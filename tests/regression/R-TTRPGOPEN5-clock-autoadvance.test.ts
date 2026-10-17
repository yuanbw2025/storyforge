import { describe, expect, it } from 'vitest'
import {
  evaluateTtrpgClockAutoAdvanceV1,
  evaluateTtrpgPressureOnWorldTurnV1,
  parseTtrpgPressureClockV1,
  TTRPG_PRESSURE_CLOCK_TRIGGER_SOURCES,
} from '../../src/lib/ttrpg/pressure-runtime'
import type { TtrpgPredicateEvaluationContextV1 } from '../../src/lib/ttrpg/predicate'
import { advanceTtrpgWorldTimeV1, createTtrpgWorldTimeV1 } from '../../src/lib/ttrpg/world-time'
import type { TtrpgWorldTimeV1 } from '../../src/lib/ttrpg/world-time'
import { openCampaignFixture } from '../helpers/ttrpg-open-content'

function advanceWorldTime(
  reason: 'game-action' | 'stage-close',
  turns: number,
): TtrpgWorldTimeV1 {
  let worldTime = createTtrpgWorldTimeV1()
  for (let sequence = 1; sequence <= turns; sequence += 1) {
    worldTime = advanceTtrpgWorldTimeV1(worldTime, reason, sequence)
  }
  return worldTime
}

function predicateContext(
  campaign: ReturnType<typeof openCampaignFixture>,
  worldTurn: number,
  floodValue = 0,
): TtrpgPredicateEvaluationContextV1 {
  const front = campaign.fronts[0]
  return {
    frozenWorldPredicateIndex: campaign.frozenWorldPredicateIndex,
    sessionFacts: [],
    effectLedger: { storyFacts: {}, socialBalances: {} },
    pressure: {
      clocks: { flood: { value: floodValue } },
      fronts: {
        [front.frontKey]: {
          currentStageKey: null,
          escalationStages: front.escalationStages.map(stage => ({ stageKey: stage.stageKey })),
        },
      },
    },
    actors: {},
    situations: { active: [], templates: [] },
    chaos: 5,
    worldTurn,
    knownRefs: ['flood', front.frontKey, ...front.escalationStages.map(stage => stage.stageKey)],
  }
}

