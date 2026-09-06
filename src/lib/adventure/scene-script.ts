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
    exactKeys(item, ['beatKey', 'kind', 'speakerKey', 'text', 'order'], `${input.label}[${index}]`)
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
      order: integer(item.order, `${input.label}[${index}].order`, 0, 1_000),
    }
  })
  if (new Set(beats.map(beat => beat.beatKey)).size !== beats.length) fail(`${input.label} beatKey 重复`)
  const sorted = [...beats].sort((left, right) => left.order - right.order || left.beatKey.localeCompare(right.beatKey))
  if (sorted.some((beat, index) => beat !== beats[index])) fail(`${input.label} 必须按 order 稳定排序`)
  return beats
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
}): TextAdventureSceneScriptBundleArtifactV1 {
  if (!input.brief.textAdventure) fail('分场脚本缺少文字冒险 Brief')
  if (input.locationTitles.length < 1) fail('分场脚本缺少已冻结地点')
  const row = record(input.value, 'sceneScriptBundle')
  exactKeys(row, ['schema', 'version', 'actKey', 'moduleTitle', 'scenes', 'choices', 'endings'], 'sceneScriptBundle')
  if (row.schema !== 'storyforge.text-adventure-scene-script-bundle-artifact' || row.version !== 1) {
    fail('sceneScriptBundle schema/version 无效')
  }
  const expectedActKey = `act.${input.actIndex + 1}`
  if (row.actKey !== expectedActKey) fail(`sceneScriptBundle actKey 必须为 ${expectedActKey}`)
  const skeleton = textAdventureNarrativeSkeletonV1(input.brief)
  const expectedSceneKeys = textAdventureActSceneKeysV1(input.brief, input.actIndex)
  const speakerKeys = new Set(input.allowedSpeakerKeys)
  const scenes = array(row.scenes, 'sceneScriptBundle.scenes', expectedSceneKeys.length, expectedSceneKeys.length)
    .map((value, index) => {
      const item = record(value, `scenes[${index}]`)
      exactKeys(item, ['sceneKey', 'title', 'summary', 'beats'], `scenes[${index}]`)
      const sceneKey = key(item.sceneKey, `scenes[${index}].sceneKey`)
      if (sceneKey !== expectedSceneKeys[index]) fail(`scenes[${index}] 必须为 ${expectedSceneKeys[index]}`)
      const beats = parseBeats({
        value: item.beats, label: `scenes[${index}].beats`, allowedSpeakerKeys: speakerKeys,
      })
      const locationIndex = skeleton.sceneKeys.indexOf(sceneKey)
      const locationPlan = planTextAdventureNarrativeLocationsV1(
        skeleton.sceneKeys.length,
        input.locationTitles.length,
      )
      const locationTitle = input.locationTitles[locationPlan[locationIndex].locationIndex]
      const title = text(item.title, `scenes[${index}].title`, 300)
      if (title !== input.sceneTitles[sceneKey]) fail(`${sceneKey} title 必须复用叙事弧场景标题`)
      const summary = text(item.summary, `scenes[${index}].summary`, 2_000)
      if (locationTitle && ![title, summary, ...beats.map(beat => beat.text)].join('\n').includes(locationTitle)) {
        fail(`${sceneKey} 正文没有落实地点 ${locationTitle}`)
      }
      return { sceneKey, title, summary, beats }
    })
  const expectedEdges = skeleton.edges.filter(edge => expectedSceneKeys.includes(edge.sourceNodeKey))
  const choices = array(row.choices, 'sceneScriptBundle.choices', expectedEdges.length, expectedEdges.length)
    .map((value, index) => {
      const item = record(value, `choices[${index}]`)
      exactKeys(item, [
        'choiceKey', 'sourceNodeKey', 'targetNodeKey', 'text', 'description', 'unavailableReason', 'order',
      ], `choices[${index}]`)
      const expected = expectedEdges[index]
      const parsed = {
        choiceKey: key(item.choiceKey, `choices[${index}].choiceKey`),
        sourceNodeKey: key(item.sourceNodeKey, `choices[${index}].sourceNodeKey`),
        targetNodeKey: key(item.targetNodeKey, `choices[${index}].targetNodeKey`),
        text: text(item.text, `choices[${index}].text`, 240),
        description: text(item.description, `choices[${index}].description`, 1_000),
        unavailableReason: text(item.unavailableReason, `choices[${index}].unavailableReason`, 500),
        order: integer(item.order, `choices[${index}].order`, 0, 100),
      }
      if (parsed.choiceKey !== expected.choiceKey || parsed.sourceNodeKey !== expected.sourceNodeKey
        || parsed.targetNodeKey !== expected.targetNodeKey || parsed.order !== expected.order) {
        fail(`choices[${index}] 改写了冻结图骨架`)
      }
      return parsed
    })
  for (const sourceNodeKey of new Set(choices.map(choice => choice.sourceNodeKey))) {
    const sourceChoices = choices.filter(choice => choice.sourceNodeKey === sourceNodeKey)
    if (new Set(sourceChoices.map(choice => `${choice.text}\n${choice.description}`)).size !== sourceChoices.length) {
      fail(`${sourceNodeKey} 同源选择文案重复`)
    }
  }
  const expectedEndingCount = input.actIndex === 2 ? skeleton.endingKeys.length : 0
  const endings = array(row.endings, 'sceneScriptBundle.endings', expectedEndingCount, expectedEndingCount)
    .map((value, index) => {
      const item = record(value, `endings[${index}]`)
      exactKeys(item, ['endingKey', 'title', 'summary', 'beats'], `endings[${index}]`)
      const endingKey = key(item.endingKey, `endings[${index}].endingKey`)
      if (endingKey !== skeleton.endingKeys[index]) fail(`endings[${index}] 改写了冻结结局 key`)
      const beats = parseBeats({
        value: item.beats, label: `endings[${index}].beats`, allowedSpeakerKeys: speakerKeys,
      })
      const endingUnits = visibleUnits([item.summary, ...beats.map(beat => beat.text)].join('\n'))
      const minimumEndingUnits = input.brief.qualityProfile === 'commercial-candidate'
        ? Math.max(80, Math.min(400, Math.ceil(input.brief.scale.targetPlayMinutes * 4))) : 30
      if (endingUnits < minimumEndingUnits) fail(`${endingKey} 正文不足:${endingUnits}/${minimumEndingUnits}`)
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
    const actUnits = scenes.reduce((sum, scene) => (
      sum + visibleUnits([scene.summary, ...scene.beats.map(beat => beat.text)].join('\n'))
    ), 0)
    if (actUnits < minimumActUnits) fail(`第 ${input.actIndex + 1} 幕正文不足:${actUnits}/${minimumActUnits}`)
    const minimumDialogueTurns = Math.ceil(
      Math.max(4, Math.ceil(input.brief.scale.targetPlayMinutes / 2))
      * expectedSceneKeys.length / skeleton.sceneKeys.length,
    )
    const dialogueTurns = scenes.flatMap(scene => scene.beats).filter(beat => beat.kind === 'dialogue').length
    if (dialogueTurns < minimumDialogueTurns) {
      fail(`第 ${input.actIndex + 1} 幕有效对白不足:${dialogueTurns}/${minimumDialogueTurns}`)
    }
  }
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
