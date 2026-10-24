import {chatTurnAudienceGuidanceV2} from './narrative-audience'
import {selectChatHistoryActorContextV1} from './history-actor-context'
import {validateFrozenChatSourceUnitsV1} from './source-unit-runtime'
import {assertChatResolutionEvidenceSourcesV1} from './resolution-evidence'
import {assertChatInquirySettlementSourcesV1} from './inquiry-settlement'
import {assertChatInquirySourcesV1} from './narrative-inquiry'
import {assertChatSceneTransitionSourcesV1} from './narrative-scene-transition'
import {assertChatPlayerPauseSourcesV1} from './narrative-player-pause'
import {chatMemoryCorrectionContextV1, type ChatMemoryCorrectionContextV1} from './memory-correction-context'
import {assertChatMemoryReconciliationSourcesV1} from './memory-reconciliation'
import {assertChatResponseRetrievableV1, isChatMessageRetrievableV1, requireChatRetrievalMessageV1, setChatMessageRetrievalV1} from './narrative-retrieval'
import {updateChatMessageEditDraftV1} from './narrative-edit-contract'
import {isChatPrivateCharacterKeyV1} from './private-character'
import type {
  FrozenInteractionCharacterProfile,
  FrozenInteractionSceneTemplate,
  InteractionRelationshipRule,
  InteractionMemoryKind,
  InteractionRuntimeKnowledge,
  InteractionRuntimeMemory,
  InteractionRuntimeMessage,
  InteractionRuntimeProfile,
  InteractionRuntimeRelationship,
  InteractionRuntimeScene,
  InteractionRuntimeSceneTemplate,
  InteractionRuntimeThread,
  InteractionRelationshipChange,
  RuntimeMemoryStatus,
  ProductRuntimeEvent,
  CharacterInteractionRuntimeState,
} from '../types'
import type { FrozenChatSourceProjectionV1 } from '../types/character-interaction'
import { isSha256Hash } from '../product-production/hash'
import type { FrozenChatNarrativeV1 } from '../types/chat-narrative'
import { chatNarrativeViewV1, createChatNarrativeStateV1, parseChatNarrativeStateV1, parseFrozenChatNarrativeV1, rebaseChatNarrativeStateV1, type ChatNarrativeViewV1 } from './narrative-contract'
import {assertChatControlHandoffSourcesV1} from './control-handoff-state'
import {applyReviewedChatControlHandoffV1} from './control-handoff-contract'
import { applyChatNarrativeActionV1, applyReviewedChatNarrativeActionV1, interruptChatNarrativeTriggerV1, requestChatNarrativeTriggerV1 } from './narrative-actions'
import { applyChatSituationV1 } from './narrative-situations'
import {chatRelationshipEvidenceV1} from './narrative-relationships'
import {selectChatContextWindowV1, supportsChatCorrectionContextV1, type ChatContextSelectionV1} from './context-selection'
import {interactionMessageVisibleTo as visibleTo} from './message-visibility'
import {hasChatMemoryContentReviewV1, interactionMemoryForContextV1, parseChatMemoryReceiptV1} from './memory-review-contract'
import {requiredChatCommitmentKeysV1} from './commitment-context'
import {assertChatCommitmentSourcesV1, chatVisibleCommitmentsV1} from './narrative-commitments'

type JsonObject = Record<string, unknown>

const MEMORY_KINDS = new Set<InteractionMemoryKind>([
  'scene-summary',
  'key-memory',
  'commitment',
  'secret',
  'conflict',
  'gift',
])
const MEMORY_STATUSES = new Set(['proposed', 'accepted', 'rejected', 'superseded', 'disabled', 'revoked'])
const KNOWLEDGE_STATUSES = new Set<RuntimeMemoryStatus>(['known', 'mistaken', 'forgotten'])

function isObject(value: unknown): value is JsonObject {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, label: string, maximum = 20_000): string {
  const result = String(value ?? '').trim()
  if (!result || result.length > maximum) throw new Error(`${label}无效。`)
  return result
}

function nullableText(value: unknown, label: string, maximum = 20_000): string | null {
  if (value == null) return null
  return text(value, label, maximum)
}

function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label}无效。`)
  }
  return Number(value)
}

function finite(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label}无效。`)
  }
  return Number(value)
}

function strings(value: unknown, label: string, maximum = 200): string[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组。`)
  const result = value.map(item => text(item, label, maximum))
  if (new Set(result).size !== result.length) throw new Error(`${label}不能重复。`)
  return result
}

function optionalStrings(value: unknown, label: string, maximum = 200): string[] | null {
  return value == null ? null : strings(value, label, maximum)
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label}不能重复。`)
}

function profile(value: unknown): InteractionRuntimeProfile {
  if (!isObject(value)) throw new Error('互动角色快照必须是对象。')
  return {
    participantKey: text(value.participantKey, '互动角色 key', 160),
    // Portable WorldRelease resource keys include the release hash, semantic
    // coordinate and record hash; 160 bytes is too short for a valid identity.
    characterKey: text(value.characterKey, '互动角色实体 key', 500),
    name: text(value.name, '互动角色名称', 240),
    roleLabel: text(value.roleLabel, '互动角色定位', 500),
    voiceRules: text(value.voiceRules, '互动角色语气规则', 8_000),
    maxMemoryEntries: integer(value.maxMemoryEntries, '互动角色记忆上限', 1, 500),
  }
}

function relationshipRule(value: unknown): InteractionRelationshipRule {
  if (!isObject(value)) throw new Error('互动关系规则必须是对象。')
  const dimensionKey = text(value.dimensionKey, '关系规则维度', 160) as InteractionRelationshipRule['dimensionKey']
  if (!['trust', 'closeness', 'wariness', 'respect'].includes(dimensionKey)) {
    throw new Error('关系规则维度无效。')
  }
  const delta = finite(value.delta, '关系规则变化量', -1_000_000, 1_000_000)
  if (delta === 0) throw new Error('关系规则变化量不能为零。')
  return {
    ruleKey: text(value.ruleKey, '关系规则 key', 160),
    label: text(value.label, '关系规则名称', 240),
    playerText: text(value.playerText, '关系规则玩家选项', 1_000),
    fromParticipantKey: text(value.fromParticipantKey, '关系规则来源角色', 160),
    toParticipantKey: text(value.toParticipantKey, '关系规则目标角色', 160),
    dimensionKey,
    delta,
    reason: text(value.reason, '关系规则理由', 2_000),
    significantEventKey: nullableText(value.significantEventKey, '关系规则重大事件', 160),
  }
}

function sceneTemplate(value: unknown): InteractionRuntimeSceneTemplate {
  if (!isObject(value)) throw new Error('互动场景模板必须是对象。')
  const relationshipRules = Array.isArray(value.relationshipRules)
    ? value.relationshipRules.map(relationshipRule)
    : []
  assertUnique(relationshipRules.map(item => item.ruleKey), '互动关系规则 key')
  return {
    sceneKey: text(value.sceneKey, '互动场景 key', 160),
    title: text(value.title, '互动场景标题', 240),
    purpose: text(value.purpose, '互动场景目的', 4_000),
    location: text(value.location, '互动场景地点', 1_000),
    timeLabel: text(value.timeLabel, '互动场景时间', 1_000),
    participantKeys: strings(value.participantKeys, '互动场景参与者', 160),
    publicKnowledgeKeys: strings(value.publicKnowledgeKeys, '公开知识 key', 160),
    goals: strings(value.goals, '互动场景目标', 2_000),
    endingConditions: strings(value.endingConditions, '互动场景结束条件', 2_000),
    safetyBoundaries: strings(value.safetyBoundaries, '互动场景安全边界', 2_000),
    relationshipRules,
    openingNodeKey: nullableText(value.openingNodeKey, '互动场景开场节点', 160),
    endingNodeKey: nullableText(value.endingNodeKey, '互动场景结束节点', 160),
    maxTurns: integer(value.maxTurns, '互动场景最大回合', 1, 10_000),
    directorBudget: integer(value.directorBudget, '互动场景导演预算', 0, 1_000_000),
  }
}

function scene(value: unknown): InteractionRuntimeScene {
  if (!isObject(value)) throw new Error('互动场景状态必须是对象。')
  const template = sceneTemplate(value)
  const status = String(value.status ?? '')
  if (status !== 'active' && status !== 'ended') throw new Error('互动场景状态无效。')
  return {
    ...template,
    sceneId: text(value.sceneId, '互动场景 ID', 200),
    status,
    activeParticipantKeys: strings(value.activeParticipantKeys, '当前参与者', 160),
    startedAtSequence: integer(value.startedAtSequence, '场景开始序号', Number.MIN_SAFE_INTEGER),
    endedAtSequence: value.endedAtSequence == null
      ? null
      : integer(value.endedAtSequence, '场景结束序号', Number.MIN_SAFE_INTEGER),
    playerTurns: integer(value.playerTurns, '场景玩家回合', 0, template.maxTurns),
  }
}

