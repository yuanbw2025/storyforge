import { describe, expect, it } from 'vitest'
import { avgRawVoiceFixtureV1, avgVoiceAssemblyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { canonicalStringify } from '../../src/lib/agent/run/hash'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { hashAvgVoiceTextV1 } from '../../src/lib/avg/voice-production-contract'
import { compileAvgVoiceSpeechRequestV1, hashAvgSpeechProtocolV1 } from '../../src/lib/avg/voice-request-contract'
import { avgVoiceRouteBindingHashV1, type AvgAssemblyBriefV3 } from '../../src/lib/avg/voice-assembly-contract'
import { encodeAvgStoredAssemblyBriefV3, assertAvgStoredAssemblyBriefV3 } from '../../src/lib/avg/voice-assembly-storage'
import { AVG_VOICE_EXACT_STORAGE_LIMIT_V1, decodeAvgVoiceExactStorageV1, encodeAvgVoiceExactStorageV1 } from '../../src/lib/avg/voice-exact-storage'
import { assertAvgRawVoiceArtifactV1, avgVoiceRightsReceiptV1, encodeAvgRawVoicePayloadV1 } from '../../src/lib/avg/voice-raw-contract'
import { parseAvgAssemblyBrief } from '../../src/lib/avg/assembly-contract'

async function unicode(a: AvgAssemblyBriefV3) {
  const p = a.voice.protocol, preset = a.voice.batch.presets[0]!, r = a.voice.batch.requirements[0]!
  p.model = 'speech-e\u0301'; p.voices[0]!.voiceId = 'voice-e\u0301'
  p.supportsInstructions = true; p.maximumInstructionsCharacters = 4096
  preset.model = p.model; preset.voiceId = p.voices[0]!.voiceId; preset.capabilityHash = await hashAvgSpeechProtocolV1(p)
  preset.rights.declaration = '工程声明 e\u0301'; preset.rights.reference = 'fixture-e\u0301'
  r.text = 'e\u0301，封口仍在。'; r.textHash = await hashAvgVoiceTextV1(r.text); r.performance.instructions = '轻声强调 e\u0301，保留原句。'
  a.voice.binding.bindingHash = await avgVoiceRouteBindingHashV1({ requirementKey: a.voice.binding.requirementKey,
    adapterId: p.adapterId, capabilityHash: preset.capabilityHash, endpointRouteHash: p.endpointRouteHash })
  return compileAvgVoiceSpeechRequestV1(a.voice.batch, r.requirementKey, p)
}

describe('AVG exact voice packets through existing canonical production storage', () => {
  it('preserves exact text/model/voice/delivery through nested Brief, command and checkpoint serializers', async () => {
    const { assembly } = await avgVoiceAssemblyFixtureV3(), request = await unicode(assembly)
    const stored = await encodeAvgStoredAssemblyBriefV3(assembly)
    expect(stored.voice.payloadJson).toMatch(/^[\x20-\x7e]*$/)
    // These are serializer probes only, not an admitted full production Brief,
    // persisted DB, author start or real candidate/Run authority.
    const command = { type: 'save-brief-revision', brief: { schema: 'storyforge.product-production-brief', version: 3, avgAssembly: stored } }
    const checkpoint = JSON.parse(canonicalProductProductionJsonV2({ commandJson: canonicalProductProductionJsonV2(command) }))
    const read = JSON.parse(checkpoint.commandJson).brief.avgAssembly
    const resolved = await assertAvgStoredAssemblyBriefV3(read)
    expect(resolved.assembly).toEqual(assembly); expect(resolved.requests[0]).toEqual(request)
    expect(JSON.parse(resolved.requests[0]!.requestBodyJson)).toMatchObject({ input: assembly.voice.batch.requirements[0]!.text,
      model: 'speech-e\u0301', voice: 'voice-e\u0301' })
    expect(parseAvgAssemblyBrief(stored)).toEqual(stored)
    expect(() => parseAvgAssemblyBrief(assembly)).toThrow()
  })

  it('makes distinct Unicode packets distinct under V2 hashes without changing old normalization behavior', async () => {
    const value = { schema: 'storyforge.avg.raw-voice', version: 1, note: 'é' }
    const nfc = await encodeAvgVoiceExactStorageV1('raw-voice', value)
    const nfd = await encodeAvgVoiceExactStorageV1('raw-voice', { ...value, note: 'e\u0301' })
    expect(await hashProductProductionValueV2(value)).toBe(await hashProductProductionValueV2({ ...value, note: 'e\u0301' }))
    expect(await hashProductProductionValueV2(nfc)).not.toBe(await hashProductProductionValueV2(nfd))
    expect((await decodeAvgVoiceExactStorageV1(JSON.parse(canonicalProductProductionJsonV2(nfd)), 'raw-voice')).payload).toEqual({ ...value, note: 'e\u0301' })
  })

  it('keeps raw metadata exact through actual candidate/Artifact JSON serializers while rights use portable declaration hashes', async () => {
    const s = await avgRawVoiceFixtureV1(), request = await unicode(s.assembly)
    s.capability.capabilityHash = s.assembly.voice.batch.presets[0]!.capabilityHash
    Object.assign(s.payload, { request, capabilityBindingHash: s.assembly.voice.binding.bindingHash })
    s.payload.rights.declaration = s.payload.preset.rights.declaration; s.payload.rights.reference = s.payload.preset.rights.reference
    const rights = await avgVoiceRightsReceiptV1(s.payload.rights)
    const candidate = JSON.parse(canonicalProductProductionJsonV2({ result: { artifacts: [{
      payload: await encodeAvgRawVoicePayloadV1(s.payload), metadata: s.asset, rights,
    }] } })).result.artifacts[0]
    const row = { ...s.row, payloadJson: canonicalProductProductionJsonV2(candidate.payload),
      metadataJson: canonicalProductProductionJsonV2(candidate.metadata), rightsJson: canonicalProductProductionJsonV2(candidate.rights) }
    const actual = await assertAvgRawVoiceArtifactV1({ ...s, row })
    expect(actual.payload).toEqual(s.payload)
    expect(actual.payload.requirement.text).toContain('e\u0301')
    expect(actual.payload.request.requestBodyHash).toBe(await sha256Text(request.requestBodyJson))
    expect(rights.declarationHash).toBe(await sha256Text(s.payload.rights.declaration)); expect(rights.commercialUse).toBeNull()
    expect(rights).not.toHaveProperty('declaration'); expect(rights).not.toHaveProperty('reference')
    await expect(assertAvgRawVoiceArtifactV1({ ...s, row: { ...row,
      rightsJson: canonicalProductProductionJsonV2({ ...rights, declarationHash: 'a'.repeat(64) }) } })).rejects.toThrow(/权利/)
  })

  it('rejects changed hashes, encodings, noncanonical text, raw Unicode and wrong packet kinds', async () => {
    const value = { schema: 'storyforge.avg.raw-voice', version: 1, note: 'e\u0301' }
    const packet = await encodeAvgVoiceExactStorageV1('raw-voice', value)
    for (const patch of [{ contentHash: 'a'.repeat(64) }, { encoding: 'base64' }, { payloadJson: ' ' + packet.payloadJson },
      { payloadJson: JSON.stringify(value) }, { kind: 'assembly-voice' }, { unexpected: true }]) {
      await expect(decodeAvgVoiceExactStorageV1({ ...packet, ...patch }, 'raw-voice')).rejects.toThrow()
    }
    await expect(encodeAvgVoiceExactStorageV1('raw-voice', { schema: 'not-voice', version: 1 })).rejects.toThrow()
  })

  it('checks decoded safety before writing and after reading, including a correctly hashed forged envelope', async () => {
    for (const sensitive of [{ apiKey: 'short-secret' }, { reasoning_content: 'hidden' }]) {
      const value = { schema: 'storyforge.avg.raw-voice', version: 1, provider: { usage: sensitive } }
      await expect(encodeAvgVoiceExactStorageV1('raw-voice', value)).rejects.toThrow()
      const payloadJson = canonicalStringify(value)
      await expect(decodeAvgVoiceExactStorageV1({ schema: 'storyforge.avg.exact-voice-storage', version: 1,
        kind: 'raw-voice', encoding: 'ascii-json-v1', payloadJson, contentHash: await sha256Text(payloadJson) }, 'raw-voice')).rejects.toThrow()
    }
  })

  it('bounds complete encoded input and refuses unsupported JSON instead of dropping fields or truncating', async () => {
    const base = { schema: 'storyforge.avg.raw-voice', version: 1 }
    for (const value of [{ ...base, extra: undefined }, { ...base, extra: NaN }, { ...base, extra: new Date(0) }, { ...base, extra: Array(1) }]) {
      await expect(encodeAvgVoiceExactStorageV1('raw-voice', value)).rejects.toThrow()
    }
    const large = { ...base, text: '汉'.repeat(Math.ceil(AVG_VOICE_EXACT_STORAGE_LIMIT_V1 / 6)) }
    await expect(encodeAvgVoiceExactStorageV1('raw-voice', large)).rejects.toThrow(/拆批/)
  })
})
