import { db } from '../db/schema'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { hashProductRuntimeStateV1, readProductRuntimeState } from '../product/runtime-core'
import type { TextOpenWorldCombatTransitionIntentV1, TextOpenWorldCommandEnvelopeV1, TextOpenWorldDirectorTriggerV1, TextOpenWorldEffectDefinitionV1, TextOpenWorldEffectPlanV1, TextOpenWorldFeedbackReceiptV1, TextOpenWorldRandomEvidenceV1, TextOpenWorldRandomRequestV1 } from '../types'
import { createTextOpenWorldActionRegistryV1 } from './action-registry'
import { ensureTextOpenWorldCombatRetryCheckpointV1 } from './checkpoints'
import { commitTextOpenWorldCommandV1, getTextOpenWorldCommandStatusV1 } from './commands'
import { createTextOpenWorldEffectCatalogV1 } from './effect-dsl'
import { commitTextOpenWorldOutcomeBatchV1 } from './events'
import { createTextOpenWorldPreflightFeedbackV1, readTextOpenWorldFeedbackV1 } from './feedback'
import { parseTextOpenWorldModulesV1 } from './modules'
import {
  assertTextOpenWorldVNextProjectionBindingV1,
  verifyTextOpenWorldVNextSessionBindingV1,
} from './session-binding'
import { createTextOpenWorldQuestTransitionCatalogV1 } from './quest-state-machine'
import { createTextOpenWorldObjectiveCatalogV1 } from './objective-state'
import { createTextOpenWorldQuestTrackingCatalogV1 } from './quest-tracking'
import { executeTextOpenWorldPendingRewardV1 } from './reward-executor'
import { deriveTextOpenWorldContextsV1, parseTextOpenWorldSessionProjectionV1 } from './session-projection'
import { createTextOpenWorldFastTravelCatalogV1 } from './fast-travel'
import { resolveTextOpenWorldRandomEvidenceV1 } from './event-contract'
import { createTextOpenWorldWeatherCatalogV1 } from './weather'
import { createTextOpenWorldActorScheduleCatalogV1 } from './actors'
import { createTextOpenWorldCrimeCatalogV1 } from './crime'
import { createTextOpenWorldCombatStateMachineV1 } from './combat-state-machine'
import { createTextOpenWorldCombatActionCatalogV1 } from './combat-actions'
import { createTextOpenWorldCraftingCatalogV1 } from './crafting'
import { createTextOpenWorldEconomyCatalogV1 } from './economy'
import { createTextOpenWorldDirectorCatalogV1 } from './director'

const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function fail(message: string): never { throw new Error(`[text-open-world-action-executor] ${message}`) }
function targetFrom(envelope: TextOpenWorldCommandEnvelopeV1): string | null {
  const value = envelope.payload.targetKey
  return typeof value === 'string' ? value : null
}
function newCommandId(): string { return `command.action.${crypto.randomUUID()}` }
function combatTransitionIntentFrom(envelope: TextOpenWorldCommandEnvelopeV1): TextOpenWorldCombatTransitionIntentV1 {
  const value = envelope.payload.combatTransitionIntent
  const allowed: TextOpenWorldCombatTransitionIntentV1[] = [
    'begin-round', 'begin-turn', 'complete-turn', 'advance-turn', 'finish-victory', 'finish-defeat', 'finish-escaped',
  ]
  if (typeof value !== 'string' || !allowed.includes(value as TextOpenWorldCombatTransitionIntentV1)) fail('战斗阶段命令缺少合法transition intent')
  return value as TextOpenWorldCombatTransitionIntentV1
}
function actionQuantityFrom(envelope: TextOpenWorldCommandEnvelopeV1): number {
  const value = envelope.payload.quantity
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail('命令缺少合法quantity')
  return Number(value)
}
function itemKeyFrom(envelope: TextOpenWorldCommandEnvelopeV1): string {
  const value = envelope.payload.itemKey
  if (typeof value !== 'string') fail('交易命令缺少合法itemKey')
  return value
}
function directorTriggerFrom(envelope: TextOpenWorldCommandEnvelopeV1): TextOpenWorldDirectorTriggerV1 {
  const value = envelope.payload.directorTrigger
  const allowed: TextOpenWorldDirectorTriggerV1[] = ['arrival', 'explore', 'talk', 'rest', 'quest-complete', 'time-batch', 'activity']
  if (typeof value !== 'string' || !allowed.includes(value as TextOpenWorldDirectorTriggerV1)) fail('Director命令缺少合法触发类型')
  return value as TextOpenWorldDirectorTriggerV1
}

