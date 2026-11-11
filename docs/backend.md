# 后端技术方案（第一版定稿）

> 范围：只覆盖「谁提供数据、数据放哪」。AI 生成、对话式修改、地图/路径规划均未开工，见文末待开工清单。
> 代码位置：`server/`（服务端）、`shared/`（两端共用的纯 TS 引擎与数据客户端）。

## 一、选型

| 层 | 选择 | 为什么不选另一个 |
| --- | --- | --- |
| 运行时 | Node 22 + TypeScript，`tsx` 直接跑源码 | 与 `lynx/` 共用 `shared/` 的一份类型；改一行不用等编译 |
| Web 框架 | Hono 4 | 路由 + 中间件够用，`streamSSE` 内置；NestJS 的 DI/模块对两张表是纯样板 |
| 校验 | 手写类型收窄（`typeof x !== 'string'`） | 现在只有 4 个入参字段，上 zod 还早；接 AI 输出时再引 |
| ORM | Drizzle + `drizzle-kit` | SQL 可读、迁移可 diff；Prisma 多一层引擎二进制，镜像更大 |
| 数据库 | Postgres 16（`postgres:16-alpine`） | 不需要 PostGIS / pgvector：地点只是一个平表，路线靠直线距离折算 |
| 缓存/队列 | 无 | 单实例、三张表 |
| 部署 | 单机 Docker Compose（db + api），生产加 Caddy 反代 `/api` | 无状态服务 + 一个库，K8s/Serverless 都换不来收益 |

## 二、目录与职责

```
server/src/
  index.ts          路由挂载 + /api/health（探库，库挂了不能报 ok）
  db/schema.ts      三张表：places、facts、fact_feedbacks
  db/client.ts      pg Pool + drizzle 实例
  db/seed.ts        读 data/*.json 写库，可重复执行
  routes/places.ts  GET /api/places
  routes/facts.ts   GET /api/facts、GET/POST /api/facts/feedback
server/drizzle/     迁移文件（进仓，服务器只跑 migrate）
```

## 三、数据边界

| 数据 | 存放 | 理由 |
| --- | --- | --- |
| 地点 `Place` | **PG**（`places` 表） | 引擎要同步索引 → 前端启动时 `GET /api/places` 预热一次 `placeIndex` |
| 避坑信息 `TravelFact` | **PG**（`facts` 表） | 需要来源/核验时间/有效期这类可追溯字段，且多个端要读 |
| 避坑反馈 | **PG**（`fact_feedbacks` 表） | 匿名计数，靠 `clientId` 去重 |
| 发现层内容（`cities` / `guides` / `plays`） | **PG** | 首页三块 + 两条详情页都读这里；`GET /api/content` 一次拉全 |
| 展示用评分 / 去过人数 | 跟着 `places` / `cities` / `guides` 三张表走 | 运营录入的展示值，**不参与任何计算**，接口原样透出 |
| 种子数据 | 仓库根 `data/*.json` | seed 脚本只读文件写库，代码里不出现业务数据字面量 |
| 预算常数、校验阈值 | `shared/engine/` | 纯函数，可复算可测，服务端暂不需要权威计算 |
| 已保存行程 | 本机（`lynx/src/storage.ts`：宿主桥 / IndexedDB / localStorage 三层降级，含多行程与变更记录） | 产品明确第一版不做账号与云端档案；`/api/trips` 只读 |

原生壳（`lynx/`）启动先用随包副本（`lynx/src/places.ts` / `lynx/src/facts.ts`，源文件仍是 `data/*.json`）渲染，`GET /api/content` 回来后用库里的地点池覆盖（`applyPlaces`）；接口拿不到就继续用副本，不阻塞首屏。避坑仍只读副本。

服务端与前端之间只有**类型单向引用**：`server/src/routes/*.ts` 里 `import type` 指向 `shared/types`，运行时被 `tsx` 抹掉。

