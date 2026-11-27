import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import HistoryPanel from '../../src/components/history/HistoryPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import { db } from '../../src/lib/db/schema'
import { useHistoryStore } from '../../src/stores/project-singletons'
import { useHistoricalStore } from '../../src/stores/historical'
import { useWorldGroupStore } from '../../src/stores/world-group'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import type { HistoryAuthorOriginV1 } from '../../src/lib/types/history'
import { stampNewRecord } from '../../src/lib/workspace/scope'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const raw = '# 历史原文\r\n\r\n**事实**：第七年。\r\n\r\n<script>globalThis.historyBad=1</script>\r\n![外图](https://blocked.invalid/history.png)\r\n  '
beforeEach(async () => {
  await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1()
  useHistoryStore.setState({ history: null, loading: false, loadedScope: null, loadError: null, loadedHistoryAuthorOrigin: null, loadedHistoryAuthorSelection: null })
  useHistoricalStore.setState({ events: [], keywords: [], loadedEventsScope: null, loading: false, loadingKeywords: false })
  useWorldGroupStore.setState({ groups: [], links: [], activeGroupId: null, loadedScope: null, loading: false })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No external or model requests') }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); expect(fetch).not.toHaveBeenCalled()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); resetPendingEditCoordinatorForTestsV1(); await db.delete()
})
async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 150; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    if (predicate()) return
  }
  throw Error('History UI did not settle')
}
async function click(label: string, container: HTMLElement = host) {
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === label)!.click())
}
async function input(text: string) {
  const area = host.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, text)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return area
}
async function mount(purpose: 'independent-work' | 'world-engine', seed = true) {
  const fixture = await seedCurrentWorkspace('历史 Markdown', { purpose })
  const origin: HistoryAuthorOriginV1 = purpose === 'world-engine'
    ? { version: 1, kind: 'world', scope: { projectId: fixture.scope.projectId, worldId: fixture.scope.worldId } }
    : { version: 1, kind: 'work', scope: fixture.scope }
  if (seed) await useHistoryStore.getState().saveForHistoryAuthorV1({ origin, selection: { kind: 'partition', worldGroupId: null }, patch: { overview: raw, eraSystem: '# 纪年\r\n\r\n第三纪元。  ' } })
  if (purpose === 'world-engine') { await db.projects.update(fixture.scope.projectId, { activeWorkId: null }); await db.works.delete(fixture.scope.workId) }
  const project = (await db.projects.get(fixture.scope.projectId))!
  await act(async () => root.render(<ToastProvider><DialogProvider><HistoryPanel project={project} /></DialogProvider></ToastProvider>))
  await click('历史总述与纪年')
  await waitFor(() => seed ? host.querySelectorAll('[data-markdown-read-view]').length === 2 : host.querySelectorAll('div.cursor-text').length === 2)
  return fixture
}

it.each(['independent-work', 'world-engine'] as const)('%s reads exact source, edits the first history record, and reopens the committed Markdown', async purpose => {
  const f = await mount(purpose, false)
  await act(async () => host.querySelector<HTMLDivElement>('div.cursor-text')!.click())
  await input('# 首次历史\n\n保留尾部空白与中文🌊。  ')
  await act(async () => { await flushPendingEditsV1() })
  const rows = await db.histories.toArray()
  expect(rows).toHaveLength(1); expect(rows[0].overview).toBe('# 首次历史\n\n保留尾部空白与中文🌊。  ')
  expect(rows[0].eraSystem).toBe(''); expect(Reflect.get(rows[0], 'worldId')).toBe(f.scope.worldId)
  expect(host.querySelector('[data-markdown-read-view] h1')?.textContent).toBe('首次历史')
  await click('历史时间轴'); await click('历史总述与纪年')
  await waitFor(() => host.querySelector('[data-markdown-read-view] h1')?.textContent === '首次历史')
  await click('查看源码', host.querySelector<HTMLElement>('[data-markdown-read-view]')!)
  expect(host.querySelector('[data-markdown-source]')?.textContent).toBe(rows[0].overview)
})

