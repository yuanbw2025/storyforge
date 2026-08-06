import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { resolveScopeLike, stampNewRecord } from '../../src/lib/world-engine/scope'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { runNodeFlow } from '../../src/lib/node-flow/executor'
import {
  buildRagLibrary,
  readRagSelectionContext,
  updateRagDocumentPolicy,
  updateRagFieldPolicy,
} from '../../src/lib/retrieval/rag-library'
import {
  clearProjectRetrievalCache,
  rebuildProjectNarrativeSummaries,
  rebuildProjectRetrievalChunks,
} from '../../src/lib/retrieval/retrieval'
import { createRagSelectionTrace, type NodeFlow, type NodeFlowGraph } from '../../src/lib/types'

async function seedProject() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'RAG 可见资料测试',
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    targetWordCount: 100_000,
    enableMultiWorld: false,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldviewId = await db.worldviews.add({
    projectId,
    worldGroupId: null,
    geography: '',
    history: '',
    society: '',
    culture: '',
    economy: '',
    rules: '力量不可凭空产生。',
    summary: '',
    worldOrigin: '世界诞生于潮汐退去以后。',
    createdAt: now,
    updatedAt: now,
  }) as number
  const characterId = await db.characters.add({
    projectId,
    name: '云无心',
    role: 'protagonist',
    roleWeight: 'main',
    moralAxis: 'good',
    orderAxis: 'neutral',
    shortDescription: '',
    appearance: '',
    personality: '克制而敏锐。',
    background: '很久以前的旧事。'.repeat(120),
    motivation: '',
    abilities: '',
    relationships: '[]',
    arc: '',
    homeWorldGroupId: null,
    isCrossWorld: false,
    createdAt: now,
    updatedAt: now,
  }) as number
  const outlineId = await db.outlineNodes.add({
    projectId,
    parentId: null,
    type: 'chapter',
    title: '第一章',
    summary: '',
    order: 0,
    worldGroupId: null,
    createdAt: now,
    updatedAt: now,
  }) as number
  const chapterId = await db.chapters.add({
    projectId,
    outlineNodeId: outlineId,
    title: '第一章',
    content: '<p>云无心在退潮后的海床上醒来。</p>',
    wordCount: 15,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  }) as number
  return { projectId, worldviewId, characterId, chapterId }
}

