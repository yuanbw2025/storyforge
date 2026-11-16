import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ComicSource from '../../src/components/comic/ComicSource'
import LocationTreeMap from '../../src/components/geography/LocationTreeMap'
import { useAdaptationActiveProject, useAdaptationSourceChapters } from '../../src/hooks/useAdaptationPageSource'
import * as manifest from '../../src/lib/adaptation/source-manifest'
import { defaultComicTargetSpec } from '../../src/lib/comic/authoring'
import * as worksService from '../../src/lib/workspace/works'
import { db } from '../../src/lib/db/schema'
import type { Work } from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'

let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  await db.open()
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await db.delete()
})

function deferredRead() {
  let reject!: (reason: Error) => void
  const promise = new Promise<never>((_, rejectRead) => { reject = rejectRead })
  return { promise, reject }
}

function novel(name: string) {
  return createWorkspace({ name, description: '', genres: [], status: 'drafting', targetWordCount: 5000 },
    { kind: 'novel', novelProfile: 'short', initialChapterContent: name + '的原文' })
}

it('reads the latest novel and keeps the author’s chapter choices through live metadata updates', async () => {
  const a = await novel('甲')
  const b = await novel('乙')
  const sources = [a.work, b.work]
  const onError = vi.fn()
  const delayed = deferredRead()
  const read = vi.spyOn(manifest, 'listAdaptationSourceOptions').mockReturnValueOnce(delayed.promise)
  function Choices({ id, works }: { id: number; works: Work[] }) {
    const { chapters, selection, setSelection } = useAdaptationSourceChapters(String(id), works, onError)
    return <button disabled={!chapters.length} onClick={() => setSelection(chapters.map(chapter => chapter.id))}>{selection.join(',')}</button>
  }
  await act(async () => root.render(<Choices id={a.scope.workId} works={sources} />))
  await act(async () => root.render(<Choices id={b.scope.workId} works={sources} />))
  const chapters = await db.chapters.where('projectId').equals(b.scope.projectId).sortBy('order')
  const selectedIds = chapters.map(chapter => chapter.id).join(',')
  await vi.waitFor(() => expect(host.querySelector('button')!.disabled).toBe(false))
  await act(async () => host.querySelector('button')!.click())
  expect(host.textContent).toBe(selectedIds)
  await act(async () => root.render(<Choices id={b.scope.workId} works={sources.map(work => ({ ...work, title: '改名' }))} />))
  await act(async () => delayed.reject(new Error('过期的甲')))
  expect(host.textContent).toBe(selectedIds)
  expect(onError).not.toHaveBeenCalled()
  expect(read).toHaveBeenCalledTimes(2)
})

it('keeps an earlier activation failure out of the next product Work', async () => {
  const a = await novel('甲')
  const b = await novel('乙')
  const late = deferredRead()
  const onError = vi.fn()
  vi.spyOn(worksService, 'switchActiveWork').mockReturnValueOnce(late.promise)
  function Active({ work }: { work: Work }) {
    const project = useAdaptationActiveProject(work, onError)
    return <output>{project?.activeWorkId}</output>
  }
  await act(async () => root.render(<Active work={a.work} />))
  await act(async () => root.render(<Active work={b.work} />))
  await vi.waitFor(() => expect(host.textContent).toBe(String(b.scope.workId)))
  await act(async () => late.reject(new Error('旧作品激活失败')))
  expect(onError).not.toHaveBeenCalled()
})

it('clears the previous frozen source on a Work change and permits retry of the current source', async () => {
  async function source(name: string) {
    const original = await novel(name)
    const target = await manifest.createAdaptation({
      sourceScope: original.scope, sourceWorkId: original.scope.workId, title: name + '漫画',
      sourceSelection: { mode: 'entire-work' }, medium: 'comic', targetSpec: defaultComicTargetSpec(),
    })
    const units = (await manifest.listActiveSourceUnits(target.adaptation.id!)).filter(unit => unit.sourceKind === 'chapter')
    return { scope: target.scope, root: target.adaptation, units }
  }
  const a = await source('甲')
  const b = await source('乙')
  const late = deferredRead()
  const read = vi.spyOn(manifest, 'readAdaptationSourceContent').mockReturnValueOnce(late.promise)
  await act(async () => root.render(<ComicSource {...a} />))
  await act(async () => host.querySelector('button')!.click())
  expect(host.querySelector('button')!.disabled).toBe(true)
  await act(async () => root.render(<ComicSource {...b} />))
  expect(host.querySelector('button')!.disabled).toBe(false)
  await act(async () => late.reject(new Error('旧作品已关闭')))
  expect(host.querySelector('[role=alert]')).toBeNull()
  read.mockRejectedValueOnce(new Error('当前读取失败'))
  await act(async () => host.querySelector('button')!.click())
  expect(host.querySelector('[role=alert]')!.textContent).toContain('当前读取失败')
  await act(async () => host.querySelector('button')!.click())
  await vi.waitFor(() => expect(host.querySelector('pre')?.textContent).toContain('乙的原文'))
})

it('observes a tree first shown after an empty result and disconnects when its SVG leaves the page', async () => {
  const observe = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe = observe; disconnect = disconnect })
  await act(async () => root.render(<LocationTreeMap locations={[]} />))
  expect(observe).not.toHaveBeenCalled()
  await act(async () => root.render(<LocationTreeMap locations={[{ id: 'port', name: '海港', type: 'city',
    parentId: null, description: '', significance: '', order: 0 }]} />))
  expect(observe).toHaveBeenCalledWith(host.querySelector('svg')!.parentElement)
  await act(async () => root.render(<LocationTreeMap locations={[]} />))
  expect(disconnect).toHaveBeenCalledTimes(1)
})
