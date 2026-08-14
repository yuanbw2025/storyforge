import { describe, expect, it, vi } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  H4_LONG_CONSISTENCY_FIXTURES_V1,
  compareH4ConsistencyErrorDensityV1,
  exportH4LongConsistencyRunCheckpointV1,
  exportH4LongConsistencySealedScoreV1,
  importH4LongConsistencyRunCheckpointV1,
  importH4LongConsistencySealedScoreV1,
  parseH4LongConsistencyRunCheckpointV1,
  runH4LongConsistencyVerifierV1,
  scoreH4LongConsistencyCheckpointV1,
  verifyH4LongConsistencyRunCheckpointV1,
  verifyH4LongConsistencySealedScoreV1,
  wilsonInterval95V1,
  type H4LongConsistencyRunCheckpointV1,
  type H4LongConsistencyVerifierCallInputV1,
} from '../../src/lib/evals/long-consistency'

const EXECUTION: H4LongConsistencyRunCheckpointV1['execution'] = {
  generator: {
    provider: 'fixture',
    model: 'h4-synthetic-corpus',
    promptVersion: 'h4-synthetic-zh-60-v1',
  },
  verifier: {
    provider: 'independent',
    model: 'h4-verifier',
    promptVersion: 'h4-long-consistency-judge-v1',
  },
}

const FIXTURE_BY_ID = new Map(H4_LONG_CONSISTENCY_FIXTURES_V1.map(fixture => [fixture.id, fixture] as const))

function judgeOutput(fixtureId: string, options: { escalateIntent?: boolean; cleanFalsePositive?: boolean } = {}) {
  const fixture = FIXTURE_BY_ID.get(fixtureId)!
  const issues = fixture.hiddenLabels.expectedIssues.map(issue => ({
    id: `predicted:${fixture.id}`,
    subtype: issue.subtype,
    severity: issue.severity,
    intentClassification: options.escalateIntent && issue.intentClassification !== 'unintentional'
      ? 'unintentional'
      : issue.intentClassification,
    summary: '基于两段逐字证据的审查结论。',
    factEvidence: issue.factEvidence,
    contradictionEvidence: issue.contradictionEvidence,
  }))
  if (options.cleanFalsePositive && fixture.hiddenLabels.cleanControl) {
    const narrative = fixture.sources.find(source => source.kind === 'narrative')!
    const paragraphs = narrative.content.split('\n\n')
    issues.push({
      id: `predicted:${fixture.id}`,
      subtype: 'quantitative-mismatch',
      severity: 'high',
      intentClassification: 'unintentional',
      summary: '对照样例中的伪阳性。',
      factEvidence: { sourceId: narrative.id, quote: paragraphs[0] },
      contradictionEvidence: { sourceId: narrative.id, quote: paragraphs[1] },
    } as typeof issues[number])
  }
  return JSON.stringify({ schemaVersion: 1, issues })
}

function successfulCall(options: { escalateIntent?: boolean; cleanFalsePositive?: boolean } = {}) {
  return async ({ fixture }: H4LongConsistencyVerifierCallInputV1) => ({
    output: judgeOutput(fixture.id, options),
    usage: { inputTokens: 1_000, outputTokens: 100, durationMs: 25, costUsd: 0.01 },
  })
}

async function resignCheckpoint(
  checkpoint: H4LongConsistencyRunCheckpointV1,
): Promise<H4LongConsistencyRunCheckpointV1> {
  const { checkpointHash: _checkpointHash, ...body } = checkpoint
  return { ...checkpoint, checkpointHash: await hashCanonicalValue(body) }
}

function runnerInput(overrides: Partial<Parameters<typeof runH4LongConsistencyVerifierV1>[0]> = {}) {
  return {
    runId: 'h4-runner-test',
    split: 'held-out' as const,
    codeRevision: 'h4-test-revision',
    execution: EXECUTION,
    call: successfulCall(),
    now: () => 0,
    ...overrides,
  }
}

