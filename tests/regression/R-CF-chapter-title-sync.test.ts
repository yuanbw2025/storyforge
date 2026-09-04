import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useChapterStore } from '../../src/stores/chapter'
import { useOutlineStore } from '../../src/stores/outline'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { seedCurrentProject } from '../helpers/current-workspace'

describe('R-CF-chapter-title-sync: 大纲章名同步正文记录', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useOutlineStore.setState({ nodes: [], loading: false })
    useChapterStore.setState({ chapters: [], currentChapter: null, loading: false })
  })

  afterEach(() => {
    db.close()
  })

  it('修改 chapter 类型大纲节点标题时同步 chapters.title 和当前章节内存', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({
      name: '标题同步', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const outlineNodeId = await db.outlineNodes.add({
      projectId, parentId: null, type: 'chapter',
      title: '旧章名', summary: '', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const chapterId = await db.chapters.add({
      projectId, outlineNodeId, title: '旧章名',
      content: '<p>正文</p>', wordCount: 2, status: 'draft', order: 0, notes: '',
      createdAt: now, updatedAt: now,
    } as any) as number
    await finalizeCurrentFixtureV1(projectId)

    await useOutlineStore.getState().loadAll(projectId)
    await useChapterStore.getState().loadAll(projectId)
    useChapterStore.getState().selectChapter(chapterId)

    await useOutlineStore.getState().updateNode(outlineNodeId, { title: '新章名' })

    expect((await db.chapters.get(chapterId))?.title).toBe('新章名')
    expect(useChapterStore.getState().chapters.find(ch => ch.id === chapterId)?.title).toBe('新章名')
    expect(useChapterStore.getState().currentChapter?.title).toBe('新章名')
  })
})
