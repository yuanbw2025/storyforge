import { Check, X } from 'lucide-react'

export default function OutlinePreviewPanel({
  label,
  items,
  onConfirm,
  onCancel,
}: {
  label: string
  items: { title: string; summary: string }[]
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="border border-accent/50 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-accent/10">
        <span className="text-sm font-medium text-accent">{label}</span>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-primary rounded transition-colors">
            <X className="w-3 h-3" /> 取消
          </button>
          <button onClick={onConfirm}
            className="flex items-center gap-1 px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover transition-colors">
            <Check className="w-3 h-3" /> 确认写入
          </button>
        </div>
      </div>
      <div className="divide-y divide-border max-h-60 overflow-y-auto">
        {items.map((item, index) => (
          <div key={`${item.title}:${index}`} className="px-3 py-2 bg-bg-surface">
            <div className="text-sm font-medium text-text-primary">{item.title}</div>
            {item.summary && (
              <div className="text-xs text-text-muted mt-1 line-clamp-2">{item.summary}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
