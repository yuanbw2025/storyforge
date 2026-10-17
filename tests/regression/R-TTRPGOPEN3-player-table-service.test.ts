import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedOpenTtrpgSessionV1, readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { readTtrpgOpenTableV1, consentTtrpgOpenTableSeatV1, startTtrpgOpenTableV1 } from '../../src/lib/ttrpg/open-table-service'
import { loadTtrpgOpenPlayerContextV1, loadTtrpgOpenHumanViewV1, loadTtrpgOpenPartyProjectionV1 } from '../../src/lib/ttrpg/open-player-context'
import { parseProductRuntimeState, readProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
describe('R-TTRPGOPEN3 real scoped player desk adapter', () => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  it('exposes no role secrets before identity confirmation, and only the selected human private projection afterwards', async () => {
    const f = await readyOpenTtrpgSessionV1('private desk', pkg => {
      pkg.ttrpg!.campaign.characterTemplates[0].playerProfile!.secret = 'ONLY-HERO-SECRET'
      pkg.ttrpg!.campaign.characterTemplates[1].playerProfile!.secret = 'OTHER-AI-SECRET'
    }), input = { scope: f.scope, sessionId: f.sessionId }
    expect(JSON.stringify(await readTtrpgOpenTableV1(input))).not.toMatch(/ONLY-HERO-SECRET|OTHER-AI-SECRET/)
    const view = await readTtrpgOpenTableV1({ ...input, viewerKey: OPEN_HUMAN_VIEWER })
    expect(view.player!.view.self.playerProfile!.secret).toBe('ONLY-HERO-SECRET');expect(JSON.stringify(view)).not.toContain('OTHER-AI-SECRET')
    await expect(readTtrpgOpenTableV1({ ...input, viewerKey: 'viewer.seat.companion.1' })).rejects.toThrow(/真人角色/)
    await expect(loadTtrpgOpenHumanViewV1({ ...input, actorKey: 'companion.1', viewerKey: OPEN_HUMAN_VIEWER })).rejects.toThrow(/本人/)
  })
  it('allows the human to view their own sheet after declining AI advice while the registered model reader remains denied', async () => {
    const f = await seedOpenTtrpgSessionV1('decline AI', pkg => { pkg.ttrpg!.campaign.runtimePolicy.enabled = true }), input = { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER }
    await consentTtrpgOpenTableSeatV1({ ...input, aiAdviceAllowed: false })
    const before = await readTtrpgOpenTableV1(input)
    await startTtrpgOpenTableV1({ ...input, acceptedItemKeys: before.requiredItemKeys })
    expect((await readTtrpgOpenTableV1(input)).player!.aiAllowed).toBe(false)
    await expect(loadTtrpgOpenPlayerContextV1({ ...input, actorKey: 'hero' })).rejects.toThrow(/未授权 AI/)
    expect((await loadTtrpgOpenHumanViewV1({ ...input, actorKey: 'hero' })).view.authority.actorKey).toBe('hero')
    expect(await loadTtrpgOpenPartyProjectionV1({ ...input, actorKey: 'hero' })).not.toHaveProperty('view.self')
  })
  it('claims only the consenting human, starts frozen Session Zero and actual opening once, and replays the same state', async () => {
    const f = await seedOpenTtrpgSessionV1('desk opening'), input = { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER }
    await expect(startTtrpgOpenTableV1({ ...input, acceptedItemKeys: [] })).rejects.toThrow(/认领/)
    await consentTtrpgOpenTableSeatV1({ ...input, aiAdviceAllowed: true })
    const bootstrap = await readTtrpgOpenTableV1(input)
    await expect(startTtrpgOpenTableV1({ ...input, acceptedItemKeys: [] })).rejects.toThrow(/全部 Session Zero/)
    await startTtrpgOpenTableV1({ ...input, acceptedItemKeys: bootstrap.requiredItemKeys })
    const state = await readProductRuntimeState(f.sessionId)
    await startTtrpgOpenTableV1({ ...input, acceptedItemKeys: bootstrap.requiredItemKeys })
    expect(await readProductRuntimeState(f.sessionId)).toEqual(state)
    expect((await readTtrpgOpenTableV1(input)).player).not.toBeNull()
    const row = (await db.productRuntimeSessions.get(f.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).sortBy('sequence'))).toEqual(state)
    expect(state.ttrpg!.openRun!.situations.active).toHaveLength(1)
    expect(state.ttrpg!.openRun!.coordination.epochs).toEqual([])
  })
})
