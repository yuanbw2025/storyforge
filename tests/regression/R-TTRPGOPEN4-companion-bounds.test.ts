import { describe, expect, it } from 'vitest'
import {
  routeTtrpgOpenIntentV1,
  type TtrpgOpenIntentRoutingSnapshotV1,
  type TtrpgOpenIntentV1,
} from '../../src/lib/ttrpg/open-intent'
import { openCampaignFixture, openRuleFixture } from '../helpers/ttrpg-open-content'

const HASH = 'd'.repeat(64)

function intent(overrides: Partial<TtrpgOpenIntentV1> = {}): TtrpgOpenIntentV1 {
  return {
    intentKey: 'companion.1.0.intent.bounds',
    clarificationThreadKey: 'companion.1.0.intent.bounds',
    actorKey: 'companion.1',
    goal: '调查港口',
    method: '调查',
    targetRefs: ['harbor'],
    declaredResources: [],
    declaredAssumptions: [],
    requestedOutcome: null,
    source: 'companion:companion.1',
    inputRevision: HASH,
    ...overrides,
  }
}

function snapshot(): TtrpgOpenIntentRoutingSnapshotV1 {
  const campaign = openCampaignFixture()
  const actors = campaign.characterTemplates
  return {
    rulePack: openRuleFixture(),
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
      worldTurn: 2,
      knownRefs: ['hero', 'companion.1', 'companion.2', 'keeper', 'harbor', 'focus', 'vigor'],
    },
  }
}

describe('R-TTRPGOPEN4 companion bounds', () => {
  it('auto-executes only a preauthorized low-risk companion action', () => {
    const state = snapshot()
    const action = state.rulePack.actions.find(candidate => candidate.key === 'investigate')
    if (!action) throw new Error('fixture action missing')
    action.effects = action.effects.filter(effect => effect.kind !== 'resource')
    const preview = routeTtrpgOpenIntentV1(intent(), state)
    expect(preview.route).toBe('existing-action')
    expect(preview.actionKind).toBe('observe')
    expect(preview.authorization).toBe('preauthorized')
    expect(preview.requiresConfirmation).toBe(false)
    expect(preview.confirmationApproverSeatKeys).toEqual([])
  })

  it('turns a non-preauthorized companion action into a human-approved proposal', () => {
    const preview = routeTtrpgOpenIntentV1(
      intent({ goal: '攻击守卫', method: '攻击', targetRefs: ['keeper'] }),
      snapshot(),
    )
    expect(preview.route).toBe('existing-action')
    expect(preview.actionKind).toBe('other')
    expect(preview.authorization).toBe('requires-confirmation')
    expect(preview.requiresConfirmation).toBe(true)
    expect(preview.confirmationApproverSeatKeys).toEqual(['seat.hero'])
    expect(preview.confirmationApproverActorKeys).toEqual(['hero'])
  })

  it('rejects a second companion action in the same worldTurn', () => {
    const state = snapshot()
    state.companionStates = {
      'companion.1': { consecutiveActions: 1, lastActedWorldTurn: 2 },
    }
    const preview = routeTtrpgOpenIntentV1(intent(), state)
    expect(preview.route).toBe('rejected')
    expect(preview.riskSummary).toContain('同一 worldTurn 内每名 AI 队友最多执行一次行动')
    expect(preview.timeCostWorldTurns).toBe(0)
  })

  it('rejects companion actions without a human approval binding', () => {
    const state = snapshot()
    state.companionPolicy!.approvalBindings = state.companionPolicy!.approvalBindings
      .filter(binding => binding.companionActorKey !== 'companion.1')
    const preview = routeTtrpgOpenIntentV1(intent({ goal: '攻击守卫', method: '攻击', targetRefs: ['keeper'] }), state)
    expect(preview.route).toBe('rejected')
    expect(preview.authorization).toBe('blocked')
  })
})
