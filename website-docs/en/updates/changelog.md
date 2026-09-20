# Changelog

Changes are organized by user impact. **Main-branch updates do not mean a new version has been released.** The package version remains 3.9.1; tagged releases retain their original content. Live deployments may lag; see [compatibility](/en/updates/compatibility).

## Unreleased / current main

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
