import { describe, expect, it, vi } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  H4_LONG_CONSISTENCY_FIXTURES_V1,
  H4_SUBTYPE_ADJUDICATION_PROMPT_VERSION_V1,
  buildH4SubtypeAdjudicationMessagesV1,
  clearH4SubtypeAdjudicationBrowserCheckpointV1,
  deriveH4SubtypeAdjudicatedIssuesV1,
  loadH4SubtypeAdjudicationBrowserStateV1,
  persistH4SubtypeAdjudicationBrowserCheckpointV1,
  runH4LongConsistencyVerifierV1,
  runH4SubtypeAdjudicationV1,
  scoreH4SubtypeAdjudicationCheckpointV1,
  verifyH4SubtypeAdjudicationCheckpointV1,
  type H4LongConsistencyRunCheckpointV1,
  type H4LongConsistencyVerifierCallInputV1,
  type H4SubtypeAdjudicationArtifactV1,
  type H4SubtypeAdjudicationCallInputV1,
  type H4SubtypeAdjudicationCheckpointV1,
} from '../../src/lib/evals/long-consistency'

const DEVELOPMENT = H4_LONG_CONSISTENCY_FIXTURES_V1.filter(item => item.split === 'development')
const CONFLICT_FIXTURE = DEVELOPMENT[0]
const CLEAN_FIXTURE = DEVELOPMENT.find(item => item.hiddenLabels.cleanControl)!

function judgeOutput(fixtureId: string, summary = 'STAGE-ONE-SUMMARY-MUST-STAY-HIDDEN'): string {
  const fixture = DEVELOPMENT.find(item => item.id === fixtureId)!
  return JSON.stringify({
    schemaVersion: 1,
    issues: fixture.hiddenLabels.expectedIssues.map((issue, index) => ({
      id: `STAGE-ONE-ID-MUST-STAY-HIDDEN-${index + 1}`,
      subtype: issue.subtype,
      severity: issue.severity,
      intentClassification: issue.intentClassification,
      summary,
      factEvidence: issue.factEvidence,
      contradictionEvidence: issue.contradictionEvidence,
    })),
  })
}

async function createBase(fixtureIds: readonly string[]): Promise<H4LongConsistencyRunCheckpointV1> {
  return await runH4LongConsistencyVerifierV1({
    runId: `h85-base-${fixtureIds.length}`,
    split: 'development',
    codeRevision: 'h85-base-test',
    fixtureIds,
    execution: {
      generator: {
        provider: 'fixture',
        model: 'h4-synthetic-corpus',
        promptVersion: 'h4-synthetic-zh-60-v1',
      },
      verifier: {
        provider: 'agnes',
        model: 'agnes-2.5-flash',
        promptVersion: 'h4-long-consistency-judge-v7',
      },
    },
    call: async (input: H4LongConsistencyVerifierCallInputV1) => ({
      output: judgeOutput(input.fixture.id),
      usage: { inputTokens: 100, outputTokens: 10, durationMs: 5, costUsd: 0.001 },
    }),
    maxAttemptsPerFixture: 2,
    now: () => 0,
  })
}

function adjudicatorBinding() {
  return {
    provider: 'agnes',
    model: 'agnes-2.5-flash',
    promptVersion: H4_SUBTYPE_ADJUDICATION_PROMPT_VERSION_V1,
  }
}

function adjudicationOutput(fixtureId: string, subtypeOverride?: string): string {
  const fixture = DEVELOPMENT.find(item => item.id === fixtureId)!
  return JSON.stringify({
    schemaVersion: 1,
    decisions: fixture.hiddenLabels.expectedIssues.map((issue, index) => ({
      candidateId: `candidate-${String(index + 1).padStart(2, '0')}`,
      verdict: 'conflict',
      subtype: subtypeOverride ?? issue.subtype,
      reason: '两段证据满足唯一最具体的操作定义。',
    })),
  })
}

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

async function resignArtifact(
  artifact: H4SubtypeAdjudicationArtifactV1,
): Promise<H4SubtypeAdjudicationArtifactV1> {
  const { artifactHash: _artifactHash, ...body } = artifact
  return { ...artifact, artifactHash: await hashCanonicalValue(body) }
}

async function resignCheckpoint(
  checkpoint: H4SubtypeAdjudicationCheckpointV1,
): Promise<H4SubtypeAdjudicationCheckpointV1> {
  const { checkpointHash: _checkpointHash, ...body } = checkpoint
  return { ...checkpoint, checkpointHash: await hashCanonicalValue(body) }
}

