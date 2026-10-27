import { describe, expect, it } from 'vitest'
import {
  assertTtrpgSituationInstanceGatesV1,
  instantiateTtrpgSituationV1,
  parseTtrpgSituationTemplateV1,
} from '../../src/lib/ttrpg/situation-engine'
import type { TtrpgPredicateEvaluationContextV1 } from '../../src/lib/ttrpg/predicate'
import { openCampaignFixture, openRuleFixture } from '../helpers/ttrpg-open-content'

function contextFor(campaign: ReturnType<typeof openCampaignFixture>): TtrpgPredicateEvaluationContextV1 {
  return {
    frozenWorldPredicateIndex: campaign.frozenWorldPredicateIndex,
    sessionFacts: [],
    effectLedger: { storyFacts: {}, socialBalances: {} },
    pressure: {
      clocks: { flood: { value: 0, visibility: 'party' } },
      fronts: {
        storm: {
          currentStageKey: null,
          escalationStages: campaign.fronts[0].escalationStages.map(stage => ({ stageKey: stage.stageKey })),
          telegraphWorldTurns: { wind: 0 },
        },
      },
    },
    actors: {
      hero: { locationRef: 'harbor', itemKeys: [], abilityKeys: [], resources: {} },
      keeper: { locationRef: 'harbor', itemKeys: [], abilityKeys: [], resources: {} },
    },
    situations: {
      active: [],
      templates: campaign.situationTemplates.map(template => ({
        templateKey: template.templateKey,
        evidence: template.evidence.map(evidence => ({
          clueRef: evidence.clueRef,
          audience: evidence.audience,
          knownByActorKeys: evidence.knownByActorKeys,
        })),
      })),
    },
    chaos: 5,
    worldTurn: 0,
  }
}

function parseableSituation(campaign: ReturnType<typeof openCampaignFixture>) {
  const template = structuredClone(campaign.situationTemplates[0])
  template.whyNowRefs = ['world:harbor:exists', 'clock:flood']
  return template
}

function gateInput(
  campaign: ReturnType<typeof openCampaignFixture>,
  template: ReturnType<typeof parseableSituation>,
  overrides: Record<string, unknown> = {},
) {
  return {
    template,
    worldTurn: 0,
    predicateContext: contextFor(campaign),
    activeInstances: [],
    cooldownUntilWorldTurn: {},
    actorKey: 'hero',
    templateContext: campaign,
    rulePack: openRuleFixture(),
    ...overrides,
  }
}

