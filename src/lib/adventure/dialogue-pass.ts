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

function issueTags(value: unknown, label: string): TextAdventureDialogueIssueV1[] {
  const parsed = array(value, label, 1, TEXT_ADVENTURE_DIALOGUE_ISSUES_V1.length).map((item, index) => (
    enumValue(item, TEXT_ADVENTURE_DIALOGUE_ISSUES_V1, `${label}[${index}]`)
  ))
  if (new Set(parsed).size !== parsed.length) fail(`${label} 不允许重复`)
  return parsed
}

function canonicalReviewRationale(
  rationale: string,
  suppliedIssueTags: TextAdventureDialogueIssueV1[],
  verdict: 'keep' | 'revise',
): string {
  if (verdict === 'revise' || suppliedIssueTags.every(tag => tag === 'none')) return rationale
  const unresolved = suppliedIssueTags.filter(tag => tag !== 'none')
  const suffix = `（输入标记 ${unresolved.join('、')}，但未产生有效改写；规则保留冻结原文并交由独立质量门复验。）`
  return `${rationale.slice(0, Math.max(0, 2_000 - suffix.length))}${suffix}`
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
  const ordinalCompact = row.reviewedBeatCount !== undefined
    || row.reviewedChoiceCount !== undefined
    || row.reviewedCharacterCount !== undefined
  const keyCompact = row.keptBeatKeys !== undefined || row.keptChoiceKeys !== undefined
  if (ordinalCompact && keyCompact) fail('不得混用序号差量与 key 差量协议')
  const compact = ordinalCompact || keyCompact
  exactKeys(row, ordinalCompact ? [
    'schema', 'version', 'actKey', 'reviewedCharacterCount', 'reviewedBeatCount',
    'reviewedChoiceCount', 'beatReviews', 'choiceReviews',
  ] : [
    'schema', 'version', 'actKey', 'characterAssessments', 'beatReviews', 'choiceReviews', 'summary',
    ...(keyCompact ? ['keptBeatKeys', 'keptChoiceKeys'] : []),
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
  if (ordinalCompact) {
    if (row.reviewedCharacterCount !== usedSpeakerKeys.length) {
      fail(`reviewedCharacterCount 必须为 ${usedSpeakerKeys.length}`)
    }
    if (row.reviewedBeatCount !== source.beats.length) {
      fail(`reviewedBeatCount 必须为 ${source.beats.length}`)
    }
    if (row.reviewedChoiceCount !== source.choices.length) {
      fail(`reviewedChoiceCount 必须为 ${source.choices.length}`)
    }
  }

  const characterAssessments: TextAdventureDialoguePassArtifactV1['characterAssessments'] = ordinalCompact
    ? usedSpeakerKeys.map(characterKey => ({
        characterKey,
        voiceDistinctness: 'adequate',
        knowledgeBoundary: 'passed',
        notes: '已纳入本幕全量逐项审校；最终声音差异由独立叙事质量门复验。',
      }))
    : (() => {
        const parsed = array(
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
          if (!usedSpeakerKeys.includes(characterKey)) fail(`characterAssessments[${index}] 引用未使用角色`)
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
        if (new Set(parsed.map(item => item.characterKey)).size !== usedSpeakerKeys.length) {
          fail('characterAssessments 缺少或重复角色')
        }
        const assessmentByKey = new Map(parsed.map(item => [item.characterKey, item]))
        return usedSpeakerKeys.map(characterKey => assessmentByKey.get(characterKey)!)
      })()

  const sourceBeatByKey = new Map(source.beats.map(beat => [beat.beatKey, beat]))
  const expectedBeatKeys = source.beats.map(beat => beat.beatKey).sort()
  const parsedBeatReviews = array(
    row.beatReviews, 'beatReviews', compact ? 0 : expectedBeatKeys.length, expectedBeatKeys.length,
  )
    .map((value, index) => {
      const item = record(value, `beatReviews[${index}]`)
      exactKeys(item, [
        ...(ordinalCompact ? ['beatOrdinal'] : ['beatKey', 'speakerKey', 'verdict']),
        'issueTags', 'rationale',
        ...(item.revisedText === undefined ? [] : ['revisedText']),
      ], `beatReviews[${index}]`)
      const sourceBeat = ordinalCompact
        ? source.beats[(typeof item.beatOrdinal === 'number' && Number.isInteger(item.beatOrdinal)
          ? item.beatOrdinal : 0) - 1]
        : sourceBeatByKey.get(key(item.beatKey, `beatReviews[${index}].beatKey`))
      if (!sourceBeat) fail(`beatReviews[${index}] 引用未知对白序号或 key`)
      const beatKey = sourceBeat.beatKey
      const speakerKey = ordinalCompact
        ? sourceBeat.speakerKey
        : key(item.speakerKey, `beatReviews[${index}].speakerKey`)
      if (speakerKey !== sourceBeat.speakerKey) fail(`${beatKey} speakerKey 不得改写`)
      const requestedVerdict = ordinalCompact ? 'revise' as const : enumValue(
        item.verdict, ['keep', 'revise'] as const, `beatReviews[${index}].verdict`,
      )
      if (compact && requestedVerdict !== 'revise') fail(`beatReviews[${index}] 差量协议只接受 revise`)
      // `keep` is the authoritative decision; project the frozen source text
      // even when a provider leaves the redundant revisedText empty or copies
      // a slightly altered duplicate. An incomplete revision is downgraded to
      // a flagged keep so the independent quality gate can block it honestly.
      const revisedText = requestedVerdict === 'keep'
        ? sourceBeat.text
        : (typeof item.revisedText === 'string' && item.revisedText.trim()
            ? text(item.revisedText, `beatReviews[${index}].revisedText`)
            : sourceBeat.text)
      const noOpRevision = requestedVerdict === 'revise' && revisedText === sourceBeat.text
      const verdict = noOpRevision ? 'keep' as const : requestedVerdict
      const suppliedIssueTags = issueTags(item.issueTags, `beatReviews[${index}].issueTags`)
      if (requestedVerdict === 'revise' && suppliedIssueTags.includes('none')) {
        fail(`beatReviews[${index}].issueTags revise 不得使用 none`)
      }
      const rationale = text(item.rationale, `beatReviews[${index}].rationale`, 2_000)
      return {
        beatKey,
        speakerKey,
        verdict,
        // Canonical artifacts must be parse-idempotent: a keep can only carry
        // `none`. Preserve unresolved provider evidence in rationale instead
        // of emitting the former invalid keep + issueTags combination.
        issueTags: verdict === 'keep'
          ? ['none'] as TextAdventureDialogueIssueV1[] : suppliedIssueTags,
        rationale: canonicalReviewRationale(rationale, suppliedIssueTags, verdict),
        revisedText,
      }
    })
  if (new Set(parsedBeatReviews.map(item => item.beatKey)).size !== parsedBeatReviews.length) {
    fail('beatReviews 重复对白')
  }
  const keptBeatKeys = keyCompact
    ? array(row.keptBeatKeys, 'keptBeatKeys', 0, expectedBeatKeys.length)
      .map((value, index) => key(value, `keptBeatKeys[${index}]`))
    : []
  if (new Set(keptBeatKeys).size !== keptBeatKeys.length
    || keptBeatKeys.some(beatKey => !sourceBeatByKey.has(beatKey))) fail('keptBeatKeys 含重复或未知对白')
  if (!ordinalCompact) {
    const coveredBeatKeys = [...keptBeatKeys, ...parsedBeatReviews.map(item => item.beatKey)].sort()
    if (coveredBeatKeys.length !== expectedBeatKeys.length
      || coveredBeatKeys.some((beatKey, index) => beatKey !== expectedBeatKeys[index])) {
      fail(keyCompact ? 'keptBeatKeys + beatReviews 未严格覆盖全部对白' : 'beatReviews 缺少或重复对白')
    }
  }
  const beatReviewByKey = new Map(parsedBeatReviews.map(item => [item.beatKey, item]))
  const beatReviews = expectedBeatKeys.map(beatKey => beatReviewByKey.get(beatKey) ?? {
    beatKey,
    speakerKey: sourceBeatByKey.get(beatKey)!.speakerKey,
    verdict: 'keep' as const,
    issueTags: ['none'] as TextAdventureDialogueIssueV1[],
    rationale: '已逐条审校并保留冻结原文。',
    revisedText: sourceBeatByKey.get(beatKey)!.text,
  })

  const sourceChoiceByKey = new Map(source.choices.map(choice => [choice.choiceKey, choice]))
  const expectedChoiceKeys = source.choices.map(choice => choice.choiceKey).sort()
  const parsedChoiceReviews = array(
    row.choiceReviews, 'choiceReviews', compact ? 0 : expectedChoiceKeys.length, expectedChoiceKeys.length,
  )
    .map((value, index) => {
      const item = record(value, `choiceReviews[${index}]`)
      exactKeys(item, [
        ...(ordinalCompact ? ['choiceOrdinal'] : ['choiceKey', 'verdict']),
        'issueTags', 'rationale',
        ...(item.revisedText === undefined ? [] : ['revisedText']),
        ...(item.revisedDescription === undefined ? [] : ['revisedDescription']),
      ], `choiceReviews[${index}]`)
      const sourceChoice = ordinalCompact
        ? source.choices[(typeof item.choiceOrdinal === 'number' && Number.isInteger(item.choiceOrdinal)
          ? item.choiceOrdinal : 0) - 1]
        : sourceChoiceByKey.get(key(item.choiceKey, `choiceReviews[${index}].choiceKey`))
      if (!sourceChoice) fail(`choiceReviews[${index}] 引用未知选择序号或 key`)
      const choiceKey = sourceChoice.choiceKey
      const requestedVerdict = ordinalCompact ? 'revise' as const : enumValue(
        item.verdict, ['keep', 'revise'] as const, `choiceReviews[${index}].verdict`,
      )
      if (compact && requestedVerdict !== 'revise') fail(`choiceReviews[${index}] 差量协议只接受 revise`)
      const revisedText = requestedVerdict === 'keep'
        ? sourceChoice.text
        : (typeof item.revisedText === 'string' && item.revisedText.trim()
            ? text(item.revisedText, `choiceReviews[${index}].revisedText`, 240)
            : sourceChoice.text)
      const revisedDescription = requestedVerdict === 'keep'
        ? sourceChoice.description
        : (typeof item.revisedDescription === 'string' && item.revisedDescription.trim()
            ? text(item.revisedDescription, `choiceReviews[${index}].revisedDescription`, 1_000)
            : sourceChoice.description)
      const unchanged = revisedText === sourceChoice.text && revisedDescription === sourceChoice.description
      const verdict = requestedVerdict === 'revise' && unchanged ? 'keep' as const : requestedVerdict
      const suppliedIssueTags = issueTags(item.issueTags, `choiceReviews[${index}].issueTags`)
      if (requestedVerdict === 'revise' && suppliedIssueTags.includes('none')) {
        fail(`choiceReviews[${index}].issueTags revise 不得使用 none`)
      }
      const rationale = text(item.rationale, `choiceReviews[${index}].rationale`, 2_000)
      return {
        choiceKey,
        verdict,
        issueTags: verdict === 'keep'
          ? ['none'] as TextAdventureDialogueIssueV1[] : suppliedIssueTags,
        rationale: canonicalReviewRationale(rationale, suppliedIssueTags, verdict),
        revisedText,
        revisedDescription,
      }
    })
  if (new Set(parsedChoiceReviews.map(item => item.choiceKey)).size !== parsedChoiceReviews.length) {
    fail('choiceReviews 重复选择')
  }
  const keptChoiceKeys = keyCompact
    ? array(row.keptChoiceKeys, 'keptChoiceKeys', 0, expectedChoiceKeys.length)
      .map((value, index) => key(value, `keptChoiceKeys[${index}]`))
    : []
  if (new Set(keptChoiceKeys).size !== keptChoiceKeys.length
    || keptChoiceKeys.some(choiceKey => !sourceChoiceByKey.has(choiceKey))) {
    fail('keptChoiceKeys 含重复或未知选择')
  }
  if (!ordinalCompact) {
    const coveredChoiceKeys = [...keptChoiceKeys, ...parsedChoiceReviews.map(item => item.choiceKey)].sort()
    if (coveredChoiceKeys.length !== expectedChoiceKeys.length
      || coveredChoiceKeys.some((choiceKey, index) => choiceKey !== expectedChoiceKeys[index])) {
      fail(keyCompact ? 'keptChoiceKeys + choiceReviews 未严格覆盖全部选择' : 'choiceReviews 缺少或重复选择')
    }
  }
  const choiceReviewByKey = new Map(parsedChoiceReviews.map(item => [item.choiceKey, item]))
  const choiceReviews = expectedChoiceKeys.map(choiceKey => choiceReviewByKey.get(choiceKey) ?? {
    choiceKey,
    verdict: 'keep' as const,
    issueTags: ['none'] as TextAdventureDialogueIssueV1[],
    rationale: '已逐条审校并保留冻结原文。',
    revisedText: sourceChoiceByKey.get(choiceKey)!.text,
    revisedDescription: sourceChoiceByKey.get(choiceKey)!.description,
  })

  return {
    schema: 'storyforge.text-adventure-dialogue-pass-artifact',
    version: 1,
    actKey,
    characterAssessments,
    beatReviews,
    choiceReviews,
    summary: ordinalCompact
      ? `已逐项审校 ${source.beats.length} 条对白与 ${source.choices.length} 个玩家选择；实际修订 ${parsedBeatReviews.filter(review => review.verdict === 'revise').length} 条对白、${parsedChoiceReviews.filter(review => review.verdict === 'revise').length} 个选择，未完成的修订建议保留问题标签供独立质量门复验。`
      : text(row.summary, 'summary', 4_000),
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
