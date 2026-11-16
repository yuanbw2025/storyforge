---
productId: upper.text-open-world
status: preview
lastVerified: 2026-11-13
---
# Text open world

## November 13: saving, recovery and usage checks

Before formal production, check the selected sealed protagonist and ending count. Old single-ending plans remain readable/exportable and their existing tasks can be stopped. New editing, budget or media operations require the current 2–12 endings and explicit reconfirmation. NPC edits match original demand identities rather than list positions; ambiguous mappings are rejected. Long character replies remain available to the next dialogue and explicit memory saves. Late results after switching saves do not interrupt the new save's input. Interrupted confirmed commands recover within their original save. Sources: [#308](https://github.com/yuanbw2025/storyforge/pull/308), [#354](https://github.com/yuanbw2025/storyforge/pull/354), [#364](https://github.com/yuanbw2025/storyforge/pull/364), [#417](https://github.com/yuanbw2025/storyforge/pull/417), [#431](https://github.com/yuanbw2025/storyforge/pull/431).


> Preview. Dedicated production, player UI, and runtime AI are connected; general production still requires real-provider calibration and human acceptance of both ending paths.

Text open world combines regional exploration, character schedules, quests, combat, inventory, and ongoing change. New production reads an author-confirmed, sealed world version. Product assets and play results belong to the product and do not automatically update the world or original work.


## Starting production from a novel

Open an independent longform or short story and choose Derive a world draft from the novel first. Check the scope and explicitly confirm. The current scope includes all confirmed semantics. Inspect, confirm and seal the draft on the world page, then select its WorldRelease for product direction and explicitly start production. The novel and derived world are maintained separately afterward, without automatic synchronization.

