import type { ProductProductionBriefV3 } from '../types'
import type { TextAdventureCastBibleArtifactV1 } from './production-artifacts-v2'
import type { TextAdventureSceneScriptBundleArtifactV1 } from './scene-script'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function fail(message: string): never {
  throw new Error(`[text-adventure-dialogue-pass] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const normalized = [...expected].sort()
  if (actual.length !== normalized.length || normalized.some((key, index) => key !== actual[index])) {
    fail(`${label} 字段不精确:${actual.join(',')}`)
  }
}

function array(value: unknown, label: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(`${label} 数量无效`)
  return value
}

function text(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}

function key(value: unknown, label: string): string {
  const parsed = text(value, label, 200)
  if (!STABLE_KEY.test(parsed)) fail(`${label} 不是稳定 key`)
  return parsed
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label} 枚举无效`)
  return value as T
}

export const TEXT_ADVENTURE_DIALOGUE_ISSUES_V1 = [
  'none', 'voice-collapse', 'knowledge-breach', 'exposition', 'no-subtext',
  'emotion-label', 'unnatural', 'mixed-language', 'continuity', 'player-intent',
] as const
export type TextAdventureDialogueIssueV1 = typeof TEXT_ADVENTURE_DIALOGUE_ISSUES_V1[number]

export interface TextAdventureDialoguePassArtifactV1 {
  schema: 'storyforge.text-adventure-dialogue-pass-artifact'
  version: 1
  actKey: string
  characterAssessments: Array<{
    characterKey: string
    voiceDistinctness: 'strong' | 'adequate'
    knowledgeBoundary: 'passed'
    notes: string
  }>
  beatReviews: Array<{
    beatKey: string
    speakerKey: string
    verdict: 'keep' | 'revise'
    issueTags: TextAdventureDialogueIssueV1[]
    rationale: string
    revisedText: string
  }>
  choiceReviews: Array<{
    choiceKey: string
    verdict: 'keep' | 'revise'
    issueTags: TextAdventureDialogueIssueV1[]
    rationale: string
    revisedText: string
    revisedDescription: string
  }>
  summary: string
}

interface DialogueBeatInputV1 {
  beatKey: string
  speakerKey: string
  text: string
}

interface ChoiceInputV1 {
  choiceKey: string
  text: string
  description: string
}

function collectDialogueInputs(bundles: readonly TextAdventureSceneScriptBundleArtifactV1[]): {
  beats: DialogueBeatInputV1[]
  choices: ChoiceInputV1[]
} {
  const beats = bundles.flatMap(bundle => [
    ...bundle.scenes.flatMap(scene => scene.beats),
    ...bundle.endings.flatMap(ending => ending.beats),
  ]).filter(beat => beat.kind === 'dialogue').map(beat => ({
    beatKey: beat.beatKey,
    speakerKey: beat.speakerKey!,
    text: beat.text,
  }))
  const choices = bundles.flatMap(bundle => bundle.choices).map(choice => ({
    choiceKey: choice.choiceKey,
    text: choice.text,
    description: choice.description,
  }))
  if (new Set(beats.map(beat => beat.beatKey)).size !== beats.length) fail('输入对白 beatKey 重复')
  if (new Set(choices.map(choice => choice.choiceKey)).size !== choices.length) fail('输入 choiceKey 重复')
  return { beats, choices }
}

function issueTags(value: unknown, label: string, verdict: 'keep' | 'revise'): TextAdventureDialogueIssueV1[] {
  const parsed = array(value, label, 1, TEXT_ADVENTURE_DIALOGUE_ISSUES_V1.length).map((item, index) => (
    enumValue(item, TEXT_ADVENTURE_DIALOGUE_ISSUES_V1, `${label}[${index}]`)
  ))
  if (new Set(parsed).size !== parsed.length) fail(`${label} 不允许重复`)
  if (verdict === 'keep' && (parsed.length !== 1 || parsed[0] !== 'none')) {
    fail(`${label} keep 必须且只能使用 none`)
  }
  if (verdict === 'revise' && parsed.includes('none')) fail(`${label} revise 不得使用 none`)
  return parsed
}

