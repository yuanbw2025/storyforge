import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DialogProvider } from '../../src/components/shared/Dialog'
import TextOpenWorldPlayer from '../../src/components/text-game/TextOpenWorldPlayer'
import TextOpenWorldVNextPlayer from '../../src/components/text-game/TextOpenWorldVNextPlayer'
import { db } from '../../src/lib/db/schema'
import { createTextOpenWorldCombatStateMachineV1 } from '../../src/lib/open-world/combat-state-machine'
import { classifyTextOpenWorldPlayerIssueV1 } from '../../src/lib/open-world/player-resilience'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import {
  createGovernedTextOpenWorldSessionFixtureV1,
  createTextOpenWorldPlayerSessionRowFixtureV1,
  createTextOpenWorldProductRuntimePackageFixtureV1,
} from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const originalExecuteVNextAction = useTextOpenWorldPlayerStore.getState().executeVNextAction

function resetStore() {
  useTextOpenWorldPlayerStore.setState({
    scope: null,
    worldGroupId: null,
    releases: [],
    sessions: [],
    selectedSessionId: null,
    selectedSession: null,
    selectedSessionSource: null,
    events: [],
    checkpoints: [],
    runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
    selectedManifest: null,
    lastFeedback: null,
    generatedCandidate: null,
    issue: null,
    recovery: null,
    recoveryNotice: '',
    loading: false,
    busy: false,
    error: '',
    executeVNextAction: originalExecuteVNextAction,
  })
}

