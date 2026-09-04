import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { stringifyStages } from '../../src/lib/types'
import {
  acceptStorylineCrossingCandidate,
  acceptStorylineProgressCandidate,
  parseStorylineProgressResult,
  readStorylineProgressContext,
} from '../../src/lib/storyline/storyline-progress'
import {
  deleteStoryArcLifecycle,
  detachStorylineForDeletedChapters,
  updateStoryArcStagesLifecycle,
} from '../../src/lib/storyline/lifecycle'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { useChapterStore } from '../../src/stores/chapter'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const now = 1_800_000_000_000

async function seed() {
  const { scope } = await seedCurrentWorkspace('故事线测试')
  const { projectId } = scope
  const volumeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId,
    parentId: null,
    type: 'volume',
    title: '第一卷',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const nodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId,
    parentId: volumeId,
    type: 'chapter',
    title: '雨夜相逢',
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId,
    outlineNodeId: nodeId,
    title: '雨夜相逢',
    content: '<p>林飞在雨夜交出了青铜钥匙。</p>',
    wordCount: 15,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const arcA = await db.storyArcs.add(stampNewRecord(scope, 'storyArcs', {
    projectId,
    name: '寻钥主线',
    type: 'main',
    stages: stringifyStages([{
      id: 'find-key',
      title: '找到钥匙',
      description: '得到钥匙',
      keyEvents: [],
    }]),
    description: '',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const arcB = await db.storyArcs.add(stampNewRecord(scope, 'storyArcs', {
    projectId,
    name: '师徒支线',
    type: 'sub',
    stages: stringifyStages([{
      id: 'trust',
      title: '建立信任',
      description: '交付信物',
      keyEvents: [],
    }]),
    description: '',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const arcs = await db.storyArcs.where('projectId').equals(projectId).toArray()
  return { projectId, scope, chapterId, arcA, arcB, arcs }
}

describe('Phase 39 · 动态故事线进度闭环', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('解析器只接受登记 arc/stage 与正文逐字证据，并规范化交汇端点', async () => {
    const { arcA, arcB, arcs } = await seed()
    const content = '林飞在雨夜交出了青铜钥匙。'
    const result = parseStorylineProgressResult({
      chapterContent: content,
      arcs,
      raw: JSON.stringify({
        progress: [
          {
            arcId: arcA,
            currentStageId: 'find-key',
            status: 'active',
            progressNote: '钥匙完成交付',
            involvedEntities: ['林飞', '青铜钥匙', '林飞'],
            quote: '交出了青铜钥匙',
          },
          {
            arcId: arcA,
            currentStageId: 'fake-stage',
            status: 'resolved',
            progressNote: '重复且越界',
            quote: '交出了青铜钥匙',
          },
          {
            arcId: 9999,
            currentStageId: null,
            status: 'active',
            progressNote: '不存在的线',
            quote: '交出了青铜钥匙',
          },
        ],
        crossings: [
          {
            arcIdA: arcB,
            arcIdB: arcA,
            note: '信物交付让两线交汇',
            quote: '林飞在雨夜交出了青铜钥匙',
          },
          {
            arcIdA: arcA,
            arcIdB: arcA,
            note: '自身交汇',
            quote: '交出了青铜钥匙',
          },
        ],
        newArcs: [
          {
            name: '寻钥主线',
            type: 'sub',
            description: '重复登记',
            quote: '交出了青铜钥匙',
          },
          {
            name: '雨夜盟约',
            type: 'sub',
            description: '正文出现新的盟约方向',
            quote: '交出了青铜钥匙',
          },
          {
            name: '幻觉线',
            type: 'sub',
            description: '无证据',
            quote: '正文不存在',
          },
        ],
      }),
    })

    expect(result.progress).toHaveLength(1)
    expect(result.progress[0].involvedEntities).toEqual(['林飞', '青铜钥匙'])
    expect(result.crossings).toEqual([
      expect.objectContaining({ arcIdA: Math.min(arcA, arcB), arcIdB: Math.max(arcA, arcB) }),
    ])
    expect(result.newArcs.map(item => item.name)).toEqual(['雨夜盟约'])
  })

  it('作者采纳经 adopt 落库，同一故事线更新投影而不重复', async () => {
    const { projectId, chapterId, arcA } = await seed()
    const base = {
      kind: 'progress' as const,
      arcId: arcA,
      currentStageId: 'find-key',
      status: 'active' as const,
      progressNote: '钥匙完成交付',
      involvedEntities: ['林飞', '青铜钥匙'],
      evidenceQuote: '交出了青铜钥匙',
    }
    await expect(acceptStorylineProgressCandidate({
      projectId,
      chapterId,
      candidate: { ...base, evidenceQuote: '正文中并不存在的证据' },
    })).rejects.toThrow('候选证据不再成立')
    expect(await db.storylineProgress.count()).toBe(0)

    const firstId = await acceptStorylineProgressCandidate({
      projectId,
      chapterId,
      candidate: base,
    })
    const secondId = await acceptStorylineProgressCandidate({
      projectId,
      chapterId,
      candidate: {
        ...base,
        currentStageId: null,
        status: 'climax',
        progressNote: '钥匙引爆冲突',
      },
    })

    expect(secondId).toBe(firstId)
    expect(await db.storylineProgress.where('projectId').equals(projectId).count()).toBe(1)
    expect((await db.storylineProgress.get(firstId))?.status).toBe('climax')
    expect((await db.storylineProgress.get(firstId))?.currentStageId).toBeNull()
    expect(JSON.parse((await db.storylineProgress.get(firstId))!.involvedEntities)).toEqual(['林飞', '青铜钥匙'])
  })

  it('按规范章序注入上下文，绝不把后续章节的最新投影泄漏给前章', async () => {
    const { projectId, scope, chapterId: earlierChapterId, arcA } = await seed()
    const volume = (await db.outlineNodes.where('projectId').equals(projectId).toArray())
      .find(node => node.type === 'volume')!
    const laterNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
      projectId,
      parentId: volume.id!,
      type: 'chapter',
      title: '终局',
      summary: '',
      order: 1,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }) as never) as number
    const laterChapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
      projectId,
      outlineNodeId: laterNodeId,
      title: '终局',
      content: '<p>青铜钥匙在终局彻底碎裂。</p>',
      wordCount: 14,
      status: 'draft',
      order: 0,
      notes: '',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }) as never) as number
    await acceptStorylineProgressCandidate({
      projectId,
      chapterId: laterChapterId,
      candidate: {
        kind: 'progress',
        arcId: arcA,
        currentStageId: 'find-key',
        status: 'resolved',
        progressNote: '钥匙线在终局完结',
        involvedEntities: ['青铜钥匙'],
        evidenceQuote: '青铜钥匙在终局彻底碎裂',
      },
    })

    expect(await readStorylineProgressContext(projectId, earlierChapterId)).toBe('')
    expect(await readStorylineProgressContext(projectId, laterChapterId)).toContain('钥匙线在终局完结')
  })

  it('删章保留证据并断 FK；删故事线级联清理进度和相关交汇', async () => {
    const { projectId, chapterId, arcA, arcB } = await seed()
    await acceptStorylineProgressCandidate({
      projectId,
      chapterId,
      candidate: {
        kind: 'progress',
        arcId: arcA,
        currentStageId: 'find-key',
        status: 'active',
        progressNote: '钥匙完成交付',
        involvedEntities: ['林飞'],
        evidenceQuote: '交出了青铜钥匙',
      },
    })
    await acceptStorylineCrossingCandidate({
      projectId,
      chapterId,
      candidate: {
        kind: 'crossing',
        arcIdA: arcA,
        arcIdB: arcB,
        note: '主支线交汇',
        evidenceQuote: '交出了青铜钥匙',
      },
    })

    expect(await detachStorylineForDeletedChapters([chapterId]))
      .toEqual({ progressTouched: 1, crossingsTouched: 1 })
    const progress = await db.storylineProgress.where('projectId').equals(projectId).first()
    const crossing = await db.storylineCrossings.where('projectId').equals(projectId).first()
    expect(progress?.lastActiveChapterId).toBeNull()
    expect(progress?.lastActiveChapterTitle).toBe('雨夜相逢')
    expect(crossing?.chapterId).toBeNull()
    expect(crossing?.chapterTitle).toBe('雨夜相逢')

    await deleteStoryArcLifecycle(arcA)
    expect(await db.storyArcs.get(arcA)).toBeUndefined()
    expect(await db.storylineProgress.count()).toBe(0)
    expect(await db.storylineCrossings.count()).toBe(0)
    expect(await db.storyArcs.get(arcB)).toBeDefined()
  })

  it('作者删除静态阶段时自动清空悬空 currentStageId，但保留动态说明', async () => {
    const { projectId, chapterId, arcA } = await seed()
    await acceptStorylineProgressCandidate({
      projectId,
      chapterId,
      candidate: {
        kind: 'progress',
        arcId: arcA,
        currentStageId: 'find-key',
        status: 'active',
        progressNote: '钥匙完成交付',
        involvedEntities: ['林飞'],
        evidenceQuote: '交出了青铜钥匙',
      },
    })
    await updateStoryArcStagesLifecycle({ arcId: arcA, stages: '[]', validStageIds: [] })

    const progress = await db.storylineProgress.where('arcId').equals(arcA).first()
    expect(progress?.currentStageId).toBeNull()
    expect(progress?.progressNote).toBe('钥匙完成交付')
    expect((await db.storyArcs.get(arcA))?.stages).toBe('[]')
  })

  it('章节 store 的唯一删除入口会同步断开故事线动态 FK', async () => {
    const { projectId, chapterId, arcA } = await seed()
    await acceptStorylineProgressCandidate({
      projectId,
      chapterId,
      candidate: {
        kind: 'progress',
        arcId: arcA,
        currentStageId: 'find-key',
        status: 'active',
        progressNote: '钥匙完成交付',
        involvedEntities: ['林飞'],
        evidenceQuote: '交出了青铜钥匙',
      },
    })
    const chapter = (await db.chapters.get(chapterId))!
    useChapterStore.setState({ chapters: [chapter], currentChapter: chapter })
    await useChapterStore.getState().cascadeDeleteChapters([chapterId])

    expect(await db.chapters.get(chapterId)).toBeUndefined()
    expect((await db.storylineProgress.where('arcId').equals(arcA).first())?.lastActiveChapterId).toBeNull()
    expect(useChapterStore.getState().currentChapter).toBeNull()
  })

  it('确认数据进入生成上下文，且导出导入后 arc/chapter FK 正确重映射', async () => {
    const { projectId, chapterId, arcA, arcB } = await seed()
    await acceptStorylineProgressCandidate({
      projectId,
      chapterId,
      candidate: {
        kind: 'progress',
        arcId: arcA,
        currentStageId: 'find-key',
        status: 'active',
        progressNote: '钥匙完成交付',
        involvedEntities: ['林飞'],
        evidenceQuote: '交出了青铜钥匙',
      },
    })
    await acceptStorylineCrossingCandidate({
      projectId,
      chapterId,
      candidate: {
        kind: 'crossing',
        arcIdA: arcA,
        arcIdB: arcB,
        note: '主支线交汇',
        evidenceQuote: '交出了青铜钥匙',
      },
    })

    const context = await readStorylineProgressContext(projectId)
    expect(context).toContain('作者确认的故事线当前进度')
    expect(context).toContain('寻钥主线')
    expect(context).toContain('师徒支线')
    const assembled = await assembleContext({
      projectId,
      chapterId,
      sourceKeys: ['storylineProgress'],
    })
    expect(assembled.included).toEqual(['storylineProgress'])
    expect(assembled.text).toContain('主支线交汇')

    const exported = await deriveExportProjectJSON(projectId)
    const importedProjectId = await deriveImportProjectJSON(exported)
    const importedArcs = await db.storyArcs.where('projectId').equals(importedProjectId).toArray()
    const importedChapters = await db.chapters.where('projectId').equals(importedProjectId).toArray()
    const importedProgress = await db.storylineProgress.where('projectId').equals(importedProjectId).first()
    const importedCrossing = await db.storylineCrossings.where('projectId').equals(importedProjectId).first()

    expect(importedProgress).toBeDefined()
    expect(importedArcs.some(arc => arc.id === importedProgress!.arcId && arc.name === '寻钥主线')).toBe(true)
    expect(importedChapters.some(chapter => chapter.id === importedProgress!.lastActiveChapterId)).toBe(true)
    expect(importedCrossing).toBeDefined()
    expect(importedArcs.some(arc => arc.id === importedCrossing!.arcIdA)).toBe(true)
    expect(importedArcs.some(arc => arc.id === importedCrossing!.arcIdB)).toBe(true)
    expect(importedChapters.some(chapter => chapter.id === importedCrossing!.chapterId)).toBe(true)
  })
})