async function settleAcceptedCommand(envelope: TextOpenWorldCommandEnvelopeV1): Promise<TextOpenWorldFeedbackReceiptV1> {
  const state = await readProductRuntimeState(envelope.sessionId)
  const projection = parseTextOpenWorldSessionProjectionV1(state.textOpenWorld)
  if (projection.protocol.pendingCommandId !== envelope.commandId) {
    return readTextOpenWorldFeedbackV1({ sessionId: envelope.sessionId, commandId: envelope.commandId })
  }
  const action = createTextOpenWorldActionRegistryV1(projection.runtimePackage).get(envelope.actionKey)
    ?? fail(`Release不存在Action:${envelope.actionKey}`)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  if (action.action.category === 'claim-reward') {
    const instanceKey = targetFrom(envelope) ?? fail('领取奖励Action缺少任务实例目标')
    const instance = projection.state.quests.instancesByKey[instanceKey] ?? fail('领取奖励任务实例不存在')
    const definition = modules.quests.quests.find(item => item.key === instance.definitionKey) ?? fail('领取奖励任务定义不存在')
    if (definition.claimActionKey !== action.action.key || !definition.rewardContractKey) fail('领取奖励Action与任务定义不一致')
    return executeTextOpenWorldPendingRewardV1({
      sessionId: envelope.sessionId,
      commandId: envelope.commandId,
      rewardKey: definition.rewardContractKey,
      sourceKind: 'quest',
      sourceInstanceKey: instance.instanceKey,
    })
  }
  if (action.action.category === 'combat-reward-action') {
    const encounterKey = targetFrom(envelope) ?? fail('战斗奖励Action缺少遭遇目标')
    const combat = projection.state.combat
    if (!combat || !('version' in combat) || combat.status !== 'victory' || combat.phase !== 'terminal'
      || combat.encounterKey !== encounterKey) fail('战斗奖励只能在对应胜利终态结算')
    const encounter = modules.combat.encounters.find(item => item.key === encounterKey) ?? fail('战斗奖励遭遇不存在')
    const rewardKey = encounter.rewardContractKey ?? fail('胜利遭遇缺少RewardContract')
    return executeTextOpenWorldPendingRewardV1({
      sessionId: envelope.sessionId,
      commandId: envelope.commandId,
      rewardKey,
      sourceKind: 'combat',
      sourceInstanceKey: combat.instanceKey,
    })
  }
  const crimeResolution = ['steal', 'deceive', 'crime'].includes(action.action.category)
    ? createTextOpenWorldCrimeCatalogV1(projection.runtimePackage, modules).prepare({
        actionKey: action.action.key,
        targetActorKey: targetFrom(envelope) ?? fail('犯罪Action缺少Actor目标'),
        state: projection.state,
        conditionResults: deriveTextOpenWorldContextsV1(projection).action.conditionResults,
      })
    : null
  let effectKeys = crimeResolution?.authorization.effectKeys
    ?? [...new Set([...action.action.costEffectKeys, ...action.action.successEffectKeys])]
  const questTransitions = effectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'transition-quest' }> => effect.operation === 'transition-quest')
  const objectiveEffects = effectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'complete-objective' }> => effect.operation === 'complete-objective')
  const trackingEffects = effectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'track-quest' | 'untrack-quest' }> => effect.operation === 'track-quest' || effect.operation === 'untrack-quest')
  const fastTravelEffects = effectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'fast-travel' }> => effect.operation === 'fast-travel')
  const weatherEffects = effectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'settle-weather' }> => effect.operation === 'settle-weather')
  const actorScheduleEffects = effectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'settle-actor-schedules' }> => effect.operation === 'settle-actor-schedules')
  const combatSettlementEffects = effectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'settle-combat-state' }> => effect.operation === 'settle-combat-state')
  const combatActionEffects = effectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'perform-combat-action' }> => effect.operation === 'perform-combat-action')
  const craftingEffects = effectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'perform-crafting' }> => effect.operation === 'perform-crafting')
  const transactionEffects = effectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'perform-transaction' }> => effect.operation === 'perform-transaction')
  const directorEffects = effectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'settle-director' }> => effect.operation === 'settle-director')
  if ([questTransitions.length > 0, objectiveEffects.length > 0, trackingEffects.length > 0, fastTravelEffects.length > 0, weatherEffects.length > 0, actorScheduleEffects.length > 0, combatSettlementEffects.length > 0, combatActionEffects.length > 0, craftingEffects.length > 0, transactionEffects.length > 0, directorEffects.length > 0].filter(Boolean).length > 1) fail('同一Action不能混合任务迁移、Objective、追踪、快速旅行、天气、角色日程、战斗阶段、战斗行动、制作、交易或Director状态')
  let randomRequests: TextOpenWorldRandomRequestV1[] = []
  let randomEvidence: TextOpenWorldRandomEvidenceV1[] = []
  const conditionResults = Object.fromEntries(Object.entries(deriveTextOpenWorldContextsV1(projection).action.conditionResults)
    .map(([key, result]) => [key, result.satisfied]))
  const combatActionCatalog = combatActionEffects.length === 1
    ? createTextOpenWorldCombatActionCatalogV1(projection.runtimePackage, modules)
    : null
  const combatActionInput = combatActionCatalog ? {
    state: projection.state,
    actionKey: action.action.key,
    targetKey: targetFrom(envelope),
    actorKey: envelope.actorKey === 'system' ? 'system' as const : 'player' as const,
    conditionResults,
  } : null
  const directorCatalog = directorEffects.length === 1
    ? createTextOpenWorldDirectorCatalogV1(projection.runtimePackage, modules)
    : null
  const directorInput = directorCatalog ? {
    state: projection.state,
    trigger: directorTriggerFrom(envelope),
    conditionResults,
  } : null
  if (weatherEffects.length === 1 || combatActionInput || directorInput) {
    const session = await db.productRuntimeSessions.get(envelope.sessionId)
    if (!session || session.kind !== 'text-open-world') fail('随机结算Session不存在')
    const commandSequence = projection.protocol.pendingCommandSequence ?? fail('随机结算命令缺少序号')
    randomRequests = weatherEffects.length === 1
      ? createTextOpenWorldWeatherCatalogV1(projection.runtimePackage, modules).prepare({ state: projection.state })
      : combatActionInput
        ? combatActionCatalog!.randomRequestsFor(combatActionInput)
        : directorCatalog!.randomRequestsFor(directorInput!)
    randomEvidence = await Promise.all(randomRequests.map((request, drawIndex) => resolveTextOpenWorldRandomEvidenceV1({
      seed: session.seed,
      commandId: envelope.commandId,
      commandSequence,
      drawIndex,
      request,
    })))
  }
  const authorization: TextOpenWorldEffectPlanV1['authorization'] = crimeResolution?.authorization
    ?? (questTransitions.length
      ? createTextOpenWorldQuestTransitionCatalogV1(projection.runtimePackage).prepare({
        instanceKey: targetFrom(envelope) ?? fail('任务状态Action缺少实例目标'),
        state: projection.state,
        transitions: questTransitions.map(effect => ({ toStatus: effect.payload.status, stageKey: effect.payload.stageKey })),
      })
    : objectiveEffects.length === 1
      ? createTextOpenWorldObjectiveCatalogV1(projection.runtimePackage).prepare({
          instanceKey: targetFrom(envelope) ?? fail('Objective Action缺少任务实例目标'),
          objectiveKey: objectiveEffects[0].payload.objectiveKey,
          state: projection.state,
        })
      : trackingEffects.length === 1
        ? createTextOpenWorldQuestTrackingCatalogV1(projection.runtimePackage).prepare({
            instanceKey: targetFrom(envelope) ?? fail('任务追踪Action缺少任务实例目标'),
            state: projection.state,
            operation: trackingEffects[0].operation === 'track-quest' ? 'track' : 'untrack',
            slot: trackingEffects[0].payload.slot,
          })
        : fastTravelEffects.length === 1
          ? createTextOpenWorldFastTravelCatalogV1(projection.runtimePackage, modules).prepare({
              state: projection.state,
              effect: fastTravelEffects[0],
              destinationLocationKey: targetFrom(envelope) ?? fail('快速旅行Action缺少地点目标'),
            })
          : weatherEffects.length === 1
            ? createTextOpenWorldWeatherCatalogV1(projection.runtimePackage, modules).resolve({ state: projection.state, evidence: randomEvidence })
            : actorScheduleEffects.length === 1
              ? createTextOpenWorldActorScheduleCatalogV1(projection.runtimePackage, modules).prepare(projection.state)
              : combatSettlementEffects.length === 1
                ? createTextOpenWorldCombatStateMachineV1(projection.runtimePackage, modules).prepare({
                    state: projection.state,
                    intent: combatTransitionIntentFrom(envelope),
                  })
                : combatActionEffects.length === 1
                  ? combatActionCatalog!.prepare({ ...combatActionInput!, evidence: randomEvidence })
                : craftingEffects.length === 1
                  ? createTextOpenWorldCraftingCatalogV1(projection.runtimePackage, modules).prepare({
                      state: projection.state,
                      recipeKey: craftingEffects[0].payload.recipeKey,
                      quantity: actionQuantityFrom(envelope),
                      locationKey: projection.state.map.currentLocationKey,
                    })
                    : transactionEffects.length === 1
                      ? createTextOpenWorldEconomyCatalogV1(projection.runtimePackage, modules).prepare({
                          state: projection.state,
                          transactionKind: transactionEffects[0].payload.kind,
                          vendorKey: transactionEffects[0].payload.vendorKey,
                          itemKey: itemKeyFrom(envelope),
                          quantity: actionQuantityFrom(envelope),
                        })
                      : directorEffects.length === 1
                        ? directorCatalog!.resolve({ ...directorInput!, evidence: randomEvidence })
              : null)
  if (authorization?.kind === 'director-settlement') {
    effectKeys = [...effectKeys, ...authorization.selection.effectKeys]
  }
  const catalog = createTextOpenWorldEffectCatalogV1(projection.runtimePackage)
  const plan = await catalog.plan({ effectKeys, claimKey: `claim.${envelope.commandId}`, state: projection.state, authorization })
  const { receipt } = await catalog.apply({ plan, state: projection.state })
  await commitTextOpenWorldOutcomeBatchV1({
    sessionId: envelope.sessionId,
    commandId: envelope.commandId,
    ruleset: projection.ruleset,
    randomRequests,
    plan,
    receipt,
    outcome: crimeResolution?.outcome ?? 'success',
    reason: crimeResolution?.failureReason ?? null,
    degradation: null,
  })
  return readTextOpenWorldFeedbackV1({ sessionId: envelope.sessionId, commandId: envelope.commandId })
}

