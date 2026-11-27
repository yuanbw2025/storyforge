import { afterEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import FeedbackInbox from '../../src/components/shared/FeedbackInbox'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let container: HTMLDivElement | undefined
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  container?.remove()
  vi.restoreAllMocks()
  localStorage.clear()
})

it('updates offline guidance and the check action when connectivity changes without reopening the inbox', async () => {
  localStorage.clear()
  let online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  const fetcher = vi.spyOn(globalThis, 'fetch')
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(createElement(FeedbackInbox)))
  await act(async () => container!.querySelector('button')!.click())
  const check = () => [...container!.querySelectorAll('button')].find(button => button.textContent === '检查进展')!
  expect(check().disabled).toBe(false)
  await act(async () => { online = false; window.dispatchEvent(new Event('offline')) })
  expect(check().disabled).toBe(true)
  expect(container.textContent).toContain('当前离线，下次联网打开应用后补收。')
  await act(async () => { online = true; window.dispatchEvent(new Event('online')) })
  expect(check().disabled).toBe(false)
  expect(container.textContent).not.toContain('当前离线，下次联网打开应用后补收。')
  expect(fetcher).not.toHaveBeenCalled()
})
