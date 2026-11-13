# lynx/ — 跨端 UI（ReactLynx）

按 `docs/proto.png` 实现，一份代码出 iOS / Android / Web。**业务逻辑不在这里重写**：`planner` / `budget` / `validate` / `places` 全部来自 `shared/engine`（纯 TS，无 DOM 依赖）。

## 目录与样式约定

一个模块 = 一个文件夹，`index.tsx` + `index.module.scss` 成对出现：

```
src/
├── index.tsx                 # 入口，只挂 App
├── App/{index.tsx,index.module.scss}      # 外壳：根布局 + tab 栏 + 子页路由
├── pages/
│   ├── HomePage/{index.tsx,index.module.scss}
│   ├── MapPage/…  ItineraryPage/…  GuidePage/…  ProfilePage/…
│   ├── PlanSheet/…  AdvicePage/…  TripDetailPage/…  AssistantPage/…
└── styles/base.scss          # 跨模块共享的原子样式（普通 CSS，不哈希）
```

规则：
- **页面样式走 CSS Modules**（`index.module.scss`）：类名会被哈希，页面之间不会再撞名。模块里只放本页面用的类。
- **只有被两个及以上页面用到的原子类**（`.card` / `.chip` / `.btn-*` / `.page` / `.section-head` …）才放 `styles/base.scss`，它是全局 CSS，任何页面直接写类名即可。
- TSX 里统一用 `cls('a b')` 拼类名：本模块有的类自动换成哈希名，`base.scss` 里的原样透出。
- 样式统一 SCSS（`@rsbuild/plugin-sass` + `sass`），编译后仍是普通 CSS；Lynx 不支持的属性不要写。
- `npm run check:css`（已挂在 `build` 前置）会做两件事：① tsx 引用的 class 必须都能在样式里找到；② 页面用到的类不许只定义在**别的页面**的模块里（那会被哈希成另一个名字，样式静默丢失）。

## 页面

| Tab | 状态 |
| --- | --- |
| 首页 | 搜索条 / Hero + 吉祥物 / 4 快捷入口 / 热门推荐（含起价）/ 最近计划 |
| 地图 | 高德静态底图（未配 key / 无地点时退回插画）+ 当天真实折线 + 里程胶囊；行程路线 / 景点列表 / 推荐玩法 三视图；Day 切换；不做 3D |
| 行程 | 时间轴（含抵达入住、餐）+ 方案切换 + Day 切换 + 预算依据；底部「查看地图 / AI 调整行程」 |
| 避坑 | 四个分类 + 重要/正常/提醒徽标 + 来源与核验日期 + 页尾横幅与吉祥物 |
| 我的 | 头像等级 + 三项统计 + 会员横幅 + 菜单 + 关于 |

子页（不进 tab）：`智能建议`（首页快捷入口）、`行程详情`（行程页「详情」）、`AI 助手`（行程页「AI 调整行程」）。

规划入口是底部 Sheet（城市 / 天数 / 人数 / 预算），提交后调用 `generatePlans` 并跳到行程页。

## 跑起来

```bash
npm install
npm run dev     # 同时产出 lynx 与 web bundle
npm run build
```

终端会打印 `main.lynx.bundle`（原生）、`main.web.bundle`（Web）和 `__web_preview`（浏览器预览）。

原生预览：LynxExplorer 已装进本机模拟器（`com.lynx.LynxExplorer`），打开方式：

```bash
xcrun simctl openurl <UDID> "lynx://open?url=<URL 编码后的 bundle 地址>?fullscreen=true"
```

## mock 数据

`src/mock.ts` 集中放设计稿里的展示数据：城市起价、天气、最近计划、推荐玩法、行程详情摘要、预算占比、
会员与收藏统计、AI 助手对话。页面上凡是示例数据都带一行 9px 灰字说明，接真数据只改这一个文件。

## 素材来源与生成策略

**已有素材优先，不重复生成**：

| 来源 | 内容 |
| --- | --- |
| `docs/materials/icons/*.svg` | 全部线性图标（tab 与功能图标），运行时内联成 `<svg content>` |
| `docs/materials/brand/*.svg` | App 图标符号、吉祥物矢量基础稿 |
| `lynx/src/assets/gen/*.jpg` | 已有插画：chengdu / chongqing / jinli / panda / chunxi / dufu / map（原 `web/public/img` 已随旧 H5 下线迁到这里） |

**只在缺素材时用 `gpt-image-2.5-flare` 补**，风格锚定已提供插画（饱满动漫插画 + 暖灯笼光 + 蓝天）：

| 生成的文件 | 为什么缺 |
| --- | --- |
| `gen/hero.jpg` | 首页 Hero 插画，素材包里没有独立文件 |
| `gen/dali.jpg` | 大理城市卡（该城市暂无地点数据，仅视觉占位） |
| `gen/spot-kuanzhai.jpg` / `gen/spot-wuhou.jpg` | 宽窄巷子、武侯祠没有现成图 |
| `ip/mascot-{start,explore,checkin}.png` | 设计稿要求 5 个姿态（出发/探索/打卡），矢量稿只给了基础站姿 |
| `ip/marker-{start,end,done}.png` | 地图起点/终点/已抵达标记 |

吉祥物与标记用绿幕/品红幕生成后按色相抠图（脚本见 `docs/materials/README.md` 备注），输出 240px 带透明通道 PNG。
换真素材时直接替换同名文件，代码不用改。

## 设计资源

`docs/materials/`（图标 SVG / mascot / token / tab-bar 规范）与 `docs/proto.png`。
图标不打包成 PNG：`src/icon-svg.ts` 由 `docs/materials/icons/*.svg` 生成，运行时用 `<svg content>` 内联并把 `currentColor` 换成对应色值。

## 踩过的坑

| 现象 | 原因 / 解法 |
| --- | --- |
| 图片在原生端全空、Web 正常 | 原生 `<image src>` 不认相对静态路径 → `output.dataUriLimit.image` 调大内联成 data URI |
| `main-thread.js exception: not a function` | 主线程脚本是 ES2019 子集，`String.replaceAll` 不存在，用 `split().join()` |
| 图标显示成一个点 | `<image>` 尺寸不吃 CSS，且位图按原尺寸渲染；改用 `<svg content>` + `style` 显式尺寸 |
| 内容顶到状态栏 | `env(safe-area-inset-top)` 在原生端取不到值，暂时写死 60px，嵌壳后由宿主注入 |
| 深链报 `unsupported_scheme` | 只认 `lynx://open?url=` 这一种形式 |
| 点 tab 没反应 | ① 进了子页后 `route` 没清，切 tab 只改了 `tab`；② `.body` 没设 `min-height:0`，scroll 内容胀出屏幕盖住 tab bar 手势区。两处都修了，tab 项改 `catchtap` |