/**
 * First playable vNext boundary: preflight, idempotent command commit,
 * deterministic Effect batch and player Feedback are one recoverable flow.
 * Product systems added in G2 extend the Action/Effect definitions consumed
 * here; UI code never writes Session state directly.
 */
type ExecuteTextOpenWorldActionInputV1 = {
  sessionId: number
  actionKey: string
  targetKey?: string | null
  quantity?: number
  itemKey?: string
  source?: TextOpenWorldCommandEnvelopeV1['source']
  confirmed?: boolean
  commandId?: string
  requestedAt?: number
}
type ExecuteTextOpenWorldActionInternalInputV1 = ExecuteTextOpenWorldActionInputV1 & {
  combatTransitionIntent?: TextOpenWorldCombatTransitionIntentV1
  directorTrigger?: TextOpenWorldDirectorTriggerV1
}

async function executeTextOpenWorldActionAsV1(
  input: ExecuteTextOpenWorldActionInternalInputV1,
  actorKey: 'player' | 'system',
  systemCategory?: 'quest-action' | 'weather-action' | 'actor-schedule-action' | 'actor-state-action' | 'combat-state-action' | 'combat-enemy-skill' | 'combat-reward-action' | 'director-action',
): Promise<TextOpenWorldFeedbackReceiptV1> {
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId < 1) fail('sessionId无效')
  const commandId = input.commandId ?? newCommandId()
  if (!COMMAND_ID.test(commandId)) fail('commandId无效')
  const targetKey = input.targetKey ?? null
  const source = input.source ?? 'system-action'
  const hasCombatTransitionIntent = input.combatTransitionIntent != null
  if (hasCombatTransitionIntent !== (systemCategory === 'combat-state-action')) fail('战斗阶段intent只能由战斗系统Action提交')
  if (hasCombatTransitionIntent) {
    const allowed: TextOpenWorldCombatTransitionIntentV1[] = [
      'begin-round', 'begin-turn', 'complete-turn', 'advance-turn', 'finish-victory', 'finish-defeat', 'finish-escaped',
    ]
    if (!allowed.includes(input.combatTransitionIntent!)) fail('战斗阶段命令缺少合法transition intent')
  }
  const hasDirectorTrigger = input.directorTrigger != null
  if (hasDirectorTrigger !== (systemCategory === 'director-action')) fail('Director触发只能由Director系统Action提交')
  const commandPayload: Record<string, unknown> = {
    ...(targetKey == null ? {} : { targetKey }),
    ...(input.quantity == null ? {} : { quantity: input.quantity }),
    ...(input.itemKey == null ? {} : { itemKey: input.itemKey }),
    ...(input.combatTransitionIntent == null ? {} : { combatTransitionIntent: input.combatTransitionIntent }),
    ...(input.directorTrigger == null ? {} : { directorTrigger: input.directorTrigger }),
  }

  const prior = await getTextOpenWorldCommandStatusV1({ sessionId: input.sessionId, commandId })
  if (prior.status === 'committed') {
    if (prior.envelope.actionKey !== input.actionKey
      || canonicalProductProductionJsonV2(prior.envelope.payload) !== canonicalProductProductionJsonV2(commandPayload)
      || prior.envelope.source !== source
      || prior.envelope.actorKey !== actorKey) fail('相同commandId对应另一项Action请求')
    const feedback = await readTextOpenWorldFeedbackV1({ sessionId: input.sessionId, commandId })
    return feedback.phase === 'terminal' ? feedback : settleAcceptedCommand(prior.envelope)
  }

  const session = await db.productRuntimeSessions.get(input.sessionId)
  if (!session || session.kind !== 'text-open-world') fail('文字开放世界Session不存在')
  const binding = await verifyTextOpenWorldVNextSessionBindingV1(session)
  const state = await readProductRuntimeState(input.sessionId)
  const projection = parseTextOpenWorldSessionProjectionV1(state.textOpenWorld)
  assertTextOpenWorldVNextProjectionBindingV1(projection, binding)
  const registry = createTextOpenWorldActionRegistryV1(projection.runtimePackage)
  const actionContext = deriveTextOpenWorldContextsV1(projection).action
  actionContext.actorKey = actorKey
  if (actorKey === 'system') {
    actionContext.validTargetKeysByScope.actor = parseTextOpenWorldModulesV1(projection.runtimePackage).actors.actors
      .filter(actor => projection.state.actors[actor.key]?.alive && projection.state.actors[actor.key]?.present)
      .map(actor => actor.key)
  }
  const availability = registry.project(actionContext)
    .find(item => item.action.key === input.actionKey)
    ?? fail(`Release不存在Action:${input.actionKey}`)
  if (!availability.available || (availability.confirmationRequired && !input.confirmed)) {
    return createTextOpenWorldPreflightFeedbackV1({
      sessionId: input.sessionId,
      targetKey,
      baseSequence: state.lastSequence,
      availability,
      confirmed: input.confirmed === true,
    })
  }
  const resolved = registry.resolve({ actionKey: input.actionKey, targetKey, context: actionContext })
  if (actorKey === 'system' && resolved.entry.action.category !== systemCategory) fail('系统入口只能执行指定类别的受治理系统Action')
  if (resolved.entry.action.category === 'craft') {
    if (!Number.isSafeInteger(input.quantity) || Number(input.quantity) < 1) fail('制作Action必须提交正整数quantity')
    if (input.itemKey != null) fail('制作Action不能提交交易itemKey')
    createTextOpenWorldCraftingCatalogV1(projection.runtimePackage).prepare({
      state: projection.state,
      recipeKey: targetKey ?? fail('制作Action缺少配方目标'),
      quantity: Number(input.quantity),
      locationKey: projection.state.map.currentLocationKey,
    })
  } else if (resolved.entry.action.category === 'buy' || resolved.entry.action.category === 'sell') {
    if (!Number.isSafeInteger(input.quantity) || Number(input.quantity) < 1 || typeof input.itemKey !== 'string') fail('交易Action必须提交itemKey和正整数quantity')
    createTextOpenWorldEconomyCatalogV1(projection.runtimePackage).prepare({
      state: projection.state,
      transactionKind: resolved.entry.action.category,
      vendorKey: targetKey ?? fail('交易Action缺少商店目标'),
      itemKey: input.itemKey,
      quantity: Number(input.quantity),
    })
  } else if (input.quantity != null || input.itemKey != null) fail('非制作或交易Action不能提交quantity/itemKey')
  if (resolved.entry.action.category === 'start-combat') {
    const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
    const startEffects = resolved.entry.action.successEffectKeys
      .map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
      .filter(effect => effect.operation === 'start-combat' || effect.operation === 'initialize-combat')
    if (startEffects.length !== 1) fail('start-combat Action必须且只能绑定一个开始战斗Effect')
    const encounterKey = (startEffects[0] as { payload: { encounterKey: string } }).payload.encounterKey
    if (targetKey !== encounterKey) fail('start-combat Action目标与Effect遭遇不一致')
    await ensureTextOpenWorldCombatRetryCheckpointV1({ sessionId: input.sessionId, encounterKey, throughSequence: state.lastSequence })
  }
  const envelope: TextOpenWorldCommandEnvelopeV1 = {
    schema: 'storyforge.text-open-world.command', version: 1, commandId,
    sessionId: input.sessionId, actorKey, actionKey: input.actionKey,
    payload: commandPayload, baseSequence: state.lastSequence,
    baseStateHash: await hashProductRuntimeStateV1(state), source,
    requestedAt: input.requestedAt ?? Date.now(),
  }
  await commitTextOpenWorldCommandV1(envelope)
  return settleAcceptedCommand(envelope)
}