export function parseTextAdventureDialoguePassArtifactV1(input: {
  value: unknown
  brief: ProductProductionBriefV3
  cast: TextAdventureCastBibleArtifactV1
  bundles: readonly TextAdventureSceneScriptBundleArtifactV1[]
}): TextAdventureDialoguePassArtifactV1 {
  if (input.brief.intent.productType !== 'text-adventure' || !input.brief.textAdventure) {
    fail('对白审校只允许文字冒险产品')
  }
  const row = record(input.value, 'dialoguePass')
  exactKeys(row, [
    'schema', 'version', 'actKey', 'characterAssessments', 'beatReviews', 'choiceReviews', 'summary',
  ], 'dialoguePass')
  if (row.schema !== 'storyforge.text-adventure-dialogue-pass-artifact' || row.version !== 1) {
    fail('dialoguePass schema/version 无效')
  }
  const source = collectDialogueInputs(input.bundles)
  if (input.bundles.length !== 1) fail('单次对白审校必须精确绑定一个幕')
  const actKey = key(row.actKey, 'actKey')
  if (actKey !== input.bundles[0].actKey) fail(`actKey 必须为 ${input.bundles[0].actKey}`)
  const castByKey = new Map(input.cast.characters.map(character => [character.key, character]))
  const usedSpeakerKeys = [...new Set(source.beats.map(beat => beat.speakerKey))].sort()
  if (usedSpeakerKeys.some(characterKey => !castByKey.has(characterKey))) fail('输入对白引用未知角色')

  const characterAssessments = array(
    row.characterAssessments,
    'characterAssessments',
    usedSpeakerKeys.length,
    usedSpeakerKeys.length,
  ).map((value, index) => {
    const item = record(value, `characterAssessments[${index}]`)
    exactKeys(item, [
      'characterKey', 'voiceDistinctness', 'knowledgeBoundary', 'notes',
    ], `characterAssessments[${index}]`)
    const characterKey = key(item.characterKey, `characterAssessments[${index}].characterKey`)
    if (characterKey !== usedSpeakerKeys[index]) {
      fail(`characterAssessments[${index}] 必须为 ${usedSpeakerKeys[index]}`)
    }
    return {
      characterKey,
      voiceDistinctness: enumValue(
        item.voiceDistinctness,
        ['strong', 'adequate'] as const,
        `characterAssessments[${index}].voiceDistinctness`,
      ),
      knowledgeBoundary: enumValue(
        item.knowledgeBoundary,
        ['passed'] as const,
        `characterAssessments[${index}].knowledgeBoundary`,
      ),
      notes: text(item.notes, `characterAssessments[${index}].notes`, 2_000),
    }
  })

  const sourceBeatByKey = new Map(source.beats.map(beat => [beat.beatKey, beat]))
  const expectedBeatKeys = source.beats.map(beat => beat.beatKey).sort()
  const beatReviews = array(row.beatReviews, 'beatReviews', expectedBeatKeys.length, expectedBeatKeys.length)
    .map((value, index) => {
      const item = record(value, `beatReviews[${index}]`)
      exactKeys(item, [
        'beatKey', 'speakerKey', 'verdict', 'issueTags', 'rationale', 'revisedText',
      ], `beatReviews[${index}]`)
      const beatKey = key(item.beatKey, `beatReviews[${index}].beatKey`)
      if (beatKey !== expectedBeatKeys[index]) fail(`beatReviews[${index}] 必须为 ${expectedBeatKeys[index]}`)
      const sourceBeat = sourceBeatByKey.get(beatKey)!
      const speakerKey = key(item.speakerKey, `beatReviews[${index}].speakerKey`)
      if (speakerKey !== sourceBeat.speakerKey) fail(`${beatKey} speakerKey 不得改写`)
      const verdict = enumValue(item.verdict, ['keep', 'revise'] as const, `beatReviews[${index}].verdict`)
      const revisedText = text(item.revisedText, `beatReviews[${index}].revisedText`)
      if ((verdict === 'keep') !== (revisedText === sourceBeat.text)) {
        fail(`${beatKey} verdict 与修订文本不一致`)
      }
      return {
        beatKey,
        speakerKey,
        verdict,
        issueTags: issueTags(item.issueTags, `beatReviews[${index}].issueTags`, verdict),
        rationale: text(item.rationale, `beatReviews[${index}].rationale`, 2_000),
        revisedText,
      }
    })

  const sourceChoiceByKey = new Map(source.choices.map(choice => [choice.choiceKey, choice]))
  const expectedChoiceKeys = source.choices.map(choice => choice.choiceKey).sort()
  const choiceReviews = array(row.choiceReviews, 'choiceReviews', expectedChoiceKeys.length, expectedChoiceKeys.length)
    .map((value, index) => {
      const item = record(value, `choiceReviews[${index}]`)
      exactKeys(item, [
        'choiceKey', 'verdict', 'issueTags', 'rationale', 'revisedText', 'revisedDescription',
      ], `choiceReviews[${index}]`)
      const choiceKey = key(item.choiceKey, `choiceReviews[${index}].choiceKey`)
      if (choiceKey !== expectedChoiceKeys[index]) fail(`choiceReviews[${index}] 必须为 ${expectedChoiceKeys[index]}`)
      const sourceChoice = sourceChoiceByKey.get(choiceKey)!
      const verdict = enumValue(item.verdict, ['keep', 'revise'] as const, `choiceReviews[${index}].verdict`)
      const revisedText = text(item.revisedText, `choiceReviews[${index}].revisedText`, 240)
      const revisedDescription = text(item.revisedDescription, `choiceReviews[${index}].revisedDescription`, 1_000)
      const unchanged = revisedText === sourceChoice.text && revisedDescription === sourceChoice.description
      if ((verdict === 'keep') !== unchanged) fail(`${choiceKey} verdict 与修订文案不一致`)
      return {
        choiceKey,
        verdict,
        issueTags: issueTags(item.issueTags, `choiceReviews[${index}].issueTags`, verdict),
        rationale: text(item.rationale, `choiceReviews[${index}].rationale`, 2_000),
        revisedText,
        revisedDescription,
      }
    })

  return {
    schema: 'storyforge.text-adventure-dialogue-pass-artifact',
    version: 1,
    actKey,
    characterAssessments,
    beatReviews,
    choiceReviews,
    summary: text(row.summary, 'summary', 4_000),
  }
}

