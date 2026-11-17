Tier: 2

# add-a2ui-trip-revision-preview

## 背景

- 需求准源：`docs/spec-a2ui-trip-revision.md`（128 行，口径已于 2026-11-17 裁决，见其 §9）。
- 评审与证据：`.onion-sdd/a2ui-spec-review-20261117.md`（含依赖实测与 `file:line` 取证）。
- 现状：咕噜对话里的行程修改预览卡片由 `AssistantPage` 固定渲染。本期改用 Lynx 官方 A2UI 渲染器渲染同一张卡片，验证消息处理、动作回传、跨端表现与失败降级。
- 用户价值：为后续「模型选择组件 / 服务端下发 UI」铺路，本期先确认渲染器在三端可用且失败可降级。

## 目标

- 三端（Web / iOS / Android）看到的 A2UI 卡片与旧卡片内容、单位、正负号、引擎兜底提示等价。
- 确认与取消可用，且一次确认只应用一次；旧预览不能覆盖已变化的行程。
- A2UI 任一环节失败时退回现有卡片，且新旧卡片共用同一确认 / 取消 / 过期 / 防重入口。
- 不改服务端响应、引擎计算与本机持久化语义。

## 变更

- 新增 `lynx/src/a2ui/`：Catalog、自定义卡片组件、`RevisePreview` → A2UI v1.0 消息纯转换、每轮独立 store 与 surface、降级封装。
- 预览引入唯一 `previewId` 作为动作与状态的唯一键，取代轮次下标。
- 预览状态：`pending → applied`、`pending → stale`；取消直接丢弃预览并移除卡片。
- 确认后**留在对话页**，卡片显示「已写进行程」，另给「去行程页核对」入口（改 `App/subPages.tsx` 的 `onApplyRevise`）。
- `AssistantPage` Props 新增 `planIndex`，用于过期基准比较。
- 新增依赖 `@lynx-js/genui@0.8.0` 与 peer `@lynx-js/lynx-ui`；`@lynx-js/react` 锁 0.126.x。

## 影响范围

- 页面/模块: `lynx/src/pages/AssistantPage/index.tsx`、`lynx/src/App/subPages.tsx`（仅 assistant 分支）、新增 `lynx/src/a2ui/*`、`lynx/package.json` 与锁文件。
- 数据/API: 无。不改服务端接口、字段与错误码；A2UI 消息是客户端内部展示产物。
- 权限/安全/资金: 无。费用数字仍由引擎计算，卡片只做格式转换。
- 兼容性: 旧卡片保留为降级路径。确认后不再自动跳行程页 —— 这是**用户可感知的行为变化**，由裁决 1 明确同意。预览仍不落盘，跨页面回来卡片不存在（沿用现状）。

## 不做范围

- 模型生成 A2UI 消息或动态选择组件；服务端传输 A2UI 消息。
- 改服务端接口、改引擎计算规则、改造其他对话卡、重设计工作台。
- 预览跨页面持久化；无障碍名称；组件渲染测试基建。
- 地图与 SVG 图标迁移；账号同步；移除旧预览。

## 已确认决策

| 决策点 | 结论 | 来源 |
|--------|------|------|
| 确认后是否留在对话页 | 留在对话页，显示「已写进行程」+「去行程页核对」入口 | 用户确认 / AskQuestion |
| 过期保护的验收方式 | 保护照写；同页可达部分走真机（AC-04a），跨页面部分用测试构造（AC-04b） | 用户确认 / AskQuestion |
| 取消后卡片是否保留 | 消失，沿用现状；不设 `cancelled` 状态 | 用户确认 / AskQuestion |
| `applying` 中间状态 | 删除；应用是同步提交，不做卡片级失败反馈 | 用户确认 / AskQuestion |
| 无障碍名称 | 本期删除该要求 | 用户确认 / AskQuestion |
| 测试分层 | 纯函数层必测；渲染层降级由三端真机验收覆盖 | 用户确认 / AskQuestion |
| 「已写进行程」的语义 | 表示已提交到行程 store，不等于已落盘；存档失败沿用现有全局 toast | 由上述裁决推导，已写入 spec §9 |
| 同轮多次预览 | 一轮只保留最后一份，被覆盖的 previewId 立即失效 | Agent 技术口径，沿用现状 |
| 动作键 | previewId，不用轮次下标（恢复的历史只有 role/text，下标会错位） | Agent 技术口径 |
| 过期基准 | `tripId + planIndex + plan 对象引用`；不用 `versions.length` | Agent 技术口径，依据 `useTrips.ts` 6 个修改入口 |

