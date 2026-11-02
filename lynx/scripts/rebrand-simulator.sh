#!/usr/bin/env bash
# 仅用于本机模拟器演示：把 LynxExplorer 的图标与显示名换成本产品的。
#
# 注意：名称和图标属于「宿主 App」，不属于 Lynx bundle。真正的重启即失效…
# 是真正要发版时，得按 integrate-with-existing-apps 做原生壳，那时改壳的
# Info.plist / AppIcon 才作数。这个脚本只是让演示时不再显示 "LynxExplorer"。
set -euo pipefail

DEVICE="${1:-booted}"
BUNDLE_ID="com.lynx.LynxExplorer"
NAME="${APP_DISPLAY_NAME:-趣哪玩儿}"
SRC="${APP_ICON_SRC:-$(cd "$(dirname "$0")/../.." && pwd)/docs/brand/logo-zh.png}"

[ -f "$SRC" ] || { echo "找不到品牌图标：$SRC" >&2; exit 1; }

APP="$(xcrun simctl get_app_container "$DEVICE" "$BUNDLE_ID" app)"
[ -d "$APP" ] || { echo "模拟器里没装 $BUNDLE_ID（先跑 npm run dev 并用 LynxExplorer 打开一次）" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 原图是带圆角的白底方图，直接当图标会在系统自带的圆角遮罩下露出四个白角，
# 所以先放大 1.18 倍再居中裁切，让四角被渐变填满
for px in 120 152; do
  big=$(( px * 118 / 100 ))
  sips -Z "$big" "$SRC" --out "$TMP/raw-$px.png" >/dev/null
  sips -c "$px" "$px" "$TMP/raw-$px.png" --out "$TMP/icon-$px.png" >/dev/null
done

cp "$APP/AppIcon60x60@2x.png" "$TMP/backup-120.png"
cp "$APP/AppIcon76x76@2x~ipad.png" "$TMP/backup-152.png"
cp "$APP/Info.plist" "$TMP/backup-Info.plist"
echo "备份在：${TMP}（脚本结束后会删除，需要保留请自行复制）"

cp "$TMP/icon-120.png" "$APP/AppIcon60x60@2x.png"
cp "$TMP/icon-152.png" "$APP/AppIcon76x76@2x~ipad.png"

# -replace 在缺键时会失败，先用 -insert 兜底
plutil -replace CFBundleDisplayName -string "$NAME" "$APP/Info.plist" 2>/dev/null \
  || plutil -insert CFBundleDisplayName -string "$NAME" "$APP/Info.plist"

echo "已改：$(plutil -extract CFBundleDisplayName raw "$APP/Info.plist")"
echo "重启模拟器让 SpringBoard 刷新图标缓存（simctl shutdown/boot 由调用方执行）"
