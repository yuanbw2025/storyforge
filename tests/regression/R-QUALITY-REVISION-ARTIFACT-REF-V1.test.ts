import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import {
  QUALITY_REVISION_ARTIFACT_REF_MIN_BYTES_V1,
  qualityRevisionCheckpointPayloadV1,
} from '../../src/lib/agent/run/quality-revision-durable'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { AGENT_RUN_MAXIMUM_RESUME_PAYLOAD_BYTES_V1, agentRunUtf8ByteLengthV1 } from '../../src/lib/agent/run/checkpoint-contract'
import { useAIConfigStore } from '../../src/stores/ai-config'

const old = useAIConfigStore.getState()

describe('B20d · 长篇范围修订草稿接入引用式 checkpoint', () => {
  beforeEach(async () => {
    const held = new Set<string>()
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: async (name: string, _options: unknown, fn: (lock: unknown) => Promise<unknown>) => {
        if (held.has(name)) return fn(null)
        held.add(name); try { return await fn({ name }) } finally { held.delete(name) }
      } },
    })
    await db.delete(); await db.open()
    useAIConfigStore.setState({ config: { ...old.config, provider: 'ollama', model: 'quality-scope', contextWindow: 128_000, maxTokens: 4_000 } })
  })
  afterEach(() => { vi.restoreAllMocks(); useAIConfigStore.setState(old, true); db.close() })

  it('路由规则：小草稿保持内联，大草稿改走工件引用（不截断、不封顶）', () => {
    const small = { version: 'quality-revision-draft-v1', note: '小' }
    expect(qualityRevisionCheckpointPayloadV1({ resumePayload: small }).resumePayloadArtifact).toBeUndefined()
    const large = { version: 'quality-revision-draft-v1', text: '字'.repeat(QUALITY_REVISION_ARTIFACT_REF_MIN_BYTES_V1) }
    expect(agentRunUtf8ByteLengthV1(canonicalStringify(large))).toBeGreaterThan(QUALITY_REVISION_ARTIFACT_REF_MIN_BYTES_V1)
    expect(qualityRevisionCheckpointPayloadV1({ resumePayload: large }).resumePayload).toBeUndefined()
    expect(qualityRevisionCheckpointPayloadV1({ resumePayload: large }).resumePayloadArtifact?.content).toBe(large)
  })

  it('路由后的大草稿经真实 checkpoint API 往返：小引用、全文 hash/尾部保留', async () => {
    const fixture = await seedCurrentWorkspace('大草稿引用往返', { genres: ['realism'] })
    const run = await createAgentRunV1({
      scope: fixture.scope, worldGroupId: null,
      contract: {
        version: 1, runtimeBindingHash: 'b'.repeat(64), objective: '范围修订草稿引用',
        workflowKind: 'long-running-resumable',
        scope: { projectId: fixture.scope.projectId, worldGroupId: null },
        permissions: { contextSourceKeys: ['ragSelection'], writeTargets: [] },
        budget: { maxModelCalls: 3, maxToolCalls: 0, maxInputTokens: 8_000, maxOutputTokens: 2_000, maxAttemptsPerStep: 1 },
        acceptance: [{ id: 'revision.output', kind: 'output-present', required: true }],
        verificationPlan: [{ id: 'revision.terminal', kind: 'terminal', verifier: 'terminal-v1', criterionIds: ['revision.output'] }],
        failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
      } as never,
    })
    // 整章 HTML 量级的草稿：真实长篇草稿远大于普通 JSON。
    const paragraph = '<p>陈禾在长章里反复核对余额与签字，直到最后一笔落下。</p>'
    const sourceHtml = `<h2>长章</h2>${paragraph.repeat(Math.ceil(34 * 1024 * 1024 / paragraph.length))}<p>陈禾签下名字，正文到此结束。</p>`
    const draft = {
      version: 'quality-revision-draft-v1', plan: { schema: 'quality-revision-plan-v1' },
      sourceHtml, contentHtml: sourceHtml, outputText: '陈禾签下名字，正文到此结束。',
      rawPatches: [{ spanId: 'p2.1', replacement: '陈禾签下名字。' }],
    }
    expect(agentRunUtf8ByteLengthV1(canonicalStringify(draft))).toBeGreaterThan(AGENT_RUN_MAXIMUM_RESUME_PAYLOAD_BYTES_V1)
    const routed = qualityRevisionCheckpointPayloadV1({ resumePayload: draft })
    expect(routed.resumePayload).toBeUndefined()
    await createAgentRunCheckpointV1({ scope: fixture.scope, runId: run.run.id, ...routed })
    const row = await db.agentRunCheckpoints.where('runId').equals(run.run.id).last()
    expect(agentRunUtf8ByteLengthV1(row?.resumePayloadJson ?? '')).toBeLessThan(4 * 1024)
    expect(JSON.parse(row?.resumePayloadJson ?? '{}')).toMatchObject({ kind: 'agent-run-checkpoint-artifact-v1' })
    const restored = await readLatestVerifiedAgentRunCheckpointV1(fixture.scope, run.run.id)
    expect(await hashCanonicalValue(restored?.resumePayload)).toBe(await hashCanonicalValue(draft))
    expect((restored?.resumePayload as { sourceHtml?: string }).sourceHtml?.endsWith('正文到此结束。</p>')).toBe(true)
  }, 20_000)
})
