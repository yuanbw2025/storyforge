import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import NarrativeSimulationPlayer from '../../src/components/text-game/NarrativeSimulationPlayer'
import NarrativeSimulationWorkbench from '../../src/components/text-game/NarrativeSimulationWorkbench'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { publishNarrativeSimulationGame, seedNarrativeSimulationAcceptanceGame } from '../../src/lib/narrative-simulation/authoring'
import { db } from '../../src/lib/db/schema'
import { readSimulationState } from '../../src/lib/simulation/runtime'
import { EMPTY_SIMULATION_STATE, type Project, type WorkspaceScope } from '../../src/lib/types'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { useNarrativeSimulationPlayerStore } from '../../src/stores/narrative-simulation-player'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function button(host: ParentNode, text: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes(text))
  if (!result) throw new Error(`找不到按钮:${text}`)
  return result
}
async function click(host: ParentNode, text: string) {
  await act(async () => { button(host, text).click(); await new Promise(resolve => setTimeout(resolve, 0)) })
}
async function waitFor(assertion: () => void | Promise<void>) {
  const started = Date.now(); let last: unknown
  while (Date.now() - started < 12_000) {
    try { await act(async () => { await assertion() }); return }
    catch (reason) { last = reason; await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) }
  }
  throw last
}
async function fixture(name: string): Promise<{ project: Project; scope: WorkspaceScope }> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name, genre: 'simulation', genres: ['simulation'], status: 'drafting', description: '',
    targetWordCount: 20_000, createdAt: now, updatedAt: now,
  } as any) as number
  const owned = await ensureWorkspaceOwnership(projectId)
  return { project: owned.project, scope: owned.scope }
}

describe('TEXTSIM-1 · author and player UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeAll(async () => { await db.delete(); await db.open() })
  beforeEach(() => {
    localStorage.clear()
    useNarrativeSimulationPlayerStore.setState({
      scope: null, worldGroupId: null, releases: [], sessions: [], selectedSessionId: null,
      events: [], checkpoints: [], runtimeState: structuredClone(EMPTY_SIMULATION_STATE),
      selectedManifest: null, generatedCandidate: null, loading: false, busy: false, error: '',
    })
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })
  afterAll(() => db.close())

  it('作者创建验收模拟、运行批量预览并诊断，但正式发布交给制作中心', async () => {
    const owned = await fixture('TEXTSIM 作者 UI')
    await act(async () => {
      root.render(createElement(DialogProvider, null, createElement(NarrativeSimulationWorkbench, { scope: owned.scope })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(host.textContent).toContain('创建第一份封闭系统模拟'))
    await click(host, '创建验收模拟')
    await waitFor(() => expect(host.textContent).toContain('十二街区治理录'))
    expect(host.textContent).toContain('6资源 / 指标')
    expect(host.textContent).toContain('10行动 / 政策')
    await click(host, '批量模拟')
    await click(host, '运行固定种子')
    await waitFor(() => expect(host.textContent).toContain('可复现平衡证据'))
    expect(host.textContent).toContain('规则结局')
    await click(host, '发布检查')
    await click(host, '运行校验')
    await waitFor(() => expect(host.textContent).toContain('所有发布闸门通过'))
    await click(host, '发布版本')
    expect(host.textContent).toContain('制作中心冻结世界来源、用户目标、模拟规则和产品内容')
    await click(host, '交由制作中心发布')
    await waitFor(() => expect(host.textContent).toContain('正式发布必须进入制作中心'))
    expect(await db.narrativeSimulationModules.count()).toBe(1)
    expect(await db.gameReleases.count()).toBe(0)
    expect(await db.worldReleases.count()).toBe(0)
  }, 30_000)

  it('玩家完全离线结算回合、查看报告、自动检查点并进入规则结局', async () => {
    const owned = await fixture('TEXTSIM 玩家 UI')
    const definition = await seedNarrativeSimulationAcceptanceGame({ scope: owned.scope })
    await publishNarrativeSimulationGame({ scope: owned.scope, gameDefinitionId: definition.id! })
    await act(async () => {
      root.render(createElement(DialogProvider, null, createElement(NarrativeSimulationPlayer, {
        project: owned.project, scope: owned.scope, worldGroupId: null,
      })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(host.textContent).toContain('十二街区治理录'))
    await click(host, '新建模拟')
    await waitFor(() => expect(host.textContent).toContain('第 1 / 30 回合'))
    expect(host.textContent).toContain('修缮住房')
    for (let index = 0; index < 30; index += 1) {
      if (useNarrativeSimulationPlayerStore.getState().runtimeState.narrativeSimulation?.phase === 'ended') break
      await click(host, '结算回合')
      await waitFor(() => expect(useNarrativeSimulationPlayerStore.getState().busy).toBe(false))
    }
    await waitFor(() => expect(host.textContent).toContain('模拟已确定结局'))
    expect(host.textContent).toContain('玩家可见报告')
    expect(useNarrativeSimulationPlayerStore.getState().checkpoints.length).toBeGreaterThan(0)
    const endingButton = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes('进入结局'))
    expect(endingButton).toBeTruthy()
    await act(async () => { endingButton!.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
    await waitFor(() => expect(host.textContent).toContain('本局已完成'))
    const sessionId = useNarrativeSimulationPlayerStore.getState().selectedSessionId!
    const state = await readSimulationState(sessionId)
    expect(state.narrative?.completed).toBe(true)
    expect(state.narrativeSimulation?.phase).toBe('ended')
    await click(host, '退出游戏')
    await waitFor(() => expect(useNarrativeSimulationPlayerStore.getState().selectedSessionId).toBeNull())
    expect(host.textContent).toContain('选择正式发布开始模拟')
  }, 60_000)
})
