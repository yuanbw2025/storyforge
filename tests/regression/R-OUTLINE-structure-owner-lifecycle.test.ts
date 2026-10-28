import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useOutlineStore } from '../../src/stores/outline'
import { useChapterStore } from '../../src/stores/chapter'
import { useDetailedOutlineStore } from '../../src/stores/detailed-outline'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { Chapter } from '../../src/lib/types'

async function seed() {
  const { scope } = await seedCurrentWorkspace('大纲结构原子性')
  const store = useOutlineStore.getState()
  await store.loadAll(scope)
  const root = await store.addNode({ projectId: scope.projectId, parentId: null, type: 'volume', title: '原卷', summary: '', order: 0 })
  const child = await store.addNode({ projectId: scope.projectId, parentId: root, type: 'chapter', title: '原章', summary: '不可丢失的章纲', order: 0 })
  return { scope, root, child }
}
describe('outline structural operations preserve the original Work and full deletion lifecycle', () => {
  beforeEach(async () => {
    await db.delete(); await db.open()
    useOutlineStore.setState({ nodes: [], loading: false, loadedScope: null, loadError: null })
    useChapterStore.setState({ chapters: [], currentChapter: null, loading: false })
    useDetailedOutlineStore.setState({ detailedOutlines: [], loading: false })
  })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('rejects deletion of a record outside the displayed Work', async () => {
    const { scope } = await seed()
    const other = await seedCurrentWorkspace('另一作品')
    await useOutlineStore.getState().loadAll(other.scope)
    const foreign = await useOutlineStore.getState().addNode({ projectId: other.scope.projectId, parentId: null, type: 'volume', title: '外部原卷', summary: '', order: 0 })
    await useOutlineStore.getState().loadAll(scope)
    const before = await db.outlineNodes.get(foreign)
    await expect(useOutlineStore.getState().deleteNode(foreign)).rejects.toThrow(/作品|归属/)
    expect(await db.outlineNodes.get(foreign)).toEqual(before)
  })
  it('deletes authoritative descendants even when the UI cache does not contain them', async () => {
    const { root, child } = await seed()
    useOutlineStore.setState(state => ({ nodes: state.nodes.filter(node => node.id !== child) }))
    await useOutlineStore.getState().deleteNode(root)
    expect(await db.outlineNodes.get(root)).toBeUndefined()
    expect(await db.outlineNodes.get(child)).toBeUndefined()
  })
  it('rolls back the entire subtree, linked prose, scenes and caches when deleting the root fails', async () => {
    const { scope, root, child } = await seed()
    const chapter = await db.chapters.add(stampNewRecord(scope, 'chapters', {
      projectId: scope.projectId, outlineNodeId: child, title: '原章', content: '<p>作者不可丢失的正文</p>', wordCount: 12, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1,
    } as Chapter)) as number
    await useChapterStore.getState().loadAll(scope); useChapterStore.getState().selectChapter(chapter)
    const detail = await useDetailedOutlineStore.getState().getOrCreate(scope, child)
    const before = await db.outlineNodes.toArray()
    const originalDelete = db.outlineNodes.delete.bind(db.outlineNodes)
    vi.spyOn(db.outlineNodes, 'delete').mockImplementation(async key => {
      if (key === root) throw new DOMException('根卷删除配额测试', 'QuotaExceededError')
      return originalDelete(key)
    })
    await expect(useOutlineStore.getState().deleteNode(root)).rejects.toThrow('根卷删除配额测试')
    expect(await db.outlineNodes.toArray()).toEqual(before)
    expect(await db.chapters.get(chapter)).toMatchObject({ content: '<p>作者不可丢失的正文</p>' })
    expect(await db.detailedOutlines.get(detail.id!)).toEqual(detail)
    expect(useChapterStore.getState().currentChapter?.id).toBe(chapter)
    expect(useDetailedOutlineStore.getState().detailedOutlines).toContainEqual(detail)
  })
  it('rejects a mixed-owner reorder without changing any original order', async () => {
    const { child } = await seed()
    const other = await seedCurrentWorkspace('另一作品')
    await useOutlineStore.getState().loadAll(other.scope)
    const foreign = await useOutlineStore.getState().addNode({ projectId: other.scope.projectId, parentId: null, type: 'chapter', title: '外部章', summary: '', order: 17 })
    const before = await db.outlineNodes.toArray()
    await expect(useOutlineStore.getState().reorderNodes([child, foreign])).rejects.toThrow(/作品|归属|同级/)
    expect(await db.outlineNodes.toArray()).toEqual(before)
  })
  it('rejects a foreign target parent instead of moving a chapter across Works', async () => {
    const { scope, child } = await seed()
    const other = await seedCurrentWorkspace('另一作品')
    await useOutlineStore.getState().loadAll(other.scope)
    const foreign = await useOutlineStore.getState().addNode({ projectId: other.scope.projectId, parentId: null, type: 'volume', title: '外部卷', summary: '', order: 0 })
    await useOutlineStore.getState().loadAll(scope)
    const before = await db.outlineNodes.get(child)
    await expect(useOutlineStore.getState().moveNodeToParent(child, foreign, 0)).rejects.toThrow(/作品|归属|父节点/)
    expect(await db.outlineNodes.get(child)).toEqual(before)
  })
  it('rejects a parent cycle before changing either node', async () => {
    const { root, child } = await seed(); const before = await db.outlineNodes.toArray()
    await expect(useOutlineStore.getState().moveNodeToParent(root, child, 0)).rejects.toThrow(/循环|自身|父节点/)
    expect(await db.outlineNodes.toArray()).toEqual(before)
  })
  it('rolls an insertion back when sibling reordering cannot be saved', async () => {
    const { scope, root, child } = await seed(); const before = await db.outlineNodes.toArray()
    vi.spyOn(db.outlineNodes, 'update').mockRejectedValue(new DOMException('排序配额测试', 'QuotaExceededError'))
    await expect(useOutlineStore.getState().insertNodeAt({ projectId: scope.projectId, parentId: root, type: 'chapter', title: '不能残留的新章', summary: '', order: 0 }, [child], 0)).rejects.toThrow('排序配额测试')
    expect(await db.outlineNodes.toArray()).toEqual(before)
    expect(useOutlineStore.getState().nodes).toEqual(before)
  })
  it('rejects creation beneath a foreign parent without leaving a new row', async () => {
    const { scope } = await seed()
    const other = await seedCurrentWorkspace('另一作品')
    await useOutlineStore.getState().loadAll(other.scope)
    const foreign = await useOutlineStore.getState().addNode({ projectId: other.scope.projectId, parentId: null, type: 'volume', title: '外部卷', summary: '', order: 0 })
    await useOutlineStore.getState().loadAll(scope)
    const before = await db.outlineNodes.toArray()
    await expect(useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId: foreign, type: 'chapter', title: '不得挂错父级', summary: '', order: 0 })).rejects.toThrow(/作品|归属|父节点/)
    expect(await db.outlineNodes.toArray()).toEqual(before)
  })
  it('rolls a multi-root clear back when a later root fails', async () => {
    const { scope, root, child } = await seed()
    const second = await useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId: root, type: 'chapter', title: '第二章原稿', summary: '', order: 1 })
    const before = await db.outlineNodes.toArray()
    const remove = db.outlineNodes.delete.bind(db.outlineNodes)
    vi.spyOn(db.outlineNodes, 'delete').mockImplementation(async id => { if (id === child) throw new Error('批量清空失败'); return remove(id) })
    await expect(useOutlineStore.getState().deleteNodes([child, second])).rejects.toThrow('批量清空失败')
    expect(await db.outlineNodes.toArray()).toEqual(before)
    expect(useOutlineStore.getState().nodes).toEqual(before)
  })
  it('refuses a foreign descendant instead of deleting across its malformed parent reference', async () => {
    const { root, child } = await seed()
    const other = await seedCurrentWorkspace('外部作品')
    await db.outlineNodes.update(child, { projectId: other.scope.projectId, workId: other.scope.workId })
    const before = await db.outlineNodes.toArray()
    await expect(useOutlineStore.getState().deleteNode(root)).rejects.toThrow(/子大纲.*归属/)
    expect(await db.outlineNodes.toArray()).toEqual(before)
  })
  it('rolls back earlier new structures when a later bulk node has a foreign parent', async () => {
    const { scope } = await seed()
    const other = await seedCurrentWorkspace('外部作品')
    const foreign = await db.outlineNodes.add(stampNewRecord(other.scope, 'outlineNodes', { projectId: other.scope.projectId, parentId: null, type: 'volume' as const, title: '外部卷', summary: '', order: 0, createdAt: 1, updatedAt: 1 })) as number
    const before = await db.outlineNodes.toArray()
    await expect(useOutlineStore.getState().addNodes([
      { projectId: scope.projectId, parentId: null, type: 'volume', title: '不得留下半个结构', summary: '', order: 1 },
      { projectId: scope.projectId, parentId: foreign, type: 'storyBlock', title: '非法父级', summary: '', order: 0 },
    ])).rejects.toThrow(/作品|父节点/)
    expect(await db.outlineNodes.toArray()).toEqual(before)
  })
  it('a late creation keeps the original owner without appending into the new displayed Work', async () => {
    const { scope, root } = await seed()
    const other = await seedCurrentWorkspace('新的显示作品')
    const add = db.outlineNodes.add.bind(db.outlineNodes)
    vi.spyOn(db.outlineNodes, 'add').mockImplementation(async row => {
      const id = await add(row)
      useOutlineStore.setState({ loadedScope: other.scope, nodes: [] })
      return id
    })
    const id = await useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId: root, type: 'chapter', title: '旧作品的迟到创建', summary: '', order: 1 })
    expect(await db.outlineNodes.get(id)).toMatchObject({ projectId: scope.projectId, workId: scope.workId })
    expect(useOutlineStore.getState().loadedScope).toEqual(other.scope)
    expect(useOutlineStore.getState().nodes).toEqual([])
  })
  it('an incomplete or mixed-level reorder never changes canonical sibling orders', async () => {
    const { scope, root, child } = await seed()
    await useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId: root, type: 'chapter', title: '另一章', summary: '', order: 1 })
    const before = await db.outlineNodes.toArray()
    await expect(useOutlineStore.getState().reorderNodes([child])).rejects.toThrow(/同级大纲已变化/)
    await expect(useOutlineStore.getState().reorderNodes([root, child])).rejects.toThrow(/同级/)
    expect(await db.outlineNodes.toArray()).toEqual(before)
  })
  it('uses the actual multi-world setting to reject a cross-group move before writing', async () => {
    const { scope, root, child } = await seed()
    const group = async (name: string) => db.worldGroups.add(stampNewRecord(scope, 'worldGroups', { projectId: scope.projectId, name, description: '', type: 'parallel' as const, icon: '🌐', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'world' })) as Promise<number>
    const a = await group('甲世界'), b = await group('乙世界')
    await db.projects.update(scope.projectId, { enableMultiWorld: true })
    await db.outlineNodes.update(root, { worldGroupId: a })
    const target = await useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId: null, type: 'volume', title: '乙世界之卷', summary: '', order: 1, worldGroupId: b })
    await useOutlineStore.getState().loadAll(scope)
    const before = await db.outlineNodes.toArray()
    await expect(useOutlineStore.getState().moveNodeToParent(child, target, 0)).rejects.toThrow(/其他世界分组/)
    expect(await db.outlineNodes.toArray()).toEqual(before)
  })
  it('rejects malformed type and group identities before they can break the next page load', async () => {
    const { scope } = await seed(); const before = await db.outlineNodes.toArray()
    await expect(useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId: null, type: 'unknown' as 'volume', title: '非法类型', summary: '', order: 0 })).rejects.toThrow(/类型/)
    await expect(useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId: null, type: 'volume', title: '非法世界引用', summary: '', order: 0, worldGroupId: 'bad' as unknown as number })).rejects.toThrow(/世界分组/)
    expect(await db.outlineNodes.toArray()).toEqual(before)
  })
})
