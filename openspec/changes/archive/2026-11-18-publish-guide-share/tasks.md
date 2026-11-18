# tasks

## 1. 数据层

- [x] 1.1 `server/src/db/schema.ts` 新增 `photos` 表（`id` 主键 / `userId` notNull / `mime` / `bytes` / `sha256` / `createdAt`），带 `photos_user_idx`
- [x] 1.2 新增 `guideShares` 表（`token` 主键 / `draftId` / `userId` / `snapshot` jsonb / `revokedAt` 可空 / `createdAt`），带 `guide_shares_user_idx`、`guide_shares_draft_idx`、`guide_shares_draft_active_idx`（`(draftId, revokedAt)`，用来查「该草稿当前有效的分享」）
- [x] 1.3 `npm --prefix server run db:generate` 产出迁移，人工核对：只有 `CREATE TABLE` / `CREATE INDEX`，零 `DROP`
- [x] 1.4 执行迁移，记录执行前后 `photos` / `guide_shares` 计数，确认存量表数据量不变

## 2. 存储与上传

- [x] 2.1 `server/src/env.ts` 新增 `media = { dir, maxBytes, configured() }`，从 `MEDIA_DIR` / `MEDIA_MAX_BYTES` 读，默认上限 5MB
- [x] 2.2 新建 `server/src/sync/storage.ts`：`putPhoto(bytes, mime)` / `readPhoto(id)` / `photoUrl(id)`，本地磁盘实现（按 id 前两位分桶建目录），返回 `null` 表示存储未配置
- [x] 2.3 新建 `server/src/routes/photos.ts`：`POST /` 走 `requireUser` + multipart 解析 → 校验 mime 白名单（jpeg/png/webp/gif）与体积 → 写盘 + 落 `photos` 行 → 返回 `{ id, url }`；错误码 `too_large` 413 / `unsupported_type` 415 / `storage_unavailable` 503 / `bad_param` 400
- [x] 2.4 同文件 `GET /:id`：**无鉴权**，按 `photos` 行拿 mime，读文件流返回，带 `cache-control: public, max-age=31536000, immutable`；id 不存在返回 404
- [x] 2.5 `server/src/app.ts` 挂载 `app.route('/api/photos', photoRoute)`
- [x] 2.6 单测 `server/src/routes/photos.test.ts`：合法上传 / 超大 413 / 非图 415 / 未配目录 503 / 无 token 401 / 公开读回字节一致

## 3. 发布与撤回

- [x] 3.1 新建 `server/src/sync/shareSnapshot.ts`：`buildShareSnapshot(draft)` —— 按 `picked` 过滤 `sections` 条目、剥掉未勾选地点、`showCost` 为 false 时去掉费用、复用 `stripLocalPhotos`、**不携带** `tripId` / `draftId` / `userId`；返回 `{ title, summary, photos, showCost, sections, publishedAt }`
- [x] 3.2 `server/src/routes/guides.ts` 加 `POST /:id/publish`：`requireUser` → 查草稿（非本人 404 `not_found`）→ 查该草稿是否已有未撤回分享（有则原样返回）→ 否则 `crypto.randomBytes(16).toString('base64url')` 生成 token、存快照
- [x] 3.3 同文件加 `POST /:id/unpublish`：`requireUser` + 本人校验 → 给当前有效分享写 `revokedAt`；无有效分享返回 `{ ok: true, revoked: false }`（幂等）
- [x] 3.4 新建 `server/src/routes/share.ts`：
  - `GET /api/share/:token` → 查未撤回的分享，有效则返回快照 + 作者公开昵称（`u***1234` 形式，不带完整手机号）；无效返回 404 `not_found`
  - `GET /s/:token` → 一律 200，返回 HTML 外壳；有效时在 `<head>` 注入 `og:title` / `og:type=article` / `og:image` / `og:url` / `<title>`，无效时注入引导页文案与全站默认图
