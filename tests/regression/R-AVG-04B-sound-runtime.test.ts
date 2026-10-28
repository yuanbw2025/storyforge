import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/sound-production-brief'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import { avgSoundRuntimeStageFixtureV1, finishAvgSoundRuntimeFixtureV1 } from '../helpers/avg-sound-runtime-fixture'
import { acceptedAvgSoundArtifactV1 } from '../helpers/avg-sound-harness-fixture'
import { verifyStoredProductBuildPreview } from '../../src/lib/product-production/preview-manifest'
import { verifyFrozenAvgAuthorInputsV1, stageAvgAuthorArtifactV1 } from '../../src/lib/avg/author-artifacts'
import { readAvgPrototypeMediaRightsV1 } from '../../src/lib/avg/assembly-media-rights'
import { verifyProductBuildTerminalArtifactSetV1 } from '../../src/lib/product-production/artifact-store'
import { startProductProductionPreviewV1, readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { createBuildProductMediaResolver } from '../../src/lib/product-production/media-resolver'
import { runProductProductionSchedulerCycleV1, recoverImportedProductProductionProofsV1 } from '../../src/lib/product-production/scheduler'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { hashAvgSoundBytesV1 } from '../../src/lib/avg/sound-provider-contract'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1', apiKey: 'intercepted-engineering-key-no-external-account',
    model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.spyOn(readiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
  vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({ measuredAt: Date.now(), environment: input.environment,
    assets: input.assets.map(a => ({ assetKey: a.assetKey, contentHash: a.contentHash, mimeType: a.mimeType, mediaClass: 'audio', status: 'decoded',
      decodedWidth: null, decodedHeight: null, decodedDurationMs: a.mimeType === 'audio/wav' ? 12000 : 500, decodedHasAlpha: null,
      decodedChannelCount: a.mimeType === 'audio/wav' ? 2 : 1, decodedSampleRateHz: 48000, integratedLufs: -18, truePeakDbtp: -12,
      loopSeamDbfs: -40, policyFailures: [], failureCode: null })) }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

describe('AVG original sound Brief to actual sealed runtime with controlled HTTP and decoder', () => {
  it('integrates exact adopted sounds without rewriting the Brief or copying bytes and seals Preview with original sound rights and author/Run evidence', async () => {
    const s = await avgSoundRuntimeStageFixtureV1(), original = (await db.productBuilds.get(s.buildId))!
    const blobs = await db.mediaBlobObjects.count(), drafts = await db.avgDraftMedia.count()
    useAIConfigStore.getState().setConfig({ provider: 'deepseek', apiKey: '', baseUrl: 'https://unused.fixture.invalid/v1' })
    const details = await finishAvgSoundRuntimeFixtureV1(s), build = details.build!
    vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    expect(build).toMatchObject({ status: 'preview-ready', briefHash: original.briefHash, briefRevision: original.briefRevision })
    expect(build.rootTerminalReceiptHash).toMatch(/^[a-f0-9]{64}$/); expect(build.previewHash).toMatch(/^[a-f0-9]{64}$/)
    expect(details.executionBrief!.avgSoundPlanning).toEqual(s.brief.avgSoundPlanning); expect(details.executionBrief!.avgAssembly).toBeUndefined()
    const preview = (await verifyStoredProductBuildPreview(build))!
    expect(preview).toMatchObject({ version: 2, runtimePackage: { productType: 'avg' } }); expect(preview.mediaBindings).toHaveLength(2)
    expect(preview.mediaBindings.map(b => b.artifactKey)).toEqual(['avg.media.0', 'avg.media.1'])
    for (const [i, key] of ['desk.bgm', 'desk.sfx'].entries()) {
      const raw = (await acceptedAvgSoundArtifactV1(s, `avg.sound.raw.${key}`))!, final = (await acceptedAvgSoundArtifactV1(s, `avg.media.${i}`))!
      expect(final.blobObjectId).toBe(raw.blobObjectId); expect(final.contentHash).toBe(raw.contentHash)
      const rights = JSON.parse(final.rightsJson)
      expect(rights.origin).toBe(i === 0 ? 'author-selected-local-music' : 'author-selected-original-library')
      expect(rights.originalRights).toEqual(JSON.parse(raw.rightsJson)); expect(rights.rawSoundProducerReceiptHash).toBe(raw.producerReceiptHash)
      expect(rights.rawSound.contentHash).toBe(raw.contentHash); expect(rights.audioReviewReceipt).toMatch(/^[a-f0-9]{64}$/)
    }
    const source = await verifyFrozenAvgAuthorInputsV1({ scope: s.scope, buildId: s.buildId,
      expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch })
    expect(source.soundChoices).toHaveLength(2); expect(source.soundPlan!.artifact.artifactKey).toBe('avg.media.sound-plan')
    const rights = await readAvgPrototypeMediaRightsV1({ scope: s.scope, buildId: s.buildId,
      expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch })
    expect(rights.size).toBe(2)
    const terminal = await verifyProductBuildTerminalArtifactSetV1({ scope: s.scope, productionId: s.productionId, buildId: s.buildId,
      expectedControlEpoch: build.controlEpoch, expectedPlanHash: build.planHash })
    expect(terminal.artifacts.length).toBe(s.plan.tasks.flatMap(t => t.outputArtifactKeys).length)
    const session = await startProductProductionPreviewV1({ scope: s.scope, productionId: s.productionId,
      expectedBuildId: s.buildId, expectedPreviewHash: build.previewHash })
    expect(session.productType).toBe('avg'); expect(session.sessionId).toBeGreaterThan(0)
    const resolver = await createBuildProductMediaResolver({ scope: s.scope, productBuildId: s.buildId, preview })
    try {
      for (const key of ['desk.bgm', 'desk.sfx']) {
        const raw = (await acceptedAvgSoundArtifactV1(s, `avg.sound.raw.${key}`))!
        const blob = await resolver.read(`sound.${key}`)
        expect(await hashAvgSoundBytesV1(await blob.arrayBuffer())).toBe(raw.contentHash)
      }
    } finally { await resolver.dispose() }
    expect(await db.mediaBlobObjects.count()).toBe(blobs); expect(await db.avgDraftMedia.count()).toBe(drafts)
    expect(s.calls).toHaveLength(1); expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  }, 90_000)
  it.each(['context', 'artifact', 'claim', 'media'] as const)('rejects substituted %s input despite an actual child claim and preserves the known original requests', async mode => {
    const s = await avgSoundRuntimeStageFixtureV1(), execute = s.executor
    s.executor = async input => {
      if (mode === 'media' ? input.task.kind === 'avg-assembly-verify' : input.task.kind === 'avg-assembly-integrate') {
        input = { ...input }
        if (mode === 'context') input.contextText += '\nCaller substituted context'
        if (mode === 'artifact') input.inputArtifacts = input.inputArtifacts.map((r, i) => i === 0 ? { ...r, payloadJson: '{}' } : r)
        if (mode === 'claim') input.capabilityBindings = [{ requirementKey: 'avg.media.music', adapterId: 'substituted', bindingHash: 'f'.repeat(64), provider: 'substituted', model: 'substituted' }]
        if (mode === 'media') input.inputArtifacts = input.inputArtifacts.map(r => r.kind === 'audio' ? { ...r, rightsJson: '{}' } : r)
      }
      return execute(input)
    }
    await expect(finishAvgSoundRuntimeFixtureV1(s)).rejects.toThrow()
    const build = (await db.productBuilds.get(s.buildId))!
    expect(build.previewHash).toBe(''); expect(build.status).toBe('recovery-required')
    expect(await acceptedAvgSoundArtifactV1(s, 'quality.report')).toBeUndefined()
    expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  }, 90_000)
  it.each(['response', 'review', 'rights', 'bytes', 'snapshot', 'world-request'] as const)('refuses sealed source whose original %s is missing or changed, without regeneration', async changed => {
    const s = await avgSoundRuntimeStageFixtureV1(), details = await finishAvgSoundRuntimeFixtureV1(s), build = details.build!
    const raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!, payload = JSON.parse(raw.payloadJson)
    if (changed === 'response' || changed === 'snapshot') {
      const kind = changed === 'response' ? 'raw-response' : 'source-snapshot', hash = changed === 'response' ? payload.responseEvidenceHash : payload.requestSnapshotHash
      const row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([s.scope.projectId, kind, hash]).first()
      await db.agentRunArtifacts.delete(row!.id!)
    } else if (changed === 'review') {
      const row = (await acceptedAvgSoundArtifactV1(s, 'avg.review.audio.desk.bgm'))!
      const body = JSON.parse(row.payloadJson); body.soundEvidence.note = 'substituted after seal'
      await db.productBuildArtifacts.update(row.id!, { payloadJson: JSON.stringify(body) })
    } else if (changed === 'rights') await db.productBuildArtifacts.update(raw.id!, { rightsJson: '{"commercialUse":true}' })
    else if (changed === 'bytes') {
      const blob = (await db.mediaBlobObjects.get(raw.blobObjectId!))!, data = new Uint8Array(blob.data!.slice(0)); data[data.length - 1] ^= 1
      await db.mediaBlobObjects.update(blob.id!, { data: data.buffer })
    } else {
      const ledger = JSON.parse(build.budgetLedgerJson), run = ledger.tasks['avg.assembly.integrate'].runId
      const events = await db.agentRunEvents.where('runId').equals(run).toArray(), event = events.find(e => e.type === 'evidence.artifact.recorded' && JSON.parse(e.payloadJson).artifactKind === 'rendered-request')!
      const hash = JSON.parse(event.payloadJson).contentHash, row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([s.scope.projectId, 'rendered-request', hash]).first()
      await db.agentRunArtifacts.delete(row!.id!)
    }
    // A false negative must report a small scalar, not try serializing the
    // multi-megabyte physical Blob read set through Vitest's fork IPC.
    let refused = false
    try { await verifyProductBuildTerminalArtifactSetV1({ scope: s.scope, productionId: s.productionId, buildId: s.buildId,
      expectedControlEpoch: build.controlEpoch, expectedPlanHash: build.planHash }) } catch { refused = true }
    expect(refused, `terminal must reject changed ${changed}`).toBe(true)
    if (changed === 'bytes' || changed === 'world-request') await expect(runProductProductionSchedulerCycleV1(s)).rejects.toThrow()
    expect((await db.productBuilds.get(s.buildId))!.previewHash).toBe(build.previewHash)
    expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  }, 90_000)
  it('rebinds only completed portable proofs with original bytes and no new adoption, inference or input loss', async () => {
    const s = await avgSoundRuntimeStageFixtureV1(), details = await finishAvgSoundRuntimeFixtureV1(s), original = details.build!
    const backup = await exportProjectJSON(s.scope.projectId), copyId = await importProjectJSON(backup)
    let copy = (await db.productBuilds.where('projectId').equals(copyId).first())!
    const scope = { projectId: copyId, workId: copy.workId!, worldId: copy.worldId! }, source = { scope, productionId: copy.productionId }
    vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    await recoverImportedProductProductionProofsV1(source)
    copy = (await db.productBuilds.get(copy.id!))!
    expect(copy.previewManifestJson).toBe(original.previewManifestJson); expect(copy.packageHash).toBe(original.packageHash)
    const restoredBackup = await exportProjectJSON(copyId)
    const task = s.plan.tasks.find(t => t.outputArtifactKeys.includes('avg.system.plan'))!
    await expect(stageAvgAuthorArtifactV1({ scope, buildId: copy.id!, expectedBuildRevision: copy.stateRevision,
      controlEpoch: copy.controlEpoch, taskKey: task.taskKey, artifactKey: 'avg.system.plan', kind: 'product-module',
      payload: s.author.workspace.systemPlan, declaration: 'A restored seal grants no new adoption' })).rejects.toThrow()
    expect({ ...await exportProjectJSON(copyId), exportedAt: 0 }).toEqual({ ...restoredBackup, exportedAt: 0 })
    const preview = (await verifyStoredProductBuildPreview(copy))!, resolver = await createBuildProductMediaResolver({ scope, productBuildId: copy.id!, preview })
    try {
      const blob = await resolver.read('sound.desk.bgm'), raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!
      expect(await hashAvgSoundBytesV1(await blob.arrayBuffer())).toBe(raw.contentHash)
    } finally { await resolver.dispose() }
    await deleteWork(scope.workId)
    expect({ ...await exportProjectJSON(s.scope.projectId), exportedAt: 0 }).toEqual({ ...backup, exportedAt: 0 })
    db.close(); await db.open()
    await expect(runProductProductionSchedulerCycleV1({ ...s, suppliedPlan: { ...s.plan, controlEpoch: s.plan.controlEpoch + 1 } })).rejects.toThrow()
    await runProductProductionSchedulerCycleV1(s)
    expect((await db.productBuilds.get(s.buildId))!.status).toBe('preview-ready')
    expect((await db.productBuilds.get(s.buildId))!.previewManifestJson).toBe(original.previewManifestJson)
    expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  }, 90_000)
  it('reads the immutable original sound Preview after a new Brief is explicitly saved and authorized, without inheriting old adoption', async () => {
    const s = await avgSoundRuntimeStageFixtureV1(), details = await finishAvgSoundRuntimeFixtureV1(s), original = details.build!
    const saved = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command: {
      type: 'save-brief-revision', commandId: `sound.next.save.${crypto.randomUUID()}`, expectedStateRevision: details.production.stateRevision,
      parentRevision: details.brief!.revision, brief: s.brief } })
    expect(saved.ok).toBe(true)
    const prepared = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    const started = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command: {
      type: 'authorize-start', commandId: `sound.next.start.${crypto.randomUUID()}`, expectedStateRevision: prepared.production.stateRevision,
      briefRevision: prepared.brief!.revision, briefHash: prepared.brief!.briefHash, authorizationNonce: 'explicit-next-sound-build-engineering-only' } })
    expect(started.ok).toBe(true)
    const next = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    expect(next.build!.id).not.toBe(s.buildId)
    expect(await db.productBuilds.get(s.buildId)).toEqual(original)
    expect((await db.productProductionBriefs.where('[productionId+revision]').equals([s.productionId, original.briefRevision]).first())!.status).toBe('superseded')
    vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    const terminal = await verifyProductBuildTerminalArtifactSetV1({ scope: s.scope, productionId: s.productionId, buildId: s.buildId,
      expectedControlEpoch: original.controlEpoch, expectedPlanHash: original.planHash })
    expect(terminal.artifacts.length).toBe(s.plan.tasks.flatMap(t => t.outputArtifactKeys).length)
    expect(await db.productBuildArtifacts.where('buildId').equals(next.build!.id!).count()).toBe(0)
    expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  }, 90_000)
})
