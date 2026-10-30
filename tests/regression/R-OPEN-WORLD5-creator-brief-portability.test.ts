import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { verifyTextOpenWorldCreatorBriefV1 } from '../../src/lib/open-world/creator-brief-persistence'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { seedQuality005LegacyChapterBriefV1 } from '../helpers/quality005-legacy-chapter-brief'

async function snapshotPersistentDatabase() {
  const entries = await Promise.all([...db.tables]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(async table => [table.name, await table.toArray()] as const))
  return Object.fromEntries(entries)
}

async function expectImportPreflightFailure(
  backup: Parameters<typeof importProjectJSON>[0],
  error: RegExp,
): Promise<void> {
  const before = await snapshotPersistentDatabase()
  const transactionSpy = vi.spyOn(db, 'transaction')
  try {
    await expect(importProjectJSON(backup)).rejects.toThrow(error)
    expect(transactionSpy).not.toHaveBeenCalled()
  } finally {
    transactionSpy.mockRestore()
  }
  expect(await snapshotPersistentDatabase()).toEqual(before)
}

describe('R-OPEN-WORLD5 · 历史 Creator Brief 章节定位器便携闭包', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('导出导入会同时重映射 Production、Creator Brief、章节列表和 candidate Run，并保持便携 Brief Hash', async () => {
    const fixture = await seedQuality005LegacyChapterBriefV1()
    await createWorkspace({ name: '占位工作区', genres: ['other'], status: 'drafting', description: '', targetWordCount: 1, enableMultiWorld: false })
    const sourceProductionId = fixture.confirmed.production.id
    const sourceBriefId = fixture.brief.id!
    const sourceRunId = fixture.brief.candidateRunId!
    const sourceBriefHash = fixture.brief.briefHash
    const sourceBindingHash = fixture.brief.sourceBindingHash
    const backup = await exportProjectJSON(fixture.novel.scope.projectId)

    const productionShadow = backup.productProductions[0]!
    const briefShadow = backup.productProductionBriefs[0]!
    expect(productionShadow).toMatchObject({
      creatorSourceKind: 'novel',
      creatorSourceSelectionMode: 'chapters',
      _creatorSourceWorkExportId: 0,
      _creatorSourceChapterExportIds: [0, 2],
      creatorSourceBindingHash: sourceBindingHash,
    })
    expect(briefShadow).toMatchObject({
      briefKind: 'text-open-world-creator-v1',
      sourceKind: 'novel',
      sourceSelectionMode: 'chapters',
      _productionExportId: 0,
      _sourceWorkExportId: 0,
      _sourceChapterExportIds: [0, 2],
      _candidateRunExportId: 0,
      briefHash: sourceBriefHash,
      sourceBindingHash,
    })
    expect(productionShadow).not.toHaveProperty('creatorSourceWorkId')
    expect(productionShadow).not.toHaveProperty('creatorSourceChapterIdsJson')
    expect(briefShadow).not.toHaveProperty('sourceWorkId')
    expect(briefShadow).not.toHaveProperty('sourceChapterIdsJson')
    expect(briefShadow).not.toHaveProperty('candidateRunId')

    const importedProjectId = await importProjectJSON(structuredClone(backup))
    const importedOwnership = await resolveWorkspaceOwnership(importedProjectId)
    const [production, brief, importedChapters] = await Promise.all([
      db.productProductions.where('projectId').equals(importedProjectId).first(),
      db.productProductionBriefs.where('projectId').equals(importedProjectId).first(),
      db.chapters.where('projectId').equals(importedProjectId).sortBy('order'),
    ])
    expect(production?.id).not.toBe(sourceProductionId)
    expect(brief?.id).not.toBe(sourceBriefId)
    expect(brief?.candidateRunId).not.toBe(sourceRunId)
    expect(production).toMatchObject({
      workId: importedOwnership.scope.workId,
      creatorSourceWorkId: importedOwnership.scope.workId,
      creatorSourceSelectionMode: 'chapters',
      creatorSourceBindingHash: sourceBindingHash,
    })
    expect(brief).toMatchObject({
      productionId: production?.id,
      workId: importedOwnership.scope.workId,
      sourceWorkId: importedOwnership.scope.workId,
      sourceSelectionMode: 'chapters',
      briefHash: sourceBriefHash,
      sourceBindingHash,
    })
    const expectedImportedChapterIds = [importedChapters[0]!.id!, importedChapters[2]!.id!]
    expect(JSON.parse(production!.creatorSourceChapterIdsJson!)).toEqual(expectedImportedChapterIds)
    expect(JSON.parse(brief!.sourceChapterIdsJson!)).toEqual(expectedImportedChapterIds)

    const verifiedBrief = await verifyTextOpenWorldCreatorBriefV1(brief!.briefJson)
    expect(verifiedBrief.briefHash).toBe(sourceBriefHash)
    expect(verifiedBrief.sourceBindingHash).toBe(sourceBindingHash)
    const importedRun = await readAgentRunV1(importedOwnership.scope, brief!.candidateRunId!)
    expect(importedRun.contract.runtimeBindingHash).toBe(verifiedBrief.candidateEvidence.runBindingHash)
    expect(importedRun.projection.state).toBe('running')
    expect(importedRun.events.slice(-1)[0]).toMatchObject({
      type: 'verification.staled',
      payload: { reason: 'project-import-scope-rebound' },
    })
    expect(importedRun.projection.terminalReceiptHash).toBeUndefined()
  }, 30_000)

  it('缺失一个被 chapters locator 引用的章节映射时在事务前 fail-closed', async () => {
    const fixture = await seedQuality005LegacyChapterBriefV1()
    const backup = await exportProjectJSON(fixture.novel.scope.projectId)
    expect(backup.productProductions[0]?._creatorSourceChapterExportIds).toEqual([0, 2])
    expect(backup.productProductionBriefs[0]?._sourceChapterExportIds).toEqual([0, 2])

    backup.chapters.splice(2, 1)
    await expectImportPreflightFailure(
      backup,
      /Creator selected chapter|缺失必填引用映射|引用越界/,
    )
  }, 30_000)

  it('Creator Brief 引用的候选 Run 不再是匹配完成态时在事务前拒绝导入', async () => {
    const fixture = await seedQuality005LegacyChapterBriefV1()
    const backup = await exportProjectJSON(fixture.novel.scope.projectId)
    backup.agentRuns[0]!.status = 'running'

    await expectImportPreflightFailure(backup, /完整且匹配的候选 Run 终态证据/)
  }, 30_000)

  it('删除候选 Run 的终态事件但保留伪完成投影时仍在事务前拒绝导入', async () => {
    const fixture = await seedQuality005LegacyChapterBriefV1()
    const backup = await exportProjectJSON(fixture.novel.scope.projectId)
    const terminalIndex = backup.agentRunEvents.map(event => (
      event._agentRunExportId === backup.productProductionBriefs[0]!._candidateRunExportId
      && event.type === 'verification.accepted'
    )).lastIndexOf(true)
    expect(terminalIndex).toBeGreaterThanOrEqual(0)
    backup.agentRunEvents.splice(terminalIndex, 1)

    await expectImportPreflightFailure(backup, /完整且匹配的候选 Run 终态证据/)
  }, 30_000)

  it('候选 Run 的 ContextManifest 证据与 Brief 分裂时拒绝导入', async () => {
    const fixture = await seedQuality005LegacyChapterBriefV1()
    const backup = await exportProjectJSON(fixture.novel.scope.projectId)
    const contextEvent = backup.agentRunEvents.find(event => event.type === 'context.assembled')
    expect(contextEvent).toBeDefined()
    const payload = JSON.parse(contextEvent!.payloadJson)
    contextEvent!.payloadJson = JSON.stringify({ ...payload, manifestHash: 'f'.repeat(64) })

    await expectImportPreflightFailure(backup, /完整且匹配的候选 Run 终态证据/)
  }, 30_000)

  it('候选 RunContract JSON 与 portable contractHash 分裂时在事务前拒绝导入', async () => {
    const fixture = await seedQuality005LegacyChapterBriefV1()
    const backup = await exportProjectJSON(fixture.novel.scope.projectId)
    const runExportId = backup.productProductionBriefs[0]!._candidateRunExportId
    const run = backup.agentRuns.find(candidate => candidate._exportId === runExportId)
    expect(run).toBeDefined()
    const contract = JSON.parse(run!.contractJson)
    run!.contractJson = JSON.stringify({
      ...contract,
      objective: `${contract.objective}（备份篡改）`,
    })

    await expectImportPreflightFailure(backup, /Creator candidate RunContract Hash 不匹配/)
  }, 30_000)

  it('候选 Run event 的 portable 世界组与 Run 分裂时在事务前拒绝导入', async () => {
    const fixture = await seedQuality005LegacyChapterBriefV1()
    const backup = await exportProjectJSON(fixture.novel.scope.projectId)
    const runExportId = backup.productProductionBriefs[0]!._candidateRunExportId
    const run = backup.agentRuns.find(candidate => candidate._exportId === runExportId)
    const event = backup.agentRunEvents.find(candidate => candidate._agentRunExportId === runExportId)
    expect(run).toBeDefined()
    expect(event).toBeDefined()
    event!._worldGroupExportId = run!._worldGroupExportId == null ? 0 : null

    await expectImportPreflightFailure(backup, /Creator candidate Run event 世界组与运行不一致/)
  }, 30_000)

  it('已因首次导入失效的候选 Run 仍可随项目再次完整导出导入', async () => {
    const fixture = await seedQuality005LegacyChapterBriefV1()
    const firstBackup = await exportProjectJSON(fixture.novel.scope.projectId)
    const firstImportedProjectId = await importProjectJSON(firstBackup)
    const secondBackup = await exportProjectJSON(firstImportedProjectId)
    const secondImportedProjectId = await importProjectJSON(secondBackup)
    const ownership = await resolveWorkspaceOwnership(secondImportedProjectId)
    const brief = await db.productProductionBriefs.where('projectId').equals(secondImportedProjectId).first()
    expect(brief?.candidateRunId).toBeTruthy()
    const run = await readAgentRunV1(ownership.scope, brief!.candidateRunId!)
    expect(run.projection.state).toBe('running')
    expect(run.events.slice(-1)[0]).toMatchObject({
      type: 'verification.staled',
      payload: { reason: 'project-import-scope-rebound' },
    })
  }, 30_000)
})
