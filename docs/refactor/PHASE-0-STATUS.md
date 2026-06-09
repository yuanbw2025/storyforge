# Phase 0 Status Log

> ✅ **COMPLETE & MERGED (2026-06-09)** — Phase 0 (P0.1-P0.8) done, merged to `main` (`6dd652d`), deployed. This file is a historical execution log.

> Purpose: record Phase 0 execution progress after each completed step so the project author can review partial state at any time.

## Phase 0 Task Board

| Task | Status | Branch / Commit | Scope | Required Verification |
|---|---|---|---|---|
| 0.1 deleteGroup transaction scope | Done | `refactor/phase-0-task-0.1` / `45ac028` | Fix deleteGroup Dexie transaction table scope. | `npm test -- R-01`; `npm test`; `npx tsc --noEmit`; `npm run build` |
| 0.2 migrateToMultiWorld transaction scope | Done | `refactor/phase-0-task-0.2` / `31cb206` | Add `db.codexEntries` to migration transaction scope. | `npm test -- R-02`; `npm test -- R-01 R-02`; `npm test`; `npx tsc --noEmit`; `npm run build` |
| 0.3 ensureSchema delete-db risk | Done | `refactor/phase-0-task-0.3` / this task commit | Prevent production schema self-check from calling `Dexie.delete()`; align required table list with DB v26. | `npm test -- R-17`; `npm run check:required-tables`; `npm test`; `tsc`; build |
| 0.4 BUG-EXPORT-WG worldGroupId remap | Done | `refactor/phase-0-task-0.4` / this task commit | Export world group ownership by export ids and import with correct remap. | `npm test -- R-03`; Phase 0 regression suite; `npm test`; `tsc`; build |
| 0.5 importProjectJSON transaction + FK fail-fast | Done | `refactor/phase-0-task-0.5` / this task commit | Wrap import in transaction and abort/rollback on invalid remapped FK. | `npm test -- R-04`; `npm test -- R-03 R-04`; Phase 0 regression suite; `npm test`; `npm run check:required-tables`; `tsc`; build |
| 0.6 deleteProject indirect ownership cleanup | Done | `refactor/phase-0-task-0.6` / this task commit | Collect sessionIds before transaction; bulk-delete importLogs/importFiles by sessionId; bulk-delete master blobs via masterBlobId(workId); clean importJobs by projectId. | `npm test -- R-05`; full regression suite; `npm run check:required-tables`; `tsc`; build |
| 0.7 deleteNode chapter cascade | Done | `refactor/phase-0-task-0.7` / this task commit | Extract `cascadeDeleteChapters` as the single chapter-deletion entry; deleteChapter and deleteNode both route through it so emotionBeatCards are always cleaned. | `npm test -- R-06`; full regression suite; `npm run check:required-tables`; `tsc`; build |
| 0.8 migrateToMultiWorld outlineNodes stamping | Done | `refactor/phase-0-task-0.8` / this task commit | Add db.outlineNodes to migration transaction scope and stamp outline nodes to primary world. | `npm test -- R-07`; full regression suite; `npm run check:required-tables`; `tsc`; build |

Execution note: because the reviewer is temporarily unavailable, Phase 0 tasks after 0.1 are being implemented as stacked task branches and commits. They still require later independent review before main merge.

## Phase 0.1 - deleteGroup Transaction Scope

### 2026-06-08 17:02:38 CST

- Status: started.
- Branch: `refactor/phase-0-task-0.1`.
- Scope: only `MASTER-BLUEPRINT.md` Phase 0.1, `deleteGroup` transaction declaration and corresponding `R-01` regression verification.
- Existing dirty files before Phase 0.1 work:
  - `docs/MASTER-BLUEPRINT.md` existed dirty before this task.
  - `docs/refactor/HANDOFF.md` existed dirty before this task.
  - `docs/refactor/PROJECT_TABLES_ALL.md` was updated immediately before this task per project-author request.
- Rule: unrelated dirty files will not be reverted or included in the Phase 0.1 commit.

### 2026-06-08 17:02:57 CST

- Status: baseline infrastructure verified.
- Command: `npm install && npm test`.
- Result: install succeeded; Vitest passed existing suite.
- Baseline test state: `tests/regression/R-01-delete-group.test.ts` passed only the infrastructure case; the core deleteGroup regression case was still skipped before Phase 0.1 implementation.
- Note: `npm install` reported existing audit findings: 8 moderate, 5 high, 2 critical. This is outside Phase 0.1 scope and was not changed.

