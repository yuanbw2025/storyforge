import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DialogProvider } from '../../src/components/shared/Dialog'
import TextOpenWorldPlayer from '../../src/components/text-game/TextOpenWorldPlayer'
import TextOpenWorldScenePanel from '../../src/components/text-game/TextOpenWorldScenePanel'
import TextOpenWorldVNextPlayer from '../../src/components/text-game/TextOpenWorldVNextPlayer'
import { db } from '../../src/lib/db/schema'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import { projectTextOpenWorldScenesV1 } from '../../src/lib/open-world/scene-projection'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
} from '../../src/lib/open-world/session-projection'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import {
  createGovernedTextOpenWorldSessionFixtureV1,
  createTextOpenWorldProductRuntimePackageFixtureV1,
} from '../helpers/text-open-world-product-session'
import {
  createTextOpenWorldVNextFixture,
  createTextOpenWorldVNextP9Fixture,
  createTextOpenWorldVNextP9UnboundRestFixture,
} from '../helpers/text-open-world-vnext-fixture'

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

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
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

function commandEnvelope(actionKey: string): {
  actionKey: string
  source: string
  targetKey: string | null
} | null {
  const event = [...useTextOpenWorldPlayerStore.getState().events]
    .reverse()
    .find(candidate => {
      if (candidate.type !== 'text-open-world.command.committed') return false
      const payload = JSON.parse(candidate.payloadJson) as { envelope?: { actionKey?: string } }
      return payload.envelope?.actionKey === actionKey
    })
  if (!event) return null
  const payload = JSON.parse(event.payloadJson) as {
    envelope: { actionKey: string; source: string; payload: { targetKey: string | null } }
  }
  return {
    actionKey: payload.envelope.actionKey,
    source: payload.envelope.source,
    targetKey: payload.envelope.payload.targetKey ?? null,
  }
}

