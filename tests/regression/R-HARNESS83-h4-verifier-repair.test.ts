import { describe, expect, it, vi } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
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
const EXECUTION: H4LongConsistencyRunCheckpointV1['execution'] = {
  generator: { provider: 'fixture', model: 'h4-synthetic-corpus', promptVersion: 'h4-synthetic-zh-60-v1' },
  verifier: { provider: 'independent', model: 'repair-verifier', promptVersion: 'h4-long-consistency-judge-v4' },
}

function validJudgeOutput(): string {
  return JSON.stringify({
    schemaVersion: 1,
    issues: FIXTURE.hiddenLabels.expectedIssues.map(issue => ({
      id: `predicted:${FIXTURE.id}:${issue.id}`,
      subtype: issue.subtype,
      severity: issue.severity,
      intentClassification: issue.intentClassification,
      summary: '两段逐字证据互相冲突。',
      factEvidence: issue.factEvidence,
      contradictionEvidence: issue.contradictionEvidence,
    })),
  })
}

async function resignCheckpoint(
  checkpoint: H4LongConsistencyRunCheckpointV1,
): Promise<H4LongConsistencyRunCheckpointV1> {
  const { checkpointHash: _checkpointHash, ...body } = checkpoint
  return { ...checkpoint, checkpointHash: await hashCanonicalValue(body) }
}

describe('R-HARNESS83 · H4 verifier deterministic repair', () => {
  it('maps only deterministic parser failures to a closed label-free repair message', async () => {
    expect(createLongConsistencyJudgeRepairV1('ambiguous_evidence')).toEqual({
      protocolVersion: 'h4-long-consistency-repair-v1',
      reason: 'unique-evidence',
    })
    expect(createLongConsistencyJudgeRepairV1('unknown_field')?.reason).toBe('exact-schema')
    expect(createLongConsistencyJudgeRepairV1('verifier_error')).toBeNull()

    const repair = createLongConsistencyJudgeRepairV1('evidence_not_found')
    const messages = await buildLongConsistencyJudgeMessagesV1(
      FIXTURE.sources,
      'h4-long-consistency-judge-v4',
      repair,
    )
    const serialized = JSON.stringify(messages)
    expect(messages).toHaveLength(3)
    expect(serialized).toContain('确定性协议纠错重试')
    expect(serialized).toContain('不能改写、补字或纠错')
    expect(serialized).not.toContain('hiddenLabels')
    expect(serialized).not.toContain(FIXTURE.hiddenLabels.expectedIssues[0].summary)
  })

  it('repairs the second attempt without echoing raw output and rejects a rebound repair reason', async () => {
    const rawMarker = 'RAW-ATTEMPT-ONE-MUST-STAY-OUT'
    const call = vi.fn(async (input: H4LongConsistencyVerifierCallInputV1) => {
      const serialized = JSON.stringify(input.messages)
      if (input.attempt === 1) {
        expect(serialized).not.toContain('确定性协议纠错重试')
        return {
          output: `not-json-${rawMarker}`,
          usage: { inputTokens: 10, outputTokens: 1, durationMs: 2, costUsd: 0 },
        }
      }
      expect(serialized).toContain('确定性协议纠错重试')
      expect(serialized).toContain('只返回根对象')
      expect(serialized).not.toContain(rawMarker)
      return {
        output: validJudgeOutput(),
        usage: { inputTokens: 1_000, outputTokens: 100, durationMs: 25, costUsd: 0.01 },
      }
    })
    const checkpoint = await runH4LongConsistencyVerifierV1({
      runId: 'h4-repair-binding-test',
      split: 'held-out',
      codeRevision: 'h83-test',
      fixtureIds: [FIXTURE.id],
      execution: EXECUTION,
      call,
      now: () => 0,
    })

    expect(call).toHaveBeenCalledTimes(2)
    expect(checkpoint.status).toBe('completed')
    expect(checkpoint.completed[0].artifact.judgeRepair?.reason).toBe('json-contract')
    expect(JSON.stringify(checkpoint)).not.toContain(rawMarker)
    await expect(verifyH4LongConsistencyRunCheckpointV1(checkpoint)).resolves.toBe(true)

    const tampered = structuredClone(checkpoint)
    tampered.completed[0].artifact.judgeRepair = {
      protocolVersion: 'h4-long-consistency-repair-v1',
      reason: 'exact-schema',
    }
    const { artifactHash: _artifactHash, ...artifactBody } = tampered.completed[0].artifact
    tampered.completed[0].artifact.artifactHash = await hashCanonicalValue(artifactBody)
    await expect(verifyH4LongConsistencyRunCheckpointV1(await resignCheckpoint(tampered))).resolves.toBe(false)
  })
})
