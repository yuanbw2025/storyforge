import type {
  RulePackV1,
  ProductRuntimeState,
  TtrpgEffectLedgerStateV2,
  TtrpgEffectLedgerTransitionV2,
  TtrpgEffectPlanV2,
  TtrpgPendingEffectChoiceV2,
} from '../types'
import { parseTtrpgAbilityRuntimeStateV2, ttrpgAbilityStateKeyV2 } from './ability-ledger'
import { parseTtrpgEffectPlanV2 } from './effect-plan'
import { applyTtrpgItemCommandV2, ttrpgItemDefinitionFromRuleV1 } from './item-ledger'
import { parseRulePackV1 } from './rule-pack'
import { earnedTtrpgCharacterCurrencyV2 } from './advancement'

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function fail(message: string): never {
  throw new Error(`[ttrpg-effect-runtime] ${message}`)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function key(value: unknown, label: string): string {
  if (typeof value !== 'string' || !KEY.test(value)) fail(`${label} 无效`)
  return value
}

function boundedRecord(value: unknown, label: string): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 100_000) fail(`${label} 无效`)
  return Object.fromEntries(Object.entries(value).map(([entryKey, amount]) => {
    key(entryKey, `${label}.key`)
    if (typeof amount !== 'number' || !Number.isFinite(amount) || Math.abs(amount) > 1_000_000_000) fail(`${label}.${entryKey} 无效`)
    return [entryKey, amount]
  }))
}

export function createEmptyTtrpgEffectLedgerV2(): TtrpgEffectLedgerStateV2 {
  return {
    schema: 'storyforge.ttrpg-effect-ledger', version: 2,
    appliedIdempotencyKeys: [], advancementBalances: {}, socialBalances: {},
    storyClocks: {}, storyFacts: {}, pendingChoices: [], entries: [],
  }
}

