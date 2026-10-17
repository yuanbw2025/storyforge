import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOpenEntityPlanningV1 } from '../helpers/open-entity-runtime'
import { createTtrpgOpenEntityPlanV1, ttrpgOpenEntityDisclosureV1, ttrpgOpenEntityIdentityCatalogV1 } from '../../src/lib/ttrpg/open-entity-plan'
import { parseTtrpgOpenEntityOperationV1, parseTtrpgOpenEntityProposalV1 } from '../../src/lib/ttrpg/open-entity-contract'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'

describe('R-TTRPGOPEN11 bounded original Oracle entity plan', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { db.close() })
  it('freezes a deterministic three-kind plan without creating entities, inventory, facts, seats, Runs or world data', async () => {
    const s = await setupOpenEntityPlanningV1(), before = await readProductRuntimeState(s.f.sessionId), events = await db.productRuntimeEvents.count()
    const worlds = await db.worldReleases.toArray(), seats = await db.ttrpgSessionParticipants.toArray()
    const plan = await createTtrpgOpenEntityPlanV1(s.input)
    expect(plan).toEqual(await createTtrpgOpenEntityPlanV1(s.input))
    expect(plan.items.map(i => i.kind)).toEqual(['actor', 'location', 'item'])
    expect(new Set(plan.items.map(i => i.entityKey)).size).toBe(3)
    expect(plan.items.every(i => i.recipientActorKeys.join(',') === 'companion.1,companion.2,hero')).toBe(true)
    expect(plan.requiredApprovals).toEqual([{ actorKey: 'companion.1', allowedSeatKeys: ['seat.hero'] }, { actorKey: 'hero', allowedSeatKeys: ['seat.hero'] }])
    expect(ttrpgOpenEntityIdentityCatalogV1(s.input.content, [{ plan, approvals: [], resolution: null }]).some(i => i.dynamic)).toBe(false)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before); expect(await db.productRuntimeEvents.count()).toBe(events)
    expect(await db.worldReleases.toArray()).toEqual(worlds); expect(await db.ttrpgSessionParticipants.toArray()).toEqual(seats); expect(await db.agentRuns.count()).toBe(0)
  })
  it.each(['template', 'name', 'parameter', 'placement', 'injected-mechanics'] as const)('rejects %s outside the frozen proposal contract', async reason => {
    const s = await setupOpenEntityPlanningV1(), proposal = structuredClone(s.proposals[0])
    if (reason === 'template') proposal.templateKey = 'not.authorized'
    if (reason === 'name') proposal.name = 'x'.repeat(21)
    if (reason === 'parameter') proposal.parameters.mood = 'unfrozen'
    if (reason === 'placement') proposal.locationRef = 'not.actual.location'
    if (reason === 'injected-mechanics') Object.assign(proposal, { hp: 9999 })
    await expect(createTtrpgOpenEntityPlanV1({ ...s.input, proposals: [proposal] })).rejects.toThrow()
  })
  it('requires actual original consultation and current requester, refuses extra entities and does not accept a model-supplied identity', async () => {
    const s = await setupOpenEntityPlanningV1()
    for (const change of [{ viewerKey: 'viewer.other' }, { oracleSourceRef: { ...s.input.oracleSourceRef, sequence: 1 } }, { proposals: [...s.proposals, s.proposals[0]] }]) {
      await expect(createTtrpgOpenEntityPlanV1({ ...s.input, ...change })).rejects.toThrow()
    }
    expect(() => parseTtrpgOpenEntityProposalV1({ ...s.proposals[0], entityKey: 'hero' })).toThrow()
    const plan = await createTtrpgOpenEntityPlanV1(s.input)
    expect(() => parseTtrpgOpenEntityOperationV1({ plan, approvals: [], resolution: { kind: 'materialized', sourceRef: { ...plan.proposedRef, sequence: plan.proposedRef.sequence + 1 } } })).toThrow(/确认/)
  })
  it('requires the exact original complete approvals and keeps declined/pending plans out of identity resolution', async () => {
    const s = await setupOpenEntityPlanningV1(), plan = await createTtrpgOpenEntityPlanV1(s.input)
    const declined = { plan, approvals: [], resolution: { kind: 'declined', sourceRef: { ...plan.proposedRef, sequence: plan.proposedRef.sequence + 1 }, reason: '不引入对象' } }
    expect(ttrpgOpenEntityIdentityCatalogV1(s.input.content, [parseTtrpgOpenEntityOperationV1(declined)]).some(row => row.dynamic)).toBe(false)
    await expect(createTtrpgOpenEntityPlanV1({ ...s.input, previousOperations: [{ plan, approvals: [], resolution: null }], commandId: 'second.pending' })).rejects.toThrow(/窗口/)
  })
  it('intersects source and template disclosure without promoting party or private material into public', () => {
    expect(ttrpgOpenEntityDisclosureV1({ audience: 'public', knownByActorKeys: [] }, 'party', ['hero'])).toEqual({ audience: 'party', recipientActorKeys: ['hero'] })
    expect(ttrpgOpenEntityDisclosureV1({ audience: 'private', knownByActorKeys: ['hero', 'other'] }, 'public', ['hero'])).toEqual({ audience: 'private', recipientActorKeys: ['hero'] })
    expect(ttrpgOpenEntityDisclosureV1({ audience: 'public', knownByActorKeys: [] }, 'gm-only', ['hero'])).toEqual({ audience: 'gm-only', recipientActorKeys: [] })
    expect(() => ttrpgOpenEntityDisclosureV1({ audience: 'private', knownByActorKeys: ['other'] }, 'party', ['hero'])).toThrow()
  })
})
