# E2E 验收报告：add-account-auth-and-sync

Tier: 2

## 门禁结果

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `npm --prefix server run typecheck` | 0 | 无输出 |
| `npm --prefix server run test` | 0 | 5 文件 / **44 用例**全过 |
| `npm --prefix lynx run typecheck` | 0 | 无输出 |
| `npm --prefix lynx run test` | 0 | 17 文件 / **147 用例**全过（基线 143 + 新增 4） |
| `npm --prefix lynx run build` | 0 | `check:css` ✔ **793 class**（基线 769，+24 与新增页面吻合）；`main.lynx.bundle` 12309.5 kB（基线 12288.8，+20.7） |

**迁移核对**：`server/drizzle/0011_fearless_doctor_doom.sql` 共 69 行 —— 5 个 `CREATE TABLE`、7 个 `ADD COLUMN`（全部可空）、17 个 `CREATE INDEX`，**零 `DROP`**。执行前后数据量一致：trips 9 / collections 3 / footprints 4 / track_events 10 / fact_feedbacks 33；7 张表 `user_id` 全为 null。

## 逐条验收

### 1. 匿名用户不登录仍可浏览、规划、保存本机行程

- 证据：`GET /api/trips` 无 token 返回 200（用例「未登录仍能读到内置示例（匿名不降级）」，`server/src/routes/auth.test.ts`）。
- 前端：`lynx/src/sync.ts` 的 `pushTrip` / `pushMemory` / `pushGuide` 在 `authToken()` 为空时**直接 return false**，不发任何请求。`useTrips` / `useGuides` 的 effect 先落本机再调推送，推送失败只影响同步。
- 结论：**通过**。

### 2. 请求验证码 → 校验 → 拿到 token；验证码无效/过期被拒且不泄露手机号是否已注册

- 请求验证码：`{"ok":true,"cooldown":60}`，dev 环境响应头带 `x-dev-code: 1`。
- 校验：返回 `token`（43 字符 base64url）、`expiresAt`、`user`、`merged`。
- 错误码：`000000` → 401 `bad_code`；手机号格式错 → 400 `bad_param`；60 秒内重发 → 429 `too_frequent`（均有单测覆盖）。
- 不泄露存在性：已注册与未注册手机号的 `sms-code` 响应体 `toEqual` 一致（用例「已注册与未注册手机号请求验证码的响应完全一致」）。
- 结论：**通过**。

### 3. 带 token 成功、无 token/过期 401，不再凭 clientId 读他人数据

| 请求 | 结果 |
|---|---|
| `PUT /api/trips/e2e-trip-1` 无 token | **HTTP 401** |
| 同上带 token | **HTTP 200** |
| `GET /api/auth/me` 无 token | 401 `unauthorized` |
| 过期 token 请求 | 401 **`token_expired`**（与 `unauthorized` 分开，用例「过期 token 返回 token_expired」）|
| 登出后同 token 请求 | 401 `unauthorized` |

- 结论：**通过**。

### 4. 设备 A 存、设备 B 同一手机号读回；他账号读不到

- 设备 A（clientId `e2e-client-a`）写入 `e2e-trip-1` → 本人 `GET` 读回含该行程（总数 4）。
- 账号 B（手机 `13900002222`，clientId `e2e-client-b`）`GET`：**不含 `e2e-trip-1`**。
- 「换设备登录同一手机号能读回」另有单测覆盖（设备 A clientId c1 写入 → 设备 B clientId c2 同手机号登录后可见）。
- 结论：**通过（图文部分受限，见「未覆盖风险」）**。

### 5. 首次登录静默并账，不丢失、不重复

- 造匿名收藏 `e2e-anon-col`（`client_id = e2e-client-merge`，`user_id = null`），带该 clientId 登录：
  - `merged: {collections: 1, ...}`，`ANON_COL_USER_ID_FILLED true`。
- 再次登录同一手机号：`merged` 全部为 **0**（幂等，不改写已归属行）。
- 结论：**通过**。

### 6. 迁移只新增、历史数据不被破坏

- 见上方「迁移核对」：零 `DROP`，数据量前后一致，新列全 null。
- 结论：**通过**。

### 7. 收藏与足迹收口后行为不变

- `server/src/routes/me.ts` 全部改走 `optionalUser`；登录后读覆盖「账号名下」+「本机 clientId 名下未并账」两类。
- 用例「登录后写收藏带上 user_id，且本机未并账的收藏仍能读到」：匿名写 `t-anon-fact`、登录后写 `t-logged-fact`，登录态 `GET /api/me` **两条都在**。
- 结论：**通过（服务端层）**。真机「收藏页视觉不变」未验，见未覆盖风险。

### 8. 未登录写请求按 client_id 临时归属仍可用，不报 401

- 用例「未登录写收藏成功且 user_id 为空」：`POST /api/me/collections` 无 token → **200**，落库 `user_id` 为 `null`。
- 埋点走 `resolveActorQuietly`：token 坏也照常落库，永不因鉴权返回 4xx（保 `events.ts` 原有「永不返回 4xx」约定）。
- `submit.ts`（补录 / 约束报告）同样接 `resolveActorQuietly`，登录才写 `user_id`。
- 结论：**通过**。

## 未覆盖风险

1. **照片跨设备不可还原（本期已知缺口）**。`PhotoRef` 的 `local` / `dataUri` 两态换设备即失效。已实现上云前剥离：提交含三态照片的回忆，入库后只剩 `["remote"]`（实测输出）。后果：验收 4 的「图文找回」**只对 `remote` 照片成立**。要彻底解决需接对象存储，属独立一期。
2. **真机渲染未验**。登录页、「我的」页账号行的实际视觉效果、输入法交互、倒计时表现均未在 iOS 真机跑过。本报告只覆盖到 API 层与构建门禁。按用户口径「iOS 自己验」，此项留给真机验收。
3. **短信未接真实服务商**。dev 固定码 `123456` 的整条路径已验；生产路径（真发短信、真实验证码校验）未验，因为服务商凭证未到位。生产环境拒绝固定码有单测覆盖（`checkCode(..., {dev:false})` → `mismatch`）。
4. **微信 / Apple 登录未接通**。provider 占位契约保留，未配置仍返回 501；`/status` 报 `configured: false`。
5. **跨设备并发只做了「旧写拒绝」**。`updatedAt` 更旧返回 409 `stale_write` 有单测；但前端收到 409 后只吞掉、不提示用户刷新，属已知的粗糙处理（`lynx/src/sync.ts` 注释已写明）。
6. **滑动续期节流未做端到端计时验证**。单测覆盖了「窗口内不续期 / 超窗顺延」的纯函数逻辑，但没有真实等待 5 分钟验证写库次数。

## 验收结论

结论: 通过

阻塞项: 无
8 条验收中 1/2/3/5/6/7/8 在 API 层与单测层全部通过，第 4 条的「行程」部分通过、「图文」部分受照片缺口限制（已在风险 1 如实记录，未模糊处理）。

未覆盖的三项均为范围外或需真机：真机渲染（用户自行验）、真实短信服务商（凭证未到位）、微信/Apple 登录（依赖开放平台 AppID 与 iOS 能力配置）。

建议归档：**建议**。带动条件是把风险 1 与风险 5 计入后续期次，不要在 F08 分享页把「照片可找回」写进承诺。
