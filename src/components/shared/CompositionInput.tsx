/**
 * 组合输入安全的 input / textarea 包装组件
 *
 * 解决：React 受控组件在中文/日文/韩文 IME 组合输入时，
 * onChange → setState → re-render 会打断输入法组合状态，
 * 导致拼音字母直接提交、输入法闪烁等问题。
 *
 * 原理：组合输入期间只更新本地 state，不触发外部 onChange；
 * 组合结束后再同步给外部。
 */
import { useState, useEffect, useRef, forwardRef } from 'react'
import { containTextareaWheel } from './textarea-scroll'
import ResizableInputArea, { type AreaControlV1 } from './ResizableInputArea'
import type { InputAreaLayoutOptionsV1 } from '../../lib/input-area-layout'

/* ── CInput ────────────────────────────────────────────────── */

export const CInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ value: externalValue, onChange, ...rest }, ref) => {
  const [localValue, setLocalValue] = useState(String(externalValue ?? ''))
  const composingRef = useRef(false)

  // 外部值变化时同步（仅非组合状态）
  useEffect(() => {
    if (!composingRef.current) {
      setLocalValue(String(externalValue ?? ''))
    }
  }, [externalValue])

  return (
    <input
      ref={ref}
      {...rest}
      value={localValue}
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={(e) => {
        composingRef.current = false
        const val = (e.target as HTMLInputElement).value
        setLocalValue(val)
        onChange?.({ ...e, target: { ...e.target, value: val } } as unknown as React.ChangeEvent<HTMLInputElement>)
      }}
      onChange={(e) => {
        setLocalValue(e.target.value)
        if (!composingRef.current) {
          onChange?.(e)
        }
      }}
    />
  )
})
CInput.displayName = 'CInput'

/* ── CTextarea ─────────────────────────────────────────────── */

export const CTextarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { inputAreaLayout?: InputAreaLayoutOptionsV1 }
>(({ value: externalValue, onChange, onWheel, onBlur, inputAreaLayout, ...rest }, ref) => {
  const [localValue, setLocalValue] = useState(String(externalValue ?? ''))
  const composingRef = useRef(false)

  useEffect(() => {
    if (!composingRef.current) {
      setLocalValue(String(externalValue ?? ''))
    }
  }, [externalValue])

  const renderTextarea = (area?: AreaControlV1) => (
    <textarea
      ref={area ? element => {
        area.ref.current = element
        if (typeof ref === 'function') return ref(element)
        if (ref) ref.current = element
      } : ref}
      {...rest}
      style={area ? { ...rest.style, ...area.style } : rest.style}
      value={localValue}
      onBlur={area ? event => area.blur(event, onBlur) : onBlur}
      onCompositionStart={() => { composingRef.current = true; area?.compositionStart() }}
      onCompositionEnd={(e) => {
        composingRef.current = false
        const val = (e.target as HTMLTextAreaElement).value
        setLocalValue(val)
        onChange?.({ ...e, target: { ...e.target, value: val } } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
        area?.compositionEnd()
      }}
      onChange={(e) => {
        setLocalValue(e.target.value)
        if (!composingRef.current) {
          onChange?.(e)
        }
      }}
      onWheel={(e) => {
        onWheel?.(e)
        if (!e.defaultPrevented) containTextareaWheel(e)
      }}
    />
  )
  return inputAreaLayout?.enabled === true ? <ResizableInputArea options={inputAreaLayout}>{renderTextarea}</ResizableInputArea> : renderTextarea()
})
CTextarea.displayName = 'CTextarea'
