import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  createReferenceAnalysisRun,
  deleteReferenceWithAnalysis,
  discardReferenceAnalysisRun,
} from '../../src/lib/reference-analysis/lifecycle'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from '../../src/lib/registry/project-tables'
import { transactionTablesForReferenceCascade } from '../../src/lib/registry/lifecycle'
import type { WorkspaceScope } from '../../src/lib/types'
import {
  cascadeRegisteredReferences,
  deleteWork,
  deleteWorkspace,
  deleteWorld,
} from '../../src/lib/workspace/lifecycle'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import {
  addCurrentWorkFixtureV1,
  addCurrentWorldFixtureV1,
  seedCurrentWorkspace,
} from '../helpers/current-workspace'

async function referenceFixture(scope: WorkspaceScope, label: string, existingReferenceId?: number) {
  await switchActiveWork(scope.projectId, scope.workId)
  const referenceId = existingReferenceId ?? await db.references.add(stampNewRecord(scope, 'references', {
    projectId: scope.projectId, workId: scope.workId,
    title: label, author: 'synthetic author', type: 'story' as const, note: '', url: '',
    createdAt: 1, updatedAt: 1,
  }, { owner: 'work' }))
  const sourceText = `synthetic original ${label}`
  const run = await createReferenceAnalysisRun({
    referenceId, depth: 'quick', sourceFilename: `${label}.txt`, fileHash: `synthetic-${label}`,
    totalChars: sourceText.length, expectedChunks: 1, sourceKind: 'own-work',
    usageScope: 'analysis-only', rightsConfirmed: true, sourceText,
  })
  await db.referenceChunkAnalysis.add(stampNewRecord(scope, 'referenceChunkAnalysis', {
    referenceId, analysisRunId: run.id!, chunkIndex: 0, label: 'synthetic chunk',
    openingTechnique: `synthetic analysis ${label}`, createdAt: 1,
  }, { owner: 'work' }))
  const source = (await db.referenceAnalysisSources.get(run.id!))!
  expect(source).not.toHaveProperty('id')
  expect(db.referenceAnalysisSources.schema.primKey.keyPath).toBe('analysisRunId')
  return { scope, referenceId, runId: run.id!, source }
}

async function ownerFixture() {
  const { scope } = await seedCurrentWorkspace('delete-target')
  const sibling = await createWorldWork(scope.projectId, { title: 'same-world-survivor' })
  const otherWorld = await addCurrentWorldFixtureV1({ projectId: scope.projectId, name: 'other-world' })
  const otherWork = await addCurrentWorkFixtureV1({
    projectId: scope.projectId, worldId: otherWorld.id!, create: { title: 'other-world-survivor' },
  })
  const foreign = await seedCurrentWorkspace('other-project-survivor')
  const target = await referenceFixture(scope, 'target')
  const sameWorld = await referenceFixture({ ...scope, workId: sibling.id! }, 'same-world')
  const differentWorld = await referenceFixture({
    projectId: scope.projectId, worldId: otherWorld.id!, workId: otherWork.id!,
  }, 'other-world')
  const differentProject = await referenceFixture(foreign.scope, 'other-project')
  await switchActiveWork(scope.projectId, scope.workId)
  return { target, sameWorld, differentWorld, differentProject }
}

async function expectReferencePresent(fixture: Awaited<ReturnType<typeof referenceFixture>>) {
  expect(await db.works.get(fixture.scope.workId)).toBeDefined()
  expect(await db.references.get(fixture.referenceId)).toBeDefined()
  expect(await db.referenceAnalysisRuns.get(fixture.runId)).toBeDefined()
  expect(await db.referenceAnalysisSources.get(fixture.runId)).toEqual(fixture.source)
  expect(await db.referenceChunkAnalysis.where('analysisRunId').equals(fixture.runId).count()).toBe(1)
}

async function expectReferenceDeleted(fixture: Awaited<ReturnType<typeof referenceFixture>>) {
  expect(await db.references.get(fixture.referenceId)).toBeUndefined()
  expect(await db.referenceAnalysisRuns.get(fixture.runId)).toBeUndefined()
  expect(await db.referenceAnalysisSources.get(fixture.runId)).toBeUndefined()
  expect(await db.referenceChunkAnalysis.where('analysisRunId').equals(fixture.runId).count()).toBe(0)
}

async function registeredSnapshot() {
  return Object.fromEntries(await Promise.all(PROJECT_TABLES
    .filter(spec => spec.owner !== 'global')
    .map(async spec => [spec.name, await spec.table.toArray()])))
}

async function deleteOwner(scope: WorkspaceScope, owner: 'work' | 'world') {
  if (owner === 'work') await deleteWork(scope.workId)
  else await deleteWorld(scope.worldId, { confirm: true })
}

