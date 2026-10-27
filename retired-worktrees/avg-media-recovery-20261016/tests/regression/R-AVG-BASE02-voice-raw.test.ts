import { describe, expect, it } from 'vitest'
import { avgRawVoiceFixtureV1 } from '../helpers/avg-voice-production-fixture'
import { assertAvgRawVoiceArtifactV1, parseAvgVoiceByteMeasurementV1, encodeAvgRawVoicePayloadV1 } from '../../src/lib/avg/voice-raw-contract'
import { compileAvgVoiceSpeechRequestV1 } from '../../src/lib/avg/voice-request-contract'
import { encodeAvgVoiceExactStorageV1 } from '../../src/lib/avg/voice-exact-storage'

describe('AVG BASE-02 exact raw voice metadata', () => {
  it('retains unknown actual cost and unreviewed provider rights without claiming Work, bytes or audition authority', async () => {
    const s = await avgRawVoiceFixtureV1(), result = await assertAvgRawVoiceArtifactV1(s)
    expect(result.payload.provider.costUsd).toBeNull()
    expect(result.payload.rights.commercialUse).toBeNull()
    expect(result.payload.rights.requiresProviderTermsReview).toBe(true)
    expect(result.asset.kind).toBe('voice')
    expect(Object.keys(result)).toEqual(['asset', 'payload'])
    expect(result.payload).not.toHaveProperty('authorAccepted')
    expect(result.payload).not.toHaveProperty('artisticPass')
  })

  it.each(['text', 'speakerKey', 'performance', 'presetRevision'] as const)('rejects a changed %s rather than reusing old audio', async field => {
    const s = await avgRawVoiceFixtureV1(), changed = structuredClone(s.payload)
    if (field === 'text') changed.requirement.text = '封口已经打开。'
    else if (field === 'speakerKey') changed.requirement.speakerKey = null
    else if (field === 'performance') changed.requirement.performance.revision++
    else changed.requirement.presetRevision++
    await expect(assertAvgRawVoiceArtifactV1({ ...s, row: { ...s.row, payloadJson: JSON.stringify(await encodeAvgRawVoicePayloadV1(changed)) } })).rejects.toThrow()
  })

  it('rejects stale or modified request identity and a forged capability route', async () => {
    const s = await avgRawVoiceFixtureV1()
    for (const request of [{ ...s.payload.request, requestBodyJson: '{}' }, { ...s.payload.request, identityHash: 'd'.repeat(64) },
      { ...s.payload.request, requestBodyHash: 'd'.repeat(64) }]) {
      await expect(assertAvgRawVoiceArtifactV1({ ...s, row: { ...s.row, payloadJson: JSON.stringify(await encodeAvgRawVoicePayloadV1({ ...s.payload, request })) } })).rejects.toThrow(/实际请求体/)
    }
    const assembly = structuredClone(s.assembly); assembly.voice.binding.bindingHash = 'd'.repeat(64)
    await expect(assertAvgRawVoiceArtifactV1({ ...s, assembly })).rejects.toThrow(/绑定 hash/)
  })

  it('does not disguise a voice artifact as SFX, another consumer or another binary', async () => {
    const s = await avgRawVoiceFixtureV1()
    for (const row of [{ ...s.row, mediaKind: 'sfx' as const }, { ...s.row, artifactKey: 'avg.voice.raw.other' },
      { ...s.row, mimeType: 'audio/mpeg' }, { ...s.row, contentHash: 'd'.repeat(64) }, { ...s.row, byteSize: 48_042 }]) {
      await expect(assertAvgRawVoiceArtifactV1({ ...s, row })).rejects.toThrow()
    }
    await expect(assertAvgRawVoiceArtifactV1({ ...s, row: { ...s.row, metadataJson: JSON.stringify({ ...s.asset, characterTag: 'other' }) } })).rejects.toThrow(/说话人/)
  })

  it('refuses inferred or contradictory sample duration, silent evidence and malformed measured values', async () => {
    const s = await avgRawVoiceFixtureV1()
    for (const patch of [{ sampleCount: 24_001 }, { durationMs: 2000 }, { channelCount: 2 }, { truePeakDbtp: -200 },
      { integratedLufs: Number.NaN }, { durationEstimated: true }]) {
      expect(() => parseAvgVoiceByteMeasurementV1({ ...s.payload.measurement, ...patch })).toThrow()
    }
    const changed = structuredClone(s.assembly); changed.voice.batch.requirements[0]!.maximumDurationMs = 1000
    const payload = structuredClone(s.payload)
    payload.requirement.maximumDurationMs = 1000; payload.measurement.sampleCount = 24_001; payload.measurement.byteSize += 2
    payload.request = await compileAvgVoiceSpeechRequestV1(changed.voice.batch, payload.requirement.requirementKey, changed.voice.protocol)
    await expect(assertAvgRawVoiceArtifactV1({ ...s, assembly: changed, row: { ...s.row, byteSize: 48_046, payloadJson: JSON.stringify(await encodeAvgRawVoicePayloadV1(payload)) } })).rejects.toThrow(/实际时长/)
  })

  it('rejects a commercial pass, a changed rights declaration and secret-bearing provider usage', async () => {
    const s = await avgRawVoiceFixtureV1()
    for (const rights of [{ ...s.payload.rights, commercialUse: true }, { ...s.payload.rights, declaration: '不同声明' },
      { ...s.payload.rights, requiresProviderTermsReview: false }]) {
      await expect(assertAvgRawVoiceArtifactV1({ ...s, row: { ...s.row, payloadJson: JSON.stringify(await encodeAvgVoiceExactStorageV1('raw-voice', { ...s.payload, rights })), rightsJson: JSON.stringify(rights) } })).rejects.toThrow(/权利/)
    }
    const provider = { ...s.payload.provider, usage: { apiKey: 'forbidden' } }
    await expect(encodeAvgRawVoicePayloadV1({ ...s.payload, provider })).rejects.toThrow()
  })

  it('preserves an explicitly reported zero but rejects unknown or over-limit cost under a finite request ceiling', async () => {
    const s = await avgRawVoiceFixtureV1(), provider = { ...s.payload.provider, costUsd: 0 }
    const row = { ...s.row, payloadJson: JSON.stringify(await encodeAvgRawVoicePayloadV1({ ...s.payload, provider })) }
    expect((await assertAvgRawVoiceArtifactV1({ ...s, row })).payload.provider.costUsd).toBe(0)
    const capability = { ...s.capability, maximumRequestCost: 0.1 }
    await expect(assertAvgRawVoiceArtifactV1({ ...s, capability })).rejects.toThrow(/费用/)
    await expect(assertAvgRawVoiceArtifactV1({ ...s, capability, row: { ...s.row, payloadJson: JSON.stringify(await encodeAvgRawVoicePayloadV1({ ...s.payload, provider: { ...provider, costUsd: 0.2 } })) } })).rejects.toThrow(/费用/)
  })
})
