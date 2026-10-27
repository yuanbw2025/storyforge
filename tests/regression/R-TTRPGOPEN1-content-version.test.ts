import { describe, expect, expectTypeOf, it } from 'vitest'
import { parseRulePackV2, projectTtrpgRulePackMechanicalCoreV1 } from '../../src/lib/ttrpg/rule-pack-v2'
import { parseTtrpgCampaignContentV2 } from '../../src/lib/ttrpg/campaign-v2'
import { parseTtrpgOpenAuthoringV1 } from '../../src/lib/ttrpg/open-contract-parse'
import { validateTtrpgOpenApprovalBindingsV1 } from '../../src/lib/ttrpg/open-content-references'
import { parseRulePackV1, runRulePackFixturesV1, resolveRulePackDiceModelV1, resolveRulePackCheckV1 } from '../../src/lib/ttrpg/rule-pack'
import { parseTtrpgCampaignContentV1 } from '../../src/lib/ttrpg/campaign'
import { STORYFORGE_RULE_PACK_V1 } from '../../src/lib/ttrpg/storyforge-rule-pack'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createSignedTtrpgCreatorPackageV2, verifyTtrpgCreatorPackageVersionedV1 } from '../../src/lib/ttrpg/creator-sdk'
import { createTtrpgVerifiedContentViewV1, hashTtrpgFrozenPredicateIndexV1 } from '../../src/lib/ttrpg/content-version'
import { openCampaignFixture, openHybridCampaignFixture, openRuleFixture, emptyOpenAuthoringFixture } from '../helpers/ttrpg-open-content'
import type { RulePackV2, TtrpgCampaignContentV2, TtrpgCharacterTemplateV2, TtrpgPredicateV1, TtrpgOpenApprovalActorV1 } from '../../src/lib/ttrpg/open-contract'
import type { TtrpgCharacterTemplateV1, TtrpgEffectPrimitiveV2 } from '../../src/lib/types'
import type { TtrpgOpenEffectPrimitiveV1 } from '../../src/lib/ttrpg/open-contract'
import { effect } from '../../src/lib/ttrpg/open-content-templates'
import { parseTtrpgEffectPlanV2 } from '../../src/lib/ttrpg/effect-plan'

const rule = openRuleFixture()
const campaign = openCampaignFixture()

describe('R-TTRPGOPEN1 actual open effect wire subset', () => {
  it('uses the existing open story subset in the TypeScript contract and parser while retaining the knowledge owner', () => {
    expectTypeOf<Extract<TtrpgOpenEffectPrimitiveV1, { family: 'story' }>['operation']>()
      .toEqualTypeOf<'secret.reveal' | 'quest.set' | 'location.set' | 'world-fact.candidate'>()
    expectTypeOf<Extract<TtrpgEffectPrimitiveV2, { family: 'story' }>['operation']>()
      .toEqualTypeOf<'clue.discover' | 'secret.reveal' | 'quest.set' | 'clock.advance' | 'location.set' | 'world-fact.candidate'>()
    const knowledge = { effectKey: 'knowledge.original', family: 'knowledge', operation: 'knowledge.discover', targetRef: 'hero', evidenceRef: 'clue.harbor' }
    expect(effect(knowledge, 'open knowledge')).toEqual(knowledge)
    expect(() => parseTtrpgCampaignContentV2(openCampaignFixture(), rule)).not.toThrow()
  })
  it.each(['clock.advance', 'clue.discover'])('preserves generic/scripted %s but does not grant it to an open effect template', operation => {
    const primitive = { effectKey: 'legacy.original', family: 'story', operation, targetRef: 'hero', storyKey: 'original', value: 1 }
    const generic = parseTtrpgEffectPlanV2({ schema: 'storyforge.ttrpg-effect-plan', version: 2, planKey: 'legacy.plan', degree: 'success',
      sourceEventId: 'event.1', ruleRef: 'rules.original', reason: '原通用格式', audience: 'party', idempotencyKey: 'legacy.plan', status: 'immediate', effects: [primitive] })
    expect(generic.effects).toEqual([primitive])
    expect(() => effect(primitive, 'open template')).toThrow('枚举无效')
    const c = openCampaignFixture() as unknown as { effectPlanTemplates: { effects: unknown[] }[] }
    c.effectPlanTemplates[0].effects = [primitive]
    expect(() => parseTtrpgCampaignContentV2(c, rule)).toThrow('枚举无效')
  })
})

describe('R-TTRPGOPEN1 frozen shared pools', () => {
  it('rejects missing, unaffordable and conflicting pool definitions without altering V1 parsing', () => {
    const value = openRuleFixture()
    value.actions[0].usage = { mode: 'shared-pool', maximum: null, resourceKey: null, cost: 1,
      sharedPoolKey: 'party.pool', cooldownRounds: null, reset: ['session'] }
    expect(() => parseRulePackV2(value)).toThrow(/maximum/)
    expect(() => parseRulePackV1({ ...STORYFORGE_RULE_PACK_V1, actions: value.actions })).not.toThrow()
    value.actions[0].usage.maximum = 1
    value.actions[0].usage.cost = 2
    expect(() => parseRulePackV2(value)).toThrow(/可支付/)
    value.actions[0].usage.maximum = 3
    const other = structuredClone(value.actions[0])
    other.key = 'other.pool.action'; other.usage.maximum = 4
    value.actions.push(other)
    expect(() => parseRulePackV2(value)).toThrow(/一致/)
    other.usage.maximum = 3; other.usage.reset = ['long-rest']
    expect(() => parseRulePackV2(value)).toThrow(/一致/)
    other.usage.reset = ['session']
    expect(() => parseRulePackV2(value)).not.toThrow()
  })
})

