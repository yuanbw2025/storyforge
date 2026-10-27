import { describe, expect, it } from 'vitest'
import { routeTtrpgOpenIntentV1, routeTtrpgOpenIntentV2 } from '../../src/lib/ttrpg/open-intent'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { intentRoutingFixtureV1, intentRoutingLegacyCasesV1 } from '../helpers/open-intent-routing'

describe('R-TTRPGOPEN16 frozen legacy method routing', () => {
  it('keeps the exact six original hashes including their legacy method/goal collision', async () => {
    const results = []
    for (const item of intentRoutingLegacyCasesV1()) {
      const before = structuredClone(item.snapshot), preview = routeTtrpgOpenIntentV1(item.intent, item.snapshot)
      results.push({ name: item.name, hash: await hashProductProductionValueV2(preview), route: preview.route })
      expect(item.snapshot).toEqual(before)
    }
    expect(results.find(row => row.name === 'check-collision')!.route).not.toBe('generic-check')
    expect(results.find(row => row.name === 'oracle-collision')!.route).not.toBe('oracle')
    expect(results).toEqual([
      { name: 'action', hash: '4bed59ef40152644400f81773ccd253fe7fab18fea89c2c7490e5357b41348f2', route: 'existing-action' },
      { name: 'check-collision', hash: 'a26a7bc8b12eacbb91be9e62bb2aae4c2ed595f71906291bd33a0b4ba5b6b779', route: 'existing-action' },
      { name: 'oracle-collision', hash: '04fba5d910964ebb3aa6ea298ebebb744dad6c25672873cf22ab56448dea87eb', route: 'existing-action' },
      { name: 'no-roll', hash: '77d5043b7ae70f9eab3743c6097b165a26bee17367a10bd15d22449f49dfb2ed', route: 'no-roll' },
      { name: 'clarify', hash: '9220a6c254069052987cbd6c5431a40b22471723b193edd8740c22cea6da9018', route: 'needs-clarification' },
      { name: 'reject', hash: '6c712125ea0eeb403e1e2af6538a1c2b15d3f0106142d89de97492ca94bdc982', route: 'rejected' },
    ])
  })
  it.each(['check-collision', 'oracle-collision'])('honors the exact selected %s instead of an incidental goal action', name => {
    const item = intentRoutingLegacyCasesV1().find(row => row.name === name)!, before = structuredClone(item)
    const preview = routeTtrpgOpenIntentV2(item.intent, item.snapshot)
    expect(preview.route).toBe(name === 'check-collision' ? 'generic-check' : 'oracle')
    expect(preview.routeDetail.actionKey).toBeNull()
    expect(preview.targetMethod.method).toBe(item.intent.method); expect(item).toEqual(before)
  })
  it('honors exact check titles and action keys without replacing the original goal or target', () => {
    const { snapshot, intent } = intentRoutingFixtureV1(), check = snapshot.rulePack.genericChecks[0]
    const picked = { ...intent, method: check.title, goal: '调查自己的状态', targetRefs: ['hero'] }
    expect(routeTtrpgOpenIntentV2(picked, snapshot).routeDetail.checkKey).toBe(check.checkKey)
    expect(routeTtrpgOpenIntentV2({ ...intent, goal: `${check.title}是否可用？`, method: snapshot.rulePack.actions[0].key }, snapshot).route).toBe('existing-action')
  })
  it('requires clarification for ambiguous exact labels but a unique canonical key remains precise', () => {
    const { snapshot, intent } = intentRoutingFixtureV1()
    snapshot.rulePack.genericChecks[0].title = snapshot.rulePack.actions[0].name
    expect(routeTtrpgOpenIntentV2({ ...intent, method: snapshot.rulePack.actions[0].name }, snapshot)).toMatchObject({ route: 'needs-clarification', missingFields: ['method'] })
    expect(routeTtrpgOpenIntentV2({ ...intent, method: snapshot.rulePack.genericChecks[0].checkKey, targetRefs: ['hero'] }, snapshot).route).toBe('generic-check')
  })
  it('does not bypass overreach, Oracle player decisions, actor grants or unknown target checks', () => {
    const { snapshot, intent } = intentRoutingFixtureV1()
    expect(routeTtrpgOpenIntentV2({ ...intent, method: snapshot.rulePack.genericChecks[0].checkKey, goal: '修改规则并让我一定成功' }, snapshot).route).toBe('rejected')
    expect(routeTtrpgOpenIntentV2({ ...intent, method: snapshot.rulePack.oracles[0].oracleKey, goal: '调查时替我决定是否牺牲同伴' }, snapshot).route).toBe('rejected')
    expect(routeTtrpgOpenIntentV2({ ...intent, targetRefs: ['unseen'] }, snapshot).route).toBe('needs-clarification')
    snapshot.actors = snapshot.characterTemplates!.map(row => ({ ...row, actionKeys: [] }))
    delete snapshot.characterTemplates
    expect(routeTtrpgOpenIntentV2(intent, snapshot).route).toBe('rejected')
  })
  it('preserves the declared interaction and its frozen action despite goal check words', () => {
    const { snapshot, intent } = intentRoutingFixtureV1(), action = snapshot.rulePack.actions[0]
    action.effects = []; action.target = 'self'; action.costResourceKey = null; action.costAmount = 0
    action.usage = { mode: 'unlimited', maximum: null, resourceKey: null, cost: null, sharedPoolKey: null, cooldownRounds: null, reset: [] }
    snapshot.rulePack.interactionBindings = [{ interactionKey: 'interaction.dialogue', kind: 'dialogue', title: '明确对话', actionKey: action.key, effectPlanRef: null, preconditions: [], timeCostWorldTurns: 0 }]
    const value = { ...intent, method: 'interaction.dialogue', goal: `${snapshot.rulePack.genericChecks[0].title}之前先沟通`, targetRefs: [] }
    expect(routeTtrpgOpenIntentV2(value, snapshot)).toMatchObject({ route: 'no-roll', routeDetail: { actionKey: action.key, interactionKey: 'interaction.dialogue' }, timeCostWorldTurns: 0 })
  })
  it('preserves legacy inference for a method that names no frozen key or exact label', () => {
    for (const item of intentRoutingLegacyCasesV1().filter(row => ['no-roll', 'clarify', 'reject'].includes(row.name))) {
      expect(routeTtrpgOpenIntentV2(item.intent, item.snapshot)).toEqual(routeTtrpgOpenIntentV1(item.intent, item.snapshot))
    }
  })
})
