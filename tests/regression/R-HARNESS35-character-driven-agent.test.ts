import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMasterAgentPlan,
  type PinnedMasterAgentTaskV1,
} from '../../src/lib/agent/orchestrator'
import {
  adoptRestoredCharacterDrivenCandidateV1,
  parseCharacterDrivenCandidateDraftV1,
  prepareCharacterDrivenCopilotV1,
} from '../../src/lib/agent/character-driven-copilot'
import {
  parseMasterAgentPlanV1,
  runDurableMasterAgentPlanV1,
} from '../../src/lib/agent/run/master-durable'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import { createMasterCandidateStepReceiptV1 } from '../../src/lib/agent/run/master-step-verification'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { AGENT_SKILLS } from '../../src/lib/agent/skill-registry'
import { ADOPTION_BY_TARGET } from '../../src/lib/registry/adoption-schema'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { db } from '../../src/lib/db/schema'
import { parseCharacterDrivenPlotVolumes } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import type { WorkspaceScope } from '../../src/lib/types'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'

const generated = [{
  volumeTitle: '第一卷 归途',
  volumeSummary: '林舟追查旧案，并推动既有主线进入第一次正面冲突。',
  characterArcs: '林舟从逃避转向承认自己仍在意故乡。',
  chapters: [{
    title: '第一章 城门',
    summary: '林舟从故人口中得知旧案的新证据，决定暂不离开。',
    keyCharacters: ['林舟'],
    arcProgress: '故人的告知触发林舟第一次主动调查，并推进本卷主线。',
  }],
}]

