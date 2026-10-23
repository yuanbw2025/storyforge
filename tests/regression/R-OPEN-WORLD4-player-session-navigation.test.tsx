import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldPlayer from '../../src/components/text-game/TextOpenWorldPlayer'
import type { Project, WorkspaceScope } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'
import {
  createTextOpenWorldPlayerSessionRowFixtureV1,
  createTextOpenWorldProductRuntimePackageFixtureV1,
} from '../helpers/text-open-world-product-session'

vi.mock('../../src/components/text-game/TextOpenWorldVNextPlayer', () => ({ default: () => createElement('div', null, '旅程') }))
vi.mock('../../src/components/text-game/TextOpenWorldLauncher', () => ({ default: () => createElement('div', null, '游戏库') }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const original = useTextOpenWorldPlayerStore.getState()
const scope: WorkspaceScope = { projectId: 1, worldId: 2, workId: 3 }
const runtimePackage = createTextOpenWorldVNextFixture()
const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
const manifest = createTextOpenWorldProductRuntimePackageFixtureV1(runtimePackage)
const project = { id: 1, activeWorldId: 2, activeWorkId: 3 } as Project

function selection(sessionId: number | null, owner = scope, worldGroupId: number | null = null) {
  const session = sessionId == null ? null : {
    ...createTextOpenWorldPlayerSessionRowFixtureV1({ sessionId, projection }), ...owner, worldGroupId,
  }
  return {
    scope: owner, worldGroupId, selectedSessionId: sessionId, selectedSession: session,
    selectedManifest: session ? manifest : null,
    runtimeState: { ...structuredClone(original.runtimeState), textOpenWorld: session ? projection : undefined },
    loading: false, busy: false, error: '', issue: null,
  }
}

describe('Open-world settled session navigation', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const report = vi.fn()
  const load = vi.fn(async (owner: WorkspaceScope, group: number | null, sessionId?: number | null) => {
    useTextOpenWorldPlayerStore.setState({ loading: true })
    await Promise.resolve()
    useTextOpenWorldPlayerStore.setState(selection(sessionId ?? null, owner, group))
  })
  beforeEach(() => {
    report.mockClear()
    load.mockClear()
    useTextOpenWorldPlayerStore.setState({ ...original, ...selection(99), load }, true)
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    useTextOpenWorldPlayerStore.setState(original, true)
  })
  async function render(sessionId: number | null, owner = scope, worldGroupId: number | null = null) {
    await act(async () => root.render(createElement(TextOpenWorldPlayer, {
      project, scope: owner, worldGroupId, initialSessionId: sessionId, onSessionSelected: report,
    })))
  }

  it('ignores the old store at mount, reports a settled retry branch and does not reload its URL echo', async () => {
    await render(1)
    expect(load).toHaveBeenCalledTimes(1)
    expect(report).not.toHaveBeenCalled()
    await act(async () => useTextOpenWorldPlayerStore.setState({ ...selection(2), loading: true }))
    expect(report).not.toHaveBeenCalled()
    await act(async () => useTextOpenWorldPlayerStore.setState({ loading: false }))
    expect(report).toHaveBeenLastCalledWith(2)
    await render(2)
    expect(load).toHaveBeenCalledTimes(1)
    expect(useTextOpenWorldPlayerStore.getState().selectedSessionId).toBe(2)
    await render(1)
    expect(load).toHaveBeenCalledTimes(2)
    expect(useTextOpenWorldPlayerStore.getState().selectedSessionId).toBe(1)
  })

  it('clears the route on an explicit exit and reports a subsequently selected library session', async () => {
    await render(1)
    await act(async () => useTextOpenWorldPlayerStore.setState(selection(null)))
    expect(report).toHaveBeenLastCalledWith(null)
    await render(null)
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => useTextOpenWorldPlayerStore.setState(selection(3)))
    expect(report).toHaveBeenLastCalledWith(3)
    await render(3)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite a requested route after a failed load or with a foreign Work/group selection', async () => {
    load.mockImplementationOnce(async () => {
      useTextOpenWorldPlayerStore.setState({ ...selection(null), error: '存档无法核验' })
    })
    await render(1)
    expect(report).not.toHaveBeenCalled()
    await act(async () => useTextOpenWorldPlayerStore.setState(selection(2, { ...scope, workId: 4 })))
    expect(report).not.toHaveBeenCalled()
    await act(async () => useTextOpenWorldPlayerStore.setState(selection(2, scope, 5)))
    expect(report).not.toHaveBeenCalled()
    await act(async () => useTextOpenWorldPlayerStore.setState({ ...selection(2), selectedManifest: null }))
    expect(report).not.toHaveBeenCalled()
  })

  it('loads a new owner and group even when its numeric session id matches an earlier reported selection', async () => {
    await render(1)
    await act(async () => useTextOpenWorldPlayerStore.setState(selection(2)))
    await render(2)
    expect(load).toHaveBeenCalledTimes(1)
    const other = { ...scope, workId: 4 }
    await render(2, other, 5)
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenLastCalledWith(other, 5, 2)
    expect(report).toHaveBeenCalledTimes(1)
  })
})
