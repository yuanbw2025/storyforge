import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { db } from '../../src/lib/db/schema'
import AiTownPage from '../../src/pages/AiTownPage'
import { createAiTownDraft } from '../../src/lib/ai-town/authoring-service'
import { defaultAiTownSettings } from '../../src/lib/ai-town/authoring-contract'

// The shared gallery is unchanged; its real browser rendering is covered by the
// isolated BUG027 E2E. Unit tests keep all network/model access forbidden.
vi.mock('../../src/components/community/CommunityPrototypeGallery', () => ({
  default: () => createElement('section', { 'data-testid': 'gallery-fixture' }, 'offline gallery'),
}))
let root: Root | null = null
let host: HTMLDivElement
const network = vi.fn(() => { throw new Error('BUG027 does not authorize model or network calls') })
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', network)
  network.mockClear()
  db.close(); await db.delete(); await db.open()
  host = document.createElement('div'); document.body.append(host)
})
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = null; host.remove(); db.close()
  expect(network).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
async function mount(route = '/town/library') {
  root = createRoot(host)
  await act(async () => root!.render(createElement(MemoryRouter, { initialEntries: [route] },
    createElement(Routes, null, createElement(Route, { path: '/town/:pageId', element: createElement(AiTownPage) })))))
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.textContent).not.toContain('读取AI 小镇作品…')
    expect(host.querySelector('.lf-heading h2')).not.toBeNull()
  })
}
async function search(value: string) {
  const input = host.querySelector<HTMLInputElement>('[aria-label="搜索小镇"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('keeps the empty library and gallery reachable without separate oversized empty cards', async () => {
  await mount()
  expect(host.querySelector('.town-library-tools')).not.toBeNull()
  expect(host.querySelector('.town-library-empty')?.textContent).toContain('还没有自己的小镇')
  expect(host.querySelector('.town-library-empty')?.classList.contains('lf-paper')).toBe(false)
  expect(host.querySelector('.town-community')).not.toBeNull()
  expect([...host.querySelectorAll('button')].find(el => el.textContent === '新建小镇')?.disabled).toBe(false)
  expect(await db.works.count()).toBe(0)
})
it('preserves full long titles, product links and explicit no-result feedback without database writes', async () => {
  const title = '茶屋与海边🌊'.repeat(20)
  const made = await createAiTownDraft(title, defaultAiTownSettings())
  await mount()
  expect(host.querySelector('.town-library-card h3')?.textContent).toBe(title)
  expect(host.querySelector('.town-library-card a')?.getAttribute('href')).toContain(`work=${made.scope.workId}`)
  const before = await db.aiTownAuthoringDrafts.toArray()
  await search('不存在的小镇')
  expect(host.querySelector('.town-library-empty')?.textContent).toContain('没有匹配的小镇')
  expect(host.querySelector('.town-library-card')).toBeNull()
  await act(async () => [...host.querySelectorAll('button')].find(el => el.textContent === '清除搜索')!.click())
  expect(host.querySelector('.town-library-card h3')?.textContent).toBe(title)
  expect(await db.aiTownAuthoringDrafts.toArray()).toEqual(before)
})
it('starts a new unsaved plan without creating production, release or session records', async () => {
  await mount()
  await act(async () => [...host.querySelectorAll('button')].find(el => el.textContent === '新建小镇')!.click())
  await vi.waitFor(() => expect(host.querySelector('[aria-label="小镇名称"]')).not.toBeNull())
  expect(host.querySelector('.lf-heading h2')?.textContent).toBe('结局与生活')
  expect(await db.works.count()).toBe(0)
  expect(await db.productProductions.count()).toBe(0)
})
it.each([
  ['vision', '玩家身份', '生活愿景与开场目标'],
  ['residents', '居民数量', '共同建设目标'],
  ['rhythm', '每天可用行动次数', '离线推进上限'],
  ['media-plan', '居民立绘', '制作质量'],
  ['confirm', '生活目标', '生成或更新审查方案'],
])('retains actual setup controls on %s without starting production', async (route, first, second) => {
  await mount(`/town/${route}`)
  expect(host.textContent).toContain(first)
  expect(host.textContent).toContain(second)
  expect(host.querySelector('.town-plan-form')).not.toBeNull()
  expect([...host.querySelectorAll('button')].find(el => el.textContent?.trim() === '保存制作方案')).toBeDefined()
  expect(await db.productProductions.count()).toBe(0)
})
