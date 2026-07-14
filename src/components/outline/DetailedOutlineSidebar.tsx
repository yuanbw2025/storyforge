import { ChevronRight, Square, Zap } from 'lucide-react'
import type { BatchProgress } from '../../lib/ai/batch-detail-runner'
import type { DetailedOutline, OutlineNode } from '../../lib/types'

interface Props {
  chapters: OutlineNode[]
  detailedOutlines: DetailedOutline[]
  selectedNodeId: number | null
  batchProgress: BatchProgress | null
  onSelect: (nodeId: number) => void
  onBatchStart: () => void
  onBatchStop: () => void
}

export default function DetailedOutlineSidebar({
  chapters,
  detailedOutlines,
  selectedNodeId,
  batchProgress,
  onSelect,
  onBatchStart,
  onBatchStop,
}: Props) {
  const detailedNodeIds = new Set(detailedOutlines.map(detail => detail.outlineNodeId))

  return (
    <div className="w-64 flex-shrink-0 border-r border-border overflow-y-auto p-3">
      <h3 className="text-sm font-semibold text-text-primary mb-2 px-2">📖 选择章节</h3>
      {chapters.length === 0 ? (
        <div className="text-xs text-text-muted px-2 py-4">还没有章节节点。先去「大纲」里建几章。</div>
      ) : (
        <div className="space-y-0.5">
          {chapters.map(chapter => (
            <button
              key={chapter.id}
              onClick={() => { if (chapter.id != null) onSelect(chapter.id) }}
              aria-pressed={selectedNodeId === chapter.id}
              className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-sm rounded transition-colors ${
                selectedNodeId === chapter.id
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <ChevronRight className="w-3 h-3 flex-shrink-0" />
              <span className="truncate flex-1">{chapter.title}</span>
              {chapter.id != null && detailedNodeIds.has(chapter.id) && (
                <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" title="有细纲" />
              )}
            </button>
          ))}
        </div>
      )}

      {chapters.length > 0 && (
        <div className="mt-3 px-2 space-y-2">
          {!batchProgress ? (
            <button
              onClick={onBatchStart}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-accent/10 text-accent text-xs rounded hover:bg-accent/20"
            >
              <Zap className="w-3.5 h-3.5" /> 批量生成细纲
            </button>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <div className="flex-1 h-1.5 bg-bg-base rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all"
                    style={{ width: `${Math.round((batchProgress.completed / batchProgress.total) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-text-muted whitespace-nowrap">
                  {batchProgress.completed}/{batchProgress.total}
                </span>
                <button onClick={onBatchStop} className="p-0.5 text-error hover:text-error/80" title="停止">
                  <Square className="w-3 h-3" />
                </button>
              </div>
              <p className="text-[10px] text-text-muted truncate">{batchProgress.stage}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