Older novel-source production records, releases and saves retain original evidence and read-only inspection paths. When source admission blocks an operation, inspect its source and version before starting new production. See [PR #255](https://github.com/yuanbw2025/storyforge/pull/255).

## Try Salt Ridge: Night of the Cutoff (盐脊：断流之夜)

Open Text open world and choose “先试玩《盐脊：断流之夜》”. No workspace selection or model configuration is needed. Starting for the first time creates an independent release and save. Explore, interact with characters, complete quests, and reach endings; continue from your own progress.

This is a prepared showcase, not evidence that any input automatically produces an equally complete game. See [Built-in works and examples](/en/guides/examples).

## Three 3D narrative games

Find **Built-in narrative games (内置叙事游戏)** in the Player view of Text open world. No workspace, API configuration, or external game engine is required. These three games are not featured on the homepage.

- **Tidemark: Between Two Bells (潮痕：两声之间)**: a separate story of roughly 4–5 minutes. Inspect water marks, collect tools, operate the sluice in order, and carry out either rescue route.
- **Tidemark: The Last Lamp (潮痕：最后一盏灯)**: ten chapters of coastal fantasy, over 30,000 Chinese characters in the main story, over 500 distinct dialogue lines, and four endings.
- **Aphelion: Dock Seven (远日点：第七码头)**: ten chapters of space science fiction, over 30,000 Chinese characters in the main story and over 500 distinct dialogue lines, with equipment puzzles, side routes, and four endings.

Start with Between Two Bells. Desktop controls include WASD/arrow keys, click-to-move, and E to interact nearby. Phone users can use on-screen buttons; settings offer text exploration, lighter graphics, and reading modes. Content is prepared only after an explicit start. Continue after a refresh; new journeys and checkpoint branches preserve previous saves. Transfer progress through a full project backup; browser data does not automatically sync between devices.

The main stories use frozen scripts supplied with the repository, without free-form model dialogue or voice acting. The longer games only offer optional synthesized ambience; the short story currently has no sound. These works do not establish completion of general open-world generation. Download a `main` checkout containing this update or a later Release; older archives do not automatically gain this content.

## Produce your own work

1. Open Text open world → Produce (制作), then choose a workspace and a sealed world version.
2. Review available sources and gaps before continuing to the main Agent conversation. Selecting sources alone does not start production or billing.
3. Confirm the goal, gameplay, scale, budget, and production brief; resolve required inputs and model configuration.
4. Explicitly authorize production. Inspect progress and pending artifacts; use the current task's recovery guidance after interruptions.
5. Review the story, protagonist, map, quests, gameplay, and assets. Edit or repair the relevant artifacts and recheck affected dependencies.
6. Complete quality checks and playtest evidence, then freeze a publishable product version. Production previews remain separate from the formal game library.

Production may use your model and image services. Budget, failure, and quality gates must not be bypassed by editing stored data.

## Validate your own production version

Save a [full backup](/en/guides/backup-restore) of the work you actually produced, and note the current build, published release, and saves to retest. Progress in a showcase cannot replace acceptance records for your own build.

1. In AI settings, assign an independent preset to **Review and validation (审查校验)**. Its provider/model combination must differ from the production generator; changing only the API key does not establish independence. Check both identities under **Independent model and data calibration (独立模型与数据校准)** in the production workspace. After explicitly accepting the cost of this call, select **Run one independent calibration and freeze the receipt (运行一次独立校准并冻结回执)**. Inspect scores, repetition, authored duration, usage, and costs. Record frozen-price estimates separately from actual provider charges.
2. After calibration passes, the author personally completes two to six routes in the current build, reaching at least two different endings and covering actions, exploration, combat, progression, and recovery. Actually use free input and obtain at least one runtime AI response. Under **Complete human playtest with two endings (真人双结局完整试玩)**, select the relevant saves and enter active play time excluding idle time, all ten ratings and observations, costs, and waiting experience. Confirm the four human declarations and freeze the receipt. If provider charges are unavailable, select **The provider did not supply attributable costs (服务商未提供可归因费用)**.
3. Update acceptance starts with a problem actually observed in a published release. Register the issue, save the complete playtest receipt indicating that repair is required, and create a successor build through the existing local repair entry. Recheck affected artifacts and publication requirements, then explicitly publish a direct successor to that source release. Preserve the original release and saves.
4. Complete the two-ending playtest again in the repaired release, retesting every original issue and low-rated criterion. Open **Human update verification for the repaired release (修复版真人更新验证)**, enter observations, and link the routes actually completed. Open the old save to verify that it still runs its original release, or, when the system confirms compatibility, test an explicitly created migration child save. Confirm the four update declarations and freeze the update receipt.

Receipts are stored with the work and retained in full backups. Images also require the per-image review applicable to the current version. Failed calibration, unresolved issues, or a missing real repair and old-save retest leave the corresponding acceptance step pending. The person who actually played supplies the ratings and confirmations.

## Player controls and saves

The Player view provides scenes, maps, quests, characters, inventory, combat, crafting and trade, world records, and save settings. Inspect action requirements, costs, and results; follow explanations for unavailable actions.

New games and existing saves each bind to an immutable release. Existing saves are never silently upgraded; migration requires a compatible, validated path. Confirm the target before restoring, branching, or deleting a timeline. Deleting one timeline does not remove other saves or its frozen release.

Runtime AI can assist with intent interpretation, character dialogue, and result expression, within gameplay state and permission boundaries. On service failure, inspect the error and recovery options instead of repeatedly resending an action whose result is unknown.

## Three-track production, image review, and partial repair

The production workspace brings content, gameplay-system, and media dependencies together. Review images explicitly, then complete quality checks and publication. These workflows are merged through [PR #134](https://github.com/yuanbw2025/storyforge/pull/134).

- The production workspace groups progress into **game content**, **product systems**, and **media**. Expand each group to inspect missing artifacts, dependencies, blocked tasks, usage, and the existing repair entry. These groups contribute to one game and retain the underlying execution lanes.
- New builds freeze the three groups' input hashes during assembly. A repair creates a child build and reruns the affected dependencies; historical builds, releases, and saves stay pinned to their original versions. New-format records require an application version containing this update; older applications may reject them.
- Image review requires opening each verified image, accepting or rejecting it, and explicitly confirming personal review. Character groups use declared identities only; automatic checks do not judge visual similarity. Rejected images require a media repair. New builds with images need this review before the final publication quality gate can pass. Existing image generation/import and declared silent audio fallback remain available.
- In the player's **More (更多)** view, choose **Read local experience records (读取本地体验记录)** to inspect quest, combat, travel, free-input, and repetition counts. Mainline duration is the wall-clock span between recorded progress events, including idle/offline time. Same-source/fingerprint counts are not semantic similarity scores. Unverifiable AI records are reported separately.
- Choose an issue category, describe the problem without source text or private information, and export a feedback file to your device. The form is not saved until exported; nothing is uploaded or automatically sent to the author. Feedback and telemetry do not sign a human playtest receipt.

Historical Salt Ridge browser evidence was not obtained in this development environment. Engineering and mock-provider checks do not replace independent real-model calibration, two human-played endings, actual image-quality review, or a real successor release and old-save retest.

## Current limits

The catalog still marks this product as a preview. Engineering checks, automated play, and a showcase do not replace real-service calibration, long sessions, or independent human acceptance. [Back up](/en/guides/backup-restore) important work.

Evidence: [Dedicated entry](https://github.com/yuanbw2025/storyforge/commit/541c9d04) · [Salt Ridge showcase](https://github.com/yuanbw2025/storyforge/commit/a4bc3f62).
