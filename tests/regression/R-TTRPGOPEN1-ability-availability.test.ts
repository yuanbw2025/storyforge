import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readyOpenTtrpgSessionV1 } from '../helpers/open-ttrpg-session'
import { ttrpgOpenPredicateContextV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { createTtrpgAbilityRuntimeStateV2, ttrpgAbilityStateKeyV2 } from '../../src/lib/ttrpg/ability-ledger'

describe('R-TTRPGOPEN1 current ability availability', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it.each(['charges', 'cooldown', 'shared-pool', 'resource-cost', 'disabled', 'action-cost'] as const)(
    'uses the current %s owner without consuming an ability while reading predicates', async mode => {
      const fixture = await readyOpenTtrpgSessionV1(`availability ${mode}`)
      const state = await readProductRuntimeState(fixture.sessionId)
      const content = structuredClone(fixture.runtimePackage.ttrpg!)
      const actionKey = content.campaign.characterTemplates.find(actor => actor.characterKey === 'hero')!.actionKeys[0]
      const action = content.rulePack.content.actions.find(action => action.key === actionKey)!
      action.requirements = []
      action.costResourceKey = null; action.costAmount = 0
      action.usage = { mode: 'unlimited', maximum: null, resourceKey: null, cost: null,
        sharedPoolKey: null, cooldownRounds: null, reset: [] }
      const resourceKey = content.rulePack.content.resources[0].key
      if (mode === 'charges') action.usage = { ...action.usage, mode, maximum: 2 }
      if (mode === 'cooldown') action.usage = { ...action.usage, mode, cooldownRounds: 2 }
      if (mode === 'shared-pool') {
        action.usage = { ...action.usage, mode, maximum: 2, sharedPoolKey: 'pool.test', cost: 1 }
        state.ttrpg!.product.usagePools['pool.test'] = { poolKey: 'pool.test', maximum: 2, remaining: 1, lastChangedEventId: null }
      }
      if (mode === 'resource-cost') action.usage = { ...action.usage, mode, resourceKey, cost: 2 }
      if (mode === 'action-cost') { action.costResourceKey = resourceKey; action.costAmount = 2 }
      state.entities.hero.attributes[`resource.${resourceKey}`] = 3
      const ledgerKey = ttrpgAbilityStateKeyV2('hero', actionKey)
      state.ttrpg!.product.abilityStates[ledgerKey] = createTtrpgAbilityRuntimeStateV2({ actorInstanceId: 'hero',
        definition: { abilityKey: actionKey, actionDefinitionKey: actionKey, usage: action.usage } })
      const available = () => ttrpgOpenPredicateContextV1(state, content).actors!.hero.abilityKeys
      const before = structuredClone(state)
      expect(available()).toContain(actionKey)
      expect(available()).toContain(actionKey)
      expect(state).toEqual(before)
      const ability = state.ttrpg!.product.abilityStates[ledgerKey]
      if (mode === 'charges') ability.remainingUses = 0
      if (mode === 'cooldown') ability.cooldownUntilRound = state.ttrpg!.openRun!.worldTime.worldTurn + 1
      if (mode === 'shared-pool') state.ttrpg!.product.usagePools['pool.test'].remaining = 0
      if (mode === 'resource-cost' || mode === 'action-cost') state.entities.hero.attributes[`resource.${resourceKey}`] = 1
      if (mode === 'disabled') ability.disabledReasons = ['disabled.test']
      const exhausted = structuredClone(state)
      expect(available()).not.toContain(actionKey)
      expect(state).toEqual(exhausted)
    },
  )
  it('does not treat a corrupted shared pool identity as an ordinary unavailable ability', async () => {
    const fixture = await readyOpenTtrpgSessionV1('corrupt ability owner')
    const state = await readProductRuntimeState(fixture.sessionId)
    const content = structuredClone(fixture.runtimePackage.ttrpg!)
    const actionKey = content.campaign.characterTemplates.find(actor => actor.characterKey === 'hero')!.actionKeys[0]
    const action = content.rulePack.content.actions.find(action => action.key === actionKey)!
    action.usage = { mode: 'shared-pool', maximum: 2, resourceKey: null, cost: 1,
      sharedPoolKey: 'pool.test', cooldownRounds: null, reset: [] }
    state.ttrpg!.product.usagePools['pool.test'] = { poolKey: 'pool.other', maximum: 2, remaining: 1, lastChangedEventId: null }
    expect(() => ttrpgOpenPredicateContextV1(state, content)).toThrow(/共享次数池索引不一致|共享池身份/)
  })
})
