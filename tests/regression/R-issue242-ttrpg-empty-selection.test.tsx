import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createTtrpgDraft } from '../../src/lib/ttrpg/authoring-service'
import TtrpgRuntimePanel from '../../src/components/ttrpg/TtrpgRuntimePanel'
import { useTtrpgRuntimePlayerStore } from '../../src/stores/ttrpg-runtime-player'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
const initial = useTtrpgRuntimePlayerStore.getInitialState()
beforeEach(async () => {
  db.close(); await db.delete(); await db.open()
  useTtrpgRuntimePlayerStore.setState(initial, true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); db.close()
  useTtrpgRuntimePlayerStore.setState(initial, true); vi.restoreAllMocks()
})

async function renderEmptyPlayer() {
  const f = await createTtrpgDraft('合成空存档作品')
  const original = initial.select
  // Bound the pre-fix infinite loop for diagnosis; the expectation remains zero
  // redundant selections. The real store is used for the first two writes.
  const select = vi.fn(async (id: number | null) => {
    if (select.mock.calls.length <= 2) await original(id)
  })
  useTtrpgRuntimePlayerStore.setState({ select })
  const router = createMemoryRouter([{ path: '*', element: createElement(TtrpgRuntimePanel, {
    project: f.project, workspaceScope: f.scope, worldGroupId: null, initialSessionId: null,
  }) }])
  await act(async () => { root.render(createElement(RouterProvider, { router })); await new Promise(resolve => setTimeout(resolve, 30)) })
  for (let i = 0; i < 20 && useTtrpgRuntimePlayerStore.getState().loading; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  }
  return { f, select }
}

it('renders a new campaign with no sessions without repeatedly selecting null or rewriting its draft', async () => {
  const { f, select } = await renderEmptyPlayer()
  expect(host.textContent).toContain('还没有跑团产品存档')
  expect(useTtrpgRuntimePlayerStore.getState().loading).toBe(false)
  expect(select).not.toHaveBeenCalled()
  const draft = await db.ttrpgAuthoringDrafts.where('workId').equals(f.scope.workId).first()
  await act(async () => useTtrpgRuntimePlayerStore.setState({ error: '合成无关状态更新' }))
  expect(select).not.toHaveBeenCalled()
  expect(await db.ttrpgAuthoringDrafts.where('workId').equals(f.scope.workId).first()).toEqual(draft)
  expect(await db.productRuntimeSessions.count()).toBe(0)
})

it('clears an unavailable selection once without reacting to unrelated store updates', async () => {
  const { select } = await renderEmptyPlayer()
  select.mockClear()
  await act(async () => useTtrpgRuntimePlayerStore.setState({ selectedSessionId: 999 }))
  expect(select).toHaveBeenCalledTimes(1)
  expect(select).toHaveBeenCalledWith(null)
  expect(useTtrpgRuntimePlayerStore.getState().selectedSessionId).toBeNull()
  await act(async () => useTtrpgRuntimePlayerStore.setState({ error: '不应重新选择' }))
  expect(select).toHaveBeenCalledTimes(1)
})
