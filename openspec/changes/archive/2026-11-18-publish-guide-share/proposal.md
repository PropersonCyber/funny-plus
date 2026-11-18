# publish-guide-share

Tier: 2

## 背景

- 需求来源：`docs/ai-native-mvp.md` F08 后半；`shared/types/index.ts:508` 已写明「发布能力（链接、快照、撤回）等账号与服务端能力就绪后再接」，该前置条件由已归档的 `add-account-auth-and-sync` 补齐。
- 问题：F08 前半只做到本机草稿。`lynx/src/pages/GuideDraftPage/index.tsx:156` 现在对用户说的是「发布成可分享的链接还需要账号与云端存储，这一期先只存本机」——一个如实说明，但功能没闭环。
- 用户价值：写完的攻略能真的发给别人看，且发出去的是「我愿意公开的那部分」，随时能收回。

## 调研结论（决定了本期取舍）

`share-research.md` 取证（详见 e2e-report 的「调研依据」一节）：

- **Lynx 官方没有 SSR**，用 IFR + 宿主注入 `initData` 替代。因此「复用 web bundle」与「服务端注入 og 元数据」**不冲突**——前者渲染正文，后者只拼 `<head>` 里的字符串。
- 微信**不吃 `og:` meta**，只吃 JS-SDK `updateAppMessageShareData`，需要后端维护 `jsapi_ticket` + 域名白名单 + URL 精确签名。这是独立工作量，本期不做。
- 国内 UGC 平台对失效内容普遍不返 404，而是 200 + 拦截页（小红书匿名访问返 `error_code=300031`）。本期沿用 200 + 引导页。
- `navigator.clipboard.writeText` 必须在**点击手势的同步栈内**调用，`await` 过就会 `NotAllowedError`。

## 目标

- 作者能把一份草稿发布成链接；链接**不泄露**内部 id，也**不泄露**作者身份。
- 任何人**无需登录、无需装 App**，用浏览器打开链接就能看正文。
- 作者能撤回；撤回后链接立即失效（200 + 引导页，不是 404）。
- 发布内容遵守草稿阶段的隐私口径：只含用户勾选的条目，费用默认不公开，无精确位置历史 / 同行人 / 私人备注。
- 照片真能上云：web 端选的照片（`dataUri`）上传后变成 `remote`，分享页能显示。

## 变更

- 数据：新增 `photos`（id / userId / mime / bytes / sha256 / createdAt）与 `guide_shares`（token 主键 / draftId / userId / snapshot jsonb / revokedAt / createdAt）。`guide_shares` 存**发布那一刻的快照**，不做「实时引用草稿」。
- 接口：
  - `POST /api/photos`（multipart，需登录）→ `{ id, url }`
  - `GET /api/photos/:id`（公开，长期缓存）
  - `POST /api/guides/:id/publish`（需登录）→ `{ token, url }`，重复发布返回同一条
  - `POST /api/guides/:id/unpublish`（需登录）→ 撤回
  - `GET /api/share/:token`（**公开，无鉴权**）→ 快照 + 作者公开昵称
  - `GET /s/:token`（公开 HTML 外壳，注入 og 标签）
- 契约：`bad_param` 400 / `unauthorized` 401 / `not_found` 404（仅作者侧接口查不到自己的草稿）/ `too_large` 413 / `unsupported_type` 415 / `storage_unavailable` 503。
- 交互：草稿页预览态底部由「需要账号与云端存储」改成「发布 / 撤回」；发布成功给出链接与「复制链接」；新增公开分享页路由。
- 存储：`env.ts` 新增 `MEDIA_DIR`（未配则 `storage_unavailable` 503，与 `AMAP_KEY` 同一套「没配就降级」模式），新增静态路由读回。

## 影响范围

- 页面/模块：新增 `lynx/src/pages/SharePage/`（公开只读渲染，复用 `GuideDraft` 的解构口径）；改 `GuideDraftPage` 预览态、`lynx/src/api.ts`（补 multipart 上传）、`lynx/src/photo.ts`（`dataUri` → 上传换 remote）、`useGuides.ts`（发布状态）、`useRoute.ts` / `subPages.tsx`（新增 `share` 路由）。
- 数据/API：`server/src/db/schema.ts`、新增 drizzle 迁移、新增 `server/src/routes/photos.ts` / `server/src/routes/share.ts`、`app.ts` 挂载、`guides.ts` 补 publish/unpublish。
- 权限/安全：`/api/share/:token` 与 `/s/:token` **不带 `requireUser`**——这是本期唯一的公开面，必须逐一确认它只吐快照里的字段，吐不到 `userId` / 手机号 / tripId。token 用 128 bit 随机（`crypto.randomBytes(16).toString('base64url')`），不用草稿 id，避免枚举。
- 兼容性：`guide_drafts` 表结构不变；`stripLocalPhotos` 继续在存云端副本时生效，发布快照走同一函数，避免两套剥离口径。

## 不做范围

- 微信 JS-SDK 动态分享卡片（需后端 ticket + 白名单，独立立项）
- SEO / 搜索引擎收录（CSR 分享页天然不收录，不为它付成本）
- 攻略广场 / 列表 / 搜索 / 推荐
- 评论、点赞、收藏别人发布的攻略
- 访问密码、链接有效期（默认永久有效，随时可撤回）
- 原创文件系统的真实 S3/OSS：本期是本地磁盘 + 静态路由，换对象存储只改 `server/src/sync/storage.ts` 一个文件
- 分享访问量统计（`track_events` 已有通道，本期不埋）

## 已确认决策

| 决策点 | 结论 | 来源 |
|--------|------|------|
| 分享页渲染方式 | 复用 Lynx web bundle + 新增公开路由 | 用户确认 |
| 预览卡 | 保留「复用 web bundle」的同时，服务端在 `/s/:token` 外壳 HTML 里注入 4 个 og 标签 + `<title>` | 用户确认（调研后） |
| 照片上云 | 本期一起做，让 `dataUri` / `local` 真能变 `remote` | 用户确认 |
| 对象存储实现 | 本地磁盘 + 静态路由；`MEDIA_DIR` 未配则 503。不引 SDK 依赖 | 用户确认 |
| 快照 vs 实时引用 | 发布存**快照**。理由：草稿会继续被编辑，实时引用会让「我发出去的是什么」在作者改完之后变掉 | 本条由实现方决定，记录备查 |
| 失效链接的 HTTP 语义 | 200 + 引导页，不返 404 | 调研（国内 UGC 通行做法） |
