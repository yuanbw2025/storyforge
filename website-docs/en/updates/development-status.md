# Pending development and branch audit



## October 28, 2026 · Merged chains and existing-branch review

Reviewed remote main `46a90c0b` from successful maintenance baseline `7b974fbf`. The inventory covers **127 local branches and 65 existing registered worktrees**, including this maintenance branch and detached checkouts. Heads of 30 branches are not ancestors of main. Existing content and earlier evidence are reviewed without recreating cleaned development directories; fewer branches do not establish lost functionality.

### Merged work and instructions

- Text-adventure [#208](https://github.com/yuanbw2025/storyforge/pull/208) (`69e2a928`), chapter instructions/themes [#209](https://github.com/yuanbw2025/storyforge/pull/209) (`ddd673eb`), and model configuration [#217](https://github.com/yuanbw2025/storyforge/pull/217) (`f9deb5e3`) are merged. Instructions cover [navigation](/en/features/interactive/text-adventure), [chapter requirements](/en/features/longform/writing), and [model IDs/usage](/en/getting-started/model-config). Custom IDs are no longer silently substituted, and missing usage remains unknown.
- TTRPG [#196](https://github.com/yuanbw2025/storyforge/pull/196) (`301d38ef`), character chat [#172](https://github.com/yuanbw2025/storyforge/pull/172) (`42e4fdf1`), and AVG [#219](https://github.com/yuanbw2025/storyforge/pull/219) (`d4f92c80`) are merged, not wholly pending branches. Guides cover experimental entry points, media adoption, prototypes/sessions, and recovery while retaining preview catalog status. Engineering success does not upgrade TTRPG long-session/listening, chat stable multi-turn/cross-image consistency, or AVG professional-story/commercial-art acceptance.
- Story-stage reading and explicit repair [#226](https://github.com/yuanbw2025/storyforge/pull/226) merged as `bcdf9463`; see [prose instructions](/en/features/longform/writing#recovering-malformed-story-arc-stages). Malformed-writing origins, native exits, and other longform issues remain separate.
- [#210](https://github.com/yuanbw2025/storyforge/pull/210) and [#220](https://github.com/yuanbw2025/storyforge/pull/220) contain phase handoff/delivery records; traffic archives contain statistics. None counts again as product functionality. Current schema is v13 and backup v17. See [compatibility](/en/updates/compatibility) for formal v4.0.4 and later candidate scope.

### Pending delivery or review

| Branch / head | Scope | State and deduplication |
| --- | --- | --- |
| `fix/longform-state-card-recovery-20261026` · `1d758d2f` | Longform malformed reads, editing, candidate saving/adoption, and startup recovery | [Draft PR #215](https://github.com/yuanbw2025/storyforge/pull/215) is pushed and unmerged, with a clean worktree. Original failures remain distinct from current-head evidence. Its 160-item matrix retains 72 in progress, 88 pending, and zero wholly accepted items, not resolution of all faults. |
| `fix/longform-step-stability-plan-20261026` · `6860b23d` | ST00–ST07 function-level repair and acceptance plan | [Draft PR #212](https://github.com/yuanbw2025/storyforge/pull/212) is unmerged. A plan is not implemented functionality or final validation of #215. |
| `fix/client-release-4.0.5-20261028` · `1b31536e` | Version-bound old/new client fixtures, backup conversion, and signed upgrade inputs | Open [PR #228](https://github.com/yuanbw2025/storyforge/pull/228) is pushed and unmerged. Candidate inputs are not a public formal release. They correspond to that PR's frozen source; later main changes are not automatically included, and older candidate platform results do not validate the final tree. |
| `fix/state-card-context-20261026` · `6ff319e2` | Earlier local malformed-state-card read guards | Two commits are not contained by origin, including one merge/metrics-only update. The maintenance theme overlaps #215, but file equivalence is unproven. Preserve source/differences without counting another delivered feature or pushing it. |

Of three worktrees with status entries, two contain working-file changes and one only test caches. `wechat-articles-screenshots` has two promotional UI style changes. Older `storyforge-builtin-games-release` retains unfinished historical integration: 47 of 72 entries match current main blobs, while 25 retain differences, not 72 new features. The archived character-recording directory's 78 entries are only test caches. Historical backups, built-in works, identical heads, merge-only commits, and equivalent patches remain deduplicated through evidence. This maintenance did not take over, clean, commit, or merge other product work or run product tests.

## 2026-10-27 · First step-mode stability repairs

[PR #215](https://github.com/yuanbw2025/storyforge/pull/215) depends on [plan #212](https://github.com/yuanbw2025/storyforge/pull/212); both remain unmerged. This batch adds explicit malformed-state repair, original export and concurrent-write protection; durable prose-candidate saves and a navigation barrier; and reachable candidate actions when the toolbar previously covered them at 320px. Invalid values and sparse arrays are rejected before formal writes.

Product source `82436e01` passed complete CI: 928 files, 5,649 tests passed and three skipped. The full isolated browser suite passed 347 with five skipped. Another 74 targeted regressions and six touch-viewport paths at 390/320px passed. Two real Agnes chains passed, including one on final source. A separate HTTP-200/no-candidate result and an unconfirmed transport failure remain recorded with unknown usage.

Windows/Android repair packages, upgrades, native Crash/OOM and release remain unverified. Engineering success does not complete all 158 full-scope cases. See [continuity and repair](/en/features/longform/continuity).

## October 26, 2026 · Follow-up development review

Reviewed remote main `63af1fba` from successful maintenance baseline `648b6746`. Main only adds traffic archives, so product guides retain the preceding delivered instructions. This round re-enumerates **196 local branches and 114 worktrees**, including the maintenance branch and detached checkouts; heads of 136 branches are not ancestors of main. The following is a snapshot of new progress. Older dated sections remain historical records.

| Branch / reviewed head | Progress | Current state and deduplication |
| --- | --- | --- |
| `fix/adventure-ui-integration-20261026` · `42caa40b` | Text adventure reuses the product shell, preserves workspace/save navigation, and prevents stale loads from replacing the current page | The earlier seven uncommitted files advanced into [draft PR #208](https://github.com/yuanbw2025/storyforge/pull/208), with a clean worktree; they are no longer reported as that same uncommitted batch. The occasional whole-window crash remains unreproduced. New-head checks await their terminal result; earlier failures or cancellations are not passes. |
| `fix/chapter-prompt-theme-20261026` · `0b1cbd51` | Multiline instruction confirmation before chapter generation/continuation; cancelling retains temporary input without a model call; improved themed helper-text contrast | Open [PR #209](https://github.com/yuanbw2025/storyforge/pull/209) is pushed and unmerged, with a clean worktree. It retains the candidate/author-adoption chain without a new model entry. Product checks follow that final head; this maintenance does not rerun or troubleshoot them. |
| `fix/chat-narrative-flow-20261023` · `86318826` | Content, system-settings, and media tracks assemble together; real production images and story-driven runtime pictures include failure recovery and save ownership | [Draft PR #172](https://github.com/yuanbw2025/storyforge/pull/172) is updated and pushed. Previously local `6ce48b22` is now its ancestor, not an unpushed feature. The worktree is clean. The technical path has real model/image records, while 429 responses, domain rejection, and cross-image consistency limits remain; this is not stable continuous-dialogue or human acceptance. |
| `feat/ttrpg-entity-ai-20261016` · `ff7fcb4e` | Integrates open-world #134 and knowledge-base #206 while retaining product-specific source, recovery, and runtime contracts | Open [PR #196](https://github.com/yuanbw2025/storyforge/pull/196) is unmerged; the head is pushed and its worktree clean. World implementation matches main. Historical failures and new receipts remain separate. More than 30 turns, independent human evaluation, and listening quality still await verification. |
| `feat/avg-media-integration-20261021` · `2d756dd5` | Bounded read-only audio-input calibration and a final integration acceptance objective; main integration in progress | The local head has one objective-document commit not contained by origin. `avg-extension-contracts-20261015` has `MERGE_HEAD=63af1fba`. Of 262 status entries, 243 working files match main blobs; the remaining 19 cover shared production, recovery, registries, package version, and regression integration differences, not 262 new features. [Draft PR #160](https://github.com/yuanbw2025/storyforge/pull/160) remains at `534b3812` and does not establish delivery of later integration work. |
| `fix/open-world-pr134-handoff-20261026` · `ab408ba4` | PR134 stage summary and continuation links for the completed central route and deferred acceptance | Open [PR #210](https://github.com/yuanbw2025/storyforge/pull/210) only updates internal handoff documents and remains unmerged. It is not a new player feature or a substitute for deferred calibration and two human-played endings. |

The 22 worktrees with status entries comprise **8 with working-file changes, 13 retired-static-asset validation copies, and 1 test-cache-only directory**. Every deletion in the 13 copies matches its retirement manifest and HEAD blob. The archived character-recording directory contains only test caches and is classified separately, not as new product development. The two AVG audio worktrees retain 31 and 33 entries, and the older media-recovery worktree retains 100. The original chat worktree retains three plan/acceptance entries. Shared heads, ancestry, historical backups, and confirmed equivalent patches remain deduplicated. No other development was committed, pushed, merged, or cleaned by this maintenance.


## October 26, 2026 · Complete review

Reviewed remote main `51688aee` from the last successful maintenance baseline `c5a1cab7`. The inventory covers **194 local branches, including this maintenance branch, and 114 associated worktrees**, including detached checkouts. Heads of 133 branches are not ancestors of main. Counts are not feature counts. Full branches, paths, commits, differences, and deduplication evidence remain in the maintenance record. Older dated sections retain their historical snapshots; this section provides the current review.

### Merged into main

- [PR #195](https://github.com/yuanbw2025/storyforge/pull/195) merged as `87eec76a`: module-load recovery saves edits before reloading and keeps the page open when saving fails. See [troubleshooting](/en/guides/troubleshooting#retrying-a-failed-module-load).
- [PR #197](https://github.com/yuanbw2025/storyforge/pull/197) merged as `7cfdf8d9`: narrative-world engineering, sources, querying, sealing, and impact checks are integrated. Enhanced entries remain explicit local-development previews. The original narrative-world chain is no longer wholly pending merge. Semantic accuracy, formal scale performance, reader completeness, and author revision/time acceptance remain incomplete. See the [world engine](/en/features/world-engine#local-experimental-narrative-world-preview).
- [PR #201](https://github.com/yuanbw2025/storyforge/pull/201) merged as `dc0f1e3a`: invalid character-candidate edits show an error and block adoption; native historical failures are deduplicated by occurrence. This does not close underlying native crashes, unexpected interruptions, or memory issues.
- The large-contract repair shipped in formal v4.0.4 through #185/#190, and bilingual release facts in #189/#191 are merged. The current formal release remains **v4.0.4**. See [compatibility](/en/updates/compatibility) for later main increments and database v12. Other traffic archives are not product features.

- Before committing, main advanced to `51688aee`: [PR #134](https://github.com/yuanbw2025/storyforge/pull/134) is normally merged. Open-world three-track production, per-image review, child-build repair, and local experience records are no longer pending merge. The [guide](/en/features/interactive/open-world) is synchronized. Build18 remains an unpublished preview; completing its central route on the same save does not replace two endings, independent-model calibration, or human acceptance.

### New or advancing work awaiting delivery

Unpushed status uses all origin refs fetched this round. Uncommitted entries describe observed scope, not completed work. This maintenance does not commit, push, or merge product branches.

| Branch / head / worktree | Observed scope | State and deduplication |
| --- | --- | --- |
| `feat/avg-media-integration-20261021` · `cd0865b6`; `avg-extension-contracts-20261015/storyforge` | Two-source image region editing, bounded local expression processing, composite adoption, and portrait playback | The integration head is pushed, but [draft PR #160](https://github.com/yuanbw2025/storyforge/pull/160) remains at `534b3812`; it does not establish review or integration of these increments. The worktree has 6 additional documentation, AVG style, and voice-regression changes. Older image/audio/foreground branches form related dependency or validation chains, with differences retained rather than counted as separate products. |
| `feat/avg-audio-consumption-20261022`, `feat/avg-audio-derived-production-20261022` · `17c9081f`; `avg-base00a-20261014`, `avg-base00b-20261014` | Voice production/review, audio processing/consumption, partial-recovery controls, and regression material | The same-head worktrees retain 31 and 33 uncommitted entries. These are not completed new features. Older `avg-media-recovery-20261016` retains 100 entries; `avg-media-harness-20261016` has 2 style/regression changes. Some older local branches still have unpushed commits; patch, dependency, and file comparisons deduplicate their scope without submitting it. |
| `fix/chat-narrative-flow-20261023` · `2bece4d0`; original character-chat branch `26fd6e29` | Single-character technical preview of opening-action attribution, evidence references, expression, and first-turn recovery | [Draft PR #172](https://github.com/yuanbw2025/storyforge/pull/172) advanced to `2bece4d0` and remains unmerged. Original chat and compatibility branches belong to the same successor chain. Real-model records retain budget stops, upstream failures, and domain rejection, without claiming multi-turn quality acceptance. The local narrative-flow head advanced to unpushed `6ce48b22`, concerning image binding and text-task routing. Its worktree has 5 additional uncommitted production-service/UI/media-regression changes; the original chat worktree has 3 plan/acceptance entries. |
| `feat/ttrpg-entity-ai-20261016` · `b372c41d` | Open TTRPG author design, production, release/session creation, private play, and local narration preview, speed, and voice selection | Pushed to open [PR #196](https://github.com/yuanbw2025/storyforge/pull/196), unmerged, with a clean worktree. The old snapshot's 12 unpushed commits and 18 uncommitted entries no longer describe it. Later database/backup bridging belongs to this PR. More than 30 turns, independent human evaluation, and listening quality remain unverified. Local Qwen synthesis requires an Apple Silicon Mac with its runtime configured. |
| `feat/project-governance-api-20261023` · `5f0ff1a5` | Development governance and local API reader contract documents | Two commits outside main are pushed but unmerged. These are engineering rules, not user product features; local API configuration remains private. |

`fix/adventure-ui-integration-20261026` is at main ancestor `dc0f1e3a`. Its `adventure-branch-transcript/storyforge` worktree has 7 uncommitted text-adventure player, product-frame, navigation, loading, and regression files. This records observed scope without claiming completion.

### Preservation and deduplication

Excluding this documentation worktree, of 24 worktrees with status entries, **11 contain working-file changes**. The other 13 are old TTRPG validation copies: every deletion matches `.codex-retired-assets.json` and its HEAD blob. Retired static assets are not missing product code. No copy was taken over or cleaned.

Historical backups, old UI, built-in works, merge-only commits, shared heads, and equivalent patches remain deduplicated. Narrative-world engineering and the large-contract repair already accepted by main are not requested again. Retained branches do not by themselves establish new features. This round runs only directly relevant documentation content, bilingual, link, and build checks, without product tests.

## October 23, 2026 · Large-contract repair formally delivered

This section updates release status only, without re-auditing the other development branches below. [PR #185](https://github.com/yuanbw2025/storyforge/pull/185) merged as `e4f2496d`, and [release preparation PR #190](https://github.com/yuanbw2025/storyforge/pull/190) merged as `8e82486a`. The independent [release workflow](https://github.com/yuanbw2025/storyforge/actions/runs/39873499281) passed every job, and formal **v4.0.4** is public at fixed source `d90961a2`. The large run-contract repair is no longer awaiting release and is not included in v4.0.3. Exact publication time, upgrade and data boundaries live in [version compatibility](/en/updates/compatibility). The complete October 22 branch review below remains a dated snapshot; this release does not establish completion of other issues or products.


## October 22, 2026 · Complete branch and worktree review

Reviewed from the last successful baseline `50062745` through remote main `463b6473`. The inventory covers **186 local branches, including this maintenance branch, and 115 related worktrees**, including detached checkouts; 136 development heads are not ancestors of main. Commit and file counts are not feature counts. This is a dated snapshot; full paths, hashes, ancestry, patches, and working-file evidence are retained in the maintenance record.

### Entered main

- [PR #171](https://github.com/yuanbw2025/storyforge/pull/171) merged as `47d2c665`, preserving predecessor snapshots during detailed-outline generation and handling missing style statistics. This update adds [outline recovery steps](/en/features/longform/writing#continuing-after-detailed-outline-generation-stops) and [style statistics guidance](/en/features/longform/style-learning#when-sample-statistics-show-not-recorded); these are no longer pending features.
- [PR #184](https://github.com/yuanbw2025/storyforge/pull/184) merged as `463b6473`, adding a sanitized public issue, repair, release, and writeback workflow and preparing v4.0.3. The stable release remains v4.0.2 while the [v4.0.3 release workflow](https://github.com/yuanbw2025/storyforge/actions/runs/39765160155) runs. Version facts live in [compatibility](/en/updates/compatibility).
- Other mainline changes concern delivery verification, verification dates, and traffic archives; they do not add product operations or raise maturity. Existing guides retain the merged #141/#165/#166 scope.

### New or advancing development

“Unpushed” means not contained in any fetched origin ref. Uncommitted observations establish scope only, not completion or acceptance.

| Branch / head / worktree | Observed scope | Status and deduplication |
| --- | --- | --- |
| `feat/avg-media-integration-20261021` · `88bfaea4`; `feat/avg-audio-consumption-20261022` and `feat/avg-audio-derived-production-20261022` · `17c9081f` | Foreground and PCM audio foundations, per-line gain drafts, adopted processed-voice consumption, portrait layout, and retained recovery | `88bfaea4` has 15 commits outside fetched origin refs, including 13 non-merge commits. Audio, foreground, and image branches share dependencies or validation history. Pushed [draft PR #160](https://github.com/yuanbw2025/storyforge/pull/160) remains at `534b3812` and does not deliver later local commits. |
| `avg-base00a-20261014/storyforge` and `avg-base00b-20261014/storyforge` · `17c9081f`; `avg-extension-contracts-20261015/storyforge` · `88bfaea4` | Voice production/review, audio processing/consumption, local repair controls, plans, and regression material | Respectively 31, 33, and 24 uncommitted entries include untracked or staged changes. Equal-head copies still contain different working files; preserve each. `avg-media-harness-20261016` has two additional style/regression changes; the earlier 100-entry `avg-media-recovery-20261016` observation remains. |
| `feat/character-chat-optimization-20261006` and `fix/chat-regression-compat-20261022` · `26fd6e29` | Grounded story actions, unanswered inquiries across turns, opening review, and recoverable production | Pushed [draft PR #172](https://github.com/yuanbw2025/storyforge/pull/172), not merged. Its 270 commits outside main are not 270 features. Both branches share one head; the author worktree has two plan/acceptance changes and the compatibility worktree has five history-reader/test changes. Uncommitted material is not declared complete. |
| `feat/ttrpg-entity-ai-20261016` · `34fc430a`; matching worktree | Explicit methods and versioned Oracle budgets, clue sharing, pending-stage policy, next stages in frozen releases, and compatible-session continuity | Of 216 commits outside main, 12 are not contained in fetched origin refs. Another 18 uncommitted entries concern open authoring/compatible openings and plans. Existing ownership and candidate boundaries remain; no unilateral commit, push, or merge. |
| `feat/text-open-world-productization-20261013` · `d330c653`; `open-world-productization/storyforge` | Three production lanes, image confirmation, web distribution, local feedback, and main synchronization | [PR #134](https://github.com/yuanbw2025/storyforge/pull/134) remains open. The one commit not contained in origin is a merge; there are no new unpushed non-merge commits. Actual `MERGE_HEAD=463b6473`; 16 of 22 status entries have exactly the same blob as main. Remaining changes include version, metrics, and both change logs. Synchronization files are not new open-world features. |
| `fix/agent-contract-event-size-20261021` · `9653011a` | One finite UTF-8 byte budget for valid contracts and accepted/revised event snapshots | [PR #185](https://github.com/yuanbw2025/storyforge/pull/185) merged normally on October 22, 2026 as `e4f2496d`. Final full CLI passed 4602 tests, browser passed 311 with 4 environment-dependent skips, and regular CI succeeded. [Issue #178](https://github.com/yuanbw2025/storyforge/issues/178) awaits formal v4.0.4 delivery; v4.0.3 does not include this repair. |
| `narrative-world-design`, `nw2e-retrieval-repair`, and `nw-mainline-refresh-20261016` | Existing narrative projection, provenance, retrieval, governance integration, and extensive acceptance material | The chain remains outside main. The actual merge parent of `nw-mainline-refresh` is `16b006fd`. Many untracked acceptance outputs and synchronization files do not establish new features. Equivalent design/backup patches, identical heads, and ancestry remain deduplicated; worktrees are not taken over or cleaned. |

### Preserved and deduplicated work

Of 28 worktrees with status entries, 14 contain working-file changes, 13 contain registered retired static assets in old TTRPG validation copies, and one contains only test cache. Each deletion in the thirteen copies was again matched to `.codex-retired-assets.json` and its Git blob; these are not pending code and are not automatically restored. Earlier deduplication of merged longform work, historical UI, built-in works, backups, merge-only history, and equivalent patches is retained.

This run maintains the knowledge base only, without product tests or changes to other development. Older dated sections below remain historical snapshots; current status is described above.



## October 20, 2026 complete review

This review covers successful maintenance baseline `9e480ac7` through remote main `38104e61`. It enumerated **175 local branches (including maintenance) and 112 associated worktrees**, including detached ones; 127 heads are not main ancestors. Branches, commits, and working-file entries are not feature-completion counts. Full paths, commits, patches, and differences are retained in the maintenance evidence.

### In main

- [PR #165](https://github.com/yuanbw2025/storyforge/pull/165) merged longform entry consolidation, replacement, and save protection as `a45cb1db`; [PR #141](https://github.com/yuanbw2025/storyforge/pull/141) merged system-fiction planning, whole-chapter review, and scoped revision as `1b96e80a`. These formerly pending capabilities have [longform](/en/features/longform/), [planning](/en/features/longform/planning), [prose/revision](/en/features/longform/writing), and [node](/en/features/nodes) guidance and are no longer listed as missing features.
- [PR #166](https://github.com/yuanbw2025/storyforge/pull/166) merged as `b344cc0b`. This run adds [handling steps](/en/features/longform/writing) and the [changelog](/en/updates/changelog) for continuation preparation errors and retained candidates after failed outline rejection.
- Longform delivery documentation in [PR #169](https://github.com/yuanbw2025/storyforge/pull/169) merged as `66763953` and deployed. Its independent evaluation status is retained; engineering checks do not establish literary benefit.
- The latest formal release remains [v4.0.2](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.2), fixed source `04de86d7`. Version facts are centralized in [compatibility](/en/updates/compatibility). Traffic CSV archives are not product capabilities.

### Active branches and worktrees

This is a review-time snapshot. “Unpushed” means absent from all fetched origin refs. Uncommitted content is observed scope, not completion, and is not committed, pushed, or merged for its author.

| Branch / head / worktree | Scope | State and deduplication |
| --- | --- | --- |
| `feat/avg-combined-stage-20261020`, `feat/avg-publisher-stage-release-20261020`, `feat/avg-v5-native-workbench-20261019`, `feat/avg-v5-review-validation-20261018` · `534b3812` | Image/audio production workbench, visual plans/local derivatives, fixed voices/local music, author configuration, prototype releases, successor sound versions, frozen recovery | Pushed to [draft PR #160](https://github.com/yuanbw2025/storyforge/pull/160), unmerged. V5 configuration/media/history/sound branches form a dependency chain; identical heads are not separate capabilities. |
| `feat/avg-combined-native-20261020`, `fix/avg-pending-voice-recovery-implementation-20261020`, `fix/avg-pending-voice-recovery-revision-20261020` · `f44bf5f8`; `feat/avg-foreground-processing-contract-20261020` · `d08d2610` | Ambient-audio source/license admission, generated-voice write scope, one-shot audio restoration, independent interrupted-channel recovery; foreground-processing work-package design | Six commits on the `f44bf5f8` chain are absent from origin refs. `d08d2610` inherits that chain and adds one design-document commit, not an implemented foreground-processing feature. Integration/verification branches `55ea0efa`, `f451b4d9`, `a8e8d961`, and `628f6f1f` retain their own differences/evidence; shared scope is deduplicated. |
| `avg-base00a-20261014/storyforge`, `avg-extension-contracts-20261015/storyforge`, `avg-media-harness-20261016/storyforge` · `f44bf5f8`; `avg-media-recovery-20261016/storyforge` · `4b40877b` | Audio-recovery controls, assembly/material, verification cases/CI/display styles; older media-processing/recovery work | Respectively 2, 9, 14, and 100 uncommitted entries. The first three share a commit baseline but different working files; copies are not overwritten or merged. The fourth retains its earlier observed scope. Entries are not accepted features. |
| `feat/character-chat-optimization-20261006` · `2a2aae10`; `character-chat-plan/storyforge` | Player media, package workflows, recoverable session navigation; working files also concern action choice/budgets, control handoff, opening continuation/repair, source observations | All 239 commits outside main are absent from origin refs, including 231 non-merge commits. No matching open PR. Another 252 uncommitted entries include implementation, design, cases, and verification material. Development has advanced since the previous review; its author still needs to reconcile completion. Temporary verification heads are ancestors of the same chain. |
| `feat/ttrpg-entity-ai-20261016` · `0c99f468`; `ttrpg-entity-ai-20261016/storyforge` | Open production, original-request/voice recovery, two local voices, restoring rejected author input without confirming it, purpose-bounded output | Pushed; [draft PR #128](https://github.com/yuanbw2025/storyforge/pull/128) unmerged. Memory/situation/recap/sound branches are a dependency chain. Thirty-five additional uncommitted entries concern action inputs, public situations, call evidence, and original-request recovery; observed scope only. |
| `feat/text-open-world-productization-20261013` · `aa8f6d2b`; `open-world-productization/storyforge` | Three-track production, image confirmation, human review, local feedback, production/budget recovery | Pushed; [PR #134](https://github.com/yuanbw2025/storyforge/pull/134) unmerged. Its worktree is merging main `fe87ece4`; 144 status entries include synchronization and product changes. Comparison with the actual merge parent is retained rather than counting every entry as a new feature. |
| `feat/narrative-domain-projection-20261014`, `feat/narrative-reader-provenance-20261015` · `16b006fd`; `feat/narrative-world-integration-20261016` · `8197579a` | Narrative projection, IR, semantic indexing, exact reads, provenance, adoption/lifecycle integration | Five commits outside main remain local only, including one merge. `narrative-world-design`, `nw2e-retrieval-repair`, and `nw-mainline-refresh-20261016` retain uncommitted development and substantial verification material. Their earlier undelivered state is unchanged; more outputs are not new features. Identical-head design copies/equivalent patches remain deduplicated. |

### Deduplicated and preserved work

Longform and Q01–Q10 development entered main through #141. `e95f188d`, `f44ef5c6`, and `3521a8d4` are patch-equivalent to main. Remaining old verification branches contain test synchronization, verification, or historical documents rather than another undelivered longform product. Existing AVG aliases `22bafcf4`, `a522a380`, `969d1928`, and `691154d0` have pushed equivalents. Production/test files in `023310fb` match later `e2a0ae36`; prior equivalence evidence is retained.

Of 26 worktrees with status entries, **12 contain working-file changes, 13 have retired static assets in old TTRPG verification copies, and one contains only test cache**. Every deletion in the thirteen copies was again matched to `.codex-retired-assets.json` and its Git blob; they are not unsubmitted code and are not automatically restored. Old built-in-game and promotional-CSS scopes retain earlier conclusions; #111 already delivered the built-in works. Historical Fog Harbor, world-media, old open-world, bronze UI, backup, and explicitly abandoned September 12 UI branches are not proposed for merging again.

This run only maintains the public knowledge base, without product tests or author-branch/worktree/browser-data changes or cleanup. Older dated sections below remain historical; current state is described above.

## October 20, 2026 · Longform quality changes entered main

[PR #141](https://github.com/yuanbw2025/storyforge/pull/141) merged as `1b96e80a` on October 20. System-fiction elements, scene tasks, whole-chapter review, and scoped revision are no longer pending development. Instructions now live in [planning](/en/features/longform/planning) and [prose and revision](/en/features/longform/writing); see the [change log](/en/updates/changelog) for version boundaries. Node mode as a whole remains a preview.

Head `fb682a28` passed complete CLI checks (824 files / 4594 tests), complete browser checks (309 passes / 4 environment-dependent skips), and regular CI on the latest main merge tree. Three settings with two ten-chapter workflows each, totaling 60 manuscripts / 30 pairs, plus 12 openings / 6 pairs from new settings and two service models have request, workflow, and lifecycle verification. Poor drafts and failures are retained. The user moved independent reader review and independent author timing to optional follow-up research, so this delivery requires no recruitment. Missing outcomes are not passes; independent quality and time benefits remain unverified. Exposed experiment labels and omitted optional review instructions in sampling limit interpretation; these are not strict blinded tests or platform-quality certification.

Older dated sections below retain their historical branch snapshots. This section supersedes statements that #141 remains unmerged and does not reassess other development branches.

## October 19, 2026 · Longform author-feedback iteration (development branch)

[PR #141](https://github.com/yuanbw2025/storyforge/pull/141) continues to address character reactions, responsive dialogue, and endings exposed by actual author repairs. Generation, whole-chapter review, scoped revision, and recheck share the existing strategy and explicit adoption chain. Reviews distinguish internal contradictions, omitted explicit task requirements, and optional expression preferences, so polishing does not silently remove important conditions. Four internal author micro-scene repairs have been returned; they do not establish independent formal literary benefit or lower repair cost.

In prose Quality review (质量审校), enter separate requirements in Review instructions (本轮评审补充要求) and Revision instructions (本轮修稿要求). Select actual issues, allowed paragraphs, and protected quotations before one revision and one recheck. Saved reports and comparisons show the instructions actually used and recover after refresh. Authors still judge model suggestions; failures, unknown outcomes, and older candidates retain their recovery and freshness boundaries.

Complete engineering checks passed for earlier source `1b854005` (4495 tests, 3 production-agent checks, 293 browser passes / 2 skips). New commits integrating main must be verified at their actual head; see PR evidence. This branch remains unmerged, undeployed, and absent from existing downloads. Older dated sections below remain historical snapshots.

## 2026-10-19: Candidate character-chat flows {#character-chat-candidate}

This section checks only `feat/character-chat-optimization-20261006`: its committed baseline is `a4f16fd9`, followed by observed uncommitted character-chat changes. They have not been merged into main, included in a fixed download, or publicly deployed. The October 16 “clean worktree” record below describes that earlier snapshot only.

Candidate interfaces add pictures and device speech, external character-card conversion, complete experience-package installation/export, save copies for compatible versions, and three original starter drafts hidden by default. Upgrades retain the original save; story or character-knowledge changes cannot be forced onto it. Starter drafts still require the author to review sources, produce, and publish; they are not delivered experience packages. See the candidate instructions in [Character chat](/en/features/interactive/character-chat#new-flows-in-the-development-branch-unreleased).

The previous integration candidate passed 402 browser cases with four environment-dependent skips. Full CI had five timeouts; those cases passed unchanged targeted diagnostics, but that does not complete full CI. The latest fetched main `d3df49a3` adds shared adoption and longform changes, so the combined version requires fresh engineering validation. Real-model story quality and independent playtesting remain unfinished. Passing engineering load tests does not establish story quality or commercial acceptance. This section does not reassess other product branches.

The candidate also includes authorship and usage statements frozen with each release, and fixes installation numbering that could break a complete backup when a newer version was installed first. Full validation remains in progress.

## October 18, 2026 review

This review covers successful maintenance baseline `404ee3bf` through latest remote main `9cc1f4cf`. It enumerated **136 local branches (including maintenance) and 112 associated worktrees**, including detached ones; 102 branch heads are not main ancestors. Git identities are not missing-feature counts. Full branch, path, commit, patch, and working-file differences are retained in this maintenance evidence.

### Delivered changes and instructions

- [PR #153](https://github.com/yuanbw2025/storyforge/pull/153) merged into main as `8197579a`. [v4.0.2](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.2) was published on October 16 at fixed source `04de86d7`, with Windows/Mac installers, an Android APK, and four portable ZIP targets. [Installation](/en/getting-started/install) covers platform selection, the first-run agreement, updating and backups.
- General settings → Problems and suggestions provides Report a problem and Feature suggestion, sent to a private maintainer inbox with optional previewed diagnostics. The fallback website form creates a public GitHub Issue. This run corrects outdated “in development” wording and completes the [steps](/en/guides/troubleshooting#problems-and-failure-reports-in-downloaded-builds) and [privacy information](/en/guides/privacy).
- The wording correction in [PR #162](https://github.com/yuanbw2025/storyforge/pull/162) is merged and deployed. Other main commits over these two days archive traffic data rather than add product features.

### Active and undelivered development

| Branch / reviewed head | Observed scope | State and deduplication |
| --- | --- | --- |
| `feat/avg-v5-formal-foundation-20261018`, `feat/avg-versioned-planning-validation-20261018`, `feat/avg-visual-recovery-20261017` · all `b5a2f629` | Professional media purposes and character/prop families, visual plans and request compilation, retained/imported/recovered originals, explicit reuse and new versions, read-only historical verification, cost/failure evidence and voice-production handoff | Pushed to [draft PR #160](https://github.com/yuanbw2025/storyforge/pull/160), unmerged. Visual/history/original/local-processing branches form a dependency chain; three identical heads count once. `avg-extension-contracts-20261015/storyforge` has 34 uncommitted entries concerning versioned visual plans, sources and assembly; observed scope only. |
| `feat/avg-media-recovery-20261016` · `4b40877b`; `avg-media-recovery-20261016/storyforge` | Media workbench, governed image processing, assembly, adoption and recovery | Head pushed but outside main; the worktree has 100 additional uncommitted code/test entries, not proof of a completed feature. Shared AVG foundations with the previous row are not counted repeatedly. |
| `feat/character-chat-optimization-20261006` · `a4f16fd9`; `character-chat-plan/storyforge` | Role direction, actions/history, relationships/private memory, consultations and sources; worktree changes also concern conversation scope, audience, opening review, private characters and runtime recovery | All 233 commits outside main are absent from origin refs, including 226 non-merge commits. No matching open PR. Development has advanced since the previous review and has 162 additional uncommitted entries. Temporary verification heads are ancestors, not separate implementations. |
| `feat/ttrpg-entity-ai-20261016` · `9e053308` | Entities within templates with individual confirmation, situation adoption, original voice jobs, review and playback; the latest commit completes original voice generation after explicit personal review | [Draft PR #128](https://github.com/yuanbw2025/storyforge/pull/128) is pushed through `9e053308` and remains unmerged. A fresh fetch before documentation submission confirmed that the latest voice-review commit is included. Memory, recap, situation and voice branches share the same chain. Plan [#124](https://github.com/yuanbw2025/storyforge/pull/124) and shared read foundation [#150](https://github.com/yuanbw2025/storyforge/pull/150) are also unmerged. |
| `feat/narrative-domain-projection-20261014`, `feat/narrative-reader-provenance-20261015` · `16b006fd`; `feat/narrative-world-integration-20261016` · `8197579a` | Committed NW-0B/1A/1B foundations; worktrees retain semantic indexing, projection, exact reads, provenance, candidate adoption, lifecycle and integration changes | Five commits outside main on the first two heads remain local only, including one merge. Same-head design branches and equivalent patches are deduplicated. Three related worktrees have uncommitted changes: `narrative-world-design`, `nw2e-retrieval-repair`, and `nw-mainline-refresh-20261016`. A mainline integration head does not deliver uncommitted development; verification materials and outputs are not feature counts. |
| `feat/text-open-world-productization-20261013` · `aa8f6d2b`; `open-world-productization/storyforge` | Three-track production, image confirmation, human review and local feedback; working changes also concern rules, catalog production, task budgets and recovery | Pushed; [PR #134](https://github.com/yuanbw2025/storyforge/pull/134) unmerged. Thirty-nine uncommitted entries: two working files match latest main, thirty-seven differ. Existing work, main synchronization and current changes are recorded separately without committing for the author. |
| `feat/longform-quality-m2-20261014` · `1b854005`; existing AVG system chain `36b3e55f` | Longform system-fiction requirements, quality review and scoped revision; AVG rules, player, author workbench, assembly and resource windows | Longform [#135](https://github.com/yuanbw2025/storyforge/pull/135), [#141](https://github.com/yuanbw2025/storyforge/pull/141), and AVG [#133](https://github.com/yuanbw2025/storyforge/pull/133), [#137](https://github.com/yuanbw2025/storyforge/pull/137), [#140](https://github.com/yuanbw2025/storyforge/pull/140), [#143](https://github.com/yuanbw2025/storyforge/pull/143) and later system branches remain unmerged, with the same reviewed heads as before. They are not repeated as new omissions. #156/#157 share one head. |

### Equivalent commits, older verification copies, and uncommitted work

These local commits have pushed equivalents: AVG `22bafcf4` → `336b3f6c`, `a522a380` → `537bb309`, `969d1928` → `c2d955db`, `691154d0` → `ad51277b`; longform `3521a8d4` → `ff257777`, `f44ef5c6` → `3ccb0acc`, `e95f188d` → `bcc2c908`. Production code and test files in `023310fb` and `e2a0ae36` are identical; only generated architecture metrics differ. They are not missing new product features.

Twenty-three worktrees have status entries: **nine contain working-file changes**, thirteen old TTRPG verification copies have static assets retired according to `.codex-retired-assets.json`, and one contains only `.vite-e2e-cache/`. Every deletion in those thirteen copies matches the manifest and Git blob; they are not missing product work and are not automatically restored. Among the nine, older built-in-game and promotional-CSS scopes match previous reviews. The old built-in works already entered main through #111 and are not new development.

Historical Fog Harbor, world-media, old open-world, bronze UI and backup branches retain prior conclusions. Merge-only provider history is not a feature; the explicitly abandoned September 12 UI is not proposed for merging again. This run did not commit, push, merge or clean other development, or run product tests. Older dated content below remains historical.

## October 16, 2026 · Client delivery update

The 4.0.2 clients in [PR #153](https://github.com/yuanbw2025/storyforge/pull/153) provide Windows, Mac and Android installers, in-app updates, and a problems-and-suggestions entry. iOS is deferred. First launch directly displays one offline-readable User Agreement containing the personal-information and privacy terms; accepting it opens the application. The agreement remains available in settings, and manual feedback requires review and explicit submission.

See [installation](/en/getting-started/install) for system limitations and use only files actually published on the [v4.0.2 release page](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.2). The review below is a historical branch snapshot; this update and the release page supersede its pending-client status.

## October 16, 2026 review

Incremental range: last successful maintenance baseline `1c6bb315` → remote main `451ac153`. This review enumerated **103 local branches (including maintenance) and 121 associated worktrees**, including detached ones. Seventy-four heads are not main ancestors; twenty worktrees have uncommitted status. These are Git snapshot counts, not features or completion claims. Full paths, commits, file differences, and patch-equivalence evidence are retained in the maintenance record. Author worktrees were read-only.

### Main, fixed packages, and the knowledge base

- The opaque documentation navigation in [PR #139](https://github.com/yuanbw2025/storyforge/pull/139) and explicit failure feedback in [PR #144](https://github.com/yuanbw2025/storyforge/pull/144) are merged and their documentation deployed. Existing bilingual guidance is retained without duplicate feature announcements.
- The latest formal download is [v4.0.1](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.1), fixed source `e8ce0a0d`, with four portable platform ZIPs. It includes local failure-summary previews and explicit author feedback, **not first-launch, daily-active, or retention analytics**.
- The outline adoption fix in [PR #158](https://github.com/yuanbw2025/storyforge/pull/158) merged as `ce49309b` on October 16 in China, after fixed v4.0.1. This run adds the [instructions](/en/features/longform/writing) and [changelog](/en/updates/changelog). Traffic CSV archives are not product features.

### Development outside main

“Local only” means not contained by any fetched origin branch, rather than ahead of an outdated upstream. The following describes observed branch implementations or documentation, not product acceptance by this run, merging, or release. Ancestor and identical-head branches are grouped; historical conclusions remain below.

| Branch / reviewed head | Observed scope | State and deduplication |
| --- | --- | --- |
| `feat/character-chat-optimization-20261006` · `35b5c545`; `character-chat-plan/storyforge` | Role direction, actions/history branches, consultation candidates, private-memory review, source selection, recovery, history reads and cache budgets | All 222 commits outside main are absent from origin refs, including merges/docs, not 222 features. No matching open PR. Worktree currently clean. Ten temporary detached verification heads are ancestors of this chain, not independent implementations. |
| `feat/longform-quality-m2-20261014` · `1b854005` | System-fiction author requirements, optional scene tasks, complete-prose review, scoped revisions/rechecks, prose-draft recovery, shared node flows, reader/author HTML forms | Pushed; [draft PR #141](https://github.com/yuanbw2025/storyforge/pull/141) unmerged. Q01 [#135](https://github.com/yuanbw2025/storyforge/pull/135), Q02–Q10, questionnaire, model-catalog calibration, and quality integration share the same chain, not separate products. This documentation review cannot prove literary quality or human acceptance. |
| `fix/longform-quality-final-docs-20261015` · `3521a8d4`; `fix/longform-chapter-clear-receipt-20261015` · `e95f188d` | Trial documentation, quality milestones, and test waiting adjustments | Respectively two and one commit records are absent from origin refs. Bilingual trial docs have later pushed version `ff257777`; chapter-clear waits have later `bcc2c908`. Review actual documentation/test differences instead of reporting three missing product features. Old copies are not committed or pushed for their authors. |
| `feat/avg-base00a-20261014` · `18218f73`, `feat/avg-base00b-20261014` · `13ce6792`, through `feat/avg-extension-contracts-20261015` · `36b3e55f` | Versioned AVG carriers/legacy compatibility, author rule adoption, deterministic compilation, player/inventory/history, audio barriers, author workbench, assembly, scene-resource windows, prototype release and stage effects | Pushed; [#133](https://github.com/yuanbw2025/storyforge/pull/133), [#137](https://github.com/yuanbw2025/storyforge/pull/137), [#140](https://github.com/yuanbw2025/storyforge/pull/140), [#143](https://github.com/yuanbw2025/storyforge/pull/143), [#145](https://github.com/yuanbw2025/storyforge/pull/145), [#146](https://github.com/yuanbw2025/storyforge/pull/146), [#148](https://github.com/yuanbw2025/storyforge/pull/148)–[#149](https://github.com/yuanbw2025/storyforge/pull/149), [#151](https://github.com/yuanbw2025/storyforge/pull/151)–[#152](https://github.com/yuanbw2025/storyforge/pull/152), and [#154](https://github.com/yuanbw2025/storyforge/pull/154)–[#157](https://github.com/yuanbw2025/storyforge/pull/157) remain unmerged. These are dependency branches; identical-head #156/#157 are not two implementations. |
| `feat/avg-media-production-20261016` · `eab861ce`, `feat/avg-media-harness-20261016` · `4d51e5eb`, `feat/avg-media-recovery-20261016` · `ada77ead` | Owner-scoped reference-image transfer, opt-in image workbench, explicit selection/draft configuration, recovery builds, character families and inherited stage images | Pushed; [draft PR #160](https://github.com/yuanbw2025/storyforge/pull/160) points at recovery chain `ada77ead` and is unmerged. Shared AVG foundations are not counted repeatedly or described as a complete mainline media-production capability. |
| `feat/ttrpg-open-main-integration-20261015`, `feat/ttrpg-public-situation-adoption-20261016`, `feat/ttrpg-public-situation-runtime-20261016` · all `8dc5d3cf` | Open-rule settlement/recovery, private memory/recall, stage recap candidates with explicit confirmation, session-situation catalog, situation generation/review, confirmed-fact handoff for world-author review | Pushed; [draft PR #128](https://github.com/yuanbw2025/storyforge/pull/128) unmerged. Read/memory/recap/situation branches form a dependency chain; identical heads count once. Plan [#124](https://github.com/yuanbw2025/storyforge/pull/124) shares docs; shared read foundation [#150](https://github.com/yuanbw2025/storyforge/pull/150) is also unmerged. The `public-situation-delegation` worktree has eleven uncommitted entries concerning authorization, candidates, adoption and situation checks; observed scope only. |
| `feat/narrative-domain-projection-20261014`, `feat/narrative-reader-provenance-20261015` · both `16b006fd`; `feat/narrative-world-integration-20261016` · `ce49309b` | Committed NW-0B baseline, NW-1A identity/time and IR, NW-1B narrative projection; worktree changes also concern semantic indexing, exact reads, provenance, adoption, lifecycle and integration | All five commits outside main on the first two heads are local only, including one merge. The integration head is in main but its development is uncommitted, so it is not delivered. Fifteen related worktrees, including detached ones, contain overlapping code, verification material and generated evidence; copies/file counts are not features. Design branches share a head and their design patch is equivalent to a chain commit. |
| `feat/client-feedback-metrics-20261015` · `04de86d7`; `feat/windows-android-clients-20261015` · `059cd745` | Windows/Mac/Android clients, in-app updates, first-run agreement, private feedback, user-controlled activity/error analytics, native saving and upgrade handoff | Pushed; [PR #153](https://github.com/yuanbw2025/storyforge/pull/153) and [draft PR #142](https://github.com/yuanbw2025/storyforge/pull/142) unmerged. The later branch's 4.0.2 version does not establish a formal release. Current downloads remain v4.0.1; installation/activity/retention collection cannot be claimed as shipped. |
| `feat/text-open-world-productization-20261013` · `7ebb2fe5` | Three-track production, image confirmation, assembly/publication human review and local feedback; current working changes also concern recovery and production checks | Pushed; [PR #134](https://github.com/yuanbw2025/storyforge/pull/134) unmerged. Of 64 status entries, 49 working files match latest main and are synchronization content; fifteen still differ. Neither all 64 new features nor full completion is established. |
| `fix/test-temp-lifecycle-20261015` · `707b30fd` | Disposable test-directory cleanup and protection for active runs | Pushed; [draft PR #147](https://github.com/yuanbw2025/storyforge/pull/147) unmerged. Engineering tooling, not a new user product. |

### Uncommitted work and historical copies

Of twenty worktrees with status entries, fifteen belong to narrative foundations and verification copies; open-world, TTRPG situations, old built-in games and promotional CSS each account for one, plus one pure `.vite-e2e-cache/` worktree. Verification outputs and repeatedly generated material are not product-development counts. Copies still differ; evidence is retained for their authors without overwriting or cleaning them.

Old built-in works entered main through #111. Historical Fog Harbor, world-media, open-world, bronze UI and backup branches retain the conclusions below. `feat/codex-provider-merge-20261010` has only a unique merge and no new ordinary patch. The September 12 UI was explicitly abandoned and is not proposed for merging again. A historical branch does not justify adopting an old architecture.

This run only updates the public knowledge base. None of the listed product work was committed, pushed, merged or cleaned up; no product tests, full CI or browser regression were run. All older dated content remains as historical snapshots and does not override this section.

## October 15, 2026 · Longform quality development trial {#longform-quality-trial}

This section reviews only system-fiction longform Q02–Q10; other products' snapshots below are unchanged. The product source in [draft PR #141](https://github.com/yuanbw2025/storyforge/pull/141) is `c2836ba8`, unmerged and undeployed. Existing v4.0.0 downloads and the hosted experience do not include these additions. The instructions below apply to that development branch. Node mode remains a preview.

### From elements to prose

1. Select the genre in Work information (作品概况). Open Story design → Creative rules → System-fiction elements (故事设计 → 创作规则 → 系统文元素) and enter the protagonist's situation and goal, system mechanism, rewards and growth, limits and costs, and opposition and relationships. Check Enable these system-fiction author requirements (启用这些系统文作者要求), click Save elements (保存元素), and confirm Elements saved (元素已保存). Fields may be blank. Disabling retains the text; planned rewards do not become acquired items, and your selected prompt template is retained.
2. Select the chapter in Outline and chapter plans (大纲与章纲), then open Scene beats (场景细纲). Expand Optional scene tasks (场景任务（可选，可留白）) to specify entry state, scene goal, key choice, consequences, exit state, and scene function/reader expectations as needed. Everyday, quiet, and ending scenes are supported; enemies and penalties are optional.
3. Use the links between this chapter's scene beats and prose. Wait for edits to save before moving to the same chapter. If saving fails, retain and retry the current input. Write or generate prose, inspect the content and candidate, then decide whether to adopt. A word-count target is not a guarantee of exact length.

### Whole-chapter review and scoped revision

1. Open Quality review (质量审校) in the prose toolbar, choose Review (审校), Expression and repetition (表达与重复), or Read-through appeal (追读力), then Start detection (开始检测). Reports cover the current saved prose and show full-input and quotation evidence. Detection is blocked when the complete input cannot be sent. Sending the full chapter does not guarantee that the model notices every issue.
2. Select issues for this revision. Only their paragraphs are editable by default. Expand Select other editable paragraphs (选择其它可改段落) when necessary; enter one exact sentence per line in Protected original sentences (保护原句).
3. Click Generate revision and recheck (生成修订并复核). This round allows one revision and one recheck: at most two additional model requests. Wait for the recheck, compare both texts, then Confirm adoption (确认采纳修订) or Abandon revision (放弃修订). A failed recheck retains a preview without writing to the prose.
4. Reopening reads saved reports and decisions without automatically resending requests. Changes to prose or relevant materials can make old reports and candidates stale. Resolve changes before explicitly starting another round. Suggestions, a clean report, or “the model considers this improved” do not replace author judgment.

### The same workflow in node mode

Connect Whole-chapter review and revision (全文评审与修订) to Scoped revision and recheck (定向修订与复核). Select issues and scope in the revision node; Prompt, temperature, output limit, and AI configuration can be connected. Wait for the actual candidate and full recheck, adopt or reject in the run results, then verify the same prose and formatting in step mode.

Continuing downstream after upstream adoption rereads current materials and reuses confirmed content that remains valid. Changes to materials, targets, or connections can still invalidate old candidates. Recovering after refresh does not automatically generate again.

### Returning formal reading files

The organizer assigns one formal HTML per reader and genre. Do not assign the same packet code to multiple people. Open it in a browser, select participation details and reading answers, click Save completed HTML (保存已填写 HTML), and return the new HTML with `result` in its filename. Answers are embedded: open the saved file offline or on another device to continue, without importing separate data. The original blank file is not overwritten automatically. If group-chat previews cannot operate the form, use a browser or computer.

You may return the first pair and finish later. The first pair is estimated at 19–37 minutes; all ten pairs take approximately 197–453 minutes depending on genre. These are text-length estimates. The actual author receives a separate repair HTML, edits four manuscripts, and saves the revisions and timing; the estimate is 66–137 minutes. Authors must edit prose, while readers need not type comments. Automatic website collection is not deployed.

### Evidence and remaining work

The formal comparison is frozen at 60 chapters / 30 pairs across three genres, with three additional pairs from another model. Evidence includes 1,900 exact main-study checks and backup, import, and deletion across six workspaces. [Four Linux review/revision paths](https://github.com/yuanbw2025/storyforge/actions/runs/38682424600) passed. Product source `c2836ba8` passed [core CI](https://github.com/yuanbw2025/storyforge/actions/runs/38682961173) and the [complete CLI checks](https://github.com/yuanbw2025/storyforge/actions/runs/38682961091/job/116251468491); core CI included the full browser suite with 288 passes, one pass after retry, and two skips. A separate full browser run retained one failure and two passes after retry: original traces show that automation had not actually cleared the text and combat operations were still settling. A three-file test synchronization patch preserves result assertions and overall deadlines; its five related paths passed locally. Linux and final-version full validation after that patch remain pending. Independent reader returns and actual author-repair results are still zero. Literary improvement, platform acceptance, and Q10 completion are not established.

## October 14, 2026 review

Incremental range: last successful baseline `ce1cfd6c` → latest remote main `cfc5ed3f`. This review enumerated **51 local branches (including this maintenance branch) and 68 associated worktrees**, including detached ones. Twenty-three branch heads are not main ancestors. These are Git identities, not 23 missing features. Author worktrees were inspected read-only; the following is a point-in-time snapshot and later commits or PR states may change.

### Delivered changes

- [PR #119](https://github.com/yuanbw2025/storyforge/pull/119) merged as `e40fadce`: image-preserving text revisions, production-evidence and backup recovery, quest settlement, branch/prose isolation, and standalone web-game export are in main. See the [guide](/en/features/interactive/text-adventure) and [changelog](/en/updates/changelog). Older statements that #119 is unmerged are obsolete.
- v4.0.0 was formally released on October 13, 2026 at fixed source `78416965`. [Installation](/en/getting-started/install), [model configuration](/en/getting-started/model-config), and [compatibility](/en/updates/compatibility) distinguish portable downloads, later main, and the hosted experience. #119 came after those archives; existing downloads do not automatically gain its changes.
- Main already documents the hosted experience, visible navigation, README, and public analytics privacy. These were reviewed and retained. Traffic CSV archives are not product features. The website graphic replacement belongs to the separate platform repository and does not add editor capabilities.

### New or active undelivered development

“Local only” means not contained by any fetched origin reference, rather than merely ahead of an outdated upstream. None of the following is in main; this table is not a guide to shipped functionality. Worktree names are relative to the local `.codex/worktrees/` directory; full paths, commits, and patch evidence are retained in this maintenance record.

| Branch / reviewed head | Observed scope | State and deduplication |
| --- | --- | --- |
| `feat/character-chat-optimization-20261006` · `b2aefa94`; `character-chat-plan/storyforge` | Role direction and situations, reviewed actions, history edits/branches, per-turn pacing, context evidence, consultation adoption, persistent drafts, failure and backup recovery | All 99 commits outside main are absent from origin refs, including documentation and merge history; no matching open PR. Seven additional uncommitted entries. All ten temporary detached verification heads are ancestors of this branch: one development chain, not ten separate features. |
| `feat/longform-system-quality-plan-20261013` · `e3499e6e` | Prose adoption and memory-freeze timing fixes, system-fiction Q01 baseline and issue list | Pushed; [draft PR #135](https://github.com/yuanbw2025/storyforge/pull/135) remains unmerged. Included in the Q02–Q10 chain below rather than a separate missing feature. |
| `feat/longform-quality-m2-20261014` and `feat/longform-system-quality-q02-q10-20261014` · both `744d84b9`; `longform-quality-m2/storyforge`, `longform-node-experience/storyforge` | System-fiction techniques/elements, scene tasks delivered to prose, context consistency, author intent/style, resumable single-page questionnaire | Same head, counted as one chain. Twelve of eighteen commits outside main are local only, not twelve features. The first worktree also has seventeen uncommitted entries concerning prose request evidence, length observations, and interruption handling; scope observed, not completion accepted. |
| `feat/avg-production-research-20261013-latest` · `8df94be1`; `feat/avg-base00a-20261014` · `18218f73` | AVG three-track production design and work packages; BASE-00A versioned carriers and legacy-package compatibility | Pushed to [draft PR #133](https://github.com/yuanbw2025/storyforge/pull/133) and [PR #137](https://github.com/yuanbw2025/storyforge/pull/137), both unmerged. BASE-00A contains the design chain; design documents do not prove a complete AVG implementation. |
| `feat/avg-base00b-20261014` · `1d64da10`; `avg-base00b-20261014/storyforge` | Subsequent private artifact/runtime contracts, settings, admission, and adoption rules | Its only local-only commit merges BASE-00A; there is no new ordinary commit. Twenty-one uncommitted entries are the observed new development, not a completed or pushed feature. |
| `feat/narrative-domain-projection-20261014` · `f52f5d4d`; `narrative-world-design/storyforge` | Narrative-domain design, NW-0B evaluation baseline, NW-1A identity/time and IR codecs; working changes also involve projection, adoption, lifecycle, and later semantic indexing | Four commits outside main are local only, including one merge; 116 uncommitted status entries are not a completion count. NW-0B and NW-1A heads are ancestors. Two design branches share `ab9e5ed0`, whose design patch is equivalent to chain commit `4861441b`. The detached `nw1b-verification/storyforge` copy has the same head and 86 uncommitted entries: overlapping scope deduplicated, remaining differences require review. |
| `feat/text-open-world-productization-20261013` · `2e9146a4`; `open-world-productization/storyforge` | W1–W3 production responsibilities/progress, individual image reviews, assembly evidence, publication human review, local feedback export | Pushed; [PR #134](https://github.com/yuanbw2025/storyforge/pull/134) remains unmerged, not shipped main-branch capability. |
| `feat/ttrpg-handoff-20261013` · `2bda43a7`; `ttrpg-handoff-20261013/storyforge` | Authorized open-rule settlement, causal recovery, frozen role context, durable model-call evidence | Pushed; [draft PR #128](https://github.com/yuanbw2025/storyforge/pull/128) remains unmerged. It shares documentation commit `a207227c` with plan [PR #124](https://github.com/yuanbw2025/storyforge/pull/124); these are not two independent implementations. |

Eight worktrees have uncommitted status: the five active worktrees above (including the detached verification copy), plus the older built-in-games worktree, promotional screenshot CSS worktree, and a historical recording worktree containing only `.vite-e2e-cache/`. Those last three scopes match the previous review. Caches are not features; PR #111 already brought the older built-in works into main, so they are not new development alerts. Historical Fog Harbor, world-media, older open-world, UI, and backup heads are unchanged; their deduplication conclusions below still apply. Nothing is automatically adopted, merged, or cleaned up.

This run maintains the knowledge base and performs only necessary documentation checks. Product-branch acceptance, model quality, and complete-game quality are outside this run's validation scope. All dated material below remains historical and does not override this section.

## 2026-10-13 · Text open world productization (pending merge)

Branch `feat/text-open-world-productization-20261013` starts at `45c541e9`; audit commit `351bb52f`. Implementation commits: `614fe1ca`, `3216158f`, `ae1b3f3a`, `2505ef9d`, `404f5cf0`. This work adds responsibility and blocker summaries to the existing workspace, versioned assembly reports with source hashes, explicit per-image human review, and local experience-feedback exports. See [Text open world](/en/features/interactive/open-world). There are no new business tables or migrations. Historical v1 reports and releases are preserved; new publication-quality evidence uses v2 to retain calibration and visual-review receipt references.

This is a development branch, not confirmation of a main merge, website deployment, or a new released version. G7-11 independent-model calibration, G7-13 human completion of two endings, and G7-14 a real issue-driven successor release with old-save retesting still require external evidence; G7-15 remains dependent on G7-14. The WPS cloud knowledge base is outside this synchronization.

## October 12, 2026 · Website experience and navigation delivery

[PR #122](https://github.com/yuanbw2025/storyforge/pull/122) delivers the source for the real website experience: a separate showcase build reuses the project interface, workspaces and examples while isolating browser storage and disabling model configuration and AI calls. The downloaded application retains its creation capabilities. No business tables, migrations or ownership changes are introduced. Website entry points, the teal landscape theme and the public Workshop platform are delivered to the main branch through [platform PR #2](https://github.com/yuanbw2025/storyforge-platform/pull/2).

The [website experience](https://storyforge-lab.com/storyforge/) is independently deployed. Always-visible navigation was merged through [PR #126](https://github.com/yuanbw2025/storyforge/pull/126) and automatically deployed. Main-branch source, the fixed online experience package and formal releases are verified separately; the public Workshop currently provides a catalog and downloads, while online submissions remain closed. The snapshot below predates this integration; its unmerged website-branch status does not replace the current state of the linked PRs.

## Pre-integration snapshot: October 12, 2026

Baseline: remote main `ce10e774`. All 31 local branches (including this maintenance branch) and 48 worktrees, including detached ones, were enumerated. The QQ bot guide was merged through [PR #123](https://github.com/yuanbw2025/storyforge/pull/123) and [deployed successfully](https://github.com/yuanbw2025/storyforge/actions/runs/38239411813). Its guide and changelog are already synchronized, so this round does not duplicate them.

- `feat/text-adventure-delivery-20261010`: 20 commits outside main, none local-only. [Draft PR #119](https://github.com/yuanbw2025/storyforge/pull/119) remains unmerged. In addition to the previously recorded image-preserving revision and task recovery, development adds indexed backup ledger export, frozen-scene transcript binding, branch-action feedback, ending hints, isolation of branch playback and generated prose, and preservation of rejected-parent recovery proof. [Remote checks passed](https://github.com/yuanbw2025/storyforge/actions/runs/38108748168) for the latest PR head `38c5e1c8`; this does not establish integration or online availability.
- `fix/adventure-branch-transcript` and `fix/flagship-backup-export-index` share head `5642c839` and are both ancestors of the text-adventure branch above. Backup indexing and branch transcript fixes are recorded once, not treated as two additional products to merge.
- `feat/website-experience-20261012`: four commits outside main, none local-only; pushed to [draft PR #122](https://github.com/yuanbw2025/storyforge/pull/122), still unmerged. Development covers the real interface in an isolated showcase build with AI calls restricted, showcase-only entry points, and top-level knowledge-base navigation. No PR check records were found this round; its entry-point descriptions are not published as available user-guide features.
- `/Users/qinyingying/.codex/worktrees/character-chat-plan/storyforge`: five observed uncommitted entries cover a character-chat development plan, document routing, authority listings, and checker changes.
- `/Users/qinyingying/.codex/worktrees/ttrpg-plan-20261012/storyforge`: eight observed uncommitted entries cover a TTRPG development plan, product contract, capability baseline, routing, and checker changes. These two worktrees are observations only; neither a finalized plan nor an implemented product is established.
- The two old home CSS modifications, 72 differences in the old built-in-game worktree, archived test cache, and other historical branches retain the deduplication conclusions below. This maintenance has not submitted, pushed, merged, or cleaned the authors' development work.


## Historical review: October 10, 2026

The baseline is remote main `6da4c2dc`. This round enumerated all 25 local branches (including this maintenance branch) and 44 worktrees. The October 8 snapshot below remains historical evidence.

- PRs #113 (plugins and Workshop), #115 (node maintenance and free graph editing), #118 (unnamed Canon record conflicts), and #120 (local Codex provider) are merged into main. The Workshop, node, and model-configuration guides were published by [site deployment](https://github.com/yuanbw2025/storyforge/actions/runs/38046659880). Integration does not establish a new formal release or application deployment status.
- `feat/text-adventure-delivery-20261010`: 12 commits outside main, none local-only; pushed to [draft PR #119](https://github.com/yuanbw2025/storyforge/pull/119), still unmerged. Development covers sealed production-proof recovery after backup import, actual task settlement, controlled final revisions, retaining authorized original images, durable failure when visual authority is missing, and verified work-version display in saves. Remote checks are still running; this round only reads their status and does not describe development as online functionality.
- The one local-only commit on `feat/codex-provider-merge-20261010` is a merge of traffic archives. It has no unique ordinary patch and is not a missing feature. The actual provider branch is integrated through #120.
- Other historical branch heads outside main are unchanged from the previous review. Existing deduplication conclusions for backups, migrated built-in games, and old open-world architecture still apply. Two development worktrees retain the same uncommitted scope, and one contains test cache only; this maintenance does not submit, push, or merge them again.

## Historical snapshot (October 8, 2026)

> Snapshot: 2026-10-08 15:07 (UTC+8) · Remote main `7629a7fa`. This page records development evidence, not a list of released features.

This audit covers all 19 local branches (including this documentation-maintenance branch) and 41 registered worktrees, including detached worktrees and those moved into archives. Excluding maintenance, 8 of the remaining 18 branch heads are outside main. “Local-only commits” means commits not contained in any fetched origin branch; the count is not the number of missing features.

## 2026-10-10 addition: local Codex provider

Implementation: [d492fe3e](https://github.com/yuanbw2025/storyforge/commit/d492fe3e); delivery and current checks: [PR #120](https://github.com/yuanbw2025/storyforge/pull/120).

Branch `feat/codex-provider-20261010` adds an optional local text transport using Codex app-server. It reuses the detected ChatGPT login without an API key and leaves candidate review/adoption with existing StoryForge workflows. See [configuration](/en/getting-started/model-config). Merge, CI, and hosted documentation deployment must be checked separately; this entry does not update the older branch inventory below.

## 2026-10-10 · Free node graph editing preview

[PR #115](https://github.com/yuanbw2025/storyforge/pull/115) extends node maintenance with bidirectional port dragging, compatible-node search, canvas creation, reconnecting and prompt selection. This PR delivers node maintenance and free graph editing; use its latest full checks and merge state to assess delivery, and verify online deployment separately. See [node authoring](/en/features/nodes) for steps and limits.

## October 8 · Historical longform node maintenance development record

At the October 8 review, `feat/longform-node-experience-20261008` was validating author requirements, durable candidate edits and rejection, local execution, fixed-character adoption, interrupted-run recovery, and narrow-screen views in an independent worktree. The branch was unmerged at that time; PR #115 provides the current delivery state, and this historical snapshot does not establish an online update. Isolated browser tests cover cross-mode operations, invalid connections, and backup/deletion paths; complete production acceptance of every official longform template remains pending. See [node authoring](/en/features/nodes).

## October 9 targeted update Plugins and Workshop

Plugin preview 1.0 is delivered through PR #113; the base implementation is [53c276f3](https://github.com/yuanbw2025/storyforge/commit/53c276f3). See [PR #113](https://github.com/yuanbw2025/storyforge/pull/113) for delivery and review. New [Workshop guides](/en/workshop/) cover capabilities, installation, development, an AI prompt and Skill kit, publishing, maintenance and recovery, with in-app help/download entry points. Use the latest PR checks and merge state to assess delivery; verify website deployment separately. The branch snapshot below preserves the 2026-10-08 review, so its unmerged status and old CI result do not describe the current state.

## Now in main

- [PR #107](https://github.com/yuanbw2025/storyforge/pull/107): game-production responsibilities and lifecycle documentation, plus review protection until longform candidates are saved.
- [PR #108](https://github.com/yuanbw2025/storyforge/pull/108): preserving entered task-repair drafts during the initial production-progress load.
- [PR #109](https://github.com/yuanbw2025/storyforge/pull/109): home layout, text display, and a unified power-system editor within World origin. The earlier “local and unpushed” description is obsolete.
- [PR #110](https://github.com/yuanbw2025/storyforge/pull/110): the prepared Last Letter motion-comic sample. Its documentation has already passed [site deployment](https://github.com/yuanbw2025/storyforge/actions/runs/37356743763). The sample does not mean comic production can automatically create equivalent animation.
- [PR #111](https://github.com/yuanbw2025/storyforge/pull/111): the three built-in narrative games are now in main, including slow-frame travel and paused-scene fixes. Later commits supersede the earlier pending/failed-CI status and temporary uncommitted-worktree observations. The Word-import transitive-dependency security fix is also in main, whose latest [full CI](https://github.com/yuanbw2025/storyforge/actions/runs/37477830226) passed.

See the [changelog](/en/updates/changelog), [longform settings](/en/features/longform/planning), and [candidates and recovery](/en/guides/ai-workflow). Mainline integration, application deployment, and documentation deployment are checked separately; a merge date is not a version-release date.

## Branches outside main in the historical snapshot (not current status)

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
