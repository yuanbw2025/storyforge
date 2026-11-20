import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, StoryForgeDB, STORYFORGE_STORES_V14 } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { installRasterDecoderForVitestV1, encodeFixtureRasterV1 } from '../helpers/raster-decoder-vitest'
import { saveWorkCoverDraftV1 } from '../../src/lib/work-cover/drafts'
import { uploadWorkCoverAssetV1 } from '../../src/lib/work-cover/assets'
import { adoptWorkCoverV1, prepareWorkCoverAdoptionV1, renderWorkCoverV1 } from '../../src/lib/work-cover/adoption'
import { adopt } from '../../src/lib/registry/adopt'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { sha256BinaryV1 } from '../../src/lib/media/blob-store'
import { collectUnreferencedMediaBlobObjects } from '../../src/lib/product-production/media-blob-store'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { updateWorkCover } from '../../src/lib/workspace/works'
import { normalizeProjectBackup } from '../../src/lib/export/backup-trust'
import { assertWorkCoverPortableRowV1 } from '../../src/lib/work-cover/contracts'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { appendAgentRunEventV1, createAgentRunV1, deleteAgentRunV1 } from '../../src/lib/agent/run/event-store'

installRasterDecoderForVitestV1()
beforeEach(async () => { await db.delete(); await db.open() })

async function uploaded(name = '封面隔离样例') {
  const { scope, work } = await seedCurrentWorkspace(name)
  const draft = await saveWorkCoverDraftV1({ scope, prompt: '海上灯塔与星空，无文字', expectedRevision: null, expectedWorkUpdatedAt: work.updatedAt })
  const bytes = encodeFixtureRasterV1(12, 18)
  const asset = await uploadWorkCoverAssetV1({ scope, draftId: draft.id, expectedDraftRevision: draft.revision, data: bytes })
  const confirmation = () => prepareWorkCoverAdoptionV1({ scope, draftId: draft.id, assetId: asset.id,
    expectedDraftRevision: draft.revision + 1, expectedWorkUpdatedAt: work.updatedAt })
  return { scope, work, draft, asset, bytes, confirmation }
}

