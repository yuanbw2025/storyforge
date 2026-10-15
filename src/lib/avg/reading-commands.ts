import { db } from '../db/schema'
import type { ProductRuntimeEvent } from '../types'
import { applyProductRuntimeEvent, hashStateJson, normalizeCommandId, parseEventPayload, parseProductRuntimeState, readProductRuntimeState, readSessionEvents, replayProductRuntimeEvents } from '../product/runtime-core'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { nextAvgVoiceGenerationV1 } from './reading-runtime'
import type { AVG_VOICE_OUTCOMES_V1 } from './reading-contract'

interface ReadingCommandBase { sessionId: number; lineKey: string; visit: number; commandId: string; baseSequence: number; baseStateHash: string }
export type AvgVoiceCommandV1 = ReadingCommandBase & ({ type: 'start' } | { type: 'observe'; generation: string; outcome: typeof AVG_VOICE_OUTCOMES_V1[number]; reason: string; playedMs: number })
/** A playback observation is neither an artistic review nor proof of hearing.
 * It only admits the actual transport outcome to the native reading barrier. */
export async function commitAvgVoiceCommandV1(input: AvgVoiceCommandV1): Promise<ProductRuntimeEvent> {
  const commandId = normalizeCommandId(input.commandId)
  if (!Number.isSafeInteger(input.baseSequence) || input.baseSequence < 0 || !/^[a-f0-9]{64}$/.test(input.baseStateHash)) throw new Error('[avg-reading] 命令基线无效')
  const preview = await readProductRuntimeState(input.sessionId), previewHash = await hashStateJson(JSON.stringify(preview))
  const reading = preview.avgReading, binding = reading?.plan.voices.find(v => v.lineKey === input.lineKey)
  if (!reading || !binding) throw new Error('[avg-reading] 当前没有已绑定的配音')
  const payload = { lineKey: input.lineKey, visit: input.visit, assetKey: binding.assetKey,
    generation: input.type === 'start' ? nextAvgVoiceGenerationV1(reading) : input.generation,
    ...(input.type === 'observe' ? { outcome: input.outcome, reason: input.reason, playedMs: input.playedMs } : {}) }
  const type = input.type === 'start' ? 'avg.reading.voice.started' as const : 'avg.reading.voice.observed' as const
  return db.transaction('rw', db.productRuntimeSessions, db.productRuntimeEvents, async () => {
    const session = await db.productRuntimeSessions.get(input.sessionId)
    if (!session || session.kind !== 'avg' || session.productBuildId == null && session.productReleaseId == null) throw new Error('[avg-reading] AVG 可玩会话不存在')
    const events = await readSessionEvents(session), prior = events.find(e => e.commandId === commandId)
    if (prior) {
      const old = parseEventPayload(prior)
      if (prior.type !== type || prior.baseSequence !== input.baseSequence || prior.baseStateHash !== input.baseStateHash
        || old.lineKey !== input.lineKey || old.visit !== input.visit
        || input.type === 'observe' && (old.generation !== input.generation || old.outcome !== input.outcome || old.reason !== input.reason || old.playedMs !== input.playedMs)) throw new Error('[avg-reading] commandId 已被不同命令使用')
      return prior
    }
    if (session.status !== 'active') throw new Error('[avg-reading] 会话未激活')
    const state = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)
    if (state.lastSequence !== input.baseSequence || previewHash !== input.baseStateHash || canonicalProductProductionJsonV2(state) !== canonicalProductProductionJsonV2(preview)) throw new Error('[avg-reading] 状态已变化，请刷新后重试')
    const event: ProductRuntimeEvent = { projectId: session.projectId, worldGroupId: session.worldGroupId ?? null,
      sessionId: session.id!, sequence: state.lastSequence + 1, type, actorKey: 'player', targetKey: input.lineKey,
      commandId, baseSequence: input.baseSequence, baseStateHash: input.baseStateHash, payloadJson: JSON.stringify(payload), createdAt: Date.now() }
    applyProductRuntimeEvent(state, event)
    event.id = await db.productRuntimeEvents.add(event) as number
    await db.productRuntimeSessions.update(session.id!, { updatedAt: event.createdAt })
    return event
  })
}
