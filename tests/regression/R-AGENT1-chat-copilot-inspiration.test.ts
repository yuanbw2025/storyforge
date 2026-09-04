import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InspirationCopilotStaleError,
  createInspirationCopilotNode,
  parseInspirationCandidateDraft,
  prepareInspirationCopilot,
  type InspirationCopilotInput,
} from '../../src/lib/agent/inspiration-copilot'
import { db } from '../../src/lib/db/schema'
import {
  adoptGenerationNodeOutput,
  prepareGenerationNode,
  runGenerationNode,
} from '../../src/lib/generation/generation-node'
import { parseInspirationVersions } from '../../src/lib/inspiration/workspace'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { useInspirationWorkspaceStore } from '../../src/stores/inspiration-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { seedCurrentProject } from '../helpers/current-workspace'

const singleResult = {
  worldview: {
    worldOrigin: '旧城由一场遗忘诞生',
    powerHierarchy: '',
    continentLayout: '',
    climateByRegion: '',
    races: '',
    factionLayout: '',
  },
  history: { overview: '' },
  storyCore: {
    logline: '守塔人追查被雨抹去的名字',
    theme: '记忆',
    centralConflict: '保存与遗忘',
    plotPattern: '探索',
    mainPlot: '寻找旧城失忆的源头',
  },
  characters: [],
}

async function addProject(enableMultiWorld = false): Promise<number> {
  const now = Date.now()
  return await seedCurrentProject({
    name: enableMultiWorld ? '多世界灵感' : '灵感项目',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    enableMultiWorld,
    createdAt: now,
    updatedAt: now,
  }) as number
}

async function addWorkspace(projectId: number) {
  const now = Date.now()
  const id = await db.inspirationWorkspaces.add({
    projectId,
    fragments: JSON.stringify([
      {
        id: 'idea-selected',
        text: '旧城每次下雨都会忘记一个人',
        label: '城市规则',
        sourceKind: 'author',
        createdAt: now,
      },
      {
        id: 'idea-hidden',
        text: '本轮不应读取的秘密碎片',
        label: '隐藏',
        sourceKind: 'author',
        createdAt: now + 1,
      },
    ]),
    versions: '[]',
    createdAt: now,
    updatedAt: now,
  })
  await finalizeCurrentFixtureV1(projectId)
  return (await db.inspirationWorkspaces.get(id))!
}

function nodeInput(
  projectId: number,
  row: Awaited<ReturnType<typeof addWorkspace>>,
  patch: Partial<InspirationCopilotInput> = {},
): InspirationCopilotInput {
  return {
    projectId,
    projectName: '灵感项目',
    genres: 'fantasy',
    mode: 'single',
    authorRequest: '强化记忆与身份冲突',
    contextText: '【本次参与融合的灵感碎片】\n旧城每次下雨都会忘记一个人',
    selectedFragmentIds: ['idea-selected'],
    parentVersionId: null,
    snapshot: {
      id: row.id!,
      updatedAt: row.updatedAt,
      fragments: row.fragments,
      versions: row.versions,
    },
    config: useAIConfigStore.getState().config,
    ...patch,
  }
}

