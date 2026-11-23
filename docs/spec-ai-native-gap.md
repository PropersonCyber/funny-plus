# AI Native MVP 差距闭合规格

- 状态：R 组、G1–G7、X1–X6 已完成（见 §0.1）；剩 §1 四项决策与 DOC1–DOC5；其中 D1 决定 §5 是否成立，N 组（N1–N11）全部阻塞在 D1- 范围：把当前实现与 AI Native MVP 口径的差距，转成可判定、可分期、可验收的工作项
- 使用方：Funny+ 全栈（`lynx/` 客户端、`server/` 服务端、`shared/` 引擎、`data/` 数据）
- 日期：2026-11-18
- 取证基线：HEAD `faad1b9`，`git diff` 为空（`e3b0c442`）。本文全部结论为**静态代码与数据取证**，未跑 App、未调外部接口，运行时行为见 §9。

## 0. 怎么用这份文件

每条工作项固定三段：**现状证据**（`文件:行`）→ **要求**（MUST / MUST NOT）→ **验收**（WHEN / THEN，可直接写成测试）。

编号规则：`D` 待裁决策 · `R` 红线 · `G` 判据闭合 · `N` 能力补齐 · `X` 代码卫生 · `DOC` 文档同步。
`R` / `G` 不依赖任何裁决，可直接开工；`N` 全部挂在 D1 之下。

口径三方对账来源：`docs/ai-native-mvp.md`（产品 F01–F10）、`docs/ai-native-plan.md`（AI Native 判据 J1–J4 与工作项 A/B/C）、`docs/product-plan.md` + `PRODUCT.md`（A 版）。**三方当前互相冲突，见 D1。**

### 0.1 已完成的工作项

| 编号 | 主题 | 关键改动 | 验证 |
|---|---|---|---|
| R1/R2 | 开发码开关 | `isDev()` 读 `AUTH_DEV_CODE`，关闭时 `/api/auth/dev-code` 返 404，启动打告警 | 门禁 + 手工核对 |
| R3 | 照片归属 | `GET /api/photos/:id` 加归属校验，私有对匿名 404；新增 `DELETE`；按 id 判公开引用 | `photos.test.ts` 8 例 |
| R4 | 演示班次 | `canJudgeHard` 加 `!isDemo`，`rankLine` 让 demo 沉底 | 门禁 |
| R5 | 收藏删除越权 | 已登录只认 `userId`；`mine` 查询补 `userId` 分支 | `me.test.ts` 3 例 |
| R6 | 同步失败可见 | 新增 `syncStatus.ts` 状态机，界面按真实状态改文案 | `syncState.test.ts` |
| G1 | 服务端取真实路段耗时 | 新增 `ai/routeWarm.ts`；`generatePlans` 两遍生成 | `routeWarm.test.ts` |
| G2 | 客户端注入线路 | 新增 `lines.ts`；表单路径的末班/核载硬约束不再静默跳过 | `engine.test.ts` 33 例 |
| G3 | 未知项全量上屏 | 未核实项从 `uncertain[0]` 改为全量；行程页页脚不再硬写「待核实」 | 门禁 |
| G4 | 避坑同源 | `facts.ts` 服务端优先 + 随包兜底；新增 `factsData.ts` | `factsData.test.ts` 3 例 |
| G5 | 云端拉取与补推 | trips 扩 `plans`/`plan_index`/`ended_at`；新增两个列表接口；`syncMerge.ts`；登录自动补推+拉取 | `syncPull.test.ts` 11 例、`syncMerge.test.ts` 11 例 |
| G6 | 会话上云 | `ai_sessions`/`ai_messages`；chat 只传 `sessionId + input`；历史只回文本，预览卡不复活 | `aiHistory.test.ts` 10 例 + 真实模型冒烟 |
| G7 | AI 侧度量与漏斗 | `ai_calls` 表 + `ai/observe.ts` + `ai/metrics.ts` + `npm run metrics`；`PROMPT_VERSION` | `metrics.test.ts` 13 例 + 真实对话冒烟 |
| X1 | 提示词版本化 | 抽 `ai/prompt.ts` + `PROMPT_VERSION`，随 `ai_calls.prompt_version` 落库 | `metrics.test.ts` 13 例 |
| X2 | 重复路由与过期注释 | 删掉重复的 `GET /status`；`:112` 那条挂在 `lastUserText` 上的 `ownerId` 注释整段移除 | 门禁 |
| X3 | 死代码 | 删 `lynx/src/auth.ts`（仓内零 import、两端原生零引用）；`openLocationSettings()` 连同 `__fpOpenSettings` 契约一起删，`CityPage` 直接给可执行的权限提示；`trackSessionId` 已被 G7 调用 | 门禁 |
| X4 | 草稿 id 漂移 | `loadGuides` 原样恢复 `draft.id` | `guides.test.ts` 4 例 |
| X5 | 失败提示与占位文案 | 对话失败带「重新发送」+ `chatError.ts` 把英文运行时错误翻成中文；本地兜底预览改用 `applyReviseOp` 已算出的 `affected`（`revisePlan` 不再丢弃）；攻略页旧文案换成已支持发布的口径；城市列表搜索图标指向现有筛选；麦克风不再假装「聆听中」；`runSend` 依赖补齐 `planIndex`；AI 未配置时首页浮标隐藏 | `chatError.test.ts` 4 例 |
| X6 | 有表字段无写入 | `photos.sha256` 做同人同图去重（命中复用 id，不落第二份）；`factFeedbacks` 落 `userId` 并按 userId 补判重；`trip_versions` 已由 G5 写入 | `photos.test.ts` 9 例（含去重用例） |
| N8 | 回忆草稿生成 | `lynx/src/memoryDraft.ts` 的 `buildMemoryDraft` + 纯函数 `draftFor`（已有回顾 / 已有草稿 / 刚否掉且无新记录 / 整理不出内容，四种都不生成）；`endTrip` 不再刷新 `updatedAt`、不再覆盖用户文字；`discardDraft` 记 `draftDismissedAt`；采纳前对非空回顾二次确认；**完全无记录时返回空串**，不再生成只有「还没记」的清单 | `memoryDraft.test.ts` 15 例（共 217） |

| N10 | 表单走模型提案 | 新增 `POST /api/ai/plans` + `server/src/ai/propose.ts`（模型只给地点顺序）+ `generatePlans(demand,{order})` 接缝；`lynx/src/planFetch.ts` 6s 超时无损落回本地 | `engine.test.ts` 3 例（共 209）；模型路径需真机 + key 冒烟 |
| N4 | 时段粒度修改 | `ReviseOp` 加 `ease{day,window}`；关键词兜底认「上午/下午/晚上」；`retime` 加 `WINDOW_FLOOR`（压缩不得把安排拖出原时段），换序用 `keepWindows:false` | `engine.test.ts` 4 例（含「晚上的安排不被拖进下午」） |
| N3 | 日期与固定安排 | `ItineraryItem.pinned` + 行程页「固定」开关 + `applyReviseOp` 拒绝 drop/replace + **`reorder` 让固定项保持原位次**；**`dateFrom` 全链路（表单 → 落库 → 引擎）+ `places.closedWeekdays` 闭馆判断**（迁移 `0018`） | `engine.test.ts` 6 例 + `dayDate.test.ts` 14 例 |
| N11 | 对话回归集 | `server/src/ai/eval/`（6 类用例 + 判定纯函数 + SSE runner）+ `scripts/chat-eval.ts`；runner 保留 `tool_result`，判定新增 `noInventedPrices`（金额须在工具返回里有出处）、`engineIssues`（引擎真的判出 over-budget / empty-day）、`expectPlans`、`slotsAbsent`；every `mustMention` alternative 拆成独立「或」组 | `eval/checks.test.ts` 18 例；真实模型跑批未执行（需 key + 起 `dev:api`） |
| C1/C2/C3 | 数据飞轮 | `server/src/data/trustRules.ts`（阈值集中）；`GET /api/facts`、`GET /api/content`、AI `getFacts` **三处共用 `factWithTrust`**（反馈 + 有效期，AI 不再用进程级缓存）；`POST /api/submit` 按**归一化后的值**凑票（`17:00` 与 `1020` 算同一票）、只在原列为空时写入、**写入同时把行压到 `experience`**（`capTrust`）、写 0 行时不再谎报 `promoted`、**凑票只认登录账号**（`isAgreed`，自报 `clientId` 不算数） | `trustRules.test.ts` 19 例 + `submit.test.ts` 5 例（真库） |

