import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useChapterStore } from '../../src/stores/chapter'
import { assertChapterEditorSavedV1, createChapterEditorDraftBufferV1 } from '../../src/lib/authoring/chapter-editor-save'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace, currentWorkFixtureRecordV1 } from '../helpers/current-workspace'
const store = useChapterStore
beforeEach(async () => {
  await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1()
  store.setState({ chapters: [], currentChapter: null, loading: false })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model calls') }))
})
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); db.close() })
async function fixture() {
  const { scope } = await seedCurrentWorkspace('正文保存确认')
  const id = await store.getState().addChapter({ projectId: scope.projectId, outlineNodeId: 1, order: 0,
    title: '原章', content: '<p>原文。</p>', wordCount: 3, status: 'draft', notes: '' })
  store.getState().selectChapter(id)
  return { scope, id, before: (await db.chapters.get(id))! }
}

it('acknowledges the exact committed original chapter and checks status only when submitted', async () => {
  const { id, before } = await fixture(), patch = { content: '<p>完整原文🌊。  </p>', wordCount: 6, status: 'final' as const }
  await store.getState().updateChapter(id, patch)
  const actual = await db.chapters.get(id)
  expect(() => assertChapterEditorSavedV1(before, actual, patch)).not.toThrow()
  // A later draft may already be saved; an older status callback may only
  // confirm its status and identity, never replace the newer editor content.
  await store.getState().updateChapter(id, { content: '<p>更新的正文。</p>', wordCount: 6 })
  const newer = await db.chapters.get(id)
  expect(() => assertChapterEditorSavedV1(before, newer, { status: 'final' })).not.toThrow()
  expect(() => assertChapterEditorSavedV1(before, newer, patch)).toThrow('尚未保存成功')
  expect(() => assertChapterEditorSavedV1(before, { ...newer!, ragDocumentId: 'changed' }, {})).toThrow('身份已变化')
})

it('rejects a genuinely deleted chapter and a chapter owned by another Work rather than resolving a false save', async () => {
  const { scope, id, before } = await fixture()
  await db.chapters.delete(id)
  await expect(store.getState().updateChapter(id, { content: 'missing' })).rejects.toThrow('已不存在')
  expect(store.getState().currentChapter?.content).toBe(before.content)
  const otherWork = await db.works.add(currentWorkFixtureRecordV1({ projectId: scope.projectId, worldId: scope.worldId, title: '另一作品' })) as number
  const foreign = stampNewRecord({ ...scope, workId: otherWork }, 'chapters', { ...before, id: undefined, workId: otherWork }, { owner: 'work' })
  const foreignId = await db.chapters.add(foreign) as number
  await expect(store.getState().updateChapter(foreignId, { content: 'wrong owner' })).rejects.toThrow('不属于当前作品')
  expect((await db.chapters.get(foreignId))?.content).toBe(before.content)
})

it('rejects an actual zero-row update when the target disappears between its read and write, and retains a retryable draft', async () => {
  const { id, before } = await fixture(), original = db.chapters.update.bind(db.chapters)
  const drafts = createChapterEditorDraftBufferV1(async draft => {
    await store.getState().updateChapter(draft.chapterId, { content: draft.html, wordCount: 5 })
    assertChapterEditorSavedV1(before, await db.chapters.get(id), { content: draft.html, wordCount: 5 })
  })
  drafts.stage({ chapterId: id, html: '<p>不能丢的新稿。</p>', plainText: '不能丢的新稿。' })
  vi.spyOn(db.chapters, 'update').mockImplementationOnce((key, patch) => db.chapters.delete(key as number).then(() => original(key as number, patch)))
  await expect(drafts.flush()).rejects.toThrow('目标已不存在')
  expect(drafts.hasPending()).toBe(true); expect(await db.chapters.get(id)).toBeUndefined()
  expect(store.getState().currentChapter?.content).toBe(before.content)
  await db.chapters.add(before)
  await drafts.flush(); expect(drafts.hasPending()).toBe(false)
  expect((await db.chapters.get(id))?.content).toBe('<p>不能丢的新稿。</p>')
})

it('requires a real readback even for a no-op callback or unchanged editor buffer', async () => {
  const { id, before } = await fixture()
  await db.chapters.delete(id)
  expect(() => assertChapterEditorSavedV1(before, undefined, { content: before.content, wordCount: before.wordCount })).toThrow('身份已变化')
  await db.chapters.add(before)
  await db.chapters.update(id, { content: '<p>另一处已经修改。</p>' })
  const actual = await db.chapters.get(id)
  expect(() => assertChapterEditorSavedV1(before, actual,
    { content: before.content, wordCount: before.wordCount })).toThrow('尚未保存成功')
})
