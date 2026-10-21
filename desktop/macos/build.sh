#!/usr/bin/env bash
# build.sh — 把这只猫打包成一个能双击的 macOS App
#
#   ./build.sh              # 生成 build/乐乐桌宠.app
#   ./build.sh --run        # 打包完直接启动
#   ./build.sh --selftest   # 打包 + 启动 + 自检（打印窗口/页面状态后自动退出）
#
# 只用系统自带的 swiftc，不联网、不装任何依赖。

set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd)"
ROOT="$(cd ../.. && pwd)"

APP_NAME="乐乐桌宠"
BUILD="$HERE/build"
APP="$BUILD/$APP_NAME.app"
MACOS_DIR="$APP/Contents/MacOS"
RES="$APP/Contents/Resources"

echo "▸ 清理旧的 app"
rm -rf "$APP"
mkdir -p "$MACOS_DIR" "$RES/web/assets"

echo "▸ 拷贝网页与素材"
cp "$HERE/pet.html" "$RES/web/pet.html"
cp "$HERE/dashboard.html" "$RES/web/dashboard.html"
for f in lele-pet.js lele-skin.png lele-eye-l.png lele-eye-r.png lele.png lele-fallback.jpg; do
  cp "$ROOT/assets/$f" "$RES/web/assets/$f"
done
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"

echo "▸ 编译（swiftc，几秒钟）"
# 把编译中间产物放在本目录里：某些环境下 clang 的默认缓存目录不可写
mkdir -p "$HERE/.build/tmp" "$HERE/.build/mc"
export TMPDIR="$HERE/.build/tmp"
swiftc -module-cache-path "$HERE/.build/mc" \
  -O -whole-module-optimization \
  -framework Cocoa -framework WebKit \
  "$HERE/Pet.swift" -o "$MACOS_DIR/LelePet"

echo "▸ 临时签名（本机自用够了）"
codesign --force --deep --sign - "$APP" 2>/dev/null || echo "  （跳过签名，不影响本机运行）"

chmod +x "$MACOS_DIR/LelePet"
echo "✓ 打包完成：$APP"
echo "  双击它就能把猫放到桌面上；菜单栏出现 🐱"

case "${1:-}" in
  --selftest)
    echo "▸ 自检"
    "$MACOS_DIR/LelePet" --selftest
    ;;
  --run)
    open "$APP"
    ;;
esac
