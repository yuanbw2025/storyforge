import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import Dexie from 'dexie'
import TtrpgPage from '../../src/pages/TtrpgPage'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { db } from '../../src/lib/db/schema'
import * as authoring from '../../src/lib/ttrpg/authoring-service'
import { saveTtrpgOpenPreviewEnabledV1 } from '../../src/lib/ttrpg/open-preview-preferences'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { createFreshOpenDraftFixtureV1 } from '../helpers/open-ttrpg-fresh-authoring'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root, host: HTMLDivElement
let currentUrl = ''
let externalNavigate: NavigateFunction
let network: MockInstance<typeof fetch>
const releases: (() => void)[] = []

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  releases.push(resolve)
  return { promise, resolve }
}

function LocationProbe() {
  const location = useLocation()
  currentUrl = `${location.pathname}${location.search}`
  externalNavigate = useNavigate()
  return null
}

function button(text: string, within: ParentNode = host) {
  return [...within.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.trim() === text)
}

function workbench() {
  const navigation = host.querySelector('nav[aria-label="跑团页面导航"]')
  const value = navigation && button('制作台', navigation)
  if (!value) throw new Error('fixture readiness: actual workbench navigation missing')
  return value
}

async function waitFor(check: () => boolean, description: string) {
  const deadline = performance.now() + 2000
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`fixture readiness: ${description}`)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  }
}

async function click(value: HTMLButtonElement) { await act(async () => value.click()) }
async function readInAct<T>(read: () => Promise<T>) {
  let value!: T
  await act(async () => { value = await read() })
  return value
}

async function mount(f: Awaited<ReturnType<typeof createFreshOpenDraftFixtureV1>>) {
  const url = `/ttrpg/source?project=${f.scope.projectId}&work=${f.scope.workId}`
  await act(async () => root.render(<MemoryRouter initialEntries={[url]}><DialogProvider>
    <LocationProbe /><Routes><Route path="/ttrpg/:pageId" element={<TtrpgPage />} /></Routes>
  </DialogProvider></MemoryRouter>))
  await waitFor(() => Boolean(button('保存出口范围')), 'real source catalog and scoped draft loaded')
  await waitFor(() => Boolean(button('搜索')) && !button('搜索')!.disabled, 'actual read-only World resource query settled')
  expect(currentUrl).toBe(url)
  return url
}

function heldSaveAcknowledgement() {
  const original = authoring.saveTtrpgSourceSelection
  const acknowledgement = deferred()
  const ready = deferred()
  let committed: Awaited<ReturnType<typeof authoring.readTtrpgDraft>> | undefined
  let captured: Parameters<typeof original> | undefined
  let failure: unknown
  const save = vi.spyOn(authoring, 'saveTtrpgSourceSelection').mockImplementation(async (...args) => {
    // Await the actual service transaction, then independently read its row.
    // Only its completed acknowledgement is held; no native RW is suspended.
    try {
      const result = await original(...args)
      const actual = await authoring.readTtrpgDraft(args[0])
      expect(Dexie.currentTransaction?.active ?? false).toBe(false)
      expect(actual).toEqual(result)
      expect(actual.revision).toBe(args[1] + 1)
      expect(JSON.parse(actual.selectionJson!)).toEqual(args[3])
      captured = args
      committed = actual
      ready.resolve()
      await acknowledgement.promise
      return result
    } catch (cause) { failure = cause; ready.resolve(); throw cause }
  })
  return { save, acknowledgement, ready, committed: () => committed, captured: () => captured,
    failure: () => failure }
}

async function saveUntilCommitted(held: ReturnType<typeof heldSaveAcknowledgement>) {
  await act(async () => { button('保存出口范围')!.click(); await held.ready.promise })
  if (!held.committed()) throw held.failure() ?? new Error('fixture readiness: actual save never committed')
}

async function acknowledge(held: ReturnType<typeof heldSaveAcknowledgement>) {
  await act(async () => { held.acknowledgement.resolve(); await held.save.mock.results[0].value })
  await waitFor(() => !workbench().disabled && host.textContent?.includes('出口范围已保存') === true, 'save acknowledgement visible')
}

async function waitForWorkbench() {
  await waitFor(() => currentUrl.startsWith('/ttrpg/vision?') &&
    Boolean(host.querySelector('textarea[aria-label="本次设计要求"]')) &&
    [...host.querySelectorAll('h4')].some(value => value.textContent === '开放设计草稿'),
  'the actual lazy workbench editors have rendered after navigation')
}

beforeEach(async () => {
  resetPendingEditCoordinatorForTestsV1()
  localStorage.clear()
  await db.delete(); await db.open()
  expect(saveTtrpgOpenPreviewEnabledV1(true)).toBe(true)
  currentUrl = ''
  network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('FOLLOWUP fixture forbids network/model calls'))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { releases.splice(0).forEach(release => release()); await Promise.resolve() })
  await act(async () => root.unmount())
  host.remove(); resetPendingEditCoordinatorForTestsV1(); localStorage.clear(); db.close()
  vi.restoreAllMocks()
})

