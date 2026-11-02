# Versions, upgrades, and data compatibility

## Which version these docs describe

This incremental review covers **October 30, 2026, main baseline 8707bb8a**, checking user-visible changes since successful maintenance baseline `3b524e11`. Product status follows each product guide.

The current formal release is [**v4.0.4**](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.4), published on **October 23, 2026 at 03:17 UTC**, at fixed source `d90961a2`. It delivers the large run-contract save and recovery repair in [PR #185](https://github.com/yuanbw2025/storyforge/pull/185), with [release preparation PR #190](https://github.com/yuanbw2025/storyforge/pull/190) merged. Contracts and event snapshots share a finite 32 MiB UTF-8 record budget and retain full snapshots. Oversized records are still explicitly rejected; model budgets, candidate adoption, permissions and stale checks remain, with no database migration. The independent release passed full production/browser checks, all clients and four portable startup targets, plus upgrades from formal v4.0.3. Android retains four-stage verification including the old-package restart baseline, new-package restore and final restart. Export a complete backup before upgrading, as described below.

The previous formal release is [**v4.0.3**](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.3), published on **October 22, 2026 at 14:16 UTC**, at fixed source `eb1fb49d`. [PR #184](https://github.com/yuanbw2025/storyforge/pull/184) is merged. The release includes fixes for detailed-outline source snapshots, missing style statistics, scene-outline input, and error recovery, with client startup, upgrade and full browser checks passed. The [latest release page](https://github.com/yuanbw2025/storyforge/releases/latest) provides a Windows EXE, two Mac DMGs, an Android APK, four portable ZIP targets, update metadata and `SHA256SUMS.txt`. Version 4.0.2 adds Windows, Mac and Android installers, in-app updates and the unified User Agreement; see [installation](/en/getting-started/install). Builds of v4.0.1 include explicit failure feedback and the text-adventure recovery, image-preserving revisions, and standalone web export from [PR #119](https://github.com/yuanbw2025/storyforge/pull/119). See [troubleshooting and capture limits](/en/guides/troubleshooting#problems-and-failure-reports-in-downloaded-builds).

v4.0.2 was formally published on October 16, 2026 at fixed source `04de86d7`. Its release page provides a Windows EXE, Apple Silicon/Intel Mac DMGs, an Android APK, four Windows/Mac/Linux portable ZIP targets, and `SHA256SUMS.txt`. In-app problems and suggestions go to a private maintainer inbox; the fallback web form creates a public Issue. See [troubleshooting](/en/guides/troubleshooting#problems-and-failure-reports-in-downloaded-builds).

The historical [formal v4.0.0 release](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.0) was published on October 13, 2026 at fixed commit `78416965`; it does not include those later changes. Include the version, build commit, address, and date when reporting issues.

Live sites may lag deployment. [Tagged releases](https://github.com/yuanbw2025/storyforge/releases) do not automatically gain later main-branch features.

The outline candidate adoption fix in [PR #158](https://github.com/yuanbw2025/storyforge/pull/158) came after fixed v4.0.1 source `e8ce0a0d` and is included in the 4.0.2 client source. Use the release page to confirm published downloads; see [development status](/en/updates/development-status) for other pending work.

Current main includes longform entry consolidation in [PR #165](https://github.com/yuanbw2025/storyforge/pull/165), continuation/outline error handling in [PR #166](https://github.com/yuanbw2025/storyforge/pull/166), and system-fiction planning/whole-chapter review in [PR #141](https://github.com/yuanbw2025/storyforge/pull/141). These increments merged as `a45cb1db`, `b344cc0b`, and `1b96e80a`, respectively. See the [longform guide](/en/features/longform/). Fixed v4.0.2 source remains `04de86d7`, listed above.

## Main-branch changes after v4.0.4

Module-load recovery in [PR #195](https://github.com/yuanbw2025/storyforge/pull/195), narrative-world engineering work in [PR #197](https://github.com/yuanbw2025/storyforge/pull/197), open-world production and repair in [PR #134](https://github.com/yuanbw2025/storyforge/pull/134), and character-candidate editing protection and native-failure deduplication in [PR #201](https://github.com/yuanbw2025/storyforge/pull/201) are merged into main and await a later formal installer release. The current formal release remains v4.0.4 above; no later release date is set.

After narrative-index v12, [PR #196](https://github.com/yuanbw2025/storyforge/pull/196) advances main to database **v13 and complete backup format v17**, retaining a union bridge for both historical v12 databases and strict compatibility for v14/v15/v16 backups. Original world/work records remain the content source; rebuildable caches stay outside complete backups. Do not hand upgraded databases to software supporting only older schemas. Retain a v13-compatible environment and check pre-upgrade backups in an isolated copy before rollback. See [backup and recovery](/en/guides/backup-restore).

Newly reviewed text-adventure navigation [#208](https://github.com/yuanbw2025/storyforge/pull/208), chapter instructions/themes [#209](https://github.com/yuanbw2025/storyforge/pull/209), model configuration [#217](https://github.com/yuanbw2025/storyforge/pull/217), TTRPG [#196](https://github.com/yuanbw2025/storyforge/pull/196), character chat [#172](https://github.com/yuanbw2025/storyforge/pull/172), story-stage recovery [#226](https://github.com/yuanbw2025/storyforge/pull/226), and AVG [#219](https://github.com/yuanbw2025/storyforge/pull/219) are merged into main. Formal downloads remain v4.0.4. The v4.0.5 [preparation PR #228](https://github.com/yuanbw2025/storyforge/pull/228) merged as `ae765da8` on October 29, 2026, but v4.0.5 is not publicly released at this review. Its publication date and downloadable assets await actual release verification. Longform saving/adoption and load recovery #215, plus chapter encyclopedia-reference protection #231, are also merged into main; see their guides.

## Before upgrading

1. Export complete JSON in the original environment, and save important prose separately.
2. Preserve original files. If using a disk workspace, explicitly check differences and synchronize.
3. Read data-compatibility notes in the changelog.
4. After updating, check works, chapters, assets, and saving.

With no personal source changes, update following Git's guidance, then run `npm ci` and `npm run dev`. Preserve local changes and resolve conflicts first if present; do not upgrade using forced-overwrite commands.

## Not every old backup can be imported

Current backup validation accepts only the supported current format. Database migration and external-backup import are separate paths. Support for some database migrations does not imply arbitrary old JSON can be imported.

If an old file is rejected:

- Preserve the original backup and the environment that can still open it.
- Record the version and error text.
- If the original environment can read it, export prose separately so you are not left with only one format.
- Submit [feedback](/en/feedback/bug) and wait for an evidence-based compatibility solution.

Do not alter backup version numbers, delete validation fields, or clear the original browser database to bypass an error.

## Rolling back

Reverting source or opening an old release does not guarantee the old program can read newer data. Original pre-upgrade backups and a separate environment provide the recovery basis.

Continue: [Backup and recovery](/en/guides/backup-restore) · [Changelog](/en/updates/changelog).

Implemented on a branch, merged into remote main, and successfully deployed are three separate states. [Pending development](/en/updates/development-status) records work not yet delivered. A documentation review date is not a product release date.

[PR #171](https://github.com/yuanbw2025/storyforge/pull/171), merged on October 21, fixes missing detailed-outline snapshots and profile reading when style counts are absent. See [prose and chapter plans](/en/features/longform/writing) and [style learning](/en/features/longform/style-learning). The contract-snapshot budget repair in [PR #185](https://github.com/yuanbw2025/storyforge/pull/185) merged into main on October 22, 2026. It is now included in formal **v4.0.4**; this repair is not in v4.0.3.
