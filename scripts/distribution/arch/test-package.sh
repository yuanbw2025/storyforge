#!/usr/bin/env bash
set -euo pipefail
# Runs only inside the disposable Arch Linux CI container, with a synthetic user.
pacman -Syu --noconfirm --needed nodejs npm sudo xorg-server-xvfb xorg-xauth dbus desktop-file-utils
useradd --create-home --shell /bin/bash storyforge
printf 'storyforge ALL=(ALL) NOPASSWD: /usr/bin/pacman\n' > /etc/sudoers.d/storyforge
chmod 440 /etc/sudoers.d/storyforge
cd /workspace
mkdir -p release/arch
trap 'pacman -Q > release/arch/test-environment.txt' EXIT
version=$(node -p "require('./package.json').version")
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
mkdir -p release/arch/package
cp scripts/distribution/arch/PKGBUILD scripts/distribution/arch/storyforge.desktop public/icon-512.png LICENSE release/arch/package/
cp -a release/linux/linux-unpacked release/arch/package/payload
chown -R storyforge:storyforge release
runuser -u storyforge -- env STORYFORGE_PACKAGE_VERSION="$version" bash -c 'cd release/arch/package && makepkg --syncdeps --noconfirm'
package="release/arch/StoryForge-$version-arch-x64.pkg.tar.zst"
mv "release/arch/package/storyforge-$version-1-x86_64.pkg.tar.zst" "$package"
pacman -U --noconfirm "$package"
test "$(pacman -Q storyforge)" = "storyforge $version-1"
desktop-file-validate /usr/share/applications/storyforge.desktop
test -x /usr/bin/storyforge
test -f /usr/share/icons/hicolor/512x512/apps/storyforge.png
# Chromium's sandbox stays enabled; the container permits its namespace setup.
timeout 300 runuser -u storyforge -- dbus-run-session -- xvfb-run -a node scripts/desktop/smoke.mjs /usr/bin/storyforge
timeout 300 runuser -u storyforge -- dbus-run-session -- xvfb-run -a node scripts/desktop/arch-lifecycle.mjs seed
pacman -U --noconfirm "$package"
timeout 300 runuser -u storyforge -- dbus-run-session -- xvfb-run -a node scripts/desktop/arch-lifecycle.mjs verify
pacman -R --noconfirm storyforge
test ! -e /usr/bin/storyforge
test ! -e /usr/share/applications/storyforge.desktop
test ! -e /usr/share/icons/hicolor/512x512/apps/storyforge.png
# Reinstall after removal and verify the same real production manuscript and OPFS.
pacman -U --noconfirm "$package"
timeout 300 runuser -u storyforge -- dbus-run-session -- xvfb-run -a node scripts/desktop/arch-lifecycle.mjs verify
pacman -Q > release/arch/test-environment.txt
sha256sum "$package" > release/arch/package.sha256
printf 'Arch pacman install, native launch, agreement, restart, reinstall, removal and data preservation passed.\n' > release/arch/test-result.txt
