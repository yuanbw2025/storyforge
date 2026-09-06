import { db } from '../db/schema'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { hashProductRuntimeStateV1, readProductRuntimeState } from '../product/runtime-core'
import type { TextOpenWorldCommandEnvelopeV1, TextOpenWorldEffectDefinitionV1, TextOpenWorldEffectPlanV1, TextOpenWorldFeedbackReceiptV1 } from '../types'
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

const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function fail(message: string): never { throw new Error(`[text-open-world-action-executor] ${message}`) }
function targetFrom(envelope: TextOpenWorldCommandEnvelopeV1): string | null {
  const value = envelope.payload.targetKey
  return typeof value === 'string' ? value : null
}
function newCommandId(): string { return `command.action.${crypto.randomUUID()}` }

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
  const effectKeys = [...new Set([...action.action.costEffectKeys, ...action.action.successEffectKeys])]
  const questTransitions = effectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'transition-quest' }> => effect.operation === 'transition-quest')
  const objectiveEffects = effectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'complete-objective' }> => effect.operation === 'complete-objective')
  const trackingEffects = effectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'track-quest' | 'untrack-quest' }> => effect.operation === 'track-quest' || effect.operation === 'untrack-quest')
  const fastTravelEffects = effectKeys.map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
    .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'fast-travel' }> => effect.operation === 'fast-travel')
  if ([questTransitions.length > 0, objectiveEffects.length > 0, trackingEffects.length > 0, fastTravelEffects.length > 0].filter(Boolean).length > 1) fail('同一Action不能混合任务迁移、Objective、追踪或快速旅行状态')
  const authorization: TextOpenWorldEffectPlanV1['authorization'] = questTransitions.length
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
          : null
  const catalog = createTextOpenWorldEffectCatalogV1(projection.runtimePackage)
  const plan = await catalog.plan({ effectKeys, claimKey: `claim.${envelope.commandId}`, state: projection.state, authorization })
  const { receipt } = await catalog.apply({ plan, state: projection.state })
  await commitTextOpenWorldOutcomeBatchV1({
    sessionId: envelope.sessionId,
    commandId: envelope.commandId,
    ruleset: projection.ruleset,
    randomRequests: [],
    plan,
    receipt,
    outcome: 'success',
    reason: null,
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
  source?: TextOpenWorldCommandEnvelopeV1['source']
  confirmed?: boolean
  commandId?: string
  requestedAt?: number
}

async function executeTextOpenWorldActionAsV1(
  input: ExecuteTextOpenWorldActionInputV1,
  actorKey: 'player' | 'system',
): Promise<TextOpenWorldFeedbackReceiptV1> {
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId < 1) fail('sessionId无效')
  const commandId = input.commandId ?? newCommandId()
  if (!COMMAND_ID.test(commandId)) fail('commandId无效')
  const targetKey = input.targetKey ?? null
  const source = input.source ?? 'system-action'

  const prior = await getTextOpenWorldCommandStatusV1({ sessionId: input.sessionId, commandId })
  if (prior.status === 'committed') {
    if (prior.envelope.actionKey !== input.actionKey
      || targetFrom(prior.envelope) !== targetKey
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
  if (actorKey === 'system' && resolved.entry.action.category !== 'quest-action') fail('系统入口只能执行quest-action')
  if (resolved.entry.action.category === 'start-combat') {
    const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
    const startEffects = resolved.entry.action.successEffectKeys
      .map(effectKey => modules.actions.effects.find(effect => effect.key === effectKey)!)
      .filter(effect => effect.operation === 'start-combat')
    if (startEffects.length !== 1) fail('start-combat Action必须且只能绑定一个开始战斗Effect')
    const encounterKey = (startEffects[0] as { payload: { encounterKey: string } }).payload.encounterKey
    if (targetKey !== encounterKey) fail('start-combat Action目标与Effect遭遇不一致')
    await ensureTextOpenWorldCombatRetryCheckpointV1({ sessionId: input.sessionId, encounterKey, throughSequence: state.lastSequence })
  }
  const envelope: TextOpenWorldCommandEnvelopeV1 = {
    schema: 'storyforge.text-open-world.command', version: 1, commandId,
    sessionId: input.sessionId, actorKey, actionKey: input.actionKey,
    payload: targetKey == null ? {} : { targetKey }, baseSequence: state.lastSequence,
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
      }, 'system')
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
    }, 'system')
    if (feedback.phase !== 'terminal' || feedback.status !== 'succeeded') fail(`Stage系统结算未成功:${next.actionKey}:${next.targetKey}`)
  }
  fail('单次玩家行动触发的任务系统结算超过32步')
}

export async function executeTextOpenWorldActionV1(input: ExecuteTextOpenWorldActionInputV1): Promise<TextOpenWorldFeedbackReceiptV1> {
  const feedback = await executeTextOpenWorldActionAsV1(input, 'player')
  if (feedback.phase === 'terminal' && feedback.status === 'succeeded' && feedback.commandId) {
    await settleReadyQuestSystemActionsV1(input.sessionId, feedback.commandId)
  }
  return feedback
}

/** Runs a governed Stage completion/quest lifecycle action owned by deterministic code. */
export async function executeTextOpenWorldSystemQuestActionV1(input: ExecuteTextOpenWorldActionInputV1): Promise<TextOpenWorldFeedbackReceiptV1> {
  return executeTextOpenWorldActionAsV1(input, 'system')
}