export function parseTtrpgEffectLedgerStateV2(value: unknown): TtrpgEffectLedgerStateV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('效果账本必须是对象')
  const row = value as Record<string, unknown>
  const v2BaseFields = ['schema', 'version', 'appliedIdempotencyKeys', 'advancementBalances', 'socialBalances', 'storyClocks', 'storyFacts', 'entries']
  const current = [...v2BaseFields, 'pendingChoices']
  const fields = Object.keys(row).sort().join(',')
  if (![v2BaseFields.sort().join(','), current.sort().join(',')].includes(fields)
    || row.schema !== 'storyforge.ttrpg-effect-ledger' || row.version !== 2
    || !Array.isArray(row.appliedIdempotencyKeys) || row.appliedIdempotencyKeys.length > 100_000
    || !Array.isArray(row.entries) || row.entries.length > 100_000
    || !row.storyFacts || typeof row.storyFacts !== 'object' || Array.isArray(row.storyFacts)) fail('效果账本结构无效')
  const appliedIdempotencyKeys = row.appliedIdempotencyKeys.map((item, index) => key(item, `appliedIdempotencyKeys[${index}]`))
  if (new Set(appliedIdempotencyKeys).size !== appliedIdempotencyKeys.length) fail('效果账本幂等键重复')
  const storyFacts = Object.fromEntries(Object.entries(row.storyFacts as Record<string, unknown>).map(([factKey, fact]) => {
    key(factKey, 'storyFacts.key')
    if (fact != null && !['string', 'number', 'boolean'].includes(typeof fact)) fail(`storyFacts.${factKey} 无效`)
    if (typeof fact === 'number' && !Number.isFinite(fact)) fail(`storyFacts.${factKey} 无效`)
    return [factKey, fact as string | number | boolean | null]
  }))
  const entries = row.entries.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`entries[${index}] 无效`)
    const entry = raw as Record<string, unknown>
    const fields = ['eventSequence', 'planKey', 'degree', 'sourceEventId', 'ruleRef', 'reason', 'audience', 'idempotencyKey', 'transitions']
    if (Object.keys(entry).sort().join(',') !== fields.sort().join(',') || !Number.isInteger(entry.eventSequence)
      || Number(entry.eventSequence) < 1 || !Array.isArray(entry.transitions) || entry.transitions.length > 100) fail(`entries[${index}] 结构无效`)
    const transitions = entry.transitions.map((rawTransition, transitionIndex) => {
      if (!rawTransition || typeof rawTransition !== 'object' || Array.isArray(rawTransition)) fail(`entries[${index}].transitions[${transitionIndex}] 无效`)
      const transition = rawTransition as Record<string, unknown>
      const transitionFields = ['effectKey', 'family', 'operation', 'targetRef', 'beforeJson', 'afterJson']
      if (Object.keys(transition).sort().join(',') !== transitionFields.sort().join(',')
        || !['numeric', 'condition', 'item', 'ability', 'advancement', 'social', 'story'].includes(String(transition.family))) fail('效果转移字段无效')
      key(transition.effectKey, 'transition.effectKey'); key(transition.targetRef, 'transition.targetRef')
      if (typeof transition.operation !== 'string' || !transition.operation
        || typeof transition.beforeJson !== 'string' || typeof transition.afterJson !== 'string') fail('效果转移值无效')
      try { JSON.parse(transition.beforeJson); JSON.parse(transition.afterJson) } catch { fail('效果转移不是合法 JSON') }
      return transition as unknown as TtrpgEffectLedgerTransitionV2
    })
    return {
      eventSequence: Number(entry.eventSequence), planKey: key(entry.planKey, 'entry.planKey'),
      degree: String(entry.degree) as TtrpgEffectLedgerStateV2['entries'][number]['degree'],
      sourceEventId: key(entry.sourceEventId, 'entry.sourceEventId'), ruleRef: key(entry.ruleRef, 'entry.ruleRef'),
      reason: String(entry.reason), audience: String(entry.audience) as TtrpgEffectLedgerStateV2['entries'][number]['audience'],
      idempotencyKey: key(entry.idempotencyKey, 'entry.idempotencyKey'), transitions,
    }
  })
  const pendingChoices = (row.pendingChoices == null ? [] : row.pendingChoices)
  if (!Array.isArray(pendingChoices) || pendingChoices.length > 10_000) fail('待选择效果清单无效')
  const parsedPendingChoices: TtrpgPendingEffectChoiceV2[] = pendingChoices.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`pendingChoices[${index}] 无效`)
    const choice = raw as Record<string, unknown>
    const choiceFields = ['choiceKey', 'proposedEventSequence', 'actionSequence', 'ownerActorKey', 'plan']
    if (Object.keys(choice).sort().join(',') !== choiceFields.sort().join(',')) fail(`pendingChoices[${index}] 字段无效`)
    const plan = parseTtrpgEffectPlanV2(choice.plan)
    const choiceKey = key(choice.choiceKey, `pendingChoices[${index}].choiceKey`)
    const proposedEventSequence = Number(choice.proposedEventSequence)
    const actionSequence = Number(choice.actionSequence)
    const ownerActorKey = key(choice.ownerActorKey, `pendingChoices[${index}].ownerActorKey`)
    if (!Number.isInteger(proposedEventSequence) || proposedEventSequence < 1
      || !Number.isInteger(actionSequence) || actionSequence < 1 || actionSequence >= proposedEventSequence
      || plan.status !== 'pending-choice' || plan.planKey !== choiceKey
      || plan.sourceEventId !== `event.${actionSequence}`
      || plan.audience !== `actor:${ownerActorKey}`) fail(`pendingChoices[${index}] 约束无效`)
    return { choiceKey, proposedEventSequence, actionSequence, ownerActorKey, plan }
  })
  if (new Set(parsedPendingChoices.map(choice => choice.choiceKey)).size !== parsedPendingChoices.length
    || new Set(parsedPendingChoices.map(choice => choice.plan.idempotencyKey)).size !== parsedPendingChoices.length
    || new Set(parsedPendingChoices.map(choice => choice.plan.sourceEventId)).size !== parsedPendingChoices.length) {
    fail('待选择效果存在重复引用')
  }
  return {
    schema: 'storyforge.ttrpg-effect-ledger', version: 2, appliedIdempotencyKeys,
    advancementBalances: boundedRecord(row.advancementBalances, 'advancementBalances'),
    socialBalances: boundedRecord(row.socialBalances, 'socialBalances'),
    storyClocks: boundedRecord(row.storyClocks, 'storyClocks'), storyFacts,
    pendingChoices: parsedPendingChoices, entries,
  }
}

