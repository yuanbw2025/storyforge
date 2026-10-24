import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {act, createElement} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import StarterExperiences from '../../src/components/character-interaction/StarterExperiences'
import * as starters from '../../src/lib/character-interaction/starter-experiences'

let host: HTMLDivElement, root: Root
beforeEach(() => {vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host)})
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()})
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(value => value.textContent === text)!
async function show() {
  await act(async () => (host.querySelector('input') as HTMLInputElement).click())
  await act(async () => button('查看《潮汐前的灯》方案').click())
}
it('requires explicit experimental opt-in, previews without creating and cancels without touching a Work', async () => {
  const create = vi.spyOn(starters, 'createChatStarterDraftV1')
  await act(async () => root.render(createElement(StarterExperiences, {disabled: false, onCreated: vi.fn()})))
  expect(host.textContent).not.toContain('潮汐前的灯')
  await show()
  expect(host.textContent).toContain('暂不能直接游玩')
  expect(host.textContent).toContain('旅人开场尚未得知')
  expect(create).not.toHaveBeenCalled()
  await act(async () => button('取消起稿').click())
  expect(host.querySelector('[aria-label="原创体验方案预览"]')).toBeNull()
  expect(create).not.toHaveBeenCalled()
})
it('creates only once on double clicks and retries navigation without creating a second Work', async () => {
  const scope = {projectId: 1, worldId: 2, workId: 3}
  const create = vi.spyOn(starters, 'createChatStarterDraftV1').mockResolvedValue({scope} as never)
  const navigate = vi.fn().mockRejectedValueOnce(new Error('页面跳转未完成')).mockResolvedValue(undefined)
  await act(async () => root.render(createElement(StarterExperiences, {disabled: false, onCreated: navigate})))
  await show()
  await act(async () => {button('使用此方案新建作品（实验性）').click(); button('使用此方案新建作品（实验性）').click()})
  expect(create).toHaveBeenCalledTimes(1)
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('页面跳转未完成')
  await act(async () => button('使用此方案新建作品（实验性）').click())
  expect(create).toHaveBeenCalledTimes(1)
  expect(navigate).toHaveBeenCalledTimes(2)
  expect(navigate).toHaveBeenLastCalledWith(scope)
})
