import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adoptGenerationNodeOutput,
  runGenerationNode,
} from '../../src/lib/generation/generation-node'
import {
  parseStorylineProgressCandidateDraftV1,
  prepareStorylineProgressCopilotV1,
} from '../../src/lib/agent/storyline-progress-copilot'
import { db } from '../../src/lib/db/schema'
import type { Project, WorkspaceScope } from '../../src/lib/types'
import { stringifyStages } from '../../src/lib/types'
import { selectAgentSkillIdV1 } from '../../src/lib/agent/workflow-catalog'

async function workspace(): Promise<{ project: Project; scope: WorkspaceScope; chapterId: number; arcId: number }> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '故事线映射测试',
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    status: 'drafting',
    targetWordCount: 100_000,


    createdAt: now,
    updatedAt: now,
  } as Project) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'harness-40-world',
    name: '映射世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '故事线映射测试',
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const volumeId = await db.outlineNodes.add({
    projectId,
    workId,
    parentId: null,
    type: 'volume',
    title: '卷一',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const nodeId = await db.outlineNodes.add({
    projectId,
    workId,
    parentId: volumeId,
    type: 'chapter',
    title: '交付',
    summary: '钥匙交付',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId,
    workId,
    outlineNodeId: nodeId,
    title: '交付',
    content: '<p>林飞交出了青铜钥匙。</p>',
    wordCount: 12,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const arcId = await db.storyArcs.add({
    projectId,
    workId,
    name: '寻钥主线',
    type: 'main',
    stages: stringifyStages([{
      id: 'hand-over',
      title: '交付',
      description: '交出钥匙',
      keyEvents: ['交出钥匙'],
    }]),
    description: '寻找钥匙并完成交付。',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('测试项目创建失败')
  return { project, scope: { projectId, worldId, workId }, chapterId, arcId }
}

function draft(arcId: number): string {
  return JSON.stringify({
    progress: [{
      arcId,
      currentStageId: 'hand-over',
      status: 'active',
      progressNote: '青铜钥匙已经完成交付。',
      involvedEntities: ['林飞', '青铜钥匙'],
      quote: '交出了青铜钥匙',
    }],
    crossings: [],
    newArcs: [],
  })
}

describe.sequential('R-HARNESS40 · 故事线进度映射 Skill', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('通过正式上下文装配、严格逐字证据 gate，并在确认后经 adopt 写入', async () => {
    const { project, scope, chapterId, arcId } = await workspace()
    const runAI = vi.fn(async () => draft(arcId))
    const prepared = await prepareStorylineProgressCopilotV1({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      chapterId,
      authorRequest: `映射章节 ID=${chapterId}`,
    }, { runAI })
    expect(prepared.contextSources).toEqual(expect.arrayContaining(['storyArcs', 'chapterContent']))
    const generated = await runGenerationNode(prepared.node, prepared.prepared)
    expect(generated.gate?.status).toBe('pass')
    expect(await db.storylineProgress.count()).toBe(0)

    const adopted = await adoptGenerationNodeOutput(prepared.node, generated.output)
    expect(adopted.adopted).toBe(true)
    expect(runAI).toHaveBeenCalledOnce()
    expect(await db.storylineProgress.count()).toBe(1)
    expect(await db.storylineProgress.toCollection().first()).toMatchObject({
      arcId,
      status: 'active',
      progressNote: '青铜钥匙已经完成交付。',
      lastActiveChapterId: chapterId,
    })
  })

  it('章节映射请求稳定路由到 storyline-progress Skill，而普通故事线规划仍路由 story-arcs', () => {
    expect(selectAgentSkillIdV1('outline', '映射本章如何推进故事线进度')).toBe('outline.storyline-progress')
    expect(selectAgentSkillIdV1('outline', '生成一条主线故事线')).toBe('outline.story-arcs')
  })

  it('durable 快照只保存正文 hash 和动态投影版本，不复制正文或进度全文', async () => {
    const { project, scope, chapterId, arcId } = await workspace()
    const now = Date.now()
    await db.storylineProgress.add({
      projectId: project.id!,
      workId: scope.workId,
      arcId,
      currentStageId: 'hand-over',
      status: 'active',
      progressNote: '不应进入 durable 快照的进度全文',
      lastActiveChapterId: chapterId,
      lastActiveChapterTitle: '交付',
      involvedEntities: JSON.stringify(['林飞']),
      evidenceQuote: '不应进入 durable 快照的证据全文',
      createdAt: now,
      updatedAt: now,
    } as any)
    const prepared = await prepareStorylineProgressCopilotV1({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      chapterId,
      authorRequest: `映射章节 ID=${chapterId}`,
    }, { runAI: async () => draft(arcId) })

    const durableSnapshot = JSON.stringify(prepared.snapshot)
    expect(durableSnapshot).toContain('chapterContentHash')
    expect(durableSnapshot).not.toContain('林飞交出了青铜钥匙')
    expect(durableSnapshot).not.toContain('不应进入 durable 快照的进度全文')
    expect(durableSnapshot).not.toContain('不应进入 durable 快照的证据全文')
  })

  it('恢复 durable 候选时兼容 quote 字段并规范化证据', () => {
    const restored = parseStorylineProgressCandidateDraftV1(JSON.stringify({
      progress: [{
        arcId: 1,
        currentStageId: null,
        status: 'active',
        progressNote: '推进',
        quote: '正文证据',
      }],
      crossings: [],
      newArcs: [],
    }))
    expect(restored.progress[0]?.evidenceQuote).toBe('正文证据')
  })

  it('没有逐字正文证据或候选结构越界时阻断写入', async () => {
    const { project, scope, chapterId, arcId } = await workspace()
    const prepared = await prepareStorylineProgressCopilotV1({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      chapterId,
      authorRequest: `映射章节 ID=${chapterId}`,
    }, { runAI: async () => draft(arcId) })
    const invalid = JSON.stringify({
      progress: [{
        arcId,
        currentStageId: 'not-a-stage',
        status: 'active',
        progressNote: '无证据',
        involvedEntities: [],
        quote: '不存在的句子',
      }],
      crossings: [],
      newArcs: [],
    })
    const blocked = await adoptGenerationNodeOutput(prepared.node, parseStorylineProgressCandidateDraftV1(invalid))
    expect(blocked.adopted).toBe(false)
    expect(blocked.gate?.issues.map(issue => issue.code)).toContain('storyline-progress-invalid')
    expect(await db.storylineProgress.count()).toBe(0)
  })

  it('章节正文发生变化后旧候选 stale，不能覆盖新正文', async () => {
    const { project, scope, chapterId, arcId } = await workspace()
    const prepared = await prepareStorylineProgressCopilotV1({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      chapterId,
      authorRequest: `映射章节 ID=${chapterId}`,
    }, { runAI: async () => draft(arcId) })
    await db.chapters.update(chapterId, { content: '<p>作者已经改写了这一章。</p>', updatedAt: Date.now() })
    await expect(adoptGenerationNodeOutput(prepared.node, {
      progress: [{
        arcId,
        currentStageId: 'hand-over',
        status: 'active',
        progressNote: '青铜钥匙已经完成交付。',
        involvedEntities: ['林飞'],
        evidenceQuote: '交出了青铜钥匙',
      }],
      crossings: [],
      newArcs: [],
    })).rejects.toThrow('目标章节或故事线状态已在候选生成后发生变化')
    expect(await db.storylineProgress.count()).toBe(0)
  })
})
