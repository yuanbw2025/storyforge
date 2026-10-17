import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { loadTtrpgOpenMemoryReadStateV1 } from '../../src/lib/ttrpg/open-memory-read-state'
import { replayTtrpgOpenReadEventsV1 } from '../../src/lib/ttrpg/open-read-replay'
import { recordTtrpgOpenNarrativeMemoryV1 } from '../../src/lib/ttrpg/runtime-commands'
import * as core from '../../src/lib/product/runtime-core'
import * as source from '../../src/lib/product-production/preview-source'

describe('R-TTRPGOPEN9 exact-input bounded pure replay reuse', { timeout: 30000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('reuses only pure computation while returning independent state and checking the frozen source and current owner again', async () => {
    const f = await readyOpenTtrpgSessionV1('Pure replay read', p => { p.ttrpg!.campaign.runtimePolicy.enabled = true })
    const input = { scope: f.scope, sessionId: f.sessionId, reader: { kind: 'actor' as const, actorKey: 'hero' } }
    const replay = vi.spyOn(core, 'replayProductRuntimeEvents'), verify = vi.spyOn(source, 'verifyProductRuntimeSessionSourceV1')
    const first = await loadTtrpgOpenMemoryReadStateV1(input), expected = structuredClone(first.state)
    first.state.entities.hero.name = 'MUTATED-CALLER-STATE'
    const second = await loadTtrpgOpenMemoryReadStateV1(input)
    expect(second.state).toEqual(expected); expect(second.state).not.toBe(first.state)
    expect(replay).toHaveBeenCalledTimes(1); expect(verify).toHaveBeenCalledTimes(2)
    await recordTtrpgOpenNarrativeMemoryV1({ ...await openEnvelopeV1(f.sessionId, 'read.replay.note'), viewerKey: OPEN_HUMAN_VIEWER,
      draft: { revisionKey: 'pure-read.new-event', observerKey: 'hero', reliability: 'belief', audience: 'private', knownBy: ['hero'], summary: '这仍是个人推测。', fromEventSequence: 1, toEventSequence: expected.lastSequence } })
    const before = replay.mock.calls.length, third = await loadTtrpgOpenMemoryReadStateV1(input)
    expect(replay.mock.calls.length).toBe(before + 1); expect(third.entries).toHaveLength(1)
    await expect(second.assertCurrent()).rejects.toThrow(/变化/)
  })
  it('never treats a supplied hash, changed event bytes, a mutated event object or a different initial state as the same input', async () => {
    const f = await readyOpenTtrpgSessionV1('Exact event bytes', p => { p.ttrpg!.campaign.runtimePolicy.enabled = true })
    const session = (await db.productRuntimeSessions.get(f.sessionId))!, events = await core.readSessionEvents(session), replay = vi.spyOn(core, 'replayProductRuntimeEvents')
    const expected = replayTtrpgOpenReadEventsV1(session.initialStateJson, events)
    const before = replay.mock.calls.length
    expect(replayTtrpgOpenReadEventsV1(session.initialStateJson, structuredClone(events))).toEqual(expected)
    expect(replay.mock.calls.length).toBe(before)
    // Even metadata ignored by the pure reducer invalidates reuse. Mutating the caller's rows cannot mutate the saved input.
    events[0].createdAt += 1
    expect(replayTtrpgOpenReadEventsV1(session.initialStateJson, events)).toEqual(expected)
    expect(replay.mock.calls.length).toBe(before + 1)
    const corrupt = structuredClone(events); corrupt[0].payloadJson = '{}'
    expect(() => replayTtrpgOpenReadEventsV1(session.initialStateJson, corrupt)).toThrow()
    expect(replay.mock.calls.length).toBe(before + 2)
    expect(replayTtrpgOpenReadEventsV1(session.initialStateJson, await core.readSessionEvents(session))).toEqual(expected)
    expect(replay.mock.calls.length).toBe(before + 3)
    expect(replayTtrpgOpenReadEventsV1(session.initialStateJson + ' ', await core.readSessionEvents(session))).toEqual(expected)
    expect(replay.mock.calls.length).toBe(before + 4)
  })
})