describe('FOLLOWUP-TTRPG-NAV-ACK · actual saved-source acknowledgement', () => {
  it('exposes busy navigation during a committed save and requires one explicit click after acknowledgement', async () => {
    const f = await createFreshOpenDraftFixtureV1()
    const sourceUrl = await mount(f), held = heldSaveAcknowledgement()
    await saveUntilCommitted(held)
    const committed = held.committed()!
    expect(held.captured()?.[0]).toEqual(f.scope)
    expect(committed.workId).toBe(f.scope.workId)
    expect((await readInAct(() => authoring.readTtrpgDraft(f.scope))).revision).toBe(committed.revision)
    const navigation = workbench()
    expect.soft(navigation.disabled, 'the page must expose the busy policy rather than silently swallow enabled navigation').toBe(true)
    expect([...host.querySelectorAll<HTMLButtonElement>('nav[aria-label="跑团页面导航"] button, nav[aria-label="制作阶段"] button, .lf-current')]
      .every(value => value.disabled)).toBe(true)
    await click(navigation)
    expect(currentUrl).toBe(sourceUrl)
    await acknowledge(held)
    expect(currentUrl, 'a busy click must never be queued').toBe(sourceUrl)
    await click(workbench())
    await waitForWorkbench()
    const location = new URL(currentUrl, 'http://fixture.local')
    expect(location.searchParams.get('project')).toBe(String(f.scope.projectId))
    expect(location.searchParams.get('work')).toBe(String(f.scope.workId))
    expect(held.save).toHaveBeenCalledTimes(1)
    expect((await readInAct(() => authoring.readTtrpgDraft(f.scope))).revision).toBe(committed.revision)
    expect(await readInAct(() => db.agentRuns.count())).toBe(0)
    expect(await readInAct(() => db.productBuilds.count())).toBe(0)
    expect(network).not.toHaveBeenCalled()
  })

  it('never replays the old owner navigation after an external owner change during the saved acknowledgement', async () => {
    const a = await createFreshOpenDraftFixtureV1(), b = await createFreshOpenDraftFixtureV1()
    await mount(a)
    const beforeB = await readInAct(() => authoring.readTtrpgDraft(b.scope))
    const held = heldSaveAcknowledgement()
    await saveUntilCommitted(held)
    await click(workbench())
    const bUrl = `/ttrpg/source?project=${b.scope.projectId}&work=${b.scope.workId}`
    await act(async () => externalNavigate(bUrl))
    await waitFor(() => currentUrl === bUrl && Boolean(button('保存出口范围')), 'new owner source page loaded')
    expect(workbench().disabled).toBe(true)
    await acknowledge(held)
    expect(currentUrl).toBe(bUrl)
    expect(await readInAct(() => authoring.readTtrpgDraft(b.scope))).toEqual(beforeB)
    expect((await readInAct(() => authoring.readTtrpgDraft(a.scope))).revision).toBe(held.committed()!.revision)
    await click(workbench())
    await waitForWorkbench()
    const location = new URL(currentUrl, 'http://fixture.local')
    expect(location.searchParams.get('project')).toBe(String(b.scope.projectId))
    expect(location.searchParams.get('work')).toBe(String(b.scope.workId))
    expect(held.save).toHaveBeenCalledTimes(1)
    expect(network).not.toHaveBeenCalled()
  })

  it('keeps a real native save failure visible and releases navigation without changing the author draft', async () => {
    const f = await createFreshOpenDraftFixtureV1(), sourceUrl = await mount(f)
    const before = await readInAct(() => authoring.readTtrpgDraft(f.scope))
    const failure = new Error('FOLLOWUP actual source-selection native write failure')
    const failWrite = () => { throw failure }
    db.ttrpgAuthoringDrafts.hook('updating', failWrite)
    try {
      await click(button('保存出口范围')!)
      await waitFor(() => host.querySelector('[role="alert"]')?.textContent?.includes(failure.message) === true,
        'the real native save error remains visible')
      expect(workbench().disabled).toBe(false)
      expect(currentUrl).toBe(sourceUrl)
      expect(await readInAct(() => authoring.readTtrpgDraft(f.scope))).toEqual(before)
      expect(host.textContent).not.toContain('出口范围已保存')
      expect(await readInAct(() => db.agentRuns.count())).toBe(0)
      expect(await readInAct(() => db.productBuilds.count())).toBe(0)
      expect(network).not.toHaveBeenCalled()
    } finally { db.ttrpgAuthoringDrafts.hook('updating').unsubscribe(failWrite) }
  })
})
