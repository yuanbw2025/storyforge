import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { describeTtrpgOpenHumanEffectV1 } from '../../src/lib/ttrpg/open-table-risk'
import { applyTtrpgItemCommandV2, ttrpgItemDefinitionFromRuleV1 } from '../../src/lib/ttrpg/item-ledger'
import { setupPressureEffectFixtureV1 } from '../helpers/open-ttrpg-pressure-effect'
import { setupMaintenanceFixtureV1 } from '../helpers/open-ttrpg-maintenance'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { resumeTtrpgOpenSituationsV1 } from '../../src/lib/ttrpg/open-situation-coordinator'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { readTtrpgOpenTableV1, readTtrpgOpenTableHostConsequenceV1, prepareTtrpgOpenTableConsequenceV1, proposeTtrpgOpenTableConsequenceV1, confirmTtrpgOpenTableConsequenceV1, resumeTtrpgOpenTableV1, readTtrpgOpenTableStageClosureV1, closeTtrpgOpenTableStageV1, type TtrpgOpenTableInputV1 } from '../../src/lib/ttrpg/open-table-service'
const input = (f: Awaited<ReturnType<typeof setupPressureEffectFixtureV1>>): TtrpgOpenTableInputV1 => ({ scope: f.f.scope, sessionId: f.command.sessionId, viewerKey: f.command.viewerKey })
async function locator(base: TtrpgOpenTableInputV1) { const view = await readTtrpgOpenTableV1(base);expect(view.player!.consequence).not.toBeNull();return { ...base, ...view.player!.consequence! } }
async function replay(sessionId: number) {
  const row = (await db.productRuntimeSessions.get(sessionId))!
  expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(sessionId))
}
describe('R-TTRPGOPEN3 actual host consequence desk and explicit stage closure', { timeout: 30000 }, () => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  it('keeps host material out of ordinary reads and makes a prepared pressure consequence pay only after individual consent', async () => {
    const f = await setupPressureEffectFixtureV1({}, pkg => { pkg.ttrpg!.campaign.effectPlanTemplates[0].reason = 'HOST-PRIVATE-REASON' }), base = input(f), loc = await locator(base)
    const before = await readProductRuntimeState(base.sessionId), view = await readTtrpgOpenTableV1(base)
    const unknownState = structuredClone(before), rules = f.f.runtimePackage.ttrpg!.rulePack.content
    unknownState.ttrpg!.product.inventory = applyTtrpgItemCommandV2({ state: unknownState.ttrpg!.product.inventory, definitions: Object.fromEntries(rules.items.map(i => [i.key, ttrpgItemDefinitionFromRuleV1(i)])), command: { commandId: 'preview.grant', kind: 'grant', instanceId: 'preview.unknown', definitionRef: rules.items[0].key, ownerRef: 'hero', locationRef: null, quantity: 1, eventId: 'event.1' } }).state
    const owned = unknownState.ttrpg!.product.inventory.items['preview.unknown'];owned.identification = 'unknown'
    const itemEffect = { effectKey: 'private.item.preview', family: 'item' as const, operation: 'item.remove' as const, targetRef: 'hero', itemDefinitionRef: owned.definitionRef, itemInstanceRef: owned.itemInstanceId, destinationRef: null, amount: 1 }
    const effectInput = { state: unknownState, rules: f.f.runtimePackage.ttrpg!.rulePack.content, actorKey: 'hero', effect: itemEffect, bindings: {}, name: (ref: string | null) => ref === 'hero' ? 'hero' : null }
    const itemName = effectInput.rules.items.find(i => i.key === owned.definitionRef)!.name
    expect(describeTtrpgOpenHumanEffectV1(effectInput).text).not.toContain(itemName)
    expect(describeTtrpgOpenHumanEffectV1({ ...effectInput, host: true }).text).toContain(itemName)
    expect(JSON.stringify(view)).not.toMatch(/HOST-PRIVATE-REASON|mechanicalStateJson/)
    const host = await readTtrpgOpenTableHostConsequenceV1(loc)
    expect(host.title).toBe('HOST-PRIVATE-REASON');expect(host.parameters[0].options.map(o => o.key)).toEqual(['hero'])
    await expect(prepareTtrpgOpenTableConsequenceV1({ ...loc, request: { bindings: {}, alternativeKey: 'large' } })).rejects.toThrow()
    await expect(prepareTtrpgOpenTableConsequenceV1({ ...loc, request: { bindings: { actor: 'keeper' }, alternativeKey: 'large' } })).rejects.toThrow()
    const draft = await prepareTtrpgOpenTableConsequenceV1({ ...loc, request: { bindings: { actor: 'hero' }, alternativeKey: 'large' } })
    expect(draft.lines.join('')).toContain('消耗 2');expect(draft.reviewable).toBe(true)
    expect(await readProductRuntimeState(base.sessionId)).toEqual(before)
    const proposed = await proposeTtrpgOpenTableConsequenceV1({ ...loc, ...draft })
    expect(await proposeTtrpgOpenTableConsequenceV1({ ...loc, ...draft })).toEqual(proposed)
    const afterProposal = await readProductRuntimeState(base.sessionId)
    expect(afterProposal.entities).toEqual(before.entities)
    const personal = (await readTtrpgOpenTableV1(base)).player!.consequenceApprovals
    expect(personal).toHaveLength(1);expect(JSON.stringify(personal)).not.toMatch(/HOST-PRIVATE-REASON|mechanicalStateJson/)
    const approvalInput = { ...loc, ...personal[0], decision: 'approve' as const }, accepted = await confirmTtrpgOpenTableConsequenceV1(approvalInput)
    expect((await readProductRuntimeState(base.sessionId)).entities).toEqual(before.entities)
    await resumeTtrpgOpenTableV1({ ...base, operationKey: loc.operationKey })
    const after = await readProductRuntimeState(base.sessionId)
    expect(await confirmTtrpgOpenTableConsequenceV1(approvalInput)).toEqual(accepted)
    await expect(confirmTtrpgOpenTableConsequenceV1({ ...approvalInput, decision: 'reject' })).rejects.toThrow()
    expect(Number(after.entities.hero.attributes[`resource.${f.resource}`])).toBe(Number(before.entities.hero.attributes[`resource.${f.resource}`]) - 2)
    await resumeTtrpgOpenTableV1({ ...base, operationKey: loc.operationKey });expect(await readProductRuntimeState(base.sessionId)).toEqual(after)
    await replay(base.sessionId)
  })
  it('requires the other real human to approve their own hybrid character, and a rejection permits a new retained revision', async () => {
    const f = await setupPressureEffectFixtureV1({ aiTarget: true }, pkg => { pkg.ttrpg!.campaign.characterTemplates[1].controller = 'hybrid' }, async f => { delete f.request.discovery }), base = input(f), loc = await locator(base)
    const first = await prepareTtrpgOpenTableConsequenceV1({ ...loc, request: { bindings: { actor: 'companion.1' }, alternativeKey: 'small' } })
    await proposeTtrpgOpenTableConsequenceV1({ ...loc, ...first })
    expect((await readTtrpgOpenTableV1(base)).player!.consequenceApprovals).toEqual([])
    await expect(confirmTtrpgOpenTableConsequenceV1({ ...loc, ...first, actorKey: 'companion.1', decision: 'approve' })).rejects.toThrow()
    const other = { ...base, viewerKey: 'viewer.seat.companion.1' }, own = (await readTtrpgOpenTableV1(other)).player!.consequenceApprovals[0]
    await expect(readTtrpgOpenTableHostConsequenceV1({ ...loc, ...other })).rejects.toThrow()
    await confirmTtrpgOpenTableConsequenceV1({ ...loc, ...other, ...own, decision: 'reject' })
    const second = await prepareTtrpgOpenTableConsequenceV1({ ...loc, request: { bindings: { actor: 'companion.1' }, alternativeKey: 'large' } })
    expect(second.revision).toBe(2)
    const host = await readTtrpgOpenTableHostConsequenceV1(loc)
    expect(host.history).toEqual([{ revision: 1, status: 'rejected' }])
    await proposeTtrpgOpenTableConsequenceV1({ ...loc, ...second })
    const next = (await readTtrpgOpenTableV1(other)).player!.consequenceApprovals[0]
    await confirmTtrpgOpenTableConsequenceV1({ ...loc, ...other, ...next, decision: 'approve' })
    await replay(base.sessionId)
  })
  it('uses the actual situation work journal rather than a second consequence owner', async () => {
    const f = await setupMaintenanceFixtureV1({ resolve: true, effect: true, cost: true }), base = { scope: f.f.scope, sessionId: f.command.sessionId, viewerKey: f.command.viewerKey }
    await resumeTtrpgOpenSituationsV1(f.command)
    const loc = await locator(base);expect(loc.owner).toBe('situations')
    const before = await readProductRuntimeState(base.sessionId), draft = await prepareTtrpgOpenTableConsequenceV1({ ...loc, request: { bindings: { actor: 'hero' }, alternativeKey: 'small' } })
    await proposeTtrpgOpenTableConsequenceV1({ ...loc, ...draft })
    const approval = (await readTtrpgOpenTableV1(base)).player!.consequenceApprovals[0]
    await confirmTtrpgOpenTableConsequenceV1({ ...loc, ...approval, decision: 'approve' });await resumeTtrpgOpenTableV1({ ...base, operationKey: loc.operationKey })
    const state = await readProductRuntimeState(base.sessionId), resource = f.f.runtimePackage.ttrpg!.rulePack.content.resources[0].key
    expect(Number(state.entities.hero.attributes[`resource.${resource}`])).toBe(Number(before.entities.hero.attributes[`resource.${resource}`]) - 1)
    await replay(base.sessionId)
  })
  it('closes with a private human summary, settles an actual stage cost, and preserves world time across reload', async () => {
    const f = await setupChecksFixtureV1({ closure: true, stageTick: 2, stageMaximum: 3, stageEffect: true }), base = { scope: f.f.scope, sessionId: f.command.sessionId, viewerKey: f.command.viewerKey }, opInput = { ...base, operationKey: f.command.operationKey }
    await resumeTtrpgOpenChecksV1(f.command)
    const prompt = await readTtrpgOpenTableStageClosureV1(opInput);expect(prompt.eligible).toBe(true)
    const before = await readProductRuntimeState(base.sessionId), event = await closeTtrpgOpenTableStageV1({ ...opInput, summary: 'HOST-PRIVATE-SUMMARY' })
    expect(await closeTtrpgOpenTableStageV1({ ...opInput, summary: 'HOST-PRIVATE-SUMMARY' })).toEqual(event)
    await expect(closeTtrpgOpenTableStageV1({ ...opInput, summary: 'changed' })).rejects.toThrow()
    await resumeTtrpgOpenTableV1(opInput)
    const loc = await locator(base);expect(loc.owner).toBe('stage')
    const draft = await prepareTtrpgOpenTableConsequenceV1({ ...loc, request: { bindings: { actor: 'hero' }, alternativeKey: null } })
    await proposeTtrpgOpenTableConsequenceV1({ ...loc, ...draft })
    const approval = (await readTtrpgOpenTableV1(base)).player!.consequenceApprovals[0]
    await confirmTtrpgOpenTableConsequenceV1({ ...loc, ...approval, decision: 'approve' });await resumeTtrpgOpenTableV1(opInput)
    const state = await readProductRuntimeState(base.sessionId)
    expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(JSON.stringify(await readTtrpgOpenTableV1(base))).not.toContain('HOST-PRIVATE-SUMMARY')
    db.close();await db.open();expect(await readProductRuntimeState(base.sessionId)).toEqual(state);await replay(base.sessionId)
  })
  it('permits the actual human GM facade without letting the Session Zero player impersonate that host', async () => {
    const f = await setupPressureEffectFixtureV1({ humanGm: true }), base = input(f), loc = await locator(base), gm = { ...loc, viewerKey: f.gmViewer }
    await expect(readTtrpgOpenTableHostConsequenceV1(loc)).rejects.toThrow()
    expect((await readTtrpgOpenTableHostConsequenceV1(gm)).parameters).toHaveLength(1)
    const draft = await prepareTtrpgOpenTableConsequenceV1({ ...gm, request: { bindings: { actor: 'hero' }, alternativeKey: 'small' } })
    await proposeTtrpgOpenTableConsequenceV1({ ...gm, ...draft })
    expect((await readTtrpgOpenTableV1(base)).player!.consequenceApprovals.map(a => a.actorKey)).toEqual(['hero'])
    await replay(base.sessionId)
  })
})
