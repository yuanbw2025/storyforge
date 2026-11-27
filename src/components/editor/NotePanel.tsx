/**
 * 便签面板 — Phase H3
 *
 * 编辑器侧边可展开的便签列表
 */
import { useState, useEffect, useContext, useRef } from 'react'
import { Plus, Pin, Trash2, X } from 'lucide-react'
import { useNoteStore } from '../../stores/note'
import { NOTE_COLORS, type NoteColor, type Note } from '../../lib/types/note'
import type { WorkspaceScope } from '../../lib/types'
import { AuthorRecordSaveScopeV1, useAuthorRecordSavesV1 } from '../shared/AuthorRecordSaveScope'
import AcknowledgedTextField from '../shared/AcknowledgedTextField'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'

interface Props {
  projectId: number
  chapterId?: number
  onClose: () => void
}

export default function NotePanel({ projectId, chapterId, onClose }: Props) {
  const { notes: liveNotes, loadedScope, loadAll, addNote, updateNote, deleteNote, togglePin } = useNoteStore()
  const scope = useContext(AuthorRecordSaveScopeV1)
  const owner = scope ? `${scope.projectId}:${scope.worldId}:${scope.workId}` : String(projectId)
  const [view, setView] = useState({ owner, scope, projectId })
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const switching = owner !== view.owner
  const latest = useRef({ owner, scope, projectId }); latest.current = { owner, scope, projectId }
  const retained = useRef<Note[]>([])
  const currentOwner = view.scope ? loadedScope?.projectId === view.scope.projectId && loadedScope.worldId === view.scope.worldId && loadedScope.workId === view.scope.workId : loadedScope?.projectId === view.projectId
  if (currentOwner) retained.current = liveNotes
  const notes = currentOwner ? liveNotes : retained.current
  useEffect(() => {
    if (!switching) return
    let active = true
    void flushPendingEditsV1().then(() => { if (active) { retained.current = []; setView(latest.current); setError('') } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '便签输入尚未保存。') })
    return () => { active = false }
  }, [owner, switching, retry])
  const [filter, setFilter] = useState<'all' | 'chapter' | 'global'>('all')

  useEffect(() => {
    let active = true
    void loadAll(view.scope ?? view.projectId).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '便签读取失败。') })
    return () => { active = false }
  }, [view, loadAll, retry])

  const filteredNotes = filter === 'chapter' && chapterId
    ? notes.filter(note => note.chapterId === chapterId)
    : filter === 'global'
      ? notes.filter(note => !note.chapterId)
      : notes

  const command = (action: () => void | Promise<unknown>) => {
    void flushPendingEditsV1().then(action).then(() => setError('')).catch(cause => setError(cause instanceof Error ? cause.message : '便签操作未完成。'))
  }
  const handleAdd = () => command(async () => {
    await addNote(view.projectId, '', filter === 'chapter' ? chapterId : undefined, 'yellow', view.scope ?? undefined)
  })

  return (
    <div className="bg-bg-surface border border-border rounded-xl overflow-hidden shadow-lg" aria-label="章节便签面板">
      {error && <p role="alert" className="p-3 text-xs text-error">{error}<button className="ml-2 underline" onClick={() => setRetry(value => value + 1)}>重新读取便签</button></p>}
      <AuthorRecordSaveScopeV1.Provider value={view.scope}>
      <fieldset disabled={switching} inert={switching} className="min-w-0 border-0 p-0">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-elevated border-b border-border">
        <h3 className="text-sm font-bold text-text-primary">📝 便签</h3>
        <div className="flex items-center gap-2">
          <button onClick={handleAdd}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover transition-colors">
            <Plus className="w-3 h-3" /> 新便签
          </button>
          <button aria-label="关闭便签" onClick={() => command(onClose)} className="p-1 text-text-muted hover:text-text-primary rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 过滤标签 */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border">
        {(['all', 'chapter', 'global'] as const).map(f => (
          <button
            key={f}
            onClick={() => command(() => setFilter(f))}
            className={`px-2 py-1 text-[10px] rounded transition-colors ${
              filter === f ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {f === 'all' ? '全部' : f === 'chapter' ? '本章' : '通用'}
          </button>
        ))}
        <span className="text-[10px] text-text-muted ml-auto">{filteredNotes.length} 条</span>
      </div>

      {/* 便签列表 */}
      <div className="p-3 space-y-2 max-h-[50vh] overflow-y-auto">
        {filteredNotes.length === 0 ? (
          <div className="text-center py-6 text-text-muted text-xs">
            暂无便签，点击「新便签」创建
          </div>
        ) : (
          filteredNotes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              scope={view.scope ?? undefined}
              onUpdate={(data) => updateNote(note.id!, data, { scope: view.scope ?? undefined })}
              onDelete={() => command(() => deleteNote(note.id!, view.scope ?? undefined))}
              onTogglePin={() => command(() => togglePin(note.id!, view.scope ?? undefined))}
            />
          ))
        )}
      </div>
      </fieldset>
      </AuthorRecordSaveScopeV1.Provider>
    </div>
  )
}

function NoteCard({ note, scope, onUpdate, onDelete, onTogglePin }: {
  note: Note
  scope?: WorkspaceScope
  onUpdate: (data: Partial<Note>) => Promise<void>
  onDelete: () => void
  onTogglePin: () => void
}) {
  const localSave = useAuthorRecordSavesV1('notes', note)
  const colorStyle = NOTE_COLORS[note.color] || NOTE_COLORS.yellow
  const [error, setError] = useState('')

  return (
    <div className={`rounded-lg p-3 ${colorStyle.bg} ${colorStyle.text} transition-all`}>
      <div className="flex items-start gap-2">
        <AcknowledgedTextField label={`便签${note.id}内容`} value={note.content} rows={2} placeholder="写点什么..." localSave={localSave('content')}
          className={`w-full bg-transparent resize-none outline-none text-xs ${colorStyle.text} placeholder:opacity-50`}
          onCommit={(content, _expected, intent) => intent && scope
            ? useNoteStore.getState().updateNote(note.id!, { content }, { scope, confirmation: intent })
            : onUpdate({ content })} />
        <div className="flex flex-col gap-0.5 shrink-0">
          <button onClick={onTogglePin}
            className={`p-1 rounded transition-colors ${note.pinned ? 'text-accent' : 'opacity-40 hover:opacity-100'}`}
            title={note.pinned ? '取消置顶' : '置顶'}>
            <Pin className="w-3 h-3" />
          </button>
          <button onClick={onDelete}
            className="p-1 opacity-40 hover:opacity-100 rounded transition-colors"
            title="删除">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-error">{error}</p>}
      {/* 颜色选择 */}
      <div className="flex items-center gap-1 mt-2">
        {(Object.keys(NOTE_COLORS) as NoteColor[]).map(color => (
          <button
            key={color}
            aria-label={`便签颜色${NOTE_COLORS[color].label}`}
            onClick={() => { void onUpdate({ color }).then(() => setError('')).catch(cause => setError(cause instanceof Error ? cause.message : '便签颜色未保存。')) }}
            className={`w-4 h-4 rounded-full border-2 transition-all ${
              note.color === color ? 'border-current scale-110' : 'border-transparent opacity-50 hover:opacity-100'
            }`}
            style={{ backgroundColor: color === 'yellow' ? '#fef08a' : color === 'blue' ? '#bfdbfe' : color === 'green' ? '#bbf7d0' : color === 'pink' ? '#fbcfe8' : color === 'purple' ? '#e9d5ff' : '#fed7aa' }}
          />
        ))}
        {note.chapterId && (
          <span className="text-[10px] opacity-60 ml-auto">📌 章节便签</span>
        )}
      </div>
    </div>
  )
}
