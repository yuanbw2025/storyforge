# StoryForge Refactor Progress

> ## ✅ COMPLETE — Phases 0/1/2/3 all done, merged to `main` and deployed (2026-06-09)
> Merge commit `6dd652d`; deployed via my-website + Vercel. Final gates: tsc=0 / 87 tests / architecture lint clean / 45 required tables / generated AI manual matches code / build OK. This board is now a historical record. Remaining items in `/docs/ROADMAP.md` (FB-2/4/5/6/7/8, Phase 34-37, Phase 35-b/c, BUG-INPUT-WITH-GEN) are NEW features/bugs, not part of this refactor.
>
> Purpose: single progress board for the whole refactor. `PHASE-0-STATUS.md` records detailed Phase 0 execution logs; this file shows the complete project-level picture.

## Overall Phases

| Phase | Status | Goal | Completion Signal |
|---|---|---|---|
| Phase 0 - Emergency fixes | ✅ Done | Remove immediate data-loss and invalid-transaction risks before building new architecture. | P0.1-P0.8 all fixed, regression tests green, build green. |
| Phase 1 - Three registries foundation | ✅ Done | Build `PROJECT_TABLES`, `FIELD_REGISTRY + AdoptionSchema`, and `CONTEXT_SOURCES + assembleContext` as single sources of truth. | Lifecycle/read/write paths use registry-derived APIs; lint and registry tests pass. |
| Phase 2 - Multiworld and content integrity | ✅ Done (Reviewed, Merged) | Finish multiworld linkage, context completeness, AI current-value usage, import/world routing, JSON reference cleanup, and remaining P1 content integrity fixes. | Complete on stacked task branches 2.1-2.8. Reviewed & approved by Claude 2026-06-09. Merged to main 2026-06-09 (`6dd652d`) and deployed. Real-data upgrade smoke test deferred to post-deploy monitoring (auto-backup safety net). |
| Phase 3 - Project polish | ✅ Done (Merged) | Add generated AI manual, CI, coverage, safety, performance, README, contributing docs, and i18n preparation. | All 7 subtasks done (3.1-3.7). CI 6 gates green, generated docs match code, bundle -30%, PAT session-only, i18n scaffold + key-parity test. Merged & deployed 2026-06-09. |

## Core Architecture Work

| Core Item | Phase | Status | Scope |
|---|---|---|---|
| `PROJECT_TABLES` registry | 1.1 | Done | 45 Dexie tables registered; lifecycle selectors/APIs added; `deleteProject` / `deleteGroup` / `migrateToMultiWorld` now use registry-derived APIs. |
| `FIELD_REGISTRY` | 1.2 | Done | Writable singleton/collection fields, aliases, types, enums, enum aliases, sanitizers, and world-scoped write rules are registered for the 1.2 write layer. |
| `AdoptionSchema` | 1.2 | Done | Collection writes for characters, foreshadows, outline nodes, chapters, detailed outlines, story arcs, codex categories, and codex entries now declare identity, dedupe policy, FK checks, array member checks, and stamps. |
| `adopt()` unified write path | 1.2 | Done | AI output and structured adoption paths for 1.2b callers now route through validation, alias mapping, dedupe, FK checks, and typed DB writes. |
| `CONTEXT_SOURCES` registry | 1.3 | Done | 18 AI context sources now declare scope, layer, budgets, worldGroupId/input requirements, enablement rules, and tests. |
| `assembleContext()` unified read path | 1.3 | Done | Pure-add assembly API exists with source requirements, world-aware reads, per-source caps, true L3->L2->L1 trimming, and migrated core generation callers. |
| Registry validation and lint | 1.1-1.3 / 3.3 | ✅ Done | `scripts/check-architecture.mjs` + `check-required-tables.mjs` enforce three-registry law in CI; caught real violations during the refactor. |
| Generated AI manual | 3.1 | ✅ Done | `scripts/generate-ai-manual.mjs` scans prompt modules / context sources / field registry / call metadata → `docs/AI-FUNCTIONS-MANUAL.generated.md`, with `--check` CI gate. |

## Phase 0 Emergency Fixes

| Task | Status | Branch / Commit | Summary |
|---|---|---|---|
| 0.1 deleteGroup transaction scope | Done | `refactor/phase-0-task-0.1` / `45ac028` | `deleteGroup` uses temporary 45-table `PROJECT_TABLES_ALL`; `R-01` enabled and green. |
| 0.2 migrateToMultiWorld transaction scope | Done | `refactor/phase-0-task-0.2` / `31cb206` | `migrateToMultiWorld` transaction includes `db.codexEntries`; `R-02` added and green. |
| 0.3 ensureSchema delete-db risk | Done | `refactor/phase-0-task-0.3` | Production schema self-check blocks reset instead of deleting IndexedDB; 45-table drift check added. |
| 0.4 BUG-EXPORT-WG worldGroupId remap | Done | `refactor/phase-0-task-0.4` | Multiworld backup ownership uses export ids and imports back to the corresponding new world groups. |
| 0.5 importProjectJSON transaction + FK fail-fast | Done | `refactor/phase-0-task-0.5` / `823005b` | Import is wrapped in one 45-table transaction, invalid FK remaps fail fast, and final FK integrity assertion runs before commit. |
| 0.6 deleteProject indirect ownership cleanup | Done | `refactor/phase-0-task-0.6` / `d814d12` | Delete-project cascade covers indirect import/master-study ownership and blobs. |
| 0.7 deleteNode chapter cascade | Done | `refactor/phase-0-task-0.7` / `5cd1dd6` | Outline deletion routes chapter cleanup through the single cascade entry. |
| 0.8 migrateToMultiWorld outlineNodes stamping | Done | `refactor/phase-0-task-0.8` / `e73624d` | Old outline nodes are stamped to the primary world during multiworld migration. |

