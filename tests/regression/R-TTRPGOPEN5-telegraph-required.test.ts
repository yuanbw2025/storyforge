import { describe, expect, it } from 'vitest'
import {
  evaluateTtrpgFrontAdvanceV1,
  evaluateTtrpgFrontTelegraphV1,
  parseTtrpgPressureFrontV1,
} from '../../src/lib/ttrpg/pressure-runtime'
import { advanceTtrpgWorldTimeV1, createTtrpgWorldTimeV1 } from '../../src/lib/ttrpg/world-time'
import { openCampaignFixture } from '../helpers/ttrpg-open-content'

function worldTimeAt(turn: number) {
  let worldTime = createTtrpgWorldTimeV1()
  for (let sequence = 1; sequence <= turn; sequence += 1) {
    worldTime = advanceTtrpgWorldTimeV1(worldTime, 'game-action', sequence)
  }
  return worldTime
}

function frontState(telegraphWorldTurns: Record<string, number> = {}) {
  return { currentStageKey: null, telegraphWorldTurns, defeated: false }
}

describe('R-TTRPGOPEN5 telegraph required', () => {
  it('makes an escalation unreachable without a telegraph', () => {
    const campaign = openCampaignFixture()
    const front = campaign.fronts[0]
    const stage = front.escalationStages[0]

    expect(() => evaluateTtrpgFrontAdvanceV1({
      front,
      frontState: frontState(),
      clockStates: { flood: { value: stage.atClockValue, lastAdvancedSequence: -1, lastAdvancedWorldTurn: 0 } },
      stageKey: stage.stageKey,
      worldTime: worldTimeAt(2),
    })).toThrow(/征兆/)
  })

  it('requires party/public audience and accepts the exact minLeadWorldTurns boundary', () => {
    const campaign = openCampaignFixture()
    const front = campaign.fronts[0]
    const stage = front.escalationStages[0]
    const telegraph = front.telegraph[0]

    const emitted = evaluateTtrpgFrontTelegraphV1({
      front,
      frontState: frontState(),
      telegraphKey: telegraph.telegraphKey,
      audience: telegraph.audience,
      worldTime: worldTimeAt(1),
    })
    expect(emitted).toEqual({
      frontKey: front.frontKey,
      telegraphKey: telegraph.telegraphKey,
      audience: 'party',
      telegraphWorldTurn: 1,
    })

    const advanced = evaluateTtrpgFrontAdvanceV1({
      front,
      frontState: frontState({ [telegraph.telegraphKey]: 1 }),
      clockStates: { flood: { value: stage.atClockValue, lastAdvancedSequence: -1, lastAdvancedWorldTurn: 0 } },
      stageKey: stage.stageKey,
      worldTime: worldTimeAt(2),
    })
    expect(advanced.telegraphEvidence).toEqual([{
      telegraphKey: telegraph.telegraphKey,
      telegraphWorldTurn: 1,
      minLeadWorldTurns: telegraph.minLeadWorldTurns,
    }])

    expect(() => evaluateTtrpgFrontAdvanceV1({
      front,
      frontState: frontState({ [telegraph.telegraphKey]: 2 }),
      clockStates: { flood: { value: stage.atClockValue, lastAdvancedSequence: -1, lastAdvancedWorldTurn: 0 } },
      stageKey: stage.stageKey,
      worldTime: worldTimeAt(2),
    })).toThrow(/征兆/)

    expect(() => evaluateTtrpgFrontTelegraphV1({
      front,
      frontState: frontState(),
      telegraphKey: telegraph.telegraphKey,
      audience: 'gm-only',
      worldTime: worldTimeAt(1),
    })).toThrow(/不一致/)
  })

  it('rejects closed audience and minLeadWorldTurns values at parse boundaries', () => {
    const front = openCampaignFixture().fronts[0]
    expect(() => parseTtrpgPressureFrontV1({
      ...front,
      telegraph: front.telegraph.map(item => ({ ...item, audience: 'gm-only' })),
    })).toThrow(/枚举无效/)
    expect(() => parseTtrpgPressureFrontV1({
      ...front,
      telegraph: front.telegraph.map(item => ({ ...item, minLeadWorldTurns: 0 })),
    })).toThrow(/数值越界/)
    expect(() => parseTtrpgPressureFrontV1({
      ...front,
      telegraph: front.telegraph.map(item => ({ ...item, minLeadWorldTurns: 11 })),
    })).toThrow(/数值越界/)
  })
})