门禁现状（2026-11-23 第三轮复跑）：lynx typecheck 0 / lynx test **280** / `check:css` 837 class 通过 / server typecheck 0 / **server test 180 例全绿（19 个文件，含连库的 8 个）**。连库测试是本次先起 `docker compose -f server/docker-compose.yml up -d` + `db:migrate` + `db:seed` 之后真跑通的，不再是「本机无 Postgres 未跑」。

### 0.1.1 2026-11-23 复核五个「已完成」项发现的缺陷

上一轮把它们标成已完成，但按验收口径复跑后，有九处是「读起来对、跑起来不对」。共同点是都不会报错，只会让用户在某一刻看到自相矛盾的结论或丢字。前五条来自对报告项的复核，6–7 是修完之后做边界检查追加的，8–9 是拉起真库跑全量测试时才暴露的 —— 那两个问题一直存在，只是以前连库测试从没在本机跑过。

| # | 问题 | 实际行为 | 改动 |
|---|---|---|---|
| 1 | 时段修改会动其他时段，固定安排也可能被移动 | 「第二天下午轻松点」只删下午那一条，随后整天重排：晚上 19:00 的夜游被算到 14:50。`reorder` 走过另一条分支，`pinned` 拦不住它 | `retime` 按**原本所属时段**设地板（`WINDOW_FLOOR`），换序显式 `keepWindows:false`；`reorder` 让固定项留在原位并在 reason 里说明 |
| 2 | 补录可能继承「官方」可信度，且 C2 一直静默失效 | `promoteIfAgreed` 写值但不动 `trust`，官方行吸收用户填报后仍走 `canJudgeHard` 判硬冲突；同时 `Number('17:00')` 是 NaN，**带冒号的时间永远进不了线上表**，而 vote 按原字符串分组，`17:00` 与 `1020` 各算一票 | 归一化收敛到 `normalizeSubmitValue`（写库与凑票共用）；写入时 `capTrust` 把行压到 `experience`；`UPDATE ... RETURNING` 写 0 行时不再谎报生效 |
| 3 | 回忆草稿三个问题仍在 | 采纳覆盖用户已写的回顾；删掉草稿后重开再结束会再生成同一份；完全没有记录时仍生成「还没记」 | 见 §N8（`draftFor` + `draftDismissedAt` + 采纳二次确认 + 空态返回空串） |
| 4 | 反馈降级只覆盖了一个入口 | `GET /api/facts` 走 `resolveTrust`，但 `/api/content` 与 AI 的 `factCache` 用库里的原始 `trust`；`factCache` 还在进程生命周期内不再失效，AI 的回答永远停在服务启动时那一档。攻略页徽标同样直接读 `f.trust` | `feedbackStats()` + `factWithTrust()` 三处共用；AI 去掉进程级缓存改为每轮重查；徽标改走 `displayTrust` |
| 5 | 回归集判不出它声称要判的东西 | `price-bait` 只禁三个字面串；`over_budget` / `time_conflict` 只看关键词、从不看引擎，且两条的前提本身就是错的（重庆两天不超预算；都江堰/青城山不在收录里）；`mustMention` 的 AND/OR 写反，诚实回答反而失败 | runner 保留 `tool_result`；新增 `noInventedPrices` / `engineIssues` / `expectPlans` / `slotsAbsent`；用例前提换成引擎确实会报出来的需求 |
| 6 | 补录的间隔值无上界 | `intervalMin` 原来只挡 0 与负数，`1512`（25 小时一班）能写进 int 列，等车推算随之失真 | 归一化时同样按「不超过一天」挡掉，并补一条用例 |
| 7 | 回归基线会混进提交 | `chat-eval.ts` 注释写着「基线不进版本库」，但 `.gitignore` 里没有对应条目 | 补进 `.gitignore`，`git check-ignore` 已验证 |
| 8 | 补录凑票可以自导自演 | `clientId` 是客户端自报的，同一个人换两个字符串就是「两个独立设备」，一条未经核验的末班因此能写进线上表 —— C2 的立论（多个人独立一致）根本不成立 | 凑票只认**登录账号**：`isAgreed` 默认只数 userId，匿名票完全不参与计数（不是降权，是排除——降权仍可伪造）。`submit.test.ts` 用真库覆盖「一人两 clientId 不生效 / 两账号才生效 / 同账号换设备只算一票」 |
| 9 | 改草稿再保存会误判冲突 | `PUT /api/guides/:id` 拿客户端自己的编辑时刻比服务端写入时刻，客户端时刻几乎必然更早，于是连续保存两次必有一次被判 `stale_write` | 冲突判定改比**两端同一量纲的值**（草稿 payload 里的 `updatedAt`），`share.test.ts` 那条一直红的用例随之转绿 |

### 0.2 2026-11-22 补的三项（不依赖任何裁决）

上一轮取证后单独补的几处，都属于「代码与数据自相矛盾」而不是新能力：

| 项 | 问题 | 改动 | 验证 |
|---|---|---|---|
| 快照冒充已核验 | 客户端先用随包 `data/*.json` 渲染、接口回来再覆盖（`lynx/src/factsData.ts`），而避坑页直接读 `f.trust` 上屏（`GuidePage/index.tsx`、`GuideDetailPage/index.tsx`）。库里把某条降档后，打进包的旧副本仍显示「官方信息」/「官方已核验」——正是 G3 要收的口径，只是漏在避坑条目上 | `TravelFact.origin`（`canonical`/`bundled`/`server`，只走内存不入库）+ `displayTrust()`：非 canonical 的 `official` 一律降一档显示；`originNote()` 额外说清来路 | `factsData.test.ts` 新增 3 例（共 192） |
| 接口裁剪字段 | `GET /api/content` 的 `toPlace` 少 `openText`、`toFact` 少 `placeId`/`poiGroup`，与 `GET /api/places`、`GET /api/facts` 不同形。客户端 `applyPlaces` 用 content 覆盖随包副本后，行程页的营业时间原文（`ItineraryPage:362`）静默变空 | 两处补齐；`poiGroup` 类型本就允许可选 | lynx typecheck 0 / server typecheck 0 |
| 结束旅行无回忆记录 | `endTrip` 只写 `endedAt`，回忆页每条安排读 `memory.places`，没有记录时整页只剩「还没记录」，等于「归属于某趟旅行的记录」没有起点 | `useTrips.endTrip` 结束时建一份空回忆记录；已有内容只更新 `updatedAt`，不覆盖用户的文字；`visited` 仍默认 `unknown`，不替用户写「去过」 | 同上（纯状态构造，无外网依赖） |

未做（仍需裁决）：首页咕噜迎接与主卡入口权重（N1/N2，与 `docs/ai-native-plan.md:26` 的「不动入口权重」冲突，属 D1）；固定安排与时段粒度修改（N3/N4，D1 口径）；现场推荐与下一站（N6/N7，D4 数据供给为零）；登录三通道（N5，D3）；攻略照片勾选「不默认带出」（N9，`useGuides.ts:72` 仍自动带前 3 张，改它要同时定「重生成时是否保留用户已选」）；DOC1–DOC5。

**技术栈未定的地方只留了接口位，没有擅自选型**：G7 的聚合口径集中在 `ai/metrics.ts`，命令行只负责打印，将来接看板不改编排；G5/G6 的会话与行程存储都走既有的 drizzle + Postgres，没有引入新组件；N5 的三项外部依赖（短信服务商 / 微信开放平台 / Sign in with Apple）仍等 D3 定责任人后才落实现。

### 0.1.2 2026-11-23 第三轮：补五项缺能力，并修掉过程中暴露的三处真缺陷

这一轮补的是产品清单上「仍未做」的能力。补的过程中，新写的测试反过来抓出三处真缺陷 ——
共同点还是老样子：不会报错，只在某个具体时刻给出错的结论。

