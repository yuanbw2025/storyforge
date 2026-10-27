import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { FrozenRuntimeMediaAssetV2, ProductBuildArtifactRecordV1 } from '../../src/lib/types'
import { createAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { putMediaBlobObject, sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { canonicalProductProductionJsonV2 as json, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { textOpenWorldProductArtifactStoreV1 } from '../../src/lib/product-production/artifact-store'
import { processAvgAudioPcmWaveV1, inspectAvgAudioProcessingWaveBytesV1 } from '../../src/lib/avg/audio-processing'
import { parseAvgProcessedAudioPayloadV1, deriveAvgProcessedAudioAssetV1, deriveAvgProcessedAudioRightsV1 } from '../../src/lib/avg/processed-audio-contract'
import { inspectAvgProcessedAudioSourceV1, type AvgProcessedAudioStoredFieldsV1 } from '../../src/lib/avg/processed-audio-source'
import type { AvgAudioPcmKindV1, AvgAudioProcessingRecipeV1 } from '../../src/lib/avg/audio-processing-contract'
import * as voiceDecode from '../../src/lib/avg/voice-decoder'
import * as soundDecode from '../../src/lib/avg/sound-decoder'
import { parseAvgVoiceByteMeasurementV1 } from '../../src/lib/avg/voice-raw-contract'
import { inspectAvgVoiceWaveV1, AVG_VOICE_DECODER_V1 } from '../../src/lib/avg/voice-wave'
import { avgSoundPcmFixtureV1 } from '../helpers/avg-sound-wire-data'

// Actual isolated Work/Blob ownership, stored WAV reads, arithmetic, strict
// codecs and every output sample are exercised. Only the unavailable browser
// analyzer is controlled. The inert raw descriptor is explicitly NOT a real
// accepted producer, completed Run, original response or author approval.
async function fixture(kind: AvgAudioPcmKindV1 = 'bgm', gainMilliDb = -6000) {
  const { scope } = await createAvgDraftV1('加工音频物理读取隔离测试')
  const data = avgSoundPcmFixtureV1(.02), hash = await sha256MediaData(data)
  const recipe: AvgAudioProcessingRecipeV1 = { schema: 'storyforge.avg.audio-processing-recipe', version: 1, gainMilliDb,
    maximumDurationMs: 1000, sampleRatePolicy: 'preserve', channelPolicy: 'preserve', timelinePolicy: 'preserve',
    overflowPolicy: 'reject', declaration: '仅工程WAV及物理来源验证，真实producer、审听及采用另验。' }
  const processed = await processAvgAudioPcmWaveV1({ data, source: { contentHash: hash, mimeType: 'audio/wav', kind }, recipe })
  const rawBlob = await putMediaBlobObject({ scope, data, mimeType: 'audio/wav', backend: 'indexeddb' })
  const outputBlob = await putMediaBlobObject({ scope, data: processed.data, mimeType: 'audio/wav', backend: 'indexeddb' })
  const sourceAsset: FrozenRuntimeMediaAssetV2 = { assetKey: 'audio.fixture', version: 1, kind,
    name: '工程PCM', altText: '物理来源测试', mimeType: 'audio/wav', byteSize: data.byteLength,
    contentHash: hash, blobContentHash: hash, width: null, height: null, durationMs: processed.receipt.source.durationMs,
    source: 'fixture:original', license: 'unreviewed-fixture', characterTag: kind === 'voice' ? 'keeper' : '', sceneTag: 'desk' }
  const domain = kind === 'voice' ? 'voice' as const : 'sound' as const
  const raw: ProductBuildArtifactRecordV1 = { projectId: scope.projectId, worldId: scope.worldGroupId, workId: scope.workId,
    buildId: 7, artifactKey: 'avg.' + domain + '.raw.fixture.audio', requirementKey: null,
    version: 3, kind: 'audio', mediaKind: kind, status: 'accepted', producerRunId: 13,
    producerReceiptHash: 'a'.repeat(64), controlEpoch: 0, inputHash: 'b'.repeat(64), contentHash: hash,
    payloadJson: json({ inertSourceDescriptor: true }), metadataJson: json(sourceAsset), qualityJson: '{}',
    rightsJson: json({ origin: 'fixture', commercialUse: null }), blobObjectId: rawBlob.id!, mimeType: 'audio/wav',
    byteSize: data.byteLength, parentArtifactHash: null, carriedFrom: null, createdAt: 1, updatedAt: 1 }
  const payload = await parseAvgProcessedAudioPayloadV1({ schema: 'storyforge.avg.processed-audio', version: 1,
    domain, requirementKey: 'fixture.audio', requestIdentityHash: 'c'.repeat(64),
    raw: { artifactKey: raw.artifactKey, version: raw.version, contentHash: raw.contentHash, producerReceiptHash: raw.producerReceiptHash },
    sourceAsset, recipe, receipt: processed.receipt })
  const asset = deriveAvgProcessedAudioAssetV1(payload), rights = await deriveAvgProcessedAudioRightsV1(payload, JSON.parse(raw.rightsJson))
  const wave = inspectAvgVoiceWaveV1(processed.data, 1000)
  const measurement = kind === 'voice'
    ? parseAvgVoiceByteMeasurementV1({ decoder: AVG_VOICE_DECODER_V1, contentHash: asset.contentHash,
      mimeType: 'audio/wav', byteSize: asset.byteSize, durationMs: wave.durationMs, channelCount: wave.channelCount,
      sourceSampleRateHz: wave.sampleRateHz, decodedSampleRateHz: 48_000, sampleCount: wave.sampleCount, integratedLufs: -18, truePeakDbtp: -6 })
    : soundDecode.parseAvgSoundByteMeasurementV1({ schema: 'storyforge.avg.sound-byte-measurement', version: 1,
      decoder: 'storyforge.avg.sound-browser.v1', contentHash: asset.contentHash, mimeType: 'audio/wav', byteSize: asset.byteSize,
      durationMs: wave.durationMs, channelCount: wave.channelCount, decodedSampleRateHz: 48_000,
      integratedLufs: -18, truePeakDbtp: -6, loopSeamDbfs: -40 })
  const quality = { schema: 'storyforge.avg.processed-audio-evidence', version: 1,
    rawProducerReceiptHash: raw.producerReceiptHash, processingReceiptHash: payload.receipt.receiptHash,
    sourceRightsHash: rights.sourceRightsHash, sourceContextHash: 'd'.repeat(64), noProviderRequest: true,
    contentHashVerified: true, decoderVerified: true, measurement, hearing: 'unobserved', authorAdopted: false }
  const row: AvgProcessedAudioStoredFieldsV1 = { artifactKey: 'avg.' + domain + '.processed.fixture.audio',
    requirementKey: null, kind: 'audio', mediaKind: kind, payloadJson: json(payload), metadataJson: json(asset),
    rightsJson: json(rights), qualityJson: json(quality), contentHash: asset.contentHash,
    mimeType: 'audio/wav', byteSize: asset.byteSize, blobObjectId: outputBlob.id! }
  const sound = vi.spyOn(soundDecode, 'inspectAvgSoundBytesV1').mockImplementation(async input => ({ data: input.data,
    measurement: soundDecode.parseAvgSoundByteMeasurementV1({ ...measurement, decodedSampleRateHz: 96_000 }) }))
  vi.spyOn(voiceDecode, 'inspectAvgVoiceBytesV1').mockImplementation(async input => ({ data: input.data,
    measurement: parseAvgVoiceByteMeasurementV1({ ...measurement, decodedSampleRateHz: 96_000 }) }))
  return { data, processed, payload, quality, measurement, sound, rawBlob, outputBlob, input: {
    scope, entry: { domain, requirementKey: 'fixture.audio', recipe },
    original: { row: raw, asset: sourceAsset, requestIdentityHash: payload.requestIdentityHash },
    row, sourceContextHash: quality.sourceContextHash,
  } }
}
beforeEach(async () => {
  await db.delete(); await db.open()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network in physical processed-source inspection') }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
afterAll(() => db.close())

describe('AVG processed audio physical source and unchanged current authority', () => {
  it.each(['voice', 'bgm', 'sfx', 'ambience'] as const)('rechecks real %s WAV and Work ownership without writing or granting a producer', async kind => {
    const f = await fixture(kind), before = await db.mediaBlobObjects.toArray()
    const actual = await inspectAvgProcessedAudioSourceV1(f.input)
    expect(actual.asset.contentHash).toBe(await sha256MediaData(f.processed.data))
    expect(actual.recorded.decodedSampleRateHz).toBe(48_000); expect(actual.observed.decodedSampleRateHz).toBe(96_000)
    expect(actual.payload.receipt.output).toMatchObject({ sampleRateHz: 48_000, sampleCount: 960 })
    expect(actual.rights).toMatchObject({ commercialUse: null, requiresAuthorReview: true })
    expect(await db.productBuildArtifacts.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
    expect(await db.mediaBlobObjects.toArray()).toEqual(before); expect(fetch).not.toHaveBeenCalled()
  })
  it('accepts zero-gain physical deduplication while keeping raw and processed identities separate', async () => {
    const f = await fixture('voice', 0)
    expect(f.rawBlob.id).toBe(f.outputBlob.id)
    expect((await inspectAvgProcessedAudioSourceV1(f.input)).asset.version).toBe(2)
    expect(await db.mediaBlobObjects.count()).toBe(1)
    expect(f.input.row.artifactKey).not.toBe(f.input.original.row.artifactKey)
  })
  it.each(['hearing', 'authorAdopted', 'sourceContextHash', 'rawProducerReceiptHash', 'unknownApproval'] as const)('rejects invented evidence: %s', async field => {
    const f = await fixture(), changed = { ...f.quality, [field]: field === 'authorAdopted' ? true : 'forged' }
    f.input.row.qualityJson = json(changed)
    await expect(inspectAvgProcessedAudioSourceV1(f.input)).rejects.toThrow()
    expect(f.sound).not.toHaveBeenCalled(); expect(await db.productBuildArtifacts.count()).toBe(0)
  })
  it('rejects an exact-byte output owned by another Work', async () => {
    const f = await fixture(), other = await createAvgDraftV1('另一媒资作品')
    const foreign = await putMediaBlobObject({ scope: other.scope, data: f.processed.data, mimeType: 'audio/wav', backend: 'indexeddb' })
    f.input.row.blobObjectId = foreign.id!
    await expect(inspectAvgProcessedAudioSourceV1(f.input)).rejects.toThrow(/同作品/)
    expect(f.sound).not.toHaveBeenCalled()
  })
  it('rejects altered stored bytes even when the Blob metadata still claims the old hash', async () => {
    const f = await fixture(), changed = f.processed.data.slice(0)
    new DataView(changed).setInt16(60, 1, true)
    await db.mediaBlobObjects.update(f.outputBlob.id!, { data: changed })
    await expect(inspectAvgProcessedAudioSourceV1(f.input)).rejects.toThrow()
    expect(f.sound).not.toHaveBeenCalled()
  })
  it('rejects a fully rehashed output and receipt whose non-peak sample is not the frozen gain result', async () => {
    const f = await fixture(), changed = f.processed.data.slice(0), pcm = new DataView(changed)
    pcm.setInt16(60, pcm.getInt16(60, true) + 1, true)
    const output = await inspectAvgAudioProcessingWaveBytesV1(changed, 'bgm', 1000)
    const { receiptHash, ...body } = f.payload.receipt
    expect(receiptHash).toMatch(/^[a-f0-9]{64}$/)
    const receipt = { ...body, output, receiptHash: await hashProductProductionValueV2({ ...body, output }) }
    const payload = await parseAvgProcessedAudioPayloadV1({ ...f.payload, receipt })
    const asset = deriveAvgProcessedAudioAssetV1(payload)
    const blob = await putMediaBlobObject({ scope: f.input.scope, data: changed, mimeType: 'audio/wav', backend: 'indexeddb' })
    Object.assign(f.input.row, { payloadJson: json(payload), metadataJson: json(asset), contentHash: asset.contentHash,
      blobObjectId: blob.id, qualityJson: json({ ...f.quality, processingReceiptHash: receipt.receiptHash,
        measurement: { ...f.measurement, contentHash: asset.contentHash } }) })
    await expect(inspectAvgProcessedAudioSourceV1(f.input)).rejects.toThrow(/样本|增益|处理|PCM/)
    expect(f.sound).not.toHaveBeenCalled()
  })
  it('rejects a fresh decoder with different real channels even when stored measurements match', async () => {
    const f = await fixture(), inspect = f.sound.getMockImplementation()!
    f.sound.mockImplementation(async input => { const actual = await inspect(input); return { ...actual, measurement: { ...actual.measurement, channelCount: 1 } } })
    await expect(inspectAvgProcessedAudioSourceV1(f.input)).rejects.toThrow(/实际衍生解码/)
  })
  it('captures caller-owned source and evidence before asynchronous receipt hashing', async () => {
    const f = await fixture(), pending = inspectAvgProcessedAudioSourceV1(f.input)
    f.input.row.qualityJson = '{}'; f.input.original.row.rightsJson = '{}'; f.input.scope.workId += 1000
    await expect(pending).resolves.toMatchObject({ asset: { contentHash: f.outputBlob.contentHash } })
  })
  it.each(['voice', 'sound'])('keeps direct shared sealed-store access closed for %s processed namespaces', async domain => {
    await expect(textOpenWorldProductArtifactStoreV1.acceptProductBuildArtifact({ artifactKey: `avg.${domain}.processed.fixture.audio` } as never)).rejects.toThrow(/不能回退通用工件写口/)
    expect(await db.productBuildArtifacts.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
  })
})
