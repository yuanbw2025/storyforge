import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { readLatestConsistencyAgentRun } from '../../src/lib/agent/consistency-agent'
import {
  refreshDurableConsistencyAuditFreshnessV1,
  runDurableConsistencyAuditV1,
  type ConsistencyAuditDurableBoundaryV1,
} from '../../src/lib/agent/run/consistency-audit-durable'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { buildMemoryArtifactIndexV1 } from '../../src/lib/memory/settlement'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import { resolveScopeLike } from '../../src/lib/world-engine/scope'
import type { Project } from '../../src/lib/types'

const now = 1_700_000_000_000
const targetText = '林舟再次获得潮汐钥匙。'
const targetHtml = `<p>${targetText}</p>`

async function seedConsistencyProject() {
  const project: Project = {
    id: 92_001,
    name: '记忆收口一致性审计',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    enableMultiWorld: false,
    workspaceUid: generateWorkspaceUid(),
    createdAt: now,
    updatedAt: now,
  }
  await db.projects.put(project)
  await db.creativeRules.add({
    projectId: project.id!,
    writingStyle: '',
    narrativePOV: 'third-limited',
    toneAndMood: '',
    prohibitions: '[]',
    consistencyRules: JSON.stringify(['潮汐钥匙只能获得一次']),
    specialRequirements: '',
    referenceWorks: '[]',
    citedReferenceIds: '[]',
    createdAt: now,
    updatedAt: now,
  })
  const volumeId = await db.outlineNodes.add({
    projectId: project.id!,
    parentId: null,
    type: 'volume',
    title: '第一卷',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  })
  const firstOutlineId = await db.outlineNodes.add({
    projectId: project.id!,
    parentId: volumeId,
    type: 'chapter',
    title: '第一章 得钥',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  })
  const targetOutlineId = await db.outlineNodes.add({
    projectId: project.id!,
    parentId: volumeId,
    type: 'chapter',
    title: '第二章 重逢',
    summary: '',
    order: 1,
    createdAt: now,
    updatedAt: now,
  })
  const firstChapterId = await db.chapters.add({
    projectId: project.id!,
    outlineNodeId: firstOutlineId,
    title: '第一章 得钥',
    content: '<p>林舟拾起潮汐钥匙。</p>',
    wordCount: 10,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  })
  const targetChapterId = await db.chapters.add({
    projectId: project.id!,
    outlineNodeId: targetOutlineId,
    title: '第二章 重逢',
    content: targetHtml,
    wordCount: targetText.length,
    status: 'draft',
    order: 1,
    notes: '',
    createdAt: now,
    updatedAt: now,
  })
  await db.itemLedger.add({
    projectId: project.id!,
    itemName: '潮汐钥匙',
    heldByName: '林舟',
    action: 'gain',
    quantity: 1,
    chapterId: firstChapterId,
    chapterTitle: '第一章 得钥',
    note: '',
    createdAt: now,
  })
  const scope = await resolveScopeLike(project.id!)
  return { project, scope, targetChapterId, targetOutlineId }
}

function runInput(
  fixture: Awaited<ReturnType<typeof seedConsistencyProject>>,
  call: () => Promise<string>,
  overrides: Partial<Parameters<typeof runDurableConsistencyAuditV1>[0]> = {},
) {
  return {
    scope: fixture.scope,
    chapterId: fixture.targetChapterId,
    chapterTitle: '第二章 重逢',
    worldGroupId: null,
    outlineNodeId: fixture.targetOutlineId,
    chapterContent: targetHtml,
    mode: 'deep' as const,
    provider: 'openai' as const,
    model: 'test-consistency-model',
    budget: new AgentTeamBudgetTracker('economy'),
    call,
    ...overrides,
  }
}