| # | 能力 | 做了什么 | 验证 |
|---|---|---|---|
| 1 | 首页咕噜迎接（N1/N2） | 主 CTA 从「进表单」改为「进助理」，有行程时多一张当前旅行卡（点它带一句「继续调整」进对话）。表单没删，仍从「行程规划」快捷格进 —— 两条路都到同一份行程 | 门禁 + 手工核对 |
| 2 | 轻量规划（F04 任务 B） | 新增 `shared/engine/lightPlan.ts`：`Demand.hours` + `startMin` 走单日规划，从指定时刻起算、到点就停、不计住宿。表单加「时长」行 | `lightPlan.test.ts` 18 例 |
| 3 | 到达判定与下一站（F04/F05） | 新增 `shared/engine/onSite.ts`：到达半径 + 精度阈值（>500m 不判）、过期快照不判、共三档结论；下一站按行程顺序算，未核验班次不标已核验；城市交通**如实地报不可用**。行程页每条景点有「我在这附近 / 下一站」 | `onSite.test.ts` 19 例 |
| 4 | 季节性营业时间 | `Place.seasons`（人工摘录，不从 `openText` 正则解析）+ `shared/engine/opening.ts`。只在日期已知时按季节取档；无档或日期未知退回全年最保守值。迁移 `0019`，7→5 个地点有档 | `opening.test.ts` 8 例 |
| 5 | 登录三通道（N5） | 短信真接阿里云（`server/src/auth/sms.ts`）；微信接 unionid 兑换、Apple 接 identityToken 本地验签（含 alg/aud/iss/exp 四道闸）；三者共用一个签发入口 `issueSession`。未配置时如实 501/503，**不再假装发出短信** | `loginProviders.test.ts` 13 例（含 7 个 Apple 拒绝分支） |
| 6 | 回忆 AI 叙述（F07） | `POST /api/ai/memory-narrative`：模型只改写用户写过的内容，每段必须挂靠一条真实记录，`applyNarrative` 把指不上的句子丢弃；不可用落回确定性草稿。`memoryDraft` 移到 `shared/` 供两端共用 | `narrate.test.ts` 7 例 + 既有 15 例迁移后仍绿 |

**这一轮被测试抓出来的三处真缺陷**：

| # | 问题 | 实际行为 | 改动 |
|---|---|---|---|
| A | 轻量规划只判「时长放得下」，不判「到的时候还开着」 | 「四小时」从 21:00 起算会排进 23:00 关门、却要停留一小时的点 —— 用户到门口进不去。测试 `时长不够排下任何一站时给可读原因` 先红 | 加 `end > window[1]` 这个门槛，与截止时刻并列判 |
| B | 季节档的 `open` 语义与 `Place.open` 不一致 | `Place.open` 存的是「最晚可进入」（`lightsOffCap` 把「16:00 停止检票」收在这里），我第一版季节档填的是名义关门时间（故宫 17:00）。真数据冒烟直接红：夏季应判 16:00 而不是 17:00 | 五条季节档全部改成「最晚入园」口径；`Place.open` 与 `OpenSeason.open` 的类型注释把这条钉死 |
| C | `db:seed` 的 upsert 不会清除已删除的可选字段 | 从 `data/places.json` 删掉一条季节档后重跑 seed，库里那份原样留着 —— 「数据已经改了」和「线上还在按旧数据判」同时成立。天坛与长江索道的档就是这样残留在库里的 | seed 对 `seasons` / `closedRanges` / `closedWeekdays` 显式置 null/空 |

**仍未做（能力已备，缺数据）**：吃/拍/买事实 0 条、城市公交地铁 0 条、POI 到达半径未逐个核、
`dateTo` 无独立入口、攻略照片勾选（N9）未动。这些不是代码问题，是数据与产品口径问题。

## 1. 待裁决策（阻塞项，先答再动 §5）

### D1 验收基准是哪一版

`docs/ai-native-mvp.md:3,7` 写「当前 MVP 以 A 版为准」「当前不做：账号与跨设备同步、攻略分享快照」，但 HEAD 前四个 commit 已把账号同步、攻略分享、A2UI 预览、事实上屏全部落地并归档验收。

- 选项 A：以文首 A 版为准 → 账号/分享属超范围交付，需决定「回收」还是「补完到可用」；§5 的 N1–N8 大部分不做。
- 选项 B：以 F01–F10 全量为准 → 文首 A 版声明作废，F04/F05 从零起，且必须先解 D4 的数据供给。

**未定之前不要动 §5。** `R` / `G` 两组与本决策无关。

### D2 首发城市与验收旅程

`docs/ai-native-mvp.md:102,104` 两条验收旅程都指定北京，但北京数据最薄：facts 仅 8 条（成都 21 / 重庆 18），12 个地点中只有 7 个挂到事实，唯一线路 `bj-summer-palace-ferry` 为 `pending` 且首末班/间隔/票价全 null。

- 选项 A：补北京数据到可验收（工作量在数据侧，不在代码侧）。
- 选项 B：把验收旅程改到重庆或成都，北京降为「可规划但不可现场验收」。

### D3 三项外部依赖谁去申请

短信服务商、微信开放平台移动应用 AppID、iOS Sign in with Apple 能力配置。这三项不通，F06 永远停在占位（见 N5）。**属外部流程，不是代码问题**，需要指定责任人与时间点。

### D4 F04 / F05 是否进本期

现场推荐所需的吃 / 拍 / 买数据为 **0 条**（`data/facts.json` 的 `poiGroup` 只有 `pitfall` 38 / `access` 9）；城市交通真实班次为 **0 条**（`data/lines.json` 5 条中 4 条全 null，第 5 条是构造数据）。

先做交互只会得到空壳。建议：**数据供给未落地前不开 F04/F05 的交互工单**。

## 2. 差距总览

### 2.1 AI Native 四条硬判据（`docs/ai-native-plan.md:11-14`）

| 判据 | 现状 | 断点 | 闭合项 |
|---|---|---|---|
| J1 不填表单，一句话完成规划并落行程页 | 通 | — | — |
| J2 AI 说出口的每个数字可回链 `source`/`verifiedAt` | 半通 | 对话气泡无来源上屏；避坑数据两端不同源 | G3、G4 |
| J3 同一句自然语言，聊天与行程页得到同一种改动 | 半通 | 解析已同源，但两端喂给引擎的数据不同 | G1、G2 |
| J4 会话与行程跨设备可用，每次 AI 交互可度量 | 断 | 无会话表；云端只推不拉；无 AI 侧度量 | G5、G6、G7 |

J1 证据链：`lynx/src/pages/AssistantPage/index.tsx:265` → `lynx/src/App/subPages.tsx:202` → `lynx/src/App/index.tsx:76` → `lynx/src/App/useTrips.ts:102`。

### 2.2 产品功能（`docs/ai-native-mvp.md:76-87`）

| 编号 | 现状 | 主要缺口 | 工作项 |
|---|---|---|---|
| F01 首页与咕噜 | 已完成 | 主 CTA 进助理、当前旅行卡已上首页；表单仍作为第二入口保留 | — |
| F02 旅行上下文 | 完成 | 固定安排与日期范围均已接入（N3） | — |
| F03 规划与修改 | 已完成 | 预览确认、时段粒度（ease）、轻量规划（hours）均已落；**两种规划起点**已落：按时间（`startMin` 出发 + `returnBy` 约束 + 延长备选）与按景点反推（`mustVisit` → 建议出发/返回）；表单有出发/返回时刻行 | — |
| F04 现场推荐 | 判定已做、数据缺 | 到达判定与附近检索已落；对话可**无行程**直查附近，支持手动指定起点（`placeId`）与吃/玩/拍照三类标签筛选；吃类只有小吃街/商圈（无餐厅数据），拍类无机位与时段 | D4 → N6 |
| F05 路段交通与下一站 | 部分 | 新增 `transportFor` 工具：按实际人数逐段比步行/打车/景区线路，算全团价、分乘、是否要走更快，越核载明示；城市公交 0 条，如实报不可用 | D4 → N7 |
| F06 账号与同步 | 代码已通、差凭证 | 短信接阿里云、微信接 unionid、Apple 本地验签；未配时如实 501/503 | 外部凭证 |
| F07 收藏与回忆 | 已完成 | 结束旅行草稿 + AI 叙述整理（每段挂靠真实记录，不编感受） | — |
| F08 攻略与分享 | 部分 | 快照冻结与撤回已真实现；无照片勾选、无更新发布 | R6、N9、X4 |
| F09 可信与失败 | 部分 | 未知票价告知被截断；页脚 trust 自相矛盾；无重试入口 | G3、X5 |
| F10 评估 | 部分 | 事件已落库，但无聚合口径、无旅程标识 | G7 |

### 2.3 改造清单完成度（`docs/ai-native-plan.md`）