## 四、接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/places?city=` | `{ items: Place[] }`，全量返回；`open` 由 `open_start`/`open_end` 两列还原成元组 |
| GET | `/api/health` | `{ ok, db }`，实际执行 `select 1` |
| GET | `/api/facts?city=` | `{ items: TravelFact[] }`，**全量返回不过滤过期**；A2 要求前端显示「已折叠 N 条」，服务端剪掉就数不出来 |
| GET | `/api/facts/feedback?clientId=` | `{ items: FactFeedbackSummary[] }`，聚合计数 + 本设备的反馈 |
| POST | `/api/facts/feedback` | `{ factId, verdict, note?, clientId }` → 201；重复提交 409，factId 不在库里 400 |

字段命名与 `shared/types` 一致（驼峰）。日期列用 PG `date`，drizzle 默认返回 `YYYY-MM-DD` 字符串，和前端 `validUntil` 的字符串比较口径一致，不引入时区。

## 五、迁移策略

`db:push` 已删除，改 `generate → migrate`。push 会按当前 schema 直接改库，部署过一次之后就会丢数据。

```bash
npm --prefix server run db:generate   # 改完 schema.ts 后生成 SQL
npm --prefix server run db:migrate    # 应用到库
npm --prefix server run db:seed       # 读 data/*.json 灌种子数据（幂等）
```

## 六、本地起法

```bash
cp server/.env.example server/.env        # PG_URL / PORT
npm run dev:db                            # docker，宿主端口 5434
npm --prefix server i
npm run db:migrate && npm run db:seed
npm run dev:api                           # http://127.0.0.1:8787
npm run dev                               # lynx 预览，默认 3001
```

## 七、待开工（按依赖排序）

1. **真实模型接入**：`POST /api/ai/plans`，模型只输出 `{ pace, transport, placeIds[] }`，时间轴/预算/校验仍由前端纯函数补齐（地点池从 `places` 表取）
2. 对话式修改（自然语言改行程）：产品标为附加功能，暂缓
3. 地图/路径规划：高德 Web 服务 API + 服务端代理 + 路线缓存，替代 `travelMinutes` 的直线折算
4. 反馈加权影响 `trust`：规则未定，现在只计数

## 八、门票票价的数据来源（已调研，结论：没有现成免费 API）

高德拿不到票价：`biz_ext.cost` 的官方定义是「人均消费」，只有餐饮/酒店/景点/影院类 POI 才有，
且文档标「逐渐废弃」；故宫这类无内部消费的景区实测恒为空。`place/detail` 同样为空。

各通路实测结论（2026-11 核验）：

| 通路 | 结论 |
| --- | --- |
| 携程开放平台 | `open.ctrip.com` 跳联盟 CPS 后台（返佣，不给数据）；`open.trip.com` 的票务菜单是占位，`/ticket/` 404 |
| 美团开放平台 | 已迁到「技术服务合作中心」，原文档中心 500 |
| 阿里云市场 / 聚合数据 | 没有「景点门票」品类，搜「门票」零结果 |
| 景区官网 | 故宫 `ticket.dpm.org.cn` 可稳定取到「旺季 60 / 淡季 40 元 + 物价局批文号」；但颐和园、北京动物园、熊猫基地官网均抓不到，**不可规模化** |
| 北京市公共数据开放平台 | ✅ 有结构化数据集（如「怀柔区景区门票价格」：旅游景点 / 价格(元) / 文件依据），JSON + CSV 接口，但下载与 API 需注册拿 `userKey` |
| 文旅部 | 只有 5A 名录和景区天气，无票价 |

**当前口径**：票价 `null`（未核实），界面「暂无票价」。接入 L2 时只需填 `Place.ticket` +
`source` + `verifiedAt`，界面与预算逻辑不用改。注意故宫页面写明「未授权任何第三方代理门票」，
票价只能展示与预算估算，不能做交易。
