// 复制授权台——共享状态机与规则（入口 / 判定 / 存档三块业务代码公用）

export const STATUS = Object.freeze({
  PENDING: "待判定",   // 已申请，等待授权判定
  GRANTED: "已授权",   // 判定通过，等待复制后复核
  REJECTED: "已拒绝",  // 过期或已排给别家等
  RECHECK: "待复验",   // 复核缺样 / 尺寸不符 / 错盒
  DONE: "已完成",      // 复核合格并留馆存档
  WITHDRAWN: "已撤回", // 申请方撤回
});

export const STATUS_ORDER = [
  STATUS.PENDING,
  STATUS.GRANTED,
  STATUS.RECHECK,
  STATUS.DONE,
  STATUS.REJECTED,
  STATUS.WITHDRAWN,
];

// 未完成授权：同一底片在这些状态下只允许存在一条
export const UNFINISHED = new Set([STATUS.PENDING, STATUS.GRANTED, STATUS.RECHECK]);

// 修正后需把旧授权与复核结论退回重算的核心字段：用途、期限、尺寸、盒位
export const CORE_FIELDS = ["purpose", "term", "size", "box"];

export class ReproError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const today = () => new Date().toISOString().slice(0, 10);
export const nowAt = () => new Date().toISOString();
export const trim = (v) => (v == null ? "" : String(v).trim());

export function findItem(db, ref) {
  const key = trim(ref);
  return db.items.find((x) => x.code === key || x.id === key);
}
export const itemKey = (item) => item.code || item.id;

export function findRepro(db, id) {
  const key = trim(id);
  return db.repros.find((r) => r.id === key || r.no === key);
}

// 同一底片是否已存在未完成授权（排除自身）
export function findActiveConflict(db, itemCode, exceptId = null) {
  return db.repros.find(
    (r) => r.itemCode === itemCode && UNFINISHED.has(r.status) && r.id !== exceptId
  );
}

export function nextReproNo(db) {
  const day = today().replaceAll("-", "");
  const seq = db.repros.filter((r) => (r.no || "").startsWith("RP-" + day)).length + 1;
  return `RP-${day}-${String(seq).padStart(3, "0")}`;
}

export function addLog(auth, step, note) {
  auth.logs.push({ at: nowAt(), step, note });
}

export function reproView(auth, db) {
  const item = db ? findItem(db, auth.itemCode) : null;
  const conflict = findActiveConflict(db, auth.itemCode, auth.id);
  return {
    ...auth,
    itemBox: item ? item.box : "",
    expired: auth.term < today(),
    unfinished: UNFINISHED.has(auth.status),
    conflict: conflict
      ? { no: conflict.no, client: conflict.client, status: conflict.status }
      : null,
    lastReview: auth.reviews.length ? auth.reviews[auth.reviews.length - 1] : null,
  };
}
