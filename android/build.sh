#!/usr/bin/env bash
# 构建安卓 APK：把 lynx 打出来的 web 运行时塞进壳里，再用 SDK 自带工具链完成编译 / 签名。
#
# 为什么不用 Gradle：这个壳只有一个 Activity、零第三方依赖，
# 引 Gradle 要再拉一套 distribution 和插件，几十 MB 只为编 4 个文件不划算。
# aapt2 + javac + d8 + apksigner 是 AGP 底下真正干活的那几层，直接调同样可靠。
#
# 用法：
#   ./build.sh                 # 打 debug 包，后端指向本机 127.0.0.1:8787
#   ./build.sh --api http://192.168.1.5:8787   # 指向局域网后端
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/android/app"
OUT="$ROOT/android/build"
SDK="${ANDROID_HOME:-$HOME/android-dev/sdk}"
BT="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"
JAVA_HOME="${JAVA_HOME:-$HOME/android-dev/jdk-17.0.21+9/Contents/Home}"
JAVA="$JAVA_HOME/bin/java"
JAVAC="$JAVA_HOME/bin/javac"
KEYTOOL="$JAVA_HOME/bin/keytool"

# SDK 里的 aapt2 / d8 / apksigner 都是 java 启动器，没有 JAVA_HOME 会直接报找不到运行时
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

API_BASE="http://127.0.0.1:8787"
while [ $# -gt 0 ]; do
  case "$1" in
    --api) API_BASE="$2"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

for f in "$BT/aapt2" "$PLATFORM" "$JAVAC" "$ROOT/lynx/dist/main.web.bundle"; do
  [ -e "$f" ] || { echo "缺少依赖: $f" >&2; echo "先跑 npm run build 出 bundle；SDK 见 README" >&2; exit 1; }
done

echo "==> 清理"
rm -rf "$OUT"
mkdir -p "$OUT"/{gen,classes,dex,assets/web,res} "$OUT"/static

echo "==> 同步 web 运行时"
cp "$ROOT/lynx/dist/main.web.bundle" "$OUT/assets/web/main.web.bundle"
cp -R "$ROOT/ios/FunnyPlus/FunnyPlus/web/static" "$OUT/assets/web/static"
cp "$ROOT/ios/FunnyPlus/FunnyPlus/web/index.html" "$OUT/assets/web/index.html"

echo "==> 生成 BuildConfig（API_BASE=$API_BASE）"
mkdir -p "$OUT"/gen/com/maka/funnyplus
sed "s|__API_BASE__|$API_BASE|" "$APP/src/com/maka/funnyplus/BuildConfig.java.tpl" \
  > "$OUT/gen/com/maka/funnyplus/BuildConfig.java"

echo "==> 编译资源"
"$BT/aapt2" compile --dir "$APP/res" -o "$OUT/res/compiled.zip"
"$BT/aapt2" link -o "$OUT/base.apk" \
  -I "$PLATFORM" \
  --manifest "$APP/AndroidManifest.xml" \
  -A "$OUT/assets" \
  --java "$OUT/gen" \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code 1 --version-name 0.1.0 \
  "$OUT/res/compiled.zip"

echo "==> 编译 Java"
find "$APP/src" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
"$JAVAC" -source 8 -target 8 -bootclasspath "$PLATFORM" -classpath "$PLATFORM" \
  -d "$OUT/classes" @"$OUT/sources.txt" 2>&1 | grep -v "bootstrap class path\|source value 8\|target value 8\|deprecat" || true
[ -d "$OUT/classes/com" ] || { echo "javac 没产出 class，构建失败" >&2; exit 1; }

echo "==> dex"
"$BT/d8" --min-api 24 --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')

echo "==> 打包"
cd "$OUT/dex" && zip -q -X "$OUT/base.apk" classes.dex && cd "$ROOT"

echo "==> 签名"
KS="$ROOT/android/keystore/funny.jks"
if [ ! -f "$KS" ]; then
  echo "    首次构建，生成调试用 keystore（分享给朋友装需要固定签名，否则覆盖安装会失败）"
  mkdir -p "$(dirname "$KS")"
  "$KEYTOOL" -genkeypair -v -keystore "$KS" -alias funnyplus -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass funnyplus -keypass funnyplus \
    -dname "CN=Funny Plus, OU=Dev, O=Maka, L=Beijing, C=CN" >/dev/null 2>&1
fi

"$BT/zipalign" -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"
"$BT/apksigner" sign --ks "$KS" --ks-key-alias funnyplus \
  --ks-pass pass:funnyplus --key-pass pass:funnyplus \
  --out "$OUT/funny-plus.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify --print-certs "$OUT/funny-plus.apk" | head -4

SIZE=$(du -h "$OUT/funny-plus.apk" | cut -f1)
echo
echo "==> 完成: $OUT/funny-plus.apk ($SIZE)"
echo "    后端地址: $API_BASE"
