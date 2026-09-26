// 复制授权台 · 入口（intake）
// 把台面登记（申请 / 复核 / 修正 / 撤回）翻译成台账字段。
// 这里只管字段口径和必填校验；能不能受理、结论如何，交给 desk/decision.js。

export const GRANT_FIELDS = [
  ["negativeCode", "底片编号"],
  ["customer", "复制客户"],
  ["purpose", "用途"],
  ["size", "复制尺寸"],
  ["deadline", "期限"],
  ["handler", "经办人"],
];

// 修正后会让旧授权和结论退回重算的四个关键字段
export const AMENDABLE_FIELDS = [
  ["purpose", "用途"],
  ["deadline", "期限"],
  ["size", "尺寸"],
  ["box", "盒位"],
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const clean = (value) =>
  typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();

export const todayStr = (when = new Date()) => when.toISOString().slice(0, 10);

const flag = (value) =>
  value === true || value === "true" || value === "on" || value === 1 || value === "1";

// 复制件不出馆：任何携带出馆意图的请求入口即拦下
export function takeOutRequested(body = {}) {
  return body.outOfBuilding === true || body.takeOut === true || body.leavesBuilding === true;
}

// 登记用途、尺寸、期限和经办人；盒位默认取底片当前盒位
export function parseApply(body = {}, fallbackBox = "") {
  const data = {
    negativeCode: clean(body.negativeCode),
    customer: clean(body.customer),
    purpose: clean(body.purpose),
    size: clean(body.size),
    deadline: clean(body.deadline),
    handler: clean(body.handler),
    box: clean(body.box) || clean(fallbackBox),
  };
  const errors = [];
  for (const [key, label] of GRANT_FIELDS) {
    if (!data[key]) errors.push(`缺少${label}`);
  }
  if (data.deadline && !DATE_RE.test(data.deadline)) {
    errors.push("期限格式应为 YYYY-MM-DD");
  }
  return { data, errors };
}

// 复制后的样片、尺寸、盒位核对，必须另有复核人
export function parseReview(body = {}) {
  const data = {
    verifier: clean(body.verifier),
    copiedBy: clean(body.copiedBy),
    note: clean(body.note),
    sampleOk: flag(body.sampleOk),
    sizeOk: flag(body.sizeOk),
    boxOk: flag(body.boxOk),
  };
  const errors = [];
  if (!data.verifier) errors.push("缺少复核人");
  return { data, errors };
}

// 用途、期限、尺寸、盒位修正
export function parseAmend(body = {}) {
  const errors = [];
  const patch = {};
  for (const [key, label] of AMENDABLE_FIELDS) {
    if (body[key] !== undefined) {
      const value = clean(body[key]);
      if (!value) {
        errors.push(`${label}不能为空`);
        continue;
      }
      patch[key] = value;
    }
  }
  if (patch.deadline && !DATE_RE.test(patch.deadline)) {
    errors.push("期限格式应为 YYYY-MM-DD");
  }
  const by = clean(body.by);
  if (!by) errors.push("缺少修正经办人");
  if (Object.keys(patch).length === 0) {
    errors.push("未提供用途、期限、尺寸或盒位的修正值");
  }
  return { patch, by, errors };
}

// 撤回未完成授权
export function parseWithdraw(body = {}) {
  const data = { by: clean(body.by), reason: clean(body.reason) };
  const errors = [];
  if (!data.by) errors.push("缺少撤回经办人");
  return { data, errors };
}