describe('Text Open World G4-03 · 场景与三类输入集成', () => {
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

  it.sequential('展示冻结P9叙事，并把NPC当前关系投影为差、一般、好三档对话', async () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const manifest = createTextOpenWorldProductRuntimePackageFixtureV1(runtimePackage)
    const neutral = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    useTextOpenWorldPlayerStore.setState({
      selectedSessionId: 101,
      selectedSessionSource: 'build-preview',
      selectedManifest: manifest,
      runtimeState: { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: neutral },
    })

    await act(async () => {
      root.render(createElement(TextOpenWorldVNextPlayer))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const published = host.querySelector('[data-testid="text-open-world-published-scene"]')
    expect(published?.textContent).toContain('冻结叙事')
    expect(published?.textContent).toContain('干涸的内渠')
    expect(published?.textContent).toContain('潮声仍在堤外起伏')
    expect(host.querySelector('[data-testid="text-open-world-npc-dialogue"]')).toBeNull()

    await click(buttonByText(host, '岑阿婆 · 守渠人的话'))
    let dialogue = host.querySelector('[data-testid="text-open-world-npc-dialogue"]')
    expect(dialogue?.textContent).toContain('态度一般 · 礼貌而保留')
    expect(dialogue?.textContent).toContain('岑阿婆礼貌地点头，等你说明来意。')

    const bad = structuredClone(neutral)
    bad.state.relationships.morality = -100
    bad.state.relationships.factionAffinityByKey['faction.canal-keepers'] = -100
    await act(async () => {
      useTextOpenWorldPlayerStore.setState({
        runtimeState: { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: bad },
      })
    })
    dialogue = host.querySelector('[data-testid="text-open-world-npc-dialogue"]')
    expect(dialogue?.textContent).toContain('态度较差 · 冷淡而克制')
    expect(dialogue?.textContent).toContain('岑阿婆把渠图收近了些，只冷淡地问你还有什么正事。')

    const good = structuredClone(neutral)
    good.state.relationships.morality = 100
    good.state.relationships.factionAffinityByKey['faction.canal-keepers'] = 100
    await act(async () => {
      useTextOpenWorldPlayerStore.setState({
        runtimeState: { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: good },
      })
    })
    dialogue = host.querySelector('[data-testid="text-open-world-npc-dialogue"]')
    expect(dialogue?.textContent).toContain('态度友好 · 友善且愿意帮助')
    expect(dialogue?.textContent).toContain('岑阿婆给你让出石栏边的位置，愿意把记得的细节再讲一遍。')
  })

  it.sequential('固定选项只选择既有Action，并把fixed-choice写入正式命令信封', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `场景固定选项-${crypto.randomUUID()}`,
      textOpenWorldVNext: createTextOpenWorldVNextP9Fixture(),
      runtimeShape: 'vnext-only',
      title: '盐脊固定选项存档',
      seed: 'g4-scene-fixed-choice',
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
      expect(host.textContent).toContain('接下盐渠委托')
    })

    await click(buttonByText(host, '接下盐渠委托', true))
    await waitFor(() => {
      expect(useTextOpenWorldPlayerStore.getState().busy).toBe(false)
      expect(commandEnvelope('action.accept-main')).toMatchObject({ source: 'fixed-choice' })
    })

    expect(commandEnvelope('action.accept-main')).toEqual({
      actionKey: 'action.accept-main',
      source: 'fixed-choice',
      targetKey: expect.stringContaining('quest.main.1'),
    })
    const receipt = host.querySelector('[data-testid="text-open-world-feedback"]')
    expect(receipt?.getAttribute('role')).toBe('status')
    expect(receipt?.getAttribute('aria-live')).toBe('polite')
    expect(receipt?.getAttribute('aria-atomic')).toBe('true')
    expect(host.textContent).toContain('盐壳下的水痕')
  }, 20_000)

  it.sequential('正式生产语义下未绑定场景的休息仍作为系统Action可执行', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `场景通用行动-${crypto.randomUUID()}`,
      textOpenWorldVNext: createTextOpenWorldVNextP9UnboundRestFixture(),
      runtimeShape: 'vnext-only',
      title: '盐脊通用行动存档',
      seed: 'g4-scene-ambient-action',
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
      expect(host.querySelector('[data-testid="text-open-world-system-actions"]')?.textContent)
        .toContain('休息')
    })

    await click(buttonByText(host, '休息', true))
    await waitFor(() => {
      expect(useTextOpenWorldPlayerStore.getState().busy).toBe(false)
      expect(commandEnvelope('action.rest')).toMatchObject({ source: 'system-action', targetKey: null })
    })
    expect(useTextOpenWorldPlayerStore.getState().runtimeState.textOpenWorld?.state.time.worldMinute)
      .toBeGreaterThan(480)
  }, 20_000)

  it.sequential('自然输入仅精确映射冻结例句；不匹配时给出边界提示且不写事件', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: `场景自然输入-${crypto.randomUUID()}`,
      textOpenWorldVNext: createTextOpenWorldVNextP9Fixture(),
      runtimeShape: 'vnext-only',
      title: '盐脊自然输入存档',
      seed: 'g4-scene-natural-input',
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
      expect(host.querySelector('#text-open-world-natural-command')).toBeTruthy()
    })

    const input = host.querySelector('#text-open-world-natural-command')
    if (!(input instanceof HTMLInputElement)) throw new Error('自然语言输入框不存在')
    const eventCountBeforeBoundary = useTextOpenWorldPlayerStore.getState().events.length
    await setInputValue(input, '我要飞到月亮')
    await click(buttonByText(host, '提交'))

    expect(useTextOpenWorldPlayerStore.getState().events).toHaveLength(eventCountBeforeBoundary)
    expect(host.querySelector('[data-testid="text-open-world-input-notice"]')?.textContent)
      .toContain('没有改变世界状态')
    expect(commandEnvelope('action.accept-main')).toBeNull()

    await setInputValue(input, '  我接受这个任务  ')
    await click(buttonByText(host, '提交'))
    await waitFor(() => {
      expect(useTextOpenWorldPlayerStore.getState().busy).toBe(false)
      expect(commandEnvelope('action.accept-main')).toMatchObject({ source: 'mapped-intent' })
    })

    expect(commandEnvelope('action.accept-main')).toEqual({
      actionKey: 'action.accept-main',
      source: 'mapped-intent',
      targetKey: expect.stringContaining('quest.main.1'),
    })
  }, 20_000)

  it.sequential('目标为零或不唯一时，固定Choice和自然输入都fail-closed', async () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const runtimeProjection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const projection = projectTextOpenWorldScenesV1(runtimeProjection)
    if (projection.status !== 'ready') throw new Error('测试需要P9场景投影')
    const acceptAction = createTextOpenWorldActionRegistryV1(runtimePackage)
      .project(deriveTextOpenWorldContextsV1(runtimeProjection).action)
      .find(action => action.action.key === 'action.accept-main')!
    const onExecute = vi.fn()
    const renderWithTargets = async (validTargetKeys: string[]) => {
      await act(async () => {
        root.render(createElement(TextOpenWorldScenePanel, {
          sessionKey: 'target-boundary',
          eventSequence: 0,
          projection,
          availableActions: [{ ...acceptAction, available: true, validTargetKeys }],
          feedback: null,
          busy: false,
          fallback: { regionTitle: '盐港', locationTitle: '盐港广场', description: '测试场景', playerName: '来客' },
          onExecute,
        }))
        await new Promise(resolve => setTimeout(resolve, 0))
      })
    }

    await renderWithTargets([])
    await click(buttonByText(host, '接下盐渠委托', true))
    expect(onExecute).not.toHaveBeenCalled()
    expect(host.querySelector('[data-testid="text-open-world-input-notice"]')?.textContent)
      .toContain('当前没有合法目标')
    const input = host.querySelector('#text-open-world-natural-command') as HTMLInputElement
    await setInputValue(input, '我接受这个任务')
    await click(buttonByText(host, '提交'))
    expect(onExecute).not.toHaveBeenCalled()

    await renderWithTargets(['quest-instance.1', 'quest-instance.2'])
    await click(buttonByText(host, '接下盐渠委托', true))
    expect(onExecute).not.toHaveBeenCalled()
    expect(host.querySelector('[data-testid="text-open-world-input-notice"]')?.textContent)
      .toContain('当前有多个合法目标')
  })

  it.sequential('场景页把专属战斗操作移交G4-09战斗面板，不再代选敌人或复用场景按钮', async () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const runtimeProjection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const projection = projectTextOpenWorldScenesV1(runtimeProjection)
    if (projection.status !== 'ready') throw new Error('测试需要P9场景投影')
    const projectedActions = createTextOpenWorldActionRegistryV1(runtimePackage)
      .project(deriveTextOpenWorldContextsV1(runtimeProjection).action)
    const projectedAction = projectedActions.find(action => action.action.key === 'action.combat-basic-attack')!
    const combatAction = {
      ...projectedAction,
      available: true,
      unavailableReasons: [],
      validTargetKeys: ['combatant.enemy.1', 'combatant.enemy.2'],
    }
    const onExecute = vi.fn()

    await act(async () => {
      root.render(createElement(TextOpenWorldScenePanel, {
        sessionKey: 'multi-enemy-fallback', eventSequence: 0, projection,
        availableActions: [...projectedActions.filter(action => action.available), combatAction],
        feedback: null, busy: false,
        fallback: { regionTitle: '盐港', locationTitle: '断脊渠口', description: '测试场景', playerName: '来客' },
        onExecute,
      }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(host.querySelector('[data-testid="text-open-world-fixed-choices"]')).toBeTruthy()
    const input = host.querySelector('#text-open-world-natural-command') as HTMLInputElement
    expect(input.disabled).toBe(false)
    expect(input.placeholder).toBe('输入本场景中的行动表达')
    expect(Array.from(host.querySelectorAll('button')).some(button => button.textContent?.includes('普通攻击')))
      .toBe(false)
    expect(host.querySelector('[data-testid="text-open-world-system-actions"]')?.textContent)
      .not.toContain('普通攻击')
    expect(onExecute).not.toHaveBeenCalled()
  })

  it.sequential('高风险固定Choice确认后仍保留原始source、目标和当前Session边界', async () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const narrative = runtimePackage.modules.narrative.payload as any
    const actions = runtimePackage.modules.actions.payload as any
    const actorScene = narrative.scenes.find((scene: any) => scene.key === 'scene.actor.caretaker')
    const riskyChoice = {
      key: 'choice.steal-tonic',
      sceneKey: actorScene.key,
      label: '偷取盐露药剂',
      description: '这是需要二次确认的犯罪行动。',
      actionKey: 'action.steal-tonic',
    }
    actorScene.actionKeys.push(riskyChoice.actionKey)
    actorScene.fixedChoiceKeys.push(riskyChoice.key)
    narrative.fixedChoices.push(riskyChoice)
    actions.inputBindings.actions
      .find((binding: any) => binding.actionKey === riskyChoice.actionKey)
      .fixedChoiceKeys.push(riskyChoice.key)

    const executeVNextAction = vi.fn(async () => ({ status: 'committed' }) as never)
    useTextOpenWorldPlayerStore.setState({
      selectedSessionId: 303,
      selectedSessionSource: 'build-preview',
      selectedManifest: createTextOpenWorldProductRuntimePackageFixtureV1(runtimePackage),
      runtimeState: {
        ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
        textOpenWorld: createInitialTextOpenWorldSessionProjectionV1(runtimePackage),
      },
      executeVNextAction,
    })

    await act(async () => {
      root.render(createElement(TextOpenWorldVNextPlayer))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await click(buttonByText(host, '岑阿婆 · 守渠人的话'))
    await click(buttonByText(host, '偷取盐露药剂', true))
    expect(host.querySelector('[role="alertdialog"][aria-modal="true"]')).toBeTruthy()

    await click(buttonByText(host, '确认执行'))
    await waitFor(() => expect(executeVNextAction).toHaveBeenCalledTimes(1))
    expect(executeVNextAction).toHaveBeenCalledWith(
      'action.steal-tonic',
      'actor.caretaker',
      {
        confirmed: true,
        source: 'fixed-choice',
        expectedBaseSequence: 0,
      },
    )
  })

  it.sequential('Narrative v1 / Action v14明确兼容降级，不伪造P9叙事或自然输入', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const manifest = createTextOpenWorldProductRuntimePackageFixtureV1(runtimePackage)
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    useTextOpenWorldPlayerStore.setState({
      selectedSessionId: 202,
      selectedSessionSource: 'build-preview',
      selectedManifest: manifest,
      runtimeState: { ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE), textOpenWorld: projection },
    })

    await act(async () => {
      root.render(createElement(TextOpenWorldVNextPlayer))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(host.textContent).toContain('旧版运行包')
    expect(host.textContent).toContain('叙事与自然输入不会被伪造')
    expect(host.textContent).toContain('系统 Action · 当前可执行行动')
    expect(host.textContent).not.toContain('冻结叙事')
    expect(host.textContent).not.toContain('干涸的内渠')
    expect(host.textContent).not.toContain('可识别示例')
    expect(host.textContent).not.toContain('向岑阿婆购买')
    expect(host.textContent).not.toContain('向岑阿婆出售')
    expect(host.textContent).not.toContain('制作盐露药剂')
    const input = host.querySelector('#text-open-world-natural-command')
    expect(input).toBeInstanceOf(HTMLInputElement)
    expect((input as HTMLInputElement).disabled).toBe(true)
    expect((input as HTMLInputElement).placeholder).toBe('当前场景没有自然语言绑定')
  })
})
