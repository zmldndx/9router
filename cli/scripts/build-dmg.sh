#!/usr/bin/env bash
# Build macOS .app bundle + .dmg for 9Router (tray-only, bundled Node).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI_DIR="$ROOT/cli"
DIST_DIR="$ROOT/dist/macos"
APP_NAME="9Router"
CACHE_DIR="$ROOT/dist/.cache"
VERSION="$(node -p "require('$CLI_DIR/package.json').version")"
NODE_VERSION="20.18.1"

echo "==> Building CLI standalone app..."
cd "$CLI_DIR"
npm run build

ARCH="$(uname -m)"
NODE_ARCH="$([ "$ARCH" = "arm64" ] && echo "arm64" || echo "x64")"
NODE_TAR="node-v${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
NODE_DIR="node-v${NODE_VERSION}-darwin-${NODE_ARCH}"

mkdir -p "$CACHE_DIR"
if [ ! -f "$CACHE_DIR/$NODE_TAR" ]; then
  echo "==> Downloading Node.js ${NODE_VERSION} (${NODE_ARCH})..."
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TAR}" -o "$CACHE_DIR/$NODE_TAR"
fi

echo "==> Extracting Node.js..."
rm -rf "$CACHE_DIR/$NODE_DIR"
tar -xzf "$CACHE_DIR/$NODE_TAR" -C "$CACHE_DIR"

BUNDLE="$DIST_DIR/${APP_NAME}.app"
STAGING="$DIST_DIR/staging"
DMG_PATH="$DIST_DIR/${APP_NAME}-${VERSION}-mac-${NODE_ARCH}.dmg"

echo "==> Creating app bundle..."
rm -rf "$BUNDLE" "$STAGING"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources/app/cli"

cp "$CACHE_DIR/$NODE_DIR/bin/node" "$BUNDLE/Contents/MacOS/node"
chmod +x "$BUNDLE/Contents/MacOS/node"

rsync -a \
  --exclude node_modules \
  --exclude .build-home \
  "$CLI_DIR/" "$BUNDLE/Contents/Resources/app/cli/"

echo "==> Bundling systray2 (menu bar)..."
BUNDLE_RUNTIME="$BUNDLE/Contents/Resources/app/cli/runtime"
mkdir -p "$BUNDLE_RUNTIME"
cat > "$BUNDLE_RUNTIME/package.json" << 'PKG'
{"name":"9router-bundled-runtime","private":true,"version":"1.0.0"}
PKG
(
  cd "$BUNDLE_RUNTIME"
  npm install "systray2@2.1.4" --no-audit --no-fund --prefer-offline --no-save
)
TRAY_BIN="$BUNDLE_RUNTIME/node_modules/systray2/traybin/tray_darwin_release"
if [ -f "$TRAY_BIN" ]; then
  chmod +x "$TRAY_BIN"
  xattr -cr "$TRAY_BIN" 2>/dev/null || true
else
  echo "WARNING: systray2 tray binary missing — menu bar icon may not appear"
fi

cat > "$BUNDLE/Contents/MacOS/${APP_NAME}" << 'LAUNCHER'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$DIR/../Resources/app/cli"
LOG_DIR="$HOME/.9router/logs"
mkdir -p "$LOG_DIR"
export NINEROUTER_PACKAGED=1
export NODE_ENV=production
export NODE_PATH="$APP_ROOT/runtime/node_modules${NODE_PATH:+:$NODE_PATH}"
cd "$APP_ROOT"
exec "$DIR/node" "$APP_ROOT/cli.js" --tray --skip-update --no-browser >> "$LOG_DIR/9router.log" 2>&1
LAUNCHER
chmod +x "$BUNDLE/Contents/MacOS/${APP_NAME}"

cat > "$BUNDLE/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>com.9router.app</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

# Dock + menu bar icon (.icns for Finder/Dock)
ICON_SRC="$CLI_DIR/src/cli/tray/icon.png"
if [ -f "$ICON_SRC" ]; then
  mkdir -p "$BUNDLE/Contents/Resources"
  ICONSET="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$ICONSET"
  sips -z 16 16 "$ICON_SRC" --out "$ICONSET/icon_16x16.png" >/dev/null
  sips -z 32 32 "$ICON_SRC" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
  sips -z 32 32 "$ICON_SRC" --out "$ICONSET/icon_32x32.png" >/dev/null
  sips -z 64 64 "$ICON_SRC" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
  sips -z 128 128 "$ICON_SRC" --out "$ICONSET/icon_128x128.png" >/dev/null
  sips -z 256 256 "$ICON_SRC" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
  sips -z 256 256 "$ICON_SRC" --out "$ICONSET/icon_256x256.png" >/dev/null
  sips -z 512 512 "$ICON_SRC" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
  sips -z 512 512 "$ICON_SRC" --out "$ICONSET/icon_512x512.png" >/dev/null
  sips -z 1024 1024 "$ICON_SRC" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
  iconutil -c icns "$ICONSET" -o "$BUNDLE/Contents/Resources/AppIcon.icns"
  rm -rf "$(dirname "$ICONSET")"
fi

echo "==> Creating DMG..."
mkdir -p "$STAGING"
cp -R "$BUNDLE" "$STAGING/"
ln -sf /Applications "$STAGING/Applications"

rm -f "$DMG_PATH"
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$STAGING" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

echo ""
echo "Done: $DMG_PATH"
echo "Install: open DMG, drag ${APP_NAME}.app to Applications — menu bar shows「9Router」(no Dock icon)."
