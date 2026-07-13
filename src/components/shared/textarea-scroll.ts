import type { WheelEvent as ReactWheelEvent } from 'react'

const SCROLL_EPSILON = 1

export function parseCssPixels(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 长文本框仍能沿滚轮方向滚动时，把滚动留在文本框内；到达边界后交还外层页面。
 */
export function containTextareaWheel(event: ReactWheelEvent<HTMLTextAreaElement>): void {
  const textarea = event.currentTarget
  const canScrollUp = event.deltaY < 0 && textarea.scrollTop > SCROLL_EPSILON
  const canScrollDown = event.deltaY > 0
    && textarea.scrollTop + textarea.clientHeight < textarea.scrollHeight - SCROLL_EPSILON

  if (canScrollUp || canScrollDown) {
    event.stopPropagation()
  }
}
