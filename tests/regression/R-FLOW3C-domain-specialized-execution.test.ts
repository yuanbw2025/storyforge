import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/ai/client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/ai/client')>('../../src/lib/ai/client')
  return { ...actual, chat: vi.fn() }
})

import { chat } from '../../src/lib/ai/client'
import { CHARACTER_DIMENSIONS } from '../../src/lib/character/character-dimensions'
import { db } from '../../src/lib/db/schema'
import { adoptDomainCandidate, executeDomainNode } from '../../src/lib/node-authoring/domain-execution'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { buildAuthoringCreationChainGraph } from '../../src/lib/node-authoring/creation-chain'
import { emptyAuthoringGraph, type AuthoringInputEnvelope, type AuthoringNodeInstance } from '../../src/lib/node-authoring/contracts'
import { inspectAuthoringGraphFreshness } from '../../src/lib/node-authoring/freshness'
import { adoptAuthoringCandidate, runAuthoringGraph } from '../../src/lib/node-authoring/executor'
import { buildRagLibrary } from '../../src/lib/retrieval/rag-library'
import type { AIConfig, NodeFlow, Project } from '../../src/lib/types'
import { resolveScopeLike, stampNewRecord } from '../../src/lib/world-engine/scope'

const project: Project = {
  id: 73003,
  name: '领域节点专用执行测试',
  genre: 'fantasy',
  genres: ['fantasy'],
  status: 'drafting',
  description: '',
  targetWordCount: 100_000,
  enableMultiWorld: false,
  createdAt: 1,
  updatedAt: 1,
}

const aiConfig: AIConfig = {
  provider: 'custom',
  apiKey: 'test',
  model: 'test-model',
  baseUrl: 'https://example.test',
  temperature: 0.7,
  maxTokens: 8000,
}

function node(templateId: string, config: Record<string, unknown> = {}): AuthoringNodeInstance {
  const template = AUTHORING_NODE_BY_ID.get(templateId)
  if (!template) throw new Error(`missing template ${templateId}`)
  return {
    id: `node-${templateId}`,
    templateId,
    templateVersion: 1,
    title: template.label,
    x: 0,
    y: 0,
    config: { ...defaultConfigForTemplate(template), ...config },
    inputs: structuredClone(template.inputs),
    outputs: structuredClone(template.outputs),
  }
}

function characterDraft(): string {
  const dimensions = Object.fromEntries(CHARACTER_DIMENSIONS.map(dimension => [dimension.key, `${dimension.label}候选`]))
  return JSON.stringify({
    name: '潮汐测者',
    roleWeight: 'main',
    moralAxis: 'good',
    orderAxis: 'lawful',
    relationships: '与旧城守门人互相扶持。',
    shortDescription: '能够听见海床回声的测潮者。',
    ...dimensions,
  })
}

const detailDraft = JSON.stringify({
  openingHook: '潮声从上一章的断桥下传来。',
  endingCliffhanger: '海床亮起第二道门。',
  sceneLocation: '黑潮海岸',
  emotionArc: 'rising',
  appearingCharacterIds: [],
  foreshadowIds: [],
  scenes: [{
    title: '退潮',
    summary: '主角在退潮时发现城门。',
    location: '黑潮海岸',
    conflict: '守门人拒绝让主角靠近。',
    pace: 'medium',
    characterIds: [],
    estimatedWords: 1800,
  }],
})

async function addNodeFlow(name: string, graphJson: string): Promise<number> {
  const scope = await resolveScopeLike(project.id!)
  return await db.nodeFlows.add(stampNewRecord(scope, 'nodeFlows', {
    projectId: project.id!,
    worldGroupId: null,
    name,
    description: '',
    graphJson,
    createdAt: 1,
    updatedAt: 1,
  }, { owner: 'work' }) as NodeFlow) as number
}