function message(value: unknown): InteractionRuntimeMessage {
  if (!isObject(value)) throw new Error('互动消息必须是对象。')
  const role = String(value.role ?? '')
  if (role !== 'player' && role !== 'character' && role !== 'system') throw new Error('互动消息角色无效。')
  if (value.playerConversation !== undefined && (role !== 'player' || value.playerConversation !== 'private' && value.playerConversation !== 'present' || !Array.isArray(value.audienceKeys))) throw new Error('玩家对话范围标记无效。')
  return {
    messageId: text(value.messageId, '互动消息 ID', 200),
    eventSequence: integer(value.eventSequence, '互动消息事件序号', Number.MIN_SAFE_INTEGER),
    role,
    ...(value.playerConversation === undefined ? {} : {playerConversation: value.playerConversation as 'private' | 'present'}),
    speakerKey: text(value.speakerKey, '互动消息说话者', 160),
    audienceKeys: optionalStrings(value.audienceKeys, '互动消息听众', 160),
    text: text(value.text, '互动消息文本', 20_000),
    replyToSequence: value.replyToSequence == null
      ? null
      : integer(value.replyToSequence, '互动回复目标序号', Number.MIN_SAFE_INTEGER),
    supersededBySequence: value.supersededBySequence == null
      ? null
      : integer(value.supersededBySequence, '互动消息替代序号', Number.MIN_SAFE_INTEGER),
  }
}

function knowledge(value: unknown): InteractionRuntimeKnowledge {
  if (!isObject(value)) throw new Error('互动知识必须是对象。')
  const status = String(value.status ?? '') as RuntimeMemoryStatus
  if (!KNOWLEDGE_STATUSES.has(status)) throw new Error('互动知识状态无效。')
  return {
    knowledgeKey: text(value.knowledgeKey, '互动知识 key', 160),
    participantKey: text(value.participantKey, '互动知识角色', 160),
    content: text(value.content, '互动知识内容', 8_000),
    status,
    importance: integer(value.importance, '互动知识重要度', 0, 100),
    sourceEventSequence: integer(value.sourceEventSequence, '互动知识来源序号', Number.MIN_SAFE_INTEGER),
  }
}

function memory(value: unknown): InteractionRuntimeMemory {
  if (!isObject(value)) throw new Error('互动记忆必须是对象。')
  const kind = String(value.kind ?? '') as InteractionMemoryKind
  const status = String(value.status ?? '') as InteractionRuntimeMemory['status']
  if (!MEMORY_KINDS.has(kind)) throw new Error('互动记忆类型无效。')
  if (!MEMORY_STATUSES.has(status)) throw new Error('互动记忆状态无效。')
  if (value.authorship !== undefined && value.authorship !== 'player-correction') throw new Error('互动记忆内容来源无效。')
  if (value.playerPinned !== undefined && value.playerPinned !== true) throw new Error('记忆固定设置无效。')
  return {
    memoryId: text(value.memoryId, '互动记忆 ID', 200),
    participantKey: text(value.participantKey, '互动记忆角色', 160),
    kind,
    content: text(value.content, '互动记忆内容', 8_000),
    importance: integer(value.importance, '互动记忆重要度', 0, 100),
    sourceEventSequences: strings(value.sourceEventSequences, '互动记忆来源序号')
      .map(item => integer(Number(item), '互动记忆来源序号', Number.MIN_SAFE_INTEGER)),
    evidenceExcerpt: text(value.evidenceExcerpt, '互动记忆证据摘录', 1_000),
    status,
    proposalSequence: integer(value.proposalSequence, '互动记忆提议序号', Number.MIN_SAFE_INTEGER),
    decisionSequence: value.decisionSequence == null
      ? null
      : integer(value.decisionSequence, '互动记忆决定序号', Number.MIN_SAFE_INTEGER),
    supersededByMemoryId: nullableText(value.supersededByMemoryId, '替代记忆 ID', 200),
    ...(value.authorship === 'player-correction' ? {authorship: 'player-correction' as const} : {}),
    ...(value.contentReview === undefined ? {} : {contentReview: parseChatMemoryReceiptV1(value.contentReview)}),
    ...(value.playerPinned === true ? {playerPinned: true as const} : {}),
  }
}

function relationship(value: unknown): InteractionRuntimeRelationship {
  if (!isObject(value)) throw new Error('互动关系必须是对象。')
  const minimum = finite(value.minimum, '关系下限', -1_000_000, 1_000_000)
  const maximum = finite(value.maximum, '关系上限', minimum, 1_000_000)
  return {
    fromParticipantKey: text(value.fromParticipantKey, '关系来源角色', 160),
    toParticipantKey: text(value.toParticipantKey, '关系目标角色', 160),
    dimensionKey: text(value.dimensionKey, '关系维度 key', 160),
    label: text(value.label, '关系维度名称', 240),
    minimum,
    maximum,
    value: finite(value.value, '关系值', minimum, maximum),
    largeChangeThreshold: finite(value.largeChangeThreshold, '关系大幅变化阈值', 0, maximum - minimum),
    lastChangedSequence: integer(value.lastChangedSequence, '关系最后变化序号', Number.MIN_SAFE_INTEGER),
  }
}

function relationshipChange(value: unknown): InteractionRelationshipChange {
  if (!isObject(value)) throw new Error('互动关系历史必须是对象。')
  return {
    eventSequence: integer(value.eventSequence, '关系变化序号', Number.MIN_SAFE_INTEGER),
    fromParticipantKey: text(value.fromParticipantKey, '关系变化来源角色', 160),
    toParticipantKey: text(value.toParticipantKey, '关系变化目标角色', 160),
    dimensionKey: text(value.dimensionKey, '关系变化维度', 160),
    before: finite(value.before, '关系变化前值', -1_000_000, 1_000_000),
    after: finite(value.after, '关系变化后值', -1_000_000, 1_000_000),
    delta: finite(value.delta, '关系变化量', -1_000_000, 1_000_000),
    reason: text(value.reason, '关系变化理由', 2_000),
    ruleKey: text(value.ruleKey, '关系变化规则', 160),
    sourceEventSequence: integer(value.sourceEventSequence, '关系变化来源序号', Number.MIN_SAFE_INTEGER),
    significantEventKey: nullableText(value.significantEventKey, '重大事件 key', 160),
  }
}

function thread(value: unknown): InteractionRuntimeThread {
  if (!isObject(value)) throw new Error('互动线索必须是对象。')
  const status = String(value.status ?? '')
  if (status !== 'open' && status !== 'resolved') throw new Error('互动线索状态无效。')
  return {
    threadKey: text(value.threadKey, '互动线索 key', 160),
    title: text(value.title, '互动线索标题', 1_000),
    status,
    openedSequence: integer(value.openedSequence, '互动线索开启序号', Number.MIN_SAFE_INTEGER),
    resolvedSequence: value.resolvedSequence == null
      ? null
      : integer(value.resolvedSequence, '互动线索解决序号', Number.MIN_SAFE_INTEGER),
  }
}

