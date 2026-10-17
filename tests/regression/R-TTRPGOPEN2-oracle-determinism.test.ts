import { describe, expect, it } from 'vitest'
import {
  advanceTtrpgChaosV1,
  parseTtrpgOracleTableV1,
  resolveTtrpgOracleV1,
  selectTtrpgOracleEntryIndexV1,
  verifyTtrpgOracleOutcomeV1,
} from '../../src/lib/ttrpg/oracle'
import { openRuleFixture } from '../helpers/ttrpg-open-content'

describe('R-TTRPGOPEN2 oracle determinism', () => {
  it('parses the closed table, resolves deterministically, and verifies all receipt material', async () => {
    const rulePack = openRuleFixture()
    const table = parseTtrpgOracleTableV1(rulePack.oracles[0], rulePack)
    expect(table.oracleKey).toBe('oracle.yes')

    const input = {
      rulePack,
      oracleKey: table.oracleKey,
      question: '灯塔守卫会帮助我们吗？',
      askedBy: 'player:hero' as const,
      seed: 'oracle.seed',
      commandId: 'command.oracle.1',
      eventSequence: 4,
      likelihoodTierKey: 'even',
    }
    const first = await resolveTtrpgOracleV1(input)
    const second = await resolveTtrpgOracleV1(input)

    expect(first).toEqual(second)
    expect(first.outcome.finalized).toBe(true)
    expect(first.rollReceipt.nonce).toBe('oracle:oracle.yes:command.oracle.1')
    expect(first.rollReceipt.diceResolution.dice.length).toBeGreaterThan(0)
    expect(first.rollReceipt.receiptHash).toMatch(/^[a-f0-9]{64}$/)
    await expect(verifyTtrpgOracleOutcomeV1({
      rulePack,
      seed: input.seed,
      outcome: first.outcome,
      rollReceipt: first.rollReceipt,
    })).resolves.toBe(true)
  })

  it('uses independent unbiased entry selection and records rejection accounting', async () => {
    const selected = await selectTtrpgOracleEntryIndexV1({
      seed: 'entry.seed',
      nonce: 'entry.nonce',
      weightTotal: 3,
    })
    expect(selected.index).toBeGreaterThanOrEqual(0)
    expect(selected.index).toBeLessThan(3)
    expect(selected.consumedSamples).toBe(selected.rejectedSamples + 1)
  })

  it('rejects changed dice or outcome material during verification', async () => {
    const rulePack = openRuleFixture()
    const resolved = await resolveTtrpgOracleV1({
      rulePack,
      oracleKey: 'oracle.yes',
      question: '会下雨吗？',
      askedBy: 'gm',
      seed: 'verify.seed',
      commandId: 'command.oracle.verify',
      eventSequence: 8,
      likelihoodTierKey: 'even',
    })
    const tampered = structuredClone(resolved)
    tampered.rollReceipt.diceResolution.total += 1
    await expect(verifyTtrpgOracleOutcomeV1({
      rulePack,
      seed: 'verify.seed',
      outcome: resolved.outcome,
      rollReceipt: tampered.rollReceipt,
    })).resolves.toBe(false)
  })

  it('uses the same deterministic receipt path for meaning tables and chaos steps only once', async () => {
    const rulePack = openRuleFixture()
    const meaningTable = {
      ...rulePack.oracles[0],
      oracleKey: 'oracle.meaning',
      kind: 'meaning' as const,
      likelihood: null,
      entries: [
        { entryKey: 'meaning.a', weight: 1, text: '靠近', tags: ['motion'] },
        { entryKey: 'meaning.b', weight: 2, text: '等待', tags: ['pause'] },
        { entryKey: 'meaning.c', weight: 1, text: '交换', tags: ['social'] },
        { entryKey: 'meaning.d', weight: 1, text: '离开', tags: ['retreat'] },
      ],
      tests: [{
        testKey: 'meaning.fixture',
        seed: 'meaning.seed',
        nonce: 'meaning.nonce',
        chaosValue: null,
        likelihoodTierKey: null,
        expectedRawResult: null,
        expectedEntryKey: 'meaning.a',
      }],
    }
    rulePack.oracles = [...rulePack.oracles, meaningTable]
    const resolved = await resolveTtrpgOracleV1({
      rulePack,
      oracleKey: meaningTable.oracleKey,
      question: '这个迹象意味着什么？',
      askedBy: 'gm',
      seed: 'meaning.seed',
      commandId: 'command.meaning.1',
      eventSequence: 9,
    })
    expect(resolved.outcome.rawResult).toEqual({ entryKey: resolved.rollReceipt.selectedEntryKey })
    expect(resolved.rollReceipt.entrySelection?.nonce).toBe('oracle:oracle.meaning:command.meaning.1:entry')
    await expect(verifyTtrpgOracleOutcomeV1({
      rulePack,
      seed: 'meaning.seed',
      outcome: resolved.outcome,
      rollReceipt: resolved.rollReceipt,
    })).resolves.toBe(true)

    expect(advanceTtrpgChaosV1({
      state: { value: 5, lastChangedAtSequence: 0 },
      trigger: 'failed-check',
      eventSequence: 10,
    })).toEqual({ value: 6, lastChangedAtSequence: 10 })
    expect(advanceTtrpgChaosV1({
      state: { value: 6, lastChangedAtSequence: 10 },
      trigger: 'situation-resolved',
      eventSequence: 11,
    })).toEqual({ value: 5, lastChangedAtSequence: 11 })
  })
})
