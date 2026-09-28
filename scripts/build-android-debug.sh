#!/usr/bin/env bash
# Build a debug APK for Pomah Admin. Does not need the website to be rebuilt:
# the shell loads https://pomahguesthouse.com/admin.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f android/gradlew ]]; then
  echo "android/ is missing. From the repo root run: bunx cap add android && bun run android:sync"
  exit 1
fi

if [[ ! -d android/capacitor-cordova-android-plugins ]]; then
  echo "Syncing Capacitor plugins..."
  bunx cap sync android
fi

if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" ]]; then
  if [[ ! -f android/local.properties ]]; then
    echo "Android SDK not found. Install command-line tools, then either:"
    echo "  export ANDROID_HOME=\$HOME/Android/Sdk"
    echo "  echo sdk.dir=\$ANDROID_HOME > android/local.properties"
    echo "See docs/android.md."
    exit 1
  fi
fi

if [[ ! -f android/app/google-services.json ]]; then
  echo "Note: android/app/google-services.json is absent. The APK will install, but push stays off until that file is added and the app is rebuilt."
fi

chmod +x android/gradlew
(cd android && ./gradlew assembleDebug)

APK="android/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$APK" ]]; then
  echo "Gradle finished without $APK"
  exit 1
fi
echo "Debug APK: $ROOT/$APK"