export function parseFrozenChatSourceV1(value: unknown, participantKeys: readonly string[], characterKeys: readonly string[]): FrozenChatSourceProjectionV1 {
  if (!isObject(value) || value.schema !== 'storyforge.chat-runtime-source' || (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== 5 && value.version !== 6)
    || Object.keys(value).sort().join(',') !== (value.version === 6 ? 'backgroundSources,knowledge,playerCharacterSource,playerRole,privateCharacterSources,projectionHash,schema,sourceUnits,version,worldReleaseHash' : value.version === 5 ? 'backgroundSources,knowledge,playerCharacterSource,playerRole,privateCharacterSources,projectionHash,schema,version,worldReleaseHash' : value.version === 3 || value.version === 4 ? 'backgroundSources,knowledge,playerCharacterSource,playerRole,projectionHash,schema,version,worldReleaseHash' : value.version === 2 ? 'backgroundSources,knowledge,playerRole,projectionHash,schema,version,worldReleaseHash' : 'knowledge,playerRole,projectionHash,schema,version,worldReleaseHash')
    || !isSha256Hash(value.projectionHash) || !isSha256Hash(value.worldReleaseHash)
    || typeof value.playerRole !== 'string' || value.playerRole.length > 5000
    || !Array.isArray(value.knowledge) || value.knowledge.length > 2000) throw new Error('角色资料运行投影无效')
  const background = new Map<string, NonNullable<FrozenChatSourceProjectionV1['backgroundSources']>[number]>()
  const authored = new Map<string, string>()
  if (value.version === 5 || value.version === 6) {
    if (!Array.isArray(value.privateCharacterSources) || value.version === 5 && !value.privateCharacterSources.length || value.privateCharacterSources.length > 8) throw new Error('体验新角色来源数量无效')
    for (const source of value.privateCharacterSources) {
      if (!isObject(source) || Object.keys(source).sort().join(',') !== 'resourceKey,sourceHash' || !isChatPrivateCharacterKeyV1(source.resourceKey)
        || !characterKeys.includes(source.resourceKey) || authored.has(source.resourceKey) || !isSha256Hash(source.sourceHash)) throw new Error('体验新角色来源身份或证据无效')
      authored.set(source.resourceKey, source.sourceHash)
    }
  }
  if (characterKeys.some(key => isChatPrivateCharacterKeyV1(key) && !authored.has(key))) throw new Error('体验新角色缺少独立来源身份')
  const playerSource = value.version === 3 || value.version === 4 || value.version === 5 || value.version === 6 ? value.playerCharacterSource : undefined
  if ((value.version === 3 || (value.version === 4 || value.version === 5 || value.version === 6) && playerSource !== null) && (!isObject(playerSource) || Object.keys(playerSource).sort().join(',') !== 'resourceKey,sourceHash'
    || typeof playerSource.resourceKey !== 'string' || !playerSource.resourceKey.trim() || playerSource.resourceKey.length > 500
    || isChatPrivateCharacterKeyV1(playerSource.resourceKey) || characterKeys.includes(playerSource.resourceKey) || !isSha256Hash(playerSource.sourceHash))) throw new Error('玩家人物来源身份或证据无效')
  const playerSourceKey = isObject(playerSource) ? String(playerSource.resourceKey) : undefined
  if (value.version === 2 || value.version === 3 || value.version === 4 || value.version === 5 || value.version === 6) {
    if (!Array.isArray(value.backgroundSources) || value.backgroundSources.length > 128) throw new Error('背景资料来源数量无效')
    for (const source of value.backgroundSources) {
      if (!isObject(source) || Object.keys(source).sort().join(',') !== (Object.prototype.hasOwnProperty.call(source, 'relatedResourceKeys') ? 'relatedResourceKeys,resourceKey,resourceKind,sourceHash' : 'resourceKey,resourceKind,sourceHash')
        || typeof source.resourceKey !== 'string' || !source.resourceKey || source.resourceKey.length > 500
        || isChatPrivateCharacterKeyV1(source.resourceKey) || background.has(source.resourceKey) || characterKeys.includes(source.resourceKey) || source.resourceKey === playerSourceKey || !isSha256Hash(source.sourceHash)
        || typeof source.resourceKind !== 'string' || !/^[a-z][a-z-]{0,63}$/.test(source.resourceKind)
        || ['character', 'world', 'world-link', 'codex-category'].includes(source.resourceKind)) throw new Error('背景资料来源身份或证据无效')
      if (Object.prototype.hasOwnProperty.call(source, 'relatedResourceKeys') && (source.resourceKind !== 'character-relation'
        || !Array.isArray(source.relatedResourceKeys) || !source.relatedResourceKeys.length || source.relatedResourceKeys.length > 2
        || source.relatedResourceKeys.some(key => typeof key !== 'string' || !key || key.length > 500)
        || new Set(source.relatedResourceKeys).size !== source.relatedResourceKeys.length)) throw new Error('关系背景的便携来源端点无效')
      background.set(source.resourceKey, source as unknown as NonNullable<FrozenChatSourceProjectionV1['backgroundSources']>[number])
    }
  }
  const allowed = new Set(['player', ...participantKeys])
  const known = new Set<string>()
  const ranges = new Map<string, Array<{start: number; end: number}>>()
  for (const seed of value.knowledge) {
    if (!isObject(seed) || typeof seed.key !== 'string' || !seed.key || seed.key.length > 160 || known.has(seed.key)
      || Object.keys(seed).sort().join(',') !== ((value.version === 4 || value.version === 5 || value.version === 6) && Object.prototype.hasOwnProperty.call(seed, 'discovery') ? 'audienceKeys,content,discovery,key,source' : 'audienceKeys,content,key,source')
      || typeof seed.content !== 'string' || !seed.content || seed.content.length > 7900
      || !Array.isArray(seed.audienceKeys) || !seed.audienceKeys.length && !(value.version === 6 && isObject(seed.source) && seed.source.unit) && !((value.version === 4 || value.version === 5 || value.version === 6) && seed.discovery)
      || seed.audienceKeys.some(key => typeof key !== 'string' || !allowed.has(key))
      || new Set(seed.audienceKeys).size !== seed.audienceKeys.length
      || !isObject(seed.source) || !characterKeys.includes(String(seed.source.resourceKey)) && !background.has(String(seed.source.resourceKey)) && seed.source.resourceKey !== playerSourceKey
      || Object.keys(seed.source).sort().join(',') !== (value.version === 6 && Object.prototype.hasOwnProperty.call(seed.source, 'unit') ? 'pointer,purpose,resourceKey,sourceHash,unit' : Object.prototype.hasOwnProperty.call(seed.source, 'textRange')
        ? 'pointer,purpose,resourceKey,sourceHash,textRange' : 'pointer,purpose,resourceKey,sourceHash')
      || !isSha256Hash(seed.source.sourceHash) || typeof seed.source.pointer !== 'string' || !seed.source.pointer.startsWith('/') || seed.source.pointer.length > 1000
      || !['identity', 'motivation', 'voice', 'knowledge'].includes(String(seed.source.purpose))) {
      throw new Error('角色资料来源、可见性或容量无效；单项资料最多 7900 字符')
    }
    if (seed.source.unit !== undefined && (value.version !== 6 || !isObject(seed.source.unit) || Object.keys(seed.source.unit).sort().join(',') !== 'fragmentKey,unitKey'
      || typeof seed.source.unit.fragmentKey !== 'string' || !seed.source.unit.fragmentKey || seed.source.unit.fragmentKey.length > 1000
      || typeof seed.source.unit.unitKey !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(seed.source.unit.unitKey))) throw new Error('事实单位来源身份无效')
    if (seed.discovery !== undefined) {
      const rule = seed.discovery
      if (value.version !== 4 && value.version !== 5 && value.version !== 6 || seed.source.purpose !== 'knowledge' || !isObject(rule)
        || Object.keys(rule).sort().join(',') !== 'actorKeys,condition,prerequisiteKnowledgeKeys'
        || typeof rule.condition !== 'string' || !rule.condition.trim() || rule.condition.length > 2000
        || !Array.isArray(rule.actorKeys) || !rule.actorKeys.length || rule.actorKeys.length > 8
        || rule.actorKeys.some(key => typeof key !== 'string' || !participantKeys.includes(key) || (seed.audienceKeys as string[]).includes(key))
        || new Set(rule.actorKeys).size !== rule.actorKeys.length
        || !Array.isArray(rule.prerequisiteKnowledgeKeys) || !rule.prerequisiteKnowledgeKeys.length || rule.prerequisiteKnowledgeKeys.length > 200
        || rule.prerequisiteKnowledgeKeys.some(key => typeof key !== 'string' || !key || key.length > 160 || key === seed.key)
        || new Set(rule.prerequisiteKnowledgeKeys).size !== rule.prerequisiteKnowledgeKeys.length) throw new Error('世界隐情发现来源授权无效')
    }
    if (authored.has(String(seed.source.resourceKey)) && authored.get(String(seed.source.resourceKey)) !== seed.source.sourceHash) throw new Error('体验新角色资料的来源证据不一致')
    if (background.has(String(seed.source.resourceKey)) && (seed.source.purpose !== 'knowledge'
      || background.get(String(seed.source.resourceKey))!.sourceHash !== seed.source.sourceHash)) throw new Error('背景资料不能替代人物身份且必须保持来源证据')
    if (seed.source.resourceKey === playerSourceKey && (!['identity', 'knowledge'].includes(String(seed.source.purpose))
      || (playerSource as Record<string, unknown>).sourceHash !== seed.source.sourceHash)) throw new Error('玩家资料不能成为 AI 动机或口吻且必须保持来源证据')
    if (Object.prototype.hasOwnProperty.call(seed.source, 'textRange')) {
      const range = seed.source.textRange
      let original: unknown
      try { original = JSON.parse(seed.content) } catch { throw new Error('角色原文片段不是合法文本') }
      if (!isObject(range) || Object.keys(range).sort().join(',') !== 'end,start'
        || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
        || Number(range.start) < 0 || Number(range.end) <= Number(range.start)
        || typeof original !== 'string' || original.length !== Number(range.end) - Number(range.start)) {
        throw new Error('角色原文片段范围与正文不一致')
      }
      const groupKey = JSON.stringify([seed.source.resourceKey, seed.source.pointer])
      const previous = ranges.get(groupKey) ?? []
      const current = {start: Number(range.start), end: Number(range.end)}
      if (previous.some(r => current.start < r.end && current.end > r.start)) throw new Error('角色原文片段范围重复或重叠')
      ranges.set(groupKey, [...previous, current])
    }
    const subjectKey = seed.source.resourceKey === playerSourceKey ? 'player' : participantKeys[characterKeys.indexOf(String(seed.source.resourceKey))]
    if (formatChatSourceKnowledge(seed as unknown as FrozenChatSourceProjectionV1['knowledge'][number], subjectKey, chatRelationSubjects(background.get(String(seed.source.resourceKey))?.relatedResourceKeys, [...participantKeys, ...(playerSourceKey ? ['player'] : [])], [...characterKeys, ...(playerSourceKey ? [playerSourceKey] : [])])).length > 8000) {
      throw new Error('角色资料连同人物与字段归属超过运行知识容量，请缩小来源片段')
    }
    known.add(seed.key)
  }
  for (const seed of value.knowledge) if (seed.discovery) {
    for (const key of seed.discovery.prerequisiteKnowledgeKeys) {
      const prerequisite = value.knowledge.find(item => item.key === key)
      if (!prerequisite || prerequisite.source.purpose !== 'knowledge'
        || seed.discovery.actorKeys.some((actor: string) => !prerequisite.audienceKeys.includes(actor))) throw new Error('世界隐情的发现前提缺少角色可知原文依据')
    }
  }
  if (value.version === 6) validateFrozenChatSourceUnitsV1(value as unknown as FrozenChatSourceProjectionV1, participantKeys, characterKeys)
  return structuredClone(value) as unknown as FrozenChatSourceProjectionV1
}

function chatRelationSubjects(keys: readonly string[] | undefined, participants: readonly string[], characters: readonly string[]) {
  return keys?.map(key => {const participant = participants[characters.indexOf(key)]; return participant ? `${participant}（${key}）` : key})
}