- 已落：A1、A2、A3、A4、A5、A6（A5 工具内联在 `server/src/routes/ai.ts:193-315`，未抽 `tools.ts`，不影响判据）
- 未落：A7（无 `prompt.ts` / `PROMPT_VERSION`）→ X1；B1（无 `/api/ai/plans`）→ N10；B2 → G1；B3 → G6；B6（无 eval 目录）→ N11
- 部分：B4（`PUT` 已开但无 `GET`）→ G5；B5（客户端埋点齐、服务端 AI 度量缺）→ G7
- 已落（2026-11-23）：C1 / C2 / C3，见 §0.1 与 §6.1

## 3. P0 红线（R 组，与 D1 无关，建议先修）

### R1 生产环境接受固定验证码

现状：`server/src/auth/codes.ts:45` `isDev = env !== 'production'`；`:76` dev 分支对任意手机号放行 `DEV_CODE`。`server/.env`、`server/.env.example`、`server/package.json:7` 的 `start` **均未设置 `NODE_ENV`**（实测 `grep -c NODE_ENV` 为 0）。按仓库现有配置部署即 dev 生效。

要求：生产路径 MUST NOT 接受固定码。判定 MUST 改为**显式开启**（白名单）而不是「非 production 即开」。部署配置 MUST 显式声明环境。

验收：
- **WHEN** 未设置任何环境开关，向任意手机号提交 `123456`
- **THEN** 登录失败，且不产生 session
- **WHEN** 显式开启开发开关
- **THEN** 固定码可用，且启动日志有一条醒目告警

### R2 开发验证码经接口外泄

现状：`server/src/routes/auth.ts:203` `GET /api/auth/dev-code` 在非生产直接返回验证码；`lynx/src/App/useAuth.ts:84` 取回后由 `lynx/src/pages/LoginPage/index.tsx:114` 渲染成界面提示。

要求：该路由 MUST 与 R1 共用同一个显式开关，且 MUST NOT 出现在生产路由表中。

验收：
- **WHEN** 开关关闭时请求该路由
- **THEN** 返回 404，且不泄露任何码值

### R3 私人照片公开可读且不可删

现状：`server/src/routes/photos.ts:79-91` `GET /api/photos/:id` 无鉴权、无归属校验，未发布的回忆照片同样返回字节，唯一屏障是 id 不可猜；全路由无 `DELETE`。

要求：读取 MUST 校验归属，或区分「已被公开快照引用」与「仅私人引用」两态；后者 MUST 要求登录且校验 userId。删除 MUST 提供接口，且 MUST NOT 让已被公开快照引用的照片失效。

验收：
- **WHEN** 未登录请求一张只属于私人回忆的照片
- **THEN** 401 / 403，不返回字节
- **WHEN** 该照片已被已发布快照引用
- **THEN** 匿名可读（分享页需要）
- **WHEN** 用户删除自己的照片
- **THEN** 私人引用消失，已发布快照仍可渲染

### R4 构造班次冒充官方数据判硬错误

现状：`data/lines.json` 的 `demo-cq-cableway` 为 `trust:'official'`、`isDemo:true`，`firstBus:450` / `lastBus:1020` / 票价 20 全为构造值（其 `source` 字段自述「不得对外当作真实信息」）。`shared/engine/lines.ts:37` `canJudgeHard` 只看 `trust` → `shared/engine/validate.ts:160-180` 据此判 **error** 拦用户；`shared/engine/lines.ts:89` 排序还给 `official` 加权，压过真实那条 `pending` 的 `cq-cableway-line`。`trustLabel.official` = 「官方已核验」（`shared/engine/facts.ts`）。`isDemo` 在客户端无任何徽章渲染。

要求：`isDemo` 为真 MUST NOT 参与硬约束判定，MUST NOT 排到真实条目之前，MUST NOT 显示为「官方已核验」。构造数据 MUST 只用于测试夹具，MUST NOT 进入 `db:seed` 的生产数据集。

验收：
- **WHEN** 行程命中一条 `isDemo` 线路且时刻晚于其末班
- **THEN** 最多 warn，不产生 error
- **WHEN** 同城同时存在 demo 与真实线路
- **THEN** 真实线路优先，且界面不出现「官方已核验」

### R5 收藏与足迹可被他人 clientId 读删

现状：`server/src/routes/me.ts:106-123` `DELETE /collections` 只按 `clientId`，无 `userId`；`:56,62` `GET /api/me` 匿名分支同样。`clientId` 生成规则为时间戳 + 1e6 随机（`lynx/src/api.ts:106`）。`server/src/routes/submit.ts:41-49`、`server/src/routes/facts.ts:76-81` 的 mine 查询同样只按 clientId。

要求：已登录请求 MUST 按 `userId` 判定归属；`clientId` MUST NOT 单独作为已登录数据的访问凭证。

验收：
- **WHEN** 账号 A 携带账号 B 的 clientId 请求删除收藏
- **THEN** 不删除 B 的任何数据
- **WHEN** 用户登录后换设备查询自己的补录与反馈
- **THEN** 能读到已并账的记录

### R6 云同步失败静默显示为成功

现状：`lynx/src/sync.ts:34,47,61` catch 后 `return false`，调用处一律 `void` 丢弃（`lynx/src/App/useTrips.ts:83`、`lynx/src/App/useGuides.ts:96`），界面无任何云端状态；而 `lynx/src/pages/ProfilePage/index.tsx:91`、`lynx/src/pages/LoginPage/index.tsx:59,77` 明写「已跟随账号，换设备也能找回」。服务端已有 409 `stale_write`（`server/src/routes/memories.ts:54`、`server/src/routes/guides.ts:79`），客户端刻意不重试不提示（`lynx/src/sync.ts:17`）。

要求：同步失败 MUST 有可见状态，MUST NOT 让「已跟随账号」的文案在未同步成功时出现。冲突 MUST 可见。本机落盘失败已有的 toast 口径（`lynx/src/App/useTrips.ts:89`）可作为参照。

验收：
- **WHEN** 断网后编辑行程
- **THEN** 界面显示「未同步」而非成功，恢复网络后可重试
- **WHEN** 服务端返回 409
- **THEN** 用户看到冲突提示，且本机数据不被静默覆盖

## 4. P1 判据闭合（G 组，让 J2/J3/J4 真通）

### G1 服务端注入真实路段耗时（对应 B2）

现状：`server/src/routes/ai.ts:99-117` `ensureEngine` 只灌 places / facts / lines，全仓服务端从不调 `setRouteMinutes` → 对话生成的方案路段恒为直线折算。客户端只有 `lynx/src/pages/PlanSheet/index.tsx:120` 调 `warmTravelMinutes`，对话落行程的路径（`lynx/src/App/index.tsx:76`）不经过它。

要求：两条入口 MUST 得到同一档路段来源。服务端生成时 MUST 先取真实路段再算时刻；取不到的段 MUST 保留 `straight` 标记与「约」字样。

验收：
- **WHEN** 同一组需求分别经对话与表单生成
- **THEN** 同一段路的 `transportSource` 与耗时一致
- **WHEN** 地图服务不可用
- **THEN** 标 `straight` 并说明估算，不冒充导航结果

### G2 客户端注入线路数据（对应 J3）

现状：客户端从不调 `setLines`（`lynx/src/data.ts:22` 只灌地点），仅 `server/src/db/seed.ts:100` 与 `server/src/routes/ai.ts:109` 注入 → 表单路径下 `shared/engine/validate.ts:158-184` 的末班与核载硬约束**永不触发**。

要求：两端引擎 MUST 注入同一份数据集。任一数据集缺失 MUST 可观测，MUST NOT 静默跳过校验。

验收：
- **WHEN** 表单生成的行程排到某线路末班之后
- **THEN** 与对话路径给出同一条 issue、同一 level
- **WHEN** 线路数据未加载
- **THEN** 明确告知「班次未加载，未做末班校验」，不声称已通过

### G3 未知与来源全量上屏（对应 J2、F09）

现状：`shared/engine/budget.ts:86-91` 会追加「有 N 个景点票价未核实」，但 `lynx/src/pages/AssistantPage/index.tsx:451` 与 `lynx/src/pages/ItineraryPage/index.tsx:272` 都只渲染 `uncertain[0]`，而住宿提示排在前面 → **票价未核实的告知被吞掉**。`lynx/src/pages/ItineraryPage/index.tsx:275` 页脚把所有门票硬写成 `trustLabel.pending`，与同文件 `:356` 的逐条 trust 标签矛盾。对话气泡（`lynx/src/pages/AssistantPage/index.tsx:429-453`）只显示地名 + 人均，无来源与核验时间，尽管工具侧字段齐备（`shared/engine/aiGround.ts:27`）。

