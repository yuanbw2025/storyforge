import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { ProductBuildArtifactRecordV1 } from '../../src/lib/types'
import { canonicalStringify } from '../../src/lib/agent/run/hash'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { putMediaBlobObject, sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import * as artifacts from '../../src/lib/product-production/artifact-store'
import * as decoder from '../../src/lib/avg/voice-decoder'
import * as responses from '../../src/lib/avg/voice-response-proof'
import { assertAvgOriginalVoiceResponseV1 } from '../../src/lib/avg/voice-response-proof'
import { assertAvgVoiceResponseEvidenceV1 } from '../../src/lib/avg/voice-response-contract'
import { readAvgChosenVoiceSourceV1 } from '../../src/lib/avg/voice-choice-validation'
import { avgRawVoiceFixtureV1 } from '../helpers/avg-voice-production-fixture'
import { avgReadingAudioFixture } from '../helpers/avg-reading-fixture'
import { seedAvgAuthorStageInputs } from '../helpers/avg-author-stage-fixture'
import { encodeAvgRawVoicePayloadV1 } from '../../src/lib/avg/voice-raw-contract'
import type { AvgAuthorVoiceChoiceV1 } from '../../src/lib/avg/voice-choice-contract'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })

async function wireFixture() {
  const s = await avgRawVoiceFixtureV1(), audio = await avgReadingAudioFixture(500)
  Object.assign(s.payload.measurement, { contentHash: audio.asset.contentHash, byteSize: audio.data.byteLength,
    durationMs: 500, sourceSampleRateHz: 16000, sampleCount: 8000 })
  Object.assign(s.asset, { contentHash: audio.asset.contentHash, blobContentHash: audio.asset.contentHash,
    byteSize: audio.data.byteLength, durationMs: 500 })
  const binary = Array.from(new Uint8Array(audio.data), byte => String.fromCharCode(byte)).join('')
  const receipt = { schema: 'storyforge.avg.voice-provider-response', version: 1,
    requestIdentityHash: s.payload.request.identityHash, requestBodyHash: s.payload.request.requestBodyHash,
    endpointRouteHash: s.payload.request.endpointRouteHash, status: 200, contentType: 'audio/wav',
    providerRequestId: s.payload.provider.providerRequestId, usage: null, costUsd: null, omissions: [], bodyComplete: true,
    observedBytes: audio.data.byteLength, bodyHash: audio.asset.contentHash, hashScope: 'full-body', bodyBase64: btoa(binary), bodyOmitted: null }
  const evidence = canonicalStringify(receipt), responseEvidenceHash = await sha256Text(evidence)
  return { ...s, audio, receipt, evidence, responseEvidenceHash }
}

