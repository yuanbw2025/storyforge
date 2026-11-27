#!/usr/bin/env bash
set -euo pipefail
# Disposable Arch container only. Both packages and fixtures were verified on the host.
ulimit -c 0
: "${STORYFORGE_PREVIOUS_VERSION:?}"
: "${STORYFORGE_PREVIOUS_SOURCE:?}"
: "${STORYFORGE_CURRENT_SOURCE:?}"
pacman -Syu --noconfirm --needed nodejs npm sudo xorg-server-xvfb xorg-xauth dbus
id storyforge >/dev/null 2>&1 || useradd --create-home --shell /bin/bash storyforge
printf 'storyforge ALL=(ALL) NOPASSWD: /usr/bin/pacman\n' > /etc/sudoers.d/storyforge
chmod 440 /etc/sudoers.d/storyforge
cd /workspace
version=$(node -p "require(process.env.STORYFORGE_CANDIDATE_DIRECTORY ? './' + process.env.STORYFORGE_CANDIDATE_DIRECTORY + '/package.json' : './package.json').version")
test "$version" != "$STORYFORGE_PREVIOUS_VERSION"
mkdir -p release/arch
chown -R storyforge:storyforge release
old="release/arch/previous/StoryForge-$STORYFORGE_PREVIOUS_VERSION-arch-x64.pkg.tar.zst"
next="release/arch/StoryForge-$version-arch-x64.pkg.tar.zst"
sha256sum "$old" "$next" > release/arch/upgrade-packages.sha256
# Reuse all existing cross-version assertions: old restart, full production export,
# OPFS, invalid import rejection, restore into another Work, and restart of that Work.
timeout 900 runuser -u storyforge -- dbus-run-session -- xvfb-run -a \
  node scripts/desktop/upgrade-smoke.mjs "$old" "$next" "$STORYFORGE_PREVIOUS_VERSION" \
  "$STORYFORGE_PREVIOUS_SOURCE" "$STORYFORGE_CURRENT_SOURCE" "${STORYFORGE_CANDIDATE_DIRECTORY:-.}" \
  | tee release/arch/upgrade-result.jsonl
pacman -Q > release/arch/upgrade-environment.txt
