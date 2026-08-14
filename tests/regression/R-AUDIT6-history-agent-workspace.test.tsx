import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HistoryAgentWorkspace from '../../src/components/history/HistoryAgentWorkspace'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

function lane(patch: Record<string, unknown> = {}) {
  return {
    candidate: null,
    runId: null,
    busy: false,
    message: null,
    unsafeRunId: null,
    adoptionPending: false,
    ...patch,
  }
}

async function mount(patch: Record<string, unknown> = {}) {
  const props = {
    canEdit: true,
    consultActive: false,
    stormActive: false,
    consultAI: lane(),
    stormAI: lane(),
    savedConsult: undefined,
    savedStorm: undefined,
    savedStormLabel: 'AI 头脑风暴结果',
    deleteLabel: '删除事件',
    onConsult: vi.fn(),
    onStorm: vi.fn(),
    onDelete: vi.fn(),
    onAcceptConsult: vi.fn(),
    onAcceptStorm: vi.fn(),
    onRejectConsult: vi.fn(),
    onRejectStorm: vi.fn(),
    onRetryConsult: vi.fn(),
    onRetryStorm: vi.fn(),
    onClearConsult: vi.fn(),
    onClearStorm: vi.fn(),
    ...patch,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(HistoryAgentWorkspace, props as any)))
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
describe('AUDIT-6 · 历史双 Agent 持久候选视图', () => {
  it('转发考据、风暴与删除命令，并保留条目类型文案', async () => {
    const { host, props } = await mount({ deleteLabel: '删除关键词' })
    await act(async () => button(host, 'AI 历史考据').click())
    await act(async () => button(host, 'AI 头脑风暴').click())
    await act(async () => button(host, '删除关键词').click())
    expect(props.onConsult).toHaveBeenCalledOnce()
    expect(props.onStorm).toHaveBeenCalledOnce()
    expect(props.onDelete).toHaveBeenCalledOnce()
  })

  it('运行中、已有候选、未知窗口与只读模式都会禁用对应动作', async () => {
    const { host } = await mount({
      canEdit: false,
      consultAI: lane({ busy: true }),
      stormAI: lane({ unsafeRunId: 9 }),
    })
    expect(button(host, 'AI 历史考据').disabled).toBe(true)
    expect(button(host, 'AI 头脑风暴').disabled).toBe(true)
    expect(host.textContent).not.toContain('删除事件')
  })

  it('活动候选隐藏旧结果，并转发确认、拒绝和拒绝后重试', async () => {
    const onAcceptConsult = vi.fn()
    const onRejectConsult = vi.fn()
    const onRetryConsult = vi.fn()
    const { host } = await mount({
      consultActive: true,
      consultAI: lane({ candidate: { result: '本轮考据候选' }, runId: 7 }),
      savedConsult: '旧考据结果',
      onAcceptConsult,
      onRejectConsult,
      onRetryConsult,
    })
    expect(host.textContent).toContain('本轮考据候选')
    expect(host.textContent).not.toContain('旧考据结果')
    await act(async () => button(host, '确认写入').click())
    await act(async () => button(host, '拒绝候选').click())
    await act(async () => button(host, '拒绝并重试').click())
    expect(onAcceptConsult).toHaveBeenCalledOnce()
    expect(onRejectConsult).toHaveBeenCalledOnce()
    expect(onRetryConsult).toHaveBeenCalledOnce()
  })

  it('冻结采纳意图只允许继续终验；非活动态展示两类正式结果并可清除', async () => {
    const frozen = await mount({
      consultActive: true,
      consultAI: lane({ candidate: { result: '已冻结候选' }, runId: 7, adoptionPending: true }),
    })
    expect(button(frozen.host, '继续确认与终验')).toBeTruthy()
    expect(frozen.host.textContent).not.toContain('拒绝候选')

    const onClearConsult = vi.fn()
    const onClearStorm = vi.fn()
    const saved = await mount({
      savedConsult: '已保存考据',
      savedStorm: '已保存细节',
      savedStormLabel: 'AI 时代细节库',
      onClearConsult,
      onClearStorm,
    })
    expect(saved.host.textContent).toContain('AI 历史考据结果')
    expect(saved.host.textContent).toContain('AI 时代细节库')
    const clearButtons = Array.from(saved.host.querySelectorAll('button')).filter(item => item.textContent?.trim() === '清除')
    expect(clearButtons).toHaveLength(2)
    await act(async () => clearButtons[0].click())
    await act(async () => clearButtons[1].click())
    expect(onClearConsult).toHaveBeenCalledOnce()
    expect(onClearStorm).toHaveBeenCalledOnce()
  })
})
