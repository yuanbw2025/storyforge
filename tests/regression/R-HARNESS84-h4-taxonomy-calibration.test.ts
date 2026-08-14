import { describe, expect, it, vi } from 'vitest'
import {
  H4_LONG_CONSISTENCY_FIXTURES_V1,
  buildLongConsistencyJudgeMessagesV1,
  createLongConsistencyJudgeRepairV1,
  runH4LongConsistencyVerifierV1,
  verifyH4LongConsistencyRunCheckpointV1,
  type H4LongConsistencyRunCheckpointV1,
  type H4LongConsistencyVerifierCallInputV1,
} from '../../src/lib/evals/long-consistency'

const FIXTURE = H4_LONG_CONSISTENCY_FIXTURES_V1.find(item => item.id === 'h4-held-01')!

function validJudgeOutput(): string {
  return JSON.stringify({
    schemaVersion: 1,
    issues: FIXTURE.hiddenLabels.expectedIssues.map(issue => ({
      id: `predicted:${FIXTURE.id}:${issue.id}`,
      subtype: issue.subtype,
      severity: issue.severity,
      intentClassification: issue.intentClassification,
      summary: '两段逐字证据满足冻结分类定义。',
      factEvidence: issue.factEvidence,
      contradictionEvidence: issue.contradictionEvidence,
    })),
  })
}

