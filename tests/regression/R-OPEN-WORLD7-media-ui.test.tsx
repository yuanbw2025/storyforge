import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldScenePanel from '../../src/components/text-game/TextOpenWorldScenePanel'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { projectTextOpenWorldScenesV1 } from '../../src/lib/open-world/scene-projection'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
} from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('Text Open World G7-06 · media player UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  async function render(url: string | null) {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const runtime = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const projection = projectTextOpenWorldScenesV1(runtime)
    if (projection.status !== 'ready') throw new Error('测试需要P9场景投影')
    const availableActions = createTextOpenWorldActionRegistryV1(runtimePackage)
      .project(deriveTextOpenWorldContextsV1(runtime).action)
      .filter(action => action.available)
    await act(async () => root.render(createElement(TextOpenWorldScenePanel, {
      sessionKey: 1,
      eventSequence: 0,
      projection,
      availableActions,
      feedback: null,
      busy: false,
      fallback: { regionTitle: '盐港', locationTitle: '盐港广场', description: '测试', playerName: '来客' },
      background: {
        slotKey: 'slot.salt-port', assetKey: url ? 'asset.salt-port' : null, url,
        altText: '盐港广场场景背景', fallbackText: '盐雾中的港口广场',
      },
      onExecute: vi.fn(),
    })))
  }

  it('场景背景使用不可变URL与alt，缺失时保留完整文字场景', async () => {
    await render('blob:salt-port')
    const image = host.querySelector('[data-testid="text-open-world-published-scene"] img')
    expect(image?.getAttribute('src')).toBe('blob:salt-port')
    expect(image?.getAttribute('alt')).toBe('盐港广场场景背景')
    expect(host.querySelector('[data-testid="text-open-world-published-scene"]')?.textContent).toContain('盐港')

    await render(null)
    const scene = host.querySelector('[data-testid="text-open-world-published-scene"]')
    expect(scene?.getAttribute('data-media-fallback')).toBe('true')
    expect(scene?.querySelector('img')).toBeNull()
    expect(scene?.textContent).toContain('盐港')
  })
})
