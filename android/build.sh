#!/usr/bin/env bash
# 构建安卓 APK。
#
# 从手搓 aapt2/d8 改为 Gradle：Lynx 只发 Maven 上的 AAR（lynx + lynx-base + primjs +
# servalsvg 等，带 liblynx.so），手工那套得自己解依赖树、解 jniLibs、合并 manifest，
# 等于重写一遍 AGP。现在这里只负责「同步 bundle + 调 gradlew」。
#
# 用法：
#   ./build.sh                                 # debug 包，后端指向本机（模拟器用 10.0.2.2）
#   ./build.sh --api http://192.168.1.5:8787   # 指向局域网后端（真机用）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID="$ROOT/android"
JAVA_HOME="${JAVA_HOME:-$HOME/android-dev/jdk-17.0.21+9/Contents/Home}"

export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

# 模拟器里 127.0.0.1 是它自己，10.0.2.2 才是宿主机的回环
API_BASE="http://10.0.2.2:8787"
while [ $# -gt 0 ]; do
  case "$1" in
    --api) API_BASE="$2"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

BUNDLE="$ROOT/lynx/dist/main.lynx.bundle"
[ -f "$BUNDLE" ] || { echo "缺少 $BUNDLE，先跑 npm run build" >&2; exit 1; }

echo "==> 同步 Lynx bundle"
mkdir -p "$ANDROID/app/src/main/assets/web"
cp "$BUNDLE" "$ANDROID/app/src/main/assets/web/main.lynx.bundle"

echo "==> gradlew assembleDebug（API_BASE=$API_BASE）"
cd "$ANDROID"
./gradlew :app:assembleDebug -PapiBase="$API_BASE" --console=plain

APK="$ANDROID/app/build/outputs/apk/debug/app-debug.apk"
echo
echo "==> 完成: $APK ($(du -h "$APK" | cut -f1))"
echo "    后端地址: $API_BASE"
echo "    安装: adb install -r $APK"
