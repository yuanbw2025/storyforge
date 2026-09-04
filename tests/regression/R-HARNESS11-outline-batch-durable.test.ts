import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readAgentRunV1 } from '../../src/lib/agent/run'
import { runBatchOutlineGeneration } from '../../src/lib/ai/batch-outline-runner'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import {
  beginOutlineGenerationAdoptionV1,
  commitOutlineGenerationAdoptionV1,
  rejectOutlineGenerationCandidateV1,
  restoreLatestOutlineGenerationBatchV1,
  restoreLatestOutlineGenerationCandidateV1,
} from '../../src/lib/outline/harness'
import { adoptGeneratedOutlineItems } from '../../src/lib/outline/adopt-generation'
import type { OutlineNode, Project, WorkspaceScope } from '../../src/lib/types'
import { prepareOutlineGatewayAssemblyV1 } from '../../src/lib/outline/gateway-context'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { verifyContextGatewayCandidateEvidenceV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

async function createWorkspace(): Promise<{
  scope: WorkspaceScope
  project: Project
  worldGroupId: number
  volumes: OutlineNode[]
}> {
  const now = Date.now()
  const { project, scope } = await seedCurrentWorkspace('批量章纲 durable')
  const { projectId } = scope
  const worldGroupId = await db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    projectId,
    name: '主世界',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'world' }) as never) as number
  const volumeIds = await db.outlineNodes.bulkAdd([
    stampNewRecord(scope, 'outlineNodes', {
      projectId,
      worldGroupId,
      parentId: null,
      type: 'volume',
      title: '第一卷',
      summary: '潮城开始迁徙。',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }),
    stampNewRecord(scope, 'outlineNodes', {
      projectId,
      worldGroupId,
      parentId: null,
      type: 'volume',
      title: '第二卷',
      summary: '迁徙队伍穿越盐海。',
      order: 1,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }),
  ] as any, { allKeys: true }) as number[]
  const volumes = await db.outlineNodes.bulkGet(volumeIds) as OutlineNode[]
  return {
    scope,
    project,
    worldGroupId,
    volumes,
  }
}

async function assembleBatchContext(input: {
  fixture: Awaited<ReturnType<typeof createWorkspace>>
  volume: OutlineNode
  priorOutlineCandidateText?: string
}) {
  return prepareOutlineGatewayAssemblyV1({
    projectId: input.fixture.scope.projectId,
    scope: input.fixture.scope,
    worldGroupId: input.volume.worldGroupId ?? null,
    request: { kind: 'chapters', volumeId: input.volume.id! },
    authorRequest: `把《${input.volume.title}》拆分为章纲`,
    config: useAIConfigStore.getState().config,
    priorOutlineCandidateText: input.priorOutlineCandidateText,
  })
}