要求：`uncertain` MUST 全量可见。票价未核实 MUST NOT 被其他提示挤掉。页脚 MUST NOT 与逐条 trust 冲突。对话中引用事实 MUST 可回链到 `source` / `verifiedAt`。

验收：
- **WHEN** 一份方案同时有住宿假设与 3 个未核实票价
- **THEN** 两条提示都可见
- **WHEN** 任取 AI 一句含营业时间或价格的回答
- **THEN** 能在景点页或避坑页找到同一条记录及其核验时间

### G4 避坑数据统一到服务端

现状：`lynx/src/facts.ts:1-6` 仍读随包 `data/facts.json`，未接 `GET /api/facts`；服务端另有 `server/src/routes/facts.ts` 与反馈聚合。两端不同源 → J2 的回链可能对不上。

要求：客户端避坑 MUST 与服务端同源。随包 JSON 只允许作为离线兜底，且 MUST 标明数据时点。

验收：
- **WHEN** 服务端某条避坑的 trust 或有效期变更
- **THEN** 客户端刷新后一致，不出现两份不同的核验时间

### G5 云端拉取与登录补推（对应 B4、F06）

现状：`lynx/src/sync.ts` 只有 `PUT` 与 publish / unpublish，**全仓无任何 `GET /api/trips|memories|guides` 调用点**；服务端 GET 已写好却无人调（`server/src/routes/trips.ts:19`、`server/src/routes/memories.ts:21`、`server/src/routes/guides.ts:25`）。只推「当前活动行程」（`lynx/src/App/useTrips.ts:83,195`），其他行程与回忆永不上行。登录不触发补推：`lynx/src/App/index.tsx:42` 的 `useTrips(booted)` / `useGuides(booted)` 不依赖 auth，effect deps 只有 `[loaded, store]` / `[loaded, book]`。`server/src/routes/trips.ts:54-73` 只收 demand + plan，`endedAt` / `planIndex` / `plans[]` / `versions[]` 不上云，`trip_versions` 只有 seed 写。

要求：跨设备找回 MUST 有拉取路径。登录 MUST 触发本机数据补推。行程上云 MUST 覆盖「已结束」分类与多方案，否则 MUST NOT 承诺可找回。

验收：
- **WHEN** 设备 A 保存 3 份行程并结束其中 1 份，设备 B 登录同账号
- **THEN** 3 份都在，分类正确，变更记录可见
- **WHEN** 匿名期已产生行程与收藏，随后首次登录
- **THEN** 无需再次编辑即完成并账与上行

### G6 会话上云（对应 B3）

现状：无 `ai_sessions` / `ai_messages` 表；对话存本机 `funny-plus.chat.v1`（`lynx/src/chatSession.ts:17`），上限 40 轮，只恢复 `{role, text}`，方案卡与预览卡丢失（`:41`）。

要求：会话 MUST 按账号归属并在换设备后可续。历史 MUST 由服务端持有，客户端只传 sessionId + 本轮输入。预览卡 MUST NOT 跨设备复活成可确认状态。

验收：
- **WHEN** 设备 A 对话生成方案后，设备 B 登录同账号进助手
- **THEN** 能看到上次对话文字与已落地的行程
- **WHEN** 设备 A 留有一张未确认的预览
- **THEN** 设备 B 不出现可确认的旧预览

### G7 AI 侧度量与旅程漏斗（对应 B5、F10）

现状：客户端 32 个事件真落库（`lynx/src/track.ts:40` → `server/src/routes/events.ts:87` → `track_events`），`plan_adopted` / `revise_applied` / `revise_cancelled` / `plan_failed` / `revise_unsupported` / `data_gap_view` 都有。缺：服务端无 AI 度量（无 `observe.ts`，token / 延迟 / 工具成功率 / 校验回喂次数 / 降级次数全无）；`scripts/` 只有 `fetch-lynx.sh` 与 `verify-amap.ts`，**无聚合查询**；事件无 journey 字段，`sessionId` 只区分冷启动（`lynx/src/track.ts:34`）→ 任务 A / B 两条旅程分不开；`platform` 列存在但从不上报（`lynx/src/track.ts:60`），恒 null；`trackSessionId()` 导出后无调用者。

要求：MUST 能回答「N 次对话里几次生成方案、几次被采纳、几次降级、工具成功率多少」。MUST 能按两条验收旅程统计完成与中断环节。提示词版本 MUST 随事件上报（见 X1）。

验收：
- **WHEN** 跑完一轮任务 A 与任务 B
- **THEN** 一条命令或一个接口能分别给出两条旅程的漏斗与中断环节
- **WHEN** 模型不可用触发降级
- **THEN** 降级次数可查，且能与该轮对话关联

## 5. P2 能力补齐（N 组，全部挂在 D1 之下）

### N1 首页改为咕噜迎接（F01）

现状：`lynx/src/pages/HomePage/index.tsx:102-277` 是 hero + 城市卡 + 攻略的发现页，咕噜只有右下角 FAB（`:275`）。`lynx/src/App/MainTabs.tsx:47-64` **只传 `city` 与回调，不传 `plans` / `tripId` / `planIndex`** → 首页没有渲染当前旅行卡的数据基础。

要求：首页 MUST 有自然语言入口、当前旅行卡与场景引导；无旅行时 MUST 可直接提需求。
注意：`docs/ai-native-plan.md:26-29` 明确「页面布局视觉一律不动，改入口权重属产品决策需单开一轮」。**本项与该约束冲突，需 D1 一并裁决。**

验收：
- **WHEN** 已有行程的用户打开首页
- **THEN** 看到当前旅行卡并能一键继续与咕噜讨论
- **WHEN** 新用户直接在首页输入需求
- **THEN** 进入同一助理，结果落同一工作台

### N2 统一两个规划入口（F01、9.3）

现状：首页「AI 规划」主卡 `lynx/src/pages/HomePage/index.tsx:112` 走 `onPlan` 进**表单** `PlanSheet`；只有 banner（同文件 `:230`）与 FAB（`:275`）进 assistant。「我在这里，接下来做什么」全仓零命中。

要求：两种入口 MUST 进同一助理。当地临时入口的存在与否取决于 D4。

验收：
- **WHEN** 分别从主卡与 FAB 进入
- **THEN** 落到同一个助理会话，已确认安排出现在同一工作台

### N3 旅行上下文补日期与固定安排（F02）—— **已完成（2026-11-23）**

原现状：`Demand` 只有 destination / dayCount / party / budgetLevel / preferences / transport / notes，**无日期或时间范围**；`ItineraryPage:154` 的日期是设计稿文案。pin / locked / 固定安排在三个包里零命中。

已做：`ItineraryItem.pinned` + 行程页「固定」开关 + `useTrips.setPinned`；`applyReviseOp` 遇 pinned 拒绝 drop / replace 并说明原因；关键词兜底跳过 pinned（否则「轻松点」会静默吃掉用户固定的那条）。

**日期链路已补齐（2026-11-23）**：`dateFrom` 从类型 → 表单选日期 → 落库 → 引擎参与校验，全链路打通。

- **表单**：新增「出发日期」行，选项是未来 45 天的日历，含周几；第一项是「还不确定」，值落成 `undefined` 而不是空串 —— 允许未知是产品口径，不给这一项等于逼用户编日期。Lynx 没有原生日期控件，复用已有的 `PickerSheet` 列表，不引入未验证的滚轮吸附。
- **行程页**：顶部那行日期改成真实值；未填时显示「日期未定」（原来那里摆着设计稿写死的示例日期，跟真实预算并排，看起来像真数据）。
- **闭馆判断**：新增 `places.closedWeekdays`（0=周日…6=周六）+ `closedRanges`（MM-DD，支持跨年），迁移 `0018_place_closures`。`validatePlan` 在**日期已知且该点有结构化闭馆数据**时判 `closed-weekday` 为 error，给「换一天 / 换一个点」两条出路。
- **为什么不解析 `openText`**：34 条里只有 3 条含周几闭馆，且写法各异（「周一全天关闭(法定节假日除外)」「周二–周日 09:00–17:00」）。把正则当数据源，判错一次就是把「今天闭馆」说成「今天开放」，比不判更糟。所以只给已确认的 3 个点（故宫 / 国博 / 三峡博物馆，均周一）填结构化字段，其余留空 = 不判定。

