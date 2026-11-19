import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { prepareCoverRunV1, submitCoverImageOnceV1, type CoverImageConnectionV1 } from '../../src/lib/work-cover/run'
import { failCoverRunV1 } from '../../src/lib/work-cover/run-evidence'
import { binaryDataUrlV1, sha256BinaryV1 } from '../../src/lib/media/blob-store'
import { readAgentRunV1, deleteAgentRunV1, createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { repairSavedWorkCoverImageV1 } from '../../src/lib/work-cover/repair'
import { assertLiveRepairedCoverAssetV1 } from '../../src/lib/work-cover/repair-proof'
import { renderWorkCoverV1 } from '../../src/lib/work-cover/adoption'
import { updateWorkCover } from '../../src/lib/workspace/works'
import { deleteWork } from '../../src/lib/workspace/lifecycle'

installRasterDecoderForVitestV1()
beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => vi.unstubAllGlobals())

const connection: CoverImageConnectionV1 = { presetId: 'test-image-preset', imageModel: 'agnes-image-2.1-flash',
  config: { provider: 'agnes', baseUrl: 'https://apihub.agnes-ai.com/v1', apiKey: 'fixture-provider-key', model: 'fixture-text', temperature: 0.7, maxTokens: 0 } }
async function failedImage() {
  // Unit stand-in only; real same-context browser locks are tested in e2e.
  let tail = Promise.resolve()
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, action: () => Promise<unknown>) => {
    const prior = tail; let release!: () => void
    tail = new Promise<void>(resolve => { release = resolve }); await prior
    try { return await action() } finally { release() }
  } } })
  await seedCurrentWorkspace('displaced IDs')
  const { scope, work } = await seedCurrentWorkspace('保存原答恢复')
  const draft = await saveWorkCoverDraftV1({ scope, prompt: '灯塔', expectedRevision: null, expectedWorkUpdatedAt: work.updatedAt })
  const authorization = await prepareCoverRunV1({ scope, draftId: draft.id, expectedDraftRevision: draft.revision, connection, currentConnection: () => connection })
  const bytes = encodeFixtureRasterV1(12, 18)
  const post = vi.fn(async () => new Response(JSON.stringify({ task_id: 'original-receipt', data: [{ url: '', b64_json: binaryDataUrlV1(bytes, 'image/png').split(',')[1] }] }), { status: 200 }))
  vi.stubGlobal('fetch', post); await submitCoverImageOnceV1(authorization)
  const buffer = (await db.workCoverResponseBuffers.where('runId').equals(authorization.runId).first())!
  await db.workCoverResponseBuffers.update(buffer.id!, { state: 'failed', errorCode: 'image-response-rejected' })
  await failCoverRunV1(scope, authorization.runId, 'image-response-rejected')
  const source = await readAgentRunV1(scope, authorization.runId)
  const input = { scope, sourceRunId: authorization.runId, draftId: draft.id, expectedDraftRevision: draft.revision, expectedWorkUpdatedAt: work.updatedAt }
  return { scope, work, draft, bytes, buffer: (await db.workCoverResponseBuffers.get(buffer.id!))!, post, source, input }
}

