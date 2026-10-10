# Changelog

Changes are organized by user impact. **Main-branch updates do not mean a new version has been released.** The package version remains 3.9.1; tagged releases retain their original content. Live deployments may lag; see [compatibility](/en/updates/compatibility).

## 2026-10-10 · Free node graph editing in development

[PR #115](https://github.com/yuanbw2025/storyforge/pull/115) extends node maintenance with bidirectional port dragging, compatible-node search, canvas creation, reconnecting and prompt selection. Remote CI passed for the October 8 commit; the added interactions are being validated and are not merged or confirmed online. See [node authoring](/en/features/nodes) for steps and limits.

## Development preview Plugins and Workshop

[PR #113](https://github.com/yuanbw2025/storyforge/pull/113) delivers the plugin preview, installation/development tutorials, AI development kit and publication workflow. See [Workshop guides](/en/workshop/) and [development status](/en/updates/development-status). Check [PR #113](https://github.com/yuanbw2025/storyforge/pull/113) for merge/deployment status; the feature still requires explicitly enabling the developer preview and is not a new tagged release.

## 2026-10-08 · New development brief in the knowledge base

The [Plugins and Workshop 1.0 trial brief](/en/updates/plugin-workshop-v1) documents trial steps, project changes, data protection, acceptance results, and limits. PR #113 was unmerged at the 2026-10-08 review. This entry preserves that documentation update; consult the guides and PR above for current status.

## Unreleased / current main

### 2026-10-06 · Word-import dependency security maintenance

- Removed a component with a known vulnerability from the Word-import dependency chain while preserving existing `.docx` text extraction.
- Browser regressions passed for Chinese text, paragraphs, table text, and explicit errors for damaged files.

Evidence: [Dependency fix](https://github.com/yuanbw2025/storyforge/commit/f06caf0f), merged through [PR #111](https://github.com/yuanbw2025/storyforge/pull/111). See [Import and references](/en/guides/import) for usage.

### 2026-10-06 · Three ready-to-play 3D narrative games

- Text open world → Built-in narrative games now offers Tidemark: The Last Lamp (潮痕：最后一盏灯), Aphelion: Dock Seven (远日点：第七码头), and Tidemark: Between Two Bells (潮痕：两声之间), with no API setup or extra model download.
- Each long story retains ten chapters, over 30,000 Chinese characters of main story, over 500 distinct dialogue lines, and four endings. Between Two Bells is a four-to-five-minute investigation and rescue story.
- Includes 3D/text exploration, interactions and branching choices, phone controls, refresh recovery, and checkpoint branches; fixed pauses during continuous pathfinding at low frame rates.
- Content and procedural scenes ship with the source. An explicit start prepares independent releases and saves; browsing introductions installs nothing. Saves stay in the current browser and can be restored from full project backups.
- Dialogue uses frozen scripts without free-form AI conversation or voice acting. This does not raise the maturity rating of general game production. Older Release archives retain their original content.

Guides: [Text open world](/en/features/interactive/open-world) · [Examples](/en/guides/examples).
Evidence: [Game content and entry integration](https://github.com/yuanbw2025/storyforge/commit/41f32066).

### 2026-10-06 · Home layout and a unified power-system entry

- Fixed home layout and sidebar text display.
- Longform and the world engine now edit power systems under World origin → Power system, with the overview, structured rules, and level entries on one page. Old links still reach the new entry.
- Existing data identities and references are preserved. Overviews and structured rules do not automatically overwrite each other, and multi-world editing remains scoped to the current world.

Guides: [Longform settings](/en/features/longform/planning) · [World engine](/en/features/world-engine).
Evidence: [PR #109](https://github.com/yuanbw2025/storyforge/pull/109), mainline merge `7b0ac619`. The date is the mainline integration date; live availability depends on application deployment.

### 2026-10-06 · The Last Letter motion-comic showcase

- Comic → Library and Home → Example works → Comic now offer a 50-second motion comic with sound in a separate tab. The four existing complete page comics remain readable and downloadable.
- Fullscreen, pause, seeking, replay, volume, and still-frame comparison work without a model API or changes to author works.
- This independently prepared sample demonstrates limited animation, camera movement, and audiovisual effects. It does not claim the current comic-production workflow automatically generates equivalent animation. Movie resources load on demand and stay outside the app precache.

Guides: [Novel to comic](/en/features/comic) · [Built-in works and examples](/en/guides/examples).
Evidence: [Motion-comic showcase integration](https://github.com/yuanbw2025/storyforge/commit/f18c2922). Live availability depends on deployment completion.

### 2026-10-05 · Candidate persistence and production-recovery input protection

- Longform “Split into scenes” and “Improve scene outline” now explicitly wait for candidate validation and persistence after streaming. Editing, adoption, dismissal, and retry are not exposed before a recoverable candidate is ready.
- The initial progress load in interactive production preserves task-repair text the author has already entered. Switching productions or changing the run-control version still resets the relevant input; unsubmitted drafts are not promised to survive refresh.
- Updates to the game-lifecycle and production-lane charter define development boundaries, not newly completed features in every game product.

Guides: [Longform scene outlines](/en/features/longform/writing) · [AI candidates and recovery](/en/guides/ai-workflow).
Evidence: [Candidate persistence protection](https://github.com/yuanbw2025/storyforge/commit/37451b15) · [Recovery-input protection](https://github.com/yuanbw2025/storyforge/commit/36b74105), merged through [PR #107](https://github.com/yuanbw2025/storyforge/pull/107) and [PR #108](https://github.com/yuanbw2025/storyforge/pull/108), respectively.

### 2026-10-04 · Adventure presentation, local revisions, and large backups

- Connected cover cards, details, start/continue, and saves. Unpublished playtests are labeled, historical versions are grouped under details, and stale Build starts are blocked.
- Reading includes immersion and accessibility controls, with usable narrow-screen toolbars. Choices show actual missing conditions and scene characters follow the frozen cast list.
- Added local story, cast, scene, dialogue, and route revisions; improved pause recovery, image replacement, rights declarations, and visual-review dependencies while retaining old Builds and saves.
- Improved large-project JSON reading/writing and open-world travel-effect validation performance.
- Engineering delivery for Tidal Bell Isles is separate from publishing the work: its local unpublished playtest, images, and saves do not arrive through Git or a fresh installation.

Guides: [Text adventure](/en/features/interactive/text-adventure) · [Large backups](/en/guides/backup-restore).
Evidence: [PR #100 mainline integration](https://github.com/yuanbw2025/storyforge/commit/dd253f85).

### 2026-10-04 · Longform context fixes and Luniang naming

- Corrected cases where existing material was incorrectly reported as a missing mandatory resource, blocking outline, detailed-outline, or prose generation.
- Fact checks distinguish events that can coexist from conflicting single states, retaining real-conflict blocks.
- Renamed the companion to Luniang (炉娘) across the panel, settings, and portrait descriptions without changing works or voice settings.

Guides: [Longform](/en/features/longform/) · [Outlines and prose](/en/features/longform/writing).
Evidence: [Context fix](https://github.com/yuanbw2025/storyforge/commit/0c602f2d) · [Companion naming](https://github.com/yuanbw2025/storyforge/commit/db86b01a).

### October 3, 2026 · Model proxy settings in deployed builds

- Deployed builds no longer offer the development-server-only local proxy button, preventing accidental use of unavailable proxy endpoints.
- Semantic retrieval presets use local proxies in development and direct provider endpoints in deployed builds. Direct requests still depend on the provider's cross-origin policy.
- Saved proxy addresses remain unchanged. Self-hosted proxies can still be configured manually, and direct access can be restored explicitly.

Entry: [Model and API configuration](/en/getting-started/model-config).
Evidence: [Proxy settings fix](https://github.com/yuanbw2025/storyforge/commit/98f7e8a6).

### 2026-09-29 · Forge Writing Workshop and node templates

- Added 28 optional original templates for starting, scenes, prose, local revision, style diagnosis, chapter handoff, and publication copy.
- Search by workshop scope or keyword in the Prompt library. Templates are inactive by default and preserve existing author selections.
- Workflows select per-node templates, bind materials, and preserve author hints. Handoff templates use short prose evidence to separate actual events from speculation.

Guides: [Prompt usage](/en/guides/using-prompts) · [Workshop index](/en/prompts/a/a-index) · [Nodes](/en/features/nodes).
Evidence: [Workshop templates](https://github.com/yuanbw2025/storyforge/commit/8d3c1985) · [Handoff evidence](https://github.com/yuanbw2025/storyforge/commit/ac8c0be9). The date is the mainline integration date.

### 2026-09-25–27 · Selective longform writing, saving, and import recovery

- Start from a minimal confirmed idea or a selected volume, chapter, passage, or character field; execution plans preserve explicit scope and negative instructions.
- Edit, discuss, or decline candidates. Recover optional post-adoption organization separately; library counts reflect saved manuscripts.
- Added cancellable speech input and reading. Recognized text is editable before sending; it never automatically sends or adopts. Automatic reading is off by default.
- Fixed work-information saving, streaming display, chapter-switch state, and candidate revision; outline dragging scrolls at list edges.
- Fixed world background being mistaken for an instruction to write world data, and handling of ambiguous chapter ordinals.
- Retry failed import chunks and continue unprocessed ones. Incomplete JSON, authorization failures, and unknown outcomes stop; only clearly retryable HTTP 503 responses receive bounded automatic retries.

Guides: [Longform](/en/features/longform/) · [Saving prose](/en/features/longform/writing) · [Import](/en/guides/import).
Evidence: [Selective writing and candidates](https://github.com/yuanbw2025/storyforge/commit/e082dcb0) · [Voice](https://github.com/yuanbw2025/storyforge/commit/eeda8bd7) · [Saving and switching](https://github.com/yuanbw2025/storyforge/commit/2b6c8499) · [Post-adoption recovery](https://github.com/yuanbw2025/storyforge/commit/92a6f80b) · [Feedback fixes](https://github.com/yuanbw2025/storyforge/commit/3ea1c8e3) · [Explicit recovery](https://github.com/yuanbw2025/storyforge/commit/ab07dee3) · [Counts](https://github.com/yuanbw2025/storyforge/commit/ba275db2).

### 2026-09-22–26 · Text open world production and Salt Ridge showcase

- Connected dedicated production from a frozen world or novel source through goal confirmation, authorized production, artifact editing, local repair, assets, quality, and release.
- Player views include maps, quests, characters, inventory, combat, crafting/trade, world records, tutorials, and saves. Runtime AI remains constrained by formal gameplay and state.
- Existing saves retain their release; upgrades require compatibility checks. Production previews remain separate from the formal game library.
- Added Salt Ridge: Night of the Cutoff (盐脊：断流之夜), a prepared showcase that starts independent play and saves without model configuration.
- The product remains a preview. Engineering checks and a showcase do not replace real-provider calibration and human acceptance of general production.

Guides: [Text open world](/en/features/interactive/open-world) · [Examples](/en/guides/examples).
Evidence: [Mainline integration](https://github.com/yuanbw2025/storyforge/commit/8402d50b) · [Dedicated entry](https://github.com/yuanbw2025/storyforge/commit/541c9d04) · [Salt Ridge](https://github.com/yuanbw2025/storyforge/commit/a4bc3f62).

### 2026-09-22 · Professional text-adventure production, assets, and packages

- Mainline entries connect product direction, automatic production, quality/assets, publishing/export, and adventure runtime.
- Professional production covers story, cast, quests, scenes, and dialogue, checking decision consequences and ending closure.
- Images have versioned binding evidence. Visual requirements and images require author confirmation, with independent visual review and targeted repairs.
- Product packages support validation, import, and independent play. Budget recovery, task rewind, and checkpoint recovery preserve valid existing artifacts.
- The product remains a preview. Automated checks do not prove human acceptance or publication of a particular flagship work.

Guide: [Text adventure](/en/features/interactive/text-adventure).
Evidence: [Mainline integration](https://github.com/yuanbw2025/storyforge/commit/58c5723c) · [Professional production](https://github.com/yuanbw2025/storyforge/commit/237f1912) · [Product packages](https://github.com/yuanbw2025/storyforge/commit/ecc178b8) · [Mainline path](https://github.com/yuanbw2025/storyforge/commit/fdc5b87c).

### 2026-09-21 · English knowledge base and return-to-site navigation

- Completed English pages, locale-specific links, and recovery guidance; Chinese remains the authoritative source.
- Added return-to-official-site navigation, keeping clear entries between the knowledge base and product website.

Evidence: [Bilingual knowledge base](https://github.com/yuanbw2025/storyforge/commit/6262e6ed) · [Return navigation](https://github.com/yuanbw2025/storyforge/commit/0fcff237).

### September 18–19, 2026 · Official knowledge base and feedback

- Added an independent VitePress documentation site with Chinese navigation, local search, Prompt materials, and historical archives.
- Replaced the landing page with a knowledge-base homepage showing the sidebar directly.
- Added bug, feature-request, and documentation-correction forms with attachments and submission numbers.
- Retained GitHub Issue Forms as an optional channel.

Entries: [Knowledge base](/en/) · [Feedback](/en/feedback/).
Evidence: [Site foundation](https://github.com/yuanbw2025/storyforge/commit/a2fe8fee) · [Knowledge base and forms](https://github.com/yuanbw2025/storyforge/commit/58892a5b).

### September 14–16, 2026 · New home and product workbenches

- Connected Home to actual works, worlds, tasks, versions, and local search; products manage content in their own libraries.
- Connected redesigned longform, short-fiction, screenplay, world, comic, motion-comic, chat, TTRPG, town, and AVG interfaces to real flows.
- Restored built-in examples and independent experience copies, unified brand icons, added 14 shared themes, and improved usable workspace area.
- Fixed prose-editor initialization potentially saving empty prose and background refresh disrupting screenplay planning edits.
- Text adventure and text open world remain explicitly in development; UI integration does not raise maturity commitments.

Entries: [Choose a product](/en/getting-started/choose-product) · [Longform](/en/features/longform/).
Evidence: [Home](https://github.com/yuanbw2025/storyforge/commit/62b53d35) · [Current UI foundation](https://github.com/yuanbw2025/storyforge/commit/2a5f6715) · [Themes](https://github.com/yuanbw2025/storyforge/commit/11a07816) · [Prose-save fix](https://github.com/yuanbw2025/storyforge/commit/758f0a5f).

### September 9–10, 2026 · Motion-comic preproduction and built-in works

- Motion-comic production now runs from a sentence or novel through series bible, episodes, assets, episode scripts, storyboards, and reference frames.
- Added image/motion Prompts, per-shot Seedance execution packages, and other target-tool packages; delivery stops before external video generation.
- Restored the no-model-API Fog Harbor: The Lost-Tide Bells text-adventure/AVG experience. Its playability does not mean all general-purpose game products are complete.

Entries: [Motion-comic materials](/en/features/motion-drama) · [Built-in works](/en/guides/examples).
Evidence: [Production](https://github.com/yuanbw2025/storyforge/commit/35d8ab99) · [Execution packages](https://github.com/yuanbw2025/storyforge/commit/79ae680a) · [Built-in Fog Harbor](https://github.com/yuanbw2025/storyforge/commit/787f8f06).

### September 6–8, 2026 · Independent creation and interactive previews

- Completed short-fiction intent, chapter plans, prose, evidence-based review, targeted rewriting, and version exports.
- Completed screenplay source analysis, professional adaptation, scenes, dual review, and Fountain/FDX/print delivery.
- Completed comic panels, reading flow, visuals, separate lettering, review, and storyboard/visual editions.
- Added short-fiction, screenplay, and comic examples and library entries.
- Added the Fog Harbor: The Last Lamp TTRPG community preview, AI hosting, and recoverable play; public online multiplayer is not deployed.
- Added town schedules, relationships, events, replay, and independent runtime evolution; it remains a preview.

Entries: [Short fiction](/en/features/shortform) · [Screenplay](/en/features/screenplay) · [Comic](/en/features/comic) · [Interactive products](/en/features/interactive/).
Evidence: [Short fiction](https://github.com/yuanbw2025/storyforge/commit/9a7e7a71) · [Screenplay](https://github.com/yuanbw2025/storyforge/commit/3167f422) · [Comic](https://github.com/yuanbw2025/storyforge/commit/39a01171) · [Town](https://github.com/yuanbw2025/storyforge/commit/ee93e27e) · [TTRPG preview](https://github.com/yuanbw2025/storyforge/commit/cdf070b2).

### August 31–September 4, 2026 · Work, world, and product-version boundaries

- Separated workspace, work, and world identities/ownership; longform and short fiction remain independent creation products.
- Authors can explicitly derive worlds and seal versions for product-specific reading.
- World-derived products follow world sealing, product direction, and product execution. Assets and runtime progress do not automatically write back to worlds.
- Current architecture and backup formats have explicit validation. Preserve the original environment and full backups before upgrading; arbitrary historical JSON is not assumed importable.

Entries: [Core concepts](/en/concepts/) · [Upgrade compatibility](/en/updates/compatibility).
Evidence: [World identity separation](https://github.com/yuanbw2025/storyforge/commit/e32d0a56) · [World-version transition](https://github.com/yuanbw2025/storyforge/commit/c5e2f56d) · [Current architecture transition](https://github.com/yuanbw2025/storyforge/commit/a0e0951a).

### August 26, 2026 · Project authority and documentation rebuild

Clarified boundaries of independent creation, the world engine, and upper-level products; organized current engineering documentation and historical archives. Old panoramic guides remain preserved but do not define current product status.

### August 17, 2026 · Local memory workspace and unified AI execution

- Added readable disk projections, difference checks, conflict handling, recovery capsules, and author-confirmed bidirectional synchronization.
- AI outputs first become candidates, recording sources, versions, usage, and run evidence; author confirmation promotes them to official content.
- File synchronization and recovery run locally without model tokens; AI generation and semantic review are separately billed.

Entries: [Memory workspace](/en/features/memory-workspace) · [AI workflow](/en/guides/ai-workflow).

## Tagged releases

### v3.9.1 · August 4, 2026

A fixed release of the traditional step-by-step mode, with local creation, JSON import/export, and source-based npm startup. It does not contain all later independent products and redesigned interfaces on main.

### Earlier versions

Historical capability descriptions belong to their original context and cannot identify current feature entries. See [GitHub Releases](https://github.com/yuanbw2025/storyforge/releases), the [repository changelog](https://github.com/yuanbw2025/storyforge/blob/main/CHANGELOG.md), and [historical feature updates](/en/updates/historical-feature-updates) (links to the Chinese original).

## Documentation maintenance

September 20, 2026: rebuilt product guides, onboarding, data/cost explanations, and main-branch milestone records against baseline 58892a5b. This is a knowledge-base maintenance date, not a new product release date.

2026-10-04: reconciled late-September onward mainline changes against remote main `dd253f85`, inspected all 86 local branches and associated worktrees, and synchronized Chinese and English guides. [Pending development](/en/updates/development-status) lists unmerged work separately, without claiming it is live. Documentation deployment requires a successful corresponding workflow run.
