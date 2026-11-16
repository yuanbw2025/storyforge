import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { runDurableMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import { beginMasterAgentCandidateAdoptionV1, commitMasterAgentCandidateAdoptionV1, recoverPendingMasterAgentAdoptionsV1 } from '../../src/lib/agent/run/master-adoption'
import { prepareOutlineCopilot } from '../../src/lib/agent/outline-copilot'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import type { WorkspaceScope } from '../../src/lib/types'
import { captureWorkspaceContentRevisionV1 } from '../../src/lib/authoring/content-revision'
import { adoptGeneratedOutlineItems } from '../../src/lib/outline/adopt-generation'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const DIRECT_WORKFLOW = {
  version: 1 as const,
  workflowId: 'single-domain-direct' as const,
  reasonCodes: ['single-explicit-domain' as const],
}

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
}> {
  const now = Date.now()
  const created = await seedCurrentWorkspace(label, { enableMultiWorld: true })
  const worldGroupId = await db.worldGroups.add(stampNewRecord(created.scope, 'worldGroups', {
    projectId: created.scope.projectId,
    name: '主世界',
    description: '',
    type: 'primary',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'world' })) as number
  return { scope: created.scope, worldGroupId }
}

async function outlinePending() {
    const fixture = await createWorkspace('大纲部分恢复')
    await db.projects.update(fixture.scope.projectId, { enableMultiWorld: true })
    const volumeId = await db.outlineNodes.add({
      projectId: fixture.scope.projectId,
      worldId: null,
      workId: fixture.scope.workId,
      worldGroupId: fixture.worldGroupId,
      parentId: null,
      type: 'volume',
      title: '第一卷',
      summary: '潮门即将关闭。',
      order: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any) as number
    await stampCurrentFixtureResourceUidsV1(fixture.scope.projectId)
    const prepared = await prepareOutlineCopilot({
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      authorRequest: '展开第一卷章节大纲',
    })
    const contentRevision = await captureWorkspaceContentRevisionV1({ scope: fixture.scope, worldGroupId: fixture.worldGroupId })
    const items = [
      { title: '潮门关闭', summary: '城门在潮汐前关闭，守灯人被迫留下。' },
      { title: '最后一班船', summary: '守灯人发现仍有一艘船没有返航。' },
    ]
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
      purpose: 'master-authoring',
    })
    const result = await runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id,
      plan: {
        summary: '生成第一卷章节大纲。',
        tasks: [{ id: 'outline-1', agentId: 'outline', skillId: 'outline.compose', instruction: '生成两个章节。', dependsOn: [] }],
        workflow: DIRECT_WORKFLOW,
      },
      budget: new AgentTeamBudgetTracker('balanced'),
    }, { execute: async (options: any) => {
      const task = options.plan.tasks[0]
      await options.executionTrace.taskStarted(task)
      const reservation = options.budget.reserveCall({
        label: task.id,
        messages: [{ role: 'user', content: task.instruction }],
        maxOutputTokens: 100,
      })
      const draft = JSON.stringify(items)
      options.budget.settleCall(reservation, draft)
      // Exercise the real outline preparation policy, not a test-only Gateway
      // rebuilt from task.skillId (which hid the compose/volumes mismatch).
      const renderedRequest = [{ role: 'user' as const, content: task.instruction }]
      const execution = prepared.contextGatewayExecution
      const assembled = prepared.input.assembled
      await options.executionTrace.contextGatewayPrepared(task, { execution, assembled, renderedRequest })
      const gateway = {
        contextSources: prepared.contextSources,
        contextEvidence: prepared.contextEvidence,
        contextGatewayRuntime: { execution, assembled, renderedRequest, rawResponse: draft },
      }
      await options.executionTrace.candidateReady(task, {
        payload: {
          version: 1,
          taskId: task.id,
          agentId: task.agentId,
          skillId: task.skillId,
          label: '章节大纲',
          contextSources: gateway.contextSources,
          contextEvidence: gateway.contextEvidence,
          baseSnapshot: prepared.snapshot,
          contentRevision,
          outlineMode: prepared.mode,
          outlineParentId: prepared.parentVolumeId,
          workspaceScope: options.scope,
          dependsOnTaskIds: [],
        },
        draft,
        runtimeNode: {} as any,
        runtimeOutput: draft,
        contextGatewayRuntime: gateway.contextGatewayRuntime,
      })
      return []
    }})
    const candidate = result.candidates[0]
    const ref = {
      scope: fixture.scope,
      runId: result.runId,
      candidateEventId: candidate.event.id!,
      worldGroupId: fixture.worldGroupId,
    }
    await beginMasterAgentCandidateAdoptionV1(ref)
    return { fixture, volumeId, prepared, items, ref, result }
}