describe('035 Work cover identity/CAS/lifecycle', () => {
  it.each([false, true])('retains a cover source Run until Work/history deletion (parent tree: %s)', async withParent => {
    const { scope, asset, draft } = await uploaded()
    const contract = {
      version: 1, objective: 'synthetic cover source retention only', workflowKind: 'read-only-audit', runtimeBindingHash: 'd'.repeat(64),
      scope: { projectId: scope.projectId, worldGroupId: null }, permissions: { contextSourceKeys: ['manualText'], writeTargets: [] },
      budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1000, maxOutputTokens: 100, maxAttemptsPerStep: 1 },
      acceptance: [{ id: 'result', kind: 'output-present', required: true }],
      verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'cover-retention-fixture', criterionIds: ['result'] }],
      failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
    }
    const parent = await createAgentRunV1({ scope, contract })
    let source = parent
    if (withParent) {
      const stepId = 'cover-retention-fixture'
      await appendAgentRunEventV1({ scope, runId: parent.run.id, type: 'step.scheduled', payload: { stepId } })
      await appendAgentRunEventV1({ scope, runId: parent.run.id, type: 'step.started', payload: { stepId, attempt: 1 } })
      await appendAgentRunEventV1({ scope, runId: parent.run.id, type: 'step.succeeded', payload: { stepId, attempt: 1, outputHash: 'e'.repeat(64) } })
      await appendAgentRunEventV1({ scope, runId: parent.run.id, type: 'verification.started', payload: { verifierSetVersion: 'cover-retention-fixture' } })
      const completed = await appendAgentRunEventV1({ scope, runId: parent.run.id, type: 'verification.accepted', payload: { receiptHash: 'f'.repeat(64) } })
      source = await createAgentRunV1({ scope, contract: { ...contract, lineage: { parent: {
        runId: parent.run.id, receiptHash: completed.projection.terminalReceiptHash!, relation: 'cover-retention-fixture',
      } } } })
    }
    const candidate = {
      schema: 'storyforge.work-cover.image-candidate@1', workCode: asset.workCode,
      dispatchKey: crypto.randomUUID(), attempt: 1, ordinal: 0, briefHash: draft.briefHash,
      routeHash: 'a'.repeat(64), assetKey: asset.assetKey, blobHash: asset.blobHash,
      responseHash: 'b'.repeat(64), providerReceiptHash: 'c'.repeat(64), rights: 'provider-terms-unverified',
    }
    await db.workCoverAssets.update(asset.id, { role: 'generated-original', sourceRunId: source.run.id,
      rights: 'provider-terms-unverified', candidateJson: JSON.stringify({ ...candidate, candidateHash: await hashCanonicalValue(candidate) }) })
    const eventsBefore = await db.agentRunEvents.where('runId').equals(source.run.id).count()
    const parentEventsBefore = await db.agentRunEvents.where('runId').equals(parent.run.id).count()
    await expect(deleteAgentRunV1(scope, source.run.id)).rejects.toThrow(/来源运行/)
    await expect(deleteAgentRunV1(scope, parent.run.id)).rejects.toThrow(/来源运行/)
    expect(await db.agentRuns.get(parent.run.id)).toBeDefined()
    expect(await db.agentRuns.get(source.run.id)).toBeDefined()
    expect(await db.agentRunEvents.where('runId').equals(source.run.id).count()).toBe(eventsBefore)
    expect(await db.agentRunEvents.where('runId').equals(parent.run.id).count()).toBe(parentEventsBefore)
    await expect(renderWorkCoverV1({ scope, assetId: asset.id })).resolves.toMatchObject({ asset: { sourceRunId: source.run.id } })
    await expect(exportProjectJSON(scope.projectId)).resolves.toMatchObject({ version: 20 })
    const unreferenced = await createAgentRunV1({ scope, contract })
    expect(await deleteAgentRunV1(scope, unreferenced.run.id)).toBe(true)
    await deleteWork(scope.workId)
    expect(await db.agentRuns.get(source.run.id)).toBeUndefined()
    expect(await db.agentRuns.get(parent.run.id)).toBeUndefined()
    expect(await db.workCoverAssets.where('workId').equals(scope.workId).count()).toBe(0)
  }, 20_000)

  it('rejects generated image evidence without a source Run and upload rows carrying model candidates', async () => {
    const { asset, draft } = await uploaded()
    const preimage = {
      schema: 'storyforge.work-cover.image-candidate@1', workCode: asset.workCode,
      dispatchKey: crypto.randomUUID(), attempt: 1, ordinal: 0,
      briefHash: draft.briefHash, routeHash: 'a'.repeat(64), assetKey: asset.assetKey,
      blobHash: asset.blobHash, responseHash: 'b'.repeat(64), providerReceiptHash: 'c'.repeat(64),
      rights: 'provider-terms-unverified',
    }
    const candidateJson = JSON.stringify({ ...preimage, candidateHash: await hashCanonicalValue(preimage) })
    const generated = { ...asset, role: 'generated-original', rights: 'provider-terms-unverified', candidateJson }
    expect(() => assertWorkCoverPortableRowV1('asset', generated)).toThrow()
    expect(() => assertWorkCoverPortableRowV1('asset', { ...asset, candidateJson })).toThrow()
    expect(() => assertWorkCoverPortableRowV1('asset', { ...asset, role: 'rendered-cover' })).toThrow()
    const portable = { ...generated, _sourceRunExportId: 0 }
    expect(() => assertWorkCoverPortableRowV1('asset', portable)).not.toThrow()
  })

  it('v14→v15 adds only empty cover stores and preserves existing author bytes', async () => {
    const name = `cover-upgrade-${crypto.randomUUID()}`
    const old = new Dexie(name); old.version(14).stores(STORYFORGE_STORES_V14)
    await old.open(); const id = await old.table('works').add({ title: '作者原稿', coverImage: 'original-bytes' }); old.close()
    const current = new StoryForgeDB(name)
    try {
      await current.open()
      expect(await current.works.get(id as number)).toMatchObject({ title: '作者原稿', coverImage: 'original-bytes' })
      expect(await current.workCoverAssets.count()).toBe(0)
      expect(await current.workCoverDrafts.count()).toBe(0)
      expect(await current.workCoverAdoptions.count()).toBe(0)
      expect(await current.workCoverResponseBuffers.count()).toBe(0)
    } finally { current.close(); await current.delete() }
  })

  it('keeps upload/candidate separate until explicit adopt; same bytes in preview/Work/receipt, no fake model Run', async () => {
    const fixture = await uploaded(), { scope, work, asset, bytes } = fixture
    expect((await db.works.get(work.id!))!.coverImage ?? '').toBe('')
    expect(await db.agentRuns.count()).toBe(0)
    const preview = await renderWorkCoverV1({ scope, assetId: asset.id })
    const confirmation = await fixture.confirmation()
    await adoptWorkCoverV1(scope, confirmation)
    expect((await db.works.get(work.id!))!.coverImage).toBe(preview.dataUrl)
    const receipt = (await db.workCoverAdoptions.toArray())[0]!
    expect(receipt.originalAssetId).toBe(receipt.finalAssetId)
    expect(receipt.newCoverHash).toBe(await sha256BinaryV1(bytes))
    expect(receipt.layoutHash).toBeNull()
    expect(JSON.parse(receipt.renderManifestJson).rendererId).toBe('identity-v1')
  })

  it('recovers committed adoption before revision stale; a later manual change is never overwritten', async () => {
    const fixture = await uploaded(), confirmation = await fixture.confirmation()
    await adoptWorkCoverV1(fixture.scope, confirmation)
    const first = (await db.works.get(fixture.scope.workId))!
    await adoptWorkCoverV1(fixture.scope, confirmation)
    expect(await db.workCoverAdoptions.count()).toBe(1)
    expect((await db.works.get(first.id!))!.updatedAt).toBe(first.updatedAt)
    await updateWorkCover(fixture.scope, '', first.updatedAt)
    await adoptWorkCoverV1(fixture.scope, confirmation)
    expect((await db.works.get(first.id!))!.coverImage).toBe('')
    expect(await db.workCoverAdoptions.count()).toBe(1)
  })

  it('finds an old receipt after a new prompt, and rejects reusing its key for changed content', async () => {
    const fixture = await uploaded(), confirmation = await fixture.confirmation()
    await adoptWorkCoverV1(fixture.scope, confirmation)
    const current = (await db.workCoverDrafts.get(fixture.draft.id))!
    const intent = JSON.parse(current.pendingAdoptionJson!)
    await db.workCoverDrafts.update(fixture.draft.id, { pendingAdoptionJson: JSON.stringify({ ...intent, candidateHash: '0'.repeat(64) }) })
    await expect(adoptWorkCoverV1(fixture.scope, confirmation)).rejects.toThrow('不同内容')
    await db.workCoverDrafts.update(fixture.draft.id, { pendingAdoptionJson: current.pendingAdoptionJson })
    const work = (await db.works.get(fixture.scope.workId))!
    await saveWorkCoverDraftV1({ scope: fixture.scope, prompt: '新的封面提示', expectedRevision: current.revision, expectedWorkUpdatedAt: work.updatedAt })
    await adoptWorkCoverV1(fixture.scope, confirmation)
    expect((await db.workCoverDrafts.get(fixture.draft.id))!.briefJson).toContain('新的封面提示')
    expect(await db.workCoverAdoptions.count()).toBe(1)
  })

  it('refuses damaged stored bytes without changing the old cover or losing the candidate row', async () => {
    const fixture = await uploaded()
    const blob = (await db.mediaBlobObjects.get(fixture.asset.blobObjectId))!
    const damaged = blob.data!.slice(0); new Uint8Array(damaged)[0] ^= 1
    await db.mediaBlobObjects.update(blob.id!, { data: damaged })
    await expect(fixture.confirmation()).rejects.toThrow(/hash/)
    expect((await db.works.get(fixture.work.id!))!.coverImage ?? '').toBe('')
    expect(await db.workCoverAssets.get(fixture.asset.id)).toBeDefined()
    expect(await db.workCoverAdoptions.count()).toBe(0)
  })

  it('retains a shared-store-valid image above the old cover pixel limit without adopting or resampling', async () => {
    const fixture = await uploaded()
    const draft = (await db.workCoverDrafts.get(fixture.draft.id))!
    const large = encodeFixtureRasterV1(5_000, 4_001)
    const asset = await uploadWorkCoverAssetV1({ scope: fixture.scope, draftId: draft.id!, expectedDraftRevision: draft.revision, data: large })
    await expect(renderWorkCoverV1({ scope: fixture.scope, assetId: asset.id })).rejects.toThrow('2000 万像素')
    expect((await db.mediaBlobObjects.get(asset.blobObjectId))!.data).toEqual(large)
    expect((await db.works.get(fixture.work.id!))!.coverImage ?? '').toBe('')
    expect(await db.workCoverAdoptions.count()).toBe(0)
  }, 20_000)

  it('rejects generic cover writes, wrong scope and stale adoption with no partial receipt or cover', async () => {
    const fixture = await uploaded(), other = await uploaded('另一部作品')
    await expect(adopt({ projectId: fixture.scope.projectId, scope: fixture.scope, target: 'works', recordId: fixture.work.id,
      mode: 'replace', data: { coverImage: 'forged' } })).rejects.toThrow('work-cover-v1')
    const confirmation = await fixture.confirmation()
    await expect(adoptWorkCoverV1(other.scope, confirmation)).rejects.toThrow()
    await db.works.update(fixture.work.id!, { updatedAt: fixture.work.updatedAt + 10 })
    await expect(adoptWorkCoverV1(fixture.scope, confirmation)).rejects.toThrow('作品已修改')
    expect(await db.workCoverAdoptions.count()).toBe(0)
    expect((await db.works.get(fixture.work.id!))!.coverImage ?? '').toBe('')
  })

  it('rolls back Work/Draft changes on receipt/quota failure', async () => {
    const fixture = await uploaded(), confirmation = await fixture.confirmation()
    const before = await db.workCoverDrafts.get(fixture.draft.id)
    const spy = vi.spyOn(db.workCoverAdoptions, 'add').mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'))
    try { await expect(adoptWorkCoverV1(fixture.scope, confirmation)).rejects.toThrow('quota') } finally { spy.mockRestore() }
    expect((await db.works.get(fixture.work.id!))!.coverImage ?? '').toBe('')
    expect(await db.workCoverDrafts.get(fixture.draft.id)).toEqual(before)
    expect(await db.workCoverAssets.count()).toBe(1)
  })

  it('pins candidates against shared GC; same content in another Work is isolated', async () => {
    const first = await uploaded(), second = await uploaded('同图其他作品')
    expect(first.asset.blobHash).toBe(second.asset.blobHash)
    expect(first.asset.blobObjectId).not.toBe(second.asset.blobObjectId)
    await collectUnreferencedMediaBlobObjects({ scope: first.scope })
    expect(await db.mediaBlobObjects.get(first.asset.blobObjectId)).toBeDefined()
    await deleteWork(first.scope.workId)
    expect(await db.workCoverAssets.where('workId').equals(first.scope.workId).count()).toBe(0)
    expect(await db.mediaBlobObjects.get(second.asset.blobObjectId)).toBeDefined()
  })

  it('backs up/restores identity assets and equal original/final IDs with remapped scope; never restores local dispatch rights', async () => {
    const fixture = await uploaded(), confirmation = await fixture.confirmation()
    await adoptWorkCoverV1(fixture.scope, confirmation)
    const backup = await exportProjectJSON(fixture.scope.projectId)
    expect('workCoverResponseBuffers' in backup).toBe(false)
    const projectId = await importProjectJSON(backup)
    const restored = (await db.works.where('projectId').equals(projectId).toArray())[0]!
    expect(restored.coverImage).toBe((await db.works.get(fixture.work.id!))!.coverImage)
    const receipt = (await db.workCoverAdoptions.where('projectId').equals(projectId).toArray())[0]!
    expect(receipt.originalAssetId).toBe(receipt.finalAssetId)
    expect(receipt.originalAssetId).not.toBe(fixture.asset.id)
    expect((await db.workCoverDrafts.where('projectId').equals(projectId).first())!.pendingAdoptionJson).toBeNull()
    expect(await db.workCoverResponseBuffers.where('projectId').equals(projectId).count()).toBe(0)
    await expect(exportProjectJSON(projectId)).resolves.toMatchObject({ version: 20 })
  }, 20_000)

  it('rejects corrupt hash and cross-Work portable asset references before allocating a project', async () => {
    const fixture = await uploaded(), confirmation = await fixture.confirmation()
    await adoptWorkCoverV1(fixture.scope, confirmation)
    const backup = await exportProjectJSON(fixture.scope.projectId)
    const corrupted = structuredClone(backup) as unknown as Record<string, Array<Record<string, unknown>>>
    corrupted.workCoverAssets[0].blobHash = '0'.repeat(64)
    const count = await db.projects.count()
    await expect(importProjectJSON(corrupted)).rejects.toThrow('封面')
    expect(await db.projects.count()).toBe(count)
  })

  it('converts a genuine v18 backup by adding empty cover tables', async () => {
    const { scope } = await seedCurrentWorkspace('旧版备份')
    const legacy = await exportProjectJSON(scope.projectId) as unknown as Record<string, unknown>
    legacy.version = 18
    delete legacy.workCoverDrafts; delete legacy.workCoverAssets; delete legacy.workCoverAdoptions
    const converted = normalizeProjectBackup(legacy)
    expect(converted).toMatchObject({ version: 20, workCoverDrafts: [], workCoverAssets: [], workCoverAdoptions: [] })
  })
})
