# publish-guide-share 验收报告

Tier: 2 · 代码冻结点：`git diff | shasum -a 256` = `6809abb3825df0fd`

## 调研依据

开工前对「App 内容分享到外部可访问页面」做了行业调研（全文见会话附件 `share-research.md`，199 行，取证方式为 curl 直取一手文档 + 实测产品页面）。三条结论直接决定了本期的技术取舍：

1. **Lynx 官方没有 SSR**，官方对照表里 SSR 那行写的是「IFR + host 提供的 `initData`」（来源 `https://lynxjs.org/llms.txt`）。所以「复用 web bundle 渲染正文」与「服务端在 head 里拼 og 标签」不冲突，两件事各管一半。
2. **微信不吃 `og:` meta**，只吃 JS-SDK 的 `updateAppMessageShareData`，需要后端维护 `jsapi_ticket` + 域名白名单 + URL 精确签名（来源：`https://res.wx.qq.com/open/js/jweixin-1.6.0.js` 实体，官方文档页已 404）。这是独立工作量，本期明确不做。
3. **国内 UGC 对失效内容普遍返 200 而不是 404**（小红书匿名访问返 `error_code=300031`）。本期沿用这一做法。

另外两条查不到一手依据、按现象处理，报告里标注：抓取器不执行 JS（〔推断〕，依据是 ogp.me 要求 meta 静态在 head）；微信外链屏蔽规则页不可达（〔未验证〕）。

## 门禁结果

| 命令 | 结果 |
|---|---|
| `npm --prefix server run typecheck` | 0 |
| `npm --prefix server run test` | 8 文件 / **69 用例**全过（基线 44 + 新增 25） |
| `npm --prefix lynx run typecheck` | 0 |
| `npm --prefix lynx run test` | 17 文件 / **156 用例**全过（基线 147 + 新增 9） |
| `npm --prefix lynx run build` | 0，`check:css` **824 class**（基线 793，+31 与 SharePage 24 + GuideDraftPage 7 精确吻合） |
| 迁移 | `0012_cute_natasha_romanoff.sql`：2 `CREATE TABLE` + 5 `CREATE INDEX`，**零 DROP**；执行前后存量表计数不变 |

## 逐条验收

### AC-1 发布生成不泄露内部标识的链接

| Scenario | 实测 | 结论 |
|---|---|---|
| 首次发布返回 token 与 url | `{"token":"d6t3SDbqr7iM4DUG6gJRyg","url":"http://127.0.0.1:8787/s/d6t3..."}`，token 22 字符（22 × 6 bit ≈ 132 bit） | 通过 |
| token 不含 draftId / tripId / userId 片段 | `grep -c "$DID"` = **0** | 通过 |
| 重复发布幂等 | 第二次返回 `SECOND_TOKEN_SAME=true`，`guide_shares` 只 1 行 | 通过 |
| 撤回后重发换新 token，旧链接保持失效 | `NEW=atOphKzAy4qF...` ≠ `OLD=d6t3...`；旧 404 / 新 200 | 通过 |
| 未登录发布 401 | curl 无 Authorization → **401** | 通过 |
| 不能发布别人的草稿 | 账号 B 打 A 的草稿 → **404 `not_found`**，分享记录 0 条 | 通过 |

> token 长度说明：方案里写的是「128 bit 随机」，实现体是 `randomBytes(16)` = 128 bit，经 base64url 后是 22 字符。schema 与 spec 的口径一致。

### AC-2 公开分享页无需登录即可查看

| Scenario | 实测 | 结论 |
|---|---|---|
| 未登录拿到快照 | 无 Authorization 请求 `/api/share/:token` → 200 + 完整快照 | 通过 |
| 响应不含内部标识 | userId=0 / user_id=0 / phone=0 / tripId=0 / 草稿id=0 处命中 | 通过 |
| 作者仅脱敏展示 | `authorLabel = "136****0001"` | 通过 |
| 未勾选条目被剔除 | 快照里 titles 只有 `['人民公园']`，未勾选地点的正文「不该出现在分享里」命中 **0** 次 | 通过 |
| `showCost=false` 不含费用字段 | 快照 keys = `['photos','publishedAt','sections','showCost','summary','title']`，无 `perPerson` | 通过 |
| 外壳含四个 og 属性 | `og:title=成都两日：我的走法 · 趣哪玩儿` / `og:type=article` / `og:image=.../api/photos/...` / `og:url=.../s/...`，另有 `twitter:card` | 通过 |
| og:title 来自该次发布 | 见上，标题为内容标题而非全站固定文案 | 通过 |
| 浏览器真实渲染 | 见「浏览器实测」一节 | 通过 |

