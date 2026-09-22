import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldQuestLogPanel from '../../src/components/text-game/TextOpenWorldQuestLogPanel'
import TextOpenWorldVNextPlayer from '../../src/components/text-game/TextOpenWorldVNextPlayer'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { createTextOpenWorldDirectorQuestInstanceV1 } from '../../src/lib/open-world/quests'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
} from '../../src/lib/open-world/session-projection'
import {
  EMPTY_PRODUCT_RUNTIME_STATE,
  type TextOpenWorldItemModuleV1,
  type TextOpenWorldSessionProjectionV1,
} from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import {
  createTextOpenWorldPlayerSessionRowFixtureV1,
  createTextOpenWorldProductRuntimePackageFixtureV1,
} from '../helpers/text-open-world-product-session'
import {
  createTextOpenWorldVNextFixture,
  createTextOpenWorldVNextP9Fixture,
} from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const MAIN_INSTANCE_KEY = 'quest-instance.12.quest.main.1.release.13.session-start'

function randomActiveProjection() {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const items = runtimePackage.modules.items.payload as TextOpenWorldItemModuleV1
  items.rewardContracts.find(reward => reward.key === 'reward.quest-supplies')!.dropTableKeys = ['drop.salt-jackal']
  const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
  const main = projection.state.quests.instancesByKey[MAIN_INSTANCE_KEY]
  main.status = 'active'
  main.acceptedAtWorldMinute = 480
  main.currentStageKey = 'quest-stage.main.1'
  main.objectiveStatusByKey['objective.main.1'] = 'active'
  const random = createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
    definitionKey: 'quest.template.supplies',
    sourceInstanceKey: 'quest-log-ui.1',
    worldMinute: 480,
  })
  random.status = 'active'
  random.acceptedAtWorldMinute = 480
  random.currentStageKey = 'quest-stage.template.supplies'
  random.objectiveStatusByKey['objective.template.supplies'] = 'active'
  projection.state.quests.instancesByKey[random.instanceKey] = random
  const hiddenInstances = (['available', 'locked'] as const).map((status, index) => {
    const instance = createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
      definitionKey: 'quest.template.supplies',
      sourceInstanceKey: `quest-log-ui.hidden.${index + 1}`,
      worldMinute: 480,
    })
    instance.status = status
    instance.offeredAtWorldMinute = null
    instance.deadlineWorldMinute = null
    projection.state.quests.instancesByKey[instance.instanceKey] = instance
    return instance
  })
  projection.state.director.generatedQuestInstanceCount = 1 + hiddenInstances.length
  projection.state.director.revealedQuestInstanceKeys = [random.instanceKey]
  projection.state.director.activeQuestInstanceKeys = [random.instanceKey]
  projection.director = structuredClone(projection.state.director)
  const actions = createTextOpenWorldActionRegistryV1(runtimePackage)
    .project(deriveTextOpenWorldContextsV1(projection).action)
  return { runtimePackage, projection, random, actions }
}

