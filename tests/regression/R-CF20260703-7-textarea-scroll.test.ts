import { describe, expect, it, vi } from 'vitest'
import { containTextareaWheel } from '../../src/components/shared/textarea-scroll'

function wheelEvent(
  textarea: Pick<HTMLTextAreaElement, 'scrollTop' | 'clientHeight' | 'scrollHeight'>,
  deltaY: number,
) {
  return {
    currentTarget: textarea,
    deltaY,
    stopPropagation: vi.fn(),
  }
}

describe('CF-20260703-7 · 长文本框滚动边界', () => {
  it('文本框仍可滚动时截断冒泡，到达边界后把滚动交还页面', () => {
    const textarea = { scrollTop: 40, clientHeight: 100, scrollHeight: 400 }

    const scrollingDown = wheelEvent(textarea, 60)
    containTextareaWheel(scrollingDown as never)
    expect(scrollingDown.stopPropagation).toHaveBeenCalledOnce()

    textarea.scrollTop = 300
    const atBottom = wheelEvent(textarea, 60)
    containTextareaWheel(atBottom as never)
    expect(atBottom.stopPropagation).not.toHaveBeenCalled()

    textarea.scrollTop = 0
    const atTop = wheelEvent(textarea, -60)
    containTextareaWheel(atTop as never)
    expect(atTop.stopPropagation).not.toHaveBeenCalled()
  })
})

