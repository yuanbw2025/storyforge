import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readTtrpgOpenPreviewEnabledV1, saveTtrpgOpenPreviewEnabledV1, useTtrpgOpenPreviewEnabledV1 } from '../../src/lib/ttrpg/open-preview-preferences'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined, host: HTMLDivElement | undefined
beforeEach(() => { localStorage.clear(); vi.stubEnv('VITE_ENABLE_TTRPG_OPEN_PREVIEW', '') })
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; vi.restoreAllMocks(); vi.unstubAllEnvs(); localStorage.clear() })
it('defaults off, persists only an explicit browser choice, and removes that choice on opt-out', () => {
  expect(readTtrpgOpenPreviewEnabledV1()).toBe(false)
  localStorage.setItem('storyforge:ttrpg:open-preview:v1', 'true')
  expect(readTtrpgOpenPreviewEnabledV1()).toBe(false)
  expect(saveTtrpgOpenPreviewEnabledV1(true)).toBe(true)
  expect(readTtrpgOpenPreviewEnabledV1()).toBe(true)
  expect(saveTtrpgOpenPreviewEnabledV1(false)).toBe(true)
  expect(readTtrpgOpenPreviewEnabledV1()).toBe(false)
})
it('keeps the explicit preview-build override while storage errors fail closed and cannot report a saved choice', () => {
  vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw Error('denied') })
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw Error('denied') })
  expect(readTtrpgOpenPreviewEnabledV1()).toBe(false)
  expect(saveTtrpgOpenPreviewEnabledV1(true)).toBe(false)
  vi.stubEnv('VITE_ENABLE_TTRPG_OPEN_PREVIEW', '1')
  expect(readTtrpgOpenPreviewEnabledV1()).toBe(true)
})
it('updates all mounted gates on a local choice and on another tab clearing storage', async () => {
  function Gate() { return createElement('span', null, String(useTtrpgOpenPreviewEnabledV1())) }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(createElement('div', null, createElement(Gate), createElement(Gate))))
  expect(host.textContent).toBe('falsefalse')
  await act(async () => { saveTtrpgOpenPreviewEnabledV1(true) })
  expect(host.textContent).toBe('truetrue')
  await act(async () => { localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: null })) })
  expect(host.textContent).toBe('falsefalse')
})
