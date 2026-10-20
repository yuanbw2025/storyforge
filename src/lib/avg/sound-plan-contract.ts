import { avgEnum, avgKey, avgList, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'

// Independent local-processing contracts. The semantic V1 sound plan stays
// strict and cannot acquire processing, provider or author authority.
export { parseAvgAudioProcessingRecipeV1, parseAvgAudioProcessingReceiptV1, assertAvgAudioProcessingReceiptV1 } from './audio-processing-contract'
export type { AvgAudioProcessingRecipeV1, AvgAudioProcessingReceiptV1 } from './audio-processing-contract'

/** Semantic proposal only. A plan cannot grant a source licence, edit a Cue,
 * choose a provider, approve sound quality or adopt an audio asset. */
export interface AvgSoundPlanV1 {
  schema: 'storyforge.avg.sound-plan'
  version: 1
  direction: { goal: string; dialogueSpace: string; continuity: string }
  entries: Array<{ requirementKey: string; designIntent: string; prompt: string | null
    librarySourceKey: string | null; acceptanceNotes: string[] }>
}

export function parseAvgMusicPromptV1(value: unknown): string {
  const prompt = avgText(value, 'music prompt', 512)
  if ([...prompt].some(c => {
    const scalar = c.codePointAt(0)!
    return scalar < 32 && ![9, 10, 13].includes(scalar) || scalar >= 0xd800 && scalar <= 0xdfff
  })) throw new Error('[avg-sound] 音乐说明不能包含控制字符或无效Unicode')
  return prompt
}

export function parseAvgSoundPlanV1(value: unknown): AvgSoundPlanV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'direction', 'entries'], 'sound plan')
  if (r.schema !== 'storyforge.avg.sound-plan' || r.version !== 1) throw new Error('[avg-sound] 声音方案版本无效')
  const d = avgRecord(r.direction, ['goal', 'dialogueSpace', 'continuity'], 'sound direction')
  const entries = avgUnique(avgList(r.entries, 'sound entries', value => {
    const e = avgRecord(value, ['requirementKey', 'designIntent', 'prompt', 'librarySourceKey', 'acceptanceNotes'], 'sound entry')
    const prompt = e.prompt === null ? null : parseAvgMusicPromptV1(e.prompt)
    const librarySourceKey = e.librarySourceKey === null ? null : avgKey(e.librarySourceKey, 'library source key')
    if ((prompt === null) === (librarySourceKey === null)) {
      throw new Error('[avg-sound] 每项必须明确生成说明或音效库来源，不得夹带控制字符')
    }
    return { requirementKey: avgKey(e.requirementKey, 'sound requirement'), designIntent: avgText(e.designIntent, 'sound intent', 2000),
      prompt, librarySourceKey, acceptanceNotes: avgList(e.acceptanceNotes, 'sound acceptance notes', (v, label) => avgText(v, label, 1000), 16) }
  }, 8), e => e.requirementKey, 'sound entries')
  if (!entries.length) throw new Error('[avg-sound] 声音方案不能为空')
  return { schema: r.schema, version: 1, direction: { goal: avgText(d.goal, 'sound goal', 2000),
    dialogueSpace: avgText(d.dialogueSpace, 'dialogue space', 2000), continuity: avgText(d.continuity, 'sound continuity', 2000) }, entries }
}

export const AVG_SOUND_CHANNELS_V1 = ['bgm', 'ambience', 'sfx'] as const
export type AvgSoundChannelV1 = typeof AVG_SOUND_CHANNELS_V1[number]
export function parseAvgSoundChannelV1(value: unknown): AvgSoundChannelV1 {
  return avgEnum(value, AVG_SOUND_CHANNELS_V1, 'sound channel')
}
