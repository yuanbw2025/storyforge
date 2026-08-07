import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  clearRecentGenerationShadowTracesV1,
  listRecentGenerationShadowTracesV1,
  readAgentRunV1,
} from '../../src/lib/agent/run'
import {
  prepareGenerationNode,
  runGenerationNode,
  type GenerationNode,
} from '../../src/lib/generation/generation-node'
import {
  createOutlineGenerationTraceV1,
  isOutlineDurableHarnessEnabledV1,
  OUTLINE_DURABLE_HARNESS_STORAGE_KEY,
  OUTLINE_GENERATION_SOURCE_KEYS,
} from '../../src/lib/outline/harness'
import type { AssembleContextResult } from '../../src/lib/registry/types'
import type { WorkspaceScope } from '../../src/lib/types'

async function createWorkspace(): Promise<{
  scope: WorkspaceScope
  worldGroupId: number
  outlineNodeId: number
}> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '大纲 durable adapter',
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 100_000,
    worldCode: 'outline-durable-world',
    worldVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'outline-durable-world',
    name: '潮汐世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '潮城纪事',
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
  const outlineNodeId = await db.outlineNodes.add({
    projectId,
    worldId: null,
    workId,
    worldGroupId,
    parentId: null,
    type: 'volume',
    title: '第一卷',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  return { scope: { projectId, worldId, workId }, worldGroupId, outlineNodeId }
}

function assembly(): AssembleContextResult {
  return {
    text: '【故事核心】潮汐城市必须在七日内迁徙。',
    segments: [{
      label: '故事核心',
      layer: 'L1',
      content: '【故事核心】潮汐城市必须在七日内迁徙。',
      tokens: 16,
      trimmable: true,
    }],
    included: ['storyCore'],
    omitted: OUTLINE_GENERATION_SOURCE_KEYS.filter(key => key !== 'storyCore'),
    trimmed: [],
    totalInputTokens: 16,
    inputBudget: 8_000,
    overBudgetBeforeTrim: false,
    overBudgetAfterTrim: false,
  }
}

function node(run: () => Promise<string>): GenerationNode<AssembleContextResult, string> {
  return {
    id: 'outline.chapter:batch:1',
    kind: 'outline.chapter',
    editableInput: true,
    assembleInput: assembled => [{ role: 'user', content: assembled.text }],
    run,
  }
}

describe('R-HARNESS1-outline-durable-adapter · 大纲双写接入', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    clearRecentGenerationShadowTracesV1()
    localStorage.removeItem(OUTLINE_DURABLE_HARNESS_STORAGE_KEY)
  })

  afterEach(() => {
    localStorage.removeItem(OUTLINE_DURABLE_HARNESS_STORAGE_KEY)
    db.close()
  })

  it('真实 GenerationNode 只调用一次模型，同时写入无正文 durable ledger 与 H0 shadow', async () => {
    const fixture = await createWorkspace()
    const assembled = assembly()
    const run = vi.fn(async () => '第一章：潮门关闭前的最后一班船')
    const generationNode = node(run)
    const trace = await createOutlineGenerationTraceV1({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      request: { kind: 'chapters', volumeId: fixture.outlineNodeId },
      assembled,
      durable: true,
    })

    const result = await runGenerationNode(
      generationNode,
      prepareGenerationNode(generationNode, assembled),
      { shadowTrace: trace },
    )

    expect(result.output).toBe('第一章：潮门关闭前的最后一班船')
    expect(run).toHaveBeenCalledOnce()
    expect(trace.mode, trace.initializationError).toBe('durable-shadow')
    expect(listRecentGenerationShadowTracesV1()).toHaveLength(1)
    const durableRunId = trace.durable!.runId
    const snapshot = await readAgentRunV1(fixture.scope, durableRunId)
    expect(snapshot.projection.steps[`outline.chapter:batch:${fixture.outlineNodeId}`]).toMatchObject({
      status: 'succeeded',
      attempt: 1,
    })
    expect(snapshot.events.map(event => event.type)).toEqual([
      'run.created',
      'contract.accepted',
      'step.scheduled',
      'step.started',
      'context.assembled',
      'model.requested',
      'model.responded',
      'step.succeeded',
    ])
    const ledgerText = JSON.stringify({ run: snapshot.run, events: snapshot.events })
    expect(ledgerText).not.toContain('潮汐城市必须在七日内迁徙')
    expect(ledgerText).not.toContain('潮门关闭前的最后一班船')
  })

  it('关闭 durable 开关时保持原 shadow 行为且不写运行表', async () => {
    const fixture = await createWorkspace()
    const assembled = assembly()
    const run = vi.fn(async () => '候选')
    const generationNode = node(run)
    const trace = await createOutlineGenerationTraceV1({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      request: { kind: 'chapters', volumeId: fixture.outlineNodeId },
      assembled,
      durable: false,
    })

    await runGenerationNode(
      generationNode,
      prepareGenerationNode(generationNode, assembled),
      { shadowTrace: trace },
    )

    expect(trace.mode).toBe('shadow-only')
    expect(run).toHaveBeenCalledOnce()
    expect(await db.agentRuns.count()).toBe(0)
  })

  it('本机回滚开关默认启用，显式 disabled 后关闭 durable 接入', () => {
    expect(isOutlineDurableHarnessEnabledV1()).toBe(true)
    localStorage.setItem(OUTLINE_DURABLE_HARNESS_STORAGE_KEY, 'disabled')
    expect(isOutlineDurableHarnessEnabledV1()).toBe(false)
  })

  it('模型失败继续抛出原错误，并把失败步骤写入 durable ledger', async () => {
    const fixture = await createWorkspace()
    const assembled = assembly()
    const providerError = new Error('provider unavailable')
    const run = vi.fn(async () => { throw providerError })
    const generationNode = node(run)
    const trace = await createOutlineGenerationTraceV1({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      request: { kind: 'chapters', volumeId: fixture.outlineNodeId },
      assembled,
      durable: true,
    })

    await expect(runGenerationNode(
      generationNode,
      prepareGenerationNode(generationNode, assembled),
      { shadowTrace: trace },
    )).rejects.toBe(providerError)

    expect(run).toHaveBeenCalledOnce()
    const snapshot = await readAgentRunV1(fixture.scope, trace.durable!.runId)
    expect(snapshot.projection.steps[`outline.chapter:batch:${fixture.outlineNodeId}`]).toMatchObject({
      status: 'failed',
      failureCode: 'generation_model_failed',
    })
  })

  it('durable 账本在执行前损坏时降级为 shadow，不能改变模型结果或调用数', async () => {
    const fixture = await createWorkspace()
    const assembled = assembly()
    const run = vi.fn(async () => '仍然返回原候选')
    const generationNode = node(run)
    const trace = await createOutlineGenerationTraceV1({
      projectId: fixture.scope.projectId,
      worldGroupId: fixture.worldGroupId,
      request: { kind: 'chapters', volumeId: fixture.outlineNodeId },
      assembled,
      durable: true,
    })
    await db.agentRuns.update(trace.durable!.runId, { projectionHash: 'f'.repeat(64) })

    const result = await runGenerationNode(
      generationNode,
      prepareGenerationNode(generationNode, assembled),
      { shadowTrace: trace },
    )

    expect(result.output).toBe('仍然返回原候选')
    expect(run).toHaveBeenCalledOnce()
    expect(trace.shadow.projection().steps[`outline.chapter:batch:${fixture.outlineNodeId}`].status).toBe('succeeded')
    expect(trace.traceErrors.some(error => error.includes('物化投影与事件重放结果不一致'))).toBe(true)
  })
})
