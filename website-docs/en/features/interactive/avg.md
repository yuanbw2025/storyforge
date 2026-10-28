---
productId: upper.avg
status: preview
lastVerified: 2026-10-28
---
# AVG and visual novels

> Preview: author workbench, production revision, release, and player saves are connected. Generated literary and audiovisual quality still require per-work acceptance.

Entry: AVG → Library (AVG → 作品库). Try the [no-API built-in work](/en/guides/examples) first to understand the stage and choices.

## Recommended workflow

1. Define goals in Production → Story and experience (制作台 → 故事与体验), and branches in Routes and ending goals (路线与结局目标).
2. Select a world version; confirm candidates and the production plan through Planning conversation (方案会谈).
3. Start Production flow (制作流程), checking Narrative graph and dialogue (叙事图与对白) and Variables and endings (变量与结局).
4. Check assets and presentation references under Backgrounds and sprites (背景与立绘), Audio and presentation (音频与演出), and Asset management (素材管理).
5. Run Checks and playtest (检查与试玩), revise issues, and retain a release.
6. Play at Play → Player stage (游玩 → 玩家舞台), managing progress through Saves and routes (存档与路线).

## Text and presentation

Story beats can reference backgrounds, characters, and audio. Missing assets or invalid references affect the stage; successful text generation does not mean audiovisual delivery is complete.

Check that each important route reaches its intended ending and that stage state is correct after loading a save.

## Experimental images, voice, and local prototypes

In an available development preview, open the relevant media panels from the author workspace. First establish requirements, purpose, sources, and usage rights. Image and audio services are configured separately; saving a requirement does not send a request.

1. Image production (图片生产) manages backgrounds, character families, reference images, and original candidates. Generation-only references do not automatically become stage assets. Inspect originals, exact sources, and cost records before reviewing purpose/rights and explicitly selecting an image.
2. For local processing, inspect input images, recipes, and output versions. Two-image region composites, foreground, and expression processing retain provenance and receipts. Incomplete processing, blocking reviews, or stale sources prevent adoption. Being able to inspect existing requirements does not mean new image calls are enabled in that environment.
3. Per-line voice requirements (逐句配音需求) select 1–8 saved dialogue lines. Check speakers, service capabilities, licensed voices, and delivery before explicitly starting. Wait for the batch to finish, then listen line by line, compare originals and processed results, and adopt. An audio file appearing does not mean production has finished.
4. Check voice, BGM, ambience, and effect bindings and overlapping playback. Adopting one track does not voice every line. Recover failed/interrupted slots through their existing controls, retaining originals and history.
5. After playtesting, use Local prototype acceptance (本地原型版本验收) to select a completed preview save, check the route and frozen media, and explicitly save a local prototype. Start an independent save from that version; later edits create a new Build without rewriting older versions.

Use a [complete backup](/en/guides/backup-restore) for transfer and inspect media, provenance, and frozen versions after recovery. Engineering verification of nine media categories and recovery does not replace story, visual, listening, or commercial acceptance of each work. Source: [PR #219](https://github.com/yuanbw2025/storyforge/pull/219).

## Current boundaries

Built-in works use prepared story and assets to demonstrate a playable result. This does not mean arbitrary worlds automatically produce comparable quality. Audiovisual assets require lawful sources and actual service support.

Continue: [Shared interactive workflow](/en/features/interactive/) · [Backup and recovery](/en/guides/backup-restore).
