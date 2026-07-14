import { Trash2 } from 'lucide-react'
import type { DetailedScene, ScenePace } from '../../lib/types'

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
  onUpdate: (patch: Partial<DetailedScene>) => void
  onDelete: () => void
}

export default function DetailedSceneCard({ scene, index, onUpdate, onDelete }: Props) {
  return (
    <div className="bg-bg-surface border border-border rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-text-muted text-xs">#{index + 1}</span>
        <input
          value={scene.title}
          onChange={event => onUpdate({ title: event.target.value })}
          placeholder="场景标题..."
          className="flex-1 px-2 py-1 bg-bg-base border border-border rounded text-sm font-medium text-text-primary focus:outline-none focus:border-accent"
        />
        <select
          aria-label="场景节奏"
          value={scene.pace}
          onChange={event => onUpdate({ pace: event.target.value as ScenePace })}
          className={`px-2 py-1 text-xs rounded border-0 ${PACE_COLORS[scene.pace]}`}
        >
          {Object.entries(PACE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          type="number"
          value={scene.estimatedWords || ''}
          onChange={event => onUpdate({ estimatedWords: parseInt(event.target.value) || 0 })}
          placeholder="字数"
          className="w-20 px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
        />
        <button onClick={onDelete} className="p-1 text-text-muted hover:text-error" aria-label={`删除场景${index + 1}`}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <textarea
        value={scene.summary}
        onChange={event => onUpdate({ summary: event.target.value })}
        placeholder="一句话场景概要..."
        rows={2}
        className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary resize-none focus:outline-none focus:border-accent"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={scene.location}
          onChange={event => onUpdate({ location: event.target.value })}
          placeholder="📍 地点"
          className="px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
        />
        <input
          value={scene.conflict}
          onChange={event => onUpdate({ conflict: event.target.value })}
          placeholder="⚔ 核心冲突"
          className="px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
        />
      </div>
      {scene.notes && (
        <textarea
          value={scene.notes}
          onChange={event => onUpdate({ notes: event.target.value })}
          placeholder="备注 / AI 建议..."
          rows={3}
          className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-muted resize-y focus:outline-none focus:border-accent"
        />
      )}
    </div>
  )
}
