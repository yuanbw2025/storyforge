# Phase 1 Completion

> ✅ **DONE & MERGED (2026-06-09)** — historical record; merged to `main` (`6dd652d`) and deployed.

> Completed: 2026-06-08 23:54:34 CST  
> Scope: 三注册表地基(PROJECT_TABLES / FIELD_REGISTRY + AdoptionSchema / CONTEXT_SOURCES + assembleContext)

## Completed Tasks

| Task | Branch | Status |
|---|---|---|
| 1.1a PROJECT_TABLES registry + derived APIs | `refactor/phase-1-task-1.1a` | Done |
| 1.1b lifecycle callers switch + startup validation | `refactor/phase-1-task-1.1b` | Done |
| 1.2a FIELD_REGISTRY + AdoptionSchema + adopt() | `refactor/phase-1-task-1.2a` | Done |
| 1.2b adopt() caller migration | `refactor/phase-1-task-1.2b` | Done |
| 1.3a CONTEXT_SOURCES + assembleContext() | `refactor/phase-1-task-1.3a` | Done |
| 1.3b AI generation caller migration | `refactor/phase-1-task-1.3b` | Done |

## Shape Checks

- [x] `PROJECT_TABLES` covers all 45 Dexie tables.
- [x] `deleteProject` / `deleteGroup` / `migrateToMultiWorld` use registry-derived lifecycle APIs.
- [x] `FIELD_REGISTRY` and `ADOPTION_SCHEMAS` validate writable fields, aliases, duplicate policy, FK checks, and array member checks.
- [x] Existing AI/writeback callers migrated in 1.2b route through `adopt()`.
- [x] `CONTEXT_SOURCES` registers 18 context sources with scope, layer, budget, and input requirements.
- [x] `assembleContext()` performs real final-text trimming from L3 to L2 to L1.
- [x] Component/hook old context-builder grep is clean for `buildWorldContext|buildCharacterContext|buildNodeWritingContext|buildCurrentWorldContext|buildCodexContext|buildWorldRulesContext`.

## Verification

- `npx tsc --noEmit`: passed
- `npm test`: passed(13 files / 39 tests)
- `npm run check:required-tables`: passed(45 tables match schema.ts)
- `npm run build`: passed
- Known build warnings remain unchanged: Vite dynamic-import placement and chunk-size warnings.

## Known Follow-up

- Phase 2.1 must make `worldRulesProfiles` world-scoped; until then `worldRules` remains project-scoped in `CONTEXT_SOURCES`.
- Phase 2.3 still needs AIFieldCard current-value injection.
- Phase 2.4 still needs import pipeline target `worldGroupId`.
- Phase 2.6 still needs JSON-array role reference cleanup/remap for character delete/merge.
