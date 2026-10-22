import { describe, expect, it } from 'vitest'
import type { ProductRuntimeEvent } from '../../src/lib/types'
import { ttrpgOpenMemoryEventDigestV1 } from '../../src/lib/ttrpg/open-memory-event-digest'
import { ttrpgOpenMemoryPrefixRootsV2 } from '../../src/lib/ttrpg/open-memory-prefix-proof'
import { parseTtrpgOpenMemoryDraftV1 } from '../../src/lib/ttrpg/open-memory-contract'

function event(sequence: number, sessionId = 11, text = `source event ${sequence}`): ProductRuntimeEvent {
  return { sequence, sessionId, type: 'ttrpg.open.table-message.posted', payloadJson: JSON.stringify({ envelope: { sessionId }, text }) } as ProductRuntimeEvent
}
describe('R-TTRPGOPEN8 compact complete portable source prefixes', () => {
  it('covers a real digest sequence beyond 1000 events, retains its early prefix, and detects a changed middle event', async () => {
    const events = await Promise.all(Array.from({ length: 1003 }, (_, i) => ttrpgOpenMemoryEventDigestV1(event(i + 1), 'session.prefix')))
    const roots = await ttrpgOpenMemoryPrefixRootsV2('session.prefix', events)
    expect(roots.size).toBe(1003); expect(roots.get(1003)).toMatch(/^[a-f0-9]{64}$/)
    expect((await ttrpgOpenMemoryPrefixRootsV2('session.prefix', events.slice(0, 20))).get(20)).toBe(roots.get(20))
    events[500] = await ttrpgOpenMemoryEventDigestV1(event(501, 11, 'changed original source'), 'session.prefix')
    const changed = await ttrpgOpenMemoryPrefixRootsV2('session.prefix', events)
    expect(changed.get(500)).toBe(roots.get(500)); expect(changed.get(1003)).not.toBe(roots.get(1003))
  })
  it('preserves portable roots under the sole registered session locator remap and rejects missing/reordered/foreign source evidence', async () => {
    const first = await Promise.all([1, 2, 3].map(n => ttrpgOpenMemoryEventDigestV1(event(n), 'session.prefix')))
    const remapped = await Promise.all([1, 2, 3].map(n => ttrpgOpenMemoryEventDigestV1(event(n, 99), 'session.prefix')))
    expect(first[0].payloadHash).not.toBe(remapped[0].payloadHash)
    expect(await ttrpgOpenMemoryPrefixRootsV2('session.prefix', first)).toEqual(await ttrpgOpenMemoryPrefixRootsV2('session.prefix', remapped))
    for (const bad of [first.slice(1), [first[0], first[2], first[1]], [{ ...first[0], portablePayloadHash: undefined }], [{ ...first[0], sourceRef: { sessionKey: 'other', sequence: 1 } }]]) {
      await expect(ttrpgOpenMemoryPrefixRootsV2('session.prefix', bad)).rejects.toThrow(/完整有序/)
    }
  })
  it('keeps the old complete manual window contract and its original 1000-event boundary', () => {
    const draft = { revisionKey: 'manual.legacy', observerKey: 'hero', reliability: 'observed', audience: 'private', knownBy: ['hero'], summary: '手写原记录', fromEventSequence: 1, toEventSequence: 1000 }
    expect(parseTtrpgOpenMemoryDraftV1(draft).toEventSequence).toBe(1000)
    expect(() => parseTtrpgOpenMemoryDraftV1({ ...draft, toEventSequence: 1001 })).toThrow(/1000/)
  })
})
