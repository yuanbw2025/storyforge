import { describe, expect, it } from 'vitest'
import {
  evaluateTtrpgFrontDefeatV1,
  parseTtrpgPressureFrontV1,
} from '../../src/lib/ttrpg/pressure-runtime'
import type { TtrpgPredicateEvaluationContextV1 } from '../../src/lib/ttrpg/predicate'
import { openCampaignFixture } from '../helpers/ttrpg-open-content'

function context(
  campaign: ReturnType<typeof openCampaignFixture>,
  worldTurn: number,
  chaos: number,
): TtrpgPredicateEvaluationContextV1 {
  const front = campaign.fronts[0]
  return {
    frozenWorldPredicateIndex: campaign.frozenWorldPredicateIndex,
    sessionFacts: [],
    effectLedger: { storyFacts: {}, socialBalances: {} },
    pressure: {
      clocks: { flood: { value: 3 } },
      fronts: {
        [front.frontKey]: {
          currentStageKey: null,
          escalationStages: front.escalationStages.map(stage => ({ stageKey: stage.stageKey })),
        },
      },
    },
    actors: {},
    situations: { active: [], templates: [] },
    chaos,
    worldTurn,
    knownRefs: ['flood', front.frontKey, ...front.escalationStages.map(stage => stage.stageKey)],
  }
}

describe('R-TTRPGOPEN5 front defeat', () => {
  it('emits defeated only when every defeatPredicate is satisfied', () => {
    const campaign = openCampaignFixture()
    const baseFront = campaign.fronts[0]
    const front = {
      ...baseFront,
      defeatPredicates: [
        { op: 'world-turn-at-least' as const, value: 10 },
        { op: 'chaos-at-least' as const, value: 5 },
      ],
    }
    const frontState = { currentStageKey: null, telegraphWorldTurns: {}, defeated: false }
    const result = evaluateTtrpgFrontDefeatV1({
      front,
      frontState,
      predicateContext: context(campaign, 10, 5),
    })

    expect(result.frontKey).toBe(front.frontKey)
    expect(result.satisfiedPredicates).toEqual(front.defeatPredicates)
    expect(frontState).toEqual({ currentStageKey: null, telegraphWorldTurns: {}, defeated: false })
  })

  it('rejects a partial defeat and keeps the front open', () => {
    const campaign = openCampaignFixture()
    const baseFront = campaign.fronts[0]
    const front = {
      ...baseFront,
      defeatPredicates: [
        { op: 'world-turn-at-least' as const, value: 10 },
        { op: 'chaos-at-least' as const, value: 5 },
      ],
    }
    const frontState = { currentStageKey: null, telegraphWorldTurns: {}, defeated: false }

    expect(() => evaluateTtrpgFrontDefeatV1({
      front,
      frontState,
      predicateContext: context(campaign, 10, 4),
    })).toThrow(/未全部满足/)
    expect(frontState.defeated).toBe(false)
  })

  it('keeps defeat predicates non-empty and rejects a second defeat', () => {
    const campaign = openCampaignFixture()
    const front = campaign.fronts[0]
    expect(() => parseTtrpgPressureFrontV1({ ...front, defeatPredicates: [] })).toThrow(/数组长度/)
    expect(() => evaluateTtrpgFrontDefeatV1({
      front,
      frontState: { currentStageKey: null, telegraphWorldTurns: {}, defeated: true },
      predicateContext: context(campaign, 10, 5),
    })).toThrow(/已经defeated/)
  })
})