export function applyTextAdventureDialoguePassV1(input: {
  bundles: readonly TextAdventureSceneScriptBundleArtifactV1[]
  dialoguePass: TextAdventureDialoguePassArtifactV1
}): TextAdventureSceneScriptBundleArtifactV1[] {
  const beatByKey = new Map(input.dialoguePass.beatReviews.map(review => [review.beatKey, review]))
  const choiceByKey = new Map(input.dialoguePass.choiceReviews.map(review => [review.choiceKey, review]))
  return input.bundles.map(bundle => ({
    ...bundle,
    scenes: bundle.scenes.map(scene => ({
      ...scene,
      beats: scene.beats.map(beat => beat.kind === 'dialogue'
        ? { ...beat, text: beatByKey.get(beat.beatKey)!.revisedText }
        : { ...beat }),
    })),
    choices: bundle.choices.map(choice => ({
      ...choice,
      text: choiceByKey.get(choice.choiceKey)!.revisedText,
      description: choiceByKey.get(choice.choiceKey)!.revisedDescription,
    })),
    endings: bundle.endings.map(ending => ({
      ...ending,
      beats: ending.beats.map(beat => beat.kind === 'dialogue'
        ? { ...beat, text: beatByKey.get(beat.beatKey)!.revisedText }
        : { ...beat }),
    })),
  }))
}
