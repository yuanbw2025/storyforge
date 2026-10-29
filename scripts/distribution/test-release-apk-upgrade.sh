#!/usr/bin/env bash
set -euo pipefail
sha256sum release-test/*.apk | tee release-test/package-checksums.txt
for file in release-test/*.apk; do
  "$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --print-certs "$file" | tee "$file.certificate.txt"
  grep -q '4bc440d0734135945d9cc143bb45723fa750e1a6d03bfb9753c165e9c3c056f0' "$file.certificate.txt"
done
adb install release-test/upgrade-test-old.apk
adb install release-test/upgrade-test-runner.apk
run_phase() {
  local evidence_name="${2:-$1}"
  local expected_version
  case "$1" in
    seed|baseline) expected_version="${PREVIOUS_CLIENT_VERSION:?Pass the previous formal client version}" ;;
    *) expected_version=$(node -p "require('./package.json').version") ;;
  esac
  adb shell am instrument -w -r -e class com.storyforge.client.ClientUpgradeTest -e phase "$1" -e expectedVersion "$expected_version" com.storyforge.client.test/androidx.test.runner.AndroidJUnitRunner | tee "release-test/$evidence_name.txt"
  grep -q 'OK (1 test)' "release-test/$evidence_name.txt"
}
run_phase seed
adb shell am force-stop com.storyforge.client
# Establish that the old formal APK can read its own persisted baseline before replacement.
run_phase baseline baseline-restart
adb shell am force-stop com.storyforge.client
adb install -r release-test/upgrade-test-new.apk
run_phase restore
adb shell am force-stop com.storyforge.client
run_phase restart
adb shell dumpsys package com.storyforge.client > release-test/package.txt
version=$(node -p "require('./package.json').version")
grep -q "versionName=$version" release-test/package.txt
