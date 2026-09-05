import { db } from '../db/schema'
import { readProductRuntimeState } from '../product/runtime-core'
import type { TextOpenWorldFeedbackReceiptV1 } from '../types'
import { commitTextOpenWorldOutcomeBatchV1 } from './events'
import { resolveTextOpenWorldRandomEvidenceV1 } from './event-contract'
import { createTextOpenWorldEffectCatalogV1 } from './effect-dsl'
import { readTextOpenWorldFeedbackV1 } from './feedback'
import { createTextOpenWorldRewardCatalogV1 } from './rewards'
import { parseTextOpenWorldSessionProjectionV1, deriveTextOpenWorldContextsV1 } from './session-projection'
import { assertTextOpenWorldVNextProjectionBindingV1, verifyTextOpenWorldVNextSessionBindingV1 } from './session-binding'

function fail(message: string): never { throw new Error(`[text-open-world-reward-executor] ${message}`) }

/**
 * Settles a reward for a command already accepted by its owning quest/combat/exploration system.
 * The source system owns eligibility; this coordinator owns deterministic drop evidence,
 * the atomic EffectPlan and the terminal event batch.
 */
export async function executeTextOpenWorldPendingRewardV1(input: {
  sessionId: number
  commandId: string
  rewardKey: string
  sourceKind: 'quest' | 'combat' | 'exploration' | 'crafting' | 'system'
  sourceInstanceKey: string
}): Promise<TextOpenWorldFeedbackReceiptV1> {
  const session = await db.productRuntimeSessions.get(input.sessionId)
  if (!session || session.kind !== 'text-open-world') fail('文字开放世界Session不存在')
  const binding = await verifyTextOpenWorldVNextSessionBindingV1(session)
  const runtime = await readProductRuntimeState(input.sessionId)
  const projection = parseTextOpenWorldSessionProjectionV1(runtime.textOpenWorld)
  assertTextOpenWorldVNextProjectionBindingV1(projection, binding)
  if (projection.protocol.pendingCommandId !== input.commandId || projection.protocol.pendingCommandSequence == null) {
    const feedback = await readTextOpenWorldFeedbackV1({ sessionId: input.sessionId, commandId: input.commandId })
    if (feedback.phase !== 'terminal') fail('奖励命令不是当前待结算命令')
    const event = (await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).toArray())
      .find(candidate => candidate.type === 'text-open-world.effects.applied' && JSON.parse(candidate.payloadJson)?.commandId === input.commandId)
    const authorization = event ? JSON.parse(event.payloadJson)?.plan?.authorization : null
    if (authorization?.kind !== 'reward' || authorization.rewardKey !== input.rewardKey || authorization.sourceInstanceKey !== input.sourceInstanceKey) {
      fail('同一commandId对应另一份奖励请求')
    }
    return feedback
  }
  const rewards = createTextOpenWorldRewardCatalogV1(projection.runtimePackage)
  const reward = rewards.get(input.rewardKey) ?? fail(`RewardContract不存在:${input.rewardKey}`)
  if (reward.sourceKind !== input.sourceKind) fail('RewardContract来源类型不匹配')
  const conditionResults = Object.fromEntries(Object.entries(deriveTextOpenWorldContextsV1(projection).action.conditionResults)
    .map(([key, result]) => [key, result.satisfied]))
  const preparation = rewards.prepare({ rewardKey: input.rewardKey, sourceInstanceKey: input.sourceInstanceKey, conditionResults })
  const evidence = await Promise.all(preparation.randomRequests.map((request, drawIndex) => resolveTextOpenWorldRandomEvidenceV1({
    seed: session.seed, commandId: input.commandId, commandSequence: projection.protocol.pendingCommandSequence!, drawIndex, request,
  })))
  const resolved = await rewards.resolve({ preparation, evidence, state: projection.state, conditionResults })
  const { receipt } = await createTextOpenWorldEffectCatalogV1(projection.runtimePackage).apply({ plan: resolved.effectPlan, state: projection.state })
  await commitTextOpenWorldOutcomeBatchV1({
    sessionId: input.sessionId, commandId: input.commandId, ruleset: projection.ruleset,
    randomRequests: preparation.randomRequests, plan: resolved.effectPlan, receipt,
    outcome: 'success', reason: null, degradation: null,
  })
  return readTextOpenWorldFeedbackV1({ sessionId: input.sessionId, commandId: input.commandId })
}
