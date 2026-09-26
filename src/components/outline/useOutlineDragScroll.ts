import { useEffect, type RefObject } from 'react'

/** Scroll only the hovered outline pane during an internal native drag. */
export function useOutlineDragScroll(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let active = false
    let frame = 0
    let previous = 0
    let pane: HTMLElement | null = null
    let velocity = 0
    const stopScroll = () => {
      cancelAnimationFrame(frame)
      frame = 0
      previous = 0
      pane = null
      velocity = 0
    }
    const stop = () => { active = false; stopScroll() }
    const tick = (time: number) => {
      frame = 0
      if (!active || !pane?.isConnected || !velocity) return
      const elapsed = previous ? Math.min(time - previous, 32) : 16
      previous = time
      pane.scrollTop += velocity * elapsed / 16
      frame = requestAnimationFrame(tick)
    }
    const start = (event: DragEvent) => {
      if (event.target instanceof Element && event.target.closest('[draggable="true"]')) active = true
    }
    const move = (event: DragEvent) => {
      if (!active) return
      if (!(event.target instanceof Element) || !root.contains(event.target)) { stopScroll(); return }
      let target = event.target instanceof HTMLElement ? event.target : event.target.parentElement
      while (target && root.contains(target)) {
        if (/auto|scroll/.test(getComputedStyle(target).overflowY) && target.scrollHeight > target.clientHeight) break
        target = target.parentElement
      }
      if (!target || !root.contains(target)) { stopScroll(); return }
      const rect = target.getBoundingClientRect()
      const top = Math.max(0, rect.top)
      const bottom = Math.min(window.innerHeight, rect.bottom)
      const edge = Math.min(64, (bottom - top) / 3)
      if (edge <= 0 || event.clientY < top || event.clientY > bottom) { stopScroll(); return }
      const speed = event.clientY < top + edge ? -16 * (1 - (event.clientY - top) / edge)
        : event.clientY > bottom - edge ? 16 * (1 - (bottom - event.clientY) / edge) : 0
      if (!speed) { stopScroll(); return }
      pane = target
      velocity = speed
      // Allow dragover in the pane's empty margin without changing drop targets.
      event.preventDefault()
      if (!frame) frame = requestAnimationFrame(tick)
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') stop() }
    const leave = (event: DragEvent) => { if (!event.relatedTarget) stopScroll() }
    root.addEventListener('dragstart', start, true)
    document.addEventListener('dragover', move, true)
    document.addEventListener('drop', stop, true)
    document.addEventListener('dragend', stop, true)
    document.addEventListener('mouseup', stop, true)
    document.addEventListener('keydown', key, true)
    document.addEventListener('dragleave', leave, true)
    window.addEventListener('blur', stop)
    return () => {
      stop()
      root.removeEventListener('dragstart', start, true)
      document.removeEventListener('dragover', move, true)
      document.removeEventListener('drop', stop, true)
      document.removeEventListener('dragend', stop, true)
      document.removeEventListener('mouseup', stop, true)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('dragleave', leave, true)
      window.removeEventListener('blur', stop)
    }
  }, [rootRef])
}
