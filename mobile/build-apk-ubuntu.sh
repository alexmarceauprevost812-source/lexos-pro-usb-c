#!/usr/bin/env bash
# Construire l'APK sur ton Ubuntu / Kali (Alienware). Besoin : Node 20+, Java 17, Android SDK.
# Android SDK le plus simple : installer Android Studio une fois, ou les « command-line tools ».
set -e
: "${ANDROID_HOME:=$HOME/Android/Sdk}"
export ANDROID_HOME
echo "Android SDK : $ANDROID_HOME"
npm install
npx expo prebuild -p android --no-install
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
cp app/build/outputs/apk/release/app-release.apk ../TI-LEX-Local.apk
echo "✔ APK prêt : TI-LEX-Local.apk"
