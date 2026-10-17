/** Bounded pure replay reuse. Actual source/events/participants and authority are checked by each owner read. */
import type { ProductRuntimeEvent } from '../types'
import { parseProductRuntimeState, replayProductRuntimeEvents } from '../product/runtime-core'

const MAX_REPLAY_BYTES = 32 * 1024 * 1024
type State = ReturnType<typeof replayProductRuntimeEvents>
let previous: { initial: string; events: ProductRuntimeEvent[]; state: State } | undefined

function size(events: readonly ProductRuntimeEvent[]) {
  let bytes = 0
  for (const event of events) {
    if (Object.getPrototypeOf(event) !== Object.prototype) return Infinity
    for (const key of Reflect.ownKeys(event)) {
      if (typeof key !== 'string') return Infinity
      const descriptor = Object.getOwnPropertyDescriptor(event, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) return Infinity
      const value: unknown = descriptor.value
      if (value !== null && !['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return Infinity
      bytes += key.length * 2 + (typeof value === 'string' ? value.length * 2 : 8)
      if (bytes > MAX_REPLAY_BYTES) return Infinity
    }
  }
  return bytes
}
function equal(a: readonly ProductRuntimeEvent[], b: readonly ProductRuntimeEvent[]) {
  return a.length === b.length && a.every((event, index) => {
    const keys = Object.keys(event), other = b[index]
    return keys.length === Object.keys(other).length && keys.every(key => Object.prototype.hasOwnProperty.call(other, key)
      && Object.is(event[key as keyof ProductRuntimeEvent], other[key as keyof ProductRuntimeEvent]))
  })
}
/** Not keyed by a self-asserted hash, physical session id or receipt. No access decision, capability or callback is retained. */
export function replayTtrpgOpenReadEventsV1(initial: string, events: readonly ProductRuntimeEvent[]): State {
  const bytes = initial.length * 2 + size(events)
  if (bytes <= MAX_REPLAY_BYTES && previous?.initial === initial && equal(events, previous.events)) return structuredClone(previous.state)
  previous = undefined
  const state = replayProductRuntimeEvents(parseProductRuntimeState(initial), events)
  if (bytes + JSON.stringify(state).length * 2 <= MAX_REPLAY_BYTES) previous = { initial, events: events.map(event => ({ ...event })), state: structuredClone(state) }
  return state
}