async function settleReadyQuestSystemActionsV1(sessionId: number, causeCommandId: string): Promise<void> {
  for (let index = 0; index < 32; index += 1) {
    const runtime = await readProductRuntimeState(sessionId)
    const projection = parseTextOpenWorldSessionProjectionV1(runtime.textOpenWorld)
    const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
    const completionActionKeys = new Set(modules.quests.stages.map(stage => stage.completionActionKey).filter((key): key is string => key != null))
    const expirationActionKeys = new Set(modules.actions.actions.filter(action => action.category === 'quest-action'
      && action.successEffectKeys.some(effectKey => {
        const effect = modules.actions.effects.find(candidate => candidate.key === effectKey)
        return effect?.operation === 'transition-quest' && effect.payload.status === 'expired'
      })).map(action => action.key))
    const settlementActionKeys = new Set([...completionActionKeys, ...expirationActionKeys])
    if (projection.protocol.pendingCommandId) {
      const pendingActionKey = projection.protocol.pendingActionKey
      const pendingTargetKey = projection.protocol.pendingTargetKey
      if (projection.protocol.pendingActorKey !== 'system' || !pendingActionKey || !pendingTargetKey || !settlementActionKeys.has(pendingActionKey)) {
        fail('任务系统结算器发现不属于自身的待结算命令')
      }
      const feedback = await executeTextOpenWorldActionAsV1({
        sessionId, actionKey: pendingActionKey, targetKey: pendingTargetKey,
        commandId: projection.protocol.pendingCommandId, source: 'system-action',
      }, 'system', 'quest-action')
      if (feedback.phase !== 'terminal' || feedback.status !== 'succeeded') fail(`Stage待结算命令未成功:${pendingActionKey}:${pendingTargetKey}`)
      continue
    }
    const context = deriveTextOpenWorldContextsV1(projection).action
    context.actorKey = 'system'
    const next = createTextOpenWorldActionRegistryV1(projection.runtimePackage).project(context)
      .filter(item => item.available && item.action.category === 'quest-action' && settlementActionKeys.has(item.action.key))
      .flatMap(item => item.validTargetKeys.map(targetKey => ({ actionKey: item.action.key, targetKey, priority: completionActionKeys.has(item.action.key) ? 0 : 1 })))
      .sort((left, right) => left.priority - right.priority || left.actionKey.localeCompare(right.actionKey) || left.targetKey.localeCompare(right.targetKey))[0]
    if (!next) return
    const commandHash = await hashProductProductionValueV2({ causeCommandId, index, ...next })
    const feedback = await executeTextOpenWorldActionAsV1({
      sessionId, actionKey: next.actionKey, targetKey: next.targetKey,
      commandId: `command.system-quest.${commandHash}`, source: 'system-action',
    }, 'system', 'quest-action')
    if (feedback.phase !== 'terminal' || feedback.status !== 'succeeded') fail(`Stage系统结算未成功:${next.actionKey}:${next.targetKey}`)
  }
  fail('单次玩家行动触发的任务系统结算超过32步')
}

