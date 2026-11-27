import { useForeshadowStore } from '../../stores/foreshadow'
import type { Foreshadow, ForeshadowStatus, ForeshadowType, WorkspaceScope } from '../../lib/types'
import { useState } from 'react'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'

const STATUS_COLUMNS: { key: ForeshadowStatus; label: string; dot: string; accent: string; border: string }[] = [
  { key: 'planned', label: '已计划', dot: 'bg-text-muted', accent: 'text-text-primary', border: 'border-l-border' },
  { key: 'planted', label: '已埋设', dot: 'bg-error', accent: 'text-text-primary', border: 'border-l-error' },
  { key: 'echoed', label: '已呼应', dot: 'bg-warning', accent: 'text-text-primary', border: 'border-l-warning' },
  { key: 'resolved', label: '已回收', dot: 'bg-success', accent: 'text-text-primary', border: 'border-l-success' },
]

const TYPE_EMOJI: Record<ForeshadowType, string> = {
  chekhov: '🔫', prophecy: '🔮', symbol: '🎭', character: '👤',
  dialogue: '💬', environment: '🌿', timeline: '⏰',
  'red-herring': '🐟', parallel: '🔄', callback: '↩️',
}

interface Props {
  onSelectForeshadow: (id: number) => void
  scope?: WorkspaceScope
}

export default function ForeshadowKanban({ onSelectForeshadow, scope }: Props) {
  const { foreshadows, updateStatus, loadedScope } = useForeshadowStore()
  const [error, setError] = useState('')
  const persistStatus = async (f: Foreshadow, status: ForeshadowStatus) => {
    try {
      await flushPendingEditsV1()
      await updateStatus(f.id!, status, { scope: scope ?? loadedScope ?? undefined, expected: { status: f.status } })
      setError('')
    } catch (error) { setError(error instanceof Error ? error.message : '伏笔状态未保存，请重试。') }
  }

  const getColumnItems = (status: ForeshadowStatus) =>
    foreshadows.filter(f => f.status === status && (!scope || (f.projectId === scope.projectId && Reflect.get(f, 'workId') === scope.workId)))

  const handleAdvance = (f: Foreshadow) => {
    const flow: ForeshadowStatus[] = ['planned', 'planted', 'echoed', 'resolved']
    const idx = flow.indexOf(f.status)
    if (idx < flow.length - 1 && f.id) {
      void persistStatus(f, flow[idx + 1])
    }
  }

  const handleRevert = (f: Foreshadow) => {
    const flow: ForeshadowStatus[] = ['planned', 'planted', 'echoed', 'resolved']
    const idx = flow.indexOf(f.status)
    if (idx > 0 && f.id) {
      void persistStatus(f, flow[idx - 1])
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 pb-4 md:grid-cols-2 xl:grid-cols-4">
      {error && <p role="alert" className="col-span-full text-sm text-error">{error}</p>}
      {STATUS_COLUMNS.map(col => {
        const items = getColumnItems(col.key)
        return (
          <div key={col.key} className="min-w-0 overflow-hidden rounded-xl border border-border bg-bg-surface/70 shadow-theme-sm">
            {/* 列标题 */}
            <div className="flex items-center justify-between border-b border-border bg-bg-elevated/60 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
                <span className={`text-sm font-semibold ${col.accent}`}>{col.label}</span>
              </div>
              <span className="rounded-full bg-bg-base px-2 py-0.5 text-xs text-text-muted">
                {items.length}
              </span>
            </div>

            {/* 卡片列表 */}
            <div className="min-h-[520px] space-y-3 px-3 py-4">
              {items.length === 0 ? (
                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-text-muted/50">
                  暂无伏笔
                </div>
              ) : (
                items.map(f => (
                  <div
                    key={f.id}
                    className={`group cursor-pointer rounded-lg border border-border border-l-2 ${col.border} bg-bg-elevated p-4 shadow-theme-sm transition hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-theme-md`}
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