describe('035 saved local response repair', () => {
  it.each(['after-blob', 'checkpoint', 'after-terminal', 'forged-blob'] as const)('rolls back %s and retries the same local intent without resending', async fault => {
    const f = await failedImage()
    const addAsset = db.workCoverAssets.add.bind(db.workCoverAssets), updateBuffer = db.workCoverResponseBuffers.update.bind(db.workCoverResponseBuffers)
    const spy = fault === 'after-blob'
      ? vi.spyOn(db.workCoverAssets, 'add').mockRejectedValueOnce(new Error('fixture-result-fault'))
      : fault === 'checkpoint'
        ? vi.spyOn(db.agentRunCheckpoints, 'add').mockRejectedValueOnce(new Error('fixture-result-fault'))
        : fault === 'after-terminal'
          ? vi.spyOn(db.workCoverResponseBuffers, 'update').mockImplementation((key, changes) => {
            const raw = (changes as { localRepairJson?: string }).localRepairJson
            if (raw && JSON.parse(raw).phase === 'candidate-ready') throw new Error('fixture-result-fault')
            return updateBuffer(key, changes)
          })
          : vi.spyOn(db.workCoverAssets, 'add').mockImplementation(async row => {
            const id = await addAsset(row), blob = (await db.mediaBlobObjects.get(row.blobObjectId))!
            const data = blob.data!.slice(0); new Uint8Array(data)[0] ^= 1
            await db.mediaBlobObjects.update(blob.id!, { data }) // Keep the claimed hash/metadata unchanged.
            return id
          })
    try { await expect(repairSavedWorkCoverImageV1(f.input)).rejects.toThrow() } finally { spy.mockRestore() }
    expect(await db.workCoverAssets.count()).toBe(0); expect(await db.mediaBlobObjects.count()).toBe(0)
    const original = (await db.workCoverResponseBuffers.get(f.buffer.id!))!
    expect(original.payload).toEqual(f.buffer.payload); expect(original.rawResponseHash).toBe(f.buffer.rawResponseHash)
    expect(original.state).toBe('failed'); expect(original.errorCode).toBe('image-response-rejected')
    expect(await readAgentRunV1(f.scope, f.source.run.id)).toEqual(f.source)
    const intent = JSON.parse(original.localRepairJson!)
    expect(intent.phase).toBe('bound')
    const interrupted = await readAgentRunV1(f.scope, intent.runId)
    expect(interrupted.projection.state).toBe('running')
    expect(interrupted.events.some(event => ['candidate.persisted', 'verification.accepted', 'checkpoint.created'].includes(event.type))).toBe(false)
    expect((await db.works.get(f.scope.workId))!.coverImage ?? '').toBe('')
    const repaired = await repairSavedWorkCoverImageV1(f.input)
    expect(repaired.materializationRunId).toBe(intent.runId)
    expect(await db.agentRuns.count()).toBe(2); expect(await db.workCoverAssets.count()).toBe(1)
    expect(f.post).toHaveBeenCalledTimes(1)
  })

  it.each(['raw', 'decoder', 'http', 'request', 'draft', 'work', 'scope', 'locks'] as const)('rejects changed %s before creating a local root', async changed => {
    const f = await failedImage()
    if (changed === 'raw') { const data = f.buffer.payload!.slice(0); new Uint8Array(data)[0] ^= 1; await db.workCoverResponseBuffers.update(f.buffer.id!, { payload: data }) }
    if (changed === 'decoder') { const data = new TextEncoder().encode('{"data":[{"url":null,"b64_json":"AAAA"}]}').buffer; await db.workCoverResponseBuffers.update(f.buffer.id!, { payload: data, rawResponseHash: await sha256BinaryV1(data) }) }
    if (changed === 'http') await db.workCoverResponseBuffers.update(f.buffer.id!, { httpStatus: 401 })
    if (changed === 'request') await db.workCoverResponseBuffers.update(f.buffer.id!, { requestJson: '{}' })
    if (changed === 'draft') await db.workCoverDrafts.update(f.draft.id, { revision: f.draft.revision + 1 })
    if (changed === 'work') await db.works.update(f.scope.workId, { updatedAt: f.work.updatedAt + 1 })
    if (changed === 'scope') f.input.scope = { ...f.scope, ...(await seedCurrentWorkspace('other scope')).scope }
    if (changed === 'locks') vi.stubGlobal('navigator', {})
    await expect(repairSavedWorkCoverImageV1(f.input)).rejects.toThrow()
    expect(await db.agentRuns.count()).toBe(1); expect(await db.workCoverAssets.count()).toBe(0)
    expect((await db.workCoverResponseBuffers.get(f.buffer.id!))!.payload).toBeInstanceOf(ArrayBuffer)
    expect(f.post).toHaveBeenCalledTimes(1)
  })

  it.each(['work', 'draft'] as const)('rechecks %s after native decode and before reserving/root creation', async changed => {
    const f = await failedImage(), decode = globalThis.createImageBitmap
    const spy = vi.spyOn(globalThis, 'createImageBitmap').mockImplementationOnce(async (...args) => {
      if (changed === 'work') await db.works.update(f.scope.workId, { updatedAt: f.work.updatedAt + 1 })
      else await db.workCoverDrafts.update(f.draft.id, { revision: f.draft.revision + 1 })
      return (decode as (...values: typeof args) => Promise<ImageBitmap>)(...args)
    })
    try { await expect(repairSavedWorkCoverImageV1(f.input)).rejects.toThrow('准备期间') } finally { spy.mockRestore() }
    expect(await db.agentRuns.count()).toBe(1); expect(await db.workCoverAssets.count()).toBe(0)
    const buffer = (await db.workCoverResponseBuffers.get(f.buffer.id!))!
    expect(buffer.localRepairJson).toBeUndefined(); expect(buffer.payload).toEqual(f.buffer.payload)
    expect(await readAgentRunV1(f.scope, f.source.run.id)).toEqual(f.source); expect(f.post).toHaveBeenCalledTimes(1)
  })

  it.each(['reserved', 'creating-root', 'root-committed'] as const)('reconciles the %s crash boundary conservatively', async boundary => {
    const f = await failedImage(), update = db.workCoverResponseBuffers.update.bind(db.workCoverResponseBuffers)
    const spy = boundary === 'creating-root'
      ? vi.spyOn(db.agentRuns, 'add').mockRejectedValueOnce(new Error('fixture-root-interrupted'))
      : vi.spyOn(db.workCoverResponseBuffers, 'update').mockImplementation((key, changes) => {
        const raw = (changes as { localRepairJson?: string }).localRepairJson
        if (raw && JSON.parse(raw).phase === (boundary === 'reserved' ? 'creating-root' : 'bound')) throw new Error('fixture-root-interrupted')
        return update(key, changes)
      })
    try { await expect(repairSavedWorkCoverImageV1(f.input)).rejects.toThrow('fixture-root-interrupted') } finally { spy.mockRestore() }
    expect(await db.agentRuns.count()).toBe(boundary === 'root-committed' ? 2 : 1)
    if (boundary === 'creating-root') {
      await expect(repairSavedWorkCoverImageV1(f.input)).rejects.toThrow('创建结果未知')
      await expect(repairSavedWorkCoverImageV1(f.input)).rejects.toThrow('创建结果未知')
      expect(await db.agentRuns.count()).toBe(1); expect(await db.workCoverAssets.count()).toBe(0)
    } else {
      await repairSavedWorkCoverImageV1(f.input)
      expect(await db.agentRuns.count()).toBe(2); expect(await db.workCoverAssets.count()).toBe(1)
    }
    expect(f.post).toHaveBeenCalledTimes(1)
  })

  it('refuses multiple matching committed roots and corrupt intent nonce without creating another root', async () => {
    const f = await failedImage(), update = db.workCoverResponseBuffers.update.bind(db.workCoverResponseBuffers)
    const spy = vi.spyOn(db.workCoverResponseBuffers, 'update').mockImplementation((key, changes) => {
      const raw = (changes as { localRepairJson?: string }).localRepairJson
      if (raw && JSON.parse(raw).phase === 'bound') throw new Error('fixture-before-bind')
      return update(key, changes)
    })
    try { await expect(repairSavedWorkCoverImageV1(f.input)).rejects.toThrow('fixture-before-bind') } finally { spy.mockRestore() }
    const root = (await db.agentRuns.where('workId').equals(f.scope.workId).toArray()).find(row => row.id !== f.source.run.id)!
    await createAgentRunV1({ scope: f.scope, contract: JSON.parse(root.contractJson) })
    await expect(repairSavedWorkCoverImageV1(f.input)).rejects.toThrow('创建结果未知')
    expect(await db.agentRuns.count()).toBe(3); expect(await db.workCoverAssets.count()).toBe(0)
    const row = (await db.workCoverResponseBuffers.get(f.buffer.id!))!, intent = JSON.parse(row.localRepairJson!)
    await db.workCoverResponseBuffers.update(row.id!, { localRepairJson: JSON.stringify({ ...intent, nonce: 'invalid' }) })
    await expect(repairSavedWorkCoverImageV1(f.input)).rejects.toThrow('意图损坏')
    expect(await db.agentRuns.count()).toBe(3); expect(f.post).toHaveBeenCalledTimes(1)
  })

  it('rejects swapped references, altered witnesses/events/artifacts and arbitrary imported stale tails before writes', async () => {
    const f = await failedImage(), asset = await repairSavedWorkCoverImageV1(f.input)
    const wire = await exportProjectJSON(f.scope.projectId)
    const variants = ['source-ref', 'proof-ref', 'missing-proof', 'foreign-proof', 'witness', 'source-time', 'proof-output', 'candidate', 'roots', 'artifact']
    for (const variant of variants) {
      const bad = structuredClone(wire), row = bad.workCoverAssets[0]
      if (variant === 'source-ref') row._sourceRunExportId = row._materializationRunExportId!
      if (variant === 'proof-ref') row._materializationRunExportId = row._sourceRunExportId
      if (variant === 'missing-proof') bad.agentRuns = bad.agentRuns.filter(run => run._exportId !== row._materializationRunExportId)
      if (variant === 'foreign-proof') bad.agentRuns.find(run => run._exportId === row._materializationRunExportId)!._workOwnerExportId = 999
      if (variant === 'witness') { const evidence = JSON.parse(row.repairEvidenceJson!); evidence.source.httpStatus = 201; row.repairEvidenceJson = JSON.stringify(evidence) }
      if (variant === 'source-time') bad.agentRunEvents.find(event => event._agentRunExportId === row._sourceRunExportId)!.createdAt += 1
      if (variant === 'proof-output') {
        const event = bad.agentRunEvents.find(event => event._agentRunExportId === row._materializationRunExportId && event.type === 'tool.returned')!
        event.payloadJson = JSON.stringify({ ...JSON.parse(event.payloadJson), resultHash: '0'.repeat(64) })
      }
      if (variant === 'candidate') { const candidate = JSON.parse(row.candidateJson!); candidate.responseHash = '0'.repeat(64); row.candidateJson = JSON.stringify(candidate) }
      if (variant === 'roots') row.exactArtifactRefsJson = '[]'
      if (variant === 'artifact') bad.agentRunArtifacts[0].content += 'tampered'
      const before = await db.projects.count()
      await expect(importProjectJSON(bad), variant).rejects.toThrow()
      expect(await db.projects.count(), variant).toBe(before)
    }
    const restored = await importProjectJSON(wire), rebound = await exportProjectJSON(restored)
    const stale = rebound.agentRunEvents.find(event => event.type === 'verification.staled')!
    expect(stale).toBeDefined()
    stale.payloadJson = JSON.stringify({ ...JSON.parse(stale.payloadJson), reason: 'unrelated-staleness' })
    const before = await db.projects.count()
    await expect(importProjectJSON(rebound)).rejects.toThrow()
    expect(await db.projects.count()).toBe(before)
    expect(await readAgentRunV1(f.scope, f.source.run.id)).toEqual(f.source)
    expect((await db.workCoverAssets.get(asset.id))!.repairEvidenceJson).toBe(asset.repairEvidenceJson)
    expect(f.post).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('uses an independent zero-model proof, adopts explicitly, and survives two displaced-ID roundtrips', async () => {
    const f = await failedImage()
    const asset = await repairSavedWorkCoverImageV1(f.input)
    expect(asset.sourceRunId).toBe(f.source.run.id); expect(asset.materializationRunId).not.toBe(f.source.run.id)
    expect((await db.works.get(f.scope.workId))!.coverImage ?? '').toBe('')
    expect(await readAgentRunV1(f.scope, f.source.run.id)).toEqual(f.source)
    const proof = await readAgentRunV1(f.scope, asset.materializationRunId!)
    expect(proof.projection.state).toBe('completed'); expect(proof.contract.budget.maxModelCalls).toBe(0)
    expect(proof.events.some(event => event.type.startsWith('model.'))).toBe(false)
    expect(proof.contract.permissions).toEqual({ contextSourceKeys: [], writeTargets: [] })
    expect(proof.contract.lineage).toBeUndefined(); expect(proof.contract.ownership).toBeUndefined()
    await expect(assertLiveRepairedCoverAssetV1(f.scope, asset)).resolves.toBeDefined()
    expect((await db.workCoverResponseBuffers.get(f.buffer.id!))!).toMatchObject({ state: 'failed', errorCode: 'image-response-rejected', rawResponseHash: f.buffer.rawResponseHash, payload: null })
    expect(await repairSavedWorkCoverImageV1(f.input)).toEqual(asset)
    const current = (await db.workCoverDrafts.get(f.draft.id))!
    const confirmation = await prepareWorkCoverAdoptionV1({ scope: f.scope, draftId: f.draft.id, assetId: asset.id,
      expectedDraftRevision: current.revision, expectedWorkUpdatedAt: f.work.updatedAt })
    await adoptWorkCoverV1(f.scope, confirmation)
    expect((await db.workCoverAdoptions.where('workId').equals(f.scope.workId).first())!.materializationRunId).toBe(asset.materializationRunId)
    const laterCover = binaryDataUrlV1(encodeFixtureRasterV1(10, 14, 'image/png', '#905a20'), 'image/png')
    await updateWorkCover(f.scope, laterCover, (await db.works.get(f.scope.workId))!.updatedAt)
    const draftBeforeReplay = await db.workCoverDrafts.get(f.draft.id)
    await adoptWorkCoverV1(f.scope, confirmation); await repairSavedWorkCoverImageV1(f.input)
    expect((await db.works.get(f.scope.workId))!.coverImage).toBe(laterCover)
    expect(await db.workCoverDrafts.get(f.draft.id)).toEqual(draftBeforeReplay)
    let projectId = f.scope.projectId
    for (let round = 0; round < 2; round++) {
      await seedCurrentWorkspace(`round-${round}-unrelated`)
      const backup = await exportProjectJSON(projectId)
      expect(backup.version).toBe(20)
      expect(backup.workCoverAssets[0]).not.toHaveProperty('materializationRunId')
      expect(backup.workCoverAssets[0]._materializationRunExportId).toBeTypeOf('number')
      projectId = await importProjectJSON(backup)
      const work = (await db.works.where('projectId').equals(projectId).first())!, imported = (await db.workCoverAssets.where('projectId').equals(projectId).first())!
      expect(work.id).not.toBe(f.scope.workId); expect(imported.sourceRunId).not.toBe(asset.sourceRunId)
      expect(imported.materializationRunId).not.toBe(asset.materializationRunId)
      expect(imported.id).not.toBe(asset.id)
      expect(imported.candidateJson).toBe(asset.candidateJson); expect(imported.repairEvidenceJson).toBe(asset.repairEvidenceJson)
      expect(imported.blobHash).toBe(asset.blobHash)
      const scope = { projectId, workId: work.id!, worldId: work.worldId }
      const reboundSource = await readAgentRunV1(scope, imported.sourceRunId!), reboundProof = await readAgentRunV1(scope, imported.materializationRunId!)
      expect(reboundSource.run.contractHash).not.toBe(f.source.run.contractHash)
      expect(reboundProof.run.contractHash).not.toBe(proof.run.contractHash)
      expect(reboundSource.projection.state).toBe('failed'); expect(reboundProof.projection.state).toBe('running')
      expect(reboundProof.events[reboundProof.events.length - 1]).toMatchObject({ type: 'verification.staled', payload: { reason: 'project-import-scope-rebound' } })
      await expect(renderWorkCoverV1({ scope, assetId: imported.id! })).resolves.toMatchObject({ asset: { blobHash: asset.blobHash } })
      const importedDraft = (await db.workCoverDrafts.where('projectId').equals(projectId).first())!
      const historical = (await db.workCoverAdoptions.where('projectId').equals(projectId).first())!
      await adoptWorkCoverV1(scope, { draftId: importedDraft.id!, operationKey: historical.operationKey })
      expect((await db.works.get(work.id!))!.coverImage).toBe(laterCover)
      expect(await db.workCoverResponseBuffers.where('projectId').equals(projectId).count()).toBe(0)
    }
    expect(f.post).toHaveBeenCalledTimes(1)
    for (const id of [asset.sourceRunId!, asset.materializationRunId!]) await expect(deleteAgentRunV1(f.scope, id)).rejects.toThrow('来源运行')
    await deleteWork(f.scope.workId)
    expect(await db.agentRuns.get(asset.sourceRunId!)).toBeUndefined(); expect(await db.agentRuns.get(asset.materializationRunId!)).toBeUndefined()
  }, 30_000)
})

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
      spec.sourceRunRetention = { field: 'sourceRunId', additionalFields: fields }
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
