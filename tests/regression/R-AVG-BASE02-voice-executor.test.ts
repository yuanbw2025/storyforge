import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedAvgAuthorStageInputs } from '../helpers/avg-author-stage-fixture'
import { avgReadingAudioFixture } from '../helpers/avg-reading-fixture'
import { avgVoicePolicyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { readVerifiedMediaBlobObjectData } from '../../src/lib/product-production/media-blob-store'
import * as blobs from '../../src/lib/product-production/media-blob-store'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import { ProductProductionDraftRejectedErrorV1, ProductProductionResultUnknownErrorV1, type ProductProductionTaskExecutionInputV1 } from '../../src/lib/product-production/scheduler'
import { readAvgSystemPlanForCompilationV1 } from '../../src/lib/avg/author-artifacts'
import { hashAvgVoiceSourceInputV1 } from '../../src/lib/avg/voice-production-source'
import { hashAvgVoiceTextV1 } from '../../src/lib/avg/voice-production-contract'
import { hashAvgSpeechProtocolV1 } from '../../src/lib/avg/voice-request-contract'
import { avgVoiceRouteBindingHashV1 } from '../../src/lib/avg/voice-assembly-contract'
import { AvgVoiceTransportErrorV1, configuredAvgVoiceEndpointHashV1, createConfiguredAvgVoiceTransportV1 } from '../../src/lib/avg/voice-transport'
import { assertAvgStoredAssemblyBriefV3, encodeAvgStoredAssemblyBriefV3 } from '../../src/lib/avg/voice-assembly-storage'
import { buildAvgVoiceAssemblyPlanV3 } from '../../src/lib/avg/voice-assembly-plan'
import type { AvgVoiceProductionBriefV3 } from '../../src/lib/avg/voice-production-policy'
import * as sources from '../../src/lib/avg/voice-task-source'
import { executeAvgVoiceTaskV3 } from '../../src/lib/avg/voice-production-executor'
import { assertAvgRawVoiceArtifactV1 } from '../../src/lib/avg/voice-raw-contract'
import * as assemblyGate from '../../src/lib/avg/assembly-contract'

beforeEach(async () => { vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1'); await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); db.close() })

/** Actual isolated AVG Work and author-adopted rules/scripts. V3 is still
 * unadmitted, so success cases explicitly replace ONLY its unfinished source/
 * Run authority boundary and browser decoder. They validate the private leaf
 * transport/usage/Blob composition, not formal V3 Harness/start acceptance.
 */
async function fixture(mockSource = true) {
  vi.spyOn(assemblyGate, 'avgVoiceProductionEnabledV3').mockReturnValue(true)
  const owner = await seedAvgAuthorStageInputs(), build = (await db.productBuilds.get(owner.buildId))!
  const accepted = await readAvgSystemPlanForCompilationV1({ scope: owner.scope, buildId: owner.buildId,
    expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch, includeSceneScripts: true })
  const policy = await avgVoicePolicyFixtureV3(), a = policy.avgAssembly, p = a.voice.protocol, preset = a.voice.batch.presets[0]!
  const config = { provider: 'agnes' as const, baseUrl: 'https://speech.fixture.invalid/v1', apiKey: 'private-fixture-value-never-returned' }
  p.provider = 'agnes'; p.endpointRouteHash = await configuredAvgVoiceEndpointHashV1({ baseUrl: config.baseUrl, model: p.model })
  Object.assign(preset, { provider: 'agnes', endpointRouteHash: p.endpointRouteHash, capabilityHash: await hashAvgSpeechProtocolV1(p) })
  policy.capabilityRequirements[0]!.capabilityHash = preset.capabilityHash
  a.voice.binding.endpointRouteHash = p.endpointRouteHash
  a.voice.binding.bindingHash = await avgVoiceRouteBindingHashV1({ requirementKey: 'avg.media.voice', adapterId: p.adapterId,
    capabilityHash: preset.capabilityHash, endpointRouteHash: p.endpointRouteHash })
  a.sceneKeys = accepted.plan.scenes.map(scene => scene.key)
  a.voice.batch.sourceInputHash = await hashAvgVoiceSourceInputV1({ systemPlan: accepted.plan, scripts: accepted.scripts.map(s => s.payload) })
  const r = a.voice.batch.requirements[0]!, script = accepted.scripts.find(s => s.payload.sceneKey === r.sceneKey)!
  const line = script.payload.lines.find(line => line.lineKey === r.lineKey)!
  Object.assign(r, { text: line.text, textHash: await hashAvgVoiceTextV1(line.text), speakerKey: line.speakerKey,
    textRevision: script.artifact.version, script: script.artifact })
  const row = (await db.productProductionBriefs.where('productionId').equals(owner.productionId).first())!
  const base = parseProductProductionBriefV3(row.briefJson), stored = await encodeAvgStoredAssemblyBriefV3(a)
  const brief: AvgVoiceProductionBriefV3 = { ...base, ...policy, intent: { ...base.intent, ...policy.intent }, avgAssembly: stored }
  const resolved = await assertAvgStoredAssemblyBriefV3(stored), result = { ...resolved, accepted }
  const source = mockSource ? vi.spyOn(sources, 'readAvgVoiceTaskSourcesV3').mockResolvedValue(result) : null
  const plan = buildAvgVoiceAssemblyPlanV3({ brief: policy, briefHash: await hashProductProductionValueV2(brief),
    buildNumber: build.buildNumber, controlEpoch: build.controlEpoch })
  const task = plan.tasks.find(t => t.kind === 'avg-media-voice-generate')!
  const onMediaOutput = vi.fn(async (_evidence: string): Promise<void | 'discarded-stale'> => {})
  const input: ProductProductionTaskExecutionInputV1 = { scope: owner.scope, productionId: owner.productionId, buildId: owner.buildId,
    buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, planHash: await hashProductProductionValueV2(plan),
    task, attempt: 1, taskRunId: 777, idempotencyKey: 'avg.voice.private-leaf.1', contextText: 'Actual author sources; private V3 authority boundary replaced for this unit test.',
    inputArtifacts: [], capabilityBindings: [{ ...a.voice.binding, provider: 'agnes', model: p.model }], authorResolution: null,
    signal: new AbortController().signal, onMediaOutput }
  const audio = await avgReadingAudioFixture(500)
  const fetcher = vi.fn(async () => new Response(audio.data, { headers: { 'Content-Type': 'audio/wav', 'x-request-id': 'fixture.voice.1' } }))
  const transport = await createConfiguredAvgVoiceTransportV1({ config, assembly: a, capability: policy.capabilityRequirements[0]!, fetcher })
  vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async value => ({ measuredAt: 1, environment: value.environment,
    assets: [{ assetKey: value.assets[0]!.assetKey, contentHash: value.assets[0]!.contentHash, mimeType: 'audio/wav', mediaClass: 'audio',
      status: 'decoded', decodedWidth: null, decodedHeight: null, decodedDurationMs: 500, decodedHasAlpha: null,
      decodedChannelCount: 1, decodedSampleRateHz: 48_000, integratedLufs: -18, truePeakDbtp: -12, loopSeamDbfs: -40, policyFailures: [], failureCode: null }] }))
  return { owner, build, brief, resolved, source, sourceResult: result, input, transport, fetcher, audio, onMediaOutput, capability: policy.capabilityRequirements[0]! }
}

describe('AVG private voice executor leaf transport and received usage', () => {
  it('returns a raw technical candidate with actual same-Work Blob bytes, exact request and unknown cost; no voice adoption or binding', async () => {
    const s = await fixture(), existing = await db.productBuildArtifacts.count()
    const result = await executeAvgVoiceTaskV3(s.input, s), artifact = result.artifacts[0]!
    expect(s.fetcher).toHaveBeenCalledOnce(); expect(s.onMediaOutput).toHaveBeenCalledOnce()
    expect(result.usage).toMatchObject({ mediaCalls: 1, modelCalls: 0, costUsd: null })
    expect(result.passedGateIds).toEqual(s.input.task.acceptanceGateIds); expect(result.artifacts).toHaveLength(1)
    expect(artifact).toMatchObject({ artifactKey: 'avg.voice.raw.keeper.line', kind: 'audio', mediaKind: 'voice', mimeType: 'audio/wav' })
    const blob = (await db.mediaBlobObjects.get(artifact.blobObjectId!))!
    expect(blob.workId).toBe(s.owner.scope.workId); expect(await readVerifiedMediaBlobObjectData(blob)).toEqual(s.audio.data)
    expect(await db.productBuildArtifacts.count()).toBe(existing)
    const checked = await assertAvgRawVoiceArtifactV1({ assembly: s.resolved.assembly, capability: s.capability, row: {
      artifactKey: artifact.artifactKey, kind: artifact.kind, mediaKind: artifact.mediaKind!, contentHash: artifact.contentHash!,
      mimeType: artifact.mimeType!, byteSize: artifact.byteSize!, payloadJson: canonicalProductProductionJsonV2(artifact.payload),
      metadataJson: canonicalProductProductionJsonV2(artifact.metadata), rightsJson: canonicalProductProductionJsonV2(artifact.rights),
    } })
    expect(checked.payload.request).toEqual(s.resolved.requests[0]); expect(checked.payload.rights.commercialUse).toBeNull()
    expect(artifact.quality).not.toHaveProperty('authorAccepted')
  }, 30_000)

  it('fails closed without the mocked V3 source/Run boundary and never sends from an old V1 Build', async () => {
    const s = await fixture(false), error = await executeAvgVoiceTaskV3(s.input, s).catch(error => error)
    expect(error).toBeInstanceOf(ProductProductionDraftRejectedErrorV1)
    expect(error.usage.mediaCalls).toBe(0); expect(error.usage.costUsd).toBe(0)
    expect(s.fetcher).not.toHaveBeenCalled(); expect(await db.mediaBlobObjects.count()).toBe(0)
  }, 30_000)

  it('refuses a manipulated Build missing an actual durable ledger claim before dispatch', async () => {
    const s = await fixture(false)
    await db.productBuilds.update(s.owner.buildId, { status: 'building', planHash: s.input.planHash,
      briefHash: await hashProductProductionValueV2(s.brief), budgetLedgerJson: canonicalProductProductionJsonV2({
        schema: 'storyforge.product-production-budget-ledger', version: 2, rootRunId: null, tasks: {}, attempts: [], rootClaim: null,
      }) })
    const error = await executeAvgVoiceTaskV3(s.input, s).catch(error => error)
    expect(error).toBeInstanceOf(ProductProductionDraftRejectedErrorV1)
    expect(error.message).toMatch(/ledger/); expect(error.usage.mediaCalls).toBe(0); expect(s.fetcher).not.toHaveBeenCalled()
  }, 30_000)

  it.each(['flag', 'voice-gate', 'attempt', 'route'])('refuses changed %s without sending', async variant => {
    const s = await fixture()
    if (variant === 'flag') vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '')
    if (variant === 'voice-gate') vi.mocked(assemblyGate.avgVoiceProductionEnabledV3).mockReturnValue(false)
    if (variant === 'attempt') s.input.attempt = 2
    if (variant === 'route') s.input.capabilityBindings[0]!.bindingHash = 'a'.repeat(64)
    const error = await executeAvgVoiceTaskV3(s.input, s).catch(error => error)
    expect(error).toBeInstanceOf(ProductProductionDraftRejectedErrorV1); expect(error.usage.mediaCalls).toBe(0)
    expect(s.fetcher).not.toHaveBeenCalled(); expect(s.onMediaOutput).not.toHaveBeenCalled()
  }, 30_000)

  it('counts a fully received HTTP refusal as one observed media attempt instead of a free failed preflight', async () => {
    const s = await fixture()
    s.fetcher.mockImplementationOnce(async () => new Response('{"error":"fixture refusal"}', { status: 401 }))
    const error = await executeAvgVoiceTaskV3(s.input, s).catch(error => error)
    expect(error).toBeInstanceOf(ProductProductionDraftRejectedErrorV1)
    expect(error.usage).toMatchObject({ mediaCalls: 1, modelCalls: 0, costUsd: null })
    expect(s.fetcher).toHaveBeenCalledOnce(); expect(s.onMediaOutput).toHaveBeenCalledOnce()
    expect(await db.mediaBlobObjects.count()).toBe(0)
  }, 30_000)

  it.each(['network', 'discarded-response'])('retains the unknown reservation after %s and never hides a resend', async variant => {
    const s = await fixture()
    if (variant === 'network') s.fetcher.mockRejectedValueOnce(new Error('fixture disconnect'))
    else s.onMediaOutput.mockResolvedValueOnce('discarded-stale')
    const error = await executeAvgVoiceTaskV3(s.input, s).catch(error => error)
    expect(error).toBeInstanceOf(ProductProductionResultUnknownErrorV1)
    expect(error.reservationDisposition).toBe('retain'); expect(error.requestDispatched).toBe(true)
    expect(s.fetcher).toHaveBeenCalledOnce(); expect(await db.mediaBlobObjects.count()).toBe(0)
  }, 30_000)

  it('cannot release a dispatched reservation as zero usage when an invalid received error lacks its response', async () => {
    const s = await fixture(), transport = { ...s.transport, request: async () => { throw new AvgVoiceTransportErrorV1('response-recorded', 'fixture missing response') } }
    const error = await executeAvgVoiceTaskV3(s.input, { ...s, transport }).catch(error => error)
    expect(error).toBeInstanceOf(ProductProductionResultUnknownErrorV1)
    expect(error.reservationDisposition).toBe('retain'); expect(error).not.toHaveProperty('usage')
    expect(await db.mediaBlobObjects.count()).toBe(0)
  }, 30_000)

  it.each(['source', 'blob'])('keeps received usage and evidence after later %s failure', async variant => {
    const s = await fixture()
    if (variant === 'source') s.source!.mockResolvedValueOnce(s.sourceResult).mockResolvedValueOnce(s.sourceResult).mockRejectedValueOnce(new Error('fixture stale source'))
    else vi.spyOn(blobs, 'putMediaBlobObject').mockRejectedValueOnce(new Error('fixture storage full'))
    const error = await executeAvgVoiceTaskV3(s.input, s).catch(error => error)
    expect(error).toBeInstanceOf(ProductProductionDraftRejectedErrorV1)
    expect(error.usage).toMatchObject({ mediaCalls: 1, costUsd: null })
    expect(error.usage.storageBytes).toBeGreaterThan(0)
    expect(s.fetcher).toHaveBeenCalledOnce(); expect(s.onMediaOutput).toHaveBeenCalledOnce()
    expect(await db.mediaBlobObjects.count()).toBe(0)
  }, 30_000)
})
