import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { db } from '../../src/lib/db/schema'
import TextGameDevelopmentPage from '../../src/pages/TextGameDevelopmentPage'
let root: Root | null = null
let host: HTMLDivElement
beforeEach(async () => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); db.close(); await db.delete(); await db.open(); host = document.createElement('div'); document.body.append(host) })
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; host.remove(); db.close(); vi.unstubAllGlobals() })
it.each([true, false])('isolates the compact product root when openWorld=%s without starting production', async openWorld => {
  const base = openWorld ? 'openworld' : 'adventure'
  root = createRoot(host)
  await act(async () => root!.render(createElement(MemoryRouter, { initialEntries: [`/${base}/runtime`] }, createElement(Routes, null,
    createElement(Route, { path: `/${base}/:pageId`, element: createElement(TextGameDevelopmentPage, { openWorld }) })))))
  expect(Boolean(host.querySelector('.open-world-product-page'))).toBe(openWorld)
  expect(Boolean(host.querySelector('.adventure-compact-ui'))).toBe(!openWorld)
  expect(await db.productBuilds.count()).toBe(0)
  expect(await db.productRuntimeSessions.count()).toBe(0)
})
it('keeps the empty Creator source boundary and explicit settings entry', async () => {
  root = createRoot(host)
  await act(async () => root!.render(createElement(MemoryRouter, { initialEntries: ['/openworld/runtime?mode=production'] }, createElement(Routes, null,
    createElement(Route, { path: '/openworld/:pageId', element: createElement(TextGameDevelopmentPage, { openWorld: true }) })))))
  expect(host.querySelector('[data-testid="text-open-world-source-empty"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="创作工作区"]')).not.toBeNull()
  expect(await db.productProductions.count()).toBe(0)
})
