# account-sync Specification

## Purpose
TBD - created by archiving change add-account-auth-and-sync. Update Purpose after archive.

### Requirement: 短信验证码登录

系统 MUST 提供手机号 + 短信验证码登录，登录成功签发可校验的 token，且任何响应都不得泄露手机号是否已注册。

#### Scenario: 首次登录自动建号并签发 token

- **WHEN** 用户提交合法手机号请求验证码
- **AND** 提交正确且在有效期内的验证码
- **THEN** 返回 `token`、`expiresAt` 与 `user`
- **AND** 若该手机号此前无账号，系统创建新账号
- **AND** 本机 token 被持久化后，后续请求自动带 `Authorization: Bearer <token>`

#### Scenario: 已注册与未注册手机号响应不可区分

- **WHEN** 分别用已注册手机号与未注册手机号请求验证码
- **THEN** 两者的响应体与 HTTP 状态码完全一致
- **AND** 用错误验证码校验时一律返回 `bad_code`，不区分「号码未注册」

#### Scenario: 验证码错误或过期被拒

- **WHEN** 提交错误验证码
- **THEN** 返回 401 `bad_code`
- **AND** 不签发 token

- **WHEN** 提交超过有效期的验证码
- **THEN** 返回 401 `bad_code`
- **AND** 不签发 token

#### Scenario: 验证码尝试次数与重发频率受限

- **WHEN** 同一验证码累计校验失败达到上限
- **THEN** 该验证码作废，后续校验一律失败

- **WHEN** 同一手机号在冷却时间内重复请求验证码
- **THEN** 返回 429 `too_frequent`

#### Scenario: 非生产环境接受固定验证码

- **WHEN** 服务运行在非生产环境
- **THEN** 接受固定验证码 `123456` 完成登录
- **AND** 该固定码在生产环境不生效

### Requirement: 登录态校验与失效

系统 MUST 校验每个受保护请求的 token，并按 `unauthorized` 与 `token_expired` 区分失效原因。

#### Scenario: 无 token 或无效 token 被拒

- **WHEN** 请求受保护接口但不带 `Authorization`
- **THEN** 返回 401 `unauthorized`

- **WHEN** 请求携带无法匹配任何 session 的 token
- **THEN** 返回 401 `unauthorized`

#### Scenario: 过期 token 单独标记

- **WHEN** 携带已过期的 token 请求受保护接口
- **THEN** 返回 401 `token_expired`（不是 `unauthorized`）
- **AND** 前端据此清除本机 token 并引导重新登录

#### Scenario: 滑动续期与写库节流

- **WHEN** 带有效 token 的请求在同一 session 的续期节流窗口内再次到达
- **THEN** token 仍有效
- **AND** 不为该请求重复写入 session 的活跃时间

- **WHEN** 请求距上次续期超过节流窗口
- **THEN** 该 session 的过期时间被顺延

#### Scenario: 登出后 token 立即失效

- **WHEN** 用户登出
- **THEN** 该 token 被作废
- **AND** 用同一 token 再次请求受保护接口返回 401 `unauthorized`
- **AND** 服务端不删除该账号的任何业务数据

### Requirement: 用户数据按账号隔离

系统 MUST 按账号隔离行程、回忆与攻略草稿的读写，未登录时不得读到他人数据。

#### Scenario: 受保护数据仅本人可读

- **WHEN** 账号 A 保存行程、回忆或攻略草稿
- **AND** 账号 B 带自己的 token 请求同一资源
- **THEN** 返回 401 或该资源不存在，不得返回 A 的内容

#### Scenario: 登录后跨设备找回

- **WHEN** 设备 A 登录并保存行程
- **AND** 设备 B 用同一手机号登录
- **THEN** 设备 B 能读到该行程

#### Scenario: 未登录行程读取保持可用

- **WHEN** 未登录用户请求行程列表
- **THEN** 请求成功，只返回其本机 `clientId` 名下与公共示例数据
- **AND** 不因缺少 token 返回 401

#### Scenario: 旧写被拒绝

- **WHEN** 客户端提交的 `updatedAt` 早于服务端已存版本
- **THEN** 返回 409 `stale_write`
- **AND** 服务端内容不被覆盖

### Requirement: 首次登录静默并账

系统 MUST 在登录成功时把本机 `clientId` 名下尚无归属的数据认领给该账号，且该操作幂等。

#### Scenario: 本机数据并入账号

- **WHEN** 匿名状态下用 `clientId = c1` 写入行程、回忆或攻略草稿
- **AND** 该设备登录成功
- **THEN** 这些记录的 `user_id` 被填为登录账号
- **AND** 用户无需额外确认，数据不丢失

#### Scenario: 并账幂等

- **WHEN** 同一 `clientId` 再次登录同一账号
- **THEN** 已归属的数据不被重复处理或改写
- **AND** 不产生重复记录

### Requirement: 匿名可用性不降级

系统 MUST 保证未登录用户仍可浏览、规划并保存本机行程。

#### Scenario: 匿名写请求按设备归属

- **WHEN** 未登录用户提交收藏、足迹、反馈或埋点
- **THEN** 请求成功，数据按 `client_id` 记录且 `user_id` 为空
- **AND** 不返回 401

#### Scenario: 匿名用户不看到登录阻断

- **WHEN** 未登录用户使用浏览与规划功能
- **THEN** 不出现「需要登录」的错误提示或强制跳转
- **AND** 未登录时云端同步调用被跳过，本机读写路径保持原样

### Requirement: 数据迁移只增不改

系统 MUST 以只新增的方式完成本次数据模型变更。

#### Scenario: 迁移不破坏历史数据

- **WHEN** 在已有数据上执行本次迁移
- **THEN** 只发生建表与新增可空列，不出现删除表或删除列
- **AND** 迁移前已存在的记录数量与内容不变
- **AND** 新增的 `user_id` 列在全为 null 时，系统行为与改动前一致

### Requirement: 照片跨设备的已知边界

系统 MUST 只把可跨设备访问的照片同步到账号，并对不可同步的照片明确标注，不得让用户误以为全部照片都能找回。

#### Scenario: 仅远程照片上云

- **WHEN** 用户的数据中包含 `kind` 为 `local` 或 `dataUri` 的照片
- **THEN** 这类照片不进入云端存储
- **AND** `kind` 为 `remote` 的照片正常同步

- **WHEN** 用户在其他设备查看找回的数据
- **THEN** 只能看到已同步的远程照片
- **AND** 界面标注本机照片换设备不可见的说明
