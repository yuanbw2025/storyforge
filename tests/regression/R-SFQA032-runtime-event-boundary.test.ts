import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { moveAiTownPlayerV1 } from '../../src/lib/ai-town/runtime-api'
import {
  appendProductRuntimeEvent, readProductRuntimeState, readProductRuntimeStateVersion, readSessionEvents,
} from '../../src/lib/product/runtime-core'
import { PRODUCT_RUNTIME_EVENT_TYPES, type ProductRuntimeEventType } from '../../src/lib/types'
import { seedAiTownRuntimeFixture } from '../helpers/ai-town-runtime'

const neutralTypes: readonly ProductRuntimeEventType[] = [
  'time.advanced', 'entity.upserted', 'entity.patched', 'entity.removed', 'memory.recorded', 'narrative.recorded',
]

describe('SFQA032 runtime event append boundary', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('cannot use generic Town movement to skip the real command destination check', async () => {
    const { session } = await seedAiTownRuntimeFixture()
    const sessionId = session.id!
    const start = await readProductRuntimeStateVersion(sessionId)
    const command = { sessionId, baseSequence: start.sequence, baseStateHash: start.stateHash,
      commandId: 'sfqa032.move', locationKey: 'town.location.2' }
    const first = await moveAiTownPlayerV1(command)
    expect((await moveAiTownPlayerV1(command)).id).toBe(first.id)
    await expect(moveAiTownPlayerV1({ ...command, commandId: 'sfqa032.stale', locationKey: 'town.location.1' })).rejects.toThrow(/变化|stale/)
    const next = await readProductRuntimeStateVersion(sessionId)
    await expect(moveAiTownPlayerV1({ ...command, commandId: 'sfqa032.already-there', locationKey: 'town.location.2',
      baseSequence: next.sequence, baseStateHash: next.stateHash })).rejects.toThrow('已经在目标地点')
    const row = await db.productRuntimeSessions.get(sessionId)
    const events = await readSessionEvents(session)
    const generic = await appendProductRuntimeEvent({ sessionId, type: 'town.player.moved', actorKey: 'player',
      targetKey: 'town.location.2', payload: { locationKey: 'town.location.2', summary: '伪造重复移动。' },
    }).then(result => ({ appendedSequence: result.sequence }), (error: unknown) => ({ error }))
    expect(generic).toEqual({ error: expect.objectContaining({ message: expect.stringContaining('专用') }) })
    expect(await db.productRuntimeSessions.get(sessionId)).toEqual(row)
    expect(await readSessionEvents(session)).toEqual(events)
    expect((await readProductRuntimeState(sessionId)).town?.player.locationKey).toBe('town.location.2')
  })

  it('uses the admitted call-time event type after asynchronous session lookup', async () => {
    const { session } = await seedAiTownRuntimeFixture()
    const request: Parameters<typeof appendProductRuntimeEvent>[0] = {
      sessionId: session.id!, type: 'narrative.recorded', payload: { text: '中立的运行记录。' },
    }
    const write = appendProductRuntimeEvent(request)
    request.type = 'town.player.moved'
    request.payload = { locationKey: 'town.location.2', summary: '异步替换为产品事件。' }
    const event = await write
    expect(event.type).toBe('narrative.recorded')
    expect(JSON.parse(event.payloadJson)).toEqual({ text: '中立的运行记录。' })
    expect((await readProductRuntimeState(session.id!)).town?.player.locationKey).toBe('town.location.1')
  })

  it('rejects every registered non-neutral event without writing to a real Town session', async () => {
    const { session } = await seedAiTownRuntimeFixture()
    const before = await db.productRuntimeSessions.get(session.id!)
    const events = await readSessionEvents(session)
    const version = await readProductRuntimeStateVersion(session.id!)
    const governed = PRODUCT_RUNTIME_EVENT_TYPES.filter(type => !neutralTypes.includes(type))
    expect(governed.some(type => type.startsWith('town.'))).toBe(true)
    for (const type of [...governed, 'future.preview.started' as ProductRuntimeEventType]) {
      await expect(appendProductRuntimeEvent({ sessionId: session.id!, type, payload: {} }), type).rejects.toThrow(/专用|commitAdventureAction/)
    }
    expect(await db.productRuntimeSessions.get(session.id!)).toEqual(before)
    expect(await readSessionEvents(session)).toEqual(events)
    expect(await readProductRuntimeStateVersion(session.id!)).toEqual(version)
  })

  it('keeps a previously stored Town event readable without permitting it through generic append', async () => {
    const { session } = await seedAiTownRuntimeFixture()
    const version = await readProductRuntimeStateVersion(session.id!)
    // Historical low-level writer produced events without command metadata.
    await db.productRuntimeEvents.add({
      projectId: session.projectId, worldGroupId: session.worldGroupId ?? null, sessionId: session.id!,
      sequence: version.sequence + 1, type: 'town.player.moved', actorKey: 'player', targetKey: 'town.location.2',
      payloadJson: JSON.stringify({ locationKey: 'town.location.2', summary: '旧存档中的移动。' }), createdAt: 1,
    })
    db.close(); await db.open()
    expect((await readProductRuntimeState(session.id!)).town?.player.locationKey).toBe('town.location.2')
    await expect(appendProductRuntimeEvent({ sessionId: session.id!, type: 'town.player.moved',
      payload: { locationKey: 'town.location.1', summary: '本轮不能再使用旧入口。' } })).rejects.toThrow('专用')
    expect((await readProductRuntimeStateVersion(session.id!)).sequence).toBe(version.sequence + 1)
  })
})
