/**
 * 状态变更审核弹窗
 * 展示 AI 提取的 diff，用户可逐条勾选接受/拒绝，确认后写入状态表
 */
import { useState } from 'react'
import { Check, X, AlertCircle } from 'lucide-react'
import type { StateDiffItem } from '../../lib/types'
import { STATE_CATEGORY_LABELS } from '../../lib/types/state-card'

interface Props {
  diffs: StateDiffItem[]
  chapterTitle: string
  onConfirm: (accepted: StateDiffItem[]) => void
  onCancel: () => void
}

export default function StateDiffModal({ diffs, chapterTitle, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(diffs.map((_, i) => i)))

  const toggle = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const handleConfirm = () => {
    const accepted = diffs.filter((_, i) => selected.has(i))
    console.log(`[StateDiff] 用户确认：${accepted.length}/${diffs.length} 条变更`)
    onConfirm(accepted)
  }

  if (diffs.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-bg-surface border border-border rounded-xl p-6 max-w-lg w-full mx-4">
          <div className="flex items-center gap-2 text-text-muted mb-4">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">本章未检测到状态变更</span>
          </div>
          <button onClick={onCancel}
            className="px-4 py-2 bg-bg-elevated text-text-secondary rounded-lg text-sm hover:bg-bg-hover transition-colors">
            关闭
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-surface border border-border rounded-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        {/* 头部 */}
        <div className="p-5 border-b border-border">
          <h3 className="text-lg font-bold text-text-primary">📋 状态变更审核</h3>
          <p className="text-sm text-text-muted mt-1">
            章节「{chapterTitle}」生成了 {diffs.length} 条变更，请勾选要写入状态表的项目。
          </p>
        </div>

        {/* 变更列表 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {diffs.map((diff, idx) => (
            <label
              key={idx}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                selected.has(idx)
                  ? 'border-accent bg-accent/5'
                  : 'border-border bg-bg-base opacity-60'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(idx)}
                onChange={() => toggle(idx)}
                className="mt-0.5 accent-accent"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="px-1.5 py-0.5 rounded text-xs bg-bg-elevated text-text-muted">
                    {STATE_CATEGORY_LABELS[diff.category] || diff.category}
                  </span>
                  <span className="font-medium text-text-primary">{diff.entityName}</span>
                  <span className="text-text-muted">·</span>
                  <span className="text-text-secondary">{diff.field}</span>
                </div>
                <div className="mt-1 text-xs flex items-center gap-2">
                  {diff.oldValue ? (
                    <>
                      <span className="text-red-400 line-through">{diff.oldValue}</span>
                      <span className="text-text-muted">→</span>
                      <span className="text-green-400">{diff.newValue}</span>
                    </>
                  ) : (
                    <span className="text-green-400">+ {diff.newValue}</span>
                  )}
                </div>
              </div>
            </label>
          ))}
        </div>

        {/* 底部操作 */}
        <div className="p-5 border-t border-border flex items-center justify-between">
          <span className="text-xs text-text-muted">
            已选 {selected.size}/{diffs.length} 条
          </span>
          <div className="flex gap-3">
            <button onClick={onCancel}
              className="flex items-center gap-1.5 px-4 py-2 bg-bg-elevated text-text-secondary rounded-lg text-sm hover:bg-bg-hover transition-colors">
              <X className="w-4 h-4" /> 取消
            </button>
            <button onClick={handleConfirm}
              className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent-hover transition-colors">
              <Check className="w-4 h-4" /> 写入状态表（{selected.size}）
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
