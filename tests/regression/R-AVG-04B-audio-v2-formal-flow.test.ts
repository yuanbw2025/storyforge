import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as soundReadiness from '../../src/lib/avg/sound-production-brief'
import * as audioReadiness from '../../src/lib/avg/audio-production-brief'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import { avgSoundPlanningFixtureV1 } from '../helpers/avg-sound-planning-fixture'
import { avgSoundWireFixtureV1, avgSoundLibraryFixtureV1 } from '../helpers/avg-sound-provider-fixture'
import { avgSoundHarnessFixtureV1, adoptAvgSoundSourcesV1, adoptAvgSoundArtifactV1, cycleAvgSoundUntilV1,
  acceptedAvgSoundArtifactV1, confirmAvgSoundCandidateV1 } from '../helpers/avg-sound-harness-fixture'
import { avgSoundAuthorReviewFixtureV3 } from '../helpers/avg-sound-review-fixture'
import { finishAvgSoundRuntimeFixtureV1 } from '../helpers/avg-sound-runtime-fixture'
import { avgSoundProductionBudgetV1, avgSoundProductionGateIdsV1 } from '../../src/lib/avg/sound-production-policy'
import { readAvgSoundCandidateV1, stageAvgSoundReviewV1, stageAvgSoundChoiceV1 } from '../../src/lib/avg/sound-workbench-service'
import { configureAvgChosenSoundDraftV1, stageAvgWorkspaceInputV1 } from '../../src/lib/avg/assembly-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { parseAvgAuthorSoundChoiceV1 } from '../../src/lib/avg/sound-choice-contract'
import { parseAvgProcessedAudioPayload, parseAvgProcessedAudioPayloadV1 } from '../../src/lib/avg/processed-audio-contract'
import { inspectAvgAudioProcessingWaveBytesV1 } from '../../src/lib/avg/audio-processing'
import { executeAvgAudioGainWorkerRequestV1, type AvgAudioGainWorkerRequestV1 } from '../../src/lib/avg/audio-gain-worker-protocol'
import { executeAvgAudioDspWorkerRequestV2, type AvgAudioDspWorkerRequestV2 } from '../../src/lib/avg/audio-dsp-worker-protocol-v2'
import { hashAvgTaskRuntimeBindingV1 } from '../../src/lib/avg/task-claim'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readMediaBlobObjectData, sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { verifyAcceptedProductBuildArtifactV1 } from '../../src/lib/product-production/artifact-store'
import { verifyFrozenAvgAuthorInputsV1 } from '../../src/lib/avg/author-artifacts'
import { verifyStoredProductBuildPreview } from '../../src/lib/product-production/preview-manifest'
import { createBuildProductMediaResolver } from '../../src/lib/product-production/media-resolver'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { recoverImportedProductProductionProofsV1 } from '../../src/lib/product-production/service'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'

// Controlled HTTP, DOM decoder and Worker transport only. Both V2 compute and
// independent verification execute the actual complete numeric protocol; no
// result, Run, producer receipt or author adoption is seeded. Playback/hearing
// declarations are ENGINEERING fixtures, never native or human listening proof.
const workerJobs: Array<{ schema: string; mode: string; ok: boolean }> = []
class WorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage(value: AvgAudioGainWorkerRequestV1 | AvgAudioDspWorkerRequestV2, transfer: Transferable[]) {
    const request = structuredClone(value, { transfer })
    queueMicrotask(() => {
      const reply = request.schema === 'storyforge.avg.audio-dsp-worker-request'
        ? executeAvgAudioDspWorkerRequestV2(request) : executeAvgAudioGainWorkerRequestV1(request)
      workerJobs.push({ schema: request.schema, mode: request.schema === 'storyforge.avg.audio-dsp-worker-request' ? request.mode : 'gain-v1', ok: reply.ok })
      this.onmessage?.({ data: reply } as MessageEvent<unknown>)
    })
  }
}
const config = { provider: 'agnes' as const, baseUrl: 'https://sound-proposal.fixture.invalid/v1',
  apiKey: 'controlled-engineering-key-no-external-account', model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 }
const declaration = 'ENGINEERING explicitly adopts this exact preview candidate; native hearing, artistic and commercial quality are not claimed.'
const ref = (r: { artifactKey: string; version: number; contentHash: string }) => ({ artifactKey: r.artifactKey, version: r.version, contentHash: r.contentHash })

