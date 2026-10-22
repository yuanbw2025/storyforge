import { beforeEach,afterEach,describe,it,expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { seedPrivateChoiceFixtureV1 } from '../helpers/open-ttrpg-private-choice'
import { setup,start } from '../helpers/open-ttrpg-knowledge'
import { readProductRuntimeState,parseProductRuntimeState,replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { readTtrpgOpenTableV1,prepareTtrpgOpenTablePrivateChoiceV1,discloseTtrpgOpenTablePrivateChoiceV1,chooseTtrpgOpenTableConsequenceV1 } from '../../src/lib/ttrpg/open-table-service'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { rt,forkAndStart,approve } from '../helpers/open-ttrpg-branch-recovery'
import { parseTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation'
import { currentTtrpgOpenPrivateChoiceV1,verifyTtrpgOpenPrivateChoiceHashesV1 } from '../../src/lib/ttrpg/open-private-choice'
import { applyTtrpgOpenPrivateChoiceDisclosureEventV1 } from '../../src/lib/ttrpg/open-private-choice-reducer'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'

describe('R-TTRPGOPEN4 explicit private result informed choice', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => db.close())
  it.each([true,false])('discloses necessary cost only with real human host authority (%s), then the player pays once', async humanGm => {
    const x = await seedPrivateChoiceFixtureV1({ humanGm }),before = await readProductRuntimeState(x.f.sessionId)
    expect((await readTtrpgOpenTableV1(x.player)).player!.operation!.risk.choices).toEqual([])
    const prepared = await prepareTtrpgOpenTablePrivateChoiceV1({ ...x.host,...x.locator })
    expect(prepared.alternatives.map(a => a.lines.join(''))).toEqual([expect.stringContaining('消耗 1'),expect.stringContaining('消耗 2')])
    expect(JSON.stringify(prepared)).not.toMatch(/OTHER-PRIVATE-PROFILE|mechanicalBasisJson|ruleSourceRef|"dice"|"outcome"/)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    const receipt = await discloseTtrpgOpenTablePrivateChoiceV1({ ...x.host,...x.locator,reviewHash: prepared.reviewHash })
    expect(await discloseTtrpgOpenTablePrivateChoiceV1({ ...x.host,...x.locator,reviewHash: prepared.reviewHash })).toEqual(receipt)
    const view = await readTtrpgOpenTableV1(x.player),op = view.player!.operation!,choice = op.risk.choices[0]
    expect(choice).toMatchObject({ disclosureHash: prepared.reviewHash,canChoose: true });expect(op.risk.privateRoll).toBe(true)
    expect(JSON.stringify(await loadTtrpgOpenPlayerContextV1({ scope: x.f.scope,sessionId: x.f.sessionId,actorKey: 'hero' }))).not.toMatch(/privateChoiceDisclosures|mechanicalBasisJson|OTHER-PRIVATE-PROFILE/)
    const afterDisclosure = await readProductRuntimeState(x.f.sessionId)
    expect(afterDisclosure.entities).toEqual(before.entities);expect(rt(afterDisclosure).openRun!.knowledge).toEqual(rt(before).openRun!.knowledge)
    const input = { ...x.player,...x.locator,riskHash: op.riskHash,disclosureHash: prepared.reviewHash,alternativeKey: 'large' }
    const selected = await chooseTtrpgOpenTableConsequenceV1(input)
    expect(await chooseTtrpgOpenTableConsequenceV1(input)).toEqual(selected)
    await resumeTtrpgOpenOperationV1(x.command)
    const after = await readProductRuntimeState(x.f.sessionId),resource = x.f.runtimePackage.ttrpg!.rulePack.content.resources[0].key
    expect(Number(after.entities.hero.attributes[`resource.${resource}`])).toBe(Number(before.entities.hero.attributes[`resource.${resource}`]) - 2)
    expect(rt(after).openRun!.ruleReceipts).toEqual(rt(before).openRun!.ruleReceipts)
    await resumeTtrpgOpenOperationV1(x.command);expect(await readProductRuntimeState(x.f.sessionId)).toEqual(after)
    const row = (await db.productRuntimeSessions.get(x.f.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson),await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).sortBy('sequence'))).toEqual(after)
  })
  it('rejects unauthorized disclosure, a blind choice, wrong hash and actor substitution without changing state', async () => {
    const x = await seedPrivateChoiceFixtureV1(),before = await readProductRuntimeState(x.f.sessionId),op = rt(before).openRun!.operations[0]
    await expect(prepareTtrpgOpenTablePrivateChoiceV1({ ...x.player,...x.locator })).rejects.toThrow()
    await expect(chooseTtrpgOpenTableConsequenceV1({ ...x.player,...x.locator,riskHash: op.riskHash,alternativeKey: 'small' })).rejects.toThrow()
    const prepared = await prepareTtrpgOpenTablePrivateChoiceV1({ ...x.host,...x.locator })
    await expect(discloseTtrpgOpenTablePrivateChoiceV1({ ...x.host,...x.locator,reviewHash: 'f'.repeat(64) })).rejects.toThrow(/变化/)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    await discloseTtrpgOpenTablePrivateChoiceV1({ ...x.host,...x.locator,reviewHash: prepared.reviewHash })
    const disclosed = await readProductRuntimeState(x.f.sessionId)
    await expect(chooseTtrpgOpenTableConsequenceV1({ ...x.host,...x.locator,riskHash: op.riskHash,alternativeKey: 'small',disclosureHash: prepared.reviewHash })).rejects.toThrow()
    await expect(chooseTtrpgOpenTableConsequenceV1({ ...x.player,...x.locator,riskHash: op.riskHash,alternativeKey: 'small',disclosureHash: 'f'.repeat(64) })).rejects.toThrow()
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(disclosed)
  })
  it('rejects a forged disclosure body and makes a real disclosure stale when mechanical state changes', async () => {
    const x = await seedPrivateChoiceFixtureV1({ hidden: true }),before = await readProductRuntimeState(x.f.sessionId)
    const prepared = await prepareTtrpgOpenTablePrivateChoiceV1({ ...x.host,...x.locator })
    expect(JSON.stringify(prepared)).not.toContain('PRIVATE-GM')
    await discloseTtrpgOpenTablePrivateChoiceV1({ ...x.host,...x.locator,reviewHash: prepared.reviewHash })
    const event = (await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).sortBy('sequence')).find(e => e.type === 'ttrpg.open.choice.disclosed')!
    const payload = JSON.parse(event.payloadJson);payload.disclosure.body.alternatives[0].lines = ['免费，不产生后果']
    expect(() => applyTtrpgOpenPrivateChoiceDisclosureEventV1(structuredClone(before),event,payload)).toThrow(/不一致/)
    const badHash = rt(await readProductRuntimeState(x.f.sessionId)).openRun!.operations
    badHash[0].privateChoiceDisclosures![0].reviewHash = 'f'.repeat(64)
    await expect(verifyTtrpgOpenPrivateChoiceHashesV1(badHash)).rejects.toThrow(/hash/)
    const changed = await readProductRuntimeState(x.f.sessionId),runtime = rt(changed),operation = runtime.openRun!.operations[0]
    const resource = x.f.runtimePackage.ttrpg!.rulePack.content.resources[0].key;changed.entities.hero.attributes[`resource.${resource}`] = Number(changed.entities.hero.attributes[`resource.${resource}`]) - 1
    expect(currentTtrpgOpenPrivateChoiceV1({ state: changed,runtime,operation,kind: 'knowledge',templateKey: x.locator.templateKey })).toBeNull()
    const legacy = structuredClone(opFrom(before));delete legacy.privateChoiceDisclosures
    expect(parseTtrpgOpenOperationV1(legacy)).not.toHaveProperty('privateChoiceDisclosures')
  })
  it('restores the actual scoped disclosure through a complete backup and still requires the player choice', async () => {
    const x = await seedPrivateChoiceFixtureV1(),prepared = await prepareTtrpgOpenTablePrivateChoiceV1({ ...x.host,...x.locator })
    await discloseTtrpgOpenTablePrivateChoiceV1({ ...x.host,...x.locator,reviewHash: prepared.reviewHash })
    const projectId = await importProjectJSON(await exportProjectJSON(x.f.scope.projectId)),session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const input = { scope: { projectId,worldId: session.worldId,workId: session.workId },sessionId: session.id!,viewerKey: x.player.viewerKey }
    const op = (await readTtrpgOpenTableV1(input)).player!.operation!
    expect(op.risk.choices[0].disclosureHash).toBe(prepared.reviewHash)
    await chooseTtrpgOpenTableConsequenceV1({ ...input,...x.locator,riskHash: op.riskHash,alternativeKey: 'small',disclosureHash: prepared.reviewHash })
    expect(rt(await readProductRuntimeState(x.f.sessionId)).openRun!.operations[0].discoveryChoices).toBeUndefined()
  })
  it('does not reuse a parent disclosure in a newly authorized child and retains the original roll', async () => {
    const x = await seedPrivateChoiceFixtureV1(),prepared = await prepareTtrpgOpenTablePrivateChoiceV1({ ...x.host,...x.locator })
    await discloseTtrpgOpenTablePrivateChoiceV1({ ...x.host,...x.locator,reviewHash: prepared.reviewHash })
    const parent = await readProductRuntimeState(x.f.sessionId),child = await forkAndStart(x.f.sessionId)
    await approve(child.sessionId,child.op.operationKey)
    const command = { sessionId: child.sessionId,operationKey: child.op.operationKey,frozenPlanHash: child.op.planHash,viewerKey: x.player.viewerKey }
    await resumeTtrpgOpenOperationV1(command)
    const player = { ...x.player,sessionId: child.sessionId },host = { ...x.host,sessionId: child.sessionId },locator = { ...x.locator,operationKey: child.op.operationKey }
    const op = (await readTtrpgOpenTableV1(player)).player!.operation!
    expect(op.risk.choices).toEqual([])
    await expect(chooseTtrpgOpenTableConsequenceV1({ ...player,...locator,riskHash: op.riskHash,alternativeKey: 'small',disclosureHash: prepared.reviewHash })).rejects.toThrow()
    const fresh = await prepareTtrpgOpenTablePrivateChoiceV1({ ...host,...locator })
    expect(fresh.reviewHash).not.toBe(prepared.reviewHash)
    await discloseTtrpgOpenTablePrivateChoiceV1({ ...host,...locator,reviewHash: fresh.reviewHash })
    await chooseTtrpgOpenTableConsequenceV1({ ...player,...locator,riskHash: op.riskHash,alternativeKey: 'small',disclosureHash: fresh.reviewHash })
    await resumeTtrpgOpenOperationV1(command)
    expect(rt(await readProductRuntimeState(child.sessionId)).openRun!.ruleReceipts[0].result).toEqual(rt(parent).openRun!.ruleReceipts[0].result)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(parent)
  })
  it('uses the same informed consent for an actual main action effect choice', async () => {
    const f = await setup({ generic: true },p => {
      p.ttrpg!.campaign.gmMode = 'human';p.ttrpg!.campaign.informationPolicy.hiddenDice = 'gm-only'
      const check = p.ttrpg!.rulePack.content.genericChecks[0]
      const original = p.ttrpg!.campaign.effectPlanTemplates.find(t => t.planKey === 'plan.success')!,resource = p.ttrpg!.rulePack.content.resources[0].key
      for (const degree of Object.keys(check.effectPlanByDegree) as Array<keyof typeof check.effectPlanByDegree>) {
        const t = structuredClone(original);t.planKey = `plan.private.${degree}`;t.degree = degree
        t.effects = [];t.alternatives = [{ alternativeKey: 'first',title: '一种代价',effects: [{ effectKey: 'first.cost',family: 'numeric',operation: 'resource.spend',targetRef: 'parameter:actor',valueKey: resource,amount: 1 }] },
          { alternativeKey: 'second',title: '另一种代价',effects: [{ effectKey: 'second.cost',family: 'numeric',operation: 'resource.spend',targetRef: 'parameter:actor',valueKey: resource,amount: 2 }] }]
        p.ttrpg!.campaign.effectPlanTemplates.push(t);check.effectPlanByDegree[degree] = t.planKey
      }
    })
    f.request.effectBindings = Object.fromEntries(Object.values(f.runtimePackage.ttrpg!.rulePack.content.genericChecks[0].effectPlanByDegree).filter((key): key is string => key !== null).map(key => [key,{ actor: 'hero' }]))
    const command = await start(f);expect(await resumeTtrpgOpenOperationV1(command)).toMatchObject({ status: 'awaiting-choice',nextStepKey: 'effect' })
    const player = { scope: f.scope,sessionId: f.sessionId,viewerKey: command.viewerKey },host = { ...player,viewerKey: 'viewer.gm' },locator = { operationKey: command.operationKey,kind: 'effect' as const,templateKey: rt(await readProductRuntimeState(f.sessionId)).openRun!.operations[0].pendingChoice!.templateKey }
    const before = await readProductRuntimeState(f.sessionId),prepared = await prepareTtrpgOpenTablePrivateChoiceV1({ ...host,...locator })
    await discloseTtrpgOpenTablePrivateChoiceV1({ ...host,...locator,reviewHash: prepared.reviewHash })
    const op = (await readTtrpgOpenTableV1(player)).player!.operation!
    await chooseTtrpgOpenTableConsequenceV1({ ...player,...locator,riskHash: op.riskHash,alternativeKey: 'second',disclosureHash: prepared.reviewHash })
    await resumeTtrpgOpenOperationV1(command)
    const after = await readProductRuntimeState(f.sessionId),resource = f.runtimePackage.ttrpg!.rulePack.content.resources[0].key
    expect(Number(after.entities.hero.attributes[`resource.${resource}`])).toBe(Number(before.entities.hero.attributes[`resource.${resource}`]) - 2)
    expect(rt(after).openRun!.ruleReceipts).toEqual(rt(before).openRun!.ruleReceipts)
  })
})
function opFrom(state: Awaited<ReturnType<typeof readProductRuntimeState>>) { return rt(state).openRun!.operations[0] }