describe('R-HARNESS84 · H4 taxonomy calibration', () => {
  it('adds operational definitions only to judge v5+ and preserves the v4 prompt contract', async () => {
    const v4 = JSON.stringify(await buildLongConsistencyJudgeMessagesV1(
      FIXTURE.sources,
      'h4-long-consistency-judge-v4',
    ))
    const v5 = JSON.stringify(await buildLongConsistencyJudgeMessagesV1(
      FIXTURE.sources,
      'h4-long-consistency-judge-v5',
    ))
    const v6 = JSON.stringify(await buildLongConsistencyJudgeMessagesV1(
      FIXTURE.sources,
      'h4-long-consistency-judge-v6',
    ))
    const v7 = JSON.stringify(await buildLongConsistencyJudgeMessagesV1(
      FIXTURE.sources,
      'h4-long-consistency-judge-v7',
    ))

    expect(v4).not.toContain('operationalDefinitionZh')
    expect(v4).not.toContain('decisionBoundaryZh')
    expect(v5).toContain('operationalDefinitionZh')
    expect(v5).toContain('decisionBoundaryZh')
    expect(v5).toContain('同一实体在明确相同的时刻处于两个互斥地点')
    expect(v5).toContain('已有能力仍在、关键时刻却像忘了可用手段')
    expect(v5).toContain('礼仪、文化、执法惯例或群体规范归 social-norms')
    expect(v5).not.toContain('最多报告 8 条最高置信 issue')
    expect(v6).toContain('最多报告 8 条最高置信 issue')
    expect(v6).toContain('{\\"schemaVersion\\":1,\\"issues\\":[]}')
    expect(v7).toContain('operationalDefinitionZh')
    expect(v7).toContain('最多报告 8 条最高置信 issue')
    expect(v5).not.toContain('hiddenLabels')
    expect(v5).not.toContain(FIXTURE.hiddenLabels.expectedIssues[0].summary)
  })

  it('adds the full static protocol checklist only to judge v7 repair messages', async () => {
    const repair = createLongConsistencyJudgeRepairV1('missing_field')
    const v6 = JSON.stringify(await buildLongConsistencyJudgeMessagesV1(
      FIXTURE.sources,
      'h4-long-consistency-judge-v6',
      repair,
    ))
    const v7 = JSON.stringify(await buildLongConsistencyJudgeMessagesV1(
      FIXTURE.sources,
      'h4-long-consistency-judge-v7',
      repair,
    ))

    expect(v6).not.toContain('重新执行全部冻结检查')
    expect(v7).toContain('重新执行全部冻结检查')
    expect(v7).toContain('不得为补齐字段而虚构证据')
    expect(v7).not.toContain('hiddenLabels')
    expect(v7).not.toContain(FIXTURE.hiddenLabels.expectedIssues[0].summary)
  })

  it('runs and verifies judge v5 with an explicit null repair binding', async () => {
    const execution: H4LongConsistencyRunCheckpointV1['execution'] = {
      generator: {
        provider: 'fixture',
        model: 'h4-synthetic-corpus',
        promptVersion: 'h4-synthetic-zh-60-v1',
      },
      verifier: {
        provider: 'independent',
        model: 'taxonomy-calibrated-verifier',
        promptVersion: 'h4-long-consistency-judge-v5',
      },
    }
    const call = vi.fn(async (input: H4LongConsistencyVerifierCallInputV1) => {
      expect(input.messages).toHaveLength(2)
      expect(JSON.stringify(input.messages)).toContain('operationalDefinitionZh')
      return {
        output: validJudgeOutput(),
        usage: { inputTokens: 1_200, outputTokens: 120, durationMs: 30, costUsd: 0.01 },
      }
    })

    const checkpoint = await runH4LongConsistencyVerifierV1({
      runId: 'h4-taxonomy-calibration-test',
      split: 'held-out',
      codeRevision: 'h84-test',
      fixtureIds: [FIXTURE.id],
      execution,
      call,
      now: () => 0,
    })

    expect(call).toHaveBeenCalledTimes(1)
    expect(checkpoint.status).toBe('completed')
    expect(checkpoint.completed[0].artifact.judgeRepair).toBeNull()
    expect(checkpoint.usage).toMatchObject({
      modelCalls: 1,
      meteredModelCalls: 1,
      inputTokens: 1_200,
      outputTokens: 120,
    })
    await expect(verifyH4LongConsistencyRunCheckpointV1(checkpoint)).resolves.toBe(true)
  })

  it('uses a third bounded attempt when a JSON repair reveals a different deterministic protocol failure', async () => {
    const execution: H4LongConsistencyRunCheckpointV1['execution'] = {
      generator: {
        provider: 'fixture',
        model: 'h4-synthetic-corpus',
        promptVersion: 'h4-synthetic-zh-60-v1',
      },
      verifier: {
        provider: 'independent',
        model: 'taxonomy-calibrated-verifier',
        promptVersion: 'h4-long-consistency-judge-v5',
      },
    }
    const call = vi.fn(async (input: H4LongConsistencyVerifierCallInputV1) => {
      const prompt = JSON.stringify(input.messages)
      if (input.attempt === 1) {
        expect(prompt).not.toContain('确定性协议纠错重试')
        return {
          output: 'not-json',
          usage: { inputTokens: 10, outputTokens: 1, durationMs: 2, costUsd: 0 },
        }
      }
      if (input.attempt === 2) {
        expect(prompt).toContain('只返回根对象')
        const invalid = JSON.parse(validJudgeOutput())
        invalid.issues[0].factEvidence.quote = '的'
        return {
          output: JSON.stringify(invalid),
          usage: { inputTokens: 20, outputTokens: 2, durationMs: 3, costUsd: 0 },
        }
      }
      expect(prompt).toContain('扩大 quote 到含专名、数字或上下文的唯一完整句')
      return {
        output: validJudgeOutput(),
        usage: { inputTokens: 30, outputTokens: 3, durationMs: 4, costUsd: 0 },
      }
    })

    const checkpoint = await runH4LongConsistencyVerifierV1({
      runId: 'h4-taxonomy-three-attempt-test',
      split: 'held-out',
      codeRevision: 'h84-test',
      fixtureIds: [FIXTURE.id],
      execution,
      call,
      maxAttemptsPerFixture: 3,
      now: () => 0,
    })

    expect(call).toHaveBeenCalledTimes(3)
    expect(checkpoint.status).toBe('completed')
    expect(checkpoint.failures.map(failure => failure.code)).toEqual(['invalid_json', 'ambiguous_evidence'])
    expect(checkpoint.completed[0].artifact.judgeRepair?.reason).toBe('unique-evidence')
    expect(checkpoint.usage).toMatchObject({ modelCalls: 3, inputTokens: 60, outputTokens: 6 })
    await expect(verifyH4LongConsistencyRunCheckpointV1(checkpoint)).resolves.toBe(true)
  })

  it('stops before a third call when the next repair message would be identical', async () => {
    const call = vi.fn(async () => ({
      output: 'still-not-json',
      usage: { inputTokens: 10, outputTokens: 1, durationMs: 2, costUsd: 0 },
    }))
    const checkpoint = await runH4LongConsistencyVerifierV1({
      runId: 'h4-taxonomy-no-identical-retry-test',
      split: 'held-out',
      codeRevision: 'h84-test',
      fixtureIds: [FIXTURE.id],
      execution: {
        generator: {
          provider: 'fixture',
          model: 'h4-synthetic-corpus',
          promptVersion: 'h4-synthetic-zh-60-v1',
        },
        verifier: {
          provider: 'independent',
          model: 'taxonomy-calibrated-verifier',
          promptVersion: 'h4-long-consistency-judge-v6',
        },
      },
      call,
      maxAttemptsPerFixture: 3,
      now: () => 0,
    })

    expect(call).toHaveBeenCalledTimes(2)
    expect(checkpoint.status).toBe('failed')
    expect(checkpoint.attempts[0].count).toBe(2)
    expect(checkpoint.failures.map(failure => failure.code)).toEqual(['invalid_json', 'invalid_json'])
    await expect(verifyH4LongConsistencyRunCheckpointV1(checkpoint)).resolves.toBe(true)
  })

  it('enforces the judge v6 eight-issue cap before evidence resolution', async () => {
    const tooMany = JSON.parse(validJudgeOutput())
    tooMany.issues = Array.from({ length: 9 }, (_, index) => ({
      ...tooMany.issues[0],
      id: `over-cap-${index}`,
    }))
    const checkpoint = await runH4LongConsistencyVerifierV1({
      runId: 'h4-taxonomy-cap-test',
      split: 'held-out',
      codeRevision: 'h84-test',
      fixtureIds: [FIXTURE.id],
      execution: {
        generator: {
          provider: 'fixture',
          model: 'h4-synthetic-corpus',
          promptVersion: 'h4-synthetic-zh-60-v1',
        },
        verifier: {
          provider: 'independent',
          model: 'taxonomy-calibrated-verifier',
          promptVersion: 'h4-long-consistency-judge-v6',
        },
      },
      call: async () => ({ output: JSON.stringify(tooMany) }),
      maxAttemptsPerFixture: 1,
      now: () => 0,
    })

    expect(checkpoint.status).toBe('failed')
    expect(checkpoint.failures[0].code).toBe('too_many_items')
    await expect(verifyH4LongConsistencyRunCheckpointV1(checkpoint)).resolves.toBe(true)
  })

  it('fails immediately on non-retryable provider status without fabricating usage', async () => {
    const error = Object.assign(new Error('account balance unavailable'), {
      status: 403,
      code: 'AccountOverdueError',
    })
    const call = vi.fn(async () => { throw error })
    const checkpoint = await runH4LongConsistencyVerifierV1({
      runId: 'h4-taxonomy-provider-terminal-test',
      split: 'held-out',
      codeRevision: 'h84-test',
      fixtureIds: [FIXTURE.id],
      execution: {
        generator: {
          provider: 'fixture',
          model: 'h4-synthetic-corpus',
          promptVersion: 'h4-synthetic-zh-60-v1',
        },
        verifier: {
          provider: 'independent',
          model: 'taxonomy-calibrated-verifier',
          promptVersion: 'h4-long-consistency-judge-v7',
        },
      },
      call,
      maxAttemptsPerFixture: 3,
      now: () => 0,
    })

    expect(call).toHaveBeenCalledTimes(1)
    expect(checkpoint.status).toBe('failed')
    expect(checkpoint.failures).toMatchObject([{
      attempt: 1,
      code: 'verifier_error_non_retryable',
      usage: null,
    }])
    expect(checkpoint.usage).toMatchObject({
      modelCalls: 1,
      meteredModelCalls: 0,
      unmeteredModelCalls: 1,
    })
    await expect(verifyH4LongConsistencyRunCheckpointV1(checkpoint)).resolves.toBe(true)
  })
})
