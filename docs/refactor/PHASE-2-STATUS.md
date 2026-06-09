# Phase 2 Status - Content Integrity and Multiworld Linkage

> ✅ **COMPLETE, REVIEWED & MERGED (2026-06-09)** — tasks 2.1-2.8 done, Claude-reviewed, merged to `main` (`6dd652d`) and deployed. The "pending main merge / real-data smoke test" notes below are now resolved: merged; real-old-data migration deferred to post-deploy monitoring with auto-backup safety net.

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
| 2.8 Remaining P1 fixes | Done | `refactor/phase-2-task-2.8` / this task commit | P1-9 through P1-16 are closed or locked: request trimming, true abort, multiworld context wiring, ID validation, portal cleanup, recursive geography delete, and export sanitization. |

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

## 2.8 Verification Evidence

- `npx tsc --noEmit`: passed.
- `npm test -- tests/regression/R-18-phase2-p1-fixes.test.ts`: 1 file / 8 tests passed.
- `npm test`: 20 files / 57 tests passed.
- `npm run check:required-tables`: 45 tables match `schema.ts`.
- `npm run build`: passed; existing Vite dynamic-import/chunk-size warnings only.

## 2.8 Completion Notes

- P1-9: `chat()` and `streamChat()` now call `trimMessagesToFit()` before fetch so over-window payloads are truly degraded instead of only showing a UI warning.
- P1-10: non-streaming `chat()` accepts `AbortSignal` and passes it to fetch; shared and duplicate `chatWithAbort()` helpers now call the real signal path instead of `Promise.race`.
- P1-11: SceneVerify remains locked to one `assembleContext()` call using the active world group; R-18 asserts `historical` and `worldRules` are read from the same assembled result.
- P1-12: `StoryCorePanel` now loads worldview context with `activeGroupId` in multiworld projects.
- P1-13: enhanced detailed-outline adoption filters hallucinated `appearingCharacterIds`, `foreshadowIds`, and `scenes[].characterIds` before writing.
- P1-14: world-node portal JSON parsing is safe, and deleting a node subtree removes other nodes' portals pointing into that subtree.
- P1-15: legacy geography `locations` JSON deletion now removes the full descendant subtree.
- P1-16: HTML and EPUB export sanitize chapter HTML to remove scripts, event handlers, and `javascript:` URLs.

## Phase 2 Completion

- Status: complete pending external review and main merge.
- Final verification on `refactor/phase-2-task-2.8`: `npx tsc --noEmit`, `npm test` (20 files / 57 tests), `npm run check:required-tables`, and `npm run build` all passed.
- Build warnings are unchanged Vite dynamic-import/chunk-size warnings.

---

## 🔍 审查者复核记录(Claude · 2026-06-09)

> 按 HANDOFF.md §四 7 步流程对 GPT 5.5 的 Phase 1.2a→2.8(12 个 commit)做独立审查。

### 审查结论:✅ 通过,质量高于预期

| Step | 检查项 | 结果 |
|---|---|---|
| 1 | 改动范围 | ✅ 12 个独立 commit,每个对应一任务,可单独回滚 |
| 2 | tsc + build | ✅ tsc=0 / build 成功(3352 模块) |
| 3 | 测试 | ✅ **57 个全绿**(从 27 → 57,新增 30:adopt 7 + assemble-context 4 + R-11~R-18) |
| 4 | 反模式 grep（Phase 1 形态核心） | ✅ **三条全 0 命中** |
| 5 | 灾难场景反推 | ✅ Phase 2 所有 P1 对应反例测试(R-11~R-18)全绿 |
| 6 | 高风险审查(schema v27/v28 迁移) | ✅ 迁移正确,逻辑安全 |
| 7 | 结论 | ✅ 通过 |

### 反模式 grep 详情(三注册表真落地的铁证)

- 面板手挑 `buildWorldContext/buildCharacterContext`：**0 命中**(都走 assembleContext)
- 组件直接 `db.xxx.add/update`：**0 命中**(都走 adopt)
- stores 手写 `db.transaction([...大清单...])`：**0 命中**(都走派生 API)

→ "屎山"的三个根源(读侧手挑 / 写侧散落 / 生命周期手写表清单)被真正收口。

### 逐项功能逻辑核验(确认不是假壳)

- 2.1：schema v27 真改 `worldRulesProfiles` 为 `projectId, worldGroupId`;PROJECT_TABLES 真标 `worldScoped: true` + exportRemap;world-rules store 真按 worldGroupId 维护;`buildWorldRulesContext(projectId, worldGroupId?)` 真接世界参数 → Phase 40 完整落地。
- 2.2：ChapterEditor 真 `import assembleContext` 并调用,worldRules segment 真传入章节正文 prompt(非假壳)。
- 2.3~2.8：各有对应 R-12~R-18 反例测试且全绿。
- adopt.ts(338 行):别名映射 / enum 归一 / sanitize / FK 校验 / 数组成员校验 / 以 DB 为准定位防重复 / 4 种 duplicatePolicy 全实现。
- assemble-context.ts:真裁剪 L3→L2→L1 真实现(L0 不可裁),非 Phase 0 时"只算不裁"。

### 加分项(超出蓝图)

1. 抽出 `character-references.ts` 处理 JSON 数组引用 remap(单一入口,未硬写进 store)。
2. validateRegistry 扩展到校验 FIELD_REGISTRY / AdoptionSchema / CONTEXT_SOURCES(world source 必须声明 worldGroupId,启动期抓漏)。
3. 进度文档每任务带独立 Verification Evidence,自陈"pending external review and main merge"无夸大。

### ⚠️ 合并前必做(非阻断,但涉及真实用户数据)

- **schema v27/v28 是真实用户数据迁移**。Dexie `version().stores()` 只改索引;`worldRulesProfiles` 从 `&projectId`(唯一)→ 非唯一,老数据 worldGroupId=undefined=null=默认主世界,逻辑安全。
- **建议合并 main 前,在浏览器用一份真实老用户数据(单世界 + 多世界各一个项目)实测一次升级**:打开应用→确认数据无损→删项目/删世界组/启用多世界/导出导入各走一遍→确认无报错无残留。
- 这是唯一一道"自动测试覆盖不到、必须真人在浏览器验证"的关口。

### 🟡 流程小注(下次注意,本次不阻断)

- 12 个任务用了堆叠在 `phase-2-task-2.8` 的单分支链,本应一任务一分支。但 commit 独立、可逐个 revert,影响小。

**审查者签字:本批次(0.6 起至 2.8)通过,可进入 Phase 3。合并 main 前请完成上方"真实数据升级实测"。**
