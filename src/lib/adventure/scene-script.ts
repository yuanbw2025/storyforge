import type {
  FrozenNarrativeBeat,
  FrozenProductNarrativeNode,
  FrozenNarrativeChoice,
  ProductProductionBriefV3,
} from '../types'
import { planTextAdventureNarrativeLocationsV1 } from './narrative-location-plan'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function fail(message: string): never {
  throw new Error(`[text-adventure-scene-script] ${message}`)
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

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}

function nullableText(value: unknown, label: string, maximum = 200): string | null {
  if (value === null) return null
  return text(value, label, maximum)
}

function key(value: unknown, label: string): string {
  const parsed = text(value, label, 200)
  if (!STABLE_KEY.test(parsed)) fail(`${label} 不是稳定 key`)
  return parsed
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label} 无效`)
  return Number(value)
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label} 枚举无效`)
  return value as T
}

function visibleUnits(value: string): number {
  const cjk = value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0
  const latin = value.match(/[\p{L}\p{N}]+/gu)?.filter(token => (
    !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(token)
  )).length ?? 0
  return cjk + latin
}

export interface TextAdventureNarrativeSkeletonEdgeV1 {
  choiceKey: string
  sourceNodeKey: string
  targetNodeKey: string
  order: number
}

export interface TextAdventureNarrativeSkeletonV1 {
  sceneKeys: string[]
  endingKeys: string[]
  edges: TextAdventureNarrativeSkeletonEdgeV1[]
  statefulDecisionSceneCount: number
}

export interface TextAdventureAssembledNarrativeArtifactV1 {
  schema: 'storyforge.product-narrative-artifact'
  version: 1
  moduleKind: 'main'
  moduleTitle: string
  entryNodeKey: string
  nodes: FrozenProductNarrativeNode[]
  beats: FrozenNarrativeBeat[]
  choices: FrozenNarrativeChoice[]
}

export function textAdventureNarrativeSkeletonV1(
  brief: ProductProductionBriefV3,
): TextAdventureNarrativeSkeletonV1 {
  if (!brief.textAdventure) fail('缺少文字冒险 Brief')
  const sceneKeys = Array.from({ length: brief.textAdventure.narrative.targetSceneCount }, (_, index) => (
    `scene.${String(index + 1).padStart(3, '0')}`
  ))
  const endingKeys = Array.from({ length: brief.scale.targetEndingCount }, (_, index) => (
    `ending.${String(index + 1).padStart(3, '0')}`
  ))
  const requiredStatefulDecisions = Math.max(
    brief.scale.targetEndingCount - 1,
    brief.qualityProfile === 'commercial-candidate'
      ? Math.max(2, Math.ceil(brief.scale.targetPlayMinutes / 10)) : 1,
  )
  const statefulDecisionSceneCount = Math.min(requiredStatefulDecisions, Math.max(0, sceneKeys.length - 1))
  const edges: TextAdventureNarrativeSkeletonEdgeV1[] = []
  let choiceIndex = 0
  const add = (sourceNodeKey: string, targetNodeKey: string, order: number) => {
    choiceIndex += 1
    edges.push({
      choiceKey: `choice.${String(choiceIndex).padStart(3, '0')}`,
      sourceNodeKey, targetNodeKey, order,
    })
  }
  for (let index = 0; index < sceneKeys.length - 1; index += 1) {
    add(sceneKeys[index], sceneKeys[index + 1], 0)
    if (index < statefulDecisionSceneCount) add(sceneKeys[index], sceneKeys[index + 1], 1)
  }
  endingKeys.forEach((endingKey, index) => add(sceneKeys[sceneKeys.length - 1], endingKey, index))
  return { sceneKeys, endingKeys, edges, statefulDecisionSceneCount }
}

export function textAdventureActSceneKeysV1(brief: ProductProductionBriefV3, actIndex: number): string[] {
  if (!Number.isInteger(actIndex) || actIndex < 0 || actIndex > 2) fail('actIndex 无效')
  const { sceneKeys } = textAdventureNarrativeSkeletonV1(brief)
  const base = Math.floor(sceneKeys.length / 3)
  const extra = sceneKeys.length % 3
  const counts = [0, 1, 2].map(index => base + (index < extra ? 1 : 0))
  const start = counts.slice(0, actIndex).reduce((sum, count) => sum + count, 0)
  return sceneKeys.slice(start, start + counts[actIndex])
}

