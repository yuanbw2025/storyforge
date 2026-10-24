import {db} from '../db/schema'
import type {ProductRuntimeEvent, ProductRuntimeState} from '../types'
import {parseProductRuntimeState, readProductRuntimeState, readSessionEvents, replayProductRuntimeEvents} from '../product/runtime-core'

const maximumRetainedBytes = 16 * 1024 * 1024

/** Reuse a deterministic reduction only after comparing the complete original
 * input and every event in its prefix, including payload and scope metadata.
 * No session ID, sequence or stored runtime head stands in for those bytes.
 * The one retained prefix is process-local, bounded and isolated from callers. */
export function createChatRuntimeReplayV1(maximumBytes = maximumRetainedBytes) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > maximumRetainedBytes) throw new Error('Invalid chat replay cache bound')
  let previous: {initialJson: string; events: string[]; stateJson: string} | undefined
  return (initialJson: string, events: readonly ProductRuntimeEvent[], throughSequence = Number.MAX_SAFE_INTEGER) => {
    const ordered = events.filter(event => event.sequence <= throughSequence).sort((a, b) => a.sequence - b.sequence)
    const rows = ordered.map(event => JSON.stringify(event))
    const prefix = previous && previous.initialJson === initialJson && rows.length >= previous.events.length
      && previous.events.every((row, index) => rows[index] === row) ? previous : undefined
    // This JSON is our private canonical result, never a persisted cache or
    // caller-supplied state. Parsing makes a fresh copy; new suffixes still go
    // through the shared reducer's own input and event validation.
    const proven = prefix ? JSON.parse(prefix.stateJson) as ProductRuntimeState : undefined
    if (prefix && rows.length === prefix.events.length) return proven!
    const state = replayProductRuntimeEvents(proven ?? parseProductRuntimeState(initialJson),
      prefix ? ordered.slice(prefix.events.length) : ordered)
    const stateJson = JSON.stringify(state)
    const bytes = (initialJson.length + stateJson.length + rows.reduce((sum, row) => sum + row.length, 0)) * 2
    previous = bytes <= maximumBytes ? {initialJson, events: rows, stateJson} : undefined
    return state
  }
}

export const replayChatRuntimeEventsV1 = createChatRuntimeReplayV1()

/** Historical producer verification still reads and scope-checks the complete
 * authoritative event collection before any exact-prefix reuse. */
export async function readChatRuntimeStateAtSequenceV1(sessionId: number, throughSequence: number) {
  const session = await db.productRuntimeSessions.get(sessionId)
  if (!session) throw new Error('产品运行会话不存在。')
  if (session.kind !== 'character-interaction') return readProductRuntimeState(sessionId, throughSequence)
  const events = await readSessionEvents(session, throughSequence)
  return replayChatRuntimeEventsV1(session.initialStateJson, events, throughSequence)
}
