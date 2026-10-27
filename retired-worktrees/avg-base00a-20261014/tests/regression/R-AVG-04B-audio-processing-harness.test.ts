import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as gates from '../../src/lib/avg/assembly-contract'
import * as readiness from '../../src/lib/avg/audio-production-brief'
import * as mediaVerifier from '../../src/lib/product-production/media-runtime-verifier'
import { prepareNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { avgAuthorWorkspaceFixture } from '../helpers/avg-author-stage-fixture'
import { avgReadingAudioFixture } from '../helpers/avg-reading-fixture'
import { avgVoicePolicyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { verifyAcceptedProductBuildArtifactV1, acceptProductBuildArtifact } from '../../src/lib/product-production/artifact-store'
import { readMediaBlobObjectData } from '../../src/lib/product-production/media-blob-store'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { hashAvgVoiceSourceInputV1 } from '../../src/lib/avg/voice-production-source'
import { hashAvgVoiceTextV1 } from '../../src/lib/avg/voice-production-contract'
import { hashAvgSpeechProtocolV1 } from '../../src/lib/avg/voice-request-contract'
import { configuredAvgVoiceEndpointHashV1 } from '../../src/lib/avg/voice-transport'
import { avgVoiceRouteBindingHashV1, avgVoiceAssemblyGateIdsV3 } from '../../src/lib/avg/voice-assembly-contract'
import { encodeAvgStoredAssemblyBriefV3 } from '../../src/lib/avg/voice-assembly-storage'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { stageAvgWorkspaceInputV1, confirmAvgWorkspaceInputV1, runAvgAssemblyV1, readAvgVoiceCandidateV3,
  stageAvgAudioReviewV3, stageAvgVoiceChoiceV3, configureAvgChosenVoiceDraftV3 } from '../../src/lib/avg/assembly-service'
import { avgVoiceProductionBudgetV3 } from '../../src/lib/avg/voice-production-policy'
import { assertAvgAudioProcessingWaveBytesV1 } from '../../src/lib/avg/audio-processing'
import { parseAvgProcessedAudioPayloadV1 } from '../../src/lib/avg/processed-audio-contract'
import { executeAvgAudioGainWorkerRequestV1, type AvgAudioGainWorkerRequestV1 } from '../../src/lib/avg/audio-gain-worker-protocol'
import { hashAvgTaskRuntimeBindingV1 } from '../../src/lib/avg/task-claim'
import { AVG_VOICE_REVIEW_CRITERIA_V1 } from '../../src/lib/avg/voice-review-contract'
import type { AvgReviewIssuesV1 } from '../../src/lib/avg/artifact-contract'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'

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

async function startProcessedVoice() {
  let phase = 'prepare-assembly'
  try {
  const workspace = avgAuthorWorkspaceFixture()
  workspace.presentation.reading = { schema: 'storyforge.avg.reading-plan', version: 1, manualVoice: 'wait',
    voiceFailure: 'pause', maximumVoiceWaitMs: 30000, autoDelayMs: 800, voices: [] }
  const owner = await prepareNativeAvgAssembly(workspace), base = parseProductProductionBriefV3(owner.details.brief!.briefJson)
  const policy = await avgVoicePolicyFixtureV3(false), assembly = policy.avgAssembly, protocol = assembly.voice.protocol
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
      script: { artifactKey: `avg.content.scene-script.${script.sceneKey}`, version: 1, contentHash: await hashProductProductionValueV2(script) } })
  }
  const processing = readiness.avgAudioProcessingForVoiceV3({ schema: 'storyforge.avg.audio-production-processing-plan', version: 1,
    entries: [{ domain: 'voice', requirementKey: assembly.voice.batch.requirements[0]!.requirementKey, recipe: {
      schema: 'storyforge.avg.audio-processing-recipe', version: 1, gainMilliDb: -6000, maximumDurationMs: 1000,
      sampleRatePolicy: 'preserve', channelPolicy: 'preserve', timelinePolicy: 'preserve', overflowPolicy: 'reject',
      declaration: '明确加工测试原件；原请求、审听、作者选择与正式启用仍独立。' } }] }, assembly)
  policy.productionBudget = readiness.addAvgAudioProcessingBudgetV1(avgVoiceProductionBudgetV3(assembly), processing, 'voice')
  policy.media.voiceLineCount = assembly.voice.batch.requirements.length
  policy.completionContract.requiredGateIds = [...avgVoiceAssemblyGateIdsV3(assembly), ...readiness.avgAudioProcessingGateIdsV1(processing)]
  const brief = parseProductProductionBriefV3({ ...base, ...policy, intent: { ...base.intent, ...policy.intent },
    avgAssembly: await encodeAvgStoredAssemblyBriefV3(assembly), avgAudioProcessing: processing })
  phase = 'save-frozen-processing-brief'
  const saved = await executeProductProductionCommand({ scope: owner.scope, productionId: owner.productionId,
    command: { type: 'save-brief-revision', commandId: 'processed.harness.brief', expectedStateRevision: owner.details.production.stateRevision,
      parentRevision: owner.details.brief!.revision, brief } })
  if (!saved.ok) throw new Error(JSON.stringify(saved))
  const prepared = await readProductProductionDetailsV1(owner.scope, owner.productionId, ['avg'])
  phase = 'authorize-start'
  const started = await executeProductProductionCommand({ scope: owner.scope, productionId: owner.productionId,
    command: { type: 'authorize-start', commandId: 'processed.harness.start', expectedStateRevision: prepared.production.stateRevision,
      briefRevision: prepared.brief!.revision, briefHash: prepared.brief!.briefHash, authorizationNonce: 'processed.harness.explicit-test-start' } })
  if (!started.ok) throw new Error(JSON.stringify(started))
  const details = await readProductProductionDetailsV1(owner.scope, owner.productionId, ['avg'])
  const s = { ...owner, details, buildId: details.build!.id! }, audio = await avgReadingAudioFixture(500)
  const fetcher = vi.fn(async (target: RequestInfo | URL) => {
    if (!String(target).endsWith('/audio/speech')) throw new Error('Unexpected controlled processed-voice route')
    return new Response(audio.data, { headers: { 'Content-Type': 'audio/wav', 'x-request-id': 'processed.harness.response.1' } })
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
    throw new Error('[processed-harness:' + phase + '] ' + String(error) + ' ' + JSON.stringify(rows.map(row => ({
      status: row.status, failure: row.failureJson,
    }))))
  }
}

describe('AVG actual processed-voice producer with explicitly controlled incomplete capability', () => {
  it('requires independent derived review before real author adoption and exact-line configuration', async () => {
    const s = await startProcessedVoice()
    const rows = await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()
    const raw = rows.find(r => r.artifactKey === 'avg.voice.raw.keeper.line' && r.status === 'accepted')!
    const processed = rows.find(r => r.artifactKey === 'avg.voice.processed.keeper.line' && r.status === 'accepted')!
    if (!raw || !processed) throw new Error((await db.productBuilds.get(s.buildId))!.failureJson)
    const target = { scope: s.scope, productionId: s.productionId, requirementKey: 'keeper.line',
      rawVersion: raw.version, rawContentHash: raw.contentHash,
      processed: { version: processed.version, contentHash: processed.contentHash } }
    await expect(readAvgVoiceCandidateV3({ ...target, version: raw.version, contentHash: raw.contentHash, processed: undefined })).rejects.toThrow(/加工版本/)
    const selected = await readAvgVoiceCandidateV3({ ...target, version: raw.version, contentHash: raw.contentHash })
    expect(selected.data).not.toEqual(s.audio.data)
    expect(selected.asset.contentHash).toBe(processed.contentHash)
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
    expect(source).toEqual(s.audio.data)
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
