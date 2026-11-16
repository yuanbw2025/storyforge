import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { URL as NodeURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { ProductRuntimeEvent } from '../../src/lib/types'
import legacyStart from '../fixtures/ttrpg/sfqa079-legacy-open-start.json'
import { applyProductRuntimeEvent, hashProductRuntimeStateV1, parseProductRuntimeState, readProductRuntimeState, readSessionEvents, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { configureTtrpgSessionParticipantV2, readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { completeTtrpgOpenSessionZeroV1, startTtrpgOpenRunV1 } from '../../src/lib/ttrpg/runtime-commands'
import { isTtrpgRuntimeContentV2 } from '../../src/lib/ttrpg/content-version'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { OPEN_HUMAN_VIEWER, openEnvelopeV1, seedOpenTtrpgSessionV1 } from '../helpers/open-ttrpg-session'

async function prepare(claim: boolean) {
  const f = await seedOpenTtrpgSessionV1('SFQA079 explicit open seat', pkg => {
    if (!pkg.ttrpg || !isTtrpgRuntimeContentV2(pkg.ttrpg)) throw new Error('Expected the official open content contract')
    const campaign = pkg.ttrpg.campaign
    const template = structuredClone(campaign.characterTemplates[0])
    template.characterKey = 'new-player'; template.seatKey = 'seat.new-player'; template.controller = 'open'
    template.characterSheet.characterKey = template.characterKey
    campaign.characterTemplates.push(template)
    campaign.entityBindings.push({ ...structuredClone(campaign.entityBindings[1]), bindingKey: template.characterKey, templateKey: template.characterKey })
  })
  for (const seat of await readTtrpgSessionParticipantsV2(f.sessionId)) {
    if (seat.controller === 'vacant' && !claim) continue
    await configureTtrpgSessionParticipantV2({ sessionId: f.sessionId, seatKey: seat.seatKey,
      commandId: `claim.${seat.seatKey}`, expectedRevision: seat.revision,
      requestedByViewerKey: seat.controller === 'ai' ? 'viewer.gm' : seat.viewerKey,
      ...(seat.controller === 'vacant' ? { controller: 'human' as const } : {}),
      assignmentState: seat.controller === 'ai' ? 'assigned' : 'claimed',
      consent: { aiIdentityDisclosed: true, aiAdviceAllowed: true } })
  }
  return f
}
async function confirm(f: Awaited<ReturnType<typeof prepare>>, selected = ['hero', 'companion.1', 'companion.2', 'new-player']) {
  const state = await readProductRuntimeState(f.sessionId)
  if (!state.ttrpg) throw new Error('Expected the real open instance')
  return completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(f.sessionId, 'zero'),
    acceptedItemKeys: state.ttrpg.product.sessionZero.requiredItemKeys, selectedCharacterKeys: selected, viewerKey: OPEN_HUMAN_VIEWER })
}
beforeEach(async () => {
  await db.delete(); await db.open()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('No model or external network authorized') }))
})
afterEach(() => {
  try { expect(fetch).not.toHaveBeenCalled() }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() }
})

