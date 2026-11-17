# F06 账号与同步骨架 — 技术设计

## 1. 边界

| 层 | 本期改动 |
|---|---|
| 数据 | 新增 `users` / `auth_sessions` / `sms_codes` / `trip_memories` / `guide_drafts`；7 张存量表补 `user_id` 列 |
| 服务端 | `auth.ts` 从占位改为真实现；新增鉴权中间件；`trips.ts` 补写接口；新增 memories / guides 路由 |
| 前端 | `api.ts` 的 `setAuthToken()` 已就位，只补 401 处理；新增登录页与登录入口；`useTrips` / `useGuides` 补云端同步 |
| 不动 | 微信 / Apple provider 占位维持 501；分享发布不做 |

## 2. 数据模型

### 新增表

```ts
// users：手机号是账号合并锚点，三方凭证是绑定手段
users: id text pk, phone text unique null, wechatUnionid text unique null,
       appleSub text unique null, createdAt, lastSeenAt

// auth_sessions：一设备一 session，token 只存哈希
auth_sessions: id text pk, userId text not null, tokenHash text unique not null,
               clientId text, expiresAt not null, lastSeenAt, revokedAt null, createdAt

// sms_codes：验证码不复用、可枚举作废
sms_codes: id text pk, phone text not null, codeHash text not null,
           attempts int default 0, expiresAt not null, consumedAt null, createdAt
```

`phone` 可空是为了微信 / Apple 首次登录时用户还没绑手机号；绑定后再写 `phone` 并触发账号合并（同一手机号的历史匿名数据并过来）。

### 7 张存量表补列

`trips` / `collections` / `footprints` / `fact_feedbacks` / `data_submissions` / `constraint_reports` / `track_events` 各加：

```ts
userId: text('user_id'),   // nullable：历史行与匿名写入都留空
index('<table>_user_idx').on(t.userId)
```

纯新增可空列，历史数据不受影响，回滚安全。

### 云端化的三份用户数据

`trips` 已有表结构，直接复用；回忆与草稿各新建一张，用 `jsonb` 存整份 payload —— 因为它们的最小读写单元就是整份结构，拆成列反而要在服务端重写 `TripMemory` / `GuideDraft` 的嵌套形状，且每次加字段都要迁移。

```ts
trip_memories: tripId text pk, userId text not null, payload jsonb not null, updatedAt
guide_drafts:  id text pk, userId text not null, tripId text not null, payload jsonb not null, updatedAt
```

## 3. token 与鉴权

**opaque token，不用 JWT。** 32 字节随机数 base64url，库里只存 `sha256(token)`。理由：已选滑动续期，每次校验都要写库顺延过期时间，JWT 的无状态优势在这个策略下不存在；opaque 还能即时吊销（`revokedAt`），JWT 做不到。

**滑动续期节流**：同一 session 5 分钟内不重复写库。不节流等于每个请求一次 UPDATE，埋点批量上报会把 `auth_sessions` 打成热点行。

**中间件两档**：

| 中间件 | 语义 | 用在哪 |
|---|---|---|
| `requireUser` | 无 token / 哈希查不到 / 已吊销 / 已过期 → 401 | 行程、回忆、草稿的读写；`/api/auth/me` |
| `optionalUser` | 解析出 user 或 null，不拦 | 收藏、足迹、反馈、埋点（匿名仍可用） |

**读写归属规则**（`optionalUser` 的四条路径都要一致）：

- 写：有 user → 同时写 `user_id` 与 `client_id`；无 user → 只写 `client_id`，`user_id` 留空。
- 读：`or(eq(userId, uid), and(isNull(userId), eq(clientId, cid)))` —— 登录后既能读到账号数据，也能读到自己本机尚未并账的数据。
- 并账（登录成功时执行，幂等）：`update <table> set user_id = $uid where client_id = $cid and user_id is null`，7 张表逐张跑。
- 登出：不删数据，只 `revokedAt` 失效 session；本机 token 由前端清。

## 4. 接口契约

