import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AvgGamePlayer from '../../src/components/text-game/AvgGamePlayer'
import { compileAvgExecutablePackageV2 } from '../../src/lib/avg/executable-package'
import { createProductInitialStateV1 } from '../../src/lib/product/runtime-instances'
import { useAvgGamePlayerStore } from '../../src/stores/avg-game-player'
import type { Project } from '../../src/lib/types'
import { legacyPackage } from '../helpers/avg-carrier-fixture'
import { avgNativeScripts } from '../helpers/avg-native-fixture'
import { avgReadingFixture } from '../helpers/avg-reading-fixture'
import { avgSystemFixture } from '../helpers/avg-system-fixture'

// Real player and store subscription; command completion is controlled here.
// Native browser recovery separately verifies the actual persisted checkpoint.
vi.mock('../../src/components/avg/NativeVoice', () => ({ NativeVoice: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const scope = { projectId: 1, worldId: 2, workId: 3 }
const project: Project = { id: 1, workspaceUid: 'avg-checkpoint-click', workspacePurpose: 'independent-work',
  name: '原存档归属', activeWorldId: 2, activeWorkId: 3, createdAt: 0, updatedAt: 0 }
const save = vi.fn<(name: string) => Promise<void>>()
let host: HTMLDivElement
let root: Root
let finish: () => void

function button() {
  const result = host.querySelector<HTMLButtonElement>('button[aria-label="快速存档"]')
  if (!result) throw new Error('missing actual quick-save button')
  return result
}
async function mount() {
  const pkg = compileAvgExecutablePackageV2({ product: { key: 'checkpoint-click', title: '保存点击', description: '' },
    sourceWorld: legacyPackage().sourceWorld, systemPlan: avgSystemFixture(), scripts: avgNativeScripts(),
    stage: { version: 1, cues: [], assets: [] }, aspectRatio: '16:9', reading: avgReadingFixture({ voices: [] }) })
  const runtimeState = createProductInitialStateV1({ runtimePackage: pkg, runtimeSourceHash: 'a'.repeat(64) })
  useAvgGamePlayerStore.setState({ ...useAvgGamePlayerStore.getInitialState(), scope, selectedSessionId: 7,
    selectedSourceSessionId: 7, selectedManifest: pkg, runtimeState, saveCheckpoint: save })
  await act(async () => root.render(<AvgGamePlayer project={project} scope={scope} worldGroupId={null} initialSessionId={7} />))
}
beforeEach(() => {
  localStorage.clear()
  save.mockReset().mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  useAvgGamePlayerStore.setState(useAvgGamePlayerStore.getInitialState(), true)
  host.remove(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks()
})

describe('AVG checkpoint click during background sound updates', () => {
  it('keeps the explicit save action available while a background command is busy', async () => {
    await mount()
    await act(async () => useAvgGamePlayerStore.setState({ busy: true }))
    expect(button().disabled).toBe(false)
    await act(async () => button().click())
    expect(save).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[role="status"]')).toBeNull()
    await act(async () => finish())
    expect(host.querySelector('[role="status"]')?.textContent).toBe('已快速存档')
  })
  it('does not submit another checkpoint while its own save remains pending', async () => {
    await mount()
    await act(async () => { button().click(); button().click() })
    expect(save).toHaveBeenCalledTimes(1)
    expect(button().disabled).toBe(true)
    await act(async () => finish())
    expect(button().disabled).toBe(false)
  })
  it('does not acknowledge an old save in a newly selected session', async () => {
    await mount()
    await act(async () => button().click())
    await act(async () => {
      useAvgGamePlayerStore.setState({ selectedSessionId: 8, selectedSourceSessionId: 8 })
      root.render(<AvgGamePlayer project={project} scope={scope} worldGroupId={null} initialSessionId={8} />)
    })
    await act(async () => finish())
    expect(host.querySelector('[role="status"]')).toBeNull()
  })
  it('does not save a new selected session while the stage still belongs to the old source', async () => {
    await mount()
    await act(async () => useAvgGamePlayerStore.setState({ selectedSessionId: 8, selectedSourceSessionId: 7, loading: false }))
    expect(button().disabled).toBe(true)
    await act(async () => button().click())
    expect(save).not.toHaveBeenCalled()
  })
  it('does not save the next session through the previous rendered button', async () => {
    await mount()
    await act(async () => {
      useAvgGamePlayerStore.setState({ selectedSessionId: 8, selectedSourceSessionId: 8 })
      button().click()
    })
    expect(save).not.toHaveBeenCalled()
  })
})