describe('SFQA079 open seat authority at the public run start', () => {
  it('starts a selected open template only with its real claimed-human authority and replays after reopening', async () => {
    const f = await prepare(true)
    const frozenBuilds = await db.productBuilds.toArray()
    await confirm(f)
    const input = { ...await openEnvelopeV1(f.sessionId, 'start'), viewerKey: OPEN_HUMAN_VIEWER }
    const event = await startTtrpgOpenRunV1(input)
    const state = await readProductRuntimeState(f.sessionId)
    const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
    expect(f.campaign.characterTemplates.find(row => row.characterKey === 'new-player')?.controller).toBe('open')
    expect(runtime?.authorization?.seats.find(row => row.actorKey === 'new-player')).toMatchObject({ controller: 'human', assignmentState: 'claimed' })
    expect(runtime?.openRun?.companions.find(row => row.actorKey === 'new-player')?.controller).toBe('human')
    expect(await startTtrpgOpenRunV1(input)).toEqual(event)
    const session = await db.productRuntimeSessions.get(f.sessionId)
    if (!session) throw new Error('Expected the original instance')
    expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), await readSessionEvents(session))).toEqual(state)
    db.close(); await db.open()
    expect(await readProductRuntimeState(f.sessionId)).toEqual(state)
    expect(await db.productBuilds.toArray()).toEqual(frozenBuilds)
  })

  it('leaves an unselected vacant template outside the active run', async () => {
    const f = await prepare(false)
    await confirm(f, ['hero', 'companion.1', 'companion.2'])
    await startTtrpgOpenRunV1({ ...await openEnvelopeV1(f.sessionId, 'start'), viewerKey: OPEN_HUMAN_VIEWER })
    const state = await readProductRuntimeState(f.sessionId)
    expect(parseTtrpgRuntimeStateV2(state.ttrpg)?.openRun?.companions.map(row => row.actorKey)).toEqual(['hero', 'companion.1', 'companion.2'])
    expect((await readTtrpgSessionParticipantsV2(f.sessionId)).find(row => row.actorKey === 'new-player')).toMatchObject({ controller: 'vacant', assignmentState: 'vacant', sessionZeroAcceptedAtSequence: null })
  })

  it('rejects a selected unclaimed seat without a partial Session Zero or run', async () => {
    const f = await prepare(false)
    const before = await readProductRuntimeState(f.sessionId)
    await expect(confirm(f)).rejects.toThrow(/控制权无效|席位不可用|空缺/)
    await expect(startTtrpgOpenRunV1({ ...await openEnvelopeV1(f.sessionId, 'start'), viewerKey: OPEN_HUMAN_VIEWER })).rejects.toThrow(/Session Zero/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    expect(await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).count()).toBe(before.lastSequence)
  })

  it('rejects stale current authority and cannot substitute another controller in the started event', async () => {
    const f = await prepare(true)
    await confirm(f)
    const before = await readProductRuntimeState(f.sessionId)
    const event = await startTtrpgOpenRunV1({ ...await openEnvelopeV1(f.sessionId, 'start'), viewerKey: OPEN_HUMAN_VIEWER })
    const payload = JSON.parse(event.payloadJson)
    for (const controller of ['open', 'vacant', 'invalid']) {
      const invalid = structuredClone(payload)
      invalid.openRun.companions.find((row: { actorKey: string }) => row.actorKey === 'new-player').controller = controller
      expect(() => applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify(invalid) })).toThrow()
    }
    const fresh = await prepare(true)
    await confirm(fresh)
    const authority = await readTtrpgSessionParticipantsV2(fresh.sessionId)
    const seat = authority.find(row => row.actorKey === 'new-player')
    if (!seat?.id) throw new Error('Expected the real claimed participant')
    await expect(configureTtrpgSessionParticipantV2({ sessionId: fresh.sessionId, seatKey: seat.seatKey, commandId: 'late-change',
      expectedRevision: seat.revision, requestedByViewerKey: seat.viewerKey, consent: { aiAdviceAllowed: false } })).rejects.toThrow(/Session Zero 完成后/)
    // Deliberately corrupt the isolated current row: a frozen authorization
    // must not silently authorize a later controller/revision change.
    await db.ttrpgSessionParticipants.update(seat.id, { revision: seat.revision + 1 })
    const unchanged = await readProductRuntimeState(fresh.sessionId)
    await expect(startTtrpgOpenRunV1({ ...await openEnvelopeV1(fresh.sessionId, 'stale-start'), viewerKey: OPEN_HUMAN_VIEWER })).rejects.toThrow(/stale/)
    expect(await readProductRuntimeState(fresh.sessionId)).toEqual(unchanged)
    expect(unchanged.ttrpg?.openRun).toBeNull()
  })

  it('uses current hybrid authority rather than the frozen AI template for a newly started run', async () => {
    const f = await prepare(true)
    const frozenBuilds = await db.productBuilds.toArray()
    const participant = (await readTtrpgSessionParticipantsV2(f.sessionId)).find(row => row.actorKey === 'companion.1')
    if (!participant) throw new Error('Expected the actual companion with its frozen human approval binding')
    await configureTtrpgSessionParticipantV2({ sessionId: f.sessionId, seatKey: participant.seatKey,
      commandId: 'claim.hybrid', expectedRevision: participant.revision, requestedByViewerKey: 'viewer.gm',
      controller: 'hybrid', assignmentState: 'claimed', consent: { aiIdentityDisclosed: true, aiAdviceAllowed: true } })
    await confirm(f)
    const input = { ...await openEnvelopeV1(f.sessionId, 'start.hybrid'), viewerKey: OPEN_HUMAN_VIEWER }
    const event = await startTtrpgOpenRunV1(input)
    const state = await readProductRuntimeState(f.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
    if (!runtime?.openRun || !runtime.authorization) throw new Error('Expected the real initialized run and authorization')
    expect(f.campaign.characterTemplates.find(row => row.characterKey === 'companion.1')?.controller).toBe('ai')
    expect(runtime.openRun.companions.find(row => row.actorKey === 'companion.1')?.controller).toBe('hybrid')
    for (const companion of runtime.openRun.companions) {
      expect(companion.controller).toBe(runtime.authorization.seats.find(row => row.actorKey === companion.actorKey)?.controller)
    }
    expect(await startTtrpgOpenRunV1(input)).toEqual(event)
    db.close(); await db.open()
    expect(await readProductRuntimeState(f.sessionId)).toEqual(state)
    expect(await db.productBuilds.toArray()).toEqual(frozenBuilds)
  })

  it('replays the exact real old AI-template/hybrid-authority event without rewriting its bytes or original head hash', async () => {
    const raw = await readFile(new NodeURL('../fixtures/ttrpg/sfqa079-legacy-open-start.json', import.meta.url))
    expect(createHash('sha256').update(raw).digest('hex')).toBe('3fa3abd4534ff07483fb52f2d242e4852634b13caf27557babb35f79a8f9d8d5')
    expect(JSON.stringify(legacyStart.events)).toBe(legacyStart.rawEventRowsJson)
    expect(createHash('sha256').update(legacyStart.rawEventRowsJson).digest('hex')).toBe(legacyStart.rawEventRowsSHA256)
    const events: ProductRuntimeEvent[] = legacyStart.events.map(event => {
      switch (event.type) {
        case 'narrative.started': case 'narrative.node.entered':
        case 'ttrpg.session-zero.completed': case 'ttrpg.open.run.started':
          return { ...event, type: event.type }
        default: throw new Error('Unexpected event kind in the original immutable sample')
      }
    })
    const replay = replayProductRuntimeEvents(parseProductRuntimeState(legacyStart.session.initialStateJson), events)
    const runtime = parseTtrpgRuntimeStateV2(replay.ttrpg)
    expect(runtime?.authorization?.seats.find(row => row.actorKey === 'companion.1')?.controller).toBe('hybrid')
    expect(runtime?.openRun?.companions.find(row => row.actorKey === 'companion.1')?.controller).toBe('ai')
    expect(replay).toEqual(legacyStart.state)
    expect(await hashProductRuntimeStateV1(replay)).toBe(legacyStart.head.stateHash)
    expect(await readFile(new NodeURL('../fixtures/ttrpg/sfqa079-legacy-open-start.json', import.meta.url))).toEqual(raw)
  })

})