function formatChatSourceKnowledge(seed: FrozenChatSourceProjectionV1['knowledge'][number], subjectKey?: string, relatedResourceKeys?: readonly string[]): string {
  const labels = {identity: '身份资料', motivation: '目标和动机（意愿，不代表已经发生）', voice: '语言资料', knowledge: '已知资料'}
  // The audience owns the knowledge; the subject owns the described trait.
  // Keeping these distinct prevents public facts about B becoming A's identity.
  const range = seed.source.textRange
  return `【${labels[seed.source.purpose]}；${subjectKey ? `所属角色=${subjectKey}${isChatPrivateCharacterKeyV1(seed.source.resourceKey) ? '；来源=本体验新角色' : ''}` : `世界背景来源=${seed.source.resourceKey}${relatedResourceKeys?.length ? `；关联人物来源=${relatedResourceKeys.join('、')}` : ''}`}；字段=${seed.source.pointer}${range ? `；原文区间=[${range.start},${range.end})` : ''}】${seed.content}`
}

/** Build the only release-entry projection for character interaction. */
export function createInitialInteractionState(input: {
  playerKey?: string
  profiles: readonly FrozenInteractionCharacterProfile[]
  sceneTemplates: readonly FrozenInteractionSceneTemplate[]
  chatSource?: FrozenChatSourceProjectionV1
  chatNarrative?: FrozenChatNarrativeV1
}): CharacterInteractionRuntimeState {
  const playerKey = input.playerKey?.trim() || 'player'
  if (input.chatNarrative !== undefined && playerKey !== 'player') throw new Error('叙事情境的玩家身份标识必须为 player')
  const profiles: InteractionRuntimeProfile[] = input.profiles.map(item => ({
    participantKey: item.participantKey,
    characterKey: item.characterKey,
    name: item.name,
    roleLabel: item.roleLabel,
    voiceRules: item.voiceRules,
    maxMemoryEntries: item.maxMemoryEntries,
  }))
  const participantKeys = new Set(profiles.map(item => item.participantKey))
  if (participantKeys.has(playerKey)) throw new Error('玩家 key 不能与互动角色重复。')
  const sceneTemplates: InteractionRuntimeSceneTemplate[] = input.sceneTemplates.map(item => ({
    ...structuredClone(item),
    relationshipRules: structuredClone(item.relationshipRules ?? []),
  }))
  const knowledgeByParticipant = new Map<string, InteractionRuntimeKnowledge>()
  const contentByKey = new Map<string, string>()
  const remember = (knowledgeKey: string, targetKey: string, content: string, importance: number) => {
    const knownContent = contentByKey.get(knowledgeKey)
    if (knownContent != null && knownContent !== content) {
      throw new Error(`初始知识 ${knowledgeKey} 内容冲突。`)
    }
    contentByKey.set(knowledgeKey, content)
    const mapKey = `${knowledgeKey}\u0000${targetKey}`
    const current = knowledgeByParticipant.get(mapKey)
    knowledgeByParticipant.set(mapKey, {
      knowledgeKey,
      participantKey: targetKey,
      content,
      status: 'known',
      importance: Math.max(current?.importance ?? 0, importance),
      sourceEventSequence: 0,
    })
  }
  for (const source of input.profiles) {
    for (const seed of source.initialKnowledge) {
      const targets = seed.visibility === 'public'
        ? [playerKey, ...participantKeys]
        : [source.participantKey]
      for (const target of targets) remember(seed.key, target, seed.content, seed.importance)
    }
  }
  if (input.chatSource) {
    const projected = parseFrozenChatSourceV1(input.chatSource, [...participantKeys], profiles.map(p => p.characterKey))
    for (const scene of sceneTemplates) for (const knowledgeKey of scene.publicKnowledgeKeys) {
      const source = projected.knowledge.find(k => k.key === knowledgeKey)
      if (source && [playerKey, ...scene.participantKeys].some(viewer => !source.audienceKeys.includes(viewer))) {
        throw new Error('场景公开知识不能扩大已确认资料的知情范围。')
      }
    }
    for (const seed of projected.knowledge) for (const target of seed.audienceKeys) {
      const subject = profiles.find(item => item.characterKey === seed.source.resourceKey)
      const mappedPlayer = projected.playerCharacterSource
      remember(seed.key, target, formatChatSourceKnowledge(seed, seed.source.resourceKey === mappedPlayer?.resourceKey ? 'player' : subject?.participantKey,
        chatRelationSubjects(projected.backgroundSources?.find(source => source.resourceKey === seed.source.resourceKey)?.relatedResourceKeys,
          [...participantKeys, ...(mappedPlayer ? ['player'] : [])], [...profiles.map(p => p.characterKey), ...(mappedPlayer ? [mappedPlayer.resourceKey] : [])])), 100)
    }
    if (!input.chatNarrative && projected.playerRole.trim()) for (const target of [playerKey, ...participantKeys]) {
      remember('chat.player-role', target, `玩家确认的虚构角色身份：${projected.playerRole}`, 100)
    }
  }
  const state: CharacterInteractionRuntimeState = {
    schema: 'storyforge.character-interaction',
    version: 1,
    playerKey,
    profiles,
    sceneTemplates,
    activeScene: null,
    sceneHistory: [],
    messages: [],
    knowledge: [...knowledgeByParticipant.values()],
    memories: [],
    relationships: input.profiles.flatMap(item => item.relationshipDimensions.map(dimension => ({
      fromParticipantKey: item.participantKey,
      toParticipantKey: playerKey,
      dimensionKey: dimension.key,
      label: dimension.label,
      minimum: dimension.minimum,
      maximum: dimension.maximum,
      value: dimension.initial,
      largeChangeThreshold: dimension.largeChangeThreshold,
      lastChangedSequence: 0,
    }))),
    relationshipHistory: [],
    threads: [],
    totalPlayerTurns: 0,
    remainingDirectorBudget: 0,
  }
  if (input.chatNarrative !== undefined) {
    if (!input.chatSource) throw new Error('主动叙事情境需要已确认的角色资料投影')
    const content = parseFrozenChatNarrativeV1(input.chatNarrative, {source: input.chatSource,
      participantKeys: profiles.map(p => p.participantKey), characterKeys: profiles.map(p => p.characterKey), sceneKeys: sceneTemplates.map(s => s.sceneKey)})
    state.chatNarrative = createChatNarrativeStateV1(content)
  }
  return parseInteractionState(state)!
}

export function parseInteractionState(value: unknown): CharacterInteractionRuntimeState | null {
  if (value == null) return null
  if (!isObject(value) || value.schema !== 'storyforge.character-interaction' || value.version !== 1) {
    throw new Error('不支持的角色互动状态。')
  }
  if (!Array.isArray(value.profiles) || !Array.isArray(value.sceneTemplates)
    || !Array.isArray(value.sceneHistory) || !Array.isArray(value.messages)
    || !Array.isArray(value.knowledge) || !Array.isArray(value.memories)
    || !Array.isArray(value.relationships) || !Array.isArray(value.relationshipHistory)
    || !Array.isArray(value.threads)) {
    throw new Error('角色互动状态集合无效。')
  }
  const result: CharacterInteractionRuntimeState = {
    schema: 'storyforge.character-interaction',
    version: 1,
    playerKey: text(value.playerKey, '玩家 key', 160),
    profiles: value.profiles.map(profile),
    sceneTemplates: value.sceneTemplates.map(sceneTemplate),
    activeScene: value.activeScene == null ? null : scene(value.activeScene),
    sceneHistory: value.sceneHistory.map(scene),
    messages: value.messages.map(message),
    knowledge: value.knowledge.map(knowledge),
    memories: value.memories.map(memory),
    relationships: value.relationships.map(relationship),
    relationshipHistory: value.relationshipHistory.map(relationshipChange),
    threads: value.threads.map(thread),
    totalPlayerTurns: integer(value.totalPlayerTurns, '互动总玩家回合', 0),
    remainingDirectorBudget: integer(value.remainingDirectorBudget, '互动导演剩余预算', 0),
  }
  assertUnique(result.profiles.map(item => item.participantKey), '互动角色 key')
  assertUnique(result.sceneTemplates.map(item => item.sceneKey), '互动场景模板 key')
  assertUnique(result.messages.map(item => item.messageId), '互动消息 ID')
  assertUnique(result.memories.map(item => item.memoryId), '互动记忆 ID')
  assertUnique(result.threads.map(item => item.threadKey), '互动线索 key')
  assertUnique(result.relationships.map(relationshipKey), '互动关系维度')
  if (value.chatNarrative !== undefined) {
    if (result.playerKey !== 'player') throw new Error('叙事情境的玩家身份标识必须为 player')
    result.chatNarrative = parseChatNarrativeStateV1(value.chatNarrative, {
      participantKeys: result.profiles.map(p => p.participantKey), characterKeys: result.profiles.map(p => p.characterKey), sceneKeys: result.sceneTemplates.map(s => s.sceneKey),
    })
  }
  for (const id of result.chatNarrative?.excludedMessageIds ?? []) requireChatRetrievalMessageV1(result, id)
  assertChatPlayerPauseSourcesV1(result)
  assertChatSceneTransitionSourcesV1(result)
  assertChatCommitmentSourcesV1(result)
  assertChatMemoryReconciliationSourcesV1(result)
  assertChatInquirySourcesV1(result)
  assertChatInquirySettlementSourcesV1(result)
  assertChatResolutionEvidenceSourcesV1(result)
  assertChatControlHandoffSourcesV1(result)
  return result
}

function relationshipKey(value: Pick<InteractionRuntimeRelationship, 'fromParticipantKey' | 'toParticipantKey' | 'dimensionKey'>): string {
  return `${value.fromParticipantKey}\u0000${value.toParticipantKey}\u0000${value.dimensionKey}`
}

