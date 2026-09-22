import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  ProductRuntimeCheckpoint,
  ProductRuntimeEvent,
  TextOpenWorldActionAvailabilityV1,
  TextOpenWorldCombatActionAuthorizationV1,
  TextOpenWorldCombatRuntimeStateV1,
  TextOpenWorldCombatRuntimeStateV2,
  TextOpenWorldEffectChangeV1,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldEffectsAppliedEventPayloadV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldSessionProjectionV1,
} from '../types'
import { createTextOpenWorldActionRegistryV1 } from './action-registry'
import { parseTextOpenWorldCommandEventPayloadV1 } from './command-contract'
import {
  parseTextOpenWorldEffectsAppliedEventPayloadV1,
  parseTextOpenWorldRandomResolvedEventPayloadV1,
} from './event-contract'
import { deriveTextOpenWorldInventoryQuantitiesV1 } from './inventory'
import { deriveTextOpenWorldLifeProjectionV1 } from './life-cycle'
import { parseTextOpenWorldModulesV1 } from './modules'
import {
  deriveTextOpenWorldContextsV1,
  parseTextOpenWorldSessionProjectionV1,
} from './session-projection'

const COMBAT_ACTION_CATEGORIES = new Set([
  'combat-basic-attack', 'combat-skill', 'combat-item', 'escape',
])
const MAXIMUM_LOG_ENTRIES = 100

type TextOpenWorldModernCombatRuntimeStateV1 =
  | TextOpenWorldCombatRuntimeStateV1
  | TextOpenWorldCombatRuntimeStateV2

