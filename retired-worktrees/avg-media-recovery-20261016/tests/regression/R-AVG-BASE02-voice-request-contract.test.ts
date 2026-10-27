import { describe, expect, it } from 'vitest'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { hashAvgVoiceTextV1, type AvgVoiceProductionBatchV1 } from '../../src/lib/avg/voice-production-contract'
import {
  AVG_NATURAL_VOICE_INTENT_V1, compileAvgVoiceSpeechRequestV1, hashAvgSpeechProtocolV1,
  parseAvgSpeechProtocolV1, type AvgSpeechProtocolV1,
} from '../../src/lib/avg/voice-request-contract'

/** Inert request fixture. No accepted Work, real service or rights are asserted. */
async function fixture() {
  const protocol: AvgSpeechProtocolV1 = {
    schema: 'storyforge.avg.speech-protocol', version: 1, adapterId: 'storyforge.avg.compatible-speech.v1',
    provider: 'fixture', model: 'speech-fixture', endpointRouteHash: 'a'.repeat(64),
    voices: [{ voiceId: 'voice-a', locales: ['zh-CN'] }], outputFormat: 'wav',
    maximumInputCharacters: 4096, supportsInstructions: true, maximumInstructionsCharacters: 4096,
    speedRange: { minimum: 0.25, maximum: 4 },
  }
  const text = '  **封口**仍在。\n'
  const batch: AvgVoiceProductionBatchV1 = {
    schema: 'storyforge.avg.voice-production-batch', version: 1, sourceInputHash: 'b'.repeat(64), outputFormat: 'wav',
    presets: [{ presetKey: 'keeper.voice', revision: 1, adapterId: protocol.adapterId,
      provider: protocol.provider, model: protocol.model, voiceId: 'voice-a', locale: 'zh-CN',
      endpointRouteHash: protocol.endpointRouteHash, capabilityHash: await hashAvgSpeechProtocolV1(protocol),
      rights: { basis: 'provider-preset', declaration: '仅为请求编译测试，未取得真实声音权利。', reference: 'fixture' } }],
    requirements: [{ requirementKey: 'line.desk', assetKey: 'voice.desk', sceneKey: 'desk', lineKey: 'line.desk',
      speakerKey: 'keeper', locale: 'zh-CN', text, textRevision: 1, textHash: await hashAvgVoiceTextV1(text),
      script: { artifactKey: 'avg.content.scene-script.desk', version: 1, contentHash: 'c'.repeat(64) },
      presetKey: 'keeper.voice', presetRevision: 1,
      performance: { revision: 1, intent: AVG_NATURAL_VOICE_INTENT_V1, pronunciations: [], instructions: null, speed: null },
      maximumDurationMs: 30_000 }],
  }
  return { batch, protocol }
}

