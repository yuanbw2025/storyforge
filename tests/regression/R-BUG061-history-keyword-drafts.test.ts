import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createHistoryKeywordDraftV1, copyHistoryKeywordDraftSetV1, selectHistoryKeywordDraftV1, deleteHistoryKeywordDraftV1, readHistoryKeywordDraftsV1, saveHistoryKeywordDraftsV1 } from '../../src/lib/history/keyword-drafts'
import { scopeTransactionTables } from '../../src/lib/workspace/scope'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })
async function fixture() {
  const f = await seedCurrentWorkspace('061 独立关键词草稿')
  const first = { ...createHistoryKeywordDraftV1('灰潮钱'), description: '独立内容 α\n尾空格  ', conceptNote: '作者自己的想法 Ω' }
  const second = { ...createHistoryKeywordDraftV1('灰潮钱'), description: '同名不同义的另一份内容', category: 'economy' as const }
  return { ...f, origin: { scope: f.scope, worldGroupId: null }, value: { version: 1 as const, drafts: [first, second] } }
}
it('keeps independent author drafts and cancellation/deletion undo never clears prose or creates a formal keyword', async () => {
  const f = await fixture()
  expect(await readHistoryKeywordDraftsV1(f.origin)).toEqual({ revision: null, value: { version: 1, drafts: [] } })
  expect(await db.agentConversations.count()).toBe(0)
  let value = selectHistoryKeywordDraftV1(f.value, f.value.drafts[0].draftId, true)
  value = selectHistoryKeywordDraftV1(value, f.value.drafts[0].draftId, false)
  expect(value).toEqual(f.value)
  value = deleteHistoryKeywordDraftV1(value, f.value.drafts[0].draftId, true)
  expect(value.drafts[0]).toMatchObject({ deleted: true, selected: false, description: f.value.drafts[0].description })
  value = deleteHistoryKeywordDraftV1(value, f.value.drafts[0].draftId, false)
  expect(value).toEqual(f.value)
  const saved = await saveHistoryKeywordDraftsV1({ ...f.origin, expectedRevision: null, value })
  expect(await readHistoryKeywordDraftsV1(f.origin)).toEqual(saved)
  expect(await db.historicalKeywords.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
  expect(await db.agentEvents.count()).toBe(1)
  expect(await saveHistoryKeywordDraftsV1({ ...f.origin, expectedRevision: saved.revision, value })).toEqual(saved)
  expect(await db.agentEvents.count()).toBe(1)
})
it('refuses stale-window saves and malformed or forged identities without losing the current draft set', async () => {
  const f = await fixture(), initial = await saveHistoryKeywordDraftsV1({ ...f.origin, expectedRevision: null, value: f.value })
  const value = structuredClone(f.value); value.drafts[0].keyword = '作者改名不串到另一个草稿'
  const saved = await saveHistoryKeywordDraftsV1({ ...f.origin, expectedRevision: initial.revision, value })
  await expect(saveHistoryKeywordDraftsV1({ ...f.origin, expectedRevision: initial.revision, value: f.value })).rejects.toThrow('其他窗口')
  expect(await readHistoryKeywordDraftsV1(f.origin)).toEqual(saved)
  expect(saved.value.drafts[1]).toEqual(f.value.drafts[1])
  expect(() => copyHistoryKeywordDraftSetV1({ ...f.value, drafts: [{ ...f.value.drafts[0], projectId: f.scope.projectId }] })).toThrow()
  expect(() => copyHistoryKeywordDraftSetV1({ ...f.value, drafts: [f.value.drafts[0], f.value.drafts[0]] })).toThrow('身份')
})
it('rolls back new channel and draft together when the original caller aborts or the native draft write fails', async () => {
  const f = await fixture()
  await expect(db.transaction('rw', scopeTransactionTables(db.worldGroups, db.agentConversations, db.agentEvents), async () => {
    await saveHistoryKeywordDraftsV1({ ...f.origin, expectedRevision: null, value: f.value })
    throw Error('original caller aborted')
  })).rejects.toThrow('original caller aborted')
  expect(await db.agentConversations.count()).toBe(0);expect(await db.agentEvents.count()).toBe(0)
  vi.spyOn(db.agentEvents, 'add').mockRejectedValueOnce(new DOMException('local quota', 'QuotaExceededError'))
  await expect(saveHistoryKeywordDraftsV1({ ...f.origin, expectedRevision: null, value: f.value })).rejects.toThrow('local quota')
  expect(await db.agentConversations.count()).toBe(0);expect(await db.agentEvents.count()).toBe(0)
  expect(f.value.drafts[0].description).toContain('尾空格  ')
})
it('isolates actual Work and World partitions, denies readonly overview and never borrows a Work for World-only authoring', async () => {
  const f = await fixture(), other = await seedCurrentWorkspace('其他作品')
  await expect(saveHistoryKeywordDraftsV1({ ...f.origin, scope: { ...f.scope, workId: other.scope.workId }, expectedRevision: null, value: f.value })).rejects.toThrow()
  await db.projects.update(f.scope.projectId, { enableMultiWorld: true })
  await expect(saveHistoryKeywordDraftsV1({ ...f.origin, expectedRevision: null, value: f.value })).rejects.toThrow('具体历史分区')
  const now = Date.now(), groupId = await db.worldGroups.add({ projectId: f.scope.projectId, worldId: f.scope.worldId, name: '灰潮世界组', icon: '🌊', order: 0, createdAt: now, updatedAt: now }) as number
  const origin = { ...f.origin, worldGroupId: groupId }
  const saved = await saveHistoryKeywordDraftsV1({ ...origin, expectedRevision: null, value: f.value })
  expect((await readHistoryKeywordDraftsV1(origin)).revision).toBe(saved.revision)
  expect(await readHistoryKeywordDraftsV1({ scope: other.scope, worldGroupId: null })).toMatchObject({ revision: null })
  await db.projects.update(f.scope.projectId, { workspacePurpose: 'world-engine' })
  await expect(readHistoryKeywordDraftsV1(origin)).rejects.toThrow('原长篇')
})
it('backs up independent draft text and selection through original registered messages, and original Work deletion removes only its own draft channel', async () => {
  const f = await fixture(), value = selectHistoryKeywordDraftV1(f.value, f.value.drafts[1].draftId, true)
  await saveHistoryKeywordDraftsV1({ ...f.origin, expectedRevision: null, value })
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const project = (await db.projects.get(imported))!
  const copy = { scope: { projectId: imported, worldId: project.activeWorldId!, workId: project.activeWorkId! }, worldGroupId: null }
  expect((await readHistoryKeywordDraftsV1(copy)).value).toEqual(value)
  await deleteWork(f.scope.workId)
  expect(await db.agentConversations.where('projectId').equals(f.scope.projectId).count()).toBe(0)
  expect(await db.agentEvents.where('projectId').equals(f.scope.projectId).count()).toBe(0)
  expect((await readHistoryKeywordDraftsV1(copy)).value).toEqual(value)
}, 15000)