/**
 * Scene prose is deliberately produced in at most two bounded packets per act.
 * The split is derived from the frozen scene order, so retries never invent a
 * new boundary and the deterministic act assembler can prove completeness.
 */
export function textAdventureSceneScriptPartSceneKeysV1(
  brief: ProductProductionBriefV3,
  actIndex: number,
): string[][] {
  const sceneKeys = textAdventureActSceneKeysV1(brief, actIndex)
  if (sceneKeys.length <= 1) return [sceneKeys]
  const firstCount = Math.ceil(sceneKeys.length / 2)
  return [sceneKeys.slice(0, firstCount), sceneKeys.slice(firstCount)]
}

export interface TextAdventureSceneScriptBundleArtifactV1 {
  schema: 'storyforge.text-adventure-scene-script-bundle-artifact'
  version: 1
  actKey: string
  moduleTitle: string
  scenes: Array<{
    sceneKey: string
    title: string
    summary: string
    beats: Array<Omit<FrozenNarrativeBeat, 'nodeKey'>>
  }>
  choices: Array<{
    choiceKey: string
    sourceNodeKey: string
    targetNodeKey: string
    text: string
    description: string
    unavailableReason: string
    order: number
  }>
  endings: Array<{
    endingKey: string
    title: string
    summary: string
    beats: Array<Omit<FrozenNarrativeBeat, 'nodeKey'>>
  }>
}

function parseBeats(input: {
  value: unknown
  label: string
  allowedSpeakerKeys: ReadonlySet<string>
}): Array<Omit<FrozenNarrativeBeat, 'nodeKey'>> {
  const rows = array(input.value, input.label, 1, 80)
  const beats = rows.map((value, index) => {
    const item = record(value, `${input.label}[${index}]`)
    exactKeys(
      item,
      item.order === undefined
        ? ['beatKey', 'kind', 'speakerKey', 'text']
        : ['beatKey', 'kind', 'speakerKey', 'text', 'order'],
      `${input.label}[${index}]`,
    )
    const kind = enumValue(item.kind, ['narration', 'dialogue', 'action', 'system'] as const, `${input.label}[${index}].kind`)
    const speakerKey = nullableText(item.speakerKey, `${input.label}[${index}].speakerKey`)
    if (kind === 'dialogue') {
      if (!speakerKey || !input.allowedSpeakerKeys.has(speakerKey)) fail(`${input.label}[${index}] dialogue speakerKey 无效`)
    } else if (speakerKey !== null) fail(`${input.label}[${index}] 非对白 beat 不得设置 speakerKey`)
    return {
      beatKey: key(item.beatKey, `${input.label}[${index}].beatKey`),
      kind,
      speakerKey,
      text: text(item.text, `${input.label}[${index}].text`),
      // Array position is already canonical. Accepting an omitted cosmetic
      // order avoids another paid model call without inventing story content.
      order: item.order === undefined
        ? index
        : integer(item.order, `${input.label}[${index}].order`, 0, 1_000),
    }
  })
  if (new Set(beats.map(beat => beat.beatKey)).size !== beats.length) fail(`${input.label} beatKey 重复`)
  const sorted = [...beats].sort((left, right) => left.order - right.order || left.beatKey.localeCompare(right.beatKey))
  if (sorted.some((beat, index) => beat !== beats[index])) fail(`${input.label} 必须按 order 稳定排序`)
  return beats
}