describe('FLOW-3C · 领域节点专用执行器', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.projects.put(project)
    await db.worldviews.put({
      projectId: project.id!,
      worldGroupId: null,
      worldOrigin: '潮汐退去后，第一座城从海床升起。',
      createdAt: 1,
      updatedAt: 1,
    } as any)
    await db.storyCores.put({
      projectId: project.id!,
      logline: '一名测潮者寻找沉没城市。',
      concept: '海床上的城市会在退潮时醒来。',
      createdAt: 1,
      updatedAt: 1,
    } as any)
    vi.mocked(chat).mockReset()
  })

  afterEach(() => db.close())

  it('角色节点使用结构化角色 parser，并通过 roster 快照采纳', async () => {
    vi.mocked(chat).mockResolvedValue(characterDraft())
    const graphNode = node('character.profile', { request: '创建一名听见海床回声的主角' })
    const flowId = await addNodeFlow(
      '角色领域节点',
      JSON.stringify({ ...emptyAuthoringGraph(), nodes: [graphNode] }),
    )
    const flow = await db.nodeFlows.get(flowId) as NodeFlow
    const graphRun = await runAuthoringGraph({ flow })
    expect(graphRun.candidates[graphNode.id].domain?.kind).toBe('character')
    const freshness = await inspectAuthoringGraphFreshness({ flow, snapshots: graphRun.snapshots, candidates: graphRun.candidates })
    expect(freshness[graphNode.id].status).toBe('fresh')
    const result = await executeDomainNode({
      node: node('character.profile', { request: '创建一名听见海床回声的主角' }),
      inputs: [],
      projectId: project.id!,
      worldGroupId: null,
      aiConfig,
    })
    expect(result?.domain.kind).toBe('character')
    const adopted = await adoptDomainCandidate({
      node: node('character.profile'),
      domain: result!.domain,
      output: result!.output,
      projectId: project.id!,
      worldGroupId: null,
    })
    expect(adopted?.written).toHaveLength(1)
    expect((await db.characters.where('projectId').equals(project.id!).first())?.name).toBe('潮汐测者')
  })

  it('卷纲节点复用既有卷纲 parser 与快照采纳', async () => {
    vi.mocked(chat).mockResolvedValue(JSON.stringify([
      { title: '第一卷：潮门', summary: '主角发现海床城门并踏入旧文明。' },
    ]))
    const result = await executeDomainNode({
      node: node('outline.volume', { request: '规划第一卷' }),
      inputs: [],
      projectId: project.id!,
      worldGroupId: null,
      aiConfig,
    })
    expect(result?.domain.kind).toBe('outline')
    const adopted = await adoptDomainCandidate({
      node: node('outline.volume'),
      domain: result!.domain,
      output: result!.output,
      projectId: project.id!,
      worldGroupId: null,
    })
    expect(adopted?.written).toHaveLength(1)
    expect(await db.outlineNodes.where('projectId').equals(project.id!).count()).toBe(1)
  })

  it('细纲节点过滤无效 FK，正文节点拒绝覆盖已有正文并支持正式采纳', async () => {
    const volumeId = await db.outlineNodes.add({
      projectId: project.id!, parentId: null, type: 'volume', title: '第一卷：潮门', summary: '卷摘要', order: 0, worldGroupId: null, createdAt: 1, updatedAt: 1,
    })
    const chapterId = await db.outlineNodes.add({
      projectId: project.id!, parentId: volumeId, type: 'chapter', title: '第一章：退潮', summary: '主角在海岸发现城门。', order: 0, worldGroupId: null, createdAt: 1, updatedAt: 1,
    })
    const foreshadowId = await db.foreshadows.add({
      projectId: project.id!,
      name: '海床铜钟',
      type: 'environment',
      status: 'planned',
      description: '退潮时会响起的铜钟。',
      plantChapterId: null,
      echoChapterIds: '[]',
      resolveChapterId: null,
      notes: '',
      createdAt: 1,
      updatedAt: 1,
    } as any)
    vi.mocked(chat).mockResolvedValueOnce(JSON.stringify({
      ...JSON.parse(detailDraft),
      foreshadowIds: [foreshadowId, 999999],
    }))
    const detail = await executeDomainNode({
      node: node('outline.plan', { chapterTitle: '第一章：退潮' }),
      inputs: [], projectId: project.id!, worldGroupId: null, aiConfig,
    })
    expect(detail?.domain).toMatchObject({ kind: 'detail', outlineNodeId: chapterId })
    const detailAdoption = await adoptDomainCandidate({
      node: node('outline.plan'), domain: detail!.domain, output: detail!.output,
      projectId: project.id!, worldGroupId: null,
    })
    expect(detailAdoption?.written).toHaveLength(1)
    const savedDetail = await db.detailedOutlines.where('outlineNodeId').equals(chapterId).first()
    expect(savedDetail?.scenes).toHaveLength(1)
    expect(savedDetail?.foreshadowIds).toEqual([foreshadowId])

    vi.mocked(chat).mockResolvedValueOnce('潮声在夜色中持续了很久，直到城门从海床升起，露出一条通往旧文明的石阶。主角沿着湿冷的石阶向下，听见远处有人敲响沉重的铜钟，海水在身后重新合拢。石壁上的古老刻痕逐渐亮起，照出一条没有尽头的黑暗长廊。')
    const prose = await executeDomainNode({
      node: node('chapter.prose', { chapterTitle: '第一章：退潮', request: '生成第一章正文' }),
      inputs: [], projectId: project.id!, worldGroupId: null, aiConfig,
    })
    expect(prose?.domain).toMatchObject({ kind: 'prose', outlineNodeId: chapterId })
    const proseAdoption = await adoptDomainCandidate({
      node: node('chapter.prose'), domain: prose!.domain, output: prose!.output,
      projectId: project.id!, worldGroupId: null,
    })
    expect(proseAdoption?.written).toHaveLength(1)
    expect((await db.chapters.where('outlineNodeId').equals(chapterId).first())?.content).toContain('潮声')
  })

  it('细纲节点遵守候选数量控制并保留全部可比较版本', async () => {
    const volumeId = await db.outlineNodes.add({
      projectId: project.id!, parentId: null, type: 'volume', title: '第一卷：潮门', summary: '卷摘要', order: 0, worldGroupId: null, createdAt: 1, updatedAt: 1,
    })
    await db.outlineNodes.add({
      projectId: project.id!, parentId: volumeId, type: 'chapter', title: '第一章：退潮', summary: '主角在海岸发现城门。', order: 0, worldGroupId: null, createdAt: 1, updatedAt: 1,
    })
    vi.mocked(chat)
      .mockResolvedValueOnce(detailDraft)
      .mockResolvedValueOnce(JSON.stringify({ ...JSON.parse(detailDraft), endingCliffhanger: '第三道门在月下开启。' }))
    const candidateCount: AuthoringInputEnvelope = {
      sourceNodeId: 'candidate-count', sourcePortId: 'value', targetPortId: 'candidate-count',
      semantic: 'control.count', cardinality: 'one', state: 'control', content: '2', tokens: 1,
    }
    const result = await executeDomainNode({
      node: node('outline.plan', { chapterTitle: '第一章：退潮' }),
      inputs: [candidateCount], projectId: project.id!, worldGroupId: null, aiConfig,
    })
    expect(chat).toHaveBeenCalledTimes(2)
    expect(result?.variants).toHaveLength(2)
    expect(result?.output).toContain('海床亮起第二道门')
    expect(result?.variants?.[1]).toContain('第三道门在月下开启')
  })

  it('细纲节点从上游结构化章纲候选解析目标章节，无需重复填写标题', async () => {
    const volumeId = await db.outlineNodes.add({
      projectId: project.id!, parentId: null, type: 'volume', title: '第一卷：潮门', summary: '卷摘要', order: 0, worldGroupId: null, createdAt: 1, updatedAt: 1,
    })
    const chapterId = await db.outlineNodes.add({
      projectId: project.id!, parentId: volumeId, type: 'chapter', title: '第一章：退潮', summary: '主角在海岸发现城门。', order: 0, worldGroupId: null, createdAt: 1, updatedAt: 1,
    })
    vi.mocked(chat).mockResolvedValueOnce(detailDraft)
    const upstream: AuthoringInputEnvelope = {
      sourceNodeId: 'chapter', sourcePortId: 'candidate', targetPortId: 'chapter',
      semantic: 'outline.chapter', cardinality: 'many', state: 'candidate',
      content: JSON.stringify([{ title: '第一章：退潮', summary: '主角在海岸发现城门。' }]), tokens: 20,
    }
    const result = await executeDomainNode({
      node: node('outline.plan'), inputs: [upstream], projectId: project.id!, worldGroupId: null, aiConfig,
    })
    expect(result?.domain).toMatchObject({ kind: 'detail', outlineNodeId: chapterId })
  })

  it('角色维度节点按稳定资料绑定定点写回，不会误更新第一个角色', async () => {
    const firstId = await db.characters.add({
      projectId: project.id!, name: '先行者', shortDescription: '已有角色一。', motivation: '原动机一',
      worldGroupId: null, homeWorldGroupId: null, createdAt: 1, updatedAt: 1,
    } as any)
    const secondId = await db.characters.add({
      projectId: project.id!, name: '潮汐测者', shortDescription: '已有角色二。', motivation: '原动机二',
      worldGroupId: null, homeWorldGroupId: null, createdAt: 1, updatedAt: 1,
    } as any)
    const target = (await buildRagLibrary({ projectId: project.id!, worldGroupId: null }))
      .find(entry => entry.tableName === 'characters' && entry.recordId === secondId && entry.fieldKey === 'motivation')
    expect(target).toBeDefined()
    const graphNode = node('character.field.motivation', { request: '为角色设计新的核心动机。' })
    graphNode.binding = {
      mode: 'snapshot',
      ref: { documentId: target!.documentId, fieldKey: 'motivation', target: 'characters' },
    }
    vi.mocked(chat).mockResolvedValue('为了让沉没城市重见天日。')
    const flowId = await addNodeFlow(
      '角色维度绑定',
      JSON.stringify({ ...emptyAuthoringGraph(), nodes: [graphNode] }),
    )
    const flow = await db.nodeFlows.get(flowId) as NodeFlow
    const result = await runAuthoringGraph({ flow })
    const adopted = await adoptAuthoringCandidate({ flow, nodeId: graphNode.id, output: result.candidates[graphNode.id].output })
    expect(adopted.written).toHaveLength(1)
    expect((await db.characters.get(firstId))?.motivation).toBe('原动机一')
    expect((await db.characters.get(secondId))?.motivation).toBe('为了让沉没城市重见天日。')
  })

  it('官方完整创作链可按作者确认边界从故事生成到正式正文', async () => {
    vi.mocked(chat).mockImplementation(async (_messages, _config, options) => {
      switch (options.category) {
        case 'worldview.dimension': return '潮汐退去后，沉没城市会在每个月圆之夜从海床苏醒。'
        case 'story.core': return '退潮后苏醒的城市迫使测潮者在真相与故乡之间选择。'
        case 'character.generate': return characterDraft()
        case 'outline.volume': return JSON.stringify([{ title: '第一卷：潮门', summary: '主角发现海床城门并踏入旧文明。' }])
        case 'outline.chapter': return JSON.stringify([{ title: '第一章：退潮', summary: '主角在海岸发现城门。' }])
        case 'detail.chapter-planning': return detailDraft
        case 'chapter.content': return '潮声在夜色中持续了很久，直到城门从海床升起。测潮者沿着湿冷石阶向下，听见远处有人敲响铜钟。海水在身后重新合拢，古老刻痕逐渐亮起，照出通往旧文明的黑暗长廊。他握紧潮汐罗盘继续前行，墙壁深处却传来另一个与自己完全相同的脚步声。'
        default: throw new Error(`unexpected category: ${options.category}`)
      }
    })
    const { graph, nodeIds } = buildAuthoringCreationChainGraph()
    const flowId = await addNodeFlow('完整创作链', JSON.stringify(graph))
    const flow = await db.nodeFlows.get(flowId) as NodeFlow

    const runAndAdopt = async (nodeId: string) => {
      const result = await runAuthoringGraph({ flow, targetNodeId: nodeId })
      const failure = Object.values(result.candidates).find(candidate => candidate.status === 'blocked')
      expect(result.run.status, failure?.errors?.join('；')).toBe('completed')
      expect(result.candidates[nodeId]?.status).toBe('candidate')
      return adoptAuthoringCandidate({ flow, nodeId, output: result.candidates[nodeId].output })
    }

    await runAndAdopt(nodeIds.world)
    await runAndAdopt(nodeIds.concept)
    await runAndAdopt(nodeIds.conflict)
    await runAndAdopt(nodeIds.character)
    await runAndAdopt(nodeIds.volume)
    await runAndAdopt(nodeIds.chapter)
    await runAndAdopt(nodeIds.detail)
    await runAndAdopt(nodeIds.prose)

    const [worldview, storyCore, characters, outlines, details, chapters] = await Promise.all([
      db.worldviews.where('projectId').equals(project.id!).first(),
      db.storyCores.where('projectId').equals(project.id!).first(),
      db.characters.where('projectId').equals(project.id!).toArray(),
      db.outlineNodes.where('projectId').equals(project.id!).toArray(),
      db.detailedOutlines.where('projectId').equals(project.id!).toArray(),
      db.chapters.where('projectId').equals(project.id!).toArray(),
    ])
    expect(worldview?.worldOrigin).toContain('每个月圆之夜')
    expect(storyCore?.concept).toContain('退潮后苏醒的城市')
    expect(storyCore?.centralConflict).toContain('真相与故乡')
    expect(characters.some(character => character.name === '潮汐测者')).toBe(true)
    expect(outlines.map(item => item.type)).toEqual(['volume', 'chapter'])
    expect(details).toHaveLength(1)
    expect(chapters[0]?.content).toContain('古老刻痕')
  })
})