describe('064 master outline recovery', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network') }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    db.close()
  })

  it('finishes confirmed intent when the required source is unchanged', async () => {
    const p = await outlinePending()
    const result = await recoverPendingMasterAgentAdoptionsV1(p.fixture.scope)
    expect(result.failed).toEqual([])
    expect(result.recoveredRunIds).toEqual([p.result.runId])
    const chapters = (await db.outlineNodes.toArray()).filter(row => row.type === 'chapter')
    expect(chapters.map(({ title, summary }) => ({ title, summary }))).toEqual(p.items)
  })

  it.each(['commit', 'recovery'] as const)('refuses changed required volume before any chapter write through %s', async mode => {
    const p = await outlinePending()
    expect(p.prepared.input.assembled.text).toContain('潮门即将关闭。')
    const summary = '作者新方向：潮门永远开放，去山中找药。'
    await db.outlineNodes.update(p.volumeId, { summary, updatedAt: Date.now() })
    if (mode === 'commit') {
      await expect(commitMasterAgentCandidateAdoptionV1(p.ref)).rejects.toThrow(/stale|发生变化|已变化|过期/i)
    } else {
      const result = await recoverPendingMasterAgentAdoptionsV1(p.fixture.scope)
      expect(result.failed).toEqual([{ runId: p.result.runId, reason: expect.stringMatching(/stale|发生变化|已变化|过期/i) }])
      expect(result.recoveredRunIds).toEqual([])
    }
    expect((await db.outlineNodes.toArray()).filter(row => row.type === 'chapter')).toEqual([])
    expect((await db.outlineNodes.get(p.volumeId))?.summary).toBe(summary)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['partial', 'receipt-only', 'title', 'summary', 'order'] as const)(
    'handles %s after the original outline write boundary', async mode => {
      const p = await outlinePending()
      const started = await readAgentRunV1(p.fixture.scope, p.result.runId)
      expect(started.events.some(event => event.type === 'adoption.started')).toBe(true)
      const first = await adoptGeneratedOutlineItems({
        projectId: p.fixture.scope.projectId, workspaceScope: p.fixture.scope,
        worldGroupId: p.fixture.worldGroupId, parentId: p.volumeId, type: 'chapter',
        startingOrder: p.prepared.snapshot.startingOrder,
        items: mode === 'receipt-only' ? p.items : p.items.slice(0, 1),
      })
      expect(first.writtenCount).toBe(mode === 'receipt-only' ? 2 : 1)
      if (mode === 'receipt-only') {
        await db.outlineNodes.update(p.volumeId, { summary: '已写后的作者新卷摘要。' })
      } else if (mode !== 'partial') {
        const changes = { title: { title: '作者重命名' }, summary: { summary: '作者新摘要' }, order: { order: 42 } }
        await db.outlineNodes.update(first.firstId!, changes[mode])
      }
      const before = await db.outlineNodes.toArray()
      const recovered = await recoverPendingMasterAgentAdoptionsV1(p.fixture.scope)
      const replay = await recoverPendingMasterAgentAdoptionsV1(p.fixture.scope)
      expect(replay).toEqual({ recoveredRunIds: [], failed: [] })
      const finished = await readAgentRunV1(p.fixture.scope, p.result.runId)
      if (mode === 'partial' || mode === 'receipt-only') {
        expect(recovered).toEqual({ recoveredRunIds: [p.result.runId], failed: [] })
        expect(finished.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
        const chapters = (await db.outlineNodes.toArray()).filter(row => row.type === 'chapter')
        expect(chapters.map(({ title, summary }) => ({ title, summary }))).toEqual(p.items)
        if (mode === 'receipt-only') expect(await db.outlineNodes.toArray()).toEqual(before)
      } else {
        expect(recovered.recoveredRunIds).toEqual([])
        expect(recovered.failed[0]?.reason).toMatch(/过期|已变化/)
        expect(finished.projection.steps['master:outline-1'].status).toBe('stale')
        expect(await db.outlineNodes.toArray()).toEqual(before)
      }
      expect(fetch).not.toHaveBeenCalled()
    },
  )


  it('rolls back new chapters if the final step receipt fails, then retries without a model', async () => {
    const p = await outlinePending()
    const { scope } = p.fixture
    const runId = p.result.runId
    const outlineBefore = await db.outlineNodes.toArray()
    const before = await readAgentRunV1(scope, runId)
    const originalRaw = before.events.find(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response')
    if (originalRaw?.type !== 'evidence.artifact.recorded') throw new Error('Missing original Gateway model response artifact')
    const readRaw = () => readAgentRunArtifactExactV1({
      projectId: scope.projectId, artifactKind: 'raw-response', contentHash: originalRaw.payload.contentHash,
    })
    const rawBefore = await readRaw()
    expect(rawBefore).toContain(p.items[0].title)
    let interrupted = 0
    const stopBeforeFinalReceipt = (_key: unknown, event: { type: string }) => {
      if (event.type !== 'step.succeeded') return
      interrupted++
      throw new Error('Synthetic final receipt write failed')
    }
    db.agentRunEvents.hook('creating', stopBeforeFinalReceipt)
    try {
      expect(await recoverPendingMasterAgentAdoptionsV1(scope)).toEqual({
        recoveredRunIds: [], failed: [{ runId, reason: 'Synthetic final receipt write failed' }],
      })
    } finally {
      db.agentRunEvents.hook('creating').unsubscribe(stopBeforeFinalReceipt)
    }
    expect(interrupted).toBe(1)
    db.close()
    await db.open()
    expect(await db.outlineNodes.toArray()).toEqual(outlineBefore)
    expect((await readAgentRunV1(scope, runId)).events).toEqual(before.events)
    expect(await readRaw()).toBe(rawBefore)
    expect(await recoverPendingMasterAgentAdoptionsV1(scope)).toEqual({ recoveredRunIds: [runId], failed: [] })
    const completed = await readAgentRunV1(scope, runId)
    expect(completed.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
    expect(completed.events.filter(event => event.type === 'step.succeeded')).toHaveLength(1)
    const chapters = (await db.outlineNodes.toArray()).filter(row => row.type === 'chapter')
    expect(chapters.map(({ title, summary }) => ({ title, summary }))).toEqual(p.items)
    expect(await readRaw()).toBe(rawBefore)
    expect(fetch).not.toHaveBeenCalled()
  })

})