it('does not rewrite safe reading, retains failed input, and blocks local tab changes until its original writer succeeds', async () => {
  await mount('independent-work')
  const before = (await db.histories.toArray())[0]
  expect(host.querySelector('[data-markdown-read-view]')?.querySelector('script,img,iframe,svg')).toBeNull(); expect(Reflect.get(globalThis, 'historyBad')).toBeUndefined()
  await click('查看源码', host.querySelector<HTMLElement>('[data-markdown-read-view]')!)
  expect(host.querySelector('[data-markdown-source]')?.textContent).toBe(raw)
  expect((await db.histories.toArray())[0]).toEqual(before)
  await click('编辑源码', host.querySelector<HTMLElement>('[data-markdown-read-view]')!)
  const area = await input('# 未保存总述\n\n原第七年不变。  ')
  const reject = () => { throw Error('history-write-failure') }; db.histories.hook('updating', reject)
  try {
    await click('历史时间轴')
    await waitFor(() => host.textContent?.includes('history-write-failure') === true)
    expect(host.querySelector('textarea')).toBe(area); expect((await db.histories.get(before.id!))?.overview).toBe(raw)
  } finally { db.histories.hook('updating').unsubscribe(reject) }
  await click('重试保存'); await waitFor(() => host.querySelector('textarea') === null)
  expect((await db.histories.get(before.id!))?.overview).toBe('# 未保存总述\n\n原第七年不变。  ')
  expect((await db.histories.get(before.id!))?.eraSystem).toBe(before.eraSystem)
})

it('uses the captured World for late event and keyword edits, rejects missing/foreign records and does not move identity', async () => {
  const a = await seedCurrentWorkspace('历史 A', { purpose: 'world-engine' })
  const b = await seedCurrentWorkspace('历史 B', { purpose: 'world-engine' })
  const scope = { projectId: a.scope.projectId, worldId: a.scope.worldId }
  const eventId = await useHistoricalStore.getState().addEvent({ projectId: a.scope.projectId, year: 7, date: '七年', era: 'custom', title: '# 字面事件名', description: raw, isHistorical: false }, scope)
  const keywordId = await db.historicalKeywords.add(stampNewRecord(scope, 'historicalKeywords', { projectId: scope.projectId, keyword: '# 字面关键词', category: 'technology', era: 'custom', description: raw, createdAt: 1, updatedAt: 1 }, { owner: 'world' }) as never)
  await db.projects.update(a.scope.projectId, { activeWorkId: null }); await db.works.delete(a.scope.workId)
  await useHistoricalStore.getState().loadEvents(b.scope.projectId)
  const event = (await db.historicalTimelineEvents.get(eventId))!, keyword = (await db.historicalKeywords.get(keywordId))!
  await useHistoricalStore.getState().updateEvent(eventId, { description: '# A事件正文  ' }, scope)
  await useHistoricalStore.getState().updateKeyword(keywordId, { description: '# A关键词正文  ' }, scope)
  expect((await db.historicalTimelineEvents.get(eventId))?.description).toBe('# A事件正文  ')
  expect((await db.historicalTimelineEvents.get(eventId))?.title).toBe(event.title)
  expect((await db.historicalKeywords.get(keywordId))?.keyword).toBe(keyword.keyword)
  for (const update of [() => useHistoricalStore.getState().updateEvent(eventId, { description: '跨世界' }, b.scope),
    () => useHistoricalStore.getState().updateKeyword(keywordId, { description: '跨世界' }, b.scope),
    () => useHistoricalStore.getState().updateEvent(999999, { description: '已删除' }, scope),
    () => useHistoricalStore.getState().updateKeyword(999999, { description: '已删除' }, scope),
    () => useHistoricalStore.getState().updateKeyword(keywordId, { projectId: b.scope.projectId }, scope)]) {
    await expect(update()).rejects.toThrow()
  }
  expect((await db.historicalKeywords.get(keywordId))?.description).toBe('# A关键词正文  ')
  expect(useHistoricalStore.getState().events).toEqual([])
})