export function validateTextAdventureCommercialEndingNarrativeV1(input: {
  endingKey: string
  endingText: string
  beats: TextAdventureSceneScriptBundleArtifactV1['endings'][number]['beats']
  requiredConsequences: readonly string[]
  nonPlayerSpeakerKeys: readonly string[]
}): void {
  if (input.requiredConsequences.length < 2) fail(`${input.endingKey} 缺少冻结结局后果合同`)
  const missingConsequences = input.requiredConsequences.filter(consequence => (
    !input.endingText.includes(consequence)
  ))
  if (missingConsequences.length > 0) {
    fail(`${input.endingKey} 未兑现冻结结局后果:${missingConsequences.join('、')}`)
  }
  const nonPlayerSpeakerKeys = new Set(input.nonPlayerSpeakerKeys)
  if (!input.beats.some(beat => (
    beat.kind === 'dialogue' && beat.speakerKey != null
    && nonPlayerSpeakerKeys.has(beat.speakerKey)
  ))) {
    fail(`${input.endingKey} 缺少正式 NPC 的角色回响`)
  }
}

export function parseTextAdventureSceneScriptBundleArtifactV1(input: {
  value: unknown
  brief: ProductProductionBriefV3
  actIndex: number
  allowedSpeakerKeys: readonly string[]
  locationTitles: readonly string[]
  expectedModuleTitle: string
  sceneTitles: Readonly<Record<string, string>>
  endingTitles: Readonly<Record<string, string>>
  endingConsequences?: Readonly<Record<string, readonly string[]>>
  nonPlayerSpeakerKeys?: readonly string[]
  expectedSceneKeys?: readonly string[]
}): TextAdventureSceneScriptBundleArtifactV1 {
  if (!input.brief.textAdventure) fail('分场脚本缺少文字冒险 Brief')
  if (input.locationTitles.length < 1) fail('分场脚本缺少已冻结地点')
  const row = record(input.value, 'sceneScriptBundle')
  exactKeys(row, [
    'schema', 'version', 'actKey', 'moduleTitle', 'scenes',
    ...(row.choices === undefined ? [] : ['choices']),
    ...(row.endings === undefined ? [] : ['endings']),
  ], 'sceneScriptBundle')
  if (row.schema !== 'storyforge.text-adventure-scene-script-bundle-artifact' || row.version !== 1) {
    fail('sceneScriptBundle schema/version 无效')
  }
  const expectedActKey = `act.${input.actIndex + 1}`
  if (row.actKey !== expectedActKey) fail(`sceneScriptBundle actKey 必须为 ${expectedActKey}`)
  const skeleton = textAdventureNarrativeSkeletonV1(input.brief)
  const fullActSceneKeys = textAdventureActSceneKeysV1(input.brief, input.actIndex)
  const expectedSceneKeys = input.expectedSceneKeys == null
    ? fullActSceneKeys
    : [...input.expectedSceneKeys]
  if (expectedSceneKeys.length < 1
    || new Set(expectedSceneKeys).size !== expectedSceneKeys.length
    || expectedSceneKeys.some(sceneKey => !fullActSceneKeys.includes(sceneKey))) {
    fail('expectedSceneKeys 必须是本幕非空、不重复的冻结场景子集')
  }
  const expectedPositions = expectedSceneKeys.map(sceneKey => fullActSceneKeys.indexOf(sceneKey))
  if (expectedPositions.some((position, index) => index > 0 && position !== expectedPositions[index - 1] + 1)) {
    fail('expectedSceneKeys 必须是本幕连续且有序的冻结场景子集')
  }
  const speakerKeys = new Set(input.allowedSpeakerKeys)
  const rawSceneRows = array(row.scenes, 'sceneScriptBundle.scenes', 1, 80)
  const identifiedSceneRows = rawSceneRows.map((value, index) => {
    const item = record(value, `scenes[${index}]`)
    const sceneKey = key(item.sceneKey, `scenes[${index}].sceneKey`)
    if (!fullActSceneKeys.includes(sceneKey)) fail(`scenes[${index}] 不属于本幕:${sceneKey}`)
    return { item, sceneKey, sourceIndex: index }
  })
  if (new Set(identifiedSceneRows.map(row => row.sceneKey)).size !== identifiedSceneRows.length) {
    fail('sceneScriptBundle.scenes sceneKey 重复')
  }
  const sceneRowByKey = new Map(identifiedSceneRows.map(scene => [scene.sceneKey, scene]))
  const missingSceneKeys = expectedSceneKeys.filter(sceneKey => !sceneRowByKey.has(sceneKey))
  if (missingSceneKeys.length > 0) {
    fail(`sceneScriptBundle.scenes 未覆盖冻结分包:实际=${identifiedSceneRows.map(scene => scene.sceneKey).join(',') || 'none'};缺失=${missingSceneKeys.join(',')}`)
  }
  // Some providers repeat the whole act for a bounded part request. Selecting
  // only frozen in-scope identities is lossless: no prose is invented and an
  // unknown, duplicate, or missing scene still fails closed.
  const selectedSceneRows = expectedSceneKeys.map(sceneKey => sceneRowByKey.get(sceneKey)!)
  const nestedChoiceRows = identifiedSceneRows.flatMap(scene => {
    if (scene.item.choices === undefined) return []
    return array(scene.item.choices, `scenes[${scene.sourceIndex}].choices`, 0, 100)
  })
  const scenes = selectedSceneRows.map(({ item, sceneKey, sourceIndex }) => {
      exactKeys(
        item,
        item.choices === undefined
          ? ['sceneKey', 'title', 'summary', 'beats']
          : ['sceneKey', 'title', 'summary', 'beats', 'choices'],
        `scenes[${sourceIndex}]`,
      )
      const beats = parseBeats({
        value: item.beats, label: `scenes[${sourceIndex}].beats`, allowedSpeakerKeys: speakerKeys,
      })
      const locationIndex = skeleton.sceneKeys.indexOf(sceneKey)
      const locationPlan = planTextAdventureNarrativeLocationsV1(
        skeleton.sceneKeys.length,
        input.locationTitles.length,
      )
      const locationTitle = input.locationTitles[locationPlan[locationIndex].locationIndex]
      text(item.title, `scenes[${sourceIndex}].title`, 300)
      // Title is immutable architecture metadata, not a creative slot owned by
      // the Scene Writer. Always project the accepted arc title so a provider
      // typo cannot rename the graph node or waste otherwise valid prose.
      const title = input.sceneTitles[sceneKey]
      if (!title) fail(`${sceneKey} 缺少已冻结叙事弧场景标题`)
      const authoredSummary = text(item.summary, `scenes[${sourceIndex}].summary`, 2_000)
      // Scene identity already has one deterministic location assignment from
      // the frozen architecture. Providers sometimes use a natural short name
      // in prose; preserve that prose while making the canonical location
      // visible to the player instead of discarding an otherwise valid paid
      // result or asking the model to invent state.
      const summary = locationTitle
        && ![title, authoredSummary, ...beats.map(beat => beat.text)].join('\n').includes(locationTitle)
        ? `${locationTitle}｜${authoredSummary}`
        : authoredSummary
      return { sceneKey, title, summary, beats }
    })
  const expectedEdges = skeleton.edges.filter(edge => expectedSceneKeys.includes(edge.sourceNodeKey))
  const fullActChoiceKeys = new Set(skeleton.edges
    .filter(edge => fullActSceneKeys.includes(edge.sourceNodeKey))
    .map(edge => edge.choiceKey))
  const rawChoiceRows = [
    ...array(row.choices ?? [], 'sceneScriptBundle.choices', 0, 100),
    ...nestedChoiceRows,
  ].map((value, index) => {
    const item = record(value, `choiceCandidates[${index}]`)
    const choiceKey = key(item.choiceKey, `choiceCandidates[${index}].choiceKey`)
    if (!fullActChoiceKeys.has(choiceKey)) fail(`choiceCandidates[${index}] 不属于本幕:${choiceKey}`)
    return { item, choiceKey, sourceIndex: index }
  })
  const choices = expectedEdges.map(expected => {
      const candidates = rawChoiceRows.filter(candidate => candidate.choiceKey === expected.choiceKey)
      if (candidates.length === 0) fail(`sceneScriptBundle.choices 缺少冻结选择 ${expected.choiceKey}`)
      const parsedCandidates = candidates.map(({ item, sourceIndex }) => {
      exactKeys(item, [
        'choiceKey', 'sourceNodeKey', 'targetNodeKey', 'text', 'description',
        ...(item.unavailableReason === undefined ? [] : ['unavailableReason']),
        ...(item.order === undefined ? [] : ['order']),
      ], `choiceCandidates[${sourceIndex}]`)
      const parsed = {
        choiceKey: key(item.choiceKey, `choiceCandidates[${sourceIndex}].choiceKey`),
        sourceNodeKey: key(item.sourceNodeKey, `choiceCandidates[${sourceIndex}].sourceNodeKey`),
        targetNodeKey: key(item.targetNodeKey, `choiceCandidates[${sourceIndex}].targetNodeKey`),
        text: text(item.text, `choiceCandidates[${sourceIndex}].text`, 240),
        description: text(item.description, `choiceCandidates[${sourceIndex}].description`, 1_000),
        unavailableReason: (item.unavailableReason === undefined
          ? ''
          : boundedString(item.unavailableReason, `choiceCandidates[${sourceIndex}].unavailableReason`, 500))
          || '当前状态不满足此行动条件。',
        order: item.order === undefined
          ? expected.order
          : integer(item.order, `choiceCandidates[${sourceIndex}].order`, 0, 100),
      }
      if (parsed.choiceKey !== expected.choiceKey || parsed.sourceNodeKey !== expected.sourceNodeKey
        || parsed.targetNodeKey !== expected.targetNodeKey || parsed.order !== expected.order) {
        fail(`choiceCandidates[${sourceIndex}] 改写了冻结图骨架`)
      }
      return parsed
      })
      if (new Set(parsedCandidates.map(candidate => JSON.stringify(candidate))).size !== 1) {
        fail(`${expected.choiceKey} 在根级与 scene 内的重复内容冲突`)
      }
      return parsedCandidates[0]
    })
  for (const sourceNodeKey of new Set(choices.map(choice => choice.sourceNodeKey))) {
    const sourceChoices = choices.filter(choice => choice.sourceNodeKey === sourceNodeKey)
    if (new Set(sourceChoices.map(choice => `${choice.text}\n${choice.description}`)).size !== sourceChoices.length) {
      fail(`${sourceNodeKey} 同源选择文案重复`)
    }
  }
  const expectedEndingKeys = input.actIndex === 2
    && expectedSceneKeys.includes(fullActSceneKeys[fullActSceneKeys.length - 1])
    ? skeleton.endingKeys : []
  const endings = array(
    row.endings ?? [], 'sceneScriptBundle.endings', expectedEndingKeys.length, expectedEndingKeys.length,
  )
    .map((value, index) => {
      const item = record(value, `endings[${index}]`)
      exactKeys(item, ['endingKey', 'title', 'summary', 'beats'], `endings[${index}]`)
      const endingKey = key(item.endingKey, `endings[${index}].endingKey`)
      if (endingKey !== expectedEndingKeys[index]) fail(`endings[${index}] 改写了冻结结局 key`)
      const beats = parseBeats({
        value: item.beats, label: `endings[${index}].beats`, allowedSpeakerKeys: speakerKeys,
      })
      const endingUnits = visibleUnits([item.summary, ...beats.map(beat => beat.text)].join('\n'))
      const minimumEndingUnits = input.brief.qualityProfile === 'commercial-candidate'
        ? Math.max(80, Math.min(400, Math.ceil(input.brief.scale.targetPlayMinutes * 4))) : 30
      if (endingUnits < minimumEndingUnits) fail(`${endingKey} 正文不足:${endingUnits}/${minimumEndingUnits}`)
      if (input.brief.qualityProfile === 'commercial-candidate') {
        validateTextAdventureCommercialEndingNarrativeV1({
          endingKey,
          endingText: [String(item.summary ?? ''), ...beats.map(beat => beat.text)].join('\n'),
          beats,
          requiredConsequences: input.endingConsequences?.[endingKey] ?? [],
          nonPlayerSpeakerKeys: input.nonPlayerSpeakerKeys ?? [],
        })
      }
      return {
        endingKey,
        title: (() => {
          const title = text(item.title, `endings[${index}].title`, 300)
          if (title !== input.endingTitles[endingKey]) fail(`${endingKey} title 必须复用故事圣经结局标题`)
          return title
        })(),
        summary: text(item.summary, `endings[${index}].summary`, 2_000),
        beats,
      }
    })
  if (input.brief.qualityProfile === 'commercial-candidate') {
    const minimumRouteUnits = Math.max(
      input.brief.scale.targetWordCount,
      Math.ceil(input.brief.scale.targetPlayMinutes * 200),
    )
    const minimumActUnits = Math.ceil(minimumRouteUnits * expectedSceneKeys.length / skeleton.sceneKeys.length)
    const minimumBundleUnits = expectedSceneKeys.length === fullActSceneKeys.length
      ? minimumActUnits
      : Math.ceil(minimumActUnits * 0.9)
    const actUnits = scenes.reduce((sum, scene) => (
      sum + visibleUnits([scene.summary, ...scene.beats.map(beat => beat.text)].join('\n'))
    ), 0)
    if (actUnits < minimumBundleUnits) fail(`第 ${input.actIndex + 1} 幕正文不足:${actUnits}/${minimumBundleUnits}`)
    const minimumSceneUnits = Math.floor(minimumActUnits / expectedSceneKeys.length * 0.75)
    for (const scene of scenes) {
      const sceneUnits = visibleUnits([scene.summary, ...scene.beats.map(beat => beat.text)].join('\n'))
      if (sceneUnits < minimumSceneUnits) {
        fail(`${scene.sceneKey} 正文不足:${sceneUnits}/${minimumSceneUnits}`)
      }
    }
    const minimumDialogueTurns = Math.ceil(
      Math.max(4, Math.ceil(input.brief.scale.targetPlayMinutes / 2))
      * expectedSceneKeys.length / skeleton.sceneKeys.length,
    )
    const dialogueTurns = scenes.flatMap(scene => scene.beats).filter(beat => beat.kind === 'dialogue').length
    if (dialogueTurns < minimumDialogueTurns) {
      fail(`第 ${input.actIndex + 1} 幕有效对白不足:${dialogueTurns}/${minimumDialogueTurns}`)
    }
  }
  const allBeatKeys = [
    ...scenes.flatMap(scene => scene.beats.map(beat => beat.beatKey)),
    ...endings.flatMap(ending => ending.beats.map(beat => beat.beatKey)),
  ]
  if (new Set(allBeatKeys).size !== allBeatKeys.length) fail('sceneScriptBundle 跨场景 beatKey 重复')
  return {
    schema: 'storyforge.text-adventure-scene-script-bundle-artifact', version: 1,
    actKey: expectedActKey,
    moduleTitle: (() => {
      const title = text(row.moduleTitle, 'sceneScriptBundle.moduleTitle', 300)
      if (title !== input.expectedModuleTitle) fail('sceneScriptBundle.moduleTitle 必须复用故事圣经标题')
      return title
    })(),
    scenes, choices, endings,
  }
}

