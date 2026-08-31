import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import AdventureGamePlayer from '../../src/components/text-game/AdventureGamePlayer'
import AdventureGameWorkbench from '../../src/components/text-game/AdventureGameWorkbench'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { publishAdventureGameDraft, seedAdventureAcceptanceGame } from '../../src/lib/adventure/authoring'
import { db } from '../../src/lib/db/schema'
import { readSimulationState } from '../../src/lib/simulation/runtime'
import { EMPTY_SIMULATION_STATE, type Project, type WorkspaceScope } from '../../src/lib/types'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { useAdventureGamePlayerStore } from '../../src/stores/adventure-game-player'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function button(host: ParentNode, text: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.trim() === text)
  if (!result) throw new Error(`找不到按钮:${text}`)
  return result
}

function buttonContaining(host: ParentNode, text: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes(text))
  if (!result) throw new Error(`找不到包含文本的按钮:${text}`)
  return result
}

async function click(host: ParentNode, text: string, contains = false) {
  await act(async () => {
    ;(contains ? buttonContaining(host, text) : button(host, text)).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function waitFor(assertion: () => void | Promise<void>) {
  const started = Date.now(); let last: unknown
  while (Date.now() - started < 8_000) {
    try { await act(async () => { await assertion() }); return } catch (reason) {
      last = reason
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  throw last
}

async function finishNarrative(host: ParentNode) {
  for (let step = 0; step < 100; step += 1) {
    const control = host.querySelector<HTMLButtonElement>('.adventure-narrative-continue')
    if (!control) return
    await act(async () => {
      control.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }
  throw new Error('逐句叙述未能在 100 步内结束')
}

async function fixture(): Promise<{ project: Project; scope: WorkspaceScope }> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '文字冒险 UI', genre: 'adventure', genres: ['adventure'], status: 'drafting', description: '',
    targetWordCount: 20_000, createdAt: now, updatedAt: now,
  } as any) as number
  const ownership = await ensureWorkspaceOwnership(projectId)
  return { project: ownership.project, scope: ownership.scope }
}

describe('TEXTADV-1 · author and player UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let scrollIntoView: ReturnType<typeof vi.fn>
  beforeAll(async () => { await db.delete(); await db.open() })
  beforeEach(() => {
    scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    localStorage.clear()
    useAdventureGamePlayerStore.setState({
      scope: null, worldGroupId: null, releases: [], sessions: [], selectedSessionId: null,
      events: [], checkpoints: [], recoverableRunIds: [], runtimeState: structuredClone(EMPTY_SIMULATION_STATE), selectedManifest: null,
      pendingIntent: null, generatedNarrative: null, generatingRunId: null,
      loading: false, busy: false, error: '',
    })
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    delete (Element.prototype as { scrollIntoView?: Element['scrollIntoView'] }).scrollIntoView
  })
  afterAll(() => db.close())

  it('作者可检查旧有限地点草稿，但正式发布必须交给制作中心', async () => {
    const owned = await fixture()
    await act(async () => {
      root.render(createElement(DialogProvider, null, createElement(AdventureGameWorkbench, { scope: owned.scope })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(host.textContent).toContain('创建第一份有限地点冒险'))
    await click(host, '创建验收冒险')
    await waitFor(() => expect(host.textContent).toContain('雾港潮汐钟'))
    expect(host.textContent).toContain('6地点')
    expect(host.textContent).toContain('4任务')

    await click(host, '状态预览')
    await waitFor(() => expect(host.textContent).toContain('从任意地点检查初始可玩状态'))
    expect(host.textContent).toContain('雾港码头')
    expect(host.textContent).toContain('查看告示')

    await click(host, '发布检查')
    await click(host, '运行校验')
    await waitFor(() => expect(host.textContent).toContain('所有发布闸门通过'))
    await click(host, '发布版本')
    expect(host.textContent).toContain('制作中心冻结世界来源、用户目标、产品内容和媒资')
    await click(host, '交由制作中心发布')
    await waitFor(() => expect(host.textContent).toContain('正式发布必须进入制作中心'))
    expect(await db.gameReleases.count()).toBe(0)
    expect(await db.worldReleases.count()).toBe(0)
  }, 20_000)

  it('玩家用离线正式行动完成主线后才解锁圆满结局', async () => {
    const owned = await fixture()
    const definition = await seedAdventureAcceptanceGame({ scope: owned.scope, title: '雾港潮汐钟', gameKey: 'ui-mist-harbor' })
    await publishAdventureGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })
    await act(async () => {
      root.render(createElement(DialogProvider, null, createElement(AdventureGamePlayer, {
        project: owned.project, scope: owned.scope, worldGroupId: null,
      })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(host.textContent).toContain('雾港潮汐钟'))
    expect(host.textContent).toContain('文字冒险游戏库')
    expect(await db.simulationSessions.where('projectId').equals(owned.scope.projectId).count()).toBe(0)
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="查看游戏：雾港潮汐钟"]')!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(host.textContent).toContain('6 个地点')
    expect(host.textContent).toContain('4 个任务')
    await click(host, '开始新冒险')
    await waitFor(() => expect(host.textContent).toContain('雾港码头'))
    await click(host, '退出游戏')
    await waitFor(() => expect(useAdventureGamePlayerStore.getState().selectedSessionId).toBeNull())
    expect(host.textContent).toContain('冒险详情')
    expect(await db.simulationSessions.where('projectId').equals(owned.scope.projectId).count()).toBe(1)
    await click(host, '继续上次进度')
    await waitFor(() => expect(host.textContent).toContain('雾港码头'))
    expect(host.querySelector('.adventure-console')).not.toBeNull()
    expect(host.querySelector('.adventure-map-rail')).toBeNull()
    expect(host.querySelector('.adventure-status-rail')).toBeNull()
    expect(host.querySelector<HTMLInputElement>('input[aria-label="输入冒险指令"]')).not.toBeNull()
    expect(host.textContent).toContain('故事从这里开始')
    expect(host.querySelector('.adventure-console-system > small')).toBeNull()
    expect(host.textContent).toContain('离线确定性模式')
    const command = host.querySelector<HTMLInputElement>('input[aria-label="输入冒险指令"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(command, '状态')
      command.dispatchEvent(new Event('input', { bubbles: true }))
      command.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(host.textContent).toContain('当前位置：雾港码头')
    expect(host.querySelector('.adventure-console-response .adventure-player-command')).not.toBeNull()
    expect(host.querySelector('.adventure-console-response .adventure-system-response')).not.toBeNull()
    expect(host.querySelector('.adventure-console-response .adventure-system-response > small')).toBeNull()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(command, '查看告示')
      command.dispatchEvent(new Event('input', { bubbles: true }))
      command.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(useAdventureGamePlayerStore.getState().runtimeState.adventure?.actionHistory).toHaveLength(1))
    expect(useAdventureGamePlayerStore.getState().runtimeState.adventure?.actionHistory[0]?.actionKey).toBe('inspect.notice')
    expect(host.querySelector('.adventure-narrative-continue')).not.toBeNull()
    expect(host.querySelector('.adventure-console-entry.is-playing > .adventure-player-command')).not.toBeNull()
    expect(host.querySelector<HTMLInputElement>('input[aria-label="输入冒险指令"]')?.disabled).toBe(true)
    expect(host.textContent).toContain('故事正在继续')
    await finishNarrative(host)
    expect(host.querySelector<HTMLInputElement>('input[aria-label="输入冒险指令"]')?.disabled).toBe(false)
    await click(host, '背包', true)
    expect(host.textContent).toContain('背包与物品')
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="关闭面板"]')!.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(host.textContent).not.toContain('进入圆满结局')

    for (const label of ['前往集市', '询问商人', '前往档案馆', '进入水渠', '前往钟楼', '取回钟片']) {
      await click(host, label, true)
      await waitFor(() => expect(useAdventureGamePlayerStore.getState().busy).toBe(false))
      await finishNarrative(host)
    }
    expect(host.textContent).toContain('潮汐商人信任 +1')
    expect(host.textContent).toContain('目标完成')
    await waitFor(() => expect(buttonContaining(host, '进入圆满结局').disabled).toBe(false))
    expect(host.textContent).not.toContain('进入代价结局')
    await click(host, '进入圆满结局', true)
    await waitFor(() => expect(host.textContent).toContain('冒险结束圆满结局'))
    const sessionId = useAdventureGamePlayerStore.getState().selectedSessionId!
    const state = await readSimulationState(sessionId)
    expect(state.narrative?.endingKey).toBe('victory')
    expect(state.adventure?.quests.find(item => item.questKey === 'main.bell')?.status).toBe('completed')
    expect(state.adventure?.actionHistory).toHaveLength(7)
    expect(scrollIntoView).not.toHaveBeenCalled()
  }, 20_000)
})
