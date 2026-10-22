import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import * as runtimeCore from '../../src/lib/product/runtime-core'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { readyOpenTtrpgSessionV1 } from '../helpers/open-ttrpg-session'
describe('R-TTRPGOPEN1 exact actor read model', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('keeps only the requested actor private profile and hides GM-only entities without changing the event head', async () => {
    const fixture = await readyOpenTtrpgSessionV1('actor view secrecy', pkg => {
      for (const actor of pkg.ttrpg!.campaign.characterTemplates) {
        if (actor.playerProfile) actor.playerProfile.secret = `PRIVATE-${actor.characterKey}`
        if (actor.gmProfile) actor.gmProfile.secret = 'GM-SECRET-MARKER'
      }
      const keeper = pkg.ttrpg!.campaign.entityBindings.find(binding => binding.bindingKey === 'keeper')!
      keeper.audience = 'gm-only'
    })
    const before = await runtimeCore.readProductRuntimeState(fixture.sessionId)
    const hero = await loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'hero' })
    const companion = await loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'companion.1' })
    expect(hero.view.self.playerProfile!.secret).toBe('PRIVATE-hero')
    expect(companion.view.self.playerProfile!.secret).toBe('PRIVATE-companion.1')
    expect(JSON.stringify(companion.view)).not.toContain('PRIVATE-hero')
    expect(JSON.stringify(companion.view)).not.toContain('GM-SECRET-MARKER')
    expect(companion.view.actorsHere.some(actor => actor.actorKey === 'keeper')).toBe(false)
    expect(companion.view.knowledge).toEqual([])
    expect(JSON.stringify(companion.view)).not.toContain('hiddenCount')
    expect(companion.readEvidence.sequence).toBe(before.lastSequence)
    expect(await runtimeCore.readProductRuntimeState(fixture.sessionId)).toEqual(before)
  })
  it('rejects non-player roles and stale consent rows before making a context', async () => {
    const fixture = await readyOpenTtrpgSessionV1('actor read authorization')
    await expect(loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'keeper' })).rejects.toThrow(/活动玩家/)
    const row = await db.ttrpgSessionParticipants.where('sessionId').equals(fixture.sessionId).filter(row => row.actorKey === 'companion.1').first()
    await db.ttrpgSessionParticipants.update(row!.id!, { revision: row!.revision + 1 })
    await expect(loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'companion.1' })).rejects.toThrow(/stale/)
  })
  it('labels frozen initial observations instead of exposing unseen live NPC state', async () => {
    const fixture = await readyOpenTtrpgSessionV1('initial observations')
    const context = await loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'hero' })
    expect(context.view.initialObservations.every(observation => observation.asOf === 'release')).toBe(true)
    expect(context.view.actorsHere.every(actor => !('attributes' in actor) && !('gmProfile' in actor))).toBe(true)
  })
  it('refuses a snapshot that changes during the multi-source read', async () => {
    const fixture = await readyOpenTtrpgSessionV1('stale actor read')
    const current = await runtimeCore.readProductRuntimeStateVersion(fixture.sessionId)
    vi.spyOn(runtimeCore, 'readProductRuntimeStateVersion').mockResolvedValue({ ...current, sequence: current.sequence + 1 })
    await expect(loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'hero' })).rejects.toThrow(/读取期间/)
  })
})
