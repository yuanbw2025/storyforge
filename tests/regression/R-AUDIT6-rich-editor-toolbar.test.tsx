import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RichEditorToolbar from '../../src/components/editor/RichEditorToolbar'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function mount(patch: Record<string, unknown> = {}) {
  const props = {
    typography: { fontFamily: '', fontSize: '', lineHeight: '', paragraphSpacing: '' },
    colorInputValue: '#112233',
    backgroundColorInputValue: '#ffe45c',
    wordCount: 12345,
    active: { bold: false, italic: false, strike: false, heading2: false, heading3: false, bulletList: false, orderedList: false, blockquote: false },
    canUndo: true,
    canRedo: false,
    onMouseDownCapture: vi.fn(),
    onTypographyChange: vi.fn(),
    onTextColorChange: vi.fn(),
    onClearTextColor: vi.fn(),
    onBackgroundColorChange: vi.fn(),
    onBold: vi.fn(),
    onItalic: vi.fn(),
    onStrike: vi.fn(),
    onHeading2: vi.fn(),
    onHeading3: vi.fn(),
    onBulletList: vi.fn(),
    onOrderedList: vi.fn(),
    onBlockquote: vi.fn(),
    onHorizontalRule: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...patch,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(RichEditorToolbar, props)))
  return { host, props }
}

function titledButton(host: HTMLElement, title: string): HTMLButtonElement {
  const match = host.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
  if (!match) throw new Error(`missing button: ${title}`)
  return match
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 / HEALTH-4 · 富文本格式工具栏', () => {
  it('转发排版选择并保持跨章配置值', async () => {
    const { host, props } = await mount()
    const fontSize = host.querySelector<HTMLSelectElement>('select[aria-label="字号"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(fontSize, '20px')
      fontSize.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(props.onTypographyChange).toHaveBeenCalledWith({ fontSize: '20px' })
    expect(host.textContent).toContain('12,345 字')
  })

  it('逐项转发格式命令，并准确禁用重做', async () => {
    const { host, props } = await mount()
    for (const title of ['加粗 (Cmd/Ctrl+B)', '斜体 (Cmd/Ctrl+I)', '删除线', '二级标题', '三级标题', '无序列表', '有序列表', '引用', '分割线', '撤销 (Cmd/Ctrl+Z)']) {
      await act(async () => titledButton(host, title).click())
    }
    expect(props.onBold).toHaveBeenCalledOnce()
    expect(props.onItalic).toHaveBeenCalledOnce()
    expect(props.onStrike).toHaveBeenCalledOnce()
    expect(props.onHeading2).toHaveBeenCalledOnce()
    expect(props.onHeading3).toHaveBeenCalledOnce()
    expect(props.onBulletList).toHaveBeenCalledOnce()
    expect(props.onOrderedList).toHaveBeenCalledOnce()
    expect(props.onBlockquote).toHaveBeenCalledOnce()
    expect(props.onHorizontalRule).toHaveBeenCalledOnce()
    expect(props.onUndo).toHaveBeenCalledOnce()
    expect(titledButton(host, '重做 (Cmd/Ctrl+Shift+Z)').disabled).toBe(true)
  })

  it('转发自定义字色、预设字色、清除字色和背景色', async () => {
    const { host, props } = await mount()
    const color = host.querySelector<HTMLInputElement>('input[aria-label="字色"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(color, '#abcdef')
      color.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="字色 正文"]')!.click())
    await act(async () => Array.from(host.querySelectorAll('button')).find(item => item.textContent === '清')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="黄底"]')!.click())
    expect(props.onTextColorChange).toHaveBeenNthCalledWith(1, '#abcdef')
    expect(props.onTextColorChange).toHaveBeenNthCalledWith(2, 'var(--editor-ink-primary)')
    expect(props.onClearTextColor).toHaveBeenCalledOnce()
    expect(props.onBackgroundColorChange).toHaveBeenCalledWith('var(--editor-mark-yellow)')
  })
})
