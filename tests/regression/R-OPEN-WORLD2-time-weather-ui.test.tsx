import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TextOpenWorldVNextPlayer from '../../src/components/text-game/TextOpenWorldVNextPlayer'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { createTextOpenWorldProductRuntimePackageFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('Text Open World vNext · player clock and weather UI', () => {
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

  it('HUD显示第几天、时间段和当前地区天气，不暴露内部分钟计数', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const productRuntimePackage = createTextOpenWorldProductRuntimePackageFixtureV1(runtimePackage)
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    useTextOpenWorldPlayerStore.setState({
      selectedSessionId: 1, selectedManifest: productRuntimePackage,
      runtimeState: { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: projection },
      checkpoints: [], busy: false, lastFeedback: null, error: '',
    })

    await act(async () => {
      root.render(createElement(TextOpenWorldVNextPlayer))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const hud = host.querySelector('[data-testid="text-open-world-clock-weather"]')
    expect(hud?.textContent).toContain('第 1 天 · 白天 · 晴朗 · 干燥而明亮。')
    expect(hud?.textContent).not.toContain('480')
    expect(host.textContent).not.toContain('世界时间 480 分钟')
  })
})