describe('AVG BASE-02 bounded speech wire request', () => {
  it('sends exact canonical words as input and keeps rights, timing, credentials and performance metadata off the wire', async () => {
    const { batch, protocol } = await fixture()
    const request = await compileAvgVoiceSpeechRequestV1(batch, 'line.desk', protocol)
    expect(JSON.parse(request.requestBodyJson)).toEqual({ input: batch.requirements[0]!.text, model: 'speech-fixture', voice: 'voice-a', response_format: 'wav' })
    expect(request.requestBodyHash).toBe(await hashProductProductionValueV2(JSON.parse(request.requestBodyJson)))
    expect(request.maximumDurationMs).toBe(30_000)
    for (const field of ['apiKey', 'baseUrl', 'rights', 'maximumDurationMs', 'textRevision', 'performanceRevision']) expect(request.requestBodyJson).not.toContain(`"${field}"`)
  })

  it('conveys actual delivery and pronunciation directions separately instead of changing spoken input', async () => {
    const { batch, protocol } = await fixture(), changed = structuredClone(batch)
    changed.requirements[0]!.performance = { revision: 2, intent: '急切但压低声音',
      pronunciations: [{ phrase: '封口', reading: 'fēng kǒu' }], instructions: '句末停顿。', speed: 1.2 }
    const request = await compileAvgVoiceSpeechRequestV1(changed, 'line.desk', protocol), body = JSON.parse(request.requestBodyJson)
    expect(body.input).toBe(batch.requirements[0]!.text)
    expect(body.instructions).toContain('急切但压低声音')
    expect(body.instructions).toContain('fēng kǒu')
    expect(body.speed).toBe(1.2)
    expect(request.textHash).toBe(batch.requirements[0]!.textHash)
    expect(request.performanceRevision).toBe(2)
  })

  it('refuses unsupported directions before any request can be dispatched', async () => {
    const { batch, protocol } = await fixture(), plain = { ...protocol, supportsInstructions: false, maximumInstructionsCharacters: 0 }
    batch.presets[0]!.capabilityHash = await hashAvgSpeechProtocolV1(plain)
    expect(await compileAvgVoiceSpeechRequestV1(batch, 'line.desk', plain)).toBeDefined()
    for (const performance of [
      { ...batch.requirements[0]!.performance, intent: '激动' },
      { ...batch.requirements[0]!.performance, instructions: '慢慢说' },
      { ...batch.requirements[0]!.performance, pronunciations: [{ phrase: '封口', reading: 'fēng kǒu' }] },
    ]) await expect(compileAvgVoiceSpeechRequestV1({ ...batch, requirements: [{ ...batch.requirements[0], performance }] }, 'line.desk', plain)).rejects.toThrow(/不能静默丢弃/)
  })

  it('refuses unsupported explicit speed rather than treating even 1.0 as an omitted request', async () => {
    const { batch, protocol } = await fixture(), plain = { ...protocol, speedRange: null }
    batch.presets[0]!.capabilityHash = await hashAvgSpeechProtocolV1(plain)
    batch.requirements[0]!.performance.speed = 1
    await expect(compileAvgVoiceSpeechRequestV1(batch, 'line.desk', plain)).rejects.toThrow(/语速/)
  })

  it('rejects a requested speed outside the frozen service range instead of clamping it to an allowed value', async () => {
    const { batch, protocol } = await fixture(), narrow = { ...protocol, speedRange: { minimum: 0.8, maximum: 1.2 } }
    batch.presets[0]!.capabilityHash = await hashAvgSpeechProtocolV1(narrow)
    batch.requirements[0]!.performance.speed = 0.5
    await expect(compileAvgVoiceSpeechRequestV1(batch, 'line.desk', narrow)).rejects.toThrow(/超出冻结服务范围/)
    expect(() => parseAvgSpeechProtocolV1({ ...narrow, speedRange: { minimum: 1.2, maximum: 0.8 } })).toThrow(/范围无效/)
  })

  it('refuses long input or combined directions without truncating, normalizing or splitting the canonical line', async () => {
    const { batch, protocol } = await fixture(), long = structuredClone(batch)
    long.requirements[0]!.text = '字'.repeat(4097)
    long.requirements[0]!.textHash = await hashAvgVoiceTextV1(long.requirements[0]!.text)
    await expect(compileAvgVoiceSpeechRequestV1(long, 'line.desk', protocol)).rejects.toThrow(/输入上限/)
    const directions = structuredClone(batch)
    directions.requirements[0]!.performance.intent = '演'.repeat(2000)
    directions.requirements[0]!.performance.instructions = '法'.repeat(4000)
    await expect(compileAvgVoiceSpeechRequestV1(directions, 'line.desk', protocol)).rejects.toThrow(/不能截断/)
  })

  it.each(['provider', 'model', 'endpointRouteHash'] as const)('does not let a rehashed protocol silently change frozen %s', async field => {
    const { batch, protocol } = await fixture(), changed = { ...protocol,
      [field]: field === 'endpointRouteHash' ? 'd'.repeat(64) : 'different-service' }
    batch.presets[0]!.capabilityHash = await hashAvgSpeechProtocolV1(changed)
    await expect(compileAvgVoiceSpeechRequestV1(batch, 'line.desk', changed)).rejects.toThrow(/绑定不一致/)
  })

  it('requires the exact voice catalog and capability identity instead of trusting a model name alone', async () => {
    const { batch, protocol } = await fixture(), changed = { ...protocol, voices: [{ voiceId: 'different-voice', locales: ['zh-CN' as const] }] }
    await expect(compileAvgVoiceSpeechRequestV1(batch, 'line.desk', changed)).rejects.toThrow(/绑定不一致/)
    batch.presets[0]!.capabilityHash = await hashAvgSpeechProtocolV1(changed)
    await expect(compileAvgVoiceSpeechRequestV1(batch, 'line.desk', changed)).rejects.toThrow(/准确音色/)
  })

  it('gives a retake a new identity even when exact text and serialized wire body are identical', async () => {
    const { batch, protocol } = await fixture(), changed = structuredClone(batch)
    changed.requirements[0]!.performance.revision++
    const first = await compileAvgVoiceSpeechRequestV1(batch, 'line.desk', protocol), retake = await compileAvgVoiceSpeechRequestV1(changed, 'line.desk', protocol)
    expect(retake.requestBodyHash).toBe(first.requestBodyHash)
    expect(retake.identityHash).not.toBe(first.identityHash)
  })

  it('preserves decomposed Unicode in spoken input, directions and provider identifiers instead of NFC rewriting', async () => {
    const { batch, protocol } = await fixture(), changed = structuredClone(batch), exactProtocol = structuredClone(protocol)
    exactProtocol.voices[0]!.voiceId = 'voice-e\u0301'
    changed.presets[0]!.voiceId = exactProtocol.voices[0]!.voiceId
    changed.presets[0]!.capabilityHash = await hashAvgSpeechProtocolV1(exactProtocol)
    changed.requirements[0]!.text = 'e\u0301 的原样台词。'
    changed.requirements[0]!.textHash = await hashAvgVoiceTextV1(changed.requirements[0]!.text)
    changed.requirements[0]!.performance.instructions = '保留 e\u0301 的准确指导。'
    const request = await compileAvgVoiceSpeechRequestV1(changed, 'line.desk', exactProtocol)
    const body = JSON.parse(request.requestBodyJson)
    expect(body.input).toBe(changed.requirements[0]!.text)
    expect(body.voice).toBe('voice-e\u0301')
    expect(body.instructions).toContain('保留 e\u0301 的准确指导。')
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.requestBodyJson))
    expect(request.requestBodyHash).toBe(Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''))
    expect(request.requestBodyHash).not.toBe(await hashProductProductionValueV2(body))
    expect(await hashAvgSpeechProtocolV1({ ...exactProtocol, voices: [{ voiceId: 'voice-é', locales: ['zh-CN'] }] }))
      .not.toBe(changed.presets[0]!.capabilityHash)
  })

  it('rejects unknown request items, stale text hashes, sparse catalogs and secret-bearing protocol fields', async () => {
    const { batch, protocol } = await fixture()
    await expect(compileAvgVoiceSpeechRequestV1(batch, 'missing', protocol)).rejects.toThrow(/冻结批次/)
    const changed = structuredClone(batch); changed.requirements[0]!.textHash = 'd'.repeat(64)
    await expect(compileAvgVoiceSpeechRequestV1(changed, 'line.desk', protocol)).rejects.toThrow(/台词 hash/)
    for (const value of [{ ...protocol, apiKey: 'forbidden' }, { ...protocol, voices: Array(1) }, { ...protocol, supportsInstructions: false }, { ...protocol, maximumInputCharacters: 4097 }]) expect(() => parseAvgSpeechProtocolV1(value)).toThrow()
  })
})