**仍未做**：`dateTo` 没有独立入口（区间由 `dateFrom + dayCount` 推出，两者同时可填会互相矛盾）；季节区间营业时间（`cd-panda` 的 03-16 至 10-31 两档）尚未结构化，仍只取最保守交集。

要求：MUST 支持日期或时间范围（允许未知）。固定安排 MUST 在后续修改中作为约束，MUST NOT 被 drop / replace 静默改掉，也 MUST NOT 被换序挪位次（`reorder` 现在让固定项留在原位，并在 reason 里说明「保持原位」）。

验收：
- **WHEN** 用户固定第 2 天的某个地点，随后说「第二天轻松点」
- **THEN** 该地点不被删除，预览说明它被保留的原因
- **WHEN** 日期未填
- **THEN** 明确标为未知，不伪造具体日期
- **WHEN** 日期填了，行程里排到周一闭馆的点
- **THEN** 出发前就报 error，并给「换一天 / 换一个点」两条出路
- **WHEN** 日期没填
- **THEN** 不做任何闭馆判断，不凭空提示

### N4 修改支持时段粒度（F03、9.2）—— **已完成（2026-11-23）**

**补一轮**：「只动该时段」原来只做到「只删该时段」，时刻仍整天顺延 —— 删掉下午一站后，晚上 19:00 的夜游被重排到 14:50，用户看到的是「我说下午轻松点，结果晚上那站没了」。`retime` 现在按每个条目**原本所属时段**设地板（`WINDOW_FLOOR`），压缩只能在本时段内往前收；换序则显式 `keepWindows:false`，因为那是用户要求整体重排。

原现状：`shared/types/index.ts:253-256` `ReviseOp` 只有 `drop` / `replace` / `reorder`，**无时段字段**；模型 schema 同样没有（`server/src/ai/revise.ts:21-30`），提示词把「轻松点」直接定义成 drop 一个景点（`:43`）。`shared/engine/planEdit.ts:106` 的 retime 是全天顺延重排，不是只动下午。关键词兜底恒删当天最后一个（`shared/engine/planner.ts:266`）。

要求：MUST 支持「第 N 天 + 时段」的定向修改。无法表达时 MUST 返回 `supported:false` 与可读原因，MUST NOT 退化成删最后一个。

验收：
- **WHEN** 用户说「第二天下午轻松点」
- **THEN** 只有第 2 天下午的安排变化，上午与其他天不变
- **WHEN** 指令无法映射成动作
- **THEN** 原计划不变，并说明不支持的原因

### N5 登录三件套接通（F06、9.6，依赖 D3）

现状：短信只生成码落库、**未接任何服务商**（`server/src/routes/auth.ts:71-99`，全仓无 SMS SDK）。微信兑换未实现，配了也返回 501（同文件 `:189-194`）；**Apple 通道服务端完全不存在**（`:33-42` 只有 `wechat` / `onetap`）。`users.wechatUnionid` / `appleSub` 建了唯一索引但从无写入（`server/src/db/schema.ts:400-409`）。iOS 无 WXApi / ASAuthorization 实现（`ios/FunnyPlus/FunnyPlus/HostBridge.swift:34-50` 只解析 URL scheme），`ios/FunnyPlus/FunnyPlus/Info.plist:50` 的微信 scheme 是假值 `wx0000000000000000`，无 applesignin entitlement；Android 只有注释占位。前端连按钮都没有（`lynx/src/pages/LoginPage/index.tsx:115` 写死「首期只支持手机号登录」）。

要求：三条通道 MUST 按 9.6 的平台矩阵落地。手机号 MUST 作为合并锚点，unionid / sub MUST 作为绑定凭证。未接通前 MUST NOT 在界面承诺该通道可用。

验收：
- **WHEN** 同一人先用 App 微信登录、再用 H5 短信登录同一手机号
- **THEN** 落到同一账号，数据不分裂
- **WHEN** iOS 提供微信登录
- **THEN** 同时提供 Sign in with Apple

### N6 到达判定与现场推荐（F04，依赖 D4）

现状：GPS 真拿到（`ios/FunnyPlus/FunnyPlus/HostBridge.swift:139` CLLocationManager、`android/app/src/main/kotlin/com/maka/funnyplus/MainActivity.kt:171` LocationManager，权限声明齐备），但 `lynx/src/geo.ts:191` 唯一消费者是 `locateCity` → 只逆地理成城市名。`accuracy` 在 `lynx/src/geo.ts:96` 解析后**全仓零消费者**。无 geofence / 到达判定代码；`shared/engine/placeIndex.ts:20` 的 `distanceKm` 只算地点↔地点，设备坐标从不参与。`lynx/src/locationFace.ts` 是首页胶囊与城市页共用的**文案单例**，与到达无关。三分支（匹配→主动推荐 / 不匹配→先询问 / 不可用→手动确认）一条都没有。

要求：MUST 按 3.3 三分支实现，MUST 考虑地点范围与定位精度阈值。定位推断与用户确认 MUST 分开记录。定位不可用 MUST 允许手动指定或确认到达，MUST NOT 假定到达。MUST NOT 引入后台持续定位或推送。

验收：
- **WHEN** 已计划某地点且定位在其范围内、精度达标
- **THEN** 应用内展示少量相关推荐
- **WHEN** 定位不在该地点
- **THEN** 先询问是否查看推荐，不声称已到达
- **WHEN** 拒绝定位授权
- **THEN** 可手动指定地点继续，且不展示无法支持的精确距离

### N7 下一站与城市交通（F05，依赖 D4）

现状：离开意图识别、澄清分支、下一站候选、交通查询**全部零代码**；9 个工具（`server/src/routes/ai.ts:193-315`）无相关项。`shared/engine/lines.ts:25-31` 是**景区内部交通**（观光车 / 摆渡车 / 索道 / 大扶梯 / 游船），不是城市公交地铁。`transportAdvice` 打车用硬编码 ¥60/车、4 人/车（`shared/engine/lines.ts:102`，有 assumptions 说明）。

要求：MUST 区分「继续探索」与「离开」两种意图；明确说去下一站时 MUST NOT 重复确认。MUST 展示可获得的交通方式、时间、费用或未知项及对后续安排的影响。仅查看 MUST NOT 改行程。无数据 MUST 如实说明，MUST NOT 伪造实时结果。

验收：
- **WHEN** 用户说「这里没什么可玩的」
- **THEN** 先澄清意图，不直接改行程
- **WHEN** 无可用交通数据
- **THEN** 说明缺口并给手动输入，不显示虚构的时刻或价格
- **WHEN** 用户确认变更
- **THEN** 影响同步到工作台；取消则原计划不变

### N8 回忆草稿生成（F07、9.7）—— **已完成（2026-11-23）**

原现状：`lynx/src/App/useTrips.ts:223` `endTrip` **只写 `endedAt` 并发埋点，不生成任何草稿**（注释自述「只记时刻，不清任何数据」）；回忆初值是空壳（`:207`）。全仓无回忆相关 AI 调用。

改动：`lynx/src/memoryDraft.ts` 的 `buildMemoryDraft`（纯函数）。按天分块，三个桶严格按 `visited` 三态切：`yes` → 写「去了」+ 用户原文，`no` → 写「没去」，`unknown` 且有内容 → 标「未确认到访」，`unknown` 且无内容 → 进末尾「还没记」清单。草稿存 `TripMemory.draft` 而不直接写 `overview`：`overview` 会当攻略概述带出去（`useGuides.draftFromMemory`），草稿默认不该变成用户要公开的那段话。

**上一版留下的三个问题，本轮修掉**（都不是新功能，是原实现读起来像对的、跑起来会伤用户）：
- **采纳会覆盖用户后来写的回顾**：草稿卡就在回顾框上方，用户很可能先写两句再点「用作回顾」，而 `adoptDraft` 是无条件 `overview = draft`，本机没有历史版本可退。现在已有非空回顾时按钮先变成「确认覆盖」，要再点一次。
- **删掉草稿后重开再结束会再生成同一份**：`discardDraft` 只删字段，`buildMemoryDraft` 对同一份 `places` 是确定性的。现在 `discardDraft` 记 `draftDismissedAt`（随 `loadMemory` / 云端 payload 一起走），`draftFor` 在「否掉之后没有更新的记录」时不再生成。
- **完全没有记录时仍生成「还没记：…」**：那份东西在页面上是一张带「用作回顾」按钮的卡，点一下就把一串地名变成公开攻略的概述。现在 `buildMemoryDraft` 在一条记录都没有时返回空串，空态交给页面邀请补充。