describe('AGENT-1 27.1-d · ChatCopilot 灵感反推闭环', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useInspirationWorkspaceStore.setState({
      workspace: null,
      fragments: [],
      versions: [],
      loading: false,
    })
  })

  afterEach(() => db.close())

  it('prepare 只经正式工具读取作者选择的碎片，并冻结同一项目快照', async () => {
    const projectId = await addProject()
    const row = await addWorkspace(projectId)
    const prepared = await prepareInspirationCopilot({
      projectId,
      selectedFragmentIds: ['idea-selected'],
      authorRequest: '强化记忆冲突',
    })
    const prompt = prepared.prepared.messages.map(message => message.content).join('\n')

    expect(prepared.contextSources).toEqual(['inspirationWorkspace'])
    expect(prepared.contextEvidence.inputState).toMatchObject({
      state: 'complete',
      handling: 'grounded-transform',
    })
    expect(prompt).toContain('complete / grounded-transform')
    expect(prepared.selectedFragmentIds).toEqual(['idea-selected'])
    expect(prompt).toContain('旧城每次下雨都会忘记一个人')
    expect(prompt).not.toContain('本轮不应读取的秘密碎片')
    expect((await db.inspirationWorkspaces.get(row.id!))?.versions).toBe('[]')
  })

  it('生成只产出内存候选，确认可见候选后才新增一个版本且不二次调用模型', async () => {
    const projectId = await addProject()
    const row = await addWorkspace(projectId)
    const runAI = vi.fn(async () => JSON.stringify(singleResult))
    const node = createInspirationCopilotNode(nodeInput(projectId, row), { runAI })
    const prepared = prepareGenerationNode(node, nodeInput(projectId, row))
    const generated = await runGenerationNode(node, prepared)

    expect(generated.gate?.status).toBe('pass')
    expect(runAI).toHaveBeenCalledOnce()
    expect(parseInspirationVersions((await db.inspirationWorkspaces.get(row.id!))?.versions)).toHaveLength(0)

    const edited = {
      ...generated.output,
      storyCore: { ...generated.output.storyCore, theme: '身份与记忆' },
    }
    const adopted = await adoptGenerationNodeOutput(node, edited)
    expect(adopted.adopted).toBe(true)
    expect(runAI).toHaveBeenCalledOnce()

    const versions = parseInspirationVersions((await db.inspirationWorkspaces.get(row.id!))?.versions)
    expect(versions).toHaveLength(1)
    expect(versions[0].fragmentIds).toEqual(['idea-selected'])
    expect(versions[0].resultJson).toContain('身份与记忆')
  })

  it('空壳候选在写入前被确定性 gate 阻断', async () => {
    const projectId = await addProject()
    const row = await addWorkspace(projectId)
    const node = createInspirationCopilotNode(nodeInput(projectId, row), {
      saveVersion: vi.fn(),
    })
    const empty = parseInspirationCandidateDraft(JSON.stringify({
      worldview: {},
      history: {},
      storyCore: {},
      characters: [],
    }), 'single')
    const result = await adoptGenerationNodeOutput(node, empty)

    expect(result.adopted).toBe(false)
    expect(result.gate?.issues.map(issue => issue.code)).toContain('inspiration-empty-shell')
  })

  it('候选生成后工作区变化会拒绝覆盖新版本', async () => {
    const projectId = await addProject()
    const row = await addWorkspace(projectId)
    const saveVersion = vi.fn()
    const node = createInspirationCopilotNode(nodeInput(projectId, row), {
      readCurrent: async () => ({
        id: row.id!,
        updatedAt: row.updatedAt + 1,
        fragments: row.fragments,
        versions: row.versions,
      }),
      saveVersion,
    })

    await expect(adoptGenerationNodeOutput(node, singleResult))
      .rejects.toBeInstanceOf(InspirationCopilotStaleError)
    expect(saveVersion).not.toHaveBeenCalled()
  })

  it('多世界模式要求至少一个有内容的世界', async () => {
    const projectId = await addProject(true)
    const row = await addWorkspace(projectId)
    const node = createInspirationCopilotNode(nodeInput(projectId, row, {
      mode: 'multiworld',
    }), { saveVersion: vi.fn() })
    const emptyWorld = parseInspirationCandidateDraft(JSON.stringify({
      storyCore: {},
      worlds: [{ name: '空世界' }],
      characters: [],
    }), 'multiworld')

    const result = await adoptGenerationNodeOutput(node, emptyWorld)
    expect(result.adopted).toBe(false)
    expect(result.gate?.issues.map(issue => issue.code)).toContain('inspiration-empty-shell')
  })

  it('无效 JSON、空选择和跨项目碎片在调用模型前阻断', async () => {
    const projectId = await addProject()
    await addWorkspace(projectId)
    await expect(() => parseInspirationCandidateDraft('{bad', 'single')).toThrow('有效')
    await expect(prepareInspirationCopilot({
      projectId,
      selectedFragmentIds: [],
      authorRequest: '生成',
    })).rejects.toThrow('请选择')
    await expect(prepareInspirationCopilot({
      projectId,
      selectedFragmentIds: ['foreign-id'],
      authorRequest: '生成',
    })).rejects.toThrow('不属于当前项目')
  })
})
