import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import AdventureLibrary from '../../src/components/text-game/AdventureLibrary'
import AdventureProductFrame from '../../src/components/text-game/AdventureProductFrame'

const state = vi.hoisted(() => ({
  previews: [] as Array<{ buildId: number; title: string; manifest: null; previewHash: string; buildNumber: number; error: string }>,
  releases: [], sessions: [], completedSessionEndingKeys: {}, busy: false, loading: false,
  load: vi.fn(), start: vi.fn(), startPreview: vi.fn(), select: vi.fn(), worldGroupId: null,
}))
vi.mock('../../src/stores/adventure-game-player', () => ({ useAdventureGamePlayerStore: () => state }))
let host: HTMLDivElement, root: Root | null = null
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.previews = []; state.load.mockClear(); state.start.mockClear(); state.startPreview.mockClear()
  host = document.createElement('div'); document.body.append(host)
})
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; host.remove(); vi.unstubAllGlobals() })
async function library(error = '') {
  root = createRoot(host)
  await act(async () => root!.render(createElement(AdventureLibrary, {
    scope: { projectId: 1, worldId: 2, workId: 3 }, error, onOpenSession: vi.fn(), onRemoveSession: vi.fn(),
  })))
}
async function search(value: string) {
  const input = host.querySelector<HTMLInputElement>('[aria-label="搜索文字冒险"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
it('keeps an empty library lightweight without a phantom preview or automatic session start', async () => {
  await library()
  expect(host.querySelector('.adventure-library-empty')?.textContent).toContain('故事正等待启程')
  expect(host.querySelector('.adventure-feature')).toBeNull()
  expect(host.querySelector('[aria-label="搜索文字冒险"]')).not.toBeNull()
  expect(state.startPreview).not.toHaveBeenCalled(); expect(state.start).not.toHaveBeenCalled()
})
it('filters only displayed works and preserves complete long titles and underlying editions', async () => {
  const title = '潮钟群岛与最后一封信🌊'.repeat(8)
  state.previews = [{ buildId: 7, title, manifest: null, previewHash: 'fixture-hash', buildNumber: 1, error: 'fixture unavailable' }]
  await library()
  expect(host.querySelector('.adventure-book-copy h3')?.textContent).toBe(title)
  const original = structuredClone(state.previews)
  await search('没有这部冒险')
  expect(host.querySelector('.adventure-library-empty')?.textContent).toContain('没有匹配的作品')
  expect(host.querySelectorAll('.adventure-book-grid article')).toHaveLength(0)
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '清除搜索')!.click())
  expect(host.querySelector('.adventure-book-copy h3')?.textContent).toBe(title)
  expect(state.previews).toEqual(original)
  expect(state.start).not.toHaveBeenCalled()
})
it('keeps errors and the explicit library refresh operation visible', async () => {
  await library('原版本读取失败，原数据保留')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('原版本读取失败')
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '刷新作品库')!.click())
  expect(state.load).toHaveBeenCalledWith({ projectId: 1, worldId: 2, workId: 3 }, null, true)
})
it('scopes compact styling to the adventure frame and retains workspace selection and both entry links', async () => {
  const choose = vi.fn()
  root = createRoot(host)
  await act(async () => root!.render(createElement(MemoryRouter, null, createElement(AdventureProductFrame, {
    projects: [], libraryPath: '/adventure/library', productionPath: '/adventure/production', producing: false,
    page: '作品与试玩', navigation: [], onChooseProject: choose, children: 'private content',
  }))))
  expect(host.querySelector('.adventure-product-page.adventure-compact-ui')).not.toBeNull()
  expect(host.querySelector('[aria-label="创作工作区"]')).not.toBeNull()
  const links = [...host.querySelectorAll('[aria-label="文字冒险导航"] a')].map(a => a.getAttribute('href'))
  expect(links).toEqual(['/adventure/library', '/adventure/production'])
  expect(choose).not.toHaveBeenCalled()
})
