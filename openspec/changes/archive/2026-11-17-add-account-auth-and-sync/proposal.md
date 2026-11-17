# add-account-auth-and-sync

Tier: 2

## 背景

- 需求来源：`docs/ai-native-mvp.md` 第 84 行 F06 与 9.6 节；登录方式已于 2026-11-17 定案。
- 问题：身份仍是设备级 `clientId`，行程 / 回忆 / 攻略草稿全在本机 IndexedDB，换设备即丢；`server/src/routes/auth.ts` 只有 provider 占位（`/login` 恒 501）；`auth.ts:15` 自记「所有业务接口都没有鉴权，凭 clientId 就能读别人的收藏」。
- 用户价值：旅行跟随账号而不是设备，换设备能找回，别人读不到。

## 目标

- 短信验证码登录可用，服务端签发并能校验 token。
- 行程、回忆、攻略草稿可云端写入并按账号隔离；首次登录把本机数据静默并入账号。
- 7 张按 `client_id` 归类的表全部补 `user_id` 并走鉴权，堵掉「凭 clientId 读别人数据」。
- 匿名可用性不降级：不登录仍能浏览、规划、保存本机行程。

## 变更

- 数据：新增 `users` / `auth_sessions` / `sms_codes` / `trip_memories` / `guide_drafts`；`trips` / `collections` / `footprints` / `fact_feedbacks` / `data_submissions` / `constraint_reports` / `track_events` 各补可空 `user_id` + 索引。
- 接口：新增 `POST /api/auth/sms-code`、`POST /api/auth/sms-verify`、`GET /api/auth/me`、`POST /api/auth/logout`、`PUT /api/trips/:id`、`GET|PUT /api/memories/:tripId`、`GET|PUT /api/guides/:id`；`GET /api/auth/status` 增 `user` 字段。
- 契约：错误码 `bad_param` 400 / `unauthorized` 401 / `token_expired` 401 / `too_frequent` 429 / `stale_write` 409 / `bad_code` 401。
- 交互：新增登录页（手机号 → 验证码两步）；「我的」页显示登录入口或已登录手机号与退出。
- 流程：登录成功即静默并账（本机 `clientId` 名下数据认领给账号，幂等）。

## 影响范围

- 页面/模块：新增 `lynx/src/pages/LoginPage/`、`lynx/src/App/useAuth.ts`；改 `lynx/src/api.ts`、`useTrips.ts`、`useGuides.ts`、`ProfilePage`。
- 数据/API：`server/src/db/schema.ts`、新增 drizzle `0011`；`server/src/routes/auth.ts` 重写、`trips.ts` 补写接口、新增 `memories.ts` / `guides.ts`、新增鉴权中间件。
- 权限/安全：本次核心。token 只存 `sha256`；验证码不泄露账号是否存在；未登录写请求按 `client_id` 临时归属；登录后读同时覆盖账号数据与本机未并账数据。
- 兼容性：`user_id` 全为 null 时行为与改动前一致；`/api/auth/status` 的 `providers` 字段保持不变；`GET /api/trips` 保留 `clientId` 查询参数分支。

## 不做范围

- 微信、Sign in with Apple 真流程（等开放平台 AppID 与 iOS 能力配置；provider 占位继续 501）
- 手机号一键登录（P1）
- 邮箱密码、QQ / 微博 / 支付宝登录
- 攻略发布与分享链接（F08 后半）
- 支付、复杂多人协作
- 对象存储（照片上云的真实缺口，见「风险与回滚」）

## 已确认决策

| 决策点 | 结论 | 来源 |
|--------|------|------|
| 首次登录时本机数据的合并口径 | 静默并入：登录成功即把本机 `clientId` 名下行程/回忆/草稿认领给账号，不额外弹确认。代价：将来上多账号共享设备时要补「这笔数据归谁」的确认 | 用户确认 |
| token 有效期与续期 | 单 token + 滑动续期，5 分钟写库节流。不做 refresh 双 token，不做固定 30 天硬过期。代价：一直用就一直有效，缺强制过期兜底 | 用户确认 |
| 鉴权收口范围 | 7 张表一次全收口，`client_id` 退化为未登录时的临时归属。代价：收藏/足迹的前端调用点要跟着改，回归面纳入验收 | 用户确认 |
| 短信通道实现 | dev 固定验证码 `123456`（仅非生产）+ 接口契约一次做全，不接真实服务商 | 用户确认 |
| 行程/回忆/草稿上云程度 | 本期打通写入：新接口可存可读，按账号隔离 | 用户确认 |