## Phase 1 Three Registries

| Task | Status | Branch / Commit | Summary |
|---|---|---|---|
| 1.1a PROJECT_TABLES registry + derived APIs | Done | `refactor/phase-1-task-1.1a` / `6cf0613` | Added `src/lib/registry/`, 45-table registry, lifecycle selectors/APIs, and registry tests. |
| 1.1b lifecycle callers switch + startup validation | Done | `refactor/phase-1-task-1.1b` / `fdd02e5` | `deleteProject` / `deleteGroup` / `migrateToMultiWorld` now use derived lifecycle APIs; `main.tsx` validates registry at startup. |
| 1.2a FIELD_REGISTRY + AdoptionSchema + adopt() | Done | `refactor/phase-1-task-1.2a` / this task commit | Pure-add unified write layer; no existing caller migration in this task. |
| 1.2b adopt() caller migration | Done | `refactor/phase-1-task-1.2b` / this task commit | Switched inspiration reverse, world expansion, WorkflowRunner, chunk-writer, saveXxx thin wrappers, and focused AI adoption paths to `adopt()`; added caller regressions. |
| 1.3a CONTEXT_SOURCES + assembleContext() | Done | `refactor/phase-1-task-1.3a` / this task commit | Pure-add unified read/context layer with 18 sources, registry validation, true trimming, and tests. |
| 1.3b AI generation caller migration | Done | `refactor/phase-1-task-1.3b` / this task commit | Switched chapter writing, outline/detail generation, character/foreshadow/story-arc/scene-verify/worldview AI context reads to `assembleContext()`; component/hook old-context grep is clean. |

## Phase 2 Content Integrity and Multiworld Linkage

| Task | Status | Branch / Commit | Summary |
|---|---|---|---|
| 2.1 Phase 40 `worldRulesProfiles` multiworld | Done | `refactor/phase-2-task-2.1` / this task commit | `worldRulesProfiles` is now world-scoped in schema/store/registry/export/import/context injection; per-world UI tabs and regression coverage added. |
| 2.2 `chapter-adapter` real `worldRulesContext` | Done | `refactor/phase-2-task-2.2` / this task commit | `chapter.content` now receives the assembled `worldRules` segment through `buildChapterContentPrompt`; R-11 covers rendered prompt output. |
| 2.3 `AIFieldCard` current value injection | Done | `refactor/phase-2-task-2.3` / this task commit | Added expand/rewrite/polish mode plumbing for single-field AI; current value is included by default and omitted for rewrite mode. |
| 2.4 `chunk-writer` target `worldGroupId` | Done | `refactor/phase-2-task-2.4` / this task commit | Import sessions and chunk writes now route project-imported worldview/characters/outline data to the selected target world; R-13 covers cross-world same-name isolation. |
| 2.5 Batch detail/content `worldContextResolver` | Done | `refactor/phase-2-task-2.5` / this task commit | Batch chapter content now supports per-chapter world context resolver; R-14 verifies prompt routing. |
| 2.6 Character JSON reference remap | Done | `refactor/phase-2-task-2.6` / this task commit | Shared character-reference remap now removes/replaces detailed-outline character arrays, scene JSON character ids, relations, and character state cards; R-15 covers delete and merge. |
| 2.7 Selective state extraction | Done | `refactor/phase-2-task-2.7` / this task commit | Manual and automatic state extraction now use selective recall from chapter text; R-16 locks the wiring. |
| 2.8 Remaining P1 fixes | Done | `refactor/phase-2-task-2.8` / this task commit | Closed P1-9 through P1-16: true request trim, real abort signal, multiworld context locks, ID filtering, portal cleanup, recursive geography delete, and export sanitization; R-18 covers 8 checks. |

## Execution Notes

- The reviewer is temporarily unavailable. Work is proceeding as stacked task branches and commits for later independent review.
- Do not merge stacked branches into `main` before review.
- Each task still needs isolated verification evidence and a dedicated commit.
- Existing unrelated dirty docs are not part of task commits unless explicitly staged for that task.
- Phase 2 final local verification on `refactor/phase-2-task-2.8`: `npx tsc --noEmit`, `npm test` (20 files / 57 tests), `npm run check:required-tables`, and `npm run build` passed.
