# AI Native 改造清单

> 目的：把「确定性引擎 + 侧挂对话助手」改成「模型提案 + 引擎裁决」，让产出即 AI Native。
> 定位不变：**模型负责理解、提案、解释；引擎负责算钱、排时间、校验、拒绝**。
> 本文件只列工作项与判定，不含实现。动手顺序见末尾。

## 一、验收判据（四条，全中才算 AI Native）

| # | 判据 | 怎么验 |
|---|---|---|
| J1 | 不填表单，只用一句话完成一次规划并落到行程页 | 首页对话 → 「查看完整行程」→ 行程 tab 显示的就是这次对话生成的方案，可继续改 |
| J2 | AI 说出口的每个数字/事实都来自工具，可回链 `source` / `verifiedAt` | 任取 AI 一句含数字或营业时间的回答，能在避坑页/景点页找到同一条记录 |
| J3 | 同一句自然语言，聊天里和行程页得到同一种改动 | 「第二天轻松点」两处入口结果一致（同一天、同样删点、同样 impact） |
| J4 | 会话与行程跨设备可用，每次 AI 交互可度量 | 换设备继续改上次行程；能查出采纳率、工具成功率、降级次数 |

现状（2026-11-23 核实）：J1–J4 两条入口已闭合 —— A1/A2 方案落 store、A3/A4 改行走模型解析且与行程页同源、A5 工具面补齐、A6 冲突回喂、A7 提示词版本化、B1（`POST /api/ai/plans` 承担表单主链路）、B3 会话上云、B4 行程上云 + 拉取、B5 AI 度量、B6 对话回归集（`server/src/ai/eval/`，`npm run eval:chat`）均已落。N3/N4 的日期上下文、固定安排与时段粒度修改同日落地。剩余能力项见 `docs/spec-ai-native-gap.md` §5。

## 二、三条硬约束（改造中不许破）

1. **模型不产出数字**。只允许引用工具返回值；一个数字都没引用就必须转述成「需要查」。
2. **失败无损降级**。模型超时/报错/解析失败 → 走现有 `shared/engine` 本地确定性路径，主链路不阻塞。
3. **校验只由引擎判定**。模型可以提议、可以自我修正，但 error/warn 的定性权在 `validate.ts`，模型不得覆盖。

### 不动的东西（否则清单会越改越大）

- **页面布局、视觉、样式一律不动**：不新增区块、不重排、不换视觉，`*.module.scss` 一行不改。AI 改造只动数据流和调用方。
- **首页现有 AI 入口位置不变**：`ai-card`（规划卡）、`ai-banner`（咕噜横幅）、`ai-fab`（悬浮球，[HomePage](/lynx/src/pages/HomePage/index.tsx:225)）都保持原样，只改它们 tap 之后的数据去向。
- **允许的最小 UI 改动**只有两类，且必须沿用现有样式类：①新状态需要等待提示（如 revise 变异步后的 loading）；②AI 失败时静默降级、不弹错误框。
- **要改入口权重**（比如把 AI 卡升成首页主 CTA、或让 AI 取代表单成为唯一入口）属于产品与设计决策，**不在本清单范围内**，需单开一轮先出方案。

## 三、工作项

### P0 · 让 AI 进主链路（等价 J1 + J3 的一半 + J2 的最小集）

