# F06 账号与同步骨架

## Goal

让用户的旅行、回忆、攻略草稿跟随账号而不是设备：登录一次后换设备能找回，别人读不到。对应 `docs/ai-native-mvp.md` 第 84 行 F06 与 9.6 节。

## Background

现状（已核实的仓库事实）：

- `server/src/routes/auth.ts` 只有 provider 占位：`/status` 恒报 `identity: 'device'`，`/login` 恒 501，`/logout` 空实现。
- 身份是设备级 `clientId`，`collections` / `footprints` / `fact_feedbacks` / `data_submissions` / `constraint_reports` / `track_events` / `trips.client_id` 共 7 处按它归类。
- `server/src/routes/auth.ts:15` 自记：现所有业务接口无鉴权，凭 `clientId` 就能读别人的收藏。
- 行程、回忆、攻略草稿全在本机 IndexedDB（`funny-plus.trips.v1` / `funny-plus.memory.v1` / `funny-plus.guides.v1`）；`GET /api/trips` 只读。
- `lynx/src/api.ts:30` 已留 `TOKEN_KEY = 'funny-plus.auth-token.v1'` 与 `Authorization: Bearer` 统一注入点，`setAuthToken()` 已存在 → 前端接 token 不用改调用点。
- `server/src/routes/ai.ts:125` 已留 `ownerId` 字段位，注释写明「设备 id 只做本机去重，不是用户身份」。
- 无 `users` / `auth_sessions` 表；迁移现有 0000~0010。

登录方式已于 2026-11-17 定案（`docs/ai-native-mvp.md` 9.6）：短信验证码（全端）+ 微信（App）+ Sign in with Apple（iOS 必做）。手机号是账号合并锚点，微信 unionid / Apple sub 是绑定凭证。

## Requirements

1. **账号与登录态**：新增 `users`、`auth_sessions` 两张表；短信验证码登录可用；服务端签发 token 并能校验。
2. **短信通道**：先用 dev 固定验证码（仅非生产生效），接口契约一次做全，不接真实服务商。
3. **数据归属账号**：行程、回忆、攻略草稿可云端写入并读回，按账号隔离；登录后把本机 `clientId` 的数据并入账号。
4. **匿名优先不变**：不登录仍可浏览、规划、保存本机行程；登录只挡云同步与跨设备找回。
5. **鉴权收口（7 张表全量）**：`trips` / `collections` / `footprints` / `fact_feedbacks` / `data_submissions` / `constraint_reports` / `track_events` 全部补 `user_id` 并走鉴权中间件；`client_id` 退化为未登录时的临时归属。业务接口从「凭 clientId 就能读」改为按账号授权，未登录/过期返回 401。

## Acceptance Criteria

- [ ] 匿名用户不登录仍可浏览、规划、保存本机行程，行为与本期之前一致。
- [ ] 请求验证码 → 校验 → 拿到 token；验证码无效/过期被拒，且不泄露手机号是否已注册。
- [ ] 带 token 访问行程接口成功；不带 token 或 token 过期返回 401，不再凭 `clientId` 读他人数据。
- [ ] 设备 A 登录保存行程，设备 B 登录同一手机号可读回；另一个账号读不到。
- [ ] 首次登录时本机该 `clientId` 下的行程/回忆/草稿并入账号，不丢失、不重复。
- [ ] 数据库迁移只新增表和字段，历史数据不被破坏。
- [ ] 收藏与足迹在收口后行为不变：登录前写入的本机数据登录后仍能读到，且别的账号读不到。
- [ ] 未登录时不带 token 的写请求（收藏/足迹/反馈/埋点）按 `client_id` 临时归属仍可用，不因此报 401。

## Out of Scope

- 微信、Sign in with Apple 真流程（等 AppID 与 iOS 能力配置）
- 手机号一键登录（P1）
- 邮箱密码、QQ / 微博 / 支付宝登录
- 攻略发布与分享链接（F08 后半，依赖本期）
- 支付、复杂多人协作

## Decisions

| 决策点 | 结论 | 来源 |
|--------|------|------|
| 首次登录时本机数据的合并口径 | 静默并入：登录成功即把本机 `clientId` 名下行程/回忆/草稿认领给账号，不额外弹确认。理由：`server/src/routes/auth.ts:15` 的占位契约已承诺此口径；本期只有自用设备，暂无共享设备场景。代价：将来上多账号共享设备时要补一次「这笔数据归谁」的确认 | 用户确认 |
| token 有效期与续期 | 单 token + 滑动续期：每次通过校验就顺延过期时间。不做 refresh 双 token（本期无风控无设备管理，refresh 表与轮换属提前建设），不做固定 30 天硬过期（会在验收阶段被当成 bug）。已知代价：一直用就一直有效，缺强制过期兜底，接微信/Apple 与真实短信服务商时升级到 access+refresh | 用户确认 |
| 鉴权收口范围 | 一次全收口：`trips` / `collections` / `footprints` / `fact_feedbacks` / `data_submissions` / `constraint_reports` / `track_events` 共 7 张表全部补 `user_id` + 走鉴权中间件，`client_id` 退化为「未登录时的临时归属」。理由：彻底解决 `auth.ts:15` 记的「凭 clientId 就能读别人的收藏」。已知代价：`collections` / `footprints` 的现有前端调用点要跟着改，回归面集中在这些已验收的老功能上，所以验收扩大到收藏与足迹 | 用户确认 |
