# iOS 资源

给后续原生壳工程（LynxView）用的品牌资源与配置口径。**这里只有资源，没有 Xcode 工程**。

## 图标

| 文件 | 用途 |
| --- | --- |
| `AppIcon/AppIcon-1024.png` | 中文主图标（趣哪玩儿），**默认用这张** |
| `AppIcon/AppIcon-1024-en.png` | 英文备选（funny-plus） |
| `AppIcon/AppIcon.appiconset/` | Xcode 资源集，整个目录拖进 `Assets.xcassets` 即可 |

处理口径（`docs/brand/*.png` 原稿不满足 App Store 要求，这里是加工后的版本）：

- 原稿 1254×1254 且**自带圆角 + 外圈白边**，直接当 AppIcon 会被系统二次裁切、四角露白
- 现在从原稿中心裁到无白区再缩到 **1024×1024 满幅方图**，圆角交给 iOS 自己裁
- 只保留 1024 单尺寸：Xcode 15+ 勾选 `Single Size` 后自动生成其余尺寸
- PNG 量化到 256 色（1MB → 237KB），视觉无差

## 应用名称：中文

桌面显示名走 `CFBundleDisplayName`，必须是中文；`CFBundleName` 只能是 ASCII 短名。

```xml
<!-- Info.plist -->
<key>CFBundleDisplayName</key>
<string>趣哪玩儿</string>
<key>CFBundleName</key>
<string>funnyplus</string>
```

Xcode 里对应 `PRODUCT_NAME = funnyplus`、`INFOPLIST_KEY_CFBundleDisplayName = 趣哪玩儿`。App Store 的展示名另外在 App Store Connect 填，同样是「趣哪玩儿」。

## 建壳时需要的东西（还没做）

1. `npm run build` 产出 `lynx/dist/main.lynx.bundle`，作为 App 资源打进包
2. CocoaPods 引 Lynx：`pod 'Lynx'`，版本对齐 `lynx/package.json` 里的 `@lynx-js/react`
3. 用 `LynxView` 加载**本地 bundle**（线上不要读 dev server 的 URL）
4. 启动图：iOS 14+ 用 `Info.plist` 的 `UILaunchScreen`，底色 `#F5F7FC`（`--surface`），居中放 `docs/materials/brand/app-icon-symbol.svg` 渲染的图形
5. 安全区：现在 `lynx` 里写死了 60px 顶部留白（原生端取不到 `env(safe-area-inset-top)`），嵌壳后应由宿主注入真实安全区

## 图标设计上的一个已知取舍

中文图标把「趣哪玩儿」四个字画在图标里，桌面缩到 60pt 时字会糊。这是当前选择的代价；如果后面要做无字版，用 `docs/materials/brand/app-icon-symbol.svg` 重新渲染即可，`AppIcon.appiconset` 换张图就行。
