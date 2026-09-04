import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { readOwnedRows, assertRecordInScope, resolveReadScope } from '../../src/lib/workspace/scope'
import type { WorkspaceScope } from '../../src/lib/types/world-ownership'
import { appendAgentEvent, getOrCreateAgentConversation, readAgentEvents } from '../../src/lib/agent/conversations'
import { useCultivationStore } from '../../src/stores/cultivation'
import { acceptCultivationProgressCandidate } from '../../src/lib/cultivation/progress'
import { stringifyCultivationStages } from '../../src/lib/types'
import { useHistoricalStore } from '../../src/stores/historical'
import { useWorldNodeStore } from '../../src/stores/world-node'
import { useCharacterDrivenPlanStore } from '../../src/stores/character-driven-plan'
import { useEmotionBeatStore } from '../../src/stores/emotion-beat'
import { useNoteStore } from '../../src/stores/note'
import { useNodeFlowStore } from '../../src/stores/node-flow'
import { addCurrentWorkFixtureV1, seedCurrentWorkspace } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

async function createGoldenProject(): Promise<{ projectId: number; worldId: number; a: WorkspaceScope; b: WorkspaceScope }> {
  const now = Date.now()
  const root = await seedCurrentWorkspace('C3 Golden Project')
  const projectId = root.scope.projectId
  const worldId = root.scope.worldId
  const workA = root.scope.workId
  await db.worlds.update(worldId, {
    name: '共享世界 Canon',
    description: 'World only',
    updatedAt: now,
  })
  const workBRoot = await addCurrentWorkFixtureV1({
    projectId,
    worldId,
    create: { title: '作品 B', targetWordCount: 50_000 },
    now,
  })
  const workB = workBRoot.id!
  return {
    projectId,
    worldId,
    a: { projectId, worldId, workId: workA },
    b: { projectId, worldId, workId: workB },
  }
}