- [x] 3.5 HTML 外壳模板单独成 `server/src/routes/shareShell.ts`，`<lynx-view global-props='{"__fpShareToken":"..."}'>`，bundle 路径可配（`MEDIA_PUBLIC_BASE` 未配时用 `/web/main.web.bundle`）
- [x] 3.6 `app.ts` 挂载 `app.route('/api/share', shareRoute)` 与 `app.route('/s', shareShellRoute)`
- [x] 3.7 单测 `server/src/sync/shareSnapshot.test.ts`：未勾选条目被剔除 / `showCost=false` 无费用 / `local` 与 `dataUri` 照片被剥 / 输出不含 tripId、draftId、userId
- [x] 3.8 单测 `server/src/routes/share.test.ts`：发布幂等 / 撤回后 404 / 非作者撤回 404 / 重新发布换新 token 且旧 token 失效 / `/s/:token` 有效含 og:title / 失效返 200 且不含正文 / 快照接口无 userId 等字段

## 4. 前端：照片上传

- [x] 4.1 `lynx/src/api.ts` 新增 `upload(path, file)`：不走 JSON 头，用 `FormData` + `Authorization`，其余错误处理与 `request` 一致
- [x] 4.2 `lynx/src/photo.ts` 新增 `uploadPhoto(ref)`：`dataUri` 先 base64 转 bytes 再上传；`local` 无读取能力时返回 `null` 并说明；成功返回 `kind: 'remote'` 的 `PhotoRef`，失败返回 `null`
- [x] 4.3 `MemoryPage` 选完照片后调 `uploadPhoto`，成功后写入 `remote` 引用，失败保留原样并提示一次
- [x] 4.4 单测 `lynx/src/photo.test.ts`：`dataUri` 解码为 bytes 正确 / 上传失败返回 null 不抛

## 5. 前端：发布 / 撤回 / 分享页

- [x] 5.1 `lynx/src/sync.ts` 加 `publishGuide(draftId)` / `unpublishGuide(draftId)` / `fetchShare(token)`，未登录时发布返回 `{ ok: false, reason: 'login' }`
- [x] 5.2 `lynx/src/App/useGuides.ts` 增加 `published: Record<tripId, { token, url }>`，从本机存档恢复，发布/撤回后更新
- [x] 5.3 `GuideDraftPage` 预览态底部：未登录时保持「需要账号」文案并给登录入口；已登录时给「发布」按钮；已发布时显示链接与「复制链接」「撤回」
- [x] 5.4 复制链接：`writeText` 放在点击同步栈内先调用，失败降级到「请长按选中下面的链接」的可见文本，不给点了没反应的按钮
- [x] 5.5 发布前检查草稿照片，若有 `local` / `dataUri` 残留则先提示「这些照片不会随攻略分享」，用户确认后再发
- [x] 5.6 新增 `lynx/src/pages/SharePage/index.tsx` + `index.module.scss`：只读渲染标题 / 概述 / 照片 / 分天条目 / 到访标签，底部「打开趣哪玩儿」；无效 token 显示引导文案
- [x] 5.7 `useRoute.ts` 加 `share` 与 `shareToken` 参数；`subPages.tsx` 挂 `SharePage`；`App/index.tsx` 从 `useGlobalProps()` 取 `__fpShareToken` 并 `go('share', {...})`
- [x] 5.8 `hostBridge.ts` 增加 `shareToken()` 读取器，`setHostProps` 落 `__fpShareToken`
- [x] 5.9 单测 `lynx/src/sharePage.test.ts`（若 `check:css` 与渲染口径允许则接手）覆盖「无效 token 显示引导文案」，否则以 e2e 实测代替并在报告注明

## 6. 验收

- [x] 6.1 `npm --prefix server run typecheck` / `run test` 全过
- [x] 6.2 `npm --prefix lynx run typecheck` / `run test` / `run build` 全过，`check:css` class 数与新增页面吻合
- [x] 6.3 真实链路实测（curl 打 8787）：上传照片 → 发布 → 未登录 `GET /api/share/:token` 拿到正文且不含 userId → `GET /s/:token` 含 og:title → 撤回 → 再取正文为空 / 外壳 200 引导页 → 重新发布换新 token 且旧 token 失效
- [x] 6.4 浏览器实测：web 预览下打开发布出的 `/s/:token`，确认正文渲染、照片显示、撤回后变引导页
- [x] 6.5 写 `e2e-report.md`，含调研依据、逐条 AC 的实测结论、未覆盖风险
