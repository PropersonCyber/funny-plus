# guide-share Specification

## Purpose
TBD - created by archiving change publish-guide-share. Update Purpose after archive.

### Requirement: 发布攻略生成不泄露内部标识的链接

作者 MUST 能把一份已保存的攻略草稿发布成一条分享链接。链接标识 MUST 由随机数生成，MUST NOT 由草稿 id、行程 id 或用户 id 派生或可反推。

#### Scenario: 首次发布返回链接

- **WHEN** 已登录作者对自己账号下的草稿调用 `POST /api/guides/:id/publish`
- **THEN** 返回 `token` 与完整可访问的 `url`
- **AND** `token` 为至少 128 bit 的随机值，且不含 `draftId` / `tripId` / `userId` 的任何子串

#### Scenario: 重复发布幂等

- **WHEN** 同一草稿被再次发布
- **THEN** 返回同一个 `token`，不产生第二条分享记录
- **AND** 若该 token 此前被撤回，重新发布 MUST 生成**新** token，旧链接保持失效

#### Scenario: 未登录不能发布

- **WHEN** 不带 token 或带非法 token 调用发布接口
- **THEN** 返回 401 `unauthorized`
- **AND** 不创建任何分享记录

#### Scenario: 不能发布别人的草稿

- **WHEN** 作者 A 对作者 B 的草稿调用发布接口
- **THEN** 返回 404 `not_found`
- **AND** 不创建任何分享记录

### Requirement: 公开分享页无需登录即可查看

系统 MUST 提供无需任何凭证即可访问的分享页。他人用浏览器打开链接 MUST 能看到正文，MUST NOT 被要求登录或安装 App。

#### Scenario: 未登录访问有效链接

- **WHEN** 未携带任何 token 请求 `GET /api/share/:token`
- **THEN** 返回该次发布的内容快照
- **AND** 响应体中不含 `userId`、手机号、`tripId`、`draftId` 中任何一个字段

#### Scenario: 分享页外壳可直接被浏览器打开

- **WHEN** 用浏览器请求 `GET /s/:token`
- **THEN** 返回 HTML，`<head>` 内包含 `og:title`、`og:type`、`og:image`、`og:url` 四个属性
- **AND** `og:title` 取值来自该次发布的标题，不是全站固定文案

#### Scenario: 发布内容遵守草稿阶段的隐私口径

- **WHEN** 某草稿中存在用户未勾选（`picked[planRef] !== true`）的地点
- **THEN** 该地点的任何字段都不出现在快照中
- **AND** `showCost` 为 false 时快照不含费用字段

### Requirement: 撤回后链接立即失效

作者 MUST 能撤回已发布的链接。撤回后，该链接 MUST 立即不可查看正文。

#### Scenario: 撤回后作者与访客都看不到正文

- **WHEN** 作者调用 `POST /api/guides/:id/unpublish`
- **THEN** 返回成功
- **AND** 此后 `GET /api/share/:token` 不再返回快照正文

#### Scenario: 失效链接返回引导页而非 404

- **WHEN** 访问已撤回或不存在 token 的 `GET /s/:token`
- **THEN** 返回 HTTP 200 与引导页
- **AND** 页面不包含任何原本的攻略正文

#### Scenario: 只有作者能撤回

- **WHEN** 非作者尝试撤回他人的分享
- **THEN** 返回 404 `not_found`
- **AND** 该分享保持可访问状态

### Requirement: 发布内容使用发布时刻的快照

分享页展示的 MUST 是发布那一刻的内容，此后作者继续编辑草稿 MUST NOT 改变已发布链接的内容。

#### Scenario: 发布后改草稿不影响已发布内容

- **WHEN** 作者发布后又修改了草稿标题
- **THEN** 已发布链接展示的仍是发布时的标题

### Requirement: 照片上传后才能随攻略分享

用户选的照片 MUST 能上传并换得可跨设备访问的地址。上传 MUST 校验类型与体积，失败 MUST 如实告知，MUST NOT 静默丢弃。

#### Scenario: 上传成功换成可访问地址

- **WHEN** 已登录用户上传一张合法图片
- **THEN** 返回可被 `<image src>` 直接消费的 `url`
- **AND** 该 `url` 在未登录状态下可访问

#### Scenario: 超过体积上限被拒

- **WHEN** 上传的图片超过约定上限
- **THEN** 返回 413 `too_large`
- **AND** 不写入任何文件

#### Scenario: 非图片类型被拒

- **WHEN** 上传的文件不是受支持的图片类型
- **THEN** 返回 415 `unsupported_type`

#### Scenario: 存储未配置时如实降级

- **WHEN** 服务端未配置媒体目录
- **THEN** 上传接口返回 503 `storage_unavailable`
- **AND** 前端提示「照片暂不能上传」，而不是假装成功

#### Scenario: 分享页只展示可跨设备访问的照片

- **WHEN** 草稿中的照片仍是 `local` 或 `dataUri`
- **THEN** 发布快照中不包含该照片
- **AND** 发布前界面如实提示这些照片不会随攻略分享
