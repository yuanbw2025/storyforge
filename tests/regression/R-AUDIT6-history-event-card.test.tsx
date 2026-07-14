import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HistoryTimelineEventCard from '../../src/components/history/HistoryTimelineEventCard'
import type { Chapter, HistoricalTimelineEvent } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

const event: HistoricalTimelineEvent = {
  id: 4,
  projectId: 1,
  era: 'custom',
  year: 0,
  date: '星历元年',
  title: '开元改制',
  description: '王朝改用新的纪年法',
  isHistorical: true,
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
    event,
    chapters,
    expanded: false,
    canEdit: true,
    worldBadge: { icon: '🌙', name: '月海界' },
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
  await act(async () => root.render(createElement(HistoryTimelineEventCard, props)))
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

describe('AUDIT-6 · 历史时间线事件卡', () => {
  it('折叠态展示纪年原点、史实锚点和世界归属，并转发展开命令', async () => {
    const { host, props } = await mount()
    expect(host.textContent).toContain('星历元年 (纪年原点)')
    expect(host.textContent).toContain('史实锚点')
    expect(host.textContent).toContain('AI 不可违反')
    expect(host.textContent).toContain('🌙月海界')
    expect(host.textContent).toContain('王朝改用新的纪年法')
    const toggle = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes('开元改制'))!
    await act(async () => toggle.click())
    expect(props.onToggle).toHaveBeenCalledOnce()
  })

  it('展开态将字段、属性与章节变化转成精确 patch', async () => {
    const { host, props } = await mount({ expanded: true })
    const title = host.querySelector('input[value="开元改制"]')!
    const era = host.querySelector('select[aria-label="历史时期"]')!
    const year = host.querySelector('input[aria-label="数字化年份"]')!
    const description = host.querySelector('textarea')!
    const radios = Array.from(host.querySelectorAll('input[type="radio"]')) as HTMLInputElement[]

    await changeValue(title, '旧历废止')
    await changeValue(era, 'sui-tang')
    await changeValue(year, '-221')
    await changeValue(description, '改用新历')
    await act(async () => radios[1].click())
    await act(async () => button(host, '第二章').click())

    expect(props.onChange).toHaveBeenCalledWith({ title: '旧历废止' })
    expect(props.onChange).toHaveBeenCalledWith({ era: 'sui-tang' })
    expect(props.onChange).toHaveBeenCalledWith({ year: -221 })
    expect(props.onChange).toHaveBeenCalledWith({ description: '改用新历' })
    expect(props.onChange).toHaveBeenCalledWith({ isHistorical: false })
    expect(props.onChange).toHaveBeenCalledWith({ relatedChapterIds: [7, 8] })
  })

  it('双 Agent、删除与结果清除继续转发父级命令', async () => {
    const { host, props } = await mount({ expanded: true })
    await act(async () => button(host, 'AI 历史考据').click())
    await act(async () => button(host, 'AI 头脑风暴').click())
    await act(async () => button(host, '删除事件').click())
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
