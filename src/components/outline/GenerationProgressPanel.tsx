interface Props {
  visible: boolean
  stage: string
  current: number
  total: number
  chunks?: { title: string; status: 'pending' | 'generating' | 'completed' | 'error' }[]
}

export default function GenerationProgressPanel({ visible, stage, current, total, chunks }: Props) {
  if (!visible) return null

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000]">
      <div className="bg-bg-base border border-border rounded-xl shadow-xl px-6 py-4 flex items-center gap-4 min-w-[350px]">
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>
        </div>
        
        <div className="flex-1">
          <div className="text-sm font-medium text-text-primary">{stage}</div>
          <div className="text-xs text-text-muted mt-1">第 {current}/{total} 块</div>
          <div className="mt-2 h-1.5 bg-bg-hover rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${(current / total) * 100}%` }}
            />
          </div>
        </div>

        {chunks && chunks.length > 0 && (
          <div className="flex flex-col gap-1 ml-4">
            {chunks.slice(0, 5).map((chunk, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  chunk.status === 'completed' ? 'bg-success' :
                  chunk.status === 'generating' ? 'bg-accent animate-pulse' :
                  chunk.status === 'error' ? 'bg-error' :
                  'bg-bg-hover'
                }`} />
                <span className="text-xs text-text-muted">{chunk.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
