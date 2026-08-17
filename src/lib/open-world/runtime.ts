import type {
  AdventureContentV1,
  FrozenInteractionCharacterProfile,
  FrozenInteractionSceneTemplate,
  NarrativeSimulationContentV1,
  OpenWorldAttentionLevel,
  OpenWorldCondition,
  OpenWorldContentV1,
  OpenWorldDirectorCandidateEvidence,
  OpenWorldDiscoveryChannelDefinition,
  OpenWorldDiscoveryChannelKind,
  OpenWorldDiscoveryTrigger,
  OpenWorldEffect,
  OpenWorldExpressionCandidateV1,
  OpenWorldFixedTaskCardDefinition,
  OpenWorldFrozenQuestInstance,
  OpenWorldQuestCategory,
  OpenWorldQuestInstanceStatus,
  OpenWorldRegionDefinition,
  OpenWorldRegionalProjection,
  OpenWorldTaskFingerprintDefinition,
  OpenWorldTaskTemplateDefinition,
  OpenWorldValidationReport,
  SimulationAdventureState,
  SimulationEvent,
  SimulationOpenWorldState,
} from '../types'

type JsonRow = Record<string, unknown>
type WorldDescriptor = {
  type: Extract<import('../types').SimulationEventType, `world.${string}`> | Extract<import('../types').SimulationEventType, `adventure.${string}`>
  actorKey?: string | null
  targetKey?: string | null
  payload: Record<string, unknown>
  commandEnvelope?: boolean
}

const QUEST_CATEGORIES = ['mainline', 'issue', 'character', 'exploration', 'growth', 'resource', 'crisis', 'consequence'] as const
const TRIGGERS = ['observe', 'social', 'explore', 'rest', 'travel', 'combat'] as const
const CHANNEL_KINDS = ['conversation', 'rumor', 'notice', 'letter', 'broadcast', 'encounter', 'object', 'dream'] as const

