/**
 * 世界总览面板 — 管理多个世界组 + 世界关系
 */
import { useState, useEffect } from 'react'
import { Plus, Trash2, GripVertical, ArrowRight, ChevronRight, Sparkles, Loader2, Check } from 'lucide-react'
import { useWorldGroupStore } from '../../stores/world-group'
import { useAIConfigStore } from '../../stores/ai-config'
import {
  abandonWorldSuggestRunV1,
  adoptWorldSuggestCandidateV1,
  generateWorldSuggestCandidateV1,
  readPendingWorldSuggestCandidateV1,
  readRecoverableWorldSuggestRunV1,
  rejectWorldSuggestCandidateV1,
  type WorldSuggestCandidateV1,
} from '../../lib/agent/run/world-suggest-durable'
import { resolveScopeLike } from '../../lib/world-engine/scope'
import { WORLD_GROUP_TYPE_LABELS, WORLD_LINK_TYPE_LABELS } from '../../lib/types/world-group'
import type { Project, WorkspaceScope, WorldGroup, WorldGroupType, WorldGroupLinkType } from '../../lib/types'
import WorldGroupDetail from './WorldGroupDetail'
import WorldRelationGraph from './WorldRelationGraph'

interface Props {
  project: Project
}

const ADOPTION_RECOVERY_MESSAGE = '上次世界选择已确认但尚未完成写入；请继续原运行完成写入与终验，不会重复调用模型。'

