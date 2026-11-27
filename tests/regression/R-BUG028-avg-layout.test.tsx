import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { db } from '../../src/lib/db/schema'
import AvgPage from '../../src/pages/AvgPage'
import { createAvgDraftV1 } from '../../src/lib/avg/draft-service'

vi.mock('../../src/hooks/useAutoBackup', () => ({ useAutoBackup: () => undefined }))
vi.mock('../../src/hooks/useGistAutoBackup', () => ({ useGistAutoBackup: () => undefined }))
vi.mock('../../src/components/examples/ExampleLibrary', () => ({ default: () => createElement('div', null, 'AVG sample fixture') }))
let root: Root | null = null
let host: HTMLDivElement
const network = vi.fn(() => { throw new Error('BUG028 forbids network and model calls') })
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', network); network.mockClear()
  db.close(); await db.delete(); await db.open()
  host = document.createElement('div'); document.body.append(host)
})
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = null; host.remove(); db.close(); expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals()
})
async function mount(route = '/avg/library') {
  root = createRoot(host)
  await act(async () => root!.render(createElement(MemoryRouter, { initialEntries: [route] },
    createElement(Routes, null, createElement(Route, { path: '/avg/:pageId', element: createElement(AvgPage) })))))
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.textContent).not.toContain('读取 AVG 作品…')
    expect(host.querySelector('.lf-heading h2')).not.toBeNull()
  })
}
function button(name: string) { return [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === name)! }
async function search(value: string) {
  const input = host.querySelector<HTMLInputElement>('[aria-label="搜索 AVG"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('scopes layout to AVG and keeps the empty library lightweight with examples reachable', async () => {
  await mount()
  expect(host.querySelector('.avg-author-app[data-avg-page="library"]')).not.toBeNull()
  expect(host.querySelector('.avg-library-empty')?.textContent).toContain('这里尚无作品')
  expect(host.querySelector('.avg-library-empty')?.classList.contains('lf-paper')).toBe(false)
  expect(host.querySelector('.avg-examples')?.textContent).toContain('AVG sample fixture')
  expect(await db.works.count()).toBe(0)
})
it('preserves complete long titles and existing production/play/delete operations during filtering', async () => {
  const title = '雾港的钟声与最后一封信🌊'.repeat(8)
  const made = await createAvgDraftV1(title)
  await mount()
  expect(host.querySelector('.avg-library-card h3')?.textContent).toBe(title)
  const links = [...host.querySelectorAll('.avg-library-card a')].map(a => a.getAttribute('href'))
  expect(links).toContain(`/avg/vision?project=${made.scope.projectId}&work=${made.scope.workId}`)
  expect(links).toContain(`/avg/play?project=${made.scope.projectId}&work=${made.scope.workId}`)
  expect(host.querySelector('.avg-library-card')?.textContent).toContain('删除')
  const before = await db.avgAuthoringDrafts.toArray()
  await search('不存在的AVG')
  expect(host.querySelector('.avg-library-empty')?.textContent).toContain('没有匹配的 AVG')
  expect(host.querySelector('.avg-library-card')).toBeNull()
  await act(async () => button('清除搜索').click())
  expect(host.querySelector('.avg-library-card h3')?.textContent).toBe(title)
  expect(await db.avgAuthoringDrafts.toArray()).toEqual(before)
})
it('allows new-plan browsing and return to library without implicitly creating a work or production', async () => {
  await mount()
  await act(async () => button('新建 AVG').click())
  await vi.waitFor(() => expect(host.querySelector('[aria-label="AVG 作品名称"]')).not.toBeNull())
  expect(host.querySelector('.lf-heading h2')?.textContent).toBe('故事与体验')
  await act(async () => button('作品库').click())
  await vi.waitFor(() => expect(host.querySelector('.avg-library-tools')).not.toBeNull())
  expect(await db.works.count()).toBe(0)
  expect(await db.productProductions.count()).toBe(0)
})
it.each([
  ['vision', '玩家身份／主角', '开场与核心目标'],
  ['routes', '人物路线与关系', '选择与剧情边界'],
])('keeps editable authoring controls and save actions on %s', async (page, first, second) => {
  await mount(`/avg/${page}`)
  expect(host.textContent).toContain(first); expect(host.textContent).toContain(second)
  expect(button('保存制作方案').disabled).toBe(false)
  expect(button('保存并继续').disabled).toBe(false)
  expect(await db.productProductions.count()).toBe(0)
})
