import Dexie from 'dexie'
import { db } from '../db/schema'
import { transactionTablesForReferenceCascade } from '../registry/lifecycle'
import { cascadeRegisteredReferences } from '../world-engine/lifecycle'
import {
  EMPTY_SIMULATION_STATE,
  NARRATIVE_MODULE_KINDS,
  NARRATIVE_BEAT_KINDS,
  NARRATIVE_NODE_KINDS,
  RUNTIME_ENTITY_KINDS,
  RUNTIME_LIFECYCLE_STATUSES,
  SIMULATION_EVENT_TYPES,
  SIMULATION_SESSION_KINDS,
  type RuntimeAttributes,
  type RuntimeEntityState,
  type RuntimeMemory,
  type AnyGameReleaseManifestV1,
  type FrozenNarrativeBeat,
  type FrozenNarrativeChoice,
  type NarrativeChoiceHistoryEntry,
  type SimulationCheckpoint,
  type SimulationEvent,
  type SimulationEventType,
  type SimulationNpcEvolutionCandidate,
  type SimulationNpcEvolutionProposal,
  type SimulationNarrativeNodeSnapshot,
  type SimulationNarrativeState,
  type SimulationRuntimeState,
  type SimulationSession,
  type SimulationSessionKind,
  type SimulationTtrpgAction,
  type SimulationTtrpgAttackResult,
  type SimulationTtrpgCheck,
  type SimulationTtrpgCheckRequest,
  type SimulationTtrpgCombatant,
  type SimulationTtrpgCondition,
  type SimulationTtrpgCampaignState,
  type SimulationChatIdentity,
  type SimulationChatScene,
  type SimulationChatState,
  type SimulationChatMessage,
  type InteractionMemoryKind,
  type SimulationTtrpgEncounter,
  type SimulationTtrpgEncounterCandidate,
  type SimulationTtrpgNpcSchedule,
  type SimulationTtrpgQuest,
  SIMULATION_TTRPG_QUEST_STATUSES,
  type SimulationTtrpgQuestStatus,
  type SimulationTtrpgResource,
  type SimulationTtrpgScene,
  type SimulationTtrpgState,
  type SimulationTtrpgTurnCandidate,
} from '../types'
import {
  applyInteractionEvent,
  createInitialInteractionState,
  parseInteractionState,
  rebaseInteractionStateForBranch,
} from '../character-interaction/runtime'
import {
  applyAdventureEffects,
  applyAdventureEvent,
  adventureNarrativeProjection,
  availableAdventureActions,
  createInitialAdventureState,
  parseAdventureState,
} from '../adventure/runtime'
import {
  applyNarrativeEffects,
  evaluateNarrativeCondition,
  parseNarrativeCondition,
  parseNarrativeEffects,
} from '../narrative/blueprint'
import {
  applyNarrativeChoiceEffects,
  evaluateNarrativeChoices,
} from '../text-game/content'
import { assertGameReleaseUnchanged, parseAnyGameReleaseManifest } from '../text-game/releases'
import { applyAvgPresentationEvent, createInitialAvgPresentationState, parseAvgPresentationState } from '../avg/runtime'
import {
  applyNarrativeSimulationEvent,
  createInitialNarrativeSimulationState,
  narrativeSimulationProjection,
  parseNarrativeSimulationState,
  planNarrativeSimulationTurn,
  rebaseNarrativeSimulationStateForBranch,
} from '../narrative-simulation/runtime'
import {
  applyOpenWorldEvent,
  createInitialOpenWorldState,
  openWorldMainlineProjection,
  parseOpenWorldState,
  planOpenWorldDraw,
  planOpenWorldQuestDecision,
  planOpenWorldTick,
  planOpenWorldTravel,
  rebaseOpenWorldStateForBranch,
} from '../open-world/runtime'

type JsonObject = Record<string, unknown>

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export interface CreateSimulationSessionInput {
  projectId: number
  worldGroupId?: number | null
  kind: SimulationSessionKind
  title: string
  seed?: string
  canonSnapshot?: unknown
  initialState?: SimulationRuntimeState
}

export interface CreateReleasedGameSessionInput extends CreateSimulationSessionInput {
  worldId: number
  workId: number
  worldReleaseId: number
  gameReleaseId: number
  narrativeModuleExportId: number
  /** New games must match the release entry state; validated branches preserve a replayed mid-game state. */
  origin: 'release' | 'branch'
}

export interface DiceResolution {
  expression: string
  dice: number[]
  modifier: number
  total: number
  nonce: string
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonObject(value: string, label: string): JsonObject {
  try {
    const parsed = JSON.parse(value)
    if (!isObject(parsed)) throw new Error(`${label} 必须是 JSON 对象。`)
    return parsed
  } catch (error) {
    if (error instanceof Error && error.message.endsWith('必须是 JSON 对象。')) throw error
    throw new Error(`${label} 不是合法 JSON。`)
  }
}

function assertFiniteInteger(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${label} 必须是 ${min}..${max} 的整数。`)
  }
  return Number(value)
}

function optionalPositiveInteger(value: unknown, label: string): number | null {
  if (value == null) return null
  return assertFiniteInteger(value, label, 1, Number.MAX_SAFE_INTEGER)
}

function optionalPortableInteger(value: unknown, label: string): number | null {
  if (value == null) return null
  return assertFiniteInteger(value, label, 0, Number.MAX_SAFE_INTEGER)
}

function narrativeKeyArray(value: unknown, label: string, keys?: Set<string>, allowDuplicates = false): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组。`)
  const result = value.map(item => String(item).trim())
  if (result.some(item => !item || item.length > 200)
    || (!allowDuplicates && new Set(result).size !== result.length)) {
    throw new Error(`${label} 包含空值、超长值或重复值。`)
  }
  if (keys && result.some(item => !keys.has(item))) throw new Error(`${label} 引用了不存在的叙事节点。`)
  return result
}

function narrativeTextArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组。`)
  const result = value.map(item => String(item).trim())
  if (result.some(item => !item || item.length > 100) || new Set(result).size !== result.length) {
    throw new Error(`${label} 包含空值、超长值或重复值。`)
  }
  return result
}

function parseFrozenNarrativeBeat(value: unknown, nodeKeys: Set<string>): FrozenNarrativeBeat {
  if (!isObject(value)) throw new Error('冻结 Beat 必须是对象。')
  const beatKey = String(value.beatKey ?? '').trim()
  const nodeKey = String(value.nodeKey ?? '').trim()
  const kind = String(value.kind ?? '')
  const speakerKey = value.speakerKey == null ? null : String(value.speakerKey).trim()
  const text = String(value.text ?? '')
  if (!beatKey || beatKey.length > 200 || !/^[a-zA-Z0-9._:-]+$/.test(beatKey)) throw new Error('冻结 Beat key 无效。')
  if (!nodeKeys.has(nodeKey)) throw new Error(`冻结 Beat 节点不存在: ${beatKey}`)
  if (!NARRATIVE_BEAT_KINDS.includes(kind as FrozenNarrativeBeat['kind'])) throw new Error(`冻结 Beat 类型无效: ${beatKey}`)
  if (kind === 'dialogue' && !speakerKey) throw new Error(`冻结对话 Beat 缺少 speaker: ${beatKey}`)
  if (!text.trim() || text.length > 40_000) throw new Error(`冻结 Beat 文本无效: ${beatKey}`)
  return {
    beatKey,
    nodeKey,
    kind: kind as FrozenNarrativeBeat['kind'],
    speakerKey,
    text,
    order: assertFiniteInteger(value.order, `${beatKey}.order`, -1_000_000, 1_000_000),
  }
}

function parseFrozenNarrativeChoice(value: unknown, nodeKeys: Set<string>): FrozenNarrativeChoice {
  if (!isObject(value)) throw new Error('冻结 Choice 必须是对象。')
  const choiceKey = String(value.choiceKey ?? '').trim()
  const sourceNodeKey = String(value.sourceNodeKey ?? '').trim()
  const targetNodeKey = String(value.targetNodeKey ?? '').trim()
  const text = String(value.text ?? '')
  const description = String(value.description ?? '')
  const unavailableReason = String(value.unavailableReason ?? '')
  const displayConditionJson = String(value.displayConditionJson ?? '{}')
  const availableConditionJson = String(value.availableConditionJson ?? '{}')
  const effectsJson = String(value.effectsJson ?? '[]')
  if (!choiceKey || choiceKey.length > 200 || !/^[a-zA-Z0-9._:-]+$/.test(choiceKey)) throw new Error('冻结 Choice key 无效。')
  if (!nodeKeys.has(sourceNodeKey) || !nodeKeys.has(targetNodeKey)) throw new Error(`冻结 Choice 节点不存在: ${choiceKey}`)
  if (!text.trim() || text.length > 4_000 || description.length > 20_000 || unavailableReason.length > 4_000) {
    throw new Error(`冻结 Choice 内容无效: ${choiceKey}`)
  }
  parseNarrativeCondition(displayConditionJson)
  parseNarrativeCondition(availableConditionJson)
  parseNarrativeEffects(effectsJson)
  const tags = narrativeTextArray(value.tags, `${choiceKey}.tags`)
  return {
    choiceKey,
    sourceNodeKey,
    text,
    description,
    unavailableReason,
    targetNodeKey,
    displayConditionJson,
    availableConditionJson,
    effectsJson,
    tags,
    order: assertFiniteInteger(value.order, `${choiceKey}.order`, -1_000_000, 1_000_000),
  }
}

function parseSimulationNarrativeNode(value: unknown): SimulationNarrativeNodeSnapshot {
  if (!isObject(value)) throw new Error('冻结叙事节点必须是对象。')
  const key = String(value.key ?? '').trim()
  const kind = String(value.kind ?? '')
  const title = String(value.title ?? '').trim()
  const summary = String(value.summary ?? '').trim()
  const conditionJson = String(value.conditionJson ?? '{}')
  const effectsJson = String(value.effectsJson ?? '[]')
  if (!key || key.length > 200 || !/^[a-zA-Z0-9._:-]+$/.test(key)) throw new Error('冻结叙事节点 key 无效。')
  if (!NARRATIVE_NODE_KINDS.includes(kind as typeof NARRATIVE_NODE_KINDS[number])) throw new Error(`冻结叙事节点类型无效: ${kind}`)
  if (!title || title.length > 500 || summary.length > 20_000) throw new Error(`冻结叙事节点内容无效: ${key}`)
  parseNarrativeCondition(conditionJson)
  parseNarrativeEffects(effectsJson)
  return {
    key,
    kind: kind as SimulationNarrativeNodeSnapshot['kind'],
    title,
    summary,
    conditionJson,
    effectsJson,
    successorKeys: narrativeKeyArray(value.successorKeys, `${key}.successorKeys`),
  }
}

function parseSimulationNarrativeState(value: unknown): SimulationNarrativeState | null {
  if (value == null) return null
  if (!isObject(value) || value.schema !== 'storyforge.simulation-narrative'
    || (value.version !== 1 && value.version !== 2)) {
    throw new Error('不支持的冻结叙事状态。')
  }
  if (!Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > 5_000) {
    throw new Error('冻结叙事必须包含 1..5000 个节点。')
  }
  const nodes = value.nodes.map(parseSimulationNarrativeNode)
  const keys = new Set(nodes.map(node => node.key))
  if (keys.size !== nodes.length) throw new Error('冻结叙事节点 key 不能重复。')
  for (const node of nodes) {
    if (node.successorKeys.some(key => !keys.has(key))) throw new Error(`冻结叙事节点 ${node.key} 存在悬空后继。`)
  }
  const moduleKind = String(value.moduleKind ?? '')
  const moduleTitle = String(value.moduleTitle ?? '').trim()
  const sourceHash = String(value.sourceHash ?? '').trim()
  if (!NARRATIVE_MODULE_KINDS.includes(moduleKind as typeof NARRATIVE_MODULE_KINDS[number])) throw new Error('冻结叙事模块类型无效。')
  if (!moduleTitle || moduleTitle.length > 500 || !sourceHash || sourceHash.length > 128) throw new Error('冻结叙事模块身份无效。')
  const currentNodeKey = value.currentNodeKey == null ? null : String(value.currentNodeKey).trim()
  if (currentNodeKey != null && !keys.has(currentNodeKey)) throw new Error('冻结叙事当前节点不存在。')
  if (!isObject(value.variables)) throw new Error('冻结叙事变量必须是对象。')
  if (typeof value.completed !== 'boolean') throw new Error('冻结叙事完成状态无效。')
  const common: SimulationNarrativeState = {
    schema: 'storyforge.simulation-narrative',
    version: value.version,
    sourceModuleId: optionalPositiveInteger(value.sourceModuleId, '叙事来源模块 ID'),
    sourceModuleExportId: optionalPortableInteger(value.sourceModuleExportId, '叙事来源便携 ID'),
    moduleKind: moduleKind as SimulationNarrativeState['moduleKind'],
    moduleTitle,
    sourceHash,
    nodes,
    currentNodeKey,
    visitedNodeKeys: narrativeKeyArray(value.visitedNodeKeys, '叙事已访问节点', keys, true),
    availableNodeKeys: narrativeKeyArray(value.availableNodeKeys, '叙事可选节点', keys),
    variables: structuredClone(value.variables),
    completed: value.completed,
  }
  if (value.version === 1) return common
  const contentHash = String(value.contentHash ?? '').trim()
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error('冻结游戏发布身份无效。')
  if (!Array.isArray(value.beats) || value.beats.length > 50_000) throw new Error('冻结 Beat 列表无效。')
  if (!Array.isArray(value.choices) || value.choices.length > 50_000) throw new Error('冻结 Choice 列表无效。')
  const beats = value.beats.map(beat => parseFrozenNarrativeBeat(beat, keys))
  const choices = value.choices.map(choice => parseFrozenNarrativeChoice(choice, keys))
  const choiceKeys = new Set(choices.map(choice => choice.choiceKey))
  if (choiceKeys.size !== choices.length) throw new Error('冻结 Choice key 不能重复。')
  const visibleChoiceKeys = narrativeKeyArray(value.visibleChoiceKeys, '可见 Choice')
  const availableChoiceKeys = narrativeKeyArray(value.availableChoiceKeys, '可用 Choice')
  if (visibleChoiceKeys.some(key => !choiceKeys.has(key)) || availableChoiceKeys.some(key => !choiceKeys.has(key))) {
    throw new Error('冻结叙事 Choice 状态引用不存在。')
  }
  if (availableChoiceKeys.some(key => !visibleChoiceKeys.includes(key))) throw new Error('可用 Choice 必须可见。')
  if (!Array.isArray(value.choiceHistory)) throw new Error('冻结叙事选择历史必须是数组。')
  const choiceHistory: NarrativeChoiceHistoryEntry[] = value.choiceHistory.map(raw => {
    if (!isObject(raw)) throw new Error('冻结叙事选择历史记录无效。')
    const choiceKey = String(raw.choiceKey ?? '').trim()
    const fromNodeKey = String(raw.fromNodeKey ?? '').trim()
    const toNodeKey = String(raw.toNodeKey ?? '').trim()
    if (!choiceKeys.has(choiceKey) || !keys.has(fromNodeKey) || !keys.has(toNodeKey)) {
      throw new Error('冻结叙事选择历史引用不存在。')
    }
    return {
      eventSequence: assertFiniteInteger(raw.eventSequence, '选择事件序号', 1, Number.MAX_SAFE_INTEGER),
      choiceKey,
      fromNodeKey,
      toNodeKey,
    }
  })
  const endingKey = value.endingKey == null ? null : String(value.endingKey).trim()
  if (endingKey != null && !keys.has(endingKey)) throw new Error('冻结叙事结局节点不存在。')
  const completedAtSequence = value.completedAtSequence == null
    ? null
    : assertFiniteInteger(value.completedAtSequence, '叙事完成事件序号', 0, Number.MAX_SAFE_INTEGER)
  if (value.completed !== (endingKey != null) || (value.completed && completedAtSequence == null)) {
    throw new Error('冻结叙事完成状态不一致。')
  }
  const lastEnteredNodeSequence = value.lastEnteredNodeSequence == null
    ? null
    : assertFiniteInteger(value.lastEnteredNodeSequence, '最后节点进入序号', 1, Number.MAX_SAFE_INTEGER)
  const evaluations = currentNodeKey == null || value.completed
    ? []
    : evaluateNarrativeChoices({
      ...common.variables,
      __visitedNodeKeys: common.visitedNodeKeys,
      __selectedChoiceKeys: choiceHistory.map(item => item.choiceKey),
    }, currentNodeKey, choices)
  const expectedVisible = evaluations.filter(choice => choice.visible).map(choice => choice.choiceKey)
  const expectedAvailable = evaluations.filter(choice => choice.available).map(choice => choice.choiceKey)
  if (JSON.stringify(visibleChoiceKeys) !== JSON.stringify(expectedVisible)
    || JSON.stringify(availableChoiceKeys) !== JSON.stringify(expectedAvailable)) {
    throw new Error('冻结叙事 Choice 投影与变量状态不一致。')
  }
  return {
    ...common,
    contentHash,
    beats,
    choices,
    visibleChoiceKeys,
    availableChoiceKeys,
    choiceHistory,
    endingKey,
    completedAtSequence,
    lastEnteredNodeSequence,
  }
}

export function enterFrozenNarrativeNode(
  narrative: SimulationNarrativeState,
  targetKey: string,
  options: {
    variables?: Record<string, unknown>
    eventSequence?: number
    selectedChoiceKey?: string
  } = {},
): SimulationNarrativeState {
  const target = narrative.nodes.find(node => node.key === targetKey)
  if (!target) throw new Error(`冻结叙事节点不存在: ${targetKey}`)
  const sourceVariables = options.variables ?? narrative.variables
  const predicateVariables = {
    ...sourceVariables,
    __visitedNodeKeys: narrative.visitedNodeKeys,
    __selectedChoiceKeys: [
      ...(narrative.choiceHistory ?? []).map(item => item.choiceKey),
      ...(options.selectedChoiceKey ? [options.selectedChoiceKey] : []),
    ],
  }
  if (!evaluateNarrativeCondition(parseNarrativeCondition(target.conditionJson), predicateVariables)) {
    throw new Error(`冻结叙事节点条件未满足: ${targetKey}`)
  }
  const variables = applyNarrativeEffects(parseNarrativeEffects(target.effectsJson), sourceVariables)
  const choiceVariables = {
    ...variables,
    __visitedNodeKeys: [...narrative.visitedNodeKeys, targetKey],
    __selectedChoiceKeys: predicateVariables.__selectedChoiceKeys,
  }
  const completed = target.kind === 'ending'
  const choiceEvaluations = narrative.version === 2 && !completed
    ? evaluateNarrativeChoices(choiceVariables, targetKey, narrative.choices ?? [])
    : []
  const availableNodeKeys = narrative.version === 2
    ? [...new Set(choiceEvaluations.filter(choice => choice.available).map(choice => choice.targetNodeKey))]
    : target.successorKeys.filter(key => {
      const node = narrative.nodes.find(candidate => candidate.key === key)!
      return evaluateNarrativeCondition(parseNarrativeCondition(node.conditionJson), variables)
    })
  return {
    ...narrative,
    currentNodeKey: targetKey,
    visitedNodeKeys: [...narrative.visitedNodeKeys, targetKey],
    availableNodeKeys,
    variables,
    completed,
    ...(narrative.version === 2 ? {
      visibleChoiceKeys: choiceEvaluations.filter(choice => choice.visible).map(choice => choice.choiceKey),
      availableChoiceKeys: choiceEvaluations.filter(choice => choice.available).map(choice => choice.choiceKey),
      endingKey: completed ? targetKey : null,
      completedAtSequence: completed ? options.eventSequence ?? null : null,
    } : {}),
  }
}

/**
 * Apply one choice with the exact same deterministic semantics used by the
 * persisted event reducer. Authoring preview reuses this helper but never
 * writes a session or an event.
 */
export function advanceFrozenNarrativeChoice(
  narrative: SimulationNarrativeState,
  choiceKey: string,
  eventSequence: number,
): SimulationNarrativeState {
  if (narrative.version !== 2 || narrative.completed || !narrative.currentNodeKey) {
    throw new Error('当前叙事没有可提交选择的内容。')
  }
  if (!narrative.availableChoiceKeys?.includes(choiceKey)) throw new Error('所选 Choice 当前不可用。')
  const choice = narrative.choices?.find(item => item.choiceKey === choiceKey)
  if (!choice || choice.sourceNodeKey !== narrative.currentNodeKey) throw new Error('所选 Choice 不属于当前节点。')
  const fromNodeKey = narrative.currentNodeKey
  const variables = applyNarrativeChoiceEffects(choice, narrative.variables)
  const entered = enterFrozenNarrativeNode(narrative, choice.targetNodeKey, {
    variables,
    eventSequence,
    selectedChoiceKey: choiceKey,
  })
  return {
    ...entered,
    choiceHistory: [
      ...(narrative.choiceHistory ?? []),
      { eventSequence, choiceKey, fromNodeKey, toNodeKey: choice.targetNodeKey },
    ],
  }
}

function assertRuntimeAttributes(value: unknown): RuntimeAttributes {
  if (!isObject(value)) throw new Error('运行时 attributes 必须是对象。')
  const result: RuntimeAttributes = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!key.trim() || key.length > 80) throw new Error('运行时属性键无效。')
    if (raw !== null && !['string', 'number', 'boolean'].includes(typeof raw)) {
      throw new Error(`运行时属性 ${key} 只能是标量。`)
    }
    if (typeof raw === 'number' && !Number.isFinite(raw)) {
      throw new Error(`运行时属性 ${key} 不是有限数字。`)
    }
    result[key] = raw as RuntimeAttributes[string]
  }
  return result
}

function assertRuntimeEntity(value: unknown): RuntimeEntityState {
  if (!isObject(value)) throw new Error('运行时实体必须是对象。')
  const entityKey = String(value.entityKey ?? '').trim()
  const name = String(value.name ?? '').trim()
  const kind = String(value.kind ?? '')
  const lifecycleStatus = String(value.lifecycleStatus ?? '')
  if (!entityKey || entityKey.length > 160) throw new Error('运行时实体缺少有效 entityKey。')
  if (!name || name.length > 200) throw new Error('运行时实体缺少有效名称。')
  if (!RUNTIME_ENTITY_KINDS.includes(kind as RuntimeEntityState['kind'])) {
    throw new Error(`未知运行时实体类型: ${kind}`)
  }
  if (!RUNTIME_LIFECYCLE_STATUSES.includes(lifecycleStatus as RuntimeEntityState['lifecycleStatus'])) {
    throw new Error(`未知运行时生命周期: ${lifecycleStatus}`)
  }
  const sourceId = value.sourceId == null
    ? null
    : assertFiniteInteger(value.sourceId, 'sourceId', 1, Number.MAX_SAFE_INTEGER)
  const locationKey = value.locationKey == null ? null : String(value.locationKey).trim() || null
  return {
    entityKey,
    kind: kind as RuntimeEntityState['kind'],
    sourceId,
    name,
    locationKey,
    lifecycleStatus: lifecycleStatus as RuntimeEntityState['lifecycleStatus'],
    attributes: assertRuntimeAttributes(value.attributes ?? {}),
  }
}

function assertRuntimeMemory(value: unknown): RuntimeMemory {
  if (!isObject(value)) throw new Error('运行时记忆必须是对象。')
  const id = String(value.id ?? '').trim()
  const subjectKey = String(value.subjectKey ?? '').trim()
  const content = String(value.content ?? '').trim()
  const status = String(value.status ?? '')
  if (!id || id.length > 160) throw new Error('运行时记忆缺少有效 id。')
  if (!subjectKey || subjectKey.length > 160) throw new Error('运行时记忆缺少主体。')
  if (!content || content.length > 4_000) throw new Error('运行时记忆内容无效。')
  if (!['known', 'mistaken', 'forgotten'].includes(status)) {
    throw new Error(`未知运行时记忆状态: ${status}`)
  }
  return {
    id,
    subjectKey,
    content,
    status: status as RuntimeMemory['status'],
    sourceEventSequence: assertFiniteInteger(
      value.sourceEventSequence,
      'sourceEventSequence',
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  }
}

export function isNpcRuntimeEntity(entity: RuntimeEntityState): boolean {
  return entity.kind === 'npc'
    || (entity.kind === 'character' && (
      entity.attributes.role === 'npc'
      || entity.attributes.roleWeight === 'npc'
    ))
}

export function parseSimulationNpcEvolutionCandidate(
  value: unknown,
): SimulationNpcEvolutionCandidate {
  if (!isObject(value)) throw new Error('NPC 演进候选必须是对象。')
  const allowed = new Set([
    'baseSequence',
    'entityKey',
    'locationKey',
    'lifecycleStatus',
    'attributes',
    'narrative',
    'memory',
    'rationale',
  ])
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (unknown.length) throw new Error(`NPC 演进候选包含未知字段: ${unknown.join(', ')}`)
  const entityKey = String(value.entityKey ?? '').trim()
  if (!entityKey || entityKey.length > 160) throw new Error('NPC 演进候选缺少有效实体。')
  const rawLocationKey = value.locationKey
  if (rawLocationKey != null && typeof rawLocationKey !== 'string') {
    throw new Error('NPC 演进地点必须是稳定实体键或 null。')
  }
  const locationKey = typeof rawLocationKey === 'string'
    ? rawLocationKey.trim() || null
    : null
  const lifecycleStatus = String(value.lifecycleStatus ?? '')
  if (!RUNTIME_LIFECYCLE_STATUSES.includes(lifecycleStatus as RuntimeEntityState['lifecycleStatus'])) {
    throw new Error(`未知 NPC 生命周期状态: ${lifecycleStatus}`)
  }
  const narrative = String(value.narrative ?? '').trim()
  if (narrative.length > 20_000) throw new Error('NPC 演进叙事过长。')
  const rationale = String(value.rationale ?? '').trim()
  if (rationale.length > 4_000) throw new Error('NPC 演进理由过长。')
  let memory: SimulationNpcEvolutionCandidate['memory'] = null
  if (value.memory != null) {
    if (!isObject(value.memory)) throw new Error('NPC 演进记忆必须是对象或 null。')
    const status = String(value.memory.status ?? '')
    const content = String(value.memory.content ?? '').trim()
    if (!['known', 'mistaken', 'forgotten'].includes(status)) {
      throw new Error(`未知 NPC 记忆状态: ${status}`)
    }
    if (!content || content.length > 4_000) throw new Error('NPC 演进记忆内容无效。')
    memory = { status: status as RuntimeMemory['status'], content }
  }
  return {
    baseSequence: assertFiniteInteger(
      value.baseSequence,
      'NPC 演进基线序号',
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    entityKey,
    locationKey,
    lifecycleStatus: lifecycleStatus as RuntimeEntityState['lifecycleStatus'],
    attributes: assertRuntimeAttributes(value.attributes ?? {}),
    narrative,
    memory,
    rationale,
  }
}

function prepareNpcEvolution(
  state: SimulationRuntimeState,
  candidate: SimulationNpcEvolutionCandidate,
): RuntimeEntityState {
  const existing = state.entities[candidate.entityKey]
  if (!existing) throw new Error(`要演进的运行时实体不存在: ${candidate.entityKey}`)
  if (!isNpcRuntimeEntity(existing)) throw new Error('只有运行时 NPC 可以进入演进候选。')
  if (candidate.locationKey != null) {
    const location = state.entities[candidate.locationKey]
    if (!location || location.kind !== 'location') {
      throw new Error(`NPC 演进目标地点不存在: ${candidate.locationKey}`)
    }
  }
  const next = assertRuntimeEntity({
    ...existing,
    locationKey: candidate.locationKey,
    lifecycleStatus: candidate.lifecycleStatus,
    attributes: { ...existing.attributes, ...candidate.attributes },
  })
  const attributesChanged = Object.entries(candidate.attributes)
    .some(([key, child]) => existing.attributes[key] !== child)
  if (
    next.locationKey === existing.locationKey
    && next.lifecycleStatus === existing.lifecycleStatus
    && !attributesChanged
    && !candidate.narrative
    && !candidate.memory
  ) throw new Error('NPC 演进候选没有任何状态或经历变化。')
  return next
}

function applyNpcEvolution(
  state: SimulationRuntimeState,
  candidate: SimulationNpcEvolutionCandidate,
  eventSequence: number,
): void {
  state.entities[candidate.entityKey] = prepareNpcEvolution(state, candidate)
  if (candidate.narrative) {
    state.narratives.push({ eventSequence, text: candidate.narrative })
  }
  if (candidate.memory) {
    state.memories.push({
      id: `npc-evolution:${eventSequence}:${candidate.entityKey}`,
      subjectKey: candidate.entityKey,
      status: candidate.memory.status,
      content: candidate.memory.content,
      sourceEventSequence: eventSequence,
    })
  }
}

function assertTtrpgScene(value: unknown): SimulationTtrpgScene {
  if (!isObject(value)) throw new Error('跑团场景必须是对象。')
  const sceneId = String(value.sceneId ?? '').trim()
  const title = String(value.title ?? '').trim()
  const description = String(value.description ?? '').trim()
  const locationKey = value.locationKey == null ? null : String(value.locationKey).trim() || null
  const status = String(value.status ?? 'active')
  if (!sceneId || sceneId.length > 160) throw new Error('跑团场景缺少有效 ID。')
  if (!title || title.length > 200) throw new Error('跑团场景标题无效。')
  if (description.length > 8_000) throw new Error('跑团场景描述过长。')
  if (status !== 'active' && status !== 'resolved') throw new Error('跑团场景状态无效。')
  return { sceneId, title, description, locationKey, status: status as SimulationTtrpgScene['status'] }
}

function assertTtrpgAction(value: unknown): SimulationTtrpgAction {
  if (!isObject(value)) throw new Error('跑团动作必须是对象。')
  const eventSequence = assertFiniteInteger(value.eventSequence, '跑团动作事件序号', 1, Number.MAX_SAFE_INTEGER)
  const actorKey = String(value.actorKey ?? '').trim()
  const text = String(value.text ?? '').trim()
  if (!actorKey || actorKey.length > 160) throw new Error('跑团动作缺少行动者。')
  if (!text || text.length > 4_000) throw new Error('跑团动作文本无效。')
  return { eventSequence, actorKey, text }
}

function assertTtrpgCheck(value: unknown): SimulationTtrpgCheck {
  if (!isObject(value)) throw new Error('跑团检定必须是对象。')
  const eventSequence = assertFiniteInteger(value.eventSequence, '跑团检定事件序号', 1, Number.MAX_SAFE_INTEGER)
  const actorKey = String(value.actorKey ?? '').trim()
  const skill = String(value.skill ?? '').trim()
  const expression = String(value.expression ?? '').trim()
  const dc = assertFiniteInteger(value.dc, '检定难度', 0, 1_000)
  const dice = value.dice
  if (!actorKey || actorKey.length > 160) throw new Error('跑团检定缺少行动者。')
  if (!skill || skill.length > 120) throw new Error('跑团检定技能无效。')
  if (!Array.isArray(dice)) throw new Error('跑团检定缺少骰子结果。')
  const parsed = parseDiceExpression(expression)
  if (dice.length !== parsed.count) throw new Error('跑团检定骰子数量与骰式不一致。')
  const normalizedDice = dice.map(die => assertFiniteInteger(die, '检定骰子点数', 1, parsed.sides))
  const modifier = Number(value.modifier)
  const total = Number(value.total)
  const success = value.success
  if (modifier !== parsed.modifier || total !== normalizedDice.reduce((sum, die) => sum + die, modifier)) {
    throw new Error('跑团检定合计与骰式不一致。')
  }
  if (success !== (total >= dc)) throw new Error('跑团检定成功状态与合计不一致。')
  return {
    eventSequence,
    actorKey,
    skill,
    expression: parsed.normalized,
    dice: normalizedDice,
    modifier,
    total,
    dc,
    success: Boolean(success),
  }
}

function assertTtrpgResource(value: unknown): SimulationTtrpgResource {
  if (!isObject(value)) throw new Error('跑团资源必须是对象。')
  const current = assertFiniteInteger(value.current, '资源当前值', 0, 1_000_000_000)
  const maximum = assertFiniteInteger(value.maximum, '资源上限', 1, 1_000_000_000)
  if (current > maximum) throw new Error('资源当前值不能超过上限。')
  return { current, maximum }
}

function assertTtrpgCondition(value: unknown): SimulationTtrpgCondition {
  if (!isObject(value)) throw new Error('跑团状态效果必须是对象。')
  const conditionId = String(value.conditionId ?? '').trim()
  const name = String(value.name ?? '').trim()
  const description = String(value.description ?? '').trim()
  const duration = value.duration == null
    ? null
    : assertFiniteInteger(value.duration, '状态效果持续回合', 0, 1_000_000)
  const stacks = assertFiniteInteger(value.stacks ?? 1, '状态效果层数', 1, 1_000)
  if (!conditionId || conditionId.length > 160) throw new Error('状态效果缺少有效 ID。')
  if (!name || name.length > 120) throw new Error('状态效果名称无效。')
  if (description.length > 2_000) throw new Error('状态效果描述过长。')
  return { conditionId, name, description, duration, stacks }
}

function assertTtrpgCombatant(value: unknown): SimulationTtrpgCombatant {
  if (!isObject(value)) throw new Error('战斗参与者必须是对象。')
  const entityKey = String(value.entityKey ?? '').trim()
  const initiative = assertFiniteInteger(value.initiative, '先攻值', 0, 1_000)
  const armorClass = assertFiniteInteger(value.armorClass, '护甲等级', 0, 1_000)
  if (!entityKey || entityKey.length > 160) throw new Error('战斗参与者缺少实体键。')
  if (!isObject(value.resources)) throw new Error('战斗资源必须是对象。')
  const resources: Record<string, SimulationTtrpgResource> = {}
  for (const [key, resource] of Object.entries(value.resources)) {
    if (!key.trim() || key.length > 80) throw new Error('战斗资源键无效。')
    resources[key] = assertTtrpgResource(resource)
  }
  if (!resources.hp) throw new Error('战斗参与者必须拥有 hp 资源。')
  if (!Array.isArray(value.conditions)) throw new Error('战斗状态效果必须是数组。')
  const conditions = value.conditions.map(assertTtrpgCondition)
  if (new Set(conditions.map(condition => condition.conditionId)).size !== conditions.length) {
    throw new Error('战斗状态效果不能重复。')
  }
  return { entityKey, initiative, armorClass, resources, conditions }
}

function assertTtrpgEncounter(value: unknown): SimulationTtrpgEncounter {
  if (!isObject(value)) throw new Error('跑团遭遇必须是对象。')
  const encounterId = String(value.encounterId ?? '').trim()
  const title = String(value.title ?? '').trim()
  const description = String(value.description ?? '').trim()
  const status = String(value.status ?? 'active')
  const round = assertFiniteInteger(value.round, '战斗回合', 1, Number.MAX_SAFE_INTEGER)
  const activeActorKey = value.activeActorKey == null ? null : String(value.activeActorKey).trim() || null
  if (!encounterId || encounterId.length > 160) throw new Error('遭遇缺少有效 ID。')
  if (!title || title.length > 200) throw new Error('遭遇标题无效。')
  if (description.length > 8_000) throw new Error('遭遇描述过长。')
  if (status !== 'active' && status !== 'resolved') throw new Error('遭遇状态无效。')
  if (!Array.isArray(value.turnOrder) || value.turnOrder.length === 0) throw new Error('遭遇必须有回合顺序。')
  const turnOrder = value.turnOrder.map(raw => String(raw).trim())
  if (turnOrder.some(key => !key || key.length > 160) || new Set(turnOrder).size !== turnOrder.length) {
    throw new Error('遭遇回合顺序包含无效或重复参与者。')
  }
  if (activeActorKey != null && !turnOrder.includes(activeActorKey)) throw new Error('遭遇当前行动者不在回合顺序中。')
  if (!isObject(value.combatants)) throw new Error('遭遇缺少战斗参与者。')
  const combatants: Record<string, SimulationTtrpgCombatant> = {}
  for (const [key, raw] of Object.entries(value.combatants)) {
    const combatant = assertTtrpgCombatant(raw)
    if (combatant.entityKey !== key) throw new Error(`遭遇参与者索引与实体键不一致: ${key}`)
    combatants[key] = combatant
  }
  if (turnOrder.some(key => !combatants[key]) || Object.keys(combatants).some(key => !turnOrder.includes(key))) {
    throw new Error('遭遇回合顺序与参与者不一致。')
  }
  return { encounterId, title, description, status: status as SimulationTtrpgEncounter['status'], round, activeActorKey, turnOrder, combatants }
}

function assertTtrpgAttackResult(value: unknown): SimulationTtrpgAttackResult {
  if (!isObject(value)) throw new Error('攻击结果必须是对象。')
  const actorKey = String(value.actorKey ?? '').trim()
  const targetKey = String(value.targetKey ?? '').trim()
  const attackExpression = String(value.attackExpression ?? '').trim()
  const damageExpression = value.damageExpression == null ? null : String(value.damageExpression).trim() || null
  const resourceKey = String(value.resourceKey ?? 'hp').trim()
  const reason = String(value.reason ?? '').trim()
  if (!actorKey || !targetKey || actorKey.length > 160 || targetKey.length > 160) throw new Error('攻击缺少有效行动者或目标。')
  const attack = parseDiceExpression(attackExpression)
  const attackDice = value.attackDice
  if (!Array.isArray(attackDice) || attackDice.length !== attack.count) throw new Error('攻击骰子数量与骰式不一致。')
  const normalizedAttackDice = attackDice.map(die => assertFiniteInteger(die, '攻击骰子点数', 1, attack.sides))
  const attackModifier = Number(value.attackModifier)
  const attackTotal = Number(value.attackTotal)
  const armorClass = assertFiniteInteger(value.armorClass, '护甲等级', 0, 1_000)
  const hit = value.hit
  if (attackModifier !== attack.modifier || attackTotal !== normalizedAttackDice.reduce((sum, die) => sum + die, attackModifier)) {
    throw new Error('攻击合计与骰式不一致。')
  }
  if (hit !== (attackTotal >= armorClass)) throw new Error('攻击命中状态与合计不一致。')
  let normalizedDamageExpression: string | null = null
  let damageDice: number[] = []
  let damageModifier = 0
  const damageTotal = Number(value.damageTotal ?? 0)
  if (damageExpression) {
    const damage = parseDiceExpression(damageExpression)
    if (!Array.isArray(value.damageDice) || value.damageDice.length !== damage.count) throw new Error('伤害骰子数量与骰式不一致。')
    damageDice = value.damageDice.map(die => assertFiniteInteger(die, '伤害骰子点数', 1, damage.sides))
    damageModifier = Number(value.damageModifier)
    if (damageModifier !== damage.modifier || damageTotal !== damageDice.reduce((sum, die) => sum + die, damageModifier)) {
      throw new Error('伤害合计与骰式不一致。')
    }
    if (damageTotal < 0) throw new Error('伤害合计不能为负数。')
    normalizedDamageExpression = damage.normalized
  } else if (damageTotal !== 0 || (Array.isArray(value.damageDice) && value.damageDice.length > 0)) {
    throw new Error('没有伤害骰式时不能提交伤害结果。')
  }
  const resourceDelta = assertFiniteInteger(value.resourceDelta, '资源变化量', -1_000_000_000, 1_000_000_000)
  if (!hit && (damageTotal !== 0 || resourceDelta !== 0)) throw new Error('未命中攻击不能造成伤害。')
  if (hit && resourceDelta !== -damageTotal) throw new Error('攻击资源变化必须等于伤害负值。')
  if (!resourceKey || resourceKey.length > 80) throw new Error('攻击资源键无效。')
  if (reason.length > 2_000) throw new Error('攻击理由过长。')
  return { actorKey, targetKey, attackExpression: attack.normalized, attackDice: normalizedAttackDice, attackModifier, attackTotal, armorClass, hit: Boolean(hit), damageExpression: normalizedDamageExpression, damageDice, damageModifier, damageTotal, resourceKey, resourceDelta, reason }
}

function emptyTtrpgState(): SimulationTtrpgState {
  return {
    scene: null,
    round: 0,
    activeActorKey: null,
    turnOrder: [],
    actions: [],
    checks: [],
    attacks: [],
    encounter: null,
    campaign: emptyTtrpgCampaignState(),
  }
}

function parseTtrpgState(value: unknown): SimulationTtrpgState | null {
  if (value == null) return null
  if (!isObject(value)) throw new Error('跑团状态必须是对象或 null。')
  const scene = value.scene == null ? null : assertTtrpgScene(value.scene)
  const round = assertFiniteInteger(value.round, '跑团回合', 0, Number.MAX_SAFE_INTEGER)
  const activeActorKey = value.activeActorKey == null ? null : String(value.activeActorKey).trim() || null
  if (!Array.isArray(value.turnOrder)) throw new Error('跑团回合顺序必须是数组。')
  const turnOrder = value.turnOrder.map(raw => String(raw).trim())
  if (turnOrder.some(key => !key || key.length > 160) || new Set(turnOrder).size !== turnOrder.length) {
    throw new Error('跑团回合顺序包含无效或重复行动者。')
  }
  if (activeActorKey != null && !turnOrder.includes(activeActorKey)) throw new Error('跑团当前行动者不在回合顺序中。')
  if (!Array.isArray(value.actions) || !Array.isArray(value.checks)) throw new Error('跑团动作与检定记录必须是数组。')
  if (value.attacks != null && !Array.isArray(value.attacks)) throw new Error('跑团攻击记录必须是数组。')
  return {
    scene,
    round,
    activeActorKey,
    turnOrder,
    actions: value.actions.map(assertTtrpgAction),
    checks: value.checks.map(assertTtrpgCheck),
    attacks: (value.attacks ?? []).map(assertTtrpgAttackResult),
    encounter: value.encounter == null ? null : assertTtrpgEncounter(value.encounter),
    campaign: parseTtrpgCampaignState(value.campaign),
  }
}

function emptyTtrpgCampaignState(): SimulationTtrpgCampaignState {
  return { summary: '', quests: [], npcSchedules: [] }
}

function assertTtrpgQuest(value: unknown): SimulationTtrpgQuest {
  if (!isObject(value)) throw new Error('战役任务必须是对象。')
  const questId = String(value.questId ?? '').trim()
  const title = String(value.title ?? '').trim()
  const description = String(value.description ?? '').trim()
  const status = String(value.status ?? '') as SimulationTtrpgQuestStatus
  if (!questId || questId.length > 160) throw new Error('战役任务 ID 无效。')
  if (!title || title.length > 240) throw new Error('战役任务标题无效。')
  if (description.length > 8_000) throw new Error('战役任务描述过长。')
  if (!SIMULATION_TTRPG_QUEST_STATUSES.includes(status)) throw new Error(`未知战役任务状态: ${status}`)
  const dueClock = value.dueClock == null ? null : assertFiniteInteger(value.dueClock, '任务期限', 0, Number.MAX_SAFE_INTEGER)
  return {
    questId,
    title,
    description,
    status,
    priority: assertFiniteInteger(value.priority ?? 0, '任务优先级', 0, 5),
    dueClock,
    updatedSequence: assertFiniteInteger(value.updatedSequence, '任务更新时间序号', 1, Number.MAX_SAFE_INTEGER),
  }
}

function assertTtrpgNpcSchedule(value: unknown): SimulationTtrpgNpcSchedule {
  if (!isObject(value)) throw new Error('NPC 日程必须是对象。')
  const scheduleId = String(value.scheduleId ?? '').trim()
  const entityKey = String(value.entityKey ?? '').trim()
  const activity = String(value.activity ?? '').trim()
  const recurrence = String(value.recurrence ?? 'once')
  if (!scheduleId || scheduleId.length > 160) throw new Error('NPC 日程 ID 无效。')
  if (!entityKey || entityKey.length > 160) throw new Error('NPC 日程缺少 NPC。')
  if (!activity || activity.length > 2_000) throw new Error('NPC 日程活动无效。')
  if (!['once', 'daily', 'weekly'].includes(recurrence)) throw new Error(`未知 NPC 日程重复方式: ${recurrence}`)
  const startClock = assertFiniteInteger(value.startClock, 'NPC 日程开始时间', 0, Number.MAX_SAFE_INTEGER)
  const endClock = value.endClock == null ? null : assertFiniteInteger(value.endClock, 'NPC 日程结束时间', startClock, Number.MAX_SAFE_INTEGER)
  const locationKey = value.locationKey == null ? null : String(value.locationKey).trim() || null
  return {
    scheduleId,
    entityKey,
    startClock,
    endClock,
    locationKey,
    activity,
    recurrence: recurrence as SimulationTtrpgNpcSchedule['recurrence'],
    updatedSequence: assertFiniteInteger(value.updatedSequence, '日程更新时间序号', 1, Number.MAX_SAFE_INTEGER),
  }
}

function parseTtrpgCampaignState(value: unknown): SimulationTtrpgCampaignState {
  if (value == null) return emptyTtrpgCampaignState()
  if (!isObject(value)) throw new Error('长期战役状态必须是对象。')
  const summary = String(value.summary ?? '').trim()
  if (summary.length > 20_000) throw new Error('长期战役摘要过长。')
  if (!Array.isArray(value.quests) || !Array.isArray(value.npcSchedules)) {
    throw new Error('长期战役任务和 NPC 日程必须是数组。')
  }
  const quests = value.quests.map(assertTtrpgQuest)
  const npcSchedules = value.npcSchedules.map(assertTtrpgNpcSchedule)
  if (new Set(quests.map(quest => quest.questId)).size !== quests.length) throw new Error('战役任务 ID 不能重复。')
  if (new Set(npcSchedules.map(schedule => schedule.scheduleId)).size !== npcSchedules.length) throw new Error('NPC 日程 ID 不能重复。')
  return { summary, quests, npcSchedules }
}

function assertChatIdentity(value: unknown): SimulationChatIdentity {
  if (!isObject(value)) throw new Error('聊天用户身份必须是对象。')
  const name = String(value.name ?? '').trim()
  const description = String(value.description ?? '').trim()
  if (!name || name.length > 160) throw new Error('聊天用户身份名称无效。')
  if (description.length > 2_000) throw new Error('聊天用户身份描述过长。')
  return { name, description }
}

function assertChatScene(value: unknown): SimulationChatScene {
  if (!isObject(value)) throw new Error('聊天场景必须是对象。')
  const title = String(value.title ?? '').trim()
  const description = String(value.description ?? '').trim()
  if (!title || title.length > 200) throw new Error('聊天场景标题无效。')
  if (description.length > 8_000) throw new Error('聊天场景描述过长。')
  return { title, description }
}

function assertChatMessage(value: unknown): SimulationChatMessage {
  if (!isObject(value)) throw new Error('聊天消息必须是对象。')
  const messageId = String(value.messageId ?? '').trim()
  const eventSequence = assertFiniteInteger(value.eventSequence, '聊天消息事件序号', 1, Number.MAX_SAFE_INTEGER)
  const role = String(value.role ?? '')
  const speakerKey = value.speakerKey == null ? null : String(value.speakerKey).trim() || null
  const text = String(value.text ?? '').trim()
  const replyToSequence = value.replyToSequence == null
    ? null
    : assertFiniteInteger(value.replyToSequence, '聊天回复目标序号', 1, Number.MAX_SAFE_INTEGER)
  const supersededBySequence = value.supersededBySequence == null
    ? null
    : assertFiniteInteger(value.supersededBySequence, '聊天替代序号', 1, Number.MAX_SAFE_INTEGER)
  if (!messageId || messageId.length > 160) throw new Error('聊天消息 ID 无效。')
  if (role !== 'user' && role !== 'character') throw new Error('聊天消息角色无效。')
  if (role === 'user' && speakerKey != null) throw new Error('用户消息不能绑定角色实体。')
  if (role === 'character' && !speakerKey) throw new Error('角色回复缺少角色实体。')
  if (!text || text.length > 20_000) throw new Error('聊天消息文本无效。')
  if (role === 'user' && replyToSequence != null) throw new Error('用户消息不能引用回复目标。')
  if (role === 'character' && replyToSequence == null) throw new Error('角色回复必须引用用户消息。')
  return { messageId, eventSequence, role: role as SimulationChatMessage['role'], speakerKey, text, replyToSequence, supersededBySequence }
}

function parseChatState(value: unknown): SimulationChatState | null {
  if (value == null) return null
  if (!isObject(value)) throw new Error('角色聊天状态必须是对象。')
  const characterKey = String(value.characterKey ?? '').trim()
  if (!characterKey || characterKey.length > 160) throw new Error('角色聊天缺少有效角色。')
  const identity = assertChatIdentity(value.identity)
  const scene = assertChatScene(value.scene)
  if (!Array.isArray(value.messages)) throw new Error('角色聊天消息必须是数组。')
  const messages = value.messages.map(assertChatMessage)
  if (new Set(messages.map(message => message.messageId)).size !== messages.length) {
    throw new Error('角色聊天消息 ID 不能重复。')
  }
  return { characterKey, identity, scene, messages }
}

function requireChatState(state: SimulationRuntimeState): SimulationChatState {
  if (!state.chat) throw new Error('角色聊天尚未配置。')
  return state.chat
}

function requireTtrpgState(state: SimulationRuntimeState): SimulationTtrpgState {
  if (!state.ttrpg) state.ttrpg = emptyTtrpgState()
  return state.ttrpg
}

export function parseSimulationTtrpgTurnCandidate(value: unknown): SimulationTtrpgTurnCandidate {
  if (!isObject(value)) throw new Error('跑团回合候选必须是对象。')
  const allowed = new Set(['baseSequence', 'actorKey', 'action', 'narrative', 'check', 'outcomes', 'nextActorKey'])
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (unknown.length) throw new Error(`跑团回合候选包含未知字段: ${unknown.join(', ')}`)
  const baseSequence = assertFiniteInteger(value.baseSequence, '跑团候选基线序号', 0, Number.MAX_SAFE_INTEGER)
  const actorKey = String(value.actorKey ?? '').trim()
  const action = String(value.action ?? '').trim()
  const narrative = String(value.narrative ?? '').trim()
  const nextActorKey = value.nextActorKey == null ? null : String(value.nextActorKey).trim() || null
  if (!actorKey || actorKey.length > 160) throw new Error('跑团候选缺少行动者。')
  if (!action || action.length > 4_000) throw new Error('跑团候选动作无效。')
  if (!narrative || narrative.length > 20_000) throw new Error('跑团候选叙事无效。')
  let check: SimulationTtrpgCheckRequest | null = null
  if (value.check != null) {
    if (!isObject(value.check)) throw new Error('跑团检定候选必须是对象或 null。')
    const skill = String(value.check.skill ?? '').trim()
    const expression = String(value.check.expression ?? '').trim()
    const reason = String(value.check.reason ?? '').trim()
    const dc = assertFiniteInteger(value.check.dc, '检定难度', 0, 1_000)
    parseDiceExpression(expression)
    if (!skill || skill.length > 120) throw new Error('跑团候选技能无效。')
    if (!reason || reason.length > 1_000) throw new Error('跑团候选检定理由无效。')
    check = { skill, expression, dc, reason }
  }
  let outcomes: SimulationTtrpgTurnCandidate['outcomes'] = null
  if (value.outcomes != null) {
    if (!isObject(value.outcomes)) throw new Error('跑团检定分支叙事必须是对象或 null。')
    const success = String(value.outcomes.success ?? '').trim()
    const failure = String(value.outcomes.failure ?? '').trim()
    if (!success || !failure || success.length > 20_000 || failure.length > 20_000) {
      throw new Error('跑团检定成功/失败叙事无效。')
    }
    outcomes = { success, failure }
  }
  if ((check == null) !== (outcomes == null)) throw new Error('跑团检定与成功/失败叙事必须同时提供。')
  return { baseSequence, actorKey, action, narrative, check, outcomes, nextActorKey }
}

export function parseSimulationState(value: string | SimulationRuntimeState): SimulationRuntimeState {
  const parsed = typeof value === 'string' ? parseJsonObject(value, '运行时状态') : value
  if (parsed.version !== 1) throw new Error('不支持的运行时状态版本。')
  const clock = assertFiniteInteger(parsed.clock, '运行时时钟', 0, Number.MAX_SAFE_INTEGER)
  const lastSequence = assertFiniteInteger(
    parsed.lastSequence,
    'lastSequence',
    0,
    Number.MAX_SAFE_INTEGER,
  )
  if (!isObject(parsed.entities)) throw new Error('运行时 entities 必须是对象。')
  const entities: Record<string, RuntimeEntityState> = {}
  for (const [key, raw] of Object.entries(parsed.entities)) {
    const entity = assertRuntimeEntity(raw)
    if (entity.entityKey !== key) throw new Error(`实体索引与 entityKey 不一致: ${key}`)
    entities[key] = entity
  }
  if (!Array.isArray(parsed.memories)) throw new Error('运行时 memories 必须是数组。')
  if (!Array.isArray(parsed.narratives)) throw new Error('运行时 narratives 必须是数组。')
  const memories = parsed.memories.map(assertRuntimeMemory)
  const narratives = parsed.narratives.map(raw => {
    if (!isObject(raw)) throw new Error('运行时叙事记录必须是对象。')
    const text = String(raw.text ?? '').trim()
    if (!text || text.length > 20_000) throw new Error('运行时叙事文本无效。')
    return {
      eventSequence: assertFiniteInteger(
        raw.eventSequence,
        'narrative.eventSequence',
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      text,
    }
  })
  return {
    version: 1,
    clock,
    entities,
    memories,
    narratives,
    ttrpg: parseTtrpgState(parsed.ttrpg),
    chat: parseChatState(parsed.chat),
    interaction: parseInteractionState(parsed.interaction),
    narrative: parseSimulationNarrativeState(parsed.narrative),
    adventure: parseAdventureState(parsed.adventure),
    presentation: parseAvgPresentationState(parsed.presentation),
    narrativeSimulation: parseNarrativeSimulationState(parsed.narrativeSimulation),
    openWorld: parseOpenWorldState(parsed.openWorld),
    lastSequence,
  }
}

function cloneState(state: SimulationRuntimeState): SimulationRuntimeState {
  return structuredClone(state)
}

function parseEventPayload(event: SimulationEvent): JsonObject {
  if (!SIMULATION_EVENT_TYPES.includes(event.type)) {
    throw new Error(`未知模拟事件类型: ${event.type}`)
  }
  return parseJsonObject(event.payloadJson, `模拟事件 ${event.type}`)
}

export function applySimulationEvent(
  current: SimulationRuntimeState,
  event: SimulationEvent,
): SimulationRuntimeState {
  const state = cloneState(parseSimulationState(current))
  if (event.sequence !== state.lastSequence + 1) {
    throw new Error(`模拟事件序号不连续: 期望 ${state.lastSequence + 1}，收到 ${event.sequence}`)
  }
  const payload = parseEventPayload(event)
  if (event.type.startsWith('world.')) {
    state.openWorld = applyOpenWorldEvent(state.openWorld ?? null, event)
    if (event.type === 'world.narrative.synced') {
      if (!state.openWorld || !state.narrative || state.narrative.version !== 2 || !isObject(payload.projection)) {
        throw new Error('[textworld] Narrative 同步需要正式开放世界与冻结叙事状态。')
      }
      const expected = openWorldMainlineProjection(state.openWorld, state.openWorld.mainlineQuestKeys)
      if (stableJson(payload.projection) !== stableJson(expected)) {
        throw new Error('[textworld] Narrative 投影与开放世界状态不一致。')
      }
      state.narrative.variables = { ...state.narrative.variables, openWorld: structuredClone(expected) }
      if (!state.narrative.completed && state.narrative.currentNodeKey) {
        const evaluations = evaluateNarrativeChoices({
          ...state.narrative.variables,
          __visitedNodeKeys: state.narrative.visitedNodeKeys,
          __selectedChoiceKeys: (state.narrative.choiceHistory ?? []).map(item => item.choiceKey),
        }, state.narrative.currentNodeKey, state.narrative.choices ?? [])
        state.narrative.visibleChoiceKeys = evaluations.filter(item => item.visible).map(item => item.choiceKey)
        state.narrative.availableChoiceKeys = evaluations.filter(item => item.available).map(item => item.choiceKey)
        state.narrative.availableNodeKeys = [...new Set(evaluations.filter(item => item.available).map(item => item.targetNodeKey))]
      }
    }
    state.lastSequence = event.sequence
    return state
  }
  if (event.type.startsWith('simulation.')) {
    state.narrativeSimulation = applyNarrativeSimulationEvent(state.narrativeSimulation ?? null, event)
    if (event.type === 'simulation.narrative.synced') {
      if (!state.narrative || state.narrative.version !== 2 || !isObject(payload.projection)) {
        throw new Error('[textsim] Narrative 同步需要正式模拟与冻结叙事状态。')
      }
      const expected = narrativeSimulationProjection(state.narrativeSimulation)
      if (stableJson(payload.projection) !== stableJson(expected)) {
        throw new Error('[textsim] Narrative 投影与模拟状态不一致。')
      }
      state.narrative.variables = { ...state.narrative.variables, simulation: structuredClone(expected) }
      if (!state.narrative.completed && state.narrative.currentNodeKey) {
        const evaluations = evaluateNarrativeChoices({
          ...state.narrative.variables,
          __visitedNodeKeys: state.narrative.visitedNodeKeys,
          __selectedChoiceKeys: (state.narrative.choiceHistory ?? []).map(item => item.choiceKey),
        }, state.narrative.currentNodeKey, state.narrative.choices ?? [])
        state.narrative.visibleChoiceKeys = evaluations.filter(item => item.visible).map(item => item.choiceKey)
        state.narrative.availableChoiceKeys = evaluations.filter(item => item.available).map(item => item.choiceKey)
        state.narrative.availableNodeKeys = [...new Set(evaluations.filter(item => item.available).map(item => item.targetNodeKey))]
      }
    }
    state.lastSequence = event.sequence
    return state
  }
  if (event.type.startsWith('presentation.')) {
    state.presentation = applyAvgPresentationEvent(
      state.presentation ?? null,
      event,
      state.narrative?.currentNodeKey ?? null,
      state.narrative?.beats ?? [],
    )
    state.lastSequence = event.sequence
    return state
  }
  if (event.type.startsWith('interaction.')) {
    state.interaction = applyInteractionEvent(state.interaction ?? null, event)
    state.lastSequence = event.sequence
    return state
  }
  if (event.type === 'adventure.narrative.synced') {
    if (!state.adventure || !state.narrative || state.narrative.version !== 2) {
      throw new Error('[adventure] Narrative 同步需要正式冒险与冻结叙事状态。')
    }
    if (!isObject(payload.projection)) throw new Error('[adventure] Narrative 投影无效。')
    const expected = adventureNarrativeProjection(state.adventure)
    if (stableJson(payload.projection) !== stableJson(expected)) {
      throw new Error('[adventure] Narrative 投影与冒险状态不一致。')
    }
    state.narrative.variables = {
      ...state.narrative.variables,
      adventure: structuredClone(expected),
      ...(state.openWorld ? {
        openWorld: openWorldMainlineProjection(state.openWorld, state.openWorld.mainlineQuestKeys),
      } : {}),
    }
    if (!state.narrative.completed && state.narrative.currentNodeKey) {
      const evaluations = evaluateNarrativeChoices({
        ...state.narrative.variables,
        __visitedNodeKeys: state.narrative.visitedNodeKeys,
        __selectedChoiceKeys: (state.narrative.choiceHistory ?? []).map(item => item.choiceKey),
      }, state.narrative.currentNodeKey, state.narrative.choices ?? [])
      state.narrative.visibleChoiceKeys = evaluations.filter(item => item.visible).map(item => item.choiceKey)
      state.narrative.availableChoiceKeys = evaluations.filter(item => item.available).map(item => item.choiceKey)
      state.narrative.availableNodeKeys = [...new Set(
        evaluations.filter(item => item.available).map(item => item.targetNodeKey),
      )]
    }
    state.lastSequence = event.sequence
    return state
  }
  if (event.type.startsWith('adventure.')) {
    state.adventure = applyAdventureEvent(state.adventure ?? null, event)
    if (state.openWorld) state.openWorld = applyOpenWorldEvent(state.openWorld, event)
    state.lastSequence = event.sequence
    return state
  }
  switch (event.type) {
    case 'time.advanced': {
      const amount = assertFiniteInteger(payload.amount, '时间推进量', 1, 1_000_000_000)
      if (state.clock + amount > Number.MAX_SAFE_INTEGER) throw new Error('运行时时钟溢出。')
      state.clock += amount
      break
    }
    case 'entity.upserted': {
      const entity = assertRuntimeEntity(payload.entity)
      state.entities[entity.entityKey] = entity
      break
    }
    case 'entity.patched': {
      const entityKey = String(payload.entityKey ?? '').trim()
      const existing = state.entities[entityKey]
      if (!existing) throw new Error(`运行时实体不存在: ${entityKey}`)
      if (!isObject(payload.patch)) throw new Error('实体补丁必须是对象。')
      const allowed = new Set(['name', 'locationKey', 'lifecycleStatus', 'attributes'])
      for (const key of Object.keys(payload.patch)) {
        if (!allowed.has(key)) throw new Error(`实体补丁禁止字段: ${key}`)
      }
      state.entities[entityKey] = assertRuntimeEntity({
        ...existing,
        ...payload.patch,
        entityKey,
        kind: existing.kind,
        sourceId: existing.sourceId,
        attributes: payload.patch.attributes == null
          ? existing.attributes
          : { ...existing.attributes, ...assertRuntimeAttributes(payload.patch.attributes) },
      })
      break
    }
    case 'entity.removed': {
      const entityKey = String(payload.entityKey ?? '').trim()
      if (!state.entities[entityKey]) throw new Error(`运行时实体不存在: ${entityKey}`)
      delete state.entities[entityKey]
      break
    }
    case 'memory.recorded': {
      const memory = assertRuntimeMemory(payload.memory)
      if (memory.sourceEventSequence !== event.sequence) {
        throw new Error('运行时记忆必须引用自身事件序号。')
      }
      const index = state.memories.findIndex(row => row.id === memory.id)
      if (index >= 0) state.memories[index] = memory
      else state.memories.push(memory)
      break
    }
    case 'random.resolved': {
      assertDiceResolution(payload)
      break
    }
    case 'narrative.recorded': {
      const text = String(payload.text ?? '').trim()
      if (!text || text.length > 20_000) throw new Error('运行时叙事文本无效。')
      state.narratives.push({ eventSequence: event.sequence, text })
      break
    }
    case 'narrative.started': {
      const narrative = state.narrative
      if (!narrative || narrative.version !== 2 || !narrative.currentNodeKey || event.sequence !== 1) {
        throw new Error('GameRelease 叙事启动事件无效。')
      }
      if (String(payload.entryNodeKey ?? '').trim() !== narrative.currentNodeKey
        || String(payload.contentHash ?? '').trim() !== narrative.contentHash) {
        throw new Error('叙事启动事件与冻结发布不一致。')
      }
      break
    }
    case 'narrative.node.entered': {
      const narrative = state.narrative
      if (!narrative || narrative.version !== 2 || !narrative.currentNodeKey) {
        throw new Error('GameRelease 节点进入事件无效。')
      }
      const nodeKey = String(payload.nodeKey ?? '').trim()
      const causeSequence = assertFiniteInteger(payload.causeSequence, '节点进入原因序号', 1, event.sequence - 1)
      if (nodeKey !== narrative.currentNodeKey) throw new Error('节点进入事件与当前冻结节点不一致。')
      if (event.sequence !== causeSequence + 1) throw new Error('节点进入事件没有紧随其状态变更。')
      if (causeSequence > 1
        && narrative.choiceHistory?.[narrative.choiceHistory.length - 1]?.eventSequence !== causeSequence) {
        throw new Error('节点进入事件缺少对应的 Choice。')
      }
      narrative.lastEnteredNodeSequence = event.sequence
      break
    }
    case 'narrative.node.advanced': {
      if (!state.narrative || state.narrative.completed || !state.narrative.currentNodeKey) {
        throw new Error('当前会话没有可推进的冻结叙事。')
      }
      if (state.narrative.version !== 1) throw new Error('GameRelease 叙事必须通过正式 Choice 提交。')
      const fromNodeKey = String(payload.fromNodeKey ?? '').trim()
      const toNodeKey = String(payload.toNodeKey ?? '').trim()
      if (fromNodeKey !== state.narrative.currentNodeKey) throw new Error('冻结叙事推进来源节点已变化。')
      if (!state.narrative.availableNodeKeys.includes(toNodeKey)) throw new Error('冻结叙事目标不是当前可选后继。')
      state.narrative = enterFrozenNarrativeNode(state.narrative, toNodeKey)
      break
    }
    case 'narrative.choice.committed': {
      const narrative = state.narrative
      if (!narrative || narrative.version !== 2 || narrative.completed || !narrative.currentNodeKey) {
        throw new Error('当前会话没有可提交选择的 GameRelease 叙事。')
      }
      const commandId = String(payload.commandId ?? '').trim()
      const baseSequence = assertFiniteInteger(payload.baseSequence, '选择基准序号', 0, Number.MAX_SAFE_INTEGER)
      const baseStateHash = String(payload.baseStateHash ?? '').trim()
      const fromNodeKey = String(payload.fromNodeKey ?? '').trim()
      const choiceKey = String(payload.choiceKey ?? '').trim()
      const toNodeKey = String(payload.toNodeKey ?? '').trim()
      if (!commandId || commandId.length > 200 || !/^[a-zA-Z0-9._:-]+$/.test(commandId)) throw new Error('选择 commandId 无效。')
      if (!/^[a-f0-9]{64}$/.test(baseStateHash)) throw new Error('选择 baseStateHash 无效。')
      if (baseSequence !== event.sequence - 1) throw new Error('选择基准序号与事件位置不一致。')
      if (fromNodeKey !== narrative.currentNodeKey) throw new Error('选择来源节点已变化。')
      if (!narrative.availableChoiceKeys?.includes(choiceKey)) throw new Error('所选 Choice 当前不可用。')
      const choice = narrative.choices?.find(item => item.choiceKey === choiceKey)
      if (!choice || choice.sourceNodeKey !== fromNodeKey || choice.targetNodeKey !== toNodeKey) {
        throw new Error('选择与冻结内容不一致。')
      }
      state.narrative = advanceFrozenNarrativeChoice(narrative, choiceKey, event.sequence)
      break
    }
    case 'narrative.ending.reached': {
      const narrative = state.narrative
      const endingKey = String(payload.endingKey ?? '').trim()
      const enteredSequence = assertFiniteInteger(payload.enteredSequence, '结局进入序号', 1, event.sequence - 1)
      if (!narrative || narrative.version !== 2 || !narrative.completed
        || narrative.currentNodeKey !== endingKey || narrative.endingKey !== endingKey) {
        throw new Error('结局事件与冻结叙事状态不一致。')
      }
      if (event.sequence !== enteredSequence + 1) throw new Error('结局事件没有紧随节点进入。')
      if (narrative.lastEnteredNodeSequence !== enteredSequence) throw new Error('结局事件引用的节点尚未正式进入。')
      narrative.completedAtSequence = event.sequence
      break
    }
    case 'chat.session.configured': {
      const characterKey = String(payload.characterKey ?? '').trim()
      const character = state.entities[characterKey]
      if (!character || !['character', 'npc'].includes(character.kind)) {
        throw new Error(`角色聊天角色不存在或类型不支持: ${characterKey}`)
      }
      const identity = assertChatIdentity(payload.identity)
      const scene = assertChatScene(payload.scene)
      const current = state.chat
      if (current && current.messages.length > 0 && current.characterKey !== characterKey) {
        throw new Error('已有聊天消息后不能更换角色；请从当前会话建立分支。')
      }
      state.chat = {
        characterKey,
        identity,
        scene,
        messages: current?.messages ?? [],
      }
      break
    }
    case 'chat.message.recorded': {
      const chat = requireChatState(state)
      if (chat.messages.some(message => message.role === 'user' && message.supersededBySequence == null && message.replyToSequence == null)) {
        const last = chat.messages[chat.messages.length - 1]
        if (last?.role === 'user') throw new Error('上一条用户消息尚未得到角色回复。')
      }
      const message = assertChatMessage({
        ...payload,
        eventSequence: event.sequence,
        role: 'user',
        speakerKey: null,
        replyToSequence: null,
        supersededBySequence: null,
      })
      chat.messages.push(message)
      break
    }
    case 'chat.reply.recorded': {
      const chat = requireChatState(state)
      const replyToSequence = assertFiniteInteger(payload.replyToSequence, '聊天回复目标序号', 1, event.sequence - 1)
      const target = chat.messages.find(message => message.eventSequence === replyToSequence)
      if (!target || target.role !== 'user') throw new Error('聊天回复必须引用当前会话中的用户消息。')
      const activeReply = chat.messages.find(message => (
        message.role === 'character'
        && message.replyToSequence === replyToSequence
        && message.supersededBySequence == null
      ))
      const supersedesSequence = payload.supersedesSequence == null
        ? null
        : assertFiniteInteger(payload.supersedesSequence, '聊天替代回复序号', 1, event.sequence - 1)
      if (activeReply && supersedesSequence !== activeReply.eventSequence) {
        throw new Error('该用户消息已有当前回复；重生成必须明确替代原回复。')
      }
      if (supersedesSequence != null) {
        const superseded = chat.messages.find(message => message.eventSequence === supersedesSequence)
        if (!superseded || superseded.role !== 'character' || superseded.replyToSequence !== replyToSequence || superseded.supersededBySequence != null) {
          throw new Error('待替代的聊天回复无效或已经被替代。')
        }
        superseded.supersededBySequence = event.sequence
      }
      const message = assertChatMessage({
        ...payload,
        eventSequence: event.sequence,
        messageId: payload.messageId ?? `chat:${event.sequence}`,
        role: 'character',
        speakerKey: chat.characterKey,
        replyToSequence,
        supersededBySequence: null,
      })
      chat.messages.push(message)
      break
    }
    case 'ttrpg.scene.opened': {
      const ttrpg = requireTtrpgState(state)
      const scene = assertTtrpgScene(payload.scene)
      const rawTurnOrder = payload.turnOrder
      if (!Array.isArray(rawTurnOrder) || rawTurnOrder.length === 0) {
        throw new Error('跑团场景至少需要一个行动者。')
      }
      const turnOrder = rawTurnOrder.map(raw => String(raw).trim())
      if (new Set(turnOrder).size !== turnOrder.length) throw new Error('跑团回合顺序不能重复。')
      for (const actorKey of turnOrder) {
        const actor = state.entities[actorKey]
        if (!actor || !['player', 'character', 'npc'].includes(actor.kind)) {
          throw new Error(`跑团行动者不存在或类型不支持: ${actorKey}`)
        }
      }
      if (scene.locationKey != null) {
        const location = state.entities[scene.locationKey]
        if (!location || location.kind !== 'location') throw new Error(`跑团场景地点不存在: ${scene.locationKey}`)
      }
      ttrpg.scene = scene
      ttrpg.round = 1
      ttrpg.activeActorKey = turnOrder[0]
      ttrpg.turnOrder = turnOrder
      ttrpg.actions = []
      ttrpg.checks = []
      ttrpg.attacks = []
      ttrpg.encounter = null
      break
    }
    case 'ttrpg.action.recorded': {
      const ttrpg = requireTtrpgState(state)
      if (!ttrpg.scene || ttrpg.scene.status !== 'active') throw new Error('跑团尚未开始活动场景。')
      const action = assertTtrpgAction({
        eventSequence: event.sequence,
        actorKey: payload.actorKey,
        text: payload.text,
      })
      if (!ttrpg.turnOrder.includes(action.actorKey)) throw new Error('跑团动作行动者不在当前回合顺序中。')
      if (ttrpg.activeActorKey !== action.actorKey) throw new Error('当前还没轮到该行动者。')
      ttrpg.actions.push(action)
      break
    }
    case 'ttrpg.check.resolved': {
      const ttrpg = requireTtrpgState(state)
      if (!isObject(payload.check)) throw new Error('跑团检定缺少 check 对象。')
      const check = assertTtrpgCheck({ ...payload.check, eventSequence: event.sequence })
      if (!ttrpg.turnOrder.includes(check.actorKey)) throw new Error('跑团检定行动者不在当前回合顺序中。')
      ttrpg.checks.push(check)
      break
    }
    case 'ttrpg.gm.response.recorded': {
      const ttrpg = requireTtrpgState(state)
      if (!ttrpg.scene || ttrpg.scene.status !== 'active') throw new Error('跑团尚未开始活动场景。')
      const actionSequence = assertFiniteInteger(payload.actionSequence, '跑团动作序号', 1, event.sequence - 1)
      if (!ttrpg.actions.some(action => action.eventSequence === actionSequence)) {
        throw new Error('AI GM 叙事没有对应的玩家动作。')
      }
      if (payload.checkSequence != null) {
        const checkSequence = assertFiniteInteger(payload.checkSequence, '跑团检定序号', 1, event.sequence - 1)
        if (!ttrpg.checks.some(check => check.eventSequence === checkSequence)) {
          throw new Error('AI GM 叙事引用了不存在的检定。')
        }
      }
      const text = String(payload.text ?? '').trim()
      if (!text || text.length > 20_000) throw new Error('AI GM 叙事文本无效。')
      state.narratives.push({ eventSequence: event.sequence, text })
      break
    }
    case 'ttrpg.turn.advanced': {
      const ttrpg = requireTtrpgState(state)
      if (!ttrpg.scene || ttrpg.scene.status !== 'active') throw new Error('跑团尚未开始活动场景。')
      const nextActorKey = String(payload.nextActorKey ?? '').trim()
      const round = assertFiniteInteger(payload.round, '跑团回合', 1, Number.MAX_SAFE_INTEGER)
      if (!ttrpg.turnOrder.includes(nextActorKey)) throw new Error('下一个行动者不在当前回合顺序中。')
      const currentIndex = ttrpg.turnOrder.indexOf(ttrpg.activeActorKey ?? '')
      const nextIndex = (currentIndex + 1) % ttrpg.turnOrder.length
      const expectedActorKey = ttrpg.turnOrder[nextIndex]
      const expectedRound = ttrpg.round + (nextIndex === 0 ? 1 : 0)
      if (nextActorKey !== expectedActorKey || round !== expectedRound) {
        throw new Error('跑团回合推进与确定性顺序不一致。')
      }
      ttrpg.activeActorKey = nextActorKey
      ttrpg.round = round
      break
    }
    case 'ttrpg.encounter.started': {
      const ttrpg = requireTtrpgState(state)
      if (!ttrpg.scene || ttrpg.scene.status !== 'active') throw new Error('请先开始一个跑团场景。')
      if (ttrpg.encounter?.status === 'active') throw new Error('当前已有进行中的战斗遭遇。')
      const encounter = assertTtrpgEncounter(payload.encounter)
      for (const actorKey of encounter.turnOrder) {
        const actor = state.entities[actorKey]
        if (!actor || !['player', 'character', 'npc'].includes(actor.kind)) {
          throw new Error(`遭遇参与者不存在或类型不支持: ${actorKey}`)
        }
      }
      if (encounter.activeActorKey !== encounter.turnOrder[0]) throw new Error('遭遇必须从先攻最高者开始。')
      ttrpg.encounter = encounter
      break
    }
    case 'ttrpg.encounter.resolved': {
      const ttrpg = requireTtrpgState(state)
      const encounter = ttrpg.encounter
      if (!encounter || encounter.status !== 'active') throw new Error('当前没有进行中的战斗遭遇。')
      const reason = String(payload.reason ?? '').trim()
      if (reason.length > 2_000) throw new Error('遭遇结束理由过长。')
      encounter.status = 'resolved'
      encounter.activeActorKey = null
      if (reason) state.narratives.push({ eventSequence: event.sequence, text: `遭遇结束：${reason}` })
      break
    }
    case 'ttrpg.combat.attack.resolved': {
      const ttrpg = requireTtrpgState(state)
      const encounter = ttrpg.encounter
      if (!encounter || encounter.status !== 'active') throw new Error('请先开始一个战斗遭遇。')
      const attack = assertTtrpgAttackResult(payload.attack)
      if (attack.actorKey !== event.actorKey || attack.targetKey !== event.targetKey) {
        throw new Error('攻击事件的行动者或目标与事件元数据不一致。')
      }
      if (encounter.activeActorKey !== attack.actorKey) throw new Error('当前还没轮到该战斗行动者。')
      if (!encounter.combatants[attack.actorKey] || !encounter.combatants[attack.targetKey]) {
        throw new Error('攻击行动者或目标不在当前遭遇中。')
      }
      ttrpg.attacks.push(attack)
      break
    }
    case 'ttrpg.combat.resource.changed': {
      const ttrpg = requireTtrpgState(state)
      const encounter = ttrpg.encounter
      if (!encounter || encounter.status !== 'active') throw new Error('请先开始一个战斗遭遇。')
      const entityKey = String(payload.entityKey ?? '').trim()
      const resourceKey = String(payload.resourceKey ?? '').trim()
      const delta = assertFiniteInteger(payload.delta, '资源变化量', -1_000_000_000, 1_000_000_000)
      const combatant = encounter.combatants[entityKey]
      if (!combatant || !resourceKey || resourceKey.length > 80) throw new Error('资源变化目标无效。')
      if (event.targetKey !== entityKey) throw new Error('资源变化事件目标与实体不一致。')
      const resource = combatant.resources[resourceKey]
      if (!resource) throw new Error(`战斗参与者没有资源: ${resourceKey}`)
      const expectedCurrent = Math.max(0, Math.min(resource.maximum, resource.current + delta))
      const current = assertFiniteInteger(payload.current, '资源当前值', 0, resource.maximum)
      if (current !== expectedCurrent) throw new Error('资源变化结果与当前资源不一致。')
      combatant.resources[resourceKey] = { ...resource, current }
      break
    }
    case 'ttrpg.combat.condition.applied': {
      const ttrpg = requireTtrpgState(state)
      const encounter = ttrpg.encounter
      if (!encounter || encounter.status !== 'active') throw new Error('请先开始一个战斗遭遇。')
      const entityKey = String(payload.entityKey ?? '').trim()
      const combatant = encounter.combatants[entityKey]
      if (!combatant) throw new Error('状态效果目标不在当前遭遇中。')
      if (event.targetKey !== entityKey) throw new Error('状态效果事件目标与实体不一致。')
      const condition = assertTtrpgCondition(payload.condition)
      const existing = combatant.conditions.find(item => item.conditionId === condition.conditionId)
      if (existing) {
        existing.stacks = Math.min(1_000, existing.stacks + condition.stacks)
        existing.duration = condition.duration
        existing.description = condition.description
      } else {
        combatant.conditions.push(condition)
      }
      break
    }
    case 'ttrpg.combat.condition.removed': {
      const ttrpg = requireTtrpgState(state)
      const encounter = ttrpg.encounter
      if (!encounter || encounter.status !== 'active') throw new Error('请先开始一个战斗遭遇。')
      const entityKey = String(payload.entityKey ?? '').trim()
      const conditionId = String(payload.conditionId ?? '').trim()
      const combatant = encounter.combatants[entityKey]
      if (!combatant || !conditionId) throw new Error('状态效果移除目标无效。')
      if (event.targetKey !== entityKey) throw new Error('状态效果事件目标与实体不一致。')
      combatant.conditions = combatant.conditions.filter(condition => condition.conditionId !== conditionId)
      break
    }
    case 'ttrpg.combat.turn.advanced': {
      const ttrpg = requireTtrpgState(state)
      const encounter = ttrpg.encounter
      if (!encounter || encounter.status !== 'active') throw new Error('请先开始一个战斗遭遇。')
      const nextActorKey = String(payload.nextActorKey ?? '').trim()
      const round = assertFiniteInteger(payload.round, '战斗回合', 1, Number.MAX_SAFE_INTEGER)
      if (!encounter.turnOrder.includes(nextActorKey)) throw new Error('下一个战斗行动者不在遭遇中。')
      const currentIndex = encounter.turnOrder.indexOf(encounter.activeActorKey ?? '')
      const nextIndex = (currentIndex + 1) % encounter.turnOrder.length
      const expectedActorKey = encounter.turnOrder[nextIndex]
      const expectedRound = encounter.round + (nextIndex === 0 ? 1 : 0)
      if (nextActorKey !== expectedActorKey || round !== expectedRound) throw new Error('战斗回合推进与先攻顺序不一致。')
      const leaving = encounter.activeActorKey ? encounter.combatants[encounter.activeActorKey] : null
      if (leaving) {
        leaving.conditions = leaving.conditions
          .map(condition => condition.duration == null ? condition : { ...condition, duration: condition.duration - 1 })
          .filter(condition => condition.duration == null || condition.duration > 0)
      }
      encounter.activeActorKey = nextActorKey
      encounter.round = round
      break
    }
    case 'ttrpg.campaign.summary.updated': {
      const ttrpg = requireTtrpgState(state)
      const baseSequence = assertFiniteInteger(payload.baseSequence, '战役摘要基线序号', 0, event.sequence - 1)
      if (baseSequence !== event.sequence - 1) throw new Error('战役摘要基线与事件序号不一致。')
      const summary = String(payload.summary ?? '').trim()
      if (summary.length > 20_000) throw new Error('长期战役摘要过长。')
      ttrpg.campaign = ttrpg.campaign ?? emptyTtrpgCampaignState()
      ttrpg.campaign.summary = summary
      break
    }
    case 'ttrpg.campaign.quest.upserted': {
      const ttrpg = requireTtrpgState(state)
      const quest = assertTtrpgQuest(payload.quest)
      if (quest.updatedSequence !== event.sequence) throw new Error('战役任务更新时间序号不一致。')
      ttrpg.campaign = ttrpg.campaign ?? emptyTtrpgCampaignState()
      const index = ttrpg.campaign.quests.findIndex(item => item.questId === quest.questId)
      if (index >= 0) ttrpg.campaign.quests[index] = quest
      else ttrpg.campaign.quests.push(quest)
      break
    }
    case 'ttrpg.campaign.schedule.upserted': {
      const ttrpg = requireTtrpgState(state)
      const schedule = assertTtrpgNpcSchedule(payload.schedule)
      if (schedule.updatedSequence !== event.sequence) throw new Error('NPC 日程更新时间序号不一致。')
      const npc = state.entities[schedule.entityKey]
      if (!npc || !isNpcRuntimeEntity(npc)) throw new Error('NPC 日程目标不是当前运行时 NPC。')
      if (schedule.locationKey != null) {
        const location = state.entities[schedule.locationKey]
        if (!location || location.kind !== 'location') throw new Error('NPC 日程地点不是当前运行时地点。')
      }
      ttrpg.campaign = ttrpg.campaign ?? emptyTtrpgCampaignState()
      const index = ttrpg.campaign.npcSchedules.findIndex(item => item.scheduleId === schedule.scheduleId)
      if (index >= 0) ttrpg.campaign.npcSchedules[index] = schedule
      else ttrpg.campaign.npcSchedules.push(schedule)
      break
    }
    case 'npc.evolution.proposed': {
      const candidate = parseSimulationNpcEvolutionCandidate(payload.candidate)
      if (candidate.baseSequence !== state.lastSequence) {
        throw new Error('NPC 演进候选基线与当前事件序号不一致。')
      }
      prepareNpcEvolution(state, candidate)
      break
    }
    case 'npc.evolution.accepted': {
      const proposalSequence = assertFiniteInteger(
        payload.proposalSequence,
        'NPC 演进提案序号',
        1,
        event.sequence - 1,
      )
      if (state.lastSequence !== proposalSequence) {
        throw new Error('NPC 演进候选已过期，请重新生成。')
      }
      const candidate = parseSimulationNpcEvolutionCandidate(payload.candidate)
      if (candidate.baseSequence !== proposalSequence - 1) {
        throw new Error('NPC 演进候选与提案序号不一致。')
      }
      applyNpcEvolution(state, candidate, event.sequence)
      break
    }
    case 'npc.evolution.rejected': {
      assertFiniteInteger(
        payload.proposalSequence,
        'NPC 演进提案序号',
        1,
        event.sequence - 1,
      )
      const reason = String(payload.reason ?? '').trim()
      if (reason.length > 1_000) throw new Error('NPC 演进拒绝原因过长。')
      break
    }
  }
  state.lastSequence = event.sequence
  return state
}

/** Prepare a release entry state with the same projection later persisted by
 * adventure.narrative.synced. No event is fabricated at sequence zero. */
export function withAdventureNarrativeProjection(
  current: SimulationRuntimeState,
): SimulationRuntimeState {
  const state = cloneState(parseSimulationState(current))
  if (!state.adventure || !state.narrative || state.narrative.version !== 2) return state
  const projection = adventureNarrativeProjection(state.adventure)
  state.narrative.variables = { ...state.narrative.variables, adventure: projection }
  if (!state.narrative.completed && state.narrative.currentNodeKey) {
    const evaluations = evaluateNarrativeChoices({
      ...state.narrative.variables,
      __visitedNodeKeys: state.narrative.visitedNodeKeys,
      __selectedChoiceKeys: (state.narrative.choiceHistory ?? []).map(item => item.choiceKey),
    }, state.narrative.currentNodeKey, state.narrative.choices ?? [])
    state.narrative.visibleChoiceKeys = evaluations.filter(item => item.visible).map(item => item.choiceKey)
    state.narrative.availableChoiceKeys = evaluations.filter(item => item.available).map(item => item.choiceKey)
    state.narrative.availableNodeKeys = [...new Set(
      evaluations.filter(item => item.available).map(item => item.targetNodeKey),
    )]
  }
  return parseSimulationState(state)
}

/** Prepare the release entry state with the same projection later persisted by
 * simulation.narrative.synced. Narrative conditions consume this read-only
 * projection; the deterministic simulation remains the source of truth. */
export function withNarrativeSimulationProjection(
  current: SimulationRuntimeState,
): SimulationRuntimeState {
  const state = cloneState(parseSimulationState(current))
  if (!state.narrativeSimulation || !state.narrative || state.narrative.version !== 2) return state
  const projection = narrativeSimulationProjection(state.narrativeSimulation)
  state.narrative.variables = { ...state.narrative.variables, simulation: projection }
  if (!state.narrative.completed && state.narrative.currentNodeKey) {
    const evaluations = evaluateNarrativeChoices({
      ...state.narrative.variables,
      __visitedNodeKeys: state.narrative.visitedNodeKeys,
      __selectedChoiceKeys: (state.narrative.choiceHistory ?? []).map(item => item.choiceKey),
    }, state.narrative.currentNodeKey, state.narrative.choices ?? [])
    state.narrative.visibleChoiceKeys = evaluations.filter(item => item.visible).map(item => item.choiceKey)
    state.narrative.availableChoiceKeys = evaluations.filter(item => item.available).map(item => item.choiceKey)
    state.narrative.availableNodeKeys = [...new Set(
      evaluations.filter(item => item.available).map(item => item.targetNodeKey),
    )]
  }
  return parseSimulationState(state)
}

/** Prepare a TEXTWORLD release entry with the same read-only projection that
 * later world.narrative.synced events verify during replay. */
export function withOpenWorldNarrativeProjection(
  current: SimulationRuntimeState,
): SimulationRuntimeState {
  const state = cloneState(parseSimulationState(current))
  if (!state.openWorld || !state.narrative || state.narrative.version !== 2) return state
  const projection = openWorldMainlineProjection(state.openWorld, state.openWorld.mainlineQuestKeys)
  state.narrative.variables = { ...state.narrative.variables, openWorld: projection }
  if (!state.narrative.completed && state.narrative.currentNodeKey) {
    const evaluations = evaluateNarrativeChoices({
      ...state.narrative.variables,
      __visitedNodeKeys: state.narrative.visitedNodeKeys,
      __selectedChoiceKeys: (state.narrative.choiceHistory ?? []).map(item => item.choiceKey),
    }, state.narrative.currentNodeKey, state.narrative.choices ?? [])
    state.narrative.visibleChoiceKeys = evaluations.filter(item => item.visible).map(item => item.choiceKey)
    state.narrative.availableChoiceKeys = evaluations.filter(item => item.available).map(item => item.choiceKey)
    state.narrative.availableNodeKeys = [...new Set(evaluations.filter(item => item.available).map(item => item.targetNodeKey))]
  }
  return parseSimulationState(state)
}

export function replaySimulationEvents(
  initialState: SimulationRuntimeState,
  events: readonly SimulationEvent[],
  throughSequence = Number.MAX_SAFE_INTEGER,
): SimulationRuntimeState {
  let state = cloneState(parseSimulationState(initialState))
  const ordered = [...events]
    .filter(event => event.sequence <= throughSequence)
    .sort((a, b) => a.sequence - b.sequence)
  for (const event of ordered) state = applySimulationEvent(state, event)
  return state
}

async function assertSessionScope(input: {
  projectId: number
  worldGroupId?: number | null
}): Promise<void> {
  if (!await db.projects.get(input.projectId)) throw new Error('模拟会话所属项目不存在。')
  if (input.worldGroupId != null) {
    const world = await db.worldGroups.get(input.worldGroupId)
    if (!world || world.projectId !== input.projectId) {
      throw new Error('模拟会话所属世界不存在或不属于当前项目。')
    }
  }
}

function defaultSeed(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

async function insertSimulationSession(
  input: CreateSimulationSessionInput,
  binding?: Pick<SimulationSession,
    'worldId' | 'workId' | 'worldReleaseId' | 'gameReleaseId' | 'narrativeModuleExportId'>,
): Promise<SimulationSession> {
  await assertSessionScope(input)
  if (!SIMULATION_SESSION_KINDS.includes(input.kind)) throw new Error('未知模拟会话类型。')
  const title = input.title.trim()
  if (!title || title.length > 200) throw new Error('模拟会话标题无效。')
  const initialState = parseSimulationState(input.initialState ?? EMPTY_SIMULATION_STATE)
  if (initialState.lastSequence !== 0) throw new Error('模拟会话初始状态 lastSequence 必须为 0。')
  const canonSnapshot = input.canonSnapshot ?? { version: 1, sources: [] }
  if (!isObject(canonSnapshot)) throw new Error('Canon 冻结快照必须是对象。')
  const now = Date.now()
  const session: SimulationSession = {
    projectId: input.projectId,
    worldGroupId: input.worldGroupId ?? null,
    kind: input.kind,
    title,
    status: 'active',
    rulesetVersion: 1,
    seed: input.seed?.trim() || defaultSeed(),
    canonSnapshotJson: JSON.stringify(canonSnapshot),
    initialStateJson: JSON.stringify(initialState),
    parentSessionId: null,
    parentThroughSequence: null,
    createdAt: now,
    updatedAt: now,
    ...binding,
  }
  session.id = await db.simulationSessions.add(session) as number
  return session
}

export async function createSimulationSession(
  input: CreateSimulationSessionInput,
): Promise<SimulationSession> {
  if (input.kind === 'storygame' || input.kind === 'textadventure' || input.kind === 'avg'
    || input.kind === 'textsimulation' || input.kind === 'textworld') {
    throw new Error('新建正式文字游戏必须通过不可变 GameRelease；createSimulationSession 仅保留内核和 legacy 运行时入口。')
  }
  return insertSimulationSession(input)
}

/**
 * 正式文字游戏的唯一底层建档入口。调用者仍需先完成 GameRelease 不可变校验；
 * 此处再次核对绑定与冻结状态，避免通用 SIM API 形成 legacy 写旁路。
 */
export async function createReleasedGameSession(
  input: CreateReleasedGameSessionInput,
): Promise<SimulationSession> {
  const [gameRelease, worldRelease] = await Promise.all([
    assertGameReleaseUnchanged(input.gameReleaseId),
    db.worldReleases.get(input.worldReleaseId),
  ])
  if (!gameRelease || gameRelease.projectId !== input.projectId
    || gameRelease.worldId !== input.worldId || gameRelease.workId !== input.workId
    || gameRelease.worldReleaseId !== input.worldReleaseId) {
    throw new Error('文字游戏的 GameRelease 绑定无效。')
  }
  if (!worldRelease || worldRelease.projectId !== input.projectId || worldRelease.worldId !== input.worldId) {
    throw new Error('文字游戏的 WorldRelease 绑定无效。')
  }
  const manifest = parseAnyGameReleaseManifest(gameRelease.manifestJson)
  const expectedKind: SimulationSessionKind = manifest.productType === 'storygame'
    ? 'storygame' : manifest.productType === 'character-interaction' ? 'chatgame'
      : manifest.productType === 'text-adventure' ? 'textadventure'
        : manifest.productType === 'avg' ? 'avg'
          : manifest.productType === 'narrative-simulation' ? 'textsimulation' : 'textworld'
  if (input.kind !== expectedKind) throw new Error(`GameRelease ${manifest.productType} 与会话类型不匹配。`)
  if (manifest.worldRelease.narrativeModuleExportId !== input.narrativeModuleExportId) {
    throw new Error('文字游戏的冻结叙事绑定无效。')
  }
  const narrative = parseSimulationState(input.initialState ?? EMPTY_SIMULATION_STATE).narrative
  const releaseContentMismatch = narrative?.version !== 2 || narrative.contentHash !== gameRelease.contentHash
    || narrative.sourceHash !== gameRelease.contentHash
    || narrative.sourceModuleId != null
    || narrative.sourceModuleExportId !== input.narrativeModuleExportId
    || narrative.moduleKind !== manifest.narrative.moduleKind
    || narrative.moduleTitle !== manifest.narrative.moduleTitle
    || stableJson(narrative.nodes) !== stableJson(manifest.narrative.nodes)
    || stableJson(narrative.beats) !== stableJson(manifest.narrative.beats)
    || stableJson(narrative.choices) !== stableJson(manifest.narrative.choices)
  const releaseEntryMismatch = input.origin === 'release' && narrative?.version === 2 && (
    narrative.currentNodeKey !== manifest.narrative.entryNodeKey
    || narrative.choiceHistory?.length !== 0
    || narrative.visitedNodeKeys.length !== 1
    || narrative.visitedNodeKeys[0] !== manifest.narrative.entryNodeKey
  )
  if (releaseContentMismatch || releaseEntryMismatch) {
    throw new Error('文字游戏初始叙事必须来自绑定 GameRelease 的冻结内容。')
  }
  if (manifest.productType === 'character-interaction') {
    const interaction = parseSimulationState(input.initialState ?? EMPTY_SIMULATION_STATE).interaction
    const releaseInitial = createInitialInteractionState({
      playerKey: manifest.interaction.playerKey,
      profiles: manifest.interaction.profiles,
      sceneTemplates: manifest.interaction.sceneTemplates,
    })
    const frozenMismatch = !interaction
      || interaction.playerKey !== releaseInitial.playerKey
      || stableJson(interaction.profiles) !== stableJson(releaseInitial.profiles)
      || stableJson(interaction.sceneTemplates) !== stableJson(releaseInitial.sceneTemplates)
    const releaseStateMismatch = input.origin === 'release'
      && stableJson(interaction) !== stableJson(releaseInitial)
    if (frozenMismatch || releaseStateMismatch) {
      throw new Error('chatgame 初始状态必须来自绑定 GameRelease 的冻结互动内容。')
    }
  }
  if (manifest.productType === 'text-adventure') {
    const adventure = parseSimulationState(input.initialState ?? EMPTY_SIMULATION_STATE).adventure
    const releaseInitial = createInitialAdventureState(manifest.adventure, gameRelease.contentHash)
    const frozenMismatch = !adventure || adventure.contentHash !== gameRelease.contentHash
      || stableJson(adventure.abilities) !== stableJson(releaseInitial.abilities)
      || Object.keys(adventure.resources).some(key => !Object.prototype.hasOwnProperty.call(releaseInitial.resources, key))
    const releaseStateMismatch = input.origin === 'release' && stableJson(adventure) !== stableJson(releaseInitial)
    if (frozenMismatch || releaseStateMismatch) {
      throw new Error('textadventure 初始状态必须来自绑定 GameRelease 的冻结冒险内容。')
    }
  }
  if (manifest.productType === 'avg') {
    const presentation = parseSimulationState(input.initialState ?? EMPTY_SIMULATION_STATE).presentation
    const releaseInitial = createInitialAvgPresentationState({
      contentHash: gameRelease.contentHash,
      assets: manifest.presentation.assets,
      content: manifest.presentation,
      entryNodeKey: manifest.narrative.entryNodeKey,
    })
    const frozenMismatch = !presentation || presentation.contentHash !== gameRelease.contentHash
      || stableJson(presentation.assets) !== stableJson(releaseInitial.assets)
      || stableJson(presentation.cues) !== stableJson(releaseInitial.cues)
    const releaseStateMismatch = input.origin === 'release' && stableJson(presentation) !== stableJson(releaseInitial)
    if (frozenMismatch || releaseStateMismatch) throw new Error('avg 初始演出必须来自绑定 GameRelease 的冻结内容。')
  }
  if (manifest.productType === 'narrative-simulation') {
    const simulation = parseSimulationState(input.initialState ?? EMPTY_SIMULATION_STATE).narrativeSimulation
    const releaseInitial = createInitialNarrativeSimulationState(manifest.simulation, gameRelease.contentHash)
    const frozenMismatch = !simulation || simulation.contentHash !== gameRelease.contentHash
      || simulation.turnLimit !== releaseInitial.turnLimit
      || simulation.actionBudget !== releaseInitial.actionBudget
      || Object.keys(simulation.resources).sort().join(',') !== Object.keys(releaseInitial.resources).sort().join(',')
      || Object.keys(simulation.metrics).sort().join(',') !== Object.keys(releaseInitial.metrics).sort().join(',')
      || Object.keys(simulation.actorStances).sort().join(',') !== Object.keys(releaseInitial.actorStances).sort().join(',')
      || simulation.issues.map(item => item.issueKey).sort().join(',') !== releaseInitial.issues.map(item => item.issueKey).sort().join(',')
    const releaseStateMismatch = input.origin === 'release' && stableJson(simulation) !== stableJson(releaseInitial)
    if (frozenMismatch || releaseStateMismatch) {
      throw new Error('textsimulation 初始状态必须来自绑定 GameRelease 的冻结内容。')
    }
  }
  if (manifest.productType === 'text-open-world') {
    const initial = parseSimulationState(input.initialState ?? EMPTY_SIMULATION_STATE)
    const expectedInteraction = createInitialInteractionState({
      playerKey: manifest.interaction.playerKey,
      profiles: manifest.interaction.profiles,
      sceneTemplates: manifest.interaction.sceneTemplates,
    })
    const expectedAdventure = createInitialAdventureState(manifest.adventure, gameRelease.contentHash)
    const expectedSimulation = createInitialNarrativeSimulationState(manifest.simulation, gameRelease.contentHash)
    const expectedOpenWorld = createInitialOpenWorldState(manifest.openWorld, gameRelease.contentHash)
    const frozenMismatch = !initial.interaction || !initial.adventure || !initial.narrativeSimulation || !initial.openWorld
      || initial.adventure.contentHash !== gameRelease.contentHash
      || initial.narrativeSimulation.contentHash !== gameRelease.contentHash
      || initial.openWorld.contentHash !== gameRelease.contentHash
      || stableJson(initial.interaction.profiles) !== stableJson(expectedInteraction.profiles)
      || stableJson(initial.interaction.sceneTemplates) !== stableJson(expectedInteraction.sceneTemplates)
      || stableJson(initial.openWorld.mainlineQuestKeys) !== stableJson(expectedOpenWorld.mainlineQuestKeys)
    const releaseStateMismatch = input.origin === 'release' && (
      stableJson(initial.interaction) !== stableJson(expectedInteraction)
      || stableJson(initial.adventure) !== stableJson(expectedAdventure)
      || stableJson(initial.narrativeSimulation) !== stableJson(expectedSimulation)
      || stableJson(initial.openWorld) !== stableJson(expectedOpenWorld)
    )
    if (frozenMismatch || releaseStateMismatch) {
      throw new Error('textworld 初始状态必须来自绑定 GameRelease 的全部冻结内容。')
    }
  }
  return insertSimulationSession(input, {
    worldId: input.worldId,
    workId: input.workId,
    worldReleaseId: input.worldReleaseId,
    gameReleaseId: input.gameReleaseId,
    narrativeModuleExportId: input.narrativeModuleExportId,
  })
}

/** @deprecated STORYGAME compatibility wrapper; new product code uses createReleasedGameSession. */
export async function createReleasedStoryGameSession(
  input: CreateReleasedGameSessionInput,
): Promise<SimulationSession> {
  if (input.kind !== 'storygame') throw new Error('storygame 兼容入口只接受 storygame。')
  return createReleasedGameSession(input)
}

async function readSessionEvents(
  session: SimulationSession,
  throughSequence = Number.MAX_SAFE_INTEGER,
): Promise<SimulationEvent[]> {
  const events = await db.simulationEvents.where('sessionId').equals(session.id!).toArray()
  for (const event of events) {
    if (
      event.projectId !== session.projectId
      || (event.worldGroupId ?? null) !== (session.worldGroupId ?? null)
    ) {
      throw new Error(`模拟事件 ${event.id ?? '?'} 作用域与会话不一致。`)
    }
  }
  return events.filter(event => event.sequence <= throughSequence)
}

export async function readSimulationState(
  sessionId: number,
  throughSequence = Number.MAX_SAFE_INTEGER,
): Promise<SimulationRuntimeState> {
  const session = await db.simulationSessions.get(sessionId)
  if (!session) throw new Error('模拟会话不存在。')
  const events = await readSessionEvents(session, throughSequence)
  return replaySimulationEvents(parseSimulationState(session.initialStateJson), events, throughSequence)
}

async function appendBuiltEvent(
  sessionId: number,
  build: (input: {
    session: SimulationSession
    state: SimulationRuntimeState
    events: SimulationEvent[]
    sequence: number
  }) => Omit<SimulationEvent, 'id' | 'projectId' | 'worldGroupId' | 'sessionId' | 'sequence' | 'createdAt'>,
): Promise<SimulationEvent> {
  return db.transaction(
    'rw',
    db.simulationSessions,
    db.simulationEvents,
    async () => {
      const session = await db.simulationSessions.get(sessionId)
      if (!session) throw new Error('模拟会话不存在。')
      if (session.status !== 'active') throw new Error('只有 active 会话可以追加事件。')
      const events = await readSessionEvents(session)
      const state = replaySimulationEvents(parseSimulationState(session.initialStateJson), events)
      const sequence = state.lastSequence + 1
      const built = build({ session, state, events, sequence })
      const event: SimulationEvent = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId,
        sequence,
        ...built,
        createdAt: Date.now(),
      }
      applySimulationEvent(state, event)
      event.id = await db.simulationEvents.add(event) as number
      await db.simulationSessions.update(sessionId, { updatedAt: event.createdAt })
      return event
    },
  )
}

export async function appendSimulationEvent(input: {
  sessionId: number
  type: SimulationEventType
  actorKey?: string | null
  targetKey?: string | null
  payload: unknown
}): Promise<SimulationEvent> {
  if (input.type === 'random.resolved') {
    throw new Error('随机判定只能通过 resolveSimulationDice() 生成。')
  }
  if (input.type.startsWith('interaction.')) {
    throw new Error('受治理的角色互动事件只能通过对应的专用命令 API 生成。')
  }
  if (input.type.startsWith('adventure.')) {
    throw new Error('受治理的文字冒险事件只能通过 commitAdventureAction() 生成。')
  }
  if (input.type.startsWith('presentation.')) {
    throw new Error('受治理的 AVG 演出事件只能通过对应的专用命令 API 生成。')
  }
  if (input.type.startsWith('simulation.')) {
    throw new Error('受治理的复杂模拟事件只能通过对应的专用回合命令生成。')
  }
  if (input.type.startsWith('world.')) {
    throw new Error('受治理的开放世界事件只能通过对应的专用命令生成。')
  }
  if (
    input.type === 'npc.evolution.proposed'
    || input.type === 'npc.evolution.accepted'
    || input.type === 'npc.evolution.rejected'
    || input.type === 'ttrpg.scene.opened'
    || input.type === 'ttrpg.action.recorded'
    || input.type === 'ttrpg.check.resolved'
    || input.type === 'ttrpg.gm.response.recorded'
    || input.type === 'ttrpg.turn.advanced'
    || input.type === 'ttrpg.encounter.started'
    || input.type === 'ttrpg.encounter.resolved'
    || input.type === 'ttrpg.combat.attack.resolved'
    || input.type === 'ttrpg.combat.resource.changed'
    || input.type === 'ttrpg.combat.condition.applied'
    || input.type === 'ttrpg.combat.condition.removed'
    || input.type === 'ttrpg.combat.turn.advanced'
    || input.type === 'ttrpg.campaign.summary.updated'
    || input.type === 'ttrpg.campaign.quest.upserted'
    || input.type === 'ttrpg.campaign.schedule.upserted'
    || input.type === 'chat.session.configured'
    || input.type === 'chat.message.recorded'
    || input.type === 'chat.reply.recorded'
    || input.type === 'narrative.started'
    || input.type === 'narrative.node.entered'
    || input.type === 'narrative.node.advanced'
    || input.type === 'narrative.choice.committed'
    || input.type === 'narrative.ending.reached'
  ) {
    throw new Error('受治理的互动事件只能通过对应的专用 API 生成。')
  }
  return appendBuiltEvent(input.sessionId, ({ sequence }) => {
    let payload = input.payload
    if (
      input.type === 'memory.recorded'
      && isObject(payload)
      && isObject(payload.memory)
    ) {
      payload = {
        ...payload,
        memory: {
          ...payload.memory,
          sourceEventSequence: sequence,
        },
      }
    }
    return {
      type: input.type,
      actorKey: input.actorKey ?? null,
      targetKey: input.targetKey ?? null,
      payloadJson: JSON.stringify(payload),
    }
  })
}

export async function reachAvgPresentationBeat(input: {
  sessionId: number
  beatKey: string
  commandId: string
  baseSequence: number
  baseStateHash: string
  snapshotKey?: string | null
}): Promise<SimulationEvent> {
  const commandId = normalizeCommandId(input.commandId)
  const beatKey = input.beatKey.trim()
  const baseStateHash = input.baseStateHash.trim()
  if (!beatKey || beatKey.length > 200) throw new Error('[avg] beatKey 无效')
  if (!Number.isInteger(input.baseSequence) || input.baseSequence < 0 || !/^[a-f0-9]{64}$/.test(baseStateHash)) {
    throw new Error('[avg] 演出命令基线无效')
  }
  const previewSession = await db.simulationSessions.get(input.sessionId)
  if (!previewSession || previewSession.kind !== 'avg' || previewSession.gameReleaseId == null) throw new Error('[avg] 正式 AVG 实例不存在')
  const previewEvents = await readSessionEvents(previewSession)
  const previewState = replaySimulationEvents(parseSimulationState(previewSession.initialStateJson), previewEvents)
  const previewHash = await hashStateJson(JSON.stringify(previewState))
  return db.transaction('rw', db.simulationSessions, db.simulationEvents, async () => {
    const session = await db.simulationSessions.get(input.sessionId)
    if (!session || session.kind !== 'avg' || session.gameReleaseId == null) throw new Error('[avg] 正式 AVG 实例不存在')
    const events = await readSessionEvents(session)
    const prior = events.find(event => event.commandId === commandId)
    if (prior) {
      const payload = parseEventPayload(prior)
      if (prior.type !== 'presentation.beat.reached' || payload.beatKey !== beatKey) throw new Error('[avg] commandId 已被不同命令使用')
      return prior
    }
    if (session.status !== 'active') throw new Error('[avg] 只有 active 会话可以推进演出')
    const state = replaySimulationEvents(parseSimulationState(session.initialStateJson), events)
    if (state.lastSequence !== input.baseSequence || previewState.lastSequence !== state.lastSequence || previewHash !== baseStateHash) {
      throw new Error('[avg] 演出状态已变化，请刷新后重试')
    }
    if (!state.presentation || !state.narrative) throw new Error('[avg] 当前没有可推进的演出 Beat')
    const event: SimulationEvent = {
      projectId: session.projectId, worldGroupId: session.worldGroupId ?? null, sessionId: session.id!,
      sequence: state.lastSequence + 1, type: 'presentation.beat.reached', actorKey: null, targetKey: beatKey,
      commandId, baseSequence: input.baseSequence, baseStateHash,
      payloadJson: JSON.stringify({ beatKey, snapshotKey: input.snapshotKey?.trim() || null }), createdAt: Date.now(),
    }
    applySimulationEvent(state, event)
    event.id = await db.simulationEvents.add(event) as number
    await db.simulationSessions.update(session.id!, { updatedAt: event.createdAt })
    return event
  })
}

export async function recordAvgMediaFailure(input: {
  sessionId: number
  assetKey: string
  reason: string
  commandId: string
}): Promise<SimulationEvent> {
  const commandId = normalizeCommandId(input.commandId)
  const assetKey = input.assetKey.trim()
  const reason = input.reason.trim() || '资源不可用'
  if (!/^[a-zA-Z0-9._:-]{1,200}$/.test(assetKey)) throw new Error('[avg] 失败媒资 key 无效')
  if (reason.length > 2_000) throw new Error('[avg] 媒资失败原因过长')
  return db.transaction('rw', db.simulationSessions, db.simulationEvents, async () => {
    const session = await db.simulationSessions.get(input.sessionId)
    if (!session || session.kind !== 'avg' || session.gameReleaseId == null) throw new Error('[avg] 正式 AVG 实例不存在')
    const events = await readSessionEvents(session)
    const prior = events.find(event => event.commandId === commandId)
    if (prior) {
      const payload = parseEventPayload(prior)
      if (prior.type !== 'presentation.media.failed' || payload.assetKey !== assetKey || payload.reason !== reason) {
        throw new Error('[avg] commandId 已被不同媒资诊断使用')
      }
      return prior
    }
    const state = replaySimulationEvents(parseSimulationState(session.initialStateJson), events)
    const event: SimulationEvent = {
      projectId: session.projectId, worldGroupId: session.worldGroupId ?? null, sessionId: session.id!,
      sequence: state.lastSequence + 1, type: 'presentation.media.failed', actorKey: null, targetKey: assetKey,
      commandId, payloadJson: JSON.stringify({ assetKey, reason }), createdAt: Date.now(),
    }
    applySimulationEvent(state, event)
    event.id = await db.simulationEvents.add(event) as number
    await db.simulationSessions.update(session.id!, { updatedAt: event.createdAt })
    return event
  })
}

export async function advanceSimulationNarrative(input: {
  sessionId: number
  targetNodeKey: string
  baseSequence?: number
}): Promise<SimulationEvent> {
  const targetNodeKey = input.targetNodeKey.trim()
  if (!targetNodeKey) throw new Error('请选择要进入的叙事节点。')
  return appendBuiltEvent(input.sessionId, ({ state }) => {
    const narrative = state.narrative
    if (!narrative || narrative.completed || !narrative.currentNodeKey) {
      throw new Error('当前会话没有可推进的冻结叙事。')
    }
    if (narrative.version !== 1) throw new Error('GameRelease 叙事必须提交正式 Choice。')
    const baseSequence = input.baseSequence ?? state.lastSequence
    if (baseSequence !== state.lastSequence) throw new Error('叙事分支已变化，请刷新后重试。')
    if (!narrative.availableNodeKeys.includes(targetNodeKey)) {
      throw new Error('所选节点不是当前条件允许的后继。')
    }
    return {
      type: 'narrative.node.advanced',
      actorKey: null,
      targetKey: targetNodeKey,
      payloadJson: JSON.stringify({
        fromNodeKey: narrative.currentNodeKey,
        toNodeKey: targetNodeKey,
        baseSequence,
      }),
    }
  })
}

function normalizeCommandId(value: string): string {
  const commandId = value.trim()
  if (!commandId || commandId.length > 200 || !/^[a-zA-Z0-9._:-]+$/.test(commandId)) {
    throw new Error('命令 commandId 无效。')
  }
  return commandId
}

export async function readSimulationStateVersion(sessionId: number): Promise<{
  sequence: number
  stateHash: string
}> {
  const state = await readSimulationState(sessionId)
  return { sequence: state.lastSequence, stateHash: await hashStateJson(JSON.stringify(state)) }
}

interface InteractionCommandEnvelope {
  sessionId: number
  commandId: string
  baseSequence: number
  baseStateHash: string
}

async function appendInteractionCommand(input: InteractionCommandEnvelope & {
  type: Extract<SimulationEventType, `interaction.${string}`>
  actorKey?: string | null
  targetKey?: string | null
  payload: JsonObject
}): Promise<SimulationEvent> {
  const commandId = normalizeCommandId(input.commandId)
  const baseStateHash = input.baseStateHash.trim()
  if (!Number.isInteger(input.baseSequence) || input.baseSequence < 0) {
    throw new Error('互动命令 baseSequence 无效。')
  }
  if (!/^[a-f0-9]{64}$/.test(baseStateHash)) throw new Error('互动命令 baseStateHash 无效。')
  const previewSession = await db.simulationSessions.get(input.sessionId)
  if (!previewSession) throw new Error('模拟会话不存在。')
  const previewEvents = await readSessionEvents(previewSession)
  const previewState = replaySimulationEvents(parseSimulationState(previewSession.initialStateJson), previewEvents)
  const previewStateHash = await hashStateJson(JSON.stringify(previewState))
  return db.transaction('rw', db.simulationSessions, db.simulationEvents, async () => {
    const session = await db.simulationSessions.get(input.sessionId)
    if (!session) throw new Error('模拟会话不存在。')
    if (session.kind !== 'chatgame' && session.kind !== 'textadventure' && session.kind !== 'textworld') {
      throw new Error('角色互动命令只能写入带冻结互动状态的正式会话。')
    }
    const events = await readSessionEvents(session)
    const prior = events.find(event => event.commandId === commandId)
    const commandPayload = {
      ...input.payload,
      commandId,
      baseSequence: input.baseSequence,
      baseStateHash,
    }
    if (prior) {
      if (prior.type !== input.type || prior.baseSequence !== input.baseSequence
        || prior.baseStateHash !== baseStateHash
        || stableJson(parseEventPayload(prior)) !== stableJson(commandPayload)) {
        throw new Error('互动命令 commandId 已被不同命令使用。')
      }
      return prior
    }
    if (session.status !== 'active') throw new Error('只有 active 会话可以提交互动命令。')
    const state = replaySimulationEvents(parseSimulationState(session.initialStateJson), events)
    if (!state.interaction) throw new Error('当前会话不是 CHATGAME-2 角色互动存档。')
    if (state.lastSequence !== input.baseSequence) throw new Error('互动状态已变化，请刷新后重试。')
    if (previewState.lastSequence !== state.lastSequence || previewStateHash !== baseStateHash) {
      throw new Error('互动状态哈希已变化，请刷新后重试。')
    }
    const event: SimulationEvent = {
      projectId: session.projectId,
      worldGroupId: session.worldGroupId ?? null,
      sessionId: input.sessionId,
      sequence: state.lastSequence + 1,
      type: input.type,
      actorKey: input.actorKey ?? null,
      targetKey: input.targetKey ?? null,
      commandId,
      baseSequence: input.baseSequence,
      baseStateHash,
      payloadJson: JSON.stringify(commandPayload),
      createdAt: Date.now(),
    }
    applySimulationEvent(state, event)
    event.id = await db.simulationEvents.add(event) as number
    await db.simulationSessions.update(input.sessionId, { updatedAt: event.createdAt })
    return event
  })
}

export async function startInteractionScene(input: InteractionCommandEnvelope & {
  sceneId: string
  sceneKey: string
}): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: 'interaction.scene.started',
    targetKey: input.sceneKey.trim(),
    payload: { sceneId: input.sceneId.trim(), sceneKey: input.sceneKey.trim() },
  })
}

export async function endInteractionScene(input: InteractionCommandEnvelope & {
  sceneId: string
  reason: string
}): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: 'interaction.scene.ended',
    targetKey: input.sceneId.trim(),
    payload: { sceneId: input.sceneId.trim(), reason: input.reason.trim() },
  })
}

export async function joinInteractionParticipant(input: InteractionCommandEnvelope & {
  participantKey: string
}): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: 'interaction.participant.joined',
    actorKey: input.participantKey.trim(),
    targetKey: input.participantKey.trim(),
    payload: { participantKey: input.participantKey.trim() },
  })
}

export async function leaveInteractionParticipant(input: InteractionCommandEnvelope & {
  participantKey: string
}): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: 'interaction.participant.left',
    actorKey: input.participantKey.trim(),
    targetKey: input.participantKey.trim(),
    payload: { participantKey: input.participantKey.trim() },
  })
}

export async function commitInteractionPlayerMessage(input: InteractionCommandEnvelope & {
  messageId: string
  text: string
  audienceKeys?: string[] | null
}): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: 'interaction.player.message.committed',
    actorKey: 'player',
    payload: {
      messageId: input.messageId.trim(),
      text: input.text.trim(),
      audienceKeys: input.audienceKeys ?? null,
    },
  })
}

export async function commitInteractionCharacterReply(input: InteractionCommandEnvelope & {
  messageId: string
  speakerKey: string
  text: string
  replyToSequence: number
  audienceKeys?: string[] | null
  supersedesSequence?: number | null
  budgetCost?: number
  disclosures?: Array<{
    knowledgeKey: string
    toParticipantKeys: string[]
    evidenceExcerpt: string
  }>
}): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: 'interaction.character.reply.committed',
    actorKey: input.speakerKey.trim(),
    targetKey: input.speakerKey.trim(),
    payload: {
      messageId: input.messageId.trim(),
      speakerKey: input.speakerKey.trim(),
      text: input.text.trim(),
      replyToSequence: input.replyToSequence,
      audienceKeys: input.audienceKeys ?? null,
      supersedesSequence: input.supersedesSequence ?? null,
      budgetCost: input.budgetCost ?? 0,
      disclosures: input.disclosures ?? [],
    },
  })
}

export async function proposeInteractionMemory(input: InteractionCommandEnvelope & {
  memoryId: string
  participantKey: string
  kind: InteractionMemoryKind
  content: string
  importance: number
  sourceEventSequences: number[]
  evidenceExcerpt: string
}): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: 'interaction.memory.proposed',
    actorKey: input.participantKey.trim(),
    targetKey: input.participantKey.trim(),
    payload: {
      memoryId: input.memoryId.trim(),
      participantKey: input.participantKey.trim(),
      kind: input.kind,
      content: input.content.trim(),
      importance: input.importance,
      sourceEventSequences: input.sourceEventSequences,
      evidenceExcerpt: input.evidenceExcerpt.trim(),
    },
  })
}

export async function resolveInteractionMemory(input: InteractionCommandEnvelope & {
  memoryId: string
  resolution: 'accepted' | 'rejected'
}): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: input.resolution === 'accepted'
      ? 'interaction.memory.accepted'
      : 'interaction.memory.rejected',
    targetKey: input.memoryId.trim(),
    payload: { memoryId: input.memoryId.trim() },
  })
}

export async function supersedeInteractionMemory(input: InteractionCommandEnvelope & {
  memoryId: string
  supersededByMemoryId: string
}): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: 'interaction.memory.superseded',
    targetKey: input.memoryId.trim(),
    payload: {
      memoryId: input.memoryId.trim(),
      supersededByMemoryId: input.supersededByMemoryId.trim(),
    },
  })
}

export async function shareInteractionKnowledge(input: InteractionCommandEnvelope & {
  knowledgeKey: string
  fromParticipantKey: string
  toParticipantKeys: string[]
  sourceEventSequence: number
  evidenceExcerpt: string
}): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: 'interaction.knowledge.shared',
    actorKey: input.fromParticipantKey.trim(),
    payload: {
      knowledgeKey: input.knowledgeKey.trim(),
      fromParticipantKey: input.fromParticipantKey.trim(),
      toParticipantKeys: input.toParticipantKeys,
      sourceEventSequence: input.sourceEventSequence,
      evidenceExcerpt: input.evidenceExcerpt.trim(),
    },
  })
}

export async function changeInteractionRelationship(input: InteractionCommandEnvelope & {
  fromParticipantKey: string
  toParticipantKey: string
  dimensionKey: string
  delta: number
  reason: string
  ruleKey: string
  sourceEventSequence: number
  significantEventKey?: string | null
}): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: 'interaction.relationship.changed',
    actorKey: input.fromParticipantKey.trim(),
    targetKey: input.toParticipantKey.trim(),
    payload: {
      fromParticipantKey: input.fromParticipantKey.trim(),
      toParticipantKey: input.toParticipantKey.trim(),
      dimensionKey: input.dimensionKey.trim(),
      delta: input.delta,
      reason: input.reason.trim(),
      ruleKey: input.ruleKey.trim(),
      sourceEventSequence: input.sourceEventSequence,
      significantEventKey: input.significantEventKey?.trim() || null,
    },
  })
}

export async function openInteractionThread(input: InteractionCommandEnvelope & {
  threadKey: string
  title: string
}): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: 'interaction.thread.opened',
    targetKey: input.threadKey.trim(),
    payload: { threadKey: input.threadKey.trim(), title: input.title.trim() },
  })
}

export async function resolveInteractionThread(input: InteractionCommandEnvelope & {
  threadKey: string
  resolution: string
}): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: 'interaction.thread.resolved',
    targetKey: input.threadKey.trim(),
    payload: { threadKey: input.threadKey.trim(), resolution: input.resolution.trim() },
  })
}

export async function commitNarrativeChoice(input: {
  sessionId: number
  choiceKey: string
  commandId: string
  baseSequence: number
  baseStateHash: string
}): Promise<SimulationEvent> {
  const commandId = normalizeCommandId(input.commandId)
  const choiceKey = input.choiceKey.trim()
  const baseStateHash = input.baseStateHash.trim()
  if (!choiceKey || choiceKey.length > 200) throw new Error('请选择有效的 Choice。')
  if (!Number.isInteger(input.baseSequence) || input.baseSequence < 0) throw new Error('选择 baseSequence 无效。')
  if (!/^[a-f0-9]{64}$/.test(baseStateHash)) throw new Error('选择 baseStateHash 无效。')
  // Hashing a long replayed state is external async work. Resolve it before
  // entering the write transaction; Dexie transaction zones must not span
  // browser crypto promises or they can become inactive/intermittently hang.
  const previewSession = await db.simulationSessions.get(input.sessionId)
  if (!previewSession) throw new Error('模拟会话不存在。')
  const previewEvents = await readSessionEvents(previewSession)
  const previewState = replaySimulationEvents(parseSimulationState(previewSession.initialStateJson), previewEvents)
  const previewStateHash = await hashStateJson(JSON.stringify(previewState))
  return db.transaction('rw', db.simulationSessions, db.simulationEvents, async () => {
    const session = await db.simulationSessions.get(input.sessionId)
    if (!session) throw new Error('模拟会话不存在。')
    const events = await readSessionEvents(session)
    const prior = events.find(event => event.commandId === commandId)
    if (prior) {
      const payload = parseEventPayload(prior)
      if (prior.type !== 'narrative.choice.committed' || payload.choiceKey !== choiceKey
        || prior.baseSequence !== input.baseSequence || prior.baseStateHash !== baseStateHash) {
        throw new Error('选择 commandId 已被不同命令使用。')
      }
      return prior
    }
    if (session.status !== 'active') throw new Error('只有 active 会话可以提交选择。')
    const state = replaySimulationEvents(parseSimulationState(session.initialStateJson), events)
    if (state.lastSequence !== input.baseSequence) throw new Error('叙事分支已变化，请刷新后重试。')
    if (previewSession.id !== session.id || previewState.lastSequence !== state.lastSequence
      || previewStateHash !== baseStateHash) throw new Error('叙事状态已变化，请刷新后重试。')
    const narrative = state.narrative
    if (!narrative || narrative.version !== 2 || narrative.completed || !narrative.currentNodeKey) {
      throw new Error('当前会话没有可提交选择的 GameRelease 叙事。')
    }
    if (!narrative.availableChoiceKeys?.includes(choiceKey)) throw new Error('所选 Choice 当前不可用。')
    const choice = narrative.choices?.find(item => item.choiceKey === choiceKey)
    if (!choice || choice.sourceNodeKey !== narrative.currentNodeKey) throw new Error('所选 Choice 不属于当前节点。')
    if (session.kind === 'avg') {
      const nodeBeats = (narrative.beats ?? []).filter(beat => beat.nodeKey === narrative.currentNodeKey)
        .sort((a, b) => a.order - b.order || a.beatKey.localeCompare(b.beatKey))
      const reachedIndex = state.presentation?.currentNodeKey === narrative.currentNodeKey && state.presentation.currentBeatKey
        ? nodeBeats.findIndex(beat => beat.beatKey === state.presentation!.currentBeatKey)
        : -1
      const unread = nodeBeats.slice(reachedIndex + 1)
      if (unread.length) throw new Error('[avg] 必须先读完当前节点的全部 Beat 才能选择。')
    }
    const adventureActionTags = choice.tags.filter(tag => tag.startsWith('adventure-action:'))
    if ((session.kind === 'textadventure' || session.kind === 'textworld') && adventureActionTags.length) {
      if (adventureActionTags.length !== 1 || !state.adventure) {
        throw new Error('[adventure] Narrative Choice 公共行动绑定无效。')
      }
      const actionKey = adventureActionTags[0].slice('adventure-action:'.length)
      const requiredCommandId = adventureNarrativeActionCommandId(session.id!, choiceKey)
      if (!state.adventure.actionHistory.some(item => (
        item.actionKey === actionKey && item.commandId === requiredCommandId
      ))) {
        throw new Error('[adventure] Narrative Choice 必须先通过公共 Adventure 行动桥接。')
      }
    }
    const event: SimulationEvent = {
      projectId: session.projectId,
      worldGroupId: session.worldGroupId ?? null,
      sessionId: input.sessionId,
      sequence: state.lastSequence + 1,
      type: 'narrative.choice.committed',
      actorKey: null,
      targetKey: choice.targetNodeKey,
      commandId,
      baseSequence: input.baseSequence,
      baseStateHash,
      payloadJson: JSON.stringify({
        commandId,
        baseSequence: input.baseSequence,
        baseStateHash,
        fromNodeKey: narrative.currentNodeKey,
        choiceKey,
        toNodeKey: choice.targetNodeKey,
      }),
      createdAt: Date.now(),
    }
    let projected = applySimulationEvent(state, event)
    event.id = await db.simulationEvents.add(event) as number
    const enteredEvent: SimulationEvent = {
      projectId: session.projectId,
      worldGroupId: session.worldGroupId ?? null,
      sessionId: input.sessionId,
      sequence: event.sequence + 1,
      type: 'narrative.node.entered',
      actorKey: null,
      targetKey: choice.targetNodeKey,
      payloadJson: JSON.stringify({ nodeKey: choice.targetNodeKey, causeSequence: event.sequence }),
      createdAt: event.createdAt,
    }
    projected = applySimulationEvent(projected, enteredEvent)
    enteredEvent.id = await db.simulationEvents.add(enteredEvent) as number
    let lastEvent = enteredEvent
    if (projected.narrative?.completed) {
      const endingEvent: SimulationEvent = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: input.sessionId,
        sequence: enteredEvent.sequence + 1,
        type: 'narrative.ending.reached',
        actorKey: null,
        targetKey: choice.targetNodeKey,
        payloadJson: JSON.stringify({ endingKey: choice.targetNodeKey, enteredSequence: enteredEvent.sequence }),
        createdAt: event.createdAt,
      }
      applySimulationEvent(projected, endingEvent)
      endingEvent.id = await db.simulationEvents.add(endingEvent) as number
      lastEvent = endingEvent
    }
    await db.simulationSessions.update(input.sessionId, { updatedAt: lastEvent.createdAt })
    return event
  })
}

function adventureNarrativeActionCommandId(sessionId: number, choiceKey: string): string {
  return normalizeCommandId(`choice-action:${sessionId}:${choiceKey}`)
}

function adventureNarrativeChoiceCommandId(sessionId: number, choiceKey: string): string {
  return normalizeCommandId(`choice-commit:${sessionId}:${choiceKey}`)
}

/**
 * Executes the deliberately small Narrative -> Adventure public-action bridge.
 * Both phases use stable command ids, so a crash between the action and the
 * choice is recoverable by calling this function again without duplicating an
 * item, quest effect, or ending transition.
 */
export async function commitAdventureNarrativeChoice(input: {
  sessionId: number
  choiceKey: string
  commandId?: string
}): Promise<SimulationEvent> {
  const choiceKey = input.choiceKey.trim()
  if (!choiceKey) throw new Error('[adventure] Narrative Choice key 不能为空。')
  const session = await db.simulationSessions.get(input.sessionId)
  if (!session || (session.kind !== 'textadventure' && session.kind !== 'textworld') || session.gameReleaseId == null) {
    throw new Error('[adventure] 正式文字冒险实例不存在。')
  }
  const bridgeChoiceCommandId = adventureNarrativeChoiceCommandId(session.id!, choiceKey)
  const existingEvents = await readSessionEvents(session)
  let state = replaySimulationEvents(parseSimulationState(session.initialStateJson), existingEvents)
  const choice = state.narrative?.choices?.find(item => item.choiceKey === choiceKey)
  if (!choice || choice.sourceNodeKey !== state.narrative?.currentNodeKey) {
    const prior = existingEvents.find(event => {
      if (event.type !== 'narrative.choice.committed') return false
      const payload = parseEventPayload(event)
      return payload.choiceKey === choiceKey && (event.commandId === bridgeChoiceCommandId
        || (input.commandId != null && event.commandId === normalizeCommandId(input.commandId)))
    })
    if (prior) return prior
    throw new Error('[adventure] Narrative Choice 不属于当前节点。')
  }
  const actionTags = choice.tags.filter(tag => tag.startsWith('adventure-action:'))
  if (actionTags.length > 1) throw new Error('[adventure] Narrative Choice 只能绑定一个公共行动。')
  const choiceCommandId = actionTags.length === 1
    ? bridgeChoiceCommandId
    : normalizeCommandId(input.commandId ?? '')
  const priorChoice = existingEvents.find(event => event.commandId === choiceCommandId)
  if (priorChoice) {
    const payload = parseEventPayload(priorChoice)
    if (priorChoice.type !== 'narrative.choice.committed' || payload.choiceKey !== choiceKey) {
      throw new Error('[adventure] Narrative Choice commandId 已被不同命令使用。')
    }
    return priorChoice
  }
  if (actionTags.length === 1) {
    const actionKey = actionTags[0].slice('adventure-action:'.length)
    const release = await assertGameReleaseUnchanged(session.gameReleaseId)
    const manifest = parseAnyGameReleaseManifest(release.manifestJson)
    if (manifest.productType !== 'text-adventure' && manifest.productType !== 'text-open-world') throw new Error('[adventure] 实例发布绑定无效。')
    const action = manifest.adventure.actions.find(item => item.key === actionKey)
    if (!action || action.narrativeChoiceKey !== choiceKey) {
      throw new Error('[adventure] Narrative Choice 没有有效的冻结公共行动绑定。')
    }
    const actionCommandId = adventureNarrativeActionCommandId(session.id!, choiceKey)
    if (!state.adventure?.actionHistory.some(item => (
      item.actionKey === actionKey && item.commandId === actionCommandId
    ))) {
      const baseStateHash = await hashStateJson(JSON.stringify(state))
      await commitAdventureAction({
        sessionId: session.id!,
        actionKey,
        commandId: actionCommandId,
        baseSequence: state.lastSequence,
        baseStateHash,
      })
      state = await readSimulationState(session.id!)
    }
  }
  const baseStateHash = await hashStateJson(JSON.stringify(state))
  return commitNarrativeChoice({
    sessionId: session.id!,
    choiceKey,
    commandId: choiceCommandId,
    baseSequence: state.lastSequence,
    baseStateHash,
  })
}

export async function configureChatSession(input: {
  sessionId: number
  characterKey: string
  identity: SimulationChatIdentity
  scene: SimulationChatScene
  baseSequence?: number
}): Promise<SimulationEvent> {
  void input
  throw new Error('CHATGAME-1 已进入只读兼容；新配置必须从 character-interaction GameRelease 启动。')
}

export async function appendChatMessage(input: {
  sessionId: number
  text: string
}): Promise<SimulationEvent> {
  void input
  throw new Error('CHATGAME-1 已进入只读兼容；新消息必须使用 CHATGAME-2 互动命令。')
}

export async function appendChatReply(input: {
  sessionId: number
  replyToSequence: number
  text: string
  baseSequence: number
  supersedesSequence?: number | null
}): Promise<SimulationEvent> {
  void input
  throw new Error('CHATGAME-1 已进入只读兼容；新回复必须由 Instance Harness 候选经 CHATGAME-2 命令采用。')
}

function proposalSequenceFromResolution(event: SimulationEvent): number | null {
  if (
    event.type !== 'npc.evolution.accepted'
    && event.type !== 'npc.evolution.rejected'
  ) return null
  const payload = parseEventPayload(event)
  return Number.isInteger(payload.proposalSequence) ? Number(payload.proposalSequence) : null
}

export function readPendingNpcEvolutionProposals(
  events: readonly SimulationEvent[],
): SimulationNpcEvolutionProposal[] {
  const resolved = new Set(events.flatMap(event => {
    const sequence = proposalSequenceFromResolution(event)
    return sequence == null ? [] : [sequence]
  }))
  return events
    .filter(event => event.type === 'npc.evolution.proposed' && !resolved.has(event.sequence))
    .map(event => ({
      ...parseSimulationNpcEvolutionCandidate(parseEventPayload(event).candidate),
      proposalSequence: event.sequence,
    }))
    .sort((left, right) => left.proposalSequence - right.proposalSequence)
}

export async function appendNpcEvolutionProposal(input: {
  sessionId: number
  candidate: SimulationNpcEvolutionCandidate
}): Promise<SimulationEvent> {
  const candidate = parseSimulationNpcEvolutionCandidate(input.candidate)
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== 'npc-evolution') {
      throw new Error('NPC 演进候选只能写入 NPC 演进会话。')
    }
    if (candidate.baseSequence !== state.lastSequence) {
      throw new Error('NPC 演进生成期间会话已变化，请重新生成。')
    }
    prepareNpcEvolution(state, candidate)
    return {
      type: 'npc.evolution.proposed',
      actorKey: candidate.entityKey,
      targetKey: candidate.entityKey,
      payloadJson: JSON.stringify({ candidate }),
    }
  })
}

export async function acceptNpcEvolutionProposal(input: {
  sessionId: number
  proposalSequence: number
}): Promise<SimulationEvent> {
  return appendBuiltEvent(input.sessionId, ({ session, state, events }) => {
    if (session.kind !== 'npc-evolution') throw new Error('当前不是 NPC 演进会话。')
    const proposal = events.find(event => (
      event.sequence === input.proposalSequence
      && event.type === 'npc.evolution.proposed'
    ))
    if (!proposal) throw new Error('NPC 演进提案不存在。')
    if (events.some(event => proposalSequenceFromResolution(event) === input.proposalSequence)) {
      throw new Error('NPC 演进提案已经处理。')
    }
    if (state.lastSequence !== input.proposalSequence) {
      throw new Error('NPC 演进候选已过期，请重新生成。')
    }
    const candidate = parseSimulationNpcEvolutionCandidate(parseEventPayload(proposal).candidate)
    return {
      type: 'npc.evolution.accepted',
      actorKey: candidate.entityKey,
      targetKey: candidate.entityKey,
      payloadJson: JSON.stringify({ proposalSequence: input.proposalSequence, candidate }),
    }
  })
}

export async function rejectNpcEvolutionProposal(input: {
  sessionId: number
  proposalSequence: number
  reason?: string
}): Promise<SimulationEvent> {
  const reason = input.reason?.trim() ?? ''
  if (reason.length > 1_000) throw new Error('NPC 演进拒绝原因过长。')
  return appendBuiltEvent(input.sessionId, ({ session, events }) => {
    if (session.kind !== 'npc-evolution') throw new Error('当前不是 NPC 演进会话。')
    const proposal = events.find(event => (
      event.sequence === input.proposalSequence
      && event.type === 'npc.evolution.proposed'
    ))
    if (!proposal) throw new Error('NPC 演进提案不存在。')
    if (events.some(event => proposalSequenceFromResolution(event) === input.proposalSequence)) {
      throw new Error('NPC 演进提案已经处理。')
    }
    return {
      type: 'npc.evolution.rejected',
      actorKey: proposal.actorKey ?? null,
      targetKey: proposal.targetKey ?? null,
      payloadJson: JSON.stringify({ proposalSequence: input.proposalSequence, reason }),
    }
  })
}

function hash32(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  hash ^= hash >>> 16
  return hash >>> 0
}

function deterministicDie(seed: string, sides: number): number {
  let value = hash32(seed)
  value += 0x6d2b79f5
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return ((value ^ (value >>> 14)) >>> 0) % sides + 1
}

function parseDiceExpression(expression: string): {
  normalized: string
  count: number
  sides: number
  modifier: number
} {
  const match = expression.trim().toLowerCase().match(/^(\d{1,3})d(\d{1,4})(?:([+-])(\d{1,7}))?$/)
  if (!match) throw new Error('骰式必须是 NdM±K，例如 1d20+3。')
  const count = assertFiniteInteger(Number(match[1]), '骰子数量', 1, 100)
  const sides = assertFiniteInteger(Number(match[2]), '骰子面数', 2, 1_000)
  const rawModifier = match[4] ? Number(match[4]) : 0
  const modifier = match[3] === '-' ? -rawModifier : rawModifier
  if (Math.abs(modifier) > 1_000_000) throw new Error('骰式修正值过大。')
  const normalized = `${count}d${sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ''}`
  return { normalized, count, sides, modifier }
}

function assertDiceResolution(value: unknown): DiceResolution {
  if (!isObject(value)) throw new Error('随机判定结果必须是对象。')
  const parsed = parseDiceExpression(String(value.expression ?? ''))
  if (!Array.isArray(value.dice) || value.dice.length !== parsed.count) {
    throw new Error('随机判定骰子数量与骰式不一致。')
  }
  const dice = value.dice.map(die => assertFiniteInteger(die, '骰子点数', 1, parsed.sides))
  const modifier = Number(value.modifier)
  const total = Number(value.total)
  if (modifier !== parsed.modifier || total !== dice.reduce((sum, die) => sum + die, modifier)) {
    throw new Error('随机判定合计与骰式不一致。')
  }
  return {
    expression: parsed.normalized,
    dice,
    modifier,
    total,
    nonce: String(value.nonce ?? ''),
  }
}

function buildDiceResolution(input: {
  seed: string
  sequence: number
  expression: ReturnType<typeof parseDiceExpression>
  nonce: string
}): DiceResolution {
  const dice = Array.from({ length: input.expression.count }, (_, index) => (
    deterministicDie(
      `${input.seed}\u0000${input.sequence}\u0000${input.expression.normalized}\u0000${input.nonce}\u0000${index}`,
      input.expression.sides,
    )
  ))
  return {
    expression: input.expression.normalized,
    dice,
    modifier: input.expression.modifier,
    total: dice.reduce((sum, die) => sum + die, input.expression.modifier),
    nonce: input.nonce,
  }
}

export async function resolveSimulationDice(input: {
  sessionId: number
  expression: string
  nonce?: string
  actorKey?: string | null
  targetKey?: string | null
}): Promise<SimulationEvent> {
  const parsed = parseDiceExpression(input.expression)
  const nonce = input.nonce?.trim() ?? ''
  if (nonce.length > 200) throw new Error('随机判定 nonce 过长。')
  return appendBuiltEvent(input.sessionId, ({ session, sequence }) => {
    const resolution = buildDiceResolution({ seed: session.seed, sequence, expression: parsed, nonce })
    return {
      type: 'random.resolved',
      actorKey: input.actorKey ?? null,
      targetKey: input.targetKey ?? null,
      payloadJson: JSON.stringify(resolution),
    }
  })
}

export interface AdventureCommandEnvelope {
  sessionId: number
  commandId: string
  baseSequence: number
  baseStateHash: string
  actionKey: string
}

function adventureEvent(
  session: SimulationSession,
  sequence: number,
  type: SimulationEventType,
  payload: Record<string, unknown>,
  envelope?: Pick<AdventureCommandEnvelope, 'commandId' | 'baseSequence' | 'baseStateHash'>,
): SimulationEvent {
  return {
    projectId: session.projectId,
    worldGroupId: session.worldGroupId ?? null,
    sessionId: session.id!,
    sequence,
    type,
    actorKey: 'player',
    targetKey: null,
    commandId: envelope?.commandId ?? null,
    baseSequence: envelope?.baseSequence ?? null,
    baseStateHash: envelope?.baseStateHash ?? null,
    payloadJson: JSON.stringify(payload),
    createdAt: Date.now(),
  }
}

function adventureEffectsForOutcome(
  action: import('../types').AdventureActionDefinition,
  outcome: import('../types').AdventureCheckOutcome,
) {
  return outcome === 'success' ? action.successEffects
    : outcome === 'costly-success' ? action.costlySuccessEffects : action.failureEffects
}

function adventureTextForOutcome(
  action: import('../types').AdventureActionDefinition,
  outcome: import('../types').AdventureCheckOutcome,
): string {
  return outcome === 'success' ? action.successText
    : outcome === 'costly-success' ? action.costlySuccessText : action.failureText
}

async function buildAdventureInteractionStateHashes(input: {
  state: SimulationRuntimeState
  session: SimulationSession
  action: import('../types').AdventureActionDefinition
  commandId: string
}): Promise<string[]> {
  if (input.action.kind !== 'talk') return []
  const binding = input.action.interaction
  const interaction = input.state.interaction
  if (!binding || !interaction) throw new Error('[adventure] talk 行动缺少共享角色互动状态。')
  const scene = interaction.sceneTemplates.find(item => item.sceneKey === binding.sceneKey)
  const rule = scene?.relationshipRules.find(item => item.ruleKey === binding.ruleKey)
  if (!scene || !rule) throw new Error('[adventure] talk 行动的冻结互动绑定无效。')
  let projected = structuredClone(input.state)
  const sceneId = `scene:${binding.sceneKey}:${projected.lastSequence + 1}`
  const descriptors: Array<{ type: SimulationEventType; payload: Record<string, unknown> }> = [
    { type: 'interaction.scene.started', payload: { sceneId, sceneKey: binding.sceneKey } },
    {
      type: 'interaction.player.message.committed',
      payload: {
        messageId: `message:${binding.ruleKey}:${projected.lastSequence + 2}`,
        text: rule.playerText,
        audienceKeys: null,
      },
    },
    {
      type: 'interaction.relationship.changed',
      payload: {
        fromParticipantKey: rule.fromParticipantKey,
        toParticipantKey: rule.toParticipantKey,
        dimensionKey: rule.dimensionKey,
        delta: rule.delta,
        reason: rule.reason,
        ruleKey: rule.ruleKey,
        sourceEventSequence: projected.lastSequence + 2,
        significantEventKey: rule.significantEventKey,
      },
    },
    { type: 'interaction.scene.ended', payload: { sceneId, reason: `adventure-action:${input.action.key}` } },
  ]
  const hashes: string[] = []
  for (const descriptor of descriptors) {
    const baseStateHash = await hashStateJson(JSON.stringify(projected))
    hashes.push(baseStateHash)
    const sequence = projected.lastSequence + 1
    const envelope = {
      commandId: `${input.commandId.slice(0, 150)}:interaction:${sequence}`,
      baseSequence: projected.lastSequence,
      baseStateHash,
    }
    projected = applySimulationEvent(projected, adventureEvent(
      input.session,
      sequence,
      descriptor.type,
      { ...descriptor.payload, ...envelope },
      envelope,
    ))
  }
  return hashes
}

/**
 * TEXTADV-1 authoritative write path. A command expands into small domain
 * events inside one Dexie transaction; no UI or Harness candidate may submit
 * those events directly.
 */
export async function commitAdventureAction(input: AdventureCommandEnvelope): Promise<SimulationEvent> {
  const commandId = normalizeCommandId(input.commandId)
  const actionKey = input.actionKey.trim()
  if (!actionKey || actionKey.length > 160) throw new Error('[adventure] 行动 key 无效。')
  if (!Number.isInteger(input.baseSequence) || input.baseSequence < 0) throw new Error('[adventure] baseSequence 无效。')
  if (!/^[a-f0-9]{64}$/.test(input.baseStateHash)) throw new Error('[adventure] baseStateHash 无效。')
  const previewSession = await db.simulationSessions.get(input.sessionId)
  if (!previewSession || (previewSession.kind !== 'textadventure' && previewSession.kind !== 'textworld') || previewSession.gameReleaseId == null) {
    throw new Error('[adventure] 正式文字冒险实例不存在。')
  }
  const [previewEvents, release] = await Promise.all([
    readSessionEvents(previewSession),
    assertGameReleaseUnchanged(previewSession.gameReleaseId),
  ])
  const previewPrior = previewEvents.find(event => event.commandId === commandId)
  if (previewPrior) {
    const body = parseEventPayload(previewPrior)
    if (previewPrior.type !== 'adventure.action.committed' || body.actionKey !== actionKey
      || previewPrior.baseSequence !== input.baseSequence || previewPrior.baseStateHash !== input.baseStateHash) {
      throw new Error('[adventure] commandId 已被不同命令使用。')
    }
    return previewPrior
  }
  const previewState = replaySimulationEvents(parseSimulationState(previewSession.initialStateJson), previewEvents)
  const previewStateHash = await hashStateJson(JSON.stringify(previewState))
  const manifest = parseAnyGameReleaseManifest(release.manifestJson)
  if ((manifest.productType !== 'text-adventure' && manifest.productType !== 'text-open-world') || !previewState.adventure
    || previewState.adventure.contentHash !== release.contentHash) {
    throw new Error('[adventure] 实例发布绑定无效。')
  }
  const previewAvailable = availableAdventureActions(
    manifest.adventure,
    previewState.adventure,
    previewState.narrative?.variables,
  ).find(item => item.action.key === actionKey)
  if (!previewAvailable?.available) {
    throw new Error(previewAvailable?.reason || '[adventure] 行动不在当前位置或前置条件未满足。')
  }
  if (previewSession.kind === 'textworld' && previewAvailable.action.kind === 'move') {
    throw new Error('[textworld] 区域移动只能通过开放世界交通命令提交。')
  }
  const interactionStateHashes = await buildAdventureInteractionStateHashes({
    state: previewState,
    session: previewSession,
    action: previewAvailable.action,
    commandId,
  })
  return db.transaction('rw', db.simulationSessions, db.simulationEvents, db.gameReleases, db.worldReleases, async () => {
    const session = await db.simulationSessions.get(input.sessionId)
    if (!session || (session.kind !== 'textadventure' && session.kind !== 'textworld') || session.gameReleaseId == null) throw new Error('[adventure] 正式文字冒险实例不存在。')
    const events = await readSessionEvents(session)
    const prior = events.find(event => event.commandId === commandId)
    if (prior) {
      const body = parseEventPayload(prior)
      if (prior.type !== 'adventure.action.committed' || body.actionKey !== actionKey
        || prior.baseSequence !== input.baseSequence || prior.baseStateHash !== input.baseStateHash) {
        throw new Error('[adventure] commandId 已被不同命令使用。')
      }
      return prior
    }
    if (session.status !== 'active') throw new Error('[adventure] 只有 active 实例可以行动。')
    let projected = replaySimulationEvents(parseSimulationState(session.initialStateJson), events)
    if (projected.lastSequence !== input.baseSequence) throw new Error('[adventure] 冒险状态已变化，请刷新后重试。')
    if (previewSession.gameReleaseId !== session.gameReleaseId || previewState.lastSequence !== projected.lastSequence
      || previewStateHash !== input.baseStateHash) throw new Error('[adventure] 冒险状态哈希已变化。')
    if ((manifest.productType !== 'text-adventure' && manifest.productType !== 'text-open-world') || !projected.adventure || projected.adventure.contentHash !== release.contentHash) {
      throw new Error('[adventure] 实例发布绑定无效。')
    }
    const available = availableAdventureActions(manifest.adventure, projected.adventure, projected.narrative?.variables)
      .find(item => item.action.key === actionKey)
    if (!available?.available) throw new Error(available?.reason || '[adventure] 行动不在当前位置或前置条件未满足。')
    const action = available.action
    if (session.kind === 'textworld' && action.kind === 'move') {
      throw new Error('[textworld] 区域移动只能通过开放世界交通命令提交。')
    }
    if (action.kind === 'talk') {
      const binding = action.interaction
      if (!binding || !projected.interaction) throw new Error('[adventure] talk 行动缺少共享角色互动状态。')
      const scene = projected.interaction.sceneTemplates.find(item => item.sceneKey === binding.sceneKey)
      const rule = scene?.relationshipRules.find(item => item.ruleKey === binding.ruleKey)
      if (!scene || !scene.participantKeys.includes(binding.participantKey) || !rule
        || rule.fromParticipantKey !== binding.participantKey) {
        throw new Error('[adventure] talk 行动的冻结互动绑定无效。')
      }
      if (projected.interaction.activeScene) throw new Error('[adventure] 请先结束当前角色互动场景。')
    }
    let outcome: import('../types').AdventureCheckOutcome = 'success'
    let evidence: import('../types').AdventureCheckEvidence | null = null
    const remainingInteractionStateHashes = [...interactionStateHashes]
    const nextSequence = () => projected.lastSequence + 1
    const append = async (type: SimulationEventType, payload: Record<string, unknown>, envelope?: boolean) => {
      const interactionEnvelope = type.startsWith('interaction.') ? {
        commandId: `${commandId.slice(0, 150)}:interaction:${nextSequence()}`,
        baseSequence: projected.lastSequence,
        baseStateHash: remainingInteractionStateHashes.shift() ?? (() => { throw new Error('[adventure] 互动状态哈希预算不足。') })(),
      } : null
      const selectedEnvelope = interactionEnvelope ?? (envelope ? {
        commandId, baseSequence: input.baseSequence, baseStateHash: input.baseStateHash,
      } : undefined)
      const event = adventureEvent(
        session,
        nextSequence(),
        type,
        interactionEnvelope ? { ...payload, ...interactionEnvelope } : payload,
        selectedEnvelope,
      )
      projected = applySimulationEvent(projected, event)
      event.id = await db.simulationEvents.add(event) as number
      return event
    }
    if (action.kind === 'talk') {
      const binding = action.interaction!
      const scene = projected.interaction!.sceneTemplates.find(item => item.sceneKey === binding.sceneKey)!
      const rule = scene.relationshipRules.find(item => item.ruleKey === binding.ruleKey)!
      const sceneId = `scene:${binding.sceneKey}:${nextSequence()}`
      await append('interaction.scene.started', { sceneId, sceneKey: binding.sceneKey })
      const message = await append('interaction.player.message.committed', {
        messageId: `message:${binding.ruleKey}:${nextSequence()}`,
        text: rule.playerText,
        audienceKeys: null,
      })
      await append('interaction.relationship.changed', {
        fromParticipantKey: rule.fromParticipantKey,
        toParticipantKey: rule.toParticipantKey,
        dimensionKey: rule.dimensionKey,
        delta: rule.delta,
        reason: rule.reason,
        ruleKey: rule.ruleKey,
        sourceEventSequence: message.sequence,
        significantEventKey: rule.significantEventKey,
      })
      await append('interaction.scene.ended', { sceneId, reason: `adventure-action:${action.key}` })
    }
    if (action.rule.kind === 'threshold') {
      const total = projected.adventure.abilities[action.rule.abilityKey]
      outcome = total >= action.rule.difficulty ? 'success' : 'failure'
      evidence = { eventSequence: nextSequence(), actionKey, abilityKey: action.rule.abilityKey, mode: 'threshold', expression: null, dice: [], modifier: total, total, difficulty: action.rule.difficulty, outcome }
    } else if (action.rule.kind === 'random') {
      const expression = parseDiceExpression(action.rule.expression)
      const ability = projected.adventure.abilities[action.rule.abilityKey]
      if (ability == null) throw new Error(`[adventure] 能力不存在:${action.rule.abilityKey}`)
      const dice = buildDiceResolution({ seed: session.seed, sequence: nextSequence(), expression, nonce: `adventure:${commandId}:${actionKey}` })
      const total = dice.total + ability
      outcome = total >= action.rule.difficulty ? 'success'
        : action.rule.costlySuccessFloor != null && total >= action.rule.costlySuccessFloor ? 'costly-success' : 'failure'
      evidence = { eventSequence: nextSequence(), actionKey, abilityKey: action.rule.abilityKey, mode: 'random', expression: dice.expression, dice: dice.dice, modifier: dice.modifier + ability, total, difficulty: action.rule.difficulty, outcome }
    } else if (action.rule.kind === 'resource-payment') {
      const total = projected.adventure.resources[action.rule.resourceKey]
      outcome = total >= action.rule.amount ? 'success' : 'not-attempted'
      evidence = { eventSequence: nextSequence(), actionKey, abilityKey: null, mode: 'resource-payment', expression: null, dice: [], modifier: 0, total, difficulty: action.rule.amount, outcome }
    }
    if (evidence) await append('adventure.check.resolved', { evidence })
    const effects = outcome === 'not-attempted' ? [] : [
      ...(action.rule.kind === 'resource-payment'
        ? [{ op: 'change-resource' as const, resourceKey: action.rule.resourceKey, delta: -action.rule.amount }]
        : []),
      ...adventureEffectsForOutcome(action, outcome),
    ]
    // Preflight all effects against a pure clone before the first mutating event.
    applyAdventureEffects(manifest.adventure, projected.adventure, effects, nextSequence())
    for (const effect of effects) {
      if (effect.op === 'enter-location') {
        await append('adventure.location.left', { locationKey: projected.adventure!.currentLocationKey })
        await append('adventure.location.entered', { locationKey: effect.locationKey })
      } else if (effect.op === 'gain-item') await append('adventure.item.gained', effect)
      else if (effect.op === 'remove-item') await append('adventure.item.used', effect)
      else if (effect.op === 'transfer-item') await append('adventure.item.transferred', effect)
      else if (effect.op === 'change-item-state') await append('adventure.item.state-changed', effect)
      else if (effect.op === 'change-resource') {
        const definition = manifest.adventure.resources.find(item => item.key === effect.resourceKey)!
        const before = projected.adventure!.resources[effect.resourceKey]
        const after = Math.max(definition.minimum, Math.min(definition.maximum, before + effect.delta))
        if (after !== before + effect.delta) throw new Error(`[adventure] 资源越界:${effect.resourceKey}`)
        await append('adventure.resource.changed', { resourceKey: effect.resourceKey, before, after, delta: effect.delta })
      } else if (effect.op === 'change-ability') {
        const definition = manifest.adventure.abilities.find(item => item.key === effect.abilityKey)!
        const before = projected.adventure!.abilities[effect.abilityKey]
        const after = before + effect.delta
        if (after < definition.minimum || after > definition.maximum) throw new Error(`[adventure] 能力越界:${effect.abilityKey}`)
        await append('adventure.ability.changed', { abilityKey: effect.abilityKey, before, after, delta: effect.delta })
      } else if (effect.op === 'apply-condition') await append('adventure.condition.applied', effect)
      else if (effect.op === 'remove-condition') await append('adventure.condition.removed', effect)
      else if (effect.op === 'accept-quest') await append('adventure.quest.accepted', effect)
      else if (effect.op === 'fail-quest') await append('adventure.quest.failed', effect)
      else {
        await append('adventure.quest.objective-updated', effect)
        const quest = projected.adventure!.quests.find(item => item.questKey === effect.questKey)!
        if (quest.status === 'active' && quest.objectives.filter(item => !item.optional).every(item => item.completed)) {
          await append('adventure.quest.completed', { questKey: effect.questKey })
          const reward = manifest.adventure.quests.find(item => item.key === effect.questKey)!.rewardEffects
          for (const rewardEffect of reward) {
            if (rewardEffect.op !== 'gain-item' && rewardEffect.op !== 'change-resource'
              && rewardEffect.op !== 'change-ability' && rewardEffect.op !== 'apply-condition') {
              throw new Error('[adventure] 首期任务奖励只支持物品、资源、能力或状态。')
            }
            if (rewardEffect.op === 'gain-item') await append('adventure.item.gained', rewardEffect)
            else if (rewardEffect.op === 'apply-condition') await append('adventure.condition.applied', rewardEffect)
            else if (rewardEffect.op === 'change-ability') {
              const definition = manifest.adventure.abilities.find(item => item.key === rewardEffect.abilityKey)!
              const before = projected.adventure!.abilities[rewardEffect.abilityKey]
              const after = before + rewardEffect.delta
              if (after < definition.minimum || after > definition.maximum) throw new Error(`[adventure] 奖励能力越界:${rewardEffect.abilityKey}`)
              await append('adventure.ability.changed', { abilityKey: rewardEffect.abilityKey, before, after, delta: rewardEffect.delta })
            }
            else {
              const definition = manifest.adventure.resources.find(item => item.key === rewardEffect.resourceKey)!
              const before = projected.adventure!.resources[rewardEffect.resourceKey]
              const after = before + rewardEffect.delta
              if (after < definition.minimum || after > definition.maximum) throw new Error(`[adventure] 奖励资源越界:${rewardEffect.resourceKey}`)
              await append('adventure.resource.changed', { resourceKey: rewardEffect.resourceKey, before, after, delta: rewardEffect.delta })
            }
          }
        }
      }
    }
    await append('adventure.narrative.synced', {
      projection: adventureNarrativeProjection(projected.adventure!),
    })
    const narrative = outcome === 'not-attempted' ? action.unavailableText : adventureTextForOutcome(action, outcome)
    const committed = await append('adventure.action.committed', { commandId, actionKey, kind: action.kind, outcome, narrative, repeatable: action.repeatable }, true)
    await db.simulationSessions.update(session.id!, { updatedAt: Date.now() })
    return committed
  })
}

function assertTtrpgActor(state: SimulationRuntimeState, actorKey: string): void {
  const actor = state.entities[actorKey]
  if (!actor || !['player', 'character', 'npc'].includes(actor.kind)) {
    throw new Error(`跑团行动者不存在或类型不支持: ${actorKey}`)
  }
  const ttrpg = state.ttrpg
  if (!ttrpg?.scene || ttrpg.scene.status !== 'active') throw new Error('请先开始一个跑团场景。')
  if (!ttrpg.turnOrder.includes(actorKey)) throw new Error('行动者不在当前回合顺序中。')
  if (ttrpg.activeActorKey !== actorKey) throw new Error('当前还没轮到该行动者。')
}

export async function openTtrpgScene(input: {
  sessionId: number
  title: string
  description: string
  locationKey?: string | null
  turnOrder: string[]
}): Promise<SimulationEvent> {
  const title = input.title.trim()
  const description = input.description.trim()
  const turnOrder = [...new Set(input.turnOrder.map(key => key.trim()).filter(Boolean))]
  if (!title || title.length > 200) throw new Error('跑团场景标题无效。')
  if (description.length > 8_000) throw new Error('跑团场景描述过长。')
  if (turnOrder.length === 0) throw new Error('跑团场景至少需要一个行动者。')
  const scene: SimulationTtrpgScene = {
    sceneId: globalThis.crypto?.randomUUID?.() ?? `scene-${Date.now()}-${Math.random()}`,
    title,
    description,
    locationKey: input.locationKey?.trim() || null,
    status: 'active',
  }
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== 'ttrpg') throw new Error('只有跑团会话可以开始场景。')
    for (const actorKey of turnOrder) {
      const actor = state.entities[actorKey]
      if (!actor || !['player', 'character', 'npc'].includes(actor.kind)) {
        throw new Error(`跑团行动者不存在或类型不支持: ${actorKey}`)
      }
    }
    if (scene.locationKey != null) {
      const location = state.entities[scene.locationKey]
      if (!location || location.kind !== 'location') throw new Error(`跑团场景地点不存在: ${scene.locationKey}`)
    }
    return {
      type: 'ttrpg.scene.opened',
      actorKey: turnOrder[0],
      targetKey: scene.locationKey,
      payloadJson: JSON.stringify({ scene, turnOrder }),
    }
  })
}

export async function resolveTtrpgCheck(input: {
  sessionId: number
  actorKey: string
  skill: string
  expression: string
  dc: number
  nonce?: string
}): Promise<SimulationEvent> {
  const actorKey = input.actorKey.trim()
  const skill = input.skill.trim()
  const parsed = parseDiceExpression(input.expression)
  const dc = assertFiniteInteger(input.dc, '检定难度', 0, 1_000)
  const nonce = input.nonce?.trim() || `check:${skill}`
  if (!skill || skill.length > 120) throw new Error('检定技能无效。')
  if (nonce.length > 200) throw new Error('检定 nonce 过长。')
  return appendBuiltEvent(input.sessionId, ({ session, state, sequence }) => {
    if (session.kind !== 'ttrpg') throw new Error('只有跑团会话可以进行技能检定。')
    assertTtrpgActor(state, actorKey)
    const resolution = buildDiceResolution({ seed: session.seed, sequence, expression: parsed, nonce })
    return {
      type: 'ttrpg.check.resolved',
      actorKey,
      targetKey: actorKey,
      payloadJson: JSON.stringify({
        check: {
          actorKey,
          skill,
          expression: resolution.expression,
          dice: resolution.dice,
          modifier: resolution.modifier,
          total: resolution.total,
          dc,
          success: resolution.total >= dc,
        },
      }),
    }
  })
}

export function parseSimulationTtrpgEncounterCandidate(value: unknown): SimulationTtrpgEncounterCandidate {
  if (!isObject(value)) throw new Error('跑团遭遇候选必须是对象。')
  const allowed = new Set(['baseSequence', 'title', 'description', 'participantKeys'])
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (unknown.length) throw new Error(`跑团遭遇候选包含未知字段: ${unknown.join(', ')}`)
  const baseSequence = assertFiniteInteger(value.baseSequence, '遭遇候选基线序号', 0, Number.MAX_SAFE_INTEGER)
  const title = String(value.title ?? '').trim()
  const description = String(value.description ?? '').trim()
  if (!title || title.length > 200) throw new Error('遭遇候选标题无效。')
  if (!description || description.length > 8_000) throw new Error('遭遇候选描述无效。')
  if (!Array.isArray(value.participantKeys)) throw new Error('遭遇候选必须提供参与者列表。')
  const participantKeys = value.participantKeys.map(raw => String(raw).trim())
  if (participantKeys.length < 2 || participantKeys.length > 40 || participantKeys.some(key => !key || key.length > 160)) {
    throw new Error('遭遇候选参与者必须为 2..40 个有效实体。')
  }
  if (new Set(participantKeys).size !== participantKeys.length) throw new Error('遭遇候选参与者不能重复。')
  return { baseSequence, title, description, participantKeys }
}

function numericAttribute(entity: RuntimeEntityState, keys: string[], fallback: number, min: number, max: number): number {
  for (const key of keys) {
    const value = entity.attributes[key]
    if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) return value
  }
  return fallback
}

function combatantFromEntity(entity: RuntimeEntityState, initiative: number): SimulationTtrpgCombatant {
  const maximumHp = numericAttribute(entity, ['maxHp', 'hp'], 10, 1, 1_000_000_000)
  const currentHp = numericAttribute(entity, ['hp'], maximumHp, 0, maximumHp)
  const resources: Record<string, SimulationTtrpgResource> = {
    hp: { current: currentHp, maximum: maximumHp },
  }
  for (const key of ['mana', 'stamina', 'actionPoints']) {
    const maximum = numericAttribute(entity, [`max${key[0].toUpperCase()}${key.slice(1)}`, key], 0, 0, 1_000_000_000)
    if (maximum > 0) resources[key] = { current: numericAttribute(entity, [key], maximum, 0, maximum), maximum }
  }
  return {
    entityKey: entity.entityKey,
    initiative,
    armorClass: numericAttribute(entity, ['armorClass', 'ac'], 10, 0, 1_000),
    resources,
    conditions: [],
  }
}

export async function startTtrpgEncounter(input: {
  sessionId: number
  candidate: SimulationTtrpgEncounterCandidate
}): Promise<SimulationEvent> {
  const candidate = parseSimulationTtrpgEncounterCandidate(input.candidate)
  return appendBuiltEvent(input.sessionId, ({ session, state, sequence }) => {
    if (session.kind !== 'ttrpg') throw new Error('只有跑团会话可以开始遭遇。')
    const ttrpg = state.ttrpg
    if (!ttrpg?.scene || ttrpg.scene.status !== 'active') throw new Error('请先开始一个跑团场景。')
    if (candidate.baseSequence !== state.lastSequence) throw new Error('遭遇候选已过期，请重新生成。')
    if (ttrpg.encounter?.status === 'active') throw new Error('当前已有进行中的战斗遭遇。')
    const combatants: Record<string, SimulationTtrpgCombatant> = {}
    for (const entityKey of candidate.participantKeys) {
      const entity = state.entities[entityKey]
      if (!entity || !['player', 'character', 'npc'].includes(entity.kind)) throw new Error(`遭遇参与者不存在或类型不支持: ${entityKey}`)
      const initiative = numericAttribute(entity, ['initiative'], deterministicDie(`${session.seed}\u0000${sequence}\u0000initiative:${entityKey}`, 20), 0, 1_000)
      combatants[entityKey] = combatantFromEntity(entity, initiative)
    }
    const turnOrder = Object.values(combatants)
      .sort((left, right) => right.initiative - left.initiative || left.entityKey.localeCompare(right.entityKey))
      .map(combatant => combatant.entityKey)
    const encounter: SimulationTtrpgEncounter = {
      encounterId: globalThis.crypto?.randomUUID?.() ?? `encounter-${Date.now()}-${Math.random()}`,
      title: candidate.title,
      description: candidate.description,
      status: 'active',
      round: 1,
      activeActorKey: turnOrder[0],
      turnOrder,
      combatants,
    }
    return {
      type: 'ttrpg.encounter.started',
      actorKey: turnOrder[0],
      targetKey: null,
      payloadJson: JSON.stringify({ encounter }),
    }
  })
}

export async function resolveTtrpgEncounter(input: {
  sessionId: number
  reason?: string
}): Promise<SimulationEvent> {
  const reason = input.reason?.trim() ?? ''
  if (reason.length > 2_000) throw new Error('遭遇结束理由过长。')
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== 'ttrpg') throw new Error('只有跑团会话可以结束遭遇。')
    if (!state.ttrpg?.encounter || state.ttrpg.encounter.status !== 'active') throw new Error('当前没有进行中的战斗遭遇。')
    return {
      type: 'ttrpg.encounter.resolved',
      actorKey: null,
      targetKey: null,
      payloadJson: JSON.stringify({ reason }),
    }
  })
}

export async function changeTtrpgResource(input: {
  sessionId: number
  entityKey: string
  resourceKey: string
  delta: number
  reason?: string
}): Promise<SimulationEvent> {
  const entityKey = input.entityKey.trim()
  const resourceKey = input.resourceKey.trim()
  const delta = assertFiniteInteger(input.delta, '资源变化量', -1_000_000_000, 1_000_000_000)
  const reason = input.reason?.trim() ?? ''
  if (!entityKey || !resourceKey || resourceKey.length > 80) throw new Error('资源变化目标无效。')
  if (reason.length > 2_000) throw new Error('资源变化理由过长。')
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== 'ttrpg') throw new Error('只有跑团会话可以调整战斗资源。')
    const encounter = state.ttrpg?.encounter
    const resource = encounter?.combatants[entityKey]?.resources[resourceKey]
    if (!encounter || encounter.status !== 'active' || !resource) throw new Error('资源目标不在当前进行中的遭遇中。')
    const current = Math.max(0, Math.min(resource.maximum, resource.current + delta))
    return {
      type: 'ttrpg.combat.resource.changed',
      actorKey: entityKey,
      targetKey: entityKey,
      payloadJson: JSON.stringify({ entityKey, resourceKey, delta, current, reason }),
    }
  })
}

export async function applyTtrpgCondition(input: {
  sessionId: number
  entityKey: string
  condition: SimulationTtrpgCondition
}): Promise<SimulationEvent> {
  const entityKey = input.entityKey.trim()
  const condition = assertTtrpgCondition(input.condition)
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== 'ttrpg') throw new Error('只有跑团会话可以施加状态效果。')
    if (!state.ttrpg?.encounter?.combatants[entityKey]) throw new Error('状态效果目标不在当前遭遇中。')
    return {
      type: 'ttrpg.combat.condition.applied',
      actorKey: entityKey,
      targetKey: entityKey,
      payloadJson: JSON.stringify({ entityKey, condition }),
    }
  })
}

export async function removeTtrpgCondition(input: {
  sessionId: number
  entityKey: string
  conditionId: string
}): Promise<SimulationEvent> {
  const entityKey = input.entityKey.trim()
  const conditionId = input.conditionId.trim()
  if (!entityKey || !conditionId) throw new Error('状态效果移除目标无效。')
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== 'ttrpg') throw new Error('只有跑团会话可以移除状态效果。')
    if (!state.ttrpg?.encounter?.combatants[entityKey]) throw new Error('状态效果目标不在当前遭遇中。')
    return {
      type: 'ttrpg.combat.condition.removed',
      actorKey: entityKey,
      targetKey: entityKey,
      payloadJson: JSON.stringify({ entityKey, conditionId }),
    }
  })
}

export async function resolveTtrpgAttack(input: {
  sessionId: number
  actorKey: string
  targetKey: string
  attackExpression: string
  damageExpression?: string | null
  resourceKey?: string
  reason?: string
}): Promise<SimulationEvent[]> {
  const actorKey = input.actorKey.trim()
  const targetKey = input.targetKey.trim()
  const attackExpression = parseDiceExpression(input.attackExpression)
  const damageExpression = input.damageExpression?.trim() ? parseDiceExpression(input.damageExpression) : null
  const resourceKey = input.resourceKey?.trim() || 'hp'
  const reason = input.reason?.trim() ?? ''
  if (!actorKey || !targetKey || actorKey === targetKey) throw new Error('攻击者与目标必须是不同实体。')
  if (resourceKey.length > 80) throw new Error('攻击资源键无效。')
  if (reason.length > 2_000) throw new Error('攻击理由过长。')
  return db.transaction('rw', db.simulationSessions, db.simulationEvents, async () => {
    const session = await db.simulationSessions.get(input.sessionId)
    if (!session) throw new Error('模拟会话不存在。')
    if (session.status !== 'active') throw new Error('只有 active 会话可以追加事件。')
    if (session.kind !== 'ttrpg') throw new Error('只有跑团会话可以执行攻击。')
    const events = await readSessionEvents(session)
    let state = replaySimulationEvents(parseSimulationState(session.initialStateJson), events)
    const encounter = state.ttrpg?.encounter
    if (!encounter || encounter.status !== 'active') throw new Error('请先开始一个进行中的战斗遭遇。')
    if (encounter.activeActorKey !== actorKey) throw new Error('当前还没轮到该战斗行动者。')
    const actor = encounter.combatants[actorKey]
    const target = encounter.combatants[targetKey]
    if (!actor || !target) throw new Error('攻击行动者或目标不在当前遭遇中。')
    const targetResource = target.resources[resourceKey]
    if (!targetResource) throw new Error(`目标没有资源: ${resourceKey}`)
    const attackSequence = state.lastSequence + 1
    const attackDice = Array.from({ length: attackExpression.count }, (_, index) => deterministicDie(`${session.seed}\u0000${attackSequence}\u0000${attackExpression.normalized}\u0000attack:${actorKey}:${targetKey}\u0000${index}`, attackExpression.sides))
    const attackTotal = attackDice.reduce((sum, die) => sum + die, attackExpression.modifier)
    const hit = attackTotal >= target.armorClass
    const damageDice = hit && damageExpression
      ? Array.from({ length: damageExpression.count }, (_, index) => deterministicDie(`${session.seed}\u0000${attackSequence}\u0000${damageExpression.normalized}\u0000damage:${actorKey}:${targetKey}\u0000${index}`, damageExpression.sides))
      : []
    const damageTotal = hit && damageExpression ? damageDice.reduce((sum, die) => sum + die, damageExpression.modifier) : 0
    if (damageTotal < 0) throw new Error('伤害骰式不能产生负数伤害。')
    const resourceDelta = -damageTotal
    const attack: SimulationTtrpgAttackResult = {
      actorKey,
      targetKey,
      attackExpression: attackExpression.normalized,
      attackDice,
      attackModifier: attackExpression.modifier,
      attackTotal,
      armorClass: target.armorClass,
      hit,
      damageExpression: hit && damageExpression ? damageExpression.normalized : null,
      damageDice,
      damageModifier: damageExpression?.modifier ?? 0,
      damageTotal,
      resourceKey,
      resourceDelta,
      reason,
    }
    const appended: SimulationEvent[] = []
    const appendLocal = (eventInput: { type: SimulationEventType; actorKey?: string | null; targetKey?: string | null; payload: unknown }) => {
      const event: SimulationEvent = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: input.sessionId,
        sequence: state.lastSequence + 1,
        type: eventInput.type,
        actorKey: eventInput.actorKey ?? null,
        targetKey: eventInput.targetKey ?? null,
        payloadJson: JSON.stringify(eventInput.payload),
        createdAt: Date.now(),
      }
      state = applySimulationEvent(state, event)
      appended.push(event)
    }
    appendLocal({ type: 'ttrpg.combat.attack.resolved', actorKey, targetKey, payload: { attack } })
    if (hit && damageTotal > 0) {
      const current = Math.max(0, Math.min(targetResource.maximum, targetResource.current + resourceDelta))
      appendLocal({
        type: 'ttrpg.combat.resource.changed',
        actorKey,
        targetKey,
        payload: { entityKey: targetKey, resourceKey, delta: resourceDelta, current, reason: reason || '攻击伤害' },
      })
    }
    const currentIndex = encounter.turnOrder.indexOf(actorKey)
    const nextIndex = (currentIndex + 1) % encounter.turnOrder.length
    const nextActorKey = encounter.turnOrder[nextIndex]
    const nextRound = encounter.round + (nextIndex === 0 ? 1 : 0)
    appendLocal({
      type: 'ttrpg.combat.turn.advanced',
      actorKey,
      targetKey: nextActorKey,
      payload: { nextActorKey, round: nextRound },
    })
    for (const event of appended) event.id = await db.simulationEvents.add(event) as number
    await db.simulationSessions.update(input.sessionId, { updatedAt: appended[appended.length - 1].createdAt })
    return appended
  })
}

export async function updateTtrpgCampaignSummary(input: {
  sessionId: number
  summary: string
  baseSequence?: number
}): Promise<SimulationEvent> {
  const summary = input.summary.trim()
  if (summary.length > 20_000) throw new Error('长期战役摘要不能超过 20,000 个字符。')
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== 'ttrpg') throw new Error('只有跑团会话可以更新长期战役摘要。')
    const baseSequence = input.baseSequence ?? state.lastSequence
    if (baseSequence !== state.lastSequence) throw new Error('长期战役摘要基线已变化，请刷新后重试。')
    return {
      type: 'ttrpg.campaign.summary.updated',
      actorKey: null,
      targetKey: null,
      payloadJson: JSON.stringify({ baseSequence, summary }),
    }
  })
}

export async function upsertTtrpgQuest(input: {
  sessionId: number
  questId: string
  title: string
  description: string
  status: SimulationTtrpgQuest['status']
  priority?: number
  dueClock?: number | null
}): Promise<SimulationEvent> {
  return appendBuiltEvent(input.sessionId, ({ session, sequence }) => {
    if (session.kind !== 'ttrpg') throw new Error('只有跑团会话可以管理战役任务。')
    const quest = assertTtrpgQuest({
      questId: input.questId,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority ?? 0,
      dueClock: input.dueClock ?? null,
      updatedSequence: sequence,
    })
    return {
      type: 'ttrpg.campaign.quest.upserted',
      actorKey: null,
      targetKey: quest.questId,
      payloadJson: JSON.stringify({ quest }),
    }
  })
}

export async function upsertTtrpgNpcSchedule(input: {
  sessionId: number
  scheduleId: string
  entityKey: string
  startClock: number
  endClock?: number | null
  locationKey?: string | null
  activity: string
  recurrence?: SimulationTtrpgNpcSchedule['recurrence']
}): Promise<SimulationEvent> {
  return appendBuiltEvent(input.sessionId, ({ session, state, sequence }) => {
    if (session.kind !== 'ttrpg') throw new Error('只有跑团会话可以管理 NPC 日程。')
    const entityKey = input.entityKey.trim()
    const npc = state.entities[entityKey]
    if (!npc || !isNpcRuntimeEntity(npc)) throw new Error('NPC 日程目标不是当前运行时 NPC。')
    const locationKey = input.locationKey?.trim() || null
    if (locationKey != null) {
      const location = state.entities[locationKey]
      if (!location || location.kind !== 'location') throw new Error('NPC 日程地点不是当前运行时地点。')
    }
    const schedule = assertTtrpgNpcSchedule({
      scheduleId: input.scheduleId,
      entityKey,
      startClock: input.startClock,
      endClock: input.endClock ?? null,
      locationKey,
      activity: input.activity,
      recurrence: input.recurrence ?? 'once',
      updatedSequence: sequence,
    })
    return {
      type: 'ttrpg.campaign.schedule.upserted',
      actorKey: entityKey,
      targetKey: locationKey,
      payloadJson: JSON.stringify({ schedule }),
    }
  })
}

export async function appendTtrpgTurn(input: {
  sessionId: number
  candidate: SimulationTtrpgTurnCandidate
}): Promise<SimulationEvent[]> {
  const candidate = parseSimulationTtrpgTurnCandidate(input.candidate)
  return db.transaction('rw', db.simulationSessions, db.simulationEvents, async () => {
    const session = await db.simulationSessions.get(input.sessionId)
    if (!session) throw new Error('模拟会话不存在。')
    if (session.status !== 'active') throw new Error('只有 active 会话可以追加事件。')
    if (session.kind !== 'ttrpg') throw new Error('只有跑团会话可以记录回合。')
    const events = await readSessionEvents(session)
    let state = replaySimulationEvents(parseSimulationState(session.initialStateJson), events)
    if (candidate.baseSequence !== state.lastSequence) throw new Error('跑团候选已过期，请重新生成。')
    assertTtrpgActor(state, candidate.actorKey)
    const ttrpg = state.ttrpg!
    const currentIndex = ttrpg.turnOrder.indexOf(ttrpg.activeActorKey!)
    const nextIndex = (currentIndex + 1) % ttrpg.turnOrder.length
    const expectedNextActorKey = ttrpg.turnOrder[nextIndex]
    const expectedRound = ttrpg.round + (nextIndex === 0 ? 1 : 0)
    if (candidate.nextActorKey != null && candidate.nextActorKey !== expectedNextActorKey) {
      throw new Error('跑团候选尝试改变确定性回合顺序。')
    }
    if (candidate.check) parseDiceExpression(candidate.check.expression)
    const appended: SimulationEvent[] = []
    const appendLocal = (inputEvent: {
      type: SimulationEventType
      actorKey?: string | null
      targetKey?: string | null
      payload: unknown
    }) => {
      const event: SimulationEvent = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: input.sessionId,
        sequence: state.lastSequence + 1,
        type: inputEvent.type,
        actorKey: inputEvent.actorKey ?? null,
        targetKey: inputEvent.targetKey ?? null,
        payloadJson: JSON.stringify(inputEvent.payload),
        createdAt: Date.now(),
      }
      state = applySimulationEvent(state, event)
      appended.push(event)
    }
    appendLocal({
      type: 'ttrpg.action.recorded',
      actorKey: candidate.actorKey,
      targetKey: candidate.actorKey,
      payload: { actorKey: candidate.actorKey, text: candidate.action },
    })
    let checkSequence: number | null = null
    let resolvedNarrative = candidate.narrative
    if (candidate.check) {
      const expression = parseDiceExpression(candidate.check.expression)
      const sequence = state.lastSequence + 1
      const resolution = buildDiceResolution({
        seed: session.seed,
        sequence,
        expression,
        nonce: `check:${candidate.check.skill}`,
      })
      checkSequence = sequence
      resolvedNarrative = [
        candidate.narrative,
        resolution.total >= candidate.check.dc ? candidate.outcomes!.success : candidate.outcomes!.failure,
      ].filter(Boolean).join('\n\n')
      appendLocal({
        type: 'ttrpg.check.resolved',
        actorKey: candidate.actorKey,
        targetKey: candidate.actorKey,
        payload: {
          check: {
            actorKey: candidate.actorKey,
            skill: candidate.check.skill,
            expression: resolution.expression,
            dice: resolution.dice,
            modifier: resolution.modifier,
            total: resolution.total,
            dc: candidate.check.dc,
            success: resolution.total >= candidate.check.dc,
          },
        },
      })
    }
    const actionSequence = appended[0].sequence
    appendLocal({
      type: 'ttrpg.gm.response.recorded',
      actorKey: null,
      targetKey: candidate.actorKey,
      payload: {
        actionSequence,
        checkSequence,
        text: resolvedNarrative,
      },
    })
    appendLocal({
      type: 'ttrpg.turn.advanced',
      actorKey: candidate.actorKey,
      targetKey: expectedNextActorKey,
      payload: { nextActorKey: expectedNextActorKey, round: expectedRound },
    })
    for (const event of appended) event.id = await db.simulationEvents.add(event) as number
    await db.simulationSessions.update(input.sessionId, { updatedAt: appended[appended.length - 1].createdAt })
    return appended
  })
}

export async function commitNarrativeSimulationTurn(input: {
  sessionId: number
  decisionKeys: string[]
  commandId: string
  baseSequence: number
  baseStateHash: string
}): Promise<{
  events: SimulationEvent[]
  checkpoint: SimulationCheckpoint
  state: SimulationRuntimeState
}> {
  const commandId = normalizeCommandId(input.commandId)
  const baseStateHash = input.baseStateHash.trim()
  if (!Number.isInteger(input.baseSequence) || input.baseSequence < 0
    || !/^[a-f0-9]{64}$/.test(baseStateHash)) {
    throw new Error('[textsim] 回合命令基线无效。')
  }
  const previewSession = await db.simulationSessions.get(input.sessionId)
  if (!previewSession || (previewSession.kind !== 'textsimulation' && previewSession.kind !== 'textworld') || previewSession.gameReleaseId == null) {
    throw new Error('[textsim] 正式叙事模拟实例不存在。')
  }
  const previewRelease = await assertGameReleaseUnchanged(previewSession.gameReleaseId)
  const previewManifest = parseAnyGameReleaseManifest(previewRelease.manifestJson)
  if (previewManifest.productType !== 'narrative-simulation' && previewManifest.productType !== 'text-open-world') throw new Error('[textsim] 实例发布绑定无效。')
  const previewEvents = await readSessionEvents(previewSession)
  const previewState = replaySimulationEvents(parseSimulationState(previewSession.initialStateJson), previewEvents)
  const previewPrior = previewEvents.find(event => event.commandId === commandId)
  if (!previewState.narrativeSimulation
    || previewState.narrativeSimulation.contentHash !== previewRelease.contentHash) {
    throw new Error('[textsim] 实例冻结状态与 GameRelease 不一致。')
  }
  if (!previewPrior && (previewState.lastSequence !== input.baseSequence
    || await hashStateJson(JSON.stringify(previewState)) !== baseStateHash)) {
    throw new Error('[textsim] 模拟状态已变化，请刷新后重试。')
  }
  if (!previewPrior) {
    planNarrativeSimulationTurn({
      content: previewManifest.simulation,
      state: previewState.narrativeSimulation,
      decisionKeys: input.decisionKeys,
      seed: previewSession.seed,
      startingSequence: previewState.lastSequence,
    })
  }

  return db.transaction(
    'rw',
    db.simulationSessions,
    db.simulationEvents,
    db.simulationCheckpoints,
    db.gameReleases,
    async () => {
      const session = await db.simulationSessions.get(input.sessionId)
      if (!session || (session.kind !== 'textsimulation' && session.kind !== 'textworld') || session.gameReleaseId == null) {
        throw new Error('[textsim] 正式叙事模拟实例不存在。')
      }
      const release = await db.gameReleases.get(session.gameReleaseId)
      if (!release || release.manifestJson !== previewRelease.manifestJson
        || release.contentHash !== previewRelease.contentHash) {
        throw new Error('[textsim] GameRelease 在回合提交期间发生变化。')
      }
      const manifest = parseAnyGameReleaseManifest(release.manifestJson)
      if (manifest.productType !== 'narrative-simulation' && manifest.productType !== 'text-open-world') throw new Error('[textsim] 实例发布绑定无效。')
      const events = await readSessionEvents(session)
      const prior = events.find(event => event.commandId === commandId)
      if (prior) {
        const priorPayload = parseEventPayload(prior)
        if (prior.type !== 'simulation.turn.started'
          || prior.baseSequence !== input.baseSequence
          || prior.baseStateHash !== baseStateHash
          || stableJson(priorPayload.decisionKeys) !== stableJson(input.decisionKeys)) {
          throw new Error('[textsim] commandId 已被不同回合命令使用。')
        }
        const turn = Number(priorPayload.turn)
        const ended = events.find(event => event.sequence >= prior.sequence
          && event.type === 'simulation.turn.ended'
          && Number(parseEventPayload(event).turn) === turn)
        if (!ended) throw new Error('[textsim] 已提交回合缺少结束事件。')
        const commandEvents = events.filter(event => event.sequence >= prior.sequence && event.sequence <= ended.sequence)
        const checkpoint = await db.simulationCheckpoints.where('sessionId').equals(session.id!)
          .filter(item => item.throughSequence === ended.sequence).first()
        if (!checkpoint) throw new Error('[textsim] 已提交回合缺少检查点。')
        const state = parseSimulationState(checkpoint.stateJson)
        return { events: commandEvents, checkpoint, state }
      }
      if (session.status !== 'active') throw new Error('[textsim] 只有 active 会话可以提交回合。')
      let state = replaySimulationEvents(parseSimulationState(session.initialStateJson), events)
      const stateHash = await hashStateJson(JSON.stringify(state))
      if (state.lastSequence !== input.baseSequence || stateHash !== baseStateHash
        || state.lastSequence !== previewState.lastSequence) {
        throw new Error('[textsim] 模拟状态已变化，请刷新后重试。')
      }
      if (!state.narrativeSimulation || state.narrativeSimulation.contentHash !== release.contentHash) {
        throw new Error('[textsim] 实例冻结状态与 GameRelease 不一致。')
      }
      const settledTurn = state.narrativeSimulation.turn
      const plan = planNarrativeSimulationTurn({
        content: manifest.simulation,
        state: state.narrativeSimulation,
        decisionKeys: input.decisionKeys,
        seed: session.seed,
        startingSequence: state.lastSequence,
      })
      const appended: SimulationEvent[] = []
      const createdAt = Date.now()
      for (const [index, descriptor] of plan.descriptors.entries()) {
        const envelope = descriptor.commandEnvelope
          ? { commandId, baseSequence: input.baseSequence, baseStateHash }
          : {}
        const event: SimulationEvent = {
          projectId: session.projectId,
          worldGroupId: session.worldGroupId ?? null,
          sessionId: session.id!,
          sequence: input.baseSequence + index + 1,
          type: descriptor.type,
          actorKey: descriptor.actorKey,
          targetKey: descriptor.targetKey,
          ...envelope,
          payloadJson: JSON.stringify({ ...descriptor.payload, ...envelope }),
          createdAt,
        }
        state = applySimulationEvent(state, event)
        appended.push(event)
      }
      for (const event of appended) event.id = await db.simulationEvents.add(event) as number
      const stateJson = JSON.stringify(state)
      const throughSequence = appended[appended.length - 1].sequence
      const checkpoint: SimulationCheckpoint = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: session.id!,
        throughSequence,
        name: `第 ${settledTurn} 回合自动检查点`,
        stateJson,
        stateHash: await hashStateJson(stateJson),
        createdAt,
      }
      checkpoint.id = await db.simulationCheckpoints.add(checkpoint) as number
      await db.simulationSessions.update(session.id!, { updatedAt: createdAt })
      return { events: appended, checkpoint, state }
    },
  )
}

export type OpenWorldCommand = {
  kind: 'draw'
  trigger: import('../types').OpenWorldDiscoveryTrigger
} | {
  kind: 'travel'
  edgeKey: string
} | {
  kind: 'quest-decision'
  instanceKey: string
  decision: 'accept' | 'decline'
} | {
  kind: 'tick'
}

interface OpenWorldEventPlan {
  descriptors: Array<{
    type: SimulationEventType
    actorKey?: string | null
    targetKey?: string | null
    payload: Record<string, unknown>
  }>
}

function normalizeOpenWorldCommand(command: OpenWorldCommand): OpenWorldCommand {
  if (command.kind === 'draw') {
    if (!['observe', 'social', 'explore', 'rest', 'travel', 'combat'].includes(command.trigger)) {
      throw new Error('[textworld] 发现触发类型无效。')
    }
    return { kind: 'draw', trigger: command.trigger }
  }
  if (command.kind === 'travel') {
    const edgeKey = command.edgeKey.trim()
    if (!edgeKey || edgeKey.length > 160) throw new Error('[textworld] 交通边 key 无效。')
    return { kind: 'travel', edgeKey }
  }
  if (command.kind === 'quest-decision') {
    const instanceKey = command.instanceKey.trim()
    if (!instanceKey || instanceKey.length > 200 || !['accept', 'decline'].includes(command.decision)) {
      throw new Error('[textworld] 任务决策无效。')
    }
    return { kind: 'quest-decision', instanceKey, decision: command.decision }
  }
  if (command.kind === 'tick') return { kind: 'tick' }
  throw new Error('[textworld] 未知开放世界命令。')
}

function planOpenWorldCommand(input: {
  manifest: Extract<AnyGameReleaseManifestV1, { productType: 'text-open-world' }>
  state: SimulationRuntimeState
  seed: string
  command: OpenWorldCommand
}): OpenWorldEventPlan {
  if (!input.state.openWorld || !input.state.adventure || !input.state.narrativeSimulation) {
    throw new Error('[textworld] 实例缺少开放世界、冒险或模拟冻结状态。')
  }
  const common = {
    content: input.manifest.openWorld,
    state: input.state.openWorld,
    startingSequence: input.state.lastSequence,
  }
  if (input.command.kind === 'draw') {
    return planOpenWorldDraw({
      ...common,
      simulation: input.manifest.simulation,
      adventure: input.state.adventure,
      trigger: input.command.trigger,
      seed: input.seed,
    })
  }
  if (input.command.kind === 'travel') {
    return planOpenWorldTravel({ ...common, edgeKey: input.command.edgeKey })
  }
  if (input.command.kind === 'quest-decision') {
    return planOpenWorldQuestDecision({
      ...common,
      simulation: input.manifest.simulation,
      instanceKey: input.command.instanceKey,
      decision: input.command.decision,
    })
  }
  return planOpenWorldTick({
    ...common,
    simulation: input.manifest.simulation,
    seed: input.seed,
  })
}

/** TEXTWORLD-1 authoritative command path. Every command expands to replayable
 * shared adventure/world events, a verified narrative projection, and one
 * atomic checkpoint. */
export async function commitOpenWorldCommand(input: {
  sessionId: number
  command: OpenWorldCommand
  commandId: string
  baseSequence: number
  baseStateHash: string
}): Promise<{ events: SimulationEvent[]; checkpoint: SimulationCheckpoint; state: SimulationRuntimeState }> {
  const commandId = normalizeCommandId(input.commandId)
  const command = normalizeOpenWorldCommand(input.command)
  const baseStateHash = input.baseStateHash.trim()
  if (!Number.isInteger(input.baseSequence) || input.baseSequence < 0 || !/^[a-f0-9]{64}$/.test(baseStateHash)) {
    throw new Error('[textworld] 命令基线无效。')
  }
  const previewSession = await db.simulationSessions.get(input.sessionId)
  if (!previewSession || previewSession.kind !== 'textworld' || previewSession.gameReleaseId == null) {
    throw new Error('[textworld] 正式文字开放世界实例不存在。')
  }
  const [previewRelease, previewEvents] = await Promise.all([
    assertGameReleaseUnchanged(previewSession.gameReleaseId),
    readSessionEvents(previewSession),
  ])
  const previewManifest = parseAnyGameReleaseManifest(previewRelease.manifestJson)
  if (previewManifest.productType !== 'text-open-world') throw new Error('[textworld] 实例发布绑定无效。')
  const previewState = replaySimulationEvents(parseSimulationState(previewSession.initialStateJson), previewEvents)
  const prior = previewEvents.find(event => event.commandId === commandId)
  if (!prior && (previewState.lastSequence !== input.baseSequence
    || await hashStateJson(JSON.stringify(previewState)) !== baseStateHash)) {
    throw new Error('[textworld] 世界状态已变化，请刷新后重试。')
  }
  if (!prior) planOpenWorldCommand({ manifest: previewManifest, state: previewState, seed: previewSession.seed, command })
  const checkpointName = commandId.length <= 190
    ? `TEXTWORLD:${commandId}`
    : `TEXTWORLD:${commandId.slice(0, 120)}:${(await hashStateJson(JSON.stringify(commandId))).slice(0, 64)}`

  return db.transaction(
    'rw',
    db.simulationSessions,
    db.simulationEvents,
    db.simulationCheckpoints,
    db.gameReleases,
    async () => {
      const session = await db.simulationSessions.get(input.sessionId)
      if (!session || session.kind !== 'textworld' || session.gameReleaseId == null) {
        throw new Error('[textworld] 正式文字开放世界实例不存在。')
      }
      const release = await db.gameReleases.get(session.gameReleaseId)
      if (!release || release.contentHash !== previewRelease.contentHash
        || release.manifestJson !== previewRelease.manifestJson) {
        throw new Error('[textworld] GameRelease 在命令提交期间发生变化。')
      }
      const manifest = parseAnyGameReleaseManifest(release.manifestJson)
      if (manifest.productType !== 'text-open-world') throw new Error('[textworld] 实例发布绑定无效。')
      const events = await readSessionEvents(session)
      const existing = events.find(event => event.commandId === commandId)
      if (existing) {
        const payload = parseEventPayload(existing)
        if (existing.baseSequence !== input.baseSequence || existing.baseStateHash !== baseStateHash
          || stableJson(payload.worldCommand) !== stableJson(command)) {
          throw new Error('[textworld] commandId 已被不同命令使用。')
        }
        const checkpoint = await db.simulationCheckpoints.where('sessionId').equals(session.id!)
          .filter(item => item.name === checkpointName).first()
        if (!checkpoint || checkpoint.throughSequence < existing.sequence) {
          throw new Error('[textworld] 已提交命令缺少检查点。')
        }
        return {
          events: events.filter(event => event.sequence >= existing.sequence && event.sequence <= checkpoint.throughSequence),
          checkpoint,
          state: parseSimulationState(checkpoint.stateJson),
        }
      }
      if (session.status !== 'active') throw new Error('[textworld] 只有 active 实例可以提交命令。')
      let state = replaySimulationEvents(parseSimulationState(session.initialStateJson), events)
      if (state.lastSequence !== input.baseSequence || state.lastSequence !== previewState.lastSequence
        || await hashStateJson(JSON.stringify(state)) !== baseStateHash) {
        throw new Error('[textworld] 世界状态已变化，请刷新后重试。')
      }
      if (!state.openWorld || !state.adventure || !state.narrativeSimulation
        || state.openWorld.contentHash !== release.contentHash
        || state.adventure.contentHash !== release.contentHash
        || state.narrativeSimulation.contentHash !== release.contentHash) {
        throw new Error('[textworld] 实例冻结状态与 GameRelease 不一致。')
      }
      const plan = planOpenWorldCommand({ manifest, state, seed: session.seed, command })
      const appended: SimulationEvent[] = []
      const createdAt = Date.now()
      const append = (descriptor: OpenWorldEventPlan['descriptors'][number], envelope = false) => {
        const commandEnvelope = envelope ? { commandId, baseSequence: input.baseSequence, baseStateHash } : {}
        const event: SimulationEvent = {
          projectId: session.projectId,
          worldGroupId: session.worldGroupId ?? null,
          sessionId: session.id!,
          sequence: state.lastSequence + 1,
          type: descriptor.type,
          actorKey: descriptor.actorKey ?? null,
          targetKey: descriptor.targetKey ?? null,
          ...commandEnvelope,
          payloadJson: JSON.stringify({ ...descriptor.payload, ...(envelope ? { worldCommand: command } : {}) }),
          createdAt,
        }
        state = applySimulationEvent(state, event)
        appended.push(event)
      }
      for (const [index, descriptor] of plan.descriptors.entries()) append(descriptor, index === 0)
      append({
        type: 'world.narrative.synced',
        payload: { projection: openWorldMainlineProjection(state.openWorld!, state.openWorld!.mainlineQuestKeys) },
      })
      for (const event of appended) event.id = await db.simulationEvents.add(event) as number
      const stateJson = JSON.stringify(state)
      const checkpoint: SimulationCheckpoint = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: session.id!,
        throughSequence: state.lastSequence,
        name: checkpointName,
        stateJson,
        stateHash: await hashStateJson(stateJson),
        createdAt,
      }
      checkpoint.id = await db.simulationCheckpoints.add(checkpoint) as number
      await db.simulationSessions.update(session.id!, { updatedAt: createdAt })
      return { events: appended, checkpoint, state }
    },
  )
}

async function hashStateJson(stateJson: string): Promise<string> {
  const data = new TextEncoder().encode(stateJson)
  const digestPromise = crypto.subtle.digest('SHA-256', data)
  const digest = Dexie.currentTransaction ? await Dexie.waitFor(digestPromise) : await digestPromise
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function createSimulationCheckpoint(input: {
  sessionId: number
  name: string
  throughSequence?: number
}): Promise<SimulationCheckpoint> {
  const session = await db.simulationSessions.get(input.sessionId)
  if (!session) throw new Error('模拟会话不存在。')
  const events = await readSessionEvents(session)
  const latest = events.reduce((max, event) => Math.max(max, event.sequence), 0)
  const throughSequence = input.throughSequence ?? latest
  if (!Number.isInteger(throughSequence) || throughSequence < 0 || throughSequence > latest) {
    throw new Error('检查点序号不在会话事件范围内。')
  }
  const state = replaySimulationEvents(
    parseSimulationState(session.initialStateJson),
    events,
    throughSequence,
  )
  const stateJson = JSON.stringify(state)
  const name = input.name.trim() || `检查点 ${throughSequence}`
  if (name.length > 200) throw new Error('检查点名称不能超过 200 个字符。')
  const checkpoint: SimulationCheckpoint = {
    projectId: session.projectId,
    worldGroupId: session.worldGroupId ?? null,
    sessionId: session.id!,
    throughSequence,
    name,
    stateJson,
    stateHash: await hashStateJson(stateJson),
    createdAt: Date.now(),
  }
  checkpoint.id = await db.simulationCheckpoints.add(checkpoint) as number
  return checkpoint
}

export async function verifySimulationCheckpoint(checkpointId: number): Promise<boolean> {
  const checkpoint = await db.simulationCheckpoints.get(checkpointId)
  if (!checkpoint) return false
  const session = await db.simulationSessions.get(checkpoint.sessionId)
  if (
    !session
    || session.projectId !== checkpoint.projectId
    || (session.worldGroupId ?? null) !== (checkpoint.worldGroupId ?? null)
  ) return false
  const replayed = await readSimulationState(checkpoint.sessionId, checkpoint.throughSequence)
  const stateJson = JSON.stringify(replayed)
  return stateJson === checkpoint.stateJson
    && await hashStateJson(stateJson) === checkpoint.stateHash
}

export async function branchSimulationSession(input: {
  parentSessionId: number
  throughSequence: number
  title: string
  seed?: string
}): Promise<SimulationSession> {
  const parent = await db.simulationSessions.get(input.parentSessionId)
  if (!parent) throw new Error('父模拟会话不存在。')
  const events = await readSessionEvents(parent)
  const latest = events.reduce((max, event) => Math.max(max, event.sequence), 0)
  if (
    !Number.isInteger(input.throughSequence)
    || input.throughSequence < 0
    || input.throughSequence > latest
  ) throw new Error('分支序号不在父会话事件范围内。')
  const state = replaySimulationEvents(
    parseSimulationState(parent.initialStateJson),
    events,
    input.throughSequence,
  )
  if (state.interaction) {
    state.interaction = rebaseInteractionStateForBranch(state.interaction, input.throughSequence)
  }
  if (state.narrativeSimulation) {
    state.narrativeSimulation = rebaseNarrativeSimulationStateForBranch(state.narrativeSimulation)
  }
  if (state.openWorld) {
    state.openWorld = rebaseOpenWorldStateForBranch(state.openWorld)
  }
  state.lastSequence = 0
  const childInput: CreateSimulationSessionInput = {
    projectId: parent.projectId,
    worldGroupId: parent.worldGroupId ?? null,
    kind: parent.kind,
    title: input.title,
    seed: input.seed,
    canonSnapshot: parseJsonObject(parent.canonSnapshotJson, 'Canon 冻结快照'),
    initialState: state,
  }
  const child = (parent.kind === 'storygame' || parent.kind === 'chatgame' || parent.kind === 'textadventure'
    || parent.kind === 'avg' || parent.kind === 'textsimulation' || parent.kind === 'textworld') && parent.gameReleaseId != null
    && parent.worldId != null && parent.workId != null && parent.worldReleaseId != null
    && parent.narrativeModuleExportId != null
    ? await createReleasedGameSession({
      ...childInput,
      worldId: parent.worldId,
      workId: parent.workId,
      worldReleaseId: parent.worldReleaseId,
      gameReleaseId: parent.gameReleaseId,
      narrativeModuleExportId: parent.narrativeModuleExportId,
      origin: 'branch',
    })
    : parent.kind === 'storygame' && state.narrative?.version === 1
      ? await insertSimulationSession(childInput)
    : await createSimulationSession(childInput)
  await db.simulationSessions.update(child.id!, {
    parentSessionId: parent.id!,
    parentThroughSequence: input.throughSequence,
    worldId: parent.worldId ?? null,
    workId: parent.workId ?? null,
    worldReleaseId: parent.worldReleaseId ?? null,
    gameReleaseId: parent.gameReleaseId ?? null,
    narrativeModuleId: parent.narrativeModuleId ?? null,
    narrativeModuleExportId: parent.narrativeModuleExportId ?? null,
    draftSnapshotHash: parent.draftSnapshotHash ?? null,
  })
  return {
    ...child,
    parentSessionId: parent.id!,
    parentThroughSequence: input.throughSequence,
    worldId: parent.worldId ?? null,
    workId: parent.workId ?? null,
    worldReleaseId: parent.worldReleaseId ?? null,
    gameReleaseId: parent.gameReleaseId ?? null,
    narrativeModuleId: parent.narrativeModuleId ?? null,
    narrativeModuleExportId: parent.narrativeModuleExportId ?? null,
    draftSnapshotHash: parent.draftSnapshotHash ?? null,
  }
}

export async function deleteSimulationSession(sessionId: number): Promise<void> {
  await db.transaction('rw', transactionTablesForReferenceCascade('simulationSessions'), async () => {
    // Preserve child ids before the registered parentSessionId setNull runs;
    // parentThroughSequence is the companion provenance field and must be
    // cleared in the same lifecycle operation.
    const children = await db.simulationSessions.where('parentSessionId').equals(sessionId).toArray()
    // PROJECT_TABLES is authoritative for runtime-owned extensions such as the
    // unified Harness ledger. Cascading the registered references keeps this
    // lifecycle complete without a second hand-written run/event table list.
    await cascadeRegisteredReferences('simulationSessions', sessionId)
    await db.simulationEvents.where('sessionId').equals(sessionId).delete()
    await db.simulationCheckpoints.where('sessionId').equals(sessionId).delete()
    for (const child of children) {
      if (child.id != null) {
        await db.simulationSessions.update(child.id, {
          parentSessionId: null,
          parentThroughSequence: null,
        })
      }
    }
    await db.simulationSessions.delete(sessionId)
  })
}
