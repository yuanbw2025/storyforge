import { describe, expect, it } from 'vitest'
import { assertTtrpgOracleInterpretationScopeV1 } from '../../src/lib/ttrpg/oracle'
import { openRuleFixture } from '../helpers/ttrpg-open-content'

describe('R-TTRPGOPEN2 oracle scope', () => {
  it.each([
    ['rule-change', '改规则'],
    ['world-fact', '改写世界事实'],
    ['player-decision', '替玩家决定'],
    ['retcon', '追溯改写'],
  ] as const)('rejects interpretation scope %s', (scope) => {
    expect(() => assertTtrpgOracleInterpretationScopeV1({
      oracle: openRuleFixture().oracles[0],
      attemptedScopes: [scope],
      newEntityCount: 0,
    })).toThrow(`oracle-scope:${scope}`)
  })

  it('accepts a bounded interpretation with no forbidden scope', () => {
    expect(() => assertTtrpgOracleInterpretationScopeV1({
      oracle: openRuleFixture().oracles[0],
      attemptedScopes: [],
      newEntityCount: 0,
    })).not.toThrow()
  })

  it('rejects more dynamic entities than the frozen table permits', () => {
    expect(() => assertTtrpgOracleInterpretationScopeV1({
      oracle: openRuleFixture().oracles[0],
      attemptedScopes: [],
      newEntityCount: 1,
    })).toThrow('oracle-scope:max-new-entities')
  })
})
