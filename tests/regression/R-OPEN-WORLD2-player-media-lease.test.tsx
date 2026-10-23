import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldVNextPlayer from '../../src/components/text-game/TextOpenWorldVNextPlayer'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'
import {
  createTextOpenWorldPlayerSessionRowFixtureV1,
  createTextOpenWorldProductRuntimePackageFixtureV1,
} from '../helpers/text-open-world-product-session'

const mocks = vi.hoisted(() => ({ source: vi.fn(), resolve: vi.fn() }))
vi.mock('../../src/lib/product-production/preview-source', async importOriginal => ({
  ...await importOriginal<object>(),
  productRuntimeSourceForSessionV1: mocks.source,
  resolveProductRuntimeSource: mocks.resolve,
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function resolver(url: string) {
  return {
    preload: vi.fn(async () => ({
      urls: { 'asset.salt-port': url }, failures: [], usedBytes: 1,
    })),
    dispose: vi.fn(),
  }
}

let cleanup: (() => Promise<void>) | undefined
afterEach(async () => { await cleanup?.(); cleanup = undefined; vi.resetAllMocks() })

async function mountPlayer(configure?: (sourceHash: string) => void) {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const manifest = createTextOpenWorldProductRuntimePackageFixtureV1(runtimePackage)
  const presentation = runtimePackage.modules.presentation.payload as any
  presentation.mediaSlots.push({
    key: 'background.location.salt-port', kind: 'background', consumerRef: 'location.salt-port',
    required: true, assetKey: 'asset.salt-port', fallbackText: '盐港', altText: '盐港背景',
  })
  runtimePackage.mediaManifest.slotKeys.push('background.location.salt-port')
  runtimePackage.mediaManifest.requiredSlotKeys.push('background.location.salt-port')
  manifest.textOpenWorldVNext = runtimePackage
  // The resolver is mocked: these tests verify UI lease lifetime and races,
  // not production manifest/Blob validation, real images or human acceptance.
  manifest.presentation = { assets: [{
    assetKey: 'asset.salt-port', version: 1, contentHash: 'a'.repeat(64), byteSize: 1,
  }] } as any
  const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
  const session = createTextOpenWorldPlayerSessionRowFixtureV1({ sessionId: 1, projection })
  const media = resolver('blob:current')
  mocks.source.mockImplementation(async pointers => pointers.productReleaseId != null
    ? { kind: 'release', productReleaseId: pointers.productReleaseId }
    : { kind: 'build', productBuildId: pointers.productBuildId, expectedPreviewHash: 'e'.repeat(64) })
  mocks.resolve.mockResolvedValue({ runtimeSourceHash: session.runtimeSourceHash, mediaResolver: media })
  configure?.(session.runtimeSourceHash)
  const original = useTextOpenWorldPlayerStore.getState()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanup = async () => {
    await act(async () => root.unmount())
    host.remove()
    useTextOpenWorldPlayerStore.setState(original, true)
  }
  useTextOpenWorldPlayerStore.setState({
    scope: { projectId: 1, worldId: 1, workId: 1 },
    selectedSessionId: 1, selectedSession: session, selectedManifest: manifest,
    sessions: [session], events: [], checkpoints: [],
    runtimeState: { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: projection },
    loading: false, busy: false, lastFeedback: null, issue: null, error: '',
  })
  await act(async () => root.render(createElement(TextOpenWorldVNextPlayer)))
  return { session, manifest, media, host }
}

describe('Open-world player media lease ownership', () => {
  it('keeps frozen media through command snapshots but releases it on an actual source/owner switch', async () => {
    const { session, manifest, media } = await mountPlayer()
    expect(media.preload).toHaveBeenCalledTimes(1)
    await act(async () => {
      useTextOpenWorldPlayerStore.setState({
        selectedSession: { ...session, updatedAt: session.updatedAt + 1 },
        selectedManifest: structuredClone(manifest),
        scope: { projectId: 1, worldId: 1, workId: 1 },
      })
    })
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
    expect(media.preload).toHaveBeenCalledTimes(1)
    expect(media.dispose).not.toHaveBeenCalled()

    const next = resolver('blob:next')
    mocks.resolve.mockResolvedValue({ runtimeSourceHash: 'b'.repeat(64), mediaResolver: next })
    await act(async () => {
      useTextOpenWorldPlayerStore.setState({
        scope: { projectId: 2, worldId: 2, workId: 2 }, selectedSessionId: 2,
        selectedSession: { ...session, id: 2, projectId: 2, worldId: 2, workId: 2,
          productBuildId: 2, runtimeSourceHash: 'b'.repeat(64) },
      })
    })
    expect(media.dispose).toHaveBeenCalledTimes(1)
    expect(next.preload).toHaveBeenCalledTimes(1)
    expect(mocks.resolve).toHaveBeenLastCalledWith({
      scope: { projectId: 2, worldId: 2, workId: 2 },
      source: { kind: 'build', productBuildId: 2, expectedPreviewHash: 'e'.repeat(64) },
    })
    await cleanup!()
    cleanup = undefined
    expect(next.dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes a late resolver from the prior session without preloading or publishing its URLs', async () => {
    const old = resolver('blob:old')
    let releaseOld!: (value: unknown) => void
    const { session } = await mountPlayer(() => {
      mocks.resolve.mockImplementationOnce(() => new Promise(resolve => { releaseOld = resolve }))
    })
    const next = resolver('blob:next')
    mocks.resolve.mockResolvedValue({ runtimeSourceHash: session.runtimeSourceHash, mediaResolver: next })
    await act(async () => {
      useTextOpenWorldPlayerStore.setState({
        selectedSessionId: 2, selectedSession: { ...session, id: 2 },
      })
    })
    await act(async () => { releaseOld({ runtimeSourceHash: session.runtimeSourceHash, mediaResolver: old }) })
    expect(old.dispose).toHaveBeenCalledTimes(1)
    expect(old.preload).not.toHaveBeenCalled()
    expect(next.preload).toHaveBeenCalledTimes(1)
  })

  it('rejects a resolver for a different frozen package before acquiring any media', async () => {
    const wrong = resolver('blob:wrong')
    const { host } = await mountPlayer(() => {
      mocks.resolve.mockResolvedValue({ runtimeSourceHash: 'f'.repeat(64), mediaResolver: wrong })
    })
    expect(wrong.preload).not.toHaveBeenCalled()
    expect(wrong.dispose).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('已使用文字回退')
  })
})