describe('AVG saved voice response byte proof', () => {
  it('recovers exact original PCM from a complete bounded receipt without a credential, decoder pass or adoption', async () => {
    const s = await wireFixture(), checked = await assertAvgVoiceResponseEvidenceV1({ evidence: s.evidence, raw: s.payload })
    expect(checked.data).toEqual(s.audio.data); expect(checked.responseEvidenceHash).toBe(s.responseEvidenceHash)
    expect(checked).not.toHaveProperty('authorAccepted'); expect(checked).not.toHaveProperty('commercialUse')
  })

  it.each(['identity', 'body-identity', 'route', 'http', 'mime', 'partial', 'omitted', 'usage', 'cost', 'request-id', 'hash', 'byte-size', 'base64', 'omissions'])(
    'rejects %s evidence instead of trusting received/decoderVerified flags', async variant => {
      const s = await wireFixture(), r: Record<string, unknown> = { ...s.receipt }
      if (variant === 'identity') r.requestIdentityHash = 'd'.repeat(64)
      if (variant === 'body-identity') r.requestBodyHash = 'd'.repeat(64)
      if (variant === 'route') r.endpointRouteHash = 'd'.repeat(64)
      if (variant === 'http') r.status = 401
      if (variant === 'mime') r.contentType = 'other'
      if (variant === 'partial') { r.bodyComplete = false; r.hashScope = 'retained-prefix' }
      if (variant === 'omitted') { r.bodyBase64 = null; r.bodyOmitted = 'policy' }
      if (variant === 'usage') r.usage = { billed: 1 }
      if (variant === 'cost') r.costUsd = 0
      if (variant === 'request-id') r.providerRequestId = 'different.request'
      if (variant === 'hash') r.bodyHash = 'd'.repeat(64)
      if (variant === 'byte-size') r.observedBytes = s.audio.data.byteLength + 2
      if (variant === 'base64') r.bodyBase64 = '!' + s.receipt.bodyBase64.slice(1)
      if (variant === 'omissions') r.omissions = ['usage-policy']
      await expect(assertAvgVoiceResponseEvidenceV1({ evidence: canonicalStringify(r), raw: s.payload })).rejects.toThrow()
    })

  it('detects modified PCM despite matching metadata, and rejects contradictory source frames', async () => {
    const s = await wireFixture(), changed = new Uint8Array(s.audio.data.slice(0)); changed[100] = changed[100]! ^ 1
    const r = { ...s.receipt, bodyBase64: btoa(Array.from(changed, byte => String.fromCharCode(byte)).join('')) }
    await expect(assertAvgVoiceResponseEvidenceV1({ evidence: canonicalStringify(r), raw: s.payload })).rejects.toThrow()
    const raw = structuredClone(s.payload); raw.measurement.sourceSampleRateHz = 24000; raw.measurement.sampleCount = 12000
    await expect(assertAvgVoiceResponseEvidenceV1({ evidence: s.evidence, raw })).rejects.toThrow()
  })

  it('rejects noncanonical receipts and forbidden material hidden inside otherwise valid PCM Base64', async () => {
    const s = await wireFixture()
    await expect(assertAvgVoiceResponseEvidenceV1({ evidence: JSON.stringify(s.receipt, null, 2), raw: s.payload })).rejects.toThrow()
    const bytes = new Uint8Array(s.audio.data.slice(0)); bytes.set(new TextEncoder().encode('Bearer fixtureForbiddenSecret123456789'), 128)
    const contentHash = await sha256MediaData(bytes.buffer), raw = structuredClone(s.payload)
    raw.measurement.contentHash = contentHash
    const evidence = canonicalStringify({ ...s.receipt, bodyHash: contentHash,
      bodyBase64: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')) })
    await expect(assertAvgVoiceResponseEvidenceV1({ evidence, raw })).rejects.toThrow(/密钥|认证/)
  })

  it('does not read a bare project-wide receipt through an invented producer Run', async () => {
    const s = await choiceFixture(false)
    await expect(assertAvgOriginalVoiceResponseV1({ scope: s.owner.scope, row: s.row, raw: s.payload })).rejects.toThrow()
    await expect(readAvgChosenVoiceSourceV1(s.input)).rejects.toThrow()
  }, 30_000)
})

/** Real isolated Work/Blob bytes; sealed producer and browser decode are
 * explicitly replaced for leaf composition tests while V3 is unadmitted.
 * These mocks do not establish actual Run/start/adoption/browser acceptance. */
async function choiceFixture(mockProof = true) {
  const s = await wireFixture(), owner = await seedAvgAuthorStageInputs(), build = (await db.productBuilds.get(owner.buildId))!
  const blob = await putMediaBlobObject({ scope: owner.scope, data: s.audio.data, mimeType: 'audio/wav', expectedContentHash: s.asset.contentHash })
  const row: ProductBuildArtifactRecordV1 = { ...s.row, id: 999, projectId: owner.scope.projectId, worldId: owner.scope.worldId,
    workId: owner.scope.workId!, buildId: owner.buildId, requirementKey: 'avg.media.voice', version: 1, status: 'accepted',
    producerRunId: 777, producerReceiptHash: 'a'.repeat(64), controlEpoch: build.controlEpoch, inputHash: 'b'.repeat(64),
    payloadJson: canonicalProductProductionJsonV2(await encodeAvgRawVoicePayloadV1(s.payload)), metadataJson: canonicalProductProductionJsonV2(s.asset),
    contentHash: s.asset.contentHash, byteSize: s.asset.byteSize,
    qualityJson: canonicalProductProductionJsonV2({ received: true, rawResponseRecorded: true, responseEvidenceHash: s.responseEvidenceHash }),
    blobObjectId: blob.id!, parentArtifactHash: null, carriedFrom: null, createdAt: 1, updatedAt: 1 }
  const verify = vi.spyOn(artifacts, 'verifyAcceptedProductBuildArtifactV1').mockImplementation(async () => structuredClone(row))
  const response = mockProof ? vi.spyOn(responses, 'assertAvgOriginalVoiceResponseV1').mockResolvedValue({ data: s.audio.data, responseEvidenceHash: s.responseEvidenceHash }) : null
  const decode = vi.spyOn(decoder, 'inspectAvgVoiceBytesV1').mockResolvedValue({ data: s.audio.data,
    measurement: { ...s.payload.measurement, decodedSampleRateHz: 44100, integratedLufs: -17.5 } })
  const choice: AvgAuthorVoiceChoiceV1 = { schema: 'storyforge.avg.voice-choice', version: 1, requirementKey: 'keeper.line',
    requestIdentityHash: s.payload.request.identityHash, raw: { artifactKey: row.artifactKey, version: 1, contentHash: row.contentHash },
    review: { artifactKey: 'avg.review.audio.keeper.line', version: 1, contentHash: 'd'.repeat(64) }, asset: s.asset, declaration: '工程待确认选择' }
  return { ...s, owner, row, blob, verify, response, decode,
    input: { scope: owner.scope, buildId: owner.buildId, assembly: s.assembly, capability: s.capability, choice } }
}

describe('AVG chosen voice technical source composition', () => {
  it('checks actual same-Work Blob while allowing device resampling; it creates no review, author receipt or reading binding', async () => {
    const s = await choiceFixture(), count = await db.productBuildArtifacts.count(), result = await readAvgChosenVoiceSourceV1(s.input)
    expect(result.blobObjectId).toBe(s.blob.id); expect(result.validation).toMatchObject({ sourceSampleRateHz: 16000, sampleCount: 8000,
      responseEvidenceHash: s.responseEvidenceHash, durationMs: 500, contentHash: s.asset.contentHash })
    expect(result.validation).not.toHaveProperty('decodedSampleRateHz'); expect(result.validation).not.toHaveProperty('authorAccepted')
    expect(s.verify).toHaveBeenCalledTimes(2); expect(await db.productBuildArtifacts.count()).toBe(count)
  }, 30_000)

  it.each(['foreign-blob', 'corrupt-blob', 'wrong-identity', 'changed-producer', 'changed-decode'])(
    'refuses %s instead of selecting by metadata alone', async variant => {
      const s = await choiceFixture()
      if (variant === 'foreign-blob') await db.mediaBlobObjects.update(s.blob.id!, { workId: s.owner.scope.workId! + 999 })
      if (variant === 'corrupt-blob') await db.mediaBlobObjects.update(s.blob.id!, { data: new ArrayBuffer(s.audio.data.byteLength) })
      if (variant === 'wrong-identity') s.input.choice.requestIdentityHash = 'd'.repeat(64)
      if (variant === 'changed-producer') s.verify.mockResolvedValueOnce(structuredClone(s.row)).mockResolvedValueOnce({ ...s.row, producerReceiptHash: 'e'.repeat(64) })
      if (variant === 'changed-decode') s.decode.mockResolvedValueOnce({ data: s.audio.data, measurement: { ...s.payload.measurement, sampleCount: 7999 } })
      await expect(readAvgChosenVoiceSourceV1(s.input)).rejects.toThrow()
    }, 30_000)
})
