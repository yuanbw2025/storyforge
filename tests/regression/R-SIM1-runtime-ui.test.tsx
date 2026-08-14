import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import SimulationRuntimePanel from '../../src/components/simulation/SimulationRuntimePanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { db } from '../../src/lib/db/schema'
import { EMPTY_SIMULATION_STATE, type Project } from '../../src/lib/types'
import { useSimulationRuntimeStore } from '../../src/stores/simulation-runtime'
import { appendNpcEvolutionProposal, createSimulationSession, readSimulationState } from '../../src/lib/simulation/runtime'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function changeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll('button'))
    .find(item => item.textContent?.trim() === text)
  if (!result) throw new Error(`找不到按钮: ${text}`)
  return result
}

async function clickWhenEnabled(host: HTMLElement, text: string) {
  const target = button(host, text)
  await viWaitFor(() => expect(target.disabled).toBe(false))
  await act(async () => {
    target.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('SIM-1B · 互动运行时 UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let project: Project

  beforeEach(async () => {
    await db.delete()
    await db.open()
    useSimulationRuntimeStore.setState({
      projectId: null,
      worldGroupId: null,
      sessions: [],
      selectedSessionId: null,
      events: [],
      pendingProposals: [],
      checkpoints: [],
      runtimeState: structuredClone(EMPTY_SIMULATION_STATE),
      loading: false,
      error: '',
    })
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '互动运行时 UI',
      genre: '',
      genres: [],
      status: 'drafting',
      description: '',
      targetWordCount: 0,
      enableMultiWorld: false,
      createdAt: now,
      updatedAt: now,
    } as Project) as number
    project = (await db.projects.get(projectId))!
    await db.characters.add({
      projectId,
      homeWorldGroupId: null,
      name: '林舟',
      role: 'protagonist',
      roleWeight: 'main',
      moralAxis: 'neutral',
      orderAxis: 'neutral',
      alignment: 'good',
      shortDescription: '潮汐旅人',
      appearance: '',
      personality: '',
      background: '',
      motivation: '',
      abilities: '',
      relationships: '',
      arc: '',
      createdAt: now,
      updatedAt: now,
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    db.close()
  })

  it('从可见入口创建会话、追加事件、保存检查点、建立分支并安全删除', async () => {
    await act(async () => {
      root.render(createElement(
        DialogProvider,
        null,
        createElement(SimulationRuntimePanel, { project, worldGroupId: null }),
      ))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    const title = host.querySelector<HTMLInputElement>('input[placeholder="新会话名称"]')!
    await act(async () => changeValue(title, '雾港跑团'))
    await viWaitFor(() => expect(
      host.querySelector<HTMLInputElement>('input[aria-label="冻结 角色 林舟"]'),
    ).not.toBeNull())
    await act(async () => {
      host.querySelector<HTMLInputElement>('input[aria-label="冻结 世界 互动运行时 UI"]')!.click()
      host.querySelector<HTMLInputElement>('input[aria-label="冻结 角色 林舟"]')!.click()
    })
    await clickWhenEnabled(host, '创建并冻结')
    await viWaitFor(() => expect(host.textContent).toContain('雾港跑团'))
    expect(await db.simulationSessions.count()).toBe(1)
    expect(host.textContent).toContain('Canon 冻结审计')
    expect(host.textContent).toContain('运行时实体')
    expect(host.textContent).toContain('林舟')

    const time = host.querySelector<HTMLInputElement>('input[aria-label="推进时间"]')!
    await act(async () => changeValue(time, '3'))
    await clickWhenEnabled(host, '推进时间')
    await viWaitFor(() => expect(host.textContent).toContain('时间 +3'))

    const narrative = host.querySelector<HTMLTextAreaElement>('textarea')!
    await act(async () => changeValue(narrative, '守门人交出了潮汐密钥。'))
    await clickWhenEnabled(host, '追加叙事事件')
    await viWaitFor(() => expect(host.textContent).toContain('守门人交出了潮汐密钥。'))

    const checkpoint = host.querySelector<HTMLInputElement>('input[placeholder="检查点名称"]')!
    await act(async () => changeValue(checkpoint, '进入钟楼前'))
    await clickWhenEnabled(host, '保存')
    await viWaitFor(() => expect(host.textContent).toContain('进入钟楼前'))

    const branch = host.querySelector<HTMLInputElement>('input[placeholder="新分支名称"]')!
    await act(async () => changeValue(branch, '拒绝密钥分支'))
    await clickWhenEnabled(host, '分支')
    await viWaitFor(() => expect(db.simulationSessions.count()).resolves.toBe(2))
    const child = (await db.simulationSessions.toArray())
      .find(session => session.title === '拒绝密钥分支')
    expect(child).toMatchObject({ parentThroughSequence: 2 })
    expect(child?.parentSessionId).toBeTypeOf('number')

    await viWaitFor(() => expect(host.querySelector(
      'button[aria-label="删除会话 拒绝密钥分支"]',
    )).not.toBeNull())
    const remove = host.querySelector<HTMLButtonElement>(
      'button[aria-label="删除会话 拒绝密钥分支"]',
    )!
    await act(async () => remove.click())
    await viWaitFor(() => expect(host.textContent).toContain('删除互动会话“拒绝密钥分支”？'))
    await act(async () => {
      button(host, '删除').click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await viWaitFor(() => expect(db.simulationSessions.count()).resolves.toBe(1))
    expect(await db.simulationEvents.count()).toBe(2)
  })

  it('NPC 演进候选刷新后仍可从面板确认并应用', async () => {
    const session = await createSimulationSession({
      projectId: project.id!,
      kind: 'npc-evolution',
      title: 'NPC 演进线',
      initialState: {
        ...structuredClone(EMPTY_SIMULATION_STATE),
        entities: {
          'npc:gatekeeper': {
            entityKey: 'npc:gatekeeper',
            kind: 'npc',
            sourceId: null,
            name: '守门人',
            locationKey: null,
            lifecycleStatus: 'active',
            attributes: { role: 'npc', mood: '平静' },
          },
        },
      },
    })
    await appendNpcEvolutionProposal({
      sessionId: session.id!,
      candidate: {
        baseSequence: 0,
        entityKey: 'npc:gatekeeper',
        locationKey: null,
        lifecycleStatus: 'active',
        attributes: { mood: '警惕' },
        narrative: '守门人开始留意城外动静。',
        memory: null,
        rationale: '作者确认后的运行时状态变化。',
      },
    })

    await act(async () => {
      root.render(createElement(
        DialogProvider,
        null,
        createElement(SimulationRuntimePanel, { project, worldGroupId: null }),
      ))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await viWaitFor(() => expect(host.textContent).toContain('NPC 演进候选'))
    await viWaitFor(() => expect(host.textContent).toContain('守门人开始留意城外动静。'))
    await clickWhenEnabled(host, '确认并应用')
    await viWaitFor(() => expect((readSimulationState(session.id!)).then(state => state.lastSequence)).resolves.toBe(2))
    expect((await readSimulationState(session.id!)).entities['npc:gatekeeper'].attributes.mood).toBe('警惕')
    expect(host.textContent).toContain('暂无待确认候选')
  })

  it('跑团会话可从可见入口开始场景并执行确定性技能检定', async () => {
    const session = await createSimulationSession({
      projectId: project.id!,
      kind: 'ttrpg',
      title: '钟楼战役',
      seed: 'ui-ttrpg',
      initialState: {
        ...structuredClone(EMPTY_SIMULATION_STATE),
        entities: {
          'character:linzhou': {
            entityKey: 'character:linzhou',
            kind: 'character',
            sourceId: 1,
            name: '林舟',
            locationKey: null,
            lifecycleStatus: 'active',
            attributes: { role: 'player' },
          },
        },
      },
    })
    await act(async () => {
      root.render(createElement(
        DialogProvider,
        null,
        createElement(SimulationRuntimePanel, { project, worldGroupId: null }),
      ))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await viWaitFor(() => expect(host.textContent).toContain('单机战役主持'))
    await act(async () => {
      changeValue(host.querySelector<HTMLInputElement>('input[aria-label="跑团场景标题"]')!, '钟楼门厅')
      changeValue(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="跑团场景描述"]')!, '潮声从墙后传来。')
      changeValue(host.querySelector<HTMLInputElement>('input[aria-label="跑团回合顺序"]')!, 'character:linzhou')
    })
    await clickWhenEnabled(host, '开始场景')
    await viWaitFor(() => expect(host.textContent).toContain('第 1 回合'))
    expect((await readSimulationState(session.id!)).ttrpg).toMatchObject({
      activeActorKey: 'character:linzhou',
      turnOrder: ['character:linzhou'],
    })
    await act(async () => {
      changeValue(host.querySelector<HTMLInputElement>('input[aria-label="跑团检定技能"]')!, '感知')
      changeValue(host.querySelector<HTMLInputElement>('input[aria-label="跑团检定难度"]')!, '10')
    })
    await clickWhenEnabled(host, '技能检定')
    await viWaitFor(() => expect((readSimulationState(session.id!)).then(state => state.ttrpg?.checks.length)).resolves.toBe(1))
    expect(host.textContent).toContain('检定：感知')
  })

  it('跑团面板可创建战斗遭遇并执行攻击、资源与状态操作', async () => {
    const session = await createSimulationSession({
      projectId: project.id!,
      kind: 'ttrpg',
      title: '战斗遭遇 UI',
      seed: 'ui-ttrpg-1b',
      initialState: {
        ...structuredClone(EMPTY_SIMULATION_STATE),
        entities: {
          'character:linzhou': {
            entityKey: 'character:linzhou', kind: 'character', sourceId: 1, name: '林舟', locationKey: null,
            lifecycleStatus: 'active', attributes: { role: 'player', hp: 20, maxHp: 20, armorClass: 12, initiative: 20 },
          },
          'npc:watcher': {
            entityKey: 'npc:watcher', kind: 'npc', sourceId: null, name: '守望者', locationKey: null,
            lifecycleStatus: 'active', attributes: { role: 'npc', hp: 10, maxHp: 10, armorClass: 10, initiative: 10 },
          },
        },
      },
    })
    await act(async () => {
      root.render(createElement(
        DialogProvider,
        null,
        createElement(SimulationRuntimePanel, { project, worldGroupId: null }),
      ))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await viWaitFor(() => expect(useSimulationRuntimeStore.getState().selectedSessionId).toBe(session.id))
    await viWaitFor(() => expect(host.textContent).toContain('战斗遭遇与规则'))
    await act(async () => {
      changeValue(host.querySelector<HTMLInputElement>('input[aria-label="跑团场景标题"]')!, '战斗场景')
      changeValue(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="跑团场景描述"]')!, '战斗即将开始。')
      changeValue(host.querySelector<HTMLInputElement>('input[aria-label="跑团回合顺序"]')!, 'character:linzhou,npc:watcher')
    })
    await clickWhenEnabled(host, '开始场景')
    await act(async () => {
      changeValue(host.querySelector<HTMLInputElement>('input[aria-label="跑团遭遇标题"]')!, '门厅伏击')
      changeValue(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="跑团遭遇描述"]')!, '击退守望者。')
    })
    await clickWhenEnabled(host, '直接开始遭遇')
    await viWaitFor(() => expect((readSimulationState(session.id!)).then(state => state.ttrpg?.encounter?.title)).resolves.toBe('门厅伏击'))
    await act(async () => {
      changeValue(host.querySelector<HTMLInputElement>('input[aria-label="攻击骰式"]')!, '1d20+100')
      changeValue(host.querySelector<HTMLInputElement>('input[aria-label="伤害骰式"]')!, '1d4')
    })
    await clickWhenEnabled(host, '执行攻击')
    await viWaitFor(() => expect((readSimulationState(session.id!)).then(state => state.ttrpg?.attacks.length)).resolves.toBe(1))
    expect(host.textContent).toContain('战斗第 1 回合')
    expect((await readSimulationState(session.id!)).ttrpg?.encounter?.activeActorKey).toBe('npc:watcher')
  })

  it('产品跑团入口只显示跑团存档，不会自动打开已有沙盒会话', async () => {
    const ttrpg = await createSimulationSession({
      projectId: project.id!,
      kind: 'ttrpg',
      title: '产品跑团战役',
      seed: 'product-ttrpg',
      initialState: structuredClone(EMPTY_SIMULATION_STATE),
    })
    const sandbox = await createSimulationSession({
      projectId: project.id!,
      kind: 'sandbox',
      title: '不应出现在跑团页的沙盒',
      seed: 'product-sandbox',
      initialState: structuredClone(EMPTY_SIMULATION_STATE),
    })
    await db.simulationSessions.update(sandbox.id!, { updatedAt: Date.now() + 1_000 })

    await act(async () => {
      root.render(createElement(
        DialogProvider,
        null,
        createElement(SimulationRuntimePanel, {
          project,
          worldGroupId: null,
          sessionKind: 'ttrpg',
        }),
      ))
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    await viWaitFor(() => expect(useSimulationRuntimeStore.getState().selectedSessionId).toBe(ttrpg.id))
    await viWaitFor(() => expect(host.textContent).toContain('单机战役主持'))
    expect(host.textContent).toContain('产品跑团战役')
    expect(host.textContent).not.toContain('不应出现在跑团页的沙盒')
    expect(host.querySelector('[data-testid="runtime-kind-lock"]')?.textContent).toContain('跑团存档')
    expect(host.querySelector('select[aria-label="运行时类型"]')).toBeNull()
  })
})

async function viWaitFor(assertion: () => void | Promise<void>) {
  const started = Date.now()
  let lastError: unknown
  while (Date.now() - started < 3_000) {
    try {
      await act(async () => {
        await assertion()
      })
      return
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
      })
    }
  }
  throw lastError
}
