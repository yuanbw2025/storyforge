import { useRef, useState, useEffect, useCallback, type TextareaHTMLAttributes } from 'react'
import { containTextareaWheel, parseCssPixels } from './textarea-scroll'

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> {
  /** 最小行数 */
  minRows?: number
  /** 最大行数（超过后出现滚动条） */
  maxRows?: number
}

/**
 * 自适应高度的 textarea（组合输入安全）
 *
 * 随内容自动增长/收缩高度，到 maxRows 后显示滚动条。
 * 内置 IME 组合输入保护，中文/日文/韩文输入不会闪烁。
 */
export default function AutoResizeTextarea({
  minRows = 2,
  maxRows = 20,
  value: externalValue,
  onChange,
  onWheel,
  className = '',
  ...rest
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const [localValue, setLocalValue] = useState(String(externalValue ?? ''))

  // 外部值变化时同步（仅非组合状态）
  useEffect(() => {
    if (!composingRef.current) {
      setLocalValue(String(externalValue ?? ''))
    }
  }, [externalValue])

  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const computed = getComputedStyle(el)
    const lineHeight = parseCssPixels(computed.lineHeight) || 20
    const paddingY = parseCssPixels(computed.paddingTop) + parseCssPixels(computed.paddingBottom)
    const minH = lineHeight * minRows + paddingY
    const maxH = lineHeight * maxRows + paddingY
    const targetH = Math.min(maxH, Math.max(minH, el.scrollHeight))
    el.style.height = `${targetH}px`
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden'
  }, [minRows, maxRows])

  useEffect(() => { resize() }, [localValue, resize])
  useEffect(() => { resize() }, [resize])

  return (
    <textarea
      ref={ref}
      {...rest}
      value={localValue}
      className={`resize-none ${className}`}
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={(e) => {
        composingRef.current = false
        const val = (e.target as HTMLTextAreaElement).value
        setLocalValue(val)
        onChange?.({ ...e, target: { ...e.target, value: val } } as unknown as React.ChangeEvent<HTMLTextAreaElement>)
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
}