describe('SFQA-014 · registered lifecycle uses the real primary key', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it.each(['work', 'world'] as const)('deleting a %s removes original text and preserves other owners', async owner => {
    const fixtures = await ownerFixture()
    await deleteOwner(fixtures.target.scope, owner)
    await expectReferenceDeleted(fixtures.target)
    expect(await db.works.get(fixtures.target.scope.workId)).toBeUndefined()
    if (owner === 'world') {
      await expectReferenceDeleted(fixtures.sameWorld)
      expect(await db.worlds.get(fixtures.target.scope.worldId)).toBeUndefined()
      expect(await db.works.get(fixtures.sameWorld.scope.workId)).toBeUndefined()
    } else {
      await expectReferencePresent(fixtures.sameWorld)
      expect(await db.worlds.get(fixtures.target.scope.worldId)).toBeDefined()
    }
    await expectReferencePresent(fixtures.differentWorld)
    await expectReferencePresent(fixtures.differentProject)
  })

  it.each(['work', 'world'] as const)('deleting a %s also cleans a stored owner after its old parent is gone', async owner => {
    const fixtures = await ownerFixture()
    // A local legacy/interrupted row still has its stamped owner. An unrelated
    // extra id property must never override this table's analysisRunId key.
    const legacySource = {
      ...fixtures.target.source, id: fixtures.differentProject.runId,
    }
    await db.referenceAnalysisSources.put(legacySource)
    await db.referenceAnalysisRuns.delete(fixtures.target.runId)
    await deleteOwner(fixtures.target.scope, owner)
    expect(await db.referenceAnalysisSources.get(fixtures.target.runId)).toBeUndefined()
    await expectReferencePresent(fixtures.differentWorld)
    await expectReferencePresent(fixtures.differentProject)
  })

  it.each(['exclusive-work', 'exclusive-world', 'work-instance'] as const)(
    'uses the real key for the %s owner locator', async locator => {
      const fixtures = await ownerFixture()
      const spec = REGISTRY_BY_NAME.get('referenceAnalysisSources')!
      const originalOwner = spec.domainOwner
      const source = locator === 'exclusive-world'
        ? { ...fixtures.target.source, workId: null, worldId: fixtures.target.scope.worldId }
        : fixtures.target.source
      // The current table uses a Work field. Apply the other two supported
      // locator contracts only within this isolated generic lifecycle test.
      await db.referenceAnalysisRuns.delete(fixtures.target.runId)
      spec.domainOwner = locator === 'work-instance' ? {
        allowed: ['work', 'instance'], defaultOwner: 'work',
        locator: { kind: 'exclusive-work-instance', workField: 'workId', instanceField: 'productRuntimeSessionId' },
      } : {
        allowed: ['world', 'work'], defaultOwner: 'work',
        locator: { kind: 'exclusive-fields', worldField: 'worldId', workField: 'workId' },
      }
      try {
        await spec.table.put(source)
        await deleteOwner(fixtures.target.scope, locator === 'exclusive-world' ? 'world' : 'work')
      } finally {
        spec.domainOwner = originalOwner
      }
      expect(await db.referenceAnalysisSources.get(fixtures.target.runId)).toBeUndefined()
      await expectReferencePresent(fixtures.differentWorld)
      await expectReferencePresent(fixtures.differentProject)
    },
  )

  it('follows registered cascades into a non-id primary-key table before deleting the parent', async () => {
    const fixtures = await ownerFixture()
    await db.transaction('rw', transactionTablesForReferenceCascade('referenceAnalysisRuns'), async () => {
      await cascadeRegisteredReferences('referenceAnalysisRuns', fixtures.target.runId)
      await db.referenceAnalysisRuns.delete(fixtures.target.runId)
    })
    expect(await db.references.get(fixtures.target.referenceId)).toBeDefined()
    expect(await db.referenceAnalysisSources.get(fixtures.target.runId)).toBeUndefined()
    expect(await db.referenceChunkAnalysis.where('analysisRunId').equals(fixtures.target.runId).count()).toBe(0)
    await expectReferencePresent(fixtures.sameWorld)
    await expectReferencePresent(fixtures.differentProject)
  })

  it('uses the real key for a registered unindexed nullable reference', async () => {
    const fixtures = await ownerFixture()
    const groupId = await db.worldGroups.add(stampNewRecord(fixtures.target.scope, 'worldGroups', {
      projectId: fixtures.target.scope.projectId, name: 'synthetic nullable reference source',
      description: '', type: 'custom' as const, order: 0, createdAt: 1, updatedAt: 1,
    }, { owner: 'world' }))
    const source = { ...fixtures.target.source, legacyGroupId: groupId, id: fixtures.differentProject.runId }
    await db.referenceAnalysisSources.put(source)
    const spec = REGISTRY_BY_NAME.get('worldGroups')!
    const originalRefs = spec.refs
    // Exercise an extension of registered metadata against the actual non-id
    // table; no production schema or registry entry is changed by this test.
    spec.refs = [...(originalRefs ?? []), {
      kind: 'simple', field: 'id', target: 'referenceAnalysisSources[legacyGroupId]', onDelete: 'setNull',
    }]
    try {
      await db.transaction('rw', transactionTablesForReferenceCascade('worldGroups'), async () => {
        await cascadeRegisteredReferences('worldGroups', groupId)
        await db.worldGroups.delete(groupId)
      })
    } finally {
      spec.refs = originalRefs
    }
    expect(await db.referenceAnalysisSources.get(fixtures.target.runId)).toEqual({ ...source, legacyGroupId: null })
    await expectReferencePresent(fixtures.differentProject)
  })

  it.each(['work', 'world'] as const)('rolls back non-id deletion when the final %s delete fails', async owner => {
    const fixtures = await ownerFixture()
    const before = await registeredSnapshot()
    const deletedSourceKeys: number[] = []
    const onDelete = (key: number) => { deletedSourceKeys.push(key) }
    db.referenceAnalysisSources.hook('deleting', onDelete)
    vi.spyOn(owner === 'work' ? db.works : db.worlds, 'delete')
      .mockRejectedValueOnce(new Error('synthetic final owner delete failure'))
    try {
      await expect(deleteOwner(fixtures.target.scope, owner)).rejects.toThrow('synthetic final owner delete failure')
    } finally {
      db.referenceAnalysisSources.hook('deleting').unsubscribe(onDelete)
    }
    expect(deletedSourceKeys).toContain(fixtures.target.runId)
    expect(await registeredSnapshot()).toEqual(before)
  })

  it('requires confirmation before changing a populated World', async () => {
    const fixtures = await ownerFixture()
    const before = await registeredSnapshot()
    await expect(deleteWorld(fixtures.target.scope.worldId)).rejects.toThrow('必须显式确认')
    expect(await registeredSnapshot()).toEqual(before)
  })

  it.each(['project', 'reference', 'run'] as const)('preserves the existing %s deletion contract', async entry => {
    const fixtures = await ownerFixture()
    if (entry === 'project') {
      await deleteWorkspace(fixtures.target.scope.projectId)
      await expectReferenceDeleted(fixtures.sameWorld)
      await expectReferenceDeleted(fixtures.differentWorld)
      expect(await db.projects.get(fixtures.target.scope.projectId)).toBeUndefined()
    } else if (entry === 'reference') {
      await deleteReferenceWithAnalysis(fixtures.target.referenceId)
      await expectReferencePresent(fixtures.sameWorld)
    } else {
      await discardReferenceAnalysisRun(fixtures.target.runId)
      expect(await db.references.get(fixtures.target.referenceId)).toBeDefined()
      await expectReferencePresent(fixtures.sameWorld)
    }
    expect(await db.referenceAnalysisRuns.get(fixtures.target.runId)).toBeUndefined()
    expect(await db.referenceAnalysisSources.get(fixtures.target.runId)).toBeUndefined()
    expect(await db.referenceChunkAnalysis.where('analysisRunId').equals(fixtures.target.runId).count()).toBe(0)
    await expectReferencePresent(fixtures.differentProject)
  })

  it.each(['work', 'world'] as const)('deletes a restored %s without exporting or changing local original text', async owner => {
    const fixtures = await ownerFixture()
    const backup = await exportProjectJSON(fixtures.target.scope.projectId)
    expect(backup).not.toHaveProperty('referenceAnalysisSources')
    const restoredProjectId = await importProjectJSON(backup)
    const restoredReference = await db.references.where('projectId').equals(restoredProjectId)
      .filter(row => row.title === 'target').first()
    expect(restoredReference).toBeDefined()
    const restoredWork = (await db.works.get(restoredReference!.workId!))!
    const restoredScope = { projectId: restoredProjectId, worldId: restoredWork.worldId, workId: restoredWork.id! }
    const restoredRun = await db.referenceAnalysisRuns.where('referenceId').equals(restoredReference!.id!).first()
    expect(restoredRun?.fileHash).toBe('synthetic-target')
    expect(await db.referenceAnalysisSources.get(restoredRun!.id!)).toBeUndefined()
    const resumed = await referenceFixture(restoredScope, 'restored-local-original', restoredReference!.id!)
    await deleteOwner(restoredScope, owner)
    await expectReferenceDeleted(resumed)
    expect(await db.referenceAnalysisRuns.get(restoredRun!.id!)).toBeUndefined()
    await expectReferencePresent(fixtures.target)
    await expectReferencePresent(fixtures.differentProject)
  })
})