## 验收

覆盖 `specs/account-sync/spec.md` 的全部 Scenario，落成 `e2e-report.md` 的 8 条：

1. 匿名用户不登录仍可浏览、规划、保存本机行程，行为与本期之前一致。
2. 请求验证码 → 校验 → 拿到 token；验证码无效/过期被拒且不泄露手机号是否已注册。
3. 带 token 访问行程接口成功；不带 token 或 token 过期返回 401，不再凭 `clientId` 读他人数据。
4. 设备 A 登录保存行程，设备 B 登录同一手机号可读回；另一个账号读不到。
5. 首次登录时本机该 `clientId` 下的行程/回忆/草稿并入账号，不丢失、不重复。
6. 数据库迁移只新增表和字段，历史数据不被破坏。
7. 收藏与足迹收口后行为不变：登录前写入的本机数据登录后仍能读到，别的账号读不到。
8. 未登录不带 token 的写请求（收藏/足迹/反馈/埋点）按 `client_id` 临时归属仍可用，不报 401。

## 风险与回滚

- **照片缺口（必须记录，不能假装解决）**：`PhotoRef` 的 `kind: 'local'` 与 `kind: 'dataUri'` 换设备即失效。本期不做对象存储，上云只保留 `kind: 'remote'`，另两态留本机并标注「本机照片，换设备不可见」。因此验收 4 的「找回图文」只对 remote 照片成立，`e2e-report.md` 需单列此未覆盖风险。
- **并发**：跨设备 last-write-wins + 旧写拒绝（`updatedAt` 更旧返回 409 `stale_write`）。不做字段级 merge——`TripMemory.places` 与 `GuideDraft.picked` 都是按 `PlanItem.id` 的 map，合并语义无正确答案。
- **回归面**：`collections` / `footprints` 是已验收老功能，本次改其读写归属，需在验收 7/8 覆盖。
- **回滚**：`user_id` 选可空列而非改造主键，停用 `requireUser` 强制即退回旧行为，表与列可保留。迁移 `0011` 只有 `CREATE TABLE` 与 `ADD COLUMN`，无 `DROP`。
- **安全**：手机号明文入库（唯一索引），日志不得打印手机号与 token；token 只存哈希。

## 前端实现决策

无 Figma 与截图，按仓库既有页面模式实现（`TripDetailPage` / `GuideDraftPage` 的卡片与按钮风格）。灰区决策：

| 维度 | 灰区问题 | 决策 | 依据 |
|------|----------|------|------|
| UI 状态 | 发送验证码后的加载与倒计时 | 按钮进 loading 并显示 60s 倒计时；失败原地提示，不清空已填手机号 | 项目既有防重复模式 |
| UI 状态 | 验证码错误 / 过期 | 输入框下方红字提示，保留输入便于重试 | 同上 |
| 交互行为 | 防重复提交 | 校验中禁用提交按钮；已提交未返回时不重复发请求 | 同上 |
| 权限与条件渲染 | 未登录时云端能力如何暴露 | 不显示任何「需登录」报错；写操作直接落本机，不请求云 | `prd.md` 验收 1（匿名不降级） |
| 权限与条件渲染 | 登录入口位置 | 仅「我的」页；未登录显示「登录可跨设备找回」，已登录显示手机号 + 退出 | 9.6 节「允许先体验，云端保存前引导登录」 |
| 数据展示 | 手机号展示 | 中间四位脱敏（`138****8000`） | 隐私默认值全取不公开 |
| 响应式 | 目标端 | 沿用 `responsive-layout` 既有断点，登录页复用现有页面容器宽度 | 项目规范 |

## References

- `docs/ai-native-mvp.md` 第 84 行 F06、9.6 节（登录方式定案）、第 100-106 行首版验收任务
- `server/src/routes/auth.ts:11-15`（占位契约承诺的三件事）
- `lynx/src/api.ts:30`（`TOKEN_KEY` 与 Bearer 注入点已就位）
- Trellis task `.trellis/tasks/11-17-f06-account-auth-sync/`（`prd.md` 决策表、`design.md` 技术设计、`implement.md` 执行计划）
- 契约来源：`inferred`（无 YApi 链接，接口契约由本 change 自定，以 `specs/account-sync/spec.md` 为最高依据）
