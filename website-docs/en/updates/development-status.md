# Pending development and branch audit

> Snapshot: 2026-10-08 15:07 (UTC+8) · Remote main `7629a7fa`. This page records development evidence, not a list of released features.

This audit covers all 19 local branches (including this documentation-maintenance branch) and 41 registered worktrees, including detached worktrees and those moved into archives. Excluding maintenance, 8 of the remaining 18 branch heads are outside main. “Local-only commits” means commits not contained in any fetched origin branch; the count is not the number of missing features.

## 2026-10-10 addition: local Codex provider

Branch `feat/codex-provider-20261010` adds an optional local text transport using Codex app-server. It reuses the detected ChatGPT login without an API key and leaves candidate review/adoption with existing StoryForge workflows. See [configuration](/en/getting-started/model-config). Merge, CI, and hosted documentation deployment must be checked separately; this entry does not update the older branch inventory below.

## October 9 targeted update Plugins and Workshop

Plugin preview 1.0 is delivered through PR #113; the base implementation is [53c276f3](https://github.com/yuanbw2025/storyforge/commit/53c276f3). See [PR #113](https://github.com/yuanbw2025/storyforge/pull/113) for delivery and review. New [Workshop guides](/en/workshop/) cover capabilities, installation, development, an AI prompt and Skill kit, publishing, maintenance and recovery, with in-app help/download entry points. Use the latest PR checks and merge state to assess delivery; verify website deployment separately. The branch snapshot below preserves the 2026-10-08 review, so its unmerged status and old CI result do not describe the current state.

## Now in main

- [PR #107](https://github.com/yuanbw2025/storyforge/pull/107): game-production responsibilities and lifecycle documentation, plus review protection until longform candidates are saved.
- [PR #108](https://github.com/yuanbw2025/storyforge/pull/108): preserving entered task-repair drafts during the initial production-progress load.
- [PR #109](https://github.com/yuanbw2025/storyforge/pull/109): home layout, text display, and a unified power-system editor within World origin. The earlier “local and unpushed” description is obsolete.
- [PR #110](https://github.com/yuanbw2025/storyforge/pull/110): the prepared Last Letter motion-comic sample. Its documentation has already passed [site deployment](https://github.com/yuanbw2025/storyforge/actions/runs/37356743763). The sample does not mean comic production can automatically create equivalent animation.
- [PR #111](https://github.com/yuanbw2025/storyforge/pull/111): the three built-in narrative games are now in main, including slow-frame travel and paused-scene fixes. Later commits supersede the earlier pending/failed-CI status and temporary uncommitted-worktree observations. The Word-import transitive-dependency security fix is also in main, whose latest [full CI](https://github.com/yuanbw2025/storyforge/actions/runs/37477830226) passed.

See the [changelog](/en/updates/changelog), [longform settings](/en/features/longform/planning), and [candidates and recovery](/en/guides/ai-workflow). Mainline integration, application deployment, and documentation deployment are checked separately; a merge date is not a version-release date.

## Branches still outside main

- `feat/plugin-workshop-v1-20261008`: 1 commit outside main, 0 local-only; clean worktree.

  `53c276f3` is pushed to [draft PR #113](https://github.com/yuanbw2025/storyforge/pull/113), still unmerged. A follow-up at 16:14 (UTC+8) confirmed [remote CI failure](https://github.com/yuanbw2025/storyforge/actions/runs/37734889246): 229 browser tests passed, 1 failed, and 2 were skipped. The complete text-open-world journey failed while waiting for the combat result; the cause needs investigation. The plugin and local Workshop trial includes 12 reference packages; local test success does not mean online availability. See the [trial brief](/en/updates/plugin-workshop-v1) for scope, trial steps, data protection, and validation limits.

- `feat/builtin-3d-adventure`: 9 commits outside main; 9 local-only.

  Earlier local development of the three built-in works; the works have now been migrated into main through PR #111. Old commit identities and implementation differ, so do not merge them again directly or list the three works as pending delivery.

- `feat/mist-harbor-builtin`: 1 commit outside main; 1 local-only.

  `6ddbdb8c`: Mist Harbor AVG effects, soundtrack, and recording copy. An unpushed commit in an archived worktree; continued relevance needs review.

- `fix/avg-production-world-media-reuse`: 1 commit outside main; 1 local-only.

  `618d388e`: frozen-world media reuse, also contained in the older open-world architecture branch. Retained as one review item.

- `codex/backup-text-open-world-before-main-sync-20260906-3f38495f`: 45 commits outside main; 45 local-only.

  Old backup with 43 ordinary patches equivalent to main. Remaining differences include historical documentation and generated metadata; do not merge again based on SHA counts.

- `feat/public-product-presentation`: 53 commits outside main; 53 local-only.

  Old open-world production branch with 45 ordinary patches equivalent to main. Remaining source, rules, protagonist, story-architecture, and documentation differences need comparison with later implementations.

- `feat/text-open-world-product-architecture`: 38 commits outside main; 38 local-only.

  Old open-world architecture, partly superseded by later implementation. Not 38 missing features; do not restore obsolete product boundaries.

- `refactor/storyforge-bronze-ui`: 3 commits outside main; 0 local-only.

  Pushed historical UI branch, with [PR #84](https://github.com/yuanbw2025/storyforge/pull/84) still open. It does not replace current interface instructions.

## Uncommitted work and archive deduplication

- `feat/builtin-games-release`: 72 status entries observed across built-in works, entry points, assets, dependencies, and documentation, related to the now-merged migration in PR #111. Retain these as old-worktree differences, not a file-count measure of missing features. Staged and unstaged files are not an accepted release snapshot.
- `codex/wechat-articles-screenshots-20260922`: two uncommitted home/workspace CSS files; screenshot adjustments still need to be distinguished from product changes.
- `feat/character-chat-recording`: all 78 untracked entries are under `.vite-e2e-cache/`, classified as test cache only.
- `feat/character-chat-optimization-20261006`: no independent feature commits or uncommitted files at audit time. A branch name does not prove completed optimization.

Earlier cleanup authorized by the maintainer removed 74 old branch references and moved 33 old worktrees into an archive directory. A remaining directory does not mean its branch is active. Archived detached `c5e04d3c` contains only unique merge history with no file difference against the merge base. The September 12 UI rebuild at detached `e08ffd7e` was explicitly retired by the maintainer and is no longer treated as pending delivery. Equivalent patches from old text-adventure revisions have been deduplicated and are not proposed for merging again.

This maintenance does not commit, push, merge, or clean up the development work above, or modify author browser data. The full historical record remains in the [2026-10-04 audit snapshot](/en/updates/development-status-20261004), excluded from local search and not a current to-do list.

## Synchronizing the baseline on every run

Each maintenance run fetches current remote references, then synchronizes its maintenance branch with the latest main and checks new changes. Fetching alone does not update the working branch. Recheck main before committing and merging; when it advances, inspect the added changes and repeat affected validation. Author worktrees are inspected read-only; maintenance runs in a separate worktree.

Continue: [Changelog](/en/updates/changelog) · [Compatibility](/en/updates/compatibility).
