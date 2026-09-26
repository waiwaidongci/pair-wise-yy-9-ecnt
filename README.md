# 古法蓝晒底片整理室

运行：

```bash
npm start
```

访问`http://localhost:3040`。数据保存在`data/cyanotype-negative-room.json`。

页面分两个页签：底片整理、复制授权台。

## 复制授权台

防止同一张底片许给多家复制客户、取片时拿错母版。规则：

- 登记授权：用途、复制尺寸、授权期限、经办人（盒位缺省取底片现盒位）。
- 同一底片只允许一条**未完成授权**（待判定/已授权/待复验），重复登记直接拒绝；授权过期，或底片已排给别家，判定时拒绝。
- 复制后由经办人之外的**另一人**复核样片、尺寸和盒位；缺样、尺寸不符或错盒一律停在**待复验**，复制件不出馆。
- 复核合格后存档（复制件留馆不出馆），该底片才可登记下一次复制。
- 用途、期限、尺寸或盒位被修正后，旧授权与复核结论退回重算，状态回到待判定（旧结论存入 `history` 备查）。
- 列表和页面均支持申请、复核、撤回（撤回后底片释放，可重新登记）。

三块业务代码分开：

| 代码 | 职责 |
| --- | --- |
| `repro/intake.js` | 入口：申请登记、撤回、修正退回重算 |
| `repro/decision.js` | 判定：授权判定（过期/已排别家拒绝）、另一人复核样片尺寸盒位 |
| `repro/archive.js` | 存档：复核合格的复制件留馆存档，不出馆 |

状态机：`待判定 → 已授权 → 已完成`；复核不过进入`待复验`；判定拒绝为`已拒绝`；未完成单可`已撤回`。

### API

- `GET /api/repros?status=&q=` 列表（含过期、冲突、现盒位等判定信息）
- `POST /api/repros` 登记申请
- `PATCH /api/repros/:id` 修正（核心字段变更退回重算）
- `POST /api/repros/:id/decide` 判定 `{judge, grant, reason?}`
- `POST /api/repros/:id/review` 复核 `{checker, hasSample, actualSize?, actualBox?}`
- `POST /api/repros/:id/withdraw` 撤回 `{reason?}`
- `GET /api/repros/stats` 各状态数量
