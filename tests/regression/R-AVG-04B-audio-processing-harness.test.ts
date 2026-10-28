import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { ProductRelease } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as gates from '../../src/lib/avg/assembly-contract'
import * as readiness from '../../src/lib/avg/audio-production-brief'
import * as mediaVerifier from '../../src/lib/product-production/media-runtime-verifier'
import { prepareNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { avgAuthorWorkspaceFixture } from '../helpers/avg-author-stage-fixture'
import { avgReadingAudioFixture } from '../helpers/avg-reading-fixture'
import { avgVoicePolicyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { readProductProductionDetailsV1, stopProductProductionV1 } from '../../src/lib/product-production/service'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { verifyAcceptedProductBuildArtifactV1, acceptProductBuildArtifact } from '../../src/lib/product-production/artifact-store'
import { readMediaBlobObjectData } from '../../src/lib/product-production/media-blob-store'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { hashAvgVoiceSourceInputV1 } from '../../src/lib/avg/voice-production-source'
import { hashAvgVoiceTextV1 } from '../../src/lib/avg/voice-production-contract'
import { hashAvgSpeechProtocolV1 } from '../../src/lib/avg/voice-request-contract'
import { configuredAvgVoiceEndpointHashV1 } from '../../src/lib/avg/voice-transport'
import { avgVoiceRouteBindingHashV1 } from '../../src/lib/avg/voice-assembly-contract'
import { encodeAvgVoiceDraftV1 } from '../../src/lib/avg/voice-draft-contract'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { stageAvgWorkspaceInputV1, confirmAvgWorkspaceInputV1, runAvgAssemblyV1, readAvgVoiceCandidateV3, readAvgRawVoiceCandidateV3,
  stageAvgAudioReviewV3, stageAvgVoiceChoiceV3, configureAvgChosenVoiceDraftV3, keepAvgGeneratedVoiceStageDraftV1,
  prepareAvgAssemblyBriefV1, startAvgAssemblyV1, prepareAvgVoiceRecoveryBriefV1 } from '../../src/lib/avg/assembly-service'
import { assertAvgAudioProcessingWaveBytesV1 } from '../../src/lib/avg/audio-processing'
import { parseAvgProcessedAudioPayloadV1 } from '../../src/lib/avg/processed-audio-contract'
import { executeAvgAudioGainWorkerRequestV1, type AvgAudioGainWorkerRequestV1 } from '../../src/lib/avg/audio-gain-worker-protocol'
import { hashAvgTaskRuntimeBindingV1 } from '../../src/lib/avg/task-claim'
import { AVG_VOICE_REVIEW_CRITERIA_V1 } from '../../src/lib/avg/voice-review-contract'
import type { AvgReviewIssuesV1 } from '../../src/lib/avg/artifact-contract'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { verifyFrozenAvgAuthorInputsV1 } from '../../src/lib/avg/author-artifacts'
import { verifyStoredProductBuildPreview } from '../../src/lib/product-production/preview-manifest'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { readAvgAdoptedGeneratedVoice } from '../../src/lib/avg/generated-voice-source'
import { saveAvgVoiceProcessingDraftV1 } from '../../src/lib/avg/voice-draft-service'
import { saveAvgVoiceLocalRepairDraftV2, clearAvgVoiceLocalRepairDraftV2 } from '../../src/lib/avg/voice-local-repair-service'
import { parseAvgStoredAssemblyBriefV3 } from '../../src/lib/avg/voice-assembly-storage'
import { parseAvgVoiceRecoveryV1 } from '../../src/lib/avg/voice-recovery-contract'
import { assertAvgVoiceLocalRepairSourcesV2 } from '../../src/lib/avg/voice-recovery'
import { readAvgVoiceDraftV1 } from '../../src/lib/avg/voice-draft-contract'

import { startProductProductionPreviewV1 } from '../../src/lib/product-production/service'
import { prepareProductProductionAdoption, publishProductProductionBuild } from '../../src/lib/product-production/adoption'
import { recordProductBuildMainRoutePlaythroughV1 } from '../../src/lib/product-production/quality-receipts'
import { scanAvgPrototypeMediaV1 } from '../../src/lib/avg/prototype-media-scan'
import { reachAvgPresentationBeat } from '../../src/lib/avg/runtime-commands'
import { commitAvgVoiceCommandV1 } from '../../src/lib/avg/reading-commands'
import { avgCurrentReadingLineV1 } from '../../src/lib/avg/reading-runtime'
import { commitNarrativeChoice, readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import { createProductRuntimeInstance } from '../../src/lib/product/runtime-instances'
import { verifyProductReleaseManifest } from '../../src/lib/product-production/runtime-package'
import { readProductReleaseMediaBytes } from '../../src/lib/product-production/release-media'
import { avgRuntimeStage } from '../../src/lib/avg/executable-module'
import { hashAvgSoundBytesV1 } from '../../src/lib/avg/sound-provider-contract'

// Only the explicitly closed capability, external HTTP, Worker transport and
// unavailable native analyzer are controlled. The authorized Brief, canonical
// Plan, registered context, root/child claims, physical PCM, receipts, sealed
// admission and DB are actual isolated application paths. Not a public-ready
// feature, real provider, native Worker, audition or author adoption claim.
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
const config = { provider: 'agnes' as const, baseUrl: 'https://processed-speech.fixture.invalid/v1',
  apiKey: 'fixture-only-never-a-real-key', model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 }
beforeEach(async () => {
  await db.delete(); await db.open(); vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1')
  vi.spyOn(gates, 'avgVoiceProductionEnabledV3').mockReturnValue(true)
  vi.spyOn(readiness, 'avgAudioProcessingExecutionReadyV1').mockReturnValue(true)
  vi.stubGlobal('Worker', WorkerPort); useAIConfigStore.getState().setConfig(config)
  vi.spyOn(mediaVerifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({ measuredAt: Date.now(), environment: input.environment,
    assets: input.assets.map(asset => ({ assetKey: asset.assetKey, contentHash: asset.contentHash, mimeType: asset.mimeType,
      mediaClass: 'audio', status: 'decoded', decodedWidth: null, decodedHeight: null, decodedDurationMs: 500,
      decodedHasAlpha: null, decodedChannelCount: 1, decodedSampleRateHz: 48000, integratedLufs: -18,
      truePeakDbtp: -12, loopSeamDbfs: -40, policyFailures: [], failureCode: null })) }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); db.close() })

async function startProcessedVoice(withSecondLine = false) {
  let phase = 'prepare-assembly'
  try {
  const workspace = avgAuthorWorkspaceFixture()
  workspace.presentation.reading = { schema: 'storyforge.avg.reading-plan', version: 1, manualVoice: 'wait',
    voiceFailure: 'pause', maximumVoiceWaitMs: 30000, autoDelayMs: 800, voices: [] }
  const owner = await prepareNativeAvgAssembly(workspace)
  const policy = await avgVoicePolicyFixtureV3(false), assembly = policy.avgAssembly, protocol = assembly.voice.protocol
  if (withSecondLine) assembly.voice.batch.requirements.push({ ...structuredClone(assembly.voice.batch.requirements[0]),
    requirementKey: 'keeper.other', assetKey: 'voice.wait', sceneKey: 'wait', lineKey: 'line.wait' })
  protocol.provider = 'agnes'; protocol.endpointRouteHash = await configuredAvgVoiceEndpointHashV1({ baseUrl: config.baseUrl, model: protocol.model })
  const capabilityHash = await hashAvgSpeechProtocolV1(protocol)
  Object.assign(assembly.voice.batch.presets[0]!, { provider: protocol.provider, model: protocol.model,
    endpointRouteHash: protocol.endpointRouteHash, capabilityHash })
  policy.capabilityRequirements[0]!.capabilityHash = capabilityHash
  assembly.voice.binding.endpointRouteHash = protocol.endpointRouteHash
  assembly.voice.binding.bindingHash = await avgVoiceRouteBindingHashV1({ requirementKey: 'avg.media.voice', adapterId: protocol.adapterId,
    capabilityHash, endpointRouteHash: protocol.endpointRouteHash })
  assembly.sceneKeys = workspace.systemPlan.scenes.map(scene => scene.key)
  assembly.voice.batch.sourceInputHash = await hashAvgVoiceSourceInputV1(workspace)
  for (const requirement of assembly.voice.batch.requirements) {
    const script = workspace.scripts.find(s => s.sceneKey === requirement.sceneKey)!, line = script.lines.find(l => l.lineKey === requirement.lineKey)!
    Object.assign(requirement, { text: line.text, textHash: await hashAvgVoiceTextV1(line.text), speakerKey: line.speakerKey, textRevision: 1,
      // The controlled clip is 500 ms. Declare a finite 1 s ceiling through
      // the real draft path, below the independently declared reading wait.
      maximumDurationMs: 1000,
      script: { artifactKey: `avg.content.scene-script.${script.sceneKey}`, version: 1, contentHash: await hashProductProductionValueV2(script) } })
  }
  const processing = readiness.avgAudioProcessingForVoiceV3({ schema: 'storyforge.avg.audio-production-processing-plan', version: 1,
    entries: [{ domain: 'voice', requirementKey: assembly.voice.batch.requirements[0]!.requirementKey, recipe: {
      schema: 'storyforge.avg.audio-processing-recipe', version: 1, gainMilliDb: -6000, maximumDurationMs: assembly.voice.batch.requirements[0]!.maximumDurationMs,
      sampleRatePolicy: 'preserve', channelPolicy: 'preserve', timelinePolicy: 'preserve', overflowPolicy: 'reject',
      declaration: '明确加工测试原件；原请求、审听、作者选择与正式启用仍独立。' } }] }, assembly)
  workspace.voiceProduction = await encodeAvgVoiceDraftV1(assembly.voice)
  workspace.voiceProcessing = processing
  phase = 'save-actual-voice-and-processing-workspace'
  const draft = await readAvgDraftV1(owner.scope)
  const saved = await saveAvgAuthorWorkspaceV1(owner.scope, draft.revision, workspace)
  const prepared = await prepareAvgAssemblyBriefV1({ scope: owner.scope, expectedDraftRevision: saved.revision })
  phase = 'authorize-start'
  await startAvgAssemblyV1({ scope: owner.scope, productionId: owner.productionId, expectedBriefHash: prepared.brief!.briefHash })
  const details = await readProductProductionDetailsV1(owner.scope, owner.productionId, ['avg'])
  const s = { ...owner, details, buildId: details.build!.id! }, audio = await avgReadingAudioFixture(500)
  const fetcher = vi.fn(async (target: RequestInfo | URL) => {
    if (!String(target).endsWith('/audio/speech')) throw new Error('Unexpected controlled processed-voice route')
    return new Response(audio.data, { headers: { 'Content-Type': 'audio/wav', 'x-request-id': `processed.harness.response.${fetcher.mock.calls.length}` } })
  })
  vi.stubGlobal('fetch', fetcher)
  phase = 'first-author-input-run'
  await runAvgAssemblyV1(s); expect(fetcher).not.toHaveBeenCalled()
  for (const artifactKey of ['avg.system.plan', ...assembly.sceneKeys.map(key => `avg.content.scene-script.${key}`)]) {
    phase = 'confirm-original-input:' + artifactKey
    const draft = await readAvgDraftV1(s.scope), candidate = await stageAvgWorkspaceInputV1({ ...s, expectedDraftRevision: draft.revision,
      artifactKey, declaration: '明确确认工程输入；不是剧情、视听或商业质量通过。' })
    await confirmAvgWorkspaceInputV1({ ...s, artifactKey: candidate.artifactKey, candidateVersion: candidate.version,
      candidateHash: JSON.parse(candidate.metadataJson).candidateHash })
  }
  phase = 'raw-and-local-processing-run'
  await runAvgAssemblyV1(s)
  return { ...s, audio, fetcher, processing }
  } catch (error) {
    const rows = await db.productBuilds.toArray().catch(() => [])
    const artifacts = await db.productBuildArtifacts.toArray().catch(() => [])
    const events = await db.agentRunEvents.toArray().catch(() => [])
    throw new Error('[processed-harness:' + phase + '] ' + (error instanceof Error ? error.stack || String(error) : String(error)) + ' ' + JSON.stringify({
      builds: rows.map(row => ({ status: row.status, failure: row.failureJson,
        tasks: Object.entries(JSON.parse(row.budgetLedgerJson).tasks ?? {}).map(([key, entry]) => {
          const task = entry as { status?: string; runId?: number; errorCode?: string }
          return { key, status: task.status, runId: task.runId, errorCode: task.errorCode }
        }) })),
      artifacts: artifacts.map(row => ({ key: row.artifactKey, status: row.status, runId: row.producerRunId })),
      events: events.slice(-12).map(row => ({ type: row.type, runId: row.runId })),
    }))
  }
}

type VoiceOwner = Pick<Awaited<ReturnType<typeof startProcessedVoice>>, 'scope' | 'productionId'>
async function confirmCurrentInputs(s: VoiceOwner, keys: string[]) {
  for (const artifactKey of keys) {
    const candidate = await stageAvgWorkspaceInputV1({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision,
      artifactKey, declaration: '确认原创工程输入；工程观察不代表文学、真人审听或商业质量通过。' })
    await confirmAvgWorkspaceInputV1({ ...s, artifactKey: candidate.artifactKey, candidateVersion: candidate.version,
      candidateHash: JSON.parse(candidate.metadataJson).candidateHash })
  }
}
async function adoptCurrentVoices(s: VoiceOwner) {
  const details = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
  const assembly = parseAvgStoredAssemblyBriefV3(details.executionBrief!.avgAssembly).assembly
  const rows = await db.productBuildArtifacts.where('buildId').equals(details.build!.id!).toArray()
  for (const requirement of assembly.voice.batch.requirements) {
    const raw = rows.find(r => r.status === 'accepted' && r.artifactKey === `avg.voice.raw.${requirement.requirementKey}`)!
    const processed = rows.find(r => r.status === 'accepted' && r.artifactKey === `avg.voice.processed.${requirement.requirementKey}`)
    if (!raw) throw new Error(details.build!.failureJson)
    const target = { ...s, requirementKey: requirement.requirementKey, rawVersion: raw.version, rawContentHash: raw.contentHash,
      ...(processed ? { processed: { version: processed.version, contentHash: processed.contentHash } } : {}) }
    const selected = await readAvgVoiceCandidateV3({ ...target, version: raw.version, contentHash: raw.contentHash })
    const report: AvgReviewIssuesV1 = { schema: 'storyforge.avg.review-issues', version: 1, targetKey: requirement.requirementKey,
      observations: ['audio'], unobserved: [], issues: [], audioEvidence: { audioHash: selected.asset.contentHash,
        requestIdentityHash: selected.payload.request.identityHash,
        audition: { generation: 'audition.controlled-local-repair', outcome: 'ended', durationMs: 500, playedMs: 500, muted: false, volume: 1, playbackRate: 1, seeked: false },
        checks: AVG_VOICE_REVIEW_CRITERIA_V1.map(criterion => ({ criterion, result: 'pass', note: '受控工程观察，非真人审听。' })), note: '独立工程观察，不签实际听感。' } }
    const declaration = '仅确认受控工程候选，原音频和许可限制保留，真人审听和商业品质未知。'
    const review = await stageAvgAudioReviewV3({ ...target, report, declaration })
    await confirmAvgWorkspaceInputV1({ ...s, artifactKey: review.artifactKey, candidateVersion: review.version, candidateHash: JSON.parse(review.metadataJson).candidateHash })
    const choice = await stageAvgVoiceChoiceV3({ ...target, declaration })
    await confirmAvgWorkspaceInputV1({ ...s, artifactKey: choice.artifactKey, candidateVersion: choice.version, candidateHash: JSON.parse(choice.metadataJson).candidateHash })
  }
  await configureAvgChosenVoiceDraftV3({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
}


async function publishVoicePreview(s: VoiceOwner) {
  const build = (await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])).build!
  const environment = { browserName: 'isolated-published-voice-repair', browserVersion: '1',
    platform: 'controlled HTTP/Worker/decoder and transport observations; not native hearing', viewport: { width: 1280, height: 720 } }
  const preview = await startProductProductionPreviewV1(s)
  const command = async () => {
    const state = await readProductRuntimeStateVersion(preview.sessionId)
    return { sessionId: preview.sessionId, baseSequence: state.sequence, baseStateHash: state.stateHash, commandId: crypto.randomUUID() }
  }
  for (const lineKey of ['line.desk', 'line.wait']) {
    const state = await readProductRuntimeState(preview.sessionId), line = avgCurrentReadingLineV1(state)!
    expect(line.beat.beatKey).toBe(lineKey)
    await commitAvgVoiceCommandV1({ ...await command(), type: 'start', lineKey, visit: line.visit })
    const current = (await readProductRuntimeState(preview.sessionId)).avgReading!.current!
    await commitAvgVoiceCommandV1({ ...await command(), type: 'observe', lineKey, visit: line.visit,
      generation: current.generation, outcome: 'ended', reason: 'controlled engineering transport observation; not hearing', playedMs: 500 })
    await reachAvgPresentationBeat({ ...await command(), beatKey: lineKey })
    if (lineKey === 'line.desk') await commitNarrativeChoice({ ...await command(), choiceKey: 'wait' })
  }
  expect((await readProductRuntimeState(preview.sessionId)).narrative!.completed).toBe(true)
  await recordProductBuildMainRoutePlaythroughV1({ scope: s.scope, productBuildId: build.id!, productRuntimeSessionId: preview.sessionId,
    authorConfirmation: 'author-confirmed-main-route', environment })
  const measured = await scanAvgPrototypeMediaV1({ scope: s.scope, buildId: build.id!, expectedPreviewHash: build.previewHash,
    environment, signal: new AbortController().signal })
  expect(measured!.evidence.passed).toBe(true)
  const ready = (await db.productBuilds.get(build.id!))!, quality = JSON.parse(ready.qualityReportJson)
  const brief = parseProductProductionBriefV3((await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])).executionBrief!)
  const passed = new Set(quality.hardGateResults.filter((g: { passed: boolean }) => g.passed).map((g: { gateId: string }) => g.gateId))
  expect(ready.status, JSON.stringify({ buildNumber: ready.buildNumber, playable: quality.playable, mediaCoverage: quality.mediaCoverage,
    failedGates: quality.hardGateResults.filter((g: { passed: boolean }) => !g.passed),
    missingGates: brief.completionContract.requiredGateIds.filter(g => !passed.has(g)) })).toBe('release-ready')
  const adoption = await prepareProductProductionAdoption(s)
  const published = await publishProductProductionBuild({ ...s, command: { type: 'publish',
    commandId: `voice.repair.release.${crypto.randomUUID()}`, expectedStateRevision: adoption.intent.expectedStateRevision,
    buildNumber: adoption.intent.buildNumber, expectedManifestHash: adoption.intent.manifestHash, adoptionIntentHash: adoption.adoptionIntentHash } })
  const record: ProductRelease = (await db.productReleases.get(published.productReleaseId))!
  const manifest = await verifyProductReleaseManifest(record.manifestJson), assets = avgRuntimeStage(manifest.runtimePackage)!.assets
  for (const asset of assets) expect(await hashAvgSoundBytesV1(await readProductReleaseMediaBytes({ scope: s.scope,
    productReleaseId: record.id!, asset }))).toBe(asset.blobContentHash)
  return { record, manifest, assets, build: (await db.productBuilds.get(build.id!))! }
}

describe('AVG actual processed-voice producer with explicitly controlled incomplete capability', () => {
  it('repairs one voice from a published release without another request and publishes a distinct portable release while preserving the old save', async () => {
    const s = await startProcessedVoice(true)
    await adoptCurrentVoices(s); await confirmCurrentInputs(s, ['avg.author.stage'])
    expect((await runAvgAssemblyV1(s)).buildStatus).toBe('preview-ready')
    const original = await publishVoicePreview(s), parent = original.build
    expect(parent.status).toBe('released')
    const oldSave = await createProductRuntimeInstance({ scope: s.scope, kind: 'avg', title: 'ENGINEERING original published voice save',
      productSource: { kind: 'release', productReleaseId: original.record.id! } })
    const oldState = await readProductRuntimeState(oldSave.id!)
    const kept = await keepAvgGeneratedVoiceStageDraftV1({ ...s, expectedBuildId: parent.id!, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
    const before = parseAvgAuthorWorkspaceV1(kept.editorJson)
    const other = before.presentation.inheritedVoices!.find(v => v.source.requirementKey === 'keeper.other')!
    const otherAsset = before.presentation.stage.assets.find(a => a.assetKey === other.assetKey)!
    const selected = before.presentation.inheritedVoices!.find(v => v.source.requirementKey === 'keeper.line')!
    useAIConfigStore.getState().setConfig({ ...config, apiKey: '', baseUrl: 'https://unused.fixture.invalid/v1' })
    const saved = await saveAvgVoiceLocalRepairDraftV2({ ...s, expectedDraftRevision: kept.revision,
      expectedBuildId: parent.id!, expectedBuildRevision: parent.stateRevision, expectedPreviewHash: parent.previewHash,
      assetKey: selected.assetKey, recipe: { ...s.processing.entries[0].recipe, gainMilliDb: -3000,
        declaration: 'ENGINEERING repair exactly one published voice locally; retain original release, other line, save and source rights.' } })
    expect(await db.productReleases.get(original.record.id!)).toEqual(original.record)
    expect(await readProductRuntimeState(oldSave.id!)).toEqual(oldState)
    const prepared = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: saved.revision })
    const brief = parseProductProductionBriefV3(prepared.brief!.briefJson)
    expect(brief.capabilityRequirements).toHaveLength(1)
    expect(brief.capabilityRequirements[0]).toMatchObject({ requirementKey: 'avg.media.voice', mediaClass: 'voice', operation: 'speech',
      capabilityHash: s.details.executionBrief!.capabilityRequirements[0].capabilityHash })
    expect(parseAvgStoredAssemblyBriefV3(brief.avgAssembly).assembly.voice.recovery!.rerunRequirementKeys).toEqual([])
    expect(brief.productionBudget).toMatchObject({ maximumModelCalls: 0, maximumMediaCalls: 0, maximumCostUsd: null })
    const started = await startAvgAssemblyV1({ ...s, expectedBriefHash: prepared.brief!.briefHash })
    const tasks = JSON.parse(started.build!.planJson).tasks as Array<{ kind: string;
      budgetReservation: { modelCalls: number; mediaCalls: number; maximumCostUsd: number | null } }>
    expect(tasks.every(t => t.budgetReservation.modelCalls === 0 && t.budgetReservation.mediaCalls === 0
      && t.budgetReservation.maximumCostUsd === 0)).toBe(true)
    expect(tasks.filter(t => t.kind === 'avg-media-voice-generate')).toHaveLength(0)
    expect(tasks.filter(t => t.kind === 'avg-media-voice-reuse')).toHaveLength(1)
    expect(tasks.filter(t => t.kind === 'avg-audio-process')).toHaveLength(1)
    await confirmCurrentInputs(s, ['avg.system.plan', ...before.scripts.map(script => `avg.content.scene-script.${script.sceneKey}`)])
    await runAvgAssemblyV1(s); await adoptCurrentVoices(s)
    const configured = parseAvgAuthorWorkspaceV1((await readAvgDraftV1(s.scope)).editorJson)
    expect(configured.presentation.stage.assets.find(a => a.assetKey === other.assetKey)).toEqual(otherAsset)
    expect(configured.presentation.reading).toEqual(before.presentation.reading)
    expect(configured.presentation.stage.assets.find(a => a.assetKey === selected.assetKey)!.contentHash)
      .not.toBe(before.presentation.stage.assets.find(a => a.assetKey === selected.assetKey)!.contentHash)
    await confirmCurrentInputs(s, ['avg.author.stage'])
    expect((await runAvgAssemblyV1(s)).buildStatus).toBe('preview-ready')
    expect(await db.productReleases.count()).toBe(1)
    const repaired = await publishVoicePreview(s)
    expect(repaired.record.id).not.toBe(original.record.id)
    expect(repaired.manifest.lineage.releaseUid).not.toBe(original.manifest.lineage.releaseUid)
    expect(repaired.manifest.releaseIdentityHash).not.toBe(original.manifest.releaseIdentityHash)
    expect(repaired.manifest.lineage.parentRelease).toEqual({ releaseUid: original.manifest.lineage.releaseUid,
      releaseHash: original.manifest.lineage.releaseHash })
    expect(await db.productReleases.get(original.record.id!)).toEqual(original.record)
    expect(await readProductRuntimeState(oldSave.id!)).toEqual(oldState)
    for (const asset of original.assets) expect(await hashAvgSoundBytesV1(await readProductReleaseMediaBytes({ scope: s.scope,
      productReleaseId: original.record.id!, asset }))).toBe(asset.blobContentHash)
    expect(s.fetcher).toHaveBeenCalledTimes(2)
    vi.mocked(readiness.avgAudioProcessingExecutionReadyV1).mockReturnValue(false)
    vi.mocked(gates.avgVoiceProductionEnabledV3).mockReturnValue(false)
    const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const restoredReleases: ProductRelease[] = await db.productReleases.where('projectId').equals(projectId).toArray()
    expect(restoredReleases).toHaveLength(2)
    for (const source of [original, repaired]) {
      const restored = restoredReleases.find(r => r.contentHash === source.record.contentHash)!
      expect(restored).toBeDefined()
      const scope = { projectId, worldId: restored.worldId, workId: restored.workId }
      expect(restored.version).toBe(source.record.version)
      const manifest = await verifyProductReleaseManifest(restored.manifestJson)
      expect(manifest.releaseIdentityHash).toBe(source.manifest.releaseIdentityHash)
      for (const asset of avgRuntimeStage(manifest.runtimePackage)!.assets) expect(await hashAvgSoundBytesV1(await readProductReleaseMediaBytes({
        scope, productReleaseId: restored.id!, asset }))).toBe(asset.blobContentHash)
    }
    await deleteWork(restoredReleases[0].workId)
    expect(await db.productReleases.get(original.record.id!)).toEqual(original.record)
    expect(await db.productReleases.get(repaired.record.id!)).toEqual(repaired.record)
    expect(await readProductRuntimeState(oldSave.id!)).toEqual(oldState)
    expect(s.fetcher).toHaveBeenCalledTimes(2)
  }, 60_000)
  it('preserves a pending completed-version repair across full remapping with processing closed, without acquiring start permission', async () => {
    const s = await startProcessedVoice()
    await adoptCurrentVoices(s); await confirmCurrentInputs(s, ['avg.author.stage'])
    expect((await runAvgAssemblyV1(s)).buildStatus).toBe('preview-ready')
    const parent = (await db.productBuilds.get(s.buildId))!
    const kept = await keepAvgGeneratedVoiceStageDraftV1({ ...s, expectedBuildId: parent.id!, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
    const saved = await saveAvgVoiceLocalRepairDraftV2({ scope: s.scope, expectedDraftRevision: kept.revision, expectedBuildId: parent.id!,
      expectedBuildRevision: parent.stateRevision, expectedPreviewHash: parent.previewHash, assetKey: 'voice.desk',
      recipe: { ...s.processing.entries[0].recipe, gainMilliDb: -2000, declaration: '本地待开始返修，导入后仍须明确准备并开始，不继承旧调用权限。' } })
    const proposed = parseAvgAuthorWorkspaceV1(saved.editorJson)
    vi.mocked(readiness.avgAudioProcessingExecutionReadyV1).mockReturnValue(false)
    vi.mocked(gates.avgVoiceProductionEnabledV3).mockReturnValue(false)
    useAIConfigStore.getState().setConfig({ ...config, apiKey: '' })
    const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const build = (await db.productBuilds.where('projectId').equals(projectId).first())!
    const scope = { projectId, workId: build.workId, worldId: build.worldId }, draft = await readAvgDraftV1(scope)
    const imported = parseAvgAuthorWorkspaceV1(draft.editorJson)
    expect(imported.voiceLocalRepair).toEqual(proposed.voiceLocalRepair)
    expect(imported.voiceProduction).toEqual(proposed.voiceProduction)
    expect(imported.presentation).toEqual(proposed.presentation)
    const count = await db.productBuilds.count()
    await expect(prepareAvgAssemblyBriefV1({ scope, expectedDraftRevision: draft.revision })).rejects.toThrow(/尚未开放/)
    expect(await db.productBuilds.count()).toBe(count)
    const cleared = await clearAvgVoiceLocalRepairDraftV2({ scope, expectedDraftRevision: draft.revision })
    expect(parseAvgAuthorWorkspaceV1(cleared.editorJson)).not.toHaveProperty('voiceLocalRepair')
    expect(parseAvgAuthorWorkspaceV1(cleared.editorJson).presentation).toEqual(proposed.presentation)
    expect((await readAvgDraftV1(s.scope)).editorJson).toBe(saved.editorJson)
    await deleteWork(scope.workId)
    expect(await db.productBuilds.get(s.buildId)).toEqual(parent)
    expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)
  it('repairs one adopted frozen voice from an older producer, leaves the other line intact, and restores all generations without another speech request', async () => {
    const s = await startProcessedVoice(true)
    await adoptCurrentVoices(s); await confirmCurrentInputs(s, ['avg.author.stage'])
    expect((await runAvgAssemblyV1(s)).buildStatus).toBe('preview-ready')
    const first = (await db.productBuilds.get(s.buildId))!
    const draft = await readAvgDraftV1(s.scope), initial = parseAvgAuthorWorkspaceV1(draft.editorJson)
    initial.basePreviewHash = first.previewHash
    await saveAvgAuthorWorkspaceV1(s.scope, draft.revision, initial)
    const kept = await keepAvgGeneratedVoiceStageDraftV1({ ...s, expectedBuildId: s.buildId, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
    const next = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: kept.revision })
    await startAvgAssemblyV1({ ...s, expectedBriefHash: next.brief!.briefHash })
    await confirmCurrentInputs(s, ['avg.system.plan', ...initial.scripts.map(script => `avg.content.scene-script.${script.sceneKey}`), 'avg.author.stage'])
    expect((await runAvgAssemblyV1(s)).buildStatus).toBe('preview-ready')
    const parent = (await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])).build!
    const beforeDraft = await readAvgDraftV1(s.scope), before = parseAvgAuthorWorkspaceV1(beforeDraft.editorJson)
    const selected = before.presentation.inheritedVoices!.find(v => v.source.requirementKey === 'keeper.line')!
    const other = before.presentation.inheritedVoices!.find(v => v.source.requirementKey === 'keeper.other')!
    const otherAsset = before.presentation.stage.assets.find(a => a.assetKey === other.assetKey)!
    const reading = structuredClone(before.presentation.reading), recipe = { ...s.processing.entries[0].recipe, gainMilliDb: -3000,
      declaration: '基于当前已确认预览，只从保留原音频把第一句调至负三分贝，其他句不重做。' }
    useAIConfigStore.getState().setConfig({ ...config, apiKey: '', baseUrl: 'https://unused.fixture.invalid/v1' })
    const request = { ...s, expectedDraftRevision: beforeDraft.revision, expectedBuildId: parent.id!, expectedBuildRevision: parent.stateRevision,
      expectedPreviewHash: parent.previewHash, assetKey: selected.assetKey, recipe }
    await expect(saveAvgVoiceLocalRepairDraftV2({ ...request, expectedPreviewHash: '0'.repeat(64) })).rejects.toThrow(/预览/)
    const count = await db.productBuilds.count(), blobs = await db.mediaBlobObjects.count()
    const saved = await saveAvgVoiceLocalRepairDraftV2(request), proposed = parseAvgAuthorWorkspaceV1(saved.editorJson)
    expect(proposed.presentation).toEqual(before.presentation)
    expect(proposed.voiceLocalRepair!.sourceBuildNumber).toBe(first.buildNumber)
    expect(proposed.voiceLocalRepair!.parentBuildNumber).toBe(parent.buildNumber)
    const voice = readAvgVoiceDraftV1(proposed.voiceProduction).voice
    expect(voice.batch.requirements.map(r => r.requirementKey)).toEqual(['keeper.line'])
    expect(() => parseAvgVoiceRecoveryV1(proposed.voiceLocalRepair, voice.batch)).toThrow()
    const forged = structuredClone(proposed.voiceLocalRepair!); forged.adoptedChoice.authorReceiptHash = '0'.repeat(64)
    await expect(assertAvgVoiceLocalRepairSourcesV2({ ...s, voice: { ...voice, recovery: forged } })).rejects.toThrow()
    const parentStage = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([parent.id!, 'avg.author.stage']).filter(r => r.status === 'accepted').first())!
    await db.productBuildArtifacts.update(parentStage.id!, { payloadJson: '{}' })
    await expect(assertAvgVoiceLocalRepairSourcesV2({ ...s, voice: { ...voice, recovery: proposed.voiceLocalRepair } })).rejects.toThrow()
    await db.productBuildArtifacts.put(parentStage)
    await db.productBuilds.update(parent.id!, { rootTerminalReceiptHash: '' })
    await expect(assertAvgVoiceLocalRepairSourcesV2({ ...s, voice: { ...voice, recovery: proposed.voiceLocalRepair } })).rejects.toThrow()
    await db.productBuilds.put(parent)
    expect(await db.productBuilds.count()).toBe(count); expect(await db.mediaBlobObjects.count()).toBe(blobs)
    const cleared = await clearAvgVoiceLocalRepairDraftV2({ scope: s.scope, expectedDraftRevision: saved.revision })
    expect(parseAvgAuthorWorkspaceV1(cleared.editorJson).presentation).toEqual(before.presentation)
    expect(parseAvgAuthorWorkspaceV1(cleared.editorJson)).not.toHaveProperty('voiceLocalRepair')
    const again = await saveAvgVoiceLocalRepairDraftV2({ ...request, expectedDraftRevision: cleared.revision })
    const prepared = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: again.revision })
    const brief = parseProductProductionBriefV3(prepared.brief!.briefJson)
    expect(brief.productionBudget.maximumMediaCalls).toBe(0); expect(brief.productionBudget.maximumModelCalls).toBe(0)
    const started = await startAvgAssemblyV1({ ...s, expectedBriefHash: prepared.brief!.briefHash }), childId = started.build!.id!
    const tasks = JSON.parse(started.build!.planJson).tasks as Array<{ kind: string }>
    expect(tasks.filter(t => t.kind === 'avg-media-voice-generate')).toHaveLength(0)
    expect(tasks.filter(t => t.kind === 'avg-media-voice-reuse')).toHaveLength(1)
    expect(tasks.filter(t => t.kind === 'avg-audio-process')).toHaveLength(1)
    await expect(clearAvgVoiceLocalRepairDraftV2({ scope: s.scope, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })).rejects.toThrow(/已开始/)
    await confirmCurrentInputs(s, ['avg.system.plan', ...initial.scripts.map(script => `avg.content.scene-script.${script.sceneKey}`)])
    await runAvgAssemblyV1(s)
    const produced = await db.productBuildArtifacts.where('buildId').equals(childId).toArray()
    const raw = produced.find(r => r.status === 'accepted' && r.artifactKey === 'avg.voice.raw.keeper.line')!
    const processed = produced.find(r => r.status === 'accepted' && r.artifactKey === 'avg.voice.processed.keeper.line')!
    if (!raw || !processed) throw new Error((await db.productBuilds.get(childId))!.failureJson)
    expect(raw.contentHash).toBe(s.audio.asset.contentHash)
    await assertAvgAudioProcessingWaveBytesV1({ source: await readMediaBlobObjectData({ scope: s.scope, blobObjectId: raw.blobObjectId! }),
      output: await readMediaBlobObjectData({ scope: s.scope, blobObjectId: processed.blobObjectId! }), recipe,
      receipt: (await parseAvgProcessedAudioPayloadV1(processed.payloadJson)).receipt })
    await adoptCurrentVoices(s)
    const configured = parseAvgAuthorWorkspaceV1((await readAvgDraftV1(s.scope)).editorJson)
    expect(configured.presentation.stage.assets.find(a => a.assetKey === other.assetKey)).toEqual(otherAsset)
    expect(configured.presentation.inheritedVoices).toEqual([other])
    expect(configured.presentation.reading).toEqual(reading)
    expect(configured.presentation.stage.assets.find(a => a.assetKey === selected.assetKey)!.contentHash)
      .not.toBe(before.presentation.stage.assets.find(a => a.assetKey === selected.assetKey)!.contentHash)
    await confirmCurrentInputs(s, ['avg.author.stage'])
    expect((await runAvgAssemblyV1(s)).buildStatus).toBe('preview-ready')
    const child = (await db.productBuilds.get(childId))!, preview = await verifyStoredProductBuildPreview(child)
    await expect(clearAvgVoiceLocalRepairDraftV2({ scope: s.scope, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })).rejects.toThrow(/已配置/)
    const completed = await keepAvgGeneratedVoiceStageDraftV1({ ...s, expectedBuildId: childId, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
    expect(parseAvgAuthorWorkspaceV1(completed.editorJson)).not.toHaveProperty('voiceLocalRepair')
    expect(s.fetcher).toHaveBeenCalledTimes(2)
    vi.mocked(readiness.avgAudioProcessingExecutionReadyV1).mockReturnValue(false)
    vi.mocked(gates.avgVoiceProductionEnabledV3).mockReturnValue(false)
    const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const restoredBuild = (await db.productBuilds.where('projectId').equals(projectId).filter(b => b.buildNumber === child.buildNumber).first())!
    const scope = { projectId, workId: restoredBuild.workId, worldId: restoredBuild.worldId }
    const input = { scope, buildId: restoredBuild.id!, expectedBuildRevision: restoredBuild.stateRevision, controlEpoch: restoredBuild.controlEpoch }
    const restored = await verifyFrozenAvgAuthorInputsV1(input)
    expect(restored.authorStage!.payload.inheritedVoices).toEqual([other])
    expect(restored.voiceChoices![0].payload.asset).toEqual(configured.presentation.stage.assets.find(a => a.assetKey === selected.assetKey))
    expect((await verifyStoredProductBuildPreview(restoredBuild))!.packageHash).toBe(preview!.packageHash)
    const blob = (await db.mediaBlobObjects.get(restored.voiceChoices![0].blobObjectId))!, bytes = new Uint8Array(blob.data!.slice(0))
    bytes[bytes.length - 1] ^= 1; await db.mediaBlobObjects.update(blob.id!, { data: bytes.buffer })
    await expect(verifyFrozenAvgAuthorInputsV1(input)).rejects.toThrow()
    await db.mediaBlobObjects.put(blob); await deleteWork(scope.workId)
    expect(await db.productBuilds.get(childId)).toEqual(child)
    expect(s.fetcher).toHaveBeenCalledTimes(2)
    // Hosted V8 coverage exhausted the old 30s whole cross-version repair/restore budget.
    // Keep local feedback and all production/transport limits unchanged.
  }, process.env.CI ? 120_000 : 30_000)
  it('repairs a stopped batch from explicitly retained raw audio with a changed gain and zero new provider requests', async () => {
    const s = await startProcessedVoice(), before = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    const originalRows = await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()
    const originalRaw = originalRows.find(r => r.artifactKey === 'avg.voice.raw.keeper.line' && r.status === 'accepted')!
    const originalProcessed = originalRows.find(r => r.artifactKey === 'avg.voice.processed.keeper.line' && r.status === 'accepted')!
    expect(originalRaw).toBeDefined(); expect(originalProcessed).toBeDefined()
    await stopProductProductionV1({ scope: s.scope, production: before.production })
    const stopped = (await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])).build!
    const plan = structuredClone(s.processing); plan.entries[0].recipe.gainMilliDb = -3000
    plan.entries[0].recipe.declaration = '保留已生成的原音频，只把本地音量改为降低三分贝，另行试听采用。'
    const saved = await saveAvgVoiceProcessingDraftV1({ scope: s.scope, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision, plan })
    const proposal = await prepareAvgVoiceRecoveryBriefV1({ ...s, expectedDraftRevision: saved.revision,
      expectedBuildId: stopped.id!, expectedBuildRevision: stopped.stateRevision, retainedRequirementKeys: ['keeper.line'],
      declaration: '明确保留全部原音频，本次不重录，只重新进行本地音量加工及独立审听采用。' })
    const brief = parseProductProductionBriefV3(proposal.brief!.briefJson)
    expect(brief.productionBudget.maximumMediaCalls).toBe(0); expect(brief.productionBudget.maximumModelCalls).toBe(0)
    expect(brief.avgAudioProcessing).toEqual(plan)
    const started = await startAvgAssemblyV1({ ...s, expectedBriefHash: proposal.brief!.briefHash })
    const childId = started.build!.id!
    for (const artifactKey of ['avg.system.plan', ...parseAvgAuthorWorkspaceV1(saved.editorJson).scripts.map(script => `avg.content.scene-script.${script.sceneKey}`)]) {
      const candidate = await stageAvgWorkspaceInputV1({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision,
        artifactKey, declaration: '确认沿用原始工程文本与规则，本轮只返修音量。' })
      await confirmAvgWorkspaceInputV1({ ...s, artifactKey: candidate.artifactKey, candidateVersion: candidate.version,
        candidateHash: JSON.parse(candidate.metadataJson).candidateHash })
    }
    await runAvgAssemblyV1(s)
    const rows = await db.productBuildArtifacts.where('buildId').equals(childId).toArray()
    const raw = rows.find(r => r.artifactKey === originalRaw.artifactKey && r.status === 'accepted')!
    const processed = rows.find(r => r.artifactKey === originalProcessed.artifactKey && r.status === 'accepted')!
    if (!raw || !processed) throw new Error((await db.productBuilds.get(childId))!.failureJson)
    expect(raw.contentHash).toBe(originalRaw.contentHash)
    expect(processed.contentHash).not.toBe(originalProcessed.contentHash)
    const source = await readMediaBlobObjectData({ scope: s.scope, blobObjectId: raw.blobObjectId! })
    const output = await readMediaBlobObjectData({ scope: s.scope, blobObjectId: processed.blobObjectId! })
    await assertAvgAudioProcessingWaveBytesV1({ source, output, recipe: plan.entries[0].recipe,
      receipt: (await parseAvgProcessedAudioPayloadV1(processed.payloadJson)).receipt })
    expect(rows.filter(r => r.status === 'accepted' && r.artifactKey.startsWith('avg.voice.choice.'))).toHaveLength(0)
    expect((await db.productBuildArtifacts.get(originalRaw.id!))!.payloadJson).toBe(originalRaw.payloadJson)
    expect((await db.productBuildArtifacts.get(originalProcessed.id!))!.payloadJson).toBe(originalProcessed.payloadJson)
    expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)
  it('requires independent derived review before real author adoption and exact-line configuration', async () => {
    const s = await startProcessedVoice()
    const rows = await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()
    const raw = rows.find(r => r.artifactKey === 'avg.voice.raw.keeper.line' && r.status === 'accepted')!
    const processed = rows.find(r => r.artifactKey === 'avg.voice.processed.keeper.line' && r.status === 'accepted')!
    if (!raw || !processed) throw new Error((await db.productBuilds.get(s.buildId))!.failureJson)
    const target = { scope: s.scope, productionId: s.productionId, requirementKey: 'keeper.line',
      rawVersion: raw.version, rawContentHash: raw.contentHash,
      processed: { version: processed.version, contentHash: processed.contentHash } }
    const evidence = async () => JSON.stringify(await Promise.all([db.productBuilds.toArray(), db.productBuildArtifacts.toArray(),
      db.agentRuns.toArray(), db.agentRunEvents.toArray(), db.mediaBlobObjects.toArray()]))
    const beforeComparison = await evidence()
    const comparison = await readAvgRawVoiceCandidateV3({ ...target, version: raw.version, contentHash: raw.contentHash })
    expect(comparison.asset.contentHash).toBe(raw.contentHash)
    expect(new Uint8Array(comparison.data)).toEqual(new Uint8Array(s.audio.data))
    expect(await evidence()).toBe(beforeComparison)
    await expect(readAvgRawVoiceCandidateV3({ ...target, version: raw.version, contentHash: 'f'.repeat(64) })).rejects.toThrow()
    await expect(readAvgRawVoiceCandidateV3({ ...target, scope: { ...s.scope, workId: s.scope.workId! + 1000 },
      version: raw.version, contentHash: raw.contentHash })).rejects.toThrow()
    expect(await evidence()).toBe(beforeComparison)
    await expect(readAvgVoiceCandidateV3({ ...target, version: raw.version, contentHash: raw.contentHash, processed: undefined })).rejects.toThrow(/加工版本/)
    const selected = await readAvgVoiceCandidateV3({ ...target, version: raw.version, contentHash: raw.contentHash })
    expect(new Uint8Array(selected.data)).not.toEqual(new Uint8Array(s.audio.data))
    expect(selected.asset.contentHash).toBe(processed.contentHash)
    expect(selected.processedMeasurement?.contentHash).toBe(processed.contentHash)
    expect(selected.processedMeasurement?.sourceSampleRateHz).toBe(selected.processing!.receipt.output.sampleRateHz)
    expect(selected.processedMeasurement?.integratedLufs).toEqual(expect.any(Number))
    const report: AvgReviewIssuesV1 = { schema: 'storyforge.avg.review-issues', version: 1, targetKey: target.requirementKey,
      observations: ['audio'], unobserved: [], issues: [], audioEvidence: {
        audioHash: raw.contentHash, requestIdentityHash: selected.payload.request.identityHash,
        audition: { generation: 'audition.controlled-derived-observation', outcome: 'ended', durationMs: 500, playedMs: 500,
          muted: false, volume: 1, playbackRate: 1, seeked: false },
        checks: AVG_VOICE_REVIEW_CRITERIA_V1.map(criterion => ({ criterion, result: 'pass', note: '受控工程观察，非真人审听。' })),
        note: '控制原生观察输入验证采用边界，非真实听感或商业验收。' } }
    const declaration = '明确采用工程加工候选；原许可限制与实际人声审听结论仍未知。'
    await expect(stageAvgAudioReviewV3({ ...target, report, declaration })).rejects.toThrow(/准确音频/)
    expect(await db.productBuildArtifacts.where('buildId').equals(s.buildId).filter(r => r.artifactKey === 'avg.review.audio.keeper.line').count()).toBe(0)
    report.audioEvidence!.audioHash = processed.contentHash
    const review = await stageAvgAudioReviewV3({ ...target, report, declaration })
    await confirmAvgWorkspaceInputV1({ ...s, artifactKey: review.artifactKey, candidateVersion: review.version,
      candidateHash: JSON.parse(review.metadataJson).candidateHash })
    const choice = await stageAvgVoiceChoiceV3({ ...target, declaration })
    const payload = JSON.parse(choice.payloadJson), candidate = JSON.parse(choice.metadataJson)
    expect(payload.version).toBe(2); expect(candidate.version).toBe(10)
    expect(candidate.inputs.map((r: { artifactKey: string }) => r.artifactKey)).toEqual([
      raw.artifactKey, review.artifactKey, processed.artifactKey,
    ])
    expect(payload.raw.contentHash).toBe(raw.contentHash)
    expect(payload.processed.contentHash).toBe(processed.contentHash)
    await confirmAvgWorkspaceInputV1({ ...s, artifactKey: choice.artifactKey, candidateVersion: choice.version, candidateHash: candidate.candidateHash })
    const draft = await readAvgDraftV1(s.scope)
    await configureAvgChosenVoiceDraftV3({ ...s, expectedDraftRevision: draft.revision })
    const workspace = parseAvgAuthorWorkspaceV1((await readAvgDraftV1(s.scope)).editorJson)
    expect(workspace.presentation.stage.assets.find(a => a.assetKey === payload.asset.assetKey)).toEqual(payload.asset)
    expect(workspace.presentation.reading!.voices).toHaveLength(1)
    expect(workspace.presentation.stage.cues.some(c => c.assetKey === payload.asset.assetKey)).toBe(false)
    expect(s.fetcher).toHaveBeenCalledOnce(); expect(await db.productReleases.count()).toBe(0)
    expect((await db.productBuildArtifacts.get(raw.id!))!.contentHash).toBe(raw.contentHash)
    const stage = await stageAvgWorkspaceInputV1({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision,
      artifactKey: 'avg.author.stage', declaration })
    await confirmAvgWorkspaceInputV1({ ...s, artifactKey: stage.artifactKey, candidateVersion: stage.version,
      candidateHash: JSON.parse(stage.metadataJson).candidateHash })
    expect((await runAvgAssemblyV1(s)).buildStatus).toBe('preview-ready')
    const readyBuild = (await db.productBuilds.get(s.buildId))!, preview = await verifyStoredProductBuildPreview(readyBuild)
    // The same exact adopted processed clip remains readable after freezing.
    // This read must not reopen production or silently return the raw clip.
    const frozenClip = await readAvgVoiceCandidateV3({ ...target, version: raw.version, contentHash: raw.contentHash })
    expect(frozenClip.asset).toEqual(selected.asset)
    expect(new Uint8Array(frozenClip.data)).toEqual(new Uint8Array(selected.data))
    await expect(readAvgVoiceCandidateV3({ ...target, version: raw.version, contentHash: raw.contentHash,
      processed: { ...target.processed, contentHash: '0'.repeat(64) } })).rejects.toThrow()
    expect(await db.productBuilds.get(s.buildId)).toEqual(readyBuild)
    expect((await db.productBuildArtifacts.get(raw.id!))!.payloadJson).toBe(raw.payloadJson)
    expect((await db.productBuildArtifacts.get(processed.id!))!.payloadJson).toBe(processed.payloadJson)
    expect(s.fetcher).toHaveBeenCalledOnce()
    // The author explicitly chooses the displayed preview as the next edit's
    // baseline, through the same ordinary saved draft as the workbench button.
    const readyDraft = await readAvgDraftV1(s.scope), revisionWorkspace = parseAvgAuthorWorkspaceV1(readyDraft.editorJson)
    revisionWorkspace.basePreviewHash = readyBuild.previewHash
    await saveAvgAuthorWorkspaceV1(s.scope, readyDraft.revision, revisionWorkspace)
    const kept = await keepAvgGeneratedVoiceStageDraftV1({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision,
      expectedBuildId: s.buildId })
    const inheritedWorkspace = parseAvgAuthorWorkspaceV1(kept.editorJson), inherited = inheritedWorkspace.presentation.inheritedVoices![0]!
    expect(inheritedWorkspace).not.toHaveProperty('voiceProduction'); expect(inheritedWorkspace).not.toHaveProperty('voiceProcessing')
    expect(inherited.source.version).toBe(2)
    if (inherited.source.version !== 2) throw new Error('Expected distinct processed inheritance source')
    expect(inherited.source.raw.contentHash).toBe(raw.contentHash)
    expect(inherited.source.processing.contentHash).toBe(processed.contentHash)
    expect(inherited.source.processing.noProviderRequest).toBe(true)
    const forged = structuredClone(inherited.source); forged.processing.producerReceiptHash = '0'.repeat(64)
    await expect(readAvgAdoptedGeneratedVoice({ scope: s.scope, source: forged })).rejects.toThrow()
    const childBrief = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: kept.revision })
    const childDeclaration = parseProductProductionBriefV3(childBrief.brief!.briefJson)
    expect(childDeclaration.productionBudget.maximumMediaCalls).toBe(0)
    expect(childDeclaration.productionBudget.maximumModelCalls).toBe(0)
    expect(childDeclaration).not.toHaveProperty('avgAudioProcessing')
    const childStart = await startAvgAssemblyV1({ ...s, expectedBriefHash: childBrief.brief!.briefHash })
    const childId = childStart.build!.id!
    for (const artifactKey of ['avg.system.plan', ...inheritedWorkspace.scripts.map(script => `avg.content.scene-script.${script.sceneKey}`), 'avg.author.stage']) {
      const candidate = await stageAvgWorkspaceInputV1({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision, artifactKey, declaration })
      await confirmAvgWorkspaceInputV1({ ...s, artifactKey: candidate.artifactKey, candidateVersion: candidate.version,
        candidateHash: JSON.parse(candidate.metadataJson).candidateHash })
    }
    expect((await runAvgAssemblyV1(s)).buildStatus).toBe('preview-ready')
    const childBuild = (await db.productBuilds.get(childId))!, childPreview = await verifyStoredProductBuildPreview(childBuild)
    const originalBuild = (await db.productBuilds.get(s.buildId))!
    expect(s.fetcher).toHaveBeenCalledOnce()
    vi.mocked(readiness.avgAudioProcessingExecutionReadyV1).mockReturnValue(false)
    vi.mocked(gates.avgVoiceProductionEnabledV3).mockReturnValue(false)
    useAIConfigStore.getState().setConfig({ ...config, apiKey: '' })
    const frozenInput = { scope: s.scope, buildId: s.buildId, expectedBuildRevision: originalBuild.stateRevision, controlEpoch: originalBuild.controlEpoch }
    const original = await verifyFrozenAvgAuthorInputsV1(frozenInput)
    expect(original.voiceChoices![0]!.payload).toEqual(payload)
    expect(original.voiceChoices![0]!.processed!.contentHash).toBe(processed.contentHash)
    const childFrozenInput = { scope: s.scope, buildId: childId, expectedBuildRevision: childBuild.stateRevision, controlEpoch: childBuild.controlEpoch }
    expect((await verifyFrozenAvgAuthorInputsV1(childFrozenInput)).authorStage!.payload.inheritedVoices![0]).toEqual(inherited)
    const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const importedBuild = (await db.productBuilds.where('projectId').equals(projectId).first())!
    const importedScope = { projectId, worldId: importedBuild.worldId, workId: importedBuild.workId }
    const importedInput = { scope: importedScope, buildId: importedBuild.id!, expectedBuildRevision: importedBuild.stateRevision, controlEpoch: importedBuild.controlEpoch }
    const restored = await verifyFrozenAvgAuthorInputsV1(importedInput)
    const imported = restored.voiceChoices![0]!
    expect(imported.payload).toEqual(payload)
    expect(imported.validation).toEqual(original.voiceChoices![0]!.validation)
    expect(imported.blobObjectId).not.toBe(processed.blobObjectId)
    expect(new Uint8Array(await readMediaBlobObjectData({ scope: importedScope, blobObjectId: imported.blobObjectId }))).toEqual(new Uint8Array(selected.data))
    expect((await verifyStoredProductBuildPreview(importedBuild))!.packageHash).toBe(preview!.packageHash)
    const importedChild = (await db.productBuilds.where('[productionId+buildNumber]').equals([importedBuild.productionId, childBuild.buildNumber]).first())!
    const importedChildInput = { scope: importedScope, buildId: importedChild.id!, expectedBuildRevision: importedChild.stateRevision, controlEpoch: importedChild.controlEpoch }
    expect((await verifyFrozenAvgAuthorInputsV1(importedChildInput)).authorStage!.payload.inheritedVoices![0]).toEqual(inherited)
    expect((await verifyStoredProductBuildPreview(importedChild))!.packageHash).toBe(childPreview!.packageHash)
    const count = await db.productBuildArtifacts.count()
    await expect(stageAvgVoiceChoiceV3({ ...target, scope: importedScope, productionId: importedBuild.productionId, declaration })).rejects.toThrow()
    expect(await db.productBuildArtifacts.count()).toBe(count)
    const blob = (await db.mediaBlobObjects.get(imported.blobObjectId))!, corrupt = new Uint8Array(blob.data!.slice(0))
    corrupt[corrupt.length - 1] ^= 1
    await db.mediaBlobObjects.update(blob.id!, { data: corrupt.buffer })
    await expect(verifyFrozenAvgAuthorInputsV1(importedInput)).rejects.toThrow()
    await expect(verifyFrozenAvgAuthorInputsV1(importedChildInput)).rejects.toThrow()
    await db.mediaBlobObjects.put(blob)
    await deleteWork(importedScope.workId)
    expect(await db.productBuildArtifacts.where('workId').equals(importedScope.workId).count()).toBe(0)
    expect(await db.mediaBlobObjects.where('workId').equals(importedScope.workId).count()).toBe(0)
    expect(await db.productBuilds.get(s.buildId)).toEqual(originalBuild)
    expect(await db.productBuilds.get(childId)).toEqual(childBuild)
    expect(new Uint8Array(await readMediaBlobObjectData({ scope: s.scope, blobObjectId: processed.blobObjectId! }))).toEqual(new Uint8Array(selected.data))
    expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)
  it('seals the exact zero-request local result and stops before independent derived audition/adoption', async () => {
    const s = await startProcessedVoice()
    const rows = await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()
    const raw = rows.find(r => r.artifactKey === 'avg.voice.raw.keeper.line' && r.status === 'accepted')
    const processed = rows.find(r => r.artifactKey === 'avg.voice.processed.keeper.line' && r.status === 'accepted')
    if (!raw || !processed) throw new Error((await db.productBuilds.get(s.buildId))!.failureJson)
    const payload = await parseAvgProcessedAudioPayloadV1(processed.payloadJson)
    const verified = await verifyAcceptedProductBuildArtifactV1({ scope: s.scope, buildId: s.buildId,
      artifactKey: processed.artifactKey, version: processed.version, contentHash: processed.contentHash })
    expect(verified.producerRunId).toBeGreaterThan(0); expect(verified.producerReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(verified.producerRunId).not.toBe(raw.producerRunId)
    expect(payload.raw.producerReceiptHash).toBe(raw.producerReceiptHash)
    const [source, output] = await Promise.all([readMediaBlobObjectData({ scope: s.scope, blobObjectId: raw.blobObjectId! }),
      readMediaBlobObjectData({ scope: s.scope, blobObjectId: processed.blobObjectId! })])
    expect(new Uint8Array(source)).toEqual(new Uint8Array(s.audio.data))
    await assertAvgAudioProcessingWaveBytesV1({ source, output, recipe: s.processing.entries[0]!.recipe, receipt: payload.receipt })
    const build = (await db.productBuilds.get(s.buildId))!, plan = JSON.parse(build.planJson)
    const task = plan.tasks.find((t: { kind: string }) => t.kind === 'avg-audio-process')
    const run = await readAgentRunV1(s.scope, processed.producerRunId!)
    expect(run.contract.runtimeBindingHash).toBe(await hashAvgTaskRuntimeBindingV1({ planHash: build.planHash, task, capabilityBindings: [] }))
    expect(run.projection.state).toBe('completed')
    expect(JSON.parse(processed.qualityJson)).toMatchObject({ noProviderRequest: true, hearing: 'unobserved', authorAdopted: false })
    expect(s.fetcher).toHaveBeenCalledOnce()
    expect(rows.filter(r => r.status === 'accepted' && (r.artifactKey.startsWith('avg.review.audio.') || r.artifactKey.startsWith('avg.voice.choice.')))).toEqual([])
    expect(build.packageHash).toBe(''); expect(await db.productReleases.count()).toBe(0)
    const count = await db.productBuildArtifacts.count()
    vi.mocked(readiness.avgAudioProcessingExecutionReadyV1).mockReturnValue(false)
    await expect(acceptProductBuildArtifact({ ...processed, scope: s.scope,
      payload: JSON.parse(processed.payloadJson), metadata: JSON.parse(processed.metadataJson),
      quality: JSON.parse(processed.qualityJson), rights: JSON.parse(processed.rightsJson) })).rejects.toThrow(/尚未就绪/)
    expect(await db.productBuildArtifacts.count()).toBe(count); expect(s.fetcher).toHaveBeenCalledOnce()
  })
})
