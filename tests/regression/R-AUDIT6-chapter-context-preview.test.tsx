import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChapterContextPreview from '../../src/components/editor/ChapterContextPreview'
import type { StateCard } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

const cards: StateCard[] = [
  { id: 1, projectId: 1, category: 'character', entityName: '陆沉', fields: '[]', createdAt: 1, updatedAt: 1 },
  { id: 2, projectId: 1, category: 'item', entityName: '星盘', fields: '[]', createdAt: 1, updatedAt: 1 },
  { id: 3, projectId: 1, category: 'location', entityName: '北门', fields: '[]', createdAt: 1, updatedAt: 1 },
]

async function mount(patch: Record<string, unknown> = {}) {
  const props = {
    worldContext: '世界设定',
    characterContext: '角色设定',
    outlineNode: { title: '雨夜入城', summary: '主角抵达北门。' },
    stateCards: cards,
    matchedIds: [1],
    allIds: [1, 2, 3],
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
  it('展示世界观、角色与章纲，并保持预览截断边界', async () => {
    const host = (await mount({
      worldContext: `${'世'.repeat(500)}世界尾部`,
      characterContext: `${'角'.repeat(300)}角色尾部`,
      stateCards: [],
    })).host
    expect(host.textContent).toContain('【世界观】')
    expect(host.textContent).toContain('【角色】')
    expect(host.textContent).toContain('【章节大纲】雨夜入城：主角抵达北门。')
    expect(host.textContent).not.toContain('世界尾部')
    expect(host.textContent).not.toContain('角色尾部')
  })

  it('折叠态显示注入计数并转发展开命令', async () => {
    const { host, props } = await mount()
    expect(host.textContent).toContain('状态卡注入（1/3）')
    expect(host.textContent).not.toContain('陆沉')
    await act(async () => button(host, '展开调整').click())
    expect(props.onToggleStateList).toHaveBeenCalledOnce()
  })

  it('展开态区分自动匹配、手动添加和未选状态卡，并转发卡片 ID', async () => {
    const { host, props } = await mount({ stateListExpanded: true })
    expect(host.textContent).toContain('角色陆沉自动匹配')
    expect(host.textContent).toContain('物品星盘手动添加')
    expect(host.textContent).toContain('地点北门')
    const starChart = host.querySelector('button[aria-label="状态卡：星盘"]') as HTMLButtonElement
    const northGate = host.querySelector('button[aria-label="状态卡：北门"]') as HTMLButtonElement
    await act(async () => starChart.click())
    await act(async () => northGate.click())
    expect(props.onToggleStateCard).toHaveBeenCalledWith(2)
    expect(props.onToggleStateCard).toHaveBeenCalledWith(3)
  })
})
