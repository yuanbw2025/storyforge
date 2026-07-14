import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChapterEditorToolbar from '../../src/components/editor/ChapterEditorToolbar'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function mount(patch: Record<string, unknown> = {}) {
  const props = {
    isStreaming: false,
    hasText: true,
    extractingState: false,
    extractingFacts: false,
    factStreaming: false,
    analyzingImpact: false,
    impactInfo: null,
    hasOutline: true,
    showOutlinePreview: false,
    showReviewPanel: false,
    showNotePanel: false,
    customInstruction: '',
    onGenerate: vi.fn(),
    onContinue: vi.fn(),
    onExpand: vi.fn(),
    onPolish: vi.fn(),
    onDeAI: vi.fn(),
    onExtractState: vi.fn(),
    onExtractFacts: vi.fn(),
    onAnalyzeImpact: vi.fn(),
    onDismissImpact: vi.fn(),
    onToggleOutlinePreview: vi.fn(),
    onToggleReviewPanel: vi.fn(),
    onToggleNotePanel: vi.fn(),
    onCustomInstructionChange: vi.fn(),
    ...patch,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(ChapterEditorToolbar, props)))
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

describe('AUDIT-6 / HEALTH-4 · 正文编辑器工具栏', () => {
  it('逐项转发现有 AI、提取和面板命令', async () => {
    const { host, props } = await mount()
    for (const label of ['✨ 生成正文', '📝 续写', '📖 扩写', '💎 润色', '🔥 去AI味', '提取状态', '提取事实', '影响分析', '大纲预览', '质量审校', '便签']) {
      await act(async () => button(host, label).click())
    }
    expect(props.onGenerate).toHaveBeenCalledOnce()
    expect(props.onContinue).toHaveBeenCalledOnce()
    expect(props.onExpand).toHaveBeenCalledOnce()
    expect(props.onPolish).toHaveBeenCalledOnce()
    expect(props.onDeAI).toHaveBeenCalledOnce()
    expect(props.onExtractState).toHaveBeenCalledOnce()
    expect(props.onExtractFacts).toHaveBeenCalledOnce()
    expect(props.onAnalyzeImpact).toHaveBeenCalledOnce()
    expect(props.onToggleOutlinePreview).toHaveBeenCalledOnce()
    expect(props.onToggleReviewPanel).toHaveBeenCalledOnce()
    expect(props.onToggleNotePanel).toHaveBeenCalledOnce()
  })

  it('无正文或任务忙碌时保持原禁用边界', async () => {
    const { host } = await mount({
      isStreaming: true,
      hasText: false,
      extractingState: true,
      extractingFacts: true,
      factStreaming: true,
      analyzingImpact: true,
    })
    for (const label of ['✨ 生成正文', '📝 续写', '📖 扩写', '💎 润色', '🔥 去AI味', '提取中...', '抽取中...', '分析中...', '质量审校']) {
      expect(button(host, label).disabled).toBe(true)
    }
    expect(button(host, '便签').disabled).toBe(false)
  })

  it('展示影响分析结果、开关状态并转发组合输入', async () => {
    const { host, props } = await mount({
      impactInfo: '2 条事实需要复核',
      showOutlinePreview: true,
      showReviewPanel: true,
      showNotePanel: true,
    })
    expect(host.textContent).toContain('2 条事实需要复核')
    expect(button(host, '大纲预览').getAttribute('aria-pressed')).toBe('true')
    expect(button(host, '质量审校').getAttribute('aria-pressed')).toBe('true')
    expect(button(host, '便签').getAttribute('aria-pressed')).toBe('true')
    await act(async () => button(host, '×').click())
    expect(props.onDismissImpact).toHaveBeenCalledOnce()

    const input = host.querySelector('input')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '保持冷峻语气')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(props.onCustomInstructionChange).toHaveBeenCalledWith('保持冷峻语气')
  })
})