describe.sequential('R-HARNESS11 · 批量章纲 durable 主路径', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('每卷只调用一次模型，上一卷候选经正式上下文源进入下一卷，并可按批次恢复', async () => {
    const fixture = await createWorkspace()
    const contextRequests: Array<{ volumeId: number; prior?: string; included: string[] }> = []
    const runModel = vi.fn(async (_messages, volume: OutlineNode) => JSON.stringify([
      { title: `${volume.title}第一章`, summary: `${volume.title}的推进事件` },
      { title: `${volume.title}第二章`, summary: `${volume.title}的卷末转折` },
    ]))

    const result = await runBatchOutlineGeneration({
      project: fixture.project,
      nodes: fixture.volumes,
      volumes: fixture.volumes,
      batchGroupId: 'outline-batch-h11-proof',
      runModel,
      assembleContext: async ({ volume, priorOutlineCandidateText }) => {
        const assembled = await assembleBatchContext({
          fixture,
          volume,
          priorOutlineCandidateText,
        })
        contextRequests.push({
          volumeId: volume.id!,
          prior: priorOutlineCandidateText,
          included: assembled.included,
        })
        return assembled
      },
    })

    expect(result.cancelled).toBe(false)
    expect(result.failures).toEqual([])
    expect(runModel).toHaveBeenCalledTimes(2)
    expect(result.candidatesByVolume.size).toBe(2)
    expect(contextRequests[0].prior).toBeUndefined()
    expect(contextRequests[0].included).not.toContain('priorOutlineCandidate')
    expect(contextRequests[1].prior).toContain(result.candidatesByVolume.get(fixture.volumes[0].id!)!.candidateHash)
    expect(contextRequests[1].prior).toContain('第一卷第一章')
    expect(contextRequests[1].included).toContain('priorOutlineCandidate')

    const candidates = [...result.candidatesByVolume.values()]
    expect(candidates.map(candidate => candidate.batch?.batchIndex)).toEqual([0, 1])
    expect(candidates[1].batch?.predecessorCandidateHash).toBe(candidates[0].candidateHash)
    for (const candidate of candidates) {
      const snapshot = await readAgentRunV1(fixture.scope, candidate.runId)
      expect(snapshot.projection.state).toBe('awaiting_confirmation')
      expect(snapshot.projection.steps[candidate.stepId]?.candidateHash).toBe(candidate.candidateHash)
      const verified = await verifyContextGatewayCandidateEvidenceV1({
        scope: fixture.scope,
        runId: candidate.runId,
        stepId: candidate.stepId,
        attempt: 1,
        candidateHash: candidate.candidateHash,
      })
      expect(verified.manifest.version).toBe(3)
      expect(verified.manifest.gateway.retrievalTrace.mandatory
        .some(item => item.resourceKey.startsWith('outline-node:'))).toBe(true)
    }

    expect(await restoreLatestOutlineGenerationCandidateV1(fixture.scope.projectId)).toBeNull()
    const restored = await restoreLatestOutlineGenerationBatchV1(fixture.scope.projectId)
    expect(restored?.batchGroupId).toBe('outline-batch-h11-proof')
    expect(restored?.candidates.map(candidate => candidate.operation)).toEqual([
      `outline.chapter:batch:${fixture.volumes[0].id}`,
      `outline.chapter:batch:${fixture.volumes[1].id}`,
    ])

    await rejectOutlineGenerationCandidateV1(candidates[0], '测试拒绝第一卷')
    expect((await readAgentRunV1(fixture.scope, candidates[0].runId)).projection.state).toBe('failed')
    const remaining = await restoreLatestOutlineGenerationBatchV1(fixture.scope.projectId)
    expect(remaining?.candidates.map(candidate => candidate.runId)).toEqual([candidates[1].runId])

    const secondVolumeId = fixture.volumes[1].id!
    const secondItems = result.chaptersByVolume.get(secondVolumeId)!
    const intent = {
      version: 1 as const,
      kind: 'chapters' as const,
      destinationVolumeId: secondVolumeId,
      items: secondItems,
      startingOrder: 0,
      baseExistingTitles: [],
    }
    await beginOutlineGenerationAdoptionV1(candidates[1], intent)
    const adoption = await adoptGeneratedOutlineItems({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      parentId: secondVolumeId,
      type: 'chapter',
      items: secondItems,
      startingOrder: 0,
    })
    await commitOutlineGenerationAdoptionV1(candidates[1], adoption, intent)
    const completed = await readAgentRunV1(fixture.scope, candidates[1].runId)
    expect(completed.projection.state).toBe('completed')
    expect(completed.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(completed.events.slice(-4).map(event => event.type)).toEqual([
      'step.succeeded',
      'verification.started',
      'verification.accepted',
      'memory.settlement.recorded',
    ])
    expect(await restoreLatestOutlineGenerationBatchV1(fixture.scope.projectId)).toBeNull()
  })

  it('确定性解析失败直接阻断候选，不发起隐藏的 AI 重构调用', async () => {
    const fixture = await createWorkspace()
    const runModel = vi.fn(async () => '这是一段无法识别为章纲的普通说明。')
    const result = await runBatchOutlineGeneration({
      project: fixture.project,
      nodes: fixture.volumes,
      volumes: [fixture.volumes[0]],
      batchGroupId: 'outline-batch-h11-invalid',
      runModel,
      assembleContext: ({ volume }) => assembleBatchContext({ fixture, volume }),
    })

    expect(runModel).toHaveBeenCalledOnce()
    expect(result.candidatesByVolume.size).toBe(0)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].reason).toContain('无法确定性解析')
    const runs = await db.agentRuns.where('projectId').equals(fixture.scope.projectId).toArray()
    expect(runs).toHaveLength(1)
    const snapshot = await readAgentRunV1(fixture.scope, runs[0].id!)
    expect(snapshot.projection.state).toBe('failed')
    expect(snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(snapshot.events.filter(event => event.type === 'model.responded')).toHaveLength(1)
    expect(await restoreLatestOutlineGenerationBatchV1(fixture.scope.projectId)).toBeNull()
  })

  it('候选持久化后收到批量取消信号时，将该卷 run 收口为 cancelled 且不可恢复', async () => {
    const fixture = await createWorkspace()
    const controller = new AbortController()
    const runModel = vi.fn(async () => {
      controller.abort()
      return JSON.stringify([{ title: '第一章', summary: '已经生成但作者随即取消' }])
    })
    const result = await runBatchOutlineGeneration({
      project: fixture.project,
      nodes: fixture.volumes,
      volumes: fixture.volumes,
      batchGroupId: 'outline-batch-h11-cancel',
      signal: controller.signal,
      runModel,
      assembleContext: ({ volume }) => assembleBatchContext({ fixture, volume }),
    })

    expect(result.cancelled).toBe(true)
    expect(runModel).toHaveBeenCalledOnce()
    expect(result.candidatesByVolume.size).toBe(1)
    const candidate = [...result.candidatesByVolume.values()][0]
    const snapshot = await readAgentRunV1(fixture.scope, candidate.runId)
    expect(snapshot.projection.state).toBe('cancelled')
    expect(snapshot.events.slice(-2).map(event => event.type)).toEqual([
      'run.cancelled',
      'memory.settlement.recorded',
    ])
    expect(snapshot.projection.memorySettlement).toMatchObject({
      state: 'incomplete',
      terminalReceiptHash: null,
      workspaceDirty: true,
    })
    expect(await restoreLatestOutlineGenerationBatchV1(fixture.scope.projectId)).toBeNull()
  })

  it('相邻卷属于不同世界时不注入上一世界的未采纳候选', async () => {
    const fixture = await createWorkspace()
    const now = Date.now()
    const otherWorldGroupId = await db.worldGroups.add(stampNewRecord(fixture.scope, 'worldGroups', {
      projectId: fixture.scope.projectId,
      name: '镜像世界',
      order: 1,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'world' }) as never) as number
    await db.outlineNodes.update(fixture.volumes[1].id!, { worldGroupId: otherWorldGroupId })
    fixture.volumes[1] = { ...fixture.volumes[1], worldGroupId: otherWorldGroupId }
    const priorInputs: Array<string | undefined> = []
    const result = await runBatchOutlineGeneration({
      project: fixture.project,
      nodes: fixture.volumes,
      volumes: fixture.volumes,
      batchGroupId: 'outline-batch-h11-worlds',
      runModel: async (_messages, volume) => JSON.stringify([
        { title: `${volume.title}第一章`, summary: '世界内事件' },
      ]),
      assembleContext: async ({ volume, priorOutlineCandidateText }) => {
        priorInputs.push(priorOutlineCandidateText)
        return assembleBatchContext({
          fixture,
          volume,
          priorOutlineCandidateText,
        })
      },
    })

    expect(result.failures).toEqual([])
    expect(priorInputs).toEqual([undefined, undefined])
    expect(result.candidatesByVolume.get(fixture.volumes[1].id!)?.batch?.predecessorCandidateHash).toBeUndefined()
  })

  it('正式前序候选源受单源预算控制，超长内容不会绕过装配器', async () => {
    const fixture = await createWorkspace()
    const assembled = await assembleContext({
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.worldGroupId,
      outlineNodeId: fixture.volumes[1].id,
      priorOutlineCandidateText: `【同批次上一卷章纲候选】\n${'潮汐迁徙。'.repeat(20_000)}`,
      sourceKeys: ['priorOutlineCandidate'],
      inputBudgetTokens: 3_000,
    })

    expect(assembled.included).toEqual(['priorOutlineCandidate'])
    expect(assembled.totalInputTokens).toBeLessThanOrEqual(2_400)
    expect(assembled.text).toContain('该上下文源已按预算截断')
    expect(assembled.overBudgetAfterTrim).toBe(false)
  })
})