function fail(message: string): never { throw new Error(`[textworld] ${message}`) }
function row(value: unknown, label: string): JsonRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value as JsonRow
}
function exact(value: JsonRow, allowed: readonly string[], label: string) {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length) fail(`${label}字段不在白名单:${unknown.join(',')}`)
}
function array(value: unknown, label: string, maximum = 1_000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label}必须是长度不超过 ${maximum} 的数组`)
  return value
}
function text(value: unknown, label: string, maximum = 5_000, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.trim().length > maximum) fail(`${label}无效`)
  return value.trim()
}
function key(value: unknown, label: string): string {
  const result = text(value, label, 160)
  if (!/^[a-zA-Z0-9._:-]+$/.test(result)) fail(`${label}不是稳定 key`)
  return result
}
function finite(value: unknown, label: string, minimum = -1_000_000, maximum = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(`${label}无效`)
  return value
}
function integer(value: unknown, label: string, minimum = 0, maximum = 1_000_000): number {
  const result = finite(value, label, minimum, maximum)
  if (!Number.isInteger(result)) fail(`${label}必须是整数`)
  return result
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label}必须是布尔值`)
  return value
}
function keys(value: unknown, label: string, maximum = 1_000): string[] {
  const result = array(value, label, maximum).map((item, index) => key(item, `${label}[${index}]`))
  if (new Set(result).size !== result.length) fail(`${label}不得重复`)
  return result
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label}无效`)
  return value as T
}
function numberMap(value: unknown, label: string): Record<string, number> {
  const source = row(value, label); const result: Record<string, number> = {}
  for (const [entryKey, amount] of Object.entries(source)) result[key(entryKey, `${label}.key`)] = finite(amount, `${label}.${entryKey}`)
  return result
}
function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>(); const result = new Set<string>()
  for (const value of values) { if (seen.has(value)) result.add(value); else seen.add(value) }
  return [...result].sort()
}
function trigger(value: unknown, label: string) { return enumValue(value, TRIGGERS, label) }
function category(value: unknown, label: string) { return enumValue(value, QUEST_CATEGORIES, label) }
function channelKind(value: unknown, label: string) { return enumValue(value, CHANNEL_KINDS, label) }

function parseCondition(value: unknown, label: string): OpenWorldCondition {
  const source = row(value, label)
  const kind = String(source.source)
  if (kind === 'tick') {
    exact(source, ['source', 'operator', 'value'], label)
    return { source: 'tick', operator: enumValue(source.operator, ['gte', 'lte', 'eq'], `${label}.operator`), value: integer(source.value, `${label}.value`) }
  }
  if (kind === 'quest-status') {
    exact(source, ['source', 'questKey', 'operator', 'value'], label)
    return { source: 'quest-status', questKey: key(source.questKey, `${label}.questKey`), operator: enumValue(source.operator, ['eq'], `${label}.operator`), value: enumValue(source.value, ['revealed', 'active', 'resolved', 'failed', 'declined', 'expired', 'superseded', 'unseen'], `${label}.value`) }
  }
  if (['region-resource', 'region-metric', 'region-issue', 'organization-influence'].includes(kind)) {
    exact(source, ['source', 'regionKey', 'key', 'operator', 'value'], label)
    return { source: kind as OpenWorldCondition['source'] & ('region-resource' | 'region-metric' | 'region-issue' | 'organization-influence'), regionKey: key(source.regionKey, `${label}.regionKey`), key: key(source.key, `${label}.key`), operator: enumValue(source.operator, ['gte', 'lte', 'eq'], `${label}.operator`), value: finite(source.value, `${label}.value`) }
  }
  fail(`${label}.source 无效`)
}

function parseEffect(value: unknown, label: string, allowActorRegion = false): OpenWorldEffect {
  const source = row(value, label)
  if (source.op === 'change-region-value') {
    exact(source, ['op', 'target', 'regionKey', 'key', 'delta'], label)
    const regionKey = allowActorRegion && source.regionKey === '$actor-region' ? '$actor-region' : key(source.regionKey, `${label}.regionKey`)
    return { op: 'change-region-value', target: enumValue(source.target, ['resource', 'metric', 'issue'], `${label}.target`), regionKey, key: key(source.key, `${label}.key`), delta: finite(source.delta, `${label}.delta`) }
  }
  if (source.op === 'change-organization-influence') {
    exact(source, ['op', 'regionKey', 'organizationKey', 'delta'], label)
    const regionKey = allowActorRegion && source.regionKey === '$actor-region' ? '$actor-region' : key(source.regionKey, `${label}.regionKey`)
    return { op: 'change-organization-influence', regionKey, organizationKey: key(source.organizationKey, `${label}.organizationKey`), delta: finite(source.delta, `${label}.delta`) }
  }
  fail(`${label}.op 无效`)
}

function parseFingerprint(value: unknown, label: string): OpenWorldTaskFingerprintDefinition {
  const source = row(value, label)
  exact(source, ['family', 'initiatorKey', 'targetKey', 'conflictKey', 'solutionKey', 'rewardType'], label)
  return {
    family: key(source.family, `${label}.family`), initiatorKey: key(source.initiatorKey, `${label}.initiatorKey`),
    targetKey: key(source.targetKey, `${label}.targetKey`), conflictKey: key(source.conflictKey, `${label}.conflictKey`),
    solutionKey: key(source.solutionKey, `${label}.solutionKey`), rewardType: key(source.rewardType, `${label}.rewardType`),
  }
}

function parseContent(value: unknown): OpenWorldContentV1 {
  const source = row(value, '开放世界内容')
  exact(source, ['version', 'initialRegionKey', 'tickLimit', 'simulationCadenceTicks', 'maxPropagationEdgesPerTick', 'regions', 'travelEdges', 'discoveryChannels', 'fixedTaskCards', 'taskTemplates', 'decks', 'actorSchedules', 'regionalIssueRules', 'mainline', 'director'], '开放世界内容')
  if (source.version !== 1) fail('不支持的内容版本')
  const regions = array(source.regions, 'regions', 128).map((raw, index): OpenWorldRegionDefinition => {
    const item = row(raw, `regions[${index}]`)
    exact(item, ['key', 'title', 'description', 'parentKey', 'locationKey', 'tags', 'initialKnowledge', 'initialAttention', 'residentParticipantKeys', 'organizationKeys', 'channelKeys', 'initialResources', 'initialMetrics', 'initialIssuePressures', 'initialOrganizationInfluence', 'nextScheduledTick'], `regions[${index}]`)
    return {
      key: key(item.key, `regions[${index}].key`), title: text(item.title, `regions[${index}].title`, 300), description: text(item.description, `regions[${index}].description`, 8_000),
      parentKey: item.parentKey == null ? null : key(item.parentKey, `regions[${index}].parentKey`), locationKey: key(item.locationKey, `regions[${index}].locationKey`), tags: keys(item.tags, `regions[${index}].tags`, 32),
      initialKnowledge: enumValue(item.initialKnowledge, ['unknown', 'heard', 'visited', 'familiar'], `regions[${index}].initialKnowledge`), initialAttention: enumValue(item.initialAttention, ['focus', 'active', 'background'], `regions[${index}].initialAttention`),
      residentParticipantKeys: keys(item.residentParticipantKeys, `regions[${index}].residentParticipantKeys`, 100), organizationKeys: keys(item.organizationKeys, `regions[${index}].organizationKeys`, 100), channelKeys: keys(item.channelKeys, `regions[${index}].channelKeys`, 100),
      initialResources: numberMap(item.initialResources, `regions[${index}].initialResources`), initialMetrics: numberMap(item.initialMetrics, `regions[${index}].initialMetrics`), initialIssuePressures: numberMap(item.initialIssuePressures, `regions[${index}].initialIssuePressures`), initialOrganizationInfluence: numberMap(item.initialOrganizationInfluence, `regions[${index}].initialOrganizationInfluence`), nextScheduledTick: integer(item.nextScheduledTick, `regions[${index}].nextScheduledTick`, 1),
    }
  })
  const travelEdges = array(source.travelEdges, 'travelEdges', 512).map((raw, index) => {
    const item = row(raw, `travelEdges[${index}]`); exact(item, ['key', 'fromRegionKey', 'toRegionKey', 'bidirectional', 'travelTicks', 'risk', 'blockedByIssueKey', 'blockedAtPressure'], `travelEdges[${index}]`)
    return { key: key(item.key, `travelEdges[${index}].key`), fromRegionKey: key(item.fromRegionKey, `travelEdges[${index}].fromRegionKey`), toRegionKey: key(item.toRegionKey, `travelEdges[${index}].toRegionKey`), bidirectional: bool(item.bidirectional, `travelEdges[${index}].bidirectional`), travelTicks: integer(item.travelTicks, `travelEdges[${index}].travelTicks`, 1, 1_000), risk: finite(item.risk, `travelEdges[${index}].risk`, 0, 100), blockedByIssueKey: item.blockedByIssueKey == null ? null : key(item.blockedByIssueKey, `travelEdges[${index}].blockedByIssueKey`), blockedAtPressure: item.blockedAtPressure == null ? null : finite(item.blockedAtPressure, `travelEdges[${index}].blockedAtPressure`) }
  })
  const discoveryChannels = array(source.discoveryChannels, 'discoveryChannels', 512).map((raw, index): OpenWorldDiscoveryChannelDefinition => {
    const item = row(raw, `discoveryChannels[${index}]`); exact(item, ['key', 'regionKey', 'kind', 'title', 'participantKey', 'triggers', 'textTemplate'], `discoveryChannels[${index}]`)
    return { key: key(item.key, `discoveryChannels[${index}].key`), regionKey: key(item.regionKey, `discoveryChannels[${index}].regionKey`), kind: channelKind(item.kind, `discoveryChannels[${index}].kind`), title: text(item.title, `discoveryChannels[${index}].title`, 300), participantKey: item.participantKey == null ? null : key(item.participantKey, `discoveryChannels[${index}].participantKey`), triggers: array(item.triggers, `discoveryChannels[${index}].triggers`, 6).map((entry, triggerIndex) => trigger(entry, `discoveryChannels[${index}].triggers[${triggerIndex}]`)), textTemplate: text(item.textTemplate, `discoveryChannels[${index}].textTemplate`, 4_000) }
  })
  const fixedTaskCards = array(source.fixedTaskCards, 'fixedTaskCards', 1_000).map((raw, index): OpenWorldFixedTaskCardDefinition => {
    const item = row(raw, `fixedTaskCards[${index}]`)
    exact(item, ['key', 'questKey', 'regionKey', 'category', 'sourceIssueKey', 'title', 'description', 'participantKeys', 'allowedSolutions', 'rewardBudget', 'intensity', 'basePriority', 'critical', 'guaranteedByTick', 'unique', 'cooldownTicks', 'expirationTicks', 'allowedChannelKeys', 'requirements', 'declineEffects', 'expirationEffects', 'supersedeConditions', 'fingerprint'], `fixedTaskCards[${index}]`)
    return { key: key(item.key, `fixedTaskCards[${index}].key`), questKey: key(item.questKey, `fixedTaskCards[${index}].questKey`), regionKey: key(item.regionKey, `fixedTaskCards[${index}].regionKey`), category: category(item.category, `fixedTaskCards[${index}].category`), sourceIssueKey: item.sourceIssueKey == null ? null : key(item.sourceIssueKey, `fixedTaskCards[${index}].sourceIssueKey`), title: text(item.title, `fixedTaskCards[${index}].title`, 300), description: text(item.description, `fixedTaskCards[${index}].description`, 8_000), participantKeys: keys(item.participantKeys, `fixedTaskCards[${index}].participantKeys`, 100), allowedSolutions: keys(item.allowedSolutions, `fixedTaskCards[${index}].allowedSolutions`, 32), rewardBudget: finite(item.rewardBudget, `fixedTaskCards[${index}].rewardBudget`, 0, 100_000), intensity: integer(item.intensity, `fixedTaskCards[${index}].intensity`, 1, 5), basePriority: finite(item.basePriority, `fixedTaskCards[${index}].basePriority`, -10_000, 10_000), critical: bool(item.critical, `fixedTaskCards[${index}].critical`), guaranteedByTick: item.guaranteedByTick == null ? null : integer(item.guaranteedByTick, `fixedTaskCards[${index}].guaranteedByTick`, 1), unique: bool(item.unique, `fixedTaskCards[${index}].unique`), cooldownTicks: integer(item.cooldownTicks, `fixedTaskCards[${index}].cooldownTicks`, 0, 10_000), expirationTicks: item.expirationTicks == null ? null : integer(item.expirationTicks, `fixedTaskCards[${index}].expirationTicks`, 1, 10_000), allowedChannelKeys: keys(item.allowedChannelKeys, `fixedTaskCards[${index}].allowedChannelKeys`, 100), requirements: array(item.requirements, `fixedTaskCards[${index}].requirements`, 64).map((entry, entryIndex) => parseCondition(entry, `fixedTaskCards[${index}].requirements[${entryIndex}]`)), declineEffects: array(item.declineEffects, `fixedTaskCards[${index}].declineEffects`, 64).map((entry, entryIndex) => parseEffect(entry, `fixedTaskCards[${index}].declineEffects[${entryIndex}]`)), expirationEffects: array(item.expirationEffects, `fixedTaskCards[${index}].expirationEffects`, 64).map((entry, entryIndex) => parseEffect(entry, `fixedTaskCards[${index}].expirationEffects[${entryIndex}]`)), supersedeConditions: array(item.supersedeConditions, `fixedTaskCards[${index}].supersedeConditions`, 64).map((entry, entryIndex) => parseCondition(entry, `fixedTaskCards[${index}].supersedeConditions[${entryIndex}]`)), fingerprint: parseFingerprint(item.fingerprint, `fixedTaskCards[${index}].fingerprint`) }
  })
  const taskTemplates = array(source.taskTemplates, 'taskTemplates', 256).map((raw, index): OpenWorldTaskTemplateDefinition => {
    const item = row(raw, `taskTemplates[${index}]`)
    exact(item, ['key', 'adventureQuestKey', 'regionKeys', 'category', 'sourceIssueKey', 'titleTemplate', 'descriptionTemplate', 'participantKeys', 'allowedSolutions', 'rewardBudget', 'intensity', 'basePriority', 'cooldownTicks', 'expirationTicks', 'allowedChannelKinds', 'requirements', 'declineEffects', 'expirationEffects', 'fingerprint'], `taskTemplates[${index}]`)
    return { key: key(item.key, `taskTemplates[${index}].key`), adventureQuestKey: key(item.adventureQuestKey, `taskTemplates[${index}].adventureQuestKey`), regionKeys: keys(item.regionKeys, `taskTemplates[${index}].regionKeys`, 128), category: category(item.category, `taskTemplates[${index}].category`), sourceIssueKey: key(item.sourceIssueKey, `taskTemplates[${index}].sourceIssueKey`), titleTemplate: text(item.titleTemplate, `taskTemplates[${index}].titleTemplate`, 300), descriptionTemplate: text(item.descriptionTemplate, `taskTemplates[${index}].descriptionTemplate`, 8_000), participantKeys: keys(item.participantKeys, `taskTemplates[${index}].participantKeys`, 100), allowedSolutions: keys(item.allowedSolutions, `taskTemplates[${index}].allowedSolutions`, 32), rewardBudget: finite(item.rewardBudget, `taskTemplates[${index}].rewardBudget`, 0, 100_000), intensity: integer(item.intensity, `taskTemplates[${index}].intensity`, 1, 5), basePriority: finite(item.basePriority, `taskTemplates[${index}].basePriority`, -10_000, 10_000), cooldownTicks: integer(item.cooldownTicks, `taskTemplates[${index}].cooldownTicks`, 0, 10_000), expirationTicks: item.expirationTicks == null ? null : integer(item.expirationTicks, `taskTemplates[${index}].expirationTicks`, 1, 10_000), allowedChannelKinds: array(item.allowedChannelKinds, `taskTemplates[${index}].allowedChannelKinds`, CHANNEL_KINDS.length).map((entry, entryIndex) => channelKind(entry, `taskTemplates[${index}].allowedChannelKinds[${entryIndex}]`)), requirements: array(item.requirements, `taskTemplates[${index}].requirements`, 64).map((entry, entryIndex) => parseCondition(entry, `taskTemplates[${index}].requirements[${entryIndex}]`)), declineEffects: array(item.declineEffects, `taskTemplates[${index}].declineEffects`, 64).map((entry, entryIndex) => parseEffect(entry, `taskTemplates[${index}].declineEffects[${entryIndex}]`)), expirationEffects: array(item.expirationEffects, `taskTemplates[${index}].expirationEffects`, 64).map((entry, entryIndex) => parseEffect(entry, `taskTemplates[${index}].expirationEffects[${entryIndex}]`)), fingerprint: parseFingerprint(item.fingerprint, `taskTemplates[${index}].fingerprint`) }
  })
  const decks = array(source.decks, 'decks', 128).map((raw, index) => {
    const item = row(raw, `decks[${index}]`); exact(item, ['regionKey', 'fixedCardKeys', 'templateKeys', 'categoryQuotas', 'maxRevealed', 'maxActive', 'cooldownTicks', 'recentWindow', 'blankWeight', 'highIntensityStreakLimit'], `decks[${index}]`)
    const quotas = row(item.categoryQuotas, `decks[${index}].categoryQuotas`); const categoryQuotas: Partial<Record<OpenWorldQuestCategory, number>> = {}
    for (const [quotaKey, quota] of Object.entries(quotas)) categoryQuotas[category(quotaKey, `decks[${index}].categoryQuotas.key`)] = integer(quota, `decks[${index}].categoryQuotas.${quotaKey}`, 0, 100)
    return { regionKey: key(item.regionKey, `decks[${index}].regionKey`), fixedCardKeys: keys(item.fixedCardKeys, `decks[${index}].fixedCardKeys`, 1_000), templateKeys: keys(item.templateKeys, `decks[${index}].templateKeys`, 256), categoryQuotas, maxRevealed: integer(item.maxRevealed, `decks[${index}].maxRevealed`, 0, 100), maxActive: integer(item.maxActive, `decks[${index}].maxActive`, 0, 100), cooldownTicks: integer(item.cooldownTicks, `decks[${index}].cooldownTicks`, 0, 10_000), recentWindow: integer(item.recentWindow, `decks[${index}].recentWindow`, 1, 1_000), blankWeight: finite(item.blankWeight, `decks[${index}].blankWeight`, 0, 100_000), highIntensityStreakLimit: integer(item.highIntensityStreakLimit, `decks[${index}].highIntensityStreakLimit`, 1, 20) }
  })
  const actorSchedules = array(source.actorSchedules, 'actorSchedules', 512).map((raw, index) => {
    const item = row(raw, `actorSchedules[${index}]`); exact(item, ['key', 'actorKey', 'actorKind', 'periodTicks', 'offsetTicks', 'regionCycle', 'effects', 'summary'], `actorSchedules[${index}]`)
    return { key: key(item.key, `actorSchedules[${index}].key`), actorKey: key(item.actorKey, `actorSchedules[${index}].actorKey`), actorKind: enumValue(item.actorKind, ['participant', 'organization'], `actorSchedules[${index}].actorKind`), periodTicks: integer(item.periodTicks, `actorSchedules[${index}].periodTicks`, 1, 10_000), offsetTicks: integer(item.offsetTicks, `actorSchedules[${index}].offsetTicks`, 0, 10_000), regionCycle: keys(item.regionCycle, `actorSchedules[${index}].regionCycle`, 128), effects: array(item.effects, `actorSchedules[${index}].effects`, 64).map((entry, entryIndex) => parseEffect(entry, `actorSchedules[${index}].effects[${entryIndex}]`, true)), summary: text(item.summary, `actorSchedules[${index}].summary`, 2_000) }
  })
  const regionalIssueRules = array(source.regionalIssueRules, 'regionalIssueRules', 128).map((raw, index) => {
    const item = row(raw, `regionalIssueRules[${index}]`); exact(item, ['key', 'issueKey', 'regionKeys', 'driftPerTick', 'propagationThreshold', 'propagationFraction', 'propagationCap', 'cooldownTicks'], `regionalIssueRules[${index}]`)
    return { key: key(item.key, `regionalIssueRules[${index}].key`), issueKey: key(item.issueKey, `regionalIssueRules[${index}].issueKey`), regionKeys: keys(item.regionKeys, `regionalIssueRules[${index}].regionKeys`, 128), driftPerTick: finite(item.driftPerTick, `regionalIssueRules[${index}].driftPerTick`, -1_000, 1_000), propagationThreshold: finite(item.propagationThreshold, `regionalIssueRules[${index}].propagationThreshold`), propagationFraction: finite(item.propagationFraction, `regionalIssueRules[${index}].propagationFraction`, 0, 1), propagationCap: finite(item.propagationCap, `regionalIssueRules[${index}].propagationCap`, 0), cooldownTicks: integer(item.cooldownTicks, `regionalIssueRules[${index}].cooldownTicks`, 1, 10_000) }
  })
  const mainline = row(source.mainline, 'mainline'); exact(mainline, ['questKeys', 'protectedParticipantKeys', 'protectedEdgeKeys', 'latestRevealTick', 'endingNodeKey'], 'mainline')
  const director = row(source.director, 'director'); exact(director, ['globalMaxRevealed', 'globalMaxActive', 'maxQuestInstances', 'randomJitter', 'criticalGuaranteeBonus', 'backlogPenalty', 'freshnessPenalty'], 'director')
  return {
    version: 1, initialRegionKey: key(source.initialRegionKey, 'initialRegionKey'), tickLimit: integer(source.tickLimit, 'tickLimit', 1, 100_000), simulationCadenceTicks: integer(source.simulationCadenceTicks, 'simulationCadenceTicks', 1, 10_000), maxPropagationEdgesPerTick: integer(source.maxPropagationEdgesPerTick, 'maxPropagationEdgesPerTick', 1, 1_000), regions, travelEdges, discoveryChannels, fixedTaskCards, taskTemplates, decks, actorSchedules, regionalIssueRules,
    mainline: { questKeys: keys(mainline.questKeys, 'mainline.questKeys', 100), protectedParticipantKeys: keys(mainline.protectedParticipantKeys, 'mainline.protectedParticipantKeys', 100), protectedEdgeKeys: keys(mainline.protectedEdgeKeys, 'mainline.protectedEdgeKeys', 100), latestRevealTick: integer(mainline.latestRevealTick, 'mainline.latestRevealTick', 1), endingNodeKey: key(mainline.endingNodeKey, 'mainline.endingNodeKey') },
    director: { globalMaxRevealed: integer(director.globalMaxRevealed, 'director.globalMaxRevealed', 1, 100), globalMaxActive: integer(director.globalMaxActive, 'director.globalMaxActive', 1, 100), maxQuestInstances: integer(director.maxQuestInstances, 'director.maxQuestInstances', 1, 10_000), randomJitter: finite(director.randomJitter, 'director.randomJitter', 0, 1_000), criticalGuaranteeBonus: finite(director.criticalGuaranteeBonus, 'director.criticalGuaranteeBonus', 0, 100_000), backlogPenalty: finite(director.backlogPenalty, 'director.backlogPenalty', 0, 100_000), freshnessPenalty: finite(director.freshnessPenalty, 'director.freshnessPenalty', 0, 100_000) },
  }
}

export function parseOpenWorldContent(value: string | unknown): OpenWorldContentV1 {
  let parsed = value
  if (typeof value === 'string') { try { parsed = JSON.parse(value) } catch { fail('内容不是合法 JSON') } }
  return structuredClone(parseContent(parsed))
}

function fingerprint(value: OpenWorldTaskFingerprintDefinition, regionKey: string, issueKey: string | null) {
  return [issueKey ?? 'none', regionKey, value.family, value.initiatorKey, value.targetKey, value.conflictKey, value.solutionKey, value.rewardType].join('|')
}

export function validateOpenWorldContent(input: {
  content: OpenWorldContentV1 | string
  adventure: AdventureContentV1
  interactionProfiles: FrozenInteractionCharacterProfile[]
  interactionScenes: FrozenInteractionSceneTemplate[]
  simulation: NarrativeSimulationContentV1
  narrativeNodeKeys: readonly string[]
}): OpenWorldValidationReport {
  const content = parseOpenWorldContent(input.content); const errors: string[] = []; const warnings: string[] = []; const missing = new Set<string>()
  const duplicateKeys = [
    ...duplicates(content.regions.map(item => item.key)).map(item => `region:${item}`),
    ...duplicates(content.travelEdges.map(item => item.key)).map(item => `edge:${item}`),
    ...duplicates(content.discoveryChannels.map(item => item.key)).map(item => `channel:${item}`),
    ...duplicates(content.fixedTaskCards.map(item => item.key)).map(item => `card:${item}`),
    ...duplicates(content.taskTemplates.map(item => item.key)).map(item => `template:${item}`),
    ...duplicates(content.decks.map(item => item.regionKey)).map(item => `deck:${item}`),
    ...duplicates(content.actorSchedules.map(item => item.key)).map(item => `schedule:${item}`),
    ...duplicates(content.regionalIssueRules.map(item => item.key)).map(item => `issue-rule:${item}`),
  ]
  if (duplicateKeys.length) errors.push(`稳定 key 重复:${duplicateKeys.join(',')}`)
  const regionKeys = new Set(content.regions.map(item => item.key)); const edgeKeys = new Set(content.travelEdges.map(item => item.key)); const channelKeys = new Set(content.discoveryChannels.map(item => item.key)); const profileKeys = new Set(input.interactionProfiles.map(item => item.participantKey)); const organizationKeys = new Set(input.simulation.actors.filter(item => item.kind === 'organization').map(item => item.key)); const issueKeys = new Set(input.simulation.issues.map(item => item.key)); const resourceKeys = new Set(input.simulation.resources.map(item => item.key)); const metricKeys = new Set(input.simulation.metrics.map(item => item.key)); const questKeys = new Set(input.adventure.quests.map(item => item.key)); const locationKeys = new Set(input.adventure.locations.map(item => item.key)); const cardKeys = new Set(content.fixedTaskCards.map(item => item.key)); const templateKeys = new Set(content.taskTemplates.map(item => item.key))
  if (!regionKeys.has(content.initialRegionKey)) missing.add(`region:${content.initialRegionKey}`)
  const checkRegion = (value: string) => { if (!regionKeys.has(value)) missing.add(`region:${value}`) }
  const checkParticipant = (value: string) => { if (!profileKeys.has(value)) missing.add(`participant:${value}`) }
  const checkEffect = (effect: OpenWorldEffect) => { checkRegion(effect.regionKey); if (effect.op === 'change-organization-influence') { if (!organizationKeys.has(effect.organizationKey)) missing.add(`organization:${effect.organizationKey}`) } else if (effect.target === 'resource' ? !resourceKeys.has(effect.key) : effect.target === 'metric' ? !metricKeys.has(effect.key) : !issueKeys.has(effect.key)) missing.add(`${effect.target}:${effect.key}`) }
  const checkCondition = (condition: OpenWorldCondition) => { if (condition.source === 'tick') return; if (condition.source === 'quest-status') { if (!questKeys.has(condition.questKey)) missing.add(`quest:${condition.questKey}`); return } checkRegion(condition.regionKey); if (condition.source === 'organization-influence') { if (!organizationKeys.has(condition.key)) missing.add(`organization:${condition.key}`) } else if (condition.source === 'region-resource' ? !resourceKeys.has(condition.key) : condition.source === 'region-metric' ? !metricKeys.has(condition.key) : !issueKeys.has(condition.key)) missing.add(`${condition.source}:${condition.key}`) }
  for (const region of content.regions) {
    if (region.parentKey) checkRegion(region.parentKey); if (!locationKeys.has(region.locationKey)) missing.add(`location:${region.locationKey}`)
    region.residentParticipantKeys.forEach(checkParticipant); region.organizationKeys.forEach(value => { if (!organizationKeys.has(value)) missing.add(`organization:${value}`) }); region.channelKeys.forEach(value => { if (!channelKeys.has(value)) missing.add(`channel:${value}`) })
    Object.keys(region.initialResources).forEach(value => { if (!resourceKeys.has(value)) missing.add(`resource:${value}`) }); Object.keys(region.initialMetrics).forEach(value => { if (!metricKeys.has(value)) missing.add(`metric:${value}`) }); Object.keys(region.initialIssuePressures).forEach(value => { if (!issueKeys.has(value)) missing.add(`issue:${value}`) }); Object.keys(region.initialOrganizationInfluence).forEach(value => { if (!organizationKeys.has(value)) missing.add(`organization:${value}`) })
  }
  for (const edge of content.travelEdges) { checkRegion(edge.fromRegionKey); checkRegion(edge.toRegionKey); if (edge.fromRegionKey === edge.toRegionKey) errors.push(`交通边自环:${edge.key}`); if (edge.blockedByIssueKey && !issueKeys.has(edge.blockedByIssueKey)) missing.add(`issue:${edge.blockedByIssueKey}`) }
  const sceneParticipants = new Set(input.interactionScenes.flatMap(scene => scene.participantKeys))
  for (const channel of content.discoveryChannels) { checkRegion(channel.regionKey); if (channel.participantKey) { checkParticipant(channel.participantKey); if (!sceneParticipants.has(channel.participantKey)) missing.add(`interaction-scene-participant:${channel.participantKey}`) } }
  for (const card of content.fixedTaskCards) { checkRegion(card.regionKey); if (!questKeys.has(card.questKey)) missing.add(`quest:${card.questKey}`); if (card.sourceIssueKey && !issueKeys.has(card.sourceIssueKey)) missing.add(`issue:${card.sourceIssueKey}`); card.participantKeys.forEach(checkParticipant); card.allowedChannelKeys.forEach(value => { if (!channelKeys.has(value)) missing.add(`channel:${value}`) }); card.requirements.forEach(checkCondition); card.supersedeConditions.forEach(checkCondition); [...card.declineEffects, ...card.expirationEffects].forEach(checkEffect) }
  for (const template of content.taskTemplates) { if (!questKeys.has(template.adventureQuestKey)) missing.add(`quest:${template.adventureQuestKey}`); if (!issueKeys.has(template.sourceIssueKey)) missing.add(`issue:${template.sourceIssueKey}`); template.regionKeys.forEach(checkRegion); template.participantKeys.forEach(checkParticipant); template.requirements.forEach(checkCondition); [...template.declineEffects, ...template.expirationEffects].forEach(checkEffect) }
  for (const deck of content.decks) { checkRegion(deck.regionKey); deck.fixedCardKeys.forEach(value => { if (!cardKeys.has(value)) missing.add(`card:${value}`) }); deck.templateKeys.forEach(value => { if (!templateKeys.has(value)) missing.add(`template:${value}`) }) }
  for (const schedule of content.actorSchedules) { if (schedule.actorKind === 'participant') checkParticipant(schedule.actorKey); else if (!organizationKeys.has(schedule.actorKey)) missing.add(`organization:${schedule.actorKey}`); schedule.regionCycle.forEach(checkRegion); schedule.effects.forEach(effect => { if (effect.regionKey !== '$actor-region') checkEffect(effect) }) }
  for (const rule of content.regionalIssueRules) { if (!issueKeys.has(rule.issueKey)) missing.add(`issue:${rule.issueKey}`); rule.regionKeys.forEach(checkRegion) }
  const adjacency = new Map(content.regions.map(region => [region.key, new Set<string>()])); for (const edge of content.travelEdges) { adjacency.get(edge.fromRegionKey)?.add(edge.toRegionKey); if (edge.bidirectional) adjacency.get(edge.toRegionKey)?.add(edge.fromRegionKey) }
  const reached = new Set<string>(); const queue = regionKeys.has(content.initialRegionKey) ? [content.initialRegionKey] : []; while (queue.length) { const current = queue.shift()!; if (reached.has(current)) continue; reached.add(current); for (const next of adjacency.get(current) ?? []) if (!reached.has(next)) queue.push(next) }
  const unreachableRegionKeys = [...regionKeys].filter(value => !reached.has(value)).sort(); if (unreachableRegionKeys.length) errors.push(`区域不可达:${unreachableRegionKeys.join(',')}`)
  const taskRegionByQuest = new Map<string, string[]>(); for (const card of content.fixedTaskCards) taskRegionByQuest.set(card.questKey, [...(taskRegionByQuest.get(card.questKey) ?? []), card.regionKey]); for (const template of content.taskTemplates) taskRegionByQuest.set(template.adventureQuestKey, [...(taskRegionByQuest.get(template.adventureQuestKey) ?? []), ...template.regionKeys])
  const unreachableMainlineQuestKeys = content.mainline.questKeys.filter(quest => !taskRegionByQuest.get(quest)?.some(region => reached.has(region))); if (unreachableMainlineQuestKeys.length) errors.push(`主线任务不可达:${unreachableMainlineQuestKeys.join(',')}`)
  const unprotectedMainline = content.mainline.questKeys.filter(questKey => { const cards = content.fixedTaskCards.filter(card => card.questKey === questKey); return cards.length !== 1 || !cards[0].critical || !cards[0].unique || cards[0].guaranteedByTick == null || cards[0].guaranteedByTick > content.mainline.latestRevealTick }); if (unprotectedMainline.length) errors.push(`主线任务缺少唯一关键牌或最晚揭示保证:${unprotectedMainline.join(',')}`)
  const invalidProtectedReferenceKeys = [...content.mainline.protectedParticipantKeys.filter(value => !profileKeys.has(value)).map(value => `participant:${value}`), ...content.mainline.protectedEdgeKeys.filter(value => !edgeKeys.has(value)).map(value => `edge:${value}`), ...(input.narrativeNodeKeys.includes(content.mainline.endingNodeKey) ? [] : [`narrative-node:${content.mainline.endingNodeKey}`])]; if (invalidProtectedReferenceKeys.length) errors.push(`主线保护引用无效:${invalidProtectedReferenceKeys.join(',')}`)
  const taskFloodRegionKeys = content.decks.filter(deck => deck.maxRevealed > content.director.globalMaxRevealed || deck.maxActive > content.director.globalMaxActive || deck.highIntensityStreakLimit > 5).map(deck => deck.regionKey); if (taskFloodRegionKeys.length) errors.push(`任务洪水配置:${taskFloodRegionKeys.join(',')}`)
  const unboundedPropagationRuleKeys = content.regionalIssueRules.filter(rule => rule.driftPerTick > 0 && rule.propagationFraction >= 1).map(rule => rule.key); if (unboundedPropagationRuleKeys.length) errors.push(`传播无界风险:${unboundedPropagationRuleKeys.join(',')}`)
  const allFingerprints = [...content.fixedTaskCards.map(card => [card.key, fingerprint(card.fingerprint, card.regionKey, card.sourceIssueKey)] as const), ...content.taskTemplates.flatMap(template => template.regionKeys.map(region => [template.key, fingerprint(template.fingerprint, region, template.sourceIssueKey)] as const))]; const duplicateFingerprintValues = duplicates(allFingerprints.map(([, value]) => value)); const duplicateFingerprintKeys = allFingerprints.filter(([, value]) => duplicateFingerprintValues.includes(value)).map(([source]) => source); if (duplicateFingerprintKeys.length) warnings.push(`任务指纹重复:${duplicateFingerprintKeys.join(',')}`)
  if (content.regions.filter(region => region.initialAttention === 'focus').length !== 1 || content.regions.find(region => region.key === content.initialRegionKey)?.initialAttention !== 'focus') errors.push('必须恰有一个初始焦点区域且与 initialRegionKey 一致')
  if (content.regions.length < 2 || !content.travelEdges.length || !content.decks.length) errors.push('开放世界至少需要两个区域、交通边和区域牌组')
  if (content.mainline.latestRevealTick > content.tickLimit) errors.push('主线最晚揭示时间超过世界回合上限')
  if (missing.size) errors.push(`引用缺失:${[...missing].sort().join(',')}`)
  return { valid: errors.length === 0, errors, warnings, duplicateKeys, missingReferences: [...missing].sort(), unreachableRegionKeys, unreachableMainlineQuestKeys, taskFloodRegionKeys, unboundedPropagationRuleKeys, invalidProtectedReferenceKeys, duplicateFingerprintKeys }
}

export function createInitialOpenWorldState(contentValue: OpenWorldContentV1 | string, contentHash: string): SimulationOpenWorldState {
  const content = parseOpenWorldContent(contentValue); if (!/^[a-f0-9]{64}$/.test(contentHash)) fail('contentHash 无效')
  return {
    schema: 'storyforge.open-world', version: 1, contentHash, mainlineQuestKeys: structuredClone(content.mainline.questKeys), tick: 0, tickLimit: content.tickLimit, currentRegionKey: content.initialRegionKey, travel: null,
    regionKnowledge: Object.fromEntries(content.regions.map(region => [region.key, region.initialKnowledge])), attentionLevels: Object.fromEntries(content.regions.map(region => [region.key, region.initialAttention])),
    regionalProjections: content.regions.map(region => ({ regionKey: region.key, resources: structuredClone(region.initialResources), metrics: structuredClone(region.initialMetrics), issuePressures: structuredClone(region.initialIssuePressures), organizationInfluence: structuredClone(region.initialOrganizationInfluence), nextScheduledTick: region.nextScheduledTick, lastUpdatedSequence: 0 })),
    actorLocations: Object.fromEntries(content.actorSchedules.map(schedule => [schedule.actorKey, schedule.regionCycle[0]])), questInstances: [], drawHistory: [], remoteActionHistory: [], propagationHistory: [], recentFingerprints: [], sourceCooldowns: {}, blankStreak: 0, highIntensityStreak: 0, lastTickEventSequences: [], ended: false,
  }
}

function questStatus(value: unknown, label: string): OpenWorldQuestInstanceStatus { return enumValue(value, ['revealed', 'active', 'resolved', 'failed', 'declined', 'expired', 'superseded'], label) }
function parseInstance(value: unknown, label: string): OpenWorldFrozenQuestInstance {
  const item = row(value, label)
  return { instanceKey: key(item.instanceKey, `${label}.instanceKey`), sourceKind: enumValue(item.sourceKind, ['fixed', 'template'], `${label}.sourceKind`), sourceKey: key(item.sourceKey, `${label}.sourceKey`), sourceContentHash: text(item.sourceContentHash, `${label}.sourceContentHash`, 64), questKey: key(item.questKey, `${label}.questKey`), regionKey: key(item.regionKey, `${label}.regionKey`), sourceIssueKey: item.sourceIssueKey == null ? null : key(item.sourceIssueKey, `${label}.sourceIssueKey`), category: category(item.category, `${label}.category`), title: text(item.title, `${label}.title`, 300), description: text(item.description, `${label}.description`, 8_000), participantKeys: keys(item.participantKeys, `${label}.participantKeys`, 100), allowedSolutions: keys(item.allowedSolutions, `${label}.allowedSolutions`, 64), rewardBudget: finite(item.rewardBudget, `${label}.rewardBudget`, 0, 100_000), intensity: integer(item.intensity, `${label}.intensity`, 1, 5), fingerprint: text(item.fingerprint, `${label}.fingerprint`, 2_000), channelKey: key(item.channelKey, `${label}.channelKey`), status: questStatus(item.status, `${label}.status`), createdTick: integer(item.createdTick, `${label}.createdTick`), revealedSequence: integer(item.revealedSequence, `${label}.revealedSequence`), acceptedSequence: item.acceptedSequence == null ? null : integer(item.acceptedSequence, `${label}.acceptedSequence`), terminalSequence: item.terminalSequence == null ? null : integer(item.terminalSequence, `${label}.terminalSequence`), deadlineTick: item.deadlineTick == null ? null : integer(item.deadlineTick, `${label}.deadlineTick`) }
}

export function parseOpenWorldState(value: unknown): SimulationOpenWorldState | null {
  if (value == null) return null
  const source = row(value, '开放世界状态')
  if (source.schema !== 'storyforge.open-world' || source.version !== 1 || typeof source.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(source.contentHash)) fail('开放世界状态版本或 hash 无效')
  const projections = array(source.regionalProjections, 'regionalProjections', 128).map((raw, index): OpenWorldRegionalProjection => { const item = row(raw, `regionalProjections[${index}]`); return { regionKey: key(item.regionKey, `regionalProjections[${index}].regionKey`), resources: numberMap(item.resources, `regionalProjections[${index}].resources`), metrics: numberMap(item.metrics, `regionalProjections[${index}].metrics`), issuePressures: numberMap(item.issuePressures, `regionalProjections[${index}].issuePressures`), organizationInfluence: numberMap(item.organizationInfluence, `regionalProjections[${index}].organizationInfluence`), nextScheduledTick: integer(item.nextScheduledTick, `regionalProjections[${index}].nextScheduledTick`, 1), lastUpdatedSequence: integer(item.lastUpdatedSequence, `regionalProjections[${index}].lastUpdatedSequence`) } })
  const travel = source.travel == null ? null : (() => { const item = row(source.travel, 'travel'); return { edgeKey: key(item.edgeKey, 'travel.edgeKey'), fromRegionKey: key(item.fromRegionKey, 'travel.fromRegionKey'), toRegionKey: key(item.toRegionKey, 'travel.toRegionKey'), totalTicks: integer(item.totalTicks, 'travel.totalTicks', 1), remainingTicks: integer(item.remainingTicks, 'travel.remainingTicks', 0), risk: finite(item.risk, 'travel.risk', 0, 100), startedSequence: integer(item.startedSequence, 'travel.startedSequence') } })()
  const knowledgeSource = row(source.regionKnowledge, 'regionKnowledge'); const regionKnowledge = Object.fromEntries(Object.entries(knowledgeSource).map(([entryKey, status]) => [key(entryKey, 'regionKnowledge.key'), enumValue(status, ['unknown', 'heard', 'visited', 'familiar'], `regionKnowledge.${entryKey}`)]))
  const attentionSource = row(source.attentionLevels, 'attentionLevels'); const attentionLevels = Object.fromEntries(Object.entries(attentionSource).map(([entryKey, status]) => [key(entryKey, 'attentionLevels.key'), enumValue(status, ['focus', 'active', 'background'], `attentionLevels.${entryKey}`)])) as Record<string, OpenWorldAttentionLevel>
  const actorLocations = Object.fromEntries(Object.entries(row(source.actorLocations, 'actorLocations')).map(([actor, region]) => [key(actor, 'actorLocations.key'), key(region, `actorLocations.${actor}`)]))
  const questInstances = array(source.questInstances, 'questInstances', 10_000).map((item, index) => parseInstance(item, `questInstances[${index}]`))
  if (new Set(questInstances.map(item => item.instanceKey)).size !== questInstances.length) fail('任务实例 key 重复')
  return structuredClone({ ...source, schema: 'storyforge.open-world', version: 1, contentHash: source.contentHash, mainlineQuestKeys: keys(source.mainlineQuestKeys, 'mainlineQuestKeys', 100), tick: integer(source.tick, 'tick'), tickLimit: integer(source.tickLimit, 'tickLimit', 1), currentRegionKey: key(source.currentRegionKey, 'currentRegionKey'), travel, regionKnowledge, attentionLevels, regionalProjections: projections, actorLocations, questInstances, drawHistory: array(source.drawHistory, 'drawHistory', 256) as SimulationOpenWorldState['drawHistory'], remoteActionHistory: array(source.remoteActionHistory, 'remoteActionHistory', 256) as SimulationOpenWorldState['remoteActionHistory'], propagationHistory: array(source.propagationHistory, 'propagationHistory', 256) as SimulationOpenWorldState['propagationHistory'], recentFingerprints: array(source.recentFingerprints, 'recentFingerprints', 512) as SimulationOpenWorldState['recentFingerprints'], sourceCooldowns: numberMap(source.sourceCooldowns, 'sourceCooldowns'), blankStreak: integer(source.blankStreak, 'blankStreak'), highIntensityStreak: integer(source.highIntensityStreak, 'highIntensityStreak'), lastTickEventSequences: array(source.lastTickEventSequences, 'lastTickEventSequences', 1_000).map((item, index) => integer(item, `lastTickEventSequences[${index}]`)), ended: bool(source.ended, 'ended') } as SimulationOpenWorldState)
}

function stateRequired(value: SimulationOpenWorldState | null): SimulationOpenWorldState { return parseOpenWorldState(value) ?? fail('当前实例没有开放世界状态') }
function eventPayload(event: SimulationEvent) { try { return row(JSON.parse(event.payloadJson), `事件 ${event.type}`) } catch (error) { if (error instanceof SyntaxError) fail('事件载荷不是 JSON'); throw error } }
function projection(state: SimulationOpenWorldState, regionKey: string) { return state.regionalProjections.find(item => item.regionKey === regionKey) ?? fail(`区域投影不存在:${regionKey}`) }

type ValueChange = { target: 'resource' | 'metric' | 'issue' | 'organization'; regionKey: string; key: string; before: number; after: number; delta: number }
function parseChanges(value: unknown): ValueChange[] { return array(value, 'changes', 256).map((raw, index) => { const item = row(raw, `changes[${index}]`); const target = enumValue(item.target, ['resource', 'metric', 'issue', 'organization'], `changes[${index}].target`); const before = finite(item.before, `changes[${index}].before`); const after = finite(item.after, `changes[${index}].after`); const delta = finite(item.delta, `changes[${index}].delta`); if (after !== before + delta) fail(`changes[${index}] 前后值不一致`); return { target, regionKey: key(item.regionKey, `changes[${index}].regionKey`), key: key(item.key, `changes[${index}].key`), before, after, delta } }) }
function applyChanges(state: SimulationOpenWorldState, changes: ValueChange[], sequence: number) { for (const change of changes) { const target = projection(state, change.regionKey); const map = change.target === 'resource' ? target.resources : change.target === 'metric' ? target.metrics : change.target === 'issue' ? target.issuePressures : target.organizationInfluence; if (map[change.key] !== change.before) fail(`区域变化前值不一致:${change.regionKey}:${change.key}`); map[change.key] = change.after; target.lastUpdatedSequence = sequence } }

export function applyOpenWorldEvent(value: SimulationOpenWorldState | null, event: SimulationEvent): SimulationOpenWorldState | null {
  if (!event.type.startsWith('world.') && !['adventure.quest.accepted', 'adventure.quest.completed', 'adventure.quest.failed'].includes(event.type)) return value
  const state = stateRequired(value); const body = eventPayload(event)
  if (event.type === 'adventure.quest.accepted' || event.type === 'adventure.quest.completed' || event.type === 'adventure.quest.failed') {
    const questKey = key(body.questKey, 'questKey'); const candidates = state.questInstances.filter(item => item.questKey === questKey && (event.type === 'adventure.quest.accepted' ? item.status === 'revealed' : item.status === 'active'))
    if (candidates.length !== 1) fail(`任务实例生命周期不唯一:${questKey}`)
    const instance = candidates[0]
    if (event.type === 'adventure.quest.accepted') { instance.status = 'active'; instance.acceptedSequence = event.sequence }
    else { instance.status = event.type === 'adventure.quest.completed' ? 'resolved' : 'failed'; instance.terminalSequence = event.sequence }
    return state
  }
  switch (event.type) {
    case 'world.travel.started': {
      if (state.travel) fail('已有进行中的旅行'); const fromRegionKey = key(body.fromRegionKey, 'fromRegionKey'); if (state.currentRegionKey !== fromRegionKey) fail('旅行出发区域已变化')
      state.travel = { edgeKey: key(body.edgeKey, 'edgeKey'), fromRegionKey, toRegionKey: key(body.toRegionKey, 'toRegionKey'), totalTicks: integer(body.totalTicks, 'totalTicks', 1), remainingTicks: integer(body.totalTicks, 'totalTicks', 1), risk: finite(body.risk, 'risk', 0, 100), startedSequence: event.sequence }; break
    }
    case 'world.travel.progressed': { if (!state.travel || state.travel.edgeKey !== body.edgeKey) fail('旅行进度没有对应行程'); const before = integer(body.before, 'before', 1); const after = integer(body.after, 'after', 0); if (state.travel.remainingTicks !== before || after !== before - 1) fail('旅行进度不连续'); state.travel.remainingTicks = after; break }
    case 'world.travel.completed': { if (!state.travel || state.travel.edgeKey !== body.edgeKey || state.travel.remainingTicks !== 0 || state.travel.toRegionKey !== body.regionKey) fail('旅行完成与行程不一致'); state.currentRegionKey = state.travel.toRegionKey; state.travel = null; break }
    case 'world.travel.interrupted': { if (!state.travel || state.travel.edgeKey !== body.edgeKey) fail('旅行中断没有对应行程'); state.travel = null; break }
    case 'world.region.discovered': { const regionKey = key(body.regionKey, 'regionKey'); const before = enumValue(body.before, ['unknown', 'heard', 'visited', 'familiar'], 'before'); const after = enumValue(body.after, ['heard', 'visited', 'familiar'], 'after'); if (state.regionKnowledge[regionKey] !== before) fail('区域认知前值不一致'); state.regionKnowledge[regionKey] = after; break }
    case 'world.region.attention-changed': { const regionKey = key(body.regionKey, 'regionKey'); const before = enumValue(body.before, ['focus', 'active', 'background'], 'before'); const after = enumValue(body.after, ['focus', 'active', 'background'], 'after'); if (state.attentionLevels[regionKey] !== before) fail('区域关注级别前值不一致'); state.attentionLevels[regionKey] = after; break }
    case 'world.region.projection-updated': applyChanges(state, parseChanges(body.changes), event.sequence); break
    case 'world.actor.remote-action-resolved': { const changes = parseChanges(body.changes); applyChanges(state, changes, event.sequence); const actorKey = key(body.actorKey, 'actorKey'); const toRegionKey = key(body.toRegionKey, 'toRegionKey'); state.actorLocations[actorKey] = toRegionKey; state.remoteActionHistory.push({ eventSequence: event.sequence, tick: integer(body.tick, 'tick'), actorKey, actionKey: key(body.actionKey, 'actionKey'), fromRegionKey: body.fromRegionKey == null ? null : key(body.fromRegionKey, 'fromRegionKey'), toRegionKey, summary: text(body.summary, 'summary', 2_000) }); state.remoteActionHistory = state.remoteActionHistory.slice(-128); break }
    case 'world.issue.propagated': { const from = projection(state, key(body.fromRegionKey, 'fromRegionKey')); const to = projection(state, key(body.toRegionKey, 'toRegionKey')); const issueKey = key(body.issueKey, 'issueKey'); const before = finite(body.before, 'before'); const after = finite(body.after, 'after'); const amount = finite(body.amount, 'amount', 0); if (to.issuePressures[issueKey] !== before || after !== before + amount) fail('问题传播数值不一致'); to.issuePressures[issueKey] = after; to.lastUpdatedSequence = event.sequence; state.propagationHistory.push({ eventSequence: event.sequence, tick: integer(body.tick, 'tick'), ruleKey: key(body.ruleKey, 'ruleKey'), issueKey, fromRegionKey: from.regionKey, toRegionKey: to.regionKey, amount }); state.propagationHistory = state.propagationHistory.slice(-128); break }
    case 'world.issue.localized': { const target = projection(state, key(body.regionKey, 'regionKey')); const issueKey = key(body.issueKey, 'issueKey'); const before = finite(body.before, 'before'); const after = finite(body.after, 'after'); if (target.issuePressures[issueKey] !== before || after > before) fail('问题本地化数值不一致'); target.issuePressures[issueKey] = after; target.lastUpdatedSequence = event.sequence; break }
    case 'world.quest-card.considered': { const entry = { eventSequence: event.sequence, tick: integer(body.tick, 'tick'), trigger: trigger(body.trigger, 'trigger'), regionKey: key(body.regionKey, 'regionKey'), candidates: array(body.candidates, 'candidates', 2_000) as OpenWorldDirectorCandidateEvidence[], selectedInstanceKey: body.selectedInstanceKey == null ? null : key(body.selectedInstanceKey, 'selectedInstanceKey'), selectedSourceKey: body.selectedSourceKey == null ? null : key(body.selectedSourceKey, 'selectedSourceKey'), blank: bool(body.blank, 'blank'), reason: text(body.reason, 'reason', 2_000) }; state.drawHistory.push(entry); state.drawHistory = state.drawHistory.slice(-128); break }
    case 'world.quest-card.dealt': key(body.sourceKey, 'sourceKey'); key(body.instanceKey, 'instanceKey'); break
    case 'world.quest.blank-dealt': state.blankStreak += 1; state.highIntensityStreak = 0; break
    case 'world.quest.instance-created': { const instance = parseInstance(body.instance, 'instance'); if (state.questInstances.some(item => item.instanceKey === instance.instanceKey)) fail('任务实例重复创建'); state.questInstances.push(instance); state.sourceCooldowns[instance.sourceKey] = instance.createdTick; state.recentFingerprints.push({ fingerprint: instance.fingerprint, tick: instance.createdTick }); state.recentFingerprints = state.recentFingerprints.slice(-256); break }
    case 'world.quest.revealed': { const instance = state.questInstances.find(item => item.instanceKey === body.instanceKey) ?? fail('任务实例不存在'); if (instance.status !== 'revealed' || instance.revealedSequence !== 0) fail('任务不能重复揭示'); instance.revealedSequence = event.sequence; state.blankStreak = 0; state.highIntensityStreak = instance.intensity >= 4 ? state.highIntensityStreak + 1 : 0; break }
    case 'world.quest.declined':
    case 'world.quest.expired':
    case 'world.quest.superseded': { const instance = state.questInstances.find(item => item.instanceKey === body.instanceKey) ?? fail('任务实例不存在'); if (instance.status !== 'revealed') fail('任务实例不能进入该终态'); const next = event.type === 'world.quest.declined' ? 'declined' : event.type === 'world.quest.expired' ? 'expired' : 'superseded'; instance.status = next; instance.terminalSequence = event.sequence; applyChanges(state, parseChanges(body.changes), event.sequence); break }
    case 'world.tick.completed': { const before = integer(body.before, 'before'); const after = integer(body.after, 'after'); if (state.tick !== before || after !== before + 1) fail('世界 tick 不连续'); state.tick = after; state.ended = state.tick >= state.tickLimit; state.lastTickEventSequences = array(body.eventSequences, 'eventSequences', 1_000).map((item, index) => integer(item, `eventSequences[${index}]`)); break }
    case 'world.narrative.synced': break
    default: fail(`未知开放世界事件:${event.type}`)
  }
  return state
}

export function openWorldNarrativeProjection(stateValue: SimulationOpenWorldState) {
  const state = stateRequired(stateValue); const questStatuses: Record<string, OpenWorldQuestInstanceStatus> = {}
  for (const instance of state.questInstances) questStatuses[instance.questKey] = instance.status
  return { tick: state.tick, currentRegionKey: state.currentRegionKey, traveling: state.travel != null, regionKnowledge: structuredClone(state.regionKnowledge), questStatuses, mainlineReady: false, ended: state.ended }
}

export function openWorldMainlineProjection(stateValue: SimulationOpenWorldState, mainlineQuestKeys: readonly string[]) {
  const projection = openWorldNarrativeProjection(stateValue)
  projection.mainlineReady = mainlineQuestKeys.every(questKey => projection.questStatuses[questKey] === 'resolved')
  return projection
}

function conditionSatisfied(condition: OpenWorldCondition, state: SimulationOpenWorldState): boolean {
  let actual: number | string
  if (condition.source === 'tick') actual = state.tick
  else if (condition.source === 'quest-status') { const matches = state.questInstances.filter(item => item.questKey === condition.questKey); actual = matches[matches.length - 1]?.status ?? 'unseen' }
  else { const target = projection(state, condition.regionKey); actual = condition.source === 'region-resource' ? target.resources[condition.key] : condition.source === 'region-metric' ? target.metrics[condition.key] : condition.source === 'region-issue' ? target.issuePressures[condition.key] : target.organizationInfluence[condition.key] }
  if (condition.operator === 'eq') return actual === condition.value
  if (typeof actual !== 'number' || typeof condition.value !== 'number') return false
  return condition.operator === 'gte' ? actual >= condition.value : actual <= condition.value
}

function hashUnit(seed: string): number { let hash = 2166136261; for (const character of seed) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619) } return (hash >>> 0) / 0x100000000 }
function event(sequence: number, type: WorldDescriptor['type'], payload: Record<string, unknown>, actorKey: string | null = null, targetKey: string | null = null): SimulationEvent { return { projectId: 0, sessionId: 0, sequence, type, actorKey, targetKey, payloadJson: JSON.stringify(payload), createdAt: 0 } }
function applyDescriptor(state: SimulationOpenWorldState, descriptor: WorldDescriptor, sequence: number) { return stateRequired(applyOpenWorldEvent(state, event(sequence, descriptor.type, descriptor.payload, descriptor.actorKey ?? null, descriptor.targetKey ?? null))) }

function valueBounds(simulation: NarrativeSimulationContentV1, target: ValueChange['target'], entryKey: string) { if (target === 'organization') return { minimum: -100, maximum: 100 }; const values = target === 'resource' ? simulation.resources : target === 'metric' ? simulation.metrics : simulation.issues.map(issue => ({ key: issue.key, minimum: issue.minimumPressure, maximum: issue.maximumPressure })); return values.find(item => item.key === entryKey) ?? fail(`变化目标不存在:${target}:${entryKey}`) }
function changesForEffects(state: SimulationOpenWorldState, effects: readonly OpenWorldEffect[], simulation: NarrativeSimulationContentV1): ValueChange[] {
  const working = stateRequired(state); const changes: ValueChange[] = []
  for (const effect of effects) { const target = projection(working, effect.regionKey); const kind: ValueChange['target'] = effect.op === 'change-organization-influence' ? 'organization' : effect.target; const entryKey = effect.op === 'change-organization-influence' ? effect.organizationKey : effect.key; const map = kind === 'resource' ? target.resources : kind === 'metric' ? target.metrics : kind === 'issue' ? target.issuePressures : target.organizationInfluence; const before = map[entryKey] ?? fail(`区域变化目标不存在:${effect.regionKey}:${entryKey}`); const after = before + effect.delta; const bounds = valueBounds(simulation, kind, entryKey); if (after < bounds.minimum || after > bounds.maximum) fail(`区域变化越界:${effect.regionKey}:${entryKey}`); const change = { target: kind, regionKey: effect.regionKey, key: entryKey, before, after, delta: effect.delta }; changes.push(change); map[entryKey] = after }
  return changes
}

function channelsFor(content: OpenWorldContentV1, regionKey: string, triggerKind: OpenWorldDiscoveryTrigger, allowedKeys?: readonly string[], allowedKinds?: readonly OpenWorldDiscoveryChannelKind[]) { return content.discoveryChannels.filter(channel => channel.regionKey === regionKey && channel.triggers.includes(triggerKind) && (!allowedKeys || allowedKeys.includes(channel.key)) && (!allowedKinds || allowedKinds.includes(channel.kind))).sort((left, right) => left.key.localeCompare(right.key)) }
function terminalOrMissingAdventureQuest(adventure: SimulationAdventureState, questKey: string) { const status = adventure.quests.find(item => item.questKey === questKey)?.status; return status == null || status === 'active' || status === 'completed' || status === 'failed' }

export function planOpenWorldDraw(input: { content: OpenWorldContentV1 | string; simulation: NarrativeSimulationContentV1; state: SimulationOpenWorldState; adventure: SimulationAdventureState; trigger: OpenWorldDiscoveryTrigger; seed: string; startingSequence: number }): { descriptors: WorldDescriptor[]; projected: SimulationOpenWorldState; evidence: OpenWorldDirectorCandidateEvidence[] } {
  const content = parseOpenWorldContent(input.content); let state = stateRequired(input.state); if (state.ended || state.travel) fail('当前不能触发区域发牌')
  const deck = content.decks.find(item => item.regionKey === state.currentRegionKey) ?? fail('当前区域没有牌组'); const fixed = deck.fixedCardKeys.map(sourceKey => content.fixedTaskCards.find(item => item.key === sourceKey) ?? fail(`固定任务牌不存在:${sourceKey}`)); const templates = deck.templateKeys.map(sourceKey => content.taskTemplates.find(item => item.key === sourceKey) ?? fail(`任务模板不存在:${sourceKey}`)).filter(item => item.regionKeys.includes(state.currentRegionKey))
  const revealed = state.questInstances.filter(item => item.status === 'revealed'); const active = state.questInstances.filter(item => item.status === 'active'); const recentWindow = state.questInstances.filter(item => item.createdTick >= state.tick - deck.recentWindow); const categoryCounts = new Map<OpenWorldQuestCategory, number>(); for (const item of recentWindow) categoryCounts.set(item.category, (categoryCounts.get(item.category) ?? 0) + 1)
  const candidates: OpenWorldDirectorCandidateEvidence[] = []
  const evaluate = (sourceKind: 'fixed' | 'template', source: OpenWorldFixedTaskCardDefinition | OpenWorldTaskTemplateDefinition) => { const sourceKey = source.key; const questKey = sourceKind === 'fixed' ? (source as OpenWorldFixedTaskCardDefinition).questKey : (source as OpenWorldTaskTemplateDefinition).adventureQuestKey; const regionKey = state.currentRegionKey; const sourceIssueKey = source.sourceIssueKey; const taskFingerprint = fingerprint(source.fingerprint, regionKey, sourceIssueKey); const reasons: string[] = []; if (state.questInstances.length >= content.director.maxQuestInstances) reasons.push('任务实例达到上限'); if (revealed.length >= Math.min(deck.maxRevealed, content.director.globalMaxRevealed)) reasons.push('已揭示任务积压'); if (active.length >= Math.min(deck.maxActive, content.director.globalMaxActive)) reasons.push('活跃任务积压'); if (terminalOrMissingAdventureQuest(input.adventure, questKey)) reasons.push('冒险任务已经开始或终结'); const prior = state.questInstances.filter(item => item.sourceKey === sourceKey); const unique = sourceKind === 'fixed' && (source as OpenWorldFixedTaskCardDefinition).unique; if (unique && prior.length) reasons.push('唯一任务已领取'); const lastTick = state.sourceCooldowns[sourceKey]; if (lastTick != null && state.tick - lastTick < Math.max(deck.cooldownTicks, source.cooldownTicks)) reasons.push('来源冷却中'); if (!source.requirements.every(condition => conditionSatisfied(condition, state))) reasons.push('前置不满足'); const quota = deck.categoryQuotas[source.category]; if (quota != null && (categoryCounts.get(source.category) ?? 0) >= quota) reasons.push('类别配额已满'); const availableChannels = sourceKind === 'fixed' ? channelsFor(content, regionKey, input.trigger, (source as OpenWorldFixedTaskCardDefinition).allowedChannelKeys) : channelsFor(content, regionKey, input.trigger, undefined, (source as OpenWorldTaskTemplateDefinition).allowedChannelKinds); if (!availableChannels.length) reasons.push('当前触发没有合法渠道'); const recentMatches = state.recentFingerprints.filter(item => item.fingerprint === taskFingerprint && item.tick >= state.tick - deck.recentWindow).length; if (recentMatches) reasons.push('近期任务指纹重复'); const critical = sourceKind === 'fixed' && (source as OpenWorldFixedTaskCardDefinition).critical; const guarantee = sourceKind === 'fixed' && (source as OpenWorldFixedTaskCardDefinition).guaranteedByTick != null && state.tick >= (source as OpenWorldFixedTaskCardDefinition).guaranteedByTick!; const urgency = sourceIssueKey == null ? 0 : (projection(state, regionKey).issuePressures[sourceIssueKey] ?? 0) / 10; const freshness = recentMatches ? -content.director.freshnessPenalty : content.director.freshnessPenalty; const backlog = -(revealed.length + active.length) * content.director.backlogPenalty; const quotaScore = quota == null ? 0 : Math.max(0, quota - (categoryCounts.get(source.category) ?? 0)) * 2; const randomEvidence = hashUnit(`${input.seed}|draw|${state.tick}|${state.drawHistory.length}|${sourceKind}|${sourceKey}`); const random = randomEvidence * content.director.randomJitter; const guaranteeScore = guarantee ? content.director.criticalGuaranteeBonus : critical ? content.director.criticalGuaranteeBonus / 4 : 0; const scoreParts = { base: source.basePriority, urgency, freshness, backlog, quota: quotaScore, guarantee: guaranteeScore, random }; const score = reasons.length ? null : Object.values(scoreParts).reduce((sum, value) => sum + value, 0); candidates.push({ sourceKind, sourceKey, questKey, eligible: reasons.length === 0, reasons, score, scoreParts, randomEvidence, channelKey: availableChannels[0]?.key ?? null, fingerprint: taskFingerprint }) }
  fixed.forEach(source => evaluate('fixed', source)); templates.forEach(source => evaluate('template', source))
  const eligible = candidates.filter(item => item.eligible).sort((left, right) => (right.score ?? -Infinity) - (left.score ?? -Infinity) || left.sourceKey.localeCompare(right.sourceKey)); const blankScore = deck.blankWeight + state.blankStreak * -5 + (state.highIntensityStreak >= deck.highIntensityStreakLimit ? content.director.criticalGuaranteeBonus / 2 : 0) + (revealed.length + active.length) * content.director.backlogPenalty; const selected = eligible[0] && (eligible[0].score ?? -Infinity) > blankScore ? eligible[0] : null; const instanceKey = selected ? `quest.${state.tick}.${state.drawHistory.length + 1}.${selected.sourceKey}` : null; const descriptors: WorldDescriptor[] = [{ type: 'world.quest-card.considered', payload: { tick: state.tick, trigger: input.trigger, regionKey: state.currentRegionKey, candidates, selectedInstanceKey: instanceKey, selectedSourceKey: selected?.sourceKey ?? null, blank: !selected, reason: selected ? '最高合法评分超过空白牌' : eligible.length ? '空白牌符合节奏控制' : '没有合法任务候选' }, commandEnvelope: true }]
  if (!selected) descriptors.push({ type: 'world.quest.blank-dealt', payload: { tick: state.tick, trigger: input.trigger, regionKey: state.currentRegionKey, blankScore } })
  else { const source = selected.sourceKind === 'fixed' ? content.fixedTaskCards.find(item => item.key === selected.sourceKey)! : content.taskTemplates.find(item => item.key === selected.sourceKey)!; const channel = content.discoveryChannels.find(item => item.key === selected.channelKey)!; const fixedSource = selected.sourceKind === 'fixed' ? source as OpenWorldFixedTaskCardDefinition : null; const templateSource = selected.sourceKind === 'template' ? source as OpenWorldTaskTemplateDefinition : null; const regionTitle = content.regions.find(item => item.key === state.currentRegionKey)!.title; const instance: OpenWorldFrozenQuestInstance = { instanceKey: instanceKey!, sourceKind: selected.sourceKind, sourceKey: selected.sourceKey, sourceContentHash: state.contentHash, questKey: selected.questKey, regionKey: state.currentRegionKey, sourceIssueKey: source.sourceIssueKey, category: source.category, title: fixedSource?.title ?? templateSource!.titleTemplate.split('{region}').join(regionTitle), description: fixedSource?.description ?? templateSource!.descriptionTemplate.split('{region}').join(regionTitle), participantKeys: source.participantKeys, allowedSolutions: source.allowedSolutions, rewardBudget: source.rewardBudget, intensity: source.intensity, fingerprint: selected.fingerprint, channelKey: channel.key, status: 'revealed', createdTick: state.tick, revealedSequence: 0, acceptedSequence: null, terminalSequence: null, deadlineTick: source.expirationTicks == null ? null : state.tick + source.expirationTicks }; descriptors.push({ type: 'world.quest-card.dealt', payload: { sourceKind: selected.sourceKind, sourceKey: selected.sourceKey, instanceKey, channelKey: channel.key, score: selected.score } }); descriptors.push({ type: 'world.quest.instance-created', payload: { instance } }); descriptors.push({ type: 'world.quest.revealed', payload: { instanceKey, channelKey: channel.key, templateText: channel.textTemplate } }) }
  for (const [index, descriptor] of descriptors.entries()) state = applyDescriptor(state, descriptor, input.startingSequence + index + 1)
  return { descriptors, projected: state, evidence: candidates }
}

function edgeDestination(edge: OpenWorldContentV1['travelEdges'][number], current: string) { if (edge.fromRegionKey === current) return edge.toRegionKey; if (edge.bidirectional && edge.toRegionKey === current) return edge.fromRegionKey; return null }
export function planOpenWorldTravel(input: { content: OpenWorldContentV1 | string; state: SimulationOpenWorldState; edgeKey: string; startingSequence: number }): { descriptors: WorldDescriptor[]; projected: SimulationOpenWorldState } { const content = parseOpenWorldContent(input.content); let state = stateRequired(input.state); if (state.travel || state.ended) fail('当前不能开始旅行'); const edge = content.travelEdges.find(item => item.key === input.edgeKey) ?? fail('交通边不存在'); const destination = edgeDestination(edge, state.currentRegionKey); if (!destination) fail('交通边不连接当前区域'); if (edge.blockedByIssueKey && edge.blockedAtPressure != null && (projection(state, state.currentRegionKey).issuePressures[edge.blockedByIssueKey] ?? 0) >= edge.blockedAtPressure && !content.mainline.protectedEdgeKeys.includes(edge.key)) fail('交通路线已被区域问题阻断'); const descriptor: WorldDescriptor = { type: 'world.travel.started', payload: { edgeKey: edge.key, fromRegionKey: state.currentRegionKey, toRegionKey: destination, totalTicks: edge.travelTicks, risk: edge.risk }, commandEnvelope: true }; state = applyDescriptor(state, descriptor, input.startingSequence + 1); return { descriptors: [descriptor], projected: state } }

export function planOpenWorldQuestDecision(input: { content: OpenWorldContentV1 | string; simulation: NarrativeSimulationContentV1; state: SimulationOpenWorldState; instanceKey: string; decision: 'accept' | 'decline'; startingSequence: number }): { descriptors: WorldDescriptor[]; projected: SimulationOpenWorldState } { const content = parseOpenWorldContent(input.content); let state = stateRequired(input.state); const instance = state.questInstances.find(item => item.instanceKey === input.instanceKey) ?? fail('任务实例不存在'); if (instance.status !== 'revealed') fail('任务实例不能重复处理'); const descriptors: WorldDescriptor[] = []; if (input.decision === 'accept') descriptors.push({ type: 'adventure.quest.accepted', targetKey: instance.questKey, payload: { questKey: instance.questKey, sourceInstanceKey: instance.instanceKey }, commandEnvelope: true }); else { const source = instance.sourceKind === 'fixed' ? content.fixedTaskCards.find(item => item.key === instance.sourceKey) : content.taskTemplates.find(item => item.key === instance.sourceKey); if (!source) fail('任务来源不存在'); const changes = changesForEffects(state, source.declineEffects, input.simulation); descriptors.push({ type: 'world.quest.declined', targetKey: instance.instanceKey, payload: { instanceKey: instance.instanceKey, changes }, commandEnvelope: true }) } for (const [index, descriptor] of descriptors.entries()) state = applyDescriptor(state, descriptor, input.startingSequence + index + 1); return { descriptors, projected: state } }

function directedNeighbors(content: OpenWorldContentV1, regionKey: string) { return content.travelEdges.flatMap(edge => edge.fromRegionKey === regionKey ? [{ edge, to: edge.toRegionKey }] : edge.bidirectional && edge.toRegionKey === regionKey ? [{ edge, to: edge.fromRegionKey }] : []) }
export function planOpenWorldTick(input: { content: OpenWorldContentV1 | string; simulation: NarrativeSimulationContentV1; state: SimulationOpenWorldState; seed: string; startingSequence: number }): { descriptors: WorldDescriptor[]; projected: SimulationOpenWorldState } { const content = parseOpenWorldContent(input.content); let state = stateRequired(input.state); if (state.ended) fail('世界长局已经结束'); const nextTick = state.tick + 1; const descriptors: WorldDescriptor[] = []; const push = (descriptor: WorldDescriptor) => { descriptors.push(descriptor); state = applyDescriptor(state, descriptor, input.startingSequence + descriptors.length) }
  if (state.travel) { const before = state.travel.remainingTicks; push({ type: 'world.travel.progressed', payload: { edgeKey: state.travel.edgeKey, before, after: before - 1 } }); if (state.travel?.remainingTicks === 0) { const fromRegionKey = state.travel.fromRegionKey; const toRegionKey = state.travel.toRegionKey; const oldLocation = content.regions.find(item => item.key === fromRegionKey)?.locationKey ?? fail('旅行来源地点不存在'); const newLocation = content.regions.find(item => item.key === toRegionKey)?.locationKey ?? fail('旅行目标地点不存在'); push({ type: 'adventure.location.left', payload: { locationKey: oldLocation } }); push({ type: 'adventure.location.entered', payload: { locationKey: newLocation } }); push({ type: 'world.travel.completed', payload: { edgeKey: state.travel!.edgeKey, regionKey: toRegionKey } }); const beforeKnowledge = state.regionKnowledge[toRegionKey]; const afterKnowledge = beforeKnowledge === 'unknown' || beforeKnowledge === 'heard' ? 'visited' : 'familiar'; push({ type: 'world.region.discovered', payload: { regionKey: toRegionKey, before: beforeKnowledge, after: afterKnowledge } }); const activeRegions = new Set([toRegionKey, ...directedNeighbors(content, toRegionKey).map(item => item.to)]); for (const region of content.regions) { const next: OpenWorldAttentionLevel = region.key === toRegionKey ? 'focus' : activeRegions.has(region.key) ? 'active' : 'background'; if (state.attentionLevels[region.key] !== next) push({ type: 'world.region.attention-changed', payload: { regionKey: region.key, before: state.attentionLevels[region.key], after: next } }) } } }
  for (const rule of content.regionalIssueRules) { const dueRegions = rule.regionKeys.filter(regionKey => state.attentionLevels[regionKey] !== 'background' || nextTick % Math.max(1, rule.cooldownTicks) === 0); const effects = dueRegions.map(regionKey => ({ op: 'change-region-value' as const, target: 'issue' as const, regionKey, key: rule.issueKey, delta: rule.driftPerTick })).filter(effect => { const issue = input.simulation.issues.find(item => item.key === effect.key)!; const current = projection(state, effect.regionKey).issuePressures[effect.key]; return current + effect.delta >= issue.minimumPressure && current + effect.delta <= issue.maximumPressure }); if (effects.length) push({ type: 'world.region.projection-updated', payload: { tick: nextTick, cause: `issue-drift:${rule.key}`, changes: changesForEffects(state, effects, input.simulation) } }) }
  for (const schedule of content.actorSchedules.filter(item => nextTick >= item.offsetTicks && (nextTick - item.offsetTicks) % item.periodTicks === 0)) { const cycleIndex = Math.floor((nextTick - schedule.offsetTicks) / schedule.periodTicks) % schedule.regionCycle.length; const toRegionKey = schedule.regionCycle[cycleIndex]; const fromRegionKey = state.actorLocations[schedule.actorKey] ?? null; push({ type: 'world.actor.remote-action-resolved', actorKey: schedule.actorKey, targetKey: toRegionKey, payload: { tick: nextTick, actorKey: schedule.actorKey, actionKey: schedule.key, fromRegionKey, toRegionKey, summary: schedule.summary, changes: changesForEffects(state, schedule.effects.map(effect => ({ ...effect, regionKey: effect.regionKey === '$actor-region' ? toRegionKey : effect.regionKey })) as OpenWorldEffect[], input.simulation) } }) }
  const propagationCandidates: Array<{ rule: OpenWorldContentV1['regionalIssueRules'][number]; from: string; to: string; amount: number }> = []; for (const rule of content.regionalIssueRules) for (const from of rule.regionKeys) { const pressure = projection(state, from).issuePressures[rule.issueKey] ?? 0; if (pressure < rule.propagationThreshold) continue; for (const { to } of directedNeighbors(content, from)) { if (!rule.regionKeys.includes(to)) continue; const recent = state.propagationHistory.some(item => item.ruleKey === rule.key && item.fromRegionKey === from && item.toRegionKey === to && nextTick - item.tick < rule.cooldownTicks); if (recent) continue; const amount = Math.min(rule.propagationCap, Math.floor(pressure * rule.propagationFraction)); const issue = input.simulation.issues.find(item => item.key === rule.issueKey)!; const before = projection(state, to).issuePressures[rule.issueKey] ?? 0; if (amount > 0 && before + amount <= issue.maximumPressure) propagationCandidates.push({ rule, from, to, amount }) } }
  propagationCandidates.sort((left, right) => (hashUnit(`${input.seed}|propagation|${nextTick}|${left.rule.key}|${left.from}|${left.to}`) - hashUnit(`${input.seed}|propagation|${nextTick}|${right.rule.key}|${right.from}|${right.to}`)) || left.rule.key.localeCompare(right.rule.key)); for (const candidate of propagationCandidates.slice(0, content.maxPropagationEdgesPerTick)) { const before = projection(state, candidate.to).issuePressures[candidate.rule.issueKey]; push({ type: 'world.issue.propagated', targetKey: candidate.to, payload: { tick: nextTick, ruleKey: candidate.rule.key, issueKey: candidate.rule.issueKey, fromRegionKey: candidate.from, toRegionKey: candidate.to, amount: candidate.amount, before, after: before + candidate.amount } }) }
  for (const instance of state.questInstances.filter(item => item.status === 'revealed')) { const source = instance.sourceKind === 'fixed' ? content.fixedTaskCards.find(item => item.key === instance.sourceKey) : content.taskTemplates.find(item => item.key === instance.sourceKey); if (!source) fail('运行任务来源不存在'); if (instance.sourceKind === 'fixed' && (source as OpenWorldFixedTaskCardDefinition).supersedeConditions.length && (source as OpenWorldFixedTaskCardDefinition).supersedeConditions.every(condition => conditionSatisfied(condition, state))) push({ type: 'world.quest.superseded', targetKey: instance.instanceKey, payload: { instanceKey: instance.instanceKey, changes: [] } }); else if (instance.deadlineTick != null && nextTick >= instance.deadlineTick) push({ type: 'world.quest.expired', targetKey: instance.instanceKey, payload: { instanceKey: instance.instanceKey, changes: changesForEffects(state, source.expirationEffects, input.simulation) } }) }
  const eventSequences = descriptors.map((_, index) => input.startingSequence + index + 1); push({ type: 'world.tick.completed', payload: { before: state.tick, after: nextTick, eventSequences } }); return { descriptors, projected: state } }

export function rebaseOpenWorldStateForBranch(stateValue: SimulationOpenWorldState): SimulationOpenWorldState { const state = stateRequired(stateValue); state.travel = state.travel ? { ...state.travel, startedSequence: 0 } : null; state.regionalProjections = state.regionalProjections.map(item => ({ ...item, lastUpdatedSequence: 0 })); state.questInstances = state.questInstances.map(item => ({ ...item, revealedSequence: 0, acceptedSequence: item.acceptedSequence == null ? null : 0, terminalSequence: item.terminalSequence == null ? null : 0 })); state.drawHistory = state.drawHistory.map(item => ({ ...item, eventSequence: 0 })); state.remoteActionHistory = state.remoteActionHistory.map(item => ({ ...item, eventSequence: 0 })); state.propagationHistory = state.propagationHistory.map(item => ({ ...item, eventSequence: 0 })); state.lastTickEventSequences = []; return state }

export function validateOpenWorldExpressionCandidate(input: { candidate: OpenWorldExpressionCandidateV1; state: SimulationOpenWorldState; content: OpenWorldContentV1; events: readonly SimulationEvent[] }): OpenWorldExpressionCandidateV1 { const candidate = structuredClone(input.candidate); if (!['quest-expression', 'scene-narration'].includes(candidate.kind) || !candidate.title.trim() || !candidate.text.trim() || candidate.title.length > 300 || candidate.text.length > 20_000 || candidate.dialogue.length > 20_000 || !candidate.evidenceEventSequences.length || new Set(candidate.evidenceEventSequences).size !== candidate.evidenceEventSequences.length || (candidate.kind === 'quest-expression' && !candidate.instanceKey)) fail('AI 表现候选结构无效'); const evidence = new Map(input.events.map(item => [item.sequence, item])); if (candidate.evidenceEventSequences.some(sequence => !evidence.get(sequence) || (!evidence.get(sequence)!.type.startsWith('world.') && !evidence.get(sequence)!.type.startsWith('adventure.')))) fail('AI 表现候选引用不存在事件'); const instance = candidate.instanceKey == null ? null : input.state.questInstances.find(item => item.instanceKey === candidate.instanceKey) ?? fail('AI 候选任务实例不存在'); const allowed = { region: new Set(input.content.regions.map(item => item.key)), participant: new Set(instance?.participantKeys ?? []), organization: new Set(input.content.regions.flatMap(item => item.organizationKeys)), quest: new Set(instance ? [instance.questKey] : []), issue: new Set(instance?.sourceIssueKey ? [instance.sourceIssueKey] : []), channel: new Set(instance ? [instance.channelKey] : []) }; for (const ref of candidate.assertedReferences) if (!allowed[ref.kind]?.has(ref.key)) fail(`AI 表现候选伪造引用:${ref.kind}:${ref.key}`); return candidate }

export function runOpenWorldBatch(input: { content: OpenWorldContentV1; simulation: NarrativeSimulationContentV1; adventure: SimulationAdventureState; contentHash: string; seed: string; ticks: number }): { state: SimulationOpenWorldState; events: WorldDescriptor[] } { let state = createInitialOpenWorldState(input.content, input.contentHash); const events: WorldDescriptor[] = []; let sequence = 0; for (let index = 0; index < input.ticks && !state.ended; index += 1) { const plan = planOpenWorldTick({ content: input.content, simulation: input.simulation, state, seed: input.seed, startingSequence: sequence }); events.push(...plan.descriptors); state = plan.projected; sequence += plan.descriptors.length } return { state, events } }
