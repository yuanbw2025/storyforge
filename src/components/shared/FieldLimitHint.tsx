/**
 * FieldLimitHint（H3 — 硬截断阈值文本提示 + 超限警告）
 *
 * 两条要点（按 H2 阶段中确立的需求）：
 * 1. 始终显示一行灰底文本提示，告诉作者"该字段截断阈值是 N 字"。
 * 2. 当输入字符数超过阈值，警告升级为琥珀色（含 AlertTriangle 图标 + 实际超出字数）。
 *    但绝不阻断输入；作者仍可继续敲字 / 粘贴长文本。
 *
 * 该组件 **不读 useAdvancedMode**——按需求，无论是否进入高级模式，提示和警告都对所有
 * 用户始终可见。这样普通用户也能感知到硬截断的存在，避免出现"我都填了为什么 AI 写得没用上"的困惑。
 *
 * 用法：把它放在 <CTextarea /> 后面，单独占一行：
 *   <CTextarea value={x} onChange={...} />
 *   <FieldLimitHint value={x} limit={250} unit="chars" note="超出会被截断，不进 AI 上下文。" />
 */
import { AlertTriangle, Info } from 'lucide-react'

interface FieldLimitHintProps {
  /** 当前字段值（用于计算长度）。 */
  value: string
  /** 截断阈值。 */
  limit: number
  /** 计量单位：chars = 字符；token = 估算 token。默认 chars。 */
  unit?: 'chars' | 'token'
  /** 自定义说明文本，会附加在阈值之后。例如"超出会被截断，不进 AI 上下文。" */
  note?: string
  /** 自定义类名（可选，覆盖默认间距） */
  className?: string
}

/** 中文 ≈ 1.5 token/字，与 context-budget.ts 估算口径一致 */
function estimateTokens(text: string): number {
  if (!text) return 0
  const cjkCount = (text.match(/[一-鿿㐀-䶿]/g) || []).length
  const otherLen = text.length - cjkCount
  return Math.round(cjkCount * 1.5 + otherLen * 0.25)
}

export default function FieldLimitHint({
  value,
  limit,
  unit = 'chars',
  note,
  className = 'mt-1',
}: FieldLimitHintProps) {
  const measured = unit === 'token' ? estimateTokens(value || '') : (value || '').length
  const over = measured > limit
  const overBy = over ? measured - limit : 0
  const unitLabel = unit === 'token' ? 'token' : '字'

  if (over) {
    return (
      <div className={`flex items-start gap-1.5 text-[11px] text-amber-400 ${className}`}>
        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
        <span>
          当前 <span className="font-mono">{measured}</span> {unitLabel}，已超出截断阈值
          （<span className="font-mono">{limit}</span> {unitLabel}）{' '}
          <span className="font-mono">{overBy}</span> {unitLabel}；
          <span className="text-amber-300/80">超出部分不会进入 AI 上下文。</span>
          {note && <span className="text-text-muted ml-1">{note}</span>}
        </span>
      </div>
    )
  }

  return (
    <div className={`flex items-start gap-1.5 text-[11px] text-text-muted ${className}`}>
      <Info className="w-3 h-3 mt-0.5 shrink-0" />
      <span>
        截断阈值：<span className="font-mono">{limit}</span> {unitLabel}（当前{' '}
        <span className="font-mono">{measured}</span>）。{note}
      </span>
    </div>
  )
}
