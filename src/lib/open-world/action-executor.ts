import { db } from '../db/schema'
import { hashProductRuntimeStateV1, readProductRuntimeState } from '../product/runtime-core'
import type { TextOpenWorldCommandEnvelopeV1, TextOpenWorldFeedbackReceiptV1 } from '../types'
import { createTextOpenWorldActionRegistryV1 } from './action-registry'
import { commitTextOpenWorldCommandV1, getTextOpenWorldCommandStatusV1 } from './commands'
import { createTextOpenWorldEffectCatalogV1 } from './effect-dsl'
import { commitTextOpenWorldOutcomeBatchV1 } from './events'
import { createTextOpenWorldPreflightFeedbackV1, readTextOpenWorldFeedbackV1 } from './feedback'
import {
  assertTextOpenWorldVNextProjectionBindingV1,
  verifyTextOpenWorldVNextSessionBindingV1,
} from './session-binding'
import { deriveTextOpenWorldContextsV1, parseTextOpenWorldSessionProjectionV1 } from './session-projection'

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
  const effectKeys = [...new Set([...action.action.costEffectKeys, ...action.action.successEffectKeys])]
  const catalog = createTextOpenWorldEffectCatalogV1(projection.runtimePackage)
  const plan = await catalog.plan({ effectKeys, claimKey: `claim.${envelope.commandId}`, state: projection.state })
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
export async function executeTextOpenWorldActionV1(input: {
  sessionId: number
  actionKey: string
  targetKey?: string | null
  source?: TextOpenWorldCommandEnvelopeV1['source']
  confirmed?: boolean
  commandId?: string
  requestedAt?: number
}): Promise<TextOpenWorldFeedbackReceiptV1> {
  if (!Number.isSafeInteger(input.sessionId) || input.sessionId < 1) fail('sessionId无效')
  const commandId = input.commandId ?? newCommandId()
  if (!COMMAND_ID.test(commandId)) fail('commandId无效')
  const targetKey = input.targetKey ?? null
  const source = input.source ?? 'system-action'

  const prior = await getTextOpenWorldCommandStatusV1({ sessionId: input.sessionId, commandId })
  if (prior.status === 'committed') {
    if (prior.envelope.actionKey !== input.actionKey
      || targetFrom(prior.envelope) !== targetKey
      || prior.envelope.source !== source) fail('相同commandId对应另一项Action请求')
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
  const availability = registry.project(deriveTextOpenWorldContextsV1(projection).action)
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
  registry.resolve({ actionKey: input.actionKey, targetKey, context: deriveTextOpenWorldContextsV1(projection).action })
  const envelope: TextOpenWorldCommandEnvelopeV1 = {
    schema: 'storyforge.text-open-world.command', version: 1, commandId,
    sessionId: input.sessionId, actorKey: 'player', actionKey: input.actionKey,
    payload: targetKey == null ? {} : { targetKey }, baseSequence: state.lastSequence,
    baseStateHash: await hashProductRuntimeStateV1(state), source,
    requestedAt: input.requestedAt ?? Date.now(),
  }
  await commitTextOpenWorldCommandV1(envelope)
  return settleAcceptedCommand(envelope)
}
