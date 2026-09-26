# 古法蓝晒底片整理室

运行：

```bash
npm start
```

访问`http://localhost:3040`。数据保存在`data/cyanotype-negative-room.json`。

## 复制授权台

同一张底片会许给几家复制客户，授权台负责登记、判定和留档，避免取片时才发现母版拿错。页面顶部「复制授权台」进入，支持申请、复核、修正、撤回。

业务代码分三块：

| 模块 | 职责 |
| --- | --- |
| `desk/intake.js` | 入口：登记用途、尺寸、期限、经办人等字段的口径与必填校验 |
| `desk/decision.js` | 判定：能否受理、复核结论、修正退回、撤回资格的纯规则 |
| `desk/archive.js` | 存档：台账落库、复核结论与历史留痕，复制件一律留存馆内 |

规则：

- 同一底片只留一条未完成授权（待复制 / 待复验）；已排给别家或期限已过期的申请直接拒绝并留档。
- 复制后由另一人核对样片、尺寸、盒位（复核人不能是经办人或复制人）；缺样、尺寸不符或错盒停在「待复验」。
- 复制件不出馆：任何出馆请求一律 403。
- 用途、期限、尺寸或盒位修正后，旧授权和结论退回重算（回到待复制，旧结论转存历史）。
- 撤回仅对未完成授权开放，撤回后底片可重新登记。

接口：

- `GET /api/copy-grants`（可按 `status`、`negativeCode` 过滤）、`GET /api/copy-grants/:id`
- `POST /api/copy-grants` 申请；`POST /api/copy-grants/:id/review` 复核
- `PATCH /api/copy-grants/:id` 修正；`POST /api/copy-grants/:id/withdraw` 撤回
- `POST /api/copy-grants/:id/take-out` 出馆（固定 403）
