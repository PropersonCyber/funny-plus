# Funny+ · 趣哪玩儿

把「想出去玩」变成一份能编辑、能校验、能直接执行的旅行计划：结构化行程 + 可追溯的预算与避坑信息。
首期只做 P0 闭环：填需求 → 2–3 套方案对比 → 逐日行程/预算 → 局部修改 + 变更影响 → 规则校验 → 保存。

视觉参考：`docs/promo.png`（宣传稿）、`docs/prototype/`（新 UI 基准图）、`docs/proto.png`（五栏原型）。
这几张设计基准图不进仓（见 `.gitignore`），只在本机保留；拉新仓没图不影响代码。

## 结构

新 UI 只有一份：`lynx/`（ReactLynx），一份代码出 iOS / Android / Web。旧的 Vue H5（原 `web/`）已下线。

```
shared/   两端共用的纯 TS，不依赖 DOM
  engine/planner.ts     「AI 规划模块」边界：现在确定性生成，接真模型只换这个文件
  engine/budget.ts      费用模型（PRD 4.4），常数集中可替换成真实价格
  engine/validate.ts    路线/时间/人数/预算的确定性校验（PRD 六：程序负责验证）
  engine/placeIndex.ts  地点索引（由 /api/content 的 places 覆盖随包副本）+ 直线距离折算耗时
  engine/facts.ts       避坑展示规则：可信状态标签、过期判断与过期计数
  types/index.ts        领域模型
lynx/     ReactLynx 跨端 UI（src/pages 按 proto 实现，逻辑全部 import ../../shared）
server/   Hono + Postgres（Drizzle）：地点池 + 避坑目录 + 反馈 + 只读示例行程
data/     种子数据（places / facts / feedbacks 的 JSON），seed 脚本读它们写库
docs/     产品方案与设计资源
```

## 跑起来

```bash
npm --prefix lynx i
npm run dev          # rspeedy dev server，默认 3001
npm run build:ios    # 出包并同步进 iOS 壳；只跑 build 不会更新 App 里的界面
npm run build:android # 出 android/build/funny-plus.apk（安卓壳，见 android/README.md）

cp server/.env.example server/.env
npm run dev:db       # 起 Postgres（docker，宿主端口 5434）
npm --prefix server i
npm run db:migrate   # 建表（迁移文件在 server/drizzle/）
npm run db:seed      # 读 data/*.json 灌地点 / 避坑 / 示例行程，幂等
npm run dev:api      # http://127.0.0.1:8787
```

- **Web 预览**：`http://<你的IP>:3001/__web_preview?casename=main.web.bundle`
- **iOS 模拟器**：把 `http://<你的IP>:3001/main.lynx.bundle?fullscreen=true` 粘进 **Lynx Explorer**（bundle id `com.lynx.LynxExplorer`）

演示数据：加 `?demo=1` 会切到测试账号 `demo-user`，用它预置的 6 条行程（正常 / 超预算 / 8 人大团 / 时间冲突 / 空天 / 单人）和已提交的反馈看各种界面状态；`?demo=0` 关掉。

> **注意**：`?demo=1` 这套是旧 H5（已下线的 `web/`）的入口，当前 Lynx 客户端**不读这个参数**，
> 那 6 条行程只留在种子数据里供服务端接口用。要看各种界面状态请在「我的」里切换行程。

## 已知边界（故意没做）

- **AI 只负责听懂，不负责算数**：对话与意图解析走 `/api/ai/chat`（AI SDK + ops-gateway），模型补需求、挑地点、交用户原话；预算、时刻、校验全部由 `shared/engine` 算，模型不产出数字。对话生成的方案会落成真实行程，改天走「预览 → 确认」再写回，取消时原方案一个字段都不改。未配置 `AI_API_KEY` 时接口 503，界面明说不可用。
- **表单主链路走「模型提案 + 引擎裁决」**：`PlanSheet` 先打 `POST /api/ai/plans`，模型只在已收录地点里挑走法与顺序，时间/预算/校验仍由 `shared/engine` 算。服务端不可用、超时、模型没配一律无损落回本地 `planFor`，产出与旧版完全一致。
- **后端只做数据与账号**：地点池、避坑目录、反馈、短信登录、行程/回忆/攻略草稿同步、照片。反馈与有效期会按 `server/src/data/trustRules.ts` 的阈值降一档可信度并在界面写明原因；补录在同一字段有 2 个独立设备一致时填进空缺列，但**不升 `trust`**、不覆盖已有值。
- **本机优先、云端补齐**：行程/回忆/攻略草稿写本机后推云端，登录时补推 + 拉回合并；本机写不进去会明确提示「刷新会丢」。云端写失败有独立状态文案，不会假装同步成功。
- **接了三个城市**（重庆、成都、北京），只开放 1–2 天。填其它城市明确报不支持，不编数据。
- **可信状态两档**：34 个地点已用高德 POI 全量核验（`scripts/verify-amap.ts`，营业时间取最保守交集、原文存 `openText`），标 `credible`；解放碑 / 春熙路 / 王府井大街高德无营业时间，只核了坐标，仍 `pending`。**票价一律 `null`**（高德不提供门票价，见 `docs/backend.md` 第八节），界面显示「暂无票价」，预算提示「N 个景点未核实」。
- **随包副本不冒充已核验**：客户端先用 `data/*.json` 渲染、接口回来再覆盖。快照里的 `official` 会经 `displayTrust()` 降一档显示，并标注「随包快照 · 未与服务端核对」。
- **地图是 2D 静态图**：底图走高德静态图（服务端透传，key 不下发；取不到就退回插画），路线用真实的驾车/步行折线，缺段退回两点直连虚线并在里程前加「约」。没有 3D，也不做地图内搜索。
- **局部修改是「模型解析 + 引擎执行」**：模型只产出动作（删点/换点/重排/定向放松），时间与费用由引擎重算，前端先出预览再确认；模型不可用时降级到引擎的关键词识别，仍认不出就直说，不静默改。支持时段粒度：「第二天下午轻松点」只动下午（`ReviseOp.ease`）。被用户固定的安排不会被删或换。
- 预约提醒、足迹徽章、多人协作、交易跳转（P1/P2）未实现。