同时 `endTrip` 不再于「已有回忆但没生成草稿」时刷新 `updatedAt` —— 刷新会让「否掉之后没再改过」这个判断永久失效。

服务端零改动：`trip_memories.payload` 是 jsonb 透传；`stripLocalPhotos` 按结构递归，`draft` / `draftDismissedAt` 原样过；`shareSnapshot` 只从 `GuideDraft` 取，草稿不可能外泄。

验收对应：
- 3 已确认 + 2 未确认 → 3 条带「去了」与原文，2 条标「未确认到访」（`memoryDraft.test.ts`）
- 一条记录都没有 → 返回空串，不生成草稿卡（`buildMemoryDraft` / `draftFor` 各一例）
- 用户否认去过 → 写「没去」，不从草稿里消失
- 否掉之后没再改 → 不再生成；之后写了新记录 → 允许再整理一次（`draftFor` 两例）

未验证：真机上的文本域重挂（采纳草稿靠换 `key` 强制刷新 `default-value`）与 `bindtap` 手感。

已真实现、MUST NOT 回退的部分：图文再编辑（`lynx/src/pages/MemoryPage/index.tsx:143,222`）、「未确认到访不写成实际」的多层保障（`lynx/src/App/useTrips.ts:291` 默认 unknown、`lynx/src/storage.ts:327` 只认三态、`lynx/src/App/useGuides.ts:62` 只勾 `visited==='yes'`、`lynx/src/pages/SharePage/index.tsx:106` 三态标签）。

要求：结束旅行后 MUST 生成可编辑草稿，MUST 区分原计划、已确认到访与其他记录。MUST NOT 代写未发生的经历或编造感受。用户否决过的整理结果 MUST NOT 在没有任何新内容时再次出现；采纳 MUST NOT 静默覆盖用户已经写下的回顾。

验收：
- **WHEN** 用户结束一趟有 3 个已确认到访、2 个未确认的旅行
- **THEN** 草稿只把 3 个写成亲历，2 个标为未确认
- **WHEN** 某地点无任何记录
- **THEN** 留空或邀请补充，不生成感受文案

### N9 分享的照片勾选与更新发布（F08、9.8）

现状：`lynx/src/App/useGuides.ts:71` `photos: memory.photos.slice(0, 3)` **自动带前 3 张**，与 `shared/types/index.ts:525` 注释「用户勾选」及 9.8「用户选择照片」冲突。`server/src/routes/guides.ts:122-127` publish 幂等直接返回旧 token，**无更新快照接口**，只能撤回再发（换 token，旧链接失效）。`GuideSectionItem.photos` 进了快照但分享页不渲染（`lynx/src/pages/SharePage/index.tsx:99-118` 只渲染顶层 photos）。

已真实现、MUST NOT 回退的部分：快照发布时冻结（`server/src/routes/guides.ts:131` + `server/src/sync/shareSnapshot.ts:26-43` 白名单过滤）、撤回后 JSON 404（`server/src/routes/share.ts:55`）、`showCost` 默认 false、`stripLocalPhotos` 只留 remote。

要求：照片 MUST 由用户勾选，MUST NOT 默认带出。MUST 支持「更新发布」且保持链接不变。

验收：
- **WHEN** 回忆里有 5 张照片，用户只勾 2 张
- **THEN** 分享页只出现这 2 张
- **WHEN** 用户更新已发布攻略
- **THEN** 原链接指向新快照；未更新前私人回忆的修改不影响已发布内容

### N10 表单主链路走模型提案（对应 B1）—— **已完成（2026-11-23）**

原现状：无 `POST /api/ai/plans`；表单仍 100% 本地确定性 `planFor`（`lynx/src/pages/PlanSheet/index.tsx:110,125`、`lynx/src/App/useTrips.ts:19,149`）。「模型提案 + 引擎裁决」目前只覆盖对话入口。

要求：主链路替换 MUST 与「`AI_API_KEY` 未配置仍完整可用」一起验。超时或失败 MUST 无损落回本地引擎。MUST 先有 G7 的度量再替换（`docs/ai-native-plan.md:119`）。

验收：
- **WHEN** 清空 `AI_API_KEY` 后提交表单
- **THEN** 产品完整可用，与今天行为一致
- **WHEN** 模型超时
- **THEN** 落回本地引擎，主链路不阻塞，降级次数可查

### N11 对话回归集（对应 B6）—— **已完成（2026-11-23）**

原现状：`server/src/ai/eval/` 不存在。改提示词无回归基线。

要求：MUST 有固定对话集，断言「不编数字、槽位正确、issue 定性正确」，一条命令跑出通过率并可与上一版对比。MUST 覆盖缺槽位、城市未开放、超预算、时间冲突、口语方言、诱导编造价格。

**补一轮：上一版的三类断言其实判不出它声称要判的东西。**

- **「不编数字」只禁了三个字面串**（`门票 60` / `门票 80` / `人均 ¥`），「洪崖洞门票60元，长江索道80元，人均 680 元」一句都不命中，稳过。现在 `Turn` 保留每一轮的工具返回，`noInventedPrices` 把回复里的金额（`¥60` / `60元` / `门票 60`）逐个拿去工具返回里找出处，找不到即判编造；「三天」「2 人」「15:00」这类非金额数字不参与。
- **超预算 / 时间冲突只看关键词，从不看引擎**。说一句「预算完全没问题」也过。现在 `engineIssues` 直接检查工具输出里引擎判出的 issue code（`validateView` 新增 `issues` 字段回传全部三级 code）。
- **`mustMention` 的 AND / OR 写反了**：`[['时间','来不及','冲突','排不下']]` 要求四个词同现，诚实回答反而失败。现在每个说法单独成组（「或」），并在类型注释里写清两个方向的区别。同理 `missing_slot` 新增 `slotsAbsent`：嘴上追问、槽位里已经编好天数，判失败。

另两个前提本身是错的：`over_budget` 用「重庆两天两人 low」算出来 635 元、没超 1000 的上限，**永远判不到 over-budget**；`time_conflict` 用「一天去熊猫基地+都江堰+青城山」，后两个根本不在收录里，判的其实是「城市未收录」。两条都换成了引擎确实会报出来的需求。

验收：
- **WHEN** 修改提示词后跑回归
- **THEN** 输出通过率与逐条差异，编造数字类用例 MUST 全绿
- **WHEN** 模型给出一个不在任何禁词里的具体票价
- **THEN** 该用例失败，并指出哪个金额找不到出处

## 6. P3 代码卫生与文档同步

### X1 提示词版本化（对应 A7）

`SYSTEM_PROMPT` 散在 `server/src/routes/ai.ts:28` 与 `server/src/ai/revise.ts:32`，无 `prompt.ts`、无 `PROMPT_VERSION`。要求抽成带版本号常量并随 G7 埋点上报。

### X2 重复路由与过期注释

`server/src/routes/ai.ts:119` 与 `:164` **重复注册同一个 `GET /status`**（函数体相同）。`:121-126` 的「ownerId 留给接账号后填」注释已过期（账号已落地），且位置与下方 `lastUserText` 无关。

### X3 死代码

**已完成（2026-11-19）**：`grep` 确认仓内零 import、`ios/` 与 `android/` 原生层零引用 `__fpAuthCallback` / `__fpOpenSettings` 后，删掉整个 `lynx/src/auth.ts` 与 `openLocationSettings()`；`CityPage` 不再调一个恒返 false 的函数，直接给「到系统设置开启定位」的提示。`trackSessionId` 在 G7 被 `aiChat.ts` 调用，不再是死代码。

- `lynx/src/auth.ts` 整文件无 import 者，`LOGGED_IN=null`、`login()` 必抛；其约定的 `__fpAuthCallback` 与壳注入的 `__fpAuth` 名字对不上。
- `lynx/src/geo.ts:119-129` `openLocationSettings()` 读 `globalThis.lynx.__fpOpenSettings`，两端原生均未实现该键，永远返回 false。
- `lynx/src/track.ts:36` `trackSessionId()` 导出后无调用者。

处置需按「清死代码」口径先确认无外部引用，再删或补实现。

