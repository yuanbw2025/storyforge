import type { ProductProductionBriefV3 } from '../types'
import type {
  TextAdventureQuestBundleArtifactV2,
  TextAdventureSystemsArtifactV1,
} from './production-artifacts'
import {
  textAdventureActSceneKeysV1,
  textAdventureNarrativeSkeletonV1,
} from './scene-script'
import { planTextAdventureNarrativeLocationsV1 } from './narrative-location-plan'

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
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    const received = Array.isArray(value) ? value.length : typeof value
    fail(`${label} 数量无效 received=${received} expected=${minimum}..${maximum}`)
  }
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

export const TEXT_ADVENTURE_SUPERVISION_STAGE_KEYS_V1 = [
  'g1-source-and-direction',
  'g2-architecture-and-quests',
  'g3-scripts-and-dialogue',
  'g4-quality-and-media',
  'g5-assembly-and-automation',
  'g6-human-validation-and-release',
] as const

export interface TextAdventureProductionSupervisionArtifactV1 {
  schema: 'storyforge.text-adventure-production-supervision-artifact'
  version: 1
  productionPromise: string
  stages: Array<{
    key: typeof TEXT_ADVENTURE_SUPERVISION_STAGE_KEYS_V1[number]
    objective: string
    responsibleAgentIds: string[]
    exitCriteria: string[]
    stopConditions: string[]
  }>
  risks: Array<{
    key: string
    severity: 'warning' | 'blocking'
    ownerAgentId: string
    evidence: string
    mitigation: string
  }>
  authorGates: Array<{
    key: string
    afterStageKey: typeof TEXT_ADVENTURE_SUPERVISION_STAGE_KEYS_V1[number]
    decision: string
  }>
  nonGoals: string[]
}

export function parseTextAdventureProductionSupervisionArtifactV1(input: {
  value: unknown
  allowedAgentIds: readonly string[]
}): TextAdventureProductionSupervisionArtifactV1 {
  const row = record(input.value, 'productionSupervision')
  exactKeys(row, [
    'schema', 'version', 'productionPromise', 'stages', 'risks', 'authorGates', 'nonGoals',
  ], 'productionSupervision')
  if (row.schema !== 'storyforge.text-adventure-production-supervision-artifact' || row.version !== 1) {
    fail('productionSupervision schema/version 无效')
  }
  const allowedAgents = new Set(input.allowedAgentIds)
  const stages = array(
    row.stages,
    'productionSupervision.stages',
    TEXT_ADVENTURE_SUPERVISION_STAGE_KEYS_V1.length,
    TEXT_ADVENTURE_SUPERVISION_STAGE_KEYS_V1.length,
  ).map((value, index) => {
    const item = record(value, `productionSupervision.stages[${index}]`)
    exactKeys(item, [
      'key', 'objective', 'responsibleAgentIds', 'exitCriteria', 'stopConditions',
    ], `productionSupervision.stages[${index}]`)
    const stageKey = enumValue(
      item.key,
      TEXT_ADVENTURE_SUPERVISION_STAGE_KEYS_V1,
      `productionSupervision.stages[${index}].key`,
    )
    if (stageKey !== TEXT_ADVENTURE_SUPERVISION_STAGE_KEYS_V1[index]) {
      fail('productionSupervision.stages 必须按 G1-G6 固定顺序')
    }
    const responsibleAgentIds = keyArray(
      item.responsibleAgentIds,
      `productionSupervision.stages[${index}].responsibleAgentIds`,
      1,
      input.allowedAgentIds.length,
    )
    if (responsibleAgentIds.some(agentId => !allowedAgents.has(agentId))) {
      fail(`productionSupervision.stages[${index}] 引用未登记 Agent`)
    }
    return {
      key: stageKey,
      objective: text(item.objective, `productionSupervision.stages[${index}].objective`, 2_000),
      responsibleAgentIds,
      exitCriteria: textArray(item.exitCriteria, `productionSupervision.stages[${index}].exitCriteria`, 1, 12),
      stopConditions: textArray(item.stopConditions, `productionSupervision.stages[${index}].stopConditions`, 1, 12),
    }
  })
  const assignedAgents = stages.flatMap(stage => stage.responsibleAgentIds)
  if (assignedAgents.length !== input.allowedAgentIds.length
    || new Set(assignedAgents).size !== input.allowedAgentIds.length
    || input.allowedAgentIds.some(agentId => !assignedAgents.includes(agentId))) {
    fail('productionSupervision.stages 必须且只能覆盖全部专业 Agent 一次')
  }
  const risks = array(row.risks, 'productionSupervision.risks', 3, 20).map((value, index) => {
    const item = record(value, `productionSupervision.risks[${index}]`)
    exactKeys(item, ['key', 'severity', 'ownerAgentId', 'evidence', 'mitigation'], `productionSupervision.risks[${index}]`)
    const ownerAgentId = key(item.ownerAgentId, `productionSupervision.risks[${index}].ownerAgentId`)
    if (!allowedAgents.has(ownerAgentId)) fail(`productionSupervision.risks[${index}] 引用未登记 Agent`)
    return {
      key: key(item.key, `productionSupervision.risks[${index}].key`),
      severity: enumValue(item.severity, ['warning', 'blocking'], `productionSupervision.risks[${index}].severity`),
      ownerAgentId,
      evidence: text(item.evidence, `productionSupervision.risks[${index}].evidence`, 2_000),
      mitigation: text(item.mitigation, `productionSupervision.risks[${index}].mitigation`, 2_000),
    }
  })
  if (new Set(risks.map(risk => risk.key)).size !== risks.length) fail('productionSupervision.risks key 重复')
  const authorGates = array(row.authorGates, 'productionSupervision.authorGates', 3, 12).map((value, index) => {
    const item = record(value, `productionSupervision.authorGates[${index}]`)
    exactKeys(item, ['key', 'afterStageKey', 'decision'], `productionSupervision.authorGates[${index}]`)
    return {
      key: key(item.key, `productionSupervision.authorGates[${index}].key`),
      afterStageKey: enumValue(
        item.afterStageKey,
        TEXT_ADVENTURE_SUPERVISION_STAGE_KEYS_V1,
        `productionSupervision.authorGates[${index}].afterStageKey`,
      ),
      decision: text(item.decision, `productionSupervision.authorGates[${index}].decision`, 2_000),
    }
  })
  if (new Set(authorGates.map(gate => gate.key)).size !== authorGates.length) {
    fail('productionSupervision.authorGates key 重复')
  }
  return {
    schema: 'storyforge.text-adventure-production-supervision-artifact',
    version: 1,
    productionPromise: text(row.productionPromise, 'productionSupervision.productionPromise', 2_000),
    stages,
    risks,
    authorGates,
    nonGoals: textArray(row.nonGoals, 'productionSupervision.nonGoals', 3, 20),
  }
}

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

