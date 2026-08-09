import { Check, GitCompareArrows, History, Trash2, X } from 'lucide-react'
import type { InspirationResultDiff } from '../../lib/inspiration/workspace'
import type {
  InspirationFragment,
  InspirationResultMode,
  InspirationVersion,
} from '../../lib/types/inspiration-workspace'

const SOURCE_LABELS = {
  author: '本人灵感',
  reference: '参考启发',
  research: '研究资料',
  other: '其他',
} as const

interface Props {
  fragments: InspirationFragment[]
  versions: InspirationVersion[]
  selectedIds: ReadonlySet<string>
  mode: InspirationResultMode
  pendingDiff: InspirationResultDiff[] | null
  confirming: boolean
  candidateDraft?: string | null
  candidateInputSummary?: string
  onCandidateChange?: (draft: string) => void
  onToggle: (fragmentId: string) => void
  onRemove: (fragmentId: string) => void
  onConfirm: () => void
  onDiscard: () => void
}

export default function InspirationFusionReview({
  fragments,
  versions,
  selectedIds,
  mode,
  pendingDiff,
  confirming,
  candidateDraft = null,
  candidateInputSummary,
  onCandidateChange,
  onToggle,
  onRemove,
  onConfirm,
  onDiscard,
}: Props) {
  const modeVersions = versions.filter(version => version.mode === mode)

  return (
    <section className="space-y-3 rounded-lg border border-border bg-bg-surface p-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-text-primary">增量灵感库</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            勾选本次参与融合的碎片；未勾选内容不会发给 AI。
          </p>
        </div>
        <span className="flex items-center gap-1 text-xs text-text-muted">
          <History className="h-3.5 w-3.5" />
          {modeVersions.length} 个已确认版本
        </span>
      </div>

      {fragments.length === 0 ? (
        <p className="rounded bg-bg-elevated px-3 py-2 text-xs text-text-muted">
          还没有已保存碎片。填写上方内容后点“加入素材库”，也可以直接开始反推，系统会先保存本次输入。
        </p>
      ) : (
        <div className="max-h-56 space-y-1.5 overflow-y-auto">
          {fragments.map(fragment => {
            const referenced = versions.some(version => version.fragmentIds.includes(fragment.id))
            return (
            <div
              key={fragment.id}
              className={`flex items-start gap-2 rounded border px-2.5 py-2 ${
                selectedIds.has(fragment.id) ? 'border-accent/50 bg-accent/5' : 'border-border bg-bg-base'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(fragment.id)}
                onChange={() => onToggle(fragment.id)}
                className="mt-0.5 accent-accent"
                aria-label={`选择灵感碎片 ${fragment.label || fragment.text.slice(0, 20)}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px] text-text-muted">
                  <span className="rounded bg-bg-elevated px-1.5 py-0.5">
                    {SOURCE_LABELS[fragment.sourceKind]}
                  </span>
                  {fragment.label && <span className="truncate">{fragment.label}</span>}
                  <time className="ml-auto shrink-0">
                    {new Date(fragment.createdAt).toLocaleString()}
                  </time>
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-text-secondary">
                  {fragment.text}
                </p>
              </div>
              <button
                onClick={() => onRemove(fragment.id)}
                disabled={referenced}
                className="shrink-0 p-1 text-text-muted hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                title={referenced
                  ? '该碎片已被确认版本引用；可取消勾选，但不能删除来源证据'
                  : '从素材库移除'}
                aria-label="移除灵感碎片"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            )
          })}
        </div>
      )}

      {(candidateDraft != null || pendingDiff !== null) && (
        <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-amber-400">
            <GitCompareArrows className="h-4 w-4" />
            待确认的融合版本
          </div>
          <p className="text-xs text-text-muted">
            候选尚未写入版本历史，也不能采纳到项目。你可以先编辑结构化 JSON，再检查差异。
          </p>
          {candidateInputSummary && (
            <p className="text-[11px] text-text-muted">{candidateInputSummary}</p>
          )}
          {candidateDraft != null && (
            <textarea
              aria-label="灵感反推候选内容"
              value={candidateDraft}
              onChange={event => onCandidateChange?.(event.target.value)}
              disabled={confirming}
              className="min-h-64 w-full resize-y rounded border border-border bg-bg-base px-2.5 py-2 font-mono text-[11px] leading-5 text-text-primary"
            />
          )}
          {pendingDiff === null ? (
            <p className="text-xs text-red-400">候选当前不是有效结构，修正 JSON 后才能确认。</p>
          ) : pendingDiff.length === 0 ? (
            <p className="text-xs text-text-secondary">与当前版本没有字段差异。</p>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {pendingDiff.map(diff => (
                <div key={diff.path} className="rounded border border-border bg-bg-base p-2 text-xs">
                  <div className="mb-1 font-mono text-[11px] text-accent">{diff.path}</div>
                  <div className="grid gap-1 md:grid-cols-2">
                    <div className="rounded bg-red-500/5 p-1.5 text-text-muted">
                      <span className="mb-0.5 block text-[10px] text-red-400">上一版</span>
                      {diff.before || '（无）'}
                    </div>
                    <div className="rounded bg-green-500/5 p-1.5 text-text-secondary">
                      <span className="mb-0.5 block text-[10px] text-green-400">新版本</span>
                      {diff.after || '（删除）'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={onConfirm}
              disabled={confirming || pendingDiff === null}
              className="flex items-center gap-1 rounded bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700 disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              {confirming ? '保存中...' : '确认融合版本'}
            </button>
            <button
              onClick={onDiscard}
              disabled={confirming}
              className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" />
              放弃本次结果
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
