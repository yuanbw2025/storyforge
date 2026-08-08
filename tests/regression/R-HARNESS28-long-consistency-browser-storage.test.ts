import { describe, expect, it, vi } from 'vitest'
import {
  H4_LONG_CONSISTENCY_FIXTURES_V1,
  clearH4LongConsistencyBrowserCheckpointV1,
  h4LongConsistencyBrowserStorageKeyV1,
  loadH4LongConsistencyBrowserStateV1,
  persistH4LongConsistencyBrowserCheckpointV1,
  runH4LongConsistencyVerifierV1,
  type H4LongConsistencyRunCheckpointV1,
  type H4LongConsistencyVerifierCallInputV1,
} from '../../src/lib/evals/long-consistency'
import * as legacyLongConsistencyRunner from '../../src/lib/evals/long-consistency/runner'

const FIXTURE_BY_ID = new Map(H4_LONG_CONSISTENCY_FIXTURES_V1.map(fixture => [fixture.id, fixture] as const))

function judgeOutput(fixtureId: string): string {
  const fixture = FIXTURE_BY_ID.get(fixtureId)!
  return JSON.stringify({
    schemaVersion: 1,
    issues: fixture.hiddenLabels.expectedIssues.map(issue => ({
      id: `predicted:${issue.id}`,
      subtype: issue.subtype,
      severity: issue.severity,
      intentClassification: issue.intentClassification,
      summary: '浏览器恢复测试的逐字证据结论。',
      factEvidence: issue.factEvidence,
      contradictionEvidence: issue.contradictionEvidence,
    })),
  })
}

function verifierCall(input: H4LongConsistencyVerifierCallInputV1) {
  return Promise.resolve({
    output: judgeOutput(input.fixture.id),
    usage: { inputTokens: 1_000, outputTokens: 100, durationMs: 20, costUsd: 0.01 },
  })
}

function runnerInput(overrides: Partial<Parameters<typeof runH4LongConsistencyVerifierV1>[0]> = {}) {
  return {
    runId: 'h4-browser-storage-test',
    split: 'development' as const,
    codeRevision: 'browser-storage-test',
    execution: {
      generator: {
        provider: 'fixture',
        model: 'h4-synthetic-corpus',
        promptVersion: 'h4-synthetic-zh-60-v1',
      },
      verifier: {
        provider: 'independent',
        model: 'h4-browser-verifier',
        promptVersion: 'h4-long-consistency-judge-v1',
      },
    },
    call: verifierCall,
    now: () => 0,
    ...overrides,
  }
}

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

describe('R-HARNESS28 · H4 browser checkpoint persistence', () => {
  it('does not retain the legacy browser model runners or result-storage keys', () => {
    expect('runEvalInBrowser' in legacyLongConsistencyRunner).toBe(false)
    expect('runPairedEvalInBrowser' in legacyLongConsistencyRunner).toBe(false)
    expect('NS0_RESULTS_STORAGE_KEY' in legacyLongConsistencyRunner).toBe(false)
    expect('NS0_PAIRED_RESULTS_STORAGE_KEY' in legacyLongConsistencyRunner).toBe(false)
  })

  it('round-trips only verified checkpoints and keeps split slots isolated', async () => {
    const storage = memoryStorage()
    const checkpoint = await runH4LongConsistencyVerifierV1(runnerInput({
      fixtureIds: ['h4-dev-01'],
    }))
    await persistH4LongConsistencyBrowserCheckpointV1(checkpoint, storage)

    const loaded = await loadH4LongConsistencyBrowserStateV1('development', storage)
    expect(loaded?.checkpoint).toEqual(checkpoint)
    expect(loaded?.score.completedCases).toBe(1)
    expect(loaded?.score.gate.passed).toBe(false)
    expect(await loadH4LongConsistencyBrowserStateV1('held-out', storage)).toBeNull()

    clearH4LongConsistencyBrowserCheckpointV1('development', storage)
    expect(await loadH4LongConsistencyBrowserStateV1('development', storage)).toBeNull()
  })

  it('rejects corrupt JSON, re-signed state forgery and a checkpoint in the wrong split slot', async () => {
    const storage = memoryStorage()
    storage.setItem(h4LongConsistencyBrowserStorageKeyV1('development'), '{broken')
    await expect(loadH4LongConsistencyBrowserStateV1('development', storage)).rejects.toThrow('不是有效 JSON')

    const checkpoint = await runH4LongConsistencyVerifierV1(runnerInput({
      fixtureIds: ['h4-dev-01'],
    }))
    await persistH4LongConsistencyBrowserCheckpointV1(checkpoint, storage)
    storage.setItem(
      h4LongConsistencyBrowserStorageKeyV1('held-out'),
      storage.getItem(h4LongConsistencyBrowserStorageKeyV1('development'))!,
    )
    await expect(loadH4LongConsistencyBrowserStateV1('held-out', storage)).rejects.toThrow('错误 split')

    const forged = structuredClone(checkpoint)
    forged.status = 'failed'
    storage.setItem(h4LongConsistencyBrowserStorageKeyV1('development'), JSON.stringify(forged))
    await expect(loadH4LongConsistencyBrowserStateV1('development', storage)).rejects.toThrow('完整性验证失败')
  })

  it('persists each completed case and resumes after a simulated refresh without repeating it', async () => {
    const storage = memoryStorage()
    const calls: string[] = []
    let interrupted: H4LongConsistencyRunCheckpointV1 | null = null
    await expect(runH4LongConsistencyVerifierV1(runnerInput({
      fixtureIds: ['h4-dev-01', 'h4-dev-02'],
      call: async input => {
        calls.push(input.fixture.id)
        return verifierCall(input)
      },
      onCheckpoint: async checkpoint => {
        await persistH4LongConsistencyBrowserCheckpointV1(checkpoint, storage)
        if (checkpoint.completed.length === 1) {
          interrupted = checkpoint
          throw new Error('simulated-refresh')
        }
      },
    }))).rejects.toThrow('simulated-refresh')
    expect(interrupted).not.toBeNull()

    const restored = await loadH4LongConsistencyBrowserStateV1('development', storage)
    expect(restored?.checkpoint.completed.map(item => item.fixtureId)).toEqual(['h4-dev-01'])
    const call = vi.fn(async (input: H4LongConsistencyVerifierCallInputV1) => {
      calls.push(input.fixture.id)
      return verifierCall(input)
    })
    const completed = await runH4LongConsistencyVerifierV1(runnerInput({
      fixtureIds: ['h4-dev-01', 'h4-dev-02'],
      resumeFrom: restored!.checkpoint,
      call,
      onCheckpoint: checkpoint => persistH4LongConsistencyBrowserCheckpointV1(checkpoint, storage),
    }))
    expect(completed.status).toBe('completed')
    expect(call).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['h4-dev-01', 'h4-dev-02'])
    expect((await loadH4LongConsistencyBrowserStateV1('development', storage))?.checkpoint).toEqual(completed)
  })
})
