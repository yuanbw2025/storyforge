import { openContextPolicyFixtureV1 as contextPolicyFixtureV1 } from '../helpers/open-ttrpg-context'
import { describe, expect, it } from 'vitest'
import { parseTtrpgOpenContextPolicyV1 } from '../../src/lib/ttrpg/open-context-policy'
import { parseTtrpgOpenAuthoringV1 } from '../../src/lib/ttrpg/open-content-authoring'
import { parseTtrpgCampaignContentV2 } from '../../src/lib/ttrpg/campaign-v2'
import { normalizeTtrpgContextTextV1 } from '../../src/lib/ttrpg/context-trigger-contract'
import { openCampaignFixture, openRuleFixture, emptyOpenAuthoringFixture } from '../helpers/ttrpg-open-content'

describe('R-TTRPGOPEN7 immutable authored context policy', () => {
  it('retains old authoring and campaign JSON shape when policy is absent', () => {
    const draft = emptyOpenAuthoringFixture(), campaign = openCampaignFixture()
    expect(parseTtrpgOpenAuthoringV1(draft)).toEqual(draft)
    expect(parseTtrpgCampaignContentV2(campaign, openRuleFixture())).toEqual(campaign)
    expect(parseTtrpgOpenAuthoringV1(draft)).not.toHaveProperty('contextPolicy')
    expect(parseTtrpgCampaignContentV2(campaign, openRuleFixture())).not.toHaveProperty('contextPolicy')
  })
  it('keeps an explicit closed policy in both owner contracts, without reinterpreting it as facts or rules', () => {
    const contextPolicy = contextPolicyFixtureV1(), draft = { ...emptyOpenAuthoringFixture(), contextPolicy }, campaign = { ...openCampaignFixture(), contextPolicy }
    expect(parseTtrpgOpenAuthoringV1(draft).contextPolicy).toEqual(contextPolicy)
    expect(parseTtrpgCampaignContentV2(campaign, openRuleFixture()).contextPolicy).toEqual(contextPolicy)
    expect(campaign.frozenWorldPredicateIndex).toEqual(openCampaignFixture().frozenWorldPredicateIndex)
  })
  it.each([null, { ...contextPolicyFixtureV1(), maximumContextTokens: 255 }, { ...contextPolicyFixtureV1(), maximumContextTokens: 16001 },
    { ...contextPolicyFixtureV1(), normalization: 'caller-defined' }, { ...contextPolicyFixtureV1(), version: 2 },
    { ...contextPolicyFixtureV1(), writeTargets: ['world.facts'] }])('rejects unsupported or unbounded policies (%j)', value => {
    expect(() => parseTtrpgOpenContextPolicyV1(value)).toThrow()
  })
  it('requires explicit CJK phrase opt-in and uses locale-independent Unicode normalization', () => {
    const policy = contextPolicyFixtureV1(); policy.triggers[0].trigger.textPatterns = ['  港口风暴  ']
    expect(() => parseTtrpgOpenContextPolicyV1(policy)).toThrow(/明确启用/)
    policy.cjkTextMatching = 'explicit-phrase'
    expect(parseTtrpgOpenContextPolicyV1(policy).triggers[0].trigger.textPatterns).toEqual(['港口风暴'])
    expect(normalizeTtrpgContextTextV1(' ＳＴＯＲＭ I \n ')).toBe('storm i')
  })
  it('keeps GM-only directives out of actor and party-narrator contracts', () => {
    const policy = contextPolicyFixtureV1(), row = policy.triggers[0]
    row.trigger.audience = 'gm-only'; row.trigger.sourceRefs = []
    expect(() => parseTtrpgOpenContextPolicyV1(policy)).toThrow(/主持私域/)
    row.consumers = ['party-narrator']
    expect(() => parseTtrpgOpenContextPolicyV1(policy)).toThrow(/主持私域/)
    row.consumers = ['gm-assistant']; row.trigger.sourceRefs = ['ttrpgOpenGmOracleInput']
    expect(parseTtrpgOpenContextPolicyV1(policy)).toEqual(policy)
  })
  it('does not let a trigger borrow another consumer or another product source grant', () => {
    const policy = contextPolicyFixtureV1(), row = policy.triggers[0]
    row.trigger.sourceRefs = ['ttrpgOpenGmOracleInput']
    expect(() => parseTtrpgOpenContextPolicyV1(policy)).toThrow(/读取范围/)
    row.trigger.sourceRefs = ['workContext']
    expect(() => parseTtrpgOpenContextPolicyV1(policy)).toThrow(/读取范围/)
    row.consumers = ['actor', 'party-narrator']; row.trigger.sourceRefs = ['ttrpgOpenAuthority']
    expect(() => parseTtrpgOpenContextPolicyV1(policy)).toThrow(/读取范围/)
    row.trigger.sourceRefs = []
    expect(parseTtrpgOpenContextPolicyV1(policy)).toEqual(policy)
  })
  it('rejects duplicate trigger identities and dangling authored actor or predicate references', () => {
    const policy = contextPolicyFixtureV1()
    policy.triggers.push(structuredClone(policy.triggers[0]))
    expect(() => parseTtrpgOpenContextPolicyV1(policy)).toThrow(/重复/)
    policy.triggers.pop()
    policy.triggers[0].trigger.audience = 'private'; policy.triggers[0].trigger.knownByActorKeys = ['unknown.actor']
    expect(() => parseTtrpgCampaignContentV2({ ...openCampaignFixture(), contextPolicy: policy }, openRuleFixture())).toThrow(/未知引用/)
    policy.triggers[0].trigger.knownByActorKeys = ['hero']
    policy.triggers[0].trigger.predicate = { op: 'actor-at', actorKey: 'hero', locationRef: 'unknown.location' }
    expect(() => parseTtrpgCampaignContentV2({ ...openCampaignFixture(), contextPolicy: policy }, openRuleFixture())).toThrow()
  })
})
