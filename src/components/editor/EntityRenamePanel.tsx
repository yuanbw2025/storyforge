import { useEffect, useMemo, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import { db } from '../../lib/db/schema'
import type { Project, WorkspaceScope } from '../../lib/types'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { AlertTriangle, CheckCircle2, Eye, RotateCcw, ShieldCheck } from 'lucide-react'
import { useBackupStore } from '../../stores/backup'
import { useChapterStore } from '../../stores/chapter'
import { useCharacterStore } from '../../stores/character'
import { useCodexStore } from '../../stores/codex'
import { useLocationStore } from '../../stores/location'
import { useStateCardStore } from '../../stores/state-card'
import {
  buildEntityRenamePreview,
  executeEntityRename,
  listRenamableEntities,
  undoEntityRename,
  type EntityRenamePreview,
  type EntityRenameTarget,
  type EntityRenameUndoPatch,
  type RenamableEntity,
  type RenamableEntityKind,
} from '../../lib/editor/entity-rename'
import { useDialog } from '../shared/Dialog'
import { useToast } from '../shared/Toast'

interface Props {
  projectId: number
  onSelectOutlineNode: (outlineNodeId: number) => void
}

const KIND_LABELS: Record<RenamableEntityKind, string> = {
  character: '角色',
  location: '地点',
  codexEntry: '词条',
}

function formatTime(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function entityKey(entity: RenamableEntity): string {
  return `${entity.kind}:${entity.id}`
}

function parseEntityKey(value: string): EntityRenameTarget | null {
  const [kind, rawId] = value.split(':')
  const id = Number(rawId)
  if (!['character', 'location', 'codexEntry'].includes(kind) || !Number.isFinite(id)) return null
  return { kind: kind as RenamableEntityKind, id }
}

export default function EntityRenamePanel({ projectId, onSelectOutlineNode }: Props) {
  const dialog = useDialog()
  const { toast } = useToast()
  const createSnapshot = useBackupStore(state => state.createSnapshot)
  const loadChapters = useChapterStore(state => state.loadAll)
  const loadCharacters = useCharacterStore(state => state.loadAll)
  const loadLocations = useLocationStore(state => state.loadAll)
  const loadCodex = useCodexStore(state => state.loadExisting)
  const loadStateCards = useStateCardStore(state => state.loadAll)
  const [roots, setRoots] = useState<Project>()
  useEffect(() => {
    setRoots(undefined)
    const subscription = liveQuery(async () => await db.projects.get(projectId)).subscribe({
      next: setRoots,
      error: cause => { setRoots(undefined); toast('error', `改名作用域读取失败：${String(cause)}`) },
    })
    return () => subscription.unsubscribe()
  }, [projectId, toast])
  const scope = useMemo<WorkspaceScope | null>(() => roots?.id === projectId && roots.activeWorldId != null && roots.activeWorkId != null
    ? { projectId, worldId: roots.activeWorldId, workId: roots.activeWorkId } : null,
  [projectId, roots?.id, roots?.activeWorldId, roots?.activeWorkId])
  const requestVersion = useRef(0)
  const invalidateRequest = () => { requestVersion.current++ }
  const currentScopeRef = useRef(scope)
  currentScopeRef.current = scope
  const isCurrent = (owner: WorkspaceScope) => {
    const current = currentScopeRef.current
    return current?.projectId === owner.projectId && current.worldId === owner.worldId && current.workId === owner.workId
  }

  const [entities, setEntities] = useState<RenamableEntity[]>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [newName, setNewName] = useState('')
  const [preview, setPreview] = useState<EntityRenamePreview | null>(null)
  const [undoPatch, setUndoPatch] = useState<EntityRenameUndoPatch | null>(null)
  const [activity, setActivity] = useState<'preview' | 'write' | null>(null)
  const busy = activity !== null

  const selected = useMemo(
    () => entities.find(entity => entityKey(entity) === selectedKey) ?? null,
    [entities, selectedKey],
  )

  const refreshEntities = async (owner: WorkspaceScope) => {
    const next = await listRenamableEntities(owner)
    if (isCurrent(owner)) setEntities(next)
    return next
  }

  const refreshProjectStores = async (owner: WorkspaceScope) => {
    if (!isCurrent(owner)) return
    await Promise.all([
      loadChapters(owner),
      loadCharacters(owner),
      loadLocations(owner),
      loadCodex(owner),
      loadStateCards(owner),
    ])
  }

  useEffect(() => {
    let active = true
    setEntities([])
    setNewName('')
    setSelectedKey('')
    setPreview(null)
    setActivity(null)
    if (!scope) return
    void listRenamableEntities(scope)
      .then(items => {
        if (active) setEntities(items)
      })
      .catch(error => {
        if (active) toast('error', `实体加载失败：${error instanceof Error ? error.message : String(error)}`)
      })
    return () => {
      active = false
      invalidateRequest()
    }
  }, [scope, toast])

  // Scope switches and edits supersede pending previews and confirmations.
  const beginRequest = () => {
    const version = ++requestVersion.current
    return () => version === requestVersion.current
  }

  const invalidatePreview = () => {
    invalidateRequest()
    setPreview(null)
    setActivity(null)
  }

  const buildPreview = async () => {
    if (!scope) return
    const owner = scope
    const target = parseEntityKey(selectedKey)
    if (!target) {
      toast('error', '请先选择要改名的实体')
      return
    }
    if (!newName.trim()) {
      toast('error', '请输入新名称')
      return
    }
    const current = beginRequest()
    setActivity('preview')
    try {
      await flushPendingEditsV1()
      const next = await buildEntityRenamePreview(owner, target, newName)
      if (current() && isCurrent(owner)) setPreview(next)
    } catch (error) {
      if (current()) toast('error', `预览失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (current()) setActivity(null)
    }
  }

  const applyRename = async () => {
    if (!preview || preview.blockers.length || !isCurrent(preview.scope)) return
    const current = beginRequest()
    const ok = await dialog.confirm({
      title: `确认将「${preview.entity.name}」改为「${preview.newName}」？`,
      message: [
        `正文将替换 ${preview.chapterReplacementCount} 处，结构化记录将更新 ${preview.changes.filter(change => change.target !== 'chapters').length} 条。`,
        `另有 ${preview.manualReview.length} 条自由文本仅列入人工复核，不会自动改写。`,
        '执行前会创建项目快照，正文、主档和冗余显示名将在同一事务中提交。',
      ].join('\n'),
      confirmText: '创建快照并改名',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!ok || !current()) return

    setActivity('write')
    try {
      await flushPendingEditsV1()
      if (!current()) return
      const result = await executeEntityRename({
        projectId,
        scope: preview.scope,
        entity: { kind: preview.entity.kind, id: preview.entity.id },
        newName: preview.newName,
        expectedBaseline: preview.baseline,
        createSnapshot,
        label: `实体改名前自动快照 ${formatTime(Date.now())}`,
      })
      if (!current() || !isCurrent(preview.scope)) return
      setUndoPatch(result.undoPatch)
      await refreshProjectStores(preview.scope)
      const next = await refreshEntities(preview.scope)
      if (!current() || !isCurrent(preview.scope)) return
      const renamed = next.find(entity =>
        entity.kind === preview.entity.kind && entity.id === preview.entity.id,
      )
      setSelectedKey(renamed ? entityKey(renamed) : '')
      setNewName('')
      setPreview(null)
      toast('success', `改名完成：同步 ${result.changedRecords} 条记录，正文替换 ${result.chapterReplacements} 处`)
    } catch (error) {
      if (current()) toast('error', `改名失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (current()) setActivity(null)
    }
  }

  const undoRename = async () => {
    if (!undoPatch || !isCurrent(undoPatch.scope)) return
    const current = beginRequest()
    const ok = await dialog.confirm({
      title: '撤销上次实体改名？',
      message: [
        `将把「${undoPatch.newName}」恢复为「${undoPatch.oldName}」。`,
        '只有相关记录都未被再次修改时才会执行；否则请使用已创建的项目快照。',
      ].join('\n'),
      confirmText: '原子撤销',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!ok || !current()) return
    setActivity('write')
    try {
      await flushPendingEditsV1()
      if (!current()) return
      await undoEntityRename(undoPatch)
      if (!current() || !isCurrent(undoPatch.scope)) return
      await refreshProjectStores(undoPatch.scope)
      await refreshEntities(undoPatch.scope)
      if (!current() || !isCurrent(undoPatch.scope)) return
      setSelectedKey('')
      setNewName('')
      setPreview(null)
      setUndoPatch(null)
      toast('success', '已撤销上次实体改名')
    } catch (error) {
      if (current()) toast('error', `撤销失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (current()) setActivity(null)
    }
  }

  return (
    <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-3">
        <div className="grid gap-2 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[11px] text-text-muted">选择稳定实体</span>
            <select
              value={selectedKey}
              disabled={activity === 'write'}
              onChange={event => {
                setSelectedKey(event.target.value)
                setNewName('')
                invalidatePreview()
              }}
              className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            >
              <option value="">选择角色、地点或词条</option>
              {entities.map(entity => (
                <option key={entityKey(entity)} value={entityKey(entity)}>
                  {KIND_LABELS[entity.kind]} · {entity.label}（{entity.detail}）
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-text-muted">新名称</span>
            <input
              value={newName}
              onChange={event => {
                setNewName(event.target.value)
                invalidatePreview()
              }}
              placeholder={selected ? `将「${selected.name}」改为…` : '先选择实体'}
              disabled={!selected || activity === 'write'}
              className="w-full rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent disabled:opacity-50"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void buildPreview()}
            disabled={busy || !scope || !selected || !newName.trim()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50"
          >
            <Eye className="h-3.5 w-3.5" /> 预览影响范围
          </button>
          {preview && !preview.blockers.length && (
            <button
              onClick={() => void applyRename()}
              disabled={busy || !isCurrent(preview.scope)}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> 创建快照并改名
            </button>
          )}
          {undoPatch && (
            <button
              onClick={() => void undoRename()}
              disabled={busy || !isCurrent(undoPatch.scope)}
              className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning hover:bg-warning/20 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> 撤销上次实体改名
            </button>
          )}
        </div>

        <div className="rounded-lg border border-border bg-bg-base p-3 text-[11px] leading-5 text-text-muted">
          <p>物品不进入智能改名：当前物品以“持有人 + 名称”聚合，没有独立稳定 ID。贸然全局改名可能合并不同角色的同名物品。</p>
          <p>大纲、档案描述、事实引文等自由文本只列入复核，不会在缺少语义判断时自动改写。</p>
        </div>

        {preview && (
          <div className="space-y-2">
            {preview.blockers.map(blocker => (
              <div key={blocker} className="flex gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{blocker}</span>
              </div>
            ))}
            {!preview.blockers.length && (
              <div className="flex gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>未发现名称归属冲突，可按本预览安全执行。</span>
              </div>
            )}
            {preview.warnings.map(warning => (
              <div key={warning} className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <aside className="rounded-lg border border-border bg-bg-base p-3">
        <p className="mb-2 text-xs font-medium text-text-secondary">影响预览</p>
        {!preview && <p className="py-8 text-center text-xs text-text-muted">选择实体并生成预览后显示。</p>}
        {preview && (
          <div className="max-h-80 space-y-3 overflow-y-auto pr-1 text-[11px]">
            <section>
              <p className="font-medium text-text-secondary">正文</p>
              <p className="text-text-muted">{preview.chapterReplacementCount} 处 / {preview.chapterMatches.length} 章</p>
              {preview.chapterMatches.map(match => (
                <button
                  key={match.chapterId}
                  onClick={() => onSelectOutlineNode(match.outlineNodeId)}
                  className="mt-1 block w-full truncate text-left text-accent hover:underline"
                >
                  {match.title} · {match.count} 处
                </button>
              ))}
            </section>
            <section>
              <p className="font-medium text-text-secondary">结构化同步</p>
              {preview.structuredCounts.map(item => (
                <p key={item.label} className="text-text-muted">{item.label} · {item.count} 条</p>
              ))}
            </section>
            <section>
              <p className="font-medium text-text-secondary">人工复核 · {preview.manualReview.length} 条</p>
              {preview.manualReview.slice(0, 12).map((item, index) => (
                <p key={`${item.source}-${item.label}-${index}`} className="mt-1 text-text-muted">
                  {item.source} · {item.label}：{item.detail}
                </p>
              ))}
              {preview.manualReview.length > 12 && (
                <p className="mt-1 text-text-muted">另有 {preview.manualReview.length - 12} 条。</p>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  )
}
