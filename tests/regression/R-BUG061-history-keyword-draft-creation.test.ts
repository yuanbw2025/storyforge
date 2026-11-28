import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createHistoryKeywordDraftV1, readHistoryKeywordDraftsV1, saveHistoryKeywordDraftsV1 } from '../../src/lib/history/keyword-drafts'
import { createHistoryKeywordsFromDraftsV1 } from '../../src/lib/history/keyword-draft-creation'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })
async function fixture(sameName = false) {
  const f = await seedCurrentWorkspace('061 手工草稿新建')
  const drafts = [createHistoryKeywordDraftV1('灰潮钱'), createHistoryKeywordDraftV1(sameName ? '灰潮钱' : '鸣潮钱')]
  drafts[0] = { ...drafts[0], selected: true, description: '第一份完整内容\n尾空格  ', conceptNote: '作者意图' }
  const origin = { scope: f.scope, worldGroupId: null }
  const saved = await saveHistoryKeywordDraftsV1({ ...origin, expectedRevision: null, value: { version: 1, drafts } })
  return { ...f, origin, saved }
}
it('creates only selected saved author drafts through original World writer and retains unselected text', async () => {
  const f = await fixture(), result = await createHistoryKeywordsFromDraftsV1({ ...f.origin, expectedRevision: f.saved.revision! })
  const rows = await db.historicalKeywords.toArray()
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({ keyword: '灰潮钱', description: f.saved.value.drafts[0].description, conceptNote: '作者意图', worldId: f.scope.worldId })
  expect(Reflect.get(rows[0], 'workId')).toBeUndefined()
  expect(Reflect.get(rows[0], 'ragDocumentId')).toBe(f.saved.value.drafts[0].draftId)
  expect(result.value.drafts[0].selected).toBe(false);expect(result.value.drafts[1]).toEqual(f.saved.value.drafts[1])
  await expect(createHistoryKeywordsFromDraftsV1({ ...f.origin, expectedRevision: f.saved.revision! })).rejects.toThrow('草稿已变化')
  const selectedAgain = structuredClone(result.value);selectedAgain.drafts[0].selected = true
  const saved = await saveHistoryKeywordDraftsV1({ ...f.origin, expectedRevision: result.revision, value: selectedAgain })
  expect((await createHistoryKeywordsFromDraftsV1({ ...f.origin, expectedRevision: saved.revision! })).created).toEqual(result.created)
  expect(await db.historicalKeywords.count()).toBe(1)
})
it('requires explicit same-name intent, preserves independent identities and never overwrites a later author edit', async () => {
  const f = await fixture(true), value = structuredClone(f.saved.value);value.drafts[1].selected = true
  const saved = await saveHistoryKeywordDraftsV1({ ...f.origin, expectedRevision: f.saved.revision, value })
  await expect(createHistoryKeywordsFromDraftsV1({ ...f.origin, expectedRevision: saved.revision! })).rejects.toThrow('同名')
  expect(await db.historicalKeywords.count()).toBe(0)
  const result = await createHistoryKeywordsFromDraftsV1({ ...f.origin, expectedRevision: saved.revision!, allowSameNames: true })
  expect(await db.historicalKeywords.count()).toBe(2)
  await db.historicalKeywords.update(result.created[0], { description: '正式词条作者后改，不覆盖' })
  const again = structuredClone(result.value);again.drafts[0].selected = true
  const revision = await saveHistoryKeywordDraftsV1({ ...f.origin, expectedRevision: result.revision, value: again })
  await expect(createHistoryKeywordsFromDraftsV1({ ...f.origin, expectedRevision: revision.revision! })).rejects.toThrow('不会覆盖')
  expect((await db.historicalKeywords.get(result.created[0]))!.description).toBe('正式词条作者后改，不覆盖')
})
it('rolls back original formal creation if updating the draft state fails, retaining the selected author text for retry', async () => {
  const f = await fixture()
  vi.spyOn(db.agentEvents, 'add').mockRejectedValueOnce(Error('draft receipt quota fault'))
  await expect(createHistoryKeywordsFromDraftsV1({ ...f.origin, expectedRevision: f.saved.revision! })).rejects.toThrow('draft receipt quota fault')
  expect(await db.historicalKeywords.count()).toBe(0)
  expect(await readHistoryKeywordDraftsV1(f.origin)).toEqual(f.saved)
  const result = await createHistoryKeywordsFromDraftsV1({ ...f.origin, expectedRevision: f.saved.revision! })
  expect(result.created).toHaveLength(1);expect(await db.historicalKeywords.count()).toBe(1)
})
