import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import {
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import {
  beginMasterAgentCandidateAdoptionV1,
  commitMasterAgentCandidateAdoptionV1,
} from '../../src/lib/agent/run/master-adoption'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { verifyVerificationReceiptIntegrityV1 } from '../../src/lib/agent/run/verification-receipt'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import type { WorkspaceScope } from '../../src/lib/types'

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
}> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: label,
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 100_000,
    worldCode: `world-${label}`,
    worldVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: `world-${label}`,
    name: `${label}世界`,
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: label,
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
  })
  const worldGroupId = await db.worldGroups.add({
    projectId,
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  return { scope: { projectId, worldId, workId }, worldGroupId }
}

const contextEvidence = {
  profile: 'balanced' as const,
  included: ['worldview'],
  omitted: [],
  trimmed: [],
  estimatedInputTokens: 18,
  inputBudgetTokens: 14_000,
}

async function runWorldOrigin(label: string, includeContext = true) {
  const fixture = await createWorkspace(label)
  const conversation = await getOrCreateAgentConversation({
    projectId: fixture.scope.projectId,
    worldGroupId: fixture.worldGroupId,
    scope: fixture.scope,
  })
  const draft = `${label}的世界来源由潮汐与沉睡的海神共同维持。`
  const result = await runDurableMasterAgentPlanV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    conversationId: conversation.id,
    plan: {
      summary: '验证世界来源终态。',
      tasks: [{ id: 'world-1', agentId: 'world-origin', instruction: '建立世界来源。', dependsOn: [] }],
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
    options.budget.settleCall(reservation, draft)
    await options.executionTrace.candidateReady(task, {
      payload: {
        version: 1,
        taskId: task.id,
        agentId: task.agentId,
        label: '世界来源',
        contextSources: ['worldview'],
        ...(includeContext ? { contextEvidence } : {}),
        baseSnapshot: { id: null, updatedAt: null, worldOrigin: '' },
        workspaceScope: options.scope,
        dependsOnTaskIds: [],
      },
      draft,
      runtimeNode: {} as any,
      runtimeOutput: draft,
    })
  }})
  const candidate = result.candidates[0]
  const ref = {
    scope: fixture.scope,
    runId: result.runId,
    candidateEventId: candidate.event.id!,
    worldGroupId: fixture.worldGroupId,
  }
  await beginMasterAgentCandidateAdoptionV1(ref)
  await commitMasterAgentCandidateAdoptionV1(ref)
  return { fixture, result, ref }
}

describe.sequential('R-HARNESS2-master-terminal-verifier · 主 Agent 完成判定', { timeout: 15_000 }, () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('所有采纳、上下文证据和正式状态一致时写入完整 receipt 并进入 completed', async () => {
    const run = await runWorldOrigin('终态通过')
    const verified = await verifyMasterAgentRunV1({
      scope: run.fixture.scope,
      runId: run.result.runId,
      now: 1_786_200_000_000,
    })
    expect(verified.accepted).toBe(true)
    expect(verified.receipt).toBeDefined()
    expect(await verifyVerificationReceiptIntegrityV1(verified.receipt)).toBe(true)
    expect(verified.receipt?.candidateHashes).toHaveLength(1)
    expect(verified.receipt?.contextManifestHashes).toHaveLength(1)
    expect(verified.receipt?.adoptionEventIds).toHaveLength(1)
    expect(verified.snapshot.projection.state).toBe('completed')
    const completed = await readAgentRunV1(run.fixture.scope, run.result.runId)
    expect(completed.events.map(event => event.type).slice(-3))
      .toEqual(['verification.started', 'verification.accepted', 'memory.settlement.recorded'])
    expect(completed.projection.memorySettlement).toMatchObject({
      state: 'settled',
      terminalReceiptHash: verified.receipt?.receiptHash,
      workspaceDirty: true,
    })
  })

  it('缺少上下文装配证据或正式状态不匹配时拒绝伪完成', async () => {
    const missingContext = await runWorldOrigin('终态缺上下文', false)
    const rejected = await verifyMasterAgentRunV1({
      scope: missingContext.fixture.scope,
      runId: missingContext.result.runId,
    })
    expect(rejected.accepted).toBe(false)
    expect(rejected.codes).toContain('world-1:context-manifest-missing')
    expect(rejected.snapshot.projection.state).toBe('failed')

    const mismatched = await runWorldOrigin('终态状态冲突')
    const worldview = await db.worldviews.where('projectId').equals(mismatched.fixture.scope.projectId).first()
    if (!worldview?.id) throw new Error('测试世界来源未写入')
    await db.worldviews.update(worldview.id, { worldOrigin: '作者后来改写的来源' })
    const failed = await verifyMasterAgentRunV1({
      scope: mismatched.fixture.scope,
      runId: mismatched.result.runId,
    })
    expect(failed.accepted).toBe(false)
    expect(failed.codes).toContain('world-1:post-state-mismatch')
    expect(failed.snapshot.projection.state).toBe('failed')
  })
})
