import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, Clock } from 'lucide-react'
import { useHistoryStore } from '../../stores/history'
import type { Project, HistoricalEvent } from '../../lib/types'
import { nanoid } from '../../lib/utils/id'

interface Props {
  project: Project
}

export default function HistoryPanel({ project }: Props) {
  const { history, loadAll, save } = useHistoryStore()
  const [overview, setOverview] = useState('')
  const [eraSystem, setEraSystem] = useState('')
  const [events, setEvents] = useState<HistoricalEvent[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    loadAll(project.id!)
  }, [project.id, loadAll])

  useEffect(() => {
    if (history) {
      setOverview(history.overview || '')
      setEraSystem(history.eraSystem || '')
      try {
        setEvents(JSON.parse(history.events || '[]'))
      } catch {
        setEvents([])
      }
    }
  }, [history])

  const saveEvents = useCallback(async (newEvents: HistoricalEvent[]) => {
    setEvents(newEvents)
    await save({
      projectId: project.id!,
      events: JSON.stringify(newEvents),
    })
  }, [project.id, save])

  const handleSaveOverview = async () => {
    await save({ projectId: project.id!, overview })
  }

  const handleSaveEraSystem = async () => {
    await save({ projectId: project.id!, eraSystem })
  }

  const handleAddEvent = () => {
    const newEvent: HistoricalEvent = {
      id: nanoid(),
      era: '',
      date: '',
      title: '新事件',
      description: '',
      impact: '',
      order: events.length,
    }
    const updated = [...events, newEvent]
    setExpandedId(newEvent.id)
    saveEvents(updated)
  }

  const handleUpdateEvent = (id: string, data: Partial<HistoricalEvent>) => {
    const updated = events.map(e => e.id === id ? { ...e, ...data } : e)
    saveEvents(updated)
  }

  const handleDeleteEvent = (id: string) => {
    const updated = events.filter(e => e.id !== id)
    saveEvents(updated)
  }

  const handleMoveEvent = (id: string, direction: 'up' | 'down') => {
    const idx = events.findIndex(e => e.id === id)
    if (idx < 0) return
    const target = direction === 'up' ? idx - 1 : idx + 1
    if (target < 0 || target >= events.length) return
    const updated = [...events]
    ;[updated[idx], updated[target]] = [updated[target], updated[idx]]
    updated.forEach((e, i) => (e.order = i))
    saveEvents(updated)
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold text-text-primary mb-4">📜 历史年表</h2>

      {/* 历史总述 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-text-secondary mb-1">历史总述</label>
        <textarea
          value={overview}
          onChange={e => setOverview(e.target.value)}
          onBlur={handleSaveOverview}
          placeholder="描述这个世界的整体历史脉络、重大转折、文明兴衰等..."
          className="w-full h-28 p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />
      </div>

      {/* 纪年体系 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-text-secondary mb-1">纪年体系</label>
        <textarea
          value={eraSystem}
          onChange={e => setEraSystem(e.target.value)}
          onBlur={handleSaveEraSystem}
          placeholder="描述这个世界的纪年方式，如：太古纪→上古纪→中古纪→近古纪→当代..."
          className="w-full h-20 p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />
      </div>

      {/* 事件列表 */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-text-primary">历史事件 ({events.length})</h3>
        <button
          onClick={handleAddEvent}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          添加事件
        </button>
      </div>

      <div className="space-y-2">
        {events.length === 0 ? (
          <p className="text-text-muted text-sm py-8 text-center">暂无历史事件，点击上方按钮添加</p>
        ) : (
          events.map((evt, idx) => {
            const isExpanded = expandedId === evt.id
            return (
              <div key={evt.id} className="border border-border rounded-lg bg-bg-surface overflow-hidden">
                {/* 头部 */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : evt.id)}
                  className="w-full flex items-center gap-2 px-4 py-3 hover:bg-bg-hover transition-colors"
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
                  <Clock className="w-4 h-4 text-accent" />
                  <span className="text-sm font-medium text-text-primary flex-1 text-left">{evt.title}</span>
                  {evt.era && (
                    <span className="text-xs text-text-muted bg-bg-elevated px-2 py-0.5 rounded">{evt.era}</span>
                  )}
                  {evt.date && (
                    <span className="text-xs text-text-muted">{evt.date}</span>
                  )}
                </button>

                {/* 展开编辑 */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-text-muted mb-1">事件名称</label>
                        <input
                          value={evt.title}
                          onChange={e => handleUpdateEvent(evt.id, { title: e.target.value })}
                          className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">所属纪元</label>
                        <input
                          value={evt.era}
                          onChange={e => handleUpdateEvent(evt.id, { era: e.target.value })}
                          placeholder="如：上古纪"
                          className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-muted mb-1">具体时间</label>
                        <input
                          value={evt.date}
                          onChange={e => handleUpdateEvent(evt.id, { date: e.target.value })}
                          placeholder="如：太古历3000年"
                          className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">事件描述</label>
                      <textarea
                        value={evt.description}
                        onChange={e => handleUpdateEvent(evt.id, { description: e.target.value })}
                        className="w-full h-20 p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">对世界的影响</label>
                      <textarea
                        value={evt.impact}
                        onChange={e => handleUpdateEvent(evt.id, { impact: e.target.value })}
                        className="w-full h-16 p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleMoveEvent(evt.id, 'up')}
                          disabled={idx === 0}
                          className="px-2 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
                        >
                          ↑ 上移
                        </button>
                        <button
                          onClick={() => handleMoveEvent(evt.id, 'down')}
                          disabled={idx === events.length - 1}
                          className="px-2 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
                        >
                          ↓ 下移
                        </button>
                      </div>
                      <button
                        onClick={() => handleDeleteEvent(evt.id)}
                        className="flex items-center gap-1 px-3 py-1.5 text-red-400 hover:bg-red-500/10 text-xs rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        删除事件
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
