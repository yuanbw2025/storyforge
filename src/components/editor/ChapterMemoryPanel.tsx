import { FileText } from 'lucide-react'
import type { ChapterPlanReconciliation } from '../../lib/types'

interface Props {
  summary?: string
  hasText: boolean
  memoryBusy: boolean
  reconciliation?: ChapterPlanReconciliation
  reconciliationCurrent: boolean
  onGenerateMemory: () => void
  onConfirmActualProgress: () => void
  onApplyOutlineCandidate: () => void
}

export default function ChapterMemoryPanel({
  summary,
  hasText,
  memoryBusy,
  reconciliation,
  reconciliationCurrent,
  onGenerateMemory,
  onConfirmActualProgress,
  onApplyOutlineCandidate,
}: Props) {
  const reconciliationStale = reconciliation
    && !reconciliationCurrent
    && (reconciliation.reviewStatus === 'pending' || reconciliation.reviewStatus === 'confirmed-constraint')

  return (
    <>
      {(summary || hasText) && (
        <div className="mb-3 p-3 bg-bg-elevated border border-border rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-text-muted">📝 章节摘要</p>
            <button
              type="button"
              onClick={onGenerateMemory}
              disabled={!hasText || memoryBusy}
              title="基于当前正文一次刷新摘要与连续性交接记忆"
              className="flex items-center gap-1 text-xs text-text-muted hover:text-accent disabled:opacity-50 transition-colors"
            >
              <FileText className="w-3 h-3" />
              {memoryBusy ? '生成中...' : summary ? '刷新章节记忆' : '生成章节记忆'}
            </button>
          </div>
          {summary
            ? <p className="text-sm text-text-secondary">{summary}</p>
            : <p className="text-xs text-text-muted/60">改完正文后生成章节记忆，让后续章节获得可校验的前情与交接约束。</p>}
        </div>
      )}

      {reconciliationStale && (
        <div className="mb-3 px-3 py-2 text-xs text-text-muted bg-bg-elevated border border-border rounded-lg">
          计划对账已因正文或章纲变化而失效；刷新章节记忆后再处理。
        </div>
      )}

      {reconciliation && reconciliationCurrent && (
        <div className="mb-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-amber-300">计划—正文对账</p>
            <span className="text-[10px] text-text-muted">
              {reconciliation.reviewStatus === 'pending' ? '待确认' : '已处理'}
            </span>
          </div>
          <div className="mt-2 space-y-1 text-xs text-text-secondary">
            {([
              ['已完成', reconciliation.completedGoals],
              ['未完成', reconciliation.unfinishedGoals],
              ['实际偏移', reconciliation.deviations],
              ['新增约束', reconciliation.newConstraints],
              ['下一章影响', reconciliation.nextChapterImpacts],
            ] as const).flatMap(([label, items]) => items.map((item, index) => (
              <div key={`${label}:${index}`}>
                <p><span className="text-amber-300/80">{label}：</span>{item.text}</p>
                {item.evidenceQuotes[0] && (
                  <p className="pl-3 text-[11px] text-text-muted">证据：“{item.evidenceQuotes[0].quote}”</p>
                )}
              </div>
            )))}
          </div>
          {reconciliation.reviewStatus === 'pending' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onConfirmActualProgress}
                className="px-2 py-1 text-xs rounded bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
              >
                确认并附加实际进展约束
              </button>
              {reconciliation.proposedOutlineSummary && (
                <button
                  type="button"
                  onClick={onApplyOutlineCandidate}
                  className="px-2 py-1 text-xs rounded bg-accent/10 text-accent hover:bg-accent/20"
                >
                  用候选更新本章章纲
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
