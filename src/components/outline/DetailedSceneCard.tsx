import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DetailedScene, ScenePace } from '../../lib/types'
import { DETAILED_SCENE_TASK_FIELDS } from '../../lib/types/detailed-outline'
import { registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'

const PACE_LABELS: Record<ScenePace, string> = {
  slow: '🐢 慢',
  medium: '🚶 中',
  fast: '🏃 快',
  climax: '⚡ 高潮',
}

const PACE_COLORS: Record<ScenePace, string> = {
  slow: 'bg-info/10 text-info',
  medium: 'bg-text-muted/10 text-text-secondary',
  fast: 'bg-warning/10 text-warning',
  climax: 'bg-error/10 text-error',
}

interface Props {
  scene: DetailedScene
  index: number
  onUpdate: (patch: Partial<DetailedScene>) => void | Promise<void>
  onDelete: () => void
}

export default function DetailedSceneCard({ scene: persisted, index, onUpdate, onDelete }: Props) {
  const [scene, setScene] = useState(persisted)
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const lastRead = useRef(persisted)
  const writes = useRef(new Set<Promise<void>>())
  const failed = useRef<string | null>(null)
  useEffect(() => registerPendingDraftFlusherV1(async () => {
    await Promise.all([...writes.current])
    if (failed.current) throw new Error(failed.current)
  }), [])
  useEffect(() => {
    if (pending || error || lastRead.current === persisted) return
    lastRead.current = persisted
    setScene(persisted)
  }, [persisted, pending, error])
  const update = (patch: Partial<DetailedScene>, retry = false) => {
    setScene(current => ({ ...current, ...patch }))
    setPending(count => count + 1)
    let operation: Promise<void>
    try { operation = Promise.resolve(onUpdate(patch)) }
    catch (reason) { operation = Promise.reject(reason) }
    writes.current.add(operation)
    void operation.then(() => {
      if (retry) { failed.current = null; setError(null) }
    }).catch(reason => {
      failed.current = reason instanceof Error ? reason.message : '场景保存失败，当前输入已保留'
      setError(failed.current)
    }).finally(() => { writes.current.delete(operation); setPending(count => count - 1) })
  }
  return (
    <div className="bg-bg-surface border border-border rounded-xl p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-muted text-xs">#{index + 1}</span>
        <input
          value={scene.title}
          onChange={event => update({ title: event.target.value })}
          placeholder="场景标题..."
          className="min-w-0 basis-40 flex-1 px-2 py-1 bg-bg-base border border-border rounded text-sm font-medium text-text-primary focus:outline-none focus:border-accent"
        />
        <select
          aria-label="场景节奏"
          value={scene.pace}
          onChange={event => update({ pace: event.target.value as ScenePace })}
          className={`px-2 py-1 text-xs rounded border-0 ${PACE_COLORS[scene.pace]}`}
        >
          {Object.entries(PACE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          type="number"
          value={scene.estimatedWords || ''}
          onChange={event => update({ estimatedWords: parseInt(event.target.value) || 0 })}
          placeholder="字数"
          className="w-20 px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
        />
        <button onClick={onDelete} className="p-1 text-text-muted hover:text-error" aria-label={`删除场景${index + 1}`}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <textarea
        value={scene.summary}
        onChange={event => update({ summary: event.target.value })}
        placeholder="一句话场景概要..."
        rows={2}
        className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary resize-none focus:outline-none focus:border-accent"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={scene.location}
          onChange={event => update({ location: event.target.value })}
          placeholder="📍 地点"
          className="min-w-0 px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
        />
        <input
          value={scene.conflict}
          onChange={event => update({ conflict: event.target.value })}
          placeholder="⚔ 核心冲突"
          className="min-w-0 px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
        />
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-text-secondary">场景任务（可选，可留白）</summary>
        <p className="my-2 text-xs text-text-muted">可以写日常、缓冲、关系变化或收尾。这里是写作计划，退出状态不代表已经发生。</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {DETAILED_SCENE_TASK_FIELDS.map(({ key, label }) => (
            <label key={key} className="text-xs text-text-secondary">
              {label}
              <textarea aria-label={`场景${index + 1} · ${label}`} value={scene[key] ?? ''} onChange={event => update({ [key]: event.target.value })} rows={2} className="mt-1 w-full resize-y rounded border border-border bg-bg-base px-2 py-1 text-text-primary" />
            </label>
          ))}
        </div>
      </details>
        <textarea
          value={scene.notes}
          onChange={event => update({ notes: event.target.value })}
          placeholder="备注 / AI 建议..."
          rows={3}
          className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-muted resize-y focus:outline-none focus:border-accent"
        />
      {pending > 0 && <p role="status" className="text-xs text-text-muted">场景保存中…</p>}
      {error && <div role="alert" className="text-xs text-error">{error} <button type="button" onClick={() => { const { sceneId: _id, ...patch } = scene; update(patch, true) }} disabled={pending > 0}>重试保存</button></div>}
    </div>
  )
}