### 2026-06-08 17:04:56 CST

- Status: Phase 0.1 code path implemented and regression enabled.
- Changed `src/stores/world-group.ts`: added temporary Phase 0 `PROJECT_TABLES_ALL` with all 45 DB v26 Dexie tables and changed `deleteGroup` to use it for the transaction scope.
- Changed `tests/regression/R-01-delete-group.test.ts`: enabled the core deleteGroup regression case, loaded the store before deletion, and asserted no residual `worldGroupId`/`homeWorldGroupId` references across world-scoped data.
- Command: `npm test -- R-01`.
- Result: passed, 1 file / 2 tests.

### 2026-06-08 17:05:42 CST

- Status: Phase 0.1 verification passed.
- Command: `npx tsc --noEmit`.
- Result: passed with zero errors.
- Command: `npm run build`.
- Result: passed. Vite emitted existing bundle-size/dynamic-import warnings; no build failure.
- Command: `npm test`.
- Result: passed, 2 files / 6 tests.

## Phase 0.2 - migrateToMultiWorld Transaction Scope

### 2026-06-08 17:09:00 CST

- Status: started.
- Branch: `refactor/phase-0-task-0.2`.
- Branch base: stacked on top of `refactor/phase-0-task-0.1` because the project author explicitly requested continuing before Phase 0.1 review/merge.
- Scope: only `MASTER-BLUEPRINT.md` Phase 0.2, `migrateToMultiWorld` transaction declaration and corresponding `R-02` regression verification.
- Existing dirty files before Phase 0.2 work:
  - `docs/MASTER-BLUEPRINT.md` existed dirty before Phase 0.1.
  - `docs/refactor/HANDOFF.md` existed dirty before Phase 0.1.
  - `docs/refactor/PROJECT_TABLES_ALL.md` was updated before Phase 0.1 per project-author request.
- Rule: unrelated dirty files will not be reverted or included in the Phase 0.2 commit.

### 2026-06-08 17:09:48 CST

- Status: Phase 0.2 code path implemented and regression added.
- Changed `src/stores/world-group.ts`: added `db.codexEntries` to the `migrateToMultiWorld` transaction scope.
- Added `tests/regression/R-02-migrate-multiworld.test.ts`: verifies that existing codex entries are stamped to the primary world and migration does not throw.
- Command: `npm test -- R-02`.
- Result: passed, 1 file / 1 test.

### 2026-06-08 17:10:08 CST

- Status: Phase 0.2 verification passed.
- Command: `npm test -- R-01 R-02`.
- Result: passed, 2 files / 3 tests.
- Command: `npm test`.
- Result: passed, 3 files / 7 tests.
- Command: `npx tsc --noEmit`.
- Result: passed with zero errors.
- Command: `npm run build`.
- Result: passed. Vite emitted existing bundle-size/dynamic-import warnings; no build failure.

## Phase 0.3 - ensureSchema Delete-DB Risk

### 2026-06-08 17:14:00 CST

- Status: started.
- Branch: `refactor/phase-0-task-0.3`.
- Branch base: stacked on top of `refactor/phase-0-task-0.2` because the reviewer is temporarily unavailable and the project author requested continuing.
- Scope: `MASTER-BLUEPRINT.md` Phase 0.3, production schema self-check must not delete IndexedDB.
- Added project-level progress board: `docs/refactor/REFACTOR-PROGRESS.md`, including the Phase 1 three-registry foundation work so Phase 0 is not confused with the whole refactor.

### 2026-06-08 17:21:26 CST

- Status: Phase 0.3 code path implemented and regression added.
- Changed `src/lib/db/ensure-schema.ts`: added `REQUIRED_TABLES_V26` with all 45 DB v26 tables; added safe production behavior that blocks reset instead of calling `Dexie.delete()`.
- Changed `src/main.tsx`: passes `allowReset: import.meta.env.DEV`, so production builds do not auto-reset IndexedDB.
- Added `tests/regression/R-17-ensure-schema.test.ts`: checks table-list/schema consistency and verifies production missing-table path does not call `Dexie.delete()`.
- Command: `npm test -- R-17`.
- Result: passed, 1 file / 2 tests.

### 2026-06-08 17:22:56 CST

