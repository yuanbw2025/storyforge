import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useOutlineStore } from '../../src/stores/outline'
import { useChapterStore } from '../../src/stores/chapter'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { Chapter, OutlineNode } from '../../src/lib/types'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

async function seed() {
  const { scope } = await seedCurrentWorkspace('卷章保存原子性')
  await useOutlineStore.getState().loadAll(scope)
  const id = await useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId: null, type: 'chapter', title: '旧章名', summary: '', order: 0 })
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId: scope.projectId, outlineNodeId: id, title: '旧章名', content: '<p>作者原正文</p>', wordCount: 5, status: 'draft', order: 0, notes: '', createdAt: Date.now(), updatedAt: Date.now(),
  } as Chapter)) as number
  await useChapterStore.getState().loadAll(scope); useChapterStore.getState().selectChapter(chapterId)
  return { scope, id, chapterId }
}
describe('outline author save and title synchronization failures', () => {
  beforeEach(async () => { resetPendingEditCoordinatorForTestsV1(); useOutlineStore.setState({ nodes: [], loading: false }); useChapterStore.setState({ chapters: [], currentChapter: null, loading: false }); await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); resetPendingEditCoordinatorForTestsV1(); db.close() })
  it('a linked chapter write failure rolls back both titles and leaves the draft cache unchanged', async () => {
    const { id, chapterId } = await seed(); const before = await db.outlineNodes.get(id)
    vi.spyOn(db.chapters, 'bulkUpdate').mockRejectedValue(new DOMException('正文标题配额测试', 'QuotaExceededError'))
    await expect(useOutlineStore.getState().updateNode(id, { title: '作者新章名' })).rejects.toThrow('正文标题配额测试')
    expect(await db.outlineNodes.get(id)).toEqual(before)
    expect((await db.chapters.get(chapterId))?.title).toBe('旧章名')
    expect(useChapterStore.getState().currentChapter?.title).toBe('旧章名')
  })
  it('bad title data is rejected before it can corrupt the next outline load', async () => {
    const { id } = await seed(); const before = await db.outlineNodes.get(id)
    await expect(useOutlineStore.getState().updateNode(id, { title: ['损坏标题'] as unknown as string })).rejects.toThrow()
    expect(await db.outlineNodes.get(id)).toEqual(before)
  })
  it('author patches cannot change owner identity', async () => {
    const { id } = await seed(); const before = await db.outlineNodes.get(id)
    await expect(useOutlineStore.getState().updateNode(id, { projectId: 9999 })).rejects.toThrow(/作者字段|归属/)
    expect(await db.outlineNodes.get(id)).toEqual(before)
  })
  it('a missing row never acknowledges a phantom save', async () => {
    const { id } = await seed(); await db.outlineNodes.delete(id)
    await expect(useOutlineStore.getState().updateNode(id, { summary: '仍未保存' })).rejects.toThrow(/删除/)
  })
  it('a zero-row write never publishes a new title into the editor cache', async () => {
    const { id } = await seed(); const before = await db.outlineNodes.get(id)
    vi.spyOn(db.outlineNodes, 'update').mockResolvedValue(0)
    await expect(useOutlineStore.getState().updateNode(id, { title: '不存在的保存' })).rejects.toThrow(/删除|保存/)
    expect(useOutlineStore.getState().nodes.find(row => row.id === id)).toEqual(before)
    expect(useChapterStore.getState().currentChapter?.title).toBe('旧章名')
  })
  it('a stale work scope rejects instead of silently succeeding', async () => {
    const { id, scope } = await seed(); const before = await db.outlineNodes.get(id)
    const foreign = await seedCurrentWorkspace('其他作品')
    await db.outlineNodes.update(id, { workId: foreign.scope.workId } as Partial<OutlineNode>)
    await expect(useOutlineStore.getState().updateNode(id, { summary: '错误归属不得写入' })).rejects.toThrow(/作品|归属/)
    expect((await db.outlineNodes.get(id))?.summary).toBe(before?.summary)
    expect((await db.projects.get(scope.projectId))?.activeWorkId).toBe(scope.workId)
  })
  it('a partial chapter-title acknowledgement rolls the outline transaction back', async () => {
    const { id, chapterId } = await seed(); const before = await db.outlineNodes.get(id)
    vi.spyOn(db.chapters, 'bulkUpdate').mockResolvedValue(0)
    await expect(useOutlineStore.getState().updateNode(id, { title: '不得局部成功' })).rejects.toThrow(/未完整保存/)
    expect(await db.outlineNodes.get(id)).toEqual(before)
    expect((await db.chapters.get(chapterId))?.title).toBe('旧章名')
  })
  it('a foreign linked chapter cannot be modified or leave a half-saved outline title', async () => {
    const { id } = await seed(); const before = await db.outlineNodes.get(id)
    const foreign = await seedCurrentWorkspace('外部作品正文')
    const foreignId = await db.chapters.add(stampNewRecord(foreign.scope, 'chapters', {
      projectId: foreign.scope.projectId, outlineNodeId: id, title: '另一本作品的原文', content: '', wordCount: 0, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1,
    } as Chapter))
    await expect(useOutlineStore.getState().updateNode(id, { title: '不得跨作品写入' })).rejects.toThrow(/关联正文.*归属/)
    expect(await db.outlineNodes.get(id)).toEqual(before)
    expect((await db.chapters.get(foreignId))?.title).toBe('另一本作品的原文')
  })
  it('a stale touched-field preimage rejects while unrelated concurrent fields remain editable', async () => {
    const { id, scope } = await seed()
    await db.outlineNodes.update(id, { summary: '另一页面的摘要' })
    await expect(useOutlineStore.getState().updateNode(id, { summary: '不得覆盖' })).rejects.toThrow(/其他页面修改/)
    await useOutlineStore.getState().updateNode(id, { title: '独立字段可以保存' }, { scope, expected: { title: '旧章名' } })
    expect(await db.outlineNodes.get(id)).toMatchObject({ title: '独立字段可以保存', summary: '另一页面的摘要' })
  })
  it('a malformed stored row ends loading, retains the last valid cache and can be read after explicit recovery', async () => {
    const { id, scope } = await seed(); const before = useOutlineStore.getState().nodes
    await db.outlineNodes.update(id, { summary: ['原始异常'] as unknown as string })
    await useOutlineStore.getState().loadAll(scope)
    expect(useOutlineStore.getState()).toMatchObject({ loading: false, nodes: before })
    expect(useOutlineStore.getState().loadError).toContain('summary')
    expect((await db.outlineNodes.get(id))?.summary).toEqual(['原始异常'])
    await db.outlineNodes.update(id, { summary: '明确恢复的内容' })
    await useOutlineStore.getState().loadAll(scope)
    expect(useOutlineStore.getState().loadError).toBeNull()
    expect(useOutlineStore.getState().nodes[0].summary).toBe('明确恢复的内容')
  })
  it('the patch is captured before coordination rather than read later from a mutable caller', async () => {
    const { id } = await seed()
    const patch = { summary: '点击保存时的文本' }
    const pending = useOutlineStore.getState().updateNode(id, patch)
    patch.summary = '调用方之后改动的文本'
    await pending
    expect((await db.outlineNodes.get(id))?.summary).toBe('点击保存时的文本')
  })
})