describe('MEMORY-CLOSE-1 · 显式一致性审计的 durable Harness 闭环', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('一次 Deep Audit 形成 ContextManifest、候选检查点、终态验收和原子记忆结算', async () => {
    const fixture = await seedConsistencyProject()
    let calls = 0
    const result = await runDurableConsistencyAuditV1(runInput(fixture, async () => {
      calls += 1
      return JSON.stringify({ findings: [] })
    }))

    expect(calls).toBe(1)
    expect(result.reusedCheckpoint).toBe(false)
    expect(result.snapshot.projection.state).toBe('completed')
    expect(result.snapshot.projection.memorySettlement).toMatchObject({
      state: 'settled',
      workspaceDirty: true,
    })
    expect(result.snapshot.events.map(event => event.type)).toEqual(expect.arrayContaining([
      'context.assembled',
      'model.requested',
      'model.responded',
      'checkpoint.created',
      'candidate.persisted',
      'step.succeeded',
      'verification.accepted',
      'memory.settlement.recorded',
    ]))
    expect(result.candidate.durable).toMatchObject({
      runId: result.snapshot.run.id,
      stepId: 'chapter:consistency-audit',
      attempt: 1,
    })
    expect(result.run.event.durableRunId).toBe(result.snapshot.run.id)
    const checkpoint = await db.agentRunCheckpoints.where('runId').equals(result.snapshot.run.id).last()
    expect(JSON.parse(checkpoint!.resumePayloadJson!)).toMatchObject({
      type: 'consistency-agent',
      durable: { runId: result.snapshot.run.id },
    })

    const index = await buildMemoryArtifactIndexV1(fixture.project.id!)
    expect(index.runs).toHaveLength(1)
    expect(index.runs[0]).toMatchObject({
      settlementSource: 'terminal-event',
      settlementReceiptHash: result.snapshot.projection.memorySettlement?.receiptHash,
    })
  })

  it('模型响应格式损坏时以 incomplete 终态结算，且不保存兼容报告', async () => {
    const fixture = await seedConsistencyProject()
    let calls = 0
    await expect(runDurableConsistencyAuditV1(runInput(fixture, async () => {
      calls += 1
      return '不是 JSON'
    }))).rejects.toThrow('JSON 无法解析')

    expect(calls).toBe(1)
    const row = await db.agentRuns.orderBy('id').last()
    const snapshot = await readAgentRunV1(fixture.scope, row!.id!)
    expect(snapshot.projection.state).toBe('failed')
    expect(snapshot.projection.memorySettlement).toMatchObject({ state: 'incomplete' })
    expect(await db.agentEvents.count()).toBe(0)
  })

  it('模型结果未知时不自动重试；只有作者再次触发才取消旧 Run 并创建一次新调用', async () => {
    const fixture = await seedConsistencyProject()
    let calls = 0
    await expect(runDurableConsistencyAuditV1(runInput(fixture, async () => {
      calls += 1
      throw new Error('network outcome unknown')
    }))).rejects.toThrow('network outcome unknown')

    const pausedRow = await db.agentRuns.orderBy('id').last()
    expect((await readAgentRunV1(fixture.scope, pausedRow!.id!)).projection.state).toBe('paused')
    expect(calls).toBe(1)

    const completed = await runDurableConsistencyAuditV1(runInput(fixture, async () => {
      calls += 1
      return JSON.stringify({ findings: [] })
    }))
    expect(calls).toBe(2)
    expect(completed.snapshot.projection.state).toBe('completed')
    const old = await readAgentRunV1(fixture.scope, pausedRow!.id!)
    expect(old.projection.state).toBe('cancelled')
    expect(old.projection.memorySettlement).toMatchObject({ state: 'incomplete' })
  })

  it('候选检查点后中断时，下一次显式触发直接恢复并且不再调用模型', async () => {
    const fixture = await seedConsistencyProject()
    let calls = 0
    await expect(runDurableConsistencyAuditV1(runInput(fixture, async () => {
      calls += 1
      return JSON.stringify({ findings: [] })
    }, {
      onDurableBoundary: (boundary: ConsistencyAuditDurableBoundaryV1) => {
        if (boundary === 'candidate.checkpoint') throw new Error('simulated process interruption')
      },
    }))).rejects.toThrow('simulated process interruption')
    expect(calls).toBe(1)

    const recovered = await runDurableConsistencyAuditV1(runInput(fixture, async () => {
      calls += 1
      return JSON.stringify({ findings: [] })
    }))
    expect(calls).toBe(1)
    expect(recovered.reusedCheckpoint).toBe(true)
    expect(recovered.snapshot.projection.state).toBe('completed')
  })

  it('编辑器正文未保存时在创建 Run 和产生 token 前停止', async () => {
    const fixture = await seedConsistencyProject()
    let calls = 0
    await expect(runDurableConsistencyAuditV1(runInput(fixture, async () => {
      calls += 1
      return JSON.stringify({ findings: [] })
    }, { chapterContent: '<p>尚未保存的新正文</p>' }))).rejects.toThrow('尚未稳定保存')
    expect(calls).toBe(0)
    expect(await db.agentRuns.count()).toBe(0)
  })

  it('同章同模式同正文并发点击共享一个 single-flight Run 与一次模型调用', async () => {
    const fixture = await seedConsistencyProject()
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const first = runDurableConsistencyAuditV1(runInput(fixture, async () => {
      calls += 1
      await gate
      return JSON.stringify({ findings: [] })
    }))
    const second = runDurableConsistencyAuditV1(runInput(fixture, async () => {
      calls += 1
      return JSON.stringify({ findings: [] })
    }))
    await viWaitUntil(() => calls === 1)
    release()
    const [left, right] = await Promise.all([first, second])
    expect(calls).toBe(1)
    expect(left.snapshot.run.id).toBe(right.snapshot.run.id)
    expect(await db.agentRuns.count()).toBe(1)
  })

  it('正文变化会使 durable 审计的终态凭据过期并清除原记忆结算', async () => {
    const fixture = await seedConsistencyProject()
    const completed = await runDurableConsistencyAuditV1(runInput(fixture, async () => (
      JSON.stringify({ findings: [] })
    )))
    await db.chapters.update(fixture.targetChapterId, {
      content: '<p>林舟把潮汐钥匙交给守门人。</p>',
      updatedAt: now + 1,
    })

    const freshness = await refreshDurableConsistencyAuditFreshnessV1({
      scope: fixture.scope,
      candidate: completed.candidate,
    })
    expect(freshness.current).toBe(false)
    expect(freshness.snapshot?.events.at(-1)?.type).toBe('verification.staled')
    expect(freshness.snapshot?.projection.terminalReceiptHash).toBeUndefined()
    expect(freshness.snapshot?.projection.memorySettlement).toBeUndefined()
  })

  it('页面恢复拒绝只有兼容缓存、没有 durable Run 权威账本的幽灵报告', async () => {
    const fixture = await seedConsistencyProject()
    const completed = await runDurableConsistencyAuditV1(runInput(fixture, async () => (
      JSON.stringify({ findings: [] })
    )))
    expect(await readLatestConsistencyAgentRun({
      projectId: fixture.project.id!,
      chapterId: fixture.targetChapterId,
    })).not.toBeNull()

    await db.agentRuns.delete(completed.snapshot.run.id)
    expect(await db.agentEvents.count()).toBe(1)
    expect(await readLatestConsistencyAgentRun({
      projectId: fixture.project.id!,
      chapterId: fixture.targetChapterId,
    })).toBeNull()
  })
})

async function viWaitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('等待 single-flight 调用超时')
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}