function buttonByText(host: ParentNode, text: string, contains = false): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find(candidate => (
    contains ? candidate.textContent?.includes(text) : candidate.textContent?.trim() === text
  ))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮:${text}`)
  return button
}

function buttonByLabel(host: ParentNode, label: string): HTMLButtonElement {
  const button = host.querySelector(`button[aria-label="${label}"]`)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮:${label}`)
  return button
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function waitFor(assertion: () => void | Promise<void>) {
  const started = Date.now()
  let last: unknown
  while (Date.now() - started < 12_000) {
    try {
      await act(async () => { await assertion() })
      return
    } catch (reason) {
      last = reason
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  throw last
}

function viewSection(main: Element, view: string): HTMLElement {
  const section = Array.from(main.children).find(child => child.getAttribute('data-open-world-view') === view)
  if (!(section instanceof HTMLElement)) throw new Error(`找不到主视图:${view}`)
  return section
}

describe('Text Open World G4 · 真实 vNext 玩家壳集成', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeAll(async () => { await db.delete(); await db.open() })

  beforeEach(async () => {
    await db.delete()
    await db.open()
    localStorage.clear()
    resetStore()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  afterAll(() => db.close())

  it.sequential('新旅程把现有能力分配到五个视图，纯导航不改变运行投影和时间线', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `玩家壳集成-${crypto.randomUUID()}`,
      textOpenWorldVNext: createTextOpenWorldVNextFixture(),
      runtimeShape: 'vnext-only',
      title: '已有盐脊旅程',
      seed: 'g4-shell-existing-session',
    })

    await act(async () => {
      root.render(createElement(DialogProvider, null, createElement(TextOpenWorldPlayer, {
        project: created.project,
        scope: created.scope,
        worldGroupId: null,
      })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await waitFor(() => {
      expect(useTextOpenWorldPlayerStore.getState().loading).toBe(false)
      expect(host.textContent).toContain('盐脊')
    })

    await click(buttonByText(host, '查看详情', true))
    await click(buttonByText(host, '新旅程'))
    await waitFor(() => {
      expect(useTextOpenWorldPlayerStore.getState().busy).toBe(false)
      expect(host.querySelector('[data-testid="text-open-world-vnext-runtime"]')).toBeTruthy()
    })
    expect(useTextOpenWorldPlayerStore.getState().selectedSessionId).not.toBe(created.session.id)

    const shell = host.querySelector('[data-testid="text-open-world-shell"]')!
    const navigation = host.querySelector('[data-testid="text-open-world-navigation-rail"]')!
    const main = host.querySelector('[data-testid="text-open-world-main-view"]')!
    const header = host.querySelector('[data-testid="text-open-world-header"]')!
    const source = header.querySelector('.open-world-game-heading > small')!
    const status = host.querySelector('[data-testid="text-open-world-global-status"]')!
    const exit = buttonByLabel(host, '退出游戏')
    const before = useTextOpenWorldPlayerStore.getState()
    const runtimeStateBefore = structuredClone(before.runtimeState)
    const eventsBefore = structuredClone(before.events)
    const checkpointsBefore = structuredClone(before.checkpoints)

    expect(source.textContent).toContain('PRODUCT RELEASE v1 · 已固定')
    expect(status.textContent).toContain('生命')
    expect(status.textContent).toContain('盐港')
    expect(status.textContent).toContain('第 1 天')
    expect(viewSection(main, 'scene').hidden).toBe(false)
    expect(viewSection(main, 'scene').textContent).toContain('当前可执行行动')

    await click(buttonByText(navigation, '地图'))
    const map = viewSection(main, 'map')
    expect(shell.getAttribute('data-active-view')).toBe('map')
    expect(map.hidden).toBe(false)
    expect(map.querySelector('[data-testid="text-open-world-map-topology"]')?.textContent).toContain('断脊渠口')

    await click(buttonByText(navigation, '任务'))
    const quests = viewSection(main, 'quests')
    expect(shell.getAttribute('data-active-view')).toBe('quests')
    expect(quests.hidden).toBe(false)
    expect(quests.querySelector('[data-testid="text-open-world-quest-hud"]')).toBeTruthy()
    expect(quests.querySelector('[aria-label="任务历史"]')).toBeTruthy()
    expect(quests.textContent).toContain('可见任务实例')
    expect(quests.textContent).toContain('断流的盐渠')

    const statusBeforeCharacter = status.textContent
    await click(buttonByText(navigation, '角色'))
    const character = viewSection(main, 'character')
    const characterPanel = character.querySelector('[data-testid="text-open-world-character-panel"]')
    expect(shell.getAttribute('data-active-view')).toBe('character')
    expect(character.hidden).toBe(false)
    expect(characterPanel).toBeTruthy()
    expect(character.querySelector('[data-testid="text-open-world-character-identity"]')?.textContent).toContain('来客')
    const experience = character.querySelector<HTMLProgressElement>(
      '[data-testid="text-open-world-character-experience"] progress',
    )
    expect(experience?.getAttribute('aria-label')).toBe('等级经验进度 0%')
    expect(experience?.value).toBe(0)
    expect(character.querySelector('[data-testid="text-open-world-character-progression"]')?.textContent)
      .toContain('等级 1 / 20')
    const attributes = character.querySelector('[data-testid="text-open-world-character-attributes"]')
    expect(attributes?.querySelectorAll('section')).toHaveLength(3)
    expect(attributes?.textContent).toContain('力量')
    expect(attributes?.textContent).toContain('体质')
    expect(attributes?.textContent).toContain('敏捷')
    const statBreakdowns = character.querySelectorAll(
      'details[data-testid="text-open-world-character-stat-breakdown"]',
    )
    expect(statBreakdowns).toHaveLength(6)
    expect(statBreakdowns[0]?.textContent).toContain('展开查看数值来源')
    expect(statBreakdowns[0]?.textContent).toContain('基础生命')
    const skills = character.querySelector('[data-testid="text-open-world-character-skills"]')
    expect(skills?.textContent).toContain('挥击')
    expect(skills?.textContent).toContain('主动技能 · 攻击 · 单个敌人')
    expect(skills?.textContent).toContain('技能条件就绪')
    expect(skills?.textContent).toContain('规则冷却')
    expect(skills?.textContent).toContain('当前冷却')
    expect(skills?.textContent).toContain('初始可掌握')
    expect(character.querySelector('[data-testid="text-open-world-character-statuses"]')?.textContent)
      .toContain('当前没有持续状态')
    expect(character.textContent).not.toMatch(/(?:skill|condition|quest|status|effect)\./)
    expect(character.textContent).not.toContain('world-release:')
    expect(status.textContent).toBe(statusBeforeCharacter)
    const afterCharacterNavigation = useTextOpenWorldPlayerStore.getState()
    expect(afterCharacterNavigation.runtimeState).toEqual(runtimeStateBefore)
    expect(afterCharacterNavigation.events).toEqual(eventsBefore)
    expect(afterCharacterNavigation.checkpoints).toEqual(checkpointsBefore)

    await click(buttonByText(navigation, '更多'))
    const more = viewSection(main, 'more')
    expect(shell.getAttribute('data-active-view')).toBe('more')
    expect(more.hidden).toBe(false)
    expect(more.querySelector('[data-testid="text-open-world-crafting-economy-panel"]')).toBeTruthy()
    expect(more.querySelector('[data-testid="text-open-world-inventory-panel"]')).toBeTruthy()
    expect(more.querySelector('[data-testid="text-open-world-relationships"]')).toBeTruthy()
    expect(more.textContent).toContain('制作与交易')
    expect(more.textContent).toContain('盐露药剂')
    expect(more.textContent).toContain('背包')
    expect(more.textContent).toContain('存档、分支与设置')

    await click(buttonByLabel(host, '返回当前场景'))
    expect(shell.getAttribute('data-active-view')).toBe('scene')
    expect(viewSection(main, 'scene').hidden).toBe(false)
    expect(viewSection(main, 'scene').textContent).toContain('盐港')
    expect(host.querySelector('[data-testid="text-open-world-header"]')).toBe(header)
    expect(header.querySelector('.open-world-game-heading > small')).toBe(source)
    expect(host.querySelector('[data-testid="text-open-world-global-status"]')).toBe(status)
    expect(buttonByLabel(host, '退出游戏')).toBe(exit)

    const after = useTextOpenWorldPlayerStore.getState()
    expect(after.runtimeState).toEqual(runtimeStateBefore)
    expect(after.events).toEqual(eventsBefore)
    expect(after.checkpoints).toEqual(checkpointsBefore)
    expect(after.selectedSessionId).toBe(before.selectedSessionId)
  }, 30_000)

  it.sequential('切换 Session 会撤销旧高风险确认，旧确认不能写入新 Session', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const productRuntimePackage = createTextOpenWorldProductRuntimePackageFixtureV1(runtimePackage)
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const writtenSessionIds: Array<number | null> = []
    const executeVNextAction = vi.fn(async () => {
      writtenSessionIds.push(useTextOpenWorldPlayerStore.getState().selectedSessionId)
      return {} as never
    })
    useTextOpenWorldPlayerStore.setState({
      sessions: [],
      releases: [],
      selectedSessionId: 101,
      selectedSession: createTextOpenWorldPlayerSessionRowFixtureV1({
        sessionId: 101,
        projection,
      }),
      selectedSessionSource: 'build-preview',
      selectedManifest: productRuntimePackage,
      runtimeState: { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: projection },
      checkpoints: [],
      events: [],
      busy: false,
      lastFeedback: null,
      error: '',
      executeVNextAction,
    })

    await act(async () => {
      root.render(createElement(TextOpenWorldVNextPlayer))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    const riskyAction = buttonByText(host, '偷取盐露药剂', true)
    await click(riskyAction)
    const staleConfirm = buttonByText(host, '确认执行')
    expect(host.querySelector('[role="alertdialog"]')).toBeTruthy()

    await act(async () => {
      useTextOpenWorldPlayerStore.setState({
        selectedSessionId: 202,
        selectedSession: createTextOpenWorldPlayerSessionRowFixtureV1({
          sessionId: 202,
          projection,
        }),
        runtimeState: {
          ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
          textOpenWorld: structuredClone(projection),
        },
      })
      // 模拟 Session 切换通知已抵达、React 尚未提交新树时，旧 DOM 仍收到点击。
      // 确认处理器必须读取当前 Store 身份，而不能只信任旧 render 的闭包。
      staleConfirm.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(host.querySelector('[role="alertdialog"]')).toBeNull()
    expect(writtenSessionIds).toEqual([])
  })

  it.sequential('活动战斗状态在当前可见运行视图中保持可见', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const productRuntimePackage = createTextOpenWorldProductRuntimePackageFixtureV1(runtimePackage)
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.combat = createTextOpenWorldCombatStateMachineV1(runtimePackage).initialize({
      state: projection.state,
      encounterKey: 'encounter.ridge-jackal',
      instanceKey: 'combat.shell-active',
    })
    useTextOpenWorldPlayerStore.setState({
      sessions: [],
      releases: [],
      selectedSessionId: 303,
      selectedSession: createTextOpenWorldPlayerSessionRowFixtureV1({
        sessionId: 303,
        projection,
      }),
      selectedSessionSource: 'build-preview',
      selectedManifest: productRuntimePackage,
      runtimeState: { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: projection },
      checkpoints: [],
      events: [],
      busy: false,
      lastFeedback: null,
      error: '',
    })

    await act(async () => {
      root.render(createElement(TextOpenWorldVNextPlayer))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const main = host.querySelector('[data-testid="text-open-world-main-view"]')!
    const scene = viewSection(main, 'scene')
    const combatStatus = host.querySelector('[data-testid="text-open-world-combat-status"]')
    expect(scene.hidden).toBe(false)
    expect(combatStatus?.closest('[data-testid="text-open-world-global-status"]')).toBeTruthy()
    expect(combatStatus?.textContent).toContain('战斗')
    expect(combatStatus?.textContent).toContain('战斗进行中')
    expect(scene.querySelector('[data-testid="text-open-world-combat-panel"]')).toBeTruthy()
    expect(scene.querySelector('[data-testid="text-open-world-natural-input"]')).toBeNull()
  })

  it.sequential('运行页显示当前 Session 冻结 RuntimePackage hash', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `玩家壳来源证据-${crypto.randomUUID()}`,
      textOpenWorldVNext: createTextOpenWorldVNextFixture(),
      runtimeShape: 'vnext-only',
      title: '盐脊来源证据存档',
      seed: 'g4-shell-runtime-source-hash',
    })

    await act(async () => {
      root.render(createElement(DialogProvider, null, createElement(TextOpenWorldPlayer, {
        project: created.project,
        scope: created.scope,
        worldGroupId: null,
        initialSessionId: created.session.id,
      })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await waitFor(() => {
      expect(useTextOpenWorldPlayerStore.getState().loading).toBe(false)
      expect(host.querySelector('[data-testid="text-open-world-shell"]')).toBeTruthy()
    })

    const packageHash = host.querySelector('[data-testid="text-open-world-runtime-package-hash"]')
    expect(packageHash?.textContent).toContain(created.session.runtimeSourceHash.slice(0, 12))
  })

  it.sequential('父壳只公开固定分类错误，未知 Action、物品与 hash 诊断不进入 DOM', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const productRuntimePackage = createTextOpenWorldProductRuntimePackageFixtureV1(runtimePackage)
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const leakedActionKey = 'action.private-vault-operation'
    const leakedItemKey = 'item.private-ledger'
    const leakedHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const operationError = `[text-open-world-action-executor] Release不存在Action:${leakedActionKey}; ${leakedItemKey}; ${leakedHash}`
    useTextOpenWorldPlayerStore.setState({
      sessions: [],
      releases: [],
      selectedSessionId: 404,
      selectedSession: createTextOpenWorldPlayerSessionRowFixtureV1({
        sessionId: 404,
        projection,
      }),
      selectedSessionSource: 'build-preview',
      selectedManifest: productRuntimePackage,
      runtimeState: { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: projection },
      checkpoints: [],
      events: [],
      busy: false,
      lastFeedback: null,
      error: operationError,
      issue: classifyTextOpenWorldPlayerIssueV1({ error: operationError, surface: 'runtime-operation' }),
    })

    await act(async () => {
      root.render(createElement(TextOpenWorldVNextPlayer))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const alert = host.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('操作未能完成')
    expect(alert?.getAttribute('data-diagnostic-code')).toBe('TOW-PLAYER-OPERATION')
    expect(host.innerHTML).not.toContain(leakedActionKey)
    expect(host.innerHTML).not.toContain(leakedItemKey)
    expect(host.innerHTML).not.toContain(leakedHash)

    await act(async () => {
      const error = `[text-open-world-action-executor] 确认基线已变化，请刷新当前状态后重新确认:${leakedActionKey}`
      useTextOpenWorldPlayerStore.setState({
        error,
        issue: classifyTextOpenWorldPlayerIssueV1({ error, surface: 'runtime-operation' }),
      })
    })
    expect(host.querySelector('[role="alert"]')?.textContent)
      .toContain('游戏状态已经更新')
    expect(host.innerHTML).not.toContain(leakedActionKey)

    await act(async () => {
      const error = `[text-open-world] 存档加载失败，可返回游戏库重试：${leakedHash}`
      useTextOpenWorldPlayerStore.setState({
        error,
        issue: classifyTextOpenWorldPlayerIssueV1({ error, surface: 'runtime-load' }),
      })
    })
    expect(host.querySelector('[role="alert"]')?.textContent)
      .toContain('存档暂时无法载入')
    expect(host.innerHTML).not.toContain(leakedHash)

    await act(async () => {
      const error = `[text-open-world] 只能删除当前World/Work和世界分组内的文字开放世界存档。:${leakedItemKey}`
      useTextOpenWorldPlayerStore.setState({
        error,
        issue: classifyTextOpenWorldPlayerIssueV1({ error, surface: 'runtime-operation' }),
      })
    })
    expect(host.querySelector('[role="alert"]')?.textContent)
      .toContain('操作未能完成')
    expect(host.innerHTML).not.toContain(leakedItemKey)
  })
})
