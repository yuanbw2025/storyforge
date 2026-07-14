import type { PreparedGenerationContext, OutlineGenerationRequest } from './outline-generation'
import OutlineGenerationBasis from './OutlineGenerationBasis'

interface Props {
  request: OutlineGenerationRequest
  preparedContext: PreparedGenerationContext | null
  loading: boolean
  error: string
  onRetry: () => void
  onCancel: () => void
  onConfirm: () => void
}

function requestTitle(request: OutlineGenerationRequest): string {
  if (request.kind === 'volumes') return '批量生成卷级大纲'
  if (request.kind === 'chapters') return '生成本卷所有章节'
  if (request.kind === 'single-volume') return 'AI 生成本卷卷纲'
  return 'AI 生成本章章纲'
}

export default function OutlineGenerationRequestPanel({
  request,
  preparedContext,
  loading,
  error,
  onRetry,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <div className="space-y-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="text-xs leading-5 text-text-secondary">
          <span className="font-medium text-text-primary">{requestTitle(request)}</span>
          <span className="ml-2">
            {request.kind === 'single-chapter'
              ? '单章补全固定只生成当前 1 章；上方“本卷章节数”不参与本次调用。确认后才会调用 API。'
              : '请先调整上方参数，确认后才会调用 API。'}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {error && (
            <button
              onClick={onRetry}
              className="px-2.5 py-1 text-xs text-accent border border-accent/30 rounded hover:bg-accent/10"
            >
              重新读取
            </button>
          )}
          <button
            onClick={onCancel}
            className="px-2.5 py-1 text-xs text-text-muted border border-border rounded hover:text-text-primary"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || Boolean(error) || !preparedContext}
            className="px-2.5 py-1 text-xs text-white bg-accent rounded hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            确认生成
          </button>
        </div>
      </div>
      <div className="border-t border-accent/20 pt-3">
        <OutlineGenerationBasis
          context={preparedContext?.assembled ?? null}
          loading={loading}
          error={error}
        />
      </div>
    </div>
  )
}
