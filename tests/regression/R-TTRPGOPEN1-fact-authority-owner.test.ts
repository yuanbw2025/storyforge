import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readyOpenTtrpgSessionV1 } from '../helpers/open-ttrpg-session'
import { projectTtrpgOpenWorldFactsV1, ttrpgOpenSocialFactBalanceKeyV1 } from '../../src/lib/ttrpg/open-fact-authority'
import { evaluateTtrpgPredicateV1 } from '../../src/lib/ttrpg/predicate'
import { ttrpgOpenPredicateContextV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { projectTtrpgRulePackMechanicalCoreV1 } from '../../src/lib/ttrpg/rule-pack-v2'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'
import type { TtrpgOpenFrozenFactV1 } from '../../src/lib/ttrpg/open-contract'
function initial(overrides: Partial<TtrpgOpenFrozenFactV1>): TtrpgOpenFrozenFactV1 {
  return { factKey: 'fact.hero.location', subjectRef: 'hero', predicateKey: 'located-at', objectRef: null,
    canonicalValue: 'harbor', authority: 'initial-state', owner: 'entity', audience: 'public', knownByActorKeys: [],
    sourceResourceRefs: [], sourceFieldRefs: [], ...overrides }
}
describe('R-TTRPGOPEN1 runtime fact owner adapters', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('reads current location while preserving the frozen index and immutable semantic identity', async () => {
    const fixture = await readyOpenTtrpgSessionV1('location fact owner', pkg => {
      pkg.ttrpg!.campaign.frozenWorldPredicateIndex.entries.push(initial({}))
      pkg.ttrpg!.campaign.entityBindings.push({ bindingKey: 'market', templateKey: 'market', kind: 'location',
        sourceResourceRef: null, sourceFieldRefs: [], initialLocationRef: null, initialInventoryRefs: [], audience: 'public', knownByActorKeys: [] })
    })
    const content = fixture.runtimePackage.ttrpg!
    const originalIndex = structuredClone(content.campaign.frozenWorldPredicateIndex)
    const state = await readProductRuntimeState(fixture.sessionId)
    const predicate = { op: 'world-fact' as const, subjectRef: 'hero', predicateKey: 'located-at' as const, objectRef: null, value: 'harbor' }
    expect(evaluateTtrpgPredicateV1(predicate, ttrpgOpenPredicateContextV1(state, content))).toBe(true)
    state.entities.hero.locationKey = 'market'
    state.entities.harbor.lifecycleStatus = 'destroyed'
    const context = ttrpgOpenPredicateContextV1(state, content)
    expect(evaluateTtrpgPredicateV1(predicate, context)).toBe(false)
    expect(evaluateTtrpgPredicateV1({ ...predicate, value: 'market' }, context)).toBe(true)
    expect(evaluateTtrpgPredicateV1({ op: 'world-fact', subjectRef: 'harbor', predicateKey: 'exists', objectRef: null, value: true }, context)).toBe(true)
    expect(content.campaign.frozenWorldPredicateIndex).toEqual(originalIndex)
  })
  it('initializes social balances once, then reads the real ledger without mutating it', async () => {
    const allied = initial({ factKey: 'fact.hero.allied', predicateKey: 'allied-with', owner: 'social-ledger', objectRef: 'keeper', canonicalValue: true })
    const hostile = { ...allied, factKey: 'fact.hero.hostile', predicateKey: 'hostile-to' as const, canonicalValue: false }
    const fixture = await readyOpenTtrpgSessionV1('social fact owner', pkg => pkg.ttrpg!.campaign.frozenWorldPredicateIndex.entries.push(allied, hostile))
    const state = await readProductRuntimeState(fixture.sessionId), content = fixture.runtimePackage.ttrpg!
    const key = ttrpgOpenSocialFactBalanceKeyV1(allied)
    expect(state.ttrpg!.product.effectLedger.socialBalances[key]).toBe(1)
    state.ttrpg!.product.effectLedger.socialBalances[key] = -2
    const before = structuredClone(state)
    const projection = projectTtrpgOpenWorldFactsV1({ state, content, sessionFacts: [] })
    expect(projection.find(fact => fact.predicateKey === 'allied-with')!.canonicalValue).toBe(false)
    expect(projection.find(fact => fact.predicateKey === 'hostile-to')!.canonicalValue).toBe(true)
    expect(state).toEqual(before)
  })
  it('initializes physical location flags and rejects conflicting frozen character HP', async () => {
    const fixture = await readyOpenTtrpgSessionV1('physical fact owner', pkg => {
      pkg.ttrpg!.campaign.frozenWorldPredicateIndex.entries.push(initial({ factKey: 'fact.harbor.open', subjectRef: 'harbor', predicateKey: 'open', canonicalValue: true }))
    })
    const state = await readProductRuntimeState(fixture.sessionId), content = fixture.runtimePackage.ttrpg!
    expect(state.entities.harbor.attributes['ttrpg.open.open']).toBe(true)
    state.entities.harbor.attributes['ttrpg.open.open'] = false
    expect(projectTtrpgOpenWorldFactsV1({ state, content, sessionFacts: [] }).find(fact => fact.predicateKey === 'open')!.canonicalValue).toBe(false)
    await expect(readyOpenTtrpgSessionV1('bad damage owner', pkg => pkg.ttrpg!.campaign.frozenWorldPredicateIndex.entries.push(
      initial({ factKey: 'fact.hero.damaged', predicateKey: 'damaged', canonicalValue: 999999 })))).rejects.toThrow(/owner 冲突/)
  })
  it('reads ownership and damage from the existing inventory owner after transfer and repair', async () => {
    const fixture = await readyOpenTtrpgSessionV1('inventory facts', pkg => {
      const content = pkg.ttrpg!
      const item = content.rulePack.content.items[0]
      item.mechanics.maximumDurability = 10
      const core = projectTtrpgRulePackMechanicalCoreV1(content.rulePack.content)
      const hero = content.campaign.characterTemplates.find(actor => actor.characterKey === 'hero')!
      hero.itemKeys = [item.key]
      const { characterSheet: _sheet, ...template } = hero
      hero.characterSheet = createCompleteTtrpgCharacterSheetV2({ template, rulePack: core })
      content.campaign.entityBindings.find(binding => binding.bindingKey === 'hero')!.initialInventoryRefs = ['item.starting']
      content.campaign.entityBindings.push({ bindingKey: 'item.starting', sourceResourceRef: null, kind: 'item',
        templateKey: item.key, initialLocationRef: null, initialInventoryRefs: [], sourceFieldRefs: [], audience: 'party', knownByActorKeys: [] })
      content.campaign.frozenWorldPredicateIndex.entries.push(
        initial({ factKey: 'fact.item.owns', subjectRef: 'item.starting', predicateKey: 'owns', owner: 'inventory', canonicalValue: 'hero' }),
        initial({ factKey: 'fact.item.damage', subjectRef: 'item.starting', predicateKey: 'damaged', canonicalValue: 3 }))
    })
    const state = await readProductRuntimeState(fixture.sessionId), content = fixture.runtimePackage.ttrpg!
    const inventory = state.ttrpg!.product.inventory.items['item.starting']
    expect(inventory.durability).toBe(7)
    inventory.ownerRef = 'companion.1'; inventory.durability = 10
    const projection = projectTtrpgOpenWorldFactsV1({ state, content, sessionFacts: [] })
    expect(projection.find(fact => fact.predicateKey === 'owns')!.canonicalValue).toBe('companion.1')
    expect(projection.find(fact => fact.predicateKey === 'damaged')!.canonicalValue).toBe(0)
    inventory.quantity = 0; inventory.ownerRef = null
    expect(projectTtrpgOpenWorldFactsV1({ state, content, sessionFacts: [] }).some(fact => fact.predicateKey === 'owns')).toBe(false)
  })

})
