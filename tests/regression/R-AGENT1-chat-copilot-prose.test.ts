import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROSE_COPILOT_SOURCE_KEYS,
  ProseCopilotStaleError,
  adoptRestoredProseCandidate,
  createProseCopilotNode,
  parseProseCandidateDraft,
  prepareProseCopilot,
  revalidateProseCreativeDraftV1,
  runProseCreativeReliabilityV1,
  type ProseCopilotInput,
} from '../../src/lib/agent/prose-copilot'
import { adoptMasterCandidate } from '../../src/lib/agent/orchestrator'
import { appendAgentEvent, getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { db } from '../../src/lib/db/schema'
import {
  adoptGenerationNodeOutput,
  prepareGenerationNode,
  runGenerationNode,
} from '../../src/lib/generation/generation-node'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import type { AIConfigPreset, Chapter, OutlineNode, Project } from '../../src/lib/types'
import { resolveScopeLike } from '../../src/lib/world-engine/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { buildNarrativeBriefV1 } from '../../src/lib/agent/narrative-brief'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'

const longDraft = (marker: string) => (
  `${marker}。退潮后的盐海露出黑色礁脊，守灯人沿着潮痕走向沉默的钟楼。`
  + '风把旧誓言送回岸边，他意识到这次选择会改变整座港城的命运。'.repeat(3)
)

async function seedProject(): Promise<{
  project: Project
  volumeId: number
  firstId: number
  secondId: number
}> {
  const now = Date.now()
  const project: Project = {
    name: '潮汐正文',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    enableMultiWorld: false,
    createdAt: now,
    updatedAt: now,
  }
  project.id = await db.projects.add(project) as number
  const volumeId = await db.outlineNodes.add({
    projectId: project.id,
    parentId: null,
    type: 'volume',
    title: '第一卷：退潮',
    summary: '守灯人寻找失踪的潮汐钟。',
    order: 0,
    worldGroupId: null,
    createdAt: now,
    updatedAt: now,
  }) as number
  const firstId = await db.outlineNodes.add({
    projectId: project.id,
    parentId: volumeId,
    type: 'chapter',
    title: '第一章：海床之光',
    summary: '退潮后，守灯人第一次看见浮空城投下的影子。',
    order: 0,
    worldGroupId: null,
    createdAt: now,
    updatedAt: now,
  }) as number
  const secondId = await db.outlineNodes.add({
    projectId: project.id,
    parentId: volumeId,
    type: 'chapter',
    title: '第二章：无声之钟',
    summary: '主角进入钟楼，发现钟芯已经被取走。',
    order: 1,
    worldGroupId: null,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.worldviews.add({
    projectId: project.id,
    worldGroupId: null,
    worldOrigin: '盐海每十年退潮，浮空城会在海床上方显形。',
    createdAt: now,
    updatedAt: now,
  } as never)
  return { project, volumeId, firstId, secondId }
}

async function makeNodeInput(
  project: Project,
  outlineNode: OutlineNode,
  chapter: Chapter | null,
  prepared: Awaited<ReturnType<typeof prepareProseCopilot>>,
): Promise<ProseCopilotInput> {
  const config = useAIConfigStore.getState().config
  const scope = await resolveScopeLike(project.id!)
  const assembled = await assembleContext({
    projectId: project.id!,
    worldGroupId: null,
    outlineNodeId: outlineNode.id,
    chapterId: chapter?.id ?? null,
    currentChapterOrder: chapter?.order ?? 0,
    provider: config.provider,
    model: config.model,
    sourceKeys: [...PROSE_COPILOT_SOURCE_KEYS],
  })
  return {
    project,
    scope,
    worldGroupId: null,
    authorRequest: prepared.operation === 'continue' ? '续写这一章正文' : '写第一章正文',
    supplementalContext: '',
    inputGuidance: '',
    operation: prepared.operation,
    outlineNode,
    chapter,
    snapshot: prepared.snapshot,
    assembled,
    narrativeBrief: buildNarrativeBriefV1({
      authorRequest: prepared.operation === 'continue' ? '续写这一章正文' : '写第一章正文',
      assembled,
    }),
    previousTail: '',
    config,
    perspectiveCharacterId: prepared.perspectiveCharacterId,
    informationBoundary: prepared.informationBoundary,
  }
}

describe('AGENT-1 27.1-d · ChatCopilot 正文闭环', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useAIConfigStore.setState({ presets: [], taskRoutes: {} })
    db.close()
  })

  it('选择明确章纲并只经正式上下文装配，生成前保持零正文写入', async () => {
    const { project, firstId } = await seedProject()
    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '请写第一章正文，突出退潮后的陌生感',
    })
    const prompt = prepared.prepared.messages.map(message => message.content).join('\n')

    expect(prepared.operation).toBe('generate')
    expect(prepared.outlineNodeId).toBe(firstId)
    expect(prepared.contextSources).toContain('chapterOutline')
    expect(prepared.contextSources).toContain('worldview')
    expect(prepared.contextEvidence.inputState).toMatchObject({
      state: 'partial',
      handling: 'reference-and-create',
    })
    expect(prompt).toContain('partial / reference-and-create')
    expect(prompt).toContain('第一章：海床之光')
    expect(prompt).toContain('盐海每十年退潮')
    expect(prompt).toContain('本轮叙事任务（运行时合同，不是新增 Canon）')
    expect(prompt).toContain('不要用世界观介绍代替故事推进')
    expect(prepared.input.narrativeBrief.entryState).toContain('第一章：海床之光')
    expect(await db.chapters.count()).toBe(0)
  })

  it('正文 Skill 冻结生成或续写语义，不依赖提示词再次猜测操作', async () => {
    const { project, firstId } = await seedProject()
    const now = Date.now()
    await db.chapters.add({
      projectId: project.id!,
      outlineNodeId: firstId,
      title: '第一章：海床之光',
      content: '<p>作者已有正文。</p>',
      wordCount: 7,
      order: 0,
      worldGroupId: null,
      createdAt: now,
      updatedAt: now,
    })
    const continued = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '完善第一章内容',
      skillId: 'prose.continue',
    })
    expect(continued.operation).toBe('continue')
    await expect(prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '完善第一章内容',
      skillId: 'prose.generate',
    })).rejects.toThrow('已有正文')
  })

  it('主 Agent 正文档位收窄登记源预算并冻结实际输入证据', async () => {
    const { project } = await seedProject()
    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '请写第一章正文',
      routingCategory: 'agent.prose',
      contextProfile: 'lean',
    })

    expect(prepared.contextEvidence.profile).toBe('lean')
    expect(prepared.contextEvidence.inputBudgetTokens).toBeLessThanOrEqual(24_000)
    expect(prepared.contextEvidence.estimatedInputTokens).toBeGreaterThan(0)
    expect(prepared.contextEvidence.included).toEqual(prepared.contextSources)
  })

  it('主 Agent 正文角色使用独立模型预设，并按实际 provider/model 记录用量', async () => {
    const { project } = await seedProject()
    const globalConfig = {
      ...useAIConfigStore.getState().config,
      provider: 'deepseek' as const,
      apiKey: 'global-key',
      model: 'global-model',
      baseUrl: 'https://global.example/v1',
    }
    const prosePreset: AIConfigPreset = {
      id: 'prose-role',
      name: '正文专用',
      config: {
        ...globalConfig,
        provider: 'ollama',
        apiKey: '',
        model: 'qwen-prose-local',
        baseUrl: 'http://localhost:11434/v1',
        contextWindow: 131_072,
      },
    }
    useAIConfigStore.setState({
      config: globalConfig,
      presets: [prosePreset],
      taskRoutes: { 'agent-prose': prosePreset.id },
    })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://localhost:11434/v1/chat/completions')
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('qwen-prose-local')
      return new Response(JSON.stringify({
        choices: [{ message: { content: longDraft('角色路由正文') } }],
        usage: { prompt_tokens: 23, completion_tokens: 17, total_tokens: 40 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '写第一章正文',
      routingCategory: 'agent.prose',
    })
    const result = await runGenerationNode(prepared.node, prepared.prepared)

    expect(result.gate?.status).toBe('pass')
    expect(fetchMock).toHaveBeenCalledOnce()
    await vi.waitFor(async () => {
      expect(await db.aiUsageLog.toCollection().last()).toMatchObject({
        projectId: project.id,
        category: 'agent.prose',
        provider: 'ollama',
        model: 'qwen-prose-local',
        taskKind: 'agent-prose',
        inputTokens: 23,
        outputTokens: 17,
      })
    })
    expect(await db.chapters.count()).toBe(0)
  })

  it('平衡模式对过短正文只做一次定向修复并交付可采纳正文', async () => {
    const { project } = await seedProject()
    const firstRaw = '退潮了。'
    const runAI = vi.fn()
      .mockResolvedValueOnce(firstRaw)
      .mockResolvedValueOnce(longDraft('修复后的正文'))
    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '写第一章正文',
    }, { runAI })

    const result = await runProseCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'balanced',
    })

    expect(runAI).toHaveBeenCalledTimes(2)
    expect(result.draft).toContain('修复后的正文')
    expect(result.artifact).toMatchObject({
      status: 'ready',
      originalText: firstRaw,
      repair: { callIndex: 2, result: 'repaired' },
    })
    const repairPrompt = runAI.mock.calls[1][0]
      .map((message: { content: string }) => message.content)
      .join('\n')
    expect(repairPrompt).toContain('prose-response-invalid')
    expect(repairPrompt).not.toContain('盐海每十年退潮')
  })

  it('弱推进只做非阻断提示，不为主观质量自动烧第二次调用', async () => {
    const { project } = await seedProject()
    const staticDraft = '盐海、浮空城、黑色礁脊与古老钟楼构成这片土地的全部景观。'
      + '这里有漫长潮痕、沉默石壁、古老纹章与灰白天空。'.repeat(4)
    const runAI = vi.fn(async () => staticDraft)
    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '写第一章正文',
    }, { runAI })

    const result = await runProseCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'balanced',
    })

    expect(runAI).toHaveBeenCalledOnce()
    expect(result.artifact.status).toBe('usable-with-warnings')
    expect(result.artifact.repair).toBeNull()
    expect(result.artifact.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'prose-narrative-motion-weak',
        disposition: 'advisory',
        suggestedAction: 'none',
      }),
    ]))
  })

  it('正文唯一一次修复调用失败时保留首次草稿并停止', async () => {
    const { project } = await seedProject()
    const firstRaw = '退潮了，但正文还没有展开。'
    const runAI = vi.fn()
      .mockResolvedValueOnce(firstRaw)
      .mockRejectedValueOnce(new Error('provider unavailable'))
    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '写第一章正文',
    }, { runAI })

    const result = await runProseCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'balanced',
    })

    expect(runAI).toHaveBeenCalledTimes(2)
    expect(result.draft).toBe(firstRaw)
    expect(result.artifact.status).toBe('manual-repair')
    expect(result.artifact.callEvidence).toHaveLength(2)
    expect(result.artifact.repair?.result).toBe('failed')
  })

  it('作者补足过短正文后只做本地校验，不产生新的 API 调用', async () => {
    const { project } = await seedProject()
    const runAI = vi.fn(async () => '太短。')
    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '写第一章正文',
    }, { runAI })
    const generated = await runProseCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'economy',
    })

    const revalidated = revalidateProseCreativeDraftV1({
      draft: longDraft('作者补足后的正文'),
      informationBoundary: prepared.informationBoundary,
      previousArtifact: generated.artifact,
    })

    expect(generated.artifact.status).toBe('manual-repair')
    expect(revalidated.status).toBe('ready')
    expect(revalidated.callEvidence).toEqual(generated.artifact.callEvidence)
    expect(runAI).toHaveBeenCalledOnce()
  })

  it('正文主路径没有显式视角时不注入全体角色认知', async () => {
    const { project } = await seedProject()
    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '写第一章正文',
    })

    expect(prepared.perspectiveCharacterId).toBeNull()
    expect(prepared.contextSources).not.toContain('characterKnowledge')
    expect(prepared.prepared.messages.map(message => message.content).join('\n'))
      .toContain('未指定视角角色')
  })

  it('正文显式视角只注入该角色在目标章前已知内容', async () => {
    const { project, firstId, secondId } = await seedProject()
    const now = Date.now()
    const mainId = await db.characters.add({
      projectId: project.id!,
      name: '守灯人',
      roleWeight: 'main',
      moralAxis: 'neutral',
      orderAxis: 'neutral',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const sideId = await db.characters.add({
      projectId: project.id!,
      name: '钟匠',
      roleWeight: 'supporting',
      moralAxis: 'neutral',
      orderAxis: 'neutral',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const firstChapterId = await db.chapters.add({
      projectId: project.id!,
      outlineNodeId: firstId,
      title: '第一章：海床之光',
      content: '',
      wordCount: 0,
      status: 'draft',
      order: 0,
      notes: '',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    await db.knowledgeLedger.bulkAdd([
      {
        projectId: project.id!,
        characterId: mainId,
        characterName: '守灯人',
        knowledgeKey: 'main.secret',
        statement: '主角知道潮门会在黎明前关闭',
        action: 'learn',
        sourceType: 'chapter',
        sourceChapterId: firstChapterId,
        status: 'confirmed',
        createdAt: now,
        updatedAt: now,
      },
      {
        projectId: project.id!,
        characterId: sideId,
        characterName: '钟匠',
        knowledgeKey: 'side.secret',
        statement: '配角知道钟芯其实被藏在井底',
        action: 'learn',
        sourceType: 'chapter',
        sourceChapterId: firstChapterId,
        status: 'confirmed',
        createdAt: now + 1,
        updatedAt: now + 1,
      },
    ] as any)

    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '写第二章正文',
      perspectiveCharacterId: mainId,
    })
    const context = prepared.prepared.messages.map(message => message.content).join('\n')
    expect(prepared.perspectiveCharacterId).toBe(mainId)
    expect(prepared.contextSources).toContain('characterKnowledge')
    expect(context).toContain('主角知道潮门会在黎明前关闭')
    expect(context).not.toContain('配角知道钟芯其实被藏在井底')
    expect(prepared.snapshot.perspectiveCharacterId).toBe(mainId)
    expect(prepared.outlineNodeId).toBe(secondId)
  })

  it('正文拒绝不属于当前作用域的视角角色', async () => {
    const { project } = await seedProject()
    await expect(prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '写第一章正文',
      perspectiveCharacterId: 999_999,
    })).rejects.toThrow('视角角色不存在或不属于当前世界')
  })

  it('候选可编辑，作者确认眼前正文后写入且不二次调用模型', async () => {
    const { project, firstId } = await seedProject()
    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '写第一章正文',
    })
    const outline = await db.outlineNodes.get(firstId)
    const nodeInput = await makeNodeInput(project, outline!, null, prepared)
    const runAI = vi.fn(async () => longDraft('模型初稿'))
    const node = createProseCopilotNode(nodeInput, { runAI })
    const generated = await runGenerationNode(node, prepareGenerationNode(node, nodeInput))

    expect(generated.gate?.status).toBe('pass')
    expect(await db.chapters.count()).toBe(0)
    const adopted = await adoptGenerationNodeOutput(node, longDraft('作者可见修订稿'))

    expect(adopted.adopted).toBe(true)
    expect(runAI).toHaveBeenCalledOnce()
    const chapter = await db.chapters.where('outlineNodeId').equals(firstId).first()
    expect(chapter?.content).toContain('作者可见修订稿')
    expect(chapter?.content).not.toContain('模型初稿')
    expect(await db.retrievalChunks.where('sourceChapterId').equals(chapter!.id!).count()).toBeGreaterThan(0)
  })

  it('已有正文只有明确续写才会追加，普通生成与重写请求均被保护', async () => {
    const { project, firstId } = await seedProject()
    const now = Date.now()
    const chapterId = await db.chapters.add({
      projectId: project.id!,
      outlineNodeId: firstId,
      title: '第一章：海床之光',
      content: '<p>作者原稿不可覆盖。</p>',
      wordCount: 9,
      status: 'draft',
      order: 0,
      notes: '',
      createdAt: now,
      updatedAt: now,
    }) as number

    await expect(prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '写第一章正文',
    })).rejects.toThrow('已有正文')
    await expect(prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '重写第一章正文',
    })).rejects.toThrow('不覆盖已有手稿')

    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '续写第一章正文',
    })
    await adoptRestoredProseCandidate({
      projectId: project.id!,
      worldGroupId: null,
      operation: 'continue',
      outlineNodeId: firstId,
      snapshot: prepared.snapshot,
      draft: longDraft('续写确认稿'),
    })
    const chapter = await db.chapters.get(chapterId)
    expect(chapter?.content).toContain('作者原稿不可覆盖')
    expect(chapter?.content).toContain('续写确认稿')
  })

  it('短候选和超长候选在写入前阻断', () => {
    expect(() => parseProseCandidateDraft('太短')).toThrow('至少需要')
    expect(() => parseProseCandidateDraft('长'.repeat(200_001))).toThrow('不能超过')
  })

  it('候选生成后章纲或正文发生变化会拒绝旧候选', async () => {
    const { project, firstId } = await seedProject()
    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '写第一章正文',
    })
    await db.outlineNodes.update(firstId, { summary: '作者刚刚修改了章纲。', updatedAt: Date.now() + 10 })

    await expect(adoptRestoredProseCandidate({
      projectId: project.id!,
      worldGroupId: null,
      operation: 'generate',
      outlineNodeId: firstId,
      snapshot: prepared.snapshot,
      draft: longDraft('过期候选'),
    })).rejects.toBeInstanceOf(ProseCopilotStaleError)
    expect(await db.chapters.count()).toBe(0)
  })

  it('刷新后用持久化快照确认候选并同步到正式章节', async () => {
    const { project, secondId } = await seedProject()
    const prepared = await prepareProseCopilot({
      projectId: project.id!,
      worldGroupId: null,
      authorRequest: '写第二章正文',
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
    const message = await adoptMasterCandidate({
      projectId: project.id!,
      scope,
      worldGroupId: null,
      event,
      payload: {
        version: 1,
        taskId: 'prose-1',
        agentId: 'prose',
        label: prepared.label,
        contextSources: prepared.contextSources,
        baseSnapshot: prepared.snapshot,
        proseOperation: 'generate',
        proseOutlineNodeId: secondId,
      },
      draft: longDraft('刷新恢复稿'),
    })
    expect(message).toBe('正文已写入目标章节。')
    expect((await db.chapters.where('outlineNodeId').equals(secondId).first())?.content)
      .toContain('刷新恢复稿')
  })
})
