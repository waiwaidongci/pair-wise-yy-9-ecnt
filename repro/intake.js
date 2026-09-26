// 复制授权台——入口业务：登记申请、撤回、修正退回重算
import {
  STATUS,
  UNFINISHED,
  CORE_FIELDS,
  ReproError,
  today,
  trim,
  findItem,
  itemKey,
  findActiveConflict,
  nextReproNo,
  addLog,
} from "./shared.js";

const REQUIRED = [
  ["itemRef", "底片"],
  ["client", "复制客户"],
  ["purpose", "用途"],
  ["size", "复制尺寸"],
  ["term", "授权期限"],
  ["handler", "经办人"],
];

// 登记申请：用途、尺寸、期限、经办人；同一底片只留一条未完成授权
export function apply(db, input) {
  for (const [key, label] of REQUIRED) {
    if (!trim(input[key])) throw new ReproError(400, "missing_field", `缺少${label}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trim(input.term))) {
    throw new ReproError(400, "bad_term", "授权期限格式应为 YYYY-MM-DD");
  }
  const item = findItem(db, input.itemRef);
  if (!item) throw new ReproError(404, "item_not_found", "底片不存在");
  const code = itemKey(item);
  const active = findActiveConflict(db, code);
  if (active) {
    throw new ReproError(
      409,
      "active_exists",
      `该底片已有未完成授权 ${active.no}（${active.client}，${active.status}），同一底片只留一条`
    );
  }
  const auth = {
    id: "RPA-" + Date.now(),
    no: nextReproNo(db),
    itemCode: code,
    client: trim(input.client),
    purpose: trim(input.purpose),
    size: trim(input.size),
    term: trim(input.term),
    box: trim(input.box) || item.box || "",
    handler: trim(input.handler),
    status: STATUS.PENDING,
    decision: null,
    reviews: [],
    archive: null,
    logs: [],
    createdAt: new Date().toISOString(),
  };
  addLog(auth, "申请", `登记复制授权：${auth.client}，用途${auth.purpose}，尺寸${auth.size}，期限至${auth.term}，经办${auth.handler}`);
  db.repros.unshift(auth);
  return auth;
}

// 撤回：仅未完成授权可撤回，撤回后底片可重新登记
export function withdraw(db, id, input = {}) {
  const auth = db.repros.find((r) => r.id === id || r.no === id);
  if (!auth) throw new ReproError(404, "repro_not_found", "授权单不存在");
  if (!UNFINISHED.has(auth.status)) {
    throw new ReproError(409, "not_unfinished", `当前状态为${auth.status}，仅未完成授权可撤回`);
  }
  const reason = trim(input.reason) || "申请方撤回";
  auth.status = STATUS.WITHDRAWN;
  addLog(auth, "撤回", reason);
  return auth;
}

// 修正：用途、期限、尺寸或盒位变更时，旧授权与复核结论退回重算；其余字段仅更新
export function amend(db, id, input = {}) {
  const auth = db.repros.find((r) => r.id === id || r.no === id);
  if (!auth) throw new ReproError(404, "repro_not_found", "授权单不存在");
  if (!UNFINISHED.has(auth.status)) {
    throw new ReproError(409, "not_unfinished", `当前状态为${auth.status}，已终结的授权不可修正，请重新申请`);
  }
  const before = { ...auth };
  for (const key of ["client", "purpose", "size", "term", "box", "handler"]) {
    if (input[key] !== undefined && trim(input[key])) auth[key] = trim(input[key]);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(auth.term)) {
    throw new ReproError(400, "bad_term", "授权期限格式应为 YYYY-MM-DD");
  }
  const changed = CORE_FIELDS.filter((k) => auth[k] !== before[k]);
  if (changed.length && auth.status !== STATUS.PENDING) {
    // 退回重算：作废旧判定与旧复核结论，存档记录保留备查，状态回到待判定
    const oldDecision = auth.decision ? `${auth.decision.result}（${auth.decision.judge}）` : "无";
    const oldReviews = auth.reviews.length;
    auth.history ||= [];
    auth.history.push({
      at: new Date().toISOString(),
      decision: auth.decision,
      reviews: auth.reviews,
      archive: auth.archive,
    });
    auth.decision = null;
    auth.reviews = [];
    auth.archive = null;
    auth.status = STATUS.PENDING;
    addLog(
      auth,
      "修正退回",
      `修正${changed.join("、")}，旧授权（${oldDecision}）与${oldReviews}条复核结论退回重算，状态回到待判定`
    );
  } else {
    addLog(auth, "修正", changed.length ? `修正${changed.join("、")}等待判定` : "修正非核心信息，授权状态不变");
  }
  return auth;
}

export { today };