## 验收

- `docs/spec-a2ui-trip-revision.md` §7 的 AC-01 ~ AC-09（AC-04 拆 a / b）。
- AC-08：Web / iOS / Android 三端实机运行并留截图或录屏；额外核对确认后仍停在对话页、显示「已写进行程」、「去行程页核对」可跳转且行程页内容与预览一致。
- AC-09：`npm --prefix lynx run typecheck`、`npm --prefix lynx run build`、`npm --prefix lynx run test` 通过，并补纯函数层测试。
- 归档入口：本 change 的 `e2e-report.md` → `## 验收结论`。

## 风险与回滚

- **渲染器可用性未验证**：a2ui 在 Lynx 4.2.0（iOS `vendor/Lynx`、Android `org.lynxsdk.lynx:4.2.0`）上的实际渲染表现只有静态证据。缓解：任务 1 先跑最小探针，不碰业务；探针失败则停在本 change 内报告，不强行接业务。
- **依赖版本窗口窄**：`@lynx-js/react-signals@0.0.7` 的 peer 上限为 0.129，升级 ReactLynx 到 0.130+ 会断。缓解：锁 0.126.x 并在锁文件固化。
- **安装体积与插件重复**：genui deps 带 `react-rsbuild-plugin ^0.22.3` / `rsbuild-plugin 0.1.9`，与仓内 0.20.4 / 0.1.3 并存。a2ui 运行时不 import 它们（grep 0 命中），但需 build 验证。
- **分支归属**：当前分支 `feat/11-17-gulu-ground-facts` 绑定另一条 change，进入 implement 前须按分支门禁处理，见下方「执行前置」。
- 回滚：移除 `lynx/src/a2ui/` 与 AssistantPage 的接入点、还原 `subPages.tsx` 导航、卸载新增依赖即可回到旧卡片；旧卡片全程保留，降级路径本身就是回滚路径。

## 前端实现决策

- 设计稿：无新增设计稿，沿用 `AssistantPage/index.module.scss` 现有卡片类，不引 genui 主题 CSS（其 `sideEffects` 只标 css，dist JS 不 import 样式）。
- 空态：无预览时不创建 surface，不渲染 A2UI（沿用现状）。
- 加载态：`renderEmpty` / `renderFallback` 一律回落到旧卡片，不新增加载文案。
- 错误态：`renderError` / `renderUnsupported` 回落旧卡片；子树抛错用 `@lynx-js/react` 的 `useErrorBoundary` 兜住后回落。不新增错误文案。
- 防重复：确认进入即按 previewId 上锁，`applied` / `stale` 一律忽略后续动作。
- 过期态：spec FR-3 要求「提示重新生成」，旧卡片无此文案。本期用最小文案「行程已变化，请让咕噜重新提一次」，仅此处新增文案。
- 新增入口文案：「去行程页核对」（裁决 1 要求的入口）。
- 响应式：不动布局与断点，沿用旧卡片。
- 灰区未覆盖：分页、权限展示与本卡片无关，跳过。

## 执行前置

- 分支门禁命中触发条件 2：当前分支 `feat/11-17-gulu-ground-facts` 绑定 change `11-17-gulu-ground-facts`（Tier 2，phase=verify）。继续在此分支改会把两次不相关改动混进同一分支的 commit 历史。建议分支名 `feat/add-a2ui-trip-revision-preview`，**待用户确认后再创建**。
- 遗留 change `11-17-gulu-ground-facts` 的 `onsf-finish --check` 未通过（`acceptance_passed=false`：真实模型对话未执行；`evidence_valid=false`：缺 `verification.json`），按 full-change 遗留扫描规则整项跳过，不归档、不阻塞本 change。
- 未创建 Trellis task（用户未选择），按无 Trellis 兜底：工作记忆走本目录 `brainstorm.md`，运行态走 `.onion-sdd/current.json`。

## References

- `docs/spec-a2ui-trip-revision.md`（需求准源，§9 为裁决记录）
- `.onion-sdd/a2ui-spec-review-20261117.md`（评审与依赖实测证据）
- Lynx A2UI 文档：https://lynxjs.org/react/genui/a2ui ；API：https://lynxjs.org/api/genui/a2ui/
- 包实测：`@lynx-js/genui@0.8.0` 的 `a2ui/dist/react/A2UI.d.ts`（`A2UIProps`）、`a2ui/dist/store/types.d.ts`（v1.0 消息）