| 编号 | 工作项 | 改哪里 | 改成什么 | 验收 | 量级 |
|---|---|---|---|---|---|
| A1 | 助手方案落行程 | `lynx/src/App/index.tsx`（assistant 分支 + `onPlanned`）、`lynx/src/pages/AssistantPage/index.tsx`（`onApply`）、`server/src/routes/ai.ts` 的 `toDemand` 上提到 `shared/` | `onPlans` 拿到的方案经 `onPlanned(demand, plans)` 落 `store`，与表单提交同一个出口；`onApply` 不再只是切页，改为「带着本次方案进行程页」；slots → Demand 的默认值只留一份，避免两端补齐规则不一致 | 对话生成的方案出现在行程页、可局部修改、可保存 | 0.5d |
| A2 | 对话返回完整 `Plan` | `server/src/routes/ai.ts`（`generatePlans` 工具的返回体）、`lynx/src/aiChat.ts`（`ChatPlan` → `Plan`） | 工具返回完整 `Plan[]`（含 `days[].items[]`、`budget`、`issues`），不再只给标题摘要；前端不再自己拼展示 | 行程页渲染出的时间轴/预算与 AI 描述一致 | 0.5d |
| A3 | 局部修改走模型 | 新增 `POST /api/ai/revise`；`shared/types/index.ts` 加 `ReviseOp`；`shared/engine/planner.ts` 把 `revisePlan` 拆成「解析」与「执行」两半；`lynx/src/pages/ReviseSheet/index.tsx`（同步调用改异步，需 loading 态） | 模型输出结构化 `ReviseOp`（见 §四），引擎 `applyReviseOp` 执行并算 `ChangeImpact`；识别不了时返回 `supported:false` + 可读原因，前端原样显示 | 现有三个快捷词的结果与正则版逐条一致；「第二天别太赶」「这天换掉最贵的那个」这类现有正则认不出的说法能落地，不再回「没识别出可执行的修改」 | 1.5d |
| A4 | 意图解析单点 | `lynx/src/pages/AssistantPage`、`ReviseSheet` 共用同一份 intent → op 契约 | 两个入口都走 `/api/ai/revise`，前端不再各自解释文本 | J3 通过 | 0.5d |
| A5 | 工具面补齐（最小集） | `shared/engine/facts.ts` 的 `splitByFreshness`、`shared/engine/lines.ts` 的 `linesOf`、新增 `server/src/ai/tools.ts`、`server/src/routes/ai.ts`（注册） | 新增 `getPlaceDetail`（营业时间/票价/trust/source/verifiedAt）、`getFacts`（按城市/地点，含过期条数）、`getBudget`（分项 `basis` + `evidence`）、`validatePlan`（issues）、`listLines`（班次/末班） | AI 能回答「这个景点几点关门、票价核过没有、为什么第二天贵」并引用来源 | 1.5d |
| A6 | 校验回喂 | `server/src/routes/ai.ts`（`stopWhen` 6→8，`tool_result` 里带 issues 与 alternatives） | 引擎判出 error 时把问题与备选动作回喂模型，让它自己再提一版；连续两轮仍 error 就如实转述「这份计划有硬冲突」并给替代动作 | 故意提「一天排 5 个点」，AI 自己收敛到可行方案或明说不可行 | 1d |
| A7 | 提示词版本化 | 新增 `server/src/ai/prompt.ts` | `SYSTEM_PROMPT` 抽出成带版本号常量（`PROMPT_VERSION`），随埋点上报；改话术可回滚 | 埋点里能看到本次回答用的 prompt 版本 | 0.5d |

### P1 · 记忆与主链路替换（等价 J4）

| 编号 | 工作项 | 改哪里 | 改成什么 | 验收 | 量级 |
|---|---|---|---|---|---|
| B1 | 服务端主链路生成 | 新增 `POST /api/ai/plans`；`lynx/src/pages/PlanSheet/index.tsx`（`planFor` 调用点）、`lynx/src/App/index.tsx`（`onCity` 重算点） | 表单提交走服务端「模型提案 + 引擎裁决」，返回 `Plan[]`；请求失败/超时（3s）自动落回本地 `planFor`，界面不提示失败 | 关掉 AI 配置（`AI_API_KEY` 空）产品仍完整可用，与今天行为一致 | 2d |
| B2 | 服务端排真实路段 | `shared/engine/planner.ts`（路段耗时改为可注入）、`server/src/routes/geo.ts`（补按城市批量的方向查询） | 服务端生成时先取真实路段再算时刻，客户端 `warmTravelMinutes` 那遍重算可去掉；拿不到的段仍标 `straight` + 「约」 | 首次出方案的到达时刻就是真实值，不再先估算再刷新 | 1.5d |
| B3 | 会话上云 | 新增表 `ai_sessions` / `ai_messages`（drizzle 迁移）；`server/src/routes/ai.ts` | 会话按 `clientId` 归属（接登录后迁移），历史服务端持有；客户端只传 `sessionId` + 本轮输入 | 杀进程重进助手，能看到上次对话 | 1.5d |
| B4 | 行程上云 + 版本 | `server/src/routes/trips.ts`（放开写）、`lynx/src/storage.ts`（双写：本机优先、云端补齐） | `trips` / `trip_versions` 由只读改成可写；本机存档仍是首屏来源，联网后同步 | 换设备（换 clientId 除外）能拿到同一份行程；README 的「行程存本机」随之改写 | 2d |
| B5 | AI 侧埋点 | 新增 `server/src/ai/observe.ts`；`lynx/src/track.ts` 补 `flush` | 记录：轮次、token、延迟、工具成功率、校验回喂次数、降级触发、方案采纳（`plan_adopted`） | 能回答「昨天 100 次对话里几次生成了方案、几次被采纳、几次降级」 | 1d |
| B6 | 对话回归集 | 新增 `server/src/ai/eval/cases.json` + `eval/run.ts` | 20 条固定对话（含缺槽位、城市未开放、超预算、时间冲突、方言口语、恶意诱导编造价格），断言：不编数字、槽位正确、issue 定性正确 | 改 prompt 后一条命令跑出通过率，与上一版对比 | 1.5d |

### P2 · 数据飞轮（AI Native 的供给侧）

