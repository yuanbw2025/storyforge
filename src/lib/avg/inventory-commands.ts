import { db } from '../db/schema'
import type { ProductRuntimeEvent } from '../types'
import { applyProductRuntimeEvent, hashStateJson, normalizeCommandId, parseEventPayload, parseProductRuntimeState, readProductRuntimeState, readSessionEvents, replayProductRuntimeEvents } from '../product/runtime-core'
import { avgKey } from './protocol-validation'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type { AvgInventoryPlanV1 } from './inventory-contract'

/** Durable CAS command, with the same deterministic reducer used for replay.
 * Callers provide identity, never effect bytes, quantity deltas or responses. */
export async function commitAvgInventoryActionV1(input: {
  sessionId: number; actionKey: string; target: AvgInventoryPlanV1['actions'][number]['target']; commandId: string; baseSequence: number; baseStateHash: string
}): Promise<ProductRuntimeEvent> {
  const commandId = normalizeCommandId(input.commandId), actionKey = avgKey(input.actionKey, 'inventory actionKey')
  if (!Number.isSafeInteger(input.baseSequence) || input.baseSequence < 0 || !/^[a-f0-9]{64}$/.test(input.baseStateHash)) throw new Error('[avg-inventory] 命令基线无效')
  // This read also validates the initial rule snapshot against the real source.
  const preview = await readProductRuntimeState(input.sessionId), previewHash = await hashStateJson(JSON.stringify(preview))
  const payloadJson = canonicalProductProductionJsonV2({ actionKey, target: input.target })
  return db.transaction('rw', db.productRuntimeSessions, db.productRuntimeEvents, async () => {
    const session = await db.productRuntimeSessions.get(input.sessionId)
    if (!session || session.kind !== 'avg' || session.productBuildId == null && session.productReleaseId == null) throw new Error('[avg-inventory] AVG 可玩会话不存在')
    const events = await readSessionEvents(session), prior = events.find(e => e.commandId === commandId)
    if (prior) {
      if (prior.type !== 'avg.inventory.action.committed' || prior.baseSequence !== input.baseSequence || prior.baseStateHash !== input.baseStateHash
        || canonicalProductProductionJsonV2(parseEventPayload(prior)) !== payloadJson) throw new Error('[avg-inventory] commandId 已被不同命令使用')
      return prior
    }
    if (session.status !== 'active') throw new Error('[avg-inventory] 会话未激活')
    const state = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)
    if (state.lastSequence !== input.baseSequence || preview.lastSequence !== state.lastSequence || previewHash !== input.baseStateHash
      || canonicalProductProductionJsonV2(state) !== canonicalProductProductionJsonV2(preview)) throw new Error('[avg-inventory] 状态已变化，请刷新后重试')
    const event: ProductRuntimeEvent = { projectId: session.projectId, worldGroupId: session.worldGroupId ?? null,
      sessionId: session.id!, sequence: state.lastSequence + 1, type: 'avg.inventory.action.committed', actorKey: 'player', targetKey: actionKey,
      commandId, baseSequence: input.baseSequence, baseStateHash: input.baseStateHash, payloadJson, createdAt: Date.now() }
    applyProductRuntimeEvent(state, event)
    event.id = await db.productRuntimeEvents.add(event) as number
    await db.productRuntimeSessions.update(session.id!, { updatedAt: event.createdAt })
    return event
  })
}
