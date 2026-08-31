import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import StoryGameWorkbench from '../../src/components/text-game/StoryGameWorkbench'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { db } from '../../src/lib/db/schema'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import type { WorkspaceScope } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function button(host: ParentNode, text: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.trim() === text)
  if (!result) throw new Error(`找不到按钮:${text}`)
  return result
}

async function click(host: ParentNode, text: string) {
  await act(async () => {
    button(host, text).click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function waitFor(assertion: () => void | Promise<void>) {
  const started = Date.now()
  let lastError: unknown
  while (Date.now() - started < 5_000) {
    try { await act(async () => { await assertion() }); return } catch (error) {
      lastError = error
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
  }
  throw lastError
}

describe('STORYGAME-1C · workbench UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let scope: WorkspaceScope

  beforeEach(async () => {
    await db.delete(); await db.open()
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '作者工作台', genre: 'fantasy', genres: ['fantasy'], description: '',
      targetWordCount: 0, enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    scope = (await ensureWorkspaceOwnership(projectId)).scope
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => {
      root.render(createElement(DialogProvider, null, createElement(StoryGameWorkbench, { scope })))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove(); db.close()
  })

  it('载入样例后可检查路径和试玩，但正式发布必须交给制作中心', async () => {
    await waitFor(() => expect(host.textContent).toContain('创建第一个分支故事'))
    await click(host, '载入验收样例')
    await waitFor(() => expect(host.textContent).toContain('25 节点 · 45 Beat · 30 Choice'))
    expect(await db.gameDefinitions.count()).toBe(1)

    await click(host, '路径')
    await click(host, '运行完整检查')
    await waitFor(() => expect(host.textContent).toContain('内容图可以发布'))
    expect(host.textContent).toContain('25/25 节点可达')

    await click(host, '试玩')
    await click(host, '开始 / 重置')
    await waitFor(() => expect(host.textContent).toContain('你记下眼前的细节，也知道这一步会改变后来抵达的道路。'))
    expect(host.textContent).toContain('去档案室寻找失潮记录')
    await click(host, '去档案室寻找失潮记录前往“封闭档案室”')
    await waitFor(() => expect(host.textContent).toContain('封闭档案室前，潮声把被城市遗忘的名字送回岸上。'))
    expect(await db.simulationSessions.count()).toBe(0)
    expect(await db.simulationEvents.count()).toBe(0)

    await click(host, '发布')
    expect(host.textContent).toContain('来源与目标冻结')
    await click(host, '交由制作中心发布')
    await waitFor(() => expect(host.textContent).toContain('正式发布必须进入制作中心'))
    expect(await db.worldRevisions.count()).toBe(0)
    expect(await db.worldReleases.count()).toBe(0)
    expect(await db.gameReleases.count()).toBe(0)
  }, 20_000)

  it('空白模板可进入内容编辑并保留稳定 key', async () => {
    await waitFor(() => expect(host.textContent).toContain('新建空白游戏'))
    await click(host, '新建空白游戏')
    await waitFor(() => expect(host.textContent).toContain('2 节点 · 1 Beat · 1 Choice'))
    await click(host, '内容')
    expect(host.textContent).toContain('entry')
    expect(host.textContent).toContain('ending')
    expect(host.textContent).toContain('entry.narration')
    expect(host.textContent).toContain('entry.finish')
  })
})
