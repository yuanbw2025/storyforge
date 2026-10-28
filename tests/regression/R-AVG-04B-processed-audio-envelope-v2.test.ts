import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FrozenRuntimeMediaAssetV2 } from '../../src/lib/types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { processAvgAudioPcmWaveV1 } from '../../src/lib/avg/audio-processing'
import { avgSoundPcmFixtureV1 } from '../helpers/avg-sound-wire-data'
import type { AvgAudioPcmKindV1, AvgAudioProcessingRecipeV1 } from '../../src/lib/avg/audio-processing-contract'
import { AVG_AUDIO_DYNAMICS_RESAMPLE_PROCESSOR_V2, type AvgAudioProcessingRecipeV2 } from '../../src/lib/avg/audio-processing-contract-v2'
import { parseAvgProcessedAudioPayloadV1, parseAvgProcessedAudioPayloadV2, parseAvgProcessedAudioPayload,
  deriveAvgProcessedAudioAssetV1, deriveAvgProcessedAudioRightsV1, assertAvgProcessedAudioArtifactV1, assertAvgProcessedAudioArtifact,
  type AvgProcessedAudioPayload, type AvgProcessedAudioArtifactFieldsV1 } from '../../src/lib/avg/processed-audio-contract'

// Candidate-envelope fixtures only: actual original/gain WAV bytes supply
// observations, but no durable V2 producer, owned Blob or audition is claimed.
async function fixture(kind: AvgAudioPcmKindV1 = 'voice') {
  const data = avgSoundPcmFixtureV1(.01), hash = await sha256MediaData(data)
  const recipe1: AvgAudioProcessingRecipeV1 = { schema: 'storyforge.avg.audio-processing-recipe', version: 1, gainMilliDb: 0,
    maximumDurationMs: 1000, sampleRatePolicy: 'preserve', channelPolicy: 'preserve', timelinePolicy: 'preserve',
    overflowPolicy: 'reject', declaration: '工程合同夹具，保留原权利与独立审听采用边界。' }
  const original = await processAvgAudioPcmWaveV1({ data, source: { contentHash: hash, mimeType: 'audio/wav', kind }, recipe: recipe1 })
  const sourceAsset: FrozenRuntimeMediaAssetV2 = { assetKey: 'audio.fixture', version: 1, kind,
    name: '原创工程PCM', altText: '仅校验严格工件合同', mimeType: 'audio/wav', byteSize: data.byteLength,
    contentHash: hash, blobContentHash: hash, width: null, height: null, durationMs: original.receipt.source.durationMs,
    source: 'fixture:original-pcm', license: 'unreviewed-fixture', characterTag: kind === 'voice' ? 'keeper' : '', sceneTag: 'desk' }
  const domain = kind === 'voice' ? 'voice' as const : 'sound' as const
  const payload1 = await parseAvgProcessedAudioPayloadV1({ schema: 'storyforge.avg.processed-audio', version: 1,
    domain, requirementKey: 'fixture.audio', requestIdentityHash: 'b'.repeat(64),
    raw: { artifactKey: `avg.${domain}.raw.fixture.audio`, version: 3, contentHash: hash, producerReceiptHash: 'a'.repeat(64) },
    sourceAsset, recipe: recipe1, receipt: original.receipt })
  const recipe2: AvgAudioProcessingRecipeV2 = { ...recipe1, version: 2, targetSampleRateHz: null,
    resampler: 'blackman-sinc64.v1', processingOrder: 'resample-gain-linked-limit.v1', dynamics: null }
  const body2 = { schema: 'storyforge.avg.audio-processing-receipt' as const, version: 2 as const,
    processor: AVG_AUDIO_DYNAMICS_RESAMPLE_PROCESSOR_V2, recipeHash: await hashProductProductionValueV2(recipe2),
    source: original.receipt.source, output: original.receipt.output, quantization: original.receipt.quantization,
    dynamicsObservation: { limitedFrameCount: 0, maximumReductionMilliDb: 0 } }
  const payload2 = await parseAvgProcessedAudioPayloadV2({ ...payload1, version: 2, recipe: recipe2,
    receipt: { ...body2, receiptHash: await hashProductProductionValueV2(body2) } })
  const sourceRights = { origin: 'fixture', commercialUse: null, requiresAuthorReview: true, declarationHash: 'c'.repeat(64) }
  const rowOf = async (payload: AvgProcessedAudioPayload) => {
    const asset = deriveAvgProcessedAudioAssetV1(payload), rights = await deriveAvgProcessedAudioRightsV1(payload, sourceRights)
    const row: AvgProcessedAudioArtifactFieldsV1 = { artifactKey: `avg.${domain}.processed.fixture.audio`, kind: 'audio', mediaKind: kind,
      payloadJson: canonicalProductProductionJsonV2(payload), metadataJson: canonicalProductProductionJsonV2(asset),
      rightsJson: canonicalProductProductionJsonV2(rights), contentHash: asset.contentHash, mimeType: 'audio/wav', byteSize: asset.byteSize }
    return { row, asset, rights }
  }
  const one = await rowOf(payload1), two = await rowOf(payload2)
  const source = { raw: payload1.raw, asset: sourceAsset, requestIdentityHash: payload1.requestIdentityHash, rights: sourceRights }
  return { data, payload1, payload2, one, two, sourceRights, rowOf,
    input1: { entry: { domain, requirementKey: 'fixture.audio', recipe: recipe1 }, source, row: one.row },
    input2: { entry: { domain, requirementKey: 'fixture.audio', recipe: recipe2 }, source, row: two.row } }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Envelope checks cannot contact providers') }))
  vi.stubGlobal('Worker', vi.fn(() => { throw new Error('Envelope checks cannot create Workers') }))
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(Worker).not.toHaveBeenCalled(); vi.unstubAllGlobals() })

