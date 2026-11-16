import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChapterContextPreview from '../../src/components/editor/ChapterContextPreview'
import type { StateCard } from '../../src/lib/types'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

const cards: StateCard[] = [
  { id: 1, projectId: 1, category: 'character', entityName: '陆沉', fields: '[]', createdAt: 1, updatedAt: 1 },
  { id: 2, projectId: 1, category: 'item', entityName: '星盘', fields: '[]', createdAt: 1, updatedAt: 1 },
  { id: 3, projectId: 1, category: 'location', entityName: '北门', fields: '[]', createdAt: 1, updatedAt: 1 },
]

async function mount(patch: Record<string, unknown> = {}) {
  const props = {
    operation: 'generate' as const,
    onOperationChange: vi.fn(),
    onRefresh: vi.fn(),
    stateCards: cards,
    matchedIds: [1],
    extraIds: [2],
    stateListExpanded: false,
    onToggleStateList: vi.fn(),
    onToggleStateCard: vi.fn(),
    ...patch,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(ChapterContextPreview, props)))
  return { host, props }
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.trim() === label)
  if (!match) throw new Error(`missing button: ${label}`)
  return match
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 · 章节上下文预览', () => {
  it('读取未完成或失败时不把词匹配当成已冻结的正文来源，并可明确刷新', async () => {
    const { host, props } = await mount({ stateCards: [] })
    expect(host.querySelector('[role="status"]')?.textContent).toContain('正在读取')
    expect(host.querySelector('[data-testid="context-preview-packet"]')).toBeNull()
    await act(async () => button(host, '刷新预览').click())
    expect(props.onRefresh).toHaveBeenCalledOnce()
    const failed = await mount({ error: '必读资料被关闭' })
    expect(failed.host.querySelector('[role="alert"]')?.textContent).toContain('必读资料被关闭')
    expect(failed.host.querySelector('[data-testid="context-preview-packet"]')).toBeNull()
  })

  it('折叠态显示整理关注计数并转发展开命令', async () => {
    const { host, props } = await mount()
    expect(host.textContent).toContain('本章整理关注卡（1/3）')
    expect(host.textContent).not.toContain('状态卡注入')
    expect(host.textContent).not.toContain('陆沉')
    await act(async () => button(host, '展开整理关注卡').click())
    expect(props.onToggleStateList).toHaveBeenCalledOnce()
  })

  it('展开态区分自动匹配、手动添加和未选状态卡，并转发卡片 ID', async () => {
    const { host, props } = await mount({ stateListExpanded: true })
    expect(host.textContent).toContain('角色 · 陆沉规则匹配')
    expect(host.textContent).toContain('物品 · 星盘手动追加')
    expect(host.textContent).toContain('地点 · 北门')
    const automatic = host.querySelector('button[aria-label="整理关注卡：陆沉"]') as HTMLButtonElement
    expect(automatic.disabled).toBe(true)
    const starChart = host.querySelector('button[aria-label="整理关注卡：星盘"]') as HTMLButtonElement
    const northGate = host.querySelector('button[aria-label="整理关注卡：北门"]') as HTMLButtonElement
    await act(async () => starChart.click())
    await act(async () => northGate.click())
    expect(props.onToggleStateCard).toHaveBeenCalledWith(2)
    expect(props.onToggleStateCard).toHaveBeenCalledWith(3)
  })
})
