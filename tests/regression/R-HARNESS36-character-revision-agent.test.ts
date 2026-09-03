import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMasterAgentPlan,
  type PinnedMasterAgentTaskV1,
} from '../../src/lib/agent/orchestrator'
import {
  adoptRestoredCharacterRevisionCandidateV1,
  characterRevisionCandidateMatchesBusinessStateV1,
  decideCharacterRevisionCandidateV1,
  parseCharacterRevisionCandidateDraftV1,
  prepareCharacterRevisionCopilotV1,
  repairPartialCharacterRevisionAdoptionV1,
  serializeCharacterRevisionCandidateV1,
  type CharacterRevisionCandidateV1,
  type CharacterRevisionTaskInputV1,
} from '../../src/lib/agent/character-revision-copilot'
import {
  parseMasterAgentPlanV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { getOrCreateAgentConversation, updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { AGENT_SKILLS } from '../../src/lib/agent/skill-registry'
import { ADOPTION_BY_TARGET } from '../../src/lib/registry/adoption-schema'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import type { WorkspaceScope } from '../../src/lib/types'

const now = 1_900_000_000_000

function request(planId: number | null, characterId: number): CharacterRevisionTaskInputV1 {
  return {
    planId,
    changeType: 'revise-arc',
    characterId,
    characterName: '旧名字会由正式角色卡纠正',
    changeDescription: '让林舟从逃避旧案改为主动追查，但不得改写第一章已经发生的承诺。',
    protectedThroughOrdinal: 1,
    transitionChapterCount: 1,
    strategy: 'balanced',
    anchorNodeIds: [],
    extraRequirements: '保留终局会师，不自动修改正文或主线。',
  }
}

function modelPlan(nodeIds: number[]) {
  return {
    changeSummary: '林舟在已写承诺之后转为主动追查旧案。',
    scopeSummary: '第一章只读保护，第二章过渡，第三章允许重排。',
    affectedWrittenChapters: [{
      ordinal: 1,
      title: '旧城门',
      severity: 'medium',
      reason: '承诺已经写入正文，后续动机不能否定它。',
      evidenceQuotes: ['林舟在旧城门前立下承诺'],
      recommendation: 'protect',
    }],
    immutableFacts: [{
      statement: '林舟已经立下守城承诺。',
      sourceChapterOrdinal: 1,
      evidenceQuote: '林舟在旧城门前立下承诺',
    }],
    conflicts: [],
    foreshadowSuggestions: [{
      chapterOrdinal: 2,
      title: '旧案回声',
      suggestion: '通过故人告知释放旧案新证据。',
    }],
    mainPlotSuggestion: '主线目标不变，只调整林舟进入调查线的方式。',
    options: [
      {
        id: 'light',
        intensity: 'light',
        label: '轻量融入',
        summary: '只调整第二章摘要。',
        risks: ['角色转变较慢'],
        patches: [{
          outlineNodeId: nodeIds[1],
          proposedTitle: '旧案回声',
          proposedSummary: '故人告知旧案出现新证据，林舟决定继续追查。',
          reason: '在保护区后自然切入。',
        }],
      },
      {
        id: 'balanced',
        intensity: 'balanced',
        label: '中度改线',
        summary: '调整第二、三章的调查推进。',
        risks: ['需要复核终局衔接'],
        patches: [
          {
            outlineNodeId: nodeIds[1],
            proposedTitle: '旧案回声',
            proposedSummary: '故人告知旧案出现新证据，林舟决定继续追查。',
            reason: '在保护区后自然切入。',
          },
          {
            outlineNodeId: nodeIds[2],
            proposedTitle: '终局会师',
            proposedSummary: '林舟带着旧案证据与盟友会师，准备正面对抗。',
            reason: '保留终局锚点并承接调查线。',
          },
        ],
      },
      {
        id: 'deep',
        intensity: 'deep',
        label: '深度重构',
        summary: '重排全部未写调查线。',
        risks: ['改动范围较大'],
        patches: [{
          outlineNodeId: nodeIds[2],
          proposedTitle: '终局会师',
          proposedSummary: '林舟整合证据与盟友，在终局前完成会师。',
          reason: '把角色弧光集中到终局。',
        }],
      },
    ],
    warnings: [],
  }
}

async function seedWorkspace() {
  const projectId = await db.projects.add({
    name: '中途重规划作品',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    enableMultiWorld: false,


    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'harness36-world',
    name: '旧城世界',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '旧城作品',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const scope: WorkspaceScope = { projectId, worldId, workId }
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
  })
  await db.storyCores.add({
    projectId,
    workId,
    mainPlot: '林舟必须守住旧城并查清旧案。',
    createdAt: now,
    updatedAt: now,
  } as any)
  const characterId = await db.characters.add({
    projectId,
    worldId,
    name: '林舟',
    role: 'protagonist',
    roleWeight: 'main',
    moralAxis: 'good',
    orderAxis: 'neutral',
    relationships: '[]',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const volumeId = await db.outlineNodes.add({
    projectId,
    workId,
    parentId: null,
    type: 'volume',
    title: '第一卷',
    summary: '守城与旧案主线。',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const titles = ['旧城门', '旧案浮现', '终局会师']
  const nodeIds: number[] = []
  for (const [index, title] of titles.entries()) {
    nodeIds.push(await db.outlineNodes.add({
      projectId,
      workId,
      parentId: volumeId,
      type: 'chapter',
      title,
      summary: `原摘要${index + 1}`,
      order: index,
      createdAt: now,
      updatedAt: now + index,
    } as any) as number)
  }
  await db.chapters.add({
    projectId,
    workId,
    outlineNodeId: nodeIds[0],
    title: titles[0],
    content: '<p>林舟在旧城门前立下承诺，绝不让敌人入城。</p>',
    wordCount: 22,
    status: 'draft',
    order: 0,
    notes: '',
    summary: '林舟已立下守城承诺。',
    createdAt: now,
    updatedAt: now,
  } as any)
  await db.chapters.add({
    projectId,
    workId,
    outlineNodeId: nodeIds[1],
    title: titles[1],
    content: '',
    wordCount: 0,
    status: 'outline',
    order: 1,
    notes: '',
    createdAt: now,
    updatedAt: now,
  } as any)
  const planId = await db.characterDrivenPlans.add({
    projectId,
    workId,
    name: '林舟调查线',
    arcs: JSON.stringify([{
      characterId,
      name: '林舟',
      role: '主角',
      initialState: '逃避旧案',
      targetState: '主动承担调查责任',
    }]),
    userHint: '必须服务守城主线',
    generatedVolumes: '[]',
    status: 'draft',
    version: 1,
    parentPlanId: null,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  return { projectId, worldId, workId, scope, characterId, planId, nodeIds }
}

describe('R-HARNESS36 · 角色中途重规划 Agent/Harness 主路径', () => {
  const originalConfig = useAIConfigStore.getState().config

  beforeEach(async () => {
    await db.delete()
    await db.open()
    useAIConfigStore.setState({
      config: {
        ...originalConfig,
        provider: 'custom',
        apiKey: '',
        model: 'harness36-test',
        baseUrl: 'https://harness36.invalid/v1',
        maxTokens: 12_000,
        contextWindow: 64_000,
      },
      presets: [],
      taskRoutes: {},
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useAIConfigStore.setState({ config: originalConfig, presets: [], taskRoutes: {} })
    db.close()
  })

  it('固定入口跳过规划模型，并把保护区、锚点与方案冻结进 durable 计划', async () => {
    const revisionRequest = request(42, 7)
    const pinnedTask: PinnedMasterAgentTaskV1 = {
      agentId: 'outline',
      skillId: 'outline.character-revision',
      instruction: '分析角色变更并重规划未来大纲',
      characterRevisionRequest: revisionRequest,
    }
    const plan = await createMasterAgentPlan({
      projectId: 1,
      worldGroupId: null,
      request: pinnedTask.instruction,
      pinnedTask,
    })
    expect(parseMasterAgentPlanV1(plan).tasks[0]).toMatchObject({
      skillId: 'outline.character-revision',
      characterRevisionRequest: revisionRequest,
    })
    await expect(createMasterAgentPlan({
      projectId: 1,
      worldGroupId: null,
      request: '错误固定请求',
      pinnedTask: {
        agentId: 'character',
        skillId: 'character.create',
        instruction: '错误固定请求',
        characterRevisionRequest: revisionRequest,
      },
    })).rejects.toThrow('只有角色中途重规划 Skill')
  })

  it('严格候选合同拒绝额外字段、缺失三档和越权作者选择', async () => {
    const seeded = await seedWorkspace()
    const prepared = await prepareCharacterRevisionCopilotV1({
      projectId: seeded.projectId,
      scope: seeded.scope,
      worldGroupId: null,
      request: request(seeded.planId, seeded.characterId),
      authorRequest: '分析角色变更并生成三档方案',
      configOverride: useAIConfigStore.getState().config,
    })
    const candidate: CharacterRevisionCandidateV1 = {
      version: 1,
      plan: modelPlan(seeded.nodeIds) as any,
      decision: null,
    }
    const parsed = parseCharacterRevisionCandidateDraftV1(
      serializeCharacterRevisionCandidateV1(candidate),
      prepared.snapshot,
    )
    expect(parsed.plan.options.map(option => option.intensity)).toEqual(['light', 'balanced', 'deep'])
    expect(() => parseCharacterRevisionCandidateDraftV1(JSON.stringify({
      ...candidate,
      extra: true,
    }), prepared.snapshot)).toThrow('不允许的字段')
    expect(() => parseCharacterRevisionCandidateDraftV1(JSON.stringify({
      ...candidate,
      plan: { ...candidate.plan, options: candidate.plan.options.slice(0, 2) },
    }), prepared.snapshot)).toThrow('必须包含 light、balanced、deep')
    expect(() => parseCharacterRevisionCandidateDraftV1(JSON.stringify({
      ...candidate,
      decision: { optionId: 'light', outlineNodeIds: [seeded.nodeIds[2]] },
    }), prepared.snapshot)).toThrow('当前方案之外')
  })

  it('durable 执行确认前零写入，作者选择后只改未来大纲并签发终态回执', async () => {
    const seeded = await seedWorkspace()
    const conversation = await getOrCreateAgentConversation({
      projectId: seeded.projectId,
      worldGroupId: null,
      scope: seeded.scope,
    })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> }
      const prompt = body.messages?.map(message => message.content ?? '').join('\n') ?? ''
      expect(prompt).toContain('硬保护区：第 1-1 章')
      expect(prompt).toContain('林舟必须守住旧城')
      expect(prompt).toContain('逃避旧案')
      expect(prompt).toContain(`[node:${seeded.nodeIds[2]}]`)
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(modelPlan(seeded.nodeIds)) } }],
        usage: { prompt_tokens: 300, completion_tokens: 180, total_tokens: 480 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const revisionRequest = request(seeded.planId, seeded.characterId)
    const result = await runDurableMasterAgentPlanV1({
      scope: seeded.scope,
      worldGroupId: null,
      conversationId: conversation.id,
      plan: {
        summary: '角色中途重规划',
        tasks: [{
          id: 'character-revision-targeted',
          agentId: 'outline',
          skillId: 'outline.character-revision',
          instruction: '分析角色变更并生成三档方案',
          dependsOn: [],
          characterRevisionRequest: revisionRequest,
        }],
      },
      budget: new AgentTeamBudgetTracker('balanced'),
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(result.candidates[0].payload.contextSources).toEqual(expect.arrayContaining([
      'manualText',
      'storyCore',
      'existingVolumeOutlines',
    ]))
    expect((await db.outlineNodes.get(seeded.nodeIds[1]))?.title).toBe('旧案浮现')

    const base = result.candidates[0].payload.baseSnapshot as any
    const candidate = parseCharacterRevisionCandidateDraftV1(result.candidates[0].draft, base)
    const decided = decideCharacterRevisionCandidateV1(
      candidate,
      'balanced',
      [seeded.nodeIds[1], seeded.nodeIds[2]],
    )
    const decidedDraft = serializeCharacterRevisionCandidateV1(decided)
    await updateAgentEventCandidate(
      result.candidates[0].event.id!,
      seeded.projectId,
      decidedDraft,
      seeded.scope,
    )
    await commitMasterAgentCandidateAdoptionV1({
      scope: seeded.scope,
      runId: result.runId,
      candidateEventId: result.candidates[0].event.id!,
      runtime: result.candidates[0].runtime,
    })
    expect(await db.outlineNodes.get(seeded.nodeIds[0])).toMatchObject({
      title: '旧城门',
      summary: '原摘要1',
    })
    expect(await db.outlineNodes.get(seeded.nodeIds[1])).toMatchObject({
      title: '旧案回声',
      summary: '故人告知旧案出现新证据，林舟决定继续追查。',
    })
    expect((await db.chapters.where('outlineNodeId').equals(seeded.nodeIds[0]).first())?.content)
      .toContain('旧城门前立下承诺')
    expect((await db.chapters.where('outlineNodeId').equals(seeded.nodeIds[1]).first())?.title)
      .toBe('旧案回声')
    const verification = await verifyMasterAgentRunV1({ scope: seeded.scope, runId: result.runId })
    expect(verification.accepted).toBe(true)
  })

  it('正式基线变化拒绝普通采纳，部分中断恢复只补齐候选明确选择的剩余 patch', async () => {
    const seeded = await seedWorkspace()
    const prepared = await prepareCharacterRevisionCopilotV1({
      projectId: seeded.projectId,
      scope: seeded.scope,
      worldGroupId: null,
      request: request(seeded.planId, seeded.characterId),
      authorRequest: '分析角色变更并生成三档方案',
      configOverride: useAIConfigStore.getState().config,
    })
    const candidate = decideCharacterRevisionCandidateV1({
      version: 1,
      plan: parseCharacterRevisionCandidateDraftV1(JSON.stringify({
        version: 1,
        plan: modelPlan(seeded.nodeIds),
        decision: null,
      }), prepared.snapshot).plan,
      decision: null,
    }, 'balanced', [seeded.nodeIds[1], seeded.nodeIds[2]])
    const draft = serializeCharacterRevisionCandidateV1(candidate)
    await db.outlineNodes.update(seeded.nodeIds[1], { summary: '作者生成后手工修改' })
    await expect(adoptRestoredCharacterRevisionCandidateV1({
      projectId: seeded.projectId,
      scope: seeded.scope,
      snapshot: prepared.snapshot,
      draft,
    })).rejects.toThrow('已经变化')

    await db.outlineNodes.update(seeded.nodeIds[1], {
      title: '旧案回声',
      summary: '故人告知旧案出现新证据，林舟决定继续追查。',
    })
    await repairPartialCharacterRevisionAdoptionV1({
      projectId: seeded.projectId,
      scope: seeded.scope,
      snapshot: prepared.snapshot,
      draft,
    })
    expect((await db.outlineNodes.get(seeded.nodeIds[2]))?.summary)
      .toBe('林舟带着旧案证据与盟友会师，准备正面对抗。')
    expect(await characterRevisionCandidateMatchesBusinessStateV1({
      scope: seeded.scope,
      snapshot: prepared.snapshot,
      draft,
    })).toBe(true)
  })

  it('Skill 写权限只覆盖大纲标题摘要与空正文行标题，复用既有注册表', () => {
    const skill = AGENT_SKILLS.find(item => item.id === 'outline.character-revision')
    expect(skill?.writeTargets).toEqual([
      { table: 'outlineNodes', fields: ['title', 'summary'] },
      { table: 'chapters', fields: ['title'] },
    ])
    expect((FIELD_BY_TARGET.get('outlineNodes') ?? []).map(field => field.field))
      .toEqual(expect.arrayContaining(['title', 'summary']))
    expect((FIELD_BY_TARGET.get('chapters') ?? []).map(field => field.field)).toContain('title')
    expect(ADOPTION_BY_TARGET.get('outlineNodes')).toBeDefined()
    expect(ADOPTION_BY_TARGET.get('chapters')).toBeDefined()
  })
})
