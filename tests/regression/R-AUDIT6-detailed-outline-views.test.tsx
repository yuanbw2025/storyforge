import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DetailedOutlineSidebar from '../../src/components/outline/DetailedOutlineSidebar'
import DetailedSceneCard from '../../src/components/outline/DetailedSceneCard'
import type { DetailedOutline, DetailedScene, OutlineNode } from '../../src/lib/types'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
  resetPendingEditCoordinatorForTestsV1()
})

async function mount(component: ReturnType<typeof createElement>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(component))
  return host
}

function setControlValue(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value)
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

const chapters: OutlineNode[] = [
  { id: 11, projectId: 1, parentId: 1, type: 'chapter', title: '第一章', summary: '', order: 0, createdAt: 1, updatedAt: 1 },
  { id: 12, projectId: 1, parentId: 1, type: 'chapter', title: '第二章', summary: '', order: 1, createdAt: 1, updatedAt: 1 },
]

const detailed: DetailedOutline[] = [{
  id: 21,
  projectId: 1,
  outlineNodeId: 12,
  scenes: [],
  createdAt: 1,
  updatedAt: 1,
}]

const scene: DetailedScene = {
  sceneId: 'scene-1',
  title: '城门相逢',
  summary: '主角在雨夜回城',
  characterIds: [],
  location: '北门',
  conflict: '守军拒绝放行',
  pace: 'medium',
  estimatedWords: 800,
  notes: '保留身份悬念',
}

describe('AUDIT-6 / HEALTH-4 · 细纲受控视图', () => {
  it('场景本地输入不会被旧回执抹去，保存失败阻止导航，逐字段明确重试才解除错误', async () => {
    const onUpdate = vi.fn().mockRejectedValueOnce(new Error('模拟保存失败')).mockResolvedValue(undefined)
    const host = await mount(createElement(DetailedSceneCard, { scene, index: 0, onUpdate, onDelete: vi.fn() }))
    const goal = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="场景1 · 本场目标"]')!
    await act(async () => setControlValue(goal, '作者尚未保存的目标'))
    await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('模拟保存失败') })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('模拟保存失败')
    expect(goal.value).toBe('作者尚未保存的目标')
    await expect(flushPendingEditsV1()).rejects.toThrow('模拟保存失败')
    expect(onUpdate).toHaveBeenCalledOnce()
    const notes = host.querySelector<HTMLTextAreaElement>('textarea[placeholder="备注 / AI 建议..."]')!
    await act(async () => setControlValue(notes, '随后修改的备注'))
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    expect(goal.value).toBe('作者尚未保存的目标')
    const retry = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '重试保存场景1 · 本场目标')!
    await act(async () => retry.click())
    expect(onUpdate).toHaveBeenLastCalledWith({ goal: '作者尚未保存的目标' }, { goal: undefined })
    expect(onUpdate.mock.lastCall?.[0]).not.toHaveProperty('sceneId')
    expect(host.querySelector('[role="alert"]')).toBeNull()
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
  })

  it('输入期间仍可继续编辑，待保存写入成功后才放行正式跳转', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const host = await mount(createElement(DetailedSceneCard, { scene, index: 0, onUpdate: () => pending, onDelete: vi.fn() }))
    const goal = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="场景1 · 本场目标"]')!
    await act(async () => setControlValue(goal, '等待保存的目标'))
    expect(goal.value).toBe('等待保存的目标')
    let flushed = false
    const flush = flushPendingEditsV1().then(() => { flushed = true })
    await Promise.resolve()
    expect(flushed).toBe(false)
    await act(async () => { release(); await flush })
    expect(flushed).toBe(true)
  })

  it('章节侧栏标识已有细纲并转发选择与批量命令', async () => {
    const onSelect = vi.fn()
    const onBatchStart = vi.fn()
    const host = await mount(createElement(DetailedOutlineSidebar, {
      chapters,
      detailedOutlines: detailed,
      selectedNodeId: 11,
      batchProgress: null,
      onSelect,
      onBatchStart,
      onBatchStop: vi.fn(),
    }))

    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toContain('第一章')
    expect(host.querySelector('[title="已保存细纲"]')).toBeNull()
    expect(Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('第二章'))?.textContent).toContain('未规划')
    const second = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('第二章'))!
    await act(async () => second.click())
    expect(onSelect).toHaveBeenCalledWith(12)
    const batch = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('批量生成细纲'))!
    await act(async () => batch.click())
    expect(onBatchStart).toHaveBeenCalledOnce()
  })

  it('批量进度显示完成数和阶段，并转发停止命令', async () => {
    const onBatchStop = vi.fn()
    const host = await mount(createElement(DetailedOutlineSidebar, {
      chapters,
      detailedOutlines: [],
      selectedNodeId: null,
      batchProgress: {
        current: 2,
        total: 4,
        currentTitle: '第二章',
        stage: '正在生成第二章',
        completed: 1,
        failures: [],
      },
      onSelect: vi.fn(),
      onBatchStart: vi.fn(),
      onBatchStop,
    }))
    expect(host.textContent).toContain('1/4')
    expect(host.textContent).toContain('正在生成第二章')
    await act(async () => host.querySelector<HTMLButtonElement>('button[title="停止"]')!.click())
    expect(onBatchStop).toHaveBeenCalledOnce()
  })

  it('单场景卡把标题、节奏、字数、概要、地点、冲突、备注与删除全部交给父级', async () => {
    const onUpdate = vi.fn()
    const onDelete = vi.fn()
    const host = await mount(createElement(DetailedSceneCard, { scene, index: 1, onUpdate, onDelete }))
    expect(host.textContent).toContain('#2')

    await act(async () => setControlValue(host.querySelector<HTMLInputElement>('input[placeholder="场景标题..."]')!, '雨夜闯关'))
    await act(async () => setControlValue(host.querySelector<HTMLSelectElement>('select[aria-label="场景节奏"]')!, 'fast'))
    await act(async () => setControlValue(host.querySelector<HTMLInputElement>('input[placeholder="字数"]')!, '1200'))
    await act(async () => setControlValue(host.querySelector<HTMLTextAreaElement>('textarea[placeholder="一句话场景概要..."]')!, '主角强行入城'))
    await act(async () => setControlValue(host.querySelector<HTMLInputElement>('input[placeholder="📍 地点"]')!, '瓮城'))
    await act(async () => setControlValue(host.querySelector<HTMLInputElement>('input[placeholder="⚔ 核心冲突"]')!, '身份暴露'))
    await act(async () => setControlValue(host.querySelector<HTMLTextAreaElement>('textarea[placeholder="备注 / AI 建议..."]')!, '加快动作节奏'))
    await act(async () => { await flushPendingEditsV1() })

    expect(onUpdate).toHaveBeenCalledWith({ title: '雨夜闯关' }, { title: scene.title })
    expect(onUpdate).toHaveBeenCalledWith({ pace: 'fast' }, { pace: scene.pace })
    expect(onUpdate).toHaveBeenCalledWith({ estimatedWords: 1200 }, { estimatedWords: scene.estimatedWords })
    expect(onUpdate).toHaveBeenCalledWith({ summary: '主角强行入城' }, { summary: scene.summary })
    expect(onUpdate).toHaveBeenCalledWith({ location: '瓮城' }, { location: scene.location })
    expect(onUpdate).toHaveBeenCalledWith({ conflict: '身份暴露' }, { conflict: scene.conflict })
    expect(onUpdate).toHaveBeenCalledWith({ notes: '加快动作节奏' }, { notes: scene.notes })

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="删除场景2"]')!.click())
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
