import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HistoryAgentWorkspace from '../../src/components/history/HistoryAgentWorkspace'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

function stream(patch: Record<string, unknown> = {}) {
  return {
    output: '',
    isStreaming: false,
    error: null,
    tokenUsage: null,
    stop: vi.fn(),
    ...patch,
  }
}

async function mount(patch: Record<string, unknown> = {}) {
  const props = {
    canEdit: true,
    consultActive: false,
    stormActive: false,
    consultPreparing: false,
    stormPreparing: false,
    consultAI: stream(),
    stormAI: stream(),
    savedConsult: undefined,
    savedStorm: undefined,
    savedStormLabel: 'AI 头脑风暴结果',
    deleteLabel: '删除事件',
    onConsult: vi.fn(),
    onStorm: vi.fn(),
    onDelete: vi.fn(),
    onAcceptConsult: vi.fn(),
    onAcceptStorm: vi.fn(),
    onClearConsult: vi.fn(),
    onClearStorm: vi.fn(),
    ...patch,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(HistoryAgentWorkspace, props)))
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

describe('AUDIT-6 · 历史双 agent 工作区视图', () => {
  it('转发考据、风暴与删除命令，并保留条目类型文案', async () => {
    const { host, props } = await mount({ deleteLabel: '删除关键词' })
    await act(async () => button(host, 'AI 历史考据').click())
    await act(async () => button(host, 'AI 头脑风暴').click())
    await act(async () => button(host, '删除关键词').click())
    expect(props.onConsult).toHaveBeenCalledOnce()
    expect(props.onStorm).toHaveBeenCalledOnce()
    expect(props.onDelete).toHaveBeenCalledOnce()
  })

  it('准备中、生成中与只读模式都会禁用对应动作', async () => {
    const { host } = await mount({
      canEdit: false,
      consultPreparing: true,
      stormAI: stream({ isStreaming: true }),
    })
    expect(button(host, 'AI 历史考据').disabled).toBe(true)
    expect(button(host, 'AI 头脑风暴').disabled).toBe(true)
    expect(host.textContent).not.toContain('删除事件')
  })

  it('活动输出隐藏同类已保存结果，采纳与重试仍转发当前条目动作', async () => {
    const onAcceptConsult = vi.fn()
    const onConsult = vi.fn()
    const { host } = await mount({
      consultActive: true,
      consultAI: stream({ output: '本轮考据输出' }),
      savedConsult: '旧考据结果',
      onAcceptConsult,
      onConsult,
    })
    expect(host.textContent).toContain('本轮考据输出')
    expect(host.textContent).not.toContain('旧考据结果')
    await act(async () => button(host, '采纳').click())
    await act(async () => button(host, '重试').click())
    expect(onAcceptConsult).toHaveBeenCalledWith('本轮考据输出')
    expect(onConsult).toHaveBeenCalledOnce()
  })

  it('非活动态展示两类已保存结果并分别清除', async () => {
    const onClearConsult = vi.fn()
    const onClearStorm = vi.fn()
    const { host } = await mount({
      savedConsult: '已保存考据',
      savedStorm: '已保存细节',
      savedStormLabel: 'AI 时代细节库',
      savedStormMaxHeight: '80',
      onClearConsult,
      onClearStorm,
    })
    expect(host.textContent).toContain('AI 历史考据结果')
    expect(host.textContent).toContain('AI 时代细节库')
    const clearButtons = Array.from(host.querySelectorAll('button')).filter(item => item.textContent?.trim() === '清除')
    expect(clearButtons).toHaveLength(2)
    await act(async () => clearButtons[0].click())
    await act(async () => clearButtons[1].click())
    expect(onClearConsult).toHaveBeenCalledOnce()
    expect(onClearStorm).toHaveBeenCalledOnce()
  })
})
