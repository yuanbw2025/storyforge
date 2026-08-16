import type { ChunkConfig, DeviationAnalysis } from '../../lib/ai/chunked-chapter-generator'
import type { ParsedChapter } from '../../lib/ai/parse-outline-output'

interface ChunkPreviewItem {
  chunk: ChunkConfig
  chapters: ParsedChapter[]
  deviation?: DeviationAnalysis
}

interface Props {
  chunks: ChunkPreviewItem[]
  onRegenerateChunk?: (index: number) => void
  onAutoAdjustChunk?: (index: number) => void
}

const TONE_COLORS: Record<string, string> = {
  '平静': 'bg-blue-500',
  '紧张': 'bg-orange-500',
  '高潮': 'bg-red-500',
  '低落': 'bg-gray-500',
  '转折': 'bg-purple-500',
}

const PACE_LABELS: Record<string, string> = {
  '慢': '慢',
  '中': '中',
  '快': '快',
  '极快': '极快',
}

export default function ChunkPreviewPanel({ chunks, onRegenerateChunk, onAutoAdjustChunk }: Props) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-text-primary">分块预览</div>
      
      {chunks.map((item, idx) => {
        const hasDeviation = item.deviation && item.deviation.score > 30
        const isSevere = item.deviation && item.deviation.score > 60
        
        return (
          <div
            key={idx}
            className={`rounded-lg border p-3 ${
              isSevere ? 'border-error bg-error/5' :
              hasDeviation ? 'border-warning bg-warning/5' :
              'border-border bg-bg-elevated'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-primary">{item.chunk.title}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] text-white ${TONE_COLORS[item.chunk.emotionalTone] || 'bg-gray-500'}`}>
                  {item.chunk.emotionalTone}
                </span>
                <span className="text-[10px] text-text-muted">
                  {PACE_LABELS[item.chunk.pace]}节奏
                </span>
              </div>
              
              {hasDeviation && (
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${isSevere ? 'text-error' : 'text-warning'}`}>
                    偏离度 {item.deviation!.score}%
                  </span>
                  {isSevere && onAutoAdjustChunk && (
                    <button
                      onClick={() => onAutoAdjustChunk(idx)}
                      className="px-2 py-0.5 text-[10px] bg-accent text-white rounded hover:bg-accent/80"
                    >
                      自动调整
                    </button>
                  )}
                  {onRegenerateChunk && (
                    <button
                      onClick={() => onRegenerateChunk(idx)}
                      className="px-2 py-0.5 text-[10px] border border-border rounded hover:bg-bg-hover"
                    >
                      重新生成
                    </button>
                  )}
                </div>
              )}
            </div>
            
            {hasDeviation && item.deviation && (
              <div className="mb-2 text-[10px] text-text-muted space-y-1">
                {item.deviation.warnings.slice(0, 3).map((warning, i) => (
                  <div key={i} className="flex items-start gap-1">
                    <span className="text-error">●</span>
                    <span>{warning}</span>
                  </div>
                ))}
                {item.deviation.suggestions.length > 0 && (
                  <div className="flex items-start gap-1">
                    <span className="text-accent">○</span>
                    <span>建议：{item.deviation.suggestions[0]}</span>
                  </div>
                )}
              </div>
            )}
            
            <div className="space-y-1">
              {item.chapters.map((ch, chIdx) => (
                <div
                  key={chIdx}
                  className="text-xs text-text-secondary truncate"
                  title={ch.summary}
                >
                  {item.chunk.startChapter + chIdx}. {ch.title}：{ch.summary}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