function fail(message: string): never { throw new Error(`[text-open-world-player-combat] ${message}`) }
function equal(left: unknown, right: unknown): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
}
function eventPayload(event: ProductRuntimeEvent): unknown {
  try { return JSON.parse(event.payloadJson) } catch { fail(`事件${event.sequence}不是合法JSON`) }
}
function bounded(value: string, maximum = 500): string {
  const normalized = value.trim().normalize('NFC')
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, Math.max(1, maximum - 1))}…`
}
function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map(value => bounded(value)))]
}

function modifierDetails(
  modifiers: ReadonlyArray<{ stat: 'attack' | 'defense' | 'skillPower' | 'criticalChanceBasisPoints'; amount: number }>,
  stacks = 1,
): string[] {
  const labels = { attack: '攻击', defense: '防御', skillPower: '技能威力', criticalChanceBasisPoints: '暴击率' } as const
  return modifiers.map(modifier => {
    const amount = modifier.amount * stacks
    const value = modifier.stat === 'criticalChanceBasisPoints'
      ? `${amount >= 0 ? '+' : ''}${amount / 100}%`
      : `${amount >= 0 ? '+' : ''}${amount}`
    return `${labels[modifier.stat]} ${value}`
  })
}

function skillMechanicDetails(input: {
  skill: TextOpenWorldParsedModulesV1['progression']['skills'][number] | null
  actionKind: 'basic-attack' | 'skill' | 'item' | 'escape' | 'enemy-skill'
  modules: TextOpenWorldParsedModulesV1
}): string[] {
  if (!input.skill || input.modules.progression.version !== 2) return []
  const skill = input.skill as Extract<TextOpenWorldParsedModulesV1['progression'], { version: 2 }>['skills'][number]
  const mechanic = skill.mechanic
  const attributeLabel = skill.scalingAttribute == null ? null
    : input.modules.progression.rules.attributes[skill.scalingAttribute].label
  if (mechanic.kind === 'attack') {
    if (input.actionKind === 'basic-attack') return ['使用当前攻击力进行伤害结算']
    const resolution = input.modules.combat.skillResolutions.find(candidate => candidate.skillKey === skill.key)
      ?? fail('攻击技能缺少公开伤害公式')
    const scaled = `${attributeLabel ?? '成长属性'} × ${resolution.powerNumerator}/${resolution.powerDenominator}`
    return [`伤害基础：${scaled}${resolution.flatDamage ? ` + ${resolution.flatDamage}` : ''} + 技能威力`]
  }
  if (mechanic.kind === 'recovery' || mechanic.kind === 'resource') {
    const scaled = `${attributeLabel ?? '成长属性'} × ${mechanic.scalingNumerator}/${mechanic.scalingDenominator}`
    return [`${mechanic.kind === 'recovery' ? '生命恢复' : '技能资源恢复'}：${mechanic.baseAmount} + ${scaled} + 技能威力（受上限裁剪）`]
  }
  if (mechanic.kind === 'status') {
    const status = input.modules.progression.statuses.find(candidate => candidate.key === mechanic.statusKey)
      ?? fail('状态技能缺少公开状态定义')
    const duration = status.duration.clock === 'combat'
      ? '持续至本场战斗结束'
      : `持续目标接下来的 ${status.duration.turns} 个自身行动`
    const reapply = status.reapplyPolicy === 'reject' ? '已有时不重复施加'
      : status.reapplyPolicy === 'refresh' ? '再次施放会刷新持续时间'
        : `可以叠加，最多 ${status.maxStacks} 层`
    return [`施加“${status.title}”`, duration, reapply, ...modifierDetails(status.modifiers)]
  }
  return modifierDetails(mechanic.modifiers)
}

export type TextOpenWorldPlayerCombatModeV1 =
  | 'active' | 'settling' | 'victory' | 'defeat' | 'escaped' | 'legacy'

export type TextOpenWorldPlayerCombatActionGroupV1 = 'attack' | 'skill' | 'item' | 'escape'

export interface TextOpenWorldPlayerCombatActionV1 {
  /** Opaque operation identity. A renderer must never present this value. */
  actionKey: string
  group: TextOpenWorldPlayerCombatActionGroupV1
  label: string
  description: string
  available: boolean
  unavailableReasons: string[]
  resourceCost: number
  cooldownTurns: number
  cooldownRemainingTurns: number
  quantity: number | null
  /** Public, deterministic mechanic description; never contains definition keys. */
  effectDetails: string[]
  targetMode: 'none' | 'single-enemy' | 'all-enemies' | 'self' | 'fixed-item'
  /** Opaque legal targets used only to submit an operation. */
  validEnemyTargetKeys: string[]
  /** Opaque fixed target used only to submit an item operation. */
  fixedTargetKey: string | null
  confirmationRequired: boolean
}

export interface TextOpenWorldPlayerCombatantV1 {
  /** Opaque operation identity. A renderer must never present this value. */
  combatantKey: string
  label: string
  description: string | null
  level: number | null
  currentHealth: number
  maximumHealth: number
  healthRatio: number
  defeated: boolean
  activeActor: boolean
  statuses: Array<{
    title: string
    description: string
    polarity: 'beneficial' | 'harmful' | 'neutral'
    stacks: number | null
    remainingTurns: number | null
    effectDetails: string[]
  }>
}

export interface TextOpenWorldPlayerCombatLogEntryV1 {
  /** Stable UI identity derived from canonical event position, not a content key. */
  id: string
  eventSequence: number
  round: number | null
  actorLabel: string
  actionLabel: string
  summary: string
  details: string[]
  tone: 'neutral' | 'player' | 'enemy' | 'success' | 'danger' | 'reward'
}

export interface TextOpenWorldPlayerCombatRewardV1 {
  status: 'not-applicable' | 'none' | 'settling' | 'granted' | 'unavailable'
  title: string | null
  items: Array<{ kind: 'experience' | 'currency' | 'item' | 'skill' | 'recipe' | 'status' | 'other'; label: string }>
  eventSequence: number | null
}

export interface TextOpenWorldPlayerCombatProjectionV1 {
  schema: 'storyforge.text-open-world.player-combat-projection'
  version: 1
  operationIdentity: {
    sessionId: number
    /** Opaque submission guard. A renderer must never present this value. */
    combatInstanceKey: string | null
    expectedBaseSequence: number
  }
  mode: TextOpenWorldPlayerCombatModeV1
  compatibility: {
    readOnly: boolean
    turnState: boolean
    formalActions: boolean
    numericResolution: boolean
    automaticReward: boolean
    notice: string | null
  }
  encounter: {
    title: string
    description: string
    openingText: string
    recommendedLevel: number
    intensityLabel: string
  }
  phase: {
    statusLabel: string
    phaseLabel: string
    round: number | null
    actorLabel: string | null
    playerTurn: boolean
    waitingForSettlement: boolean
  }
  player: TextOpenWorldPlayerCombatantV1 & {
    skillResource: number
    maximumSkillResource: number
  }
  enemies: TextOpenWorldPlayerCombatantV1[]
  actions: TextOpenWorldPlayerCombatActionV1[]
  log: TextOpenWorldPlayerCombatLogEntryV1[]
  result: {
    status: 'none' | 'victory' | 'defeat' | 'escaped'
    title: string | null
    text: string | null
  }
  reward: TextOpenWorldPlayerCombatRewardV1
  recovery: {
    retryAvailable: boolean
    retryUnavailableReason: string | null
    respawnActions: Array<{
      /** Opaque operation identity. A renderer must never present this value. */
      actionKey: string
      title: string
      available: boolean
      unavailableReasons: string[]
    }>
  }
}

interface PendingCommandEvidence {
  commandId: string
  commandSequence: number
  actorKey: string
  actionKey: string
  randomEventSequences: number[]
  ruleset: unknown | null
}

interface TerminalEvidence {
  event: ProductRuntimeEvent
  payload: TextOpenWorldEffectsAppliedEventPayloadV1
  actionKey: string
  actorKey: string
}

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
  visible.forEach((event, index) => {
    if (!Number.isSafeInteger(event.sequence) || event.sequence !== index + 1) fail(`事件序号不连续:${index + 1}->${String(event.sequence)}`)
    if (event.sessionId !== input.sessionId) fail(`事件流混入其他Session:${event.sessionId}`)
    if (typeof event.payloadJson !== 'string') fail(`事件${event.sequence}缺少payloadJson`)
  })
  const effectByKey = new Map(input.modules.actions.effects.map(effect => [effect.key, effect]))
  let pending: PendingCommandEvidence | null = null
  const terminals: TerminalEvidence[] = []
  for (const event of visible) {
    if (event.type === 'text-open-world.command.committed') {
      if (pending) fail(`上一命令尚未终结:${pending.commandId}`)
      const command = parseTextOpenWorldCommandEventPayloadV1(eventPayload(event))
      const envelope = command.envelope
      if (envelope.sessionId !== input.sessionId || envelope.commandId !== event.commandId
        || envelope.actorKey !== event.actorKey || envelope.baseSequence !== event.baseSequence
        || envelope.baseStateHash !== event.baseStateHash || envelope.baseSequence !== event.sequence - 1
        || command.resultingSequence !== event.sequence
        || !input.modules.actions.actions.some(action => action.key === envelope.actionKey)) {
        fail(`命令事件${event.sequence}包络与索引不一致`)
      }
      pending = {
        commandId: envelope.commandId,
        commandSequence: event.sequence,
        actorKey: envelope.actorKey,
        actionKey: envelope.actionKey,
        randomEventSequences: [],
        ruleset: null,
      }
      continue
    }
    if (event.type === 'text-open-world.random.resolved') {
      if (!pending) fail(`随机证据事件${event.sequence}没有待处理命令`)
      const random = parseTextOpenWorldRandomResolvedEventPayloadV1(eventPayload(event))
      if (event.commandId != null || event.baseSequence != null || event.baseStateHash != null
        || event.actorKey !== pending.actorKey || event.targetKey != null
        || random.commandId !== pending.commandId || random.commandSequence !== pending.commandSequence
        || random.evidence.drawIndex !== pending.randomEventSequences.length
        || !equal(random.ruleset, input.projection.ruleset)
        || pending.ruleset != null && !equal(random.ruleset, pending.ruleset)) {
        fail(`随机证据事件${event.sequence}不属于当前命令批次`)
      }
      pending.ruleset = random.ruleset
      pending.randomEventSequences.push(event.sequence)
      continue
    }
    if (event.type !== 'text-open-world.effects.applied') continue
    if (!pending) fail(`Effect终态事件${event.sequence}没有待处理命令`)
    const applied = parseTextOpenWorldEffectsAppliedEventPayloadV1(eventPayload(event))
    if (event.commandId != null || event.baseSequence != null || event.baseStateHash != null
      || event.actorKey !== pending.actorKey || event.targetKey != null
      || applied.commandId !== pending.commandId || applied.commandSequence !== pending.commandSequence
      || !equal(applied.ruleset, input.projection.ruleset)
      || pending.ruleset != null && !equal(applied.ruleset, pending.ruleset)
      || !equal(applied.randomEventSequences, pending.randomEventSequences)) {
      fail(`Effect终态事件${event.sequence}不属于当前命令批次`)
    }
    applied.plan.effects.forEach(effect => {
      const frozen = effectByKey.get(effect.key)
      if (!frozen || !equal(frozen, effect)) fail(`Effect终态未匹配冻结Release定义:${effect.key}`)
    })
    terminals.push({ event, payload: applied, actionKey: pending.actionKey, actorKey: pending.actorKey })
    pending = null
  }
  if ((pending?.commandId ?? null) !== input.projection.protocol.pendingCommandId
    || (pending?.commandSequence ?? null) !== input.projection.protocol.pendingCommandSequence) {
    fail('事件流待处理命令与正式Projection不一致')
  }
  return terminals
}

function combatantLabels(
  combat: TextOpenWorldModernCombatRuntimeStateV1,
  modules: TextOpenWorldParsedModulesV1,
): Map<string, string> {
  const totals = new Map<string, number>()
  combat.enemies.forEach(enemy => totals.set(enemy.enemyKey, (totals.get(enemy.enemyKey) ?? 0) + 1))
  const seen = new Map<string, number>()
  return new Map(combat.enemies.map(enemy => {
    const definition = modules.combat.enemies.find(candidate => candidate.key === enemy.enemyKey) ?? fail('敌人定义缺失')
    const ordinal = (seen.get(enemy.enemyKey) ?? 0) + 1
    seen.set(enemy.enemyKey, ordinal)
    return [enemy.combatantKey, (totals.get(enemy.enemyKey) ?? 0) > 1 ? `${definition.title} ${ordinal}` : definition.title]
  }))
}

function safeActionReasons(input: {
  action: TextOpenWorldActionAvailabilityV1
  modules: TextOpenWorldParsedModulesV1
  combat: TextOpenWorldModernCombatRuntimeStateV1
  readOnly: boolean
  pending: boolean
  playerTurn: boolean
  learnedSkillKeys: readonly string[]
  skillResource: number
}): string[] {
  const reasons: Array<string | null> = []
  if (input.readOnly) reasons.push('此旧版战斗只提供状态与记录查看。')
  if (input.pending) reasons.push('上一项行动正在由系统结算。')
  else if (!input.playerTurn) reasons.push('当前不是你的行动回合。')
  const marker = [...input.action.action.costEffectKeys, ...input.action.action.successEffectKeys]
    .map(effectKey => input.modules.actions.effects.find(effect => effect.key === effectKey))
    .find((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'perform-combat-action' }> => effect?.operation === 'perform-combat-action')
  const skill = marker?.payload.skillKey
    ? input.modules.progression.skills.find(candidate => candidate.key === marker.payload.skillKey)
    : null
  if (skill) {
    if (!input.learnedSkillKeys.includes(skill.key)) {
      reasons.push('尚未学会这个技能。')
    }
    const remaining = Math.max(0, (input.combat.cooldownUntilRoundBySkillKey?.[skill.key] ?? 0) - input.combat.round)
    if (remaining > 0) reasons.push(`技能冷却中，还需 ${remaining} 回合。`)
  }
  input.action.unavailableReasons.forEach(reason => {
    if (reason.code === 'skill-unavailable') {
      if (skill && input.action.available === false && !reasons.some(item => item?.includes('技能冷却'))) {
        reasons.push('当前资源、冷却或使用条件不允许施放该技能。')
      }
      return
    }
    if (reason.code === 'condition-failed') reasons.push(reason.message || '当前条件不允许执行该行动。')
    else if (reason.code === 'condition-unknown') reasons.push('行动条件仍在核对。')
    else if (reason.code === 'item-unavailable') reasons.push('背包中没有可使用的该道具。')
    else if (reason.code === 'no-valid-target') reasons.push('当前没有可选择的有效目标。')
    else if (reason.code === 'defeated') reasons.push('战败后不能继续战斗。')
    else if (reason.code === 'combat-state') reasons.push('当前战斗阶段不允许执行该行动。')
    else if (reason.code === 'actor-scope') reasons.push('当前不能由玩家执行该行动。')
    else if (reason.code === 'wrong-location') reasons.push('当前位置不能执行该行动。')
    else if (reason.code === 'once-consumed') reasons.push('该行动已经执行过。')
    else if (reason.code === 'cooldown') reasons.push('该行动仍在冷却。')
    else if (reason.code === 'scene-unavailable') reasons.push('该行动所属场景当前不可用。')
    else if (reason.code === 'recipe-unavailable' || reason.code === 'materials-insufficient') reasons.push('当前不满足该行动所需条件。')
    else if (reason.code === 'route-closed') reasons.push('当前路线不可用。')
  })
  if (skill && input.skillResource < skill.resourceCost && input.action.available === false
    && input.action.unavailableReasons.some(reason => reason.code === 'skill-unavailable')) {
    reasons.push(`技能资源不足：需要 ${skill.resourceCost} 点，当前有 ${input.skillResource} 点。`)
  }
  return unique(reasons)
}

function effectQuantityDelta(change: TextOpenWorldEffectChangeV1): number | null {
  if (typeof change.before === 'number' && typeof change.after === 'number') {
    return change.after - change.before
  }
  if (Array.isArray(change.before) && Array.isArray(change.after)) {
    return change.after.length - change.before.length
  }
  return null
}

function objectNumber(value: unknown, field: string): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = (value as Record<string, unknown>)[field]
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
}

function safeEffectChangeDetail(
  change: TextOpenWorldEffectChangeV1,
  effect: TextOpenWorldEffectDefinitionV1,
  modules: TextOpenWorldParsedModulesV1,
): string | null {
  if (change.effectKey !== effect.key || change.operation !== effect.operation) {
    fail('Effect变化记录没有匹配冻结定义')
  }
  const item = (key: string) => modules.items.items.find(candidate => candidate.key === key)?.title ?? null
  const skill = (key: string) => modules.progression.skills.find(candidate => candidate.key === key)?.title ?? null
  const status = (key: string) => modules.progression.statuses.find(candidate => candidate.key === key)?.title ?? null
  const recipe = (key: string) => modules.crafting.recipes.find(candidate => candidate.key === key)?.title ?? null
  if (effect.operation === 'change-player-resource') {
    const delta = effectQuantityDelta(change)
    if (delta == null) fail('资源变化回执不是数值差异')
    const resource = effect.payload.resource === 'health' ? '生命' : '技能资源'
    return delta === 0 ? `${resource}没有变化（已达上限）`
      : `${resource}${delta > 0 ? '恢复' : '消耗'} ${Math.abs(delta)} 点`
  }
  if (effect.operation === 'remove-item') {
    const delta = effectQuantityDelta(change)
    if (delta == null || delta > 0) fail('物品移除回执不是合法数量差异')
    return item(effect.payload.itemKey) ? `消耗 ${item(effect.payload.itemKey)} × ${Math.abs(delta)}` : '消耗了一件物品'
  }
  if (effect.operation === 'apply-status') return status(effect.payload.statusKey) ? `获得状态：${status(effect.payload.statusKey)}` : '角色状态发生变化'
  if (effect.operation === 'remove-status') return status(effect.payload.statusKey) ? `移除状态：${status(effect.payload.statusKey)}` : '角色状态发生变化'
  if (effect.operation === 'grant-experience') {
    const applied = objectNumber(change.after, 'appliedExperience')
      ?? ((objectNumber(change.after, 'experience') ?? Number.NaN) - (objectNumber(change.before, 'experience') ?? Number.NaN))
    if (!Number.isFinite(applied) || applied < 0) fail('经验变化回执无效')
    return `经验 +${applied}`
  }
  if (effect.operation === 'change-currency') {
    const delta = effectQuantityDelta(change)
    if (delta == null) fail('货币变化回执不是数值差异')
    return `${modules.economy.currency.label} ${delta >= 0 ? '+' : '-'}${Math.abs(delta)}`
  }
  if (effect.operation === 'grant-item') {
    const delta = effectQuantityDelta(change)
    if (delta == null || delta < 0) fail('物品授予回执不是合法数量差异')
    return item(effect.payload.itemKey) ? `${item(effect.payload.itemKey)} × ${delta}` : '获得物品'
  }
  if (effect.operation === 'learn-skill') return skill(effect.payload.skillKey) ? `学会技能：${skill(effect.payload.skillKey)}` : '学会新技能'
  if (effect.operation === 'learn-recipe') return recipe(effect.payload.recipeKey) ? `学会配方：${recipe(effect.payload.recipeKey)}` : '学会新配方'
  return null
}

function rewardItems(
  payload: TextOpenWorldEffectsAppliedEventPayloadV1,
  modules: TextOpenWorldParsedModulesV1,
): TextOpenWorldPlayerCombatRewardV1['items'] {
  const effects = new Map(payload.plan.effects.map(effect => [effect.key, effect]))
  return payload.receipt.changes.flatMap(change => {
    const effect = effects.get(change.effectKey) ?? fail('奖励变化没有对应冻结Effect')
    const label = safeEffectChangeDetail(change, effect, modules)
    if (!label) return []
    const kind = effect.operation === 'grant-experience' ? 'experience'
      : effect.operation === 'change-currency' ? 'currency'
        : effect.operation === 'grant-item' ? 'item'
          : effect.operation === 'learn-skill' ? 'skill'
            : effect.operation === 'learn-recipe' ? 'recipe'
              : effect.operation === 'apply-status' ? 'status'
                : 'other'
    return [{ kind, label }]
  })
}

function logForAction(input: {
  sessionId: number
  event: ProductRuntimeEvent
  payload: TextOpenWorldEffectsAppliedEventPayloadV1
  authorization: TextOpenWorldCombatActionAuthorizationV1
  modules: TextOpenWorldParsedModulesV1
  labels: Map<string, string>
  playerName: string
}): TextOpenWorldPlayerCombatLogEntryV1 {
  const action = input.modules.actions.actions.find(candidate => candidate.key === input.authorization.actionKey)
    ?? fail('战斗日志引用未知Action')
  const normalizedActionLabel = action.label.replace(/^敌方/, '').replace(/^战斗中/, '')
  const actionPhrase = /^(使用|施放|发动|执行)/.test(normalizedActionLabel)
    ? normalizedActionLabel
    : `使用${normalizedActionLabel}`
  const actorLabel = input.authorization.actorCombatantKey === 'player'
    ? input.playerName
    : input.labels.get(input.authorization.actorCombatantKey) ?? fail('战斗日志行动者不存在')
  const targetLabels = input.authorization.targetCombatantKeys.map(key => (
    key === 'player' ? input.playerName : input.labels.get(key) ?? fail('战斗日志目标不存在')
  ))
  const resolutions = input.authorization.targetResolutions ?? []
  const damage = resolutions.reduce((sum, resolution) => sum + resolution.appliedDamage, 0)
  const critical = resolutions.some(resolution => resolution.critical)
  const defeated = resolutions.filter(resolution => resolution.defeated).map(resolution => (
    input.labels.get(resolution.targetCombatantKey) ?? input.playerName
  ))
  const combatantLabel = (combatantKey: string) => combatantKey === 'player'
    ? input.playerName
    : input.labels.get(combatantKey) ?? fail('战斗日志机制目标不存在')
  const statusDefinition = (statusKey: string) => input.modules.progression.statuses
    .find(status => status.key === statusKey) ?? fail('战斗日志状态定义不存在')
  const recoveryResolutions = input.authorization.recoveryResolutions ?? []
  const resourceResolutions = input.authorization.resourceResolutions ?? []
  const statusResolutions = input.authorization.statusResolutions ?? []
  const recoveredHealth = recoveryResolutions.reduce((sum, resolution) => sum + resolution.appliedRecovery, 0)
  const recoveredResource = resourceResolutions.reduce((sum, resolution) => sum + resolution.appliedRecovery, 0)
  const statusOutcome = (resolution: NonNullable<TextOpenWorldCombatActionAuthorizationV1['statusResolutions']>[number]) => {
    const target = combatantLabel(resolution.targetCombatantKey)
    const definition = statusDefinition(resolution.statusKey)
    if (resolution.outcome === 'applied') return `${target}获得状态“${definition.title}”`
    if (resolution.outcome === 'refreshed') return `${target}刷新状态“${definition.title}”的持续时间`
    if (resolution.outcome === 'stacked') return `${target}的状态“${definition.title}”叠加至 ${resolution.afterStatus?.stacks ?? 1} 层`
    if (resolution.outcome === 'max-stacks') return `${target}的状态“${definition.title}”已达叠层上限`
    return `${target}已具有状态“${definition.title}”，本次未重复施加`
  }
  const details = unique([
    ...resolutions.map(resolution => {
      const target = resolution.targetCombatantKey === 'player'
        ? input.playerName
        : input.labels.get(resolution.targetCombatantKey) ?? '目标'
      return `${target}：生命 ${resolution.beforeHealth} → ${resolution.afterHealth}，受到 ${resolution.appliedDamage} 点伤害${resolution.critical ? '（暴击）' : ''}`
    }),
    ...recoveryResolutions.map(resolution => {
      const capped = resolution.appliedRecovery < resolution.requestedRecovery ? '（已按上限封顶）' : ''
      return `${combatantLabel(resolution.targetCombatantKey)}：生命 ${resolution.beforeHealth} → ${resolution.afterHealth}，恢复 ${resolution.appliedRecovery} 点${capped}`
    }),
    ...resourceResolutions.map(resolution => {
      const capped = resolution.appliedRecovery < resolution.requestedRecovery ? '（已按上限封顶）' : ''
      return `${combatantLabel(resolution.targetCombatantKey)}：技能资源 ${resolution.beforeSkillResource} → ${resolution.afterSkillResource}，恢复 ${resolution.appliedRecovery} 点${capped}`
    }),
    ...statusResolutions.map(statusOutcome),
    ...(input.authorization.expiredStatusKeys ?? []).map(statusKey => (
      `${actorLabel}的状态“${statusDefinition(statusKey).title}”已到期`
    )),
    ...input.payload.receipt.changes.map(change => {
      const effect = input.payload.plan.effects.find(candidate => candidate.key === change.effectKey)
        ?? fail('战斗变化没有对应冻结Effect')
      return safeEffectChangeDetail(change, effect, input.modules)
    }),
    defeated.length ? `${defeated.join('、')} 已被击败` : null,
  ])
  const summary = damage > 0
    ? `${actorLabel}${actionPhrase}，对${targetLabels.join('、')}造成 ${damage} 点伤害${critical ? '，触发暴击' : ''}。`
    : recoveryResolutions.length
      ? `${actorLabel}${actionPhrase}，恢复 ${recoveredHealth} 点生命。`
      : resourceResolutions.length
        ? `${actorLabel}${actionPhrase}，恢复 ${recoveredResource} 点技能资源。`
        : statusResolutions.length
          ? `${actorLabel}${actionPhrase}，${statusResolutions.some(resolution => ['applied', 'refreshed', 'stacked'].includes(resolution.outcome)) ? '状态效果已经结算' : '状态没有发生变化'}。`
    : input.authorization.actionKind === 'escape'
      ? `${actorLabel}尝试脱离战斗。`
      : input.authorization.actionKind === 'item'
        ? `${actorLabel}${actionPhrase}。`
        : `${actorLabel}${actionPhrase}${targetLabels.length ? `，目标是${targetLabels.join('、')}` : ''}。`
  return {
    id: `text-open-world-combat-log:${input.sessionId}:${input.event.sequence}`,
    eventSequence: input.event.sequence,
    round: input.authorization.beforeRound,
    actorLabel,
    actionLabel: action.label,
    summary,
    details,
    tone: input.authorization.actorKey === 'player' ? 'player' : 'enemy',
  }
}

function statusLabel(status: 'active' | 'victory' | 'defeat' | 'escaped'): string {
  return status === 'active' ? '战斗进行中' : status === 'victory' ? '战斗胜利' : status === 'defeat' ? '战斗失败' : '已经脱离战斗'
}

function phaseLabel(phase: TextOpenWorldCombatRuntimeStateV1['phase']): string {
  const labels: Record<TextOpenWorldCombatRuntimeStateV1['phase'], string> = {
    started: '遭遇开始', 'round-start': '回合开始', 'actor-turn': '行动阶段',
    'action-resolved': '行动结算', 'round-end': '回合结束', terminal: '战斗结束',
  }
  return labels[phase]
}

function combatStatuses(input: {
  combat: TextOpenWorldModernCombatRuntimeStateV1
  combatantKey: string
  modules: TextOpenWorldParsedModulesV1
}): TextOpenWorldPlayerCombatantV1['statuses'] {
  const progression = input.modules.progression
  if (input.combat.version !== 2 || progression.version !== 2) return []
  const ordinal = input.combat.actorTurnOrdinalByCombatantKey[input.combatantKey]
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) fail('战斗状态行动序号无效')
  const instances = input.combat.statusInstancesByCombatantKey[input.combatantKey]
  if (!Array.isArray(instances)) fail('战斗状态没有覆盖战斗员')
  return instances.map(instance => {
    const definition = progression.statuses.find(status => status.key === instance.statusKey)
      ?? fail('战斗状态定义缺失')
    const remainingTurns = instance.expiresAfterTargetTurnOrdinal == null
      ? null
      : Math.max(0, instance.expiresAfterTargetTurnOrdinal - ordinal)
    return {
      title: definition.title,
      description: definition.description,
      polarity: definition.polarity,
      stacks: instance.stacks,
      remainingTurns,
      effectDetails: [
        ...modifierDetails(definition.modifiers, instance.stacks),
        remainingTurns == null
          ? '持续至本场战斗结束'
          : `剩余 ${remainingTurns} 个自身行动`,
      ],
    }
  })
}

/**
 * Builds a render-safe combat view from a validated Projection prefix. It does
 * not trust latest-state mirrors as history and never exposes receipt summaries,
 * condition keys, hashes, random draw data, source refs or raw internal reasons.
 */
export function projectTextOpenWorldPlayerCombatV1(input: {
  sessionId: number
  projection: TextOpenWorldSessionProjectionV1 | unknown
  events: readonly ProductRuntimeEvent[]
  projectedActions: readonly TextOpenWorldActionAvailabilityV1[]
  checkpoints?: readonly ProductRuntimeCheckpoint[]
}): TextOpenWorldPlayerCombatProjectionV1 | null {
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId < 1) fail('sessionId无效')
  const projection = parseTextOpenWorldSessionProjectionV1(input.projection)
  const combat = projection.state.combat
  if (!combat) return null
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const canonicalActions = createTextOpenWorldActionRegistryV1(projection.runtimePackage)
    .project(deriveTextOpenWorldContextsV1(projection).action)
  if (!equal(canonicalActions, input.projectedActions)) fail('Action投影不是当前Session的完整正式结果')
  const terminals = terminalEvidence({ sessionId: input.sessionId, projection, modules, events: input.events })
  const encounter = modules.combat.encounters.find(candidate => candidate.key === combat.encounterKey)
    ?? fail('战斗遭遇定义缺失')
  const life = deriveTextOpenWorldLifeProjectionV1({
    runtimePackage: projection.runtimePackage,
    state: projection.state,
    checkpoints: input.checkpoints ? [...input.checkpoints] : [],
  })
  const modernCombat: TextOpenWorldModernCombatRuntimeStateV1 | null = 'version' in combat ? combat : null
  const modern = modernCombat != null
  const formalActions = modern && modules.actions.version >= 10
  const numericResolution = modern && modules.actions.version >= 11
    && (modules.combat.sourceVersion === 3 || modules.combat.sourceVersion === 4)
  const automaticReward = numericResolution
  const readOnly = !numericResolution
  const pending = projection.protocol.pendingCommandId != null
  const compatibilityNotice = !modern
    ? '此存档使用旧版战斗状态，只能查看遭遇与结果；不会伪造生命、回合或行动记录。'
    : modules.actions.version < 10
      ? '此存档保留旧版回合状态，但没有冻结的四类战斗操作，只能查看。'
      : !numericResolution
        ? '此存档没有可验证的数值结算与自动奖励证据，战斗界面以只读方式兼容。'
        : null
  const labels = modernCombat ? combatantLabels(modernCombat, modules) : new Map<string, string>()
  const playerName = modules.actors.player.identity.name
  const playerTurn = modernCombat != null && modernCombat.status === 'active'
    && modernCombat.phase === 'actor-turn' && modernCombat.activeCombatantKey === 'player'
  const waitingForSettlement = pending || modernCombat != null && modernCombat.status === 'active' && !playerTurn
  const inventoryQuantities = deriveTextOpenWorldInventoryQuantitiesV1(modules, projection.state.inventory)

  const actions = formalActions ? canonicalActions
    .filter(projected => projected.action.actorScope === 'player' && COMBAT_ACTION_CATEGORIES.has(projected.action.category))
    .map((projected): TextOpenWorldPlayerCombatActionV1 => {
      const marker = [...projected.action.costEffectKeys, ...projected.action.successEffectKeys]
        .map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey))
        .find((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'perform-combat-action' }> => effect?.operation === 'perform-combat-action')
        ?? fail('战斗Action缺少正式操作标记')
      const skill = marker.payload.skillKey
        ? modules.progression.skills.find(candidate => candidate.key === marker.payload.skillKey) ?? fail('战斗技能定义缺失')
        : null
      const group: TextOpenWorldPlayerCombatActionGroupV1 = projected.action.category === 'combat-basic-attack'
        ? 'attack' : projected.action.category === 'combat-skill' ? 'skill' : projected.action.category === 'combat-item' ? 'item' : 'escape'
      const targetMode = marker.payload.kind === 'item' ? 'fixed-item'
        : marker.payload.kind === 'escape' ? 'none'
          : skill?.target ?? 'none'
      const cooldownRemainingTurns = skill && modernCombat
        ? Math.max(0, (modernCombat.cooldownUntilRoundBySkillKey?.[skill.key] ?? 0) - modernCombat.round)
        : 0
      const reasons = safeActionReasons({
        action: projected,
        modules,
        combat: modernCombat ?? fail('正式战斗Action缺少回合状态'),
        readOnly,
        pending,
        playerTurn,
        learnedSkillKeys: projection.state.player.learnedSkillKeys,
        skillResource: projection.state.player.skillResource,
      })
      return {
        actionKey: projected.action.key,
        group,
        label: projected.action.label,
        description: projected.action.description,
        available: projected.available && reasons.length === 0,
        unavailableReasons: reasons,
        resourceCost: skill?.resourceCost ?? 0,
        cooldownTurns: skill?.cooldownTurns ?? 0,
        cooldownRemainingTurns,
        quantity: marker.payload.itemKey ? inventoryQuantities[marker.payload.itemKey] ?? 0 : null,
        effectDetails: skillMechanicDetails({ skill, actionKind: marker.payload.kind, modules }),
        targetMode,
        validEnemyTargetKeys: targetMode === 'single-enemy'
          ? projected.validTargetKeys.filter(key => labels.has(key) && modernCombat?.enemies.some(enemy => enemy.combatantKey === key && !enemy.defeated))
          : [],
        fixedTargetKey: marker.payload.itemKey,
        confirmationRequired: projected.confirmationRequired,
      }
    }) : []

  const currentInstanceKey = modernCombat?.instanceKey ?? null
  const log: TextOpenWorldPlayerCombatLogEntryV1[] = []
  const baselineRewardClaimKey = combat.status === 'victory'
    && automaticReward
    && encounter.rewardContractKey
    && currentInstanceKey
    ? `claim.reward.${encounter.rewardContractKey}.${currentInstanceKey}`
    : null
  // A child branch begins with event sequence zero, so parent events are not
  // copied into its log. The rebased state still carries the canonical applied
  // claim ledger; use that ledger only to prove settlement, never to reconstruct
  // reward amounts that are no longer present in this Session's event prefix.
  const rewardSettledInBaseline = baselineRewardClaimKey != null
    && projection.state.appliedClaimKeys.includes(baselineRewardClaimKey)
  const baselineRewardContract = rewardSettledInBaseline
    ? modules.items.rewardContracts.find(candidate => candidate.key === encounter.rewardContractKey)
      ?? fail('已结算战斗奖励合同缺失')
    : null
  let reward: TextOpenWorldPlayerCombatRewardV1 = {
    status: combat.status === 'victory'
      ? rewardSettledInBaseline ? 'granted'
        : automaticReward && encounter.rewardContractKey ? 'settling'
          : automaticReward ? 'none' : 'unavailable'
      : combat.status === 'active' ? 'not-applicable' : 'none',
    title: baselineRewardContract?.title ?? null,
    items: [],
    eventSequence: null,
  }
  terminals.forEach(terminal => {
    const authorization = terminal.payload.plan.authorization
    if (authorization?.kind === 'combat-action' && currentInstanceKey && authorization.instanceKey === currentInstanceKey) {
      if (authorization.encounterKey !== encounter.key || authorization.actionKey !== terminal.actionKey
        || authorization.actorKey !== terminal.actorKey || terminal.payload.outcome !== 'success') fail('战斗行动日志证据不一致')
      log.push(logForAction({
        sessionId: input.sessionId,
        event: terminal.event,
        payload: terminal.payload,
        authorization,
        modules,
        labels,
        playerName,
      }))
      return
    }
    if (authorization?.kind === 'combat-transition' && currentInstanceKey && authorization.instanceKey === currentInstanceKey
      && authorization.intent.startsWith('finish-')) {
      const tone = authorization.afterStatus === 'victory' ? 'success' : authorization.afterStatus === 'defeat' ? 'danger' : 'neutral'
      log.push({
        id: `text-open-world-combat-log:${input.sessionId}:${terminal.event.sequence}`,
        eventSequence: terminal.event.sequence,
        round: authorization.afterRound,
        actorLabel: '系统',
        actionLabel: statusLabel(authorization.afterStatus),
        summary: statusLabel(authorization.afterStatus),
        details: [],
        tone,
      })
      return
    }
    if (authorization?.kind === 'reward' && currentInstanceKey && authorization.sourceInstanceKey === currentInstanceKey) {
      if (authorization.rewardKey !== encounter.rewardContractKey || terminal.payload.outcome !== 'success') fail('战斗奖励日志证据不一致')
      const contract = modules.items.rewardContracts.find(candidate => candidate.key === authorization.rewardKey)
        ?? fail('战斗奖励合同缺失')
      const items = rewardItems(terminal.payload, modules)
      reward = { status: 'granted', title: contract.title, items, eventSequence: terminal.event.sequence }
      log.push({
        id: `text-open-world-combat-log:${input.sessionId}:${terminal.event.sequence}`,
        eventSequence: terminal.event.sequence,
        round: modernCombat?.round ?? null,
        actorLabel: '系统',
        actionLabel: '战斗奖励',
        summary: '战斗奖励已按正式记录结算。',
        details: items.map(item => item.label),
        tone: 'reward',
      })
    }
  })

  const respawnActions = canonicalActions.filter(action => action.action.category === 'respawn').flatMap(action => {
    const effect = action.action.successEffectKeys.map(effectKey => modules.actions.effects.find(candidate => candidate.key === effectKey))
      .find((candidate): candidate is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'respawn' }> => candidate?.operation === 'respawn')
    if (!effect) return []
    const point = life.respawnPoints.find(candidate => candidate.fastTravelPointKey === effect.payload.fastTravelPointKey)
    if (!point && action.available) fail('可用复活Action没有已解锁安全点')
    return [{
      actionKey: action.action.key,
      title: point ? `在${point.title}恢复` : action.action.label,
      available: action.available && point != null,
      unavailableReasons: action.available && point ? [] : ['该安全复活点尚未解锁。'],
    }]
  })
  const actorLabel = modernCombat?.activeCombatantKey
    ? modernCombat.activeCombatantKey === 'player' ? playerName : labels.get(modernCombat.activeCombatantKey) ?? null
    : null
  const mode: TextOpenWorldPlayerCombatModeV1 = readOnly ? 'legacy'
    : pending || combat.status === 'active' && !playerTurn ? 'settling'
      : combat.status
  const result = combat.status === 'active' ? { status: 'none' as const, title: null, text: null }
    : combat.status === 'victory'
      ? { status: 'victory' as const, title: '战斗胜利', text: encounter.victoryText }
      : combat.status === 'defeat'
        ? { status: 'defeat' as const, title: '战斗失败', text: encounter.defeatText }
        : { status: 'escaped' as const, title: '已经脱离战斗', text: '你已经退出这场遭遇，世界状态与既有消耗仍然保留。' }
  const battlePlayerStatuses = modernCombat ? combatStatuses({ combat: modernCombat, combatantKey: 'player', modules }) : []
  const battlePlayerStatusKeys = modernCombat?.version === 2
    ? new Set((modernCombat.statusInstancesByCombatantKey.player ?? []).map(instance => instance.statusKey))
    : new Set<string>()

  return {
    schema: 'storyforge.text-open-world.player-combat-projection',
    version: 1,
    operationIdentity: {
      sessionId: input.sessionId,
      combatInstanceKey: currentInstanceKey,
      expectedBaseSequence: projection.lastEventSequence,
    },
    mode,
    compatibility: {
      readOnly,
      turnState: modern,
      formalActions,
      numericResolution,
      automaticReward,
      notice: compatibilityNotice,
    },
    encounter: {
      title: encounter.title,
      description: encounter.description,
      openingText: encounter.openingText,
      recommendedLevel: encounter.recommendedLevel,
      intensityLabel: encounter.intensity === 'boss' ? '首领战' : encounter.intensity === 'dangerous' ? '危险遭遇' : '普通遭遇',
    },
    phase: {
      statusLabel: statusLabel(combat.status),
      phaseLabel: modernCombat ? phaseLabel(modernCombat.phase) : '旧版战斗记录',
      round: modernCombat?.round ?? null,
      actorLabel,
      playerTurn,
      waitingForSettlement,
    },
    player: {
      combatantKey: 'player',
      label: playerName,
      description: null,
      level: projection.state.player.level,
      currentHealth: projection.state.player.health,
      maximumHealth: projection.state.player.maximumHealth,
      healthRatio: projection.state.player.maximumHealth > 0 ? projection.state.player.health / projection.state.player.maximumHealth : 0,
      defeated: projection.state.player.health === 0,
      activeActor: modernCombat?.activeCombatantKey === 'player',
      skillResource: projection.state.player.skillResource,
      maximumSkillResource: projection.state.player.maximumSkillResource,
      statuses: [
        ...battlePlayerStatuses,
        ...projection.state.player.statusKeys.filter(statusKey => !battlePlayerStatusKeys.has(statusKey)).map(statusKey => {
          const status = modules.progression.statuses.find(candidate => candidate.key === statusKey) ?? fail('玩家状态定义缺失')
          return {
            title: status.title,
            description: status.description,
            polarity: status.polarity,
            stacks: null,
            remainingTurns: null,
            effectDetails: [],
          }
        }),
      ],
    },
    enemies: modernCombat ? modernCombat.enemies.map(enemy => {
      const definition = modules.combat.enemies.find(candidate => candidate.key === enemy.enemyKey) ?? fail('敌人定义缺失')
      return {
        combatantKey: enemy.combatantKey,
        label: labels.get(enemy.combatantKey) ?? fail('敌人显示名缺失'),
        description: definition.description,
        level: definition.level,
        currentHealth: enemy.currentHealth,
        maximumHealth: enemy.maximumHealth,
        healthRatio: enemy.maximumHealth > 0 ? enemy.currentHealth / enemy.maximumHealth : 0,
        defeated: enemy.defeated,
        activeActor: modernCombat.activeCombatantKey === enemy.combatantKey,
        statuses: combatStatuses({ combat: modernCombat, combatantKey: enemy.combatantKey, modules }),
      }
    }) : [],
    actions,
    log: log.slice(-MAXIMUM_LOG_ENTRIES),
    result,
    reward,
    recovery: {
      retryAvailable: combat.status === 'defeat' && life.combatRetryCheckpointIds.length > 0,
      retryUnavailableReason: combat.status !== 'defeat' ? null
        : life.combatRetryCheckpointIds.length ? null : '没有通过校验的战前重试点；仍可读档或在已解锁安全点恢复。',
      respawnActions: combat.status === 'defeat' ? respawnActions : [],
    },
  }
}
