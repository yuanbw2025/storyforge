import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OUTLINE_COPILOT_SOURCE_KEYS,
  OutlineCopilotStaleError,
  createOutlineCopilotNode,
  parseOutlineCandidateDraft,
  prepareOutlineCopilot as prepareOutlineCopilotRaw,
  revalidateOutlineCreativeDraftV1,
  runOutlineCreativeReliabilityV1,
  type OutlineCopilotInput,
  type OutlineCopilotMode,
  type OutlineCopilotSnapshot,
} from '../../src/lib/agent/outline-copilot'
import { adoptMasterCandidate } from '../../src/lib/agent/orchestrator'
import { appendAgentEvent, getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { db } from '../../src/lib/db/schema'
import {
  adoptGenerationNodeOutput,
  prepareGenerationNode,
  runGenerationNode,
} from '../../src/lib/generation/generation-node'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import type { Project } from '../../src/lib/types'
import { resolveScopeLike } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { buildNarrativeBriefV1 } from '../../src/lib/agent/narrative-brief'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { backfillResourceUidsV1 } from '../../src/lib/context-gateway/resource-identity'
import { ensureWorkspaceOwnership } from '../../src/lib/workspace/ownership'

async function prepareOutlineCopilot(
  ...args: Parameters<typeof prepareOutlineCopilotRaw>
): ReturnType<typeof prepareOutlineCopilotRaw> {
  await ensureWorkspaceOwnership(args[0].projectId)
  await backfillResourceUidsV1(args[0].projectId)
  return prepareOutlineCopilotRaw(...args)
}

async function addProject(enableMultiWorld = false): Promise<Project> {
  const now = Date.now()
  const project: Project = {
    name: '潮汐纪元',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    enableMultiWorld,
    createdAt: now,
    updatedAt: now,
  }
  const id = await db.projects.add(project) as number
  return { ...project, id }
}

async function addVolume(
  projectId: number,
  title = '第一卷：退潮',
  worldGroupId: number | null = null,
): Promise<number> {
  const now = Date.now()
  return await db.outlineNodes.add({
    projectId,
    parentId: null,
    type: 'volume',
    title,
    summary: '守灯人发现退潮后的浮空城。',
    order: 0,
    worldGroupId,
    createdAt: now,
    updatedAt: now,
  }) as number
}

async function makeNodeInput(input: {
  project: Project
  mode: OutlineCopilotMode
  parentVolumeId: number | null
  snapshot: OutlineCopilotSnapshot
  worldGroupId?: number | null
}): Promise<OutlineCopilotInput> {
  const nodes = await db.outlineNodes.where('projectId').equals(input.project.id!).toArray()
  const volumes = nodes
    .filter(node => node.type === 'volume' && node.parentId === null)
    .sort((left, right) => left.order - right.order)
  const config = useAIConfigStore.getState().config
  const worldGroupId = input.worldGroupId ?? null
  const assembled = await assembleContext({
    projectId: input.project.id!,
    worldGroupId,
    outlineNodeId: input.parentVolumeId,
    provider: config.provider,
    model: config.model,
    sourceKeys: [...OUTLINE_COPILOT_SOURCE_KEYS],
  })
  return {
    project: input.project,
    worldGroupId,
    authorRequest: input.mode === 'volumes' ? '规划三卷主线大纲' : '把这一卷展开为章节大纲',
    supplementalContext: '',
    inputGuidance: '',
    mode: input.mode,
    parentVolumeId: input.parentVolumeId,
    nodes,
    volumes,
    assembled,
    narrativeBrief: buildNarrativeBriefV1({
      authorRequest: input.mode === 'volumes' ? '规划三卷主线大纲' : '把这一卷展开为章节大纲',
      assembled,
    }),
    snapshot: input.snapshot,
    config,
  }
}

describe('AGENT-1 27.1-d · ChatCopilot 大纲闭环', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('没有卷时选择卷纲模式，只经正式上下文源装配且不写大纲', async () => {
    const project = await addProject()
    const now = Date.now()
    await db.worldviews.add({
      projectId: project.id!,
      worldGroupId: null,
      worldOrigin: '盐海每十年退潮一次，海床会升起一座浮空城。',
      createdAt: now,
      updatedAt: now,
    } as never)

    const prepared = await prepareOutlineCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '规划全书三卷大纲',
    })
    const prompt = prepared.prepared.messages.map(message => message.content).join('\n')

    expect(prepared.mode).toBe('volumes')
    expect(prepared.parentVolumeId).toBeNull()
    expect(prepared.contextSources).toEqual(['ragSelection'])
    expect(prepared.contextEvidence.inputStateSourceKeys).toContain('worldview')
    expect(prepared.contextEvidence.inputState).toMatchObject({
      state: 'partial',
      handling: 'reference-and-create',
    })
    expect(prompt).toContain('partial / reference-and-create')
    expect(prompt).toContain('盐海每十年退潮')
    expect(prompt).toContain('规划全书三卷大纲')
    expect(prompt).toContain('本轮叙事任务（运行时合同，不是新增 Canon）')
    expect(prompt).toContain('退出变化')
    expect(prepared.input.narrativeBrief.creativeFreedom.length).toBeGreaterThan(0)
    expect(await db.outlineNodes.count()).toBe(0)
  })

  it('明确章纲 Skill 缺少上游卷纲时直接阻断，不悄悄改成卷纲任务', async () => {
    const project = await addProject()
    await expect(prepareOutlineCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '把第一卷展开为章节大纲',
      skillId: 'outline.chapters',
    })).rejects.toThrow('没有可展开的卷纲')
    expect(await db.outlineNodes.count()).toBe(0)
  })

  it('卷纲候选生成后保持零写入，作者确认眼前 JSON 后一次性写入且不二次调用模型', async () => {
    const project = await addProject()
    const prepared = await prepareOutlineCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '规划全书卷纲',
    })
    const nodeInput = await makeNodeInput({
      project,
      mode: 'volumes',
      parentVolumeId: null,
      snapshot: prepared.snapshot,
    })
    const runAI = vi.fn(async () => JSON.stringify([
      { title: '第一卷：退潮', summary: '守灯人发现浮空城，并决定追查潮汐钟。' },
      { title: '第二卷：涨潮', summary: '旧港被海潮包围，主角必须公开钟声的代价。' },
    ]))
    const node = createOutlineCopilotNode(nodeInput, { runAI })
    const generated = await runGenerationNode(node, prepareGenerationNode(node, nodeInput))

    expect(generated.gate?.status).toBe('pass')
    expect(await db.outlineNodes.count()).toBe(0)

    const edited = generated.output.map((item, index) => (
      index === 0 ? { ...item, summary: '作者修订后的第一卷核心冲突。' } : item
    ))
    const adopted = await adoptGenerationNodeOutput(node, edited)

    expect(adopted.adopted).toBe(true)
    expect(runAI).toHaveBeenCalledOnce()
    expect(await db.outlineNodes.toArray()).toMatchObject([
      { parentId: null, type: 'volume', title: '第一卷：退潮', summary: '作者修订后的第一卷核心冲突。' },
      { parentId: null, type: 'volume', title: '第二卷：涨潮' },
    ])
  })

  it('平衡模式只用一次定向修复恢复大纲 JSON，修复提示不重复发送完整世界上下文', async () => {
    const project = await addProject()
    const now = Date.now()
    await db.worldviews.add({
      projectId: project.id!,
      worldGroupId: null,
      worldOrigin: '盐海每十年退潮一次，海床会升起一座浮空城。',
      createdAt: now,
      updatedAt: now,
    } as never)
    const runAI = vi.fn()
      .mockResolvedValueOnce('这里是大纲：第一卷退潮')
      .mockResolvedValueOnce(JSON.stringify([
        { title: '第一卷：退潮', summary: '守灯人进入浮空城并被迫选择是否追查潮汐钟。' },
      ]))
    const prepared = await prepareOutlineCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '规划全书卷纲',
    }, { runAI })

    const result = await runOutlineCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'balanced',
    })

    expect(runAI).toHaveBeenCalledTimes(2)
    expect(result.output).toEqual([
      { title: '第一卷：退潮', summary: '守灯人进入浮空城并被迫选择是否追查潮汐钟。' },
    ])
    expect(result.artifact).toMatchObject({
      status: 'ready',
      repair: { callIndex: 2, result: 'repaired' },
      callEvidence: [
        { callIndex: 1, purpose: 'generate' },
        { callIndex: 2, purpose: 'repair' },
      ],
    })
    const repairPrompt = runAI.mock.calls[1][0]
      .map((message: { content: string }) => message.content)
      .join('\n')
    expect(repairPrompt).toContain('outline-response-invalid')
    expect(repairPrompt).not.toContain('盐海每十年退潮一次')
  })

  it('经济模式大纲失败保留可编辑原文且不做隐藏重试', async () => {
    const project = await addProject()
    const raw = '第一卷应该从退潮开始，但这里还不是 JSON。'
    const runAI = vi.fn(async () => raw)
    const prepared = await prepareOutlineCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '规划全书卷纲',
    }, { runAI })

    const result = await runOutlineCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'economy',
    })

    expect(runAI).toHaveBeenCalledOnce()
    expect(result.draft).toBe(raw)
    expect(result.artifact.status).toBe('manual-repair')
    expect(result.artifact.repair).toBeNull()

    const revalidated = revalidateOutlineCreativeDraftV1({
      draft: JSON.stringify([{
        title: '第一卷：退潮',
        summary: '守灯人进入浮空城，并决定追查潮汐钟。',
      }], null, 2),
      snapshot: prepared.snapshot,
      previousArtifact: result.artifact,
    })
    expect(revalidated.status).toBe('ready')
    expect(revalidated.callEvidence).toEqual(result.artifact.callEvidence)
    expect(runAI).toHaveBeenCalledOnce()
  })

  it('已有卷时默认生成目标卷章节，并把章节写入正确父级与世界作用域', async () => {
    const project = await addProject(true)
    const now = Date.now()
    const worldId = await db.worldGroups.add({
      projectId: project.id!,
      name: '盐海界',
      type: 'primary',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }) as number
    const volumeId = await addVolume(project.id!, '第一卷：退潮', worldId)
    const prepared = await prepareOutlineCopilot({
      projectId: project.id!,
      worldGroupId: worldId,
      authorRequest: '把第一卷：退潮展开成两章章纲',
    })
    const nodeInput = await makeNodeInput({
      project,
      mode: 'chapters',
      parentVolumeId: volumeId,
      snapshot: prepared.snapshot,
      worldGroupId: worldId,
    })
    const node = createOutlineCopilotNode(nodeInput, {
      runAI: async () => JSON.stringify([
        { title: '第一章：海床之光', summary: '退潮后，主角看见海床浮起的灯塔。' },
        { title: '第二章：无声之钟', summary: '灯塔中的潮汐钟拒绝为主角鸣响。' },
      ]),
    })
    const generated = await runGenerationNode(node, prepareGenerationNode(node, nodeInput))
    await adoptGenerationNodeOutput(node, generated.output)

    expect(prepared.mode).toBe('chapters')
    expect(prepared.label).toContain('第一卷：退潮')
    const chapters = (await db.outlineNodes.toArray()).filter(row => row.type === 'chapter')
    expect(chapters).toHaveLength(2)
    expect(chapters.every(row => row.parentId === volumeId && row.worldGroupId === worldId)).toBe(true)
  })

  it('未知字段、空摘要、候选内重复和当前层级同名均在写入前阻断', async () => {
    expect(() => parseOutlineCandidateDraft(JSON.stringify([
      { title: '第一卷', summary: '摘要', projectId: 999 },
    ]))).toThrow('不允许的字段')
    expect(() => parseOutlineCandidateDraft(JSON.stringify([
      { title: '第一卷', summary: '' },
    ]))).toThrow('summary')
    expect(() => parseOutlineCandidateDraft(JSON.stringify([
      { title: '第一卷', summary: '一' },
      { title: '第一卷', summary: '二' },
    ]))).toThrow('重复标题')

    const project = await addProject()
    await addVolume(project.id!)
    const prepared = await prepareOutlineCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '新增一卷卷纲',
    })
    const nodeInput = await makeNodeInput({
      project,
      mode: 'volumes',
      parentVolumeId: null,
      snapshot: prepared.snapshot,
    })
    const node = createOutlineCopilotNode(nodeInput)
    const result = await adoptGenerationNodeOutput(node, [
      { title: '第一卷：退潮', summary: '重复卷纲。' },
    ])
    expect(result.adopted).toBe(false)
    expect(result.gate?.issues.map(issue => issue.code)).toContain('outline-duplicate-title')
    expect(await db.outlineNodes.count()).toBe(1)
  })

  it('候选生成后大纲发生变化会阻止旧候选写入', async () => {
    const project = await addProject()
    const prepared = await prepareOutlineCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '规划卷纲',
    })
    const nodeInput = await makeNodeInput({
      project,
      mode: 'volumes',
      parentVolumeId: null,
      snapshot: prepared.snapshot,
    })
    const saveItems = vi.fn()
    const node = createOutlineCopilotNode(nodeInput, {
      readCurrent: async () => ({ ...prepared.snapshot, serialized: '[changed]' }),
      saveItems,
    })
    await expect(adoptGenerationNodeOutput(node, [
      { title: '第一卷：退潮', summary: '摘要。' },
    ])).rejects.toBeInstanceOf(OutlineCopilotStaleError)
    expect(saveItems).not.toHaveBeenCalled()
    expect(await db.outlineNodes.count()).toBe(0)
  })

  it('刷新后仍可用持久化快照确认候选，不依赖内存运行节点', async () => {
    const project = await addProject()
    const prepared = await prepareOutlineCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '规划卷纲',
    })
    const scope = await resolveScopeLike(project.id!)
    const conversation = await getOrCreateAgentConversation({
      projectId: project.id!,
      worldGroupId: null,
      scope,
    })
    const event = await appendAgentEvent({
      projectId: project.id!,
      conversationId: conversation.id!,
      kind: 'candidate',
      content: '',
      payload: {},
      scope,
    })
    const draft = JSON.stringify([
      { title: '第一卷：退潮', summary: '主角发现浮空城。' },
    ])

    const message = await adoptMasterCandidate({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      event,
      payload: {
        version: 1,
        taskId: 'outline-1',
        agentId: 'outline',
        label: prepared.label,
        contextSources: prepared.contextSources,
        baseSnapshot: prepared.snapshot,
        outlineMode: 'volumes',
        outlineParentId: null,
      },
      draft,
    })

    expect(message).toBe('卷级大纲已写入项目。')
    expect(await db.outlineNodes.count()).toBe(1)
  })
})