export function assembleTextAdventureSceneScriptActV1(input: {
  brief: ProductProductionBriefV3
  actIndex: number
  bundles: readonly TextAdventureSceneScriptBundleArtifactV1[]
  allowedSpeakerKeys: readonly string[]
  locationTitles: readonly string[]
  expectedModuleTitle: string
  sceneTitles: Readonly<Record<string, string>>
  endingTitles: Readonly<Record<string, string>>
  endingConsequences?: Readonly<Record<string, readonly string[]>>
  nonPlayerSpeakerKeys?: readonly string[]
}): TextAdventureSceneScriptBundleArtifactV1 {
  const expectedParts = textAdventureSceneScriptPartSceneKeysV1(input.brief, input.actIndex)
  if (input.bundles.length !== expectedParts.length) fail('分场幕装配缺少或重复正文分包')
  const byFirstScene = new Map(input.bundles.map(bundle => [bundle.scenes[0]?.sceneKey, bundle]))
  const ordered = expectedParts.map(part => byFirstScene.get(part[0]))
  if (ordered.some(bundle => !bundle)) fail('分场幕装配无法按冻结场景边界排序')
  const bundles = ordered as TextAdventureSceneScriptBundleArtifactV1[]
  if (new Set(bundles.map(bundle => bundle.moduleTitle)).size !== 1
    || bundles.some(bundle => bundle.actKey !== `act.${input.actIndex + 1}`)) {
    fail('分场幕装配的 actKey/moduleTitle 不一致')
  }
  return parseTextAdventureSceneScriptBundleArtifactV1({
    value: {
      schema: 'storyforge.text-adventure-scene-script-bundle-artifact',
      version: 1,
      actKey: `act.${input.actIndex + 1}`,
      moduleTitle: bundles[0].moduleTitle,
      scenes: bundles.flatMap(bundle => bundle.scenes),
      choices: bundles.flatMap(bundle => bundle.choices),
      endings: bundles.flatMap(bundle => bundle.endings),
    },
    brief: input.brief,
    actIndex: input.actIndex,
    allowedSpeakerKeys: input.allowedSpeakerKeys,
    locationTitles: input.locationTitles,
    expectedModuleTitle: input.expectedModuleTitle,
    sceneTitles: input.sceneTitles,
    endingTitles: input.endingTitles,
    endingConsequences: input.endingConsequences,
    nonPlayerSpeakerKeys: input.nonPlayerSpeakerKeys,
  })
}