export default function WorldGroupOverview({ project }: Props) {
  const { groups, links, loading, loadAll, createGroup, deleteGroup, ensurePrimaryGroup, createLink, deleteLink } = useWorldGroupStore()
  const aiConfig = useAIConfigStore(state => state.config)
  const [editingGroup, setEditingGroup] = useState<WorldGroup | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  // 关系创建
  const [showLinkForm, setShowLinkForm] = useState(false)
  const [linkForm, setLinkForm] = useState<{ from: number | ''; to: number | ''; type: WorldGroupLinkType; name: string }>({
    from: '', to: '', type: 'portal', name: '',
  })

  // AI 建议世界
  const [showSuggest, setShowSuggest] = useState(false)
  const [concept, setConcept] = useState('')
  const [scope, setScope] = useState<WorkspaceScope | null>(null)
  const [candidate, setCandidate] = useState<WorldSuggestCandidateV1 | null>(null)
  const [runId, setRunId] = useState<number | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set())
  const [unsafeRunId, setUnsafeRunId] = useState<number | null>(null)
  const [resumeAdoption, setResumeAdoption] = useState(false)
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [adoptedCount, setAdoptedCount] = useState(0)

  useEffect(() => {
    if (!project.id) return
    let cancelled = false
    setShowSuggest(false)
    setConcept('')
    setScope(null)
    setCandidate(null)
    setRunId(null)
    setSelectedIdx(new Set())
    setUnsafeRunId(null)
    setResumeAdoption(false)
    setSuggestError(null)
    setAdoptedCount(0)
    void (async () => {
      const resolved = await resolveScopeLike(project.id!)
      if (cancelled) return
      await loadAll(resolved)
      await ensurePrimaryGroup(resolved)
      if (cancelled) return
      setScope(resolved)
      const pending = await readPendingWorldSuggestCandidateV1({ scope: resolved })
      if (cancelled) return
      if (pending) {
        setCandidate(pending.candidate)
        setRunId(pending.snapshot.run.id)
        setConcept(pending.candidate.authorConcept)
        setShowSuggest(true)
        return
      }
      const recoverable = await readRecoverableWorldSuggestRunV1({ scope: resolved })
      if (cancelled || !recoverable) return
      setShowSuggest(true)
      if (recoverable.safeToResume && recoverable.candidate && recoverable.adoptionPending) {
        setCandidate(recoverable.candidate)
        setRunId(recoverable.snapshot.run.id)
        setConcept(recoverable.candidate.authorConcept)
        setSelectedIdx(new Set(recoverable.selectedIndexes || []))
        setResumeAdoption(true)
        setSuggestError(ADOPTION_RECOVERY_MESSAGE)
      } else if (!recoverable.safeToResume) {
        setUnsafeRunId(recoverable.snapshot.run.id)
        setSuggestError('上次世界建议停在模型结果不可判定窗口，系统不会自动重试。请放弃后重新生成。')
      }
    })().catch(reason => {
      if (!cancelled) setSuggestError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { cancelled = true }
  }, [project.id, project.activeWorldId, project.activeWorkId, loadAll, ensurePrimaryGroup])

  const handleAISuggest = async () => {
    if (!scope || candidate || unsafeRunId != null || suggestBusy) return
    setSuggestBusy(true)
    setSuggestError(null)
    setAdoptedCount(0)
    try {
      const generated = await generateWorldSuggestCandidateV1({
        scope,
        authorConcept: concept,
        aiConfig,
      })
      setCandidate(generated.candidate)
      setRunId(generated.snapshot.run.id)
      setSelectedIdx(new Set())
      setResumeAdoption(false)
    } catch (reason) {
      setSuggestError(reason instanceof Error ? reason.message : String(reason))
      const pending = await readPendingWorldSuggestCandidateV1({ scope }).catch(() => null)
      if (pending) {
        setCandidate(pending.candidate)
        setRunId(pending.snapshot.run.id)
        setConcept(pending.candidate.authorConcept)
        setSuggestError(null)
      } else {
        const recoverable = await readRecoverableWorldSuggestRunV1({ scope }).catch(() => null)
        if (recoverable?.safeToResume && recoverable.candidate && recoverable.adoptionPending) {
          setCandidate(recoverable.candidate)
          setRunId(recoverable.snapshot.run.id)
          setConcept(recoverable.candidate.authorConcept)
          setSelectedIdx(new Set(recoverable.selectedIndexes || []))
          setResumeAdoption(true)
          setSuggestError(ADOPTION_RECOVERY_MESSAGE)
        } else if (recoverable && !recoverable.safeToResume) {
          setUnsafeRunId(recoverable.snapshot.run.id)
        }
      }
    } finally {
      setSuggestBusy(false)
    }
  }

  const toggleSuggested = (idx: number) => {
    if (resumeAdoption || suggestBusy) return
    setSelectedIdx(previous => {
      const next = new Set(previous)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const handleAdoptSuggested = async () => {
    if (!scope || !candidate || runId == null || suggestBusy) return
    if (!resumeAdoption && selectedIdx.size === 0) {
      setSuggestError('请至少选择一个世界建议后再确认写入。')
      return
    }
    setSuggestBusy(true)
    setSuggestError(null)
    try {
      const selected = [...selectedIdx].sort((left, right) => left - right)
      await adoptWorldSuggestCandidateV1({
        scope,
        runId,
        ...(resumeAdoption ? {} : { selectedIndexes: selected }),
      })
      await loadAll(scope)
      setAdoptedCount(selected.length)
      setCandidate(null)
      setRunId(null)
      setSelectedIdx(new Set())
      setResumeAdoption(false)
    } catch (reason) {
      setSuggestError(reason instanceof Error ? reason.message : String(reason))
      const recoverable = await readRecoverableWorldSuggestRunV1({ scope }).catch(() => null)
      if (recoverable?.safeToResume && recoverable.candidate && recoverable.adoptionPending) {
        setCandidate(recoverable.candidate)
        setRunId(recoverable.snapshot.run.id)
        setSelectedIdx(new Set(recoverable.selectedIndexes || []))
        setResumeAdoption(true)
        setSuggestError(ADOPTION_RECOVERY_MESSAGE)
      }
    } finally {
      setSuggestBusy(false)
    }
  }

  const handleRejectSuggested = async () => {
    if (!scope || runId == null || suggestBusy || resumeAdoption) return
    setSuggestBusy(true)
    setSuggestError(null)
    try {
      await rejectWorldSuggestCandidateV1({ scope, runId })
      setCandidate(null)
      setRunId(null)
      setSelectedIdx(new Set())
    } catch (reason) {
      setSuggestError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSuggestBusy(false)
    }
  }

  const handleAbandonSuggested = async () => {
    if (!scope || unsafeRunId == null || suggestBusy) return
    setSuggestBusy(true)
    try {
      await abandonWorldSuggestRunV1({ scope, runId: unsafeRunId })
      setUnsafeRunId(null)
      setSuggestError(null)
    } catch (reason) {
      setSuggestError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSuggestBusy(false)
    }
  }

  const handleAddWorld = async () => {
    const id = await createGroup({
      projectId: project.id!,
      name: '新世界',
      description: '',
      type: 'traversal' as WorldGroupType,
      icon: '🌐',
      order: groups.length,
    })
    // 自动进入编辑
    const created = groups.find(g => g.id === id) ||
      { id, projectId: project.id!, name: '新世界', description: '', type: 'traversal' as WorldGroupType, icon: '🌐', order: groups.length, createdAt: Date.now(), updatedAt: Date.now() }
    setEditingGroup(created)
  }

  const handleDelete = async (id: number) => {
    await deleteGroup(id)
    setConfirmDeleteId(null)
  }

  const handleCreateLink = async () => {
    if (linkForm.from === '' || linkForm.to === '' || linkForm.from === linkForm.to) return
    await createLink({
      projectId: project.id!,
      fromGroupId: Number(linkForm.from),
      toGroupId: Number(linkForm.to),
      linkType: linkForm.type,
      name: linkForm.name || undefined,
      bidirectional: false,
    })
    setLinkForm({ from: '', to: '', type: 'portal', name: '' })
    setShowLinkForm(false)
  }

  // 如果正在编辑某个世界，显示详情
  if (editingGroup) {
    const latest = groups.find(g => g.id === editingGroup.id) || editingGroup
    return (
      <div className="max-w-3xl mx-auto">
        <WorldGroupDetail
          group={latest}
          onBack={() => setEditingGroup(null)}
        />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* 顶部标题 */}
      <div className="pb-4 border-b border-border/40">
        <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
          🌐 世界总览
        </h2>
        <p className="text-xs text-text-muted mt-0.5">
          管理多个世界的设定，定义世界间的穿越关系。每个世界拥有独立的世界观、力量体系、地理和历史。
        </p>
      </div>

      {loading ? (
        <div className="text-text-muted text-sm py-8 text-center">加载中...</div>
      ) : (
        <>
          {/* 世界列表 */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">世界列表 ({groups.length})</h3>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowSuggest(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-bg-elevated text-text-secondary border border-border hover:text-accent hover:border-accent/50 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  AI 建议世界
                </button>
                <button
                  onClick={handleAddWorld}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加世界
                </button>
              </div>
            </div>

            {/* AI 建议世界面板 */}
            {showSuggest && (
              <div className="p-3 bg-bg-surface border border-border rounded-lg space-y-2.5">
                <textarea
                  value={concept}
                  onChange={e => setConcept(e.target.value)}
                  disabled={suggestBusy || !!candidate || unsafeRunId != null}
                  placeholder="描述你的整体故事概念，例如：主角带着诸天系统穿越各个世界，每个世界完成任务后获得奖励...（留空则用项目简介）"
                  rows={2}
                  className="w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAISuggest}
                    disabled={suggestBusy || !scope || !!candidate || unsafeRunId != null}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
                  >
                    {suggestBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {suggestBusy ? '记录可恢复运行...' : '生成建议'}
                  </button>
                  {unsafeRunId != null && (
                    <button onClick={handleAbandonSuggested} className="text-xs text-red-400 hover:text-red-300">放弃未知运行</button>
                  )}
                </div>
                {suggestError && <div className="text-xs text-red-400">{suggestError}</div>}
                {adoptedCount > 0 && <div className="text-xs text-green-400">已写入 {adoptedCount} 个世界</div>}

                {/* 建议结果 */}
                {candidate && candidate.worlds.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between gap-2 text-xs text-amber-300">
                      <span>{resumeAdoption ? '世界选择已确认，等待恢复终验' : '世界建议候选尚未写入；请选择后统一确认'}</span>
                      <div className="flex items-center gap-2">
                        {!resumeAdoption && (
                          <button onClick={handleRejectSuggested} disabled={suggestBusy} className="text-text-muted hover:text-red-400 disabled:opacity-50">
                            放弃整批候选
                          </button>
                        )}
                        <button
                          onClick={handleAdoptSuggested}
                          disabled={suggestBusy || (!resumeAdoption && selectedIdx.size === 0)}
                          className="px-2.5 py-1 rounded bg-accent text-white disabled:opacity-40"
                        >
                          {resumeAdoption ? '继续写入与终验' : `确认写入所选 ${selectedIdx.size} 项`}
                        </button>
                      </div>
                    </div>
                    {candidate.worlds.map((w, i) => (
                      <div key={i} className="flex items-start gap-2 p-2.5 bg-bg-base border border-border rounded-lg">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-text-primary">{w.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-muted border border-border/50">
                              {WORLD_GROUP_TYPE_LABELS[w.type]}
                            </span>
                            {w.plannedChapterCount > 0 && (
                              <span className="text-[10px] text-text-muted">{w.plannedChapterCount} 章</span>
                            )}
                          </div>
                          <p className="text-xs text-text-muted mt-0.5">{w.description}</p>
                          {w.entryCondition && <p className="text-[10px] text-text-muted mt-0.5">进入：{w.entryCondition}</p>}
                        </div>
                        <button
                          onClick={() => toggleSuggested(i)}
                          disabled={resumeAdoption || suggestBusy}
                          className={`shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors ${
                            selectedIdx.has(i)
                              ? 'bg-green-600/20 text-green-400'
                              : 'bg-accent/10 text-accent hover:bg-accent/20'
                          }`}
                        >
                          {selectedIdx.has(i) ? <><Check className="w-3 h-3" /> 已选择</> : '选择'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1">
              {groups.map(g => (
                <div
                  key={g.id}
                  className="flex items-center gap-3 px-3 py-2.5 bg-bg-surface border border-border rounded-lg hover:border-accent/30 transition-colors group"
                >
                  <GripVertical className="w-4 h-4 text-text-muted/30 shrink-0 cursor-grab" />

                  {/* 图标 + 颜色指示 */}
                  <span className="text-xl shrink-0">{g.icon || '🌐'}</span>

                  {/* 信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary truncate">{g.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-muted border border-border/50">
                        {WORLD_GROUP_TYPE_LABELS[g.type]}
                      </span>
                    </div>
                    {g.description && (
                      <p className="text-xs text-text-muted truncate mt-0.5">{g.description}</p>
                    )}
                  </div>

                  {/* 预计章节 */}
                  {g.plannedChapterCount ? (
                    <span className="text-xs text-text-muted shrink-0">{g.plannedChapterCount} 章</span>
                  ) : null}

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditingGroup(g)}
                      className="p-1.5 rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
                      title="编辑"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    {g.type !== 'primary' && (
                      confirmDeleteId === g.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(g.id!)}
                            className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
                          >
                            确认删除
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-0.5 text-xs text-text-muted hover:text-text-primary transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(g.id!)}
                          className="p-1.5 rounded text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="删除世界"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>

            {groups.length === 0 && (
              <div className="text-center py-8 text-text-muted text-sm">
                暂无世界组，点击上方按钮添加
              </div>
            )}
          </section>

          {/* 世界关系 */}
          {groups.length > 1 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text-primary">世界关系</h3>
                <button
                  onClick={() => setShowLinkForm(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-bg-elevated text-text-secondary border border-border hover:text-accent hover:border-accent/50 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加关系
                </button>
              </div>

              {/* 关系创建表单 */}
              {showLinkForm && (
                <div className="flex items-center gap-2 flex-wrap p-3 bg-bg-surface border border-border rounded-lg">
                  <select
                    value={linkForm.from}
                    onChange={e => setLinkForm(f => ({ ...f, from: e.target.value ? Number(e.target.value) : '' }))}
                    className="px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                  >
                    <option value="">起点世界</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.icon} {g.name}</option>)}
                  </select>
                  <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
                  <select
                    value={linkForm.to}
                    onChange={e => setLinkForm(f => ({ ...f, to: e.target.value ? Number(e.target.value) : '' }))}
                    className="px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                  >
                    <option value="">目标世界</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.icon} {g.name}</option>)}
                  </select>
                  <select
                    value={linkForm.type}
                    onChange={e => setLinkForm(f => ({ ...f, type: e.target.value as WorldGroupLinkType }))}
                    className="px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                  >
                    {(Object.entries(WORLD_LINK_TYPE_LABELS) as [WorldGroupLinkType, string][]).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  <input
                    value={linkForm.name}
                    onChange={e => setLinkForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="通道名称（可选）"
                    className="px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent w-32"
                  />
                  <button
                    onClick={handleCreateLink}
                    disabled={linkForm.from === '' || linkForm.to === '' || linkForm.from === linkForm.to}
                    className="px-3 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors"
                  >
                    创建
                  </button>
                </div>
              )}

              {/* 关系流向图（自适应布局） */}
              <WorldRelationGraph onNodeClick={(g) => setEditingGroup(g)} />

              {links.length > 0 && (
                <div className="space-y-1">
                  {links.map(l => {
                    const from = groups.find(g => g.id === l.fromGroupId)
                    const to = groups.find(g => g.id === l.toGroupId)
                    return (
                      <div key={l.id} className="flex items-center gap-2 px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm group">
                        <span>{from?.icon} {from?.name}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
                        <span>{to?.icon} {to?.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-muted border border-border/50">
                          {WORLD_LINK_TYPE_LABELS[l.linkType]}
                        </span>
                        {l.name && <span className="text-text-muted text-xs">（{l.name}）</span>}
                        <button
                          onClick={() => deleteLink(l.id!)}
                          className="ml-auto p-1 rounded text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                          title="删除关系"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {/* 穿越总览 */}
          {groups.filter(g => g.type !== 'primary').length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-text-primary">穿越总览</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 text-xs font-medium text-text-muted">世界</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-text-muted">类型</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-text-muted">预计章节</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-text-muted">进入条件</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-text-muted">能力限制</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.filter(g => g.type !== 'primary').map(g => (
                      <tr key={g.id} className="border-b border-border/50 hover:bg-bg-hover/50 transition-colors">
                        <td className="py-2 px-3">
                          <span className="flex items-center gap-1.5">
                            <span>{g.icon}</span>
                            <span className="text-text-primary">{g.name}</span>
                          </span>
                        </td>
                        <td className="py-2 px-3 text-text-muted text-xs">{WORLD_GROUP_TYPE_LABELS[g.type]}</td>
                        <td className="py-2 px-3 text-text-muted">{g.plannedChapterCount || '—'}</td>
                        <td className="py-2 px-3 text-text-muted text-xs truncate max-w-[200px]">{g.entryCondition || '—'}</td>
                        <td className="py-2 px-3 text-text-muted text-xs truncate max-w-[200px]">{g.powerRestriction || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
