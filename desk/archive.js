// 复制授权台 · 存档（archive）
// 台账落库：登记、复核结论、修正退回、撤回都留痕；复制件一律不出馆。

import { STATUS } from "./decision.js";

export function ensureGrants(db) {
  if (!Array.isArray(db.copyGrants)) db.copyGrants = [];
  return db.copyGrants;
}

export function nextGrantId(db) {
  return "CG-" + Date.now();
}

export function findGrant(db, id) {
  return ensureGrants(db).find((g) => g.id === id);
}

export function listGrants(db, { status, negativeCode } = {}) {
  return ensureGrants(db).filter(
    (g) =>
      (!status || g.status === status) &&
      (!negativeCode || g.negativeCode === negativeCode)
  );
}

export function grantView(grant, today) {
  const expired = grant.deadline < today;
  const open = grant.status === STATUS.PENDING || grant.status === STATUS.RECHECK;
  return {
    ...grant,
    expired,
    open,
    // 复制件不出馆：任何状态下都留存馆内
    staysInBuilding: true,
  };
}

function stamp(grant, at, action, note, by) {
  grant.history ||= [];
  grant.history.push({ at, action, note, by: by || "" });
}

export function createGrant(db, data, decision, at) {
  const grant = {
    id: nextGrantId(db),
    ...data,
    status: decision.ok ? decision.status : STATUS.REJECTED,
    rejectReason: decision.ok ? "" : decision.message,
    reviews: [],
    history: [],
    createdAt: at,
    updatedAt: at,
  };
  stamp(
    grant,
    at,
    decision.ok ? "登记" : "拒绝",
    decision.ok
      ? `登记用途「${data.purpose}」，期限至 ${data.deadline}`
      : decision.message,
    data.handler
  );
  ensureGrants(db).unshift(grant);
  return grant;
}

// 复核结论入档：通过则归档留存，未过则停在待复验，复制件不出馆
export function applyReview(db, grant, review, decision, at) {
  grant.reviews ||= [];
  grant.reviews.push({
    at,
    verifier: review.verifier,
    copiedBy: decision.copyMaker,
    sampleOk: review.sampleOk,
    sizeOk: review.sizeOk,
    boxOk: review.boxOk,
    passed: decision.passed,
    problems: decision.problems,
    note: review.note,
  });
  grant.status = decision.status;
  grant.updatedAt = at;
  stamp(grant, at, "复核", decision.conclusion, review.verifier);
  return grant;
}

// 关键字段修正：旧结论归档为历史，授权退回待复制重算
export function applyAmend(db, grant, patch, by, at) {
  grant.history ||= [];
  grant.history.push({
    at,
    action: "旧结论退回",
    note: `退回前状态「${grant.status}」，复核记录 ${grant.reviews?.length || 0} 条转存历史`,
    by,
  });
  Object.assign(grant, patch);
  grant.status = STATUS.PENDING;
  grant.version = (grant.version || 1) + 1;
  grant.updatedAt = at;
  stamp(
    grant,
    at,
    "修正",
    `修正 ${Object.keys(patch).join("、")}，授权退回待复制重算`,
    by
  );
  return grant;
}

export function applyWithdraw(db, grant, by, reason, at) {
  grant.status = STATUS.WITHDRAWN;
  grant.updatedAt = at;
  stamp(grant, at, "撤回", reason || "撤回未完成授权，底片可重新登记", by);
  return grant;
}
