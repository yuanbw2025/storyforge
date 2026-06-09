/**
 * 上下文窗口预算进度条 — Phase 21.3
 *
 * 类似 Cline 的上下文窗口进度条，但适配写小说场景：
 * - 显示各层（L0-L3）的 token 占比
 * - 超窗口自动告警 + 建议裁剪
 * - 鼠标 hover 显示各段详情
 */
import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Zap } from 'lucide-react'
import {
  formatTokenCount,
  getBudgetColorClass,
  autoTrimToFit,
  type ContextBudget,
  type ContextLayer,
} from '../../lib/ai/context-budget'

interface Props {
  budget: ContextBudget
  /** 用户确认裁剪后回调（返回裁剪后的 segments） */
  onTrim?: (trimmedLayers: ContextLayer[]) => void
  /** 紧凑模式（只显示进度条，不显示详情） */
  compact?: boolean
}

const LAYER_COLORS: Record<ContextLayer, string> = {
  L0: 'bg-blue-500',
  L1: 'bg-green-500',
  L2: 'bg-amber-500',
  L3: 'bg-purple-500',
}

const LAYER_LABELS: Record<ContextLayer, string> = {
  L0: '基础指令',
  L1: '核心上下文',
  L2: '扩展上下文',
  L3: '增强上下文',
}

export default function ContextBudgetBar({ budget, onTrim, compact }: Props) {
  const [showDetail, setShowDetail] = useState(false)
  const pct = Math.min(budget.usageRatio * 100, 100)
  const colorClass = getBudgetColorClass(budget.usageRatio)

  // 按 layer 分组统计 token
  const layerTokens: Record<ContextLayer, number> = { L0: 0, L1: 0, L2: 0, L3: 0 }
  for (const seg of budget.segments) {
    layerTokens[seg.layer] += seg.tokens
  }

  return (
    <div className="text-xs">
      {/* 进度条 */}
      <div className="flex items-center gap-2">
        <Zap className={`w-3 h-3 flex-shrink-0 ${colorClass}`} />
        <div className="flex-1 h-2 bg-bg-elevated rounded-full overflow-hidden relative">
          {/* 分层色条 */}
          {(['L0', 'L1', 'L2', 'L3'] as ContextLayer[]).map(layer => {
            const layerPct = budget.inputBudget > 0
              ? (layerTokens[layer] / budget.inputBudget) * 100
              : 0
            if (layerPct <= 0) return null
            return (
              <div
                key={layer}
                className={`h-full ${LAYER_COLORS[layer]} inline-block`}
                style={{ width: `${Math.min(layerPct, 100)}%` }}
                title={`${LAYER_LABELS[layer]}: ${formatTokenCount(layerTokens[layer])}`}
              />
            )
          })}
        </div>
        <span className={`flex-shrink-0 tabular-nums ${colorClass}`}>
          {formatTokenCount(budget.totalInputTokens)} / {formatTokenCount(budget.inputBudget)}
        </span>
        {!compact && (
          <button
            onClick={() => setShowDetail(v => !v)}
            className="p-0.5 text-text-muted hover:text-text-primary"
          >
            {showDetail ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* 超窗口警告 */}
      {budget.overBudget && (
        <div className="mt-1.5 flex items-start gap-1.5 text-error bg-error/10 rounded px-2 py-1">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">上下文超出窗口限制</p>
            <p className="text-text-muted mt-0.5">
              超出 {formatTokenCount(budget.totalInputTokens - budget.inputBudget)} token。
              {onTrim && '可自动裁剪低优先级内容（参考作品/示例等）。'}
            </p>
            {onTrim && (
              <button
                onClick={() => {
                  const { trimmedLayers } = autoTrimToFit(budget)
                  onTrim(trimmedLayers)
                }}
                className="mt-1 px-2 py-0.5 bg-error/20 text-error rounded hover:bg-error/30 text-[10px]"
              >
                自动裁剪
              </button>
            )}
          </div>
        </div>
      )}

      {/* 详情面板 */}
      {showDetail && !compact && (
        <div className="mt-2 space-y-1 bg-bg-base border border-border rounded-lg p-2">
          {/* 图例 */}
          <div className="flex items-center gap-3 mb-1.5 text-[10px] text-text-muted">
            {(['L0', 'L1', 'L2', 'L3'] as ContextLayer[]).map(l => (
              <span key={l} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-sm ${LAYER_COLORS[l]}`} />
                {LAYER_LABELS[l]}
              </span>
            ))}
          </div>

          {/* 各段明细 */}
          {budget.segments.map((seg, i) => {
            const segPct = budget.inputBudget > 0
              ? ((seg.tokens / budget.inputBudget) * 100).toFixed(1)
              : '0'
            return (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <span className={`w-2 h-2 rounded-sm flex-shrink-0 ${LAYER_COLORS[seg.layer]}`} />
                <span className="flex-1 text-text-secondary truncate" title={seg.label}>
                  {seg.label}
                </span>
                <span className="text-text-muted tabular-nums">{formatTokenCount(seg.tokens)}</span>
                <span className="text-text-muted tabular-nums w-10 text-right">{segPct}%</span>
              </div>
            )
          })}

          {/* 汇总 */}
          <div className="border-t border-border pt-1 mt-1 flex justify-between text-[10px]">
            <span className="text-text-muted">
              模型窗口 {formatTokenCount(budget.maxContext)} | 预留输出 {formatTokenCount(budget.maxOutput)} | 安全边际 {formatTokenCount(budget.safetyMargin)}
            </span>
            <span className={colorClass}>{pct.toFixed(0)}% 已用</span>
          </div>
        </div>
      )}
    </div>
  )
}
