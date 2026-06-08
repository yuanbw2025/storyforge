# StoryForge Refactor Progress

> Purpose: single progress board for the whole refactor. `PHASE-0-STATUS.md` records detailed Phase 0 execution logs; this file shows the complete project-level picture.

## Overall Phases

| Phase | Status | Goal | Completion Signal |
|---|---|---|---|
| Phase 0 - Emergency fixes | In progress | Remove immediate data-loss and invalid-transaction risks before building new architecture. | P0.1-P0.8 all fixed, regression tests green, build green. |
| Phase 1 - Three registries foundation | Pending | Build `PROJECT_TABLES`, `FIELD_REGISTRY + AdoptionSchema`, and `CONTEXT_SOURCES + assembleContext` as single sources of truth. | Lifecycle/read/write paths use registry-derived APIs; lint and registry tests pass. |
| Phase 2 - Multiworld and content integrity | Pending | Finish multiworld linkage, context completeness, AI current-value usage, import/world routing, and JSON reference cleanup. | Multiworld generation/import/export do not cross-contaminate; AI reads and writes the intended fields. |
| Phase 3 - Project polish | Pending | Add generated AI manual, CI, coverage, safety, performance, README, contributing docs, and i18n preparation. | CI green, coverage target met, generated docs match code, project is presentable as a mature open-source tool. |

## Core Architecture Work

| Core Item | Phase | Status | Scope |
|---|---|---|---|
| `PROJECT_TABLES` registry | 1.1 | Pending | Register all 45 Dexie tables, owners, exportability, lifecycle behavior, refs, world scope, blob ownership, and derived lifecycle APIs. |
| `FIELD_REGISTRY` | 1.2 | Pending | Register writable singleton fields, aliases, types, enums, enum aliases, sanitizers, and world-scoped write rules. |
| `AdoptionSchema` | 1.2 | Pending | Register collection writes such as characters, foreshadows, outline nodes, codex entries, dedupe policy, FK checks, array member checks, and merge strategies. |
| `adopt()` unified write path | 1.2 | Pending | Route AI output and structured adoption through validation, alias mapping, dedupe, FK checks, and typed DB writes. |
| `CONTEXT_SOURCES` registry | 1.3 | Pending | Register AI context sources, scope, budgets, worldGroupId requirements, enablement rules, and test assertions. |
| `assembleContext()` unified read path | 1.3 | Pending | Replace scattered hand-built AI context with one budgeted, world-aware, truly trimmed context assembly API. |
| Registry validation and lint | 1.1-1.3 / 3.3 | Pending | Validate Dexie tables vs registries, prompt keys, AI meta coverage, transaction scope, manual sync, and source isolation. |
| Generated AI manual | 3.1 | Pending | Generate AI behavior documentation from prompt modules, context declarations, adoption schemas, and call metadata. |

## Phase 0 Emergency Fixes

| Task | Status | Branch / Commit | Summary |
|---|---|---|---|
| 0.1 deleteGroup transaction scope | Done | `refactor/phase-0-task-0.1` / `45ac028` | `deleteGroup` uses temporary 45-table `PROJECT_TABLES_ALL`; `R-01` enabled and green. |
| 0.2 migrateToMultiWorld transaction scope | Done | `refactor/phase-0-task-0.2` / `31cb206` | `migrateToMultiWorld` transaction includes `db.codexEntries`; `R-02` added and green. |
| 0.3 ensureSchema delete-db risk | Done | `refactor/phase-0-task-0.3` / this task commit | Production schema self-check blocks reset instead of deleting IndexedDB; 45-table drift check added. |
| 0.4 BUG-EXPORT-WG worldGroupId remap | Done | `refactor/phase-0-task-0.4` / this task commit | Multiworld backup ownership uses export ids and imports back to the corresponding new world groups. |
| 0.5 importProjectJSON transaction + FK fail-fast | Done | `refactor/phase-0-task-0.5` / this task commit | Import is wrapped in one 45-table transaction, invalid FK remaps fail fast, and final FK integrity assertion runs before commit. |
| 0.6 deleteProject indirect ownership cleanup | Pending | TBD | Delete import logs/files/jobs and master-study blobs with the project. |
| 0.7 deleteNode chapter cascade | Pending | TBD | Ensure outline deletion cascades through chapter cleanup paths. |
| 0.8 migrateToMultiWorld outlineNodes stamping | Pending | TBD | Stamp old outline nodes to primary world so they remain visible after migration. |

## Execution Notes

- The reviewer is temporarily unavailable. Work is proceeding as stacked task branches and commits for later independent review.
- Do not merge stacked branches into `main` before review.
- Each task still needs isolated verification evidence and a dedicated commit.
- Existing unrelated dirty docs are not part of task commits unless explicitly staged for that task.
