import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { DetailedScene, ScenePace } from '../../lib/types'
import { DETAILED_SCENE_TASK_FIELDS } from '../../lib/types/detailed-outline'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import AcknowledgedTextField from '../shared/AcknowledgedTextField'

const PACE_LABELS: Record<ScenePace, string> = { slow: '🐢 慢', medium: '🚶 中', fast: '🏃 快', climax: '⚡ 高潮' }
interface Props {
  scene: DetailedScene
  index: number
  onUpdate: (patch: Partial<DetailedScene>, expected?: Partial<DetailedScene>) => void | Promise<void>
  onDelete: () => void | Promise<void>
}
export default function DetailedSceneCard({ scene, index, onUpdate, onDelete }: Props) {
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const text = (key: 'title' | 'summary' | 'location' | 'conflict' | 'notes' | typeof DETAILED_SCENE_TASK_FIELDS[number]['key'], label: string, placeholder: string, input = false, rows = 2) => (
    <AcknowledgedTextField label={`场景${index + 1} · ${label}`} value={scene[key]} placeholder={placeholder} input={input} rows={rows}
      onCommit={(value, expected) => onUpdate({ [key]: value }, { [key]: expected })} />
  )
  const remove = async () => {
    if (deleting) return
    setDeleting(true); setDeleteError('')
    try { await flushPendingEditsV1(); await onDelete() }
    catch (cause) { setDeleteError(cause instanceof Error ? cause.message : '场景删除失败，请重试。') }
    finally { setDeleting(false) }
  }
  return (
    <fieldset disabled={deleting} className="bg-bg-surface border border-border rounded-xl p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-muted text-xs">#{index + 1}</span>
        {text('title', '标题', '场景标题...', true)}
        <AcknowledgedTextField label="场景节奏" value={scene.pace} choices={Object.entries(PACE_LABELS).map(([value, label]) => ({ value, label }))}
          onCommit={(value, expected) => onUpdate({ pace: value as ScenePace }, { pace: expected as ScenePace })} />
        <AcknowledgedTextField label={`场景${index + 1} · 估算字数`} value={scene.estimatedWords ? String(scene.estimatedWords) : ''} input inputType="number" placeholder="字数"
          onCommit={(value, expected) => onUpdate({ estimatedWords: value === '' ? 0 : Number(value) }, { estimatedWords: expected === '' ? 0 : Number(expected) })} />
        <button type="button" onClick={() => { void remove() }} className="p-1 text-text-muted hover:text-error" aria-label={`删除场景${index + 1}`}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {text('summary', '概要', '一句话场景概要...')}
      <div className="grid grid-cols-2 gap-2">
        {text('location', '地点', '📍 地点', true)}
        {text('conflict', '核心冲突', '⚔ 核心冲突', true)}
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-text-secondary">场景任务（可选，可留白）</summary>
        <p className="my-2 text-xs text-text-muted">可以写日常、缓冲、关系变化或收尾。这里是写作计划，退出状态不代表已经发生。</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {DETAILED_SCENE_TASK_FIELDS.map(({ key, label }) => <label key={key} className="text-xs text-text-secondary">{label}{text(key, label, `${label}…`)}</label>)}
        </div>
      </details>
      {text('notes', '备注', '备注 / AI 建议...', false, 3)}
      {deleting && <p role="status" className="text-xs text-text-muted">正在删除场景…</p>}
      {deleteError && <p role="alert" className="text-xs text-error">{deleteError}</p>}
    </fieldset>
  )
}
