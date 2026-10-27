import { describe, expect, it } from 'vitest'
import {
  assertTtrpgOpenStageClosureV1,
  evaluateTtrpgOpenStageClosureV1,
} from '../../src/lib/ttrpg/open-gates'
import { openCampaignFixture } from '../helpers/ttrpg-open-content'

describe('R-TTRPGOPEN8 stage closure', () => {
  it('closes when a configured trigger predicate is satisfied', () => {
    const campaign = openCampaignFixture()
    const context = {
      ...{
        frozenWorldPredicateIndex: campaign.frozenWorldPredicateIndex,
        sessionFacts: [],
        effectLedger: { storyFacts: {}, socialBalances: {} },
        pressure: { clocks: {}, fronts: {} },
        actors: {},
        situations: { active: [], templates: [] },
        chaos: 0,
        worldTurn: 10,
      },
    }
    const result = assertTtrpgOpenStageClosureV1({
      stageClosurePolicy: campaign.stageClosurePolicy,
      predicateContext: context,
      worldTurn: 10,
    })
    expect(result.reason).toBe('trigger')
    expect(result.triggerKey).toBe('dawn')
    expect(result.summaryPrompt).toBe('总结黎明的港口')
    expect(result.maximumReached).toBe(false)
  })

  it('forces a safe closure at maximumWorldTurns without inventing an ending', () => {
    const campaign = openCampaignFixture()
    const result = evaluateTtrpgOpenStageClosureV1({
      stageClosurePolicy: campaign.stageClosurePolicy,
      worldTurn: campaign.stageClosurePolicy.maximumWorldTurns,
    })
    expect(result).toMatchObject({
      eligible: true,
      reason: 'maximum-world-turns',
      triggerKey: null,
      summaryPrompt: null,
      maximumReached: true,
    })
    expect(result.evidence).toContain('maximumWorldTurns=30')
  })

  it('does not close before a trigger or the maximum', () => {
    const campaign = openCampaignFixture()
    const result = evaluateTtrpgOpenStageClosureV1({
      stageClosurePolicy: campaign.stageClosurePolicy,
      predicateContext: {
        frozenWorldPredicateIndex: campaign.frozenWorldPredicateIndex,
        sessionFacts: [],
        effectLedger: { storyFacts: {}, socialBalances: {} },
        pressure: { clocks: {}, fronts: {} },
        actors: {},
        situations: { active: [], templates: [] },
        chaos: 0,
        worldTurn: 9,
      },
      worldTurn: 9,
    })
    expect(result.eligible).toBe(false)
    expect(() => assertTtrpgOpenStageClosureV1({
      stageClosurePolicy: campaign.stageClosurePolicy,
      predicateContext: result,
      worldTurn: 9,
    })).toThrow(/stage-close未满足/)
  })
})
