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
  engine/placeIndex.ts  地点索引（由 /api/places 预热）+ 直线距离折算耗时
  engine/facts.ts       避坑展示规则：可信状态标签、过期判断
  api/                  地点 / 避坑 / 行程 / 反馈的接口客户端（含演示模式开关）
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

## 已知边界（故意没做）

- **没有 AI 后端**：方案生成仍是确定性模板，不是真模型调用。
- **后端只做数据**：地点池、避坑目录、匿名反馈（按 clientId 去重）。反馈只做计数，**暂不影响可信状态**（加权规则未定）。
- **行程只存本机**：`lynx` 侧目前是内存态，刷新回默认行程；服务端的示例行程是只读的。
- **只接了两个目的地**（重庆、成都），A 版只开放 1–2 天。填其它城市明确报不支持，不编数据。
- **地图是 SVG 示意**：按经纬度归一化 + 顺序编号，没有真实底图；路线耗时 = 直线距离折算，不是导航结果。
- **局部修改只认 4 类意图**（轻松/省钱/换景点/建议词），识别不了会直说。
- 预约提醒、足迹徽章、多人协作、交易跳转（P1/P2）未实现。

## 接真后端时的改动点

| 现在 | 换成 |
| --- | --- |
| `shared/engine/planner.ts` `generatePlans` | `POST /ai/plans`，返回同结构 `Plan[]` |
| `revisePlan` | `POST /ai/plans/:id/revise`，`impact` 由后端算 |
| lynx 内存态行程 | 行程 CRUD + `TripVersion` |
| `shared/engine/placeIndex.ts` `travelMinutes` | 地图服务路线 API |
| `lynx/src/{places,facts}.ts` 本地副本 | ✅ 服务端已有 `GET /api/places`、`GET /api/facts`，接上后即可删副本 |
