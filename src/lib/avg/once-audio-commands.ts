import { db } from '../db/schema'
import type { ProductRuntimeEvent } from '../types'
import { applyProductRuntimeEvent, hashStateJson, normalizeCommandId, parseEventPayload, parseProductRuntimeState, readProductRuntimeState, readSessionEvents, replayProductRuntimeEvents } from '../product/runtime-core'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { nextAvgOnceAudioGenerationV1, type AVG_ONCE_AUDIO_OUTCOMES_V1 } from './once-audio-runtime'

interface AudioCommandBase { sessionId: number; cueKey: string; visit: number; commandId: string; baseSequence: number; baseStateHash: string }
export type AvgOnceAudioActionV1 = { type: 'start'; retry: boolean } | { type: 'observe'; generation: number; outcome: typeof AVG_ONCE_AUDIO_OUTCOMES_V1[number]; reason: string; playedMs: number }
export type AvgOnceAudioCommandV1 = AudioCommandBase & AvgOnceAudioActionV1

/** Transport evidence only. No media/author review, model call, or rule effect. */
export async function commitAvgOnceAudioCommandV1(input: AvgOnceAudioCommandV1): Promise<ProductRuntimeEvent> {
  const commandId = normalizeCommandId(input.commandId)
  if (!Number.isSafeInteger(input.baseSequence) || input.baseSequence < 0 || !/^[a-f0-9]{64}$/.test(input.baseStateHash)) throw new Error('[avg-audio] 命令基线无效')
  const preview = await readProductRuntimeState(input.sessionId), previewHash = await hashStateJson(JSON.stringify(preview))
  const type = input.type === 'start' ? 'avg.audio.once.started' as const : 'avg.audio.once.observed' as const
  const payload = { cueKey: input.cueKey, visit: input.visit,
    generation: input.type === 'start' ? nextAvgOnceAudioGenerationV1(preview) : input.generation,
    ...(input.type === 'start' ? { retry: input.retry } : { outcome: input.outcome, reason: input.reason, playedMs: input.playedMs }) }
  return db.transaction('rw', db.productRuntimeSessions, db.productRuntimeEvents, async () => {
    const session = await db.productRuntimeSessions.get(input.sessionId)
    if (!session || session.kind !== 'avg' || session.productBuildId == null && session.productReleaseId == null) throw new Error('[avg-audio] AVG 可玩会话不存在')
    const events = await readSessionEvents(session), prior = events.find(e => e.commandId === commandId)
    if (prior) {
      const old = parseEventPayload(prior)
      if (prior.type !== type || prior.baseSequence !== input.baseSequence || prior.baseStateHash !== input.baseStateHash
        || old.cueKey !== input.cueKey || old.visit !== input.visit
        || input.type === 'start' && old.retry !== input.retry
        || input.type === 'observe' && (old.generation !== input.generation || old.outcome !== input.outcome || old.reason !== input.reason || old.playedMs !== input.playedMs)) throw new Error('[avg-audio] commandId 已被不同命令使用')
      return prior
    }
    if (session.status !== 'active') throw new Error('[avg-audio] 会话未激活')
    const state = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)
    if (state.lastSequence !== input.baseSequence || previewHash !== input.baseStateHash || canonicalProductProductionJsonV2(state) !== canonicalProductProductionJsonV2(preview)) throw new Error('[avg-audio] 状态已变化，请刷新后重试')
    const event: ProductRuntimeEvent = { projectId: session.projectId, worldGroupId: session.worldGroupId ?? null,
      sessionId: session.id!, sequence: state.lastSequence + 1, type, actorKey: 'player', targetKey: input.cueKey,
      commandId, baseSequence: input.baseSequence, baseStateHash: input.baseStateHash, payloadJson: JSON.stringify(payload), createdAt: Date.now() }
    applyProductRuntimeEvent(state, event)
    event.id = await db.productRuntimeEvents.add(event) as number
    await db.productRuntimeSessions.update(session.id!, { updatedAt: event.createdAt })
    return event
  })
}
