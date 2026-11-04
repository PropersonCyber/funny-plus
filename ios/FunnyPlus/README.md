# FunnyPlus iOS 壳（趣哪玩儿）

WKWebView 壳 + 内置 Lynx Web 运行时（`@lynx-js/web-core` 预构建静态包），把 `lynx/dist/main.web.bundle` 当离线资源跑。不依赖 Lynx 原生 SDK，也不需要 CocoaPods。

## 目录

```
FunnyPlus/
  main.m                 # SceneDelegate + WKWebView + app:// scheme handler
  Info.plist             # 显示名「趣哪玩儿」、UIScene 配置、ATS 放开
  Assets.xcassets/       # AppIcon（单尺寸 1024）
  web/                   # 构建产物：index.html + static/ + main.web.bundle
```

## 为什么用自定义 scheme

`file://` 下 WKWebView 的 `fetch()` 取不到 wasm，Lynx Web 运行时初始化会静默失败（白屏）。
所以用 `app://local/index.html` + `LocalSchemeHandler` 当静态文件服务器，按扩展名返回 MIME（`.wasm` → `application/wasm`）。

`client.js` 里用了 `import.meta`，**必须** `<script type="module">` 加载，否则报 `import.meta is only valid inside modules`。

## 更新产物

```bash
npm run build:ios                              # 出包并同步进 iOS 壳（漏了这一步，App 里还是旧页面）
# 等价于：npm --prefix lynx run build && cp lynx/dist/main.web.bundle ios/FunnyPlus/FunnyPlus/web/
# web 运行时快照不进仓，从依赖包里同步（升 @lynx-js/web-core 版本后也要重跑）
rsync -a --delete lynx/node_modules/@lynx-js/web-core/dist/client_prod/static ios/FunnyPlus/FunnyPlus/web/
cd ios/FunnyPlus
xcodebuild -project FunnyPlus.xcodeproj -scheme FunnyPlus \
  -configuration Release -sdk iphoneos -derivedDataPath /tmp/dd CODE_SIGNING_ALLOWED=NO build
```

## 打包 ipa

```bash
rm -rf /tmp/ipa && mkdir -p /tmp/ipa/Payload
cp -R /tmp/dd/Build/Products/Release-iphoneos/FunnyPlus.app /tmp/ipa/Payload/
cd /tmp/ipa && zip -qry ~/Downloads/趣哪玩儿-0.1.0-unsigned.ipa Payload
```

产出是**未签名**包，装真机需要用你自己的 Apple ID 重签：

- **Sideloadly / AltStore / SideStore**：拖入 ipa，填 Apple ID，自动重签安装（免费账号 7 天有效期）
- 或 `ios-deploy` / Xcode 直接跑工程（需在 Signing & Capabilities 选自己的 Team）

## 已知限制

- 未签名 ipa 不能直接双击安装，必须重签
- Bundle 内所有图片是 data URI 内联，`main.web.bundle` 5.4MB；要减体积得调 `lynx.config.ts` 的 `output.dataUriLimit.image` 改成外链资源
- 这是 web 运行时（WKWebView），不是原生 Lynx 渲染；要原生得回到 Lynx iOS SDK 源码编译路线
