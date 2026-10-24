import {assertChatInquiryRespondentReferenceV1} from './inquiry-settlement'
import {chatTurnAudienceGuidanceV1} from './narrative-audience'
import {parseChatControlHandoffRecordV1} from './control-handoff-state'
import {CHAT_HISTORY_CAPACITY_V1, assertChatHistoryCapacityV1} from './history-capacity'
import {validateChatSceneTransitionRecordsV1} from './narrative-scene-transition'
import {validateChatResolutionEvidenceV1} from './resolution-evidence'
import {validateChatFactEvidenceV1} from './fact-evidence'
import {validateChatInquiryHistoryV1, chatInquiryRepliesV1} from './narrative-inquiry'
import {chatPlayerPauseSequencesV1, rebaseChatPlayerPausesV1, validateChatGoalPlayerPauseV1} from './narrative-player-pause'
import {validateChatMemoryReconciliationRecordsV1} from './memory-reconciliation'
import {validateChatFactDiscoveryRuleV1, validateChatDiscoveryHistoryV1, chatActorInvestigationResultsV1} from './narrative-discovery'
import {validateChatMessageEditDraftV1} from './narrative-edit-contract'
import {chatCommitmentSequencesV1, rebaseChatCommitmentsV1, validateChatGoalCommitmentsV1} from './narrative-commitments'
import {parseChatPersonaV1} from './persona-source'
import { isSha256Hash } from '../product-production/hash'
import { CHAT_NARRATIVE_TRIGGERS_V1, CHAT_THREAD_STATUSES_V1 } from '../types/chat-narrative'
import type { ChatNarrativePermissionsV1, ChatNarrativeStateV1, ChatNarrativeTriggerStateV1, ChatTurnDirectionV1, ChatSituationV1, FrozenChatNarrativeV1 } from '../types/chat-narrative'
import type { FrozenChatSourceProjectionV1 } from '../types/character-interaction'

type Row = Record<string, unknown>
export const CHAT_INITIAL_FACT_CAPACITY_V1 = 200
export function chatTurnActionLimitV1(permissions: ChatNarrativePermissionsV1, trigger: ChatNarrativeTriggerStateV1): number {
  return trigger.direction?.actionLimit ?? permissions.maxActionsPerTrigger
}

