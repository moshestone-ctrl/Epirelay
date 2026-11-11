#!/usr/bin/env bash
# Installs the APK on the emulator, opens it, and prints what happened (crash logs + what's on screen).
set -u
PKG=com.epirelay.app
APK=$(ls apk/*.apk | head -1)
echo "::group::Device"
adb shell getprop ro.build.version.release
adb shell getprop ro.product.cpu.abilist
echo "::endgroup::"

echo "::group::Install"
adb install -r -g "$APK"
echo "::endgroup::"

adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 30

echo "===== APP PROCESS ====="
adb shell pidof "$PKG" && echo "RUNNING" || echo "NOT RUNNING (crashed or closed)"

echo "===== CRASH BUFFER ====="
adb logcat -d -b crash | tail -150

echo "===== JS / REACT NATIVE / EXPO LOG ====="
adb logcat -d | grep -E "ReactNativeJS|ReactNative|unknown:React|Expo|expo|AndroidRuntime|FATAL|Hermes|SoLoader|libc  |DEBUG   " | tail -200

echo "===== SCREEN TEXT ====="
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
adb shell cat /sdcard/ui.xml | grep -oE 'text="[^"]+"' | head -60
echo "===== DONE ====="