- Status: Phase 0.3 verification passed.
- Added `scripts/check-required-tables.mjs` and `npm run check:required-tables` so table-list drift fails locally/CI.
- Command: `npm test -- R-01 R-02 R-17`.
- Result: passed, 3 files / 5 tests.
- Command: `npm test`.
- Result: passed, 4 files / 9 tests.
- Command: `npx tsc --noEmit`.
- Result: passed with zero errors.
- Command: `npm run build`.
- Result: passed. Vite emitted existing bundle-size/dynamic-import warnings; no build failure.
- Command: `npm run check:required-tables`.
- Result: passed, 45 tables match `schema.ts`.

## Phase 0.4 - BUG-EXPORT-WG worldGroupId Remap

### 2026-06-08 17:29:30 CST

- Status: Phase 0.4 code path implemented and regression added.
- Branch: `refactor/phase-0-task-0.4`.
- Branch base: stacked on top of `refactor/phase-0-task-0.3`.
- Changed `src/lib/export/json-export.ts`: new exports convert `worldGroupId`/`homeWorldGroupId` into `_worldGroupExportId`/`_homeWorldGroupExportId`; imports create world groups first, then write remapped world ids directly into world-scoped rows.
- Added `tests/regression/R-03-export-world-group-remap.test.ts`: verifies export JSON no longer contains raw world ids and imported records point to the imported side world.
- Command: `npm test -- R-03`.
- Result: passed, 1 file / 1 test.

### 2026-06-08 17:31:52 CST

- Status: Phase 0.4 verification passed.
- Command: `npm test -- R-01 R-02 R-03 R-17`.
- Result: passed, 4 files / 6 tests.
- Command: `npm test`.
- Result: passed, 5 files / 10 tests.
- Command: `npm run check:required-tables`.
- Result: passed, 45 tables match `schema.ts`.
- Command: `npx tsc --noEmit`.
- Result: passed with zero errors.
- Command: `npm run build`.
- Result: passed. Vite emitted existing bundle-size/dynamic-import warnings; no build failure.

## Phase 0.5 - importProjectJSON Transaction + FK Fail-Fast

### 2026-06-08 17:36:57 CST

- Status: started.
- Branch: `refactor/phase-0-task-0.5`.
- Branch base: stacked on top of `refactor/phase-0-task-0.4`.
- Scope: wrap `importProjectJSON` in one Dexie transaction and replace unsafe FK fallback/skip paths with transaction-aborting errors.
- Changed `src/lib/export/json-export.ts`: added temporary 45-table transaction scope and FK remap helpers.
- Added `tests/regression/R-04-import-atomic-fk.test.ts`: verifies a broken chapter outline FK makes import throw and leaves no partial project.

### 2026-06-08 17:43:23 CST

- Status: done.
- Changed `src/lib/export/json-export.ts`: added a final import integrity assertion covering the FK surfaces touched by this task.
- Verification: `npm test -- R-04` passed.
- Verification: `npm test -- R-03 R-04` passed after the integrity assertion was added.
- Verification: `npm test -- R-01 R-02 R-03 R-04 R-17` passed.
- Verification: `npm test` passed.
- Verification: `npm run check:required-tables` passed.
- Verification: `npx tsc --noEmit` passed.
- Verification: `npm run build` passed. Vite emitted existing bundle-size/dynamic-import warnings; no build failure.

---

## 审查者结论 · Phase 0.1 → 0.5 通过(2026-06-08 by Claude)

**审查者**:Claude(本仓库默认审查者,见 HANDOFF §一)
**审查范围**:commits `45ac028` / `31cb206` / `9f748f5` / `f2e8bbc` / `823005b`(Phase 0.1 → 0.5)

### 总评:✅ 通过

GPT 5.5 的 5 个任务交付**质量超出预期**。严格按 MASTER-BLUEPRINT §4 执行,4 个加分项。

### 7 步审查结果

| Step | 检查项 | 结果 |
|---|---|---|
| 1 | git diff 在范围内 | ✅ 5 个独立 commit,每任务一个 |
| 2 | tsc + build | ✅ tsc=0 / build OK |
| 3 | 反例测试 R-01/02/03/04/17 | ✅ 全部通过(11/11) |
| 4 | 反模式 grep | ✅ 无新增"略/TODO/占位";deleteGroup 用 PROJECT_TABLES_ALL;main.tsx 用 `allowReset: import.meta.env.DEV` |
| 5 | 5 个 P0 灾难场景反推 | ✅ 5 个对应反例测试全过,灾难不可能复现 |
| 6 | TARGET-STATE Phase 0 形态检查表 | ✅ 逐项符合 |
| 7 | 审查结论 | ✅ 通过 |