## 还没做（按是否阻塞分）

| 缺口 | 状态 |
| --- | --- |
| 首页咕噜迎接 + 当前旅行卡 | ✅ 已做：主 CTA 直接进助理（自然语言），表单仍在「行程规划」快捷格；有行程时显示旅行卡并可「继续调整」 |
| 半天 / 几小时的轻量规划 | ✅ 已做：`Demand.hours` + `startMin` 走 `generateLightPlan`（单日、从指定时刻起算、到点就停、不计住宿）；表单有「时长」行 |
| 旅行日期 / 时间范围 | ✅ 已做：`dateFrom` 全链路（表单 → 落库 → 引擎）。`dateTo` 无独立入口，区间由 `dateFrom + dayCount` 推出 |
| 季节性营业时间 | ✅ 已做：`Place.seasons`（人工摘录，不从 `openText` 正则解析）；日期已知才按季节取档 |
| 固定安排（pin）不被静默改掉 | ✅ 已做：行程页每条安排有「固定」开关，引擎遇到 pinned 拒绝 drop / replace 并说明原因 |
| 「第二天下午轻松点」只动下午 | ✅ 已做：`ReviseOp.ease` 带 `window`，只删该时段的景点 |
| 现场推荐与到达判定、下一站 | ⚠️ 判定逻辑与工具已做（`shared/engine/onSite.ts`：到达半径 + 精度阈值、下一站、附近检索），行程页每条景点有「我在这附近 / 下一站」入口。**数据仍缺**：吃/拍/买 0 条、城市公交 0 条，所以只答「有什么避坑/怎么进出」，不编附近餐厅或地铁班次 |
| 微信 / Apple 登录 | ⚠️ 代码已通，差凭证：`/api/auth/login` 真接微信 unionid 兑换与 Apple identityToken 验签（含 aud/iss/exp/alg 校验）；`/api/auth/sms-code` 真接阿里云短信。三者都需要在 `.env` 配 `SMS_*` / `WECHAT_*` / `APPLE_CLIENT_ID`，未配置时如实 501/503，不再假装发出短信 |
| 回忆的 AI 叙述整理 | ✅ 已做：`POST /api/ai/memory-narrative`，模型只改写用户写过的内容，每段必须挂靠一条真实记录（`applyNarrative` 剪枝），不可用则落回确定性草稿 |
| 分享「更新发布」保持链接 | ✅ 已做：同一草稿再发布会刷新快照、token 不变，草稿页有「更新已发布内容」 |
| 攻略照片由用户勾选 | ✅ 已做：默认一张不带，草稿页从回忆里逐张勾选 |
| 回忆回顾用模型生成草稿 | 未做；结束旅行时按已有记录做**确定性**整理（`lynx/src/memoryDraft.ts`），不调模型 |
| 对话回归集（`server/src/ai/eval/`） | ✅ 已做：6 类用例 + `npm run eval:chat`（先起 `dev:api`），支持 `--save` / `--baseline` |
| 反馈影响 trust、补录生效、过期复核 | ✅ 已做：阈值集中在 `server/src/data/trustRules.ts`，反馈/过期降一档并写 `trustNote`，补录 2 个独立设备一致时填空缺列且不升 trust |

## 接真后端时的改动点

| 现在 | 换成 |
| --- | --- |
| `shared/engine/planner.ts` `generatePlans` | ✅ 表单已接 `POST /api/ai/plans`：模型只给地点顺序，引擎算时刻与预算；失败无损落回本地 |
| `revisePlan` | ✅ 已接 `POST /api/ai/revise`，`impact` 由服务端算 |
| 本机 `storage.ts` 多行程 | ✅ 已接 `PUT /api/trips/:id` + `GET /api/trips`，登录后补推与拉回 |
| `shared/engine/placeIndex.ts` `travelMinutes` | ✅ 已接 `/api/geo/direction`，拿不到的段退回直线折算 |
| `data/places.json` 里的 `trust: pending` | 逐条核验后填 `verifiedAt` 与 `official`/`credible` |
| `lynx/src/{places,facts}.ts` 本地副本 | ✅ 服务端已有 `GET /api/places`、`GET /api/facts`；副本只留作离线兜底并标来路 |
