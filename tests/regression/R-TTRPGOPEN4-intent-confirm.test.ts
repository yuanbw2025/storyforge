import { describe, expect, it } from 'vitest'
import {
  routeTtrpgOpenIntentV1,
  type TtrpgOpenIntentRoutingSnapshotV1,
  type TtrpgOpenIntentV1,
} from '../../src/lib/ttrpg/open-intent'
import { openCampaignFixture, openRuleFixture } from '../helpers/ttrpg-open-content'

const HASH = 'c'.repeat(64)

function intent(overrides: Partial<TtrpgOpenIntentV1> = {}): TtrpgOpenIntentV1 {
  return {
    intentKey: 'hero.0.intent.confirm',
    clarificationThreadKey: 'hero.0.intent.confirm',
    actorKey: 'hero',
    goal: '攻击守卫',
    method: '攻击',
    targetRefs: ['keeper'],
    declaredResources: [],
    declaredAssumptions: [],
    requestedOutcome: null,
    source: 'player',
    inputRevision: HASH,
    ...overrides,
  }
}

function snapshot(): TtrpgOpenIntentRoutingSnapshotV1 {
  const campaign = openCampaignFixture()
  const rulePack = openRuleFixture()
  const actors = campaign.characterTemplates
  return {
    rulePack,
    campaign,
    companionPolicy: campaign.companionPolicy,
    characterTemplates: actors,
    predicateContext: {
      frozenWorldPredicateIndex: campaign.frozenWorldPredicateIndex,
      sessionFacts: [],
      effectLedger: { storyFacts: {}, socialBalances: {} },
      pressure: {
        clocks: { flood: { value: 0 } },
        fronts: { storm: { currentStageKey: null, escalationStages: campaign.fronts[0].escalationStages } },
      },
      actors: Object.fromEntries(actors.map(actor => [
        actor.characterKey,
        { locationRef: 'harbor', itemKeys: [], abilityKeys: [], resources: { focus: 3, vigor: 3 } },
      ])),
      situations: { active: [], templates: [] },
      chaos: 5,
      worldTurn: 1,
      knownRefs: ['hero', 'companion.1', 'companion.2', 'keeper', 'harbor', 'focus', 'vigor'],
    },
  }
}

describe('R-TTRPGOPEN4 intent confirmation', () => {
  it('requires a human player confirmation for irreversible and other-category actions', () => {
    const preview = routeTtrpgOpenIntentV1(intent(), snapshot())
    expect(preview.route).toBe('existing-action')
    expect(preview.actionKind).toBe('other')
    expect(preview.requiresConfirmation).toBe(true)
    expect(preview.confirmationApproverSeatKeys).toEqual(['seat.hero'])
    expect(preview.confirmationApproverActorKeys).toEqual(['hero'])
    expect(preview.confirmationReasonKinds).toEqual([])
  })

  it('requires confirmation when a known rule action spends an undeclared resource', () => {
    const state = snapshot()
    const action = state.rulePack.actions.find(candidate => candidate.key === 'investigate')
    if (!action) throw new Error('fixture action missing')
    action.costResourceKey = 'focus'
    action.costAmount = 1
    const preview = routeTtrpgOpenIntentV1(
      intent({ goal: '调查港口', method: '调查', targetRefs: ['harbor'] }),
      state,
    )
    expect(preview.requiresConfirmation).toBe(true)
    expect(preview.confirmationReasonKinds).toContain('resource-spend')
    expect(preview.possibleCosts).toContain('消耗 focus × 1')
  })

  it('keeps secret reveal and party relation confirmation reasons separate and additive', () => {
    const state = snapshot()
    const plan = state.campaign!.effectPlanTemplates[0]
    plan.effects.push({
      effectKey: 'effect.reveal-secret',
      family: 'story',
      operation: 'secret.reveal',
      targetRef: 'keeper',
      storyKey: 'secret.keeper',
      value: true,
    })
    plan.effects.push({
      effectKey: 'effect.change-relation',
      family: 'social',
      operation: 'relationship',
      targetRef: 'keeper',
      socialKey: 'trust',
      amount: -1,
    })
    const preview = routeTtrpgOpenIntentV1(
      intent({ goal: '通用观察并揭示秘密', method: '通用观察', targetRefs: [] }),
      state,
    )
    expect(preview.route).toBe('generic-check')
    expect(preview.requiresConfirmation).toBe(true)
    expect(preview.confirmationReasonKinds).toEqual([
      'irreversible',
      'party-relation-change',
      'secret-reveal',
    ])
  })

  it('does not allow an AI teammate to confirm a human player intent', () => {
    const preview = routeTtrpgOpenIntentV1(
      intent({ actorKey: 'hero', method: '攻击', source: 'player' }),
      snapshot(),
    )
    expect(preview.confirmationApproverActorKeys).toEqual(['hero'])
    expect(preview.confirmationApproverActorKeys).not.toContain('companion.1')
  })
})