async function settleWeatherForCurrentEpochV1(sessionId: number): Promise<void> {
  const runtime = await readProductRuntimeState(sessionId)
  const projection = parseTextOpenWorldSessionProjectionV1(runtime.textOpenWorld)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const timeWeather = modules['time-weather']
  if (timeWeather.version < 2 || modules.actions.version < 5) return
  const currentEpoch = Math.floor(projection.state.time.worldMinute / timeWeather.weatherUpdateIntervalMinutes)
  if (currentEpoch <= projection.state.time.lastWeatherSettlementEpoch) return
  const weatherAction = modules.actions.actions.find(action => action.category === 'weather-action') ?? fail('新版时间天气模块缺少天气结算Action')
  const feedback = await executeTextOpenWorldActionAsV1({
    sessionId,
    actionKey: weatherAction.key,
    commandId: `command.system-weather.epoch.${currentEpoch}`,
    source: 'system-action',
  }, 'system', 'weather-action')
  if (feedback.phase !== 'terminal' || feedback.status !== 'succeeded') fail(`天气系统结算未成功:${currentEpoch}`)
}

async function settleActorSchedulesForCurrentPeriodV1(sessionId: number): Promise<void> {
  const runtime = await readProductRuntimeState(sessionId)
  const projection = parseTextOpenWorldSessionProjectionV1(runtime.textOpenWorld)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  if (modules.actions.version < 6) return
  const actorSchedules = createTextOpenWorldActorScheduleCatalogV1(projection.runtimePackage, modules)
  const currentPeriod = actorSchedules.currentPeriod(projection.state.time.worldMinute)
  if (currentPeriod.settlementWorldMinute <= projection.state.time.lastActorScheduleSettlementWorldMinute) return
  const action = modules.actions.actions.find(item => item.category === 'actor-schedule-action') ?? fail('新版角色模块缺少角色日程结算Action')
  const feedback = await executeTextOpenWorldActionAsV1({
    sessionId,
    actionKey: action.key,
    commandId: `command.system-actor-schedule.period.${currentPeriod.settlementWorldMinute}`,
    source: 'system-action',
  }, 'system', 'actor-schedule-action')
  if (feedback.phase !== 'terminal' || feedback.status !== 'succeeded') fail(`角色日程系统结算未成功:${currentPeriod.settlementWorldMinute}`)
}