describe('R-TTRPGOPEN5 clock auto advance', () => {
  it('evaluates failed checks, Oracle No, stage close, and idle clocks only after worldTurn advances', () => {
    const campaign = openCampaignFixture()
    const clock = structuredClone(campaign.clocks[0])
    const state = { value: 0, lastAdvancedSequence: -1, lastAdvancedWorldTurn: 0 }

    const failedCheck = evaluateTtrpgClockAutoAdvanceV1({
      clock: { ...clock, autoAdvance: { ...clock.autoAdvance, onIdleWorldTurns: 0, onOracleNo: 0 } },
      clockState: state,
      worldTime: advanceWorldTime('game-action', 1),
      signal: { failedCheck: true },
    })
    expect(failedCheck).toMatchObject([{ triggerSource: 'auto-failed-check', delta: 1, atWorldTurn: 1 }])

    const oracleNo = evaluateTtrpgClockAutoAdvanceV1({
      clock: { ...clock, autoAdvance: { ...clock.autoAdvance, onFailedCheck: 0, onIdleWorldTurns: 0 } },
      clockState: state,
      worldTime: advanceWorldTime('game-action', 1),
      signal: { oracleNo: true },
    })
    expect(oracleNo).toMatchObject([{ triggerSource: 'auto-oracle-no', delta: 1 }])

    const stageClose = evaluateTtrpgClockAutoAdvanceV1({
      clock: {
        ...clock,
        autoAdvance: { ...clock.autoAdvance, onFailedCheck: 0, onIdleWorldTurns: 0, onOracleNo: 0, onStageClose: 1 },
      },
      clockState: state,
      worldTime: advanceWorldTime('stage-close', 1),
    })
    expect(stageClose).toMatchObject([{ triggerSource: 'auto-stage-close', delta: 1, atWorldTurn: 1 }])

    const idle = evaluateTtrpgClockAutoAdvanceV1({
      clock: {
        ...clock,
        autoAdvance: { onFailedCheck: 0, onIdleWorldTurns: 2, onOracleNo: 0, onStageClose: 0 },
      },
      clockState: state,
      worldTime: advanceWorldTime('game-action', 2),
    })
    expect(idle).toMatchObject([{ triggerSource: 'auto-idle', delta: 1, atWorldTurn: 2 }])
  })

  it('computes idle per clock and evaluates author triggers with the derived worldTurn', () => {
    const campaign = openCampaignFixture()
    const first = structuredClone(campaign.clocks[0])
    const second = { ...structuredClone(first), clockKey: 'second-clock' }
    const worldTime = advanceWorldTime('game-action', 1)
    const result = evaluateTtrpgPressureOnWorldTurnV1({
      worldTime,
      reason: 'game-action',
      byEventSequence: 2,
      clocks: [
        { ...first, autoAdvance: { onFailedCheck: 0, onIdleWorldTurns: 2, onOracleNo: 0, onStageClose: 0 } },
        {
          ...second,
          advanceTriggers: [{
            triggerKey: 'turn-two',
            sceneKey: null,
            actionKey: null,
            condition: { op: 'world-turn-at-least', value: 2 },
            amount: 2,
            reason: '时间到了',
          }],
          autoAdvance: { onFailedCheck: 0, onIdleWorldTurns: 2, onOracleNo: 0, onStageClose: 0 },
        },
      ],
      clockStates: {
        flood: { value: 0, lastAdvancedSequence: -1, lastAdvancedWorldTurn: 0 },
        'second-clock': { value: 0, lastAdvancedSequence: -1, lastAdvancedWorldTurn: 1 },
      },
      predicateContext: predicateContext(campaign, 1),
    })

    expect(result.worldTime.worldTurn).toBe(2)
    expect(result.ticks).toEqual([
      expect.objectContaining({ clockKey: 'flood', triggerSource: 'auto-idle', delta: 1 }),
      expect.objectContaining({ clockKey: 'second-clock', triggerSource: 'author-trigger', triggerKey: 'turn-two', delta: 2 }),
    ])
    expect(worldTime.worldTurn).toBe(1)
  })

  it('keeps the trigger source closed, caps ticks at maximum, and rejects autoAdvance bounds', () => {
    const campaign = openCampaignFixture()
    const clock = structuredClone(campaign.clocks[0])
    const worldTime = advanceWorldTime('game-action', 1)
    expect(TTRPG_PRESSURE_CLOCK_TRIGGER_SOURCES).toEqual([
      'author-trigger',
      'auto-failed-check',
      'auto-idle',
      'auto-oracle-no',
      'auto-stage-close',
      'escalation',
      'situation-outcome',
    ])
    const result = evaluateTtrpgClockAutoAdvanceV1({
      clock: { ...clock, autoAdvance: { onFailedCheck: 4, onIdleWorldTurns: 0, onOracleNo: 0, onStageClose: 0 } },
      clockState: { value: clock.maximum - 1, lastAdvancedSequence: -1, lastAdvancedWorldTurn: 0 },
      worldTime,
      signal: { failedCheck: true },
    })

    expect(result).toMatchObject([{ delta: 1, valueBefore: clock.maximum - 1, valueAfter: clock.maximum }])
    expect(() => evaluateTtrpgClockAutoAdvanceV1({
      clock,
      clockState: { value: 0, lastAdvancedSequence: -1, lastAdvancedWorldTurn: 0 },
      worldTime,
      signal: { unexpected: true } as never,
    })).toThrow(/闭集/)
    expect(() => parseTtrpgPressureClockV1({
      ...clock,
      autoAdvance: { ...clock.autoAdvance, onIdleWorldTurns: 9 },
    })).toThrow(/数值越界/)
    expect(() => evaluateTtrpgPressureOnWorldTurnV1({
      worldTime: createTtrpgWorldTimeV1(),
      reason: 'view',
      byEventSequence: 1,
      clocks: [clock],
      clockStates: { [clock.clockKey]: { value: 0, lastAdvancedSequence: -1, lastAdvancedWorldTurn: 0 } },
    })).toThrow(/reason/)
  })
})
