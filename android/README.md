# 安卓壳

和 `ios/FunnyPlus` 共用同一份业务代码，但**渲染器是原生 LynxView**（不是 WebView）。

```
lynx/src/** (+ shared/)  ──rspeedy──▶  main.lynx.bundle  ──▶ iOS LynxView 4.2.0
                                                          └─▶ Android LynxView 4.2.0
```

两端跑同一个引擎版本（iOS 见 `Podfile.lock` 的 `Lynx (4.2.0)`），样式与手势差异才不会变成
「只有安卓不对」。

## 从 WebView 换成 LynxView 的原因

旧实现是 `WebView` 加载 `main.web.bundle` + `@lynx-js/web-core`。能跑，但：

| 能力 | 原生 Lynx | Web 渲染 |
|---|---|---|
| Native Modules | ✅ | ❌ 不存在 |
| Custom Element | ✅ | 受限降级 |
| 写请求（收藏/打卡） | ✅ | ❌ WebView 不把 POST body 交给 `shouldInterceptRequest` |

定位当时只能靠往 DOM 塞 `globalProps` 字符串，没有回调也没有错误码。要在 MVP 里接
系统能力（定位/照片/分享/推送），必须落在 Native Modules 上，所以先把引擎对齐。

## 构建

```bash
npm run build          # 出 lynx/dist/main.lynx.bundle
./android/build.sh     # 出 android/app/build/outputs/apk/debug/app-debug.apk
```

指向局域网后端（真机调试）：

```bash
./android/build.sh --api http://192.168.1.5:8787
```

不传就是 `http://10.0.2.2:8787` —— 模拟器里 `127.0.0.1` 是它自己，`10.0.2.2` 才是宿主机。

### 环境依赖

| 依赖 | 默认位置 | 说明 |
|---|---|---|
| JDK 17 | `~/android-dev/jdk-17.0.21+9/Contents/Home` | AGP 8.x 要求；`local.properties` 的 `org.gradle.java.home` 也指向它 |
| Android SDK | `~/android-dev/sdk` | 需 `platforms/android-34`、`build-tools/34.0.0` |
| Gradle 8.7 | 由 `gradlew` 自动下载 | 首次构建会拉 ~130MB distribution |

`android/local.properties`（不进仓）需要写本机路径：

```properties
sdk.dir=/Users/<you>/android-dev/sdk
org.gradle.java.home=/Users/<you>/android-dev/jdk-17.0.21+9/Contents/Home
```

## 结构

```
android/
├── build.sh                     # 同步 bundle + 调 gradlew
├── settings.gradle              # 仓库与插件来源
├── build.gradle                 # AGP 版本
├── gradlew / gradle/wrapper/    # Gradle wrapper（8.7）
└── app/
    ├── build.gradle             # 依赖：lynx / xelement / servalsvg / fresco
    └── src/main/
        ├── AndroidManifest.xml
        ├── assets/web/main.lynx.bundle   # 构建期从 lynx/dist 复制
        ├── res/                          # 图标与主题
        └── kotlin/com/maka/funnyplus/
            ├── FPApplication.kt          # LynxEnv + Fresco(含SVG解码) + ImageService
            ├── FPSvgDecoder.kt           # 给 Fresco 补 SVG 解码（图标是 data:image/svg+xml）
            └── MainActivity.kt           # LynxView 宿主 + 定位注入
```

## 三个容易踩的点

**1. 元素集合要挂三份。** `BuiltInBehavior` 只有 view/text/scroll-view/list 等 12 种，
`image` 在 `BuiltInUIRegistry` 里，`svg`/`input`/`video` 在 `XElementBehaviors` 里。
少任何一份都会 `603 Can't find ui tag`，最后 `9902` 崩在 image。

**2. SVG 要挂在 Fresco 的解码层。** `LynxView.setImageInterceptor` 在 `LynxTemplateRender`
或 `LynxContext` 还没建好时会**静默丢弃**（内部 null 直接 return）。我们的图标全是
`data:image/svg+xml`，Fresco 默认不认，所以走 `ImageDecoderConfig.addDecodingCapability`
在 `Application.onCreate` 注册，绕开时序。

**3. bundle 不能是 dev 构建。** dev 包内嵌 HMR 的 `webpack-dev-transport`，会去连
`10.8.206.250:3000` 并在日志里刷 `code=201 WebSocket is not found`。发布前确认
`strings lynx/dist/main.lynx.bundle | grep -c webpack-dev-transport` 为 0。
