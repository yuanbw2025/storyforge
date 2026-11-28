import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import * as sources from '../../src/lib/workspace/scope'
import { scopeTransactionTables, stampNewRecord, resolveScopeLike } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { useHistoricalStore as store } from '../../src/stores/historical'
import { useHistoryStore } from '../../src/stores/project-singletons'
import { useWorldGroupStore } from '../../src/stores/world-group'
import HistoryPanel from '../../src/components/history/HistoryPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot> | undefined, host: HTMLDivElement | undefined
beforeEach(async () => {
  resetPendingEditCoordinatorForTestsV1();await db.delete();await db.open()
  store.setState({ events: [], keywords: [], loadedEventsScope: null, loadedKeywordsScope: null, loading: false, loadingKeywords: false })
  useWorldGroupStore.setState({ groups: [], activeGroupId: null, loadedScope: null, loading: false })
  useHistoryStore.setState({ history: null, loading: false, loadError: null, loadedHistoryAuthorOrigin: null, loadedHistoryAuthorSelection: null })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model/network in history owner test') }))
})
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove();root = undefined;host = undefined
  expect(fetch).not.toHaveBeenCalled();vi.restoreAllMocks();vi.unstubAllGlobals();resetPendingEditCoordinatorForTestsV1();await db.delete()
})
async function fixture(name: string, purpose: 'world-engine' | 'independent-work' = 'independent-work') {
  const f = await seedCurrentWorkspace(name, { purpose })
  const group = await db.worldGroups.add(stampNewRecord(f.scope, 'worldGroups', { projectId: f.scope.projectId, name: `${name}分区`, type: 'primary', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'world' }) as never) as number
  await db.projects.update(f.scope.projectId, { enableMultiWorld: true })
  return { ...f, group, owner: { projectId: f.scope.projectId, worldId: f.scope.worldId } }
}
const keyword = (projectId: number, group: number, text = '本世界词条') => ({ projectId, keyword: text, category: 'technology' as const, era: 'custom' as const, description: '保留原文', worldGroupId: group })
it('uses a real World owner for keyword create/edit/delete without inventing a Work, and rejects foreign partitions atomically', async () => {
  const f = await fixture('无Work世界', 'world-engine'), other = await fixture('外部世界', 'world-engine')
  await db.projects.update(f.scope.projectId, { activeWorkId: null });await db.works.delete(f.scope.workId)
  await expect(resolveScopeLike(f.scope.projectId)).rejects.toThrow()
  const id = await store.getState().addKeyword(keyword(f.scope.projectId, f.group), f.owner)
  const row = (await db.historicalKeywords.get(id))!
  expect(Reflect.get(row, 'worldId')).toBe(f.scope.worldId);expect(Reflect.get(row, 'workId')).toBeUndefined()
  await store.getState().updateKeyword(id, { description: '作者新稿' }, f.owner)
  expect((await db.historicalKeywords.get(id))!.description).toBe('作者新稿')
  const before = await db.historicalKeywords.toArray()
  await expect(store.getState().addKeyword(keyword(f.scope.projectId, other.group), f.owner)).rejects.toThrow('分区不属于')
  await expect(store.getState().addEvent({ projectId: f.scope.projectId, era: 'custom', year: 1, date: '第一纪元', title: '不能跨分区', description: '', isHistorical: false, worldGroupId: other.group }, f.owner)).rejects.toThrow('分区不属于')
  expect(await db.historicalKeywords.toArray()).toEqual(before);expect(await db.historicalTimelineEvents.count()).toBe(0)
  await store.getState().deleteKeyword(id)
  expect(await db.historicalKeywords.get(id)).toBeUndefined()
})
it('never lets a delayed keyword load replace the newly selected World cache', async () => {
  const a = await fixture('甲世界'), b = await fixture('乙世界')
  await store.getState().addKeyword(keyword(a.scope.projectId, a.group, '甲词条'), a.owner)
  await store.getState().addKeyword(keyword(b.scope.projectId, b.group, '乙词条'), b.owner)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), original = sources.readOwnedRows
  let entered = false
  vi.spyOn(sources, 'readOwnedRows').mockImplementation((async (...args: Parameters<typeof original>) => {
    if (args[0].projectId === a.scope.projectId && args[1] === 'historicalKeywords') { entered = true;await gate }
    return original(...args)
  }) as typeof original)
  const late = store.getState().loadKeywords(a.owner)
  await vi.waitFor(() => expect(entered).toBe(true))
  await store.getState().loadKeywords(b.owner)
  expect(store.getState().keywords.map(row => row.keyword)).toEqual(['乙词条'])
  release();await late
  expect(store.getState().loadedKeywordsScope).toEqual(b.owner)
  expect(store.getState().keywords.map(row => row.keyword)).toEqual(['乙词条'])
})
it('does not publish a keyword from an outer transaction that later aborts', async () => {
  const f = await fixture('回滚世界');await store.getState().loadKeywords(f.owner)
  await expect(db.transaction('rw', scopeTransactionTables(db.historicalKeywords, db.worldGroups), async () => {
    await store.getState().addKeyword(keyword(f.scope.projectId, f.group), f.owner)
    expect(store.getState().keywords).toEqual([])
    throw Error('outer author operation failed')
  })).rejects.toThrow('outer author operation failed')
  expect(await db.historicalKeywords.count()).toBe(0);expect(store.getState().keywords).toEqual([])
})
it('binds a single enabled world partition and resets its choice on project switches while foreign cached rows stay hidden', async () => {
  const a = await fixture('甲作品'), b = await fixture('乙作品')
  for (const f of [a, b]) await useHistoryStore.getState().saveForHistoryAuthorV1({ origin: { version: 1, kind: 'work', scope: f.scope }, selection: { kind: 'partition', worldGroupId: f.group }, patch: { overview: `${f.owner.projectId}当前分区历史` } })
  await useWorldGroupStore.getState().loadAll(a.scope)
  useWorldGroupStore.getState().setActiveGroup(a.group)
  host = document.createElement('div');document.body.append(host);root = createRoot(host)
  const render = async (f: typeof a) => { const project = (await db.projects.get(f.scope.projectId))!;await act(async () => root!.render(<ToastProvider><DialogProvider><HistoryPanel project={project}/></DialogProvider></ToastProvider>)) }
  const click = async (text: string) => { await act(async () => [...host!.querySelectorAll('button')].find(button => button.textContent?.trim().endsWith(text))!.click()) }
  const waitText = async (text: string) => { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) });expect(host!.textContent).toContain(text) }) }
  await render(a);await click('历史总述与纪年');await waitText(`${a.owner.projectId}当前分区历史`)
  await render(b)
  expect(host.textContent).not.toContain('甲作品分区');expect(host.textContent).not.toContain(`${a.owner.projectId}当前分区历史`)
  expect(host.textContent).toContain('请切换到具体世界')
  await act(async () => { await useWorldGroupStore.getState().loadAll(b.scope);useWorldGroupStore.getState().setActiveGroup(b.group) })
  await waitText(`${b.owner.projectId}当前分区历史`)
  await click('一览')
  expect(host.textContent).toContain('请切换到具体世界')
  await render(a);await act(async () => { await useWorldGroupStore.getState().loadAll(a.scope);useWorldGroupStore.getState().setActiveGroup(a.group) })
  await waitText(`${a.owner.projectId}当前分区历史`)
})