### AC-3 撤回后链接立即失效

| Scenario | 实测 | 结论 |
|---|---|---|
| 撤回后取不到正文 | `unpublish` → `{"ok":true,"revoked":true}`；`/api/share/:token` → **404** | 通过 |
| 失效链接 200 + 引导页 | `/s/:token` → **200**，页面含「这份攻略已不再公开」 | 通过 |
| 引导页不残留正文 | 失效页里原标题「成都两日」命中 **0** 次 | 通过 |
| 只有作者能撤回 | 账号 B 撤回 A 的分享 → **404**，该分享仍 200 可访问 | 通过 |
| 撤回幂等 | 无有效分享时撤回 → `{"ok":true,"revoked":false}` | 通过 |

### AC-4 发布内容使用发布时刻的快照

| Scenario | 实测 | 结论 |
|---|---|---|
| 发布后改草稿不影响已发布内容 | 改标题后再取快照，`snapshot.title` 仍是发布时的「成都两日：我的走法」 | 通过（单测 `share.test.ts`「快照语义」） |

### AC-5 照片上传后才能随攻略分享

| Scenario | 实测 | 结论 |
|---|---|---|
| 上传换成可访问地址 | 67 字节 PNG → `{"id":"qBiXndfbi1HoMs2kdVldhw","url":".../api/photos/qBiX..."}` | 通过 |
| 该地址未登录可访问 | 无 Authorization GET → **200**，`content-type: image/png`，**字节完全相同**（`cmp` 通过） | 通过 |
| 超上限 413 | 上限压到 10 字节 → **413 `too_large`**，photos 表 0 行 | 通过 |
| 非图片 415 | `text/plain` → **415 `unsupported_type`** | 通过 |
| 存储未配置 503 | `media.dir=''` → **503 `storage_unavailable`** | 通过 |
| 未登录上传 401 | 无 Authorization → **401** | 通过 |
| 分享页只展示 remote 照片 | 快照 `photos` 的 kind 只剩 `['remote']` | 通过 |

## 浏览器实测

用 PI-Desktop 内置浏览器直接打开 `http://127.0.0.1:8787/s/<token>`（服务端真实进程 + 真实 DB + 真实照片文件）：

- **有效链接**：标题、概述、`来自 134****0001 的分享`、`人均 ¥388`、第 1 天「人民公园 / 去过 / 喝茶晒太阳」、第 2 天「青羊宫 / 计划过」、封面照片全部渲染，底部无 Tab 栏。截图存 `browser-screenshot-1794969701002.jpg`。
- **未勾选地点**不出现在页面上。
- **「计划过」标签反例已验**：`visited: 'unknown'` 的条目渲染为灰色「计划过」，没有冒充「去过」。
- **撤回后**：同一 URL 重新加载显示「这份攻略已不再公开」+「去看看趣哪玩儿」，原标题不出现。截图存 `browser-screenshot-*.jpg` 前一张为有效态。

## 实测中发现并已修掉的两个缺陷

这两个都不是设计遗漏，是实现过程中真实踩到并复现过的：

1. **分享页客户端资源 404**：外壳最初用 `./main.web.bundle`、`./static/js/client.js` 相对路径，浏览器挂到 `/s/:token` 下就变成请求 `/s/main.web.bundle`，正文完全加载不出来。修法：新增 `/web/*` 静态路由（类型白名单 + 拒绝 `..`），外壳改用绝对前缀 `WEB_ASSET_BASE`。实测 `/web/main.web.bundle` 200（12.4MB）、`/web/../.env` 404、`/web/server.ts` 404。
2. **分享页出现 App 底部 Tab 栏**：截图里明确可见「首页/地图/行程/避坑/我的」。访客看到会以为这是 App 内页。修法：`route.route === 'share'` 时不渲染 TabBar，复验后 `tabbarStillThere = 0`。

另修掉一个**测试自身的缺陷**：`photos.test.ts` / `share.test.ts` 里有 3 处断言用全表 `count`，库里只要有任何残留数据就会红。已全部改为按本次用户/本次草稿限定，这类断言不再依赖库的干净程度。

## 未覆盖风险