function directorTriggerForActionCategory(category: string): TextOpenWorldDirectorTriggerV1 {
  if (['move', 'travel', 'fast-travel'].includes(category)) return 'arrival'
  if (['observe', 'investigate', 'read'].includes(category)) return 'explore'
  if (category === 'talk') return 'talk'
  if (category === 'rest') return 'rest'
  if (category === 'objective-action') return 'quest-complete'
  return 'activity'
}

async function settleDirectorAfterActionV1(sessionId: number, causeCommandId: string, causeActionKey: string): Promise<void> {
  const runtime = await readProductRuntimeState(sessionId)
  const projection = parseTextOpenWorldSessionProjectionV1(runtime.textOpenWorld)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  if (modules.actions.version < 14 || modules.director.sourceVersion < 2 || !modules.director.rules.systemActionKey) return
  const action = modules.actions.actions.find(item => item.key === causeActionKey) ?? fail(`Director触发来源Action不存在:${causeActionKey}`)
  const trigger = directorTriggerForActionCategory(action.category)
  const conditionResults = Object.fromEntries(Object.entries(deriveTextOpenWorldContextsV1(projection).action.conditionResults)
    .map(([key, result]) => [key, result.satisfied]))
  const director = createTextOpenWorldDirectorCatalogV1(projection.runtimePackage, modules)
  if (!director.shouldSettle({ state: projection.state, trigger, conditionResults })) return
  const commandHash = await hashProductProductionValueV2({
    causeCommandId, causeActionKey, trigger, worldMinute: projection.state.time.worldMinute,
    drawCount: projection.state.director.drawCount,
    regionSettlement: projection.state.director.lastRegionSettlementWorldMinuteByRegionKey,
  })
  const feedback = await executeTextOpenWorldActionAsV1({
    sessionId,
    actionKey: modules.director.rules.systemActionKey,
    directorTrigger: trigger,
    commandId: `command.system-director.${commandHash}`,
    source: 'system-action',
  }, 'system', 'director-action')
  if (feedback.phase !== 'terminal' || feedback.status !== 'succeeded') fail(`Director系统结算未成功:${trigger}`)
}

