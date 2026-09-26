// 复制授权台——存档业务：复核合格的复制件留馆存档，不出馆
import { STATUS, nowAt, addLog } from "./shared.js";

export function archiveCopy(auth) {
  auth.archive = {
    at: nowAt(),
    location: auth.box,
    note: "复制件留馆存档，不出馆",
  };
  auth.status = STATUS.DONE;
  addLog(auth, "存档", `复制件核对合格，存档于${auth.box}，不出馆`);
  return auth;
}
