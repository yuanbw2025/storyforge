/** Explicit original-job control only. No create, start, lease or retry endpoint. */
import profile from '../../../scripts/ttrpg-local-tts/product-profile.json'
import { requestText } from './open-local-voice-transport'
import { parseTtrpgOpenVoiceJobStatusForKernelV1, type TtrpgOpenVoiceJobControlIdentityV1, type TtrpgOpenVoiceJobStatusV1 } from './open-voice-job-reader'
import type { TtrpgOpenVoiceJobIdentityV1 } from './open-voice-job-read-state'
import * as p from './open-contract-parse'

export interface TtrpgOpenVoiceJobControllerV1 {
  kind: 'original-local-voice-job-controller-v1'
  stop: (identity: TtrpgOpenVoiceJobControlIdentityV1, signal?: AbortSignal) => Promise<TtrpgOpenVoiceJobStatusV1>
  recoverRaw: (identity: TtrpgOpenVoiceJobIdentityV1, signal?: AbortSignal) => Promise<string>
}
function original(identity: TtrpgOpenVoiceJobControlIdentityV1) {
  const frozen = { jobKey: identity.jobKey, inputArtifactHash: p.hash(identity.inputArtifactHash, 'original job input'),
    ...(identity.profileHash === undefined ? {} : { profileHash: p.hash(identity.profileHash, 'original job profile') }) }
  if (!/^ttrpg\.voice\.[1-9][0-9]*\.[a-f0-9]{64}$/.test(frozen.jobKey) || !frozen.jobKey.endsWith('.' + frozen.inputArtifactHash)) p.fail('原任务标识无效')
  return frozen
}
export function createTtrpgOpenVoiceJobControllerV1(): TtrpgOpenVoiceJobControllerV1 {
  return { kind: 'original-local-voice-job-controller-v1', stop: async (identity, signal) => {
    const frozen = original(identity)
    const raw = await requestText('/storyforge/local-tts/v1/jobs/' + encodeURIComponent(frozen.jobKey) + '/cancel',
      { method: 'POST', body: JSON.stringify({ decision: 'request-stop-original-local-voice-job' }) }, signal, 65536, profile.statusRequestTimeoutMs)
    return parseTtrpgOpenVoiceJobStatusForKernelV1(JSON.parse(raw), frozen)
  }, recoverRaw: async (identity, signal) => {
    const frozen = original(identity)
    p.hash(frozen.profileHash, 'original raw profile')
    return requestText('/storyforge/local-tts/v1/jobs/' + encodeURIComponent(frozen.jobKey) + '/recover-raw',
      { method: 'POST', body: JSON.stringify({ decision: 'recover-original-complete-raw-without-resending', inputArtifactHash: frozen.inputArtifactHash }) },
      signal, Math.ceil(profile.maxAudioBytes / 3) * 4 + 1048576, profile.rawResponseTimeoutMs)
  } }
}