/** Pure proposal transition: records alternatives but applies no mechanics. */
export function proposeTtrpgEffectChoiceToRuntimeV2(input: {
  state: ProductRuntimeState
  plan: TtrpgEffectPlanV2
  actionSequence: number
  ownerActorKey: string
  eventSequence: number
}): { state: ProductRuntimeState; choice: TtrpgPendingEffectChoiceV2 } {
  const plan = parseTtrpgEffectPlanV2(input.plan)
  const state = structuredClone(input.state)
  const product = state.ttrpg?.product
  if (!product?.sessionZero.completed || product.ending || !product.effectLedger) fail('正式战役缺少可提议的效果账本')
  if (plan.status !== 'pending-choice') fail('效果选择提议必须使用 pending-choice 状态')
  if (!KEY.test(input.ownerActorKey) || !state.entities[input.ownerActorKey]) fail('效果选择所有者不存在')
  if (!Number.isInteger(input.eventSequence) || input.eventSequence !== state.lastSequence + 1) fail('效果选择提议事件序号不连续')
  if (!Number.isInteger(input.actionSequence) || input.actionSequence < 1 || input.actionSequence >= input.eventSequence) fail('效果选择来源行动序号无效')
  const sourceAction = product.actionHistory.find(action => action.eventSequence === input.actionSequence)
  const expectedDegree = sourceAction?.outcome === 'automatic' ? 'success' : sourceAction?.outcome
  if (!sourceAction || plan.sourceEventId !== `event.${input.actionSequence}`
    || plan.ruleRef !== sourceAction.actionKey || plan.degree !== expectedDegree) fail('效果选择没有精确绑定正式行动结果')
  if (plan.audience !== `actor:${input.ownerActorKey}`
    || plan.effects.some(effect => effect.targetRef !== input.ownerActorKey)) fail('玩家选择只能包含该角色自己的私密后果')
  if (product.effectLedger.appliedIdempotencyKeys.includes(plan.idempotencyKey)
    || product.effectLedger.entries.some(entry => entry.sourceEventId === plan.sourceEventId)
    || product.effectLedger.pendingChoices.some(choice => choice.choiceKey === plan.planKey
      || choice.plan.idempotencyKey === plan.idempotencyKey
      || choice.plan.sourceEventId === plan.sourceEventId)) fail('该行动已经存在后果或待选择提议')
  const choice: TtrpgPendingEffectChoiceV2 = {
    choiceKey: plan.planKey,
    proposedEventSequence: input.eventSequence,
    actionSequence: input.actionSequence,
    ownerActorKey: input.ownerActorKey,
    plan,
  }
  product.effectLedger.pendingChoices.push(choice)
  return { state, choice: structuredClone(choice) }
}

/** Pure resolution transition: selects one frozen alternative and applies it atomically. */
export function resolveTtrpgEffectChoiceToRuntimeV2(input: {
  state: ProductRuntimeState
  rulePack: RulePackV1
  choiceKey: string
  selectedEffectKey: string
  commandId: string
  eventSequence: number
}): { state: ProductRuntimeState; plan: TtrpgEffectPlanV2; transitions: TtrpgEffectLedgerTransitionV2[] } {
  const choiceKey = key(input.choiceKey, 'choiceKey')
  const selectedEffectKey = key(input.selectedEffectKey, 'selectedEffectKey')
  const commandId = key(input.commandId, 'commandId')
  const product = input.state.ttrpg?.product
  const choice = product?.effectLedger?.pendingChoices.find(item => item.choiceKey === choiceKey)
  if (!choice) fail('待选择后果不存在或已经结算')
  const selected = choice.plan.effects.find(effect => effect.effectKey === selectedEffectKey)
  if (!selected) fail('选择项不属于冻结提议')
  const plan = parseTtrpgEffectPlanV2({
    ...choice.plan,
    idempotencyKey: commandId,
    status: 'immediate',
    effects: [selected],
  })
  const applied = applyTtrpgEffectPlanToRuntimeV2({
    state: input.state,
    rulePack: input.rulePack,
    plan,
    eventSequence: input.eventSequence,
  })
  const nextLedger = applied.state.ttrpg?.product?.effectLedger
  if (!nextLedger) fail('效果选择结算后账本丢失')
  nextLedger.pendingChoices = nextLedger.pendingChoices.filter(item => item.choiceKey !== choiceKey)
  return { state: applied.state, plan, transitions: applied.transitions }
}

