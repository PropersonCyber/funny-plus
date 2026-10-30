# Funny+ · 趣哪玩儿 · H5 骨架

PRD 见会话内链接（V1.0）。首期只做 P0 的可运行闭环：填需求 → 2–3 套方案对比 → 结构化逐日行程/预算 → 局部修改 + 变更影响 → 规则校验 → 保存。

视觉参考：`docs/promo.png`（宣传稿，非当前界面截图）；新 UI 基准图在 `docs/prototype/`。

## 多端：Lynx

跨端走 [Lynx](https://lynxjs.org/zh/)（ReactLynx）：一份 UI 代码同时产出 iOS / Android / Web，并且直接复用 `web/src` 的确定性引擎（`planner` / `budget` / `validate` 是纯 TS，不依赖 DOM）。

```bash
npm run lynx:dev     # rspeedy dev server（终端出 URL / 二维码）
npm run lynx:build   # 产出 dist/main.lynx.bundle（原生）与 main.web.bundle（Web）
```

预览：把 dev server 打印的 bundle URL 粘进 **Lynx Explorer**（预置沙盒 App，已装进本机 iOS 模拟器，bundle id `com.lynx.LynxExplorer`）。上线时按官方 `integrate-with-existing-apps` 把 LynxView 嵌进原生壳。

视觉与资源按 `docs/proto.png` 与 `docs/materials/` 实现：首页 / 行程 / 地图 / 避坑 / 我的 五栏。地图、避坑、我的目前是「未实现」占位，不放假界面。

## 跑起来

```bash
cd web && npm i
npm run dev        # http://localhost:5273（根目录直接跑也行）
npm run build      # vue-tsc + vite build
```

避坑信息与反馈都需要后端（Postgres + Hono），方案见 `docs/backend.md`：

```bash
cp server/.env.example server/.env
npm run dev:db     # 起 Postgres（docker，宿主端口 5434）
npm --prefix server i
npm --prefix server run db:migrate   # 建表（迁移文件在 server/drizzle/）
npm --prefix server run db:seed      # 读 data/*.json 灌地点与避坑数据，幂等
npm run dev:api    # http://127.0.0.1:8787
```

看完整形态：任一页面加 `?demo=1`（例如 `http://<你的IP>:5273/?demo=1`），会切到测试账号 `demo-user`，
用它预置的 6 条行程（正常 / 超预算 / 8 人大团 / 时间冲突 / 空天 / 单人）和已提交的反馈看各种界面状态；`?demo=0` 关掉。

前端只认相对路径 `/api`，开发时由 Vite 代理转到 8787（`web/vite.config.ts`）。后端没起时避坑页显示「避坑信息暂时取不到」，反馈按钮显示「反馈暂不可用」，都不会假装 0 条。

## 目录

三个工程 + 共享文档：

```
web/     Vue3 + Vite 的 H5（下面的命令都在这里或根目录转发）
  src/
    api/planner.ts      # 「AI 规划模块」边界：现在确定性生成，接真模型只换这个文件
    api/catalog.ts      # 地点池 / 避坑目录接口客户端（数据都在服务端）
    api/feedback.ts     # 避坑反馈接口客户端
    lib/budget.ts       # 费用模型（PRD 4.4），常数集中可替换成真实价格
    lib/validate.ts     # 路线/时间/人数/预算的确定性校验（PRD 六：程序负责验证）
    lib/facts.ts        # 避坑展示规则：可信状态标签、过期判断
    lib/placeIndex.ts   # 地点索引（启动时由 /api/places 预热）+ 直线距离折算耗时
    stores/trip.ts      # 已保存行程，localStorage 持久化
    stores/draft.ts     # 生成中方案，仅内存
    views/              # 发现 / 创建 / 对比 / 行程 / 路线 / 避坑 / 我的
lynx/    ReactLynx 跨端 UI（src/pages 下按 proto 实现，逻辑 import ../web/src）
server/  Hono + Postgres（Drizzle）：地点池 + 避坑目录 + 反馈；明细见 docs/backend.md
data/    种子数据（places / facts / feedbacks 的 JSON），seed 脚本读它们写库
docs/    产品方案、proto.png、materials（图标/token）、品牌素材
```


## 已知边界（故意没做）

- **没有 AI 后端**：AI 生成是确定性模板，不是真模型调用；保存只在本机 localStorage。
- **后端只做数据**：避坑目录（`GET /api/facts`）与匿名反馈（`POST /api/facts/feedback`，按浏览器 clientId 去重）。反馈只做计数，**暂不影响可信状态**（加权规则未定）。
- **只接了两个目的地**（重庆、成都）。填其它城市会明确报不支持，不编数据。
- **地图是 SVG 示意**：按经纬度归一化 + 顺序编号，没有真实底图与路网。路线耗时 = 直线距离折算，不是导航结果。
- **局部修改只认 4 类意图**（轻松/省钱/换景点/建议词），识别不了会直说，不会硬猜。
- 预约提醒、足迹徽章、多人协作、交易跳转（P1/P2）未实现。
- 避坑的「反馈入口」未做，因为需要后端存反馈。

## 接真后端时的改动点

| 现在 | 换成 |
| --- | --- |
| `api/planner.ts` 的 `generatePlans` | `POST /ai/plans`，返回同结构 `Plan[]` |
| `revisePlan` | `POST /ai/plans/:id/revise`，`impact` 由后端算 |
| `stores/trip.ts` localStorage | 行程 CRUD + `TripVersion` |
| `lib/placeIndex.ts` `travelMinutes` | 地图服务路线 API |
| `data/places.ts` | ✅ 已落库：`places` 表 + `GET /api/places`，前端启动时预热 |
| `data/facts.ts` | ✅ 已落库：`facts` 表 + `GET /api/facts` |
