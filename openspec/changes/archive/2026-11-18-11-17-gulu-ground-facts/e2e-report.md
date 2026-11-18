# E2E Report: 11-17-gulu-ground-facts

## 验证范围

- 依据: `specs/gulu-grounding/spec.md`、`proposal.md`
- 场景数: 4
- 执行时间: 2026-11-17 11:15

## 验证清单结论

- TDD / 静态检查: 通过
- 文档对照: 一致
- 浏览器验证: 未执行

## 与 QA spec / YApi 的显著差异

| 来源 | 预期 | 当前实现或其它 spec | 结论 |
|------|------|----------------------|------|
| 无 | 本次没有 QA spec 或 YApi | 工具加在已有 `POST /api/ai/chat` 上，没有新路径 | 无冲突 |

## 通过（单元与静态检查，2026-11-17 原记录）

- 票价 null 保持「未核实」：`lynx` `npm test`，`aiGround.test.ts`
- 过期避坑只计数：同上
- 第二次硬冲突的停止文案：`conflictHint(1, 2)`
- 草稿跟到新行程、旧行程对话保留：`chatSession.test.ts`
- lynx 与 server `npm run typecheck` 通过。测试 122 项通过

## 通过（追加：真实模型对话）

2026-11-18 对本机 `8787` 打了 5 轮真实 `POST /api/ai/chat`（`AI_API_KEY` 已配，`/api/ai/status` 回 `enabled:true`），SSE 原文留档于 `$PI_SCRATCH_DIR/chat{1..5}.txt`。要点：模型确实按提示词调工具，事实类回答只复述工具字段。

| 提问 | 工具调用 | 工具返回 | 模型回答 | 结论 |
|------|----------|----------|----------|------|
| 重庆人民公园门票多少钱 | `queryPlaces` | 12 条重庆地点，无人民公园 | 「查不到它的票价」「需要你自行在官方渠道确认」 | 不编造 |
| 重庆洪崖洞门票多少钱 | `queryPlaces`×2、`getPlaceDetail`×2 | `ticket:null`、`ticketStatus:"未核实"` | 「票价我这边没有核实到…不能跟你说免费还是多少钱」；复述「00:00-24:00、23 点关灯、约 90 分钟、来源高德 POI、核验 2026-11-11」 | **null 未被当成免费** |
| 重庆有什么要避的坑 | `getFacts`×2 | `expiredCount:2`，正文不含过期条目 | 「另有 2 条已经过期了，过期条目系统不返回正文」 | **过期只计数** |
| 重庆1天2人预算中等，经典打卡尽量多塞 | `updateDemand`×2、`generatePlans`×2 | `attempt:1`、`errorCount:0`、`hint:"没有硬冲突"` | 正常给方案 | 生成器自身守住 12 小时上限，未产生硬冲突 |
| 重庆1天2人预算高，10 个点全塞同一天 | `updateDemand`×2、`generatePlans`×2 | 同上，两次均 `errorCount:0` | 按体力好重排，未报冲突 | 同上 |

## 失败

- 无
## 未覆盖（本轮仍缺）

- **`generatePlans` 第二次硬冲突的停止文案未经真实对话触发**。`validate.ts` 的 `day-too-long` 需单日跨度 > 12 小时，而 `generatePlans` 排程阶段已把一天压在上限内，自然提问几乎不会越界。因此 `conflictHint(n, 2)` 的「停止再生成」分支目前只有单测（`aiGround.test.ts`）覆盖，端到端路径未被真实模型走到。属于实现既有的兜底分支，非缺口。
- 浏览器 / 模拟器内未跑；上述均为服务端 HTTP 层真实链路，未经过 Lynx 页面渲染。

## 验收结论

- 结论: 通过
- 阻塞项: 无
- 归档建议: 可归档。原阻塞项「真实模型对话未执行」已于 2026-11-18 补跑，票价 null 与过期避坑两条都由真实模型验证；剩余仅 `conflictHint(·,2)` 分支缺端到端触发，已有单测，如实记入「未覆盖」。
