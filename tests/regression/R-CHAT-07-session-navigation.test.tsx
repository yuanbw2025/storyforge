import {act, createElement, useLayoutEffect} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {useChatSessionNavigation} from '../../src/components/character-interaction/useChatSessionNavigation'

const mocks = vi.hoisted(() => ({getState: vi.fn(), load: vi.fn()}))
vi.mock('../../src/stores/character-interaction-player', () => ({useCharacterInteractionPlayerStore: {getState: mocks.getState}}))
const scope = {projectId: 1, worldId: 2, workId: 3}
let state: Parameters<typeof useChatSessionNavigation>[1] & {busy: boolean}
let root: Root, host: HTMLDivElement, address: number | null, beforePaint: Array<number | null>
const onSession = vi.fn((id: number | null) => {address = id})
function Harness({requested, workspaceScope = scope}: {requested: number | null; workspaceScope?: typeof scope}) {
  useChatSessionNavigation({workspaceScope, worldGroupId: null, initialSessionId: requested, onSessionSelected: onSession}, state)
  // This represents the address a player would reload when the new view paints.
  useLayoutEffect(() => {beforePaint.push(address)})
  return createElement('span', null, state.selectedSessionId)
}
const render = async (requested: number | null, workspaceScope = scope) => {
  address = requested
  await act(async () => root.render(createElement(Harness, {requested, workspaceScope})))
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.load.mockReset().mockResolvedValue(undefined)
  state = {scope, worldGroupId: null, selectedSessionId: 4, loading: false, busy: false, load: mocks.load}
  mocks.getState.mockReset().mockImplementation(() => state)
  onSession.mockClear(); beforePaint = []; address = 4
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await render(4)
})
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals()})

it('binds a persisted branch before paint while its final refresh is busy, without reloading on URL echo', async () => {
  state = {...state, selectedSessionId: 5, busy: true}
  await render(4)
  expect(beforePaint.at(-1)).toBe(5)
  expect(address).toBe(5)
  expect(onSession).toHaveBeenLastCalledWith(5)
  await render(5)
  expect(mocks.load).toHaveBeenCalledTimes(1)
  expect(mocks.load).toHaveBeenCalledWith(scope, null, 4)
})

it('does not overwrite a real history navigation with the previous busy branch', async () => {
  state = {...state, selectedSessionId: 5, busy: true}
  await render(4); await render(5)
  let finish!: () => void
  mocks.load.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve}))
  onSession.mockClear()
  await render(4)
  expect(mocks.load).toHaveBeenLastCalledWith(scope, null, 4)
  expect(beforePaint.at(-1)).toBe(4)
  expect(onSession).not.toHaveBeenCalled()
  state = {...state, selectedSessionId: 4, busy: false}
  await act(async () => finish())
  await render(4)
  expect(address).toBe(4)
})

it('keeps a new Work address while its requested session is still loading', async () => {
  const otherScope = {...scope, workId: 30}
  let finish!: () => void
  mocks.load.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve}))
  onSession.mockClear()
  await render(8, otherScope)
  expect(mocks.load).toHaveBeenLastCalledWith(otherScope, null, 8)
  expect(beforePaint.at(-1)).toBe(8)
  expect(onSession).not.toHaveBeenCalled()
  state = {...state, scope: otherScope, selectedSessionId: 8}
  await act(async () => finish())
  await render(8, otherScope)
  expect(address).toBe(8)
})

it('binds an automatically restored session after an asynchronous initial load settles', async () => {
  let finish!: () => void
  mocks.load.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve}))
  onSession.mockClear()
  await render(null)
  expect(address).toBeNull()
  state = {...state, selectedSessionId: 8}
  await act(async () => finish())
  expect(address).toBe(8)
  expect(beforePaint.at(-1)).toBe(8)
})
