import { appendFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as soundReadiness from '../../src/lib/avg/sound-production-brief'
import * as audioReadiness from '../../src/lib/avg/audio-production-brief'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import { avgSoundRuntimeStageFixtureV1, finishAvgSoundRuntimeFixtureV1 } from '../helpers/avg-sound-runtime-fixture'
import { adoptAvgSoundSourcesV1, acceptedAvgSoundArtifactV1, confirmAvgSoundCandidateV1 } from '../helpers/avg-sound-harness-fixture'
import { avgSoundAuthorReviewFixtureV3 } from '../helpers/avg-sound-review-fixture'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { keepAvgGeneratedSoundStageDraftV1, prepareAvgAssemblyBriefV1, startAvgAssemblyV1, runAvgAssemblyV1,
  configureAvgChosenSoundDraftV1, stageAvgWorkspaceInputV1 } from '../../src/lib/avg/assembly-service'
import { saveAvgSoundLocalRepairDraftV1 } from '../../src/lib/avg/sound-local-repair-service'
import { readAvgSoundCandidateV1, stageAvgSoundReviewV1, stageAvgSoundChoiceV1 } from '../../src/lib/avg/sound-workbench-service'
import { readAvgAdoptedGeneratedSoundV1 } from '../../src/lib/avg/stage-sound-sources'
import { parseAvgProcessedAudioPayloadV1 } from '../../src/lib/avg/processed-audio-contract'
import { assertAvgAudioProcessingWaveBytesV1 } from '../../src/lib/avg/audio-processing'
import { executeAvgAudioGainWorkerRequestV1, type AvgAudioGainWorkerRequestV1 } from '../../src/lib/avg/audio-gain-worker-protocol'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readMediaBlobObjectData } from '../../src/lib/product-production/media-blob-store'
import { verifyFrozenAvgAuthorInputsV1 } from '../../src/lib/avg/author-artifacts'
import { verifyStoredProductBuildPreview } from '../../src/lib/product-production/preview-manifest'
import { recoverImportedProductProductionProofsV1, readProductProductionDetailsV1, startProductProductionPreviewV1 } from '../../src/lib/product-production/service'
import { prepareProductProductionAdoption, publishProductProductionBuild } from '../../src/lib/product-production/adoption'
import { recordProductBuildMainRoutePlaythroughV1 } from '../../src/lib/product-production/quality-receipts'
import { scanAvgPrototypeMediaV1 } from '../../src/lib/avg/prototype-media-scan'
import { reachAvgPresentationBeat } from '../../src/lib/avg/runtime-commands'
import { commitNarrativeChoice, readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import { createProductRuntimeInstance } from '../../src/lib/product/runtime-instances'
import { verifyProductReleaseManifest } from '../../src/lib/product-production/runtime-package'
import { readProductReleaseMediaBytes } from '../../src/lib/product-production/release-media'
import { avgRuntimeStage } from '../../src/lib/avg/executable-module'
import { hashAvgSoundBytesV1 } from '../../src/lib/avg/sound-provider-contract'
import { classifyAvgAuthorPrototypeBriefV1 } from '../../src/lib/avg/prototype-contract'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'

// Actual isolated Brief/start, registered Context, scheduler, sealed producers,
// author decisions, CAS and portable lifecycle. Only external HTTP, Worker
// transport and unavailable DOM decoder observations are controlled.
class WorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage(value: AvgAudioGainWorkerRequestV1, transfer: Transferable[]) {
    const request = structuredClone(value, { transfer })
    queueMicrotask(() => this.onmessage?.({ data: executeAvgAudioGainWorkerRequestV1(request) } as MessageEvent<unknown>))
  }
}
const config = { provider: 'agnes' as const, baseUrl: 'https://sound-proposal.fixture.invalid/v1',
  apiKey: 'controlled-engineering-key-no-external-account', model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 }
