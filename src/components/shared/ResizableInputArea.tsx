import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type FocusEventHandler, type ReactNode, type RefObject } from 'react'
import {
  clampInputAreaBoxV1, isInputAreaLayoutKeyV1, readInputAreaBoxV1, normalizeInputAreaDesiredBoxV1, saveInputAreaBoxV1,
  type InputAreaBoundsV1, type InputAreaDesiredBoxV1, type InputAreaLayoutOptionsV1,
} from '../../lib/input-area-layout'
import { parseCssPixels } from './textarea-scroll'

export interface AreaControlV1 {
  ref: RefObject<HTMLTextAreaElement | null>
  style: CSSProperties
  compositionStart: () => void
  compositionEnd: () => void
  blur: (event: FocusEvent<HTMLTextAreaElement>, callback?: FocusEventHandler<HTMLTextAreaElement>) => void
}
interface Props {
  options: InputAreaLayoutOptionsV1
  children: (control: AreaControlV1) => ReactNode
  autoHeight?: { value: string; minRows: number; maxRows: number }
  /** The opted-in InlineTextarea routes true external leave to its existing
   * commit function. This shell has no text/save/adopt authority of its own. */
  onExternalLeave?: () => void
}
interface DragV1 {
  pointerId: number
  target: HTMLElement
  before: InputAreaDesiredBoxV1 | null
  start: InputAreaDesiredBoxV1
  x: number; y: number; scale: number
  moved: boolean
  cleanup: () => void
}
const sameBox = (a: InputAreaDesiredBoxV1 | null, b: InputAreaDesiredBoxV1 | null) => a === b || a !== null && b !== null && a.width === b.width && a.height === b.height

/** Explicitly opted-in display-only shell. Callers retain the same textarea,
 * content events, refs and owner. No global CSS or narrative storage. */
