import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { getOrCreateAgentConversation, updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import type { MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import {
  replanDurableMasterAgentRunV1,
  restoreMasterAgentCandidatesV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import {
  beginMasterAgentCandidateAdoptionV1,
  commitMasterAgentCandidateAdoptionV1,
} from '../../src/lib/agent/run/master-adoption'
import {
  appendAgentRunEventV1,
  deleteAgentRunV1,
  readAgentRunV1,
} from '../../src/lib/agent/run/event-store'
import { verifyAgentRunStepVerificationReceiptIntegrityV1 } from '../../src/lib/agent/run/verification-receipt'
import {
  createMasterCandidateStepReceiptV1,
  readFreshMasterCandidateStepReceiptV1,
} from '../../src/lib/agent/run/master-step-verification'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import type { WorkspaceScope } from '../../src/lib/types'
import { backfillResourceUidsV1 } from '../../src/lib/context-gateway/resource-identity'
import { generateWorkCode, generateWorkspaceUid } from '../../src/lib/memory/identity'
import { prepareRequiredMasterGatewayFixtureV1 } from '../helpers/master-agent-gateway'

async function createWorkspace(label: string): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
}> {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(),
    name: label,
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 100_000,


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
    code: generateWorkCode(),
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
    worldId,
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  await backfillResourceUidsV1(projectId)
  return { scope: { projectId, worldId, workId }, worldGroupId }
}

function fanOutPlan(): MasterAgentPlan {
  return {
    summary: '分别建立潮汐世界和记忆灵感，再汇合生成守灯人。',
    tasks: [
      {
        id: 'world-1',
        agentId: 'world-origin',
        skillId: 'world-origin.complete',
        instruction: '建立潮汐世界。',
        dependsOn: [],
      },
      {
        id: 'inspiration-1',
        agentId: 'inspiration',
        skillId: 'inspiration.reverse',
        instruction: '反推记忆灵感。',
        dependsOn: [],
      },
      {
        id: 'character-1',
        agentId: 'character',
        skillId: 'character.create',
        instruction: '汇合两个上游候选生成守灯人。',
        dependsOn: ['world-1', 'inspiration-1'],
      },
    ],
    workflow: {
      version: 1,
      workflowId: 'multi-domain-fan-out',
      reasonCodes: ['explicit-independent-fan-out', 'multiple-explicit-domains'],
    },
  }
}

const inspirationDraft = JSON.stringify({
  worldview: {
    worldOrigin: '旧城由潮汐遗忘诞生',
    powerHierarchy: '',
    continentLayout: '',
    climateByRegion: '',
    races: '',
    factionLayout: '',
  },
  history: { overview: '' },
  storyCore: {
    logline: '守灯人追查被雨抹去的名字',
    theme: '记忆',
    centralConflict: '保存与遗忘',
    plotPattern: '探索',
    mainPlot: '寻找旧城失忆的源头',
  },
  characters: [],
})

function outputFor(taskId: string): string {
  if (taskId === 'world-1') return '潮汐由沉睡海神维持，盐城在退潮时苏醒。'
  if (taskId === 'inspiration-1') return inspirationDraft
  return JSON.stringify({
    name: '守灯人',
    roleWeight: 'main',
    moralAxis: 'good',
    orderAxis: 'lawful',
    relationships: '守护盐城记忆',
    shortDescription: '记录被潮汐抹去姓名的人。',
  })
}

function sourcesFor(taskId: string): string[] {
  return taskId === 'inspiration-1' ? [] : ['worldview']
}

async function executeFixture(
  options: any,
  outputOverrides: Readonly<Record<string, string>> = {},
): Promise<void> {
  for (const task of options.plan.tasks) {
    if (options.completedTaskOutputs?.[task.id]) continue
    await options.executionTrace.taskStarted(task)
    const output = outputOverrides[task.id] ?? outputFor(task.id)
    const reservation = options.budget.reserveCall({
      label: task.id,
      messages: [{ role: 'user', content: task.instruction }],
      maxOutputTokens: 300,
    })
    options.budget.settleCall(reservation, output)
    const sources = sourcesFor(task.id)
    const gateway = task.id === 'character-1'
      ? await prepareRequiredMasterGatewayFixtureV1({
          scope: options.scope,
          worldGroupId: options.worldGroupId,
          executionTrace: options.executionTrace,
        }, task, output)
      : undefined
    await options.executionTrace.candidateReady(task, {
      payload: {
        version: 1,
        taskId: task.id,
        agentId: task.agentId,
        skillId: task.skillId,
        label: task.id,
        contextSources: gateway?.contextSources ?? sources,
        contextEvidence: gateway?.contextEvidence ?? {
          profile: 'balanced',
          included: sources,
          omitted: [],
          trimmed: [],
          estimatedInputTokens: 20,
          inputBudgetTokens: 14_000,
        },
        baseSnapshot: task.id === 'world-1'
          ? { id: null, updatedAt: null, worldOrigin: '' }
          : task.id === 'character-1'
            ? { serialized: '[]', visibleNames: [] }
            : {},
        ...(task.id === 'inspiration-1' ? { mode: 'single', selectedFragmentIds: ['memory'] } : {}),
        workspaceScope: options.scope,
        dependsOnTaskIds: task.dependsOn,
      },
      draft: output,
      runtimeNode: {},
      runtimeOutput: output,
      ...(gateway ? { contextGatewayRuntime: gateway.contextGatewayRuntime } : {}),
    })
  }
}

async function createRun(label: string) {
  const fixture = await createWorkspace(label)
  const conversation = await getOrCreateAgentConversation({
    projectId: fixture.scope.projectId,
    worldGroupId: fixture.worldGroupId,
    scope: fixture.scope,
  })
  const result = await runDurableMasterAgentPlanV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    conversationId: conversation.id,
    plan: fanOutPlan(),
    budget: new AgentTeamBudgetTracker('balanced'),
  }, { execute: executeFixture as any })
  return { fixture, result }
}

