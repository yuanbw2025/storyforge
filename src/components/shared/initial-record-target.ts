import { useEffect } from 'react'

export const INITIAL_RECORD_TARGET_CLASS =
  'border-amber-400/70 ring-2 ring-amber-400/30 bg-amber-500/5 scroll-mt-24'

export function initialRecordTargetAttributes(active: boolean, recordId: number | undefined) {
  return active && recordId != null
    ? { 'data-impact-target': 'true', 'data-impact-target-id': String(recordId) }
    : {}
}

/** Scroll only after the panel has confirmed that its scoped store contains the row. */
export function useInitialRecordTarget(recordId: number | null | undefined, ready: boolean): void {
  useEffect(() => {
    if (recordId == null || !ready) return
    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-impact-target="true"][data-impact-target-id="${recordId}"]`,
      )
      target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [ready, recordId])
}
