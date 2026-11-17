# Tasks: add-account-auth-and-sync

> 执行约束
> - 每个任务必须有验证点，先定验证点再做最小实现。
> - 能自动化时遵守 TDD：失败用例 → 最小实现 → 通过。不得先实现再补测试。
> - 无法自动化时记录静态检查、人工或浏览器验证步骤，不得虚构已跑测试。
> - 前端任务按需覆盖 L1 契约/mock、L2 行为 Scenario、L3 联调/真实 API、L4 Browser 交叉验证。
> - 发现升级红线或范围膨胀时暂停，回到 triage/design。

## 1. 数据模型与迁移

- [x] 1.1 新增 `users` / `auth_sessions` / `sms_codes` / `trip_memories` / `guide_drafts` 五张表，并为 7 张存量表补可空 `user_id` + 索引
      验证点: `npx drizzle-kit generate` 产出 `0011_*.sql`，人工核对只含 `CREATE TABLE` 与 `ADD COLUMN`，无 `DROP`
- [x] 1.2 在已有数据上执行迁移
      验证点: `npx drizzle-kit migrate` 退出码 0；迁移前后 `select count(*) from trips` 一致；现存行的 `user_id` 为 null（对应 spec「迁移不破坏历史数据」）

## 2. 登录态基础设施

- [x] 2.1 token 签发、校验与滑动续期（含续期节流）
      验证点: 单测 5 条 —— 签发后可校验；过期返回 `token_expired`；已吊销返回 `unauthorized`；节流窗口内二次校验不改 `lastSeenAt`；超窗后 `expiresAt` 顺延（对应「滑动续期与写库节流」）
- [x] 2.2 `requireUser` 与 `optionalUser` 两档鉴权中间件
      验证点: 单测 4 条 —— 无 header → 401 `unauthorized`；坏 token → 401 `unauthorized`；好 token 注入 `c.user`；`optionalUser` 无 header 放行且 `c.user` 为 null（对应「无 token 或无效 token 被拒」）

## 3. 短信登录

- [x] 3.1 请求验证码接口（含频率限制与不泄露账号存在性）
      验证点: 单测 —— 手机号格式错 → 400 `bad_param`；已注册与未注册手机号响应体与状态码完全一致；冷却期内重发 → 429 `too_frequent`（对应「已注册与未注册手机号响应不可区分」）
- [x] 3.2 校验验证码并签发 token
      验证点: 单测 —— 错误码 → 401 `bad_code`；过期码 → 401 `bad_code`；尝试超限后该码作废；正确码返回 `token` + `expiresAt` + `user`；非生产环境接受 `123456`（对应「验证码错误或过期被拒」与「非生产环境接受固定验证码」）
- [x] 3.3 登录态查询与登出
      验证点: 单测 —— `me` 带 token 返回 user；登出后同一 token 请求 → 401 `unauthorized`，且该账号业务数据未被删除（对应「登出后 token 立即失效」）
- [x] 3.4 首次登录静默并账
      验证点: 单测 —— 预置 `client_id=c1` 且 `user_id` 为 null 的记录，登录后 `user_id` 被填；重复登录幂等不改写（对应「本机数据并入账号」与「并账幂等」）

## 4. 行程 / 回忆 / 攻略草稿上云

- [x] 4.1 行程写入接口与账号隔离（读取保持匿名可用）
      验证点: 单测 —— 无 token 写 → 401；带 token 写入后本人可读回；他人账号读不到；未登录 `GET` 仍成功（对应「受保护数据仅本人可读」「未登录行程读取保持可用」「登录后跨设备找回」）
- [x] 4.2 回忆与攻略草稿读写接口，含旧写拒绝
      验证点: 单测 —— 写入后读回一致；`updatedAt` 更旧 → 409 `stale_write` 且服务端内容不变；跨账号读不到（对应「旧写被拒绝」）
- [x] 4.3 照片同步降级：仅 `remote` 上云，`local` / `dataUri` 剥离
      验证点: 单测 —— 提交含三态照片的数据，入库后只剩 remote，另两态被剥离且不报错（对应「仅远程照片上云」）

## 5. 前端登录与云同步接入

- [x] 5.1 客户端 401 处理
      验证点: 单测 —— 收到 `token_expired` 后本机 token 被清空且抛出可识别错误；其它错误不清 token
- [x] 5.2 登录态 hook 与登录页
      验证点: 单测（纯逻辑）+ 真机走通收码 → 登录 → 刷新后登录态保留；登录页带自己的 `.module.scss`，`npm --prefix lynx run build` 通过且 `check:css` class 数增长与新增页面相符
- [x] 5.3 「我的」页登录入口与已登录态
      验证点: 真机 —— 未登录显示登录入口并可跳转；已登录显示脱敏手机号与退出；退出后回到未登录态（对应「匿名用户不看到登录阻断」）
- [x] 5.4 行程与攻略草稿的云端同步（未登录直接跳过）
      验证点: 真机 —— 匿名保存不报错且不发云端请求；登录后保存能在另一设备读回

## 6. 收口鉴权（7 张表）

- [x] 6.1 收藏 / 足迹 / 反馈 / 提交 / 约束报告 / 埋点的读写改为按账号归属，匿名仍按 `client_id`
      验证点: 单测 —— 未登录写请求成功且 `user_id` 为空；登录后写入带 `user_id`；登录后能读到本机未并账数据（对应「匿名写请求按设备归属」）
- [x] 6.2 收藏与足迹回归
      验证点: 真机或联调 —— 登录前写入的收藏/足迹在登录后仍可见；另一账号不可见（对应验收 7）

## 7. 验收报告

- [x] 7.1 生成 `e2e-report.md`，逐条覆盖 `proposal.md` 的 8 条验收
      验证点: 每条给命令、退出码或真机步骤；「照片跨设备」单列未覆盖风险，不得在结论里模糊
- [x] 7.2 全量门禁
      验证点: `npm --prefix lynx run typecheck` / `npm --prefix lynx run test` / `npm --prefix lynx run build` / `npm --prefix server run typecheck` 全部退出码 0
