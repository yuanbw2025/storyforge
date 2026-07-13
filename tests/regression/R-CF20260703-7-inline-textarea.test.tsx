import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { InlineTextarea } from '../../src/components/shared/InlineEdit'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('CF-20260703-7 · InlineTextarea 长文本内部滚动', () => {
  it('粘贴长文本后按最大行数限制高度并启用内部滚动', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(createElement(InlineTextarea, {
        value: '点击进入编辑',
        onChange: vi.fn(),
        minRows: 2,
        maxRows: 4,
      }))
    })

    await act(async () => {
      host.querySelector('div')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const textarea = host.querySelector('textarea')!
    Object.defineProperties(textarea, {
      scrollHeight: { configurable: true, value: 300 },
    })

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, '长文本\n'.repeat(80))
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(textarea.style.height).toBe('80px')
    expect(textarea.style.overflowY).toBe('auto')

    await act(async () => root.unmount())
    host.remove()
  })
})

