import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { getOrCreateAgentConversation, updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import type { MasterAgentPlan } from '../../src/lib/agent/orchestrator'
import {
  MASTER_AGENT_REPLAN_STORAGE_KEY,
  MASTER_CANDIDATE_SEMANTIC_REVIEW_STORAGE_KEY,
  replanDurableMasterAgentRunV1,
  restoreMasterAgentCandidatesV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { appendAgentRunEventV1, readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readFreshMasterCandidateStepReceiptV1 } from '../../src/lib/agent/run/master-step-verification'
import {
  beginMasterAgentCandidateAdoptionV1,
  commitMasterAgentCandidateAdoptionV1,
} from '../../src/lib/agent/run/master-adoption'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { verifyVerificationReceiptIntegrityV1 } from '../../src/lib/agent/run/verification-receipt'
import {
  runMasterCandidateSemanticReviewV1,
  type MasterCandidateSemanticReviewArtifactV1,
} from '../../src/lib/agent/master-candidate-semantic-review'
import { AgentTeamBudgetTracker, resolveAgentTeamBudgetPolicy } from '../../src/lib/agent/team-budget'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import type { AIConfig, WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

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
    worldCode: `h27-${label}`,
    worldVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: `h27-${label}`,
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
    worldId,
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  await db.worldviews.add({
    projectId,
    worldId,
    worldGroupId,
    worldOrigin: '盐城每夜退潮，居民从未知道海神真名。',
    createdAt: now,
    updatedAt: now,
  } as any)
  await db.inspirationWorkspaces.add({
    projectId,
    worldId,
    workId,
    fragments: JSON.stringify([{
      id: 'rain-memory',
      text: '旧城每次下雨都会忘记一个人',
      label: '城市规则',
      sourceKind: 'author',
      createdAt: now,
    }]),
    versions: '[]',
    createdAt: now,
    updatedAt: now,
  } as any)
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

const INSPIRATION_DRAFT = JSON.stringify({
  worldview: {
    worldOrigin: '旧城由潮汐遗忘诞生',
    powerHierarchy: '',
    continentLayout: '',
    climateByRegion: '',
    historyLine: '',
    races: '',
    factionLayout: '',
  },
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
  if (taskId === 'inspiration-1') return INSPIRATION_DRAFT
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
  if (taskId === 'world-1') return ['worldview']
  if (taskId === 'inspiration-1') return ['inspirationWorkspace']
  return ['worldview']
}

async function executeFixture(options: any): Promise<void> {
  for (const task of options.plan.tasks) {
    if (options.completedTaskOutputs?.[task.id]) continue
    await options.executionTrace.taskStarted(task)
    const output = outputFor(task.id)
    const reservation = options.budget.reserveCall({
      label: task.id,
      messages: [{ role: 'user', content: task.instruction }],
      maxOutputTokens: 300,
    })
    options.budget.settleCall(reservation, output)
    const sources = sourcesFor(task.id)
    const worldview = task.id === 'world-1'
      ? await db.worldviews.where('projectId').equals(options.scope.projectId).first()
      : null
    const inspirationWorkspace = task.id === 'inspiration-1'
      ? await db.inspirationWorkspaces.where('projectId').equals(options.scope.projectId).first()
      : null
    await options.executionTrace.candidateReady(task, {
      payload: {
        version: 1,
        taskId: task.id,
        agentId: task.agentId,
        skillId: task.skillId,
        label: task.id,
        contextSources: sources,
        contextEvidence: {
          profile: 'balanced',
          included: sources,
          omitted: [],
          trimmed: [],
          estimatedInputTokens: 20,
          inputBudgetTokens: 14_000,
        },
        baseSnapshot: task.id === 'world-1'
          ? {
              id: worldview?.id ?? null,
              updatedAt: worldview?.updatedAt ?? null,
              worldOrigin: worldview?.worldOrigin ?? '',
            }
          : task.id === 'character-1'
            ? { serialized: '[]', visibleNames: [] }
            : {
                id: inspirationWorkspace?.id ?? null,
                updatedAt: inspirationWorkspace?.updatedAt ?? null,
                fragments: inspirationWorkspace?.fragments ?? '[]',
                versions: inspirationWorkspace?.versions ?? '[]',
              },
        ...(task.id === 'inspiration-1'
          ? { mode: 'single', selectedFragmentIds: ['rain-memory'] }
          : {}),
        ...(['world-1', 'inspiration-1'].includes(task.id)
          ? { generator: { provider: 'generator-provider', model: `generator-${task.id}` } }
          : {}),
        workspaceScope: options.scope,
        dependsOnTaskIds: task.dependsOn,
      },
      draft: output,
      runtimeNode: {},
      runtimeOutput: output,
    })
  }
}

const REVIEWER_CONFIG: AIConfig = {
  provider: 'custom',
  model: 'independent-reviewer',
  apiKey: 'test',
  baseUrl: 'https://review.invalid/v1',
  temperature: 0,
  maxTokens: 3_000,
}

function semanticReviewDependency(input: any) {
  return runMasterCandidateSemanticReviewV1({
    ...input,
    reviewerConfig: REVIEWER_CONFIG,
    review: async () => JSON.stringify({ verdict: 'pass', findings: [] }),
  })
}

async function createRun(label: string, options: {
  semanticReview?: (input: any) => ReturnType<typeof runMasterCandidateSemanticReviewV1>
  budget?: AgentTeamBudgetTracker
} = {}) {
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
    budget: options.budget ?? new AgentTeamBudgetTracker('balanced'),
  }, {
    execute: executeFixture as any,
    semanticReview: (options.semanticReview ?? semanticReviewDependency) as any,
  })
  return { fixture, result }
}

describe.sequential('R-HARNESS27 · fan-out 叶子 durable 语义终验', { timeout: 20_000 }, () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    globalThis.localStorage?.setItem(MASTER_CANDIDATE_SEMANTIC_REVIEW_STORAGE_KEY, 'enabled')
    globalThis.localStorage?.removeItem(MASTER_AGENT_REPLAN_STORAGE_KEY)
  })

  afterEach(() => {
    globalThis.localStorage?.removeItem(MASTER_CANDIDATE_SEMANTIC_REVIEW_STORAGE_KEY)
    globalThis.localStorage?.removeItem(MASTER_AGENT_REPLAN_STORAGE_KEY)
    db.close()
  })

  it('真实发布证据未到位时默认关闭，不增加 reviewer 调用或改变旧 v1 回执', async () => {
    globalThis.localStorage?.removeItem(MASTER_CANDIDATE_SEMANTIC_REVIEW_STORAGE_KEY)
    const review = vi.fn(semanticReviewDependency)
    const { fixture, result } = await createRun('语义终验默认关闭', { semanticReview: review })
    const snapshot = await readAgentRunV1(fixture.scope, result.runId)

    expect(review).not.toHaveBeenCalled()
    expect(result.budgetEvidence.calls).toBe(3)
    expect(result.candidates.every(candidate => candidate.payload.semanticReview === undefined)).toBe(true)
    expect(result.projection.steps['master:world-1'].verificationReceiptHash).toBeTruthy()
    expect(snapshot.contract.candidateSemanticReviewPolicy).toBeUndefined()
    expect(snapshot.events
      .filter(event => event.type === 'step.verification.accepted')
      .every(event => event.type === 'step.verification.accepted'
        && event.payload.receipt.verifierSetVersion === 'master-candidate-step-v1')).toBe(true)
  })

  it('两类领域叶子各自独立装配、评审并签发 v2 fresh receipt 后才允许汇合', async () => {
    const { fixture, result } = await createRun('语义终验通过')
    const snapshot = await readAgentRunV1(fixture.scope, result.runId)

    expect(snapshot.contract.candidateSemanticReviewPolicy).toEqual({
      requiredForJoin: true,
      verifierSetVersion: 'master-candidate-step-v2-semantic',
      taskIds: ['world-1', 'inspiration-1'],
    })
    expect(snapshot.contract.executionBindings).toHaveLength(7)
    expect(result.budgetEvidence.calls).toBe(5)
    const leaves = result.candidates.filter(candidate => candidate.payload.semanticReview)
    expect(leaves).toHaveLength(2)
    expect(leaves.every(candidate => candidate.payload.semanticReview?.verdict === 'pass')).toBe(true)
    const receipts = snapshot.events.filter(event => event.type === 'step.verification.accepted')
    expect(receipts.map(event => event.type === 'step.verification.accepted'
      ? event.payload.receipt.verifierSetVersion
      : '')).toEqual([
      'master-candidate-step-v2-semantic',
      'master-candidate-step-v2-semantic',
      'master-candidate-step-v1',
    ])
    const settled = snapshot.events
      .filter(event => event.type === 'budget.settled')
      .map(event => event.type === 'budget.settled' ? event.payload : null)
      .filter((event): event is NonNullable<typeof event> => event !== null)
    expect(settled.map(event => [event.stepId, event.modelCalls])).toEqual([
      ['master:world-1', 2],
      ['master:inspiration-1', 2],
      ['master:character-1', 1],
    ])
    expect(settled.reduce((sum, event) => sum + event.modelCalls, 0)).toBe(result.budgetEvidence.calls)
    const characterRequest = snapshot.events.find(event => (
      event.type === 'model.requested' && event.payload.stepId === 'master:character-1'
    ))!
    expect(leaves.every(candidate => snapshot.events.some(event => (
      event.type === 'step.succeeded'
      && event.payload.stepId === candidate.payload.semanticReview!.reviewStepId
      && event.payload.outputHash === candidate.payload.semanticReview!.artifactHash
      && event.sequence < characterRequest.sequence
    )))).toBe(true)
    expect(await db.characters.count()).toBe(0)
  })

  it('只采纳三个业务候选即可完成终局验证，并把语义 criteria 与两类 manifest 写入 receipt', async () => {
    const { fixture, result } = await createRun('语义终验完成闭环')
    for (const candidate of result.candidates) {
      const ref = {
        scope: fixture.scope,
        runId: result.runId,
        candidateEventId: candidate.event.id!,
        worldGroupId: fixture.worldGroupId,
      }
      await beginMasterAgentCandidateAdoptionV1(ref)
      await commitMasterAgentCandidateAdoptionV1(ref)
    }

    const verified = await verifyMasterAgentRunV1({
      scope: fixture.scope,
      runId: result.runId,
      now: 1_786_377_600_000,
    })
    expect(verified.accepted).toBe(true)
    expect(verified.snapshot.projection.state).toBe('completed')
    expect(await verifyVerificationReceiptIntegrityV1(verified.receipt)).toBe(true)
    expect(verified.receipt?.candidateHashes).toHaveLength(3)
    expect(verified.receipt?.adoptionEventIds).toHaveLength(3)
    expect(verified.receipt?.contextManifestHashes).toHaveLength(5)

    const reviewed = result.candidates.filter(candidate => candidate.payload.semanticReview)
    expect(reviewed).toHaveLength(2)
    for (const candidate of reviewed) {
      const review = candidate.payload.semanticReview!
      expect(verified.receipt?.contextManifestHashes).toContain(review.generationContextManifestHash)
      expect(verified.receipt?.contextManifestHashes).toContain(review.reviewContextManifestHash)
      expect(verified.receipt?.criteria).toContainEqual({
        id: `${candidate.payload.taskId}.semantic-review`,
        status: 'passed',
        evidenceRefs: [`semantic-review:${review.artifactHash}`],
      })
    }
    expect(verified.snapshot.contract.acceptance.some(criterion => (
      criterion.id.includes(':semantic-review:')
    ))).toBe(false)
  })

  it('有逐字证据的 blocking 会停止持久化和下游汇合，并保存可审计 artifact', async () => {
    globalThis.localStorage?.setItem(MASTER_AGENT_REPLAN_STORAGE_KEY, 'disabled')
    const fixture = await createWorkspace('语义阻断')
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
      execute: executeFixture as any,
      semanticReview: (async (input: any) => runMasterCandidateSemanticReviewV1({
        ...input,
        reviewerConfig: REVIEWER_CONFIG,
        review: async () => input.taskId === 'inspiration-1'
          ? JSON.stringify({
              verdict: 'block',
              findings: [{
                code: 'seed-drift',
                severity: 'blocking',
                message: '候选偏离作者保存的雨中遗忘种子。',
                candidateQuote: '守灯人追查被雨抹去的名字',
                sourceKey: 'inspirationWorkspace',
                sourceQuote: '旧城每次下雨都会忘记一个人',
              }],
            })
          : JSON.stringify({ verdict: 'pass', findings: [] }),
      })) as any,
    })).rejects.toThrow('候选语义终验硬门未通过')

    const snapshot = await readAgentRunV1(fixture.scope, runId)
    expect(snapshot.projection.state).toBe('paused')
    expect(snapshot.projection.steps['master:inspiration-1']).toMatchObject({
      status: 'failed',
      failureCode: 'semantic_review_blocked',
    })
    expect(snapshot.events.some(event => (
      event.type === 'model.requested' && event.payload.stepId === 'master:character-1'
    ))).toBe(false)
    expect((await db.agentEvents.toArray()).filter(event => event.kind === 'candidate')).toHaveLength(1)
    const payload = (await db.agentEvents.toArray())
      .filter(event => event.kind === 'task')
      .map(event => JSON.parse(event.payload) as { artifact: MasterCandidateSemanticReviewArtifactV1 })
      .find(item => item.artifact.taskId === 'inspiration-1')!
    expect(payload.artifact.verdict).toBe('block')
    expect(payload.artifact.findings[0].sourceKey).toBe('inspirationWorkspace')
  })

  it('artifact 即使连同 candidateHash 一起重算，恢复仍会按 artifact 自身哈希 fail closed', async () => {
    const { fixture, result } = await createRun('语义证据篡改')
    const world = result.candidates.find(candidate => candidate.payload.taskId === 'world-1')!
    const row = await db.agentEvents.get(world.event.id!)
    const payload = JSON.parse(row!.payload) as Record<string, any>
    payload.semanticReview.findings = [{
      code: 'low-specificity',
      severity: 'warning',
      message: '攻击者插入的伪造结论。',
      candidateQuote: '盐城',
      sourceKey: null,
      sourceQuote: null,
    }]
    const { candidateHash: _oldHash, ...withoutHash } = payload
    payload.candidateHash = await hashCanonicalValue({ draft: row!.content, payload: withoutHash })
    await db.agentEvents.update(row!.id!, { payload: JSON.stringify(payload) })

    await expect(restoreMasterAgentCandidatesV1({
      scope: fixture.scope,
      runId: result.runId,
    })).rejects.toThrow('缺少 fresh 独立语义终验')
  })

  it('作者编辑会保留候选但移除 semantic artifact、撤销 v2 receipt，并阻断旧汇合版本', async () => {
    const { fixture, result } = await createRun('语义证据编辑失效')
    const world = result.candidates.find(candidate => candidate.payload.taskId === 'world-1')!
    await updateAgentEventCandidate(
      world.event.id!,
      fixture.scope.projectId,
      '潮汐改由月轮和海底钟阵共同维持。',
      fixture.scope,
    )
    const restored = await restoreMasterAgentCandidatesV1({ scope: fixture.scope, runId: result.runId })
    const revised = restored.candidates.find(candidate => candidate.payload.taskId === 'world-1')!
    expect(revised.payload.semanticReview).toBeUndefined()
    expect(restored.snapshot.projection.steps['master:world-1'].verificationReceiptHash).toBeUndefined()
    await expect(readFreshMasterCandidateStepReceiptV1({
      snapshot: restored.snapshot,
      stepId: 'master:world-1',
      candidateHash: revised.payload.candidateHash!,
      outputHash: await hashCanonicalValue(revised.draft),
      semanticReview: revised.payload.semanticReview,
      generator: revised.payload.generator,
    })).resolves.toBeNull()
    await expect(commitMasterAgentCandidateAdoptionV1({
      scope: fixture.scope,
      runId: result.runId,
      candidateEventId: revised.event.id!,
    })).rejects.toThrow('重新执行并通过终验前不能采纳')
    expect((await db.worldviews.toArray()).map(row => row.worldOrigin)).toEqual([
      '盐城每夜退潮，居民从未知道海神真名。',
    ])
  })

  it('有限重规划使旧代 semantic artifact 及其所有下游失效，不跨代重签冒充 fresh', async () => {
    const { fixture, result } = await createRun('语义证据重规划')
    const snapshot = await readAgentRunV1(fixture.scope, result.runId)
    await appendAgentRunEventV1({
      scope: fixture.scope,
      runId: result.runId,
      type: 'run.paused',
      payload: { reason: 'test_replan', recoverable: true },
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    const nextPlan = fanOutPlan()
    nextPlan.tasks = nextPlan.tasks.map(task => task.id === 'character-1'
      ? { ...task, instruction: '重新汇合两个经过终验的上游。' }
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
        fingerprint: 'c'.repeat(64),
      }],
      budgetEvidence: result.budgetEvidence,
      reasonCode: 'test_semantic_replan',
    })

    expect(replanned.projection.generation).toBe(2)
    expect(replanned.events.filter(event => (
      event.generation === 2 && event.type === 'candidate.carried-forward'
    ))).toHaveLength(0)
    expect(Object.values(replanned.projection.steps).every(step => (
      step.status === 'scheduled' && !step.verificationReceiptHash
    ))).toBe(true)
  })

  it('未确认 Run 经 PROJECT_TABLES 往返后仍能恢复 artifact、review step 和 v2 receipt', async () => {
    const { fixture, result } = await createRun('语义证据往返')
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
    const leaves = restored.candidates.filter(candidate => candidate.payload.semanticReview)
    expect(leaves).toHaveLength(2)
    for (const candidate of leaves) {
      await expect(readFreshMasterCandidateStepReceiptV1({
        snapshot: restored.snapshot,
        stepId: candidate.payload.runStepId!,
        candidateHash: candidate.payload.candidateHash!,
        outputHash: await hashCanonicalValue(candidate.draft),
        semanticReview: candidate.payload.semanticReview,
        generator: candidate.payload.generator,
      })).resolves.not.toBeNull()
    }
    const importedReviewEvidence = (await db.agentEvents
      .where('projectId')
      .equals(importedProjectId)
      .toArray())
      .filter(event => event.kind === 'task')
    expect(importedReviewEvidence).toHaveLength(2)
    expect(importedReviewEvidence.every(event => event.durableRunId === importedRun.id)).toBe(true)
  })

  it('团队预算不足时在 reviewer 调用前停止，不伪造 review step 或候选', async () => {
    globalThis.localStorage?.setItem(MASTER_AGENT_REPLAN_STORAGE_KEY, 'disabled')
    const policy = resolveAgentTeamBudgetPolicy('balanced')
    const budget = new AgentTeamBudgetTracker('balanced', {
      ...policy,
      usedTokens: 1_000,
      calls: policy.maxCalls - 1,
      canonRetries: 0,
    })
    const review = vi.fn(async () => JSON.stringify({ verdict: 'pass', findings: [] }))
    const fixture = await createWorkspace('语义评审预算')
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
      budget,
      onDurableBoundary: boundary => { runId = boundary.runId },
    }, {
      execute: executeFixture as any,
      semanticReview: (async (input: any) => runMasterCandidateSemanticReviewV1({
        ...input,
        reviewerConfig: REVIEWER_CONFIG,
        review,
      })) as any,
    })).rejects.toThrow('模型调用上限')

    const snapshot = await readAgentRunV1(fixture.scope, runId)
    expect(review).not.toHaveBeenCalled()
    expect(snapshot.events.some(event => (
      event.type === 'model.requested' && event.payload.stepId.includes(':semantic-review:')
    ))).toBe(false)
    expect((await db.agentEvents.toArray()).some(event => event.kind === 'candidate')).toBe(false)
  })
})
