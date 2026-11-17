# Tasks: add-a2ui-trip-revision-preview

> 执行约束
> - 每个任务必须有验证点。
> - 可自动化时遵守 TDD：先写失败用例 → 最小实现 → 通过。不得先实现再补测试。
> - 前端分层：L1 契约/mock（消息适配器）、L2 行为 Scenario（状态与动作）、L3 联调（真实对话双通道）、L4 三端实机。
> - Tier 2 需要 E2E 或等价验收报告，落 `e2e-report.md`。
> - 进入本文件第 2 组之前必须完成分支门禁确认（见 proposal「执行前置」）。

## 1. 依赖与最小探针（不碰业务）

- [x] 1.1 安装 `@lynx-js/genui@0.8.0`，核对 `@lynx-js/react` 未被顶版，锁文件入库
      验证点: 实测 genui 0.8.0 / react 0.126.2 / react-signals 0.0.7。**未装 `@lynx-js/lynx-ui`** —— registry 标为 optional peer，不装也能构建（见 1.2）
- [x] 1.2 用固定 A2UI 消息 + 一个自定义 catalog 组件渲染最小卡片，验证 surface 与 action 回传
      验证点: `npm --prefix lynx run build` 退出码 0；Web 实跑通过，点击确认回传 `动作 confirm / context={"previewId":"probe-preview-1"}`，截图与细节见 `e2e-report.md`
- [ ] 1.3 三端各跑一次最小探针，记录 bundle 体积增量与已知限制
      验证点: iOS（Lynx 4.2.0 vendor pod）、Android（lynx 4.2.0 AAR）各留一张截图；体积增量写入 `e2e-report.md`
      阻断条件: 任一端渲染不出来则停止，回报结论，不继续接业务
      状态: Web 已通过；iOS / Android 待实机（需设备，交用户执行，验什么见 `e2e-report.md`）

## 2. 共享动作入口与导航

- [x] 2.1 抽出预览状态机（确认 / 取消 / 过期 / 防重）到 `lynx/src/a2ui/revisionState.ts`，旧卡片先接上
      验证点: 先写用例后实现（TDD 红→绿）；8 个用例覆盖上锁、取消、三类过期、基准比较。`npm --prefix lynx run test` 13 文件 130 用例全绿
      说明: 实现 `beginPreview` / `confirmPreview` / `cancelPreview` / `isStale`
      过程留痕: 首版用例每次新建基准对象，`planRef` 引用变化导致「确认上锁」用例失败 —— 是用例写错而非实现错，恰好验证引用比较有效。已改为复用同一基准
- [x] 2.2 `AssistantPage` Props 新增 `planIndex` 与 `onOpenItinerary`，由 `subPages.tsx` 传入
      验证点: `npm --prefix lynx run typecheck` 退出码 0；`grep -n "planIndex" lynx/src/pages/AssistantPage/index.tsx lynx/src/App/subPages.tsx` 可见传递链
- [x] 2.3 改 `subPages.tsx` 的 `onApplyRevise`：去掉 `p.back()` / `p.setTab('itinerary')`；卡片显示「已写进行程」并新增「去行程页核对」入口
      验证点: Web 真链路实跑通过 —— 真实服务端对话生成预览「青羊宫：已移出这一天 / 时间-70 分钟 · 人均没变」→ 点确认 → 仍停在对话页、显示「已写进行程」、确认按钮消失并出现「去行程页核对」→ 点它跳行程页，内容与预览一致（Day 2 只剩 1 个地点、时间 -70 分钟、人均没变）。截图见 `e2e-report.md`

## 3. 消息适配器（L1，TDD）

- [x] 3.1 先写失败用例：`RevisePreview` → A2UI v1.0 消息的纯转换，覆盖完整预览、空 recheck、费用 0/负/正、`by === 'engine'`
      验证点: 先红（`Cannot find module './revisionMessages.js'`）确认用例真的会失败
      过程留痕: 首版断言写 `-¥30`，实际旧实现输出 `¥-30` —— 是**用例期望错**，已按旧卡片真实输出对齐（负号在 ¥ 之后）
- [x] 3.2 最小实现 `revisionMessages.ts` 使 3.1 转绿
      验证点: 8 个用例全绿；数值格式与旧卡片 `fmtDelta` / `fmtMoney` 逐字一致（AC-01）
- [x] 3.3 动作白名单 `revisionActions.ts`：未知动作名、缺 previewId、类型不对一律忽略；载荷业务字段被丢弃
      验证点: 5 个用例红→绿，断言 `Object.keys(parsed) === ['kind','previewId']`，载荷里的 plan / impact / reason 不出现在结果中（AC-02 / spec「动作只携带 previewId」）