function payload(event: ProductRuntimeEvent): JsonObject {
  const parsed: unknown = JSON.parse(event.payloadJson)
  if (!isObject(parsed)) throw new Error(`互动事件 ${event.type} 载荷必须是对象。`)
  return parsed
}

function verifyEnvelope(event: ProductRuntimeEvent, body: JsonObject): void {
  const commandId = text(body.commandId, '互动命令 ID', 200)
  const baseSequence = integer(body.baseSequence, '互动命令基线序号', 0)
  const baseStateHash = text(body.baseStateHash, '互动命令状态哈希', 64)
  if (!/^[a-zA-Z0-9._:-]+$/.test(commandId) || !/^[a-f0-9]{64}$/.test(baseStateHash)) {
    throw new Error('互动命令信封无效。')
  }
  if (event.commandId !== commandId || event.baseSequence !== baseSequence
    || event.baseStateHash !== baseStateHash || baseSequence !== event.sequence - 1) {
    throw new Error('互动命令信封与事件位置不一致。')
  }
}

function requireInteraction(state: CharacterInteractionRuntimeState | null): CharacterInteractionRuntimeState {
  if (!state) throw new Error('当前会话没有角色互动状态。')
  return state
}

function requireScene(state: CharacterInteractionRuntimeState): InteractionRuntimeScene {
  if (!state.activeScene || state.activeScene.status !== 'active') throw new Error('当前没有进行中的互动场景。')
  return state.activeScene
}

function requireParticipant(state: CharacterInteractionRuntimeState, participantKey: string): InteractionRuntimeProfile {
  const result = state.profiles.find(item => item.participantKey === participantKey)
  if (!result) throw new Error(`互动角色不存在: ${participantKey}`)
  return result
}

function requireEvidence(
  state: CharacterInteractionRuntimeState,
  participantKey: string,
  sourceEventSequences: number[],
  evidenceExcerpt: string,
): InteractionRuntimeMessage[] {
  if (sourceEventSequences.length === 0) throw new Error('互动事实必须引用至少一条真实消息。')
  const sources = sourceEventSequences.map(sequence => {
    const source = state.messages.find(item => item.eventSequence === sequence)
    if (!source || source.supersededBySequence != null || !visibleTo(source, participantKey)) {
      throw new Error('互动事实引用了不存在、已替代或角色不可见的消息。')
    }
    return source
  })
  if (!sources.some(source => source.text.includes(evidenceExcerpt))) {
    throw new Error('互动事实证据摘录无法在引用消息中验证。')
  }
  return sources
}

function parseAudience(value: unknown, state: CharacterInteractionRuntimeState): string[] | null {
  const audience = optionalStrings(value, '互动消息听众', 160)
  if (audience == null) return null
  for (const key of audience) {
    if (key !== state.playerKey) requireParticipant(state, key)
  }
  return audience
}

/** New narrative player messages freeze their actual audience at the event
 * boundary. Old events retain their original null/public semantics; replay
 * must never reinterpret already saved model inputs or checkpoint hashes. */
function playerMessageAudience(body: Record<string, unknown>, state: CharacterInteractionRuntimeState): string[] | null {
  if (body.playerAudienceVersion !== undefined && body.playerAudienceVersion !== 1 && body.playerAudienceVersion !== 2) throw new Error('玩家消息听众版本不受支持。')
  const audience = parseAudience(body.audienceKeys, state)
  if (!state.chatNarrative || body.playerAudienceVersion === undefined) return audience
  const active = requireScene(state).activeParticipantKeys
  if (audience?.some(key => key !== state.playerKey && !active.includes(key))) throw new Error('玩家消息只能发送给当前在场角色；离场角色不会自动听见。')
  return [...new Set([state.playerKey, ...(audience ?? active)])]
}

function applyKnowledgeDisclosure(input: {
  state: CharacterInteractionRuntimeState
  knowledgeKey: string
  fromParticipantKey: string
  toParticipantKeys: string[]
  sourceEventSequence: number
  evidenceExcerpt: string
  sourceMessage: InteractionRuntimeMessage
}): void {
  const source = input.state.knowledge.find(item => item.knowledgeKey === input.knowledgeKey
    && item.participantKey === input.fromParticipantKey && item.status === 'known')
  if (!source) throw new Error('告知者并不知道要共享的知识。')
  if (input.sourceMessage.speakerKey !== input.fromParticipantKey
    || !input.sourceMessage.text.includes(input.evidenceExcerpt)) {
    throw new Error('知识共享必须引用告知者真实说出的内容。')
  }
  for (const targetKey of input.toParticipantKeys) {
    if (targetKey !== input.state.playerKey) requireParticipant(input.state, targetKey)
    if (!visibleTo(input.sourceMessage, targetKey)) throw new Error(`知识共享消息对接收者不可见: ${targetKey}`)
    const existing = input.state.knowledge.find(item => item.knowledgeKey === input.knowledgeKey
      && item.participantKey === targetKey)
    if (existing) {
      existing.content = source.content
      existing.status = 'known'
      existing.importance = source.importance
      existing.sourceEventSequence = input.sourceEventSequence
    } else {
      input.state.knowledge.push({
        ...source,
        participantKey: targetKey,
        sourceEventSequence: input.sourceEventSequence,
      })
    }
  }
}