async function seedWorkspace() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '归途项目',
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
    code: 'harness35-world',
    name: '归途世界',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: '归途作品',
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
    logline: '离乡者回到故乡追查旧案。',
    mainPlot: '林舟必须揭开旧案并决定是否守护故乡。',
    subPlots: '故人与家族各自隐瞒证据。',
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
  const selectedPlanId = await db.characterDrivenPlans.add({
    projectId,
    workId,
    name: '归乡弧光',
    arcs: JSON.stringify([{
      characterId,
      name: '林舟旧名',
      role: '主角',
      initialState: '逃避故乡与旧案',
      targetState: '主动承担守护故乡的责任',
    }]),
    userHint: '必须服务既有主线',
    generatedVolumes: JSON.stringify([{
      volumeTitle: '旧候选秘密',
      volumeSummary: '旧结果不应进入重新生成上下文',
      characterArcs: '旧结果',
      chapters: [],
    }]),
    status: 'generated',
    version: 1,
    parentPlanId: null,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const activeOtherPlanId = await db.characterDrivenPlans.add({
    projectId,
    workId,
    name: '另一个激活方案',
    arcs: JSON.stringify([{
      characterId,
      name: '林舟',
      role: '主角',
      initialState: '绝不能进入本轮的起点',
      targetState: '绝不能进入本轮的终点',
    }]),
    userHint: '另一个方案秘密',
    generatedVolumes: '[]',
    status: 'draft',
    version: 1,
    parentPlanId: null,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  await db.works.update(workId, { activeCharacterDrivenPlanId: activeOtherPlanId })
  await db.projects.update(projectId, { activeCharacterDrivenPlanId: activeOtherPlanId })
  return { projectId, scope, selectedPlanId, activeOtherPlanId }
}

describe('R-HARNESS35 · 角色驱动规划主入口契约', () => {
  const originalConfig = useAIConfigStore.getState().config

  beforeEach(async () => {
    await db.delete()
    await db.open()
    useAIConfigStore.setState({
      config: {
        ...originalConfig,
        provider: 'custom',
        apiKey: '',
        model: 'harness35-test',
        baseUrl: 'https://harness35.invalid/v1',
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

  it('固定入口跳过规划模型，并把方案 ID 冻结进 durable 计划', async () => {
    const pinnedTask: PinnedMasterAgentTaskV1 = {
      agentId: 'outline',
      skillId: 'outline.character-driven',
      instruction: '编排角色弧光卷章方案',
      characterDrivenPlanId: 42,
    }
    const plan = await createMasterAgentPlan({
      projectId: 1,
      worldGroupId: null,
      request: pinnedTask.instruction,
      pinnedTask,
    })
    expect(plan.tasks).toEqual([expect.objectContaining({
      agentId: 'outline',
      skillId: 'outline.character-driven',
      characterDrivenPlanId: 42,
    })])
    expect(parseMasterAgentPlanV1(plan).tasks[0].characterDrivenPlanId).toBe(42)

    await expect(createMasterAgentPlan({
      projectId: 1,
      worldGroupId: null,
      request: '错误固定方案',
      pinnedTask: {
        agentId: 'character',
        skillId: 'character.create',
        instruction: '错误固定方案',
        characterDrivenPlanId: 42,
      },
    })).rejects.toThrow('只有角色驱动大纲 Skill')
  })

  it('严格候选合同拒绝额外字段、重复标题和空弧光推进', () => {
    expect(parseCharacterDrivenCandidateDraftV1(JSON.stringify(generated))).toEqual(generated)
    expect(() => parseCharacterDrivenCandidateDraftV1(JSON.stringify([{
      ...generated[0],
      extra: true,
    }]))).toThrow('不允许的字段')
    expect(() => parseCharacterDrivenCandidateDraftV1(JSON.stringify([{
      ...generated[0],
      chapters: [generated[0].chapters[0], generated[0].chapters[0]],
    }]))).toThrow('重复章节标题')
    expect(() => parseCharacterDrivenCandidateDraftV1(JSON.stringify([{
      ...generated[0],
      chapters: [{ ...generated[0].chapters[0], arcProgress: '' }],
    }]))).toThrow('arcProgress 必须是非空字符串')
  })

  it('durable 执行只读固定方案输入，确认前不写方案，确认后经 adopt 定点更新', async () => {
    const seeded = await seedWorkspace()
    const conversation = await getOrCreateAgentConversation({
      projectId: seeded.projectId,
      worldGroupId: null,
      scope: seeded.scope,
    })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> }
      const prompt = body.messages?.map(message => message.content ?? '').join('\n') ?? ''
      expect(prompt).toContain('逃避故乡与旧案')
      expect(prompt).toContain('主动承担守护故乡的责任')
      expect(prompt).toContain('林舟必须揭开旧案')
      expect(prompt).not.toContain('旧候选秘密')
      expect(prompt).not.toContain('另一个方案秘密')
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(generated) } }],
        usage: { prompt_tokens: 180, completion_tokens: 90, total_tokens: 270 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runDurableMasterAgentPlanV1({
      scope: seeded.scope,
      worldGroupId: null,
      conversationId: conversation.id,
      plan: {
        summary: '角色驱动卷章编排',
        tasks: [{
          id: 'character-driven-targeted',
          agentId: 'outline',
          skillId: 'outline.character-driven',
          instruction: '编排角色弧光卷章方案',
          dependsOn: [],
          characterDrivenPlanId: seeded.selectedPlanId,
        }],
      },
      budget: new AgentTeamBudgetTracker('balanced'),
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(result.candidates[0].payload).toMatchObject({
      skillId: 'outline.character-driven',
      characterDrivenPlanId: seeded.selectedPlanId,
    })
    expect(result.candidates[0].payload.contextSources).toContain('characterDrivenPlan')
    expect(parseCharacterDrivenPlotVolumes(
      (await db.characterDrivenPlans.get(seeded.selectedPlanId))?.generatedVolumes,
    )[0].volumeTitle).toBe('旧候选秘密')

    await commitMasterAgentCandidateAdoptionV1({
      scope: seeded.scope,
      runId: result.runId,
      candidateEventId: result.candidates[0].event.id!,
      runtime: result.candidates[0].runtime,
    })
    const selected = await db.characterDrivenPlans.get(seeded.selectedPlanId)
    const other = await db.characterDrivenPlans.get(seeded.activeOtherPlanId)
    expect(selected?.status).toBe('generated')
    expect(parseCharacterDrivenPlotVolumes(selected?.generatedVolumes)).toEqual(generated)
    expect(other?.userHint).toBe('另一个方案秘密')
  })

  it('作者在候选后修改方案输入时拒绝恢复采纳', async () => {
    const seeded = await seedWorkspace()
    const prepared = await prepareCharacterDrivenCopilotV1({
      projectId: seeded.projectId,
      scope: seeded.scope,
      worldGroupId: null,
      planId: seeded.selectedPlanId,
      authorRequest: '编排角色弧光卷章方案',
      configOverride: useAIConfigStore.getState().config,
    })
    await db.characterDrivenPlans.update(seeded.selectedPlanId, {
      userHint: '作者已经改成新的要求',
      updatedAt: Date.now() + 1,
    })
    await expect(adoptRestoredCharacterDrivenCandidateV1({
      projectId: seeded.projectId,
      scope: seeded.scope,
      planId: seeded.selectedPlanId,
      snapshot: prepared.snapshot,
      draft: JSON.stringify(generated),
    })).rejects.toThrow('方案已在候选生成后发生变化')
  })

  it('Skill 写权限同时受字段注册表和 recordOnly 采纳策略约束', () => {
    const skill = AGENT_SKILLS.find(item => item.id === 'outline.character-driven')
    expect(skill?.writeTargets).toEqual([{
      table: 'characterDrivenPlans',
      fields: ['generatedVolumes', 'status'],
    }])
    expect((FIELD_BY_TARGET.get('characterDrivenPlans') ?? []).map(field => field.field))
      .toEqual(expect.arrayContaining(['generatedVolumes', 'status']))
    expect(ADOPTION_BY_TARGET.get('characterDrivenPlans')).toMatchObject({
      recordOnly: true,
      ownerFrom: 'work',
    })
  })

  it('合法候选可生成 durable 步骤回执，供后续多任务 join 核验', async () => {
    const draft = JSON.stringify(generated)
    const candidateHash = await hashCanonicalValue({ draft, planId: 42 })
    const receipt = await createMasterCandidateStepReceiptV1({
      payload: {
        version: 1,
        taskId: 'character-driven-targeted',
        agentId: 'outline',
        skillId: 'outline.character-driven',
        label: '角色驱动卷章方案',
        contextSources: ['characterDrivenPlan'],
        baseSnapshot: {},
        characterDrivenPlanId: 42,
        runId: 1,
        runStepId: 'master:character-driven-targeted',
        candidateHash,
      },
      draft,
      attempt: 1,
      contextManifestHash: await hashCanonicalValue({ source: 'characterDrivenPlan' }),
      acceptedAt: Date.now(),
    })
    expect(receipt.stepId).toBe('master:character-driven-targeted')
    expect(receipt.criteria).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'character-driven-targeted.output-contract',
        status: 'passed',
      }),
    ]))
  })
})