function buttonByText(host: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes(text))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮:${text}`)
  return button
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('Text Open World G4-05 · 完整玩家任务日志 UI', () => {
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

  it('按玩家投影组合筛选四类任务、角色势力和追踪状态，并只执行精确正式 Action', async () => {
    const { projection, random, actions } = randomActiveProjection()
    const restart = structuredClone(actions.find(action => action.action.category === 'abandon-quest')!)
    restart.action.key = 'action.test-restart-only-through-offer'
    restart.action.category = 'restart-quest'
    restart.action.label = '不应从日志直接重接'
    restart.available = true
    restart.validTargetKeys = [random.instanceKey]
    const onExecute = vi.fn()
    const onFocusLocation = vi.fn()
    await act(async () => {
      root.render(createElement(TextOpenWorldQuestLogPanel, {
        sessionId: 1,
        projection,
        events: [],
        actions: [...actions, restart],
        busy: false,
        onExecute,
        onFocusLocation,
      }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const panel = host.querySelector('[data-testid="text-open-world-quest-log"]')!
    expect(panel.className).toContain('min-w-0')
    expect(panel.className).toContain('overflow-hidden')
    expect(panel.querySelector('[aria-label="任务分类"]')?.className).toContain('flex-wrap')
    expect(panel.querySelector('[aria-label="任务分类"]')?.className).not.toContain('overflow-x-auto')
    expect(panel.querySelectorAll('[role="listitem"]')).toHaveLength(2)
    expect(Object.keys(projection.state.quests.instancesByKey)).toHaveLength(4)
    expect(panel.textContent).toContain('主线')
    expect(panel.textContent).toContain('随机任务')
    expect(panel.textContent).toContain('岑阿婆')
    expect(panel.textContent).not.toContain('quest.main.1')
    expect(panel.textContent).not.toContain(MAIN_INSTANCE_KEY)
    for (const width of [390, 780]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      window.dispatchEvent(new Event('resize'))
      expect(panel.querySelector('[aria-label="任务分类"]')?.className).toContain('flex-wrap')
      expect(panel.querySelectorAll('.overflow-x-auto')).toHaveLength(0)
      expect(Array.from(panel.querySelectorAll('select')).every(select => select.className.includes('min-w-0'))).toBe(true)
    }

    await click(buttonByText(panel.querySelector('[aria-label="任务分类"]')!, '随机任务'))
    expect(panel.querySelectorAll('[role="listitem"]')).toHaveLength(1)
    expect(panel.querySelector('[role="listitem"]')?.getAttribute('data-quest-instance')).toBe(random.instanceKey)
    expect(panel.textContent).toContain('获得10盐票')
    expect(panel.textContent).toContain('随机奖励，将在结算时揭晓')
    expect(panel.textContent).toContain('地区动态发放')
    expect(panel.textContent).not.toContain('不应从日志直接重接')
    expect(panel.textContent).not.toContain('交付短缺物资')

    const deadlineFilter = panel.querySelector('[aria-label="按任务期限筛选"]') as HTMLSelectElement
    await act(async () => {
      deadlineFilter.value = 'timed-open'
      deadlineFilter.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(panel.querySelectorAll('[role="listitem"]')).toHaveLength(1)
    await act(async () => {
      deadlineFilter.value = 'waits'
      deadlineFilter.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(panel.querySelectorAll('[role="listitem"]')).toHaveLength(0)
    await act(async () => {
      deadlineFilter.value = 'all'
      deadlineFilter.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const track = buttonByText(panel.querySelector('[aria-label="任务操作"]')!, '钉选到HUD')
    await click(track)
    expect(onExecute).toHaveBeenCalledTimes(1)
    expect(onExecute.mock.calls[0][0].action.key).toBe('action.track-quest-pinned')
    expect(onExecute.mock.calls[0][1]).toBe(random.instanceKey)

    const locate = panel.querySelector('button[aria-label="在地图定位断脊渠口"]') as HTMLButtonElement | null
    expect(locate).toBeTruthy()
    await click(locate!)
    expect(onFocusLocation).toHaveBeenCalledWith('location.ridge-channel')

    await click(buttonByText(panel.querySelector('[aria-label="任务分类"]')!, '主线'))
    expect(panel.textContent).toContain('关键故事线不可放弃')
    expect(panel.textContent).toContain('世界发布时固定')
    expect(panel.querySelector('[data-action-category="abandon-quest"]')).toBeNull()
    const untrack = buttonByText(panel.querySelector('[aria-label="任务操作"]')!, '取消主追踪')
    await click(untrack)
    expect(onExecute.mock.calls.at(-1)?.[0].action.key).toBe('action.untrack-quest-primary')
    expect(onExecute.mock.calls.at(-1)?.[1]).toBe(MAIN_INSTANCE_KEY)

    const ownerFilter = panel.querySelector('[aria-label="按任务角色或势力筛选"]') as HTMLSelectElement
    await act(async () => {
      ownerFilter.value = 'actor:actor.caretaker'
      ownerFilter.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(panel.querySelectorAll('[role="listitem"]')).toHaveLength(1)
    const trackingFilter = panel.querySelector('[aria-label="按追踪状态筛选"]') as HTMLSelectElement
    await act(async () => {
      trackingFilter.value = 'primary'
      trackingFilter.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(panel.querySelectorAll('[role="listitem"]')).toHaveLength(1)
  })

  it('把五种终态放进一级历史入口，并在事件落后时保留主体但明确等待历史', async () => {
    const { projection: base, random, actions } = randomActiveProjection()
    const renderStatus = async (status: 'completed' | 'failed' | 'expired' | 'abandoned' | 'withdrawn') => {
      const projection = structuredClone(base)
      const instance = projection.state.quests.instancesByKey[random.instanceKey]
      instance.status = status
      instance.terminalAtWorldMinute = 480
      if (status === 'completed') instance.objectiveStatusByKey['objective.template.supplies'] = 'completed'
      if (status === 'failed') instance.objectiveStatusByKey['objective.template.supplies'] = 'failed'
      projection.state.quests.tracking.pinnedInstanceKeys = []
      projection.state.director.revealedQuestInstanceKeys = []
      projection.state.director.activeQuestInstanceKeys = []
      projection.director = structuredClone(projection.state.director)
      projection.lastEventSequence = 1
      await act(async () => {
        root.render(createElement(TextOpenWorldQuestLogPanel, {
          sessionId: 17,
          projection,
          events: [],
          actions,
          busy: false,
          onExecute: vi.fn(),
          onFocusLocation: vi.fn(),
        }))
        await new Promise(resolve => setTimeout(resolve, 0))
      })
      return projection
    }

    await renderStatus('failed')
    await click(buttonByText(host.querySelector('[aria-label="任务分类"]')!, '历史'))
    expect(host.querySelector('[aria-label="任务分类"]')?.textContent).toContain('历史 1')
    expect(host.querySelector('[role="status"]')?.textContent).toContain('历史事件正在同步')
    expect(host.textContent).toContain('任务目标已经永久失败')

    const copies: Array<[Parameters<typeof renderStatus>[0], string]> = [
      ['completed', '任务已经完成'],
      ['expired', '任务期限已经结束'],
      ['abandoned', '玩家已经放弃本次任务'],
      ['withdrawn', '任务已因世界状态变化撤回'],
    ]
    for (const [status, copy] of copies) {
      await renderStatus(status)
      expect(host.textContent).toContain(copy)
      expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(1)
    }
  })

  it('关键事实只显示任务已关联且 Session 已揭示的传闻或确认内容', async () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const narrative = runtimePackage.modules.narrative.payload
    if (narrative.version !== 2) throw new Error('fixture必须提供Narrative v2')
    narrative.scenes
      .filter(scene => scene.questKey === 'quest.main.1')
      .forEach(scene => { scene.allowedKnowledgeClaimKeys = ['knowledge.caretaker'] })
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const render = async (visibility: 'hidden' | 'rumor' | 'known') => {
      projection.state.knowledge.visibilityByKey['knowledge.caretaker'] = visibility
      const actions = createTextOpenWorldActionRegistryV1(runtimePackage)
        .project(deriveTextOpenWorldContextsV1(projection).action)
      await act(async () => {
        root.render(createElement(TextOpenWorldQuestLogPanel, {
          sessionId: 5,
          projection,
          events: [],
          actions,
          busy: false,
          onExecute: vi.fn(),
          onFocusLocation: vi.fn(),
        }))
        await new Promise(resolve => setTimeout(resolve, 0))
      })
    }

    await render('rumor')
    expect(host.querySelector('[aria-label="关键已知事实"]')).toBeNull()
    projection.state.knowledge.readRumorKeys = ['rumor.channel']
    await render('rumor')
    const facts = host.querySelector('[aria-label="关键已知事实"]')
    expect(facts?.textContent).toContain('老守渠人')
    expect(facts?.textContent).toContain('有人看见断脊渠口附近有野兽')
    expect(facts?.textContent).not.toContain('岑阿婆知道盐渠的旧路线')
    expect(facts?.textContent).toContain('传闻')
    expect(facts?.textContent).not.toContain('knowledge.caretaker')

    await render('known')
    expect(host.querySelector('[aria-label="关键已知事实"]')?.textContent).toContain('已确认')
    await render('hidden')
    expect(host.querySelector('[aria-label="关键已知事实"]')).toBeNull()
  })

  it('任务地点只发出 session-bound UI 定位请求，重复定位可聚焦且切换 Session 会清空', async () => {
    const { runtimePackage, projection, random } = randomActiveProjection()
    const executeVNextAction = vi.fn(async () => ({}) as never)
    const putSession = (sessionId: number, nextProjection: TextOpenWorldSessionProjectionV1) => {
      useTextOpenWorldPlayerStore.setState({
        sessions: [],
        releases: [],
        selectedSessionId: sessionId,
        selectedSession: createTextOpenWorldPlayerSessionRowFixtureV1({
          sessionId,
          projection: nextProjection,
        }),
        selectedSessionSource: 'build-preview',
        selectedManifest: createTextOpenWorldProductRuntimePackageFixtureV1(runtimePackage),
        runtimeState: { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: nextProjection },
        events: [],
        checkpoints: [],
        busy: false,
        lastFeedback: null,
        error: '',
        executeVNextAction,
      })
    }
    putSession(21, projection)
    const stateBefore = structuredClone(projection.state)
    await act(async () => {
      root.render(createElement(TextOpenWorldVNextPlayer))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await click(buttonByText(host.querySelector('[data-testid="text-open-world-navigation-rail"]')!, '任务'))
    await click(host.querySelector(`[role="listitem"][data-quest-instance="${random.instanceKey}"] button`) as HTMLButtonElement)
    const locate = host.querySelector('button[aria-label="在地图定位断脊渠口"]') as HTMLButtonElement
    await click(locate)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(host.querySelector('[data-testid="text-open-world-shell"]')?.getAttribute('data-active-view')).toBe('map')
    const mapList = host.querySelector('[aria-label="地图列表视图"]')!
    expect(mapList.querySelector('[data-task-focused="true"]')?.textContent).toContain('断脊渠口')
    expect(document.activeElement).toBe(mapList.querySelector('[data-task-focused="true"]'))
    expect(executeVNextAction).not.toHaveBeenCalled()
    expect(useTextOpenWorldPlayerStore.getState().runtimeState.textOpenWorld?.state).toEqual(stateBefore)

    await click(buttonByText(host.querySelector('[data-testid="text-open-world-navigation-rail"]')!, '任务'))
    await click(host.querySelector('button[aria-label="在地图定位断脊渠口"]') as HTMLButtonElement)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(document.activeElement).toBe(mapList.querySelector('[data-task-focused="true"]'))

    const nextProjection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    await act(async () => {
      putSession(22, nextProjection)
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(host.querySelector('[data-testid="text-open-world-shell"]')?.getAttribute('data-active-view')).toBe('scene')
    expect(host.querySelector('[aria-label="地图列表视图"] [data-task-focused="true"]')).toBeNull()
  })
})