/**
 * A Director command can already be durable while its Effect batch is still
 * pending (for example after a browser/process interruption). Recover that
 * exact committed envelope before accepting another player action so the
 * draw is neither lost nor repeated with a newly derived trigger.
 */
async function recoverPendingDirectorSettlementV1(sessionId: number): Promise<void> {
  const runtime = await readProductRuntimeState(sessionId)
  const projection = parseTextOpenWorldSessionProjectionV1(runtime.textOpenWorld)
  const commandId = projection.protocol.pendingCommandId
  if (!commandId) return
  const actionKey = projection.protocol.pendingActionKey
  if (!actionKey) fail('待结算命令缺少Action')
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const action = modules.actions.actions.find(item => item.key === actionKey) ?? fail(`待结算Action不存在:${actionKey}`)
  if (action.category !== 'director-action') return
  if (projection.protocol.pendingActorKey !== 'system' || !projection.protocol.pendingDirectorTrigger) {
    fail('Director待结算命令缺少系统Actor或触发类型')
  }
  const status = await getTextOpenWorldCommandStatusV1({ sessionId, commandId })
  if (status.status !== 'committed') fail(`Director待结算命令不存在:${commandId}`)
  const feedback = await settleAcceptedCommand(status.envelope)
  if (feedback.phase !== 'terminal' || feedback.status !== 'succeeded') fail(`Director待结算命令恢复失败:${commandId}`)
}

