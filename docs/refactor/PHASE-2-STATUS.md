# Phase 2 Status - Content Integrity and Multiworld Linkage

> Scope source: `docs/MASTER-BLUEPRINT.md` Phase 2.

## Task Board

| Task | Status | Branch / Commit | Summary |
|---|---|---|---|
| 2.1 Phase 40 `worldRulesProfiles` multiworld | Done | `refactor/phase-2-task-2.1` / this task commit | `worldRulesProfiles` is now project+world scoped, loaded by world tab, exported/imported with world-group remap, lifecycle-covered by `PROJECT_TABLES`, and injected through `CONTEXT_SOURCES` with per-world timeline/keyword filtering. |
| 2.2 `chapter-adapter` real `worldRulesContext` | Done | `refactor/phase-2-task-2.2` / this task commit | `buildChapterContentPrompt` now accepts and renders `worldRulesContext`; `ChapterEditor` passes the assembled `worldRules` segment into chapter prose generation. |
| 2.3 `AIFieldCard` current value injection | Done | `refactor/phase-2-task-2.3` / this task commit | Single-field AI generation now has expand/rewrite/polish modes; expand/polish include current value, rewrite ignores current value. |
| 2.4 `chunk-writer` target `worldGroupId` | Done | `refactor/phase-2-task-2.4` / this task commit | Import sessions record a target world, the confirm modal lets multiworld users choose it, and chunk writes stamp worldview/characters/outline to that world. |
| 2.5 Batch detail/content `worldContextResolver` | Done | `refactor/phase-2-task-2.5` / this task commit | Batch chapter content generation now supports per-chapter world context resolution; batch detail already used this resolver and remains covered. |
| 2.6 Character JSON reference remap | Done | `refactor/phase-2-task-2.6` / this task commit | Character delete/merge now rewrites registered detailed-outline array/scene JSON references and remaps character state cards by name. |
| 2.7 Selective state extraction | Done | `refactor/phase-2-task-2.7` / this task commit | Manual and automatic state extraction now use selective state recall based on the chapter text instead of full state context. |
| 2.8 Remaining P1 fixes | Pending | - | Close remaining P1 issues listed in `MASTER-BLUEPRINT.md`. |

## 2.1 Verification Evidence

- `npx tsc --noEmit`: passed.
- `npm test -- tests/registry/assemble-context.test.ts tests/regression/R-03-export-world-group-remap.test.ts tests/registry/project-tables.test.ts`: 3 files / 15 tests passed.
- `npm test`: 13 files / 40 tests passed.
- `npm run check:required-tables`: 45 tables match `schema.ts`.
- `npm run build`: passed; existing Vite dynamic-import/chunk-size warnings only.

## 2.1 Completion Notes

- DB schema v27 changes `worldRulesProfiles` to `++id, projectId, worldGroupId`.
- `WorldRulesPanel` adds per-world tabs in multiworld projects and filters historical preview data by current world.
- `buildWorldRulesContext(projectId, worldGroupId?)` resolves explicit worlds strictly, falls back to null/default/primary only for project-level calls, and filters historical timeline/keyword helpers by effective world.
- `CONTEXT_SOURCES.worldRules` is now a world-scoped source.
- `PROJECT_TABLES` now marks `worldRulesProfiles` as world-scoped/exportable with `worldGroupId` remap, so stamp/delete/export paths are registry-derived.
- Batch outline generation now supports a per-volume `worldRulesContextResolver`, preventing default-world rules from leaking into parallel-world batch outline generation.

## 2.2 Verification Evidence

- `npx tsc --noEmit`: passed.
- `npm test -- tests/regression/R-11-chapter-world-rules-context.test.ts`: 1 file / 1 test passed.
- `npm test`: 14 files / 41 tests passed.
- `npm run check:required-tables`: 45 tables match `schema.ts`.
- `npm run build`: passed; existing Vite dynamic-import/chunk-size warnings only.

## 2.2 Completion Notes

- `buildChapterContentPrompt` now passes `worldRulesContext` into `renderPrompt` for the `chapter.content` seed.
- `ChapterEditor` extracts the `worldRules` segment from `assembleContext()` and sends it as a dedicated adapter variable.
- R-11 verifies the actual rendered prompt messages contain the real-vs-fiction rule text.

## 2.3 Verification Evidence