### X4 攻略草稿 id 重启后漂移

`GuideBook` 以 `tripId` 为键（`lynx/src/App/useGuides.ts:95,106`）。新建草稿 `id: newGuideId()`（`lynx/src/App/useGuides.ts:67`），但 `loadGuides` 用 book 的键当 `draft.id` 恢复（`lynx/src/storage.ts:378,398`）→ 重启后 `draft.id === tripId`。而 `pushGuide(draft.id, tripId, draft)`（`lynx/src/App/useGuides.ts:96`）用的是 `draft.id`，其上方注释明写「草稿 id 与 tripId 不同」。

后果：重启后推送到另一个云端 id，云端多一份草稿，旧分享链接无法再从 UI 撤回。

要求：草稿 id MUST 跨重启稳定。验收：**WHEN** 创建草稿→发布→杀进程重进→撤回 **THEN** 撤回的是同一条分享，云端不产生重复草稿。

相关已知延期项（非缺陷，注释已声明）：`published` 只存内存（`lynx/src/App/useGuides.ts:165`），重启即显示「未发布」；随 G5 一并解决。

### X5 失败提示与占位文案

**已完成（2026-11-19）**：失败气泡带「重新发送」，重试走 `runSend(text, false)` 不重复回显用户那句话；新增 `lynx/src/chatError.ts`，含中文的错误原样透出，`AbortError` / `Failed to fetch` 之类的运行时英文翻成中文口径。`revisePlan` 不再丢弃 `applyReviseOp` 算好的 `affected`，本地兜底预览也逐条列出受影响项。攻略页文案改为「发布后生成公开链接、撤回即刻失效」；城市列表搜索图标改为指向现有筛选（真搜索框要新增输入控件，属排版改动，未在本轮做）；麦克风不再切「聆听中」假态；`send` 拆成 `runSend(text, echo)`，依赖补齐 `planIndex`；首页浮标按 `/api/ai/status` 隐藏。

- 对话失败无重试入口（`lynx/src/pages/AssistantPage/index.tsx:239-245` 只追加错误气泡），abort 后 `err.message` 直出，可能是英文原文。
- `lynx/src/pages/ReviseSheet/index.tsx:53-59` 本地兜底预览 `affected: []`，只剩总差额，无逐条受影响项。
- `lynx/src/pages/GuideDraftPage/index.tsx:175` 仍留「这一期先只存本机」旧文案。
- `lynx/src/pages/CityListPage/index.tsx:93` 搜索是 `toast('搜索即将上线')`。
- `lynx/src/pages/AssistantPage/index.tsx:95` 麦克风只切视觉态，未接录音。
- `lynx/src/pages/AssistantPage/index.tsx:252` `send` 依赖数组缺 `planIndex`（当前 UI 路径未暴露，属隐患）。
- AI 未配置时首页入口不隐藏（`lynx/src/pages/HomePage/index.tsx:275`），与 `server/src/routes/ai.ts:168` 注释「前端据此隐藏入口」不符。

### X6 有表字段无写入

**已完成（2026-11-19）**：`photos.sha256` 用于**同人同图去重** —— 命中已有行时直接复用 id 并回 `reused: true`，不落第二份；只按 `userId` 比对，别人的同一张图不会返回 id。`factFeedbacks` 落 `userId`，判重同时按 `userId` 与 `clientId`（后者只在 `userId is null` 时参与），换设备不再重复投票。仍**未做**：`users.wechatUnionid` / `appleSub` 零写入（等 D3 定微信与 Apple 登录责任人）；`tripMemories` / `guideDrafts` / `photos` 仍无 `clientId` 列，结构上不可被匿名并账认领。

`trip_versions` 只有 seed 写；`photos.sha256` 写而不读（`server/src/routes/photos.ts:60,68`），`server/src/db/schema.ts:507` 承诺的「同图不重复落盘」无实现；`users.wechatUnionid` / `appleSub` 无写入；`factFeedbacks.userId` 无写入（`server/src/routes/facts.ts:109-115`）却在合并名单里（`server/src/auth/merge.ts:40`）。

另：`tripMemories` / `guideDrafts` / `photos` 无 `clientId` 列（`server/src/db/schema.ts:474-520`），结构上不可被匿名并账认领；而它们的写入都要求登录 → `server/src/auth/merge.ts` 对回忆与照片是空转。`server/src/routes/auth.test.ts:194` 用直接 insert 造匿名行程，掩盖了这条链路不通。

### DOC1–DOC5 文档同步（`docs/ai-native-plan.md:122-129` 要求，一条未做）

| 编号 | 文件 | 现在写的 | 与代码的冲突 |
|---|---|---|---|
| DOC1 | `README.md:50` | 「没有 AI 后端，不是真模型调用」 | `server/src/ai/model.ts:13` 真接 gateway |
| DOC2 | `README.md:52,65` | 「行程存本机」「`/api/trips` 目前只读」 | `server/src/routes/trips.ts:50` 已开 PUT |
| DOC3 | `README.md:56` | 「局部修改只认 4 类意图」 | `server/src/routes/ai.ts:435` 走模型解析 |
| DOC4 | `PRODUCT.md:51`、`docs/product-plan.md:16` | 「明确不做：账号体系与云端档案、行程分享页、避坑反馈入口」 | 三项均已实现 |
| DOC5 | `docs/prd-v0.2.md:194`、`docs/ai-native-plan.md:16` | 「P0 不接模型」「现状 0/4」 | 模型已接；A1–A6 已落 |

D1 裁决后，`docs/ai-native-mvp.md:3,7` 的 A 版声明也需同步。

## 7. 依赖顺序

```
D1 ─┬─→ §5 全部（N1..N11）
    └─→ DOC4 / DOC5 与 mvp 文首声明

R1 R2 R3 R4 R5 R6            无依赖，可立即并行
G1 G2                        无依赖，先做（J3 的前提）
G3 G4                        无依赖
G7 ──→ N10                   没度量不换主链路
G5 ──→ G6 ──→ X4             先有拉取，再上会话，再修 id 漂移
D3 ──→ N5
D4 ──→ N6 / N7               数据供给未落地不开交互工单
D2 ──→ 两条验收旅程的可执行性
```

建议批次：**R 组 → G1 G2 G3 G4 → G7 → G5 G6 X4 → （D1 裁决后）N 组**。
X1–X3、X5–X6、DOC 组可随任意批次搭车，不单独占一期。

## 8. 明确不做（本轮）

- 不换模型（`deepseek-v4.1-flash` 已实测支持流式 + tool calling）；换模型需先有 N11 回归集。
- 不做 RAG 式攻略正文生成：攻略与避坑是数据资产，不是生成物。
- 不做后台持续定位与推送（`docs/ai-native-mvp.md:62`）。
- 不做机酒预订与支付、多人协作、社交评论体系、多城复杂旅行、基于他人攻略一键重规划（`docs/ai-native-mvp.md:122`）。
- ~~不做数据飞轮 C1 / C2 / C3~~ **已做（2026-11-23）**：阈值集中在 `server/src/data/trustRules.ts`，与本节原文的「不做」冲突，以 §0.1 / §6.1 为准。
- 不改页面布局与视觉（`docs/ai-native-plan.md:26`）——**N1 与此冲突，需 D1 一并裁决**。

## 9. 未验证清单（不要当已验证事实引用）

1. 全部结论为静态代码与数据取证，**未运行 App、未调用高德或模型接口、未跑 lint / typecheck / test**。
2. R1 的线上实际风险取决于部署平台是否外部注入 `NODE_ENV=production`——仓库内查不到该配置，需运维确认。
3. 短信与照片上传的实际网络行为、iOS 壳注入是否真到达 Worker，均需真机验证。
4. `lynx/src/geo.ts:11-16` 注释声称定位链路已在模拟器实测，本次未复现。
5. `shared/engine/validate.ts` 的 `day-too-long` 硬冲突停止文案，自然对话几乎不会触发（归档报告 `openspec/changes/archive/2026-11-18-11-17-gulu-ground-facts/e2e-report.md:46` 已记录），只有单测覆盖。
6. 数据覆盖统计基于 `data/*.json`；线上数据库实际存量未核对（seed 会 upsert，可能有历史残留）。
7. 分享页 HTML 外壳在撤回后返回 200 引导页而非 403/404（`server/src/routes/share.ts:79-90`），正文不可访问成立，但状态码口径需产品确认是否接受。