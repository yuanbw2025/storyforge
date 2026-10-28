import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { parseAvgSpeechProtocolV1, type AvgSpeechProtocolV1 } from './voice-request-contract'

export const AVG_LOCAL_VOICE_PROVIDER_V1 = 'storyforge-local-qwen3'
export const AVG_LOCAL_VOICE_BASE_URL_V1 = 'http://127.0.0.1:5297/v1'
export const AVG_LOCAL_VOICE_REVISION_V1 = '0c0e3051f131929182e2c023b9537f8b1c68adfe'
export const AVG_LOCAL_VOICE_MODEL_V1 = `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice@${AVG_LOCAL_VOICE_REVISION_V1}`
export const AVG_LOCAL_VOICE_IDS_V1 = ['Vivian', 'Serena', 'Uncle_Fu', 'Dylan', 'Eric'] as const
export const AVG_LOCAL_VOICE_RIGHTS_REFERENCE_V1 = 'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice/tree/0c0e3051f131929182e2c023b9537f8b1c68adfe'

/** Exact wire-compatible local profile. No credential/global AI configuration,
 * network, start permission, quality approval or product-data write. */
export async function avgLocalVoiceProtocolV1(): Promise<AvgSpeechProtocolV1> {
  const endpoint = new URL(`${AVG_LOCAL_VOICE_BASE_URL_V1}/audio/speech`)
  const endpointRouteHash = await hashCanonicalValue({ schema: 'storyforge.avg.configured-speech-route', version: 2,
    provider: AVG_LOCAL_VOICE_PROVIDER_V1, adapterId: 'storyforge.avg.compatible-speech.v1',
    method: 'POST', origin: endpoint.origin, path: endpoint.pathname, model: AVG_LOCAL_VOICE_MODEL_V1,
    modelRevision: AVG_LOCAL_VOICE_REVISION_V1 })
  return parseAvgSpeechProtocolV1({ schema: 'storyforge.avg.speech-protocol', version: 1,
    adapterId: 'storyforge.avg.compatible-speech.v1', provider: AVG_LOCAL_VOICE_PROVIDER_V1,
    model: AVG_LOCAL_VOICE_MODEL_V1, endpointRouteHash,
    voices: AVG_LOCAL_VOICE_IDS_V1.map(voiceId => ({ voiceId, locales: ['zh-CN'] })), outputFormat: 'wav',
    maximumInputCharacters: 256, supportsInstructions: true, maximumInstructionsCharacters: 2048, speedRange: null })
}

export function assertAvgLocalVoiceServiceV1(value: unknown) {
  const expected = { schema: 'storyforge.avg.local-speech-capability', version: 1,
    provider: AVG_LOCAL_VOICE_PROVIDER_V1, model: AVG_LOCAL_VOICE_MODEL_V1, modelRevision: AVG_LOCAL_VOICE_REVISION_V1,
    voices: [...AVG_LOCAL_VOICE_IDS_V1], locale: 'zh-CN', outputFormat: 'wav', maximumInputCharacters: 256,
    supportsInstructions: true, maximumInstructionsCharacters: 2048, speedRange: null, license: 'Apache-2.0', voiceMode: 'fixed-preset' }
  if (canonicalStringify(value) !== canonicalStringify(expected)) throw new Error('[avg-voice] 本地配音服务版本、音色或能力与冻结方案不一致')
}