describe('AVG strict audio envelope V2 dispatch and unchanged original identity', () => {
  it('preserves V1 canonical JSON, derived asset, rights and checker results exactly', async () => {
    const f = await fixture(), encoded = canonicalProductProductionJsonV2(f.payload1)
    expect(canonicalProductProductionJsonV2(await parseAvgProcessedAudioPayload(encoded))).toBe(encoded)
    expect(await assertAvgProcessedAudioArtifact(f.input1)).toEqual(await assertAvgProcessedAudioArtifactV1(f.input1))
    expect(deriveAvgProcessedAudioAssetV1(f.payload1)).toEqual(f.one.asset)
    expect(await deriveAvgProcessedAudioRightsV1(f.payload1, f.sourceRights)).toEqual(f.one.rights)
  })

  it.each(['voice', 'bgm', 'sfx', 'ambience'] as const)('binds %s V2 explicitly while retaining raw hash, producer and rights without claiming adoption', async kind => {
    const f = await fixture(kind), selected = await assertAvgProcessedAudioArtifact(f.input2)
    expect(selected.payload).toEqual(f.payload2); expect(selected.asset).toEqual(f.two.asset)
    expect(selected.asset.source).toBe(AVG_AUDIO_DYNAMICS_RESAMPLE_PROCESSOR_V2)
    expect(selected.payload.raw).toEqual(f.payload1.raw)
    expect(selected.asset.contentHash).toBe(f.payload1.raw.contentHash)
    expect(selected.asset.version).toBe(2); expect(selected.payload.raw.version).toBe(3)
    expect(f.two.row.artifactKey).not.toBe(selected.payload.raw.artifactKey)
    expect(selected.rights).toEqual(f.one.rights)
    expect(selected.rights).toMatchObject({ requiresAuthorReview: true, commercialUse: null,
      sourceProducerReceiptHash: 'a'.repeat(64), sourceRightsHash: await hashProductProductionValueV2(f.sourceRights) })
  })

  it('retains different source/output resampling metadata only in the explicit V2 envelope, without claiming a physical producer', async () => {
    const f = await fixture(), recipe = { ...f.payload2.recipe, sampleRatePolicy: 'explicit' as const, targetSampleRateHz: 24000 }
    const source = f.payload2.receipt.source, sampleCount = Math.round(source.sampleCount / 2)
    const dataByteSize = sampleCount * source.channelCount * 2
    const { receiptHash: _old, ...receipt } = f.payload2.receipt
    const body = { ...receipt, recipeHash: await hashProductProductionValueV2(recipe), output: { ...source,
      sampleRateHz: 24000, sampleCount, durationMs: Math.max(1, Math.round(sampleCount * 1000 / 24000)),
      dataOffset: 44, dataByteSize, byteSize: 44 + dataByteSize, contentHash: 'd'.repeat(64), pcmHash: 'e'.repeat(64) } }
    const payload = await parseAvgProcessedAudioPayload({ ...f.payload2, recipe, receipt: { ...body, receiptHash: await hashProductProductionValueV2(body) } })
    const row = await f.rowOf(payload)
    const selected = await assertAvgProcessedAudioArtifact({ ...f.input2, entry: { ...f.input2.entry, recipe }, row: row.row })
    expect(selected.payload.raw).toEqual(f.payload1.raw)
    expect(selected.asset.byteSize).toBe(44 + dataByteSize); expect(selected.asset.durationMs).toBe(source.durationMs)
    expect(selected.asset.contentHash).toBe('d'.repeat(64))
  })

  it('keeps both legacy parsers/checkers strict and refuses cross-version recipe, receipt or entry downgrades', async () => {
    const f = await fixture()
    await expect(parseAvgProcessedAudioPayloadV1(f.payload2)).rejects.toThrow()
    await expect(parseAvgProcessedAudioPayloadV2(f.payload1)).rejects.toThrow()
    await expect(assertAvgProcessedAudioArtifactV1({ ...f.input1, row: f.two.row })).rejects.toThrow()
    await expect(parseAvgProcessedAudioPayload({ ...f.payload2, recipe: f.payload1.recipe })).rejects.toThrow(/V2/)
    await expect(parseAvgProcessedAudioPayload({ ...f.payload2, receipt: f.payload1.receipt })).rejects.toThrow(/V2/)
    await expect(parseAvgProcessedAudioPayload({ ...f.payload1, recipe: f.payload2.recipe })).rejects.toThrow()
    await expect(parseAvgProcessedAudioPayload({ ...f.payload2, version: 3 })).rejects.toThrow()
    // A V1 entry inside a mixed plan still consumes a V1 envelope; the plan's
    // top-level version cannot transfer V2 authority to that unchanged entry.
    await expect(assertAvgProcessedAudioArtifact({ ...f.input1, row: f.two.row })).rejects.toThrow()
    await expect(assertAvgProcessedAudioArtifact({ ...f.input2, row: f.one.row })).rejects.toThrow()
  })

  it.each(['domain', 'raw-producer', 'raw-version', 'raw-key', 'request', 'rights', 'blob-hash', 'mime', 'approval'] as const)('refuses changed %s without widening raw/source/rights authority', async changed => {
    const f = await fixture(), candidate: any = structuredClone(f.input2)
    if (changed === 'domain') candidate.entry.domain = 'sound'
    if (changed === 'raw-producer') candidate.source.raw.producerReceiptHash = 'd'.repeat(64)
    if (changed === 'raw-version') candidate.source.raw.version++
    if (changed === 'raw-key') candidate.source.raw.artifactKey = 'avg.voice.raw.foreign'
    if (changed === 'request') candidate.source.requestIdentityHash = 'd'.repeat(64)
    if (changed === 'rights') candidate.source.rights.commercialUse = true
    if (changed === 'blob-hash') candidate.source.asset.blobContentHash = 'd'.repeat(64)
    if (changed === 'mime') candidate.source.asset.mimeType = 'audio/ogg'
    if (changed === 'approval') candidate.row.rightsJson = canonicalProductProductionJsonV2({ ...f.two.rights, commercialUse: true, requiresAuthorReview: false })
    await expect(assertAvgProcessedAudioArtifact(candidate)).rejects.toThrow()
  })

  it('rejects self-consistent licence or actor relabelling against the independent original source', async () => {
    const f = await fixture(), payload = await parseAvgProcessedAudioPayloadV2({ ...f.payload2,
      sourceAsset: { ...f.payload2.sourceAsset, license: 'commercial-granted', characterTag: 'another-speaker' } })
    const forged = await f.rowOf(payload)
    await expect(assertAvgProcessedAudioArtifact({ ...f.input2, row: forged.row })).rejects.toThrow(/原请求\/版本\/权利/)
  })

  it('rejects OGG, source Blob hash disagreement and hidden fields in V2 itself', async () => {
    const f = await fixture()
    for (const body of [{ ...f.payload2, authorAdopted: true }, { ...f.payload2, raw: { ...f.payload2.raw, producerRunId: 1 } },
      { ...f.payload2, sourceAsset: { ...f.payload2.sourceAsset, mimeType: 'audio/ogg' } },
      { ...f.payload2, sourceAsset: { ...f.payload2.sourceAsset, blobContentHash: 'd'.repeat(64) } }]) {
      await expect(parseAvgProcessedAudioPayload(body)).rejects.toThrow()
    }
  })

  it('captures caller-owned raw, recipe, receipt, asset and rights before asynchronous hashing', async () => {
    const f = await fixture(), body = structuredClone(f.payload2), parsing = parseAvgProcessedAudioPayload(body)
    body.raw.producerReceiptHash = 'd'.repeat(64); body.recipe.gainMilliDb = 1000; body.sourceAsset.license = 'changed'
    body.receipt.dynamicsObservation.limitedFrameCount = 1
    expect(await parsing).toEqual(f.payload2)
    const input = structuredClone(f.input2), checking = assertAvgProcessedAudioArtifact(input)
    input.entry.recipe.gainMilliDb = 1000; input.source.raw.version++; input.source.rights.declarationHash = 'd'.repeat(64)
    await expect(checking).resolves.toMatchObject({ payload: f.payload2 })
    const rightsPayload = structuredClone(f.payload2), originalRights = structuredClone(f.sourceRights)
    const deriving = deriveAvgProcessedAudioRightsV1(rightsPayload, originalRights)
    rightsPayload.recipe.declaration = 'changed'; originalRights.declarationHash = 'd'.repeat(64)
    expect(await deriving).toEqual(f.two.rights)
  })
})