describe('R-TTRPGOPEN1 shared situation timing references', () => {
  it('keeps the frozen parser and runtime S9 on the same subject/predicate identity', () => {
    const c = openCampaignFixture()
    expect(parseTtrpgCampaignContentV2(c, rule).situationTemplates[0].whyNowRefs)
      .toContain('world:harbor:exists')
  })
  it.each(['world:fact.harbor', 'world:harbor:missing', 'world:missing:exists', 'session:event.1'])('rejects unresolvable frozen timing reference %s', ref => {
    const c = openCampaignFixture()
    c.situationTemplates[0].whyNowRefs[0] = ref
    expect(() => parseTtrpgCampaignContentV2(c, rule)).toThrow()
  })
})

describe('R-TTRPGOPEN1 frozen companion approval bindings', () => {
  it('does not broaden private knowledge when party resource approval is allowed', () => {
    const c = openCampaignFixture()
    for (const binding of c.companionPolicy.approvalBindings) binding.partyResourceApprovalAllowed = true
    const fact = c.frozenWorldPredicateIndex.entries[0]
    fact.audience = 'private'; fact.knownByActorKeys = ['hero']
    for (const evidence of c.situationTemplates[0].evidence) {
      evidence.audience = 'private'; evidence.knownByActorKeys = ['hero']
    }
    const parsed = parseTtrpgCampaignContentV2(c, rule)
    expect(parsed.companionPolicy.approvalBindings.every(b => b.partyResourceApprovalAllowed)).toBe(true)
    expect(parsed.frozenWorldPredicateIndex.entries[0].knownByActorKeys).toEqual(['hero'])
    expect(parsed.companionPolicy.confirmationRequiredKinds).toContain('secret-reveal')
    c.situationTemplates[0].evidence[0].knownByActorKeys.push('companion.1')
    expect(() => parseTtrpgCampaignContentV2(c, rule)).toThrow(/private/)
  })
  it('accepts multiple distinct human approvers without mutating input', () => {
    const c = openCampaignFixture()
    const human = structuredClone(c.characterTemplates[0])
    human.characterKey = 'hero.2'; human.seatKey = 'seat.hero.2'; human.characterSheet.characterKey = 'hero.2'
    c.characterTemplates.push(human)
    c.entityBindings.push({ ...structuredClone(c.entityBindings[1]), bindingKey: 'hero.2', templateKey: 'hero.2' })
    c.companionPolicy.approvalBindings[0].approverSeatKeys = ['seat.hero', 'seat.hero.2']
    const before = structuredClone(c)
    const parsed = parseTtrpgCampaignContentV2(c, rule)
    expect(parsed.companionPolicy.approvalBindings[0].approverSeatKeys).toEqual(['seat.hero', 'seat.hero.2'])
    expect(Object.keys(parsed.companionPolicy.approvalBindings[0]).sort()).toEqual(['approverSeatKeys', 'companionActorKey', 'partyResourceApprovalAllowed'])
    parsed.companionPolicy.approvalBindings[0].approverSeatKeys.push('missing')
    expect(c).toEqual(before)
    c.companionPolicy.approvalBindings[0].approverSeatKeys[1] = 'missing'
    expect(() => parseTtrpgCampaignContentV2(c, rule)).toThrow(/批准席位/)
  })
  it('rejects missing and non-player approval identities in the static view', () => {
    const actors: TtrpgOpenApprovalActorV1[] = structuredClone(campaign.characterTemplates)
    actors[3].seatKey = 'seat.keeper'
    actors[3].controller = 'hybrid'
    const policy = structuredClone(campaign.companionPolicy)
    policy.approvalBindings[0].approverSeatKeys = ['seat.keeper']
    expect(() => validateTtrpgOpenApprovalBindingsV1(policy, actors)).toThrow(/非玩家/)
    policy.approvalBindings[0].approverSeatKeys = ['seat.hero']
    actors[1].seatKey = null
    expect(() => validateTtrpgOpenApprovalBindingsV1(policy, actors)).toThrow(/companionActorKey/)
    actors[1].seatKey = 'seat.hero'
    expect(() => validateTtrpgOpenApprovalBindingsV1(policy, actors)).toThrow(/重复/)
  })
  it('parses hybrid companions and approvers from real Campaign JSON', () => {
    const c = openHybridCampaignFixture(), before = structuredClone(c)
    const parsed = parseTtrpgCampaignContentV2(JSON.stringify(c), rule)
    expect(parsed).toEqual(before)
    expect(parsed.characterTemplates.map(a => a.controller)).toEqual(['human', 'hybrid', 'ai', 'gm'])
    expect(() => validateTtrpgOpenApprovalBindingsV1(parsed.companionPolicy, parsed.characterTemplates)).not.toThrow()
    expectTypeOf(parsed.characterTemplates).toEqualTypeOf<TtrpgCharacterTemplateV2[]>()
    expectTypeOf<TtrpgOpenApprovalActorV1>().toEqualTypeOf<Pick<TtrpgCharacterTemplateV2,
      'characterKey' | 'seatKey' | 'role' | 'controller'>>()
    expectTypeOf<TtrpgCharacterTemplateV1['controller']>().toEqualTypeOf<'human' | 'ai' | 'open' | 'gm'>()
    expect(c).toEqual(before)
    c.companionPolicy.approvalBindings[0].approverSeatKeys = ['seat.companion.1']
    expect(() => parseTtrpgCampaignContentV2(JSON.stringify(c), rule)).toThrow(/自批/)
    c.companionPolicy.approvalBindings[0].approverSeatKeys = ['seat.hero']
    c.companionPolicy.approvalBindings.shift()
    expect(() => parseTtrpgCampaignContentV2(JSON.stringify(c), rule)).toThrow(/覆盖/)
  })
  it.each(['mixed', 'Hybrid', '', null, 1, {}, ['hybrid']])('rejects invalid raw controller %j', controller => {
    const invalid = mutateAt(openHybridCampaignFixture(), ['characterTemplates', '1'], row => Reflect.set(row, 'controller', controller))
    expect(() => parseTtrpgCampaignContentV2(JSON.stringify(invalid), rule)).toThrow(/controller/)
  })
  it('rejects hybrid NPCs and missing player seats through the Campaign parser', () => {
    const npc = openHybridCampaignFixture()
    npc.characterTemplates[3].controller = 'hybrid'
    expect(() => parseTtrpgCampaignContentV2(JSON.stringify(npc), rule)).toThrow(/role\/controller\/seat/)
    const player = openHybridCampaignFixture()
    player.characterTemplates[1].seatKey = null
    expect(() => parseTtrpgCampaignContentV2(JSON.stringify(player), rule)).toThrow(/role\/controller\/seat/)
  })
  it('preserves open as a separate controller without companion or approval authority', () => {
    const c = openHybridCampaignFixture()
    const open = structuredClone(c.characterTemplates[0])
    open.characterKey = 'unassigned'; open.seatKey = 'seat.unassigned'; open.controller = 'open'
    open.characterSheet.characterKey = open.characterKey
    c.characterTemplates.push(open)
    c.entityBindings.push({ ...structuredClone(c.entityBindings[1]), bindingKey: open.characterKey, templateKey: open.characterKey })
    expect(parseTtrpgCampaignContentV2(JSON.stringify(c), rule).characterTemplates[4].controller).toBe('open')
    c.companionPolicy.approvalBindings[1].approverSeatKeys = ['seat.unassigned']
    expect(() => parseTtrpgCampaignContentV2(JSON.stringify(c), rule)).toThrow(/human\/hybrid/)
    c.companionPolicy.approvalBindings[1].approverSeatKeys = ['seat.hero']
    c.characterTemplates[1].controller = 'open'
    expect(() => parseTtrpgCampaignContentV2(JSON.stringify(c), rule)).toThrow(/队友数量/)
  })
  it('keeps full character sheet validation for hybrid characters', () => {
    const c = openHybridCampaignFixture()
    c.characterTemplates[1].characterSheet.rules.attributes = {}
    expect(() => parseTtrpgCampaignContentV2(JSON.stringify(c), rule)).toThrow(/角色卡属性/)
  })
  it('preserves hybrid identities through SDK signing, verification and content views', async () => {
    const c = openHybridCampaignFixture()
    c.frozenWorldPredicateIndex.indexHash = await hashTtrpgFrozenPredicateIndexV1(c.frozenWorldPredicateIndex)
    const before = structuredClone(c)
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const pkg = await createSignedTtrpgCreatorPackageV2({
      ...keys, packageId: 'campaign.hybrid', packageVersion: '2.0.0',
      publisherId: 'publisher.hybrid', publisherDisplayName: 'Hybrid fixture',
      rulePack: rule, campaign: parseTtrpgCampaignContentV2(JSON.stringify(c), rule),
    })
    const verified = await verifyTtrpgCreatorPackageVersionedV1({ value: pkg, playerVersion: 2 })
    expect(verified.package.payload.campaign).toEqual(before)
    const view = await createTtrpgVerifiedContentViewV1({
      campaign: c, rulePack: { content: rule, contentHash: await hashProductProductionValueV2(rule) },
      compatibility: { runtimeProtocol: 2, minimumPlayerVersion: 2 },
    })
    expect(view.runFormat).toBe('open')
    expect(view.rawContent.campaign).toEqual(before)
    expect(c).toEqual(before)
    await expect(verifyTtrpgCreatorPackageVersionedV1({ value: pkg, playerVersion: 1 })).rejects.toThrow()
  })
  it('requires draft fields and rejects forged claims or broadened permissions', () => {
    const draft = emptyOpenAuthoringFixture()
    draft.companionPolicy = structuredClone(campaign.companionPolicy)
    const rowPath = ['companionPolicy', 'approvalBindings', '0']
    for (const field of ['companionActorKey', 'approverSeatKeys', 'partyResourceApprovalAllowed']) {
      expect(() => parseTtrpgOpenAuthoringV1(mutateAt(draft, rowPath, row => Reflect.deleteProperty(row, field)))).toThrow()
    }
    expect(() => parseTtrpgOpenAuthoringV1(mutateAt(draft, ['companionPolicy'], row => Reflect.deleteProperty(row, 'approvalBindings')))).toThrow()
    expect(() => parseTtrpgOpenAuthoringV1(mutateAt(draft, ['companionPolicy'], row => Reflect.set(row, 'approvalBindings', null)))).toThrow()
    for (const field of ['claimed', 'accepted', 'revision', 'secretApprovalAllowed']) {
      expect(() => parseTtrpgOpenAuthoringV1(mutateAt(draft, rowPath, row => Reflect.set(row, field, true)))).toThrow()
    }
    for (const value of ['true', 1, null]) {
      expect(() => parseTtrpgOpenAuthoringV1(mutateAt(draft, rowPath, row => Reflect.set(row, 'partyResourceApprovalAllowed', value)))).toThrow()
    }
    draft.companionPolicy.approvalBindings[0].approverSeatKeys = []
    expect(() => parseTtrpgOpenAuthoringV1(draft)).toThrow(/approverSeatKeys/)
  })
  const invalidBindings: Array<[string, (c: TtrpgCampaignContentV2) => void, RegExp]> = [
    ['unknown companion', c => { c.companionPolicy.approvalBindings[0].companionActorKey = 'missing' }, /companionActorKey/],
    ['human is not companion', c => { c.companionPolicy.approvalBindings[0].companionActorKey = 'hero' }, /companionActorKey/],
    ['NPC is not companion', c => { c.companionPolicy.approvalBindings[0].companionActorKey = 'keeper' }, /companionActorKey/],
    ['duplicate companion', c => { c.companionPolicy.approvalBindings[1].companionActorKey = 'companion.1' }, /重复/],
    ['empty approvers', c => { c.companionPolicy.approvalBindings[0].approverSeatKeys = [] }, /approverSeatKeys/],
    ['duplicate approver', c => { c.companionPolicy.approvalBindings[0].approverSeatKeys = ['seat.hero', 'seat.hero'] }, /重复/],
    ['unknown seat', c => { c.companionPolicy.approvalBindings[0].approverSeatKeys = ['missing'] }, /批准席位/],
    ['actor key is not seat', c => { c.companionPolicy.approvalBindings[0].approverSeatKeys = ['hero'] }, /批准席位/],
    ['NPC key is not seat', c => { c.companionPolicy.approvalBindings[0].approverSeatKeys = ['keeper'] }, /批准席位/],
    ['AI self approval', c => { c.companionPolicy.approvalBindings[0].approverSeatKeys = ['seat.companion.1'] }, /自批/],
    ['another AI approval', c => { c.companionPolicy.approvalBindings[0].approverSeatKeys = ['seat.companion.2'] }, /human\/hybrid/],
    ['open is not human', c => { c.characterTemplates[0].controller = 'open' }, /human\/hybrid/],
    ['invalid key', c => { c.companionPolicy.approvalBindings[0].approverSeatKeys = ['seat / invalid'] }, /稳定 key/],
    ['too many approvers', c => { c.companionPolicy.approvalBindings[0].approverSeatKeys = Array.from({ length: 21 }, (_, i) => `seat.${i}`) }, /approverSeatKeys/],
    ['too many bindings', c => { c.companionPolicy.approvalBindings = Array.from({ length: 4 }, (_, i) => ({
      companionActorKey: `companion.${i}`, approverSeatKeys: ['seat.hero'], partyResourceApprovalAllowed: false,
    })) }, /approvalBindings/],
  ]
  it.each(invalidBindings)('rejects %s', (_name, change, error) => {
    const c = openCampaignFixture(); change(c)
    expect(() => parseTtrpgCampaignContentV2(c, rule)).toThrow(error)
  })
  it('permits empty/partial drafts but requires complete Campaign coverage', () => {
    const c = openCampaignFixture(), draft = emptyOpenAuthoringFixture()
    draft.companionPolicy = { ...structuredClone(c.companionPolicy), approvalBindings: [] }
    expect(parseTtrpgOpenAuthoringV1(draft).companionPolicy?.approvalBindings).toEqual([])
    c.companionPolicy.approvalBindings = []
    expect(() => parseTtrpgCampaignContentV2(c, rule)).toThrow(/approvalBindings.*覆盖/)
    draft.companionPolicy.approvalBindings = [structuredClone(campaign.companionPolicy.approvalBindings[0])]
    expect(parseTtrpgOpenAuthoringV1(draft).companionPolicy?.approvalBindings).toHaveLength(1)
    c.companionPolicy.approvalBindings = structuredClone(draft.companionPolicy.approvalBindings)
    expect(() => parseTtrpgCampaignContentV2(c, rule)).toThrow(/approvalBindings.*覆盖/)
  })
})