describe('R-HARNESS85 · verified evidence pair subtype adjudication', () => {
  it('shows only deterministic candidate ids and verified quote pairs, never stage-one labels or summaries', async () => {
    const base = await createBase([CONFLICT_FIXTURE.id])
    const sourceCase = base.completed[0]
    const messages = buildH4SubtypeAdjudicationMessagesV1(sourceCase)
    const serialized = JSON.stringify(messages)

    expect(serialized).toContain('candidate-01')
    expect(serialized).toContain(CONFLICT_FIXTURE.hiddenLabels.expectedIssues[0].factEvidence.quote)
    expect(serialized).toContain('operationalDefinitionZh')
    expect(serialized).toContain('decisionBoundaryZh')
    expect(serialized).not.toContain('STAGE-ONE-SUMMARY-MUST-STAY-HIDDEN')
    expect(serialized).not.toContain('STAGE-ONE-ID-MUST-STAY-HIDDEN')
    expect(serialized).not.toContain('hiddenLabels')
    expect(serialized).not.toContain('severity')
    expect(serialized).not.toContain('intentClassification')
  })

  it('records the adjudicator as a distinct model call and derives only the adjudicated subtype', async () => {
    const base = await createBase([CONFLICT_FIXTURE.id])
    const replacement = CONFLICT_FIXTURE.hiddenLabels.expectedIssues[0].subtype === 'duration-contradiction'
      ? 'absolute-time-contradiction'
      : 'duration-contradiction'
    const call = vi.fn(async (input: H4SubtypeAdjudicationCallInputV1) => ({
      output: adjudicationOutput(input.fixture.id, replacement),
      usage: { inputTokens: 40, outputTokens: 4, durationMs: 3, costUsd: 0.0004 },
    }))
    const checkpoint = await runH4SubtypeAdjudicationV1({
      runId: 'h85-one-call-test',
      codeRevision: 'h85-test',
      baseCheckpoint: base,
      adjudicator: adjudicatorBinding(),
      call,
      now: () => 0,
    })

    expect(call).toHaveBeenCalledTimes(1)
    expect(checkpoint.status).toBe('completed')
    expect(checkpoint.attempts[0].count).toBe(1)
    expect(checkpoint.calls).toHaveLength(1)
    expect(checkpoint.calls[0]).toMatchObject({
      stage: 'subtype-adjudication',
      status: 'succeeded',
      inputHash: checkpoint.completed[0].artifact.call?.inputHash,
      outputHash: checkpoint.completed[0].artifact.call?.outputHash,
    })
    expect(checkpoint.usage).toMatchObject({
      modelCalls: 1,
      meteredModelCalls: 1,
      inputTokens: 40,
      outputTokens: 4,
    })
    const derived = deriveH4SubtypeAdjudicatedIssuesV1(
      base.completed[0],
      checkpoint.completed[0].artifact.decisions,
    )
    expect(derived[0].subtype).toBe(replacement)
    expect(checkpoint.completed[0].artifact.source.verifierUsage.inputTokens).toBe(100)
    await expect(verifyH4SubtypeAdjudicationCheckpointV1(checkpoint)).resolves.toBe(true)
  })

  it('completes a clean zero-candidate parent without calling or charging the adjudicator', async () => {
    const base = await createBase([CLEAN_FIXTURE.id])
    const call = vi.fn()
    const checkpoint = await runH4SubtypeAdjudicationV1({
      runId: 'h85-zero-call-test',
      codeRevision: 'h85-test',
      baseCheckpoint: base,
      adjudicator: adjudicatorBinding(),
      call,
      now: () => 0,
    })

    expect(call).not.toHaveBeenCalled()
    expect(checkpoint.status).toBe('completed')
    expect(checkpoint.completed[0]).toMatchObject({ attempts: 0, rawAdjudicationOutput: null })
    expect(checkpoint.completed[0].artifact.call).toBeNull()
    expect(checkpoint.usage.modelCalls).toBe(0)
    await expect(verifyH4SubtypeAdjudicationCheckpointV1(checkpoint)).resolves.toBe(true)
  })

  it('uses a second call only with a changed static repair input and does not echo the bad output', async () => {
    const base = await createBase([CONFLICT_FIXTURE.id])
    const rawMarker = 'RAW-H85-OUTPUT-MUST-STAY-OUT'
    const call = vi.fn(async (input: H4SubtypeAdjudicationCallInputV1) => {
      const prompt = JSON.stringify(input.messages)
      if (input.attempt === 1) {
        expect(prompt).not.toContain('确定性判类协议纠错')
        return {
          output: `not-json-${rawMarker}`,
          usage: { inputTokens: 10, outputTokens: 1, durationMs: 2, costUsd: 0 },
        }
      }
      expect(prompt).toContain('确定性判类协议纠错')
      expect(prompt).toContain('只返回根 JSON 对象')
      expect(prompt).not.toContain(rawMarker)
      return {
        output: adjudicationOutput(input.fixture.id),
        usage: { inputTokens: 20, outputTokens: 2, durationMs: 3, costUsd: 0 },
      }
    })
    const checkpoint = await runH4SubtypeAdjudicationV1({
      runId: 'h85-repair-test',
      codeRevision: 'h85-test',
      baseCheckpoint: base,
      adjudicator: adjudicatorBinding(),
      call,
      now: () => 0,
    })

    expect(call).toHaveBeenCalledTimes(2)
    expect(checkpoint.status).toBe('completed')
    expect(checkpoint.calls.map(item => item.inputHash)).toHaveLength(2)
    expect(checkpoint.calls[0].inputHash).not.toBe(checkpoint.calls[1].inputHash)
    expect(checkpoint.calls.map(item => item.status)).toEqual(['protocol-failed', 'succeeded'])
    expect(checkpoint.usage).toMatchObject({ modelCalls: 2, inputTokens: 30, outputTokens: 3 })
    expect(JSON.stringify(checkpoint.calls)).not.toContain(rawMarker)
    await expect(verifyH4SubtypeAdjudicationCheckpointV1(checkpoint)).resolves.toBe(true)
  })

  it('stops a coded 403 after one explicit unmetered adjudicator call', async () => {
    const base = await createBase([CONFLICT_FIXTURE.id])
    const error = Object.assign(new Error('account overdue'), { status: 403, code: 'AccountOverdueError' })
    const call = vi.fn(async () => { throw error })
    const checkpoint = await runH4SubtypeAdjudicationV1({
      runId: 'h85-provider-terminal-test',
      codeRevision: 'h85-test',
      baseCheckpoint: base,
      adjudicator: adjudicatorBinding(),
      call,
      now: () => 0,
    })

    expect(call).toHaveBeenCalledTimes(1)
    expect(checkpoint.status).toBe('failed')
    expect(checkpoint.calls).toMatchObject([{
      status: 'provider-failed',
      failureCode: 'adjudicator_error_non_retryable',
      outputHash: null,
      usage: null,
    }])
    expect(checkpoint.usage).toMatchObject({ modelCalls: 1, unmeteredModelCalls: 1 })
    await expect(verifyH4SubtypeAdjudicationCheckpointV1(checkpoint)).resolves.toBe(true)
  })

  it('pauses a 429 after one call and resumes it without spending the protocol repair budget', async () => {
    const base = await createBase([CONFLICT_FIXTURE.id])
    const rateLimit = new Error('AI API Error (429): free users rate limit')
    const blockedCall = vi.fn(async () => { throw rateLimit })
    const blocked = await runH4SubtypeAdjudicationV1({
      runId: 'h85-provider-blocked-test',
      codeRevision: 'h85-test',
      baseCheckpoint: base,
      adjudicator: adjudicatorBinding(),
      call: blockedCall,
      now: () => 0,
    })

    expect(blockedCall).toHaveBeenCalledTimes(1)
    expect(blocked.status).toBe('provider-blocked')
    expect(blocked.attempts[0].count).toBe(1)
    expect(blocked.calls).toMatchObject([{
      status: 'provider-failed',
      failureCode: 'adjudicator_rate_limited',
      outputHash: null,
      usage: null,
    }])
    await expect(verifyH4SubtypeAdjudicationCheckpointV1(blocked)).resolves.toBe(true)

    const resumedCall = vi.fn(async (input: H4SubtypeAdjudicationCallInputV1) => ({
      output: adjudicationOutput(input.fixture.id),
    }))
    const completed = await runH4SubtypeAdjudicationV1({
      runId: blocked.runId,
      codeRevision: blocked.codeRevision,
      baseCheckpoint: base,
      adjudicator: adjudicatorBinding(),
      call: resumedCall,
      resumeFrom: blocked,
      now: () => 1,
    })

    expect(resumedCall).toHaveBeenCalledTimes(1)
    expect(completed.status).toBe('completed')
    expect(completed.attempts[0].count).toBe(2)
    expect(completed.calls.map(item => item.status)).toEqual(['provider-failed', 'succeeded'])
    await expect(verifyH4SubtypeAdjudicationCheckpointV1(completed)).resolves.toBe(true)
  })

  it('拒绝把旧式通用错误码伪装成可恢复的 429 检查点', async () => {
    const base = await createBase([CONFLICT_FIXTURE.id])
    const rateLimit = Object.assign(new Error('free users rate limit'), { status: 429 })
    const first = await runH4SubtypeAdjudicationV1({
      runId: 'h85-invalid-rate-limit-test',
      codeRevision: 'h85-test',
      baseCheckpoint: base,
      adjudicator: adjudicatorBinding(),
      call: async () => { throw rateLimit },
      now: () => 0,
    })
    const second = await runH4SubtypeAdjudicationV1({
      runId: first.runId,
      codeRevision: first.codeRevision,
      baseCheckpoint: base,
      adjudicator: adjudicatorBinding(),
      call: async () => { throw rateLimit },
      resumeFrom: first,
      now: () => 1,
    })
    const invalid = structuredClone(second)
    invalid.status = 'failed'
    invalid.failures = invalid.failures.map(failure => ({
      ...failure,
      code: 'adjudicator_error',
      message: 'AI API Error (429): free users rate limit',
    }))
    invalid.calls = invalid.calls.map(call => ({ ...call, failureCode: 'adjudicator_error' }))
    const signedInvalid = await resignCheckpoint(invalid)

    expect(signedInvalid.attempts[0].count).toBe(2)
    await expect(verifyH4SubtypeAdjudicationCheckpointV1(signedInvalid)).resolves.toBe(false)
    await expect(runH4SubtypeAdjudicationV1({
      runId: signedInvalid.runId,
      codeRevision: signedInvalid.codeRevision,
      baseCheckpoint: base,
      adjudicator: adjudicatorBinding(),
      call: async input => ({ output: adjudicationOutput(input.fixture.id) }),
      resumeFrom: signedInvalid,
      now: () => 2,
    })).rejects.toThrow('failed 与终止条件不匹配')
  })

  it('rejects re-signed stage hash and call-ledger tampering', async () => {
    const base = await createBase([CONFLICT_FIXTURE.id])
    const checkpoint = await runH4SubtypeAdjudicationV1({
      runId: 'h85-tamper-test',
      codeRevision: 'h85-test',
      baseCheckpoint: base,
      adjudicator: adjudicatorBinding(),
      call: async input => ({ output: adjudicationOutput(input.fixture.id) }),
      now: () => 0,
    })

    const inputTamper = structuredClone(checkpoint)
    inputTamper.completed[0].artifact.call!.inputHash = 'a'.repeat(64)
    inputTamper.completed[0].artifact = await resignArtifact(inputTamper.completed[0].artifact)
    await expect(verifyH4SubtypeAdjudicationCheckpointV1(
      await resignCheckpoint(inputTamper),
    )).resolves.toBe(false)

    const ledgerTamper = structuredClone(checkpoint)
    ledgerTamper.calls = []
    ledgerTamper.usage = {
      modelCalls: 0,
      meteredModelCalls: 0,
      unmeteredModelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      costUsd: 0,
    }
    await expect(verifyH4SubtypeAdjudicationCheckpointV1(
      await resignCheckpoint(ledgerTamper),
    )).resolves.toBe(false)
  })

  it('reuses the sealed scorer and accounts discovery plus adjudication calls separately', async () => {
    const base = await createBase(DEVELOPMENT.map(item => item.id))
    const checkpoint = await runH4SubtypeAdjudicationV1({
      runId: 'h85-perfect-development-test',
      codeRevision: 'h85-test',
      baseCheckpoint: base,
      adjudicator: adjudicatorBinding(),
      call: async input => ({
        output: adjudicationOutput(input.fixture.id),
        usage: { inputTokens: 20, outputTokens: 2, durationMs: 3, costUsd: 0.0002 },
      }),
      now: () => 0,
    })
    const score = await scoreH4SubtypeAdjudicationCheckpointV1({ checkpoint })

    expect(checkpoint.status).toBe('completed')
    expect(checkpoint.calls).toHaveLength(38)
    expect(score.highSeverityHard).toMatchObject({ truePositive: 32, falsePositive: 0, falseNegative: 0 })
    expect(score.usage.discovery.modelCalls).toBe(40)
    expect(score.usage.adjudication.modelCalls).toBe(38)
    expect(score.usage.total.modelCalls).toBe(78)
    expect(score.gate).toEqual({ passed: true, failures: [] })
  })

  it('round-trips a self-contained H85 checkpoint without depending on the H4 storage slot', async () => {
    const storage = memoryStorage()
    const base = await createBase([CONFLICT_FIXTURE.id])
    const checkpoint = await runH4SubtypeAdjudicationV1({
      runId: 'h85-browser-storage-test',
      codeRevision: 'h85-test',
      baseCheckpoint: base,
      adjudicator: adjudicatorBinding(),
      call: async input => ({ output: adjudicationOutput(input.fixture.id) }),
      now: () => 0,
    })
    await persistH4SubtypeAdjudicationBrowserCheckpointV1(checkpoint, storage)

    const restored = await loadH4SubtypeAdjudicationBrowserStateV1('development', storage)
    expect(restored?.checkpoint).toEqual(checkpoint)
    expect(restored?.checkpoint.baseCheckpoint).toEqual(base)
    expect(restored?.score.completedCases).toBe(1)
    clearH4SubtypeAdjudicationBrowserCheckpointV1('development', storage)
    expect(await loadH4SubtypeAdjudicationBrowserStateV1('development', storage)).toBeNull()
  })
})