```
POST /api/auth/sms-code   { phone }                    → { ok, cooldown }
POST /api/auth/sms-verify { phone, code, clientId }    → { token, expiresAt, user, merged }
GET  /api/auth/me         [Bearer]                     → { user }
POST /api/auth/logout     [Bearer]                     → { ok }
GET  /api/auth/status                                  → 保留，identity 变为 'account' 时有 user

GET  /api/trips           [Bearer 可选]                → { items }
PUT  /api/trips/:id       [Bearer 必需]                → { item }      整份覆盖
GET  /api/memories/:tripId  [Bearer 必需]              → { item | null }
PUT  /api/memories/:tripId  [Bearer 必需]              → { item }
GET  /api/guides/:id        [Bearer 必需]              → { item | null }
PUT  /api/guides/:id        [Bearer 必需]              → { item }
```

**错误码**（`requireUser` 与登录共用一套，前端只需认这四个）：

| HTTP | code | 时机 |
|---|---|---|
| 400 | `bad_param` | 手机号格式错、缺字段 |
| 401 | `unauthorized` | 无 token / 无效 / 已吊销 |
| 401 | `token_expired` | 过期（与上一条分开，前端据此清 token 并跳登录） |
| 429 | `too_frequent` | 验证码重发过快 / 尝试次数超限 |
| 409 | `stale_write` | `updatedAt` 比服务端旧（见 §5） |

**验证码不泄露账号存在性**：`sms-code` 对已注册与未注册手机号一律返回 `{ ok: true }`；`sms-verify` 失败一律 `bad_code`，不区分「号码没注册」。

**dev 固定验证码**：`NODE_ENV !== 'production'` 时接受固定码 `123456`，且 `sms-code` 不真发短信、响应头带 `x-dev-code: 1` 便于自测。生产路径同一张 `sms_codes` 表，换的只是发送实现。

## 5. 并发与冲突

跨设备并发选 **last-write-wins + 旧写拒绝**：写请求带客户端 `updatedAt`，服务端比它新则 409 `stale_write`，前端提示「这台设备的数据比云端旧，刷新后再改」并按云端重拉。

不做字段级 merge：`TripMemory.places` 与 `GuideDraft.picked` 都是按 `PlanItem.id` 的 map，合并语义（同一地点两边都改过怎么办）没有正确答案，硬做会把用户的文字互相覆盖得更隐蔽。

## 6. 照片的已知缺口（必须记录，不能假装解决）

`PhotoRef` 三态里 `local`（壳层文件路径）与 `dataUri`（内联）换设备即失效。本期不做对象存储，所以：

- 上云时只保留 `kind: 'remote'` 的照片；`local` / `dataUri` 留在本机，界面标注「本机照片，换设备不可见」。
- 后果：验收里「换设备找回图文」只对 `remote` 照片成立。要彻底解决得接对象存储（上传 + 签名 URL），属于独立一期，不在本次范围。
- 这一条写进 `e2e-report.md` 的未覆盖风险，不允许在验收结论里模糊掉。

## 7. 迁移与回滚

**迁移**：drizzle `0011`，纯新增（5 张表 + 7 个可空列 + 索引）。`user_id` 全为 null 时系统行为与本期之前完全一致。

**回滚**：停用 `requireUser` 的强制即可退回「凭 clientId 读」的旧行为，列与表都可留着不删 —— 这是选可空列而非改造主键的原因。

## 8. 前端落点

| 文件 | 改动 |
|---|---|
| `lynx/src/api.ts` | `request()` 遇到 401 + `token_expired` 时清 token 并抛可识别错误 |
| `lynx/src/pages/LoginPage/`（新建） | 手机号 + 验证码两步表单，带 `.module.scss`（`check:css` 要求 class 与 TSX 一一对应） |
| `lynx/src/App/useAuth.ts`（新建） | 登录态、登录/登出、并账后重拉本机数据 |
| `lynx/src/App/useTrips.ts` | 登录后有写入时推云端；启动时云端与本机合并取新 |
| `lynx/src/App/useGuides.ts` | 同上 |
| `lynx/src/pages/ProfilePage/index.tsx` | 登录入口 / 已登录显示手机号 + 退出 |

**匿名不降级**：所有云端调用在未登录时直接跳过（不报错、不弹登录），本机读写路径保持原样。