describe('WORLD-2C C3 · scope-aware world/work chain', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('同一 World 下两部 Work 的故事核心与正文上下文严格隔离', async () => {
    const { a, b } = await createGoldenProject()
    const now = Date.now()
    const outlineA = await db.outlineNodes.add({
      projectId: a.projectId, workId: a.workId, worldId: null, parentId: null,
      type: 'chapter', title: 'A 章纲', summary: 'A only', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const outlineB = await db.outlineNodes.add({
      projectId: b.projectId, workId: b.workId, worldId: null, parentId: null,
      type: 'chapter', title: 'B 章纲', summary: 'B only', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const chapterA = await db.chapters.add({
      projectId: a.projectId, workId: a.workId, outlineNodeId: outlineA, title: 'A 正文',
      content: '<p>A only prose</p>', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    await db.chapters.add({
      projectId: b.projectId, workId: b.workId, outlineNodeId: outlineB, title: 'B 正文',
      content: '<p>B only prose</p>', order: 0, createdAt: now, updatedAt: now,
    } as any)
    await db.storyCores.bulkAdd([
      { projectId: a.projectId, workId: a.workId, worldId: null, theme: 'A theme', createdAt: now, updatedAt: now },
      { projectId: b.projectId, workId: b.workId, worldId: null, theme: 'B theme', createdAt: now, updatedAt: now },
    ] as any)
    await finalizeCurrentFixtureV1(a.projectId)

    const contextA = await assembleContext({
      projectId: a.projectId, scope: a, sourceKeys: ['storyCore', 'chapterContent'], chapterId: chapterA,
    })
    expect(contextA.text).toContain('A theme')
    expect(contextA.text).toContain('A only prose')
    expect(contextA.text).not.toContain('B theme')
    expect(contextA.text).not.toContain('B only prose')

    const contextB = await assembleContext({
      projectId: b.projectId, scope: b, sourceKeys: ['storyCore'],
    })
    expect(contextB.text).toContain('B theme')
    expect(contextB.text).not.toContain('A theme')
  })

  it('结构化写回按 Work owner 定位，不能用另一部作品的 recordId 越界更新', async () => {
    const { a, b } = await createGoldenProject()
    const now = Date.now()
    const [aId, bId] = await db.storyCores.bulkAdd([
      { projectId: a.projectId, workId: a.workId, worldId: null, theme: 'old A', createdAt: now, updatedAt: now },
      { projectId: b.projectId, workId: b.workId, worldId: null, theme: 'old B', createdAt: now, updatedAt: now },
    ] as any, { allKeys: true }) as number[]
    await finalizeCurrentFixtureV1(a.projectId)

    const writtenA = await adopt({
      projectId: a.projectId, scope: a, target: 'storyCores',
      mode: 'replace', data: { theme: 'new A' },
    })
    expect(writtenA.written).toHaveLength(1)
    expect((await db.storyCores.get(aId))?.theme).toBe('new A')
    expect((await db.storyCores.get(bId))?.theme).toBe('old B')

    const crossScope = await adopt({
      projectId: a.projectId, scope: a, target: 'storyCores',
      mode: 'replace', data: { theme: 'must not touch B' },
    })
    expect(crossScope.written).toHaveLength(1)
    expect((await db.storyCores.get(aId))?.theme).toBe('must not touch B')
    expect((await db.storyCores.get(bId))?.theme).toBe('old B')
  })

  it('selector 和 owner gate 只返回当前 scope，互斥 owner 或错 scope 均拒绝', async () => {
    const { a, b } = await createGoldenProject()
    const now = Date.now()
    const row = await db.storyCores.add({
      projectId: a.projectId, workId: a.workId, worldId: null, theme: 'A', createdAt: now, updatedAt: now,
    } as any) as number
    await finalizeCurrentFixtureV1(a.projectId)
    const owned = await readOwnedRows<any>(b, 'storyCores', { owner: 'work' })
    expect(owned).toEqual([])
    expect(await assertRecordInScope(a, 'storyCores', await db.storyCores.get(row), { owner: 'work' })).toBe(true)
    expect(await assertRecordInScope(b, 'storyCores', await db.storyCores.get(row), { owner: 'work' })).toBe(false)
    await expect(resolveReadScope({
      scope: { projectId: a.projectId, worldId: 0, workId: 0 },
    })).rejects.toThrow('WorkspaceScope 必须包含有效')
    await expect(adopt({
      projectId: a.projectId, scope: { ...a, workId: 999999 }, target: 'storyCores', mode: 'replace', data: { theme: 'bad' },
    })).rejects.toThrow('WorkspaceScope')
  })

  it('Agent 对话与事件流按 Work 隔离，不能读取另一部作品的运行记录', async () => {
    const { a, b } = await createGoldenProject()
    const conversationA = await getOrCreateAgentConversation({
                                                               purpose: 'test:r-world2c-c3-scope-aware:1', projectId: a.projectId, worldGroupId: null, scope: a })
    const conversationB = await getOrCreateAgentConversation({
                                                               purpose: 'test:r-world2c-c3-scope-aware:2', projectId: b.projectId, worldGroupId: null, scope: b })
    await appendAgentEvent({ projectId: a.projectId, scope: a, conversationId: conversationA.id!, kind: 'message', role: 'user', content: 'A event' })
    await appendAgentEvent({ projectId: b.projectId, scope: b, conversationId: conversationB.id!, kind: 'message', role: 'user', content: 'B event' })
    expect((await readAgentEvents(conversationA.id!, a)).map(event => event.content)).toEqual(['A event'])
    expect((await readAgentEvents(conversationB.id!, b)).map(event => event.content)).toEqual(['B event'])
    expect(await readAgentEvents(conversationB.id!, a)).toEqual([])
  })

  it('ownership 就绪后的上游设定仍绑定 World，正文产物只写入当前 Work', async () => {
    const { a, b } = await createGoldenProject()
    await db.works.update(a.workId, { includeCultivationProgressInAI: true })
    const systemId = await useCultivationStore.getState().addSystem({
      projectId: a.projectId,
      worldGroupId: null,
      name: '剑修',
      description: '',
      stages: stringifyCultivationStages([
        { id: 'foundation', name: '筑基境', parentStageIds: [] },
      ]),
    })
    expect((await db.cultivationSystems.get(systemId) as any)?.worldId).toBe(a.worldId)
    const historicalEventId = await useHistoricalStore.getState().addEvent({
      projectId: a.projectId,
      worldGroupId: null,
      era: 'custom',
      year: 1,
      date: '元年',
      title: '世界建立',
      description: '',
      isHistorical: false,
    })
    expect((await db.historicalTimelineEvents.get(historicalEventId) as any)?.worldId).toBe(a.worldId)
    const worldNodeId = await useWorldNodeStore.getState().createNode({
      projectId: a.projectId,
      worldGroupId: null,
      parentId: null,
      name: '主世界',
      description: '',
      sortOrder: 0,
    })
    expect((await db.worldNodes.get(worldNodeId) as any)?.worldId).toBe(a.worldId)
    const planId = await useCharacterDrivenPlanStore.getState().createPlan(a.projectId, '作品 A 方案')
    await useCharacterDrivenPlanStore.getState().setActivePlan(a.projectId, planId)
    expect((await db.characterDrivenPlans.get(planId) as any)?.workId).toBe(a.workId)
    expect((await db.works.get(a.workId))?.activeCharacterDrivenPlanId).toBe(planId)
    expect(await readOwnedRows(b, 'characterDrivenPlans', { owner: 'work' })).toEqual([])

    const now = Date.now()
    const characterId = await db.characters.add({
      projectId: a.projectId, worldId: a.worldId, name: '林舟',
      roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful',
      homeWorldGroupId: null, isCrossWorld: false,
      cultivationSystemId: systemId, cultivationStageId: 'foundation',
      createdAt: now, updatedAt: now,
    } as any) as number
    const outlineId = await db.outlineNodes.add({
      projectId: a.projectId, workId: a.workId, worldId: null, parentId: null,
      type: 'chapter', title: '筑基', summary: '', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const chapterId = await db.chapters.add({
      projectId: a.projectId, workId: a.workId, outlineNodeId: outlineId, title: '筑基',
      content: '<p>林舟在生死关头凝成道基，正式踏入筑基境。</p>',
      wordCount: 22, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
    } as any) as number
    await finalizeCurrentFixtureV1(a.projectId)
    const beatId = await useEmotionBeatStore.getState().saveCard({
      projectId: a.projectId,
      chapterId,
      chapterTitle: '筑基',
      overallArc: '绝境到突破',
      beats: [],
      source: 'manual',
    })
    const noteId = await useNoteStore.getState().addNote(a.projectId, '只属于作品 A', chapterId)
    expect((await db.emotionBeatCards.get(beatId) as any)?.workId).toBe(a.workId)
    expect((await db.notes.get(noteId) as any)?.workId).toBe(a.workId)
    expect(await readOwnedRows(b, 'emotionBeatCards', { owner: 'work' })).toEqual([])
    expect(await readOwnedRows(b, 'notes', { owner: 'work' })).toEqual([])
    await adopt({
      projectId: a.projectId, scope: a, target: 'userStyleProfiles', mode: 'replace',
      data: {
        profile: '作品 A 的克制文风', enabled: true,
        sourceChapterIds: [chapterId], sampleCount: 1, sampleWords: 22,
      },
    })
    expect((await db.userStyleProfiles.where('projectId').equals(a.projectId).first() as any)?.workId).toBe(a.workId)
    expect(await readOwnedRows(b, 'userStyleProfiles', { owner: 'work' })).toEqual([])
    const flowId = await useNodeFlowStore.getState().createFlow(a.projectId, null)
    expect((await db.nodeFlows.get(flowId) as any)?.workId).toBe(a.workId)
    expect(await readOwnedRows(b, 'nodeFlows', { owner: 'work' })).toEqual([])

    const progressId = await acceptCultivationProgressCandidate({
      projectId: a.projectId,
      chapterId,
      candidate: {
        characterId,
        cultivationSystemId: systemId,
        stageId: 'foundation',
        transition: 'enter',
        trigger: '生死关头凝成道基',
        evidenceQuote: '生死关头凝成道基',
        sourceOffset: 3,
      },
    })
    expect((await db.cultivationProgress.get(progressId) as any)?.workId).toBe(a.workId)
    expect(await readOwnedRows(a, 'cultivationProgress', { owner: 'work' })).toHaveLength(1)
    expect(await readOwnedRows(b, 'cultivationProgress', { owner: 'work' })).toEqual([])
  })
})
