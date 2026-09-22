import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  ProductRuntimeEvent,
  TextOpenWorldDirectorSettlementAuthorizationV1,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldEffectsAppliedEventPayloadV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldQuestStatusV1,
  TextOpenWorldRulesetStampV1,
  TextOpenWorldSessionProjectionV1,
} from '../types'
import { parseTextOpenWorldCommandEventPayloadV1 } from './command-contract'
import {
  parseTextOpenWorldEffectsAppliedEventPayloadV1,
  parseTextOpenWorldRandomResolvedEventPayloadV1,
} from './event-contract'
import { parseTextOpenWorldModulesV1 } from './modules'
import { parseTextOpenWorldSessionProjectionV1 } from './session-projection'

const DEFAULT_NOTIFICATION_LIMIT = 40
const MAXIMUM_NOTIFICATION_LIMIT = 100
const MAXIMUM_DETAIL_COUNT = 3
const MAXIMUM_HEADLINE_LENGTH = 160
const MAXIMUM_DETAIL_LENGTH = 500

const DISCLOSED_QUEST_STATUSES = new Set<TextOpenWorldQuestStatusV1>([
  'revealed', 'accepted', 'active', 'suspended', 'completed', 'failed',
  'expired', 'abandoned', 'withdrawn',
])

interface PlayerDisclosureScope {
  actorKeys: Set<string>
  factionKeys: Set<string>
  locationKeys: Set<string>
  regionKeys: Set<string>
}

