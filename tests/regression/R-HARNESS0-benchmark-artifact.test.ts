import { describe, expect, it } from 'vitest'
import {
  createAgentHarnessBenchmarkArtifactV1,
  parseAgentHarnessBenchmarkArtifactV1,
  verifyAgentHarnessBenchmarkArtifactV1,
} from '../../src/lib/agent/run/benchmark-artifact'

function artifactBody() {
  return {
    version: 1 as const,
    createdAt: 1_786_111_000_000,
    codeRevision: 'f623c59',
    schemaVersions: { contract: 1 as const, event: 1 as const, manifest: 1 as const, receipt: 1 as const },
    execution: {
      provider: 'fixture-provider',
      model: 'fixture-model',
      promptVersion: 'outline-volume-v1',
      toolSchemaVersion: 'agent-tools-v1',
    },
    fixture: {
      id: 'outline-basic-001',
      split: 'development' as const,
      contentHash: 'a'.repeat(64),
    },
    metrics: {
      runs: 1,
      successfulSteps: 1,
      failedSteps: 0,
      modelCalls: 1,
      toolCalls: 0,
      inputTokens: 1200,
      outputTokens: 600,
      latencyMs: 1834.5,
      costUsd: 0.0123,
    },
    traceHashes: ['b'.repeat(64)],
  }
}

describe('R-HARNESS0-benchmark-artifact · 可重复基线证据', () => {
  it('只保存版本、哈希和聚合指标，并可验证完整性', async () => {
    const artifact = await createAgentHarnessBenchmarkArtifactV1(artifactBody())

    expect(artifact.artifactHash).toMatch(/^[0-9a-f]{64}$/)
    expect(await verifyAgentHarnessBenchmarkArtifactV1(artifact)).toBe(true)
    expect(Object.keys(artifact)).not.toContain('apiKey')
    expect(Object.keys(artifact.fixture)).not.toContain('content')
    expect(Object.keys(artifact.fixture)).not.toContain('hiddenLabel')
  })

  it('拒绝密钥、完整 fixture 和隐藏标签等额外字段', async () => {
    const artifact = await createAgentHarnessBenchmarkArtifactV1(artifactBody())

    expect(() => parseAgentHarnessBenchmarkArtifactV1({ ...artifact, apiKey: 'secret' }))
      .toThrow('artifact.apiKey: 未知字段')
    expect(() => parseAgentHarnessBenchmarkArtifactV1({
      ...artifact,
      fixture: { ...artifact.fixture, content: '完整手稿' },
    })).toThrow('artifact.fixture.content: 未知字段')
    expect(() => parseAgentHarnessBenchmarkArtifactV1({
      ...artifact,
      fixture: { ...artifact.fixture, hiddenLabel: '预埋答案' },
    })).toThrow('artifact.fixture.hiddenLabel: 未知字段')
  })

  it('指标或 trace 变化会使旧 artifact hash 失效', async () => {
    const artifact = await createAgentHarnessBenchmarkArtifactV1(artifactBody())

    expect(await verifyAgentHarnessBenchmarkArtifactV1({
      ...artifact,
      metrics: { ...artifact.metrics, modelCalls: 2 },
    })).toBe(false)
  })
})