export function assembleTextAdventureNarrativeFromSceneScriptsV1(input: {
  brief: ProductProductionBriefV3
  bundles: readonly TextAdventureSceneScriptBundleArtifactV1[]
}): TextAdventureAssembledNarrativeArtifactV1 {
  if (input.bundles.length !== 3) fail('分场装配必须包含三幕脚本')
  const bundles = [...input.bundles].sort((left, right) => left.actKey.localeCompare(right.actKey))
  if (bundles.map(bundle => bundle.actKey).join(',') !== 'act.1,act.2,act.3') fail('分场装配缺少或重复幕')
  if (new Set(bundles.map(bundle => bundle.moduleTitle)).size !== 1) fail('三幕 moduleTitle 不一致')
  const sceneNodes: FrozenProductNarrativeNode[] = bundles.flatMap(bundle => bundle.scenes).map((scene, index) => ({
    key: scene.sceneKey,
    kind: index === 0 ? 'entry' : 'scene',
    title: scene.title,
    summary: scene.summary,
    conditionJson: '{}',
    effectsJson: '[]',
    successorKeys: [],
  }))
  const endingNodes: FrozenProductNarrativeNode[] = bundles.flatMap(bundle => bundle.endings).map(ending => ({
    key: ending.endingKey,
    kind: 'ending',
    title: ending.title,
    summary: ending.summary,
    conditionJson: '{}',
    effectsJson: '[]',
    successorKeys: [],
  }))
  const choices: FrozenNarrativeChoice[] = bundles.flatMap(bundle => bundle.choices).map(choice => ({
    choiceKey: choice.choiceKey,
    sourceNodeKey: choice.sourceNodeKey,
    text: choice.text,
    description: choice.description,
    unavailableReason: choice.unavailableReason,
    targetNodeKey: choice.targetNodeKey,
    displayConditionJson: '{}',
    availableConditionJson: '{}',
    effectsJson: '[]',
    tags: [],
    order: choice.order,
  }))
  const outgoing = new Map<string, string[]>()
  for (const node of [...sceneNodes, ...endingNodes]) outgoing.set(node.key, [])
  for (const choice of choices) outgoing.get(choice.sourceNodeKey)?.push(choice.targetNodeKey)
  const nodes = [...sceneNodes, ...endingNodes].map(node => ({
    ...node, successorKeys: [...new Set(outgoing.get(node.key) ?? [])],
  }))
  const beats: FrozenNarrativeBeat[] = bundles.flatMap(bundle => [
    ...bundle.scenes.flatMap(scene => scene.beats.map(beat => ({ ...beat, nodeKey: scene.sceneKey }))),
    ...bundle.endings.flatMap(ending => ending.beats.map(beat => ({ ...beat, nodeKey: ending.endingKey }))),
  ])
  if (new Set(beats.map(beat => beat.beatKey)).size !== beats.length) fail('跨幕 beatKey 重复')
  return {
    schema: 'storyforge.product-narrative-artifact',
    version: 1,
    moduleKind: 'main',
    moduleTitle: bundles[0].moduleTitle,
    entryNodeKey: textAdventureNarrativeSkeletonV1(input.brief).sceneKeys[0],
    nodes,
    beats,
    choices,
  }
}
