# StoryForge Refactor Progress

> ## ✅ COMPLETE — Phases 0/1/2/3 all done, merged to `main` and deployed (2026-06-09)
> Merge commit `6dd652d`; deployed via my-website + Vercel. Final gates: tsc=0 / 87 tests / architecture lint clean / 45 required tables / generated AI manual matches code / build OK. This board is now a historical record. 当时的 remaining items 原文保存在 `/docs/ROADMAP-LEGACY.md`；当前状态必须以 `/docs/roadmap/README.md` 与 `CAPABILITY-BASELINE.md` 为准，不能按本历史清单重新施工。
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
| `PROJECT_TABLES` registry | 1.1 | Done | 39 current Dexie required tables registered; lifecycle selectors/APIs added; `deleteProject` / `deleteGroup` / `migrateToMultiWorld` now use registry-derived APIs. |
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

## Post-Refactor Audit Fixes

| Task | Status | Branch / Commit | Summary | Verification |
|---|---|---|---|---|
| P0-1 `worldNodes.portalsJSON` export/import remap | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Added a shared defensive portal parser, changed registry JSON ref path to `targetWorldId`, remapped portal targets on export/import, and covered malformed render JSON plus roundtrip ownership. | `npm test`; `npm run test:coverage`; `npm run build`; checks below |
| P0-2a import transaction registry-derived | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Removed the import-side hardcoded transaction table list; `importProjectJSON` now uses `transactionTablesFor('importProject')`, derived from `PROJECT_TABLES`. | `tests/registry/project-tables.test.ts`; full verification below |
| P0-2b exportable table lifecycle guard | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Added an architecture guard that fails when a `PROJECT_TABLES` `exportable: true` table is missing from `ProjectExportData`, `exportProjectJSON`, or `importProjectJSON`. Full declarative remap generation remains a later, larger refactor. | `npm run check:architecture` |
| P0-3 Gist PAT session-only | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Default PAT storage moved to `sessionStorage`; explicit remember writes `localStorage`; legacy local token remains recognized; UI now explains PAT storage and Gist plaintext JSON upload. | `tests/regression/R-gist-backup.test.ts`; full verification below |
| P0-3b AI API Key session-only | Done locally | `codex/fix-p0-portal-remap` / uncommitted | AI API Key now defaults to `sessionStorage`; users can explicitly remember it in `localStorage`; legacy localStorage configs stay compatible; session-only presets no longer persist the key. | `tests/regression/R-ai-config-storage.test.ts`; `tests/regression/R-gist-backup.test.ts`; `npx tsc --noEmit` |
| P0-4 AI category/meta guard | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Added real `ai.start/chat/streamChat` category enforcement to `check-architecture`, filled missing categories, and regenerated AI manual from actual call expressions. | `npm run check:architecture`; `npm run check:ai-manual`; `tests/registry/ai-manual.test.ts` |
| P0-5 onboarding settings route | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Added global `/settings` route and changed WelcomeGuide CTA away from invalid `/workspace/settings`. | `tests/regression/R-18-phase2-p1-fixes.test.ts`; full verification below |
| P0-6 historical context multiworld filter | Done locally | `codex/fix-p0-portal-remap` / uncommitted | `buildHistoricalContext` now reads current world + global old data for multiworld projects and preserves single-world full reads. | `tests/registry/assemble-context.test.ts`; full verification below |
| P1-3 app-level dialogs/toasts | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Added shared `DialogProvider`, replaced React component `alert/confirm/prompt` usage with Dialog/Toast, wired the high-risk backup guard through an injectable app dialog adapter, and added an architecture guard preventing UI native dialog regressions. Only pre-React schema mismatch keeps native `window.alert`. | `npm run check:architecture`; `rg --pcre2` native dialog scan; `npx tsc --noEmit`; `npm test` |
| P1-5 API/PAT risk disclosure | Done locally | `codex/fix-p0-portal-remap` / uncommitted | README, WelcomeGuide, AI settings, properties tips, and CloudBackupCard now use conditional privacy wording and explain third-party AI/Gist data flow. | `npx tsc --noEmit`; `npm run build` |
| P1-6 request trim respects `contextWindow` | Done locally | `codex/fix-p0-portal-remap` / uncommitted | `trimMessagesToFit` now accepts `contextWindowOverride`; `chat` and `streamChat` pass `config.contextWindow`. | `tests/registry/fb8-context-window.test.ts`; full verification below |
| P1 sanitizer hardening | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Added SVG sanitizer XSS payload coverage and upgraded export HTML sanitization from regex-only cleanup to DOM allowlist filtering with a no-DOM fallback. | `tests/regression/R-18-phase2-p1-fixes.test.ts`; `npx tsc --noEmit`; `npm run build` |
| P1 legacy DB upgrade fixture | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Added a real Dexie v28→v29 upgrade fixture that seeds old `itemSystems`/`factions`, opens the same DB with the v29 upgrade hook, verifies codex migration, and asserts old object stores are removed. | `tests/regression/R-C3-legacy-tables-drop.test.ts`; `npx tsc --noEmit` |
| P1 legacy DB upgrade fixtures v31/v32 | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Added real Dexie upgrade fixtures for v30→v31 reference-analysis reset and v31→v32 master-study store removal; import session blobs and references are explicitly preserved. | `tests/regression/R-db-upgrade-fixtures.test.ts`; `npx tsc --noEmit` |
| P1 build warning cleanup | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Removed the ineffective dynamic import of `stores/outline` from `ImportDocPanel`; Vite no longer warns that `outline.ts` is both dynamically and statically imported. Chunk-size warning remains. | `npx tsc --noEmit`; `npm run build` |
| P1 workspace code splitting | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Lazy-loaded non-initial workspace side panels and the standalone settings panel. Production build now has no Vite warnings, with the main app chunk reduced from ~1.48 MB to ~534 KB minified. | `npx tsc --noEmit`; `npm run build`; smoke/regression targeted tests |
| P1 docs drift cleanup | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Updated roadmap/data-flow/master blueprint references that still described request-side context trimming and main bundle size as unresolved after the fixes. | `rg` stale-text scan |
| P1 docs/CI drift cleanup | Done locally | `codex/fix-p0-portal-remap` / uncommitted | README/AGENTS updated for current port/table/security facts; `REQUIRED_TABLES_V26` renamed; local `npm run ci` now matches GitHub coverage flow. | `npm run check:required-tables`; `npm run test:coverage`; `npm run build` |
| P1 AI manual generator hardening | Done locally | `codex/fix-p0-portal-remap` / uncommitted | `generate-ai-manual` now scans `enumeration()` fields and real `ai.start/chat/streamChat` call expressions across components/hooks/lib, so generated manual reports 0 uncategorized calls and includes enum fields. | `npm run gen:ai-manual`; `npm run check:ai-manual` |
| P1 privacy/product wording cleanup | Done locally | `codex/fix-p0-portal-remap` / uncommitted | README, Feature Guide, Community Guide, promo materials, AI settings, properties tips, and cloud backup wording now distinguish default local storage from third-party AI/Gist data flow; stale localStorage-only claims removed. | `rg` privacy stale-text scan |
| P1 unfinished UI guard | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Replaced dead "正在开发/即将推出" UI with Labs/redirect wording and added an architecture rule blocking new WIP promise text in formal UI. | `npm run check:architecture`; `rg` WIP-text scan |
| P1 table/schema docs sync | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Feature Guide, Architecture, README, data-flow docs, world-rules design notes, and promo materials now reflect 39 required tables, 31 exportable backup tables, v32 master table removal, and fixed BUG-EXPORT-WG status. | `npm run check:required-tables`; `rg` stale table/remap scan |
| P1 golden-finger import classification | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Added prompt boundaries and import normalization so generic "金手指/系统/外挂/天赋/道具" headings are not adopted as pseudo-characters; bound protagonist concepts append to character abilities, owner-unclear concepts route to `worldview.itemDesign`, and anthropomorphized system spirits remain characters. | `tests/regression/R-golden-finger-import.test.ts`; `npx tsc --noEmit`; `npm run check:ai-manual` |
| P1 outline volume adoption visibility hardening | Done locally | `codex/fix-p0-portal-remap` / uncommitted | Locked the FB-10 root cause: AI volume adoption may write a row that duplicate detection sees, while the left volume list hides top-level rows if `parentId` is missing/legacy `undefined`; extracted a shared selector that treats both `null` and missing `parentId` as top-level and added success feedback after full write. | `tests/regression/R-FB10-volume-adopt.test.ts`; `npx tsc --noEmit`; `npm run check:architecture`; `npm run build` |

Full verification for this local batch: `npm run check:required-tables` (39 tables); `npm run check:architecture`; `npm run gen:ai-manual && npm run check:ai-manual`; `npx tsc --noEmit`; `npm test` (49 files / 166 tests); `npm run test:coverage` (49 files / 166 tests, overall line coverage 52.02%); `npm run build` (no Vite warnings, main app chunk about 534 KB minified); plus targeted stale-text scans for privacy wording, WIP UI copy, table counts, and BUG-EXPORT-WG status.

## Execution Notes

- The reviewer is temporarily unavailable. Work is proceeding as stacked task branches and commits for later independent review.
- Do not merge stacked branches into `main` before review.
- Each task still needs isolated verification evidence and a dedicated commit.
- Existing unrelated dirty docs are not part of task commits unless explicitly staged for that task.
- Phase 2 final local verification on `refactor/phase-2-task-2.8`: `npx tsc --noEmit`, `npm test` (20 files / 57 tests), `npm run check:required-tables`, and `npm run build` passed.
