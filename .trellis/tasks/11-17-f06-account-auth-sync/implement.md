# F06 账号与同步骨架 — 执行计划

> 执行约束
> - 每个任务先定验证点，再做最小实现。可写自动化测试的走 TDD：失败用例 → 最小实现 → 通过。
> - 后端用 `node:test` / 现有测试风格；前端纯函数必测（storage / api / merge 逻辑），渲染层走真机或 Browser 预览。
> - 无测试工具的部分（drizzle 迁移、Lynx 原生壳回跳）记录静态检查与手动验证步骤，不得虚构已跑测试。
> - 发现范围膨胀（例如做成了对象存储上传、或顺手改了分享）立即停下回到 `design.md`。

## 阶段 0：前置核对（不动代码）

- [x] 0.1 确认 `server/.env` 的 `PG_URL` 可用、迁移基线在 `0010`
      验证：`npm --prefix server run typecheck` 通过；`ls server/drizzle/*.sql` 最后一个是 `0010_silent_bloodstrike.sql`
- [x] 0.2 记录改动前门禁基线
      验证：`npm --prefix lynx run test` 全过并记下用例数；`npm --prefix server run typecheck` 退出码 0

## 阶段 1：数据模型与迁移

- [x] 1.1 `server/src/db/schema.ts` 新增 `users` / `auth_sessions` / `sms_codes` / `trip_memories` / `guide_drafts`；7 张存量表补 `userId` 可空列 + 索引
      验证：`npx drizzle-kit generate` 产出 `0011_*.sql`，人工核对只含 `CREATE TABLE` 与 `ALTER TABLE ... ADD COLUMN`（不允许出现 `DROP`）
- [x] 1.2 跑迁移并验证历史数据完好
      验证：`npx drizzle-kit migrate` 退出码 0；`psql` 查 `select count(*) from trips` 与迁移前一致；`select * from trips limit 1` 的 `user_id` 为 null

## 阶段 2：token 与鉴权中间件

- [x] 2.1 token 签发 / 校验 / 滑动续期（含 5 分钟节流）纯函数
      验证：单测覆盖 5 条 —— 签发后哈希可校验；过期 token 返回 `token_expired`；`revokedAt` 非空返回 `unauthorized`；5 分钟内二次校验不写库（断言 `lastSeenAt` 未变）；超过 5 分钟顺延 `expiresAt`
- [x] 2.2 `requireUser` / `optionalUser` 中间件
      验证：单测四条路径 —— 无 header → 401；坏 token → 401；好 token → 注入 `c.user`；`optionalUser` 无 header 放行且 `c.user` 为 null

## 阶段 3：登录接口（短信通道 + dev 固定码）

- [x] 3.1 `POST /api/auth/sms-code`
      验证：单测 —— 手机号格式错 → 400 `bad_param`；已注册与未注册手机号返回体完全一致（不泄露存在性）；60 秒内重复请求 → 429 `too_frequent`；dev 环境响应头带 `x-dev-code: 1`
- [x] 3.2 `POST /api/auth/sms-verify`
      验证：单测 —— 错误码 → 401 `bad_code`；过期限 → 401 `bad_code`；尝试 5 次后作废；`123456`（非生产）→ 返回 token + `expiresAt` + `user`
- [x] 3.3 `GET /api/auth/me` / `POST /api/auth/logout`
      验证：单测 —— `me` 带 token 返回 user；`logout` 后同一 token 再请求 `me` → 401 `unauthorized`
- [x] 3.4 并账：登录成功时把本机 `clientId` 名下 7 张表的数据认领给账号
      验证：单测 —— 预置 `client_id = 'c1'` 且 `user_id` 为 null 的行程各一条，登录后 `user_id` 被填上；重复登录不再改（幂等，`updated` 计数为 0）

## 阶段 4：行程 / 回忆 / 草稿上云

- [x] 4.1 `trips` 补写接口（`GET` 兼容匿名，`PUT /:id` 需鉴权）
      验证：单测 —— 无 token `PUT` → 401；带 token `PUT` 后 `GET` 能读回；另一账号 `GET` 读不到
- [x] 4.2 `trip_memories` / `guide_drafts` 路由与整份覆盖写
      验证：单测 —— `PUT` 后 `GET` 一致；`updatedAt` 更旧 → 409 `stale_write`；跨账号读不到
- [x] 4.3 照片上云的降级：只保留 `kind: 'remote'`，`local` / `dataUri` 不进库
      验证：单测 —— 送含三态照片的 `TripMemory`，库里只留 remote，另两种被剥掉且不报错

## 阶段 5：前端接登录

- [x] 5.1 `lynx/src/api.ts` 的 401 处理
      验证：单测 —— `token_expired` 响应后 `authToken()` 变空、抛出的错误可被上层识别；`unauthorized` 不清空已存在 token 之外的状态
- [x] 5.2 `useAuth` hook
      验证：单测（纯逻辑）+ 真机确认登录态在刷新后保留
- [x] 5.3 `LoginPage` 页面（手机号 → 验证码两步，带 `.module.scss`）
      验证：`npm --prefix lynx run build` 通过且 `check:css` 的 class 数增长与新增页面相符；真机走一遍收码 → 登录
- [x] 5.4 `ProfilePage` 登录入口 / 已登录态
      验证：真机 —— 未登录点入口跳登录页；登录后显示手机号与退出；退出后回到未登录态
- [x] 5.5 `useTrips` / `useGuides` 接入云端（未登录直接跳过）
      验证：真机 —— 匿名存行程不报错且不请求云；登录后保存能在另一设备读回

## 阶段 6：验收

- [x] 6.1 生成 `e2e-report.md`，覆盖 `prd.md` 的 8 条 Acceptance
      验证：每条给命令、退出码或真机步骤与截图；照片缺口单列「未覆盖风险」
- [x] 6.2 全量门禁
      验证：`npm --prefix lynx run typecheck` / `npm --prefix lynx run test` / `npm --prefix lynx run build` / `npm --prefix server run typecheck` 全部退出码 0

## 危险文件与回滚点

| 文件 | 风险 | 回滚点 |
|---|---|---|
| `server/drizzle/0011_*.sql` | 迁移不可逆（Postgres 加列可逆，建表可逆） | 迁移前 `pg_dump` 一份；本迁移只有 ADD，未删任何东西 |
| `server/src/db/schema.ts` | 改错会导致后续 `generate` 产出 DROP | 每次 `generate` 后人工核对 SQL 再 `migrate` |
| `server/src/routes/auth.ts` | 现有 `/status`、`/login` 被前端读取，语义变了会连带 | 保留 `/status` 的 `providers` 字段不变，只增 `user` |
| `server/src/routes/trips.ts` | 唯一被前端读的行程接口 | 保留 `clientId` 查询参数兼容分支 |
| `lynx/src/api.ts` | 所有请求的公共入口 | 401 处理只在拿到 `token_expired` 时清 token，其余路径不动 |
| `lynx/src/App/useTrips.ts` | 行程是本机数据主路径，改坏会丢用户数据 | 云端同步只写不覆盖本机已有更新的数据；先写本机再推云 |

## 提交前检查

- [x] 暂存范围只含本次 change 触及的文件，禁止 `git add -A`
- [x] `git diff` 人工过一遍：不允许出现大范围格式化、不允许删掉与本 change 无关的注释
- [x] `e2e-report.md` 的 `## 验收结论` 已写，且 `阻塞项:` 与实际一致