// Reflect returns unknown to the mutator: malformed inputs never masquerade as domain types.
function objectPaths(value: unknown, path: string[] = []): string[][] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((v: unknown, i) => objectPaths(v, [...path, String(i)]))
  return [path, ...Object.entries(value).flatMap(([k, v]: [string, unknown]) => objectPaths(v, [...path, k]))]
}
function mutateAt(value: unknown, path: string[], mutate: (row: object) => void): unknown {
  const copy: unknown = structuredClone(value)
  let row: unknown = copy
  for (const k of path) {
    if (!row || typeof row !== 'object') throw new Error(`Invalid mutation path ${path.join('.')}`)
    row = Reflect.get(row, k)
  }
  if (!row || typeof row !== 'object') throw new Error('Expected object')
  mutate(row)
  return copy
}
describe('R-TTRPGOPEN1 independent content versions', () => {
  it('parses open content with no scenes/endings, without fabricating nodes or mutating input', () => {
    const before = structuredClone(campaign)
    expect(parseRulePackV2(rule)).toEqual(rule)
    const parsed = parseTtrpgCampaignContentV2(campaign, rule)
    expect(parsed).toEqual(campaign)
    expect(parsed.scenes).toEqual([])
    expect(parsed.endings).toEqual([])
    expect(parsed.openingSceneKey).toBeNull()
    expect(campaign).toEqual(before)
    expect(parseTtrpgCampaignContentV2(JSON.stringify(campaign), rule)).toEqual(parsed)
    parsed.entityBindings[0].audience = 'gm-only'
    expect(campaign.entityBindings[0].audience).toBe('public')
  })
  it('keeps V1 parser and rule identity independent from all V2 additions', async () => {
    const originalHash = await hashProductProductionValueV2(STORYFORGE_RULE_PACK_V1)
    expect(() => parseRulePackV1(rule)).toThrow()
    expect(() => parseRulePackV2(STORYFORGE_RULE_PACK_V1)).toThrow()
    expect(() => parseTtrpgCampaignContentV1(campaign, STORYFORGE_RULE_PACK_V1)).toThrow()
    const projected = projectTtrpgRulePackMechanicalCoreV1(rule)
    expect(projected).toEqual(parseRulePackV1(STORYFORGE_RULE_PACK_V1))
    expect(await hashProductProductionValueV2(projected)).toBe(originalHash)
    expect(runRulePackFixturesV1(projected)).toEqual(runRulePackFixturesV1(STORYFORGE_RULE_PACK_V1))
    const diceInput = { diceModelKey: rule.diceModels[0].key, seed: 'compatibility-seed', nonce: 'compatibility-nonce' }
    expect(await resolveRulePackDiceModelV1({ ...diceInput, rulePack: projected })).toEqual(
      await resolveRulePackDiceModelV1({ ...diceInput, rulePack: STORYFORGE_RULE_PACK_V1 }))
    const checkInput = { seed: 'compatibility-seed', nonce: 'compatibility-check', checkKey: rule.checks[0].key,
      attributeKey: rule.checks[0].attributeKeys[0], attributes: campaign.characterTemplates[0].attributes, difficulty: 10 }
    expect(await resolveRulePackCheckV1({ ...checkInput, rulePack: projected })).toEqual(
      await resolveRulePackCheckV1({ ...checkInput, rulePack: STORYFORGE_RULE_PACK_V1 }))
    const changed = structuredClone(rule)
    changed.oracles[0].title = '不同 Oracle 标题'
    expect(projectTtrpgRulePackMechanicalCoreV1(changed)).toEqual(projected)
    expect(await hashProductProductionValueV2(changed)).not.toBe(await hashProductProductionValueV2(rule))
    expect(await hashProductProductionValueV2(STORYFORGE_RULE_PACK_V1)).toBe(originalHash)
  })
  it('allows an empty author draft, but not an incomplete frozen campaign', () => {
    const draft = emptyOpenAuthoringFixture()
    expect(parseTtrpgOpenAuthoringV1(draft)).toEqual(draft)
    expect(() => parseTtrpgOpenAuthoringV1({ ...draft, unknownPermission: true })).toThrow()
    expect(() => parseTtrpgOpenAuthoringV1({ ...draft, pressure: { clocks: [], fronts: [], value: 10 } })).toThrow()
    expect(() => parseTtrpgCampaignContentV2({ ...campaign, situationTemplates: [] }, rule)).toThrow()
    expect(() => parseTtrpgCampaignContentV2({ ...campaign, companionPolicy: null }, rule)).toThrow()
  })
  for (const [name, input, parse] of [
    ['rule', rule, (v: unknown) => parseRulePackV2(v)],
    ['campaign', campaign, (v: unknown) => parseTtrpgCampaignContentV2(v, rule)],
  ] as const) {
    it(`${name}: rejects unknown fields in every populated nested object`, () => {
      const accepted: string[] = []
      for (const path of objectPaths(input)) {
        const invalid = mutateAt(input, path, row => Reflect.set(row, '__unexpected__', true))
        try { parse(invalid); accepted.push(path.join('.') || '<root>') } catch { /* expected */ }
      }
      expect(accepted).toEqual([])
    })
    it(`${name}: rejects mixed versions and missing top-level fields`, () => {
      for (const field of Object.keys(input)) {
        expect(() => parse(mutateAt(input, [], row => Reflect.deleteProperty(row, field))), field).toThrow()
      }
      expect(() => parse({ ...input, version: 1 })).toThrow()
      expect(() => parse({ ...input, runFormat: 'scripted' })).toThrow()
      expect(() => parse({ ...input, version: '2' })).toThrow()
    })
  }
  const ruleCases: Array<[string, (r: RulePackV2) => void]> = [
    ['unknown dice', r => { r.oracles[0].diceModelKey = 'missing' }],
    ['missing likelihood tier', r => { if (r.oracles[0].likelihood) r.oracles[0].likelihood.defaultTierKey = 'missing' }],
    ['threshold too high', r => { if (r.oracles[0].likelihood) r.oracles[0].likelihood.tiers[0].yesAtOrAbove = 999 }],
    ['threshold too low', r => { if (r.oracles[0].likelihood) r.oracles[0].likelihood.tiers[0].yesAtOrAbove = -1 }],
    ['fractional band', r => { if (r.oracles[0].likelihood) r.oracles[0].likelihood.tiers[0].yesButBand = 0.5 }],
    ['chaos mismatch', r => { r.oracles[0].tests[0].chaosValue = 3 }],
    ['invalid expected entry', r => { r.oracles[0].tests[0].expectedEntryKey = 'missing' }],
    ['remove Oracle safety floor', r => { r.oracles[0].interpretation.forbiddenScopes.pop() }],
    ['new entities limit', r => { r.oracles[0].interpretation.maxNewEntities = 4 }],
    ['missing predicate', r => { r.factPolicy.pop() }],
    ['owner mismatch', r => { r.factPolicy[1].authority.invariant = 'entity' }],
    ['wrong value type', r => { r.factPolicy[1].valueType = 'boolean' }],
    ['multi-object cardinality', r => { r.factPolicy[3].cardinality = 'one' }],
    ['false semantic conflict', r => { r.factPolicy[0].mutuallyExclusiveWith = ['destroyed'] }],
    ['unknown attribute', r => { r.genericChecks[0].actorAttributeKey = 'missing' }],
    ['unknown resource', r => { r.genericChecks[0].resourceCosts = [{ resourceKey: 'missing', amount: 1 }] }],
    ['fractional resource cost', r => { r.genericChecks[0].resourceCosts = [{ resourceKey: r.resources[0].key, amount: 1.5 }] }],
    ['time above limit', r => { r.genericChecks[0].timeCostWorldTurns = 11 }],
    ['nonfinite difficulty', r => { r.genericChecks[0].difficulty = Number.NaN }],
    ['free model difficulty mode', r => { r.genericChecks[0].checkKey = 'not-a-frozen-check' }],
    ['duplicate target kinds', r => { r.genericChecks[0].targetKinds = ['self', 'self'] }],
    ['empty source refs', r => { r.genericChecks[0].sourceRefs = [] }],
    ['social interval overlap', r => { r.socialTierMappings[0].ranges.push({ ...r.socialTierMappings[0].ranges[0] }) }],
    ['social reversed interval', r => { r.socialTierMappings[0].ranges[0].minimum = 101 }],
    ['social unknown tier', r => { r.socialTierMappings[0].defaultTierKey = 'missing' }],
    ['unknown time override action', r => { r.timePolicy.actionOverrides = [{ actionKey: 'missing', timeCostWorldTurns: 1 }] }],
  ]
  it.each(ruleCases)('rejects rule contract violation: %s', (_name, change) => {
    const r = structuredClone(rule); change(r); expect(() => parseRulePackV2(r)).toThrow()
  })
  const campaignCases: Array<[string, (c: TtrpgCampaignContentV2) => void]> = [
    ['private fact without recipient', c => { c.frozenWorldPredicateIndex.entries[0].audience = 'private' }],
    ['private fact unknown recipient', c => { c.frozenWorldPredicateIndex.entries[0].knownByActorKeys = ['missing'] }],
    ['missing source hash', c => { c.frozenWorldPredicateIndex.entries[0].sourceFieldRefs[0].contentHash = 'bad' }],
    ['unknown initial location', c => { c.entityBindings[1].initialLocationRef = 'missing' }],
    ['actor without location', c => { c.entityBindings[1].initialLocationRef = null }],
    ['unknown inventory', c => { c.entityBindings[1].initialInventoryRefs = ['missing'] }],
    ['unknown generic plan', c => { c.effectPlanTemplates[0].planKey = 'missing' }],
    ['wrong degree plan', c => { c.effectPlanTemplates[0].degree = 'failure' }],
    ['undeclared parameter', c => { c.effectPlanTemplates[0].effects[0].targetRef = 'parameter:missing' }],
    ['wrong parameter kind', c => { c.effectPlanTemplates[0].parameters[0].entityKinds = ['location'] }],
    ['unbound parameter source', c => { c.effectPlanTemplates[0].parameters[0].allowedRefs = ['missing'] }],
    ['dynamic source missing', c => { c.effectPlanTemplates[0].parameters[0].allowDynamicFromTemplateKeys = ['missing'] }],
    ['clock has no driver', c => { c.clocks[0].autoAdvance = { onFailedCheck: 0, onIdleWorldTurns: 0, onOracleNo: 0, onStageClose: 0 } }],
    ['clock initial full', c => { c.clocks[0].initialValue = 6 }],
    ['clock auto advance limit', c => { c.clocks[0].autoAdvance.onFailedCheck = 5 }],
    ['clock completion missing', c => { c.clocks[0].onCompleteEffectPlanRef = 'missing' }],
    ['stage unknown clock', c => { c.fronts[0].escalationStages[0].clockKey = 'missing' }],
    ['stage beyond maximum', c => { c.fronts[0].escalationStages[0].atClockValue = 7 }],
    ['stage missing telegraph', c => { c.fronts[0].telegraph = [] }],
    ['telegraph lead minimum', c => { c.fronts[0].telegraph[0].minLeadWorldTurns = 0 }],
    ['unknown driver', c => { c.situationTemplates[0].driverBinding = { kind: 'npc', characterKey: 'hero' } }],
    ['unknown event driver', c => { c.situationTemplates[0].driverBinding = { kind: 'world-event', factRef: 'missing' } }],
    ['cyclic obstacles', c => { c.situationTemplates[0].obstacles[0].dependsOn = ['lamp'] }],
    ['missing causal edge', c => { c.situationTemplates[0].obstacles[1].dependsOn = [] }],
    ['unknown obstacle edge', c => { c.situationTemplates[0].obstacles[1].dependsOn = ['missing'] }],
    ['missing optional evidence', c => { c.situationTemplates[0].evidence[1].isRequired = true }],
    ['duplicate evidence', c => { c.situationTemplates[0].evidence[1].clueRef = c.situationTemplates[0].evidence[0].clueRef }],
    ['private intervention', c => { c.situationTemplates[0].interventionPoints[0].visibleTo = 'private' }],
    ['unknown discovery source', c => { c.situationTemplates[0].evidence[0].sourceFactRefs = ['missing'] }],
    ['unknown discovery path', c => { c.situationTemplates[0].evidence[0].discoveryPolicy.paths[0].interventionPointKey = 'missing' }],
    ['private discovery without recipient', c => { c.situationTemplates[0].evidence[0].discoveryPolicy.allowedAudience = 'private' }],
    ['no consequence', c => { c.situationTemplates[0].noInterventionOutcome.advancesClockKeys = [] }],
    ['unknown consequence', c => { c.situationTemplates[0].consequences[0].nextSituationTemplateKey = 'missing' }],
    ['unknown why now', c => { c.situationTemplates[0].whyNowRefs = ['world:missing', 'clock:flood'] }],
    ['session ref in frozen source', c => { c.situationTemplates[0].whyNowRefs = ['session:event.1', 'clock:flood'] }],
    ['unknown opening', c => { c.openingSituationKeys = ['missing'] }],
    ['companion floor removed', c => { c.companionPolicy.confirmationRequiredKinds.pop() }],
    ['closure limit', c => { c.stageClosurePolicy.maximumWorldTurns = 9 }],
    ['unreachable closure', c => { c.stageClosurePolicy.triggers[0].predicate = { op: 'world-turn-at-least', value: 999 } }],
    ['runtime call budget', c => { c.runtimePolicy.maximumCallsPerEpoch = 9 }],
    ['false invariant of mutable state', c => { c.canonInvariantPredicates = [{ op: 'actor-at', actorKey: 'hero', locationRef: 'harbor' }] }],
  ]
  it.each(campaignCases)('rejects campaign contract violation: %s', (_name, change) => {
    const c = structuredClone(campaign); change(c); expect(() => parseTtrpgCampaignContentV2(c, rule)).toThrow()
  })
  it('rejects every missing or extra degree key, even when null', () => {
    expect(() => parseRulePackV2(mutateAt(rule, ['genericChecks', '0', 'effectPlanByDegree'], row => Reflect.deleteProperty(row, 'failure')))).toThrow()
    expect(() => parseRulePackV2(mutateAt(rule, ['genericChecks', '0', 'effectPlanByDegree'], row => Reflect.set(row, 'automatic', null)))).toThrow()
  })
  it('bounds predicate recursion and rejects unknown operators', () => {
    let predicate: TtrpgPredicateV1 = { op: 'world-turn-at-least', value: 1 }
    for (let i = 0; i < 8; i++) predicate = { op: 'not', of: predicate }
    const c = structuredClone(campaign); c.situationTemplates[0].preconditions = [predicate]
    expect(() => parseTtrpgCampaignContentV2(c, rule)).toThrow(/深度/)
    expect(() => parseTtrpgCampaignContentV2(mutateAt(campaign, ['stageClosurePolicy', 'triggers', '0', 'predicate'], row => Reflect.set(row, 'op', 'relationship-tier')), rule)).toThrow()
  })
  it('requires explicit dynamic templates for Oracle entity allowance and forbids player templates', () => {
    const r = structuredClone(rule); r.oracles[0].interpretation.maxNewEntities = 1
    expect(() => parseTtrpgCampaignContentV2(campaign, r)).toThrow(/maxNewEntities/)
    const c = structuredClone(campaign)
    c.dynamicEntityTemplates = [{ templateKey: 'new.npc', kind: 'actor', characterTemplateKey: 'keeper', itemDefinitionKey: null,
      description: '冻结守灯人模板', parameters: [], maximumNameLength: 80, maximumInstances: 10, audience: 'party', knownByActorKeys: [], sourceRefs: ['world.harbor'] }]
    expect(parseTtrpgCampaignContentV2(c, r).dynamicEntityTemplates).toHaveLength(1)
    c.dynamicEntityTemplates[0].characterTemplateKey = 'hero'
    expect(() => parseTtrpgCampaignContentV2(c, r)).toThrow(/NPC/)
  })
  it('preserves mutable initial location separately from invariants and multi-object facts', () => {
    const c = structuredClone(campaign), base = c.frozenWorldPredicateIndex.entries[0]
    c.frozenWorldPredicateIndex.entries.push({ ...base, factKey: 'fact.location', subjectRef: 'hero', predicateKey: 'located-at',
      canonicalValue: 'harbor', authority: 'initial-state', owner: 'entity' })
    for (const objectRef of ['keeper', 'companion.1']) c.frozenWorldPredicateIndex.entries.push({ ...base, factKey: `fact.knows.${objectRef}`,
      subjectRef: 'hero', predicateKey: 'knows', objectRef, authority: 'initial-state' })
    expect(parseTtrpgCampaignContentV2(c, rule).frozenWorldPredicateIndex.entries).toHaveLength(4)
    c.canonInvariantPredicates.push({ op: 'world-fact', subjectRef: 'hero', predicateKey: 'located-at', objectRef: null, value: 'harbor' })
    expect(() => parseTtrpgCampaignContentV2(c, rule)).toThrow(/初值/)
  })
  it('accepts touching social intervals only with an unshared endpoint', () => {
    const r = structuredClone(rule), m = r.socialTierMappings[0]
    m.ranges = [{ minimum: -100, maximum: 0, minimumInclusive: true, maximumInclusive: false, tierKey: 'even' },
      { minimum: 0, maximum: 100, minimumInclusive: true, maximumInclusive: true, tierKey: 'even' }]
    expect(parseRulePackV2(r).socialTierMappings[0].ranges).toHaveLength(2)
    m.ranges[0].maximumInclusive = true
    expect(() => parseRulePackV2(r)).toThrow(/重叠/)
  })
  it('validates meaning/event entries, weighted bounds and every nested test field', () => {
    const r = structuredClone(rule)
    for (const kind of ['meaning', 'event'] as const) r.oracles.push({
      ...r.oracles[0], oracleKey: `oracle.${kind}`, kind, likelihood: null,
      entries: Array.from({ length: 4 }, (_, i) => ({ entryKey: `entry.${i}`, weight: 10, text: `征兆${i}`, tags: ['征兆'] })),
      tests: [{ testKey: 'weighted.test', seed: 'seed', nonce: 'nonce', chaosValue: null, likelihoodTierKey: null, expectedRawResult: null, expectedEntryKey: 'entry.0' }],
    })
    expect(parseRulePackV2(r).oracles).toHaveLength(3)
    for (const path of objectPaths(r.oracles[1])) {
      expect(() => parseRulePackV2(mutateAt(r, ['oracles', '1', ...path], row => Reflect.set(row, '__unexpected__', true)))).toThrow()
    }
    const table = r.oracles[1]
    table.entries = Array.from({ length: 101 }, (_, i) => ({ entryKey: `entry.${i}`, weight: 1000, text: '征兆', tags: [] }))
    expect(() => parseRulePackV2(r)).toThrow(/总权重/)
    table.entries = [{ entryKey: 'entry.0', weight: 1, text: '不足四条', tags: [] }]
    expect(() => parseRulePackV2(r)).toThrow()
  })
  it('checks all effect families, dynamic parameters and pending alternatives recursively', () => {
    const c = structuredClone(campaign)
    const itemKey = rule.items[0].key
    c.entityBindings.push({ bindingKey: 'item.one', kind: 'item', templateKey: itemKey, sourceResourceRef: null, sourceFieldRefs: [],
      initialLocationRef: null, initialInventoryRefs: [], audience: 'party', knownByActorKeys: [] })
    c.entityBindings[1].initialInventoryRefs = ['item.one']
    c.characterTemplates[0].itemKeys = [itemKey]
    c.characterTemplates[0].characterSheet.rules.itemKeys = [itemKey]
    c.dynamicEntityTemplates.push({ templateKey: 'npc.template', kind: 'actor', characterTemplateKey: 'keeper', itemDefinitionKey: null, description: '合法 NPC 模板',
      parameters: [{ parameterKey: 'occupation', allowedValues: ['看守', '水手'], required: true }], maximumNameLength: 100, maximumInstances: 100,
      audience: 'private', knownByActorKeys: ['hero'], sourceRefs: ['world.harbor'] })
    const t = c.effectPlanTemplates[0]
    t.parameters[0].allowDynamicFromTemplateKeys = ['npc.template']
    t.effects.push(
      { effectKey: 'condition', family: 'condition', operation: 'condition.apply', targetRef: 'hero', conditionKey: rule.conditions[0].key, stacks: 1, duration: 1 },
      { effectKey: 'item', family: 'item', operation: 'item.transfer', targetRef: 'hero', itemDefinitionRef: null, itemInstanceRef: 'item.one', destinationRef: 'keeper', amount: 1 },
      { effectKey: 'ability', family: 'ability', operation: 'usage.consume', targetRef: 'hero', abilityKey: rule.actions[0].key, amount: 1, clockRef: null },
      { effectKey: 'advancement', family: 'advancement', operation: 'xp', targetRef: 'hero', advancementKey: rule.advancement.currencyKey, amount: 1 },
      { effectKey: 'social', family: 'social', operation: 'relationship', targetRef: 'hero', socialKey: 'trust', amount: 1 },
      { effectKey: 'location', family: 'story', operation: 'location.set', targetRef: 'hero', storyKey: 'harbor', value: 'harbor' },
      { effectKey: 'knowledge', family: 'knowledge', operation: 'knowledge.discover', targetRef: 'hero', evidenceRef: 'evidence.door' },
    )
    c.effectPlanTemplates.push({ ...structuredClone(t), planKey: 'plan.choice', effects: [],
      alternatives: [{ alternativeKey: 'a', title: '恢复', effects: [structuredClone(t.effects[0])] },
        { alternativeKey: 'b', title: '了解', effects: [structuredClone(t.effects[7])] }] })
    expect(parseTtrpgCampaignContentV2(c, rule).effectPlanTemplates).toHaveLength(2)
    for (const field of ['effectPlanTemplates', 'dynamicEntityTemplates']) {
      const values: unknown = Reflect.get(c, field)
      for (const path of objectPaths(values)) {
        expect(() => parseTtrpgCampaignContentV2(mutateAt(c, [field, ...path], row => Reflect.set(row, '__unexpected__', true)), rule)).toThrow()
      }
    }
    const itemEffect = t.effects.find(e => e.family === 'item')
    if (!itemEffect || itemEffect.family !== 'item') throw new Error('fixture item')
    itemEffect.itemInstanceRef = null
    expect(() => parseTtrpgCampaignContentV2(c, rule)).toThrow(/实例引用/)
    itemEffect.itemInstanceRef = 'item.one'
    const abilityEffect = t.effects.find(e => e.family === 'ability')
    if (!abilityEffect || abilityEffect.family !== 'ability') throw new Error('fixture ability')
    abilityEffect.amount = null
    expect(() => parseTtrpgCampaignContentV2(c, rule)).toThrow(/正 amount/)
  })
  it('rejects missing fields throughout the new contract, including nullable fields', () => {
    const roots = ['frozenWorldPredicateIndex', 'entityBindings', 'effectPlanTemplates', 'clocks', 'fronts', 'situationTemplates',
      'companionPolicy', 'stageClosurePolicy', 'runtimePolicy']
    for (const root of roots) {
      const value: unknown = Reflect.get(campaign, root)
      for (const path of objectPaths(value)) {
        let row: unknown = value
        for (const part of path) {
          if (!row || typeof row !== 'object') throw new Error('fixture path')
          row = Reflect.get(row, part)
        }
        if (!row || typeof row !== 'object') throw new Error('fixture object')
        for (const field of Object.keys(row)) {
          if (field === 'value' && Reflect.get(row, 'op') === 'world-fact') continue
          expect(() => parseTtrpgCampaignContentV2(mutateAt(campaign, [root, ...path], target => Reflect.deleteProperty(target, field)), rule),
            `${root}.${path.join('.')}.${field}`).toThrow()
        }
      }
    }
  })
  it('keeps private source recipients closed until an explicit runtime discovery', () => {
    const c = structuredClone(campaign)
    c.frozenWorldPredicateIndex.entries[0].audience = 'private'
    c.frozenWorldPredicateIndex.entries[0].knownByActorKeys = ['hero']
    expect(() => parseTtrpgCampaignContentV2(c, rule)).toThrow(/密级/)
    for (const e of c.situationTemplates[0].evidence) {
      e.audience = 'private'; e.knownByActorKeys = ['hero']
    }
    expect(parseTtrpgCampaignContentV2(c, rule).situationTemplates[0].evidence[0].knownByActorKeys).toEqual(['hero'])
    c.situationTemplates[0].evidence[0].knownByActorKeys.push('companion.1')
    expect(() => parseTtrpgCampaignContentV2(c, rule)).toThrow(/private/)
    c.situationTemplates[0].evidence[0].audience = 'gm-only'
    expect(parseTtrpgCampaignContentV2(c, rule).situationTemplates[0].evidence[0].audience).toBe('gm-only')
  })
  it('checks invariant logic without mistaking a negated false value for conflict', () => {
    const c = structuredClone(campaign)
    c.canonInvariantPredicates = [{ op: 'not', of: { op: 'world-fact', subjectRef: 'harbor', predicateKey: 'exists', objectRef: null, value: false } }]
    expect(parseTtrpgCampaignContentV2(c, rule).canonInvariantPredicates).toEqual(c.canonInvariantPredicates)
    c.canonInvariantPredicates = [{ op: 'not', of: campaign.canonInvariantPredicates[0] }]
    expect(() => parseTtrpgCampaignContentV2(c, rule)).toThrow(/冲突/)
  })
})