describe('RAG-1 · 可见资料与精确字段选择', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('实时投影 Canon、保存字段策略，并按权重/预算生成可审计上下文', async () => {
    const seeded = await seedProject()
    const initial = await buildRagLibrary({ projectId: seeded.projectId, worldGroupId: null })
    const origin = initial.find(entry => entry.tableName === 'worldviews' && entry.fieldKey === 'worldOrigin')!
    const personality = initial.find(entry => entry.tableName === 'characters' && entry.fieldKey === 'personality')!
    const background = initial.find(entry => entry.tableName === 'characters' && entry.fieldKey === 'background')!
    expect(origin.content).toContain('潮汐')
    expect(personality.content).toContain('敏锐')
    expect((await db.worldviews.get(seeded.worldviewId))?.ragDocumentId).toBe(origin.documentId)

    await updateRagDocumentPolicy({
      projectId: seeded.projectId,
      tableName: 'worldviews',
      recordId: seeded.worldviewId,
      patch: { weight: 3 },
    })
    await updateRagFieldPolicy({
      projectId: seeded.projectId,
      tableName: 'characters',
      recordId: seeded.characterId,
      fieldKey: 'background',
      patch: { tokenCap: 100 },
    })

    const trace = createRagSelectionTrace()
    const context = await readRagSelectionContext({
      projectId: seeded.projectId,
      worldGroupId: null,
      entryKeys: [personality.key, background.key, origin.key],
      inputBudgetTokens: 600,
      trace,
    })
    expect(context.indexOf('世界来源')).toBeLessThan(context.indexOf('性格'))
    expect(trace.included.some(label => label.includes('世界来源') && label.includes('权重 3.0'))).toBe(true)
    expect(trace.trimmed.some(label => label.includes('背景'))).toBe(true)
    expect(trace.omitted).toEqual([])

    await updateRagDocumentPolicy({
      projectId: seeded.projectId,
      tableName: 'worldviews',
      recordId: seeded.worldviewId,
      patch: { enabled: false },
    })
    const disabledTrace = createRagSelectionTrace()
    const disabled = await readRagSelectionContext({
      projectId: seeded.projectId,
      entryKeys: [origin.key],
      trace: disabledTrace,
    })
    expect(disabled).toBe('')
    expect(disabledTrace.omitted[0]).toContain('资料库已停用')
    expect((await db.worldviews.get(seeded.worldviewId))?.worldOrigin).toContain('潮汐')
  })

  it('节点执行冻结实际召回，稳定资料键随项目 JSON 往返', async () => {
    const seeded = await seedProject()
    const library = await buildRagLibrary({ projectId: seeded.projectId })
    const personality = library.find(entry => entry.tableName === 'characters' && entry.fieldKey === 'personality')!
    const chapter = library.find(entry => entry.tableName === 'chapters' && entry.fieldKey === 'content')!
    const graph: NodeFlowGraph = {
      version: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [{
        id: 'source',
        kind: 'source.context',
        title: '精确材料',
        x: 0,
        y: 0,
        config: {
          selectionMode: 'exact',
          ragEntryKeys: [personality.key, chapter.key],
          sourceKeys: [],
          inputBudgetTokens: 2000,
        },
        inputSlots: [],
      }],
      edges: [],
    }
    const now = Date.now()
    const scope = await resolveScopeLike(seeded.projectId)
    const flowId = await db.nodeFlows.add(stampNewRecord(scope, 'nodeFlows', {
      projectId: seeded.projectId,
      worldGroupId: null,
      name: '精确资料节点',
      description: '',
      graphJson: JSON.stringify(graph),
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }) as NodeFlow) as number
    const flow = await db.nodeFlows.get(flowId) as NodeFlow
    const outcome = await runNodeFlow({ flow })
    expect(outcome.run.status).toBe('completed')
    expect(outcome.results.source.output).toContain('克制而敏锐')
    expect(outcome.results.source.output).toContain('退潮后的海床')
    expect(outcome.snapshots.source.totalTokens).toBeGreaterThan(0)
    expect(outcome.snapshots.source.sourceEvidence?.included).toHaveLength(2)

    const exported = await exportProjectJSON(seeded.projectId)
    const importedProjectId = await importProjectJSON(exported)
    const importedLibrary = await buildRagLibrary({ projectId: importedProjectId })
    expect(importedLibrary.some(entry => entry.key === personality.key)).toBe(true)
    expect(importedLibrary.some(entry => entry.key === chapter.key)).toBe(true)
    const importedFlow = await db.nodeFlows.where('projectId').equals(importedProjectId).first()
    expect(importedFlow?.graphJson).toContain(personality.key)
    expect(importedFlow?.graphJson).toContain(chapter.key)
  })

  it('重建和删除仅处理派生索引，绝不删除源正文', async () => {
    const seeded = await seedProject()
    const chunks = await rebuildProjectRetrievalChunks({ projectId: seeded.projectId })
    const summaries = await rebuildProjectNarrativeSummaries({ projectId: seeded.projectId })
    expect(chunks.chunks).toBeGreaterThan(0)
    expect(summaries.chapterNodes).toBe(1)

    const cleared = await clearProjectRetrievalCache(seeded.projectId)
    expect(cleared.chunks).toBeGreaterThan(0)
    expect(cleared.summaries).toBeGreaterThan(0)
    expect(await db.retrievalChunks.where('projectId').equals(seeded.projectId).count()).toBe(0)
    expect(await db.narrativeSummaryNodes.where('projectId').equals(seeded.projectId).count()).toBe(0)
    expect((await db.chapters.get(seeded.chapterId))?.content).toContain('退潮后的海床')
  })
})
