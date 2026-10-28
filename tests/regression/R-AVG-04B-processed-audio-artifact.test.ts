import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FrozenRuntimeMediaAssetV2 } from '../../src/lib/types'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'
import { processAvgAudioPcmWaveV1 } from '../../src/lib/avg/audio-processing'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { parseAvgProcessedAudioPayloadV1, deriveAvgProcessedAudioAssetV1, deriveAvgProcessedAudioRightsV1,
  assertAvgProcessedAudioArtifactV1, type AvgProcessedAudioArtifactFieldsV1 } from '../../src/lib/avg/processed-audio-contract'
import type { AvgAudioPcmKindV1, AvgAudioProcessingRecipeV1 } from '../../src/lib/avg/audio-processing-contract'
import { avgSoundPcmFixtureV1 } from '../helpers/avg-sound-wire-data'
import { avgAudioProcessingExecutionReadyV1 } from '../../src/lib/avg/audio-production-brief'
import { executeAvgAudioProcessingTaskV1 } from '../../src/lib/avg/audio-processing-executor'
import { createAvgAssemblyExecutorV1 } from '../../src/lib/avg/assembly-executor'
import { createAvgSoundPlanningExecutorV1 } from '../../src/lib/avg/sound-planning-executor'

// Actual original engineering PCM/WAV bytes and arithmetic, not neural
// inference, actual durable producer, browser audition or author adoption.
async function fixture(kind: AvgAudioPcmKindV1 = 'voice', gainMilliDb = -6000) {
  const data = avgSoundPcmFixtureV1(.01), before = data.slice(0), hash = await sha256MediaData(data)
  const recipe: AvgAudioProcessingRecipeV1 = { schema: 'storyforge.avg.audio-processing-recipe', version: 1, gainMilliDb,
    maximumDurationMs: 1000, sampleRatePolicy: 'preserve', channelPolicy: 'preserve', timelinePolicy: 'preserve',
    overflowPolicy: 'reject', declaration: '工程原件的明确本地增益；原权利和试听/作者决定继续独立。' }
  const processed = await processAvgAudioPcmWaveV1({ data, source: { contentHash: hash, mimeType: 'audio/wav', kind }, recipe })
  expect(data).toEqual(before)
  const sourceAsset: FrozenRuntimeMediaAssetV2 = { assetKey: 'audio.fixture', version: 1, kind,
    name: '原创工程PCM', altText: '仅验证加工链', mimeType: 'audio/wav', byteSize: data.byteLength,
    contentHash: hash, blobContentHash: hash, width: null, height: null, durationMs: processed.receipt.source.durationMs,
    source: 'fixture:original-pcm', license: 'unreviewed-fixture', characterTag: kind === 'voice' ? 'keeper' : '', sceneTag: 'desk' }
  const domain = kind === 'voice' ? 'voice' as const : 'sound' as const
  const payload = await parseAvgProcessedAudioPayloadV1({ schema: 'storyforge.avg.processed-audio', version: 1,
    domain, requirementKey: 'fixture.audio', requestIdentityHash: 'b'.repeat(64),
    raw: { artifactKey: 'avg.' + domain + '.raw.fixture.audio', version: 3, contentHash: hash, producerReceiptHash: 'a'.repeat(64) },
    sourceAsset, recipe, receipt: processed.receipt })
  const sourceRights = { origin: 'fixture', commercialUse: null, requiresAuthorReview: true, declarationHash: 'c'.repeat(64) }
  const asset = deriveAvgProcessedAudioAssetV1(payload), rights = await deriveAvgProcessedAudioRightsV1(payload, sourceRights)
  const row: AvgProcessedAudioArtifactFieldsV1 = { artifactKey: 'avg.' + domain + '.processed.fixture.audio',
    kind: 'audio', mediaKind: kind, payloadJson: canonicalProductProductionJsonV2(payload),
    metadataJson: canonicalProductProductionJsonV2(asset), rightsJson: canonicalProductProductionJsonV2(rights),
    contentHash: asset.contentHash, mimeType: 'audio/wav', byteSize: asset.byteSize }
  return { data, processed, payload, asset, rights, row, input: {
    entry: { domain, requirementKey: 'fixture.audio', recipe },
    source: { raw: payload.raw, asset: sourceAsset, requestIdentityHash: payload.requestIdentityHash, rights: sourceRights }, row } }
}
beforeEach(() => { vi.stubEnv('VITE_STORYFORGE_AVG_AUDIO_PROCESSING', '0')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network permitted for candidate codecs') })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('AVG exact processed audio candidate identity and unchanged raw rights', () => {
  it.each(['voice', 'bgm', 'sfx', 'ambience'] as const)('binds actual %s WAV bytes to distinct raw/processed versions without adopting', async kind => {
    const f = await fixture(kind), result = await assertAvgProcessedAudioArtifactV1(f.input)
    expect(result.asset).toMatchObject({ assetKey: f.payload.sourceAsset.assetKey, version: 2, kind,
      characterTag: f.payload.sourceAsset.characterTag, sceneTag: 'desk', license: 'unreviewed-fixture',
      contentHash: await sha256MediaData(f.processed.data), source: 'storyforge.avg.pcm16-gain.v1' })
    expect(result.payload.raw).toEqual(f.input.source.raw)
    expect(result.payload.requestIdentityHash).toBe('b'.repeat(64))
    expect(result.rights).toMatchObject({ requiresAuthorReview: true, commercialUse: null,
      sourceContentHash: await sha256MediaData(f.data), sourceProducerReceiptHash: 'a'.repeat(64) })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('retains separate raw/processed identities even when zero gain reuses identical physical bytes', async () => {
    const f = await fixture('voice', 0)
    await expect(assertAvgProcessedAudioArtifactV1(f.input)).resolves.toMatchObject({ asset: { version: 2 } })
    expect(f.processed.data).toEqual(f.data)
    expect(f.row.contentHash).toBe(f.payload.raw.contentHash)
    expect(f.row.artifactKey).not.toBe(f.payload.raw.artifactKey)
    expect(f.payload.raw.version).toBe(3)
  })

  it('rejects a self-consistent renamed licence/actor because the original frozen source is independent', async () => {
    const f = await fixture(), forged = await parseAvgProcessedAudioPayloadV1({ ...f.payload,
      sourceAsset: { ...f.payload.sourceAsset, license: 'commercial-granted', characterTag: 'another-speaker' } })
    const row = { ...f.row, payloadJson: canonicalProductProductionJsonV2(forged),
      metadataJson: canonicalProductProductionJsonV2(deriveAvgProcessedAudioAssetV1(forged)),
      rightsJson: canonicalProductProductionJsonV2(await deriveAvgProcessedAudioRightsV1(forged, f.input.source.rights)) }
    await expect(assertAvgProcessedAudioArtifactV1({ ...f.input, row })).rejects.toThrow(/原请求\/版本\/权利/)
  })

  it('rejects a different frozen recipe, raw producer/version or original request even with valid local receipt hashes', async () => {
    const f = await fixture()
    await expect(assertAvgProcessedAudioArtifactV1({ ...f.input,
      entry: { ...f.input.entry, recipe: { ...f.input.entry.recipe, gainMilliDb: -5000 } } })).rejects.toThrow()
    for (const raw of [{ ...f.input.source.raw, version: 2 }, { ...f.input.source.raw, producerReceiptHash: 'd'.repeat(64) }]) {
      await expect(assertAvgProcessedAudioArtifactV1({ ...f.input, source: { ...f.input.source, raw } })).rejects.toThrow()
    }
    await expect(assertAvgProcessedAudioArtifactV1({ ...f.input, source: { ...f.input.source,
      requestIdentityHash: 'e'.repeat(64) } })).rejects.toThrow()
  })

  it('rejects granting commercial permission or replacing a processed hash with the raw audio', async () => {
    const f = await fixture()
    await expect(assertAvgProcessedAudioArtifactV1({ ...f.input, row: { ...f.row,
      rightsJson: canonicalProductProductionJsonV2({ ...f.rights, commercialUse: true, requiresAuthorReview: false }) } })).rejects.toThrow()
    await expect(assertAvgProcessedAudioArtifactV1({ ...f.input, row: { ...f.row,
      contentHash: f.payload.raw.contentHash, metadataJson: canonicalProductProductionJsonV2(f.payload.sourceAsset) } })).rejects.toThrow()
    const changedSource = { ...f.input.source, rights: { ...f.input.source.rights, declarationHash: 'f'.repeat(64) } }
    await expect(assertAvgProcessedAudioArtifactV1({ ...f.input, source: changedSource })).rejects.toThrow()
  })

  it('rejects undeclared versions, approval fields and cross-domain raw references', async () => {
    const f = await fixture()
    for (const body of [{ ...f.payload, version: 2 }, { ...f.payload, authorAdopted: true },
      { ...f.payload, domain: 'sound' }, { ...f.payload, raw: { ...f.payload.raw, producerRunId: 1 } },
      { ...f.payload, sourceAsset: { ...f.payload.sourceAsset, mimeType: 'audio/ogg' } }]) {
      await expect(parseAvgProcessedAudioPayloadV1(body)).rejects.toThrow()
    }
  })

  it('captures raw identity, metadata, recipe and original rights before asynchronous hash work', async () => {
    const f = await fixture(), body = structuredClone(f.payload)
    const pending = parseAvgProcessedAudioPayloadV1(body)
    body.raw.producerReceiptHash = 'd'.repeat(64); body.sourceAsset.license = 'changed'; body.recipe.gainMilliDb = 0
    expect(await pending).toEqual(f.payload)
    const candidate = structuredClone(f.input), validation = assertAvgProcessedAudioArtifactV1(candidate)
    candidate.source.requestIdentityHash = 'e'.repeat(64); candidate.source.rights.declarationHash = 'f'.repeat(64)
    candidate.entry.recipe.gainMilliDb = 0
    await expect(validation).resolves.toMatchObject({ payload: f.payload })
    const rightsPayload = structuredClone(f.payload), originalRights = structuredClone(f.input.source.rights)
    const rights = deriveAvgProcessedAudioRightsV1(rightsPayload, originalRights)
    rightsPayload.sourceAsset.license = 'changed'; rightsPayload.recipe.declaration = 'changed'; originalRights.declarationHash = 'e'.repeat(64)
    expect(await rights).toEqual(f.rights)
  })
})

describe('AVG incomplete processing cannot bypass the original factory fences', () => {
  it('rejects direct task execution and both original factories before any transport or Worker', async () => {
    expect(avgAudioProcessingExecutionReadyV1()).toBe(false)
    const worker = vi.fn(() => { throw new Error('No Worker permitted before readiness') })
    vi.stubGlobal('Worker', worker)
    const plan = { schema: 'storyforge.avg.audio-production-processing-plan', version: 1, entries: [] }
    const request = { scope: { projectId: 1, worldGroupId: 1, workId: 1 }, task: {}, inputArtifacts: [],
      capabilityBindings: [], signal: new AbortController().signal } as never
    await expect(executeAvgAudioProcessingTaskV1(request, { avgAudioProcessing: plan } as never)).rejects.toThrow(/尚未就绪/)
    expect(() => createAvgAssemblyExecutorV1({ production: { productionKey: 'fixture' },
      brief: { avgAudioProcessing: plan } } as never)).toThrow(/加工尚未就绪/)
    expect(() => createAvgSoundPlanningExecutorV1({ brief: { avgAudioProcessing: plan } } as never)).toThrow(/加工尚未就绪/)
    expect(worker).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })
})
