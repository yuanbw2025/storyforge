/**
 * 版本对比面板 — Phase 24.2
 *
 * 左右分栏 diff 对比（增/删/改高亮）。
 * 基于简单的行级 diff 算法实现。
 */
import { useMemo } from 'react'
import { X, ArrowLeft, ArrowRight } from 'lucide-react'

interface Props {
  leftTitle: string
  rightTitle: string
  leftText: string
  rightText: string
  onClose: () => void
  /** 回退到左侧版本 */
  onRevertToLeft?: () => void
  /** 采用右侧版本 */
  onAcceptRight?: () => void
}

interface DiffLine {
  type: 'same' | 'add' | 'remove' | 'modify'
  left?: string
  right?: string
  lineNo: { left: number; right: number }
}

/**
 * 简单的行级 LCS diff
 */
function computeDiff(leftText: string, rightText: string): DiffLine[] {
  const leftLines = leftText.split('\n')
  const rightLines = rightText.split('\n')

  // LCS 算法
  const m = leftLines.length
  const n = rightLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (leftLines[i - 1] === rightLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // 回溯
  let i = m, j = n
  const stack: DiffLine[] = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
      stack.push({ type: 'same', left: leftLines[i - 1], right: rightLines[j - 1], lineNo: { left: i, right: j } })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'add', right: rightLines[j - 1], lineNo: { left: i, right: j } })
      j--
    } else {
      stack.push({ type: 'remove', left: leftLines[i - 1], lineNo: { left: i, right: j } })
      i--
    }
  }

  stack.reverse()
  return stack
}

const TYPE_STYLES: Record<string, string> = {
  same:   '',
  add:    'bg-green-500/10',
  remove: 'bg-red-500/10',
  modify: 'bg-yellow-500/10',
}

const TYPE_LINE_STYLES: Record<string, string> = {
  same:   'text-text-secondary',
  add:    'text-green-400',
  remove: 'text-red-400 line-through',
  modify: 'text-yellow-400',
}

export default function DiffViewer({
  leftTitle, rightTitle, leftText, rightText,
  onClose, onRevertToLeft, onAcceptRight,
}: Props) {
  const diff = useMemo(() => computeDiff(leftText, rightText), [leftText, rightText])

  const stats = useMemo(() => {
    let added = 0, removed = 0, same = 0
    for (const d of diff) {
      if (d.type === 'add') added++
      else if (d.type === 'remove') removed++
      else same++
    }
    return { added, removed, same, total: diff.length }
  }, [diff])

  return (
    <div className="bg-bg-surface border border-border rounded-xl overflow-hidden shadow-lg">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-elevated border-b border-border">
        <div className="flex items-center gap-4 text-xs">
          <span className="text-text-muted">对比结果：</span>
          <span className="text-green-400">+{stats.added} 新增</span>
          <span className="text-red-400">-{stats.removed} 删除</span>
          <span className="text-text-muted">{stats.same} 未变</span>
        </div>
        <div className="flex items-center gap-2">
          {onRevertToLeft && (
            <button onClick={onRevertToLeft}
              className="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-text-primary rounded hover:bg-bg-hover">
              <ArrowLeft className="w-3 h-3" /> 回退到左侧
            </button>
          )}
          {onAcceptRight && (
            <button onClick={onAcceptRight}
              className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded">
              <ArrowRight className="w-3 h-3" /> 采用右侧
            </button>
          )}
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 列头 */}
      <div className="grid grid-cols-2 border-b border-border text-xs">
        <div className="px-4 py-1.5 bg-red-500/5 text-red-400 font-medium">{leftTitle}</div>
        <div className="px-4 py-1.5 bg-green-500/5 text-green-400 font-medium border-l border-border">{rightTitle}</div>
      </div>

      {/* Diff 内容 */}
      <div className="max-h-[60vh] overflow-y-auto font-mono text-xs">
        {diff.map((line, idx) => (
          <div key={idx} className={`grid grid-cols-2 ${TYPE_STYLES[line.type]} hover:bg-bg-hover/50`}>
            {/* 左侧 */}
            <div className="flex">
              <span className="w-8 text-right pr-2 text-text-muted/50 select-none flex-shrink-0">
                {line.type !== 'add' ? line.lineNo.left : ''}
              </span>
              <span className={`flex-1 px-2 py-0.5 whitespace-pre-wrap break-all ${
                line.type === 'remove' ? TYPE_LINE_STYLES.remove : 'text-text-secondary'
              }`}>
                {line.left ?? ''}
              </span>
            </div>
            {/* 右侧 */}
            <div className="flex border-l border-border/30">
              <span className="w-8 text-right pr-2 text-text-muted/50 select-none flex-shrink-0">
                {line.type !== 'remove' ? line.lineNo.right : ''}
              </span>
              <span className={`flex-1 px-2 py-0.5 whitespace-pre-wrap break-all ${
                line.type === 'add' ? TYPE_LINE_STYLES.add : 'text-text-secondary'
              }`}>
                {line.right ?? ''}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