export function parseChatTurnDirectionV1(value: unknown, participantKeys: readonly string[], maximum: number): ChatTurnDirectionV1 {
  const hasScheduling = value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'scheduling')
  const hasSettlement = value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'settleSituationVersion')
  const hasAudience = value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'audienceParticipantKeys')
  const hasMode = value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'conversationMode')
  const direction = row(value, 'actorKey,actionLimit' + (hasScheduling ? ',scheduling' : '') + (hasSettlement ? ',settleSituationVersion' : '') + (hasAudience ? ',audienceParticipantKeys' : '') + (hasMode ? ',conversationMode' : ''), '本轮演绎设置')
  if (hasMode && (!hasAudience || direction.conversationMode !== 'private' && direction.conversationMode !== 'present')) fail('本轮对话方式缺少听众或无效')
  if (hasSettlement && direction.settleSituationVersion !== 1) fail('本轮情境结算版本无效')
  const settlement = hasSettlement ? {settleSituationVersion: 1 as const} : {}
  members([direction.actorKey], participantKeys, '本轮行动角色', true)
  const audience = hasAudience ? members(direction.audienceParticipantKeys, participantKeys, '本轮对话角色', true) : undefined
  if (audience && !audience.includes(String(direction.actorKey))) fail('本轮行动角色不在对话范围')
  const conversation = audience ? {audienceParticipantKeys: [...audience], ...(hasMode ? {conversationMode: direction.conversationMode as 'private' | 'present'} : {})} : {}
  integer(direction.actionLimit, '本轮动作上限', 1, maximum)
  if (hasScheduling) {
    const scheduling = row(direction.scheduling, 'mode,participantKeys', '本轮角色调度')
    if (!['natural', 'round-robin'].includes(String(scheduling.mode))) fail('本轮角色调度方式无效')
    const pool = members(scheduling.participantKeys, participantKeys, '本轮调度角色', true)
    if (!pool.includes(String(direction.actorKey))) fail('本轮首选角色不在调度范围')
    if (audience && pool.some(key => !audience.includes(key))) fail('本轮调度角色超出对话范围')
    return {actorKey: String(direction.actorKey), actionLimit: Number(direction.actionLimit), ...settlement, ...conversation,
      scheduling: {mode: scheduling.mode as 'natural' | 'round-robin', participantKeys: [...pool]}}
  }
  return {actorKey: String(direction.actorKey), actionLimit: Number(direction.actionLimit), ...settlement, ...conversation}
}
export interface ChatNarrativeBoundaryV1 {
  participantKeys: readonly string[]
  characterKeys: readonly string[]
  sceneKeys: readonly string[]
}
function fail(label: string): never { throw new Error(`[chat-narrative] ${label}`) }
function row(value: unknown, keys: string, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== keys.split(',').sort().join(',')) fail(`${label} 字段无效`)
  return value as Row
}
function text(value: unknown, label: string, max = 4000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} 内容无效`)
}
function key(value: unknown, label: string): asserts value is string {
  text(value, label, 160)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)) fail(`${label} 不是稳定标识`)
}
function integer(value: unknown, label: string, min: number, max: number): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) fail(`${label} 数值无效`)
}
function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(`${label} 数量无效`)
  return value
}
function members(value: unknown, allowed: readonly string[], label: string, nonempty = false): string[] {
  const values = list(value, label, allowed.length)
  if ((nonempty && !values.length) || new Set(values).size !== values.length
    || values.some(item => typeof item !== 'string' || !allowed.includes(item))) fail(`${label} 引用无效`)
  return values as string[]
}
function unique(rows: Row[], field: string, label: string) {
  rows.forEach(item => key(item[field], label))
  if (new Set(rows.map(item => item[field])).size !== rows.length) fail(`${label} 重复`)
}
function sequence(value: unknown, initial: boolean, label: string) {
  integer(value, label, initial ? 0 : Number.MIN_SAFE_INTEGER, initial ? 0 : Number.MAX_SAFE_INTEGER)
}

function validateCommon(value: Row, boundary: ChatNarrativeBoundaryV1) {
  if (value.version !== 1 || !isSha256Hash(value.worldReleaseHash)) fail('版本或冻结世界 hash 无效')
  if (!boundary.participantKeys.length || boundary.participantKeys.includes('player')
    || new Set(boundary.participantKeys).size !== boundary.participantKeys.length
    || boundary.participantKeys.length !== boundary.characterKeys.length) fail('参与角色边界无效')
  parseChatPersonaV1(value.persona, boundary.characterKeys)
  return parseChatNarrativePermissionsV1(value.permissions)
}

export function parseChatNarrativePermissionsV1(value: unknown): ChatNarrativePermissionsV1 {
  const extra = ['allowActorSituationExpansion', 'allowPlayerFollowupSituations', 'allowActorThreadFollowups', 'maxDiscoveriesPerSituation', 'allowInquiryResults'].filter(key => value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)).map(key => ',' + key).join('')
  const permissions = row(value, 'mode,triggers,allowedNewFactKinds,maxNewFactsPerAction,maxActiveThreads,maxActionsPerTrigger,maxActionCharacters,intensity' + extra, '运行权限')
  if (Object.prototype.hasOwnProperty.call(permissions, 'allowActorSituationExpansion') && typeof permissions.allowActorSituationExpansion !== 'boolean') fail('角色推进授权无效')
  if (Object.prototype.hasOwnProperty.call(permissions, 'allowPlayerFollowupSituations') && typeof permissions.allowPlayerFollowupSituations !== 'boolean') fail('新事项承接授权无效')
  if (Object.prototype.hasOwnProperty.call(permissions, 'allowActorThreadFollowups') && typeof permissions.allowActorThreadFollowups !== 'boolean') fail('既有事项接续授权无效')
  if (permissions.allowInquiryResults !== undefined && typeof permissions.allowInquiryResults !== 'boolean') fail('询问结果授权无效')
  if (permissions.allowInquiryResults === true && permissions.allowActorSituationExpansion !== true) fail('询问结果需要角色情境推进授权')
  if (permissions.allowActorThreadFollowups === true && permissions.allowActorSituationExpansion !== true) fail('既有事项接续需要角色情境推进授权')
  if (permissions.allowPlayerFollowupSituations === true && permissions.allowActorSituationExpansion !== true) fail('新事项承接需要角色情境推进授权')
  if (!['story', 'companionship'].includes(String(permissions.mode)) || !['everyday', 'tension', 'danger'].includes(String(permissions.intensity))) fail('叙事节奏或事件强度无效')
  if (permissions.maxDiscoveriesPerSituation !== undefined) {
    integer(permissions.maxDiscoveriesPerSituation, '单次调查事实数', 0, 3)
    if (Number(permissions.maxDiscoveriesPerSituation) > 0 && permissions.allowActorSituationExpansion !== true) fail('调查发现需要角色情境推进授权')
  }
  members(permissions.triggers, CHAT_NARRATIVE_TRIGGERS_V1, '主动触发', true)
  const kinds = members(permissions.allowedNewFactKinds, ['observation', 'object', 'place', 'temporary-character'], '私域新增事实类型')
  integer(permissions.maxNewFactsPerAction, '单次新增事实', 0, 5)
  if (permissions.allowInquiryResults === true && (!kinds.includes('observation') || Number(permissions.maxNewFactsPerAction) < 1)) fail('询问结果须有至少一条观察事实记录额度')
  if (!kinds.length && permissions.maxNewFactsPerAction !== 0) fail('未授权创作类型却分配了新增事实预算')
  integer(permissions.maxActiveThreads, '活跃剧情线上限', 1, 8)
  integer(permissions.maxActionsPerTrigger, '触发动作上限', 1, 3)
  integer(permissions.maxActionCharacters, '单次表达长度', 100, 8000)
  return structuredClone(value) as ChatNarrativePermissionsV1
}

function validateSituation(value: unknown, boundary: ChatNarrativeBoundaryV1, initial: boolean, maxActiveThreads: number) {
  const situation = row(value, 'situationKey,sceneKey,title,location,timeLabel,seed,facts,goals,beliefs,threads,possibilities', '情境')
  key(situation.situationKey, '情境标识')
  if (!boundary.sceneKeys.includes(String(situation.sceneKey))) fail('情境引用了包外场景')
  for (const field of ['title', 'location', 'timeLabel']) text(situation[field], `情境 ${field}`, 1000)
  const seed = row(situation.seed, 'text,origin,sourceEventSequence,sourceThreadKey', '情境种子')
  text(seed.text, '情境种子')
  if (!['author-confirmed', 'player-request', 'continued-thread', 'player-followup'].includes(String(seed.origin))) fail('种子来源无效')
  sequence(seed.sourceEventSequence, initial, '种子事件')
  if (initial && seed.origin !== 'author-confirmed') fail('初始情境必须来自作者确认')
  if (seed.origin === 'continued-thread') key(seed.sourceThreadKey, '种子剧情线')
  else if (seed.sourceThreadKey !== null) fail('种子剧情线来源与类型不符')
  if (seed.origin !== 'author-confirmed' && seed.sourceEventSequence === 0) fail('运行情景请求缺少真实事件')
  const viewers = ['player', ...boundary.participantKeys]
  const facts = list(situation.facts, '情境事实', initial ? CHAT_INITIAL_FACT_CAPACITY_V1 : CHAT_HISTORY_CAPACITY_V1.facts).map(item => row(item, 'factKey,text,audienceKeys,origin,sourceKnowledgeKey,sourceEventSequence' + (item != null && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'discovery') ? ',discovery' : ''), '情境事实'))
  if (!facts.length) fail('情境缺少确定背景事实')
  unique(facts, 'factKey', '事实标识')
  for (const fact of facts) {
    text(fact.text, '事实', 7900); members(fact.audienceKeys, viewers, '事实知情者')
    if (!['reviewed-world', 'author-private', 'runtime-consequence', 'runtime-situation'].includes(String(fact.origin))) fail('事实来源无效')
    if (fact.origin === 'reviewed-world') text(fact.sourceKnowledgeKey, '世界事实证据', 160)
    else if (fact.sourceKnowledgeKey !== null) fail('私域事实不能伪造世界证据')
    sequence(fact.sourceEventSequence, initial, '事实事件')
    const runtimeFact = fact.origin === 'runtime-consequence' || fact.origin === 'runtime-situation'
    if (runtimeFact && (initial || fact.sourceEventSequence === 0)) fail('运行事实必须引用已提交事件')
    if (!runtimeFact && fact.sourceEventSequence !== 0) fail('初始事实不能伪造运行事件来源')
  }
  const factKeys = facts.map(fact => String(fact.factKey))
  const evidence = (item: Row, audiences: string[], label: string) => {
    const selected = members(item.evidenceFactKeys, factKeys, `${label}依据`)
    if (selected.some(id => audiences.some(viewer => !(facts.find(f => f.factKey === id)!.audienceKeys as string[]).includes(viewer)))) fail(`${label}引用了视角不可知的事实`)
  }
  const actor = (item: Row, label: string) => {
    if (!boundary.participantKeys.includes(String(item.actorKey))) fail(`${label}不能替玩家或包外角色设定内心`)
    evidence(item, [String(item.actorKey)], label)
  }
  const goals = list(situation.goals, '角色目标', initial ? 32 : CHAT_HISTORY_CAPACITY_V1.goals).map(item => row(item, 'goalKey,actorKey,desire,concern,boundary,evidenceFactKeys,status,updatedSequence'
    + (item != null && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'commitments') ? ',commitments' : '')
    + (item != null && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'playerPause') ? ',playerPause' : ''), '角色目标'))
  if (!goals.length) fail('情境缺少角色自身目标')
  unique(goals, 'goalKey', '目标标识')
  for (const goal of goals) {
    actor(goal, '角色目标')
    for (const field of ['desire', 'concern', 'boundary']) text(goal[field], `目标 ${field}`)
    if (!['active', 'paused', 'fulfilled', 'abandoned'].includes(String(goal.status)) || initial && goal.status !== 'active') fail('目标状态无效')
    sequence(goal.updatedSequence, initial, '目标事件')
    validateChatGoalPlayerPauseV1(goal.playerPause, {initial, status: String(goal.status), updatedSequence: Number(goal.updatedSequence), threadKeys: Array.isArray(situation.threads) ? situation.threads.map(t => t?.threadKey) : []})
    validateChatGoalCommitmentsV1(goal.commitments, {actorKey: String(goal.actorKey), viewers, goalStatus: String(goal.status), updatedSequence: Number(goal.updatedSequence), initial})
  }
  const beliefs = list(situation.beliefs, '角色猜测', 64).map(item => row(item, 'beliefKey,actorKey,text,evidenceFactKeys,updatedSequence', '角色猜测'))
  unique(beliefs, 'beliefKey', '猜测标识')
  for (const belief of beliefs) { actor(belief, '角色猜测'); text(belief.text, '猜测'); sequence(belief.updatedSequence, initial, '猜测事件') }
  const threads = list(situation.threads, '剧情线', initial ? 64 : CHAT_HISTORY_CAPACITY_V1.threads).map(item => row(item, 'threadKey,title,question,audienceKeys,participantKeys,evidenceFactKeys,closureSignals,status,updatedSequence', '剧情线'))
  unique(threads, 'threadKey', '剧情线标识')
  for (const thread of threads) {
    text(thread.title, '剧情线标题', 1000); text(thread.question, '未解决问题')
    const audience = members(thread.audienceKeys, viewers, '剧情线知情者')
    members(thread.participantKeys, boundary.participantKeys, '剧情线涉及角色', true)
    evidence(thread, audience, '剧情线')
    const signals = list(thread.closureSignals, '收束条件', 8)
    if (!signals.length) fail('剧情线缺少可收束条件')
    signals.forEach(item => text(item, '收束条件', 1000))
    if (!(CHAT_THREAD_STATUSES_V1 as readonly string[]).includes(String(thread.status)) || initial && thread.status !== 'open') fail('剧情线状态无效')
    sequence(thread.updatedSequence, initial, '剧情线事件')
  }
  if (!initial) assertChatHistoryCapacityV1(situation as unknown as ChatSituationV1)
  if (threads.filter(t => t.status === 'open' || t.status === 'blocked').length > maxActiveThreads) fail('活跃剧情线超出授权上限')
  if (seed.origin === 'continued-thread' && !threads.some(t => t.threadKey === seed.sourceThreadKey)) fail('种子引用了不存在的剧情线')
  for (const possibility of list(situation.possibilities, '发展可能', 32)) {
    const item = row(possibility, 'actorKey,text,evidenceFactKeys', '发展可能')
    actor(item, '发展可能'); text(item.text, '发展可能')
  }
}

export function parseFrozenChatNarrativeV1(value: unknown, input: ChatNarrativeBoundaryV1 & {source: FrozenChatSourceProjectionV1}): FrozenChatNarrativeV1 {
  const parsed = row(value, 'schema,version,worldReleaseHash,persona,permissions,initialSituation', '初始叙事合同')
  if (parsed.schema !== 'storyforge.chat-narrative-content') fail('初始叙事合同类型无效')
  const permissions = validateCommon(parsed, input)
  if (parsed.worldReleaseHash !== input.source.worldReleaseHash) fail('叙事情境与已确认来源世界不同')
  validateSituation(parsed.initialSituation, input, true, Number(permissions.maxActiveThreads))
  const content = structuredClone(value) as FrozenChatNarrativeV1
  for (const fact of content.initialSituation.facts) validateChatFactDiscoveryRuleV1(fact, content.initialSituation.facts, input, content.permissions.maxDiscoveriesPerSituation ?? 0)
  if (content.persona.source?.resourceKey !== input.source.playerCharacterSource?.resourceKey
    || content.persona.source?.sourceHash !== input.source.playerCharacterSource?.sourceHash) fail('玩家人物与冻结来源证据不一致')
  for (const fact of content.initialSituation.facts.filter(item => item.origin === 'reviewed-world')) {
    const source = input.source.knowledge.find(item => item.key === fact.sourceKnowledgeKey)
    if (!source || !['identity', 'knowledge'].includes(source.source.purpose) || source.content !== fact.text
      || fact.audienceKeys.some(viewer => !source.audienceKeys.includes(viewer))) fail('情境世界事实缺少原文证据、用途不符或扩大了知情者')
    if (source.source.unit && [...fact.audienceKeys].sort().join('\0') !== [...source.audienceKeys].sort().join('\0')) fail('已确认事实单位的初始知情范围必须完整保留')
    if (fact.discovery && !source.discovery) fail('世界隐情没有来源级发现授权')
    if (source.discovery) {
      const rule = fact.discovery, authorization = source.discovery
      const prerequisites = rule?.prerequisiteFactKeys.map(key => content.initialSituation.facts.find(f => f.factKey === key)) ?? []
      if (!rule || rule.condition !== authorization.condition || rule.sceneKey !== content.initialSituation.sceneKey
        || [...fact.audienceKeys].sort().join('\0') !== [...source.audienceKeys].sort().join('\0')
        || [...rule.actorKeys].sort().join('\0') !== [...authorization.actorKeys].sort().join('\0')
        || prerequisites.some(f => f?.origin !== 'reviewed-world')
        || prerequisites.map(f => f!.sourceKnowledgeKey).sort().join('\0') !== [...authorization.prerequisiteKnowledgeKeys].sort().join('\0')) fail('世界隐情发现条件、角色或前提必须逐项保留作者来源授权')
    }
  }
  for (const source of input.source.knowledge.filter(item => item.discovery || item.source.unit)) {
    if (content.initialSituation.facts.filter(f => f.origin === 'reviewed-world' && f.sourceKnowledgeKey === source.key).length !== 1) fail('每条已授权世界隐情必须保留唯一原文事实与发现条件')
  }
  return content
}

export function createChatNarrativeStateV1(content: FrozenChatNarrativeV1): ChatNarrativeStateV1 {
  return structuredClone({schema: 'storyforge.chat-narrative-state', version: 1, worldReleaseHash: content.worldReleaseHash,
    persona: content.persona, permissions: content.permissions, situation: content.initialSituation, revision: 0, lastEventSequence: 0, triggers: []})
}

export function parseChatNarrativeStateV1(value: unknown, boundary: ChatNarrativeBoundaryV1): ChatNarrativeStateV1 {
  const extra = ['pendingSituation', 'pendingEdit', 'excludedMessageIds', 'discoveryHistory', 'inquiryHistory', 'memoryReconciliations', 'sceneTransitions', 'factEvidence', 'resolutionEvidence'].filter(key => value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)).map(key => ',' + key).join('')
  const parsed = row(value, 'schema,version,worldReleaseHash,persona,permissions,situation,revision,lastEventSequence,triggers' + extra, '叙事状态')
  if (parsed.schema !== 'storyforge.chat-narrative-state') fail('叙事状态类型无效')
  const permissions = validateCommon(parsed, boundary)
  integer(parsed.revision, '叙事 revision', 0, Number.MAX_SAFE_INTEGER)
  sequence(parsed.lastEventSequence, false, '叙事状态头')
  if (parsed.revision === 0 && parsed.lastEventSequence !== 0 || parsed.revision !== 0 && parsed.lastEventSequence === 0) fail('叙事版本与事件头不符')
  validateSituation(parsed.situation, boundary, parsed.revision === 0, Number(permissions.maxActiveThreads))
  const state = structuredClone(value) as ChatNarrativeStateV1
  validateChatMemoryReconciliationRecordsV1(state, boundary.participantKeys)
  validateChatSceneTransitionRecordsV1(state, boundary)
  if (state.situation.seed.origin === 'player-followup' && state.permissions.allowPlayerFollowupSituations !== true) fail('新事项情境缺少作品授权')
  for (const fact of state.situation.facts) validateChatFactDiscoveryRuleV1(fact, state.situation.facts, boundary, state.permissions.maxDiscoveriesPerSituation ?? 0)
  const triggers = list(parsed.triggers, '主动触发记录', 5000).map(item => row(item, 'kind,requestedSequence,sourceEventSequence,seed,status,actionSequences'
    + ['direction', 'controlHandoff'].filter(key => item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, key)).map(key => `,${key}`).join(''), '主动触发记录'))
  if (state.revision === 0 && triggers.length) fail('初始情境不能伪造触发历史')
  const seen = new Set<number>()
  for (const [index, trigger] of triggers.entries()) {
    members([trigger.kind], state.permissions.triggers, '触发授权', true)
    sequence(trigger.requestedSequence, false, '触发事件')
    sequence(trigger.sourceEventSequence, false, '触发来源')
    if (trigger.requestedSequence === 0 || seen.has(Number(trigger.requestedSequence))) fail('主动触发事件重复或无效')
    seen.add(Number(trigger.requestedSequence))
    if (trigger.sourceEventSequence !== 0 && Number(trigger.sourceEventSequence) >= Number(trigger.requestedSequence)) fail('主动触发来源尚未发生')
    if (index > 0 && Number(trigger.requestedSequence) <= Number(triggers[index - 1].requestedSequence)) fail('主动触发顺序无效')
    if (!['ready', 'waiting-player', 'complete', 'cancelled'].includes(String(trigger.status))) fail('主动触发状态无效')
    if (index < triggers.length - 1 && ['ready', 'waiting-player'].includes(String(trigger.status))) fail('旧主动触发仍在等待执行')
    if (trigger.kind === 'player-seed') text(trigger.seed, '玩家情境请求')
    else if (trigger.seed !== null) fail('非情境请求不能添加种子')
    const direction = trigger.direction === undefined ? undefined : parseChatTurnDirectionV1(trigger.direction, boundary.participantKeys, state.permissions.maxActionsPerTrigger)
    const limit = direction?.actionLimit ?? state.permissions.maxActionsPerTrigger
    const actions = list(trigger.actionSequences, '触发内行动', limit)
    actions.forEach((value, i) => {
      sequence(value, false, '行动事件')
      if (Number(value) <= Number(i ? actions[i - 1] : trigger.requestedSequence)) fail('行动事件顺序无效')
    })
    if (trigger.status === 'ready' && actions.length >= limit && !(direction?.settleSituationVersion === 1
      && state.permissions.allowActorSituationExpansion === true
      && state.pendingSituation?.sourceEventSequence === actions[actions.length - 1])) fail('主动触发已耗尽动作预算')
    if (trigger.controlHandoff !== undefined) {
      const handoff = parseChatControlHandoffRecordV1(trigger.controlHandoff, state.triggers[index], boundary.participantKeys)
      if (index < triggers.length - 1 && handoff.sequence >= Number(triggers[index + 1].requestedSequence)) fail('交还控制越过下一轮触发')
    }
    if (trigger.status === 'waiting-player' && !actions.length && trigger.controlHandoff === undefined) fail('等待玩家缺少角色行动或已审查的交还控制')
  }
  if (state.pendingSituation !== undefined) {
    const hasPurpose = Object.prototype.hasOwnProperty.call(state.pendingSituation, 'purpose')
    const followup = state.pendingSituation.purpose === 'player-followup'
    const inquiry = state.pendingSituation.purpose === 'inquiry-result'
    const pending = row(state.pendingSituation, 'threadKey,direction,evidenceFactKeys,evidenceExcerpt,actorKey,goalKey,sourceEventSequence' + (hasPurpose ? ',purpose' : '') + (followup ? ',playerEventSequence,playerExcerpt' : '') + (inquiry ? ',respondentFactKey,respondentExcerpt,respondentName' : ''), '待推进事项')
    if (inquiry) {
      assertChatInquiryRespondentReferenceV1(pending)
      if (state.permissions.allowInquiryResults !== true) fail('待询问结果未经作品授权')
    }
    if (hasPurpose && !['observation-result', 'player-followup', 'inquiry-result'].includes(String(pending.purpose))) fail('待推进事项用途无效')
    key(pending.actorKey, '推进角色')
    if (followup) {
      if (pending.goalKey !== null || pending.threadKey !== null || state.permissions.allowPlayerFollowupSituations !== true
        || state.situation.goals.some(g => g.actorKey === pending.actorKey && ['active', 'paused'].includes(g.status))) fail('新事项必须承接已收束角色且具有单独授权')
      sequence(pending.playerEventSequence, false, '新事项玩家来源'); text(pending.playerExcerpt, '新事项玩家原话', 1200)
      if (pending.playerEventSequence === 0 || !state.triggers.some(t => t.kind === 'player-response'
        && t.sourceEventSequence === pending.playerEventSequence && t.actionSequences[0] === pending.sourceEventSequence)) fail('新事项缺少本轮玩家回应的已审查行动')
    } else {key(pending.goalKey, '推进目标'); key(pending.threadKey, '推进剧情线')}
    text(pending.direction, '推进方向', 1200); text(pending.evidenceExcerpt, '推进表达依据', 1200)
    sequence(pending.sourceEventSequence, false, '推进来源事件')
    if (state.revision === 0 || state.permissions.allowActorSituationExpansion !== true
      || pending.sourceEventSequence === 0 || !state.triggers.some(t => t.actionSequences.includes(Number(pending.sourceEventSequence)))) fail('待推进事项缺少授权或已审查行动')
    if (!followup && (!state.situation.goals.some(g => g.goalKey === pending.goalKey && g.actorKey === pending.actorKey && g.status === 'active')
      || !state.situation.threads.some(t => t.threadKey === pending.threadKey && t.participantKeys.includes(String(pending.actorKey))
        && t.audienceKeys.includes(String(pending.actorKey)) && ['open', 'blocked'].includes(t.status)))) fail('待推进事项不属于角色的未完成事项')
    members(pending.evidenceFactKeys, state.situation.facts.filter(f => f.audienceKeys.includes(String(pending.actorKey))).map(f => f.factKey), '推进事实依据', true)
    if (pending.purpose === 'observation-result' && !state.situation.facts.some(f => f.origin === 'runtime-consequence' && f.sourceEventSequence === pending.sourceEventSequence
      && (pending.evidenceFactKeys as string[]).includes(f.factKey) && String(pending.evidenceExcerpt).includes(f.text))) fail('待观察结果缺少同一已完成行动的事实依据')
  }
  if (state.pendingEdit !== undefined) {
    validateChatMessageEditDraftV1(state.pendingEdit, {playerKey: 'player', profiles: boundary.participantKeys.map(participantKey => ({participantKey}))}, state.permissions.maxActionCharacters)
    if (state.pendingEdit.requestedSequence > state.lastEventSequence && state.pendingEdit.requestedSequence !== 0) fail('改写引用尚未发生')
  }
  if (state.excludedMessageIds !== undefined) {
    const ids = list(state.excludedMessageIds, '排除消息', 5000)
    ids.forEach(id => text(id, '排除消息 ID', 200))
    if (new Set(ids).size !== ids.length) fail('排除消息 ID 重复')
  }
  const sequences = [state.pendingSituation?.sourceEventSequence ?? 0, state.pendingSituation?.purpose === 'player-followup' ? state.pendingSituation.playerEventSequence : 0, state.situation.seed.sourceEventSequence, ...state.situation.facts.map(f => f.sourceEventSequence),
    ...state.situation.goals.map(g => g.updatedSequence), ...chatCommitmentSequencesV1(state.situation.goals), ...chatPlayerPauseSequencesV1(state.situation.goals), ...state.situation.beliefs.map(b => b.updatedSequence), ...state.situation.threads.map(t => t.updatedSequence),
    ...state.triggers.flatMap(t => [t.requestedSequence, t.sourceEventSequence, ...t.actionSequences, t.controlHandoff?.sequence ?? 0, t.controlHandoff?.sourceSequence ?? 0])]
  if (sequences.some(seq => seq !== 0 && (state.lastEventSequence === 0 || seq > state.lastEventSequence))) fail('叙事状态含尚未发生的事件引用')
  validateChatDiscoveryHistoryV1(state)
  validateChatInquiryHistoryV1(state, boundary)
  validateChatFactEvidenceV1(state, boundary.participantKeys)
  validateChatResolutionEvidenceV1(state, boundary.participantKeys)
  return state
}

/** Never expose the seed, coordinator-only truth, or other roles' goals/possibilities. */
export function chatNarrativeViewV1(state: ChatNarrativeStateV1, viewerKey: string) {
  const situation = state.situation
  const activeTrigger = state.triggers.slice(-1)[0]
  const triggerView = activeTrigger ? (({controlHandoff: _controlHandoff, ...trigger}) => ({...trigger, seed: null}))(activeTrigger) : null
  return structuredClone({
    situationKey: situation.situationKey, sceneKey: situation.sceneKey, title: situation.title, location: situation.location, timeLabel: situation.timeLabel,
    persona: state.persona,
    permissions: state.permissions,
    ...chatTurnAudienceGuidanceV1(state.triggers[state.triggers.length - 1]?.direction),
    facts: situation.facts.filter(f => f.audienceKeys.includes(viewerKey)).map(({discovery: _rule, ...fact}) => fact),
    ...(state.discoveryHistory?.some(record => record.actorKey === viewerKey) ? {investigations: chatActorInvestigationResultsV1(state, viewerKey)} : {}),
    ...(state.inquiryHistory?.some(record => record.audienceKeys.includes(viewerKey)) ? {inquiryReplies: chatInquiryRepliesV1(state, viewerKey)} : {}),
    goals: situation.goals.filter(g => g.actorKey === viewerKey),
    beliefs: situation.beliefs.filter(b => b.actorKey === viewerKey),
    threads: situation.threads.filter(t => t.audienceKeys.includes(viewerKey)),
    possibilities: situation.possibilities.filter(p => p.actorKey === viewerKey),
    ...(state.pendingSituation?.actorKey === viewerKey ? {pendingSituation: state.pendingSituation} : {}),
    ...(state.pendingEdit && [state.pendingEdit.actorKey, 'player'].includes(viewerKey) ? {pendingEdit: state.pendingEdit} : {}),
    // A scene-setting request can contain coordinator-only directions. Roles
    // receive the constructed view, never the player's raw backstage request.
    trigger: triggerView,
  })
}

export function rebaseChatNarrativeStateV1(state: ChatNarrativeStateV1, rebase: (sequence: number) => number): void {
  state.lastEventSequence = rebase(state.lastEventSequence)
  if (state.pendingEdit) state.pendingEdit.requestedSequence = rebase(state.pendingEdit.requestedSequence)
  if (state.pendingSituation) state.pendingSituation.sourceEventSequence = rebase(state.pendingSituation.sourceEventSequence)
  if (state.pendingSituation?.purpose === 'player-followup') state.pendingSituation.playerEventSequence = rebase(state.pendingSituation.playerEventSequence)
  state.situation.seed.sourceEventSequence = rebase(state.situation.seed.sourceEventSequence)
  for (const fact of state.situation.facts) fact.sourceEventSequence = rebase(fact.sourceEventSequence)
  for (const record of state.memoryReconciliations ?? []) {record.sourceSequence = rebase(record.sourceSequence); record.sequence = rebase(record.sequence)}
  for (const record of state.sceneTransitions ?? []) {record.requested.sequence = rebase(record.requested.sequence); record.arrived.sequence = rebase(record.arrived.sequence)}
  for (const record of state.discoveryHistory ?? []) {record.actionSequence = rebase(record.actionSequence); record.discoverySequence = rebase(record.discoverySequence)}
  for (const record of state.inquiryHistory ?? []) {record.questionSequence = rebase(record.questionSequence); record.resultSequence = rebase(record.resultSequence)}
  for (const item of [...state.situation.goals, ...state.situation.beliefs, ...state.situation.threads]) item.updatedSequence = rebase(item.updatedSequence)
  rebaseChatCommitmentsV1(state.situation.goals, rebase)
  rebaseChatPlayerPausesV1(state.situation.goals, rebase)
  for (const trigger of state.triggers) {
    trigger.requestedSequence = rebase(trigger.requestedSequence)
    trigger.sourceEventSequence = rebase(trigger.sourceEventSequence)
    trigger.actionSequences = trigger.actionSequences.map(rebase)
    if (trigger.controlHandoff) {
      trigger.controlHandoff.sequence = rebase(trigger.controlHandoff.sequence)
      trigger.controlHandoff.sourceSequence = rebase(trigger.controlHandoff.sourceSequence)
    }
  }
}

export type ChatNarrativeViewV1 = ReturnType<typeof chatNarrativeViewV1>
export type { ChatSituationV1 }