export interface TextAdventureSourceDecisionArtifactV1 {
  schema: 'storyforge.text-adventure-source-decision-artifact'
  version: 1
  sourceAuditHash: string
  decision: 'not-required' | 'accept-product-private-expansion'
  acceptedPrivateAdditionKeys: string[]
  authorCommandId: string | null
  authorNote: string | null
}

export function parseTextAdventureSourceDecisionArtifactV1(input: {
  value: unknown
  sourceAudit: TextAdventureSourceSufficiencyArtifactV1
  sourceAuditHash: string
}): TextAdventureSourceDecisionArtifactV1 {
  const row = record(input.value, 'sourceDecision')
  exactKeys(row, [
    'schema', 'version', 'sourceAuditHash', 'decision', 'acceptedPrivateAdditionKeys',
    'authorCommandId', 'authorNote',
  ], 'sourceDecision')
  if (row.schema !== 'storyforge.text-adventure-source-decision-artifact' || row.version !== 1) {
    fail('sourceDecision schema/version 无效')
  }
  if (row.sourceAuditHash !== input.sourceAuditHash) fail('sourceDecision 未绑定当前来源审计')
  const decision = enumValue(
    row.decision,
    ['not-required', 'accept-product-private-expansion'],
    'sourceDecision.decision',
  )
  const acceptedPrivateAdditionKeys = keyArray(
    row.acceptedPrivateAdditionKeys,
    'sourceDecision.acceptedPrivateAdditionKeys',
    0,
    100,
  )
  const proposedKeys = input.sourceAudit.privateAdditions.map(item => item.key).sort()
  if (decision === 'not-required') {
    if (input.sourceAudit.decision !== 'ready' || input.sourceAudit.authorDecisionRequired
      || acceptedPrivateAdditionKeys.length > 0 || row.authorCommandId !== null || row.authorNote !== null) {
      fail('sourceDecision.not-required 与来源审计不一致')
    }
  } else {
    if (input.sourceAudit.decision !== 'ready-with-private-additions'
      || !input.sourceAudit.authorDecisionRequired
      || acceptedPrivateAdditionKeys.length !== proposedKeys.length
      || acceptedPrivateAdditionKeys.slice().sort().some((value, index) => value !== proposedKeys[index])) {
      fail('sourceDecision 未完整接受当前产品私域补充清单')
    }
    if (typeof row.authorCommandId !== 'string' || !row.authorCommandId.trim()
      || typeof row.authorNote !== 'string' || !row.authorNote.trim()) {
      fail('sourceDecision 缺少作者命令证据')
    }
  }
  return {
    schema: 'storyforge.text-adventure-source-decision-artifact', version: 1,
    sourceAuditHash: row.sourceAuditHash as string,
    decision,
    acceptedPrivateAdditionKeys,
    authorCommandId: row.authorCommandId as string | null,
    authorNote: row.authorNote as string | null,
  }
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
    const role = enumValue(item.role, ['player', 'major-npc', 'supporting-npc'], `characters[${index}].role`)
    return {
      key: key(item.key, `characters[${index}].key`),
      role,
      sourceResourceKey,
      name: text(item.name, `characters[${index}].name`, 200),
      publicIdentity: text(item.publicIdentity, `characters[${index}].publicIdentity`, 1_000),
      desire: text(item.desire, `characters[${index}].desire`, 1_000),
      fear: text(item.fear, `characters[${index}].fear`, 1_000),
      secret: text(item.secret, `characters[${index}].secret`, 1_000),
      motivation: text(item.motivation, `characters[${index}].motivation`, 1_000),
      voice: text(item.voice, `characters[${index}].voice`, 1_000),
      initialKnowledge: textArray(item.initialKnowledge, `characters[${index}].initialKnowledge`, 1, 30),
      // The player may legitimately start without an additional hidden-fact
      // denylist. NPC knowledge remains bounded by at least one fact they do
      // not know, preserving dialogue authority without manufacturing a fake
      // restriction for the player role.
      forbiddenKnowledge: textArray(
        item.forbiddenKnowledge, `characters[${index}].forbiddenKnowledge`, role === 'player' ? 0 : 1, 30,
      ),
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

export interface TextAdventureVisualBibleArtifactV1 {
  schema: 'storyforge.text-adventure-visual-bible-artifact'
  version: 1
  style: string
  palette: string[]
  compositionRules: string[]
  continuityRules: string[]
  characterAnchors: Array<{
    characterKey: string
    name: string
    role: TextAdventureCastBibleArtifactV1['characters'][number]['role']
    identity: string
    visualAnchor: string
    requirementArtifactKeys: string[]
    palette: string[]
    hardConstraints: string[]
  }>
  assetRequirements: Array<{
    artifactKey: string
    mediaKind: 'background' | 'character-pose' | 'character-expression' | 'cg' | 'ui'
    sceneTag: string
    beatKey: string
  }>
}

export function parseTextAdventureVisualBibleArtifactV1(input: {
  value: unknown
  cast: TextAdventureCastBibleArtifactV1
  expectedAssetKeys: readonly string[]
}): TextAdventureVisualBibleArtifactV1 {
  const row = record(input.value, 'visualBible')
  exactKeys(row, [
    'schema', 'version', 'style', 'palette', 'compositionRules', 'continuityRules',
    'characterAnchors', 'assetRequirements',
  ], 'visualBible')
  if (row.schema !== 'storyforge.text-adventure-visual-bible-artifact' || row.version !== 1) {
    fail('visualBible schema/version 无效')
  }
  const palette = textArray(row.palette, 'visualBible.palette', 3, 8)
  if (palette.some(color => !/^#[0-9a-fA-F]{6}$/.test(color))) fail('visualBible.palette 颜色无效')
  const castByKey = new Map(input.cast.characters.map(character => [character.key, character]))
  const characterAnchors = array(
    row.characterAnchors, 'visualBible.characterAnchors', input.cast.characters.length, input.cast.characters.length,
  ).map((value, index) => {
    const item = record(value, `visualBible.characterAnchors[${index}]`)
    exactKeys(item, [
      'characterKey', 'name', 'role', 'identity', 'visualAnchor', 'requirementArtifactKeys',
      'palette', 'hardConstraints',
    ], `visualBible.characterAnchors[${index}]`)
    const characterKey = key(item.characterKey, `visualBible.characterAnchors[${index}].characterKey`)
    const character = castByKey.get(characterKey)
    if (!character || item.name !== character.name || item.role !== character.role
      || item.identity !== character.publicIdentity || item.visualAnchor !== character.visualAnchor) {
      fail(`visualBible 角色锚点未逐字绑定角色圣经:${characterKey}`)
    }
    const anchorPalette = textArray(item.palette, `visualBible.characterAnchors[${index}].palette`, 3, 8)
    if (anchorPalette.some(color => !/^#[0-9a-fA-F]{6}$/.test(color))) fail('visualBible 角色色板无效')
    return {
      characterKey, name: character.name, role: character.role,
      identity: character.publicIdentity, visualAnchor: character.visualAnchor,
      requirementArtifactKeys: keyArray(
        item.requirementArtifactKeys,
        `visualBible.characterAnchors[${index}].requirementArtifactKeys`,
        0,
        input.expectedAssetKeys.length,
      ),
      palette: anchorPalette,
      hardConstraints: textArray(
        item.hardConstraints,
        `visualBible.characterAnchors[${index}].hardConstraints`,
        3,
        30,
      ),
    }
  })
  if (new Set(characterAnchors.map(item => item.characterKey)).size !== input.cast.characters.length) {
    fail('visualBible 未不重不漏覆盖角色圣经')
  }
  const assetRequirements = array(
    row.assetRequirements, 'visualBible.assetRequirements',
    input.expectedAssetKeys.length, input.expectedAssetKeys.length,
  ).map((value, index) => {
    const item = record(value, `visualBible.assetRequirements[${index}]`)
    exactKeys(item, ['artifactKey', 'mediaKind', 'sceneTag', 'beatKey'], `visualBible.assetRequirements[${index}]`)
    return {
      artifactKey: key(item.artifactKey, `visualBible.assetRequirements[${index}].artifactKey`),
      mediaKind: enumValue(
        item.mediaKind,
        ['background', 'character-pose', 'character-expression', 'cg', 'ui'],
        `visualBible.assetRequirements[${index}].mediaKind`,
      ),
      sceneTag: key(item.sceneTag, `visualBible.assetRequirements[${index}].sceneTag`),
      beatKey: key(item.beatKey, `visualBible.assetRequirements[${index}].beatKey`),
    }
  })
  const actualAssetKeys = assetRequirements.map(item => item.artifactKey).sort()
  const expectedAssetKeys = [...input.expectedAssetKeys].sort()
  if (actualAssetKeys.some((value, index) => value !== expectedAssetKeys[index])) {
    fail('visualBible 素材需求未精确绑定当前 Plan')
  }
  const assetKeySet = new Set(expectedAssetKeys)
  if (characterAnchors.some(anchor => anchor.requirementArtifactKeys.some(value => !assetKeySet.has(value)))) {
    fail('visualBible 角色锚点引用未知素材')
  }
  return {
    schema: 'storyforge.text-adventure-visual-bible-artifact', version: 1,
    style: text(row.style, 'visualBible.style', 2_000), palette,
    compositionRules: textArray(row.compositionRules, 'visualBible.compositionRules', 2, 20),
    continuityRules: textArray(row.continuityRules, 'visualBible.continuityRules', 3, 30),
    characterAnchors, assetRequirements,
  }
}

export interface TextAdventureMediaAnchorDecisionArtifactV1 {
  schema: 'storyforge.text-adventure-media-anchor-decision-artifact'
  version: 1
  visualBibleHash: string
  decision: 'not-required-noncommercial' | 'confirm-character-anchors'
  confirmedCharacterKeys: string[]
  authorCommandId: string | null
  authorNote: string | null
}

export function parseTextAdventureMediaAnchorDecisionArtifactV1(input: {
  value: unknown
  visualBible: TextAdventureVisualBibleArtifactV1
  visualBibleHash: string
  confirmationRequired: boolean
}): TextAdventureMediaAnchorDecisionArtifactV1 {
  const row = record(input.value, 'mediaAnchorDecision')
  exactKeys(row, [
    'schema', 'version', 'visualBibleHash', 'decision', 'confirmedCharacterKeys',
    'authorCommandId', 'authorNote',
  ], 'mediaAnchorDecision')
  if (row.schema !== 'storyforge.text-adventure-media-anchor-decision-artifact' || row.version !== 1
    || row.visualBibleHash !== input.visualBibleHash) fail('mediaAnchorDecision schema/version/hash 无效')
  const decision = enumValue(
    row.decision,
    ['not-required-noncommercial', 'confirm-character-anchors'],
    'mediaAnchorDecision.decision',
  )
  const confirmedCharacterKeys = keyArray(
    row.confirmedCharacterKeys,
    'mediaAnchorDecision.confirmedCharacterKeys',
    0,
    input.visualBible.characterAnchors.length,
  )
  const expectedKeys = input.visualBible.characterAnchors.map(anchor => anchor.characterKey).sort()
  if (input.confirmationRequired) {
    if (decision !== 'confirm-character-anchors'
      || confirmedCharacterKeys.length !== expectedKeys.length
      || confirmedCharacterKeys.slice().sort().some((value, index) => value !== expectedKeys[index])
      || typeof row.authorCommandId !== 'string' || !row.authorCommandId.trim()
      || typeof row.authorNote !== 'string' || !row.authorNote.trim()) {
      fail('mediaAnchorDecision 缺少完整作者确认')
    }
  } else if (decision !== 'not-required-noncommercial' || confirmedCharacterKeys.length > 0
    || row.authorCommandId !== null || row.authorNote !== null) {
    fail('mediaAnchorDecision 非商业自动回执无效')
  }
  return {
    schema: 'storyforge.text-adventure-media-anchor-decision-artifact', version: 1,
    visualBibleHash: row.visualBibleHash as string, decision, confirmedCharacterKeys,
    authorCommandId: row.authorCommandId as string | null,
    authorNote: row.authorNote as string | null,
  }
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
  locationTitles?: readonly string[]
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
  // Older frozen Plans did not hand the architecture artifact to every
  // downstream consumer. Those consumers may re-parse an already accepted
  // arc without the catalog, so retain the schema ceiling here; the producing
  // task and all current Plans pass locationTitles and enforce the exact map.
  const locationCount = input.locationTitles?.length ?? 48
  const locationPlan = planTextAdventureNarrativeLocationsV1(skeleton.sceneKeys.length, locationCount)
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
      const unknownCastKeys = parsedCastKeys.filter(value => !castKeys.has(value))
      if (unknownCastKeys.length > 0) {
        fail(`sceneCards[${sceneIndex}] 引用未知角色:${unknownCastKeys.join(',')}`)
      }
      if ([...parsedSetupKeys, ...parsedPayoffKeys].some(value => !setupKeys.has(value))) {
        fail(`sceneCards[${sceneIndex}] 引用未知铺垫回收`)
      }
      const sceneKey = key(scene.key, `sceneCards[${sceneIndex}].key`)
      if (sceneKey !== expectedSceneKeys[sceneIndex]) {
        fail(`acts[${actIndex}].sceneCards[${sceneIndex}].key 必须为 ${expectedSceneKeys[sceneIndex]}`)
      }
      const parsedLocationOrdinal = integer(
        scene.locationOrdinal,
        `sceneCards[${sceneIndex}].locationOrdinal`,
        1,
        locationCount,
      )
      if (input.locationTitles) {
        const globalSceneIndex = skeleton.sceneKeys.indexOf(sceneKey)
        const expectedLocationOrdinal = locationPlan[globalSceneIndex].locationOrdinal
        if (parsedLocationOrdinal !== expectedLocationOrdinal) {
          fail(
            `sceneCards[${sceneIndex}].locationOrdinal 必须为冻结映射 ${expectedLocationOrdinal}`,
          )
        }
      }
      return {
        key: sceneKey,
        title: text(scene.title, `sceneCards[${sceneIndex}].title`, 300),
        locationOrdinal: parsedLocationOrdinal,
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

export interface TextAdventureNarrativeArcScenesArtifactV1 {
  schema: 'storyforge.text-adventure-narrative-arc-scenes-artifact'
  version: 1
  acts: TextAdventureNarrativeArcPlanArtifactV1['acts']
  endings: TextAdventureNarrativeArcPlanArtifactV1['endings']
}

export interface TextAdventureNarrativeDecisionPlanArtifactV1 {
  schema: 'storyforge.text-adventure-narrative-decision-plan-artifact'
  version: 1
  decisions: TextAdventureNarrativeArcPlanArtifactV1['decisions']
}

function placeholderNarrativeDecisionsV1(brief: ProductProductionBriefV3) {
  const skeleton = textAdventureNarrativeSkeletonV1(brief)
  return skeleton.sceneKeys.slice(0, skeleton.statefulDecisionSceneCount).map((sceneKey, index) => {
    const echoes = skeleton.sceneKeys.filter(key => key !== sceneKey).slice(0, 2)
    return {
      key: `decision.placeholder.${index + 1}`,
      sceneKey,
      prompt: '占位决定，仅用于分段工件协议校验。',
      options: [0, 1].map(optionIndex => ({
        key: `option.placeholder.${index + 1}.${optionIndex + 1}`,
        label: optionIndex === 0 ? '采取第一种行动' : '采取第二种行动',
        cost: optionIndex === 0 ? '承担第一种代价' : '承担第二种代价',
        persistentEffectKey: `flag.placeholder.${index + 1}.${optionIndex + 1}`,
        echoSceneKeys: echoes,
      })),
    }
  })
}

function placeholderNarrativeActsV1(input: {
  brief: ProductProductionBriefV3
  cast: TextAdventureCastBibleArtifactV1
  locationTitles?: readonly string[]
}) {
  const skeleton = textAdventureNarrativeSkeletonV1(input.brief)
  const locationCount = input.locationTitles?.length
    ?? input.brief.textAdventure!.narrative.targetLocationCount
  const locationPlan = planTextAdventureNarrativeLocationsV1(skeleton.sceneKeys.length, locationCount)
  const baseMinutes = Math.floor(input.brief.scale.targetPlayMinutes / 3)
  const playerKey = input.cast.characters.find(character => character.role === 'player')?.key
    ?? input.cast.characters[0].key
  return [0, 1, 2].map(actIndex => ({
    key: `act.${actIndex + 1}`,
    title: `第${actIndex + 1}幕占位`,
    targetMinutes: actIndex === 2
      ? input.brief.scale.targetPlayMinutes - baseMinutes * 2
      : baseMinutes,
    goal: '占位目标，仅用于分段工件协议校验。',
    irreversibleTurn: '占位转折，仅用于分段工件协议校验。',
    sceneCards: textAdventureActSceneKeysV1(input.brief, actIndex).map(sceneKey => {
      const sceneIndex = skeleton.sceneKeys.indexOf(sceneKey)
      return {
        key: sceneKey,
        title: `${sceneKey} 占位`,
        locationOrdinal: locationPlan[sceneIndex].locationOrdinal,
        purpose: '占位目的。',
        conflict: '占位冲突。',
        entryState: '占位进入状态。',
        exitState: '占位退出状态。',
        castKeys: [playerKey],
        setupKeys: [],
        payoffKeys: [],
      }
    }),
  }))
}

export function parseTextAdventureNarrativeArcScenesArtifactV1(input: {
  value: unknown
  brief: ProductProductionBriefV3
  cast: TextAdventureCastBibleArtifactV1
  storyBible: TextAdventureStoryBibleArtifactV1
  locationTitles?: readonly string[]
}): TextAdventureNarrativeArcScenesArtifactV1 {
  const row = record(input.value, 'arcScenes')
  exactKeys(row, ['schema', 'version', 'acts', 'endings'], 'arcScenes')
  if (row.schema !== 'storyforge.text-adventure-narrative-arc-scenes-artifact' || row.version !== 1) {
    fail('arcScenes schema/version 无效')
  }
  const parsed = parseTextAdventureNarrativeArcPlanArtifactV1({
    value: {
      schema: 'storyforge.text-adventure-narrative-arc-plan-artifact',
      version: 1,
      acts: row.acts,
      decisions: placeholderNarrativeDecisionsV1(input.brief),
      endings: row.endings,
    },
    brief: input.brief,
    cast: input.cast,
    storyBible: input.storyBible,
    locationTitles: input.locationTitles,
  })
  return {
    schema: 'storyforge.text-adventure-narrative-arc-scenes-artifact',
    version: 1,
    acts: parsed.acts,
    endings: parsed.endings,
  }
}

export function parseTextAdventureNarrativeDecisionPlanArtifactV1(input: {
  value: unknown
  brief: ProductProductionBriefV3
  cast: TextAdventureCastBibleArtifactV1
  storyBible: TextAdventureStoryBibleArtifactV1
  locationTitles?: readonly string[]
}): TextAdventureNarrativeDecisionPlanArtifactV1 {
  const row = record(input.value, 'decisionPlan')
  exactKeys(row, ['schema', 'version', 'decisions'], 'decisionPlan')
  if (row.schema !== 'storyforge.text-adventure-narrative-decision-plan-artifact' || row.version !== 1) {
    fail('decisionPlan schema/version 无效')
  }
  const skeleton = textAdventureNarrativeSkeletonV1(input.brief)
  const parsed = parseTextAdventureNarrativeArcPlanArtifactV1({
    value: {
      schema: 'storyforge.text-adventure-narrative-arc-plan-artifact',
      version: 1,
      acts: placeholderNarrativeActsV1(input),
      decisions: row.decisions,
      endings: skeleton.endingKeys.map(endingKey => ({
        endingKey,
        sceneKey: skeleton.sceneKeys[skeleton.sceneKeys.length - 1],
      })),
    },
    brief: input.brief,
    cast: input.cast,
    storyBible: input.storyBible,
    locationTitles: input.locationTitles,
  })
  return {
    schema: 'storyforge.text-adventure-narrative-decision-plan-artifact',
    version: 1,
    decisions: parsed.decisions,
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
  locationCount?: number
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
        if (input.expectedKind === 'main' && parsedSceneKeys.length !== 1) {
          fail(`objectives[${objectiveIndex}] 主线目标必须恰好绑定一个可结算场景`)
        }
        const locationOrdinal = integer(
          objective.locationOrdinal,
          `objectives[${objectiveIndex}].locationOrdinal`,
          1,
          input.locationCount ?? input.brief.textAdventure!.narrative.targetLocationCount,
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
    if (input.expectedKind === 'main' && input.brief.qualityProfile === 'commercial-candidate') {
      const actionKinds = new Set(objectives.flatMap(objective => (
        objective.alternatives.map(alternative => alternative.actionKind)
      )))
      const missingActionKinds = ['talk', 'give', 'use'].filter(actionKind => !actionKinds.has(
        actionKind as TextAdventureQuestPlanArtifactV1['quests'][number]['objectives'][number]['alternatives'][number]['actionKind'],
      ))
      if (missingActionKinds.length) {
        fail(`商业主线缺少正式交互行动:${missingActionKinds.join(',')}`)
      }
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

export interface TextAdventureQuestScriptArtifactV2 {
  schema: 'storyforge.text-adventure-quest-script-artifact'
  version: 2
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
  sideQuestScripts: TextAdventureSupplementalQuestScriptV2[]
  ambientEventScripts: TextAdventureSupplementalQuestScriptV2[]
}

export interface TextAdventureSupplementalQuestScriptV2 {
  entryKey: string
  stages: Array<{
    stageKey: string
    actionKind: 'inspect' | 'attempt' | 'use' | 'quest-action'
    abilityKey: string
    difficulty: number
    costlySuccessFloor: number
    timeCostMinutes: number
    successText: string
    costlySuccessText: string
    failureForwardText: string
  }>
}

/**
 * The Quest Scripter does not invent runtime operations. It resolves authored
 * quest plans into a bounded rule/check script; the deterministic compiler
 * remains the only owner of state mutations and registered effect keys.
 */
export function parseTextAdventureQuestScriptArtifactV2(input: {
  value: unknown
  brief: ProductProductionBriefV3
  systems: TextAdventureSystemsArtifactV1
  mainQuestPlan: TextAdventureQuestPlanArtifactV1
  sideQuests: TextAdventureQuestBundleArtifactV2
  ambientEvents: TextAdventureQuestBundleArtifactV2
}): TextAdventureQuestScriptArtifactV2 {
  const row = record(input.value, 'questScript')
  exactKeys(row, [
    'schema', 'version', 'mainObjectiveScripts', 'sideQuestScripts', 'ambientEventScripts',
  ], 'questScript')
  if (row.schema !== 'storyforge.text-adventure-quest-script-artifact' || row.version !== 2) {
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
        fail(
          `mainObjectiveScripts[${objectiveIndex}].alternatives[${alternativeIndex}] check resolution `
          + `必须绑定已登记能力与有效难度区间: abilityKey=${String(abilityKey)}, `
          + `difficulty=${String(difficulty)}, costlySuccessFloor=${String(costlySuccessFloor)}`,
        )
      }
      return {
        alternativeKey,
        resolution: { mode, abilityKey, difficulty, costlySuccessFloor },
        timeCostMinutes: integer(alternative.timeCostMinutes, 'questScript.timeCostMinutes', 1, 120),
        successText: text(
          alternative.successText,
          `mainObjectiveScripts[${objectiveIndex}].alternatives[${alternativeIndex}].successText`,
          4_000,
        ),
        costlySuccessText: text(
          alternative.costlySuccessText,
          `mainObjectiveScripts[${objectiveIndex}].alternatives[${alternativeIndex}].costlySuccessText`,
          4_000,
        ),
        failureForwardText: text(
          alternative.failureForwardText,
          `mainObjectiveScripts[${objectiveIndex}].alternatives[${alternativeIndex}].failureForwardText`,
          4_000,
        ),
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
    bundle: TextAdventureQuestBundleArtifactV2,
  ): TextAdventureSupplementalQuestScriptV2[] => {
    const entryByKey = new Map(bundle.entries.map(entry => [entry.key, entry]))
    const scripts = array(value, label, bundle.entries.length, bundle.entries.length).map((raw, index) => {
      const item = record(raw, `${label}[${index}]`)
      exactKeys(item, ['entryKey', 'stages'], `${label}[${index}]`)
      const entryKey = key(item.entryKey, `${label}[${index}].entryKey`)
      const source = entryByKey.get(entryKey)
      if (!source) fail(`${label}[${index}] 引用未知任务条目`)
      const sourceStageByKey = new Map(source.stages.map(stage => [stage.key, stage]))
      const stages = array(
        item.stages,
        `${label}[${index}].stages`,
        source.stages.length,
        source.stages.length,
      ).map((rawStage, stageIndex) => {
        const stage = record(rawStage, `${label}[${index}].stages[${stageIndex}]`)
        exactKeys(stage, [
          'stageKey', 'actionKind', 'abilityKey', 'difficulty', 'costlySuccessFloor', 'timeCostMinutes',
          'successText', 'costlySuccessText', 'failureForwardText',
        ], `${label}[${index}].stages[${stageIndex}]`)
        const stageKey = key(stage.stageKey, `${label}[${index}].stages[${stageIndex}].stageKey`)
        const sourceStage = sourceStageByKey.get(stageKey)
        if (!sourceStage) fail(`${label}[${index}] 引用未知阶段:${stageKey}`)
        const actionKind = enumValue(
          stage.actionKind,
          ['inspect', 'attempt', 'use', 'quest-action'],
          `${label}[${index}].stages[${stageIndex}].actionKind`,
        )
        const abilityKey = key(stage.abilityKey, `${label}[${index}].stages[${stageIndex}].abilityKey`)
        if (!abilityKeys.has(abilityKey) || abilityKey !== sourceStage.abilityKey
          || actionKind !== sourceStage.actionKind) {
          fail(`${label}[${index}].stages[${stageIndex}] 未闭合系统与任务设计`)
        }
        const difficulty = integer(stage.difficulty, `${label}[${index}].stages[${stageIndex}].difficulty`, 2, 30)
        const costlySuccessFloor = integer(
          stage.costlySuccessFloor,
          `${label}[${index}].stages[${stageIndex}].costlySuccessFloor`,
          1,
          29,
        )
        if (costlySuccessFloor >= difficulty) {
          fail(`${label}[${index}].stages[${stageIndex}] costlySuccessFloor 必须小于 difficulty`)
        }
        return {
          stageKey,
          actionKind,
          abilityKey,
          difficulty,
          costlySuccessFloor,
          timeCostMinutes: integer(stage.timeCostMinutes, `${label}[${index}].stages[${stageIndex}].timeCostMinutes`, 1, 120),
          successText: text(stage.successText, `${label}[${index}].stages[${stageIndex}].successText`, 4_000),
          costlySuccessText: text(stage.costlySuccessText, `${label}[${index}].stages[${stageIndex}].costlySuccessText`, 4_000),
          failureForwardText: text(stage.failureForwardText, `${label}[${index}].stages[${stageIndex}].failureForwardText`, 4_000),
        }
      })
      if (new Set(stages.map(stage => stage.stageKey)).size !== sourceStageByKey.size) {
        fail(`${label}[${index}] 未精确覆盖任务阶段`)
      }
      return {
        entryKey,
        stages,
      }
    })
    if (new Set(scripts.map(script => script.entryKey)).size !== entryByKey.size) fail(`${label} 未精确覆盖任务条目`)
    return scripts
  }
  return {
    schema: 'storyforge.text-adventure-quest-script-artifact', version: 2,
    mainObjectiveScripts,
    sideQuestScripts: parseSupplemental(row.sideQuestScripts, 'questScript.sideQuestScripts', input.sideQuests),
    ambientEventScripts: parseSupplemental(row.ambientEventScripts, 'questScript.ambientEventScripts', input.ambientEvents),
  }
}
