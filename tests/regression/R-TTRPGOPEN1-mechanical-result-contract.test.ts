import { describe, expect, it } from 'vitest'
import { parseTtrpgMechanicalResultV1 } from '../../src/lib/ttrpg/rule-action-mechanical'
import { createTtrpgAbilityRuntimeStateV2, ttrpgAbilityStateKeyV2 } from '../../src/lib/ttrpg/ability-ledger'
describe('R-TTRPGOPEN1 shared mechanical result identity', () => {
  it('accepts valid maximum-length compound ability keys and rejects mixed actor/ability identities', () => {
    const actorInstanceId = 'a'.repeat(200), abilityKey = 'b'.repeat(200)
    const before = createTtrpgAbilityRuntimeStateV2({ actorInstanceId, definition: { abilityKey, actionDefinitionKey: abilityKey,
      usage: { mode: 'unlimited', maximum: null, resourceKey: null, cost: null, sharedPoolKey: null, cooldownRounds: null, reset: [] } } })
    const value = { outcome: 'automatic', check: null, resourceChanges: [], conditionChanges: [],
      abilityChange: { stateKey: ttrpgAbilityStateKeyV2(actorInstanceId, abilityKey), before, after: { ...before, lastUsedEventId: 'event.1' },
        sharedPoolKey: null, sharedPoolBefore: null, sharedPoolAfter: null } }
    expect(parseTtrpgMechanicalResultV1(value).abilityChange!.stateKey).toHaveLength(402)
    expect(() => parseTtrpgMechanicalResultV1({ ...value, abilityChange: { ...value.abilityChange, stateKey: 'another.actor::another.ability' } })).toThrow(/身份/)
    expect(() => parseTtrpgMechanicalResultV1({ ...value, abilityChange: { ...value.abilityChange, after: { ...before, actorInstanceId: 'another.actor' } } })).toThrow(/身份/)
  })
})
