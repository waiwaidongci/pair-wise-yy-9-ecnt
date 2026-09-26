// 复制授权台——判定业务：授权判定（过期或已排别家则拒绝）、复制后由另一人复核样片/尺寸/盒位
import {
  STATUS,
  ReproError,
  today,
  trim,
  findItem,
  itemKey,
  findActiveConflict,
  addLog,
} from "./shared.js";
import { archiveCopy } from "./archive.js";

// 授权判定：过期或同一底片已排给别家则拒绝；通过则已授权，可复制
export function judge(db, id, input = {}) {
  const auth = db.repros.find((r) => r.id === id || r.no === id);
  if (!auth) throw new ReproError(404, "repro_not_found", "授权单不存在");
  if (auth.status !== STATUS.PENDING) {
    throw new ReproError(409, "not_pending", `当前状态为${auth.status}，仅待判定授权可判定`);
  }
  const judgeName = trim(input.judge);
  if (!judgeName) throw new ReproError(400, "missing_field", "缺少判定人");
  const grant = input.grant !== false;

  let result = grant ? "通过" : "拒绝";
  let reason = trim(input.reason) || (grant ? "期限有效，底片未排给别家" : "判定人拒绝");

  // 规则一：过期即拒（无论通过/拒绝意图）
  if (grant && auth.term < today()) {
    result = "拒绝";
    reason = `授权期限 ${auth.term} 已过期`;
  }
  // 规则二：同一底片已排给别家（存在另一条未完成授权）即拒
  if (result === "通过") {
    const conflict = findActiveConflict(db, auth.itemCode, auth.id);
    if (conflict) {
      result = "拒绝";
      reason = `底片已排给别家：${conflict.no}（${conflict.client}，${conflict.status}）`;
    }
  }

  auth.decision = { judge: judgeName, result, reason, at: new Date().toISOString() };
  auth.status = result === "通过" ? STATUS.GRANTED : STATUS.REJECTED;
  addLog(auth, "判定", `${judgeName}：${result}（${reason}）`);
  return auth;
}

// 复制后复核：另一人核对样片、尺寸和盒位；缺样或错盒（含尺寸不符）停在待复验
export function review(db, id, input = {}) {
  const auth = db.repros.find((r) => r.id === id || r.no === id);
  if (!auth) throw new ReproError(404, "repro_not_found", "授权单不存在");
  if (auth.status !== STATUS.GRANTED && auth.status !== STATUS.RECHECK) {
    throw new ReproError(409, "not_reviewable", `当前状态为${auth.status}，仅已授权/待复验授权可复核`);
  }
  const checker = trim(input.checker);
  if (!checker) throw new ReproError(400, "missing_field", "缺少复核人");
  if (checker === auth.handler) {
    throw new ReproError(409, "self_review", "复核须由经办人之外的另一人核对");
  }

  const hasSample = input.hasSample === true || input.hasSample === "true" || input.hasSample === "有";
  const actualSize = trim(input.actualSize) || auth.size;
  const actualBox = trim(input.actualBox);
  const item = findItem(db, auth.itemCode);
  const currentBox = item ? item.box || "" : "";

  const problems = [];
  if (!hasSample) problems.push("缺样：未见复制样片");
  if (actualSize !== auth.size) problems.push(`尺寸不符：授权${auth.size}，实测${actualSize}`);
  if (actualBox && actualBox !== auth.box) problems.push(`错盒：授权盒位${auth.box}，实放${actualBox}`);
  if (!actualBox && currentBox && currentBox !== auth.box) {
    problems.push(`错盒：授权盒位${auth.box}，母版现位于${currentBox}`);
  }

  const record = {
    checker,
    hasSample,
    actualSize,
    actualBox: actualBox || currentBox || auth.box,
    problems,
    at: new Date().toISOString(),
  };
  auth.reviews.push(record);

  if (problems.length) {
    auth.status = STATUS.RECHECK;
    addLog(auth, "复核", `${checker}：未通过——${problems.join("；")}，停在待复验，复制件不出馆`);
    return auth;
  }

  // 复核合格：复制件不出馆，交存档业务处理
  addLog(auth, "复核", `${checker}：样片、尺寸${actualSize}、盒位${record.actualBox}均核对无误`);
  return archiveCopy(auth);
}

export { itemKey };
