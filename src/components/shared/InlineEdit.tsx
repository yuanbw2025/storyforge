/**
 * 通用行内编辑组件（组合输入安全）
 *
 * 点击显示文本 → 进入编辑模式（input/textarea）→ blur 或 Escape 提交/取消
 * 内置 IME 组合输入保护。
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { containTextareaWheel, parseCssPixels } from './textarea-scroll'

/* ── InlineInput（单行） ────────────────────────────────────── */

export function InlineInput({
  value, onChange, placeholder, className, prefix, suffix,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  prefix?: string
  suffix?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const composingRef = useRef(false)

  useEffect(() => { if (!composingRef.current) setDraft(value) }, [value])

  const commit = () => {
    setEditing(false)
    if (draft !== value) onChange(draft)
  }

  if (editing) {
    return (
      <input
        value={draft}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={(e) => {
          composingRef.current = false
          setDraft((e.target as HTMLInputElement).value)
        }}
        onChange={e => {
          setDraft(e.target.value)
        }}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
          if (e.key === 'Enter') commit()
        }}
        placeholder={placeholder}
        className={`bg-transparent border-b border-accent/50 outline-none w-full ${className || ''}`}
        autoFocus
      />
    )
  }

  if (!value) {
    return (
      <div onClick={() => setEditing(true)} className={`cursor-text min-h-[1.2em] ${className || ''} opacity-40`}>
        {placeholder || '点击编辑…'}
      </div>
    )
  }

  return (
    <div onClick={() => setEditing(true)} className={`cursor-text min-h-[1.2em] ${className || ''}`}>
      {prefix}{value}{suffix}
    </div>
  )
}

/* ── InlineTextarea（多行） ──────────────────────────────────── */

export function InlineTextarea({
  value, onChange, placeholder, className, minRows = 2, maxRows = 16,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  minRows?: number
  maxRows?: number
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)

  useEffect(() => { if (!composingRef.current) setDraft(value) }, [value])

  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const computed = getComputedStyle(el)
    const lineHeight = parseCssPixels(computed.lineHeight) || 20
    const paddingY = parseCssPixels(computed.paddingTop) + parseCssPixels(computed.paddingBottom)
    const minHeight = lineHeight * minRows + paddingY
    const maxHeight = lineHeight * maxRows + paddingY
    const height = Math.min(maxHeight, Math.max(minHeight, el.scrollHeight))
    el.style.height = `${height}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [maxRows, minRows])

  useEffect(() => { if (editing) resize() }, [draft, editing, resize])

  const commit = () => {
    setEditing(false)
    if (draft !== value) onChange(draft)
  }

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={draft}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={(e) => {
          composingRef.current = false
          setDraft((e.target as HTMLTextAreaElement).value)
        }}
        onChange={e => { setDraft(e.target.value) }}
        onWheel={containTextareaWheel}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        placeholder={placeholder}
        className={className || 'w-full bg-transparent border border-accent/30 rounded px-2 py-1 text-sm text-text-primary outline-none resize-none'}
        autoFocus
      />
    )
  }

  if (!value) {
    return (
      <div onClick={() => setEditing(true)} className="text-sm text-text-muted/40 cursor-text py-0.5">
        {placeholder || '点击编辑…'}
      </div>
    )
  }

  return (
    <div onClick={() => setEditing(true)} className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap cursor-text py-0.5">
      {value}
    </div>
  )
}
