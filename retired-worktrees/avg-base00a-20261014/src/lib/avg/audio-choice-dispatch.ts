import { avgProtocolBody } from './protocol-validation'
import { parseAvgAuthorVoiceChoiceV1, type AvgAuthorVoiceChoiceV1 } from './voice-choice-contract'
import { parseAvgAuthorSoundChoiceV1, type AvgAuthorSoundChoiceV1 } from './sound-choice-contract'
import { parseAvgAuthorVoiceChoiceV2, parseAvgAuthorSoundChoiceV2,
  type AvgAuthorVoiceChoiceV2, type AvgAuthorSoundChoiceV2 } from './processed-audio-choice-contract'

export type AvgAuthorVoiceChoice = AvgAuthorVoiceChoiceV1 | AvgAuthorVoiceChoiceV2
export type AvgAuthorSoundChoice = AvgAuthorSoundChoiceV1 | AvgAuthorSoundChoiceV2

/** Explicit successor dispatch; the original V1 parsers stay strict. */
export function parseAvgAuthorVoiceChoice(value: unknown): AvgAuthorVoiceChoice {
  return (avgProtocolBody(value) as { version?: unknown })?.version === 2
    ? parseAvgAuthorVoiceChoiceV2(value) : parseAvgAuthorVoiceChoiceV1(value)
}
export function parseAvgAuthorSoundChoice(value: unknown): AvgAuthorSoundChoice {
  return (avgProtocolBody(value) as { version?: unknown })?.version === 2
    ? parseAvgAuthorSoundChoiceV2(value) : parseAvgAuthorSoundChoiceV1(value)
}