export function applyInteractionEvent(
  stateValue: CharacterInteractionRuntimeState | null,
  event: ProductRuntimeEvent,
): CharacterInteractionRuntimeState | null {
  if (!event.type.startsWith('interaction.')) return stateValue
  const state = requireInteraction(stateValue)
  const body = payload(event)
  if (body.inquiryEvidenceVersion !== undefined && event.type !== 'interaction.narrative.situation.committed') throw new Error('询问前提证据只能用于已审查情境事件')
  verifyEnvelope(event, body)
  if (body.actionChoiceVersion !== undefined && event.type !== 'interaction.narrative.action-reviewed.committed') throw new Error('行动选择额度只能随已审查角色行动提交')

  switch (event.type) {
    // The composition root validates the frozen target and portable receipt.
    // An upgrade records a copy; it never advances or rewrites the fiction.
    case 'interaction.release.upgraded': return state
    case 'interaction.scene.started': {
      if (state.activeScene) throw new Error('结束当前互动场景后才能开始新场景。')
      const sceneId = text(body.sceneId, '互动场景 ID', 200)
      const sceneKey = text(body.sceneKey, '互动场景 key', 160)
      if (state.sceneHistory.some(item => item.sceneId === sceneId)) throw new Error('互动场景 ID 已使用。')
      const template = state.sceneTemplates.find(item => item.sceneKey === sceneKey)
      if (!template) throw new Error(`互动场景模板不存在: ${sceneKey}`)
      for (const participantKey of template.participantKeys) requireParticipant(state, participantKey)
      state.activeScene = {
        ...structuredClone(template),
        sceneId,
        status: 'active',
        activeParticipantKeys: [...template.participantKeys],
        startedAtSequence: event.sequence,
        endedAtSequence: null,
        playerTurns: 0,
      }
      // A completed visit belongs to this instance. Reopening its scene does
      // not teleport back to the release template. Old events without visit
      // history retain their exact historical behavior.
      if (state.chatNarrative?.sceneTransitions?.length && state.chatNarrative.situation.sceneKey === sceneKey) {
        const current = state.chatNarrative.situation
        state.activeScene.title = current.title
        state.activeScene.location = current.location
        state.activeScene.timeLabel = current.timeLabel
      }
      for (const knowledgeKey of template.publicKnowledgeKeys) {
        const sources = state.knowledge.filter(item => item.knowledgeKey === knowledgeKey && item.status === 'known')
        if (!sources.length || new Set(sources.map(item => item.content)).size !== 1) {
          throw new Error(`场景公开知识缺失或内容冲突: ${knowledgeKey}`)
        }
        const source = sources[0]
        for (const participantKey of [state.playerKey, ...template.participantKeys]) {
          const current = state.knowledge.find(item => item.knowledgeKey === knowledgeKey
            && item.participantKey === participantKey)
          if (current) {
            current.content = source.content
            current.status = 'known'
            current.importance = Math.max(current.importance, source.importance)
            current.sourceEventSequence = event.sequence
          } else {
            state.knowledge.push({ ...source, participantKey, sourceEventSequence: event.sequence })
          }
        }
      }
      state.remainingDirectorBudget = template.directorBudget
      break
    }
    case 'interaction.scene.ended': {
      const active = requireScene(state)
      if (text(body.sceneId, '互动场景 ID', 200) !== active.sceneId) throw new Error('互动场景已经变化。')
      text(body.reason, '互动场景结束理由', 2_000)
      interruptChatNarrativeTriggerV1(state, event.sequence)
      active.status = 'ended'
      active.endedAtSequence = event.sequence
      state.sceneHistory.push(structuredClone(active))
      state.activeScene = null
      state.remainingDirectorBudget = 0
      break
    }
    case 'interaction.participant.joined': {
      const active = requireScene(state)
      const participantKey = text(body.participantKey, '加入角色 key', 160)
      requireParticipant(state, participantKey)
      if (active.activeParticipantKeys.includes(participantKey)) throw new Error('角色已经在当前场景中。')
      active.activeParticipantKeys.push(participantKey)
      break
    }
    case 'interaction.participant.left': {
      const active = requireScene(state)
      const participantKey = text(body.participantKey, '离场角色 key', 160)
      if (!active.activeParticipantKeys.includes(participantKey)) throw new Error('角色不在当前场景中。')
      active.activeParticipantKeys = active.activeParticipantKeys.filter(key => key !== participantKey)
      break
    }
    case 'interaction.player.message.committed': {
      const active = requireScene(state)
      if (active.playerTurns >= active.maxTurns) throw new Error('当前互动场景已达到最大玩家回合数。')
      const messageId = text(body.messageId, '互动消息 ID', 200)
      if (state.messages.some(item => item.messageId === messageId)) throw new Error('互动消息 ID 已使用。')
      state.messages.push({
        messageId,
        eventSequence: event.sequence,
        role: 'player',
        ...(state.chatNarrative && body.playerAudienceVersion === 2 ? {playerConversation: body.audienceKeys == null ? 'present' as const : 'private' as const} : {}),
        speakerKey: state.playerKey,
        audienceKeys: playerMessageAudience(body, state),
        text: text(body.text, '玩家互动消息', 12_000),
        replyToSequence: null,
        supersededBySequence: null,
      })
      active.playerTurns += 1
      state.totalPlayerTurns += 1
      interruptChatNarrativeTriggerV1(state, event.sequence, true)
      break
    }
    case 'interaction.narrative.message-retrieval.changed':
      return setChatMessageRetrievalV1(state, {sequence: event.sequence, messageId: body.messageId, excluded: body.excluded})
    case 'interaction.narrative.edit.requested':
    case 'interaction.narrative.edit.cancelled':
      return updateChatMessageEditDraftV1(state, {sequence: event.sequence, text: body.text, cancel: event.type === 'interaction.narrative.edit.cancelled'})
    case 'interaction.narrative.trigger.requested':
      return requestChatNarrativeTriggerV1(state, {sequence: event.sequence, kind: body.kind, sourceEventSequence: body.sourceEventSequence, seed: body.seed, direction: body.direction})
    case 'interaction.narrative.situation.committed':
      if (body.resolutionEvidenceVersion !== undefined) throw new Error('情境事件不能写入角色行动的收束依据')
      return applyChatSituationV1(state, {sequence: event.sequence, triggerSequence: body.triggerSequence, draft: body.draft, review: body.review, factEvidenceVersion: body.factEvidenceVersion, inquiryEvidenceVersion: body.inquiryEvidenceVersion})
    case 'interaction.narrative.action-reviewed.committed':
      return applyReviewedChatNarrativeActionV1(state, {sequence: event.sequence, triggerSequence: body.triggerSequence, actorKey: body.actorKey, messageId: body.messageId, action: body.action, review: body.review, factEvidenceVersion: body.factEvidenceVersion, resolutionEvidenceVersion: body.resolutionEvidenceVersion, actionChoiceVersion: body.actionChoiceVersion})
    case 'interaction.narrative.control-handoff.committed':
      if (Object.keys(body).sort().join(',') !== 'actorKey,baseSequence,baseStateHash,commandId,handoff,review,triggerSequence'
        || event.actorKey !== body.actorKey || typeof body.actorKey !== 'string' || typeof body.triggerSequence !== 'number') throw new Error('交还控制事件载荷无效')
      return applyReviewedChatControlHandoffV1(state, {sequence: event.sequence, triggerSequence: body.triggerSequence, actorKey: body.actorKey, handoff: body.handoff, review: body.review})
    case 'interaction.narrative.action.committed':
      return applyChatNarrativeActionV1(state, {sequence: event.sequence, triggerSequence: body.triggerSequence, actorKey: body.actorKey, messageId: body.messageId, action: body.action, factEvidenceVersion: body.factEvidenceVersion, resolutionEvidenceVersion: body.resolutionEvidenceVersion})
    case 'interaction.character.reply.committed': {
      if (state.chatNarrative) throw new Error('叙事情境中的角色表达必须与后果通过行动候选一起提交。')
      const active = requireScene(state)
      const speakerKey = text(body.speakerKey, '回复角色 key', 160)
      if (!active.activeParticipantKeys.includes(speakerKey)) throw new Error('回复角色不在当前场景中。')
      const replyToSequence = integer(body.replyToSequence, '回复目标序号', Number.MIN_SAFE_INTEGER, event.sequence - 1)
      const target = state.messages.find(item => item.eventSequence === replyToSequence)
      if (!target || target.supersededBySequence != null || !visibleTo(target, speakerKey)) {
        throw new Error('角色回复目标不存在、已替代或对角色不可见。')
      }
      const messageId = text(body.messageId, '互动消息 ID', 200)
      if (state.messages.some(item => item.messageId === messageId)) throw new Error('互动消息 ID 已使用。')
      const supersedesSequence = body.supersedesSequence == null
        ? null
        : integer(body.supersedesSequence, '替代回复序号', Number.MIN_SAFE_INTEGER, event.sequence - 1)
      const activeReplies = state.messages.filter(item => item.role === 'character'
        && item.speakerKey === speakerKey && item.replyToSequence === replyToSequence
        && item.supersededBySequence == null)
      if (activeReplies.length > 0 && !activeReplies.some(item => item.eventSequence === supersedesSequence)) {
        throw new Error('该角色已有当前回复；重试必须明确替代原回复。')
      }
      if (supersedesSequence != null) {
        const superseded = activeReplies.find(item => item.eventSequence === supersedesSequence)
        if (!superseded) throw new Error('待替代的角色回复无效。')
        superseded.supersededBySequence = event.sequence
      }
      const budgetCost = integer(body.budgetCost ?? 0, '互动回复预算消耗', 0, 1_000_000)
      if (budgetCost > state.remainingDirectorBudget) throw new Error('互动场景导演预算不足。')
      state.remainingDirectorBudget -= budgetCost
      const committed: InteractionRuntimeMessage = {
        messageId,
        eventSequence: event.sequence,
        role: 'character',
        speakerKey,
        audienceKeys: parseAudience(body.audienceKeys, state),
        text: text(body.text, '角色互动回复', 20_000),
        replyToSequence,
        supersededBySequence: null,
      }
      state.messages.push(committed)
      if (body.disclosures != null) {
        if (!Array.isArray(body.disclosures)) throw new Error('角色回复知识披露必须是数组。')
        for (const raw of body.disclosures) {
          if (!isObject(raw)) throw new Error('角色回复知识披露必须是对象。')
          const knowledgeKey = text(raw.knowledgeKey, '披露知识 key', 160)
          const toParticipantKeys = strings(raw.toParticipantKeys, '披露知识接收者', 160)
          if (toParticipantKeys.length === 0) throw new Error('知识披露至少需要一名接收者。')
          applyKnowledgeDisclosure({
            state,
            knowledgeKey,
            fromParticipantKey: speakerKey,
            toParticipantKeys,
            sourceEventSequence: event.sequence,
            evidenceExcerpt: text(raw.evidenceExcerpt, '披露知识证据摘录', 1_000),
            sourceMessage: committed,
          })
        }
      }
      break
    }
    case 'interaction.memory.proposed': {
      const participantKey = text(body.participantKey, '记忆角色 key', 160)
      requireParticipant(state, participantKey)
      const memoryId = text(body.memoryId, '互动记忆 ID', 200)
      if (state.memories.some(item => item.memoryId === memoryId)) throw new Error('互动记忆 ID 已使用。')
      const kind = text(body.kind, '互动记忆类型', 40) as InteractionMemoryKind
      if (!MEMORY_KINDS.has(kind)) throw new Error('互动记忆类型无效。')
      const sourceEventSequences = strings(body.sourceEventSequences, '互动记忆来源序号')
        .map(item => integer(Number(item), '互动记忆来源序号', Number.MIN_SAFE_INTEGER, event.sequence - 1))
      const evidenceExcerpt = text(body.evidenceExcerpt, '互动记忆证据摘录', 1_000)
      requireEvidence(state, participantKey, sourceEventSequences, evidenceExcerpt)
      const proposed: InteractionRuntimeMemory = {
        memoryId,
        participantKey,
        kind,
        content: text(body.content, '互动记忆内容', 8_000),
        importance: integer(body.importance, '互动记忆重要度', 0, 100),
        sourceEventSequences,
        evidenceExcerpt,
        status: 'proposed',
        proposalSequence: event.sequence,
        decisionSequence: null,
        supersededByMemoryId: null,
        ...(body.contentReview === undefined ? {} : {contentReview: parseChatMemoryReceiptV1(body.contentReview)}),
      }
      if (proposed.contentReview && !hasChatMemoryContentReviewV1(state, proposed)) throw new Error('记忆审查凭据与正文或来源不一致。')
      state.memories.push(proposed)
      break
    }
    case 'interaction.narrative.memory-control.changed':
    case 'interaction.narrative.memory.corrected': {
      if (event.actorKey !== state.playerKey) throw new Error('记忆管理需要玩家明确操作。')
      const memoryId = text(body.memoryId, '互动记忆 ID', 200)
      const target = state.memories.find(item => item.memoryId === memoryId)
      const allowedStatuses = event.type === 'interaction.narrative.memory.corrected' ? ['accepted', 'disabled', 'proposed'] : ['accepted', 'disabled']
      if (!target || !allowedStatuses.includes(target.status) || target.supersededByMemoryId != null) throw new Error('这条记忆已变化，不能继续本次管理操作。')
      // A player may stop using a memory whose old message was superseded,
      // but cannot inspect or manipulate another role's private sources.
      if (!target.sourceEventSequences.length || target.sourceEventSequences.some(sequence => {
        const source = state.messages.find(item => item.eventSequence === sequence)
        return !source || !visibleTo(source, state.playerKey) || !visibleTo(source, target.participantKey)
      })) throw new Error('玩家不能管理来源不可见的角色记忆。')
      text(body.reason, '记忆调整原因', 1_000)
      if (event.type === 'interaction.narrative.memory-control.changed') {
        const action = body.action
        if ((action === 'pin' || action === 'unpin') && !state.chatNarrative) throw new Error('固定检索需要主动叙事聊天。')
        if (action === 'pin' && !target.playerPinned) {
          requireEvidence(state, target.participantKey, target.sourceEventSequences, target.evidenceExcerpt)
          if (target.authorship !== 'player-correction' && !hasChatMemoryContentReviewV1(state, target)) throw new Error('旧摘要尚未检查，请先依据原消息修正后再固定。')
          target.playerPinned = true
        } else if (action === 'unpin' && target.playerPinned) delete target.playerPinned
        else if (action === 'disable' && target.status === 'accepted') target.status = 'disabled'
        else if (action === 'revoke') target.status = 'revoked'
        else if (action === 'enable' && target.status === 'disabled') {
          requireEvidence(state, target.participantKey, target.sourceEventSequences, target.evidenceExcerpt)
          const max = requireParticipant(state, target.participantKey).maxMemoryEntries
          if (state.memories.filter(item => item.participantKey === target.participantKey && item.status === 'accepted').length >= max) throw new Error('角色持久记忆已达上限，不能恢复这条记忆。')
          target.status = 'accepted'
        } else throw new Error('记忆状态不支持本次调整。')
        target.decisionSequence = event.sequence
      } else {
        const replacementId = text(body.replacementMemoryId, '修正记忆 ID', 200)
        if (state.memories.some(item => item.memoryId === replacementId)) throw new Error('修正记忆 ID 已使用。')
        const sourceEventSequences = strings(body.sourceEventSequences, '修正记忆来源序号')
          .map(item => integer(Number(item), '修正记忆来源序号', Number.MIN_SAFE_INTEGER, event.sequence - 1))
        const evidenceExcerpt = text(body.evidenceExcerpt, '修正记忆证据摘录', 1_000)
        const sources = requireEvidence(state, target.participantKey, sourceEventSequences, evidenceExcerpt)
        if (sources.some(source => !visibleTo(source, state.playerKey))) throw new Error('修正记忆不能引用玩家不可见的消息。')
        if (target.status === 'proposed') {
          const max = requireParticipant(state, target.participantKey).maxMemoryEntries
          if (state.memories.filter(item => item.participantKey === target.participantKey && item.status === 'accepted').length >= max) throw new Error('角色持久记忆已达上限，请先停用或撤回其他记忆。')
        }
        // One event replaces the active entry at capacity. A disabled entry
        // stays disabled; correction is not an implicit re-enable operation.
        const {contentReview: _oldReview, ...prior} = target
        state.memories.push({...prior, memoryId: replacementId, content: text(body.content, '修正记忆内容', 8_000), status: target.status === 'proposed' ? 'accepted' : target.status,
          sourceEventSequences, evidenceExcerpt, proposalSequence: event.sequence, decisionSequence: event.sequence,
          supersededByMemoryId: null, authorship: 'player-correction'})
        target.status = 'superseded'
        target.decisionSequence = event.sequence
        target.supersededByMemoryId = replacementId
      }
      break
    }
    case 'interaction.memory.accepted':
    case 'interaction.memory.rejected': {
      const memoryId = text(body.memoryId, '互动记忆 ID', 200)
      const target = state.memories.find(item => item.memoryId === memoryId)
      if (!target || target.status !== 'proposed') throw new Error('待处理的互动记忆提议不存在。')
      if (event.type === 'interaction.memory.accepted') {
        const maxEntries = requireParticipant(state, target.participantKey).maxMemoryEntries
        const activeCount = state.memories.filter(item => item.participantKey === target.participantKey
          && item.status === 'accepted').length
        if (activeCount >= maxEntries) throw new Error('角色持久记忆已达上限，请先替代旧记忆。')
        target.status = 'accepted'
      } else {
        target.status = 'rejected'
      }
      target.decisionSequence = event.sequence
      break
    }
    case 'interaction.memory.superseded': {
      const memoryId = text(body.memoryId, '旧互动记忆 ID', 200)
      const supersededByMemoryId = text(body.supersededByMemoryId, '新互动记忆 ID', 200)
      const target = state.memories.find(item => item.memoryId === memoryId)
      const replacement = state.memories.find(item => item.memoryId === supersededByMemoryId)
      if (!target || target.status !== 'accepted' || !replacement || replacement.status !== 'accepted'
        || target.participantKey !== replacement.participantKey || memoryId === supersededByMemoryId) {
        throw new Error('互动记忆替代关系无效。')
      }
      target.status = 'superseded'
      target.decisionSequence = event.sequence
      target.supersededByMemoryId = supersededByMemoryId
      break
    }
    case 'interaction.knowledge.shared': {
      const knowledgeKey = text(body.knowledgeKey, '共享知识 key', 160)
      const fromParticipantKey = text(body.fromParticipantKey, '知识告知者', 160)
      const toParticipantKeys = strings(body.toParticipantKeys, '知识接收者', 160)
      if (toParticipantKeys.length === 0) throw new Error('知识共享至少需要一名接收者。')
      const sourceEventSequence = integer(body.sourceEventSequence, '知识共享来源序号', Number.MIN_SAFE_INTEGER, event.sequence - 1)
      const evidenceExcerpt = text(body.evidenceExcerpt, '知识共享证据摘录', 1_000)
      const sourceMessages = requireEvidence(state, fromParticipantKey, [sourceEventSequence], evidenceExcerpt)
      const sourceMessage = sourceMessages[0]
      applyKnowledgeDisclosure({
        state,
        knowledgeKey,
        fromParticipantKey,
        toParticipantKeys,
        sourceEventSequence: event.sequence,
        evidenceExcerpt,
        sourceMessage,
      })
      break
    }
    case 'interaction.relationship.changed': {
      const fromParticipantKey = text(body.fromParticipantKey, '关系来源角色', 160)
      const toParticipantKey = text(body.toParticipantKey, '关系目标角色', 160)
      const dimensionKey = text(body.dimensionKey, '关系维度 key', 160)
      requireParticipant(state, fromParticipantKey)
      if (toParticipantKey !== state.playerKey) requireParticipant(state, toParticipantKey)
      const target = state.relationships.find(item => relationshipKey(item)
        === relationshipKey({ fromParticipantKey, toParticipantKey, dimensionKey }))
      if (!target) throw new Error('待变化的关系维度不存在。')
      const delta = finite(body.delta, '关系变化量', -1_000_000, 1_000_000)
      if (delta === 0) throw new Error('关系变化量不能为零。')
      const sourceEventSequence = integer(body.sourceEventSequence, '关系变化来源序号', Number.MIN_SAFE_INTEGER, event.sequence - 1)
      const source = state.messages.find(item => item.eventSequence === sourceEventSequence)
      if (!source || source.supersededBySequence != null || !visibleTo(source, fromParticipantKey)) {
        throw new Error('关系变化缺少该角色可见的真实互动依据。')
      }
      const significantEventKey = nullableText(body.significantEventKey, '重大事件 key', 160)
      if (Math.abs(delta) > target.largeChangeThreshold && !significantEventKey) {
        throw new Error('大幅关系变化必须绑定明确的重大事件。')
      }
      const before = target.value
      const after = Math.min(target.maximum, Math.max(target.minimum, before + delta))
      const actualDelta = after - before
      if (actualDelta === 0) throw new Error('关系值已在边界，当前变化不会产生状态差异。')
      target.value = after
      target.lastChangedSequence = event.sequence
      state.relationshipHistory.push({
        eventSequence: event.sequence,
        fromParticipantKey,
        toParticipantKey,
        dimensionKey,
        before,
        after,
        delta: actualDelta,
        reason: text(body.reason, '关系变化理由', 2_000),
        ruleKey: text(body.ruleKey, '关系变化规则', 160),
        sourceEventSequence,
        significantEventKey,
      })
      break
    }
    case 'interaction.thread.opened': {
      const threadKey = text(body.threadKey, '互动线索 key', 160)
      if (state.threads.some(item => item.threadKey === threadKey)) throw new Error('互动线索 key 已使用。')
      state.threads.push({
        threadKey,
        title: text(body.title, '互动线索标题', 1_000),
        status: 'open',
        openedSequence: event.sequence,
        resolvedSequence: null,
      })
      break
    }
    case 'interaction.thread.resolved': {
      const threadKey = text(body.threadKey, '互动线索 key', 160)
      const target = state.threads.find(item => item.threadKey === threadKey)
      if (!target || target.status !== 'open') throw new Error('待解决的互动线索不存在。')
      text(body.resolution, '互动线索解决说明', 2_000)
      target.status = 'resolved'
      target.resolvedSequence = event.sequence
      break
    }
    default:
      throw new Error(`未知角色互动事件: ${event.type}`)
  }
  return state
}

