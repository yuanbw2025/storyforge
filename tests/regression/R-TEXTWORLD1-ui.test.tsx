import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import TextOpenWorldPlayer from '../../src/components/text-game/TextOpenWorldPlayer'
import TextOpenWorldWorkbench from '../../src/components/text-game/TextOpenWorldWorkbench'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { db } from '../../src/lib/db/schema'
import { publishTextOpenWorldGame, seedTextOpenWorldAcceptanceGame } from '../../src/lib/open-world/authoring'
import { readSimulationState } from '../../src/lib/simulation/runtime'
import { EMPTY_SIMULATION_STATE, type Project, type WorkspaceScope } from '../../src/lib/types'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'

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
  while (Date.now() - started < 12_000) {
    try { await act(async () => { await assertion() }); return }
    catch (reason) {
      last = reason
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  throw last
}

async function fixture(name: string): Promise<{ project: Project; scope: WorkspaceScope }> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name,
    genre: 'open-world',
    genres: ['open-world'],
    status: 'drafting',
    description: '',
    targetWordCount: 20_000,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const owned = await ensureWorkspaceOwnership(projectId)
  return { project: owned.project, scope: owned.scope }
}

describe('TEXTWORLD-1 · author and player UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeAll(async () => { await db.delete(); await db.open() })
  beforeEach(() => {
    localStorage.clear()
    useTextOpenWorldPlayerStore.setState({
      scope: null,
      worldGroupId: null,
      releases: [],
      sessions: [],
      selectedSessionId: null,
      events: [],
      checkpoints: [],
      runtimeState: structuredClone(EMPTY_SIMULATION_STATE),
      selectedManifest: null,
      generatedCandidate: null,
      loading: false,
      busy: false,
      error: '',
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })
  afterAll(() => db.close())

  it.sequential('作者原子维护三个共享模块并检查，但正式发布交给制作中心', async () => {
    const owned = await fixture('TEXTWORLD 作者 UI')
    await act(async () => {
      root.render(createElement(DialogProvider, null, createElement(TextOpenWorldWorkbench, { scope: owned.scope })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(host.textContent).toContain('创建开放世界草稿'))
    await click(host, '创建验收世界')
    await waitFor(() => expect(host.textContent).toContain('五区长路'))
    const counts = Array.from(host.querySelectorAll('section article strong')).map(item => item.textContent)
    expect(counts).toEqual(expect.arrayContaining(['5', '30', '10', '20']))
    expect(host.querySelector('textarea[aria-label="OpenWorldContentV1 JSON"]')).toBeTruthy()
    expect(host.querySelector('textarea[aria-label="AdventureContentV1 JSON"]')).toBeTruthy()
    expect(host.querySelector('textarea[aria-label="NarrativeSimulationContentV1 JSON"]')).toBeTruthy()
    await click(host, '解析并保存全部模块')
    await waitFor(() => expect(host.textContent).toContain('三个声明式内容模块已原子保存'))
    await click(host, '检查')
    await waitFor(() => expect(host.textContent).toContain('全部发布校验通过'))
    expect(host.textContent).toContain('发布就绪')
    await click(host, '交由制作中心发布')
    await waitFor(() => expect(host.textContent).toContain('正式发布必须进入制作中心'))
    expect(await db.openWorldModules.where('projectId').equals(owned.scope.projectId).count()).toBe(1)
    expect(await db.gameReleases.where('projectId').equals(owned.scope.projectId).count()).toBe(0)
    expect(await db.worldReleases.where('projectId').equals(owned.scope.projectId).count()).toBe(0)
  }, 30_000)

  it.sequential('玩家离线发现、接受并解决任务，旅行和检查点分支均写入正式实例', async () => {
    const owned = await fixture('TEXTWORLD 玩家 UI')
    const definition = await seedTextOpenWorldAcceptanceGame({ scope: owned.scope })
    await publishTextOpenWorldGame({ scope: owned.scope, gameDefinitionId: definition.id! })
    await act(async () => {
      root.render(createElement(DialogProvider, null, createElement(TextOpenWorldPlayer, {
        project: owned.project,
        scope: owned.scope,
        worldGroupId: null,
      })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(host.textContent).toContain('五区长路'))
    await click(host, '新旅程')
    await waitFor(() => expect(host.textContent).toContain('TEXTWORLD-1 · REGION FOCUS'))
    const startRegion = useTextOpenWorldPlayerStore.getState().runtimeState.openWorld!.currentRegionKey
    await click(host, '发现 · observe')
    await waitFor(() => expect(useTextOpenWorldPlayerStore.getState().busy).toBe(false))
    expect(host.textContent).toContain('动态任务')
    await click(host, '接受')
    await waitFor(() => expect(host.textContent).toContain('进行中'))
    await click(host, '解决任务')
    await waitFor(() => expect(useTextOpenWorldPlayerStore.getState().busy).toBe(false))
    expect(useTextOpenWorldPlayerStore.getState().runtimeState.openWorld?.questInstances.some(item => item.status === 'resolved')).toBe(true)

    const travel = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes('前往 ')) as HTMLButtonElement | undefined
    expect(travel).toBeTruthy()
    await act(async () => { travel!.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
    await waitFor(() => expect(useTextOpenWorldPlayerStore.getState().busy).toBe(false))
    while (useTextOpenWorldPlayerStore.getState().runtimeState.openWorld?.travel) {
      await click(host, '推进世界 tick')
      await waitFor(() => expect(useTextOpenWorldPlayerStore.getState().busy).toBe(false))
    }
    expect(useTextOpenWorldPlayerStore.getState().runtimeState.openWorld?.currentRegionKey).not.toBe(startRegion)

    const input = host.querySelector('input[placeholder="检查点名称"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '抵达新区')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await waitFor(() => expect(button(host, '保存').disabled).toBe(false))
    await click(host, '保存')
    await waitFor(() => expect(useTextOpenWorldPlayerStore.getState().checkpoints.some(item => item.name === '抵达新区')).toBe(true))
    const originalSessionId = useTextOpenWorldPlayerStore.getState().selectedSessionId
    await click(host, '抵达新区', true)
    await waitFor(() => expect(useTextOpenWorldPlayerStore.getState().selectedSessionId).not.toBe(originalSessionId))
    const branchedSessionId = useTextOpenWorldPlayerStore.getState().selectedSessionId!
    const state = await readSimulationState(branchedSessionId)
    expect(state.openWorld?.currentRegionKey).not.toBe(startRegion)
    expect(await db.simulationSessions.get(branchedSessionId)).toMatchObject({ parentSessionId: originalSessionId })
    await click(host, '退出游戏')
    await waitFor(() => expect(useTextOpenWorldPlayerStore.getState().selectedSessionId).toBeNull())
    expect(host.textContent).toContain('从正式发布开始开放世界旅程')
  }, 35_000)
})