beforeEach(async () => {
  await db.delete(); await db.open(); workerJobs.length = 0
  useAIConfigStore.getState().setConfig(config)
  vi.spyOn(soundReadiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
  vi.spyOn(audioReadiness, 'avgAudioProcessingExecutionReadyV1').mockReturnValue(true)
  vi.stubGlobal('Worker', WorkerPort)
  // A device may decode/resample at 48 kHz. Frozen source/output PCM rates and
  // frames are separately read from actual WAV bytes below, never this stub.
  vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({ measuredAt: Date.now(), environment: input.environment,
    assets: input.assets.map(a => ({ assetKey: a.assetKey, contentHash: a.contentHash, mimeType: a.mimeType, mediaClass: 'audio', status: 'decoded',
      decodedWidth: null, decodedHeight: null, decodedDurationMs: a.mimeType === 'audio/wav' ? 12000 : 500, decodedHasAlpha: null,
      decodedChannelCount: a.mimeType === 'audio/wav' ? 2 : 1, decodedSampleRateHz: 48000, integratedLufs: -18, truePeakDbtp: -12,
      loopSeamDbfs: -40, policyFailures: [], failureCode: null })) }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

describe('AVG V2 local dynamics/resampling through actual sound commands and portable proof', () => {
  it('seals a distinct 24k limited BGM, independently adopts it beside original OGG, and restores frozen bytes with factories closed', async () => {
    const semantic = await avgSoundPlanningFixtureV1()
    const wire = await avgSoundWireFixtureV1(semantic.compiled.requirements.find(r => r.dispatch.operation === 'generate-music')!)
    const s = await avgSoundHarnessFixtureV1({ audioFetcher: wire.fetcher,
      additionalBindings: [{ requirementKey: 'avg.media.music', adapterId: 'storyforge.avg.local-music.v1', bindingHash: wire.route.bindingHash,
        provider: 'storyforge-local-music', model: wire.capability.model }], configureSource: async source => {
        const sound = source.brief.avgSoundPlanning!
        sound.scope.librarySources = [avgSoundLibraryFixtureV1().source]
        sound.scope.templates.find(t => t.requirementKey === 'desk.bgm')!.cue.loop = true
        Object.assign(sound.musicBinding!, wire.route)
        source.brief.capabilityRequirements.find(c => c.requirementKey === 'avg.media.music')!.capabilityHash = wire.route.bindingHash
        source.brief.avgAudioProcessing = audioReadiness.avgAudioProcessingForSoundV1({ schema: 'storyforge.avg.audio-production-processing-plan', version: 2,
          entries: [{ domain: 'sound', requirementKey: 'desk.bgm', recipe: { schema: 'storyforge.avg.audio-processing-recipe', version: 2,
            gainMilliDb: 12000, maximumDurationMs: 12000, sampleRatePolicy: 'explicit', targetSampleRateHz: 24000,
            channelPolicy: 'preserve', timelinePolicy: 'preserve', overflowPolicy: 'reject', resampler: 'blackman-sinc64.v1',
            processingOrder: 'resample-gain-linked-limit.v1', dynamics: { processor: 'linked-lookahead-peak-limit.v1',
              ceilingMilliDbfs: -1500, lookaheadMs: 3, releaseMs: 80 },
            declaration: 'ENGINEERING explicit original-relative gain, 24k resampling and linked peak limit; retain raw and independently review.' } }] }, sound)
        source.brief.productionBudget = avgSoundProductionBudgetV1(source.brief)
        source.brief.completionContract.requiredGateIds = avgSoundProductionGateIdsV1(source.brief)
      } })
    expect(s.brief.avgAudioProcessing!.version).toBe(2)
    expect(s.brief.avgAudioProcessing!.entries).toHaveLength(1)
    await adoptAvgSoundSourcesV1(s); await cycleAvgSoundUntilV1(s, 'avg.proposal.sound-plan')
    await adoptAvgSoundArtifactV1(s, 'avg.media.sound-plan', s.author.plan)
    await cycleAvgSoundUntilV1(s, 'avg.media.compiled-sound-requirements')
    await cycleAvgSoundUntilV1(s, 'avg.sound.processed.desk.bgm'); await cycleAvgSoundUntilV1(s, 'avg.sound.raw.desk.sfx')
    const raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!
    const processed = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.processed.desk.bgm'))!
    const originalRaw = canonicalProductProductionJsonV2(raw), originalRights = raw.rightsJson
    const musicPosts = () => wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(musicPosts()).toHaveLength(1)
    const originalRequest = String(musicPosts()[0][1]!.body)
    const payload = await parseAvgProcessedAudioPayload(processed.payloadJson)
    expect(payload.version).toBe(2)
    if (payload.version !== 2) throw new Error('Expected an explicit V2 producer payload')
    expect(payload.recipe).toEqual(s.brief.avgAudioProcessing!.entries[0].recipe)
    expect(payload.receipt.version).toBe(2); expect(payload.receipt.processor).toBe('storyforge.avg.pcm16-dynamics-resample.v2')
    await expect(parseAvgProcessedAudioPayloadV1(payload)).rejects.toThrow()
    const source = await readMediaBlobObjectData({ scope: s.scope, blobObjectId: raw.blobObjectId! })
    const output = await readMediaBlobObjectData({ scope: s.scope, blobObjectId: processed.blobObjectId! })
    expect(await sha256MediaData(source)).toBe(await sha256MediaData(wire.body))
    expect(processed.contentHash).not.toBe(raw.contentHash)
    const before = await inspectAvgAudioProcessingWaveBytesV1(source, 'bgm', 12000)
    const after = await inspectAvgAudioProcessingWaveBytesV1(output, 'bgm', 12000)
    expect(before).toEqual(payload.receipt.source); expect(after).toEqual(payload.receipt.output)
    expect(before).toMatchObject({ sampleRateHz: 48000, sampleCount: 576000, channelCount: 2, durationMs: 12000 })
    expect(after).toMatchObject({ sampleRateHz: 24000, sampleCount: 288000, channelCount: 2, durationMs: 12000 })
    expect(after.byteSize).toBe(44 + 288000 * 2 * 2)
    expect(after.samplePeakInteger).toBeLessThanOrEqual(Math.floor(32768 * 10 ** (-1500 / 20000)))
    expect(payload.receipt.dynamicsObservation.limitedFrameCount).toBeGreaterThan(0)
    expect(payload.receipt.dynamicsObservation.maximumReductionMilliDb).toBeGreaterThan(0)
    expect(workerJobs).toEqual(expect.arrayContaining([
      { schema: 'storyforge.avg.audio-dsp-worker-request', mode: 'compute', ok: true },
      { schema: 'storyforge.avg.audio-dsp-worker-request', mode: 'verify', ok: true },
    ]))
    const sealed = await verifyAcceptedProductBuildArtifactV1({ scope: s.scope, buildId: s.buildId, ...ref(processed) })
    expect(sealed.producerRunId).toBeGreaterThan(0); expect(sealed.producerRunId).not.toBe(raw.producerRunId)
    expect(payload.raw).toEqual({ ...ref(raw), producerReceiptHash: raw.producerReceiptHash })
    const rawPayload = JSON.parse(raw.payloadJson)
    expect(payload.requestIdentityHash).toBe(rawPayload.requirement.identityHash)
    const build = (await db.productBuilds.get(s.buildId))!, task = s.plan.tasks.find(t => t.kind === 'avg-audio-process')!
    expect(task.budgetReservation).toMatchObject({ modelCalls: 0, mediaCalls: 0, maximumCostUsd: 0 })
    const run = await readAgentRunV1(s.scope, sealed.producerRunId!)
    expect(run.projection.state).toBe('completed')
    expect(run.contract.runtimeBindingHash).toBe(await hashAvgTaskRuntimeBindingV1({ planHash: build.planHash, task, capabilityBindings: [] }))
    expect(run.events.some(e => e.type === 'model.requested' || e.type === 'tool.called'
      || e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response')).toBe(false)
    expect(JSON.parse(sealed.qualityJson)).toMatchObject({ noProviderRequest: true, hearing: 'unobserved', authorAdopted: false })
    expect(JSON.parse(sealed.rightsJson)).toMatchObject({ sourceContentHash: raw.contentHash,
      sourceProducerReceiptHash: raw.producerReceiptHash, sourceRightsHash: await hashProductProductionValueV2(JSON.parse(originalRights)),
      commercialUse: null, requiresAuthorReview: true })
    const target = { scope: s.scope, productionId: s.productionId, raw: ref(raw), processed: ref(processed) }
    const confirm = async (candidate: Parameters<typeof confirmAvgSoundCandidateV1>[1]) => {
      expect((await confirmAvgSoundCandidateV1(s, candidate)).ok).toBe(true)
    }
    const selected = await readAvgSoundCandidateV1(target)
    expect(selected.asset.contentHash).toBe(processed.contentHash)
    expect(selected.originalMeasurement.contentHash).toBe(raw.contentHash)
    const report = avgSoundAuthorReviewFixtureV3(selected.payload)
    await expect(stageAvgSoundReviewV1({ ...target, report, declaration })).rejects.toThrow(/准确声音/)
    await expect(stageAvgSoundChoiceV1({ ...target, declaration })).rejects.toThrow()
    report.soundEvidence.audioHash = selected.measurement.contentHash
    const review = await stageAvgSoundReviewV1({ ...target, report, declaration })
    expect(JSON.parse(review.metadataJson).inputs).toContainEqual(ref(processed)); await confirm(review)
    const choice = await stageAvgSoundChoiceV1({ ...target, declaration }), choicePayload = JSON.parse(choice.payloadJson)
    expect(choicePayload).toMatchObject({ version: 2, raw: ref(raw), processed: { ...ref(processed),
      recipeHash: payload.receipt.recipeHash, receiptHash: payload.receipt.receiptHash }, asset: selected.asset })
    expect(() => parseAvgAuthorSoundChoiceV1(choicePayload)).toThrow()
    expect(JSON.parse(choice.metadataJson).version).toBe(11); await confirm(choice)
    // Original licensed OGG remains unprocessed and keeps its strict V1 choice.
    const sfx = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.sfx'))!
    const sfxTarget = { ...target, raw: ref(sfx), processed: undefined }, sfxSource = await readAvgSoundCandidateV1(sfxTarget)
    expect(sfxSource.asset.mimeType).toBe('audio/ogg')
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.processed.desk.sfx')).toBeUndefined()
    const sfxReview = await stageAvgSoundReviewV1({ ...sfxTarget, report: avgSoundAuthorReviewFixtureV3(sfxSource.payload), declaration })
    await confirm(sfxReview)
    const sfxChoice = await stageAvgSoundChoiceV1({ ...sfxTarget, declaration })
    expect(parseAvgAuthorSoundChoiceV1(sfxChoice.payloadJson)).toMatchObject({ version: 1, raw: ref(sfx) })
    expect(JSON.parse(sfxChoice.metadataJson).version).toBe(9); await confirm(sfxChoice)
    const draft = await readAvgDraftV1(s.scope)
    const configured = await configureAvgChosenSoundDraftV1({ ...s, expectedDraftRevision: draft.revision })
    const workspace = parseAvgAuthorWorkspaceV1(configured.editorJson)
    expect(workspace.presentation.stage.assets).toEqual(expect.arrayContaining([selected.asset, sfxSource.asset]))
    expect(workspace.presentation.stage.cues).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetKey: selected.asset.assetKey, loop: true, volume: .2 }),
      expect.objectContaining({ assetKey: sfxSource.asset.assetKey, loop: false, volume: .6 }),
    ]))
    await confirm(await stageAvgWorkspaceInputV1({ ...s, expectedDraftRevision: configured.revision,
      artifactKey: 'avg.author.stage', declaration }))
    const finished = await finishAvgSoundRuntimeFixtureV1(s), frozen = finished.build!, preview = (await verifyStoredProductBuildPreview(frozen))!
    expect(frozen.previewHash).toBeTruthy(); expect(frozen.rootTerminalReceiptHash).toBeTruthy()
    expect(preview.mediaBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetKey: selected.asset.assetKey, blobContentHash: processed.contentHash }),
      expect.objectContaining({ assetKey: sfxSource.asset.assetKey, blobContentHash: sfx.contentHash }),
    ]))
    const finalMedia = (await db.productBuildArtifacts.where('buildId').equals(s.buildId)
      .filter(row => row.artifactKey.startsWith('avg.media.') && row.kind === 'audio').toArray()).find(row => row.contentHash === processed.contentHash)!
    expect(finalMedia.blobObjectId).toBe(processed.blobObjectId)
    expect(JSON.parse(finalMedia.rightsJson)).toMatchObject({ processedSound: ref(processed), originalRights: JSON.parse(originalRights),
      processedSoundProducerReceiptHash: processed.producerReceiptHash, audioProcessingReceiptHash: payload.receipt.receiptHash })
    expect(canonicalProductProductionJsonV2(await db.productBuildArtifacts.get(raw.id!))).toBe(originalRaw)
    expect(musicPosts()).toHaveLength(1); expect(String(musicPosts()[0][1]!.body)).toBe(originalRequest); expect(s.calls).toHaveLength(1)
    vi.mocked(soundReadiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    vi.mocked(audioReadiness.avgAudioProcessingExecutionReadyV1).mockReturnValue(false)
    useAIConfigStore.getState().setConfig({ ...config, apiKey: '' })
    const closedFetch = vi.fn(async () => { throw new Error('Closed-factory frozen proof may not contact providers') })
    vi.stubGlobal('fetch', closedFetch)
    const frozenInput = { scope: s.scope, buildId: s.buildId, expectedBuildRevision: frozen.stateRevision, controlEpoch: frozen.controlEpoch }
    const original = await verifyFrozenAvgAuthorInputsV1(frozenInput)
    const originalChoice = original.soundChoices!.find(c => c.payload.requirementKey === 'desk.bgm')!
    expect(originalChoice.payload).toEqual(choicePayload)
    const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const importedOwner = (await db.productBuilds.where('projectId').equals(projectId).first())!
    const scope = { projectId, workId: importedOwner.workId, worldId: importedOwner.worldId }
    await recoverImportedProductProductionProofsV1({ scope, productionId: importedOwner.productionId })
    const importedBuild = (await db.productBuilds.get(importedOwner.id!))!
    const importedInput = { scope, buildId: importedBuild.id!, expectedBuildRevision: importedBuild.stateRevision, controlEpoch: importedBuild.controlEpoch }
    const restored = await verifyFrozenAvgAuthorInputsV1(importedInput), imported = restored.soundChoices!.find(c => c.payload.requirementKey === 'desk.bgm')!
    expect(imported.payload).toEqual(choicePayload); expect(imported.validation).toEqual(originalChoice.validation)
    expect(imported.raw.payloadJson).toBe(raw.payloadJson); expect(imported.raw.rightsJson).toBe(originalRights)
    expect(imported.blobObjectId).not.toBe(processed.blobObjectId)
    expect(await sha256MediaData(await readMediaBlobObjectData({ scope, blobObjectId: imported.blobObjectId }))).toBe(processed.contentHash)
    const copiedPreview = (await verifyStoredProductBuildPreview(importedBuild))!
    expect(importedBuild.previewManifestJson).toBe(frozen.previewManifestJson); expect(copiedPreview.packageHash).toBe(preview.packageHash)
    const resolver = await createBuildProductMediaResolver({ scope, productBuildId: importedBuild.id!, preview: copiedPreview })
    try {
      expect(await sha256MediaData(await (await resolver.read(selected.asset.assetKey)).arrayBuffer())).toBe(processed.contentHash)
      expect(await sha256MediaData(await (await resolver.read(sfxSource.asset.assetKey)).arrayBuffer())).toBe(sfx.contentHash)
    } finally { await resolver.dispose() }
    const count = await db.productBuildArtifacts.count()
    await expect(stageAvgSoundChoiceV1({ ...target, scope, productionId: importedBuild.productionId, declaration })).rejects.toThrow(/尚未开放/)
    expect(await db.productBuildArtifacts.count()).toBe(count)
    const blob = (await db.mediaBlobObjects.get(imported.blobObjectId))!, bytes = new Uint8Array(blob.data!.slice(0))
    bytes[bytes.length - 1] ^= 1; await db.mediaBlobObjects.update(blob.id!, { data: bytes.buffer })
    await expect(verifyFrozenAvgAuthorInputsV1(importedInput)).rejects.toThrow()
    await db.mediaBlobObjects.put(blob); await deleteWork(scope.workId)
    expect(await db.productBuildArtifacts.where('workId').equals(scope.workId).count()).toBe(0)
    expect(await db.mediaBlobObjects.where('workId').equals(scope.workId).count()).toBe(0)
    expect(canonicalProductProductionJsonV2(await db.productBuilds.get(s.buildId))).toBe(canonicalProductProductionJsonV2(frozen))
    expect(canonicalProductProductionJsonV2(await db.productBuildArtifacts.get(raw.id!))).toBe(originalRaw)
    expect(await sha256MediaData(await readMediaBlobObjectData({ scope: s.scope, blobObjectId: processed.blobObjectId! }))).toBe(processed.contentHash)
    expect(closedFetch).not.toHaveBeenCalled(); expect(musicPosts()).toHaveLength(1); expect(s.calls).toHaveLength(1)
    expect(await db.productReleases.count()).toBe(0)
    // This includes real numeric resampling/verification plus full portable proof.
    // Hosted V8 coverage exhausted the old whole-case limit; product limits remain.
  }, process.env.CI ? 300_000 : 150_000)
})
