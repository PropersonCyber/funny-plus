# 趣哪玩儿 iOS UI Starter Asset Kit

这是第一版可落地的基础资源包，包含可编辑矢量图标、品牌符号、吉祥物基础矢量稿、地图标记、路线装饰、设计 Token 和五栏 Tab Bar 规范。

## 目录
- `brand/`：App 图标符号、可编辑吉祥物基础 SVG
- `icons/`：通用线性图标 SVG
- `illustrations/`：地图 Pin、路线装饰
- `tokens/`：设计 Token JSON / CSS
- `components/`：Tab Bar 配置

## iOS 适配建议
- 页面遵循 Safe Area，不把状态栏和 Home Indicator 区域当作内容区。
- 使用原生导航栏行为；根页面不重复放置品牌标题和个人中心按钮。
- 底部采用五个 Tab：首页、地图、行程、避坑、我的。
- Tab Bar 建议使用系统材质背景，图标约 22–24pt，标题约 10–11pt。
- 弹层优先使用原生 Sheet 交互：支持下拉关闭、顶部 Grabber、系统圆角与安全区。
- 字体优先使用 SF Pro + PingFang SC；动态字体应支持 Dynamic Type。
- 图标 SVG 使用 `currentColor`，导入 Xcode 前可转为 PDF Vector，或使用 SwiftUI Shape / asset catalog。

## 品牌与视觉规范
主色：`#2478F2`；辅助青色：`#35C7E8`；背景：`#F5F8FF`；主文字：`#172B4D`。
视觉关键词：清爽蓝白、轻科技、旅行探索、友好吉祥物、柔和卡片。

## 重要说明
本包是可供开发启动的基础矢量与规范资源，不等于完整商业插画库。地图底图、成都/重庆/大理景点摄影或动漫场景图、吉祥物多姿态透明 PNG，仍需按最终页面逐张制作并核对版权/地图服务授权。效果展示图中的小字和示意数据不能直接当作真实业务数据。