function setBalance(target: Record<string, number>, balanceKey: string, delta: number): [number, number] {
  const before = target[balanceKey] ?? 0
  const after = before + delta
  if (!Number.isFinite(after) || Math.abs(after) > 1_000_000_000) fail(`账本数值越界:${balanceKey}`)
  target[balanceKey] = after
  return [before, after]
}

/** Pure atomic interpreter: returns a cloned state or throws without partial mutation. */
export function applyTtrpgEffectPlanToRuntimeV2(input: {
  state: ProductRuntimeState
  rulePack: RulePackV1
  plan: TtrpgEffectPlanV2
  eventSequence: number
}): { state: ProductRuntimeState; transitions: TtrpgEffectLedgerTransitionV2[] } {
  const plan = parseTtrpgEffectPlanV2(input.plan)
  const rulePack = parseRulePackV1(input.rulePack)
  const state = structuredClone(input.state)
  const product = state.ttrpg?.product
  if (!product?.sessionZero.completed || !product.effectLedger || !product.inventory || !product.abilityStates) {
    fail('正式战役缺少效果、库存或能力账本')
  }
  if (plan.status !== 'immediate') fail('pending-choice 计划必须先完成选择再提交')
  if (!Number.isInteger(input.eventSequence) || input.eventSequence !== state.lastSequence + 1) fail('效果事件序号不连续')
  const sourceMatch = /^event\.(\d+)$/.exec(plan.sourceEventId)
  if (!sourceMatch || Number(sourceMatch[1]) < 1 || Number(sourceMatch[1]) > state.lastSequence) fail('效果来源必须引用已提交事件')
  if (product.effectLedger.appliedIdempotencyKeys.includes(plan.idempotencyKey)) fail('EffectPlan 已经提交')
  const transitions: TtrpgEffectLedgerTransitionV2[] = []
  const receipt = (effect: TtrpgEffectPlanV2['effects'][number], before: unknown, after: unknown) => {
    transitions.push({
      effectKey: effect.effectKey, family: effect.family, operation: effect.operation,
      targetRef: effect.targetRef, beforeJson: stableJson(before), afterJson: stableJson(after),
    })
  }
  const itemDefinitions = Object.fromEntries(rulePack.items.map(item => [item.key, ttrpgItemDefinitionFromRuleV1(item)]))
  for (const [effectIndex, effect] of plan.effects.entries()) {
    if (effect.family === 'numeric') {
      if (effect.operation === 'currency') {
        const balanceKey = `${effect.targetRef}:${effect.valueKey}`
        const [before, after] = setBalance(product.effectLedger.advancementBalances, balanceKey, effect.amount)
        receipt(effect, before, after)
        continue
      }
      const entity = state.entities[effect.targetRef]
      if (!entity) fail(`数值效果目标不存在:${effect.targetRef}`)
      const path = `resource.${effect.valueKey}`
      const maximum = entity.attributes[`resourceMax.${effect.valueKey}`]
      const before = entity.attributes[path]
      if (typeof before !== 'number' || !Number.isFinite(before) || typeof maximum !== 'number' || !Number.isFinite(maximum)) fail(`资源不存在:${effect.targetRef}.${effect.valueKey}`)
      const signed = ['resource.spend', 'damage', 'stress'].includes(effect.operation) ? -Math.abs(effect.amount) : Math.abs(effect.amount)
      const after = effect.operation === 'resource.set' ? effect.amount : Math.max(0, Math.min(maximum, before + signed))
      if (!Number.isFinite(after) || after < 0 || after > maximum) fail(`资源结果越界:${effect.targetRef}.${effect.valueKey}`)
      entity.attributes[path] = after
      if (effect.valueKey === 'vigor') entity.attributes.hp = after
      receipt(effect, before, after)
    } else if (effect.family === 'condition') {
      if (!state.entities[effect.targetRef]) fail(`状态目标不存在:${effect.targetRef}`)
      const definition = rulePack.conditions.find(item => item.key === effect.conditionKey)
      if (!definition) fail(`状态定义不存在:${effect.conditionKey}`)
      const before = structuredClone(product.conditions[effect.targetRef] ?? [])
      const other = before.filter(item => item.conditionKey !== effect.conditionKey)
      if (effect.operation === 'condition.remove') product.conditions[effect.targetRef] = other
      else {
        const prior = before.find(item => item.conditionKey === effect.conditionKey)
        const stacks = definition.stacking === 'replace' ? effect.stacks : (prior?.stacks ?? 0) + effect.stacks
        product.conditions[effect.targetRef] = [...other, {
          conditionKey: effect.conditionKey, stacks: Math.min(definition.maximumStacks, stacks), duration: effect.duration,
        }]
      }
      receipt(effect, before, product.conditions[effect.targetRef])
    } else if (effect.family === 'item') {
      const before = structuredClone(product.inventory)
      const instanceId = effect.itemInstanceRef ?? `item.${input.eventSequence}.${effectIndex}`
      const commandId = `effect.${input.eventSequence}.${effectIndex}`
      const command = effect.operation === 'item.grant'
        ? { commandId, kind: 'grant' as const, instanceId, definitionRef: effect.itemDefinitionRef!, ownerRef: effect.targetRef, locationRef: null, quantity: effect.amount, eventId: `event.${input.eventSequence}` }
        : effect.operation === 'item.remove'
          ? { commandId, kind: 'remove' as const, instanceId, expectedOwnerRef: effect.targetRef, quantity: effect.amount }
          : effect.operation === 'item.transfer'
            ? { commandId, kind: 'transfer' as const, instanceId, expectedOwnerRef: effect.targetRef, destinationOwnerRef: effect.destinationRef }
            : effect.operation === 'item.use'
              ? { commandId, kind: 'use' as const, instanceId, expectedOwnerRef: effect.targetRef, amount: effect.amount }
              : effect.operation === 'item.damage'
                ? { commandId, kind: 'damage' as const, instanceId, amount: effect.amount }
                : effect.operation === 'item.repair'
                  ? { commandId, kind: 'repair' as const, instanceId, amount: effect.amount }
                  : fail('EffectPlan 的装备操作需要明确槽位，请使用正式物品命令')
      product.inventory = applyTtrpgItemCommandV2({ state: product.inventory, definitions: itemDefinitions, command }).state
      receipt(effect, before, product.inventory)
    } else if (effect.family === 'ability') {
      const stateKey = ttrpgAbilityStateKeyV2(effect.targetRef, effect.abilityKey)
      const before = parseTtrpgAbilityRuntimeStateV2(product.abilityStates[stateKey])
      const after = structuredClone(before)
      const definition = rulePack.actions.find(action => action.key === effect.abilityKey)
      if (!definition) fail(`能力定义不存在:${effect.abilityKey}`)
      if (effect.operation === 'ability.disable') {
        if (!after.disabledReasons.includes(plan.ruleRef)) after.disabledReasons.push(plan.ruleRef)
      } else if (effect.operation === 'ability.unlock') after.disabledReasons = []
      else if (effect.operation === 'usage.consume') {
        if (after.remainingUses == null || after.remainingUses < effect.amount!) fail('奖励计划要求消耗的能力次数不足')
        after.remainingUses -= effect.amount!
      } else if (effect.operation === 'usage.restore') {
        if (after.remainingUses == null || definition.usage.maximum == null) fail('该能力没有次数池')
        after.remainingUses = Math.min(definition.usage.maximum, after.remainingUses + effect.amount!)
      } else if (effect.operation === 'usage.reset') after.remainingUses = definition.usage.maximum
      else if (effect.operation === 'cooldown.clear') after.cooldownUntilRound = null
      else {
        const match = /^round\.(\d+)$/.exec(effect.clockRef ?? '')
        if (!match) fail('cooldown.start 的 clockRef 必须是 round.N')
        after.cooldownUntilRound = Number(match[1])
      }
      after.lastUsedEventId = `event.${input.eventSequence}`
      product.abilityStates[stateKey] = parseTtrpgAbilityRuntimeStateV2(after)
      receipt(effect, before, after)
    } else if (effect.family === 'advancement') {
      const balanceKey = `${effect.targetRef}:${effect.operation}:${effect.advancementKey}`
      const [before, after] = setBalance(product.effectLedger.advancementBalances, balanceKey, effect.amount)
      receipt(effect, before, after)
    } else if (effect.family === 'social') {
      const balanceKey = `${effect.targetRef}:${effect.operation}:${effect.socialKey}`
      const [before, after] = setBalance(product.effectLedger.socialBalances, balanceKey, effect.amount)
      receipt(effect, before, after)
    } else if (effect.operation === 'clock.advance') {
      if (typeof effect.value !== 'number' || !Number.isInteger(effect.value) || effect.value < 1) fail('clock.advance 需要正整数')
      const balanceKey = `${effect.targetRef}:${effect.storyKey}`
      const clock = product.clockCatalog?.find(item => item.clockKey === effect.storyKey)
      if ((product.clockCatalog?.length ?? 0) > 0 && !clock) fail(`clock.advance 引用了未知 Campaign Clock:${effect.storyKey}`)
      const before = product.effectLedger.storyClocks[balanceKey] ?? clock?.initialValue ?? 0
      const after = clock ? Math.min(clock.maximum, before + effect.value) : before + effect.value
      product.effectLedger.storyClocks[balanceKey] = after
      if (clock && after >= clock.maximum) {
        product.effectLedger.storyFacts[`clock-complete:${clock.clockKey}`] = true
      }
      receipt(effect, before, after)
    } else if (effect.operation === 'location.set') {
      if (typeof effect.value !== 'string' || !state.entities[effect.value] || !state.entities[effect.targetRef]) fail('location.set 目标或地点不存在')
      const before = state.entities[effect.targetRef].locationKey
      state.entities[effect.targetRef].locationKey = effect.value
      receipt(effect, before, effect.value)
    } else if (effect.operation === 'clue.discover') {
      if (!product.clueCatalog.some(clue => clue.clueKey === effect.storyKey) || !state.entities[effect.targetRef]) fail('clue.discover 引用无效')
      const before = structuredClone(product.discoveredClues)
      const visibility = plan.audience === 'party' || plan.audience === 'public' ? 'party' as const : 'private' as const
      const existing = product.discoveredClues.find(item => item.clueKey === effect.storyKey)
      if (!existing) product.discoveredClues.push({ clueKey: effect.storyKey, actorKey: effect.targetRef, visibility, eventSequence: input.eventSequence })
      else if (existing.visibility === 'private' && visibility === 'party') existing.visibility = 'party'
      receipt(effect, before, product.discoveredClues)
    } else if (effect.operation === 'quest.set') {
      const quest = product.questProgress.find(item => item.questKey === effect.storyKey)
      if (!quest || !['active', 'completed'].includes(String(effect.value))) fail('quest.set 值或任务无效')
      const before = structuredClone(quest)
      quest.status = effect.value as 'active' | 'completed'
      quest.completedAtSequence = quest.status === 'completed' ? input.eventSequence : null
      receipt(effect, before, quest)
    } else {
      const factKey = `${effect.targetRef}:${effect.operation}:${effect.storyKey}`
      const before = product.effectLedger.storyFacts[factKey] ?? null
      product.effectLedger.storyFacts[factKey] = effect.value
      receipt(effect, before, effect.value)
    }
  }
  for (const [characterKey, progression] of Object.entries(product.characterProgression ?? {})) {
    if (progression.spentCurrency > earnedTtrpgCharacterCurrencyV2(product, characterKey)) {
      fail(`成长惩罚不能追回已经消费的货币:${characterKey}`)
    }
  }
  product.effectLedger.appliedIdempotencyKeys.push(plan.idempotencyKey)
  product.effectLedger.entries.push({
    eventSequence: input.eventSequence, planKey: plan.planKey, degree: plan.degree,
    sourceEventId: plan.sourceEventId, ruleRef: plan.ruleRef, reason: plan.reason,
    audience: plan.audience, idempotencyKey: plan.idempotencyKey, transitions,
  })
  if (product.effectLedger.entries.length > 100_000) fail('效果账本达到上限，需要压缩检查点')
  return { state, transitions }
}