let phase = 'not-started'
const mark = (value: string) => { phase = value; if (process.env.AVG_SOUND_REPAIR_PHASE_LOG) appendFileSync(process.env.AVG_SOUND_REPAIR_PHASE_LOG, JSON.stringify({ phase, at: Date.now() }) + '\n') }
const declaration = 'ENGINEERING exact local sound repair for preview only; real hearing and commercial quality remain unobserved.'
const ref = (r: { artifactKey: string; version: number; contentHash: string }) => ({ artifactKey: r.artifactKey, version: r.version, contentHash: r.contentHash })
beforeAll(async () => {
  await db.delete(); await db.open(); useAIConfigStore.getState().setConfig(config)
  vi.spyOn(soundReadiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
  vi.spyOn(audioReadiness, 'avgAudioProcessingExecutionReadyV1').mockReturnValue(true)
  vi.stubGlobal('Worker', WorkerPort)
  vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({ measuredAt: Date.now(), environment: input.environment,
    assets: input.assets.map(a => ({ assetKey: a.assetKey, contentHash: a.contentHash, mimeType: a.mimeType, mediaClass: 'audio', status: 'decoded',
      decodedWidth: null, decodedHeight: null, decodedDurationMs: a.mimeType === 'audio/wav' ? 12000 : 500, decodedHasAlpha: null,
      decodedChannelCount: a.mimeType === 'audio/wav' ? 2 : 1, decodedSampleRateHz: 48000, integratedLufs: -18, truePeakDbtp: -12,
      loopSeamDbfs: -40, policyFailures: [], failureCode: null })) }))
})
afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

const environment = { browserName: 'isolated-released-repair-contract', browserVersion: '1',
  platform: 'controlled HTTP/Worker/decoder observations; not native hearing', viewport: { width: 1280, height: 720 } }