describe.sequential('R-HARNESS25 · fan-out 步骤回执与 fresh join', { timeout: 20_000 }, () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('每个候选都有独立完整性回执，汇合模型请求发生在两个上游 fresh 回执之后', async () => {
    const { fixture, result } = await createRun('步骤回执')
    const snapshot = await readAgentRunV1(fixture.scope, result.runId)
    expect(snapshot.contract.dependencyReceiptPolicy).toEqual({
      requiredForJoin: true,
      verifierSetVersion: 'master-candidate-step-v1',
    })
    const receipts = snapshot.events.filter(event => event.type === 'step.verification.accepted')
    expect(receipts).toHaveLength(3)
    for (const event of receipts) {
      if (event.type !== 'step.verification.accepted') continue
      expect(await verifyAgentRunStepVerificationReceiptIntegrityV1(event.payload.receipt)).toBe(true)
    }
    const character = result.candidates.find(candidate => candidate.payload.taskId === 'character-1')!
    const upstreamReceiptHashes = receipts
      .filter(event => event.type === 'step.verification.accepted'
        && ['master:world-1', 'master:inspiration-1'].includes(event.payload.receipt.stepId))
      .map(event => event.type === 'step.verification.accepted' ? event.payload.receipt.receiptHash : '')
    expect(character.payload.dependencyBindings?.map(binding => binding.verificationReceiptHash))
      .toEqual(upstreamReceiptHashes)
    const characterRequest = snapshot.events.find(event => (
      event.type === 'model.requested' && event.payload.stepId === 'master:character-1'
    ))!
    expect(upstreamReceiptHashes.every(hash => snapshot.events.some(event => (
      event.type === 'step.verification.accepted'
      && event.payload.receipt.receiptHash === hash
      && event.sequence < characterRequest.sequence
    )))).toBe(true)
  })

  it('作者修改上游时旧回执先失效、合法新稿重签，旧汇合候选仍按冻结版本阻断', async () => {
    const { fixture, result } = await createRun('作者改稿')
    const world = result.candidates.find(candidate => candidate.payload.taskId === 'world-1')!
    const oldReceiptHash = result.projection.steps['master:world-1'].verificationReceiptHash!
    await updateAgentEventCandidate(
      world.event.id!,
      fixture.scope.projectId,
      '潮汐改由月轮和海底钟阵共同维持。',
      fixture.scope,
    )
    const restored = await restoreMasterAgentCandidatesV1({ scope: fixture.scope, runId: result.runId })
    const newWorld = restored.candidates.find(candidate => candidate.payload.taskId === 'world-1')!
    const newReceiptHash = restored.snapshot.projection.steps['master:world-1'].verificationReceiptHash!
    expect(newReceiptHash).not.toBe(oldReceiptHash)
    expect(restored.snapshot.events.slice(-3).map(event => event.type)).toEqual([
      'step.verification.staled',
      'candidate.revised',
      'step.verification.accepted',
    ])
    await commitMasterAgentCandidateAdoptionV1({
      scope: fixture.scope,
      runId: result.runId,
      candidateEventId: newWorld.event.id!,
    })
    const character = restored.candidates.find(candidate => candidate.payload.taskId === 'character-1')!
    await expect(beginMasterAgentCandidateAdoptionV1({
      scope: fixture.scope,
      runId: result.runId,
      candidateEventId: character.event.id!,
    })).rejects.toThrow('冻结候选版本已经变化')
    expect(await db.characters.count()).toBe(0)
  })

  it('步骤回执正文被篡改后恢复 fail-closed，不把结构正确的旧 hash 当作有效证据', async () => {
    const { fixture, result } = await createRun('回执篡改')
    const row = (await db.agentRunEvents.where('runId').equals(result.runId).sortBy('sequence'))
      .find(event => event.type === 'step.verification.accepted')!
    const payload = JSON.parse(row.payloadJson)
    payload.receipt.outputHash = 'f'.repeat(64)
    await db.agentRunEvents.update(row.id!, { payloadJson: JSON.stringify(payload) })

    await expect(restoreMasterAgentCandidatesV1({
      scope: fixture.scope,
      runId: result.runId,
    })).rejects.toThrow('步骤回执无效')
    expect(await db.characters.count()).toBe(0)
  })

  it('回执自身哈希合法但引用不存在的 Context Manifest 时仍拒绝作为 fresh 证据', async () => {
    const { fixture, result } = await createRun('Manifest 引用')
    const snapshot = await readAgentRunV1(fixture.scope, result.runId)
    const world = result.candidates.find(candidate => candidate.payload.taskId === 'world-1')!
    const stepId = 'master:world-1'
    const acceptedIndex = snapshot.events.findIndex(event => (
      event.type === 'step.verification.accepted'
      && event.payload.receipt.stepId === stepId
    ))
    const forged = await createMasterCandidateStepReceiptV1({
      payload: world.payload,
      draft: world.draft,
      attempt: snapshot.projection.steps[stepId].attempt,
      contextManifestHash: 'e'.repeat(64),
      acceptedAt: Date.now(),
    })
    const forgedSnapshot = structuredClone(snapshot)
    const accepted = forgedSnapshot.events[acceptedIndex]
    if (accepted.type !== 'step.verification.accepted') throw new Error('缺少步骤回执')
    accepted.payload.receipt = forged
    forgedSnapshot.projection.steps[stepId].verificationReceiptHash = forged.receiptHash

    await expect(readFreshMasterCandidateStepReceiptV1({
      snapshot: forgedSnapshot,
      stepId,
      candidateHash: world.payload.candidateHash!,
    })).resolves.toBeNull()
  })

  it('结构化叶子未通过确定性验证时不持久化候选，也不会启动下游汇合模型', async () => {
    const fixture = await createWorkspace('叶子硬门')
    const conversation = await getOrCreateAgentConversation({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      scope: fixture.scope,
    })
    let runId = 0
    await expect(runDurableMasterAgentPlanV1({
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      conversationId: conversation.id,
      plan: fanOutPlan(),
      budget: new AgentTeamBudgetTracker('balanced'),
      onDurableBoundary: boundary => { runId = boundary.runId },
    }, {
      execute: ((options: any) => executeFixture(options, { 'inspiration-1': '{}' })) as any,
      disableAutomaticReplanForTest: true,
    })).rejects.toThrow('缺少字段 worldview')

    const snapshot = await readAgentRunV1(fixture.scope, runId)
    expect(snapshot.projection.state).toBe('paused')
    expect(snapshot.projection.steps['master:inspiration-1']).toMatchObject({
      status: 'failed',
      failureCode: 'structured_output_blocked',
    })
    expect((await db.agentEvents.toArray()).filter(event => event.kind === 'candidate'))
      .toHaveLength(1)
    expect(snapshot.events.filter(event => event.type === 'step.verification.accepted'))
      .toHaveLength(1)
    expect(snapshot.events.some(event => (
      event.type === 'model.requested' && event.payload.stepId === 'master:character-1'
    ))).toBe(false)
  })

  it('有限重规划为跨代保留叶重新签发当前契约回执，不沿用旧代 receipt hash', async () => {
    const { fixture, result } = await createRun('跨代回执')
    const oldHashes = ['master:world-1', 'master:inspiration-1']
      .map(stepId => result.projection.steps[stepId].verificationReceiptHash)
    const snapshot = await readAgentRunV1(fixture.scope, result.runId)
    const paused = await appendAgentRunEventV1({
      scope: fixture.scope,
      runId: result.runId,
      type: 'run.paused',
      payload: { reason: 'test_replan', recoverable: true },
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    const nextPlan = fanOutPlan()
    nextPlan.tasks = nextPlan.tasks.map(task => task.id === 'character-1'
      ? { ...task, instruction: '改用欲望、阻力和代价汇合生成守灯人。' }
      : task)
    const replanned = await replanDurableMasterAgentRunV1({
      scope: fixture.scope,
      runId: result.runId,
      nextPlan,
      rootTaskIds: ['character-1'],
      failures: [{
        taskId: 'character-1',
        code: 'test_replan',
        category: 'deterministic',
        fingerprint: 'a'.repeat(64),
      }],
      budgetEvidence: result.budgetEvidence,
      reasonCode: 'test_replan',
    })
    expect(paused.projection.state).toBe('paused')
    expect(replanned.projection.generation).toBe(2)
    const newHashes = ['master:world-1', 'master:inspiration-1']
      .map(stepId => replanned.projection.steps[stepId].verificationReceiptHash)
    expect(newHashes.every(Boolean)).toBe(true)
    expect(newHashes).not.toEqual(oldHashes)
    const generationTwoReceipts = replanned.events.filter(event => (
      event.generation === 2 && event.type === 'step.verification.accepted'
    ))
    expect(generationTwoReceipts).toHaveLength(2)
    expect(generationTwoReceipts.every(event => (
      event.type === 'step.verification.accepted'
      && event.contractHash === replanned.projection.contractHash
    ))).toBe(true)
    const restored = await restoreMasterAgentCandidatesV1({
      scope: fixture.scope,
      runId: result.runId,
    })
    expect(restored.candidates.map(candidate => candidate.payload.taskId).sort())
      .toEqual(['inspiration-1', 'world-1'])
  })

  it('未确认 fan-out Run 经 PROJECT_TABLES 往返后仍可重放步骤回执并恢复候选', async () => {
    const { fixture, result } = await createRun('回执往返')
    const importedProjectId = await importProjectJSON(await exportProjectJSON(fixture.scope.projectId))
    const project = await db.projects.get(importedProjectId)
    if (!project?.activeWorldId || !project.activeWorkId) throw new Error('导入项目缺少活动 World/Work')
    const importedScope: WorkspaceScope = {
      projectId: importedProjectId,
      worldId: project.activeWorldId,
      workId: project.activeWorkId,
    }
    const importedRun = await db.agentRuns.where('projectId').equals(importedProjectId).first()
    if (!importedRun?.id) throw new Error('导入项目缺少 Agent Run')
    const restored = await restoreMasterAgentCandidatesV1({
      scope: importedScope,
      runId: importedRun.id,
    })
    expect(restored.candidates).toHaveLength(result.candidates.length)
    expect(restored.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(Object.values(restored.snapshot.projection.steps)
      .every(step => Boolean(step.verificationReceiptHash))).toBe(true)
  })

  it('删除 Run 按 PROJECT_TABLES 引用把对话候选归属置空，不遗留可恢复外键', async () => {
    const { fixture, result } = await createRun('回执删除')
    expect((await db.agentEvents.toArray()).filter(event => event.kind === 'candidate')
      .every(event => event.durableRunId === result.runId)).toBe(true)
    expect(await deleteAgentRunV1(fixture.scope, result.runId)).toBe(true)
    const candidates = (await db.agentEvents.toArray()).filter(event => event.kind === 'candidate')
    expect(candidates).toHaveLength(3)
    expect(candidates.every(event => event.durableRunId == null)).toBe(true)
    expect(await db.agentRunEvents.where('runId').equals(result.runId).count()).toBe(0)
    expect(await db.agentRunCheckpoints.where('runId').equals(result.runId).count()).toBe(0)
  })
})