| 编号 | 工作项 | 改哪里 | 改成什么 | 验收 | 量级 |
|---|---|---|---|---|---|
| C1 | 反馈影响 trust | `server/src/routes/facts.ts`、`server/src/db/schema.ts`（`fact_feedbacks` 聚合） | 「这条不对」累计到阈值后降权（`official → credible`），并在条目上显示反馈数；不做审核队列 | 造 3 条反例，条目等级自动降档 | 1.5d |
| C2 | 缺口补录闭环 | `server/src/routes/submit.ts`、`server/src/routes/facts.ts` | 用户补录进入 `data_submissions`，通过后生效并标 `experience`；AI 遇到缺口主动给补录入口（现有 `SubmitField` 契约已在） | 补一条末班时间，AI 下一次回答就用上 | 2d |
| C3 | 过期复核 | `shared/engine/facts.ts` 的 `splitByFreshness` + 服务端定时任务 | `validUntil` 过期自动降为待复核并通知补录；核验脚本扩展到票价源 | 过期条目不再静默消失，能追到「该复核哪些」 | 1.5d |

## 四、接口与类型契约（A2/A3/B1 的落点）

```ts
// shared/types/index.ts 新增
export type ReviseOp =
  | { op: 'drop';      day: number; targetId: string; reason: string }
  | { op: 'reorder';   day: number; order: string[]; reason: string }
  | { op: 'retime';    day: number; startMin: number; reason: string }
  | { op: 'budget-cap'; day?: number; maxPerPerson: number; reason: string }

// POST /api/ai/revise
// 入: { plan, demand, instruction, currentDay }
// 出: { supported: true, plan, impact, said } | { supported: false, reason }
//     supported:false 时 reason 直接给用户看，不许换成客服腔

// POST /api/ai/plans
// 入: { demand, sessionId? }
// 出: { plans: Plan[], degraded?: false } | { degraded: true }  // degraded = 让前端落回本地引擎
```

工具清单（`server/src/ai/tools.ts`，入参一律窄到 id，避免模型自由发挥）：

| 工具 | 返回 | 用途 |
|---|---|---|
| `queryPlaces({city, tags?})` | 现有 + `openText`、`trust` | 选点 |
| `getPlaceDetail({placeId})` | `open`/`openText`/`ticket`/`stayMin`/`walk`/`source`/`verifiedAt`/`trust` | 解释与排程 |
| `getFacts({city, placeId?})` | `fresh[]`/`expiredCount` | 「要注意什么」 |
| `getBudget({demand, day?})` | `items[].{category,amount,basis,evidence}`、`uncertain[]` | 「为什么贵」 |
| `validatePlan({plan})` | `issues[]`（含 `alternatives`） | 自我修正 |
| `listLines({city})` | 班次/末班/核载/`trust` | 「赶不赶得上末班」 |

## 五、明确不做（这一轮）

- 不换模型（`deepseek-v4.1-flash` 已实测支持流式 + tool calling），换模型要重跑 B6 回归集再议。
- 不做 RAG 式攻略正文生成：攻略/避坑是数据资产，不是生成物。
- 不做语音、不做多城市扩展、不做多人协作（P1/P2 之外）。
- 不让模型写地名：模型只能从 `queryPlaces` 返回值里挑，现有约束保留。

## 六、执行顺序与依赖

```
A1 + A2 + A3 + A4 ─→ A5 ─→ A6        （P0：AI 进主链路）
A7 与 A5 并行

A1..A7 完成后：
  B3（会话上云） ─→ B4（行程上云）
  B5（埋点）     ─→ B1（主链路替换） ─→ B2
  B6（回归集）可与 B1 并行

P2 视数据现状单独排
```

- 先做 A1 + A2：半天级、风险最小，先让「AI 生成的方案能进行程页」，这是后面一切的前提。
- 再做 A3 + A4：同一句话两个入口给出同一个改动，AI 才算真的在操作产品。
- A5 + A6 是产品差异化的正题（能解释、能自查），建议紧随其后，不要拖到 P1。
- B5 先于 B1：没有度量就换主链路，等于把主链路变成黑盒。
- B1 动主链路，必须和「`AI_API_KEY` 未配置仍完整可用」一起验。

## 七、文档同步（改完必做）

| 文件 | 现在写的 | 要改成 |
|---|---|---|
| `README.md` | 「没有 AI 后端：方案生成仍是确定性模板」（与代码不符，`server/src/routes/ai.ts` 已在跑） | 说明：对话与提案由模型负责、计算与校验由引擎负责，主链路有降级路径 |
| `README.md` | 「局部修改只认 4 类意图」 | 改为模型解析意图、引擎执行；正则仅离线兜底 |
| `PRODUCT.md` | 「PRD 未定、不要当产品事实写死的：真实 AI 模型与提示词」 | 改为已定：模型与提示词边界见本文件 §二 |
| `docs/prd-v0.2.md` §六 | 「P0 不接模型，P1 再接」 | 与现状对齐：模型已接，边界改为「提案与解释，不产出数字」 |
