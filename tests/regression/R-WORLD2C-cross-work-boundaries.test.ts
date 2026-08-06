import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyzeEditImpact } from '../../src/lib/consistency/impact-analysis'
import { db } from '../../src/lib/db/schema'
import { generateContextSnapshot } from '../../src/lib/export/context-snapshot'
import { exportProjectMarkdown, exportProjectTXT } from '../../src/lib/export/text-export'
import { listKnowledgeEvents } from '../../src/lib/knowledge-ledger/knowledge-ledger'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { emptyAuthoringGraph, type AuthoringNodeInstance } from '../../src/lib/node-authoring/contracts'
import { adoptAuthoringCandidate } from '../../src/lib/node-authoring/executor'
import { buildRagLibrary } from '../../src/lib/retrieval/rag-library'
import { loadSimulationCanonCandidates, parseSimulationCanonSnapshot } from '../../src/lib/simulation/canon-snapshot'
import type { NodeFlow, WorkspaceScope } from '../../src/lib/types'
import { stampNewRecord } from '../../src/lib/world-engine/scope'
import { useChapterStore } from '../../src/stores/chapter'
import { useSimulationRuntimeStore } from '../../src/stores/simulation-runtime'

async function createTwoWorkWorkspace(): Promise<{ a: WorkspaceScope; b: WorkspaceScope }> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '跨作品边界工程',
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId,
    code: 'cross-work-world',
    name: '共享世界',
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workA = await db.works.add({
    projectId,
    worldId,
    title: '作品 A',
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 50_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workB = await db.works.add({
    projectId,
    worldId,
    title: '作品 B',
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 50_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workA,
    ownershipSchemaVersion: 1,
    worldCode: 'cross-work-world',
    worldVersion: 1,
  })
  return {
    a: { projectId, worldId, workId: workA },
    b: { projectId, worldId, workId: workB },
  }
}

async function seedChapter(scope: WorkspaceScope, label: string, order: number) {
  const now = Date.now()
  const volumeId = await db.outlineNodes.add({
    projectId: scope.projectId,
    worldId: null,
    workId: scope.workId,
    parentId: null,
    type: 'volume',
    title: `${label}卷`,
    summary: `${label}卷摘要`,
    order: 0,
    worldGroupId: null,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const outlineId = await db.outlineNodes.add({
    projectId: scope.projectId,
    worldId: null,
    workId: scope.workId,
    parentId: volumeId,
    type: 'chapter',
    title: `${label}章`,
    summary: `${label}章纲秘密`,
    order,
    worldGroupId: null,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId: scope.projectId,
    workId: scope.workId,
    outlineNodeId: outlineId,
    title: `${label}章`,
    content: `<p>${label}正文秘密</p>`,
    wordCount: 8,
    status: 'draft',
    order,
    notes: '',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  return { volumeId, outlineId, chapterId }
}

function authoringNode(templateId: string): AuthoringNodeInstance {
  const template = AUTHORING_NODE_BY_ID.get(templateId)
  if (!template) throw new Error(`missing template ${templateId}`)
  return {
    id: `node-${templateId}`,
    templateId,
    templateVersion: 1,
    title: template.label,
    x: 0,
    y: 0,
    config: defaultConfigForTemplate(template),
    inputs: structuredClone(template.inputs),
    outputs: structuredClone(template.outputs),
  }
}

describe('WORLD-2C · 双 Work 下游边界反例', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useChapterStore.setState({ chapters: [], currentChapter: null, loading: false })
  })

  afterEach(() => db.close())

  it('修改 Work A 正文只失效 A 的层级摘要，不触碰 Work B', async () => {
    const { a, b } = await createTwoWorkWorkspace()
    const chapterA = await seedChapter(a, 'A', 0)
    const chapterB = await seedChapter(b, 'B', 0)
    const now = Date.now()
    const summaryA = await db.narrativeSummaryNodes.add({
      projectId: a.projectId, workId: a.workId, level: 'book', title: 'A书摘', summary: 'A',
      keywords: [], sourceHash: 'a', status: 'verified', generatedBy: 'system-rollup', createdAt: now, updatedAt: now,
    } as any) as number
    const summaryB = await db.narrativeSummaryNodes.add({
      projectId: b.projectId, workId: b.workId, level: 'chapter', sourceChapterId: chapterB.chapterId,
      title: 'B章摘', summary: 'B', keywords: [], sourceHash: 'b', status: 'verified',
      generatedBy: 'system-rollup', createdAt: now, updatedAt: now,
    } as any) as number

    await useChapterStore.getState().loadAll(a)
    await useChapterStore.getState().updateChapter(chapterA.chapterId, { content: '<p>A新正文</p>' })

    expect((await db.narrativeSummaryNodes.get(summaryA))?.status).toBe('stale')
    expect((await db.narrativeSummaryNodes.get(summaryB))?.status).toBe('verified')
  })

  it('认知账本与一致性影响分析不读取另一部作品', async () => {
    const { a, b } = await createTwoWorkWorkspace()
    const firstA = await seedChapter(a, 'A1', 0)
    const secondA = await seedChapter(a, 'A2', 1)
    const chapterB = await seedChapter(b, 'B', 0)
    const now = Date.now()
    await db.knowledgeLedger.bulkAdd([
      { projectId: a.projectId, workId: a.workId, characterId: null, characterName: 'A角色', knowledgeKey: 'a', statement: 'A认知秘密', action: 'learn', sourceType: 'manual', status: 'confirmed', createdAt: now, updatedAt: now },
      { projectId: b.projectId, workId: b.workId, characterId: null, characterName: 'B角色', knowledgeKey: 'b', statement: 'B认知秘密', action: 'learn', sourceType: 'manual', status: 'confirmed', createdAt: now, updatedAt: now },
    ] as any)
    await db.temporalFacts.bulkAdd([
      { projectId: a.projectId, workId: a.workId, subjectType: 'world', subjectName: 'A', predicate: '状态', value: 'A事实', sourceType: 'chapter', sourceChapterId: firstA.chapterId, status: 'confirmed', locked: false, createdAt: now, updatedAt: now },
      { projectId: b.projectId, workId: b.workId, subjectType: 'world', subjectName: 'B', predicate: '状态', value: 'B事实', sourceType: 'chapter', sourceChapterId: chapterB.chapterId, status: 'confirmed', locked: false, createdAt: now, updatedAt: now },
    ] as any)

    expect((await listKnowledgeEvents(a)).map(row => row.statement)).toEqual(['A认知秘密'])
    const impact = await analyzeEditImpact(a, firstA.chapterId)
    expect(impact.factsFromChapter.map(row => row.value)).toEqual(['A事实'])
    expect(impact.downstreamChapterIds).toEqual([secondA.chapterId])
    await expect(analyzeEditImpact(a, chapterB.chapterId)).rejects.toThrow('当前作品')
  })

  it('RAG、上下文快照和文本导出只包含目标 Work', async () => {
    const { a, b } = await createTwoWorkWorkspace()
    await seedChapter(a, 'A', 0)
    await seedChapter(b, 'B', 0)
    const now = Date.now()
    await db.storyCores.bulkAdd([
      { projectId: a.projectId, worldId: null, workId: a.workId, theme: 'A主题秘密', createdAt: now, updatedAt: now },
      { projectId: b.projectId, worldId: null, workId: b.workId, theme: 'B主题秘密', createdAt: now, updatedAt: now },
    ] as any)

    const rag = await buildRagLibrary({ projectId: a.projectId, scope: a, worldGroupId: null })
    const ragText = rag.map(entry => entry.content).join('\n')
    const snapshot = await generateContextSnapshot(a)
    const markdown = await exportProjectMarkdown(a)
    const plain = await exportProjectTXT(a)
    for (const text of [ragText, snapshot, markdown, plain]) {
      expect(text).toContain('A')
      expect(text).not.toContain('B正文秘密')
      expect(text).not.toContain('B章纲秘密')
      expect(text).not.toContain('B主题秘密')
    }
  })

  it('Simulation Canon 只汇入当前 Work 的物品流水', async () => {
    const { a, b } = await createTwoWorkWorkspace()
    const now = Date.now()
    await db.itemLedger.bulkAdd([
      { projectId: a.projectId, workId: a.workId, itemName: 'A钥匙', action: 'gain', quantity: 1, heldByName: '旅人', createdAt: now },
      { projectId: b.projectId, workId: b.workId, itemName: 'B王冠', action: 'gain', quantity: 1, heldByName: '旅人', createdAt: now + 1 },
    ] as any)

    const catalog = await loadSimulationCanonCandidates({ projectId: a.projectId, scope: a, worldGroupId: null })
    expect(catalog.candidates.map(candidate => candidate.name)).toContain('A钥匙')
    expect(catalog.candidates.map(candidate => candidate.name)).not.toContain('B王冠')
  })

  it('显式为非当前 Work B 创建实例时，冻结快照和绑定都不得回落到活动 Work A', async () => {
    const { a, b } = await createTwoWorkWorkspace()
    const now = Date.now()
    await db.itemLedger.bulkAdd([
      { projectId: a.projectId, workId: a.workId, itemName: 'A密钥', action: 'gain', quantity: 1, heldByName: '甲', createdAt: now },
      { projectId: b.projectId, workId: b.workId, itemName: 'B徽记', action: 'gain', quantity: 1, heldByName: '乙', createdAt: now + 1 },
    ] as any)
    const catalogB = await loadSimulationCanonCandidates({ projectId: b.projectId, scope: b, worldGroupId: null })
    const sourceKeys = catalogB.candidates
      .filter(candidate => candidate.name === 'B徽记')
      .map(candidate => candidate.sourceKey)

    const sessionId = await useSimulationRuntimeStore.getState().createSession({
      projectId: b.projectId,
      scope: b,
      worldGroupId: null,
      kind: 'storygame',
      title: 'B 的冻结实例',
      sourceKeys,
    })

    const session = await db.simulationSessions.get(sessionId)
    const snapshot = parseSimulationCanonSnapshot(session!.canonSnapshotJson)
    expect(session).toMatchObject({ worldId: b.worldId, workId: b.workId })
    expect(snapshot?.sources.map(source => source.name)).toEqual(['B徽记'])
    expect(snapshot?.sources.map(source => source.name)).not.toContain('A密钥')
  })

  it('切换到 Work B 后不能采纳 Work A 节点图的候选', async () => {
    const { a, b } = await createTwoWorkWorkspace()
    const node = authoringNode('story.theme')
    const flowId = await db.nodeFlows.add(stampNewRecord(a, 'nodeFlows', {
      projectId: a.projectId,
      worldGroupId: null,
      name: 'A节点图',
      description: '',
      graphJson: JSON.stringify({ ...emptyAuthoringGraph(), nodes: [node] }),
      createdAt: 1,
      updatedAt: 1,
    }, { owner: 'work' }) as NodeFlow) as number
    const flow = await db.nodeFlows.get(flowId) as NodeFlow
    await db.projects.update(a.projectId, { activeWorkId: b.workId })

    await expect(adoptAuthoringCandidate({ flow, nodeId: node.id, output: '不得写入 B 的主题' }))
      .rejects.toThrow('不属于当前作品')
    expect(await db.storyCores.count()).toBe(0)
  })
})
