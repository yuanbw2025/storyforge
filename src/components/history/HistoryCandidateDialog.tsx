import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

const focusable = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex]')]
  .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0)

/** Keep keyboard navigation in the current candidate without bypassing its
 * pending-edit close barrier or changing the original draft/save lifecycle. */
export default function HistoryCandidateDialog({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const root = useRef<HTMLElement>(null)
  const opener = useRef(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null)
  useEffect(() => () => { if (opener.current?.isConnected) opener.current.focus() }, [])
  useLayoutEffect(() => {
    const element = root.current
    if (element && !element.contains(document.activeElement)) (focusable(element)[0] ?? element).focus()
  })
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const element = root.current
    if (!element || event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
      || (event.target as HTMLElement).closest('[role="dialog"]') !== element) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
    if (event.key !== 'Tab') return
    const items = focusable(element), first = items[0], last = items.at(-1)
    if (!first) { event.preventDefault(); element.focus(); return }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) {
      event.preventDefault(); last!.focus()
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) {
      event.preventDefault(); first.focus()
    }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
    <section ref={root} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={handleKeyDown}
      className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-bg-surface p-4">{children}</section>
  </div>
}
