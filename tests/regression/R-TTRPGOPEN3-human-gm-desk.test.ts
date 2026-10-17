import { afterEach,beforeEach,describe,it,expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedOpenTtrpgSessionV1,OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { readProductRuntimeState,parseProductRuntimeState,replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { resumeTtrpgOpenPlayV1 } from '../../src/lib/ttrpg/open-play-coordinator'
import { rt } from '../helpers/open-ttrpg-branch-recovery'
import { readTtrpgOpenTableV1,readTtrpgOpenHostTableV1,consentTtrpgOpenHostSeatV1,consentTtrpgOpenTableSeatV1,
  startTtrpgOpenTableV1,recordTtrpgOpenTableHumanNarrationV1,changeTtrpgOpenTableSafetyV1,confirmTtrpgOpenHostRiskV1 } from '../../src/lib/ttrpg/open-table-service'

describe('R-TTRPGOPEN3 independent human GM desk', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  it('requires a real GM claim and every human consent, starts once, and never reads a player profile', async () => {
    const f = await seedOpenTtrpgSessionV1('真人主持开团',p => {
      p.ttrpg!.campaign.gmMode = 'human'
      p.ttrpg!.campaign.characterTemplates[0].playerProfile!.secret = 'PRIVATE-PLAYER-PROFILE'
    }),input = { scope: f.scope,sessionId: f.sessionId,viewerKey: 'viewer.gm' }
    const boot = await readTtrpgOpenTableV1({ scope: input.scope,sessionId: input.sessionId })
    expect(boot.hostSeats.map(s => s.viewerKey)).toEqual(['viewer.gm'])
    await expect(readTtrpgOpenHostTableV1(input)).rejects.toThrow(/主持席位/)
    await expect(consentTtrpgOpenHostSeatV1({ ...input,viewerKey: OPEN_HUMAN_VIEWER })).rejects.toThrow(/主持席位/)
    await consentTtrpgOpenHostSeatV1(input)
    await expect(startTtrpgOpenTableV1({ ...input,acceptedItemKeys: boot.requiredItemKeys })).rejects.toThrow(/分别确认/)
    await consentTtrpgOpenTableSeatV1({ ...input,viewerKey: OPEN_HUMAN_VIEWER,aiAdviceAllowed: false })
    await startTtrpgOpenTableV1({ ...input,acceptedItemKeys: boot.requiredItemKeys })
    const before = await readProductRuntimeState(f.sessionId),view = await readTtrpgOpenHostTableV1(input)
    expect(view.host).not.toBeNull();expect(view.player).toBeNull()
    expect(JSON.stringify(view)).not.toContain('PRIVATE-PLAYER-PROFILE')
    expect(rt(before).authorization!.seats.find(s => s.role === 'gm')).toMatchObject({ actorKey: null,consent: { aiAdviceAllowed: false } })
    await startTtrpgOpenTableV1({ ...input,acceptedItemKeys: boot.requiredItemKeys })
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    await expect(readTtrpgOpenHostTableV1({ ...input,viewerKey: OPEN_HUMAN_VIEWER })).rejects.toThrow(/主持席位/)
  })
  it('lets the independently claimed GM write narration and pause without player identity or model permission', async () => {
    const f = await setupChecksFixtureV1({ humanGm: true }),input = { scope: f.f.scope,sessionId: f.command.sessionId,viewerKey: 'viewer.gm' }
    await resumeTtrpgOpenPlayV1(f.command)
    const before = await readProductRuntimeState(input.sessionId),view = await readTtrpgOpenHostTableV1(input)
    expect(view.host!.operation).toMatchObject({ nextStepKey: 'narration',isStarter: false })
    expect(view.host!.operation!.ruleResult!.outcome).toBe(rt(before).openRun!.ruleReceipts[0].result.outcome)
    expect((await readTtrpgOpenTableV1({ ...input,viewerKey: OPEN_HUMAN_VIEWER })).player!.operation).not.toHaveProperty('ruleResult')
    await expect(confirmTtrpgOpenHostRiskV1({ ...input,operationKey: f.command.operationKey,actorKey: 'hero',decision: 'approve',riskHash: view.host!.operation!.riskHash })).rejects.toThrow(/不能代签/)
    await recordTtrpgOpenTableHumanNarrationV1({ ...input,operationKey: f.command.operationKey,text: '灯塔里的脚步声渐渐远去，大家仍能继续调查。',reason: 'host-authored' })
    const after = rt(await readProductRuntimeState(input.sessionId))
    expect(after.openRun!.narrations![0].binding.viewerKey).toBe('viewer.gm')
    expect(after.openRun!.coordination.calls).toEqual(rt(before).openRun!.coordination.calls)
    await resumeTtrpgOpenPlayV1(f.command)
    await changeTtrpgOpenTableSafetyV1({ ...input,status: 'paused',reason: '主持确认暂停' })
    expect(rt(await readProductRuntimeState(input.sessionId)).product.safety.status).toBe('paused')
    await changeTtrpgOpenTableSafetyV1({ ...input,status: 'active',reason: '主持确认恢复' })
    const session = (await db.productRuntimeSessions.get(input.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson),await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(input.sessionId))
  })
  it('denies a stale host seat and never promotes an AI GM identity to human authority', async () => {
    const ai = await seedOpenTtrpgSessionV1()
    await expect(consentTtrpgOpenHostSeatV1({ scope: ai.scope,sessionId: ai.sessionId,viewerKey: 'viewer.gm' })).rejects.toThrow()
    const f = await setupChecksFixtureV1({ humanGm: true }),input = { scope: f.f.scope,sessionId: f.command.sessionId,viewerKey: 'viewer.gm' }
    const seat = (await readTtrpgSessionParticipantsV2(input.sessionId)).find(s => s.role === 'gm')!
    await db.ttrpgSessionParticipants.update(seat.id!,{ revision: seat.revision + 1 })
    const before = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).count()
    await expect(readTtrpgOpenHostTableV1(input)).rejects.toThrow(/stale|变化/)
    expect(await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).count()).toBe(before)
  })
})
