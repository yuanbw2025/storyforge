import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldVNextPlayer from '../../src/components/text-game/TextOpenWorldVNextPlayer'
import { createTextOpenWorldDirectorQuestInstanceV1 } from '../../src/lib/open-world/quests'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { createTextOpenWorldProductRuntimePackageFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('Text Open World vNext · quest lifecycle player UI', () => {
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

  it('只显示已揭示任务，并把放弃任务收口到显式二次确认', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const productRuntimePackage = createTextOpenWorldProductRuntimePackageFixtureV1(runtimePackage)
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const ordinary = createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
      definitionKey: 'quest.template.supplies', sourceInstanceKey: 'ui.1', worldMinute: 480,
    })
    ordinary.status = 'active'
    ordinary.acceptedAtWorldMinute = 480
    ordinary.currentStageKey = 'quest-stage.template.supplies'
    ordinary.objectiveStatusByKey['objective.template.supplies'] = 'active'
    projection.state.quests.instancesByKey[ordinary.instanceKey] = ordinary
    projection.director.generatedQuestInstanceCount = 1
    projection.director.revealedQuestInstanceKeys = [ordinary.instanceKey]
    projection.director.activeQuestInstanceKeys = [ordinary.instanceKey]
    const executeVNextAction = vi.fn(async () => ({}) as any)
    useTextOpenWorldPlayerStore.setState({
      selectedSessionId: 1, selectedManifest: productRuntimePackage,
      runtimeState: { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: projection },
      checkpoints: [], busy: false, lastFeedback: null, error: '', executeVNextAction,
    })

    await act(async () => {
      root.render(createElement(TextOpenWorldVNextPlayer))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(host.textContent).toContain('断流的盐渠')
    expect(host.textContent).toContain('短缺物资')
    expect(host.textContent).toContain('进行中')
    expect(host.textContent).toContain('当前阶段：搜集物资')
    expect(host.textContent).toContain('寻找盐晶')
    expect(host.querySelector('[data-testid="text-open-world-quest-hud"]')?.textContent).toContain('主追踪')
    expect(host.querySelector('[data-testid="text-open-world-map-topology"]')?.textContent).toContain('断脊渠口')
    expect(host.querySelector('[data-testid="text-open-world-map-topology"]')?.textContent).toContain('60分钟 · 普通风险 · 可通行')
    expect(host.querySelector('[data-testid="text-open-world-map-topology"] svg[role="img"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="text-open-world-map-topology"] [aria-label="地图列表视图"]')).toBeTruthy()
    expect(host.querySelector(`[data-quest-instance="${ordinary.instanceKey}"]`)?.textContent).toContain('剩余1天')

    const pin = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '钉选到HUD')
    expect(pin).toBeTruthy()
    await act(async () => { pin!.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(executeVNextAction).toHaveBeenCalledWith('action.track-quest-pinned', ordinary.instanceKey)
    executeVNextAction.mockClear()

    const abandon = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('放弃物资任务'))
    expect(abandon).toBeTruthy()
    await act(async () => abandon!.click())
    expect(executeVNextAction).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('此操作会写入正式事件记录')
    const confirm = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '确认执行')
    await act(async () => { confirm!.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(executeVNextAction).toHaveBeenCalledWith('action.abandon-supplies', ordinary.instanceKey, undefined, true)

    executeVNextAction.mockClear()
    ordinary.status = 'completed'
    ordinary.terminalAtWorldMinute = 480
    ordinary.objectiveStatusByKey['objective.template.supplies'] = 'completed'
    projection.director.activeQuestInstanceKeys = []
    await act(async () => {
      useTextOpenWorldPlayerStore.setState({ runtimeState: { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: projection } })
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(host.textContent).toContain('奖励待领取')
    const claim = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('领取物资奖励'))
    expect(claim).toBeTruthy()
    await act(async () => { claim!.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(executeVNextAction).toHaveBeenCalledWith('action.claim-supplies-reward', ordinary.instanceKey)

    projection.state.quests.instancesByKey['quest-instance.12.quest.main.1.release.13.session-start'].status = 'available'
    projection.state.quests.instancesByKey['quest-instance.12.quest.main.1.release.13.session-start'].offeredAtWorldMinute = null
    await act(async () => {
      useTextOpenWorldPlayerStore.setState({ runtimeState: { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: projection } })
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(host.textContent).not.toContain('断流的盐渠')
  })
})
