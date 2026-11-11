#!/usr/bin/env bash
# Installs the APK on the emulator, opens it, and reports what happened (crash logs + what's on screen).
# With --require-screen it fails unless the app is still running and shows its first screen.
set -u
PKG=com.epirelay.app
REQUIRE_SCREEN=false
[ "${1:-}" = "--require-screen" ] && REQUIRE_SCREEN=true
APK=$(ls apk/*.apk | head -1)

echo "::group::Device"
adb shell getprop ro.build.version.release
adb shell getprop ro.product.cpu.abilist
echo "::endgroup::"

echo "::group::Install $APK"
adb install -r -g "$APK" || { echo "::error::Install failed"; exit 1; }
echo "::endgroup::"

adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

# Wait up to 90 s for the first screen (sign-in, onboarding or "not connected").
SCREEN=""
for i in $(seq 1 18); do
  sleep 5
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  SCREEN=$(adb shell cat /sdcard/ui.xml 2>/dev/null | grep -oE 'text="[^"]+"' | head -60)
  if echo "$SCREEN" | grep -qE 'Create account|Sign in|Before you start|connected to a server|Hold 2 seconds'; then
    break
  fi
done

RUNNING=false
adb shell pidof "$PKG" >/dev/null && RUNNING=true

echo "===== APP PROCESS: $([ $RUNNING = true ] && echo RUNNING || echo 'NOT RUNNING (crashed or closed)') ====="
echo "===== CRASH BUFFER ====="
adb logcat -d -b crash | tail -150
echo "===== JS / REACT NATIVE / EXPO LOG ====="
adb logcat -d | grep -E "ReactNativeJS|ReactNative|unknown:React|Expo|AndroidRuntime|FATAL|Hermes|SoLoader" | tail -200
echo "===== SCREEN TEXT ====="
echo "$SCREEN"
echo "===== DONE ====="

if [ "$REQUIRE_SCREEN" = true ]; then
  if [ "$RUNNING" != true ]; then echo "::error::The app crashed or closed on launch."; exit 1; fi
  if ! echo "$SCREEN" | grep -qE 'Create account|Sign in|Before you start|connected to a server|Hold 2 seconds'; then
    echo "::error::The app is running but its first screen never appeared."; exit 1
  fi
  echo "App opened and showed its first screen."
fi

# ---- Map check: open the sample SOS map and make sure it draws without crashing ----
adb logcat -c
adb shell am start -W -a android.intent.action.VIEW -d "epirelay://map-check" "$PKG" >/dev/null 2>&1
MAP_TEXT=""
for i in $(seq 1 12); do
  sleep 5
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  MAP_TEXT=$(adb shell cat /sdcard/ui.xml 2>/dev/null | grep -oE '(text|content-desc)="[^"]+"' | head -40)
  echo "$MAP_TEXT" | grep -qE 'Marcus|Map check' && break
done
sleep 8  # let map tiles finish loading for the screenshot
MAP_RUNNING=false
adb shell pidof "$PKG" >/dev/null && MAP_RUNNING=true
echo "===== MAP CHECK: $([ $MAP_RUNNING = true ] && echo RUNNING || echo 'CRASHED') ====="
adb logcat -d -b crash | tail -80
adb logcat -d | grep -iE "maplibre|mbgl|AndroidRuntime|ReactNativeJS" | grep -viE "libc  " | tail -40
echo "$MAP_TEXT"
adb exec-out screencap -p > map-check.png 2>/dev/null
if command -v convert >/dev/null 2>&1; then convert map-check.png -resize 45% -quality 70 map-check.jpg && SHOT=map-check.jpg; else SHOT=map-check.png; fi
echo "===== MAP SCREENSHOT BASE64 BEGIN ($SHOT) ====="
base64 -w 0 "$SHOT"; echo
echo "===== MAP SCREENSHOT BASE64 END ====="

if [ "$REQUIRE_SCREEN" = true ]; then
  if [ "$MAP_RUNNING" != true ]; then echo "::error::The app crashed when showing the map."; exit 1; fi
  if ! echo "$MAP_TEXT" | grep -q 'Map check'; then echo "::error::The map screen didn't open."; exit 1; fi
  echo "$MAP_TEXT" | grep -q 'Marcus' || echo "::warning::Map markers weren't visible to the UI inspector; check the screenshot."

  echo "Map check passed."
fi
