import { Blob as StreamableBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import {
  createAgentRunCheckpointV1,
  readLatestVerifiedAgentRunCheckpointV1,
  verifyAgentRunCheckpointV1,
} from '../../src/lib/agent/run/checkpoint'
import { AGENT_RUN_MAXIMUM_RESUME_PAYLOAD_BYTES_V1 } from '../../src/lib/agent/run/checkpoint-contract'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import type { WorkspaceScope } from '../../src/lib/types'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { createProjectJSONBlob, readProjectJSONFile } from '../../src/lib/export/json-file'

async function createWorkspace(label: string): Promise<{ scope: WorkspaceScope; worldGroupId: number; outlineNodeId: number }> {
  const now = Date.now()
  const created = await seedCurrentWorkspace(label)
  const { projectId, worldId, workId } = created.scope
  const worldGroupId = await db.worldGroups.add(stampNewRecord(created.scope, 'worldGroups', {
    projectId, worldId, name: '主世界', order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as never) as number
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
    projectId, workId, worldGroupId, parentId: null, type: 'volume', title: '第一卷',
    summary: '', order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  await stampCurrentFixtureResourceUidsV1(projectId)
  return { scope: { projectId, worldId, workId }, worldGroupId, outlineNodeId }
}

function contract(input: { projectId: number; worldGroupId: number; outlineNodeId: number }) {
  return {
    version: 1,
    runtimeBindingHash: 'a'.repeat(64),
    objective: '大载荷引用检查点验证',
    workflowKind: 'long-running-resumable',
    scope: { projectId: input.projectId, worldGroupId: input.worldGroupId, outlineNodeIds: [input.outlineNodeId] },
    permissions: {
      contextSourceKeys: ['worldview'],
      writeTargets: [{ table: 'outlineNodes', fields: ['summary'], mode: 'candidate-only' as const }],
    },
    budget: { maxModelCalls: 3, maxToolCalls: 4, maxInputTokens: 8_000, maxOutputTokens: 2_000, maxAttemptsPerStep: 2 },
    acceptance: [{ id: 'outline.output', kind: 'output-present' as const, required: true }],
    verificationPlan: [{ id: 'outline.terminal', kind: 'terminal' as const, verifier: 'terminal-v1', criterionIds: ['outline.output'] }],
    failurePolicy: { onProtocolError: 'fail' as const, onVerificationFailure: 'fail' as const, onStaleInput: 'pause-for-author' as const },
  }
}

describe('B20d · 引用式 checkpoint（F35：超旧门全文 hash/尾部与恢复）', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.unstubAllGlobals(); db.close() })

  it('超过 32MiB 的载荷只存工件引用，读取仍还原全文 hash 与尾部', async () => {
    const fixture = await createWorkspace('大载荷引用')
    const run = await createAgentRunV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      contract: contract({ projectId: fixture.scope.projectId, worldGroupId: fixture.worldGroupId, outlineNodeId: fixture.outlineNodeId }) as never,
    })
    // 33 MiB UTF-8：首尾标记必须逐字保留。
    const resumePayload = {
      version: 1,
      head: '【完整首部】',
      material: '界'.repeat(Math.floor((AGENT_RUN_MAXIMUM_RESUME_PAYLOAD_BYTES_V1 + 1024 * 1024) / 3)),
      tail: '【完整尾部：禁止遗漏】',
    }
    const expectedJson = JSON.stringify(resumePayload)
    expect(new TextEncoder().encode(expectedJson).byteLength).toBeGreaterThan(AGENT_RUN_MAXIMUM_RESUME_PAYLOAD_BYTES_V1)

    const saved = await createAgentRunCheckpointV1({
      scope: fixture.scope, runId: run.run.id, resumePayloadArtifact: { content: resumePayload },
    })
    // 检查点记录只保存小引用，不再内联 33 MiB 正文。
    const storedJson = saved.checkpoint.resumePayloadJson ?? ''
    expect(new TextEncoder().encode(storedJson).byteLength).toBeLessThan(4 * 1024)
    expect(JSON.parse(storedJson)).toMatchObject({ kind: 'agent-run-checkpoint-artifact-v1' })

    const local = await readLatestVerifiedAgentRunCheckpointV1(fixture.scope, run.run.id)
    expect(await hashCanonicalValue(local?.resumePayload)).toBe(await hashCanonicalValue(resumePayload))
    expect((local?.resumePayload as { tail?: string }).tail).toBe('【完整尾部：禁止遗漏】')
    expect(await verifyAgentRunCheckpointV1(fixture.scope, saved.checkpoint.id)).toBe(true)
    expect(local?.snapshot.events.some(event => event.type === 'evidence.artifact.recorded')).toBe(true)
  })

  it('旧内联 Run 与显式诊断预算行为不变；引用载荷也受显式上限约束', async () => {
    const fixture = await createWorkspace('旧内联')
    const run = await createAgentRunV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      contract: contract({ projectId: fixture.scope.projectId, worldGroupId: fixture.worldGroupId, outlineNodeId: fixture.outlineNodeId }) as never,
    })
    const inline = { version: 1, kind: 'legacy-inline', note: '原样内联' }
    await createAgentRunCheckpointV1({ scope: fixture.scope, runId: run.run.id, resumePayload: inline })
    const local = await readLatestVerifiedAgentRunCheckpointV1(fixture.scope, run.run.id)
    expect(await hashCanonicalValue(local?.resumePayload)).toBe(await hashCanonicalValue(inline))
    await expect(readLatestVerifiedAgentRunCheckpointV1(fixture.scope, run.run.id, {
      maximumResumePayloadBytes: 8,
    })).rejects.toMatchObject({ code: 'checkpoint_resume_budget' })

    const refRun = await createAgentRunV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      contract: contract({ projectId: fixture.scope.projectId, worldGroupId: fixture.worldGroupId, outlineNodeId: fixture.outlineNodeId }) as never,
    })
    await createAgentRunCheckpointV1({
      scope: fixture.scope, runId: refRun.run.id,
      resumePayloadArtifact: { content: { version: 1, material: 'x'.repeat(4096) } },
    })
    await expect(readLatestVerifiedAgentRunCheckpointV1(fixture.scope, refRun.run.id, {
      maximumResumePayloadBytes: 1024,
    })).rejects.toMatchObject({ code: 'checkpoint_resume_budget' })
  })

  it('导出/导入后引用仍可解引用：全文 hash、尾部与恢复一致', async () => {
    const fixture = await createWorkspace('引用往返')
    const run = await createAgentRunV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      contract: contract({ projectId: fixture.scope.projectId, worldGroupId: fixture.worldGroupId, outlineNodeId: fixture.outlineNodeId }) as never,
    })
    const resumePayload = {
      version: 1,
      head: '【导出首部】',
      material: '潮'.repeat(Math.floor((AGENT_RUN_MAXIMUM_RESUME_PAYLOAD_BYTES_V1 + 1024 * 1024) / 3)),
      tail: '【导出尾部：禁止遗漏】',
    }
    await createAgentRunCheckpointV1({ scope: fixture.scope, runId: run.run.id, resumePayloadArtifact: { content: resumePayload } })
    const backup = await exportProjectJSON(fixture.scope.projectId)
    const file = createProjectJSONBlob(backup)
    const readable = new StreamableBlob([await file.arrayBuffer()])
    const parsed = await readProjectJSONFile(readable as unknown as Blob)
    const importedId = await importProjectJSON(parsed)
    const project = await db.projects.get(importedId)
    const importedRun = await db.agentRuns.where('projectId').equals(importedId).first()
    if (!project?.activeWorldId || !project.activeWorkId || !importedRun?.id) throw new Error('导入后缺少运行 owner')
    const importedScope = { projectId: importedId, worldId: project.activeWorldId, workId: project.activeWorkId }
    const restored = await readLatestVerifiedAgentRunCheckpointV1(importedScope, importedRun.id)
    expect(await hashCanonicalValue(restored?.resumePayload)).toBe(await hashCanonicalValue(resumePayload))
    expect((restored?.resumePayload as { tail?: string }).tail).toBe('【导出尾部：禁止遗漏】')
  })

  it('工件被裁剪或正文被替换时明确失败，不返回截断/部分状态', async () => {
    const fixture = await createWorkspace('引用反例')
    const run = await createAgentRunV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      contract: contract({ projectId: fixture.scope.projectId, worldGroupId: fixture.worldGroupId, outlineNodeId: fixture.outlineNodeId }) as never,
    })
    const resumePayload = { version: 1, material: '内容', tail: '尾部' }
    const saved = await createAgentRunCheckpointV1({ scope: fixture.scope, runId: run.run.id, resumePayloadArtifact: { content: resumePayload } })
    const ref = JSON.parse(saved.checkpoint.resumePayloadJson!) as { contentHash: string }
    const row = await db.agentRunArtifacts
      .where('[projectId+artifactKind+contentHash]')
      .equals([fixture.scope.projectId, 'tool-result', ref.contentHash])
      .first()
    if (!row?.id) throw new Error('工件缺失')
    // 模拟已裁剪：正文清空 + tombstone。
    await db.agentRunArtifacts.update(row.id, { content: null, retentionState: 'evidence-pruned' })
    await expect(readLatestVerifiedAgentRunCheckpointV1(fixture.scope, run.run.id))
      .rejects.toMatchObject({ code: 'checkpoint_artifact_missing' })
    // 正文被替换但引用 hash 未变：hash/length 校验失败，绝不回退成部分状态。
    await db.agentRunArtifacts.update(row.id, { content: '{"version":1,"material":"被篡改"}', retentionState: 'available' })
    await expect(readLatestVerifiedAgentRunCheckpointV1(fixture.scope, run.run.id))
      .rejects.toMatchObject({ code: 'checkpoint_artifact_hash' })
  })
})
