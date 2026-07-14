import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HistoryKeywordCard from '../../src/components/history/HistoryKeywordCard'
import type { Chapter, HistoricalKeyword } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

const keyword: HistoricalKeyword = {
  id: 3,
  projectId: 1,
  keyword: '飞钱',
  category: 'economy',
  era: 'sui-tang',
  description: '唐代汇兑凭证',
  relatedChapterIds: [7],
  aiConsult: '旧考据',
  aiBrainstorm: '旧风暴',
  createdAt: 1,
  updatedAt: 1,
}

const chapters: Chapter[] = [
  {
    id: 7,
    projectId: 1,
    outlineNodeId: 17,
    title: '第一章',
    content: '',
    wordCount: 0,
    status: 'outline',
    order: 0,
    notes: '',
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 8,
    projectId: 1,
    outlineNodeId: 18,
    title: '第二章',
    content: '',
    wordCount: 0,
    status: 'outline',
    order: 1,
    notes: '',
    createdAt: 1,
    updatedAt: 1,
  },
]

function stream() {
  return {
    output: '',
    isStreaming: false,
    error: null,
    tokenUsage: null,
    stop: vi.fn(),
  }
}

async function mount(patch: Record<string, unknown> = {}) {
  const props = {
    keyword,
    chapters,
    expanded: false,
    canEdit: true,
    consultActive: false,
    stormActive: false,
    consultPreparing: false,
    stormPreparing: false,
    consultAI: stream(),
    stormAI: stream(),
    onToggle: vi.fn(),
    onChange: vi.fn(),
    onConsult: vi.fn(),
    onStorm: vi.fn(),
    onDelete: vi.fn(),
    onAcceptConsult: vi.fn(),
    onAcceptStorm: vi.fn(),
    ...patch,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(HistoryKeywordCard, props)))
  return { host, props }
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.trim() === label)
  if (!match) throw new Error(`missing button: ${label}`)
  return match
}

async function changeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 · 历史关键词卡', () => {
  it('折叠态展示分类、时期和定稿摘要，并转发展开命令', async () => {
    const { host, props } = await mount()
    expect(host.textContent).toContain('#飞钱')
    expect(host.textContent).toContain('社会与经济')
    expect(host.textContent).toContain('隋唐五代')
    expect(host.textContent).toContain('唐代汇兑凭证')
    expect(host.querySelector('textarea')).toBeNull()
    const toggle = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes('#飞钱'))!
    await act(async () => toggle.click())
    expect(props.onToggle).toHaveBeenCalledOnce()
  })

  it('展开态将字段与章节变化转成精确 patch', async () => {
    const { host, props } = await mount({ expanded: true })
    const nameInput = host.querySelector('input')!
    const category = host.querySelector('select[aria-label="关键词分类"]')!
    const era = host.querySelector('select[aria-label="适用历史时期"]')!
    const description = host.querySelector('textarea')!

    await changeValue(nameInput, '交子')
    await changeValue(category, 'technology')
    await changeValue(era, 'song-yuan')
    await changeValue(description, '宋代纸币')
    await act(async () => button(host, '第二章').click())

    expect(props.onChange).toHaveBeenCalledWith({ keyword: '交子' })
    expect(props.onChange).toHaveBeenCalledWith({ category: 'technology' })
    expect(props.onChange).toHaveBeenCalledWith({ era: 'song-yuan' })
    expect(props.onChange).toHaveBeenCalledWith({ description: '宋代纸币' })
    expect(props.onChange).toHaveBeenCalledWith({ relatedChapterIds: [7, 8] })
  })

  it('双 Agent、删除与结果清除继续转发父级命令', async () => {
    const { host, props } = await mount({ expanded: true })
    await act(async () => button(host, 'AI 历史考据').click())
    await act(async () => button(host, 'AI 头脑风暴').click())
    await act(async () => button(host, '删除关键词').click())
    const clearButtons = Array.from(host.querySelectorAll('button')).filter(item => item.textContent?.trim() === '清除')
    expect(clearButtons).toHaveLength(2)
    await act(async () => clearButtons[0].click())
    await act(async () => clearButtons[1].click())

    expect(props.onConsult).toHaveBeenCalledOnce()
    expect(props.onStorm).toHaveBeenCalledOnce()
    expect(props.onDelete).toHaveBeenCalledOnce()
    expect(props.onChange).toHaveBeenCalledWith({ aiConsult: undefined })
    expect(props.onChange).toHaveBeenCalledWith({ aiBrainstorm: undefined })
  })
})
