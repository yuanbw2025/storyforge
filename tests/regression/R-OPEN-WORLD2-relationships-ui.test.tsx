import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import TextOpenWorldRelationshipsPanel from '../../src/components/text-game/TextOpenWorldRelationshipsPanel'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

describe('Text Open World vNext · relationship player UI', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('显示道德、可见阵营、三档态度原因、问候和价格影响', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.relationships.morality = 100
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    root.render(createElement(TextOpenWorldRelationshipsPanel, { runtimePackage, state: projection.state }))
    await new Promise(resolve => setTimeout(resolve, 0))
    const text = container.querySelector('[data-testid="text-open-world-relationships"]')?.textContent ?? ''
    expect(text).toContain('道德值 100')
    expect(text).toContain('守渠会')
    expect(text).toContain('岑阿婆好')
    expect(text).toContain('问候语气：友善且愿意帮助')
    expect(text).toContain('买入 ×0.9 · 卖出 ×1.1')
    root.unmount()
  })
})
