# Brainstorm: add-a2ui-trip-revision-preview

无 Trellis task 绑定，本文件是本 change 的脑暴工作记忆（full-change 无 Trellis 兜底路径）。

需求澄清已在本次 change 之前完成：`docs/spec-a2ui-trip-revision.md` 经评审后由用户逐条裁决，
裁决记录在该 spec 的 §9，证据在 `.onion-sdd/a2ui-spec-review-20261117.md`。
因此进入本 change 时前沿为空，不再对已裁决条目重问。

## 已确认决策

| 决策点 | 结论 | 来源 |
|--------|------|------|
| 确认后是否留在对话页 | 留在对话页，显示「已写进行程」+「去行程页核对」入口 | 用户确认 / AskQuestion |
| 过期保护的验收方式 | 保护照写；AC-04a 真机、AC-04b 测试构造 | 用户确认 / AskQuestion |
| 取消后卡片是否保留 | 消失，沿用现状；不设 `cancelled` | 用户确认 / AskQuestion |
| `applying` 中间状态 | 删除，不做卡片级失败反馈 | 用户确认 / AskQuestion |
| 无障碍名称 | 本期删除 | 用户确认 / AskQuestion |
| 测试分层 | 纯函数必测 + 渲染层真机覆盖 | 用户确认 / AskQuestion |
| 「已写进行程」语义 | 已提交到 store，不等于已落盘 | 裁决推导，spec §9 |
| 同轮多次预览 | 只留最后一份，旧 previewId 失效 | Agent 技术口径 |
| 动作键 | previewId，不用轮次下标 | Agent 技术口径 |
| 过期基准 | `tripId + planIndex + plan 引用` | Agent 技术口径 |
| 过期提示文案 | 「行程已变化，请让咕噜重新提一次」 | Agent 最小文案，spec 要求提示但未定措辞 |
| 新入口文案 | 「去行程页核对」 | 裁决 1 要求的入口 |

## 本轮前沿

（空）

## 未决

（空）

## 待用户拍板的执行前置（非需求问题）

- 分支归属：当前分支绑定另一条 change，建议 `feat/add-a2ui-trip-revision-preview`，等用户确认。
- 遗留 change `11-17-gulu-ground-facts` 预检未过，已整项跳过，归档由用户决定。
- 是否补建 Trellis task：用户未选择，当前按不建继续。