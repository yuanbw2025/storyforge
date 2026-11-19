import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, StoryForgeDB, STORYFORGE_STORES, STORYFORGE_STORES_V15 } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { assertRegisteredSourceRunsUnreferencedV1, exactArtifactOwnerTablesV1 } from '../../src/lib/memory/artifact-root-registry'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { encodeFixtureRasterV1, installRasterDecoderForVitestV1 } from '../helpers/raster-decoder-vitest'
import { saveWorkCoverDraftV1 } from '../../src/lib/work-cover/drafts'
import { uploadWorkCoverAssetV1 } from '../../src/lib/work-cover/assets'
import { adoptWorkCoverV1, prepareWorkCoverAdoptionV1 } from '../../src/lib/work-cover/adoption'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { inspectProjectBackup, normalizeProjectBackup } from '../../src/lib/export/backup-trust'

installRasterDecoderForVitestV1()
beforeEach(async () => { await db.delete(); await db.open() })

describe('035 local repair foundation', () => {
  it('freezes V15 and upgrades populated media/Run/cover rows with only two extra indexes', async () => {
    expect(Object.keys(STORYFORGE_STORES)).toEqual(Object.keys(STORYFORGE_STORES_V15))
    expect(Object.keys(STORYFORGE_STORES).filter(key => STORYFORGE_STORES[key as keyof typeof STORYFORGE_STORES]
      !== STORYFORGE_STORES_V15[key as keyof typeof STORYFORGE_STORES_V15])).toEqual(['workCoverAssets', 'workCoverAdoptions'])
    const name = `cover-v15-${crypto.randomUUID()}`, old = new Dexie(name)
    old.version(15).stores(STORYFORGE_STORES_V15); await old.open()
    const entries = {
      works: { id: 42, projectId: 7, worldId: 9, title: '原始作品', coverImage: '原封面', updatedAt: 10 },
      agentRuns: { id: 60, projectId: 7, workId: 42, contractJson: '{"原契约":1}', projectionJson: '{"state":"failed"}' },
      agentRunEvents: { id: 61, runId: 60, sequence: 1, payloadJson: '{"原事件":true}' },
      mediaBlobObjects: { id: 62, projectId: 7, workId: 42, data: encodeFixtureRasterV1(12, 18), contentHash: 'a'.repeat(64) },
      workCoverAssets: { id: 63, projectId: 7, workId: 42, assetKey: 'original', blobObjectId: 62, sourceRunId: 60, candidateJson: '{"原候选":1}' },
      workCoverDrafts: { id: 64, projectId: 7, workId: 42, draftKey: 'original', selectedAssetId: 63, revision: 5 },
      workCoverAdoptions: { id: 65, projectId: 7, workId: 42, operationKey: 'original', sourceRunId: 60, receiptHash: 'b'.repeat(64) },
      workCoverResponseBuffers: { id: 66, projectId: 7, workId: 42, runId: 60, dispatchKey: 'original', state: 'failed', payload: new Uint8Array([1, 2, 3]).buffer },
    }
    for (const [table, row] of Object.entries(entries)) await old.table(table).add(row)
    old.close()
    const next = new StoryForgeDB(name)
    try {
      await next.open(); expect(next.verno).toBe(16)
      for (const [table, row] of Object.entries(entries)) expect(await next.table(table).get(row.id)).toEqual(row)
      for (const table of ['workCoverAssets', 'workCoverAdoptions']) {
        expect(next.table(table).schema.indexes.some(index => index.name === 'materializationRunId')).toBe(true)
      }
    } finally { next.close(); await next.delete() }
  })

  it.each(['workCoverAssets', 'workCoverAdoptions'] as const)('retains either indexed Run reference in %s', async table => {
    // Exercise the generic registered guard independently of candidate admission.
    await db.table(table).add({ projectId: 1, workId: 1, assetKey: 'fixture', operationKey: 'fixture', sourceRunId: 21, materializationRunId: 22 })
    const guard = (ids: number[]) => db.transaction('r', exactArtifactOwnerTablesV1(), () => assertRegisteredSourceRunsUnreferencedV1(ids))
    await expect(guard([21])).rejects.toThrow('仍被')
    await expect(guard([22])).rejects.toThrow('仍被')
    await expect(guard([23])).resolves.toBeUndefined()
  })

  it.each([['sourceRunId'], ['missingIndex'], ['bad.field']])('refuses duplicate/unindexed/unregistered retention metadata: %s', async fields => {
    const spec = PROJECT_TABLES.find(row => row.name === 'workCoverAssets')!, old = spec.sourceRunRetention
    try {
      spec.sourceRunRetention = { field: 'sourceRunId', additionalFields: [fields] }
      await expect(db.transaction('r', exactArtifactOwnerTablesV1(), () => assertRegisteredSourceRunsUnreferencedV1([21]))).rejects.toThrow('登记')
    } finally { spec.sourceRunRetention = old }
  })

  it('rejects a malformed string retention list', async () => {
    const spec = PROJECT_TABLES.find(row => row.name === 'workCoverAssets')!, old = spec.sourceRunRetention
    try {
      // Deliberately exercise this malformed JavaScript metadata value at runtime.
      spec.sourceRunRetention = { field: 'sourceRunId', additionalFields: 'sourceRunId' as unknown as readonly string[] }
      await expect(db.transaction('r', exactArtifactOwnerTablesV1(), () => assertRegisteredSourceRunsUnreferencedV1([21]))).rejects.toThrow('登记')
    } finally { spec.sourceRunRetention = old }
  })

  it('preserves populated v19 upload/adoption bytes and rejects v19 repair evidence before import writes', async () => {
    const { scope, work } = await seedCurrentWorkspace('v19 original cover')
    const draft = await saveWorkCoverDraftV1({ scope, prompt: '海上灯塔', expectedRevision: null, expectedWorkUpdatedAt: work.updatedAt })
    const asset = await uploadWorkCoverAssetV1({ scope, draftId: draft.id, expectedDraftRevision: draft.revision, data: encodeFixtureRasterV1(12, 18) })
    const confirmation = await prepareWorkCoverAdoptionV1({ scope, draftId: draft.id, expectedDraftRevision: draft.revision + 1,
      expectedWorkUpdatedAt: work.updatedAt, assetId: asset.id })
    await adoptWorkCoverV1(scope, confirmation)
    const legacy = { ...await exportProjectJSON(scope.projectId), version: 19 }
    expect(inspectProjectBackup(legacy).valid).toBe(true)
    const normalized = normalizeProjectBackup(legacy)
    expect(normalized).toEqual({ ...legacy, version: 20 })
    const restored = await importProjectJSON(legacy)
    expect((await db.workCoverAssets.where('projectId').equals(restored).first())!.blobHash).toBe(asset.blobHash)
    for (const field of ['_materializationRunExportId', 'repairEvidenceJson', 'candidateJson']) {
      const bad = structuredClone(legacy)
      Object.assign(bad.workCoverAssets[0], { [field]: field === 'candidateJson'
        ? '{"schema":"storyforge.work-cover.repaired-image-candidate@1"}' : field === 'repairEvidenceJson' ? '{}' : 0 })
      expect(inspectProjectBackup(bad).errors.join(';')).toContain('v20')
      const before = await db.projects.count()
      await expect(importProjectJSON(bad)).rejects.toThrow()
      expect(await db.projects.count()).toBe(before)
    }
  })
})
