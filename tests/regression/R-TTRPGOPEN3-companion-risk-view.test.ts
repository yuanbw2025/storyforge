import { afterEach,beforeEach,describe,expect,it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setup } from '../helpers/open-ttrpg-knowledge'
import { openEnvelopeV1,OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readTtrpgOpenTableV1,confirmTtrpgOpenTableRiskV1 } from '../../src/lib/ttrpg/open-table-service'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'

describe('R-TTRPGOPEN3 meaningful risk for an authorized AI companion without private content',() => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  async function fixture(hiddenTemplate = false) {
    const f = await setup({},p => {
      const c = p.ttrpg!.campaign,evidence = c.situationTemplates[0].evidence[0]
      c.informationPolicy.hiddenDice = 'gm-only'
      const actor = c.characterTemplates.find(a => a.characterKey === 'companion.1')!
      actor.playerProfile!.secret = 'PRIVATE-COMPANION-PROFILE-SENTINEL'
      const binding = c.entityBindings.find(b => b.bindingKey === 'companion.1')!
      binding.audience = 'private';binding.knownByActorKeys = ['companion.1']
      evidence.title = 'UNREVEALED-CLUE-TITLE-SENTINEL';evidence.description = 'UNREVEALED-CLUE-CONTENT-SENTINEL'
      c.effectPlanTemplates.push({ planKey: 'plan.discovery.knowledge',degree: 'failure',ruleRef: p.ttrpg!.rulePack.content.ruleSystemId,
        reason: 'PRIVATE-TEMPLATE-REASON-SENTINEL',audience: hiddenTemplate ? 'gm' : 'party',parameters: [],
        effects: [{ effectKey: 'knowledge.progress',family: 'knowledge',operation: 'knowledge.discover',targetRef: 'hero',evidenceRef: evidence.clueRef }],alternatives: [] })
      evidence.discoveryPolicy.failForwardEffectPlanRef = 'plan.discovery.knowledge'
    })
    const request = { ...f.request,actorKey: 'companion.1',controllerMode: 'ai' as const,
      discovery: { ...f.request.discovery,effectBindings: { 'plan.discovery.knowledge': {} } } }
    await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(f.sessionId,'companion.risk.start'),viewerKey: OPEN_HUMAN_VIEWER,request })
    const input = { scope: f.scope,sessionId: f.sessionId,viewerKey: OPEN_HUMAN_VIEWER }
    return { f,input }
  }
  it('lets the assigned human review known participant identity and a bounded knowledge grant, then separately approve each affected actor',async () => {
    const { f,input } = await fixture(),before = await readProductRuntimeState(f.sessionId),view = await readTtrpgOpenTableV1(input),op = view.player!.operation!
    expect(op.risk.reviewable).toBe(true);expect(op.requiresDetailedReview).toBe(false);expect(op.risk.privateRoll).toBe(true);expect(op.risk.choices).toEqual([])
    expect(op.approvals.map(a => a.actorKey).sort()).toEqual(['companion.1','companion.2','hero'])
    const text = JSON.stringify(op.risk)
    expect(text).toContain('线索');expect(text).not.toContain('UNREVEALED-');expect(text).not.toContain('PRIVATE-');expect(text).not.toContain(f.request.discovery.evidenceRef)
    expect(JSON.stringify(view)).not.toContain('PRIVATE-COMPANION-PROFILE-SENTINEL')
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    await expect(confirmTtrpgOpenTableRiskV1({ ...input,operationKey: op.operationKey,actorKey: 'companion.1',riskHash: 'f'.repeat(64),decision: 'approve' })).rejects.toThrow()
    for (const [index,approval] of op.approvals.entries()) {
      await confirmTtrpgOpenTableRiskV1({ ...input,operationKey: op.operationKey,actorKey: approval.actorKey,riskHash: op.riskHash,decision: 'approve' })
      expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.operations[0].status).toBe(index === op.approvals.length - 1 ? 'executing' : 'awaiting-approval')
    }
    const state = await readProductRuntimeState(f.sessionId)
    expect(state.ttrpg!.openRun!.operations[0].status).toBe('executing');expect(state.entities).toEqual(before.entities)
    expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime);expect(state.ttrpg!.openRun!.knowledge).toEqual(before.ttrpg!.openRun!.knowledge)
    expect(await db.agentRuns.count()).toBe(0)
    await expect(confirmTtrpgOpenTableRiskV1({ ...input,viewerKey: 'viewer.seat.companion.1',operationKey: op.operationKey,actorKey: 'companion.1',riskHash: op.riskHash,decision: 'approve' })).rejects.toThrow()
  })
  it('continues to hide GM-only templates and refuses blind consent',async () => {
    const { f,input } = await fixture(true),before = await readProductRuntimeState(f.sessionId),op = (await readTtrpgOpenTableV1(input)).player!.operation!
    expect(op.risk.reviewable).toBe(false);expect(JSON.stringify(op.risk)).not.toMatch(/PRIVATE-|UNREVEALED-/)
    await expect(confirmTtrpgOpenTableRiskV1({ ...input,operationKey: op.operationKey,actorKey: 'companion.1',riskHash: op.riskHash,decision: 'approve' })).rejects.toThrow(/审查/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  })
})
