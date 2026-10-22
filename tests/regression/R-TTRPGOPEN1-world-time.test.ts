import { describe, expect, it } from 'vitest'
import {
  advanceTtrpgWorldTimeV1,
  canAdvanceTtrpgWorldTurnV1,
  createTtrpgWorldTimeV1,
  TTRPG_WORLD_TIME_REASONS,
} from '../../src/lib/ttrpg/world-time'

describe('R-TTRPGOPEN1 world time', () => {
  it('allows exactly the E7 worldTurn reasons and rejects Oracle consultation', () => {
    expect(TTRPG_WORLD_TIME_REASONS).toEqual([
      'game-action',
      'ai-companion-action',
      'idle-tick',
      'front-escalation',
      'situation-maintenance',
      'stage-close',
    ])
    for (const reason of TTRPG_WORLD_TIME_REASONS) expect(canAdvanceTtrpgWorldTurnV1(reason)).toBe(true)
    for (const reason of ['oracle-consult', 'view', 'rules-question', '', null, 1]) {
      expect(canAdvanceTtrpgWorldTurnV1(reason)).toBe(false)
    }
  })

  it('advances once per strictly increasing event sequence without mutating state', () => {
    const initial = createTtrpgWorldTimeV1()
    const advanced = advanceTtrpgWorldTimeV1(initial, 'game-action', 1)
    expect(initial).toEqual({ worldTurn: 0, lastAdvancedByEventSequence: -1, lastAdvanceReason: null })
    expect(advanced).toEqual({ worldTurn: 1, lastAdvancedByEventSequence: 1, lastAdvanceReason: 'game-action' })
    expect(advanceTtrpgWorldTimeV1({ worldTime: advanced, reason: 'idle-tick', byEventSequence: 2 }))
      .toEqual({ worldTurn: 2, lastAdvancedByEventSequence: 2, lastAdvanceReason: 'idle-tick' })
    expect(() => advanceTtrpgWorldTimeV1(advanced, 'idle-tick', 1)).toThrow(/byEventSequence/)
    expect(() => advanceTtrpgWorldTimeV1(advanced, 'oracle-consult', 3)).toThrow(/reason/)
  })

  it('rejects malformed state and keeps the reason whitelist closed', () => {
    expect(() => advanceTtrpgWorldTimeV1({
      worldTime: { ...createTtrpgWorldTimeV1(), extra: true } as never,
      reason: 'game-action',
      byEventSequence: 1,
    })).toThrow(/字段/)
    expect(() => advanceTtrpgWorldTimeV1(createTtrpgWorldTimeV1(), 'front-tick', 1)).toThrow(/reason/)
  })
})
