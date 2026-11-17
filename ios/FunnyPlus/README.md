# FunnyPlus iOS 壳（趣哪玩儿）

Swift 宿主 + 原生 LynxView，加载随包的 `web/main.lynx.bundle`。业务界面在 `lynx/`，这里只做平台适配。Lynx SDK 仍是 Objective-C，通过 CocoaPods 本地 `vendor/` 引入。

`SceneDelegate` 的根控制器是 `LynxHostController`。旧的 WKWebView 路径还在 `WebHostController`，用来对照，不是当前入口。`LynxHostClient.m` 留在 Objective-C：`LynxViewClient` 的资源加载方法是 required，Swift 实现了它就会把资源请求从 SDK 默认加载里抢走。

## 目录

```
FunnyPlus/
  AppDelegate.swift / SceneDelegate.swift
  LynxHostController.swift   # 原生 LynxView
  HostBridge.swift           # 定位与登录回跳
  FPInputUI.swift            # SDK 没有的 <input>
  FPSVGImageLoader.swift     # data:image/svg+xml
  LynxHostClient.m           # 只接 Lynx 错误回调
  WebHostController.swift    # 旧 Web 运行时，默认不挂
  Info.plist
  Assets.xcassets/
  web/                       # main.lynx.bundle，以及旧 web 运行时产物
```

## 为什么旧 Web 路径用自定义 scheme

`file://` 下 WKWebView 的 `fetch()` 取不到 wasm，Lynx Web 运行时初始化会静默失败（白屏）。
所以用 `app://local/index.html` + `LocalSchemeHandler` 当静态文件服务器，按扩展名返回 MIME（`.wasm` → `application/wasm`）。

`client.js` 里用了 `import.meta`，**必须** `<script type="module">` 加载，否则报 `import.meta is only valid inside modules`。

## 更新产物

```bash
npm run build:ios                              # 出 lynx bundle 并拷进 iOS 壳
cd ios/FunnyPlus
xcodebuild -workspace FunnyPlus.xcworkspace -scheme FunnyPlus \
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
- 当前入口是原生 LynxView，读的是 `main.lynx.bundle`。`WebHostController` 仍能跑旧的 web 运行时，但默认不挂
- iOS 的 SVG 解码只覆盖 `path` / `circle`。图标里的 `<rect>` 在这端不会画出来，这是迁移前就有的限制
