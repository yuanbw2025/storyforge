import { FileText } from 'lucide-react'
import type { ChapterPlanReconciliation } from '../../lib/types'
import ReconciliationTable, { type ReconciliationActionMap } from './ReconciliationTable'

interface Props {
  summary?: string
  hasText: boolean
  memoryBusy: boolean
  chapterId: number
  projectId: number
  chapterTitle: string
  nextChapterTitle?: string
  reconciliation?: ChapterPlanReconciliation
  reconciliationCurrent: boolean
  onGenerateMemory: () => void
  onSaveReconciliation: (actions: ReconciliationActionMap) => Promise<void>
  onForeshadowReconciliation: (item: { section: string; index: number; text: string }) => Promise<void>
}

export default function ChapterMemoryPanel({
  summary,
  hasText,
  memoryBusy,
  chapterId,
  projectId,
  chapterTitle,
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
      {/* 章节记忆（摘要 + 对账，一次生成） */}
      {(summary || hasText) && (
        <div className="mb-3 p-3 bg-bg-elevated border border-border rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-text-muted">📝 章节记忆</p>
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
            : <p className="text-xs text-text-muted/60">生成后会自动产出章节摘要、连续性交接记忆和计划-正文对账。</p>}
        </div>
      )}

      {/* Stale Reconciliation Warning */}
      {reconciliationStale && (
        <div className="mb-3 px-3 py-2 text-xs text-text-muted bg-bg-elevated border border-border rounded-lg">
          计划对账已因正文或章纲变化而失效；刷新章节记忆后再处理。
        </div>
      )}

      {/* Reconciliation Table */}
      {reconciliation && reconciliationCurrent && (
        <ReconciliationTable
          reconciliation={reconciliation}
          chapterId={chapterId}
          projectId={projectId}
          chapterTitle={chapterTitle}
          nextChapterTitle={nextChapterTitle}
          onSave={onSaveReconciliation}
          onForeshadow={onForeshadowReconciliation}
        />
      )}

      {/* Stale Reconciliation - Show Old Data with Warning */}
      {reconciliation && !reconciliationCurrent && !reconciliationStale && (
        <div className="mb-3 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
          <p className="text-xs text-orange-400 mb-2">⚠️ 对账数据已过期</p>
          <p className="text-xs text-text-muted/60 mb-3">
            对账数据可能因为正文或章纲变化而过期。建议重新生成章节记忆。
          </p>
          <button
            type="button"
            onClick={onGenerateMemory}
            disabled={memoryBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 disabled:opacity-50 transition-colors"
          >
            {memoryBusy ? (
              <>
                <div className="w-3 h-3 border-2 border-orange-400 border-t-transparent rounded-full animate-spin"></div>
                重新生成中...
              </>
            ) : (
              <>
                🔄 重新生成
              </>
            )}
          </button>
        </div>
      )}
    </>
  )
}
