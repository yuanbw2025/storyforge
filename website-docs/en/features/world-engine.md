---
productId: world-engine
status: released
lastVerified: 2026-11-13
---
# World engine

## November 13: saving, recovery and usage checks

When deriving a world from a novel, only chapter references proven to belong to the same work/scope are rebound in the new workspace. Uncertain references retain their values and review notes; historical sealed content stays unchanged. A read-only cached world is distinct from the author's local sealed version. Before production, check source purpose, version and required material, resolving missing/mismatched items as prompted. Material disabled by the author stays out of formal context. Sources: [#307](https://github.com/yuanbw2025/storyforge/pull/307), [#377](https://github.com/yuanbw2025/storyforge/pull/377), [#380](https://github.com/yuanbw2025/storyforge/pull/380), [#429](https://github.com/yuanbw2025/storyforge/pull/429).


Build reusable settings, characters, relationships, and rules, then seal definite versions for other products to reference. Entry: World engine → My worlds → New world (世界引擎 → 我的世界 → 新建世界).

## Sources of a world

Edit from scratch or explicitly derive from longform or short fiction. Derivation preserves the selected scope and source version; the original remains owned by the original work. Later edits do not automatically synchronize.

Screenplays, comics, and motion-comic materials do not offer a “package as world” path.

## Editing and sealing

1. Select the target in My worlds (我的世界).
2. In World settings (世界设定), edit rules/origins, nature/geography, culture/society, characters/relationships, and history/facts as needed.
3. For multiple worlds, maintain world collections, planes, and passages.
4. In Versions and sealing (版本与封存), check scope, omissions, and provenance, then confirm an immutable world version.
5. In Data export interface (数据出口), inspect the selected version's capabilities, resources, and evidence.
6. For file sharing, use Sharing and import (分享与导入), checking attribution, license, and purpose.

Community and distribution (社区与发行) currently prepares shareable versions and licensing; it does not mean a public marketplace service is live.

## Where to edit power systems

In the longform workspace, open World and settings → World origin → Power system (世界与设定 → 世界起源 → 力量体系). Maintain the overview, structured rules, and level entries on one page. Structured rules include the system name, description, level list, and cultivation constraints. World settings in the world engine uses the same entry.

The separate Power system navigation item has been removed; old links open the power tab within World origin. Existing overviews, structured rules, and record identities are preserved without automatically overwriting each other. Review inconsistencies before editing. For multiple worlds, select the current world before changing its rules.

## From world to interactive work

Seal the world first. Then enter the specific TTRPG, character-chat, AI-town, or text-game product, select a version, complete direction settings, and explicitly start production. A world page does not turn a draft directly into a formal game.

Each product reads the world content it needs, then owns its separate production data, media, releases, and saves.

## Local experimental narrative-world preview

Narrative annotations, compilation, perspective queries, and change-impact tools are merged into main. Enhanced entries appear only in local development mode with an explicit `?narrative-preview=1`; production builds hide them by default. Use an isolated test work and backups.

1. In the fact library, choose Narrative annotations (experimental) (叙事注释（实验）). Check the record, original evidence, time, visibility, and whether it represents a fact, a character's belief, or an author plan. Model suggestions become saved candidates for review and confirmation, without directly overwriting prose.
2. In Versions and sealing, select semantic scope, optionally include confirmed prose and narrative from the current workspace's work, then choose Capture and compile selected content (捕获并编译所选内容). This checks a snapshot without a model call or automatic publication. Return to a saved task to continue after leaving; review changed sources when prompted.
3. Confirm and freeze completed compilation, then publish a world version. In the experimental Data export interface query, choose an entity, story thread, time, or character perspective. Index summaries help locate material; choose View complete original evidence (查看完整原文证据) to check frozen prose. Unknown time and unannotated prose retain coverage gaps: an empty query does not prove absence from the story.
4. When compiling after edits, choose an existing revision as a comparison baseline. Inspect directly changed items, dependencies awaiting revalidation, and items requiring author review. This checklist does not rewrite prose, locked content, or older world versions.

Semantic impact accuracy, formal scale performance, reader completeness, and author revision time savings still require acceptance. Do not treat the list as complete causal proof. The world supplies semantic content; each product still owns its images, publishing, and sessions. Source: [PR #197](https://github.com/yuanbw2025/storyforge/pull/197).

## Why versions matter

World version one can support a campaign while you edit version two. Existing works and saves do not automatically upgrade; adopting a newer source must be handled explicitly in the product.

World versions contain semantic material, not upper-level products' images, runtime state, or private player evolution.

Continue: [Projects, works, and worlds](/en/concepts/work-world) · [Sealing, production, and release](/en/concepts/versions).
