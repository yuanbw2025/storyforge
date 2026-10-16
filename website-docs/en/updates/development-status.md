# Pending development and branch audit

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