describe('R-TTRPGOPEN1 situation template and instance gates', () => {
  it('accepts S1-S10 through the closed parser', () => {
    const campaign = openCampaignFixture()
    const template = parseTtrpgSituationTemplateV1(
      parseableSituation(campaign),
      campaign,
      openRuleFixture(),
    )
    expect(template.templateKey).toBe('situation.lighthouse')
  })

  it('rejects each static gate counterexample', () => {
    const campaign = openCampaignFixture()
    const base = parseableSituation(campaign)
    const cases: Array<[string, () => unknown]> = [
      ['S1 cycle', () => parseTtrpgSituationTemplateV1({
        ...base,
        obstacles: base.obstacles.map((obstacle, index) => index === 0
          ? { ...obstacle, dependsOn: ['lamp'] }
          : obstacle),
      }, campaign, openRuleFixture())],
      ['S2 belief source', () => parseTtrpgSituationTemplateV1({
        ...base,
        driverBeliefs: [{ factRef: null, belief: '未知', isMistaken: false }],
      }, campaign, openRuleFixture())],
      ['S3 action reference', () => parseTtrpgSituationTemplateV1({
        ...base,
        interventionPoints: base.interventionPoints.map(point => ({
          ...point,
          suggestedActionKeys: ['action.unknown'],
        })),
      }, campaign, openRuleFixture())],
      ['S4 required evidence', () => parseTtrpgSituationTemplateV1({
        ...base,
        evidence: base.evidence.map(evidence => ({ ...evidence, isRequired: true })),
      }, campaign, openRuleFixture())],
      ['S5 consequence', () => parseTtrpgSituationTemplateV1({
        ...base,
        noInterventionOutcome: { ...base.noInterventionOutcome, effectPlanRef: null, advancesClockKeys: [] },
      }, campaign, openRuleFixture())],
      ['S6 driver', () => parseTtrpgSituationTemplateV1({
        ...base,
        driverBinding: { kind: 'npc', characterKey: 'hero' },
      }, campaign, openRuleFixture())],
      ['S7 recipient', () => parseTtrpgSituationTemplateV1({
        ...base,
        evidence: base.evidence.map(evidence => ({
          ...evidence,
          audience: 'private' as const,
          knownByActorKeys: ['unknown.actor'],
        })),
      }, campaign, openRuleFixture())],
      ['S8 effect plan', () => parseTtrpgSituationTemplateV1({
        ...base,
        consequences: [{ ...base.consequences[0], effectPlanRef: 'plan.unknown' }],
      }, campaign, openRuleFixture())],
      ['S9 why-now prefix', () => parseTtrpgSituationTemplateV1({
        ...base,
        whyNowRefs: ['time:flood', 'clock:flood'],
      }, campaign, openRuleFixture())],
      ['S10 clue namespace', () => parseTtrpgSituationTemplateV1({
        ...base,
        evidence: base.evidence.map(evidence => ({ ...evidence, clueRef: 'duplicate' })),
      }, campaign, openRuleFixture())],
    ]
    for (const [label, action] of cases) {
      expect(action, label).toThrow()
    }
  })

  it('requires every opening instance to pass I1-I7 and uses templateKey for I5', () => {
    const campaign = openCampaignFixture()
    const template = parseableSituation(campaign)
    const instance = instantiateTtrpgSituationV1({
      template,
      activatedAtSequence: 3,
      activatedAtWorldTurn: 0,
      activationReason: 'opening',
    })
    expect(assertTtrpgSituationInstanceGatesV1(gateInput(campaign, template, {
      instance,
    })).passed).toBe(true)

    expect(() => assertTtrpgSituationInstanceGatesV1(gateInput(campaign, template, {
      instance,
      activeInstances: [{ ...instance, situationKey: 'other-key' }],
    }))).toThrow(/I5/)
  })

  it('checks I1-I4, I6 and I7 as independent negative gates', () => {
    const campaign = openCampaignFixture()
    const template = parseableSituation(campaign)
    const instance = instantiateTtrpgSituationV1({
      template,
      activatedAtSequence: 4,
      activatedAtWorldTurn: 0,
      activationReason: 'opening',
    })
    const base = gateInput(campaign, template, { instance })
    const cases: Array<[string, Record<string, unknown>]> = [
      ['I1', {
        predicateContext: {
          ...contextFor(campaign),
          worldTurn: 0,
        },
        template: { ...template, preconditions: [{ op: 'world-turn-at-least', value: 1 }] },
      }],
      ['I2', {
        template: { ...template, whyNowRefs: ['telegraph:missing', 'clock:missing'] },
      }],
      ['I3', { template: { ...template, driverBinding: { kind: 'front', frontKey: 'missing.front' } } }],
      ['I4', { template: { ...template, noInterventionOutcome: { ...template.noInterventionOutcome, effectPlanRef: null, advancesClockKeys: [] } } }],
      ['I6', {
        activeInstances: Array.from({ length: 5 }, (_, index) => ({ ...instance, situationKey: `other.${index}`, templateKey: `other.${index}` })),
      }],
      ['I7', { cooldownUntilWorldTurn: { [template.templateKey]: 3 }, worldTurn: 0 }],
    ]
    for (const [label, overrides] of cases) {
      expect(() => assertTtrpgSituationInstanceGatesV1({ ...base, ...overrides }), label).toThrow(new RegExp(label))
    }
  })

  it('uses predicate templateKey matching and array index for front-stage-at-least', () => {
    const campaign = openCampaignFixture()
    const template = parseableSituation(campaign)
    const context = contextFor(campaign)
    context.pressure.fronts.storm.currentStageKey = 'rising'
    const frontPredicate = { op: 'front-stage-at-least' as const, frontKey: 'storm', stageKey: 'rising' }
    const result = assertTtrpgSituationInstanceGatesV1(gateInput(campaign, {
      ...template,
      preconditions: [frontPredicate],
    }, { predicateContext: context }))
    expect(result.i1.passed).toBe(true)
  })
})
