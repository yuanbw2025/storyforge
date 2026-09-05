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

describe('Text Open World vNext · defeated player recovery UI', () => {
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

  it('明确区分战前新分支和保留当前进度的复活，并保留读档入口', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const productRuntimePackage = createTextOpenWorldProductRuntimePackageFixtureV1(runtimePackage)
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.player.health = 0
    projection.state.combat = { encounterKey: 'encounter.ridge-jackal', status: 'defeat' }
    useTextOpenWorldPlayerStore.setState({
      selectedSessionId: 1,
      selectedManifest: productRuntimePackage,
      runtimeState: { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: projection },
      checkpoints: [{
        id: 7, projectId: 1, worldGroupId: null, sessionId: 1, throughSequence: 0,
        name: '战前重试', purpose: 'combat-retry', subjectKey: 'encounter.ridge-jackal',
        stateJson: '{}', stateHash: 'a'.repeat(64), createdAt: 1,
      }],
      busy: false,
      lastFeedback: null,
      error: '',
    })

    await act(async () => {
      root.render(createElement(TextOpenWorldVNextPlayer))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(host.querySelector('[data-testid="text-open-world-defeat-recovery"]')).toBeTruthy()
    expect(host.textContent).toContain('本次战斗失败')
    expect(host.textContent).toContain('保留这条失败时间线，并从战斗开始前建立新分支')
    expect(host.textContent).toContain('复活会保留已经发生的消耗与事件')
    const buttons = Array.from(host.querySelectorAll('button'))
    expect(buttons.find(button => button.textContent === '战前重试（新分支）')?.disabled).toBe(false)
    expect(buttons.find(button => button.textContent === '复活点恢复（保留进度）')?.disabled).toBe(false)
    expect(host.textContent).toContain('存档与分支')
  })
})
