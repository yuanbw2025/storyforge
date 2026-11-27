import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ProjectInfoPanel from '../../src/components/project/ProjectInfoPanel'
import { db } from '../../src/lib/db/schema'
import { useProjectStore } from '../../src/stores/project'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import type { Project } from '../../src/lib/types'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const originalUpdate = useProjectStore.getState().updateActiveWork
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const status = () => host.querySelector('[data-work-info-save-status]')?.getAttribute('data-work-info-save-status')
async function settle(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    if (predicate()) return
  }
  throw Error('Work info did not settle')
}
async function render(project: Project) {
  await act(async () => root.render(<ProjectInfoPanel project={project} onUpdate={() => undefined} />))
}
async function typeTitle(value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('[aria-label="作品名称"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function flush() { await act(async () => { await flushPendingEditsV1() }) }
async function fixture() {
  const created = await seedCurrentWorkspace('保存回读原作')
  await render(created.project); await settle(() => status() === 'saved')
  return created
}
beforeEach(async () => {
  await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1()
  useProjectStore.setState({ updateActiveWork: originalUpdate })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model requests') }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  useProjectStore.setState({ updateActiveWork: originalUpdate })
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks()
  resetPendingEditCoordinatorForTestsV1(); await db.delete()
})

it('confirms a native DB load, invalidates success immediately, and reopens the exact committed Work metadata', async () => {
  const { project, scope } = await fixture()
  expect(host.querySelector('[data-work-info-save-status]')?.textContent).toBe('已保存到本机')
  expect(host.querySelector('[data-work-info-save-status]')?.getAttribute('title')).toContain('同一浏览器')
  const raw = '  原作🌊：保留标点与尾空白。  '
  await typeTitle(raw); expect(status()).toBe('dirty')
  await flush(); expect(status()).toBe('saved')
  expect((await db.works.get(scope.workId))!.title).toBe(raw)
  expect(Reflect.get((await db.projects.get(scope.projectId))!, 'title')).toBeUndefined()
  await act(async () => root.unmount()); root = createRoot(host)
  await render(project); await settle(() => status() === 'saved')
  expect(host.querySelector<HTMLInputElement>('[aria-label="作品名称"]')?.value).toBe(raw)
})

it('retains the source on a real quota failure and confirms only the original writer retry', async () => {
  const { scope } = await fixture(); await typeTitle('配额失败时的作者草稿')
  const reject = () => { throw new DOMException('isolated quota failure', 'QuotaExceededError') }
  db.works.hook('updating', reject)
  try { await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('isolated quota failure') }) }
  finally { db.works.hook('updating').unsubscribe(reject) }
  expect(status()).toBe('failed')
  expect(host.querySelector<HTMLInputElement>('[aria-label="作品名称"]')?.value).toBe('配额失败时的作者草稿')
  expect((await db.works.get(scope.workId))!.title).toBe('保存回读原作')
  await flush(); expect(status()).toBe('saved')
  expect((await db.works.get(scope.workId))!.title).toBe('配额失败时的作者草稿')
})

it('does not acknowledge a resolved writer result when the actual DB was never written', async () => {
  const { scope } = await fixture(); await typeTitle('只有返回值没有落盘')
  const row = (await db.works.get(scope.workId))!
  useProjectStore.setState({ updateActiveWork: vi.fn(async () => ({ ...row, title: '只有返回值没有落盘' })) })
  // Re-render supplies the changed store callback without replacing the draft.
  await render((await db.projects.get(scope.projectId))!)
  await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('本机记录尚未确认') })
  expect(status()).toBe('failed'); expect((await db.works.get(scope.workId))!.title).toBe(row.title)
  useProjectStore.setState({ updateActiveWork: originalUpdate }); await render((await db.projects.get(scope.projectId))!)
  await flush(); expect(status()).toBe('saved')
})

it('does not let an older committed acknowledgement clear a newer draft', async () => {
  const { scope } = await fixture()
  let release!: () => void
  let held = false
  useProjectStore.setState({ updateActiveWork: async (...args) => {
    const saved = await originalUpdate(...args)
    if (!held) { held = true; await new Promise<void>(resolve => { release = resolve }) }
    return saved
  } })
  await render((await db.projects.get(scope.projectId))!); await typeTitle('第一版落盘')
  let pending!: Promise<void>
  await act(async () => { pending = flushPendingEditsV1().then(() => undefined) })
  await settle(() => typeof release === 'function'); expect(status()).toBe('saving')
  await typeTitle('第二版仍待保存')
  await act(async () => { release(); await pending })
  expect(status()).toBe('dirty')
  expect(host.querySelector<HTMLInputElement>('[aria-label="作品名称"]')?.value).toBe('第二版仍待保存')
  expect((await db.works.get(scope.workId))!.title).toBe('第一版落盘')
  await flush(); expect(status()).toBe('saved')
  expect((await db.works.get(scope.workId))!.title).toBe('第二版仍待保存')
})

it('keeps a dirty old Work bound to its original identity while another Work loads', async () => {
  const first = await fixture(), second = await seedCurrentWorkspace('另一部作品')
  await typeTitle('只保存到原作')
  await render(second.project); expect(status()).not.toBe('saved')
  await flush(); await settle(() => host.querySelector<HTMLInputElement>('[aria-label="作品名称"]')?.value === '另一部作品')
  expect(status()).toBe('saved')
  expect((await db.works.get(first.scope.workId))!.title).toBe('只保存到原作')
  expect((await db.works.get(second.scope.workId))!.title).toBe('另一部作品')
})

it('does not claim success when the committed record differs from the submitted snapshot', async () => {
  const { scope } = await fixture(); await typeTitle('待核对的原作')
  useProjectStore.setState({ updateActiveWork: async (...args) => {
    const saved = await originalUpdate(...args)
    await db.works.update(scope.workId, { description: '另一处修改的简介' })
    return saved
  } })
  await render((await db.projects.get(scope.projectId))!)
  await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('本机记录尚未确认') })
  expect(status()).toBe('failed')
  expect(host.querySelector<HTMLInputElement>('[aria-label="作品名称"]')?.value).toBe('待核对的原作')
  expect((await db.works.get(scope.workId))!.description).toBe('另一处修改的简介')
})

it('withholds the saved badge and formal flush during title composition, then saves the completed input', async () => {
  const { scope } = await fixture()
  const input = host.querySelector<HTMLInputElement>('[aria-label="作品名称"]')!
  await act(async () => input.dispatchEvent(new Event('compositionstart', { bubbles: true })))
  await typeTitle('尚在组合的中文尾字🌊'); expect(status()).toBe('dirty')
  await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('输入法仍在组合') })
  expect((await db.works.get(scope.workId))!.title).toBe('保存回读原作')
  await act(async () => input.dispatchEvent(new Event('compositionend', { bubbles: true })))
  await flush(); expect(status()).toBe('saved')
  expect((await db.works.get(scope.workId))!.title).toBe('尚在组合的中文尾字🌊')
})