1. **微信内动态分享卡片做不到**：微信只吃 JS-SDK 签名，本期只做了 `og:` 标签。微信里把链接发出去，卡片标题是 `og:title` 的内容标题这一点在微信里**不生效**，需要独立立项做 `jsapi_ticket` + 域名白名单。
2. **SEO 不收录**：CSR 页面，抓取器只见空壳。这是刻意不为它付成本，不是缺陷。
3. **抓取器行为未一手取证**：WhatsApp / Twitter / Facebook 的文档域名在本环境不可达，`og:` 是否被消费是〔推断〕。
4. **`WEB_ASSET_DIR` 必须含 web-core 运行时**：`lynx/dist` 里只有两个 bundle，没有 `static/`（client.js / css / wasm）；那套运行时在 `ios/FunnyPlus/FunnyPlus/web/static/`（壳工程的预构建快照）。本次已把 `server/.env` 的 `WEB_ASSET_DIR` 定到 `../ios/FunnyPlus/FunnyPlus/web`（仓库内稳定路径，重启不失效），并同步了最新 `main.web.bundle`。**部署时若用别的目录，必须确认它下面有 `static/`，否则分享页白屏** —— 这是最容易在线上复现的坑。
5. **真机未验**：Android 未跑；iOS 由用户自行验证。分享页是浏览器页面，真机上的表现取决于壳层 WebView 版本。
6. **照片上限 5MB 未做压缩**：大于 5MB 的图直接 413，前端只提示，不做等比压缩。手机拍照原图常在 3~8MB，实际会命中这条。
7. **草稿照片仍是 `dataUri` 的情况未端到端验**：`uploadPhoto` 的 `dataUri` 分支有单测（`photoData.test.ts` 9 例），但从「回忆页选图 → 上传成功 → 变成 remote」这条完整链路没在浏览器里跑过，因为原生壳还没有选图能力（`photo.ts` 注释已记录）。web 预览下 `pickFromBrowser` 能产出 `dataUri`，但没有自动化覆盖。
8. **`authorLabel` 用手机号派生**：`users` 表没有昵称字段，所以显示的是 `134****0001`。等有昵称或用户自定义展示名时应该换掉。
9. **`guide_shares` 无清理策略**：撤回的行永久保留（为了区分「失效」与「从未存在」），长期会累积。本期数据量可忽略，但需要一个 TTL 或归档策略。
10. **`MEDIA_DIR` 默认未配**：`server/.env` 里本次新增了 `MEDIA_DIR` / `MEDIA_PUBLIC_BASE` / `WEB_ASSET_DIR`（`.env` 不进仓，已备份为 `server/.env.bak-20261118102420-before-media`）。部署环境必须自行配齐这三项。

## 调研未取到的项

- 马蜂窝 / 大众点评的链接形态：两家都返回风控空壳页（209B / 2.9KB），未取到，不做臆测。
- 微信外链屏蔽规则：官方规则页不可达，只写到现象层（UA 检测 + 引导浮层是常见做法），未实现。

## 验收结论

结论: 通过

阻塞项: 无
（未覆盖风险 10 条已在上一节逐条列明，均为「已知限制 + 上线前提」，不构成本期阻塞。其中唯一需要动手确认的是第 4 条：部署环境的 `WEB_ASSET_DIR` 必须包含 web-core 运行时 `static/` 目录，否则分享页白屏。）

AC-1 ~ AC-5 的 24 个 Scenario 全部有实测或可执行用例覆盖，其中 20 条经由真实服务端 + 真实 Postgres + 真实文件落盘用例验证，4 条（发布后改草稿、撤回幂等、快照字段口径、dataUri 解码）由单测覆盖。浏览器侧对有效链接与失效链接两态各做了一次真实渲染与截图。

`SharePage` 没有单测，按 tasks 5.9 允许的分支改用 e2e 实测代替：这一页是纯渲染 + 一次 fetch，单测只能验形状，而本项目 rstest 对 `.tsx` 支持有限（同类问题在 `api.ts` 的泛型箭头上已经踩过）。浏览器两态各一次真实渲染 + 截图的覆盖强度高于形状断言。

未覆盖风险 10 条已逐条列明，其中第 4 条（`WEB_ASSET_DIR` 必须含 web-core 运行时）是上线前必须确认的前提，第 1 条（微信卡片）是明确的本期不做项。测试数据已全部清理（users / auth_sessions / guide_drafts / guide_shares / photos 均为 0），存量数据量与此前一致（trips 9 / collections 3 / footprints 4 / track_events 10 / fact_feedbacks 33）。
