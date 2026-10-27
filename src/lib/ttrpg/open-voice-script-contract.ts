/** Exact accepted prose and listener snapshot. Parsing grants no read, model,
 * import, adoption or playback authority; the runtime owner must prove it. */
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenNarrationBindingV1, type TtrpgOpenNarrationBindingV1 } from './open-kp-binding'
import { TTRPG_OPEN_KP_MAX_BODY_CHARACTERS_V1, TTRPG_OPEN_KP_MAX_PARAGRAPHS_V1 } from './open-kp-narration'
import { parseTtrpgOpenAudioScopeV1, type TtrpgOpenAudioScopeV1 } from './open-audio-scope'
import * as p from './open-contract-parse'

export interface TtrpgOpenVoiceScriptV1 {
  schema: 'storyforge.ttrpg-open-voice-script'; version: 1
  sessionKey: string; runtimeSourceHash: string
  narrationSourceRef: TtrpgOpenSourceRefV1; narrationBinding: TtrpgOpenNarrationBindingV1
  scope: TtrpgOpenAudioScopeV1
  /** Exact accepted paragraphs joined with two LF bytes; never trim or NFC again. */
  text: string
}
export function parseTtrpgOpenVoiceScriptV1(value: unknown): TtrpgOpenVoiceScriptV1 {
  const row = p.record(value, ['schema', 'version', 'sessionKey', 'runtimeSourceHash', 'narrationSourceRef', 'narrationBinding', 'scope', 'text'], 'voice script')
  const maximum = TTRPG_OPEN_KP_MAX_BODY_CHARACTERS_V1 + 2 * (TTRPG_OPEN_KP_MAX_PARAGRAPHS_V1 - 1)
  if (typeof row.text !== 'string' || !row.text.trim() || row.text.length > maximum) p.fail('配音原叙述为空或超出原完整叙述范围')
  const scope = parseTtrpgOpenAudioScopeV1(row.scope)
  if (scope.audience === 'public') p.fail('配音不能扩大原全队叙述的准确接收者')
  const sessionKey = p.key(row.sessionKey, 'voice session')
  if (scope.authorizationRef.sessionKey !== sessionKey) p.fail('配音来源与当前授权不属于同一团局')
  return { schema: p.literal(row.schema, 'storyforge.ttrpg-open-voice-script', 'voice script schema'),
    version: p.literal(row.version, 1, 'voice script version'), sessionKey,
    runtimeSourceHash: p.hash(row.runtimeSourceHash, 'voice runtime source'),
    narrationSourceRef: parseTtrpgOpenSourceRefV1(row.narrationSourceRef), narrationBinding: parseTtrpgOpenNarrationBindingV1(row.narrationBinding), scope, text: row.text }
}