## 4. previewId 状态、防重与过期（L2，TDD）

- [x] 4.1 previewId 生成与路由，取代轮次下标；同轮后一次预览覆盖前一次且旧 id 失效
      验证点: `revisionState.test.ts` 覆盖 previewId 唯一性；`onRevise` 覆盖时 revision 整体替换，旧 previewId 动作被白名单+previewId 比对挡掉
- [x] 4.2 确认上锁 —— 连续点击、重复 Action、applied 后再动作，均只应用一次
      验证点: 用例断言 `applied === 1`（连点三次）；实跑确认按钮在 applied 后消失
- [x] 4.3 过期判定 —— `tripId` / `planIndex` / `plan 引用` 任一变化即拒绝
      验证点: 三个独立用例各断言 `status === 'stale'`；`plan 引用` 用例用重算的 plan 模拟 pickPlan / changeCity
- [x] 4.4 状态转换 `pending → applied` / `pending → stale` 与取消丢弃；过期提示文案接入
      验证点: 实跑 applied 显示「已写进行程」+「去行程页核对」；stale 文案「行程已变化，请让咕噜重新提一次」已在 legacyCard 分支就位
      验证点: `npm --prefix lynx run test` 全绿；Web 手动验证取消后卡片移除且行程未变（AC-03）

## 5. Catalog、卡片与降级

- [x] 5.1 实现 Catalog 与 `TripRevisionCard`，复用现有卡片样式类，不引 genui 主题 CSS
      验证点: `npm --prefix lynx run build`（含 `check:css`，710 class 对上）退出码 0；Web 实跑内容与旧卡片一致（AC-01）
      catalogId: 自有标识 `funnyplus.a2ui.tripRevision.v1`，`createSurface` 与 `<A2UI>` 两处同值
      不引 lynx-ui: 只注册自定义组件，未用任何内置输入类组件（它是 optional peer）
- [x] 5.2 实现 `RevisionSurface`：每轮独立 store 与 surface，换 store 用 `key={previewId}` 重建 processor
      验证点: 实跑 surface 元素 id 为 `surface-revision-rev-mwkcq3f7-1`，previewId 进了 surface 身份
- [x] 5.3 实现降级：`renderEmpty` / `renderFallback` / `renderError` / `renderUnsupported` 全部回落旧卡片
      验证点: 四个回调指向同一个 `legacyCard`，新旧共用同一套确认/取消/过期/防重入口（spec FR-4）
- [x] 5.4 用类组件 `componentDidCatch` 包住 A2UI 子树，渲染期抛错时回落旧卡片
      验证点: 加壳后实跑，A2UI 卡片仍正常渲染（surfaceId `surface-revision-rev-mwkcz59i-1`），未误触发降级
      更正: 计划里写的 `useErrorBoundary` 不适用 —— 本仓 `runtime/lib/index.js` 通过 `export * from './core/hooks/react.js'` 确实导出了它，但它是「在组件内调用、捕获其父级」语义，做不了包裹 A2UI 的边界；改用 `Component` + `componentDidCatch`（Lynx 测试里 `lifecycle.test.jsx:282` 有先例）
      未验: 真正抛错的回落路径没有构造出来（要人为让 TripRevisionCard 抛错），留待 6.3 三端验收一并做（AC-05 抛错分支）

## 6. 双通道与验收


- [ ] 6.1 真实对话联调：流式与非流式各生成同一份预览，核对展示与动作一致；引擎兜底时显示来源提示
      验证点: 服务端两条路径各跑一次，记录请求与卡片截图（AC-06）
- [ ] 6.2 核对未改动服务端响应、引擎计算与本机持久化语义；降级不触发第二次模型请求
      验证点: `git diff --stat server/ shared/` 为空；一次降级过程中服务端只收到一次模型请求（AC-07）
- [ ] 6.3 三端完整验收：首页进入助手 → 生成预览 → 确认 → 取消 → 同页双预览过期路径；核对长文本与状态展示
      验证点: Web / iOS / Android 各留截图或录屏，含确认后仍停在对话页、已写进行程、去行程页核对可跳转（AC-08 / AC-04a）
- [ ] 6.4 全量门禁并写验收报告
      验证点: `npm --prefix lynx run typecheck`、`npm --prefix lynx run build`、`npm --prefix lynx run test` 三条命令退出码均 0；结论与残余风险写入 `e2e-report.md` 的 `## 验收结论`（AC-09）