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
  it('replays only an exact appended suffix, keeps independent checkpoints and still rejects gaps or changed prefix bytes', async () => {
    const f = await readyOpenTtrpgSessionV1('Incremental exact replay', p => { p.ttrpg!.campaign.runtimePolicy.enabled = true })
    const session = (await db.productRuntimeSessions.get(f.sessionId))!
    const firstEvents = await core.readSessionEvents(session)
    await recordTtrpgOpenNarrativeMemoryV1({ ...await openEnvelopeV1(f.sessionId, 'incremental.replay.note'), viewerKey: OPEN_HUMAN_VIEWER,
      draft: { revisionKey: 'incremental.new-event', observerKey: 'hero', reliability: 'belief', audience: 'private', knownBy: ['hero'], summary: '这仍是个人推测。', fromEventSequence: 1, toEventSequence: firstEvents.at(-1)!.sequence } })
    const allEvents = await core.readSessionEvents(session)
    expect(allEvents.length).toBeGreaterThan(firstEvents.length)
    const expected = core.replayProductRuntimeEvents(core.parseProductRuntimeState(session.initialStateJson), allEvents)
    const prefix = replayTtrpgOpenReadEventsV1(session.initialStateJson, firstEvents)
    const prefixSequence = prefix.lastSequence
    prefix.entities.hero.name = 'CALLER-MUTATED-CHECKPOINT'
    const replay = vi.spyOn(core, 'replayProductRuntimeEvents')
    const actual = replayTtrpgOpenReadEventsV1(session.initialStateJson, allEvents)
    expect(actual).toEqual(expected)
    expect(replay).toHaveBeenCalledTimes(1)
    expect(replay.mock.calls[0][0].lastSequence).toBe(prefixSequence)
    expect(replay.mock.calls[0][1]).toEqual(allEvents.slice(firstEvents.length))
    const changed = structuredClone(allEvents); changed[0].createdAt += 1
    replay.mockClear()
    expect(replayTtrpgOpenReadEventsV1(session.initialStateJson, changed)).toEqual(expected)
    expect(replay.mock.calls[0][0].lastSequence).toBe(JSON.parse(session.initialStateJson).lastSequence)
    expect(replay.mock.calls[0][1]).toEqual(changed)
    const gap = { ...changed.at(-1)!, sequence: actual.lastSequence + 2 }
    await expect(async () => replayTtrpgOpenReadEventsV1(session.initialStateJson, [...changed, gap])).rejects.toThrow(/序号不连续/)
    // A failed suffix cannot contaminate a later full proof or a caller's state.
    expect(replayTtrpgOpenReadEventsV1(session.initialStateJson, allEvents)).toEqual(expected)
  })

  it('retains a long branch input and result above32MiB while keeping returned state independent', () => {
    const initial = JSON.stringify({ version: 1, clock: 0, lastSequence: 0, memories: [], narratives: [],
      entities: { large: { entityKey: 'large', kind: 'location', sourceId: null, name: 'Large replay input', locationKey: null,
        lifecycleStatus: 'active', attributes: { note: 'x'.repeat(9 * 1024 * 1024) } } } })
    expect(initial.length * 4).toBeGreaterThan(32 * 1024 * 1024)
    expect(initial.length * 4).toBeLessThan(64 * 1024 * 1024)
    const replay = vi.spyOn(core, 'replayProductRuntimeEvents')
    const first = replayTtrpgOpenReadEventsV1(initial, [])
    first.entities.large.name = 'CALLER-MUTATED-LARGE-STATE'
    const second = replayTtrpgOpenReadEventsV1(initial, [])
    expect(replay).toHaveBeenCalledTimes(1)
    expect(second).not.toBe(first)
    expect(second.entities.large.name).toBe('Large replay input')
    expect(second.entities.large.attributes.note).toHaveLength(9 * 1024 * 1024)
  })
  it('falls back to full strict replay when the exact input and result exceed64MiB', () => {
    const initial = JSON.stringify({ version: 1, clock: 0, lastSequence: 0, memories: [], narratives: [],
      entities: { large: { entityKey: 'large', kind: 'location', sourceId: null, name: 'Beyond retention bound', locationKey: null,
        lifecycleStatus: 'active', attributes: { note: 'y'.repeat(17 * 1024 * 1024) } } } })
    expect(initial.length * 4).toBeGreaterThan(64 * 1024 * 1024)
    const replay = vi.spyOn(core, 'replayProductRuntimeEvents')
    const first = replayTtrpgOpenReadEventsV1(initial, []), second = replayTtrpgOpenReadEventsV1(initial, [])
    expect(replay).toHaveBeenCalledTimes(2)
    expect(second).not.toBe(first)
    expect(second.entities.large.attributes.note).toHaveLength(17 * 1024 * 1024)
  })

})
