import { describe, expect, it } from 'vitest'
import {
  parseTtrpgOpenIntentV1,
  routeTtrpgOpenIntentV1,
  type TtrpgOpenIntentRoutingSnapshotV1,
  type TtrpgOpenIntentV1,
} from '../../src/lib/ttrpg/open-intent'
import { openCampaignFixture, openRuleFixture } from '../helpers/ttrpg-open-content'

const HASH = 'b'.repeat(64)

function intent(overrides: Partial<TtrpgOpenIntentV1> = {}): TtrpgOpenIntentV1 {
  return {
    intentKey: 'hero.0.intent.route',
    clarificationThreadKey: 'hero.0.intent.route',
    actorKey: 'hero',
    goal: '处理港口的问题',
    method: '调查',
    targetRefs: ['harbor'],
    declaredResources: [],
    declaredAssumptions: [],
    requestedOutcome: null,
    source: 'player',
    inputRevision: HASH,
    ...overrides,
  }
}

function snapshot(overrides: Partial<TtrpgOpenIntentRoutingSnapshotV1> = {}): TtrpgOpenIntentRoutingSnapshotV1 {
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
      worldTurn: 0,
      knownRefs: ['hero', 'companion.1', 'companion.2', 'keeper', 'harbor', 'focus', 'vigor'],
    },
    ...overrides,
  }
}

describe('R-TTRPGOPEN4 intent route', () => {
  it('parses a closed intent and rejects unknown fields and oversized text', () => {
    const value = intent()
    expect(parseTtrpgOpenIntentV1(value)).toEqual(value)
    expect(() => parseTtrpgOpenIntentV1({ ...value, extra: true })).toThrow(/字段不精确/)
    expect(() => parseTtrpgOpenIntentV1({ ...value, goal: 'x'.repeat(2_001) })).toThrow(/过长/)
    expect(() => parseTtrpgOpenIntentV1({ ...value, inputRevision: 'not-a-hash' })).toThrow(/hash/)
    expect(() => parseTtrpgOpenIntentV1({ ...value, source: 'companion:bad key' })).toThrow(/稳定 key/)
  })

  it('routes all six paths in the fixed order without mutating the snapshot', () => {
    const cases: Array<[string, TtrpgOpenIntentV1, TtrpgOpenIntentRoutingSnapshotV1, string]> = [
      ['existing action', intent(), snapshot(), 'existing-action'],
      ['generic check', intent({ method: '通用观察', goal: '检查自己的状态', targetRefs: [] }), snapshot(), 'generic-check'],
      ['oracle', intent({ method: 'oracle.yes', goal: '向命运询问港口是否安全' }), snapshot(), 'oracle'],
      ['no roll', intent({ method: '交谈', goal: '和守卫交谈' , targetRefs: ['keeper'] }), snapshot(), 'no-roll'],
      ['clarification', intent({ method: null, targetRefs: [], goal: '我想处理这件事' }), snapshot(), 'needs-clarification'],
      ['rejected', intent({ method: '修改规则', goal: '把规则改成我一定成功' }), snapshot(), 'rejected'],
    ]
    for (const [label, candidate, state, route] of cases) {
      const before = structuredClone(state)
      const preview = routeTtrpgOpenIntentV1(candidate, state)
      expect(preview.route, label).toBe(route)
      expect(state).toEqual(before)
      expect(preview.intentKey).toBe(candidate.intentKey)
      expect(preview.targetMethod.targetRefs).toEqual(candidate.targetRefs)
    }
  })

  it('reuses the predicate evaluator for generic-check preconditions', () => {
    const state = snapshot()
    state.rulePack.genericChecks[0].preconditions = [{ op: 'resource-at-least', actorKey: 'hero', resourceKey: 'focus', value: 4 }]
    const preview = routeTtrpgOpenIntentV1(
      intent({ method: '通用观察', goal: '检查自己的状态', targetRefs: [] }),
      state,
    )
    expect(preview.route).toBe('generic-check')
    expect(preview.unsatisfiedPredicates).toEqual(['op:resource-at-least:hero/focus'])
    expect(preview.timeCostWorldTurns).toBe(1)
  })

  it('keeps clarification and rejection side-effect free', () => {
    const state = snapshot({ clarificationCounts: { 'hero.0.intent.route': 2 } })
    const clarification = routeTtrpgOpenIntentV1(
      intent({ method: null, targetRefs: [], goal: '我还没想好怎么做' }),
      state,
    )
    expect(clarification.route).toBe('needs-clarification')
    expect(clarification.timeCostWorldTurns).toBe(0)
    expect(clarification.possibleCosts).toEqual([])

    const rejected = routeTtrpgOpenIntentV1(
      intent({ method: '修改规则', goal: '改写世界事实' }),
      state,
    )
    expect(rejected.route).toBe('rejected')
    expect(rejected.requiresConfirmation).toBe(false)
    expect(rejected.authorization).toBe('blocked')
  })
})