- `npx tsc --noEmit`: passed.
- `npm test -- tests/regression/R-12-ai-field-current-value.test.ts`: 1 file / 2 tests passed.
- `npm test`: 15 files / 43 tests passed.
- `npm run check:required-tables`: 45 tables match `schema.ts`.
- `npm run build`: passed; existing Vite dynamic-import/chunk-size warnings only.

## 2.3 Completion Notes

- Added `FieldGenerationMode` and a shared `AIFieldModeTabs` segmented control.
- `AIFieldCard` now passes current value and selected mode to its `buildMessages` callback.
- `story.generate`, `worldview.dimension`, and `character.dimension` adapters include mode guidance; expand/polish include current field content, rewrite deliberately ignores it.
- Existing story core and worldview single-field generation controls now pass their current field value and expose expand/rewrite/polish mode selection.
- R-12 verifies rendered prompts include current value in expand mode and omit it in rewrite mode.

## 2.4 Verification Evidence

- `npx tsc --noEmit`: passed.
- `npm test -- tests/regression/R-13-import-target-world.test.ts`: 1 file / 1 test passed.
- `npm test`: 16 files / 44 tests passed.
- `npm run check:required-tables`: 45 tables match `schema.ts`.
- `npm run build`: passed; existing Vite dynamic-import/chunk-size warnings only.

## 2.4 Completion Notes

- DB schema v28 indexes `importSessions.targetWorldGroupId`.
- `ImportSession` records `targetWorldGroupId` for project imports.
- `ImportConfirmModal` shows a target-world selector for multiworld project imports.
- `ImportDocPanel` stores the selected target world in the session and stamps pre-created volume skeletons.
- `pipeline` passes `session.targetWorldGroupId` into `applyChunkResult`.
- `chunk-writer` scopes worldview merge, character de-duplication, and outline volume reuse to the target world, then stamps new rows through `adopt()`.
- R-13 verifies imported worldview, characters, and outline nodes land in the selected world and do not merge same-name characters from another world.

## 2.5 Verification Evidence

- `npx tsc --noEmit`: passed.
- `npm test -- tests/regression/R-14-batch-chapter-world-context.test.ts`: 1 file / 1 test passed.
- `npm test`: 17 files / 45 tests passed.
- `npm run check:required-tables`: 45 tables match `schema.ts`.
- `npm run build`: passed; existing Vite dynamic-import/chunk-size warnings only.

## 2.5 Completion Notes

- `BatchChapterOptions` now accepts `worldContextResolver?(chapterNodeId)`.
- `batchGenerateChapters` resolves `chWorldContext` per chapter before building `chapter.content` messages.
- R-14 mocks `chat()` and verifies each generated prompt uses the resolver context instead of the fallback context.

## 2.6 Verification Evidence

- `npx tsc --noEmit`: passed.
- `npm test -- tests/regression/R-15-character-reference-remap.test.ts`: 1 file / 2 tests passed.
- `npm test`: 18 files / 47 tests passed.
- `npm run check:required-tables`: 45 tables match `schema.ts`.
- `npm run build`: passed; existing Vite dynamic-import/chunk-size warnings only.

## 2.6 Completion Notes

- Added `applyCharacterReferenceRemap()` as the shared role-reference cleanup/remap entry.
- The helper derives detailed-outline array and scene JSON updates from `PROJECT_TABLES` refs targeting `characters`.
- Manual `deleteCharacter()` now runs character deletion, relation cleanup, detailed-outline cleanup, and character state-card deletion in one transaction.
- Import character merge now remaps duplicate-character references to the primary character and merges duplicate character state cards by `entityName`.
- R-15 covers both delete and merge paths for `appearingCharacterIds`, `scenes[].characterIds`, `characterRelations`, and character `stateCards`.

## 2.7 Verification Evidence

- `npx tsc --noEmit`: passed.
- `npm test -- tests/regression/R-16-selective-state-extraction.test.ts`: 1 file / 2 tests passed.
- `npm test`: 19 files / 49 tests passed.
- `npm run check:required-tables`: 45 tables match `schema.ts`.
- `npm run build`: passed; existing Vite dynamic-import/chunk-size warnings only.

## 2.7 Completion Notes

- `handleExtractState()` now passes `buildSelectiveStateContext(plainText, extraStateIds).text` into `buildStateExtractPrompt()`.
- `handleAutoPostGenerate()` now passes `buildSelectiveStateContext(text, extraStateIds).text` into automatic state extraction.
- R-16 locks both wiring points so `const stateCtx = buildStateContext()` cannot silently return in those extraction paths.
