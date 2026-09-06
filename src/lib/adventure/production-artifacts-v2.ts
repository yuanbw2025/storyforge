import type { ProductProductionBriefV3 } from '../types'
import type {
  TextAdventureQuestBundleArtifactV1,
  TextAdventureSystemsArtifactV1,
} from './production-artifacts'
import {
  textAdventureActSceneKeysV1,
  textAdventureNarrativeSkeletonV1,
} from './scene-script'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function fail(message: string): never {
  throw new Error(`[text-adventure-production-artifact-v2] ${message}`)
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

function text(value: unknown, label: string, maximum = 4_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}

function nullableText(value: unknown, label: string, maximum = 500): string | null {
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

function array(value: unknown, label: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(`${label} 数量无效`)
  return value
}

function textArray(value: unknown, label: string, minimum: number, maximum: number): string[] {
  const parsed = array(value, label, minimum, maximum).map((item, index) => text(item, `${label}[${index}]`, 1_000))
  if (new Set(parsed).size !== parsed.length) fail(`${label} 不允许重复`)
  return parsed
}

function keyArray(value: unknown, label: string, minimum: number, maximum: number): string[] {
  const parsed = array(value, label, minimum, maximum).map((item, index) => key(item, `${label}[${index}]`))
  if (new Set(parsed).size !== parsed.length) fail(`${label} 不允许重复`)
  return parsed
}

export const TEXT_ADVENTURE_SOURCE_DOMAINS_V1 = [
  'world-premise', 'time-and-era', 'space', 'characters', 'organizations',
  'conflicts', 'history', 'rules-and-abilities', 'items', 'visual-anchors', 'boundaries',
] as const
export type TextAdventureSourceDomainV1 = typeof TEXT_ADVENTURE_SOURCE_DOMAINS_V1[number]

export interface TextAdventureSourceSufficiencyArtifactV1 {
  schema: 'storyforge.text-adventure-source-sufficiency-artifact'
  version: 1
  decision: 'ready' | 'ready-with-private-additions' | 'blocked'
  adaptationStrategy: 'adapt-rich' | 'expand-sparse' | 'author-outline'
  coverage: Array<{
    domain: TextAdventureSourceDomainV1
    status: 'sufficient' | 'partial' | 'missing' | 'conflicting'
    resourceKeys: string[]
    rationale: string
  }>
  gaps: Array<{
    key: string
    severity: 'warning' | 'blocking'
    description: string
    affectedStages: string[]
  }>
  privateAdditions: Array<{
    key: string
    kind: 'character' | 'location-detail' | 'event' | 'item' | 'rule-detail'
    title: string
    rationale: string
  }>
  authorDecisionRequired: boolean
}

export function parseTextAdventureSourceSufficiencyArtifactV1(input: {
  value: unknown
  brief: ProductProductionBriefV3
  allowedResourceKeys: readonly string[]
}): TextAdventureSourceSufficiencyArtifactV1 {
  if (!input.brief.textAdventure) fail('来源审计缺少文字冒险 Brief')
  const row = record(input.value, 'sourceSufficiency')
  exactKeys(row, [
    'schema', 'version', 'decision', 'adaptationStrategy', 'coverage', 'gaps',
    'privateAdditions', 'authorDecisionRequired',
  ], 'sourceSufficiency')
  if (row.schema !== 'storyforge.text-adventure-source-sufficiency-artifact' || row.version !== 1) {
    fail('sourceSufficiency schema/version 无效')
  }
  const allowed = new Set(input.allowedResourceKeys)
  const coverage = array(row.coverage, 'coverage', 1, TEXT_ADVENTURE_SOURCE_DOMAINS_V1.length)
    .map((value, index) => {
      const item = record(value, `coverage[${index}]`)
      exactKeys(item, ['domain', 'status', 'resourceKeys', 'rationale'], `coverage[${index}]`)
      const resourceKeys = keyArray(item.resourceKeys, `coverage[${index}].resourceKeys`, 0, 200)
      if (resourceKeys.some(resourceKey => !allowed.has(resourceKey))) {
        fail(`coverage[${index}] 引用未授权世界资源`)
      }
      return {
        domain: enumValue(item.domain, TEXT_ADVENTURE_SOURCE_DOMAINS_V1, `coverage[${index}].domain`),
        status: enumValue(item.status, ['sufficient', 'partial', 'missing', 'conflicting'], `coverage[${index}].status`),
        resourceKeys,
        rationale: text(item.rationale, `coverage[${index}].rationale`, 2_000),
      }
    })
  if (new Set(coverage.map(item => item.domain)).size !== coverage.length) fail('coverage.domain 重复')
  const gaps = array(row.gaps, 'gaps', 0, 100).map((value, index) => {
    const item = record(value, `gaps[${index}]`)
    exactKeys(item, ['key', 'severity', 'description', 'affectedStages'], `gaps[${index}]`)
    return {
      key: key(item.key, `gaps[${index}].key`),
      severity: enumValue(item.severity, ['warning', 'blocking'], `gaps[${index}].severity`),
      description: text(item.description, `gaps[${index}].description`, 2_000),
      affectedStages: keyArray(item.affectedStages, `gaps[${index}].affectedStages`, 1, 20),
    }
  })
  const privateAdditions = array(row.privateAdditions, 'privateAdditions', 0, 100).map((value, index) => {
    const item = record(value, `privateAdditions[${index}]`)
    exactKeys(item, ['key', 'kind', 'title', 'rationale'], `privateAdditions[${index}]`)
    return {
      key: key(item.key, `privateAdditions[${index}].key`),
      kind: enumValue(item.kind, ['character', 'location-detail', 'event', 'item', 'rule-detail'], `privateAdditions[${index}].kind`),
      title: text(item.title, `privateAdditions[${index}].title`, 300),
      rationale: text(item.rationale, `privateAdditions[${index}].rationale`, 2_000),
    }
  })
  if (new Set([...gaps.map(item => item.key), ...privateAdditions.map(item => item.key)]).size
    !== gaps.length + privateAdditions.length) fail('gap/privateAddition key 重复')
  const decision = enumValue(row.decision, ['ready', 'ready-with-private-additions', 'blocked'], 'decision')
  if (typeof row.authorDecisionRequired !== 'boolean') fail('authorDecisionRequired 必须是 boolean')
  const hasBlocking = gaps.some(gap => gap.severity === 'blocking')
    || coverage.some(item => item.status === 'conflicting')
  if ((decision === 'blocked') !== hasBlocking) fail('decision 与 blocking 证据不一致')
  if (decision === 'ready-with-private-additions' && privateAdditions.length === 0) {
    fail('ready-with-private-additions 缺少补充提案')
  }
  if ((decision !== 'ready') !== row.authorDecisionRequired) {
    fail('authorDecisionRequired 与来源决策不一致')
  }
  return {
    schema: 'storyforge.text-adventure-source-sufficiency-artifact', version: 1,
    decision,
    adaptationStrategy: enumValue(
      row.adaptationStrategy,
      ['adapt-rich', 'expand-sparse', 'author-outline'],
      'adaptationStrategy',
    ),
    coverage, gaps, privateAdditions, authorDecisionRequired: row.authorDecisionRequired,
  }
}

export interface TextAdventureStoryBibleArtifactV1 {
  schema: 'storyforge.text-adventure-story-bible-artifact'
  version: 1
  title: string
  premise: string
  playerFantasy: string
  thematicQuestion: string
  emotionalPromise: string
  centralConflict: string
  canonFacts: string[]
  productPrivateFacts: string[]
  prohibitions: string[]
  setupPayoffs: Array<{
    key: string
    setup: string
    payoff: string
    introducedAct: number
    resolvedAct: number
  }>
  endings: Array<{
    key: string
    title: string
    dramaticAnswer: string
    requiredConsequences: string[]
  }>
}

export function parseTextAdventureStoryBibleArtifactV1(
  value: unknown,
  brief: ProductProductionBriefV3,
): TextAdventureStoryBibleArtifactV1 {
  if (!brief.textAdventure) fail('故事圣经缺少文字冒险 Brief')
  const row = record(value, 'storyBible')
  exactKeys(row, [
    'schema', 'version', 'title', 'premise', 'playerFantasy', 'thematicQuestion',
    'emotionalPromise', 'centralConflict', 'canonFacts', 'productPrivateFacts',
    'prohibitions', 'setupPayoffs', 'endings',
  ], 'storyBible')
  if (row.schema !== 'storyforge.text-adventure-story-bible-artifact' || row.version !== 1) {
    fail('storyBible schema/version 无效')
  }
  const setupPayoffs = array(row.setupPayoffs, 'setupPayoffs', 2, 40).map((value, index) => {
    const item = record(value, `setupPayoffs[${index}]`)
    exactKeys(item, ['key', 'setup', 'payoff', 'introducedAct', 'resolvedAct'], `setupPayoffs[${index}]`)
    const introducedAct = integer(item.introducedAct, `setupPayoffs[${index}].introducedAct`, 1, 20)
    const resolvedAct = integer(item.resolvedAct, `setupPayoffs[${index}].resolvedAct`, introducedAct, 20)
    return {
      key: key(item.key, `setupPayoffs[${index}].key`),
      setup: text(item.setup, `setupPayoffs[${index}].setup`, 2_000),
      payoff: text(item.payoff, `setupPayoffs[${index}].payoff`, 2_000),
      introducedAct, resolvedAct,
    }
  })
  const endingKeys = textAdventureNarrativeSkeletonV1(brief).endingKeys
  const endings = array(row.endings, 'endings', endingKeys.length, endingKeys.length).map((value, index) => {
    const item = record(value, `endings[${index}]`)
    exactKeys(item, ['key', 'title', 'dramaticAnswer', 'requiredConsequences'], `endings[${index}]`)
    const endingKey = key(item.key, `endings[${index}].key`)
    if (endingKey !== endingKeys[index]) fail(`endings[${index}].key 必须为 ${endingKeys[index]}`)
    return {
      key: endingKey,
      title: text(item.title, `endings[${index}].title`, 300),
      dramaticAnswer: text(item.dramaticAnswer, `endings[${index}].dramaticAnswer`, 2_000),
      requiredConsequences: textArray(item.requiredConsequences, `endings[${index}].requiredConsequences`, 2, 12),
    }
  })
  if (new Set(setupPayoffs.map(item => item.key)).size !== setupPayoffs.length
    || new Set(endings.map(item => item.key)).size !== endings.length) fail('故事圣经稳定 key 重复')
  return {
    schema: 'storyforge.text-adventure-story-bible-artifact', version: 1,
    title: text(row.title, 'title', 300), premise: text(row.premise, 'premise'),
    playerFantasy: text(row.playerFantasy, 'playerFantasy'),
    thematicQuestion: text(row.thematicQuestion, 'thematicQuestion'),
    emotionalPromise: text(row.emotionalPromise, 'emotionalPromise'),
    centralConflict: text(row.centralConflict, 'centralConflict'),
    canonFacts: textArray(row.canonFacts, 'canonFacts', 3, 100),
    productPrivateFacts: textArray(row.productPrivateFacts, 'productPrivateFacts', 0, 100),
    prohibitions: textArray(row.prohibitions, 'prohibitions', 1, 100),
    setupPayoffs, endings,
  }
}

export interface TextAdventureCastBibleArtifactV1 {
  schema: 'storyforge.text-adventure-cast-bible-artifact'
  version: 1
  characters: Array<{
    key: string
    role: 'player' | 'major-npc' | 'supporting-npc'
    sourceResourceKey: string | null
    name: string
    publicIdentity: string
    desire: string
    fear: string
    secret: string
    motivation: string
    voice: string
    initialKnowledge: string[]
    forbiddenKnowledge: string[]
    relationshipArc: string[]
    visualAnchor: string
  }>
}

export function parseTextAdventureCastBibleArtifactV1(input: {
  value: unknown
  brief: ProductProductionBriefV3
  allowedResourceKeys: readonly string[]
}): TextAdventureCastBibleArtifactV1 {
  if (!input.brief.textAdventure) fail('角色圣经缺少文字冒险 Brief')
  const row = record(input.value, 'castBible')
  exactKeys(row, ['schema', 'version', 'characters'], 'castBible')
  if (row.schema !== 'storyforge.text-adventure-cast-bible-artifact' || row.version !== 1) {
    fail('castBible schema/version 无效')
  }
  const allowed = new Set(input.allowedResourceKeys)
  const minimumCharacters = input.brief.qualityProfile === 'commercial-candidate'
    ? Math.max(6, Math.ceil(input.brief.scale.targetPlayMinutes / 12) + 1)
    : 2
  const characters = array(row.characters, 'characters', minimumCharacters, 40).map((value, index) => {
    const item = record(value, `characters[${index}]`)
    exactKeys(item, [
      'key', 'role', 'sourceResourceKey', 'name', 'publicIdentity', 'desire', 'fear', 'secret',
      'motivation', 'voice', 'initialKnowledge', 'forbiddenKnowledge', 'relationshipArc', 'visualAnchor',
    ], `characters[${index}]`)
    const sourceResourceKey = nullableText(item.sourceResourceKey, `characters[${index}].sourceResourceKey`, 200)
    if (sourceResourceKey && (!STABLE_KEY.test(sourceResourceKey) || !allowed.has(sourceResourceKey))) {
      fail(`characters[${index}].sourceResourceKey 未授权`)
    }
    return {
      key: key(item.key, `characters[${index}].key`),
      role: enumValue(item.role, ['player', 'major-npc', 'supporting-npc'], `characters[${index}].role`),
      sourceResourceKey,
      name: text(item.name, `characters[${index}].name`, 200),
      publicIdentity: text(item.publicIdentity, `characters[${index}].publicIdentity`, 1_000),
      desire: text(item.desire, `characters[${index}].desire`, 1_000),
      fear: text(item.fear, `characters[${index}].fear`, 1_000),
      secret: text(item.secret, `characters[${index}].secret`, 1_000),
      motivation: text(item.motivation, `characters[${index}].motivation`, 1_000),
      voice: text(item.voice, `characters[${index}].voice`, 1_000),
      initialKnowledge: textArray(item.initialKnowledge, `characters[${index}].initialKnowledge`, 1, 30),
      forbiddenKnowledge: textArray(item.forbiddenKnowledge, `characters[${index}].forbiddenKnowledge`, 1, 30),
      relationshipArc: textArray(item.relationshipArc, `characters[${index}].relationshipArc`, 2, 12),
      visualAnchor: text(item.visualAnchor, `characters[${index}].visualAnchor`, 2_000),
    }
  })
  if (new Set(characters.map(item => item.key)).size !== characters.length
    || new Set(characters.map(item => item.name)).size !== characters.length) fail('角色 key/name 重复')
  if (characters.filter(item => item.role === 'player').length !== 1) fail('角色圣经必须恰好一个 player')
  const minimumNpcs = input.brief.qualityProfile === 'commercial-candidate'
    ? Math.max(5, Math.ceil(input.brief.scale.targetPlayMinutes / 12)) : 1
  if (characters.filter(item => item.role !== 'player').length < minimumNpcs) fail(`主要角色不足:${minimumNpcs}`)
  return { schema: 'storyforge.text-adventure-cast-bible-artifact', version: 1, characters }
}

export interface TextAdventureNarrativeArcPlanArtifactV1 {
  schema: 'storyforge.text-adventure-narrative-arc-plan-artifact'
  version: 1
  acts: Array<{
    key: string
    title: string
    targetMinutes: number
    goal: string
    irreversibleTurn: string
    sceneCards: Array<{
      key: string
      title: string
      locationOrdinal: number
      purpose: string
      conflict: string
      entryState: string
      exitState: string
      castKeys: string[]
      setupKeys: string[]
      payoffKeys: string[]
    }>
  }>
  decisions: Array<{
    key: string
    sceneKey: string
    prompt: string
    options: Array<{
      key: string
      label: string
      cost: string
      persistentEffectKey: string
      echoSceneKeys: string[]
    }>
  }>
  endings: Array<{ endingKey: string; sceneKey: string }>
}

export function parseTextAdventureNarrativeArcPlanArtifactV1(input: {
  value: unknown
  brief: ProductProductionBriefV3
  cast: TextAdventureCastBibleArtifactV1
  storyBible: TextAdventureStoryBibleArtifactV1
}): TextAdventureNarrativeArcPlanArtifactV1 {
  if (!input.brief.textAdventure) fail('叙事弧缺少文字冒险 Brief')
  const row = record(input.value, 'arcPlan')
  exactKeys(row, ['schema', 'version', 'acts', 'decisions', 'endings'], 'arcPlan')
  if (row.schema !== 'storyforge.text-adventure-narrative-arc-plan-artifact' || row.version !== 1) {
    fail('arcPlan schema/version 无效')
  }
  const castKeys = new Set(input.cast.characters.map(item => item.key))
  const setupKeys = new Set(input.storyBible.setupPayoffs.map(item => item.key))
  const skeleton = textAdventureNarrativeSkeletonV1(input.brief)
  const acts = array(row.acts, 'acts', 3, 3).map((value, actIndex) => {
    const item = record(value, `acts[${actIndex}]`)
    exactKeys(item, ['key', 'title', 'targetMinutes', 'goal', 'irreversibleTurn', 'sceneCards'], `acts[${actIndex}]`)
    const expectedSceneKeys = textAdventureActSceneKeysV1(input.brief, actIndex)
    const sceneCards = array(
      item.sceneCards,
      `acts[${actIndex}].sceneCards`,
      expectedSceneKeys.length,
      expectedSceneKeys.length,
    ).map((value, sceneIndex) => {
      const scene = record(value, `acts[${actIndex}].sceneCards[${sceneIndex}]`)
      exactKeys(scene, [
        'key', 'title', 'locationOrdinal', 'purpose', 'conflict', 'entryState', 'exitState',
        'castKeys', 'setupKeys', 'payoffKeys',
      ], `acts[${actIndex}].sceneCards[${sceneIndex}]`)
      const parsedCastKeys = keyArray(scene.castKeys, `sceneCards[${sceneIndex}].castKeys`, 0, 20)
      const parsedSetupKeys = keyArray(scene.setupKeys, `sceneCards[${sceneIndex}].setupKeys`, 0, 20)
      const parsedPayoffKeys = keyArray(scene.payoffKeys, `sceneCards[${sceneIndex}].payoffKeys`, 0, 20)
      if (parsedCastKeys.some(value => !castKeys.has(value))) fail(`sceneCards[${sceneIndex}] 引用未知角色`)
      if ([...parsedSetupKeys, ...parsedPayoffKeys].some(value => !setupKeys.has(value))) {
        fail(`sceneCards[${sceneIndex}] 引用未知铺垫回收`)
      }
      const sceneKey = key(scene.key, `sceneCards[${sceneIndex}].key`)
      if (sceneKey !== expectedSceneKeys[sceneIndex]) {
        fail(`acts[${actIndex}].sceneCards[${sceneIndex}].key 必须为 ${expectedSceneKeys[sceneIndex]}`)
      }
      return {
        key: sceneKey,
        title: text(scene.title, `sceneCards[${sceneIndex}].title`, 300),
        locationOrdinal: integer(scene.locationOrdinal, `sceneCards[${sceneIndex}].locationOrdinal`, 1, input.brief.textAdventure!.narrative.targetLocationCount),
        purpose: text(scene.purpose, `sceneCards[${sceneIndex}].purpose`, 2_000),
        conflict: text(scene.conflict, `sceneCards[${sceneIndex}].conflict`, 2_000),
        entryState: text(scene.entryState, `sceneCards[${sceneIndex}].entryState`, 2_000),
        exitState: text(scene.exitState, `sceneCards[${sceneIndex}].exitState`, 2_000),
        castKeys: parsedCastKeys, setupKeys: parsedSetupKeys, payoffKeys: parsedPayoffKeys,
      }
    })
    const actKey = key(item.key, `acts[${actIndex}].key`)
    if (actKey !== `act.${actIndex + 1}`) fail(`acts[${actIndex}].key 必须为 act.${actIndex + 1}`)
    return {
      key: actKey,
      title: text(item.title, `acts[${actIndex}].title`, 300),
      targetMinutes: integer(item.targetMinutes, `acts[${actIndex}].targetMinutes`, 1, 120),
      goal: text(item.goal, `acts[${actIndex}].goal`, 2_000),
      irreversibleTurn: text(item.irreversibleTurn, `acts[${actIndex}].irreversibleTurn`, 2_000),
      sceneCards,
    }
  })
  const sceneKeys = new Set(acts.flatMap(act => act.sceneCards.map(scene => scene.key)))
  if (sceneKeys.size !== acts.reduce((sum, act) => sum + act.sceneCards.length, 0)) fail('scene key 重复')
  if (sceneKeys.size !== skeleton.sceneKeys.length) fail('叙事弧场景卡没有精确覆盖 Brief 目标')
  const totalMinutes = acts.reduce((sum, act) => sum + act.targetMinutes, 0)
  if (Math.abs(totalMinutes - input.brief.scale.targetPlayMinutes) > Math.max(5, input.brief.scale.targetPlayMinutes * 0.15)) {
    fail('叙事弧各幕目标分钟与 Brief 不闭合')
  }
  const decisionSceneKeys = skeleton.sceneKeys.slice(0, skeleton.statefulDecisionSceneCount)
  const decisions = array(
    row.decisions,
    'decisions',
    decisionSceneKeys.length,
    decisionSceneKeys.length,
  ).map((value, index) => {
    const item = record(value, `decisions[${index}]`)
    exactKeys(item, ['key', 'sceneKey', 'prompt', 'options'], `decisions[${index}]`)
    const sceneKey = key(item.sceneKey, `decisions[${index}].sceneKey`)
    if (sceneKey !== decisionSceneKeys[index]) {
      fail(`decisions[${index}].sceneKey 必须为 ${decisionSceneKeys[index]}`)
    }
    const options = array(item.options, `decisions[${index}].options`, 2, 2).map((value, optionIndex) => {
      const option = record(value, `decisions[${index}].options[${optionIndex}]`)
      exactKeys(option, ['key', 'label', 'cost', 'persistentEffectKey', 'echoSceneKeys'], `decisions[${index}].options[${optionIndex}]`)
      const echoSceneKeys = keyArray(option.echoSceneKeys, `decisions[${index}].options[${optionIndex}].echoSceneKeys`, 2, 20)
      if (echoSceneKeys.some(value => !sceneKeys.has(value))) fail(`decisions[${index}] 回响场景不存在`)
      return {
        key: key(option.key, `decisions[${index}].options[${optionIndex}].key`),
        label: text(option.label, `decisions[${index}].options[${optionIndex}].label`, 120),
        cost: text(option.cost, `decisions[${index}].options[${optionIndex}].cost`, 1_000),
        persistentEffectKey: key(option.persistentEffectKey, `decisions[${index}].options[${optionIndex}].persistentEffectKey`),
        echoSceneKeys,
      }
    })
    if (new Set(options.map(option => option.key)).size !== options.length
      || new Set(options.map(option => option.persistentEffectKey)).size !== options.length) {
      fail(`decisions[${index}] 选项 key/effect 重复`)
    }
    return {
      key: key(item.key, `decisions[${index}].key`), sceneKey,
      prompt: text(item.prompt, `decisions[${index}].prompt`, 1_000), options,
    }
  })
  const storyEndingKeys = new Set(input.storyBible.endings.map(item => item.key))
  const endings = array(row.endings, 'endings', skeleton.endingKeys.length, skeleton.endingKeys.length).map((value, index) => {
    const item = record(value, `endings[${index}]`)
    exactKeys(item, ['endingKey', 'sceneKey'], `endings[${index}]`)
    const endingKey = key(item.endingKey, `endings[${index}].endingKey`)
    const sceneKey = key(item.sceneKey, `endings[${index}].sceneKey`)
    if (endingKey !== skeleton.endingKeys[index] || !storyEndingKeys.has(endingKey)) {
      fail(`endings[${index}] 必须复用冻结结局 ${skeleton.endingKeys[index]}`)
    }
    if (sceneKey !== skeleton.sceneKeys[skeleton.sceneKeys.length - 1]) {
      fail(`endings[${index}] 必须从终幕最后场景汇出`)
    }
    return { endingKey, sceneKey }
  })
  if (new Set(acts.map(item => item.key)).size !== acts.length
    || new Set(decisions.map(item => item.key)).size !== decisions.length
    || new Set(endings.map(item => item.endingKey)).size !== endings.length) fail('叙事弧稳定 key 重复')
  return {
    schema: 'storyforge.text-adventure-narrative-arc-plan-artifact', version: 1,
    acts, decisions, endings,
  }
}

export interface TextAdventureQuestPlanArtifactV1 {
  schema: 'storyforge.text-adventure-quest-plan-artifact'
  version: 1
  bundleKind: 'main' | 'side' | 'ambient'
  quests: Array<{
    key: string
    title: string
    description: string
    characterKeys: string[]
    stages: Array<{
      key: string
      title: string
      objectiveKeys: string[]
    }>
    objectives: Array<{
      key: string
      stageKey: string
      title: string
      narrativePurpose: string
      sceneKeys: string[]
      locationOrdinal: number
      alternatives: Array<{
        key: string
        actionKind: 'look' | 'move' | 'talk' | 'take' | 'give' | 'use' | 'inspect' | 'attempt' | 'rest' | 'quest-action'
        targetCharacterKey: string | null
        cost: string
        successConsequence: string
        failureForwardConsequence: string
        persistentEffectKeys: string[]
      }>
    }>
  }>
}

export function parseTextAdventureQuestPlanArtifactV1(input: {
  value: unknown
  brief: ProductProductionBriefV3
  arcPlan: TextAdventureNarrativeArcPlanArtifactV1
  cast: TextAdventureCastBibleArtifactV1
  expectedKind: TextAdventureQuestPlanArtifactV1['bundleKind']
  expectedQuestCount: number
}): TextAdventureQuestPlanArtifactV1 {
  if (!input.brief.textAdventure) fail('任务计划缺少文字冒险 Brief')
  const row = record(input.value, `${input.expectedKind}QuestPlan`)
  exactKeys(row, ['schema', 'version', 'bundleKind', 'quests'], `${input.expectedKind}QuestPlan`)
  if (row.schema !== 'storyforge.text-adventure-quest-plan-artifact' || row.version !== 1
    || row.bundleKind !== input.expectedKind) fail('任务计划 schema/version/kind 无效')
  const minimumQuestCount = input.expectedKind === 'main' ? 1 : input.expectedQuestCount
  const sceneKeys = new Set(input.arcPlan.acts.flatMap(act => act.sceneCards.map(scene => scene.key)))
  const castKeys = new Set(input.cast.characters.map(character => character.key))
  const actionKinds = ['look', 'move', 'talk', 'take', 'give', 'use', 'inspect', 'attempt', 'rest', 'quest-action'] as const
  const quests = array(row.quests, 'quests', minimumQuestCount, 40).map((value, questIndex) => {
    const quest = record(value, `quests[${questIndex}]`)
    exactKeys(quest, ['key', 'title', 'description', 'characterKeys', 'stages', 'objectives'], `quests[${questIndex}]`)
    const characterKeys = keyArray(quest.characterKeys, `quests[${questIndex}].characterKeys`, 1, 20)
    if (characterKeys.some(value => !castKeys.has(value))) fail(`quests[${questIndex}] 引用未知角色`)
    const minimumStages = input.expectedKind === 'main' && input.brief.qualityProfile === 'commercial-candidate'
      ? Math.max(3, Math.ceil(input.brief.scale.targetPlayMinutes / 20))
      : input.expectedKind === 'side' && input.brief.qualityProfile === 'commercial-candidate' ? 2 : 1
    const stages = array(quest.stages, `quests[${questIndex}].stages`, minimumStages, 20).map((value, stageIndex) => {
      const stage = record(value, `quests[${questIndex}].stages[${stageIndex}]`)
      exactKeys(stage, ['key', 'title', 'objectiveKeys'], `quests[${questIndex}].stages[${stageIndex}]`)
      return {
        key: key(stage.key, `quests[${questIndex}].stages[${stageIndex}].key`),
        title: text(stage.title, `quests[${questIndex}].stages[${stageIndex}].title`, 300),
        objectiveKeys: keyArray(stage.objectiveKeys, `quests[${questIndex}].stages[${stageIndex}].objectiveKeys`, 1, 20),
      }
    })
    const minimumObjectives = input.expectedKind === 'main' && input.brief.qualityProfile === 'commercial-candidate'
      ? Math.max(8, Math.ceil(input.brief.scale.targetPlayMinutes / 7.5))
      : input.expectedKind === 'side' && input.brief.qualityProfile === 'commercial-candidate' ? 3 : 1
    const objectives = array(quest.objectives, `quests[${questIndex}].objectives`, minimumObjectives, 80)
      .map((value, objectiveIndex) => {
        const objective = record(value, `quests[${questIndex}].objectives[${objectiveIndex}]`)
        exactKeys(objective, [
          'key', 'stageKey', 'title', 'narrativePurpose', 'sceneKeys', 'locationOrdinal', 'alternatives',
        ], `quests[${questIndex}].objectives[${objectiveIndex}]`)
        const parsedSceneKeys = keyArray(objective.sceneKeys, `objectives[${objectiveIndex}].sceneKeys`, 1, 12)
        if (parsedSceneKeys.some(value => !sceneKeys.has(value))) fail(`objectives[${objectiveIndex}] 引用未知场景`)
        const locationOrdinal = integer(
          objective.locationOrdinal,
          `objectives[${objectiveIndex}].locationOrdinal`,
          1,
          input.brief.textAdventure!.narrative.targetLocationCount,
        )
        const sceneCards = input.arcPlan.acts.flatMap(act => act.sceneCards)
          .filter(scene => parsedSceneKeys.includes(scene.key))
        if (sceneCards.some(scene => scene.locationOrdinal !== locationOrdinal)) {
          fail(`objectives[${objectiveIndex}] 地点与引用场景不一致`)
        }
        const alternatives = array(objective.alternatives, `objectives[${objectiveIndex}].alternatives`, 1, 5)
          .map((value, alternativeIndex) => {
            const alternative = record(value, `objectives[${objectiveIndex}].alternatives[${alternativeIndex}]`)
            exactKeys(alternative, [
              'key', 'actionKind', 'targetCharacterKey', 'cost', 'successConsequence', 'failureForwardConsequence',
              'persistentEffectKeys',
            ], `objectives[${objectiveIndex}].alternatives[${alternativeIndex}]`)
            const actionKind = enumValue(alternative.actionKind, actionKinds, `alternatives[${alternativeIndex}].actionKind`)
            const targetCharacterKey = nullableText(
              alternative.targetCharacterKey,
              `alternatives[${alternativeIndex}].targetCharacterKey`,
              200,
            )
            if (targetCharacterKey && (!STABLE_KEY.test(targetCharacterKey) || !characterKeys.includes(targetCharacterKey))) {
              fail(`alternatives[${alternativeIndex}].targetCharacterKey 未列入任务角色`)
            }
            const targetCharacter = input.cast.characters.find(character => character.key === targetCharacterKey)
            if (actionKind === 'talk' && (!targetCharacterKey || !targetCharacter || targetCharacter.role === 'player')) {
              fail(`alternatives[${alternativeIndex}] talk 必须绑定非玩家角色`)
            }
            if (actionKind !== 'talk' && targetCharacterKey !== null) {
              fail(`alternatives[${alternativeIndex}] 非 talk 行动不得绑定角色`)
            }
            if (targetCharacterKey) {
              const availableInScene = parsedSceneKeys.some(sceneKey => input.arcPlan.acts.some(act => (
                act.sceneCards.some(scene => scene.key === sceneKey && scene.castKeys.includes(targetCharacterKey))
              )))
              if (!availableInScene) fail(`alternatives[${alternativeIndex}] talk 角色未出现在目标场景`)
            }
            return {
              key: key(alternative.key, `alternatives[${alternativeIndex}].key`),
              actionKind,
              targetCharacterKey,
              cost: text(alternative.cost, `alternatives[${alternativeIndex}].cost`, 1_000),
              successConsequence: text(alternative.successConsequence, `alternatives[${alternativeIndex}].successConsequence`, 2_000),
              failureForwardConsequence: text(alternative.failureForwardConsequence, `alternatives[${alternativeIndex}].failureForwardConsequence`, 2_000),
              persistentEffectKeys: keyArray(alternative.persistentEffectKeys, `alternatives[${alternativeIndex}].persistentEffectKeys`, 1, 12),
            }
          })
        if (new Set(alternatives.map(item => item.key)).size !== alternatives.length) fail('alternative key 重复')
        return {
          key: key(objective.key, `objectives[${objectiveIndex}].key`),
          stageKey: key(objective.stageKey, `objectives[${objectiveIndex}].stageKey`),
          title: text(objective.title, `objectives[${objectiveIndex}].title`, 300),
          narrativePurpose: text(objective.narrativePurpose, `objectives[${objectiveIndex}].narrativePurpose`, 2_000),
          sceneKeys: parsedSceneKeys,
          locationOrdinal,
          alternatives,
        }
      })
    const stageKeys = new Set(stages.map(stage => stage.key))
    const objectiveKeys = new Set(objectives.map(objective => objective.key))
    if (stageKeys.size !== stages.length || objectiveKeys.size !== objectives.length) fail('stage/objective key 重复')
    if (objectives.some(objective => !stageKeys.has(objective.stageKey))) fail('objective 引用未知 stage')
    const assignedObjectiveKeys = stages.flatMap(stage => stage.objectiveKeys)
    if (new Set(assignedObjectiveKeys).size !== assignedObjectiveKeys.length
      || assignedObjectiveKeys.some(value => !objectiveKeys.has(value))
      || assignedObjectiveKeys.length !== objectives.length) fail('stage.objectiveKeys 未精确覆盖 objectives')
    for (const stage of stages) for (const objectiveKey of stage.objectiveKeys) {
      const objective = objectives.find(item => item.key === objectiveKey)!
      if (objective.stageKey !== stage.key) fail(`objective ${objective.key} 的 stageKey 与阶段顺序不一致`)
    }
    if (input.expectedKind === 'main') {
      const sceneOrder = new Map(input.arcPlan.acts.flatMap(act => act.sceneCards)
        .map((scene, index) => [scene.key, index] as const))
      const orderedObjectives = assignedObjectiveKeys.map(objectiveKey => (
        objectives.find(objective => objective.key === objectiveKey)!
      ))
      for (let index = 1; index < orderedObjectives.length; index += 1) {
        const previousOrder = sceneOrder.get(orderedObjectives[index - 1].sceneKeys[0])!
        const currentOrder = sceneOrder.get(orderedObjectives[index].sceneKeys[0])!
        if (currentOrder < previousOrder) fail('主线阶段/目标顺序不得逆穿已结束的叙事场景')
      }
    }
    if (input.expectedKind === 'main' && input.brief.qualityProfile === 'commercial-candidate'
      && objectives.filter(objective => objective.alternatives.length >= 2).length < 2) {
      fail('商业主线至少两个目标需要多种通用解法')
    }
    return {
      key: key(quest.key, `quests[${questIndex}].key`),
      title: text(quest.title, `quests[${questIndex}].title`, 300),
      description: text(quest.description, `quests[${questIndex}].description`, 2_000),
      characterKeys, stages, objectives,
    }
  })
  if (input.expectedKind === 'main' && quests.length !== 1) fail('主线任务计划必须恰好一条主线')
  if (new Set(quests.map(quest => quest.key)).size !== quests.length) fail('quest key 重复')
  return {
    schema: 'storyforge.text-adventure-quest-plan-artifact', version: 1,
    bundleKind: input.expectedKind, quests,
  }
}

export interface TextAdventureQuestScriptArtifactV1 {
  schema: 'storyforge.text-adventure-quest-script-artifact'
  version: 1
  mainObjectiveScripts: Array<{
    objectiveKey: string
    sceneKey: string
    alternatives: Array<{
      alternativeKey: string
      resolution: {
        mode: 'automatic' | 'check'
        abilityKey: string | null
        difficulty: number | null
        costlySuccessFloor: number | null
      }
      timeCostMinutes: number
      successText: string
      costlySuccessText: string
      failureForwardText: string
    }>
  }>
  sideQuestScripts: TextAdventureSupplementalQuestScriptV1[]
  ambientEventScripts: TextAdventureSupplementalQuestScriptV1[]
}

export interface TextAdventureSupplementalQuestScriptV1 {
  entryKey: string
  actionKind: 'inspect' | 'attempt' | 'use' | 'quest-action'
  abilityKey: string
  difficulty: number
  costlySuccessFloor: number
  timeCostMinutes: number
  successText: string
  costlySuccessText: string
  failureForwardText: string
}

/**
 * The Quest Scripter does not invent runtime operations. It resolves authored
 * quest plans into a bounded rule/check script; the deterministic compiler
 * remains the only owner of state mutations and registered effect keys.
 */
export function parseTextAdventureQuestScriptArtifactV1(input: {
  value: unknown
  brief: ProductProductionBriefV3
  systems: TextAdventureSystemsArtifactV1
  mainQuestPlan: TextAdventureQuestPlanArtifactV1
  sideQuests: TextAdventureQuestBundleArtifactV1
  ambientEvents: TextAdventureQuestBundleArtifactV1
}): TextAdventureQuestScriptArtifactV1 {
  const row = record(input.value, 'questScript')
  exactKeys(row, [
    'schema', 'version', 'mainObjectiveScripts', 'sideQuestScripts', 'ambientEventScripts',
  ], 'questScript')
  if (row.schema !== 'storyforge.text-adventure-quest-script-artifact' || row.version !== 1) {
    fail('questScript schema/version 无效')
  }
  const abilityKeys = new Set(input.systems.abilities.map(ability => ability.key))
  const mainQuest = input.mainQuestPlan.quests[0]
  if (!mainQuest) fail('questScript 缺少主线计划')
  const objectiveByKey = new Map(mainQuest.objectives.map(objective => [objective.key, objective]))
  const mainObjectiveScripts = array(
    row.mainObjectiveScripts,
    'questScript.mainObjectiveScripts',
    mainQuest.objectives.length,
    mainQuest.objectives.length,
  ).map((value, objectiveIndex) => {
    const item = record(value, `mainObjectiveScripts[${objectiveIndex}]`)
    exactKeys(item, ['objectiveKey', 'sceneKey', 'alternatives'], `mainObjectiveScripts[${objectiveIndex}]`)
    const objectiveKey = key(item.objectiveKey, `mainObjectiveScripts[${objectiveIndex}].objectiveKey`)
    const objective = objectiveByKey.get(objectiveKey)
    if (!objective) fail(`mainObjectiveScripts[${objectiveIndex}] 引用未知目标`)
    const sceneKey = key(item.sceneKey, `mainObjectiveScripts[${objectiveIndex}].sceneKey`)
    if (sceneKey !== objective.sceneKeys[0]) fail(`mainObjectiveScripts[${objectiveIndex}] 场景不匹配主线计划`)
    const alternativeByKey = new Map(objective.alternatives.map(alternative => [alternative.key, alternative]))
    const alternatives = array(
      item.alternatives,
      `mainObjectiveScripts[${objectiveIndex}].alternatives`,
      objective.alternatives.length,
      objective.alternatives.length,
    ).map((value, alternativeIndex) => {
      const alternative = record(value, `mainObjectiveScripts[${objectiveIndex}].alternatives[${alternativeIndex}]`)
      exactKeys(alternative, [
        'alternativeKey', 'resolution', 'timeCostMinutes', 'successText', 'costlySuccessText', 'failureForwardText',
      ], `mainObjectiveScripts[${objectiveIndex}].alternatives[${alternativeIndex}]`)
      const alternativeKey = key(
        alternative.alternativeKey,
        `mainObjectiveScripts[${objectiveIndex}].alternatives[${alternativeIndex}].alternativeKey`,
      )
      if (!alternativeByKey.has(alternativeKey)) fail(`questScript 引用未知主线解法:${alternativeKey}`)
      const resolution = record(
        alternative.resolution,
        `mainObjectiveScripts[${objectiveIndex}].alternatives[${alternativeIndex}].resolution`,
      )
      exactKeys(resolution, [
        'mode', 'abilityKey', 'difficulty', 'costlySuccessFloor',
      ], `mainObjectiveScripts[${objectiveIndex}].alternatives[${alternativeIndex}].resolution`)
      const mode = enumValue(resolution.mode, ['automatic', 'check'], 'questScript.resolution.mode')
      const abilityKey = resolution.abilityKey === null ? null : key(resolution.abilityKey, 'questScript.resolution.abilityKey')
      const difficulty = resolution.difficulty === null
        ? null : integer(resolution.difficulty, 'questScript.resolution.difficulty', 2, 30)
      const costlySuccessFloor = resolution.costlySuccessFloor === null
        ? null : integer(resolution.costlySuccessFloor, 'questScript.resolution.costlySuccessFloor', 1, 29)
      if (mode === 'automatic' && (abilityKey !== null || difficulty !== null || costlySuccessFloor !== null)) {
        fail('automatic resolution 不得携带检查参数')
      }
      if (mode === 'check' && (!abilityKey || !abilityKeys.has(abilityKey) || difficulty == null
        || costlySuccessFloor == null || costlySuccessFloor >= difficulty)) {
        fail('check resolution 必须绑定已登记能力与有效难度区间')
      }
      return {
        alternativeKey,
        resolution: { mode, abilityKey, difficulty, costlySuccessFloor },
        timeCostMinutes: integer(alternative.timeCostMinutes, 'questScript.timeCostMinutes', 1, 120),
        successText: text(alternative.successText, 'questScript.successText', 4_000),
        costlySuccessText: text(alternative.costlySuccessText, 'questScript.costlySuccessText', 4_000),
        failureForwardText: text(alternative.failureForwardText, 'questScript.failureForwardText', 4_000),
      }
    })
    if (new Set(alternatives.map(alternative => alternative.alternativeKey)).size !== alternativeByKey.size) {
      fail(`questScript 未精确覆盖目标解法:${objectiveKey}`)
    }
    return { objectiveKey, sceneKey, alternatives }
  })
  if (new Set(mainObjectiveScripts.map(item => item.objectiveKey)).size !== objectiveByKey.size) {
    fail('questScript 未精确覆盖主线目标')
  }

  const parseSupplemental = (
    value: unknown,
    label: string,
    bundle: TextAdventureQuestBundleArtifactV1,
  ): TextAdventureSupplementalQuestScriptV1[] => {
    const entryByKey = new Map(bundle.entries.map(entry => [entry.key, entry]))
    const scripts = array(value, label, bundle.entries.length, bundle.entries.length).map((raw, index) => {
      const item = record(raw, `${label}[${index}]`)
      exactKeys(item, [
        'entryKey', 'actionKind', 'abilityKey', 'difficulty', 'costlySuccessFloor', 'timeCostMinutes',
        'successText', 'costlySuccessText', 'failureForwardText',
      ], `${label}[${index}]`)
      const entryKey = key(item.entryKey, `${label}[${index}].entryKey`)
      const source = entryByKey.get(entryKey)
      if (!source) fail(`${label}[${index}] 引用未知任务条目`)
      const abilityKey = key(item.abilityKey, `${label}[${index}].abilityKey`)
      if (!abilityKeys.has(abilityKey) || abilityKey !== source.abilityKey) {
        fail(`${label}[${index}] abilityKey 未闭合系统与任务设计`)
      }
      const difficulty = integer(item.difficulty, `${label}[${index}].difficulty`, 2, 30)
      const costlySuccessFloor = integer(item.costlySuccessFloor, `${label}[${index}].costlySuccessFloor`, 1, 29)
      if (costlySuccessFloor >= difficulty) fail(`${label}[${index}] costlySuccessFloor 必须小于 difficulty`)
      return {
        entryKey,
        actionKind: enumValue(item.actionKind, ['inspect', 'attempt', 'use', 'quest-action'], `${label}[${index}].actionKind`),
        abilityKey,
        difficulty,
        costlySuccessFloor,
        timeCostMinutes: integer(item.timeCostMinutes, `${label}[${index}].timeCostMinutes`, 1, 120),
        successText: text(item.successText, `${label}[${index}].successText`, 4_000),
        costlySuccessText: text(item.costlySuccessText, `${label}[${index}].costlySuccessText`, 4_000),
        failureForwardText: text(item.failureForwardText, `${label}[${index}].failureForwardText`, 4_000),
      }
    })
    if (new Set(scripts.map(script => script.entryKey)).size !== entryByKey.size) fail(`${label} 未精确覆盖任务条目`)
    return scripts
  }
  return {
    schema: 'storyforge.text-adventure-quest-script-artifact', version: 1,
    mainObjectiveScripts,
    sideQuestScripts: parseSupplemental(row.sideQuestScripts, 'questScript.sideQuestScripts', input.sideQuests),
    ambientEventScripts: parseSupplemental(row.ambientEventScripts, 'questScript.ambientEventScripts', input.ambientEvents),
  }
}
