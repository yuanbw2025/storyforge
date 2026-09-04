import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/ai/client', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/ai/client')>('../../src/lib/ai/client')
  return { ...actual, chat: vi.fn() }
})

import { chat } from '../../src/lib/ai/client'
import { db } from '../../src/lib/db/schema'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { executeDomainNode, adoptDomainCandidate } from '../../src/lib/node-authoring/domain-execution'
import { validateAuthoringGraph } from '../../src/lib/node-authoring/graph'
import { emptyAuthoringGraph, type AuthoringNodeInstance } from '../../src/lib/node-authoring/contracts'
import { validateAuthoringNodeCatalog } from '../../src/lib/node-authoring/validate-catalog'
import type { AIConfig, NodeFlow, Project } from '../../src/lib/types'
import { putCurrentWorkspaceFixtureV1 } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

const project: Project = {
  id: 83003,
  workspaceUid: 'WS-00000000-0000-4000-8000-000000083003',
  workspacePurpose: 'independent-work',
  name: 'FLOW-3D 连续性测试',
  enableMultiWorld: false,
  activeWorldId: 83003,
  activeWorkId: 83003,
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

describe('FLOW-3D · 连续性网络与写后整理', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await putCurrentWorkspaceFixtureV1(project)
    const volumeId = await db.outlineNodes.add({
      projectId: project.id!, parentId: null, type: 'volume', title: '第一卷', summary: '潮门卷', order: 0,
      worldGroupId: null, createdAt: 1, updatedAt: 1,
    } as any)
    const outlineId = await db.outlineNodes.add({
      projectId: project.id!, parentId: volumeId, type: 'chapter', title: '第一章：退潮', summary: '潮门现世', order: 0,
      worldGroupId: null, createdAt: 1, updatedAt: 1,
    } as any)
    await db.chapters.add({
      projectId: project.id!, outlineNodeId: outlineId, title: '第一章：退潮',
      content: '<p>林风在黑潮海岸拾起青锋剑，剑锋划伤了他的手。</p>', wordCount: 25, status: 'draft', order: 0,
      createdAt: 1, updatedAt: 1,
    } as any)
    const characterId = await db.characters.add({
      projectId: project.id!, name: '林风', shortDescription: '测潮者',
      roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral',
      homeWorldGroupId: null, isCrossWorld: false, createdAt: 1, updatedAt: 1,
    } as any)
    await db.foreshadows.add({
      projectId: project.id!, name: '海床铜钟', type: 'environment', status: 'planned',
      description: '铜钟会在退潮时响起。', plantChapterId: null, echoChapterIds: '[]', resolveChapterId: null,
      notes: '', createdAt: 1, updatedAt: 1,
    } as any)
    await db.characterRelations.add({
      projectId: project.id!, fromCharacterId: characterId, toCharacterId: characterId + 1,
      relationType: 'friend', label: '同伴', description: '', isBidirectional: true, createdAt: 1, updatedAt: 1,
    } as any).catch(() => undefined)
    await finalizeCurrentFixtureV1(project.id!)
    vi.mocked(chat).mockReset()
  })

  afterEach(() => db.close())

  it('目录登记了八类连续性节点和五类只读上下文，且三注册表引用完整', () => {
    expect(validateAuthoringNodeCatalog()).toEqual([])
    expect([...AUTHORING_NODE_BY_ID.keys()]).toEqual(expect.arrayContaining([
      'continuity.storyline', 'continuity.foreshadow', 'continuity.location', 'continuity.state',
      'continuity.item', 'continuity.fact', 'continuity.knowledge', 'continuity.timeline',
      'chapter.organize', 'context.previous-ending', 'context.handoff', 'context.recent-summaries',
      'context.related-passages', 'context.consistency-report',
    ]))
  })

  it('正文节点可以生成六域候选，作者确认后分别写回既有账本', async () => {
    vi.mocked(chat).mockResolvedValue(JSON.stringify({
      stateDiffs: [{ entityName: '林风', category: 'character', field: '身体状态', oldValue: null, newValue: '手部划伤', sourceQuote: '剑锋划伤了他的手' }],
      facts: [{ subject: '林风', predicate: 'healthStatus', value: '受伤', quote: '剑锋划伤了他的手' }],
      inventoryEvents: [{ itemName: '青锋剑', heldByName: '林风', action: 'gain', quantity: 1, note: '海岸拾得', sourceQuote: '拾起青锋剑' }],
      storyEvents: [{ title: '林风拾得青锋剑', storyTime: '', importance: 2, description: '获得关键物品', sourceQuote: '拾起青锋剑' }],
      relations: [],
      foreshadowUpdates: [],
    }))
    const chapterId = (await db.chapters.where('projectId').equals(project.id!).first())!.id!
    const result = await executeDomainNode({
      node: node('chapter.organize', { chapterTitle: '第一章：退潮' }),
      inputs: [], projectId: project.id!, worldGroupId: null, aiConfig,
    })
    expect(result?.domain.kind).toBe('chapter-organization')
    const adopted = await adoptDomainCandidate({
      node: node('chapter.organize', { chapterTitle: '第一章：退潮' }),
      domain: result!.domain,
      output: result!.output,
      projectId: project.id!,
      worldGroupId: null,
    })
    expect(adopted?.written.length).toBeGreaterThanOrEqual(3)
    expect(await db.stateCards.where('projectId').equals(project.id!).count()).toBe(1)
    expect(await db.temporalFacts.where('projectId').equals(project.id!).count()).toBe(1)
    expect(await db.itemLedger.where('projectId').equals(project.id!).count()).toBe(1)
    expect(await db.storyTimelineEvents.where('projectId').equals(project.id!).count()).toBe(1)
    const fact = await db.temporalFacts.where('projectId').equals(project.id!).first()
    expect(fact?.status).toBe('candidate')
    expect(fact?.sourceChapterId).toBe(chapterId)
  })

  it('正文变化后拒绝旧整理候选，避免静默改写账本', async () => {
    vi.mocked(chat).mockResolvedValue(JSON.stringify({ stateDiffs: [], facts: [], inventoryEvents: [], storyEvents: [], relations: [], foreshadowUpdates: [] }))
    const result = await executeDomainNode({
      node: node('chapter.organize', { chapterTitle: '第一章：退潮' }),
      inputs: [], projectId: project.id!, worldGroupId: null, aiConfig,
    })
    const chapter = await db.chapters.where('projectId').equals(project.id!).first()
    await db.chapters.update(chapter!.id!, { content: '<p>正文已被作者修改。</p>' })
    await expect(adoptDomainCandidate({
      node: node('chapter.organize'), domain: result!.domain, output: result!.output,
      projectId: project.id!, worldGroupId: null,
    })).rejects.toThrow('已过期')
  })

  it('事实节点复用受控谓词解析与事实账本扩展，不走通用表写入', async () => {
    vi.mocked(chat).mockResolvedValue(JSON.stringify({
      facts: [{ subject: '林风', predicate: 'healthStatus', value: '受伤', quote: '剑锋划伤了他的手' }],
    }))
    const result = await executeDomainNode({
      node: node('continuity.fact', { chapterTitle: '第一章：退潮' }),
      inputs: [], projectId: project.id!, worldGroupId: null, aiConfig,
    })
    expect(result?.domain.kind).toBe('facts')
    expect(result?.output).toContain('healthStatus')
    const adopted = await adoptDomainCandidate({
      node: node('continuity.fact'), domain: result!.domain, output: result!.output,
      projectId: project.id!, worldGroupId: null,
    })
    expect(adopted?.written, JSON.stringify(adopted)).toHaveLength(1)
    expect((await db.temporalFacts.where('projectId').equals(project.id!).first())?.status).toBe('candidate')
  })

  it('节点图可把章节正文接到整理本章，再接入六个下游域节点', async () => {
    const prose = node('chapter.prose', { chapterTitle: '第一章：退潮' })
    const organizer = node('chapter.organize', { chapterTitle: '第一章：退潮' })
    organizer.id = 'organizer'
    prose.id = 'prose'
    const downstream = node('continuity.fact', { chapterTitle: '第一章：退潮' })
    downstream.id = 'fact'
    const flow: NodeFlow = {
      id: 1, projectId: project.id!, worldGroupId: null, name: '连续性图', description: '',
      graphJson: JSON.stringify({
        ...emptyAuthoringGraph(),
        nodes: [prose, organizer, downstream],
        edges: [
          { id: 'e1', sourceNodeId: 'prose', sourcePortId: 'candidate', targetNodeId: 'organizer', targetPortId: 'chapter' },
          { id: 'e2', sourceNodeId: 'organizer', sourcePortId: 'candidate', targetNodeId: 'fact', targetPortId: 'context' },
        ],
      }),
      createdAt: 1, updatedAt: 1,
    }
    expect(validateAuthoringGraph(JSON.parse(flow.graphJson))).toEqual([])
    expect(JSON.parse(flow.graphJson).edges).toHaveLength(2)
  })
})