async function settleCombatSystemTransitionsV1(sessionId: number): Promise<void> {
  for (let index = 0; index < 32; index += 1) {
    const runtime = await readProductRuntimeState(sessionId)
    const projection = parseTextOpenWorldSessionProjectionV1(runtime.textOpenWorld)
    const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
    if (modules.actions.version < 9 || modules.combat.sourceVersion === 1) return
    const stateMachine = createTextOpenWorldCombatStateMachineV1(projection.runtimePackage, modules)
    const combat = projection.state.combat
    if (!combat) return
    if (!('version' in combat)) fail('新版战斗阶段缺少Combat v2投影')
    if (combat.status === 'victory' && modules.actions.version >= 11 && modules.combat.sourceVersion === 3) {
      const encounter = modules.combat.encounters.find(item => item.key === combat.encounterKey) ?? fail('胜利战斗遭遇不存在')
      const rewardKey = encounter.rewardContractKey ?? fail('胜利战斗缺少RewardContract')
      const claimKey = `claim.reward.${rewardKey}.${combat.instanceKey}`
      if (projection.state.appliedClaimKeys.includes(claimKey)) return
      const rewardAction = modules.actions.actions.find(item => item.category === 'combat-reward-action') ?? fail('新版战斗缺少胜利奖励Action')
      const commandHash = await hashProductProductionValueV2({ instanceKey: combat.instanceKey, encounterKey: combat.encounterKey, rewardKey })
      const feedback = await executeTextOpenWorldActionAsV1({
        sessionId, actionKey: rewardAction.key, targetKey: combat.encounterKey,
        commandId: `command.system-combat-reward.${commandHash}`, source: 'system-action',
      }, 'system', 'combat-reward-action')
      if (feedback.phase !== 'terminal' || feedback.status !== 'succeeded') fail(`战斗胜利奖励未成功:${rewardKey}`)
      continue
    }
    if (combat.status !== 'active') return
    const intent = stateMachine.nextSystemIntent(projection.state)
    if (!intent) {
      if (modules.actions.version < 10 || combat.status !== 'active' || combat.phase !== 'actor-turn' || combat.activeCombatantKey === 'player') return
      const next = createTextOpenWorldCombatActionCatalogV1(projection.runtimePackage, modules).nextEnemyAction(projection.state)
        ?? fail('敌人回合缺少冻结策略Action')
      const commandHash = await hashProductProductionValueV2({
        instanceKey: combat.instanceKey, phase: combat.phase, round: combat.round,
        turnIndex: combat.turnIndex, activeCombatantKey: combat.activeCombatantKey, actionKey: next.actionKey,
      })
      const feedback = await executeTextOpenWorldActionAsV1({
        sessionId, actionKey: next.actionKey, targetKey: next.targetKey,
        commandId: `command.system-combat-action.${commandHash}`, source: 'system-action',
      }, 'system', 'combat-enemy-skill')
      if (feedback.phase !== 'terminal' || feedback.status !== 'succeeded') fail(`敌人战斗Action未成功:${next.actionKey}`)
      continue
    }
    const action = modules.actions.actions.find(item => item.category === 'combat-state-action') ?? fail('新版战斗缺少阶段结算Action')
    const commandHash = await hashProductProductionValueV2({
      instanceKey: combat.instanceKey,
      phase: combat.phase,
      round: combat.round,
      turnIndex: combat.turnIndex,
      intent,
    })
    const feedback = await executeTextOpenWorldActionAsV1({
      sessionId,
      actionKey: action.key,
      targetKey: combat.encounterKey,
      combatTransitionIntent: intent,
      commandId: `command.system-combat.${commandHash}`,
      source: 'system-action',
    }, 'system', 'combat-state-action')
    if (feedback.phase !== 'terminal' || feedback.status !== 'succeeded') fail(`战斗阶段系统结算未成功:${intent}`)
  }
  fail('单次行动触发的战斗阶段结算超过32步')
}

export async function executeTextOpenWorldActionV1(input: ExecuteTextOpenWorldActionInputV1): Promise<TextOpenWorldFeedbackReceiptV1> {
  await recoverPendingDirectorSettlementV1(input.sessionId)
  await settleCombatSystemTransitionsV1(input.sessionId)
  await settleWeatherForCurrentEpochV1(input.sessionId)
  await settleActorSchedulesForCurrentPeriodV1(input.sessionId)
  const feedback = await executeTextOpenWorldActionAsV1(input, 'player')
  if (feedback.phase === 'terminal' && feedback.status === 'succeeded' && feedback.commandId) {
    await settleCombatSystemTransitionsV1(input.sessionId)
    await settleWeatherForCurrentEpochV1(input.sessionId)
    await settleActorSchedulesForCurrentPeriodV1(input.sessionId)
    await settleReadyQuestSystemActionsV1(input.sessionId, feedback.commandId)
    await settleDirectorAfterActionV1(input.sessionId, feedback.commandId, input.actionKey)
  }
  return feedback
}

/** Runs a governed Stage completion/quest lifecycle action owned by deterministic code. */
export async function executeTextOpenWorldSystemQuestActionV1(input: ExecuteTextOpenWorldActionInputV1): Promise<TextOpenWorldFeedbackReceiptV1> {
  return executeTextOpenWorldActionAsV1(input, 'system', 'quest-action')
}

/** Runs a frozen story, regional-event or transient-resolution Actor outcome. */
export async function executeTextOpenWorldSystemActorStateActionV1(input: ExecuteTextOpenWorldActionInputV1): Promise<TextOpenWorldFeedbackReceiptV1> {
  return executeTextOpenWorldActionAsV1(input, 'system', 'actor-state-action')
}

/** Runs one authorized combat phase transition through the shared ProductRuntime event stream. */
export async function executeTextOpenWorldSystemCombatTransitionV1(
  input: ExecuteTextOpenWorldActionInputV1 & { combatTransitionIntent: TextOpenWorldCombatTransitionIntentV1 },
): Promise<TextOpenWorldFeedbackReceiptV1> {
  return executeTextOpenWorldActionAsV1(input, 'system', 'combat-state-action')
}
