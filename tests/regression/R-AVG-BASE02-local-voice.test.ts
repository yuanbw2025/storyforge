import { describe, expect, it, vi } from 'vitest'
import { avgVoiceAssemblyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { avgLocalVoiceProtocolV1, AVG_LOCAL_VOICE_BASE_URL_V1, AVG_LOCAL_VOICE_REVISION_V1, AVG_LOCAL_VOICE_PROVIDER_V1 } from '../../src/lib/avg/voice-local-profile'
import { compileAvgVoiceSpeechRequestV1, hashAvgSpeechProtocolV1 } from '../../src/lib/avg/voice-request-contract'
import { avgVoiceRouteBindingHashV1 } from '../../src/lib/avg/voice-assembly-contract'
import { createConfiguredAvgLocalVoiceTransportV1, createConfiguredAvgVoiceTransportV1 } from '../../src/lib/avg/voice-transport'
import { resolveAvgVoiceExecutionCapabilityV3 } from '../../src/lib/avg/media-capability'
import { useAIConfigStore } from '../../src/stores/ai-config'

async function fixture() {
  const { assembly, capabilities } = await avgVoiceAssemblyFixtureV3(), protocol = await avgLocalVoiceProtocolV1()
  const capability = { ...capabilities[0]!, capabilityHash: await hashAvgSpeechProtocolV1(protocol) }
  assembly.voice.protocol = protocol
  Object.assign(assembly.voice.batch.presets[0]!, { provider: protocol.provider, model: protocol.model, voiceId: 'Serena',
    endpointRouteHash: protocol.endpointRouteHash, capabilityHash: capability.capabilityHash })
  assembly.voice.binding.endpointRouteHash = protocol.endpointRouteHash
  assembly.voice.binding.bindingHash = await avgVoiceRouteBindingHashV1({ requirementKey: capability.requirementKey,
    adapterId: protocol.adapterId, capabilityHash: capability.capabilityHash, endpointRouteHash: protocol.endpointRouteHash })
  const request = await compileAvgVoiceSpeechRequestV1(assembly.voice.batch, assembly.voice.batch.requirements[0]!.requirementKey, protocol)
  const capabilityBody = { schema: 'storyforge.avg.local-speech-capability', version: 1, provider: protocol.provider,
    model: protocol.model, modelRevision: AVG_LOCAL_VOICE_REVISION_V1, voices: protocol.voices.map(v => v.voiceId), locale: 'zh-CN',
    outputFormat: protocol.outputFormat, maximumInputCharacters: protocol.maximumInputCharacters,
    supportsInstructions: protocol.supportsInstructions, maximumInstructionsCharacters: protocol.maximumInstructionsCharacters,
    speedRange: null, license: 'Apache-2.0', voiceMode: 'fixed-preset' }
  const onResponse = vi.fn(async (_text: string) => {})
  return { assembly, capability, protocol, capabilityBody, request, onResponse,
    call: { requirementKey: request.requirementKey, requestIdentityHash: request.identityHash,
      idempotencyKey: 'avg.local.voice.1', signal: new AbortController().signal, onResponse } }
}

function pcm() {
  const out = new Uint8Array(444), view = new DataView(out.buffer)
  for (const [offset, tag] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) {
    for (let i = 0; i < tag.length; i++) out[offset + i] = tag.charCodeAt(i)
  }
  view.setUint32(4, 436, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  view.setUint32(40, 400, true)
  for (let i = 0; i < 200; i++) view.setInt16(44 + i * 2, Math.round(4000 * Math.sin(i / 8)), true)
  return out
}

describe('AVG explicit free local fixed-voice route', () => {
  it('checks exact service identity then sends one exact body without any Agnes credential, retaining original PCM and zero provider charge', async () => {
    const s = await fixture(), bytes = pcm()
    const fetcher = vi.fn(async (_target: RequestInfo | URL, init?: RequestInit) => init?.method === 'GET'
      ? Response.json(s.capabilityBody) : new Response(bytes, { headers: { 'content-type': 'audio/wav', 'x-storyforge-cost-usd': '0' } }))
    const transport = await createConfiguredAvgLocalVoiceTransportV1({ ...s, fetcher })
    expect(fetcher).not.toHaveBeenCalled()
    const response = await transport.request(s.call)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]![0]).toBe(`${AVG_LOCAL_VOICE_BASE_URL_V1}/capabilities`)
    expect(fetcher.mock.calls[1]![1]?.body).toBe(s.request.requestBodyJson)
    expect(fetcher.mock.calls[1]![1]?.headers).not.toHaveProperty('Authorization')
    expect(response.costUsd).toBe(0); expect(new Uint8Array(response.body)).toEqual(bytes)
    const evidence = JSON.parse(s.onResponse.mock.calls[0]![0])
    expect(evidence).toMatchObject({ bodyComplete: true, bodyOmitted: null, costUsd: 0 })
    expect(evidence.bodyBase64.length).toBeGreaterThan(0)
  })

  it.each(['revision', 'voices', 'instructions', 'license', 'oversize', 'unavailable', 'network'])('rejects %s service metadata before generation with no raw response and no retry', async variant => {
    const s = await fixture(), body: Record<string, unknown> = { ...s.capabilityBody }
    if (variant === 'revision') body.modelRevision = 'changed'
    if (variant === 'voices') body.voices = ['actor-clone']
    if (variant === 'instructions') body.supportsInstructions = false
    if (variant === 'license') body.license = 'research-only'
    const fetcher = vi.fn(async () => {
      if (variant === 'network') throw new Error('offline')
      if (variant === 'oversize') return new Response('x'.repeat(8193), { headers: { 'content-type': 'application/json' } })
      return Response.json(body, { status: variant === 'unavailable' ? 503 : 200 })
    })
    const transport = await createConfiguredAvgLocalVoiceTransportV1({ ...s, fetcher })
    await expect(transport.request(s.call)).rejects.toMatchObject({ disposition: 'not-dispatched' })
    expect(fetcher).toHaveBeenCalledOnce(); expect(s.onResponse).not.toHaveBeenCalled()
  })

  it('rejects stale identity or cancellation before even reading service metadata', async () => {
    const s = await fixture(), fetcher = vi.fn(), transport = await createConfiguredAvgLocalVoiceTransportV1({ ...s, fetcher })
    await expect(transport.request({ ...s.call, requestIdentityHash: 'a'.repeat(64) })).rejects.toMatchObject({ disposition: 'not-dispatched' })
    const stop = new AbortController(); stop.abort()
    await expect(transport.request({ ...s.call, signal: stop.signal })).rejects.toMatchObject({ disposition: 'not-dispatched' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps old Agnes transport strict and freezes a different route identity for local generation', async () => {
    const s = await fixture()
    await expect(createConfiguredAvgVoiceTransportV1({ ...s, config: { provider: 'agnes', baseUrl: AVG_LOCAL_VOICE_BASE_URL_V1, apiKey: 'test-only-unused' } })).rejects.toThrow()
    s.assembly.voice.protocol.endpointRouteHash = 'a'.repeat(64)
    await expect(createConfiguredAvgLocalVoiceTransportV1(s)).rejects.toThrow()
  })

  it('resolves a local frozen plan even with empty global AI config and never reads or changes its credential', async () => {
    const s = await fixture(), previous = useAIConfigStore.getState().config
    try {
      useAIConfigStore.getState().setConfig({ provider: 'openai', baseUrl: '', apiKey: '', model: 'unused' })
      const transport = await resolveAvgVoiceExecutionCapabilityV3({ projectId: 1, ...s })
      expect(transport.binding.provider).toBe(AVG_LOCAL_VOICE_PROVIDER_V1)
      expect(useAIConfigStore.getState().config.apiKey).toBe('')
      expect(useAIConfigStore.getState().config.provider).toBe('openai')
    } finally { useAIConfigStore.getState().setConfig(previous) }
  })
})
