import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AvgGamePlayer from '../../src/components/text-game/AvgGamePlayer'
import { compileAvgExecutablePackageV2 } from '../../src/lib/avg/executable-package'
import { createProductInitialStateV1 } from '../../src/lib/product/runtime-instances'
import type { AvgPlayableRuntimePackage, ProductRuntimeState, Project } from '../../src/lib/types'
import { useAvgGamePlayerStore } from '../../src/stores/avg-game-player'
import { legacyPackage } from '../helpers/avg-carrier-fixture'
import { avgNativeScripts } from '../helpers/avg-native-fixture'
import { avgReadingFixture } from '../helpers/avg-reading-fixture'
import { avgSystemFixture } from '../helpers/avg-system-fixture'

// Actual player, preferences, voice readiness and Cue clock; only the final
// store command and audio transport are controlled here. Native E2E separately
// verifies persisted runtime events; these UI projections are never receipts.
vi.mock('../../src/components/avg/NativeVoice', () => ({ NativeVoice: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const scope = { projectId: 1, worldId: 2, workId: 3 }
const project: Project = { id: 1, workspaceUid: 'sfqa104-ui', workspacePurpose: 'independent-work',
  name: '阅读计时隔离', activeWorldId: 2, activeWorkId: 3, createdAt: 0, updatedAt: 0 }
const reach = vi.fn<(beatKey: string) => Promise<void>>()
let host: HTMLDivElement
let root: Root

function nativePackage(delay = 400) {
  return compileAvgExecutablePackageV2({ product: { key: 'sfqa104', title: '阅读余量', description: '' },
    sourceWorld: legacyPackage().sourceWorld, systemPlan: avgSystemFixture(), scripts: avgNativeScripts(),
    stage: { version: 1, cues: [], assets: [] }, aspectRatio: '16:9',
    reading: avgReadingFixture({ autoDelayMs: delay, voices: [] }) })
}

async function mount(delay: number | null, pkg: AvgPlayableRuntimePackage = nativePackage(),
  configure?: (state: ProductRuntimeState) => void) {
  localStorage.setItem('storyforge.avg.reader-preferences.v1', JSON.stringify({ version: 1, reducedMotion: true, autoDelayMs: delay }))
  const runtimeState = createProductInitialStateV1({ runtimePackage: pkg, runtimeSourceHash: 'a'.repeat(64) })
  configure?.(runtimeState)
  useAvgGamePlayerStore.setState({ ...useAvgGamePlayerStore.getInitialState(), scope, selectedSessionId: 7,
    selectedSourceSessionId: 7, selectedManifest: pkg, runtimeState, reachBeat: reach })
  await act(async () => root.render(<AvgGamePlayer project={project} scope={scope} worldGroupId={null} initialSessionId={7} />))
  expect(host.querySelector('.avg-dialogue p')?.textContent).toBe(pkg.narrative.beats![0].text)
  await click('自动播放')
}

function button(label: string) {
  const value = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!value) throw new Error(`Missing player button: ${label}`)
  return value
}
async function click(label: string) { await act(async () => button(label).click()) }
async function tick(ms: number) { await act(async () => vi.advanceTimersByTimeAsync(ms)) }
function expectReached(beatKey: string) {
  expect(reach).toHaveBeenCalledTimes(1)
  expect(reach).toHaveBeenCalledWith(beatKey)
}
async function changeState(change: (state: ProductRuntimeState) => void) {
  const state = structuredClone(useAvgGamePlayerStore.getState().runtimeState)
  change(state)
  await act(async () => useAvgGamePlayerStore.setState({ runtimeState: state }))
}

beforeEach(() => {
  localStorage.clear()
  reach.mockReset().mockResolvedValue()
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  useAvgGamePlayerStore.setState(useAvgGamePlayerStore.getInitialState(), true)
  host.remove(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks()
})

describe('SFQA-104 actual AVG player auto-reading timer', () => {
  it.each([0, 100, 4000])('uses the reader preference %i ms before reaching the current beat', async delay => {
    await mount(delay)
    if (delay > 0) { await tick(delay - 1); expect(reach).not.toHaveBeenCalled() }
    await tick(delay === 0 ? 0 : 1)
    expectReached('line.desk')
  })

  it('uses the frozen reading plan when the preference is null', async () => {
    await mount(null)
    await tick(399); expect(reach).not.toHaveBeenCalled()
    await tick(1); expectReached('line.desk')
  })

  it('retains the 650 ms fallback for a legacy package without a reading plan', async () => {
    await mount(null, { ...legacyPackage(), productType: 'avg', presentation: { version: 1, cues: [], assets: [] } })
    await tick(649); expect(reach).not.toHaveBeenCalled()
    await tick(1); expectReached('beat.home')
  })

  it('cancels the old timer when the effective frozen-plan delay changes', async () => {
    await mount(null, nativePackage(100))
    await tick(50)
    await changeState(state => { state.avgReading!.plan.autoDelayMs = 4000 })
    await tick(3999); expect(reach).not.toHaveBeenCalled()
    await tick(1); expectReached('line.desk')
  })

  it('a changed reader preference restarts the pending delay', async () => {
    await mount(4000)
    await tick(50)
    const input = host.querySelector<HTMLInputElement>('input[aria-label="自动阅读余量"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '100')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(JSON.parse(localStorage.getItem('storyforge.avg.reader-preferences.v1')!).autoDelayMs).toBe(100)
    await tick(99); expect(reach).not.toHaveBeenCalled()
    await tick(1); expectReached('line.desk')
  })

  it('zero delay still waits for a matching completed voice result', async () => {
    await mount(0, nativePackage(), state => {
      state.avgReading!.plan.voices = avgReadingFixture().voices
      state.avgReading!.current = { lineKey: 'line.desk', visit: 0, generation: 'play.1', assetKey: 'voice.calibration',
        status: 'requested', reason: '', playedMs: null }
    })
    await tick(5000); expect(reach).not.toHaveBeenCalled()
    await changeState(state => { state.avgReading!.current!.status = 'ended'; state.avgReading!.current!.playedMs = 5000 })
    await tick(0); expectReached('line.desk')
  })

  it('zero delay still waits for the mandatory Cue', async () => {
    await mount(0, nativePackage(), state => {
      state.presentation!.cues.push({ cueKey: 'wait.first', beatKey: 'line.desk', type: 'wait', phase: 'before', durationMs: 500,
        order: 0, easing: 'linear' })
    })
    await tick(499); expect(reach).not.toHaveBeenCalled()
    await tick(1); await tick(0)
    expectReached('line.desk')
  })

  it.each(['auto-off', 'menu', 'background', 'busy'] as const)('cancels a pending timer on %s', async reason => {
    await mount(100)
    await tick(50)
    if (reason === 'auto-off') await click('自动播放')
    if (reason === 'menu') await click('历史')
    if (reason === 'background') await act(async () => {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
      document.dispatchEvent(new Event('visibilitychange'))
    })
    if (reason === 'busy') await act(async () => useAvgGamePlayerStore.setState({ busy: true }))
    await tick(5000); expect(reach).not.toHaveBeenCalled()
  })

  it('a different visit cancels the old timer and waits the new full delay', async () => {
    await mount(100)
    await tick(50)
    await changeState(state => {
      const narrative = state.narrative!
      // The initial projection has no entry event sequence. Model the next
      // actual visit explicitly instead of incrementing a nullable identity.
      narrative.visitedNodeKeys.push('desk')
      narrative.lastEnteredNodeSequence = 1
    })
    await tick(99); expect(reach).not.toHaveBeenCalled()
    await tick(1); expectReached('line.desk')
  })
})
