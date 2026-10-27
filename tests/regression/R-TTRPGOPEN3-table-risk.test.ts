import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setup, start } from '../helpers/open-ttrpg-knowledge'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { readTtrpgOpenTableV1, confirmTtrpgOpenTableRiskV1, chooseTtrpgOpenTableConsequenceV1 } from '../../src/lib/ttrpg/open-table-service'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
const input = (f: Awaited<ReturnType<typeof setup>>) => ({ scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER })
async function fixture(hidden = false, privateDice = false) {
  return setup({ generic: true, cost: true, failForward: true }, pkg => {
    pkg.ttrpg!.campaign.informationPolicy.hiddenDice = privateDice ? 'gm-only' : 'never'
    const t = pkg.ttrpg!.campaign.effectPlanTemplates.find(t => t.planKey === 'plan.discovery.cost')!
    t.alternatives = [{ alternativeKey: 'small', title: '少量消耗', effects: t.effects }, { alternativeKey: 'large', title: '更多消耗', effects: t.effects.map(e => e.family === 'numeric' ? { ...e, amount: 2 } : e) }]
    t.effects = []
    if (hidden) { t.audience = 'gm';t.reason = 'GM-PRIVATE-REASON';t.alternatives[0].title = 'GM-PRIVATE-CHOICE' }
  })
}
describe('R-TTRPGOPEN3 frozen risk and real consequence choices', () => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  it('shows frozen costs, concrete bound targets and all alternatives before consent without paying anything', async () => {
    const f = await fixture()
    await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(f.sessionId, 'risk.start'), viewerKey: OPEN_HUMAN_VIEWER, request: f.request })
    const before = await readProductRuntimeState(f.sessionId), view = await readTtrpgOpenTableV1(input(f)), op = view.player!.operation!
    expect(op.risk.reviewable).toBe(true)
    expect(JSON.stringify(op.risk)).toContain('少量消耗');expect(JSON.stringify(op.risk)).toContain('更多消耗')
    expect(op.risk.templates.find(t => t.templateKey === 'plan.discovery.cost')!.alternatives.map(a => a.lines.join(''))).toEqual([expect.stringContaining('消耗 1'), expect.stringContaining('消耗 2')])
    expect(op.risk.choices).toEqual([])
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    for (const a of op.approvals) await confirmTtrpgOpenTableRiskV1({ ...input(f), operationKey: op.operationKey, actorKey: a.actorKey, decision: 'approve', riskHash: op.riskHash })
    expect((await readProductRuntimeState(f.sessionId)).entities).toEqual(before.entities)
  })
  it('commits the human choice once, applies the selected cost once and reads live resources after reload and replay', async () => {
    const f = await fixture(), command = await start(f)
    expect(await resumeTtrpgOpenOperationV1(command)).toMatchObject({ status: 'awaiting-choice', nextStepKey: 'knowledge' })
    const before = await readTtrpgOpenTableV1(input(f)), op = before.player!.operation!, choice = op.risk.choices[0]
    expect(choice.canChoose).toBe(true)
    const choose = { ...input(f), operationKey: op.operationKey, kind: choice.kind, templateKey: choice.templateKey, alternativeKey: 'large', riskHash: op.riskHash }
    await expect(chooseTtrpgOpenTableConsequenceV1({ ...choose, riskHash: 'f'.repeat(64) })).rejects.toThrow(/无效/)
    await expect(chooseTtrpgOpenTableConsequenceV1({ ...choose, alternativeKey: 'invented' })).rejects.toThrow(/无效/)
    await expect(chooseTtrpgOpenTableConsequenceV1({ ...choose, viewerKey: 'viewer.seat.companion.1' })).rejects.toThrow(/真人角色/)
    const chosen = await chooseTtrpgOpenTableConsequenceV1(choose)
    const selected = await readProductRuntimeState(f.sessionId)
    expect(await chooseTtrpgOpenTableConsequenceV1(choose)).toEqual(chosen)
    await expect(chooseTtrpgOpenTableConsequenceV1({ ...choose, alternativeKey: 'small' })).rejects.toThrow(/无效/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(selected)
    await resumeTtrpgOpenOperationV1(command)
    const after = await readTtrpgOpenTableV1(input(f)), resource = f.runtimePackage.ttrpg!.rulePack.content.resources[0].key
    expect(after.player!.liveCharacter.resources.find(r => r.key === resource)!.value).toBe(Number(before.player!.liveCharacter.resources.find(r => r.key === resource)!.value) - 2)
    const actual = await readProductRuntimeState(f.sessionId)
    db.close();await db.open()
    expect((await readTtrpgOpenTableV1(input(f))).player!.liveCharacter).toEqual(after.player!.liveCharacter)
    await resumeTtrpgOpenOperationV1(command);expect(await readProductRuntimeState(f.sessionId)).toEqual(actual)
    const row = (await db.productRuntimeSessions.get(f.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).sortBy('sequence'))).toEqual(actual)
  })
  it('hides GM-only reasons and alternative text and refuses a blind approval or choice', async () => {
    const f = await fixture(true)
    await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(f.sessionId, 'risk.hidden'), viewerKey: OPEN_HUMAN_VIEWER, request: f.request })
    const before = await readProductRuntimeState(f.sessionId), op = (await readTtrpgOpenTableV1(input(f))).player!.operation!
    expect(op.risk.reviewable).toBe(false);expect(JSON.stringify(op.risk)).not.toContain('GM-PRIVATE')
    await expect(confirmTtrpgOpenTableRiskV1({ ...input(f), operationKey: op.operationKey, actorKey: 'hero', decision: 'approve', riskHash: op.riskHash })).rejects.toThrow(/审查/)
    await expect(chooseTtrpgOpenTableConsequenceV1({ ...input(f), operationKey: op.operationKey, kind: 'knowledge', templateKey: 'plan.discovery.cost', alternativeKey: 'small', riskHash: op.riskHash })).rejects.toThrow(/无效/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    await confirmTtrpgOpenTableRiskV1({ ...input(f), operationKey: op.operationKey, actorKey: 'hero', decision: 'reject', riskHash: op.riskHash })
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.operations[0].status).toBe('rejected')
  })
  it('shows ability cost, damage dice and conditions while each affected human approves only their own risk', async () => {
    const f = await setup({}, pkg => {
      const c = pkg.ttrpg!, a = c.rulePack.content.actions[0]
      c.campaign.characterTemplates[1].controller = 'hybrid'
      a.target = 'single-ally';a.costResourceKey = null;a.costAmount = 0
      a.usage = { mode: 'resource-cost', maximum: null, resourceKey: c.rulePack.content.resources[0].key, cost: 2, sharedPoolKey: null, cooldownRounds: null, reset: [] }
      a.effects = [{ kind: 'damage', resourceKey: c.rulePack.content.resources[0].key, diceModelKey: c.rulePack.content.diceModels[0].key, modifierAttributeKey: null, targetScope: 'action-target' }, { kind: 'condition', conditionKey: c.rulePack.content.conditions[0].key, stacks: 1, targetScope: 'action-target' }]
    })
    const request = { ...f.request, targetKey: 'companion.1' };delete request.discovery
    await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(f.sessionId, 'risk.affected'), viewerKey: OPEN_HUMAN_VIEWER, request })
    const own = (await readTtrpgOpenTableV1(input(f))).player!.operation!, before = await readProductRuntimeState(f.sessionId)
    expect(own.risk.reviewable).toBe(true);expect(own.approvals.map(a => a.actorKey)).toEqual(['hero'])
    expect(own.risk.lines.join('\n')).toMatch(/能力另消耗：.* 2/);expect(own.risk.lines.join('\n')).toMatch(/\d+d\d+.*伤害/);expect(own.risk.lines.join('\n')).toContain('添加「')
    await expect(confirmTtrpgOpenTableRiskV1({ ...input(f), operationKey: own.operationKey, actorKey: 'companion.1', decision: 'approve', riskHash: own.riskHash })).rejects.toThrow(/确认/)
    await confirmTtrpgOpenTableRiskV1({ ...input(f), operationKey: own.operationKey, actorKey: 'hero', decision: 'approve', riskHash: own.riskHash })
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.operations[0].status).toBe('awaiting-approval')
    const companion = { ...input(f), viewerKey: 'viewer.seat.companion.1' }, other = (await readTtrpgOpenTableV1(companion)).player!.operation!
    expect(other.approvals.map(a => a.actorKey)).toEqual(['companion.1'])
    await confirmTtrpgOpenTableRiskV1({ ...companion, operationKey: other.operationKey, actorKey: 'companion.1', decision: 'approve', riskHash: other.riskHash })
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.operations[0].status).toBe('executing')
    expect((await readProductRuntimeState(f.sessionId)).entities).toEqual(before.entities)
  })
  it('does not reveal a private dice result through outcome-dependent choice availability', async () => {
    const f = await fixture(false, true), command = await start(f)
    await resumeTtrpgOpenOperationV1(command)
    const op = (await readTtrpgOpenTableV1(input(f))).player!.operation!
    expect(op.risk.privateRoll).toBe(true);expect(op.risk.choices).toEqual([])
    await expect(chooseTtrpgOpenTableConsequenceV1({ ...input(f), operationKey: op.operationKey, kind: 'knowledge', templateKey: 'plan.discovery.cost', alternativeKey: 'small', riskHash: op.riskHash })).rejects.toThrow(/无效/)
  })
})