async function runtimeCommand(sessionId: number) {
  const state = await readProductRuntimeStateVersion(sessionId)
  return { sessionId, baseSequence: state.sequence, baseStateHash: state.stateHash, commandId: crypto.randomUUID() }
}
async function publishCurrentPreview(scope: Parameters<typeof readAvgDraftV1>[0], productionId: number) {
  const build = (await readProductProductionDetailsV1(scope, productionId, ['avg'])).build!
  const preview = await startProductProductionPreviewV1({ scope, productionId })
  await reachAvgPresentationBeat({ ...await runtimeCommand(preview.sessionId), beatKey: 'line.desk' })
  await commitNarrativeChoice({ ...await runtimeCommand(preview.sessionId), choiceKey: 'wait' })
  await reachAvgPresentationBeat({ ...await runtimeCommand(preview.sessionId), beatKey: 'line.wait' })
  expect((await readProductRuntimeState(preview.sessionId)).narrative!.completed).toBe(true)
  await recordProductBuildMainRoutePlaythroughV1({ scope, productBuildId: build.id!, productRuntimeSessionId: preview.sessionId,
    authorConfirmation: 'author-confirmed-main-route', environment })
  const measured = await scanAvgPrototypeMediaV1({ scope, buildId: build.id!, expectedPreviewHash: build.previewHash,
    environment, signal: new AbortController().signal })
  expect(measured!.evidence.passed).toBe(true)
  const prepared = await prepareProductProductionAdoption({ scope, productionId })
  const published = await publishProductProductionBuild({ scope, productionId, command: { type: 'publish',
    commandId: `sound.repair.release.${crypto.randomUUID()}`, expectedStateRevision: prepared.intent.expectedStateRevision,
    buildNumber: prepared.intent.buildNumber, expectedManifestHash: prepared.intent.manifestHash, adoptionIntentHash: prepared.adoptionIntentHash } })
  const record = (await db.productReleases.get(published.productReleaseId))!
  const manifest = await verifyProductReleaseManifest(record.manifestJson), assets = avgRuntimeStage(manifest.runtimePackage)!.assets
  for (const asset of assets) expect(await hashAvgSoundBytesV1(await readProductReleaseMediaBytes({ scope,
    productReleaseId: record.id!, asset }))).toBe(asset.blobContentHash)
  return { record, assets, build: (await db.productBuilds.get(build.id!))! }
}
let production: (() => Promise<void>) | null = null
let publication: (() => Promise<void>) | null = null
let portable: (() => Promise<void>) | null = null
describe.sequential('AVG one adopted sound repair through the existing workbench services', () => {
  it('publishes the original preview and saves a no-Key repair proposal without changing its release or save', async () => {
    mark('original-preview')
    try {
    const s = await avgSoundRuntimeStageFixtureV1()
    mark('original-stage-ready')
    await finishAvgSoundRuntimeFixtureV1(s)
    mark('publish-original')
    const originalRelease = await publishCurrentPreview(s.scope, s.productionId), parent = originalRelease.build
    expect(parent.status).toBe('released')
    const oldSave = await createProductRuntimeInstance({ scope: s.scope, kind: 'avg', title: 'ENGINEERING unchanged original release save',
      productSource: { kind: 'release', productReleaseId: originalRelease.record.id! } })
    const oldState = await readProductRuntimeState(oldSave.id!)
    mark('original-preview-ready')
    const raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!, compiled = (await acceptedAvgSoundArtifactV1(s, 'avg.media.compiled-sound-requirements'))!
    const oldRaw = structuredClone(raw), parentPreview = await verifyStoredProductBuildPreview(parent)
    const draft = await readAvgDraftV1(s.scope), workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
    workspace.basePreviewHash = parent.previewHash
    if (s.brief.avgSoundPlanning?.version !== 1) throw new Error('Expected original sound V1')
    workspace.soundProduction = { schema: 'storyforge.avg.sound-production-draft', version: 1, scope: s.brief.avgSoundPlanning.scope }
    const baseline = await saveAvgAuthorWorkspaceV1(s.scope, draft.revision, workspace)
    const kept = await keepAvgGeneratedSoundStageDraftV1({ ...s, expectedDraftRevision: baseline.revision, expectedBuildId: parent.id! })
    const keptWorkspace = parseAvgAuthorWorkspaceV1(kept.editorJson), untouchedSfx = keptWorkspace.presentation.inheritedSounds!.find(e => e.assetKey !== JSON.parse(raw.metadataJson).assetKey)!
    const unchangedAssets = keptWorkspace.presentation.stage.assets.filter(a => a.assetKey !== JSON.parse(raw.metadataJson).assetKey)
    const calls = { text: s.calls.length, all: s.fetcher.mock.calls.length, audio: s.wire.fetcher.mock.calls.length }
    const recipe = { schema: 'storyforge.avg.audio-processing-recipe' as const, version: 1 as const, gainMilliDb: -6000,
      maximumDurationMs: 12000, sampleRatePolicy: 'preserve' as const, channelPolicy: 'preserve' as const,
      timelinePolicy: 'preserve' as const, overflowPolicy: 'reject' as const, declaration }
    mark('save-repair')
    const repair = await saveAvgSoundLocalRepairDraftV1({ scope: s.scope, expectedDraftRevision: kept.revision,
      expectedBuildId: parent.id!, expectedBuildRevision: parent.stateRevision, expectedPreviewHash: parent.previewHash,
      assetKey: JSON.parse(raw.metadataJson).assetKey, recipe })
    useAIConfigStore.getState().setConfig({ ...config, apiKey: '' })
    expect(await db.productReleases.get(originalRelease.record.id!)).toEqual(originalRelease.record)
    expect(await readProductRuntimeState(oldSave.id!)).toEqual(oldState)
    production = async () => {
    try {
    mark('prepare')
    const prepared = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: repair.revision })
    const brief = JSON.parse(prepared.brief!.briefJson)
    expect(brief.avgSoundPlanning.version).toBe(2); expect(brief.capabilityRequirements).toEqual([])
    expect(classifyAvgAuthorPrototypeBriefV1(brief)).toBe('sound')
    for (const invalid of [
      { ...brief, qualityProfile: 'commercial-candidate' },
      { ...brief, intent: { ...brief.intent, productType: 'text-adventure' } },
      { ...brief, capabilityRequirements: s.brief.capabilityRequirements },
      { ...brief, externalDataPolicy: { ...brief.externalDataPolicy, allowedDataClasses: ['image-prompt'] } },
      { ...brief, completionContract: { ...brief.completionContract, requiredGateIds: [] } },
    ]) expect(classifyAvgAuthorPrototypeBriefV1(invalid)).toBeNull()
    expect(brief.productionBudget).toMatchObject({ maximumModelCalls: 0, maximumMediaCalls: 0, maximumCostUsd: 0 })
    expect(brief.avgSoundPlanning.repair.sourceScope.templates).toHaveLength(2)
    expect(brief.avgSoundPlanning.repair.sourcePlan.entries).toHaveLength(2)
    expect(prepared.build!.id).toBe(parent.id)
    mark('start')
    const started = await startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: prepared.brief!.briefHash })
    const build = started.build!, plan = parseProductProductionPlanV3(build.planJson, started.executionBrief!, build.briefHash)
    expect(build.id).not.toBe(parent.id); expect(build.parentBuildNumber).toBe(parent.buildNumber)
    expect(plan.tasks.some(t => t.kind === 'avg-sound-plan-propose' || t.kind === 'avg-author-sound-plan')).toBe(false)
    expect(plan.tasks.filter(t => t.kind === 'avg-sound-raw-reuse')).toHaveLength(1)
    expect(plan.tasks.every(t => t.budgetReservation.modelCalls === 0 && t.budgetReservation.mediaCalls === 0)).toBe(true)
    const next = { ...s, buildId: build.id!, brief: started.executionBrief!, plan, capabilityBindings: [],
      executor: createConfiguredProductProductionExecutorV1({ production: started.production, brief: started.executionBrief! }) }
    mark('adopt-sources')
    await adoptAvgSoundSourcesV1(next)
    await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })
    mark('inspect-new-producers')
    const reused = (await acceptedAvgSoundArtifactV1(next, raw.artifactKey))!, processed = (await acceptedAvgSoundArtifactV1(next, 'avg.sound.processed.desk.bgm'))!
    const reusedCompiled = (await acceptedAvgSoundArtifactV1(next, compiled.artifactKey))!
    if (!processed) throw new Error('Local processing did not accept its candidate: ' + (await db.productBuilds.get(build.id!))?.failureJson)
    expect(reusedCompiled.payloadJson).toBe(compiled.payloadJson); expect(reusedCompiled.rightsJson).toBe(compiled.rightsJson)
    expect(reused.payloadJson).toBe(raw.payloadJson); expect(reused.metadataJson).toBe(raw.metadataJson); expect(reused.rightsJson).toBe(raw.rightsJson)
    expect(reused.producerRunId).not.toBe(raw.producerRunId); expect(reused.producerReceiptHash).not.toBe(raw.producerReceiptHash)
    expect(JSON.parse(reused.qualityJson)).toMatchObject({ schema: 'storyforge.avg.raw-sound-revalidation', noProviderRequest: true, hearing: 'unobserved', authorAdopted: false })
    const processing = await parseAvgProcessedAudioPayloadV1(processed.payloadJson)
    expect(processing.raw.producerReceiptHash).toBe(reused.producerReceiptHash)
    const originalData = await readMediaBlobObjectData({ scope: s.scope, blobObjectId: raw.blobObjectId! })
    const output = await readMediaBlobObjectData({ scope: s.scope, blobObjectId: processed.blobObjectId! })
    await assertAvgAudioProcessingWaveBytesV1({ source: originalData, output, recipe, receipt: processing.receipt })
    for (const row of [reusedCompiled, reused, processed]) {
      const run = await readAgentRunV1(s.scope, row.producerRunId!)
      expect(run.events.some(e => e.type === 'model.requested' || e.type === 'tool.called'
        || e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response')).toBe(false)
    }
    const target = { scope: s.scope, productionId: s.productionId, raw: ref(reused), processed: ref(processed) }
    mark('read-new-audio')
    const selected = await readAvgSoundCandidateV1(target), report = avgSoundAuthorReviewFixtureV3(selected.payload)
    report.soundEvidence.audioHash = selected.asset.contentHash
    mark('independent-review')
    const review = await stageAvgSoundReviewV1({ ...target, report, declaration })
    expect((await confirmAvgSoundCandidateV1(next, review)).ok).toBe(true)
    mark('adopt-new-choice')
    const choice = await stageAvgSoundChoiceV1({ ...target, declaration })
    expect((await confirmAvgSoundCandidateV1(next, choice)).ok).toBe(true)
    mark('configure-one-slot')
    const configured = await configureAvgChosenSoundDraftV1({ scope: s.scope, productionId: s.productionId, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
    const configuredWorkspace = parseAvgAuthorWorkspaceV1(configured.editorJson)
    expect(configuredWorkspace.presentation.stage.assets.filter(a => a.assetKey !== selected.asset.assetKey)).toEqual(unchangedAssets)
    expect(configuredWorkspace.presentation.stage.cues).toEqual(keptWorkspace.presentation.stage.cues)
    expect(configuredWorkspace.presentation.inheritedSounds).toEqual([untouchedSfx])
    mark('adopt-stage')
    const stage = await stageAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId,
      expectedDraftRevision: configured.revision, artifactKey: 'avg.author.stage', declaration })
    expect((await confirmAvgSoundCandidateV1(next, stage)).ok).toBe(true)
    await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId })
    const previewReady = (await db.productBuilds.get(build.id!))!
    expect(previewReady.previewHash).toBeTruthy()
    publication = async () => {
    try {
    mark('publish-repaired')
    const revisedRelease = await publishCurrentPreview(s.scope, s.productionId), frozen = revisedRelease.build
    expect(frozen.status).toBe('released'); expect(revisedRelease.record.id).not.toBe(originalRelease.record.id)
    expect(revisedRelease.assets.filter(a => a.assetKey !== selected.asset.assetKey)).toEqual(originalRelease.assets.filter(a => a.assetKey !== selected.asset.assetKey))
    expect(revisedRelease.assets.find(a => a.assetKey === selected.asset.assetKey)!.blobContentHash).toBe(selected.asset.contentHash)
    expect(originalRelease.assets.find(a => a.assetKey === selected.asset.assetKey)!.blobContentHash).not.toBe(selected.asset.contentHash)
    expect(await db.productReleases.get(originalRelease.record.id!)).toEqual(originalRelease.record)
    expect(await db.productBuilds.get(parent.id!)).toEqual(parent)
    expect((await db.productRuntimeSessions.get(oldSave.id!))!.productReleaseId).toBe(originalRelease.record.id)
    expect(await readProductRuntimeState(oldSave.id!)).toEqual(oldState)
    const finalDraft = await readAvgDraftV1(s.scope), finalWorkspace = parseAvgAuthorWorkspaceV1(finalDraft.editorJson)
    finalWorkspace.basePreviewHash = frozen.previewHash
    const saved = await saveAvgAuthorWorkspaceV1(s.scope, finalDraft.revision, finalWorkspace)
    mark('keep-new-source')
    const retained = await keepAvgGeneratedSoundStageDraftV1({ scope: s.scope, productionId: s.productionId,
      expectedDraftRevision: saved.revision, expectedBuildId: frozen.id! })
    const retainedWorkspace = parseAvgAuthorWorkspaceV1(retained.editorJson), retainedSound = retainedWorkspace.presentation.inheritedSounds!.find(e => e.assetKey === selected.asset.assetKey)!
    expect(retainedWorkspace).not.toHaveProperty('soundLocalRepair'); expect(retainedSound.source.version).toBe(2)
    expect(await db.productBuildArtifacts.get(raw.id!)).toEqual(oldRaw)
    expect({ text: s.calls.length, all: s.fetcher.mock.calls.length, audio: s.wire.fetcher.mock.calls.length }).toEqual(calls)
    portable = async () => {
    mark('offline-portable')
    vi.mocked(soundReadiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    vi.mocked(audioReadiness.avgAudioProcessingExecutionReadyV1).mockReturnValue(false)
    mark('import-portable')
    const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const imported = (await db.productBuilds.where('projectId').equals(projectId).filter(b => b.buildNumber === frozen.buildNumber).first())!
    const scope = { projectId, workId: imported.workId, worldId: imported.worldId }
    await recoverImportedProductProductionProofsV1({ scope, productionId: imported.productionId })
    mark('read-restored')
    const restored = await readAvgAdoptedGeneratedSoundV1({ scope, source: retainedSound.source })
    expect(new Uint8Array(restored.originalData)).toEqual(new Uint8Array(originalData)); expect(new Uint8Array(restored.data)).toEqual(new Uint8Array(output))
    expect(restored.raw.producerReceiptHash).toBe(reused.producerReceiptHash)
    expect(restored.raw.blobObjectId).not.toBe(raw.blobObjectId); expect(restored.blobObjectId).not.toBe(processed.blobObjectId)
    const importedBuild = (await db.productBuilds.get(imported.id!))!
    await verifyFrozenAvgAuthorInputsV1({ scope, buildId: importedBuild.id!, expectedBuildRevision: importedBuild.stateRevision, controlEpoch: importedBuild.controlEpoch })
    const originalImported = (await db.mediaBlobObjects.get(restored.originalBlobObjectId))!, damaged = new Uint8Array(originalImported.data!.slice(0))
    damaged[damaged.length - 1] ^= 1; await db.mediaBlobObjects.update(originalImported.id!, { data: damaged.buffer })
    await expect(readAvgAdoptedGeneratedSoundV1({ scope, source: retainedSound.source })).rejects.toThrow()
    await db.mediaBlobObjects.put(originalImported); await deleteWork(scope.workId)
    expect(await db.mediaBlobObjects.where('workId').equals(scope.workId).count()).toBe(0)
    expect(canonicalProductProductionJsonV2(await db.productBuilds.get(parent.id!))).toBe(canonicalProductProductionJsonV2(parent))
    expect((await verifyStoredProductBuildPreview(parent))!.packageHash).toBe(parentPreview!.packageHash)
    expect(await db.productBuildArtifacts.get(raw.id!)).toEqual(oldRaw)
    expect({ text: s.calls.length, all: s.fetcher.mock.calls.length, audio: s.wire.fetcher.mock.calls.length }).toEqual(calls)
    expect(await db.productReleases.count()).toBe(2)
    for (const released of [originalRelease, revisedRelease]) {
      expect(await db.productReleases.get(released.record.id!)).toEqual(released.record)
      for (const asset of released.assets) expect(await hashAvgSoundBytesV1(await readProductReleaseMediaBytes({ scope: s.scope, productReleaseId: released.record.id!, asset }))).toBe(asset.blobContentHash)
    }
    expect(await readProductRuntimeState(oldSave.id!)).toEqual(oldState)
    }
    } catch (cause) { throw new Error(`Repaired sound publication phase ${phase}: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`) }
    }
    } catch (cause) { throw new Error(`Released sound repair production phase ${phase}: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`) }
    }
    } catch (cause) { throw new Error(`Sound local repair phase ${phase}: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}`) }
  }, 60_000)
  it('repairs one adopted WAV locally and creates a separately adopted preview while retaining every other slot', async () => {
    if (!production) throw new Error('The original publication/proposal phase did not complete; no repair source exists')
    await production()
    // Only the observed timed-out repair/preview phase gets a CI coverage budget.
  }, process.env.CI ? 180_000 : 60_000)
  it('publishes the repaired preview as a distinct release while preserving the original release/save and original bytes', async () => {
    if (!publication) throw new Error('The independent repaired preview phase did not complete; no publication source exists')
    await publication()
  }, 60_000)
  it('restores the completed repair with capabilities closed, rejects damaged original bytes and deletes only the imported copy', async () => {
    if (!portable) throw new Error('The preceding real production phase did not complete; no portable evidence is available')
    await portable()
  }, 60_000)
})
