import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import AvgGamePlayer from '../../src/components/text-game/AvgGamePlayer'
import AvgGameWorkbench from '../../src/components/text-game/AvgGameWorkbench'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { db } from '../../src/lib/db/schema'
import { publishAvgGame, seedAvgAcceptanceGame } from '../../src/lib/avg/authoring'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { EMPTY_SIMULATION_STATE, type Project, type WorkspaceScope } from '../../src/lib/types'
import { useAvgGamePlayerStore } from '../../src/stores/avg-game-player'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
function button(host: ParentNode, text: string) { const found = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes(text)); if (!found) throw new Error(`找不到按钮:${text}`); return found }
async function click(host: ParentNode, text: string) { await act(async () => { button(host, text).click(); await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function waitFor(fn: () => void | Promise<void>) { const start = Date.now(); let last: unknown; while (Date.now() - start < 20_000) { try { await act(fn); return } catch (cause) { last = cause; await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) } } throw last }
async function idle() { await waitFor(() => expect(useAvgGamePlayerStore.getState().busy).toBe(false)) }
async function continueNode(host: ParentNode) { while (Array.from(host.querySelectorAll('button')).some(item => item.textContent?.includes('继续'))) { await click(host, '继续'); await idle() } }
async function fixture(name: string): Promise<{ project: Project; scope: WorkspaceScope }> { const now = Date.now(); const projectId = await db.projects.add({ name, genre: 'visual', genres: ['visual'], status: 'drafting', description: '', targetWordCount: 1, createdAt: now, updatedAt: now } as any) as number; const owned = await ensureWorkspaceOwnership(projectId); return { project: owned.project, scope: owned.scope } }

describe('AVG-1 · author and player UI', () => {
  let host: HTMLDivElement; let root: ReturnType<typeof createRoot>
  beforeAll(async () => { await db.delete(); await db.open() }); afterAll(() => db.close())
  beforeEach(() => { useAvgGamePlayerStore.setState({ scope: null, worldGroupId: null, releases: [], sessions: [], selectedSessionId: null, events: [], checkpoints: [], runtimeState: structuredClone(EMPTY_SIMULATION_STATE), selectedManifest: null, loading: false, busy: false, error: '' }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })

  it('作者载入演出样例、检查并发布不可变版本', async () => {
    const owned = await fixture('AVG 作者 UI'); await act(async () => { root.render(createElement(DialogProvider, null, createElement(AvgGameWorkbench, { scope: owned.scope }))); await new Promise(resolve => setTimeout(resolve, 0)) })
    await waitFor(() => expect(host.textContent).toContain('AVG 作者工作台')); await click(host, '载入演出样例'); await waitFor(() => expect(host.textContent).toContain('潮港守灯录 · 演出版')); expect(host.textContent).toContain('bg.harbor-night@1'); await click(host, '检查'); await waitFor(() => expect(host.textContent).toContain('检查通过')); await click(host, '发布'); await waitFor(() => expect(host.textContent).toContain('已发布 GameRelease v1'))
  }, 45_000)

  it('玩家以真实媒资推进 Beat，关闭图片和减少动态后仍可走到三个选择', async () => {
    const owned = await fixture('AVG 玩家 UI'); const definition = await seedAvgAcceptanceGame({ scope: owned.scope }); await publishAvgGame({ scope: owned.scope, gameDefinitionId: definition.id! }); await act(async () => { root.render(createElement(DialogProvider, null, createElement(AvgGamePlayer, { project: owned.project, scope: owned.scope, worldGroupId: null }))); await new Promise(resolve => setTimeout(resolve, 0)) })
    await waitFor(() => expect(host.textContent).toContain('潮港守灯录 · 演出版')); expect(host.textContent).toContain('AVG 游戏库'); expect(await db.simulationSessions.where('projectId').equals(owned.scope.projectId).count()).toBe(0); await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="查看游戏：潮港守灯录 · 演出版"]')!.click(); await new Promise(resolve => setTimeout(resolve, 0)) }); expect(host.textContent).toContain('项美术'); await click(host, '开始新游戏'); await waitFor(() => expect(host.textContent).toContain('第一章 · 失潮之夜'))
    expect(host.querySelector('.avg-library')).toBeNull()
    expect(host.querySelector('.avg-dialogue')?.textContent).not.toContain('第一章 · 失潮之夜')
    expect(host.querySelector('.avg-scene-title')?.textContent).toContain('第一章 · 失潮之夜')
    expect(host.querySelector('[data-asset-key="bg.harbor-night"]')).not.toBeNull()
    await click(host, '存读档'); expect(host.querySelector('[role="dialog"][aria-label="存读档"]')).not.toBeNull(); expect(host.querySelector('.avg-saves')).not.toBeNull()
    await act(async () => { (host.querySelector('.avg-panel [aria-label="关闭"]') as HTMLButtonElement).click(); await new Promise(resolve => setTimeout(resolve, 0)) })
    await click(host, '继续'); await idle(); await waitFor(() => expect(host.querySelector('.avg-actor[aria-label="角色 lin"]')).not.toBeNull()); await click(host, '图片'); await click(host, '减少动态')
    const route = ['去档案室寻找失潮记录', '带着旧图赶往雨巷', '跟随水沟里的纸船', '从暗巷抵达旧城门', '进入无月的灯市', '沿灯市寻找守灯人', '向屋檐下的守灯人求助', '从白塔寻找风路', '把风声带回旧灯', '点亮守望灯', '跨过正在苏醒的潮桥', '先去盐花庭院', '收起最后一朵盐花', '去议会公开地图', '带着证词走上观潮台']
    for (const choice of route) { await continueNode(host); await waitFor(() => expect(host.textContent).toContain(choice)); await click(host, choice); await idle() }
    await continueNode(host); await waitFor(() => { expect(host.textContent).toContain('让所有人看见真相'); expect(host.textContent).toContain('守住仍亮着的家灯'); expect(host.textContent).toContain('把灯火带向远海') }); await click(host, '让所有人看见真相'); await idle(); await continueNode(host); await waitFor(() => expect(host.textContent).toContain('故事已完结')); expect(host.textContent).toContain('图片关闭：纯文字剧情与选择保持可玩')
  }, 45_000)
})