export interface InteractionVisibilityView {
  participantKey: string
  activeScene: InteractionRuntimeScene | null
  messages: InteractionRuntimeMessage[]
  knowledge: InteractionRuntimeKnowledge[]
  memories: InteractionRuntimeMemory[]
  relationships: InteractionRuntimeRelationship[]
  threads: InteractionRuntimeThread[]
  chatNarrative?: ChatNarrativeViewV1
  relationshipEvidence?: InteractionRelationshipChange[]
  /** Other actors' spoken promises only; never their associated private goals. */
  sharedCommitments?: ReturnType<typeof chatVisibleCommitmentsV1>
  /** Versioned model input only, never part of the ordinary visibility hash. */
  memoryCorrections?: ChatMemoryCorrectionContextV1
}

export function interactionVisibilityView(
  stateValue: CharacterInteractionRuntimeState,
  participantKey: string,
): InteractionVisibilityView {
  const state = requireInteraction(parseInteractionState(stateValue))
  if (participantKey !== state.playerKey) requireParticipant(state, participantKey)
  const sharedCommitments = chatVisibleCommitmentsV1(state, participantKey).filter(c => c.actorKey !== participantKey)
  return {
    participantKey,
    activeScene: state.activeScene ? structuredClone(state.activeScene) : null,
    messages: state.messages.filter(item => item.supersededBySequence == null && visibleTo(item, participantKey)),
    knowledge: state.knowledge.filter(item => item.participantKey === participantKey && item.status !== 'forgotten'),
    memories: state.memories.filter(item => item.participantKey === participantKey && item.status === 'accepted').map(interactionMemoryForContextV1),
    relationships: state.relationships.filter(item => item.fromParticipantKey === participantKey),
    threads: state.threads.filter(item => item.status === 'open'),
    ...(state.chatNarrative ? {chatNarrative: chatNarrativeViewV1(state.chatNarrative, participantKey), relationshipEvidence: chatRelationshipEvidenceV1(state, participantKey)} : {}),
    ...(sharedCommitments.length ? {sharedCommitments} : {}),
  }
}

