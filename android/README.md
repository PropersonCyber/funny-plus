# 安卓壳

和 `ios/FunnyPlus` 是同一个思路：不重写界面，用 WebView 加载 `lynx` 打出来的 `main.web.bundle`。
两端共用同一份 web 运行时，界面只有一处实现。

```
android/
├── build.sh                     # 一条命令出 APK
├── app/
│   ├── AndroidManifest.xml
│   ├── res/mipmap-*/            # 应用图标（由 iOS 的 AppIcon-1024 缩放而来）
│   └── src/com/maka/funnyplus/
│       ├── MainActivity.java    # WebView 宿主
│       └── BuildConfig.java.tpl # 后端地址占位，构建时替换
└── build/funny-plus.apk         # 产物（.gitignore，不进仓）
```

## 构建

```bash
npm run build          # 先出 lynx/dist/main.web.bundle
./android/build.sh     # 出 android/build/funny-plus.apk
```

要指向局域网的后端（真机调试用）：

```bash
./android/build.sh --api http://192.168.1.5:8787
```

不传就是 `http://127.0.0.1:8787`（本机后端，真机上连不通）。

### 环境依赖

脚本不依赖 Gradle，直接调 SDK 里的 `aapt2` / `d8` / `apksigner`。需要：

| 依赖 | 默认位置 | 说明 |
|---|---|---|
| JDK 17 | `~/android-dev/jdk-17.0.21+9/Contents/Home` | 可用 `JAVA_HOME` 覆盖 |
| Android SDK | `~/android-dev/sdk` | 可用 `ANDROID_HOME` 覆盖 |
| build-tools 34.0.0 | `$ANDROID_HOME/build-tools/34.0.0` | |
| platform android-34 | `$ANDROID_HOME/platforms/android-34` | 提供 `android.jar` |

从零装（无 Homebrew 时的做法）：

```bash
mkdir -p ~/android-dev && cd ~/android-dev

# JDK（清华镜像比 GitHub release 快一个数量级）
curl -L -o jdk.tar.gz "https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/aarch64/mac/OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.21_9.tar.gz"
tar xzf jdk.tar.gz

# cmdline-tools
curl -L -o cmdline-tools.zip "https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip"
mkdir -p sdk/cmdline-tools && unzip -q cmdline-tools.zip -d sdk/cmdline-tools
mv sdk/cmdline-tools/cmdline-tools sdk/cmdline-tools/latest

export JAVA_HOME="$HOME/android-dev/jdk-17.0.21+9/Contents/Home"
export ANDROID_HOME="$HOME/android-dev/sdk"
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
  "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

## 为什么这么实现

**不用 `file://` 加载页面。** 在 `file://` 下业务 JS 里的 `fetch` 会被当成不透明源，wasm 也加载不了。
安卓没有 iOS 的 `WKURLSchemeHandler`，所以把 assets 挂到 `https://appassets.androidplatform.net/assets/`——
和官方 `WebViewAssetLoader` 同一个域名和思路，但不引 androidx 依赖。页面因此拿到一个正常的安全源，
`fetch` / `wasm` / `localStorage` 全部可用。

**`/api/*` 由原生转发**（`proxyApi`），页面里始终是同源请求，省掉 CORS 和混合内容限制。
但只转发 GET：`WebView` 不把 POST 的请求体交给 `shouldInterceptRequest`，硬转发会变成空 body。
所以写操作（收藏 / 打卡）在壳里会拿到 405，前端照实弹「网络不通，收藏没存上」——
不会出现「界面显示已收藏但其实没写进去」这种假成功。

**返回键是「再按一次退出」**。业务 JS 跑在 Web Worker 里（Lynx web 运行时的工作线程），
原生在主线程的 `window` 上问不到「现在是不是在详情页」，单页应用也没有 WebView 历史可退。
与其让一次误按就把应用退到桌面、看起来像崩了，不如用安卓标准的两次确认。

## 分发给别人安装

产物是一个已签名的 debug APK，可以直接发给安卓手机装。注意事项：

1. **必须允许「未知来源」**。微信/QQ 传过去后，点开会提示来源未知，
   要在「设置 → 应用 → 特殊权限 → 安装未知应用」里给对应 App 放行。
2. **签名固定**。`android/keystore/funny.jks`（口令 `funnyplus`）不进仓但必须留在本机。
   换 key 会导致已装的包无法覆盖升级，只能先卸载。
3. **没有后端也能用**。App 冷启动用随包种子数据（`data/*.json`），
   城市 / 攻略 / 玩法 / 行程引擎都在本地，断网可浏览和生成行程。
   只有收藏和打卡需要后端，连不上就提示网络不通。
4. **系统 WebView 要够新**。跑的是 `lynx` 的 web 运行时（Chromium 内核 + wasm），
   太旧的安卓机（WebView < 100）可能白屏。实测 Android 13 / WebView 101 正常。

## 已验证

在 Android 13（API 33）arm64 模拟器上实测通过：

- 安装、启动正常，首页、热门推荐详情、我的 三个界面均正常渲染
- IP 形象、景点图、底部 tab 全部显示正确
- 返回键弹「再按一次退出」，不会一次误按就退出
- `client.js` 从虚拟域加载成功，无白屏
