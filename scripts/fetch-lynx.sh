#!/bin/bash
# 拉取原生 Lynx SDK 源码包到 ios/FunnyPlus/vendor/。
#
# 为什么不用 pod 'Lynx', '4.2.0' 直接装：这台机器连 github.com:443 时通时不通，
# 而 curl 走 release 直链是稳的（subsim 几十 MB 也是几秒），Podfile 因此指向本地 path。
# vendor/ 已 gitignore，换机器先跑这个。
set -euo pipefail

VER="${1:-4.2.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/ios/FunnyPlus/vendor"
BASE="https://github.com/lynx-family/lynx/releases/download/$VER"

mkdir -p "$VENDOR"

for name in Lynx LynxBase LynxServiceAPI; do
  if [ -f "$VENDOR/$name/$name.podspec.json" ]; then
    echo "✓ $name 已存在，跳过"
    continue
  fi
  echo "↓ $name-$VER.zip"
  tmp="$(mktemp -d)"
  curl -fsSL --retry 3 -o "$tmp/pkg.zip" "$BASE/$name-$VER.zip"
  unzip -q -o "$tmp/pkg.zip" -d "$tmp/x"
  rm -rf "$VENDOR/$name"
  mv "$tmp/x/$name" "$VENDOR/$name"
  rm -rf "$tmp"
  echo "✓ $name"
done

echo
echo "完成。接着跑："
echo "  cd ios/FunnyPlus && pod install"
echo "  open FunnyPlus.xcworkspace"
