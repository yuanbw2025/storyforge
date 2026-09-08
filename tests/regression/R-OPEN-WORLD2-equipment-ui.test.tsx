import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TextOpenWorldVNextPlayer from '../../src/components/text-game/TextOpenWorldVNextPlayer'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { createTextOpenWorldProductRuntimePackageFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('Text Open World vNext · equipment player UI', () => {
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

  it('显示三装备位、候选前后属性差异和运行状态中的具体装备', async () => {
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
    const panel = host.querySelector('[data-testid="text-open-world-inventory-panel"]')
    expect(panel).toBeTruthy()
    const equipmentViewButton = Array.from(panel!.querySelectorAll('button'))
      .find(button => button.textContent === '装备' && button.closest('[aria-label="背包与装备视图"]'))
    expect(equipmentViewButton).toBeTruthy()
    await act(async () => {
      equipmentViewButton!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    const equipmentView = panel!.querySelector('[data-testid="text-open-world-equipment-view"]')
    expect(equipmentView).toBeTruthy()
    expect(equipmentView?.textContent).toContain('武器')
    expect(equipmentView?.textContent).toContain('防具')
    expect(equipmentView?.textContent).toContain('饰品')
    expect(equipmentView?.textContent).toContain('旧盐刀')
    expect(Array.from(equipmentView!.querySelectorAll('button')).some(button => button.textContent === '装备旧盐刀')).toBe(true)

    const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const plan = await catalog.plan({ effectKeys: ['effect.equip-rust-sword'], claimKey: 'claim.ui-equip', state: projection.state })
    projection.state = (await catalog.apply({ plan, state: projection.state })).state
    await act(async () => {
      useTextOpenWorldPlayerStore.setState({ runtimeState: { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: projection } })
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(equipmentView?.textContent).toContain('旧盐刀')
    expect(Array.from(equipmentView!.querySelectorAll('button')).some(button => button.textContent === '卸下旧盐刀')).toBe(true)
  })
})
