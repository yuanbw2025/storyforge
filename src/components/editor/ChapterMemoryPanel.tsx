import { FileText } from 'lucide-react'
import type { ChapterPlanReconciliation } from '../../lib/types'
import ReconciliationTable, { type ReconciliationActionMap } from './ReconciliationTable'

interface Props {
  summary?: string
  hasText: boolean
  memoryBusy: boolean
  chapterTitle?: string
  nextChapterTitle?: string
  reconciliation?: ChapterPlanReconciliation
  reconciliationCurrent: boolean
  onGenerateMemory: () => void
  onSaveReconciliation?: (actions: ReconciliationActionMap) => Promise<void>
  onForeshadowReconciliation?: (item: { section: string; index: number; text: string }) => Promise<void>
}

export default function ChapterMemoryPanel({
  summary,
  hasText,
  memoryBusy,
  chapterTitle = '',
  nextChapterTitle,
  reconciliation,
  reconciliationCurrent,
  onGenerateMemory,
  onSaveReconciliation,
  onForeshadowReconciliation,
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
              title="一次生成章节摘要、连续性交接记忆、计划-正文对账"
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

      {/* Stale Reconciliation Warning */}
      {reconciliationStale && (
        <div className="mb-3 px-3 py-2 text-xs text-text-muted bg-bg-elevated border border-border rounded-lg">
          计划对账已因正文或章纲变化而失效；刷新章节记忆后再处理。
        </div>
      )}

      {/* 新逐条对账契约；已处理历史仅供回看，不再作为当前下游约束。 */}
      {reconciliation && onSaveReconciliation && onForeshadowReconciliation && (
        reconciliationCurrent
        || reconciliation.reviewStatus === 'applied-outline'
        || reconciliation.reviewStatus === 'dismissed'
      ) && (
        <div className="mb-3 space-y-2">
          {!reconciliationCurrent && (
            <p className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-300">
              这是已经处理的历史对账记录，不再作为当前下游约束；如正文或章纲已经变化，请重新生成章节记忆。
            </p>
          )}
          <ReconciliationTable
            reconciliation={reconciliation}
            chapterTitle={chapterTitle}
            nextChapterTitle={nextChapterTitle}
            onSave={onSaveReconciliation}
            onForeshadow={onForeshadowReconciliation}
          />
        </div>
      )}

    </>
  )
}
