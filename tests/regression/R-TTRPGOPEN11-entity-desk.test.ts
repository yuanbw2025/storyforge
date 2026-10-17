import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOpenEntityPlanningV1 } from '../helpers/open-entity-runtime'
import { OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readTtrpgOpenEntityDeskV1, startTtrpgOpenEntityDeskV1, consultTtrpgOpenEntityDeskV1, proposeTtrpgOpenEntityDeskV1,
  confirmTtrpgOpenEntityDeskV1, materializeTtrpgOpenEntityDeskV1, disposeTtrpgOpenEntityDeskV1, closeTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { createTtrpgOpenEntityPlanV1 } from '../../src/lib/ttrpg/open-entity-plan'

describe('R-TTRPGOPEN11 actual human entity desk permissions and explicit lifecycle', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('projects only recipient effects, requires actual separate approvals, then creates once without model calls', async () => {
    const s = await setupOpenEntityPlanningV1(pkg => {
      pkg.ttrpg!.campaign.characterTemplates.find(c => c.characterKey === 'companion.1')!.controller = 'hybrid'
      pkg.ttrpg!.campaign.characterTemplates.find(c => c.characterKey === 'keeper')!.gmProfile!.secret = 'ENTITY-DESK-GM-SECRET'
      pkg.ttrpg!.campaign.fronts[0].goal = 'ENTITY-DESK-PRIVATE-FRONT'
    })
    const input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: OPEN_HUMAN_VIEWER }
    const before = await db.productRuntimeEvents.count(), page = await readTtrpgOpenEntityDeskV1(input)
    expect(page?.canPropose).toBe(true)
    expect(await db.productRuntimeEvents.count()).toBe(before); expect(await db.agentRuns.count()).toBe(0)
    expect(JSON.stringify(page)).not.toContain('ENTITY-DESK-GM-SECRET'); expect(JSON.stringify(page)).not.toContain('ENTITY-DESK-PRIVATE-FRONT')
    s.proposals[0].name = 'HOST-ONLY-NPC'
    const event = await proposeTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'desk.proposal', oracleSourceRef: s.input.oracleSourceRef, proposals: s.proposals })
    expect(Object.keys(event)).toEqual(['sequence'])
    const host = (await readTtrpgOpenEntityDeskV1(input))!.pending!, op = { operationKey: host.operationKey, planHash: host.planHash }
    expect(host.items).toHaveLength(3); expect(host.required).toBe(2); expect(JSON.stringify(host)).not.toContain('frozenContentJson')
    expect(JSON.stringify(host)).not.toContain('ENTITY-DESK-'); expect(host.canMaterialize).toBe(false)
    const otherInput = { ...input, viewerKey: 'viewer.seat.companion.1' }, other = await readTtrpgOpenEntityDeskV1(otherInput)
    expect(other?.host).toBe(false); expect(other?.templates).toEqual([]); expect(other?.placements).toEqual([]); expect(other?.oracles).toEqual([])
    expect(other?.pending?.items).toHaveLength(1); expect(other?.pending?.required).toBe(1)
    expect(JSON.stringify(other)).not.toContain('HOST-ONLY-NPC'); expect(JSON.stringify(other)).not.toContain('ENTITY-DESK-')
    expect(other?.pending?.items[0].impact.join('')).toContain('数量：1')
    const full = (await readProductRuntimeState(input.sessionId)).ttrpg!.openRun!.entityOperations![0].plan
    await expect(confirmTtrpgOpenEntityDeskV1({ ...input, ...op, actorKey: 'companion.1', decision: 'approve', review: 'reviewed-this-plan' })).rejects.toThrow(/代替/)
    await expect(confirmTtrpgOpenEntityDeskV1({ ...input, ...op, actorKey: 'hero', decision: 'approve', review: 'unreviewed' as 'reviewed-this-plan' })).rejects.toThrow(/审阅/)
    await confirmTtrpgOpenEntityDeskV1({ ...input, ...op, actorKey: 'hero', decision: 'approve', review: 'reviewed-this-plan' })
    await confirmTtrpgOpenEntityDeskV1({ ...otherInput, ...op, actorKey: 'companion.1', decision: 'approve', review: 'reviewed-this-plan' })
    expect((await readTtrpgOpenEntityDeskV1(input))?.pending?.canMaterialize).toBe(true)
    await materializeTtrpgOpenEntityDeskV1({ ...input, ...op, decision: 'create-this-confirmed-plan' })
    const state = await readProductRuntimeState(input.sessionId)
    expect(full.items.every((i: { entityKey: string }) => state.entities[i.entityKey])).toBe(true)
    expect((await readTtrpgOpenEntityDeskV1(input))?.pending).toBeNull(); expect(await db.agentRuns.count()).toBe(0)
    expect(state.ttrpg!.openRun!.worldTime).toEqual(s.input.state.ttrpg!.openRun!.worldTime)
    await closeTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'desk.close' })
    expect((await readTtrpgOpenEntityDeskV1(input))?.canStart).toBe(true)
  })
  it('requires an explicit start, consults within the original per-turn quota, and refresh does not roll again', async () => {
    const s = await setupOpenEntityPlanningV1(), input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: OPEN_HUMAN_VIEWER }
    await closeTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'desk.first.close' })
    await expect(startTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'desk.start.no', decision: 'implicit' as 'start-this-consultation' })).rejects.toThrow(/明确/)
    await startTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'desk.start', decision: 'start-this-consultation' })
    const table = s.input.content.rulePack.content.oracles[0]
    await consultTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'desk.oracle', oracleKey: table.oracleKey, question: '明确咨询新人物', likelihoodTierKey: table.likelihood?.tiers[0].tierKey ?? null })
    const before = await readProductRuntimeState(input.sessionId), page = await readTtrpgOpenEntityDeskV1(input)
    expect(page?.oracles).toHaveLength(1); expect(page?.canConsult).toBe(false); expect(page?.oracles[0].question).toBe('明确咨询新人物')
    await readTtrpgOpenEntityDeskV1(input)
    expect(await readProductRuntimeState(input.sessionId)).toEqual(before)
    await expect(consultTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'desk.no.extra', oracleKey: table.oracleKey, question: '不能重复抽取', likelihoodTierKey: null })).rejects.toThrow(/不能进行/)
    expect(await db.agentRuns.count()).toBe(0)
  })
  it('does not admit secret inventory grants to a player outside the original recipients', async () => {
    const s = await setupOpenEntityPlanningV1(pkg => {
      const t = pkg.ttrpg!.campaign.dynamicEntityTemplates.find(t => t.kind === 'item')!
      t.audience = 'private'; t.knownByActorKeys = ['hero']
    })
    await expect(createTtrpgOpenEntityPlanV1(s.input)).rejects.toThrow(/受影响角色披露/)
  })
  it('refuses another scope, a stale plan and a non-host proposal without leaking the internal source', async () => {
    const s = await setupOpenEntityPlanningV1(pkg => { pkg.ttrpg!.campaign.characterTemplates.find(c => c.characterKey === 'companion.1')!.controller = 'hybrid' })
    const input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: OPEN_HUMAN_VIEWER }
    await expect(readTtrpgOpenEntityDeskV1({ ...input, scope: { ...s.f.scope, projectId: 'different-project' } })).rejects.toThrow()
    await expect(proposeTtrpgOpenEntityDeskV1({ ...input, viewerKey: 'viewer.seat.companion.1', submissionKey: 'desk.impersonate', oracleSourceRef: s.input.oracleSourceRef, proposals: s.proposals })).rejects.toThrow(/真人主持/)
    await proposeTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'desk.original', oracleSourceRef: s.input.oracleSourceRef, proposals: s.proposals })
    const pending = (await readTtrpgOpenEntityDeskV1(input))!.pending!
    await expect(disposeTtrpgOpenEntityDeskV1({ ...input, operationKey: pending.operationKey, planHash: '0'.repeat(64), reason: '陈旧版本' })).rejects.toThrow(/版本已经变化/)
    await disposeTtrpgOpenEntityDeskV1({ ...input, operationKey: pending.operationKey, planHash: pending.planHash, reason: '真人明确放弃本版本' })
    expect((await readTtrpgOpenEntityDeskV1(input))?.pending).toBeNull()
    expect(Object.keys((await readProductRuntimeState(input.sessionId)).entities)).toEqual(Object.keys(s.input.state.entities))
  })
  it('allows the actual human GM to create a private NPC without granting that instance or template to a player-host', async () => {
    const s = await setupOpenEntityPlanningV1(pkg => {
      pkg.ttrpg!.campaign.gmMode = 'human'; pkg.ttrpg!.rulePack.content.oracles[0].audience = 'gm-only'
      pkg.ttrpg!.campaign.dynamicEntityTemplates[0].audience = 'gm-only'
    }, 'viewer.gm')
    const input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: 'viewer.gm' }
    s.proposals[0].name = 'SECRET-GM-ONLY-NPC'
    await proposeTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'desk.gm.private', oracleSourceRef: s.input.oracleSourceRef, proposals: [s.proposals[0]] })
    const pending = (await readTtrpgOpenEntityDeskV1(input))!.pending!
    expect(pending.approvals.map(a => a.actorKey)).toEqual(['gm'])
    const player = { ...input, viewerKey: OPEN_HUMAN_VIEWER }
    expect(JSON.stringify(await readTtrpgOpenEntityDeskV1(player))).not.toContain('SECRET-GM-ONLY-NPC')
    await confirmTtrpgOpenEntityDeskV1({ ...input, operationKey: pending.operationKey, planHash: pending.planHash, actorKey: 'gm', decision: 'approve', review: 'reviewed-this-plan' })
    await materializeTtrpgOpenEntityDeskV1({ ...input, operationKey: pending.operationKey, planHash: pending.planHash, decision: 'create-this-confirmed-plan' })
    expect((await readTtrpgOpenEntityDeskV1(input))?.entities.some(e => e.name === 'SECRET-GM-ONLY-NPC')).toBe(true)
    expect(JSON.stringify(await readTtrpgOpenEntityDeskV1(player))).not.toContain('SECRET-GM-ONLY-NPC')
  })
})
