// 复制授权台 · 判定（decision）
// 纯规则：同一底片只留一条未完成授权；过期或已排给别家拒绝；
// 复核缺样 / 错尺寸 / 错盒位停在待复验；关键字段修正后旧结论退回重算。

import { todayStr } from "./intake.js";

export const STATUS = {
  PENDING: "待复制",
  RECHECK: "待复验",
  DONE: "已归档",
  WITHDRAWN: "已撤回",
  REJECTED: "已拒绝",
};

// 未完成授权 = 还在占用底片、未给出最终结论的授权
export const OPEN_STATUSES = [STATUS.PENDING, STATUS.RECHECK];

const err = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const ok = (value) => ({ ok: true, ...value });

export const isOpen = (grant) => grant && OPEN_STATUSES.includes(grant.status);

export const isExpired = (grant, today = todayStr()) =>
  grant && typeof grant.deadline === "string" && grant.deadline < today;

export function openGrantFor(grants, negativeCode) {
  return grants.find(
    (g) => g.negativeCode === negativeCode && isOpen(g)
  );
}

// 入口能否登记新的复制申请
export function decideApply(data, grants, today = todayStr()) {
  if (data.deadline < today) {
    return err("grant_expired", `期限 ${data.deadline} 已过期，不予登记`);
  }
  const held = openGrantFor(grants, data.negativeCode);
  if (held) {
    if (held.deadline < today) {
      return err("grant_expired", "该底片的现有授权已过期，需先撤回或修正期限后再登记");
    }
    if (held.customer === data.customer) {
      return err("duplicate_open_grant", "同一客户在该底片上已有未完成授权，先撤回或修正原授权");
    }
    return err("negative_already_assigned", "该底片已排给别家，未完成授权结束前不再受理");
  }
  return ok({ status: STATUS.PENDING });
}

// 复制完成后，由另一人核对样片、尺寸、盒位
export function decideReview(grant, review, today = todayStr()) {
  if (!grant) return err("grant_not_found", "授权不存在");
  if (!isOpen(grant)) return err("grant_not_open", "只有未完成授权可以复核");
  if (grant.deadline < today) {
    return err("grant_expired", "授权已过期，请先修正期限再复核");
  }
  const copyMaker = review.copiedBy || grant.handler;
  if (review.verifier === grant.handler || review.verifier === copyMaker) {
    return err("verifier_must_differ", "复核人必须不是经办人，复制后须由另一人核对");
  }
  const problems = [];
  if (!review.sampleOk) problems.push("缺样片");
  if (!review.sizeOk) problems.push("尺寸不符");
  if (!review.boxOk) problems.push("盒位不符");
  return ok({
    passed: problems.length === 0,
    problems,
    copyMaker,
    status: problems.length === 0 ? STATUS.DONE : STATUS.RECHECK,
    conclusion: problems.length === 0
      ? "样片、尺寸、盒位核对一致，复制件留存馆内"
      : `停在待复验：${problems.join("、")}`,
  });
}

// 用途、期限、尺寸或盒位修正后，旧授权和结论退回重算
export function decideAmend(grant, patch, today = todayStr()) {
  if (!grant) return err("grant_not_found", "授权不存在");
  if (grant.status === STATUS.WITHDRAWN || grant.status === STATUS.REJECTED) {
    return err("grant_closed", "已撤回或已拒绝的授权不能修正，请重新登记");
  }
  const next = { ...grant, ...patch };
  if (next.deadline < today) {
    return err("grant_expired", `期限 ${next.deadline} 已过期，不能作为新期限`);
  }
  return ok({
    patch,
    status: STATUS.PENDING,
    reset: "关键字段已修正，旧结论退回，授权回到待复制重新复制、重新核对",
  });
}

// 列表 / 页面的撤回入口：仅未完成授权可撤回，撤回后底片可重新登记
export function decideWithdraw(grant) {
  if (!grant) return err("grant_not_found", "授权不存在");
  if (!isOpen(grant)) return err("grant_not_open", "只有未完成授权可以撤回");
  return ok({ status: STATUS.WITHDRAWN });
}