### 4 个加分项(超出蓝图要求)

1. `scripts/check-required-tables.mjs` + `npm run check:required-tables` — schema 漂移在 CI 抓
2. `requireMappedId / requireMappedIdSafe / assertImportRef` 工具函数 — DRY,Phase 1 可复用
3. 保留 `legacyRawId` 兼容路径 — 老备份能继续导入,不破坏现有用户
4. `PHASE-0-STATUS.md` + `REFACTOR-PROGRESS.md` 自建进度跟踪 — 职业开发习惯

### 🟡 小瑕疵(不打回,记录)

- 5 个任务用了同一个分支 `refactor/phase-0-task-0.5`(本应每任务独立分支)
  - 影响小:5 个 commit 独立,仍可单回滚
  - 下次注意:0.6 / 0.7 / 0.8 一个任务一个分支

### 接手者更换说明

GPT 5.5 限额暂停。审查者 Claude 接管 0.6 / 0.7 / 0.8 实施。

剩余三个 P0 任务:
- `0.6` — deleteProject 漏间接归属表(importLogs / importFiles / importJobs / master blob)
- `0.7` — deleteNode 绕过 deleteChapter → emotionBeatCards 残留
- `0.8` — migrateToMultiWorld 漏给 outlineNodes 盖章(Gemini P0-8)

完成后由项目作者最终审查。Phase 0 全部完成 → 打 tag `phase-0-complete` → 合 main → 部署。

---

## Phase 0.6 - deleteProject Indirect Ownership Cleanup

### 2026-06-08 by Claude(接手者)

- **任务**:MASTER-BLUEPRINT §4.0.6 — deleteProject 补间接归属表清理
- **位置**:`src/stores/project.ts`
- **改法**:
  - 事务声明加入 `db.importLogs / db.importFiles / db.importJobs` 三张表
  - 事务前查 `sessionIds = importSessions.where('projectId').equals(id).primaryKeys()` 与
    `legacyMasterSessionIds`(老式 MasterWork.importSessionId)
  - 事务体内 4 步清理:
    1. `importLogs.where('sessionId').anyOf(sessionIds).delete()`
    2. `importFiles.bulkDelete(sessionIds)`(主键即 sessionId)
    3. `importFiles.bulkDelete(workIds.map(masterBlobId))`(master blob,虚拟 sessionId)
    4. `importFiles.bulkDelete(legacyMasterSessionIds)`(老式直接挂的)
    5. `importJobs.where('projectId').equals(id).delete()`
  - import `masterBlobId` from `src/lib/master-study/pipeline` 避免硬编码 `100000+`

- **新增反例测试**:`tests/regression/R-05-delete-project-blob.test.ts`
  - Test 1:全套间接归属表 + master blob 残留检查
  - Test 2:删项目 A 不影响项目 B 的 blob

- **完成判据**:
  - [x] 事务声明含 importLogs/importFiles/importJobs
  - [x] R-05 通过(2 tests)
  - [x] tsc 零错
  - [x] 全部 13 个反例测试通过
  - [x] `npm run check:required-tables` 通过
  - [x] build 通过

- **Verification**:
  - `npm test -- R-05` → 2 passed
  - `npm test` → 13 passed(7 files)
  - `npx tsc --noEmit` → TSC_EXIT=0
  - `npm run check:required-tables` → ok: 45 tables match schema.ts
  - `npm run build` → success

- **灾难场景**:✅ 已根治。用户导入 10MB 小说 blob 后删项目 → blob 不再永久残留。

---

## Phase 0.7 - deleteNode Chapter Cascade

### 2026-06-08 by Claude(接手者)

- **任务**:MASTER-BLUEPRINT §4.0.7 — deleteNode 绕过 deleteChapter → emotionBeatCards 残留
- **位置**:`src/stores/chapter.ts` + `src/stores/outline.ts`
- **改法(遵循"章节删除只能有一个入口")**:
  - chapter store 新增 `cascadeDeleteChapters(ids: number[])` 作为**唯一章节删除入口**:
    - DB 层:事务内 `chapters.bulkDelete(ids)` + 按 chapterId 清 `emotionBeatCards`
    - 内存层:从 chapters 移除 + currentChapter 若被删则置空
  - `deleteChapter(id)` 改为 `await cascadeDeleteChapters([id])`(复用)
  - `outline.deleteNode` 删章节处从 `db.chapters.bulkDelete(...)`(绕过级联)
    改为 `useChapterStore.getState().cascadeDeleteChapters(orphanChapters)`
  - 无循环依赖:outline→chapter 单向,chapter 不 import outline

