import type { MasterStyleMetrics } from '../../lib/types/master-study'

interface Props {
  metrics: MasterStyleMetrics
}

export default function MasterStyleCard({ metrics }: Props) {
  const maxBucket = Math.max(...Object.values(metrics.sentenceLengthHistogram), 1)

  return (
    <div className="rounded-2xl border border-border bg-bg-surface p-5 space-y-5">
      <h3 className="text-base font-semibold text-text-primary">
        风格量化画像
      </h3>

      {/* 数字概览 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox
          label="平均句长"
          value={`${metrics.avgSentenceLength.toFixed(1)} 字`}
        />
        <StatBox
          label="对话占比"
          value={`${(metrics.dialogRatio * 100).toFixed(0)}%`}
        />
        <StatBox
          label="段落密度"
          value={`${metrics.paragraphDensity.toFixed(1)} 段/千字`}
        />
        {metrics.descriptionRatio != null && (
          <StatBox
            label="描写占比"
            value={`${(metrics.descriptionRatio * 100).toFixed(0)}%`}
          />
        )}
      </div>

      {/* 句长直方图 */}
      <div>
        <h4 className="text-xs font-medium text-text-secondary mb-2">句长分布</h4>
        <div className="flex items-end gap-1.5 h-24">
          {Object.entries(metrics.sentenceLengthHistogram).map(([bucket, count]) => {
            const pct = (count / maxBucket) * 100
            return (
              <div key={bucket} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full relative" style={{ height: '80px' }}>
                  <div
                    className="absolute bottom-0 w-full bg-accent/70 rounded-t transition-all"
                    style={{ height: `${Math.max(pct, 2)}%` }}
                  />
                </div>
                <span className="text-[9px] text-text-muted whitespace-nowrap">{bucket}</span>
                <span className="text-[10px] text-text-secondary">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* 高频词 Top 50 */}
      {metrics.topWords.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-text-secondary mb-2">
            高频词 Top {Math.min(metrics.topWords.length, 50)}
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {metrics.topWords.slice(0, 50).map((w, i) => {
              const opacity = Math.max(0.4, 1 - i * 0.012)
              return (
                <span
                  key={`${w.word}-${i}`}
                  className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs"
                  style={{ opacity }}
                >
                  {w.word}
                  <span className="text-[10px] text-accent/60">×{w.count}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-bg-base px-3 py-2 text-center">
      <div className="text-lg font-semibold text-text-primary">{value}</div>
      <div className="text-[11px] text-text-muted">{label}</div>
    </div>
  )
}
