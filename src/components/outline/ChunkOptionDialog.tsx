import type { ChunkConfig, ChunkOption } from '../../lib/ai/chunked-chapter-generator'

interface Props {
  chunk: ChunkConfig
  options: ChunkOption[]
  onSelect: (option: ChunkOption) => void
  onCancel: () => void
}

export default function ChunkOptionDialog({ chunk, options, onSelect, onCancel }: Props) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000] p-4">
      <div className="bg-bg-base rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-hidden border border-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              选择剧情走向 — {chunk.title}
            </h2>
            <p className="text-sm text-text-muted mt-1">
              本块章节范围：第{chunk.startChapter}-{chunk.endChapter}章 · 情绪基调：{chunk.emotionalTone} · 节奏：{chunk.pace}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-bg-hover rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
          <div className="grid gap-4">
            {options.map((option, index) => (
              <div
                key={option.id}
                onClick={() => onSelect(option)}
                className="border border-border rounded-lg p-4 cursor-pointer hover:border-accent hover:bg-accent/5 transition-all group"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center font-medium text-sm">
                      {index + 1}
                    </span>
                    <span className="font-medium text-text-primary">{option.description}</span>
                  </div>
                  <div className={`px-2 py-1 rounded text-xs font-medium ${
                    option.deviation.score <= 30 ? 'bg-success/10 text-success' :
                    option.deviation.score <= 60 ? 'bg-warning/10 text-warning' :
                    'bg-error/10 text-error'
                  }`}>
                    偏离度 {option.deviation.score}%
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded bg-accent/10 text-accent text-xs flex items-center justify-center flex-shrink-0 mt-0.5">起</span>
                    <p className="text-sm text-text-secondary whitespace-pre-wrap">
                      {option.chapters[0]?.summary || '暂无描述'}
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded bg-accent/10 text-accent text-xs flex items-center justify-center flex-shrink-0 mt-0.5">承</span>
                    <p className="text-sm text-text-secondary whitespace-pre-wrap">
                      {option.chapters[Math.floor(option.chapters.length / 2)]?.summary || '暂无描述'}
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded bg-accent/10 text-accent text-xs flex items-center justify-center flex-shrink-0 mt-0.5">转</span>
                    <p className="text-sm text-text-secondary whitespace-pre-wrap">
                      {option.chapters[option.chapters.length - 1]?.summary || '暂无描述'}
                    </p>
                  </div>
                  <div className="text-xs text-text-muted">
                    共 {option.chapters.length} 章
                  </div>
                </div>

                {option.deviation.warnings.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <div className="text-xs text-warning">
                      <span className="font-medium">⚠️ 检测到偏离：</span>
                      {option.deviation.warnings.slice(0, 2).join('；')}
                      {option.deviation.warnings.length > 2 && `等 ${option.deviation.warnings.length} 项`}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-elevated">
          <p className="text-sm text-text-muted">
            选择后将继续生成下一块章节
          </p>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-text-secondary border border-border rounded-lg hover:bg-bg-hover transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
