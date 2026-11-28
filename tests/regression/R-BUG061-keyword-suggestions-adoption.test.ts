import Dexie from 'dexie'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { adopt } from '../../src/lib/registry/adopt'
import { createHistoryKeywordDraftV1, readHistoryKeywordDraftsV1, saveHistoryKeywordDraftsV1, historyKeywordDraftTransactionTablesV1 } from '../../src/lib/history/keyword-drafts'
import { allocateHistoryKeywordSuggestionIdsV1, parseHistoryKeywordSuggestionsV1, readHistoryKeywordSuggestionsSnapshotV1 } from '../../src/lib/history/keyword-suggestions'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())
async function fixture() {
  const f = await seedCurrentWorkspace('061 关键词推荐转草稿')
  const origin = { scope: f.scope, worldGroupId: null }
  const original = { ...createHistoryKeywordDraftV1('作者先有的词'), conceptNote: '我的原意见', description: '不能覆盖的原草稿\n尾空格  ' }
  await saveHistoryKeywordDraftsV1({ ...origin, expectedRevision: null, value: { version: 1, drafts: [original] } })
  const request = { draftIds: allocateHistoryKeywordSuggestionIdsV1(2) }, snapshot = await readHistoryKeywordSuggestionsSnapshotV1(origin, request)
  const suggestions = request.draftIds.map((draftId,index) => ({ draftId, keyword: `灰潮飞钱${index}`, category: 'economy' as const, era: 'custom', reason: '待确认设想：可补充市井使用场景。' }))
  return { ...f, origin, original, request, snapshot, suggestions }
}
it('does not allow model selection or forged owner/body/identity and denies generic conversation adoption', async () => {
  const f = await fixture()
  expect(parseHistoryKeywordSuggestionsV1(JSON.stringify({ version: 1, suggestions: f.suggestions }), f.request, false).selectedIds).toBeUndefined()
  for (const value of [{ version: 1, suggestions: f.suggestions, selectedIds: f.request.draftIds }, { version: 1, suggestions: [{ ...f.suggestions[0], description: '越权正文' }] }, { version: 1, suggestions: [{ ...f.suggestions[0], draftId: f.original.draftId }] }]) expect(() => parseHistoryKeywordSuggestionsV1(JSON.stringify(value), f.request, false)).toThrow()
  await expect(adopt({ target: 'agentEvents', projectId: f.scope.projectId, scope: f.scope, mode: 'add-many', data: [{ content: '不得伪造作者记录' }] })).rejects.toThrow('专用草稿')
  await expect(adopt({ target: 'agentEvents', mode: 'add-many', historyKeywordSuggestions: f.snapshot, data: { version: 1, suggestions: f.suggestions } })).rejects.toThrow('先选择')
  expect((await readHistoryKeywordDraftsV1(f.origin)).value.drafts).toEqual([f.original])
  expect(await db.historicalKeywords.count()).toBe(0)
})
it('transfers only chosen keywords to independent author drafts without inventing author intent or official settings', async () => {
  const f = await fixture()
  await adopt({ target: 'agentEvents', mode: 'add-many', historyKeywordSuggestions: f.snapshot, data: { version: 1, suggestions: f.suggestions, selectedIds: [f.request.draftIds[1]] } })
  const drafts = (await readHistoryKeywordDraftsV1(f.origin)).value.drafts
  expect(drafts).toHaveLength(2);expect(drafts[0]).toEqual(f.original)
  expect(drafts[1]).toMatchObject({ draftId: f.request.draftIds[1], keyword: f.suggestions[1].keyword, selected: true, description: '', conceptNote: '' })
  expect(JSON.stringify(drafts)).not.toContain(f.suggestions[1].reason)
  expect(await db.historicalKeywords.count()).toBe(0)
})
it('rolls back the draft transfer with the original caller and blocks changed author drafts without overwriting', async () => {
  const f = await fixture(), input = { target: 'agentEvents' as const, mode: 'add-many' as const, historyKeywordSuggestions: f.snapshot, data: { version: 1 as const, suggestions: f.suggestions, selectedIds: f.request.draftIds } }
  await expect(db.transaction('rw', historyKeywordDraftTransactionTablesV1(), async () => { await adopt(input, { transaction: Dexie.currentTransaction! });throw Error('original Run receipt fault') })).rejects.toThrow('original Run receipt fault')
  expect((await readHistoryKeywordDraftsV1(f.origin)).value.drafts).toEqual([f.original])
  const changed = structuredClone(f.snapshot.baseline.value);changed.drafts[0].conceptNote = '作者生成中更新的意见'
  await saveHistoryKeywordDraftsV1({ ...f.origin, expectedRevision: f.snapshot.baseline.revision, value: changed })
  await expect(adopt(input)).rejects.toThrow('作者草稿已变化')
  expect((await readHistoryKeywordDraftsV1(f.origin)).value).toEqual(changed)
})