describe('R-HARNESS28 · H4 verifier runner, recovery and sealed scoring', { timeout: 20_000 }, () => {
  it('runs all held-out sources through an independent verifier and exposes only aggregate sealed scores', async () => {
    const visibleCalls: string[] = []
    const checkpoint = await runH4LongConsistencyVerifierV1(runnerInput({
      call: async input => {
        const serializedFixture = JSON.stringify(input.fixture)
        const fixture = FIXTURE_BY_ID.get(input.fixture.id)!
        expect(serializedFixture).not.toContain('hiddenLabels')
        expect(serializedFixture).not.toContain('expectedIssues')
        expect(serializedFixture).not.toContain(`${fixture.id}:issue-1`)
        for (const issue of fixture.hiddenLabels.expectedIssues) {
          expect(serializedFixture).not.toContain(issue.summary)
        }
        expect(input.verifier).toEqual(EXECUTION.verifier)
        expect(input.fixture).toEqual({ id: fixture.id, split: fixture.split, task: fixture.task })
        expect(Object.keys(input.fixture).sort()).toEqual(['id', 'split', 'task'])
        expect(input.traceHash).toMatch(/^[0-9a-f]{64}$/u)
        expect(input.messages[0].content).toContain('只读的中文长篇一致性审查 Agent')
        visibleCalls.push(input.fixture.id)
        return successfulCall()(input)
      },
    }))

    expect(checkpoint.status).toBe('completed')
    expect(checkpoint.completed).toHaveLength(20)
    expect(visibleCalls).toEqual(checkpoint.fixtureIds)
    expect(checkpoint.usage).toEqual({
      modelCalls: 20,
      meteredModelCalls: 20,
      unmeteredModelCalls: 0,
      inputTokens: 20_000,
      outputTokens: 2_000,
      durationMs: 500,
      costUsd: 0.20000000000000004,
    })
    expect(await verifyH4LongConsistencyRunCheckpointV1(checkpoint)).toBe(true)
    const exported = await exportH4LongConsistencyRunCheckpointV1(checkpoint)
    expect(exported).not.toContain('hiddenLabels')
    expect(exported).not.toContain('雨水顺着')
    await expect(importH4LongConsistencyRunCheckpointV1(exported)).resolves.toEqual(checkpoint)

    const score = await scoreH4LongConsistencyCheckpointV1({ checkpoint })
    expect(score.highSeverityHard).toMatchObject({ truePositive: 16, falsePositive: 0, falseNegative: 0 })
    expect(score.highSeverityHard.precision.estimate).toBe(1)
    expect(score.highSeverityHard.recall.estimate).toBe(1)
    expect(score.intentControls).toMatchObject({ cases: 2, hardEscalations: 0 })
    expect(score.cleanControls).toMatchObject({ cases: 1, hardFalsePositives: 0 })
    expect(score.taskCounts).toEqual({ generation: 5, continuation: 5, expansion: 5, completion: 5 })
    expect(score.gate).toEqual({ passed: true, failures: [] })
    const serializedScore = JSON.stringify(score)
    expect(serializedScore).not.toContain('expectedIssues')
    expect(serializedScore).not.toContain('absolute-time-contradiction')
    expect(serializedScore).not.toContain('同一事件的绝对日期前后冲突')
    expect(await verifyH4LongConsistencySealedScoreV1(score, checkpoint)).toBe(true)
    const exportedScore = await exportH4LongConsistencySealedScoreV1(score, checkpoint)
    await expect(importH4LongConsistencySealedScoreV1(exportedScore, checkpoint)).resolves.toEqual(score)
    await expect(importH4LongConsistencySealedScoreV1(JSON.stringify({
      ...score,
      hiddenLabels: ['leak'],
    }), checkpoint)).rejects.toThrow('完整性验证失败')
  })

  it('requires different model identities before the first verifier call', async () => {
    const call = vi.fn(successfulCall())
    await expect(runH4LongConsistencyVerifierV1(runnerInput({
      fixtureIds: ['h4-held-01'],
      execution: {
        generator: EXECUTION.generator,
        verifier: {
          provider: EXECUTION.generator.provider,
          model: EXECUTION.generator.model,
          promptVersion: 'h4-long-consistency-judge-v1',
        },
      },
      call,
    }))).rejects.toThrow('不同 provider/model 身份')
    expect(call).not.toHaveBeenCalled()
  })

  it('retries a protocol failure within the frozen attempt limit', async () => {
    const failures: H4LongConsistencyRunCheckpointV1[] = []
    const call = vi.fn(async (input: Parameters<ReturnType<typeof successfulCall>>[0]) => (
      call.mock.calls.length === 1
        ? { output: 'not-json', usage: { inputTokens: 10, outputTokens: 1, durationMs: 2, costUsd: 0 } }
        : successfulCall()(input)
    ))
    const checkpoint = await runH4LongConsistencyVerifierV1(runnerInput({
      fixtureIds: ['h4-held-01'],
      call,
      onCheckpoint: value => {
        if (value.failures.length && value.completed.length === 0) failures.push(value)
      },
    }))
    expect(call).toHaveBeenCalledTimes(2)
    expect(failures).toHaveLength(1)
    expect(failures[0].failures[0]?.code).toBe('invalid_json')
    expect(checkpoint.status).toBe('completed')
    expect(checkpoint.attempts).toEqual([{ fixtureId: 'h4-held-01', count: 2 }])
    expect(checkpoint.failures).toHaveLength(1)
    expect(checkpoint.usage.modelCalls).toBe(2)
    expect(checkpoint.usage).toMatchObject({
      meteredModelCalls: 2,
      unmeteredModelCalls: 0,
      inputTokens: 1_010,
      outputTokens: 101,
      durationMs: 27,
      costUsd: 0.01,
    })
  })

  it('turns a v4 protocol failure into a label-free deterministic repair input and binds it to the checkpoint', async () => {
    const priorOutputMarker = 'PRIOR-OUTPUT-MUST-NOT-BE-ECHOED'
    const execution: H4LongConsistencyRunCheckpointV1['execution'] = {
      generator: EXECUTION.generator,
      verifier: {
        provider: 'independent',
        model: 'h4-verifier-v4',
        promptVersion: 'h4-long-consistency-judge-v4',
      },
    }
    const call = vi.fn(async (input: H4LongConsistencyVerifierCallInputV1) => {
      const prompt = input.messages.map(message => message.content).join('\n')
      expect(prompt).not.toContain('hiddenLabels')
      if (input.attempt === 1) {
        expect(prompt).not.toContain('确定性协议纠错重试')
        return {
          output: `not-json-${priorOutputMarker}`,
          usage: { inputTokens: 10, outputTokens: 1, durationMs: 2, costUsd: 0 },
        }
      }
      expect(prompt).toContain('确定性协议纠错重试')
      expect(prompt).toContain('只返回根对象')
      expect(prompt).not.toContain(priorOutputMarker)
      return successfulCall()(input)
    })
    const checkpoint = await runH4LongConsistencyVerifierV1(runnerInput({
      fixtureIds: ['h4-held-01'],
      execution,
      call,
    }))

    expect(call).toHaveBeenCalledTimes(2)
    expect(checkpoint.status).toBe('completed')
    expect(checkpoint.completed[0].artifact.judgeRepair).toEqual({
      protocolVersion: 'h4-long-consistency-repair-v1',
      reason: 'json-contract',
    })
    expect(JSON.stringify(checkpoint)).not.toContain(priorOutputMarker)
    await expect(verifyH4LongConsistencyRunCheckpointV1(checkpoint)).resolves.toBe(true)

    const tampered = structuredClone(checkpoint)
    tampered.completed[0].artifact.judgeRepair = {
      protocolVersion: 'h4-long-consistency-repair-v1',
      reason: 'exact-schema',
    }
    const { artifactHash: _artifactHash, ...artifactBody } = tampered.completed[0].artifact
    tampered.completed[0].artifact.artifactHash = await hashCanonicalValue(artifactBody)
    const resigned = await resignCheckpoint(tampered)
    await expect(verifyH4LongConsistencyRunCheckpointV1(resigned)).resolves.toBe(false)
  })

  it('resumes after a persisted interruption without re-running a completed fixture', async () => {
    const fixtureIds = ['h4-dev-01', 'h4-dev-02']
    let persisted: H4LongConsistencyRunCheckpointV1 | null = null
    const calls: string[] = []
    const call = async (input: Parameters<ReturnType<typeof successfulCall>>[0]) => {
      calls.push(input.fixture.id)
      return successfulCall()(input)
    }
    await expect(runH4LongConsistencyVerifierV1(runnerInput({
      runId: 'h4-resume-test',
      split: 'development',
      fixtureIds,
      call,
      onCheckpoint: checkpoint => {
        persisted = checkpoint
        if (checkpoint.completed.length === 1) throw new Error('simulated-process-stop')
      },
    }))).rejects.toThrow('simulated-process-stop')
    expect(calls).toEqual(['h4-dev-01'])
    expect(persisted).not.toBeNull()
    const firstArtifactHash = persisted!.completed[0].artifact.artifactHash

    const resumed = await runH4LongConsistencyVerifierV1(runnerInput({
      runId: 'h4-resume-test',
      split: 'development',
      fixtureIds,
      call,
      resumeFrom: persisted,
    }))
    expect(calls).toEqual(['h4-dev-01', 'h4-dev-02'])
    expect(resumed.status).toBe('completed')
    expect(resumed.completed[0].artifact.artifactHash).toBe(firstArtifactHash)
    expect(await verifyH4LongConsistencyRunCheckpointV1(resumed)).toBe(true)

    const uninterrupted = await runH4LongConsistencyVerifierV1(runnerInput({
      runId: 'h4-resume-test',
      split: 'development',
      fixtureIds,
      call: successfulCall(),
    }))
    expect(resumed.checkpointHash).toBe(uninterrupted.checkpointHash)
  })

  it('detects nested artifact tampering even after the checkpoint is re-signed', async () => {
    const checkpoint = await runH4LongConsistencyVerifierV1(runnerInput({ fixtureIds: ['h4-held-01'] }))
    const tampered = structuredClone(checkpoint)
    tampered.completed[0].artifact.issues[0].summary = '篡改后的评审结论'
    const { checkpointHash: _checkpointHash, ...body } = tampered
    tampered.checkpointHash = await hashCanonicalValue(body)
    expect(await verifyH4LongConsistencyRunCheckpointV1(tampered)).toBe(false)
    expect(() => parseH4LongConsistencyRunCheckpointV1({
      ...checkpoint,
      hiddenLabels: ['leak'],
    })).toThrow('checkpoint.hiddenLabels: 未知字段')
  })

  it('rejects re-signed checkpoints whose state history or trace no longer matches execution order', async () => {
    const partial = await runH4LongConsistencyVerifierV1(runnerInput({
      split: 'development',
      fixtureIds: ['h4-dev-01', 'h4-dev-02'],
      maxAttemptsPerFixture: 1,
      budget: { maxModelCalls: 1 },
    }))
    const forgedState = structuredClone(partial)
    forgedState.status = 'failed'
    expect(await verifyH4LongConsistencyRunCheckpointV1(
      await resignCheckpoint(forgedState),
    )).toBe(false)

    const complete = await runH4LongConsistencyVerifierV1(runnerInput({ fixtureIds: ['h4-held-01'] }))
    const forgedTrace = structuredClone(complete)
    forgedTrace.completed[0].artifact.traceHashes = ['f'.repeat(64)]
    const { artifactHash: _artifactHash, ...artifactBody } = forgedTrace.completed[0].artifact
    forgedTrace.completed[0].artifact.artifactHash = await hashCanonicalValue(artifactBody)
    expect(await verifyH4LongConsistencyRunCheckpointV1(
      await resignCheckpoint(forgedTrace),
    )).toBe(false)
  })

  it('stops at the model-call budget and cannot score an incomplete run as passing', async () => {
    const call = vi.fn(successfulCall())
    const checkpoint = await runH4LongConsistencyVerifierV1(runnerInput({
      split: 'development',
      fixtureIds: ['h4-dev-01', 'h4-dev-02'],
      maxAttemptsPerFixture: 1,
      budget: { maxModelCalls: 1 },
      call,
    }))
    expect(call).toHaveBeenCalledTimes(1)
    expect(checkpoint.status).toBe('budget-exhausted')
    expect(checkpoint.completed).toHaveLength(1)
    expect(await verifyH4LongConsistencyRunCheckpointV1(checkpoint)).toBe(true)
    const score = await scoreH4LongConsistencyCheckpointV1({ checkpoint })
    expect(score.gate.passed).toBe(false)
    expect(score.gate.failures).toEqual(expect.arrayContaining([
      'run-not-completed',
      'minimum-completed-cases',
      'budget-exceeded',
    ]))
  })

  it('marks failed calls without usage as unmetered and blocks their release evidence', async () => {
    const checkpoint = await runH4LongConsistencyVerifierV1(runnerInput({
      split: 'development',
      fixtureIds: ['h4-dev-01'],
      maxAttemptsPerFixture: 1,
      call: async () => {
        throw new Error('network-disconnected')
      },
    }))
    expect(checkpoint.status).toBe('failed')
    expect(checkpoint.usage).toMatchObject({
      modelCalls: 1,
      meteredModelCalls: 0,
      unmeteredModelCalls: 1,
    })
    expect(checkpoint.failures[0].usage).toBeNull()
    const score = await scoreH4LongConsistencyCheckpointV1({ checkpoint })
    expect(score.gate.failures).toContain('usage-evidence-missing')
  })

  it('fails the release gate for hard intent escalation and clean-control false positives', async () => {
    const checkpoint = await runH4LongConsistencyVerifierV1(runnerInput({
      call: successfulCall({ escalateIntent: true, cleanFalsePositive: true }),
    }))
    const score = await scoreH4LongConsistencyCheckpointV1({ checkpoint })
    expect(score.intentControls).toMatchObject({ cases: 2, hardEscalations: 2 })
    expect(score.cleanControls).toMatchObject({ cases: 1, hardFalsePositives: 1 })
    expect(score.gate.passed).toBe(false)
    expect(score.gate.failures).toEqual(expect.arrayContaining([
      'high-severity-hard-precision',
      'intent-escalation',
      'clean-hard-false-positive',
    ]))
    const tampered = { ...score, completedCases: 20_000 }
    expect(await verifyH4LongConsistencySealedScoreV1(tampered, checkpoint)).toBe(false)
  })

  it('reports Wilson intervals and deterministic paired bootstrap density reduction', () => {
    const interval = wilsonInterval95V1(16, 16)
    expect(interval.estimate).toBe(1)
    expect(interval.lower).toBeGreaterThan(0.8)
    expect(interval.upper).toBe(1)
    expect(wilsonInterval95V1(0, 0)).toEqual({
      successes: 0,
      samples: 0,
      estimate: null,
      lower: 0,
      upper: 1,
      confidence: 0.95,
    })

    const baseline = Array.from({ length: 8 }, (_, index) => ({
      fixtureId: `paired-${index + 1}`,
      narrativeChars: 10_000,
      hardConflictCount: 4,
    }))
    const candidate = baseline.map(item => ({ ...item, narrativeChars: 7_500, hardConflictCount: 2 }))
    const comparison = compareH4ConsistencyErrorDensityV1({
      baseline,
      candidate,
      bootstrapSamples: 500,
      seed: 28,
    })
    expect(comparison).toMatchObject({
      pairedCases: 8,
      baselineDensity: 4,
      candidateDensity: 2.6666666666666665,
      relativeReduction: 0.33333333333333337,
      bootstrap: {
        lower: 0.33333333333333337,
        upper: 0.33333333333333337,
        samples: 500,
      },
    })
    expect(() => compareH4ConsistencyErrorDensityV1({
      baseline,
      candidate: candidate.slice(1),
    })).toThrow('相同 fixtureId')
  })
})