/** Model retrieval keeps the visibility boundary and only omits user-selected
 * dialogue. The ordinary visibility view still supports reading the full log. */
export function interactionRetrievalView(state: CharacterInteractionRuntimeState, participantKey: string) {
  const view = interactionVisibilityView(state, participantKey)
  const all = view.messages
  view.messages = all.filter(m => isChatMessageRetrievableV1(state, m))
  return {...view, ...(all.length !== view.messages.length ? {excludedMessageCount: all.length - view.messages.length} : {})}
}

export interface InteractionContextWindow extends InteractionVisibilityView {
  /** Projection-only format marker; never persisted into narrative state. */
  messageIdentityVersion?: 1
  historyContext?: {version: 1; policy: string; resolutions: ReturnType<import('./history-selection').ChatHistoryPlanV1['resolutions']>; omitted: {facts: number; goals: number; threads: number}}
  selection?: ChatContextSelectionV1
  excludedMessageCount?: number
  omittedMessageCount: number
  characterCount: number
}

export function buildInteractionContextWindow(
  state: CharacterInteractionRuntimeState,
  participantKey: string,
  options: { maxCharacters?: number; maxRecentMessages?: number; retrievalVersion?: import('./context-selection').ChatRetrievalVersion } = {},
): InteractionContextWindow {
  if (state.chatNarrative && state.activeScene && state.chatNarrative.situation.sceneKey !== state.activeScene.sceneKey) {
    throw new Error('当前场景尚未衔接叙事情境，请完成情境切换后继续')
  }
  const maxCharacters = Math.max(2_000, Math.min(options.maxCharacters ?? 24_000, 100_000))
  const maxRecentMessages = Math.max(4, Math.min(options.maxRecentMessages ?? 32, 200))
  assertChatResponseRetrievableV1(state)
  const visible = interactionRetrievalView(state, participantKey)
  if (state.chatNarrative && options.retrievalVersion !== 'legacy') {
    const profile = state.profiles.find(p => p.participantKey === participantKey)
    if (!profile) throw new Error('缺少角色视角，无法选择来源资料')
    if (supportsChatCorrectionContextV1(options.retrievalVersion ?? 'chat-relevance-v10')) visible.memoryCorrections = chatMemoryCorrectionContextV1(state, participantKey)
    if ((options.retrievalVersion === 'chat-relevance-v12' || (options.retrievalVersion === 'chat-relevance-v13' || options.retrievalVersion === 'chat-relevance-v14')) && visible.chatNarrative) {
      visible.chatNarrative = {...visible.chatNarrative, ...chatTurnAudienceGuidanceV2(state.chatNarrative.triggers.slice(-1)[0]?.direction)}
    }
    if (options.retrievalVersion === 'chat-relevance-v11' || options.retrievalVersion === 'chat-relevance-v12' || (options.retrievalVersion === 'chat-relevance-v13' || options.retrievalVersion === 'chat-relevance-v14')) return selectChatHistoryActorContextV1(state, visible, profile, {maxCharacters, maxRecentMessages, optionalMaxCharacters: 18_000, optionalMaxTokens: 6000, relationshipHistory: true, messageIdentities: true, ...((options.retrievalVersion === 'chat-relevance-v13' || options.retrievalVersion === 'chat-relevance-v14') ? {followupEvidence: true} : {}), ...(options.retrievalVersion === 'chat-relevance-v14' ? {recentDialogue: true} : {})})
    if ((options.retrievalVersion ?? 'chat-relevance-v10') === 'chat-relevance-v10') return selectChatHistoryActorContextV1(state, visible, profile, {maxCharacters, maxRecentMessages, optionalMaxCharacters: 18_000, optionalMaxTokens: 6000, relationshipHistory: true})
    if (options.retrievalVersion === 'chat-relevance-v9') return selectChatHistoryActorContextV1(state, visible, profile, {maxCharacters, maxRecentMessages, optionalMaxCharacters: 18_000, optionalMaxTokens: 6000})
    if (options.retrievalVersion === 'chat-relevance-v8') return selectChatHistoryActorContextV1(state, visible, profile, {maxCharacters, maxRecentMessages})
    return selectChatContextWindowV1(visible, profile, {maxCharacters, maxRecentMessages, retrievalVersion: options.retrievalVersion ?? 'chat-relevance-v10',
      requiredCommitmentKeys: requiredChatCommitmentKeysV1(state.chatNarrative!.situation.goals)})
  }
  const allMessages = visible.messages
  visible.messages = allMessages.slice(-maxRecentMessages)
  visible.memories.sort((left, right) => right.importance - left.importance || left.proposalSequence - right.proposalSequence)
  visible.knowledge.sort((left, right) => right.importance - left.importance || left.knowledgeKey.localeCompare(right.knowledgeKey))
  const result: InteractionContextWindow = {
    ...visible,
    omittedMessageCount: allMessages.length - visible.messages.length,
    characterCount: 0,
  }
  const size = () => JSON.stringify({ ...result, characterCount: 0 }).length
  while (size() > maxCharacters && result.messages.length > 4) {
    result.messages.shift()
    result.omittedMessageCount += 1
  }
  while (size() > maxCharacters && result.knowledge.length > 1) result.knowledge.pop()
  while (size() > maxCharacters && !result.chatNarrative && result.relationships.length > 1) result.relationships.pop()
  if (size() > maxCharacters) throw new Error('角色关键记忆与安全上下文超过预算，请调整作者配置。')
  result.characterCount = size()
  return result
}

/**
 * A child SIM starts its own event sequence at 1. Pre-branch references therefore
 * move into a negative, immutable prehistory range so new events cannot collide.
 */
export function rebaseInteractionStateForBranch(
  stateValue: CharacterInteractionRuntimeState,
  parentThroughSequence: number,
): CharacterInteractionRuntimeState {
  const state = requireInteraction(parseInteractionState(stateValue))
  const rebase = (sequence: number | null): number | null => {
    if (sequence == null || sequence === 0) return sequence
    if (sequence > parentThroughSequence) throw new Error('互动分支状态包含目标序号之后的引用。')
    // Shift older prehistory too: otherwise a branch of a branch can alias an
    // old negative reference with a newly rebased event of the child session.
    const next = sequence - parentThroughSequence - 1
    if (!Number.isSafeInteger(next)) throw new Error('互动分支事件引用超出安全范围。')
    return next
  }
  for (const item of state.messages) {
    item.eventSequence = rebase(item.eventSequence)!
    item.replyToSequence = rebase(item.replyToSequence)
    item.supersededBySequence = rebase(item.supersededBySequence)
  }
  for (const item of state.knowledge) item.sourceEventSequence = rebase(item.sourceEventSequence)!
  for (const item of state.memories) {
    item.sourceEventSequences = item.sourceEventSequences.map(sequence => rebase(sequence)!)
    item.proposalSequence = rebase(item.proposalSequence)!
    item.decisionSequence = rebase(item.decisionSequence)
  }
  for (const item of state.relationships) item.lastChangedSequence = rebase(item.lastChangedSequence)!
  for (const item of state.relationshipHistory) {
    item.eventSequence = rebase(item.eventSequence)!
    item.sourceEventSequence = rebase(item.sourceEventSequence)!
  }
  for (const item of state.threads) {
    item.openedSequence = rebase(item.openedSequence)!
    item.resolvedSequence = rebase(item.resolvedSequence)
  }
  if (state.chatNarrative) rebaseChatNarrativeStateV1(state.chatNarrative, value => rebase(value)!)
  const scenes = [...state.sceneHistory, ...(state.activeScene ? [state.activeScene] : [])]
  for (const item of scenes) {
    item.startedAtSequence = rebase(item.startedAtSequence)!
    item.endedAtSequence = rebase(item.endedAtSequence)
  }
  return state
}