function fail(message: string): never { throw new Error(`[text-open-world-player-notifications] ${message}`) }
function eventPayload(event: ProductRuntimeEvent): unknown {
  try { return JSON.parse(event.payloadJson) } catch { fail(`事件${event.sequence}不是合法JSON`) }
}
function equal(left: unknown, right: unknown): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
}
function boundedText(value: string, maximum: number): string {
  const normalized = value.trim().normalize('NFC')
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, Math.max(1, maximum - 1))}…`
}
function uniqueDetails(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
    .slice(0, MAXIMUM_DETAIL_COUNT)
    .map(value => boundedText(value, MAXIMUM_DETAIL_LENGTH))
}

function playerDisclosureScope(
  projection: TextOpenWorldSessionProjectionV1,
  modules: TextOpenWorldParsedModulesV1,
): PlayerDisclosureScope {
  const actorKeys = new Set(modules.actors.actors.filter(actor => {
    const actorState = projection.state.actors[actor.key]
    return actorState?.alive && actorState.present && actorState.locationKey === projection.state.map.currentLocationKey
  }).map(actor => actor.key))
  const factionKeys = new Set<string>()
  Object.values(projection.state.quests.instancesByKey).forEach(instance => {
    if (!DISCLOSED_QUEST_STATUSES.has(instance.status) || instance.offeredAtWorldMinute == null) return
    const quest = modules.quests.quests.find(candidate => candidate.key === instance.definitionKey)
    if (quest?.ownerKind === 'actor' && quest.ownerKey) actorKeys.add(quest.ownerKey)
    if (quest?.ownerKind === 'faction' && quest.ownerKey) factionKeys.add(quest.ownerKey)
  })
  actorKeys.forEach(actorKey => {
    const factionKey = modules.actors.actors.find(actor => actor.key === actorKey)?.factionKey
    if (factionKey) factionKeys.add(factionKey)
  })
  const regionKeys = new Set(modules.world.regions.filter(region => (
    (projection.state.map.regionKnowledgeByKey[region.key] ?? 'unknown') !== 'unknown'
      || region.knowledgePolicy === 'always-visible'
  )).map(region => region.key))
  const locationKeys = new Set(modules.world.locations.filter(location => (
    regionKeys.has(location.regionKey)
      && (projection.state.map.locationKnowledgeByKey[location.key] ?? 'unknown') !== 'unknown'
  )).map(location => location.key))
  return { actorKeys, factionKeys, locationKeys, regionKeys }
}

export type TextOpenWorldPlayerNotificationCategoryV1 =
  | 'player' | 'inventory' | 'quest' | 'world' | 'relationship' | 'combat' | 'achievement' | 'random-event'

export interface TextOpenWorldPlayerNotificationV1 {
  /** Stable for replay and UI de-duplication; it contains no content key. */
  id: string
  sessionId: number
  effectsEventSequence: number
  /** Player actions already have the scene receipt live region; system changes do not. */
  origin: 'player' | 'system'
  category: TextOpenWorldPlayerNotificationCategoryV1
  priority: 'normal' | 'important' | 'critical'
  headline: string
  details: string[]
  worldMinute: number | null
  /** Current v2 Director events are instantaneous and can only be reported as resolved. */
  randomEventStatus: 'resolved' | null
}

interface PendingCommand {
  commandId: string
  sequence: number
  actorKey: string
  actionLabel: string
  ruleset: TextOpenWorldRulesetStampV1 | null
  randomEventSequences: number[]
}

interface TerminalEvidence {
  event: ProductRuntimeEvent
  payload: TextOpenWorldEffectsAppliedEventPayloadV1
  actionLabel: string
  origin: 'player' | 'system'
}

function assertEventIndex(
  event: ProductRuntimeEvent,
  expectedSequence: number,
  sessionId: number,
): void {
  if (!Number.isSafeInteger(event.sequence) || event.sequence !== expectedSequence) {
    fail(`事件序号不连续:${expectedSequence}->${String(event.sequence)}`)
  }
  if (event.sessionId !== sessionId) fail(`事件流混入其他Session:${event.sessionId}`)
  if (typeof event.payloadJson !== 'string') fail(`事件${event.sequence}缺少payloadJson`)
}

function assertReleaseEffects(
  payload: TextOpenWorldEffectsAppliedEventPayloadV1,
  modules: TextOpenWorldParsedModulesV1,
): void {
  const effectsByKey = new Map(modules.actions.effects.map(effect => [effect.key, effect]))
  payload.plan.effects.forEach(effect => {
    const frozen = effectsByKey.get(effect.key)
    if (!frozen || !equal(frozen, effect)) fail(`Effect终态未匹配冻结Release定义:${effect.key}`)
  })
}

/**
 * Validates the visible event prefix synchronously and returns terminal Effect
 * evidence only. Cryptographic evidence verification remains the responsibility
 * of the canonical runtime read/import path; this projector never trusts a
 * payload without the same-Session and command-batch structure.
 */
function terminalEvidence(input: {
  sessionId: number
  projection: TextOpenWorldSessionProjectionV1
  modules: TextOpenWorldParsedModulesV1
  events: readonly ProductRuntimeEvent[]
}): TerminalEvidence[] {
  if (input.events.length < input.projection.lastEventSequence) {
    fail(`事件流未覆盖投影头:${input.events.length}<${input.projection.lastEventSequence}`)
  }
  const visible = input.events.slice(0, input.projection.lastEventSequence)
  // A concurrent refresh may have already read events beyond the independently
  // verified Projection head. They are neither current facts nor input to this
  // render, so do not parse or reject them until the Projection catches up.
  visible.forEach((event, index) => assertEventIndex(event, index + 1, input.sessionId))
  let pending: PendingCommand | null = null
  const terminals: TerminalEvidence[] = []

  for (const event of visible) {
    if (event.type === 'text-open-world.command.committed') {
      if (pending) fail(`上一命令尚未终结:${pending.commandId}`)
      const command = parseTextOpenWorldCommandEventPayloadV1(eventPayload(event))
      const envelope = command.envelope
      if (envelope.sessionId !== input.sessionId
        || envelope.commandId !== event.commandId
        || envelope.actorKey !== event.actorKey
        || envelope.baseSequence !== event.baseSequence
        || envelope.baseStateHash !== event.baseStateHash
        || envelope.baseSequence !== event.sequence - 1
        || command.resultingSequence !== event.sequence) {
        fail(`命令事件${event.sequence}包络与索引不一致`)
      }
      const action = input.modules.actions.actions.find(candidate => candidate.key === envelope.actionKey)
        ?? fail(`命令引用未知冻结Action:${envelope.actionKey}`)
      pending = {
        commandId: envelope.commandId,
        sequence: event.sequence,
        actorKey: envelope.actorKey,
        actionLabel: action.label,
        ruleset: null,
        randomEventSequences: [],
      }
      continue
    }
    if (event.type === 'text-open-world.random.resolved') {
      if (!pending) fail(`随机证据事件${event.sequence}没有待处理命令`)
      const random = parseTextOpenWorldRandomResolvedEventPayloadV1(eventPayload(event))
      if (event.commandId != null || event.baseSequence != null || event.baseStateHash != null
        || event.actorKey !== pending.actorKey || event.targetKey != null
        || random.commandId !== pending.commandId || random.commandSequence !== pending.sequence
        || random.evidence.drawIndex !== pending.randomEventSequences.length
        || !equal(random.ruleset, input.projection.ruleset)
        || pending.ruleset != null && !equal(random.ruleset, pending.ruleset)) {
        fail(`随机证据事件${event.sequence}不属于当前命令批次`)
      }
      pending.ruleset = random.ruleset
      pending.randomEventSequences.push(event.sequence)
      continue
    }
    if (event.type === 'text-open-world.effects.applied') {
      if (!pending) fail(`Effect终态事件${event.sequence}没有待处理命令`)
      const applied = parseTextOpenWorldEffectsAppliedEventPayloadV1(eventPayload(event))
      if (event.commandId != null || event.baseSequence != null || event.baseStateHash != null
        || event.actorKey !== pending.actorKey || event.targetKey != null
        || applied.commandId !== pending.commandId || applied.commandSequence !== pending.sequence
        || !equal(applied.ruleset, input.projection.ruleset)
        || pending.ruleset != null && !equal(applied.ruleset, pending.ruleset)
        || !equal(applied.randomEventSequences, pending.randomEventSequences)) {
        fail(`Effect终态事件${event.sequence}不属于当前命令批次`)
      }
      assertReleaseEffects(applied, input.modules)
      if (pending.actorKey !== 'player' && pending.actorKey !== 'system') {
        fail(`Effect终态事件${event.sequence}来自未知命令Actor`)
      }
      terminals.push({
        event,
        payload: applied,
        actionLabel: pending.actionLabel,
        origin: pending.actorKey,
      })
      pending = null
    }
  }

  if ((pending?.commandId ?? null) !== input.projection.protocol.pendingCommandId
    || (pending?.sequence ?? null) !== input.projection.protocol.pendingCommandSequence) {
    fail('事件流待处理命令与正式Projection不一致')
  }
  return terminals
}

function effectDetail(
  effect: TextOpenWorldEffectDefinitionV1,
  modules: TextOpenWorldParsedModulesV1,
  disclosure: PlayerDisclosureScope,
): string | null {
  const itemTitle = (key: string) => modules.items.items.find(item => item.key === key)?.title ?? null
  const skillTitle = (key: string) => modules.progression.skills.find(skill => skill.key === key)?.title ?? null
  const statusTitle = (key: string) => modules.progression.statuses.find(status => status.key === key)?.title ?? null
  const recipeTitle = (key: string) => modules.crafting.recipes.find(recipe => recipe.key === key)?.title ?? null
  const locationTitle = (key: string) => disclosure.locationKeys.has(key)
    ? modules.world.locations.find(location => location.key === key)?.title ?? null
    : null
  const actorName = (key: string) => disclosure.actorKeys.has(key)
    ? modules.actors.actors.find(actor => actor.key === key)?.name ?? null
    : null
  const factionTitle = (key: string) => disclosure.factionKeys.has(key)
    ? modules.actors.factions.find(faction => faction.key === key)?.title ?? null
    : null
  switch (effect.operation) {
    case 'change-player-resource': {
      const resource = effect.payload.resource === 'health' ? '生命' : '技能资源'
      return `${resource}${effect.payload.amount >= 0 ? '恢复' : '消耗'}${Math.abs(effect.payload.amount)}点`
    }
    case 'grant-experience': return `获得${effect.payload.amount}点经验`
    case 'apply-status': return statusTitle(effect.payload.statusKey) ? `获得状态：${statusTitle(effect.payload.statusKey)}` : '角色状态发生变化'
    case 'remove-status': return statusTitle(effect.payload.statusKey) ? `移除状态：${statusTitle(effect.payload.statusKey)}` : '角色状态发生变化'
    case 'grant-item': return itemTitle(effect.payload.itemKey) ? `获得${itemTitle(effect.payload.itemKey)} × ${effect.payload.quantity}` : '获得物品'
    case 'remove-item': return itemTitle(effect.payload.itemKey) ? `失去${itemTitle(effect.payload.itemKey)} × ${effect.payload.quantity}` : '物品数量发生变化'
    case 'equip-item': return itemTitle(effect.payload.itemKey) ? `已装备：${itemTitle(effect.payload.itemKey)}` : '装备已更新'
    case 'unequip-item': return itemTitle(effect.payload.itemKey) ? `已卸下：${itemTitle(effect.payload.itemKey)}` : '装备已更新'
    case 'learn-skill': return skillTitle(effect.payload.skillKey) ? `学会技能：${skillTitle(effect.payload.skillKey)}` : '学会新技能'
    case 'learn-recipe': return recipeTitle(effect.payload.recipeKey) ? `学会配方：${recipeTitle(effect.payload.recipeKey)}` : '学会新配方'
    case 'change-currency': return `${effect.payload.amount >= 0 ? '获得' : '花费'}${Math.abs(effect.payload.amount)}${modules.economy.currency.label}`
    case 'change-morality': return `道德评价${effect.payload.amount >= 0 ? '提高' : '降低'}${Math.abs(effect.payload.amount)}`
    case 'change-faction-affinity': return factionTitle(effect.payload.factionKey)
      ? `${factionTitle(effect.payload.factionKey)}亲合度${effect.payload.amount >= 0 ? '提高' : '降低'}${Math.abs(effect.payload.amount)}`
      : '阵营态度发生变化'
    case 'set-story-modifier': return actorName(effect.payload.actorKey) ? `${actorName(effect.payload.actorKey)}对你的态度发生变化` : '角色态度发生变化'
    case 'reveal-knowledge': {
      if (effect.payload.visibility !== 'known') return '获得一条新线索'
      const title = modules.knowledge.entries.find(entry => entry.key === effect.payload.knowledgeKey)?.title
      return title ? `确认线索：${title}` : '确认一条新线索'
    }
    case 'reveal-location': return locationTitle(effect.payload.locationKey) ? `发现地点：${locationTitle(effect.payload.locationKey)}` : '发现新地点'
    case 'unlock-fast-travel': {
      const point = modules.world.fastTravelPoints.find(candidate => candidate.key === effect.payload.fastTravelPointKey)
      return point && locationTitle(point.locationKey) ? `解锁快速旅行：${locationTitle(point.locationKey)}` : '解锁快速旅行点'
    }
    case 'enter-location': return locationTitle(effect.payload.locationKey) ? `抵达：${locationTitle(effect.payload.locationKey)}` : '抵达新地点'
    case 'start-travel': return locationTitle(effect.payload.destinationLocationKey) ? `启程前往：${locationTitle(effect.payload.destinationLocationKey)}` : '开始旅行'
    case 'start-combat': return modules.combat.encounters.find(encounter => encounter.key === effect.payload.encounterKey)?.title
      ? `遭遇战斗：${modules.combat.encounters.find(encounter => encounter.key === effect.payload.encounterKey)!.title}`
      : '战斗开始'
    case 'resolve-combat': return effect.payload.outcome === 'victory' ? '战斗胜利' : effect.payload.outcome === 'defeat' ? '战斗失败' : '已经脱离战斗'
    case 'rest': return '休整完成'
    case 'respawn': return '已在安全地点复苏'
    case 'change-actor-state': return actorName(effect.payload.actorKey) ? `${actorName(effect.payload.actorKey)}的状态发生重要变化` : '一名角色的状态发生重要变化'
    case 'change-region-state': return disclosure.regionKeys.has(effect.payload.regionKey)
      && modules.world.regions.find(region => region.key === effect.payload.regionKey)?.title
      ? `${modules.world.regions.find(region => region.key === effect.payload.regionKey)!.title}的局势发生变化`
      : '地区局势发生变化'
    case 'set-world-flag': return '世界状态发生变化'
    case 'earn-achievement': return modules.knowledge.achievements.find(achievement => achievement.key === effect.payload.achievementKey)?.title
      ? `获得成就：${modules.knowledge.achievements.find(achievement => achievement.key === effect.payload.achievementKey)!.title}`
      : '获得新成就'
    case 'unlock-ending': return modules.narrative.endings.find(ending => ending.key === effect.payload.endingKey)?.title
      ? `解锁结局：${modules.narrative.endings.find(ending => ending.key === effect.payload.endingKey)!.title}`
      : '解锁新结局'
    case 'reach-ending': return modules.narrative.endings.find(ending => ending.key === effect.payload.endingKey)?.title
      ? `抵达结局：${modules.narrative.endings.find(ending => ending.key === effect.payload.endingKey)!.title}`
      : '故事抵达结局'
    case 'perform-crafting': return recipeTitle(effect.payload.recipeKey) ? `完成制作：${recipeTitle(effect.payload.recipeKey)}` : '制作完成'
    case 'transition-quest':
    case 'complete-objective':
    case 'claim-quest-reward':
    case 'track-quest':
    case 'untrack-quest':
    case 'fast-travel':
    case 'advance-time':
    case 'settle-weather':
    case 'settle-actor-schedules':
    case 'initialize-combat':
    case 'settle-combat-state':
    case 'perform-combat-action':
    case 'perform-transaction':
    case 'settle-director': return null
  }
}

function resolvedRandomEvent(input: {
  authorization: TextOpenWorldDirectorSettlementAuthorizationV1
  payload: TextOpenWorldEffectsAppliedEventPayloadV1
  modules: TextOpenWorldParsedModulesV1
}): { headline: string; details: string[] } | null {
  const { authorization, payload, modules } = input
  const selection = authorization.selection
  if (selection.outcomeKind !== 'random-event' || payload.outcome === 'failure' || authorization.randomRequests.length < 1) return null
  const event = modules.director.randomEvents.find(candidate => candidate.key === selection.sourceKey)
  if (!event || !event.regionKeys.includes(authorization.regionKey)
    || event.fingerprint !== selection.fingerprint
    || event.rumorKey !== selection.rumorKey
    || !equal(event.effectKeys, selection.effectKeys)) return null
  const settleEffects = payload.plan.effects.filter(effect => effect.operation === 'settle-director')
  const dynamicEffects = payload.plan.effects.filter(effect => effect.operation !== 'settle-director').map(effect => effect.key)
  if (settleEffects.length !== 1 || !equal(dynamicEffects, selection.effectKeys)) return null
  if (modules.narrative.version !== 2) return null
  const presentations = modules.narrative.randomEventPresentations.filter(candidate => candidate.randomEventKey === event.key)
  if (presentations.length !== 1 || presentations[0].rumorKey !== event.rumorKey) return null
  return {
    headline: `随机事件已发生：${event.title}`,
    details: uniqueDetails([presentations[0].resolutionText]),
  }
}

function authorizationPresentation(input: {
  authorization: NonNullable<TextOpenWorldEffectsAppliedEventPayloadV1['plan']['authorization']>
  payload: TextOpenWorldEffectsAppliedEventPayloadV1
  modules: TextOpenWorldParsedModulesV1
  projection: TextOpenWorldSessionProjectionV1
  disclosure: PlayerDisclosureScope
}): { category: TextOpenWorldPlayerNotificationCategoryV1; headline: string; details: string[]; priority: 'normal' | 'important' | 'critical'; worldMinute: number | null } | null {
  const { authorization, payload, modules, projection, disclosure } = input
  if (authorization.kind === 'director-settlement') {
    const random = resolvedRandomEvent({ authorization, payload, modules })
    if (authorization.selection.outcomeKind === 'random-event') return random ? {
      category: 'random-event', headline: random.headline, details: random.details, priority: 'important', worldMinute: authorization.worldMinute,
    } : null
    if (payload.outcome === 'failure') return null
    if (authorization.selection.outcomeKind === 'fixed-quest' || authorization.selection.outcomeKind === 'template-quest') {
      const instance = authorization.selection.questInstanceKey
        ? projection.state.quests.instancesByKey[authorization.selection.questInstanceKey]
        : null
      if (!instance || !DISCLOSED_QUEST_STATUSES.has(instance.status) || instance.offeredAtWorldMinute == null) return null
      const quest = modules.quests.quests.find(candidate => candidate.key === authorization.selection.definitionKey)
      const variant = modules.presentation.taskTextVariants.find(candidate => candidate.key === authorization.selection.variantTextKey)
      if (!quest) return null
      return {
        category: 'quest', headline: '新的地区任务已经出现', details: uniqueDetails([variant?.title ?? quest.title]),
        priority: 'important', worldMinute: authorization.worldMinute,
      }
    }
    const regions = authorization.regionChanges.map(change => disclosure.regionKeys.has(change.regionKey)
      ? modules.world.regions.find(region => region.key === change.regionKey)?.title ?? null
      : null)
    if (!regions.some(Boolean)) return null
    return {
      category: 'world', headline: '地区局势已经演化', details: uniqueDetails(regions.map(title => title ? `${title}出现了新的变化` : null)),
      priority: 'normal', worldMinute: authorization.worldMinute,
    }
  }
  if (payload.outcome === 'failure') return null
  if (authorization.kind === 'quest-transition') {
    const finalInstance = projection.state.quests.instancesByKey[authorization.instanceKey]
    if (!finalInstance || !DISCLOSED_QUEST_STATUSES.has(finalInstance.status) || finalInstance.offeredAtWorldMinute == null) return null
    const quest = modules.quests.quests.find(candidate => candidate.key === authorization.definitionKey)
    if (!quest) return null
    const finalStatus = authorization.transitions[authorization.transitions.length - 1]?.toStatus
    const statusLabel: Record<string, string> = {
      available: '已经开放', revealed: '已经揭示', accepted: '已经接受', active: '正在进行', suspended: '已经暂停',
      completed: '已经完成', failed: '已经失败', expired: '已经过期', abandoned: '已经放弃', withdrawn: '已经撤回',
    }
    return {
      category: 'quest', headline: `任务更新：${quest.title}`, details: uniqueDetails([statusLabel[finalStatus] ?? '任务状态已经更新']),
      priority: ['completed', 'failed', 'expired'].includes(finalStatus) ? 'important' : 'normal', worldMinute: authorization.worldMinute,
    }
  }
  if (authorization.kind === 'quest-objective') {
    const objective = modules.quests.objectives.find(candidate => candidate.key === authorization.objectiveKey)
    return objective ? {
      category: 'quest', headline: '任务目标已完成', details: uniqueDetails([objective.title]), priority: 'important', worldMinute: authorization.worldMinute,
    } : null
  }
  if (authorization.kind === 'quest-tracking') {
    const quest = modules.quests.quests.find(candidate => candidate.key === authorization.definitionKey)
    return quest ? {
      category: 'quest', headline: authorization.operation === 'track' ? '任务已加入追踪' : '任务已取消追踪',
      details: uniqueDetails([quest.title]), priority: 'normal', worldMinute: authorization.worldMinute,
    } : null
  }
  if (authorization.kind === 'reward') {
    const reward = modules.items.rewardContracts.find(candidate => candidate.key === authorization.rewardKey)
    return reward ? {
      category: 'inventory', headline: '奖励已经领取', details: uniqueDetails([reward.title]), priority: 'important', worldMinute: null,
    } : null
  }
  if (authorization.kind === 'fast-travel') {
    const destination = disclosure.locationKeys.has(authorization.destinationLocationKey)
      ? modules.world.locations.find(candidate => candidate.key === authorization.destinationLocationKey)
      : null
    return destination ? {
      category: 'world', headline: `已抵达：${destination.title}`, details: [], priority: 'normal',
      worldMinute: authorization.baseWorldMinute + authorization.travelMinutes,
    } : null
  }
  if (authorization.kind === 'weather-settlement') {
    const changes = authorization.changes.filter(change => change.fromWeatherKey !== change.toWeatherKey).map(change => {
      const region = disclosure.regionKeys.has(change.regionKey)
        ? modules.world.regions.find(candidate => candidate.key === change.regionKey)
        : null
      const weather = modules['time-weather'].weather.find(candidate => candidate.key === change.toWeatherKey)
      return region && weather ? `${region.title}转为${weather.label}` : null
    })
    return changes.some(Boolean) ? {
      category: 'world', headline: '天气发生变化', details: uniqueDetails(changes), priority: 'normal', worldMinute: authorization.worldMinute,
    } : null
  }
  if (authorization.kind === 'actor-schedule-settlement') return null
  if (authorization.kind === 'crime') {
    const actor = disclosure.actorKeys.has(authorization.targetActorKey)
      ? modules.actors.actors.find(candidate => candidate.key === authorization.targetActorKey)
      : null
    return {
      category: 'relationship', headline: authorization.outcome === 'success' ? '行动后果已经结算' : '行动没有成功',
      details: uniqueDetails([actor ? `${actor.name}及附近目击者可能改变对你的态度` : '附近人物可能改变对你的态度']),
      priority: 'important', worldMinute: authorization.worldMinute,
    }
  }
  if (authorization.kind === 'combat-transition') {
    if (!authorization.intent.startsWith('finish-')) return null
    const headline = authorization.afterStatus === 'victory' ? '战斗胜利' : authorization.afterStatus === 'defeat' ? '战斗失败' : '已经脱离战斗'
    return { category: 'combat', headline, details: [], priority: 'critical', worldMinute: null }
  }
  if (authorization.kind === 'combat-action') return null
  if (authorization.kind === 'crafting') {
    const recipe = modules.crafting.recipes.find(candidate => candidate.key === authorization.recipeKey)
    return recipe ? {
      category: 'inventory', headline: '制作完成', details: uniqueDetails([`${recipe.title} × ${authorization.quantity}`]),
      priority: 'normal', worldMinute: authorization.baseWorldMinute + authorization.timeCostMinutes,
    } : null
  }
  if (authorization.kind === 'transaction') {
    const item = modules.items.items.find(candidate => candidate.key === authorization.itemKey)
    return item ? {
      category: 'inventory', headline: authorization.transactionKind === 'buy' ? '购买完成' : '出售完成',
      details: uniqueDetails([`${item.title} × ${authorization.quantity}`]), priority: 'normal', worldMinute: authorization.worldMinute,
    } : null
  }
  return null
}

function categoryForEffects(effects: readonly TextOpenWorldEffectDefinitionV1[]): TextOpenWorldPlayerNotificationCategoryV1 {
  if (effects.some(effect => ['earn-achievement', 'unlock-ending', 'reach-ending'].includes(effect.operation))) return 'achievement'
  if (effects.some(effect => ['change-morality', 'change-faction-affinity', 'set-story-modifier'].includes(effect.operation))) return 'relationship'
  if (effects.some(effect => ['start-combat', 'resolve-combat', 'perform-combat-action'].includes(effect.operation))) return 'combat'
  if (effects.some(effect => ['grant-item', 'remove-item', 'equip-item', 'unequip-item', 'learn-recipe', 'change-currency', 'perform-crafting', 'perform-transaction'].includes(effect.operation))) return 'inventory'
  if (effects.some(effect => ['reveal-location', 'unlock-fast-travel', 'enter-location', 'start-travel', 'fast-travel', 'change-region-state', 'set-world-flag'].includes(effect.operation))) return 'world'
  return 'player'
}

function notificationFor(
  terminal: TerminalEvidence,
  modules: TextOpenWorldParsedModulesV1,
  projection: TextOpenWorldSessionProjectionV1,
  disclosure: PlayerDisclosureScope,
  sessionId: number,
): TextOpenWorldPlayerNotificationV1 | null {
  const authorization = terminal.payload.plan.authorization
  const authored = authorization
    ? authorizationPresentation({ authorization, payload: terminal.payload, modules, projection, disclosure })
    : null
  if (authorization?.kind === 'director-settlement' && authorization.selection.outcomeKind === 'random-event' && !authored) return null
  const details = authored?.details ?? uniqueDetails(terminal.payload.plan.effects.map(effect => effectDetail(effect, modules, disclosure)))
  if (!authored && (terminal.payload.outcome === 'failure' || details.length === 0)) return null
  const headline = authored?.headline ?? `${terminal.actionLabel}已结算`
  return {
    id: `text-open-world-notification:${sessionId}:${terminal.event.sequence}`,
    sessionId,
    effectsEventSequence: terminal.event.sequence,
    origin: terminal.origin,
    category: authored?.category ?? categoryForEffects(terminal.payload.plan.effects),
    priority: authored?.priority ?? 'normal',
    headline: boundedText(headline, MAXIMUM_HEADLINE_LENGTH),
    details,
    worldMinute: authored?.worldMinute ?? null,
    randomEventStatus: authorization?.kind === 'director-settlement' && authorization.selection.outcomeKind === 'random-event'
      ? 'resolved'
      : null,
  }
}

/**
 * Projects bounded player-visible changes from canonical terminal Effect events.
 * Director history, seen-random-event mirrors and PRNG evidence are never used
 * as current/random-event presentation evidence.
 */
export function projectTextOpenWorldPlayerNotificationsV1(input: {
  sessionId: number
  projection: TextOpenWorldSessionProjectionV1 | unknown
  events: readonly ProductRuntimeEvent[]
  limit?: number
}): TextOpenWorldPlayerNotificationV1[] {
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId < 1) fail('sessionId无效')
  const limit = input.limit ?? DEFAULT_NOTIFICATION_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAXIMUM_NOTIFICATION_LIMIT) fail('limit无效')
  const projection = parseTextOpenWorldSessionProjectionV1(input.projection)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const disclosure = playerDisclosureScope(projection, modules)
  const notifications = terminalEvidence({ sessionId: input.sessionId, projection, modules, events: input.events })
    .map(terminal => notificationFor(terminal, modules, projection, disclosure, input.sessionId))
    .filter((notification): notification is TextOpenWorldPlayerNotificationV1 => notification != null)
  return notifications.slice(-limit)
}