- **新增反例测试**:`tests/regression/R-06-delete-node-cascade.test.ts`
  - Test 1:删章节节点 → chapters/detailedOutlines/emotionBeatCards 全清 + 内存同步
  - Test 2:删卷(递归子章节)→ 所有后代节拍卡级联清空

- **完成判据**:
  - [x] 章节删除单一入口 cascadeDeleteChapters
  - [x] deleteNode 不再 bulkDelete 绕过级联
  - [x] R-06 通过(2 tests)
  - [x] tsc 零错
  - [x] 全部 15 个反例测试通过
  - [x] `npm run check:required-tables` 通过
  - [x] build 通过

- **Verification**:
  - `npm test -- R-06` → 2 passed
  - `npm test` → 15 passed(8 files)
  - `npx tsc --noEmit` → TSC=0
  - `npm run check:required-tables` → ok
  - `npm run build` → success

- **灾难场景**:✅ 已根治。删大纲卷/章后,情感节拍卡不再残留孤儿。

---

## Phase 0.8 - migrateToMultiWorld outlineNodes Stamping

### 2026-06-08 by Claude(接手者)

- **任务**:MASTER-BLUEPRINT §4.0.8 — migrateToMultiWorld 漏给 outlineNodes 盖章(Gemini-3.1 独立发现 P0-8)
- **位置**:`src/stores/world-group.ts`
- **改法**:
  - 事务声明加入 `db.outlineNodes`
  - stamp 列表加入 `await stamp(db.outlineNodes, await db.outlineNodes.where('projectId').equals(projectId).toArray())`
  - 顺手清理 requireBackupBefore 的 details 文案(原本提到"已知迁移 bug",现已修)

- **新增反例测试**:`tests/regression/R-07-migrate-outline-stamp.test.ts`
  - Test 1:启用多世界后,卷/故事块/章节全部盖章到主世界 + worldview 旁证
  - Test 2:灾难复现验证 — 50 卷大纲启用多世界后,主世界视图仍能看到全部 50 卷(旧 bug 会显示 0 卷)

- **完成判据**:
  - [x] 事务声明含 outlineNodes
  - [x] stamp 列表含 outlineNodes
  - [x] R-07 通过(2 tests)
  - [x] tsc 零错
  - [x] 全部 17 个反例测试通过
  - [x] `npm run check:required-tables` 通过
  - [x] build 通过

- **Verification**:
  - `npm test -- R-07` → 2 passed
  - `npm test` → 17 passed(9 files)
  - `npx tsc --noEmit` → TSC=0
  - `npm run check:required-tables` → ok
  - `npm run build` → success

- **灾难场景**:✅ 已根治。老用户启用多世界后,大纲不再"消失"。

---

## 🎉 Phase 0 全部完成(8/8)

| # | 任务 | 实施者 | 反例测试 |
|---|---|---|---|
| 0.1 | deleteGroup 事务作用域 | GPT-5.5 | R-01 |
| 0.2 | migrateToMultiWorld 补 codexEntries | GPT-5.5 | R-02 |
| 0.3 | ensureSchema 禁删库 | GPT-5.5 | R-17 |
| 0.4 | BUG-EXPORT-WG | GPT-5.5 | R-03 |
| 0.5 | importProjectJSON 事务化 | GPT-5.5 | R-04 |
| 0.6 | deleteProject 间接归属表 | Claude | R-05 |
| 0.7 | deleteNode 章节级联唯一入口 | Claude | R-06 |
| 0.8 | migrateToMultiWorld 补 outlineNodes | Claude | R-07 |

**反例测试网**:17 个测试全绿(R-01~R-06 + R-07 + R-17 + smoke)。
**所有 8 个 P0 灾难场景已根治。**

### 下一步(待项目作者决策)

1. 项目作者最终审查 0.6/0.7/0.8(Claude 自审已过,但跨人复核更稳)
2. 把所有 phase-0 分支合并到 main(或 squash 成 phase-0 合并提交)
3. 打 tag `phase-0-complete`
4. 部署 + 群通告 + 观察 2-3 天
5. 启动 Phase 1(三注册表地基)
