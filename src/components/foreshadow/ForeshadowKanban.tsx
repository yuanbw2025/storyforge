import { useForeshadowStore } from '../../stores/foreshadow'
import type { Foreshadow, ForeshadowStatus, ForeshadowType } from '../../lib/types'

const STATUS_COLUMNS: { key: ForeshadowStatus; label: string; emoji: string; color: string; bgColor: string }[] = [
  { key: 'planned', label: '计划中', emoji: '📋', color: 'text-text-muted', bgColor: 'border-gray-500/30' },
  { key: 'planted', label: '已埋设', emoji: '🌱', color: 'text-yellow-400', bgColor: 'border-yellow-500/30' },
  { key: 'echoed', label: '已呼应', emoji: '🔔', color: 'text-blue-400', bgColor: 'border-blue-500/30' },
  { key: 'resolved', label: '已回收', emoji: '✅', color: 'text-green-400', bgColor: 'border-green-500/30' },
]

const TYPE_EMOJI: Record<ForeshadowType, string> = {
  chekhov: '🔫', prophecy: '🔮', symbol: '🎭', character: '👤',
  dialogue: '💬', environment: '🌿', timeline: '⏰',
  'red-herring': '🐟', parallel: '🔄', callback: '↩️',
}

interface Props {
  onSelectForeshadow: (id: number) => void
}

export default function ForeshadowKanban({ onSelectForeshadow }: Props) {
  const { foreshadows, updateStatus } = useForeshadowStore()

  const getColumnItems = (status: ForeshadowStatus) =>
    foreshadows.filter(f => f.status === status)

  const handleAdvance = (f: Foreshadow) => {
    const flow: ForeshadowStatus[] = ['planned', 'planted', 'echoed', 'resolved']
    const idx = flow.indexOf(f.status)
    if (idx < flow.length - 1 && f.id) {
      updateStatus(f.id, flow[idx + 1])
    }
  }

  const handleRevert = (f: Foreshadow) => {
    const flow: ForeshadowStatus[] = ['planned', 'planted', 'echoed', 'resolved']
    const idx = flow.indexOf(f.status)
    if (idx > 0 && f.id) {
      updateStatus(f.id, flow[idx - 1])
    }
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {STATUS_COLUMNS.map(col => {
        const items = getColumnItems(col.key)
        return (
          <div key={col.key} className={`w-64 shrink-0 border-t-2 ${col.bgColor} rounded-lg`}>
            {/* 列标题 */}
            <div className="px-3 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">{col.emoji}</span>
                <span className={`text-sm font-semibold ${col.color}`}>{col.label}</span>
              </div>
              <span className="text-xs text-text-muted bg-bg-elevated px-1.5 py-0.5 rounded-full">
                {items.length}
              </span>
            </div>

            {/* 卡片列表 */}
            <div className="px-2 pb-2 space-y-2 min-h-[200px]">
              {items.length === 0 ? (
                <div className="text-center py-8 text-text-muted/40 text-xs">
                  暂无伏笔
                </div>
              ) : (
                items.map(f => (
                  <div
                    key={f.id}
                    className="bg-bg-surface border border-border rounded-lg p-3 hover:border-accent/30 transition cursor-pointer group"
                    onClick={() => onSelectForeshadow(f.id!)}
                  >
                    {/* 卡片标题 */}
                    <div className="flex items-start gap-2 mb-1.5">
                      <span className="text-sm shrink-0">{TYPE_EMOJI[f.type]}</span>
                      <span className="text-sm font-medium text-text-primary truncate">
                        {f.name}
                      </span>
                    </div>

                    {/* 描述 */}
                    {f.description && (
                      <p className="text-xs text-text-muted line-clamp-2 mb-2">
                        {f.description}
                      </p>
                    )}

                    {/* 操作按钮 */}
                    <div className="flex items-center justify-between opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRevert(f) }}
                        disabled={f.status === 'planned'}
                        className="text-xs text-text-muted hover:text-text-primary disabled:opacity-20 disabled:cursor-default"
                        title="回退状态"
                      >
                        ← 回退
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAdvance(f) }}
                        disabled={f.status === 'resolved'}
                        className="text-xs text-accent hover:text-accent-hover disabled:opacity-20 disabled:cursor-default"
                        title="推进状态"
                      >
                        推进 →
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
