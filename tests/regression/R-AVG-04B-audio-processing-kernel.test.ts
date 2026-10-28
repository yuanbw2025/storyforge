import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import * as scopeCheck from '../../src/lib/workspace/scope'
import * as blobStore from '../../src/lib/product-production/media-blob-store'
import * as voiceDecode from '../../src/lib/avg/voice-decoder'
import * as soundDecode from '../../src/lib/avg/sound-decoder'
import { inspectAvgVoiceWaveV1, AVG_VOICE_DECODER_V1 } from '../../src/lib/avg/voice-wave'
import { parseAvgVoiceByteMeasurementV1 } from '../../src/lib/avg/voice-raw-contract'
import { executeAvgAudioGainWorkerRequestV1, type AvgAudioGainWorkerRequestV1 } from '../../src/lib/avg/audio-gain-worker-protocol'
import { executeAvgBoundedAudioProcessingV1 } from '../../src/lib/avg/audio-processing-execution-kernel'
import { buildAvgAudioProcessingTopologyV1 } from '../../src/lib/avg/audio-production-topology'
import { buildAvgVoiceAssemblyPlanV3 } from '../../src/lib/avg/voice-assembly-plan'
import { buildAvgSoundProductionPlanV1 } from '../../src/lib/avg/sound-production-plan'
import { avgVoiceAssemblyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { avgSoundPlanningFixtureV1 } from '../helpers/avg-sound-planning-fixture'
import { avgSoundPcmFixtureV1 } from '../helpers/avg-sound-wire-data'
import type { AvgAudioProductionProcessingPlanV1 } from '../../src/lib/avg/audio-production-contract'
import type { FrozenRuntimeMediaAssetV2 } from '../../src/lib/types'
import type { ProductProductionTaskExecutionInputV1 } from '../../src/lib/product-production/scheduler'

// Controlled Blob I/O, scope check and unavailable native decoder only.
// Actual WAV bytes, canonical task factory, fixed-Worker protocol, host
// per-sample verification and receipt/byte checks run. The inert task/record
// descriptor below does not establish an actual Run, producer or adoption.
class WorkerPort {
  static instances: WorkerPort[] = []
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  constructor() { WorkerPort.instances.push(this) }
  postMessage(value: AvgAudioGainWorkerRequestV1, transfer: Transferable[]) {
    const request = structuredClone(value, { transfer })
    queueMicrotask(() => this.onmessage?.({ data: executeAvgAudioGainWorkerRequestV1(request) } as MessageEvent<unknown>))
  }
}
async function fixture(domain: 'voice' | 'sound' = 'sound') {
  const voice = await avgVoiceAssemblyFixtureV3(), sound = await avgSoundPlanningFixtureV1()
  const key = domain === 'voice' ? voice.assembly.voice.batch.requirements[0].requirementKey : 'desk.bgm'
  const processing: AvgAudioProductionProcessingPlanV1 = { schema: 'storyforge.avg.audio-production-processing-plan', version: 1,
    entries: [{ domain, requirementKey: key, recipe: { schema: 'storyforge.avg.audio-processing-recipe', version: 1,
      gainMilliDb: -6000, maximumDurationMs: 120_000, sampleRatePolicy: 'preserve', channelPolicy: 'preserve',
      timelinePolicy: 'preserve', overflowPolicy: 'reject', declaration: '仅本地物理内核测试；不签真实Run、试听或采用。' } }] }
  const sourcePlan = domain === 'voice'
    ? buildAvgVoiceAssemblyPlanV3({ brief: { avgAssembly: voice.assembly, capabilityRequirements: voice.capabilities },
      briefHash: 'a'.repeat(64), buildNumber: 1, controlEpoch: 0 })
    : buildAvgSoundProductionPlanV1({ brief: { avgSoundPlanning: { schema: 'storyforge.avg.sound-planning-brief', version: 1,
      assembly: { schema: voice.assembly.schema, version: 1, title: voice.assembly.title, sceneKeys: voice.assembly.sceneKeys,
        mediaAssetKeys: sound.scope.templates.map(t => t.assetKey), basePackageHash: null }, aspectRatio: '16:9', scope: sound.scope,
      musicBinding: { adapterId: 'storyforge.avg.local-music.v1', requirementKey: 'avg.media.music', bindingHash: 'b'.repeat(64), endpointRouteHash: 'c'.repeat(64) } },
      capabilityRequirements: [{ ...voice.capabilities[0], requirementKey: 'avg.sound.planning.text', mediaClass: 'text' },
        { ...voice.capabilities[0], requirementKey: 'avg.media.music', mediaClass: 'music' }] }, briefHash: 'a'.repeat(64), buildNumber: 1, controlEpoch: 0 })
  const kind = domain === 'voice' ? 'voice' as const : 'bgm' as const
  const { plan } = buildAvgAudioProcessingTopologyV1({ sourcePlan, processing,
    targets: [{ domain, requirementKey: key, kind, mimeType: 'audio/wav' }] })
  const task = plan.tasks.find(t => t.kind === 'avg-audio-process')!
  const data = avgSoundPcmFixtureV1(.01), original = data.slice(0), contentHash = await blobStore.sha256MediaData(data)
  const asset: FrozenRuntimeMediaAssetV2 = { assetKey: 'audio.fixture', version: 1, kind, name: '工程PCM', altText: '物理内核',
    mimeType: 'audio/wav', byteSize: data.byteLength, contentHash, blobContentHash: contentHash,
    width: null, height: null, durationMs: 10, source: 'fixture', license: 'not-commercially-reviewed',
    characterTag: domain === 'voice' ? 'keeper' : '', sceneTag: 'desk' }
  const row = { artifactKey: 'avg.' + domain + '.raw.' + key, version: 2, contentHash, producerReceiptHash: 'd'.repeat(64),
    producerRunId: 13, buildId: 7, controlEpoch: 0, status: 'accepted' as const, blobObjectId: 4,
    kind: 'audio' as const, mediaKind: kind, mimeType: 'audio/wav', byteSize: data.byteLength,
    rightsJson: JSON.stringify({ originalLicence: 'unreviewed-fixture', commercialUse: null }) }
  const controller = new AbortController()
  const request: ProductProductionTaskExecutionInputV1 = { scope: { projectId: 1, worldGroupId: 1, workId: 1 },
    productionId: 3, buildId: 7, buildNumber: 1, controlEpoch: 0, planHash: 'e'.repeat(64),
    task, attempt: 1, idempotencyKey: 'inert.fixture', taskRunId: 17, contextText: 'inert registered-packet stand-in; no claim asserted',
    inputArtifacts: [], capabilityBindings: [], authorResolution: null, signal: controller.signal }
  vi.spyOn(db.mediaBlobObjects, 'get').mockResolvedValue({ id: 4, contentHash, mimeType: 'audio/wav', byteSize: data.byteLength } as never)
  const owner = vi.spyOn(scopeCheck, 'assertRecordInScope').mockResolvedValue(true)
  vi.spyOn(blobStore, 'readVerifiedMediaBlobObjectData').mockImplementation(async () => data.slice(0))
  const saved: ArrayBuffer[] = []
  const put = vi.spyOn(blobStore, 'putMediaBlobObject').mockImplementation(async input => {
    const bytes = input.data as ArrayBuffer
    const hash = await blobStore.sha256MediaData(bytes); expect(hash).toBe(input.expectedContentHash); saved.push(bytes.slice(0))
    return { id: 8, contentHash: hash, mimeType: 'audio/wav', byteSize: bytes.byteLength } as never
  })
  const soundDecoder = vi.spyOn(soundDecode, 'inspectAvgSoundBytesV1').mockImplementation(async input => {
    const wave = inspectAvgVoiceWaveV1(input.data, 120_000)
    return { data: input.data, measurement: soundDecode.parseAvgSoundByteMeasurementV1({
      schema: 'storyforge.avg.sound-byte-measurement', version: 1, decoder: 'storyforge.avg.sound-browser.v1',
      contentHash: await blobStore.sha256MediaData(input.data), mimeType: 'audio/wav', byteSize: input.data.byteLength,
      durationMs: wave.durationMs, channelCount: wave.channelCount, decodedSampleRateHz: 96_000,
      integratedLufs: -18, truePeakDbtp: -6, loopSeamDbfs: -40 }) }
  })
  vi.spyOn(voiceDecode, 'inspectAvgVoiceBytesV1').mockImplementation(async input => {
    const wave = inspectAvgVoiceWaveV1(input.data, 120_000)
    return { data: input.data, measurement: parseAvgVoiceByteMeasurementV1({ decoder: AVG_VOICE_DECODER_V1,
      contentHash: await blobStore.sha256MediaData(input.data), mimeType: 'audio/wav', byteSize: input.data.byteLength,
      durationMs: wave.durationMs, channelCount: wave.channelCount, sourceSampleRateHz: wave.sampleRateHz,
      decodedSampleRateHz: 96_000, sampleCount: wave.sampleCount, integratedLufs: -18, truePeakDbtp: -6 }) }
  })
  const recheck = vi.fn(async () => undefined)
  return { request, raw: { row, asset, requestIdentityHash: 'f'.repeat(64) }, entry: processing.entries[0],
    recheck, controller, data, original, saved, put, owner, soundDecoder }
}
beforeEach(() => { WorkerPort.instances = []; vi.stubGlobal('Worker', WorkerPort); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network in local kernel') })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('AVG private physical audio kernel without sealed/adoption authority', () => {
  it.each(['voice', 'sound'] as const)('uses actual %s WAV frames separately from a device decode rate', async domain => {
    const f = await fixture(domain), result = await executeAvgBoundedAudioProcessingV1(f)
    const candidate = result.artifacts[0]!, payload = candidate.payload as { receipt: { output: { sampleRateHz: number; sampleCount: number } } }
    expect(payload.receipt.output).toMatchObject({ sampleRateHz: 48_000, sampleCount: 480 })
    expect(candidate.quality).toMatchObject({ noProviderRequest: true, decoderVerified: true, hearing: 'unobserved',
      authorAdopted: false, measurement: { decodedSampleRateHz: 96_000 } })
    expect(candidate.rights).toMatchObject({ commercialUse: null, requiresAuthorReview: true })
    expect(result.usage).toMatchObject({ modelCalls: 0, mediaCalls: 0, costUsd: 0 })
    expect(f.saved).toHaveLength(1); expect(f.data).toEqual(f.original)
    expect(WorkerPort.instances).toHaveLength(1); expect(WorkerPort.instances[0].terminate).toHaveBeenCalledOnce()
    expect(f.recheck).toHaveBeenCalledTimes(3); expect(fetch).not.toHaveBeenCalled()
    if (domain === 'sound') expect(candidate.quality).not.toHaveProperty('measurement.sampleCount')
  })
  it('rejects incorrect native channel observation without storing or choosing a candidate', async () => {
    const f = await fixture(), real = f.soundDecoder.getMockImplementation()!
    f.soundDecoder.mockImplementation(async input => { const r = await real(input); return { ...r, measurement: { ...r.measurement, channelCount: 1 } } })
    await expect(executeAvgBoundedAudioProcessingV1(f)).rejects.toThrow(/真实解码/)
    expect(f.saved).toHaveLength(0); expect(f.data).toEqual(f.original)
  })
  it('stops before storage after a late cancel and preserves the original', async () => {
    const f = await fixture()
    f.recheck.mockImplementation(async () => { if (f.recheck.mock.calls.length === 2) f.controller.abort() })
    await expect(executeAvgBoundedAudioProcessingV1(f)).rejects.toThrow(/aborted/)
    expect(f.saved).toHaveLength(0); expect(f.data).toEqual(f.original)
  })
  it('accounts a stored local Blob when the final fence goes stale without returning an adopted artifact', async () => {
    const f = await fixture()
    f.recheck.mockImplementation(async () => { if (f.recheck.mock.calls.length === 3) throw new Error('Actual final fence stale') })
    let failure: unknown
    try { await executeAvgBoundedAudioProcessingV1(f) } catch (error) { failure = error }
    expect(failure).toMatchObject({ message: 'Actual final fence stale', usage: { modelCalls: 0, mediaCalls: 0, costUsd: 0, storageBytes: f.data.byteLength } })
    expect(f.saved).toHaveLength(1); expect(f.data).toEqual(f.original)
  })
  it('rejects a foreign Blob owner and a changed paid-call budget before creating a Worker', async () => {
    const f = await fixture(); f.owner.mockResolvedValueOnce(false)
    await expect(executeAvgBoundedAudioProcessingV1(f)).rejects.toThrow(/同作品/)
    f.request.task.budgetReservation.mediaCalls = 1
    await expect(executeAvgBoundedAudioProcessingV1(f)).rejects.toThrow(/零新增/)
    expect(WorkerPort.instances).toHaveLength(0); expect(f.put).not.toHaveBeenCalled()
  })
})
