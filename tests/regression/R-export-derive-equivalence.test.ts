/**
 * R-export-derive-equivalence · 派生导出格式 ≡ 真实旧格式(防漂移)
 *
 * AUDIT-1 切换后,旧手写导出已删,改用一份**真实旧手写版生成的 fixture**
 * (tests/fixtures/legacy-export-v3.json)作对照基准:派生导出当前 seed 项目,逐字段必须
 * 与该旧格式一致(抹平 exportedAt + 旧版冗余的树 parentId 死字段后)。绿 = 导出格式未漂移,
 * 已下载的旧备份 / Gist 云存档继续兼容。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { db } from '../../src/lib/db/schema'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { seedFullProject } from '../helpers/seed-full-project'

const legacyFixturePath = path.resolve(__dirname, '../fixtures/legacy-export-v3.json')

/**
 * 对齐两处无害的有意差异后比较:
 * 1. exportedAt(Date.now)抹平。
 * 2. 旧手写版 outlineNodes/worldNodes 冗余保留了原始 parentId(db id 死字段,导入侧解构即丢);
 *    派生版干净去除。两者导入结果一致,删掉对齐。
 */
function normalize(data: any) {
  data.exportedAt = 0
  for (const t of ['outlineNodes', 'worldNodes']) {
    for (const row of (data as any)[t] ?? []) delete row.parentId
  }
  for (const row of data.detailedOutlines ?? []) {
    delete row._appearingCharacterIndexes
    delete row._foreshadowIndexes
    delete row._sceneCharacterIndexes
  }
  for (const row of data.creativeRules ?? []) delete row._citedReferenceIndexes
  // CONSISTENCY-2: 新表没有旧手写版 fixture 对应字段；其格式与 FK 往返由
  // R-export-fullcoverage 单独锁死，这里仍只比较旧格式共有部分。
  delete data.knowledgeLedger
  // Phase 39 同理；StoryArc 现在为下游动态表提供显式 exportId，旧 fixture 不含。
  delete data.storylineProgress
  delete data.storylineCrossings
  for (const row of data.storyArcs ?? []) delete row._exportId
  for (const row of data.worldNodes ?? []) {
    if (row.portalsJSON === undefined) delete row.portalsJSON
  }
  // INV-1: itemLedger now carries heldByName + characterId + _characterExportId;
  // legacy fixture predates these fields. Strip them for format-compat comparison.
  for (const row of data.itemLedger ?? []) {
    delete row.heldByName
    delete row.characterId
    delete row._characterExportId
  }
  // CONSISTENCY-3: temporalFacts 新增四类可移植设定来源 FK。旧 fixture 没有这些
  // 影子字段；新格式的实际往返由 R-CONSISTENCY3-world-constitution 锁定。
  for (const row of data.temporalFacts ?? []) {
    delete row._srcWorldviewExportId
    delete row._srcPowerSystemExportId
    delete row._srcStoryCoreExportId
    delete row._srcCharacterExportId
    delete row._srcCultivationSystemExportId
  }
  // WORLD-1:修炼体系及角色/词条的新便携 FK 没有旧 fixture 对应字段；
  // 新表和这些 FK 的往返由 R-export-fullcoverage 锁定。
  delete data.cultivationSystems
  delete data.cultivationProgress
  // STORY-1:角色驱动方案及项目 active 影子引用为新格式；专项往返由 R-CF9C 锁定。
  delete data.characterDrivenPlans
  delete data.project?._activeCharacterDrivenPlanExportId
  // IDEA-1:增量灵感工作区晚于旧 v3 fixture；来源/版本往返由 R-CM1 与
  // R-export-fullcoverage 锁定。
  delete data.inspirationWorkspaces
  // IDEA-1 reference analysis runs are a new portable layer. Legacy chunks had no
  // run shadow id; version/remap behavior is covered by R-IDEA1-reference-evolution.
  delete data.referenceAnalysisRuns
  for (const row of data.referenceChunkAnalysis ?? []) delete row._analysisRunExportId
  // AGENT-2 / FLOW-2 project process data is newer than the legacy v3 fixture.
  // Its exact remap and roundtrip contract is covered by R-export-fullcoverage.
  delete data.agentConversations
  delete data.agentEvents
  // HARNESS-1 durable run ledger postdates the historical v3 fixture. Its
  // replay, remap and roundtrip contracts are covered by R-HARNESS1 tests.
  delete data.agentRuns
  delete data.agentRunEvents
  delete data.agentRunCheckpoints
  delete data.nodeFlows
  delete data.nodeRuns
  // SIM-1 process/runtime data is newer than the legacy v3 fixture.
  // Parent/session/world remaps are covered by R-export-fullcoverage and R-SIM1-runtime-core.
  delete data.simulationSessions
  delete data.simulationEvents
  delete data.simulationCheckpoints
  // WORLD-2C roots/bindings are optional extensions to v3 until strict v4 ownership.
  // Their portable remaps are covered by R-export-fullcoverage and R-WORLD2C.
  delete data.worlds
  delete data.works
  delete data.workCharacterBindings
  // WORLD-2D/2E tables postdate the historical v3 fixture. Their portable
  // owner/FK contracts are covered by strict v4 full-coverage and WORLD-2E tests.
  delete data.narrativeModules
  delete data.narrativeNodes
  delete data.worldRevisions
  delete data.worldReleases
  delete data.project?._activeWorldExportId
  delete data.project?._activeWorkExportId
  for (const row of data.characters ?? []) {
    delete row._raceEntryExportId
    delete row._cultivationSystemExportId
    delete row.cultivationStageId
  }
  for (const row of data.codexEntries ?? []) {
    delete row._cultivationSystemExportId
    delete row._importantLocationExportId
    delete row.cultivationStageId
  }
  return data
}

describe('R-export-derive-equivalence · 派生导出 ≡ 真实旧格式 fixture', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('派生导出当前 seed 与旧手写版 fixture 逐字段相等', async () => {
    const legacy = JSON.parse(fs.readFileSync(legacyFixturePath, 'utf8'))
    const { projectId } = await seedFullProject()
    const derived = await deriveExportProjectJSON(projectId)
    expect(normalize(derived)).toEqual(normalize(legacy))
  })
})
