import { CTextarea } from '../shared/CompositionInput'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Save, X, ChevronDown } from 'lucide-react'
import { useProjectStore } from '../../stores/project'
import { useWorldGroupStore } from '../../stores/world-group'
import type { Project, WorkspaceScope } from '../../lib/types'
import { GENRE_OPTIONS } from '../../lib/types'
import { useActiveWork } from '../../hooks/useActiveWork'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import { coordinatePendingEditV1, flushPendingEditsV1, registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'
import { db } from '../../lib/db/schema'

// 按 group 分组
const GENRE_GROUPS = Array.from(
  GENRE_OPTIONS.reduce((map, opt) => {
    if (!map.has(opt.group)) map.set(opt.group, [])
    map.get(opt.group)!.push(opt)
    return map
  }, new Map<string, typeof GENRE_OPTIONS[number][]>())
)

interface ProjectInfoPanelProps {
  project: Project
  onUpdate: (project: Project) => void
}

export default function ProjectInfoPanel({ project, onUpdate }: ProjectInfoPanelProps) {
  const { updateWorkspace, updateActiveWork } = useProjectStore()
  const activeWork = useActiveWork(project)
  const [form, setForm] = useState({
    title: '',
    genres: [] as string[],
    description: '',
    targetWordCount: 500_000,
  })
  const [formOwner, setFormOwner] = useState<{ scope: WorkspaceScope; title: string } | null>(null)
  const formOwnerRef = useRef<typeof formOwner>(null)
  const lastSavedRef = useRef<{ scope: WorkspaceScope; fields: typeof form; updatedAt: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [modeSaving, setModeSaving] = useState(false)
  const [modeError, setModeError] = useState('')
  const modeBusy = useRef(false)
  const projectIdRef = useRef(project.id)
  projectIdRef.current = project.id
  const dirtyRef = useRef(false)
  const formRef = useRef(form)
  const pendingCount = useRef(0)
  useBeforeUnload(dirty || saving)
  const changeForm = (next: typeof form) => {
    formRef.current = next
    dirtyRef.current = true
    setDirty(true)
    setForm(next)
  }
  const [showGenreDropdown, setShowGenreDropdown] = useState(false)

  useEffect(() => {
    if (!project.id || !activeWork?.id || !activeWork.worldId || activeWork.id !== project.activeWorkId || dirtyRef.current) return
    const saved = lastSavedRef.current
    if (saved?.scope.projectId === project.id && saved.scope.workId === activeWork.id
      && (activeWork.updatedAt ?? 0) < saved.updatedAt
      && JSON.stringify([activeWork.title, activeWork.description, activeWork.genres, activeWork.targetWordCount])
        !== JSON.stringify([saved.fields.title, saved.fields.description, saved.fields.genres, saved.fields.targetWordCount])) return
    const next = {
      title: activeWork.title,
      genres: [...activeWork.genres],
      description: activeWork.description,
      targetWordCount: activeWork.targetWordCount,
    }
    const owner = { scope: { projectId: project.id, worldId: activeWork.worldId, workId: activeWork.id }, title: activeWork.title }
    formOwnerRef.current = owner
    setFormOwner(owner)
    formRef.current = next
    setForm(next)
  }, [activeWork, project.activeWorkId, project.id, dirty])

  const handleSave = useCallback(async () => {
    if (!dirtyRef.current) return
    const owner = formOwnerRef.current
    if (!owner) {
      throw new Error('作品仍在加载，请稍后保存。')
    }
    const snapshot = formRef.current
    pendingCount.current++
    setSaving(true)
    setError('')
    try {
      const savedWork = await coordinatePendingEditV1({
        key: `work-info:${owner.scope.workId}`,
        persist: () => updateActiveWork(owner.scope.projectId, snapshot, owner.scope),
      })
      lastSavedRef.current = { scope: owner.scope, fields: snapshot, updatedAt: savedWork?.updatedAt ?? Date.now() }
      if (formRef.current === snapshot) {
        dirtyRef.current = false
        setDirty(false)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
      throw cause
    } finally {
      pendingCount.current--
      setSaving(pendingCount.current > 0)
    }
  }, [updateActiveWork])

  useEffect(() => registerPendingDraftFlusherV1(handleSave), [handleSave])
  useEffect(() => {
    if (!dirty) return
    const timer = setTimeout(() => { void handleSave().catch(() => undefined) }, 700)
    return () => clearTimeout(timer)
  }, [dirty, form, handleSave])

  const toggleGenre = (value: string) => {
    const current = formRef.current
    changeForm({
      ...current,
      genres: current.genres.includes(value)
        ? current.genres.filter(g => g !== value)
        : [...current.genres, value],
    })
  }

  const getGenreLabels = (genres: string[]) => {
    if (!genres || genres.length === 0) return '选择流派…'
    return genres
      .slice(0, 3)
      .map(v => GENRE_OPTIONS.find(o => o.value === v)?.label ?? v)
      .join(' · ') + (genres.length > 3 ? ` +${genres.length - 3}` : '')
  }

  const ownerIsActive = formOwner?.scope.projectId === project.id && formOwner?.scope.workId === activeWork?.id

  const toggleMultiWorld = async () => {
    const owner = formOwnerRef.current
    if (!owner || modeBusy.current || owner.scope.projectId !== project.id) return
    const next = !project.enableMultiWorld
    modeBusy.current = true; setModeSaving(true); setModeError('')
    try {
      await flushPendingEditsV1()
      if (next) {
        if (!await useWorldGroupStore.getState().enableMultiWorld(owner.scope)) return
      } else await updateWorkspace(owner.scope.projectId, { enableMultiWorld: false })
      if (projectIdRef.current === owner.scope.projectId) {
        const latest = await db.projects.get(owner.scope.projectId)
        if (latest) onUpdate(latest)
      }
    } catch (cause) {
      if (projectIdRef.current === owner.scope.projectId) setModeError(cause instanceof Error ? cause.message : String(cause))
    } finally { modeBusy.current = false; setModeSaving(false) }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-text-primary">基本信息</h2>
        <button
          onClick={() => { void handleSave().catch(() => undefined) }}
          disabled={saving || !formOwner}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors text-sm font-medium"
        >
          <Save className="w-4 h-4" />
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      <p role={error ? 'alert' : 'status'} className={`mb-4 text-xs ${error ? 'text-error' : 'text-text-muted'}`}>
        {error ? `未保存：${error}。内容仍保留，请点击保存重试。` : saving ? '正在保存…' : dirty ? '有修改，稍后自动保存；切换步骤时会先保存。' : '修改后自动保存'}
      </p>

      {dirty && formOwner && !ownerIsActive && <p role="status" className="mb-3 text-xs text-warning">已保留《{formOwner.title}》的改动，将先保存到该作品，再显示当前作品的信息。</p>}

      <fieldset disabled={!ownerIsActive || !activeWork || activeWork.id !== project.activeWorkId} className="space-y-5">
        <div>
          <label className="block text-sm text-text-secondary mb-1.5">作品名称</label>
          <input
            aria-label="作品名称"
            type="text"
            value={form.title}
            onChange={(e) => changeForm({ ...formRef.current, title: e.target.value })}
            className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm text-text-secondary mb-1.5">
            流派
            {form.genres.length > 0 && <span className="ml-1.5 text-accent text-xs">已选 {form.genres.length}</span>}
          </label>
          {/* 已选标签 */}
          {form.genres.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {form.genres.map(g => {
                const opt = GENRE_OPTIONS.find(o => o.value === g)
                return (
                  <span key={g} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                    {opt?.label ?? g}
                    <button onClick={() => toggleGenre(g)} className="hover:text-error"><X className="w-2.5 h-2.5" /></button>
                  </span>
                )
              })}
            </div>
          )}
          {/* 下拉选择 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowGenreDropdown(!showGenreDropdown)}
              className="w-full flex items-center justify-between px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-secondary hover:border-accent/50 focus:outline-none transition-colors"
            >
              <span>{getGenreLabels(form.genres)}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showGenreDropdown ? 'rotate-180' : ''}`} />
            </button>
            {showGenreDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-bg-surface border border-border rounded-lg shadow-lg z-30 max-h-64 overflow-y-auto">
                {GENRE_GROUPS.map(([group, opts]) => (
                  <div key={group}>
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider bg-bg-elevated border-b border-border/50">
                      {group}
                    </div>
                    <div className="flex flex-wrap gap-1 p-2">
                      {opts.map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => toggleGenre(opt.value)}
                          className={`text-xs px-2 py-1 rounded transition-colors ${
                            form.genres.includes(opt.value)
                              ? 'bg-accent text-white'
                              : 'bg-bg-base text-text-secondary hover:bg-bg-hover'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm text-text-secondary mb-1.5">简介</label>
          <CTextarea
            aria-label="作品简介"
            value={form.description}
            onChange={(e) => changeForm({ ...formRef.current, description: e.target.value })}
            rows={4}
            className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors resize-none"
          />
        </div>

        <div>
          <label className="block text-sm text-text-secondary mb-1.5">
            目标字数：{(form.targetWordCount / 10000).toFixed(0)} 万字
          </label>
          <input
            aria-label="目标字数"
            type="range"
            min={100000}
            max={5000000}
            step={100000}
            value={form.targetWordCount}
            onChange={(e) => changeForm({ ...formRef.current, targetWordCount: Number(e.target.value) })}
            className="w-full accent-accent"
          />
        </div>

        {/* 多世界开关 */}
        <div className="p-4 bg-bg-surface border border-border rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                🌐 多世界模式
              </div>
              <p className="text-xs text-text-muted mt-0.5">
                适用于诸天流/无限流/快穿/修仙多界等题材，开启后可为每个世界创建独立的世界观、力量体系、地理和角色设定
              </p>
            </div>
            <button
              aria-label="多世界模式"
              aria-pressed={project.enableMultiWorld === true}
              disabled={modeSaving}
              onClick={() => { void toggleMultiWorld() }}
              className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ml-4 ${
                project.enableMultiWorld ? 'bg-accent' : 'bg-border'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  project.enableMultiWorld ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          {modeSaving && <p role="status" className="mt-2 text-xs text-text-muted">正在保存多世界设置…</p>}
          {modeError && <p role="alert" className="mt-2 text-xs text-error">多世界设置未保存：{modeError}。可以重新操作开关。</p>}
        </div>

        <div className="pt-4 border-t border-border">
          <p className="text-text-muted text-xs">
            创建于 {new Date(project.createdAt).toLocaleString('zh-CN')} ·
            更新于 {new Date(project.updatedAt).toLocaleString('zh-CN')}
          </p>
        </div>
      </fieldset>
    </div>
  )
}