export default function ResizableInputArea({ options, children, autoHeight, onExternalLeave }: Props) {
  const frame = useRef<HTMLDivElement>(null), textarea = useRef<HTMLTextAreaElement>(null)
  const [initialPreference] = useState(() => readInputAreaBoxV1(options.preferenceKey))
  const [desired, setDesired] = useState<InputAreaDesiredBoxV1 | null>(initialPreference.box)
  const desiredRef = useRef(desired), keyRef = useRef(options.preferenceKey)
  const storageBaseline = useRef({ key: options.preferenceKey, persistable: initialPreference.persistable })
  desiredRef.current = desired; keyRef.current = options.preferenceKey
  // An unsupported initial read remains session-only until this field reopens.
  // A timer cannot acquire write authority merely because another page later
  // replaces the storage with a recognized format.
  const persistKey = useCallback(() => storageBaseline.current.key === keyRef.current && storageBaseline.current.persistable ? keyRef.current : undefined, [])
  const [bounds, setBounds] = useState<InputAreaBoundsV1>({ width: 0, height: 0, minWidth: 160, minHeight: 64 })
  const [composing, setComposing] = useState(false), composingRef = useRef(false)
  const [dragging, setDragging] = useState(false), drag = useRef<DragV1 | null>(null)
  const [showNudges, setShowNudges] = useState(false)
  const suppressClick = useRef(false)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPersist = useRef<{ key: InputAreaLayoutOptionsV1['preferenceKey']; box: InputAreaDesiredBoxV1 } | null>(null)
  const focusInside = useRef(false), leaveRef = useRef(onExternalLeave)
  const pendingBlur = useRef<{ event: FocusEvent<HTMLTextAreaElement>; element: HTMLTextAreaElement; callback: FocusEventHandler<HTMLTextAreaElement> } | null>(null)
  leaveRef.current = onExternalLeave
  const clearPersist = useCallback(() => { if (persistTimer.current !== null) clearTimeout(persistTimer.current); persistTimer.current = null; pendingPersist.current = null }, [])
  const flushPersist = useCallback(() => {
    const pending = pendingPersist.current
    clearPersist()
    if (pending) saveInputAreaBoxV1(pending.key, pending.box)
  }, [clearPersist])
  const updateDesired = useCallback((box: InputAreaDesiredBoxV1 | null) => {
    desiredRef.current = box
    setDesired(previous => sameBox(previous, box) ? previous : box)
  }, [])
  const finishDrag = useCallback((cancel: boolean, update = true) => {
    const active = drag.current
    if (!active) return
    drag.current = null; active.cleanup()
    try { if (active.target.hasPointerCapture?.(active.pointerId)) active.target.releasePointerCapture(active.pointerId) } catch { /* Already released by the browser. */ }
    if (update) {
      setDragging(false)
      if (cancel) updateDesired(active.before)
      else if (active.moved) { suppressClick.current = true; saveInputAreaBoxV1(persistKey(), desiredRef.current) }
    }
  }, [updateDesired, persistKey])
  const notifyLeave = useCallback((relatedTarget: EventTarget | null = null) => {
    if (!focusInside.current) return
    focusInside.current = false
    // A real field leave finalizes an already completed layout action before
    // its owner may unmount the field. Unmount itself never writes a late box.
    flushPersist()
    const pending = pendingBlur.current; pendingBlur.current = null
    // Keep the real textarea blur's target/native event; React clears
    // currentTarget after dispatch. This callback snapshot supplies its original
    // textarea and the actual final destination, without dispatching any event.
    if (pending) pending.callback(Object.assign(Object.create(pending.event), { currentTarget: pending.element, relatedTarget }))
    leaveRef.current?.()
  }, [flushPersist])

  useLayoutEffect(() => {
    const el = textarea.current, parent = frame.current
    if (!el || !parent) return
    const measure = () => {
      const css = getComputedStyle(el), parentRect = parent.getBoundingClientRect()
      // clientWidth is in layout CSS pixels, even inside a CSS-zoom ancestor.
      const scale = parent.clientWidth > 0 ? parentRect.width / parent.clientWidth : 1
      const line = parseCssPixels(css.lineHeight) || 20
      const padding = parseCssPixels(css.paddingTop) + parseCssPixels(css.paddingBottom) + parseCssPixels(css.borderTopWidth) + parseCssPixels(css.borderBottomWidth)
      const next = { width: Math.max(0, parent.clientWidth), height: Math.max(0, Math.min(960, (window.visualViewport?.height ?? window.innerHeight) * .75 / (scale || 1))), minWidth: 160, minHeight: Math.max(64, line * (autoHeight?.minRows ?? 2) + padding) }
      setBounds(previous => Object.keys(next).every(key => previous[key as keyof InputAreaBoundsV1] === next[key as keyof InputAreaBoundsV1]) ? previous : next)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(parent)
    window.addEventListener('resize', measure); window.visualViewport?.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure) }
  }, [autoHeight?.minRows])

  useEffect(() => {
    finishDrag(true); clearPersist()
    if (storageBaseline.current.key !== options.preferenceKey) {
      const preference = readInputAreaBoxV1(options.preferenceKey)
      storageBaseline.current = { key: options.preferenceKey, persistable: preference.persistable }
      updateDesired(preference.box)
    }
    return () => { finishDrag(true, false); clearPersist() }
  }, [options.preferenceKey, clearPersist, finishDrag, updateDesired])
  useEffect(() => {
    const leave = () => { finishDrag(true); notifyLeave() }
    // Window focus can return to the same textarea without a new focusin.
    // Re-arm true leave when composition or a failed save kept it mounted.
    const enter = () => { focusInside.current = Boolean(frame.current?.contains(document.activeElement)) }
    window.addEventListener('blur', leave); window.addEventListener('focus', enter)
    return () => { window.removeEventListener('blur', leave); window.removeEventListener('focus', enter) }
  }, [finishDrag, notifyLeave])
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el || desired || !autoHeight || composing) return
    el.style.height = 'auto'
    const css = getComputedStyle(el), line = parseCssPixels(css.lineHeight) || 20
    const padding = parseCssPixels(css.paddingTop) + parseCssPixels(css.paddingBottom)
    const border = parseCssPixels(css.borderTopWidth) + parseCssPixels(css.borderBottomWidth)
    const min = line * autoHeight.minRows + padding + border, max = line * autoHeight.maxRows + padding + border
    const height = Math.min(max, Math.max(min, el.scrollHeight + border))
    el.style.height = `${height}px`; el.style.overflowY = el.scrollHeight + border > max ? 'auto' : 'hidden'
  }, [autoHeight?.value, autoHeight?.minRows, autoHeight?.maxRows, autoHeight, desired, bounds.width, composing])

  const actual = desired ? clampInputAreaBoxV1(desired, bounds) : null
  const currentBox = (): InputAreaDesiredBoxV1 => {
    const el = textarea.current
    return desiredRef.current ? clampInputAreaBoxV1(desiredRef.current, bounds) : { width: el?.offsetWidth || bounds.width, height: el?.offsetHeight || 120 }
  }
  const nudge = (width: number, height: number) => {
    if (composingRef.current || drag.current || bounds.width <= 0) return
    const before = currentBox(), remembered = desiredRef.current ?? normalizeInputAreaDesiredBoxV1(before)
    const adjusted = normalizeInputAreaDesiredBoxV1({ width: before.width + width, height: before.height + height })
    const next = { width: width === 0 ? remembered.width : adjusted.width, height: height === 0 ? remembered.height : adjusted.height }
    updateDesired(next); clearPersist()
    const key = persistKey()
    pendingPersist.current = { key, box: next }
    persistTimer.current = setTimeout(flushPersist, 250)
  }
  const reset = () => {
    if (composingRef.current) return
    finishDrag(true); clearPersist(); updateDesired(null); saveInputAreaBoxV1(persistKey(), null)
  }
  const beginDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (event.button !== 0 || composingRef.current || bounds.width <= 0) return
    suppressClick.current = false
    finishDrag(true); clearPersist()
    const target = event.currentTarget, container = frame.current!
    const scale = container.clientWidth > 0 ? container.getBoundingClientRect().width / container.clientWidth : 1
    const active: DragV1 = { pointerId: event.pointerId, target, before: desiredRef.current, start: currentBox(), x: event.clientX, y: event.clientY, scale: scale || 1, moved: false, cleanup: () => {} }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== active.pointerId || drag.current !== active) return
      if (composingRef.current) { finishDrag(true); return }
      const dx = (e.clientX - active.x) / active.scale, dy = (e.clientY - active.y) / active.scale
      if (Math.abs(dx) + Math.abs(dy) < 2 && !active.moved) return
      active.moved = true
      const remembered = active.before ?? normalizeInputAreaDesiredBoxV1(active.start)
      const adjusted = normalizeInputAreaDesiredBoxV1({ width: active.start.width + dx, height: active.start.height + dy })
      updateDesired({ width: Math.abs(dx) < 2 ? remembered.width : adjusted.width, height: Math.abs(dy) < 2 ? remembered.height : adjusted.height })
    }
    const up = (e: PointerEvent) => { if (e.pointerId === active.pointerId) finishDrag(false) }
    const cancel = (e: PointerEvent) => { if (e.pointerId === active.pointerId) finishDrag(true) }
    active.cleanup = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel)
      target.removeEventListener('lostpointercapture', cancel)
    }
    drag.current = active; setDragging(true)
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel)
    target.addEventListener('lostpointercapture', cancel)
    try { target.setPointerCapture?.(event.pointerId) } catch { /* Window listeners also cover unsupported capture. */ }
  }
  const control: AreaControlV1 = {
    ref: textarea,
    style: { boxSizing: 'border-box', width: '100%', maxWidth: '100%', minWidth: 0, resize: 'none',
      ...(actual && bounds.width > 0 ? { height: `${actual.height}px`, minHeight: Math.min(bounds.minHeight, bounds.height), maxHeight: bounds.height, overflowY: 'auto' } : {}),
    },
    compositionStart: () => { composingRef.current = true; setComposing(true); finishDrag(true); clearPersist() },
    compositionEnd: () => { composingRef.current = false; setComposing(false) },
    blur: (event, callback) => {
      if (!callback) return
      if (event.relatedTarget instanceof Node && frame.current?.contains(event.relatedTarget)) pendingBlur.current = { event, element: event.currentTarget, callback }
      else { pendingBlur.current = null; callback(event) }
    },
  }
  const buttonStyle: CSSProperties = { fontSize: 11, maxWidth: '100%', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '3px 6px', cursor: composing ? 'default' : 'pointer' }
  return <div ref={frame} data-input-area-layout={isInputAreaLayoutKeyV1(options.preferenceKey) ? options.preferenceKey : 'session'}
    // Below native padding/border minimums, clip within the zero/tiny parent
    // rather than overwriting caller shorthand styles or growing the parent.
    style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box', ...(bounds.width < 32 ? { overflowX: 'clip' } : {}) }}
    onFocusCapture={event => { focusInside.current = true; if (event.nativeEvent.target === textarea.current) pendingBlur.current = null }}
    onBlurCapture={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) notifyLeave(event.relatedTarget) }}>
    <div style={{ width: actual && bounds.width > 0 ? actual.width : '100%', maxWidth: '100%', minWidth: 0 }}>
      {children(control)}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', maxWidth: '100%', minWidth: 0, visibility: bounds.width > 0 ? undefined : 'hidden' }}>
        <button type="button" style={buttonStyle} disabled={composing || !desired} onMouseDown={event => event.preventDefault()} onClick={reset}>恢复自适应</button>
        <button type="button" aria-label="调整输入区大小" aria-expanded={showNudges} title="拖动角柄调整宽高；也可用方向键或点击打开尺寸按钮"
          style={{ ...buttonStyle, minHeight: 28, touchAction: 'none', cursor: dragging ? 'nwse-resize' : 'pointer' }} disabled={composing}
          onPointerDown={beginDrag} onMouseDown={event => event.preventDefault()}
          onClick={() => { if (suppressClick.current) suppressClick.current = false; else if (!dragging) setShowNudges(value => !value) }}
          onKeyDown={event => {
            const step = event.shiftKey ? 64 : 16
            if (event.key === 'ArrowLeft') { event.preventDefault(); nudge(-step, 0) }
            if (event.key === 'ArrowRight') { event.preventDefault(); nudge(step, 0) }
            if (event.key === 'ArrowUp') { event.preventDefault(); nudge(0, -step) }
            if (event.key === 'ArrowDown') { event.preventDefault(); nudge(0, step) }
          }} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) flushPersist() }}>调整 ↘</button>
      </div>
      {showNudges && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: '100%', minWidth: 0 }}>
        {([['窄一点', -32, 0], ['宽一点', 32, 0], ['矮一点', 0, -32], ['高一点', 0, 32]] as const).map(([label, width, height]) =>
          <button key={label} type="button" style={buttonStyle} disabled={composing} onMouseDown={event => event.preventDefault()} onClick={() => nudge(width, height)}>{label}</button>)}
      </div>}
    </div>
  </div>
}
