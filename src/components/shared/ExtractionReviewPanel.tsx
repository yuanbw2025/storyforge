import { Check, Loader2, Sparkles, X } from 'lucide-react'

interface Props<T> {
  title: string
  items: T[]
  selected: Set<number>
  loading?: boolean
  busy?: boolean
  selectionLocked?: boolean
  closeDisabled?: boolean
  allowEmptyConfirm?: boolean
  confirmLabel?: string
  error?: string | null
  renderItem: (item: T) => React.ReactNode
  onToggle: (index: number) => void
  onConfirm: () => void
  onClose: () => void
}

export default function ExtractionReviewPanel<T>({
  title, items, selected, loading, busy, selectionLocked, closeDisabled, allowEmptyConfirm, confirmLabel,
  error, renderItem, onToggle, onConfirm, onClose,
}: Props<T>) {
  return (
    <div className="mt-3 rounded-xl border border-accent/30 bg-bg-surface p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" /> {title}
        </h3>
        <button
          onClick={onClose}
          disabled={busy || closeDisabled}
          className="p-1 text-text-muted hover:text-text-primary disabled:opacity-40"
          title="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> AI 正在分析并整理候选项…
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="text-xs text-text-muted">没有发现可写入的新内容。</p>
      )}
      {(items.length > 0 || (!loading && !error && allowEmptyConfirm)) && (
        <>
          <div className="max-h-72 overflow-y-auto space-y-2">
            {items.map((item, index) => (
              <label
                key={index}
                className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer ${
                  selected.has(index) ? 'border-accent/40 bg-accent/5' : 'border-border'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(index)}
                  disabled={busy || selectionLocked}
                  onChange={() => onToggle(index)}
                  className="mt-0.5 accent-accent"
                />
                <div className="min-w-0 flex-1">{renderItem(item)}</div>
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              onClick={onConfirm}
              disabled={(!allowEmptyConfirm && selected.size === 0) || busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs disabled:opacity-40"
            >
              {busy
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Check className="w-3.5 h-3.5" />}
              {busy ? '正在写入并终验…' : (confirmLabel ?? `确认写入（${selected.size}）`)}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
