/**
 * Phase 25.3 — 重要地点面板
 * 树状图 / 列表双视图 + 多标签组合 + 树状父子层级
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Trash2, ChevronDown, ChevronRight, MapPin,
  GitBranch, List, Sparkles, Loader2, RotateCcw, AlertTriangle,
} from 'lucide-react'
import { useLocationStore } from '../../stores/location'
import type { Project, ImportantLocation, LocationTag } from '../../lib/types'
import { TAG_EMOJI } from '../../lib/types/location'
import LocationTagPicker from './LocationTagPicker'
import LocationTreeView from './LocationTreeView'
import { useAIConfigStore } from '../../stores/ai-config'
import { resolveRequestConfig } from '../../lib/ai/client'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../lib/ai/config-readiness'
import type { ExtractedLocation } from '../../lib/ai/adapters/structured-extract-adapter'
import ExtractionReviewPanel from '../shared/ExtractionReviewPanel'
import { resolveScopeLike } from '../../lib/world-engine/scope'
import {
  abandonLocationExtractionV1,
  adoptLocationExtractionCandidateV1,
  generateLocationExtractionCandidateV1,
  readPendingLocationExtractionCandidateV1,
  readRecoverableLocationExtractionV1,
  resumeLocationExtractionCandidateV1,
} from '../../lib/agent/run/location-extraction-durable'

interface Props {
  project: Project
}

export default function LocationPanel({ project }: Props) {
  const {
    locations, loading, loadAll,
    addLocation, updateLocation, deleteLocation,
    getTree,
  } = useLocationStore()
  const aiConfig = useAIConfigStore(s => s.config)

  const [view, setView] = useState<'tree' | 'list'>('tree')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [extractRunId, setExtractRunId] = useState<number | null>(null)
  const [candidateAction, setCandidateAction] = useState<'adopt' | 'abandon' | null>(null)
  const [recoverable, setRecoverable] = useState<{
    runId: number
    nextCallIndex: number
    totalCalls: number
    safeToResume: boolean
  } | null>(null)
  const [candidates, setCandidates] = useState<ExtractedLocation[]>([])
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set())

  useEffect(() => {
    loadAll(project.id!)
  }, [project.id, loadAll])

  // HARNESS-62: candidate and per-chunk progress survive component/browser interruption.
  useEffect(() => {
    let active = true
    setExtractRunId(null)
    setRecoverable(null)
    setCandidates([])
    setSelectedCandidates(new Set())
    void resolveScopeLike(project.id!).then(async scope => {
      const pending = await readPendingLocationExtractionCandidateV1({ scope })
      if (pending) return { pending, recoverable: null }
      return { pending: null, recoverable: await readRecoverableLocationExtractionV1({ scope }) }
    }).then(result => {
      if (!active) return
      if (result.pending) {
        setExtractRunId(result.pending.snapshot.run.id)
        setCandidates(result.pending.candidate.locations)
        setSelectedCandidates(new Set(
          result.pending.selectedIndexes ?? result.pending.candidate.locations.map((_, index) => index),
        ))
      } else if (result.recoverable) {
        setRecoverable({
          runId: result.recoverable.snapshot.run.id,
          nextCallIndex: result.recoverable.nextCallIndex,
          totalCalls: result.recoverable.totalCalls,
          safeToResume: result.recoverable.safeToResume,
        })
      }
    }).catch(error => {
      if (active) setExtractError(error instanceof Error ? error.message : '地点提取运行恢复失败')
    })
    return () => { active = false }
  }, [project.id])

  const tree = getTree()

  const handleAdd = useCallback(async (parentId: number | null = null) => {
    const id = await addLocation({
      projectId: project.id!,
      name: '新地点',
      tags: '[]',
      description: '',
      significance: '',
      parentId,
      sortOrder: locations.length,
    })
    setExpandedId(id)
  }, [project.id, addLocation, locations.length])

  const handleDelete = useCallback(async (id: number) => {
    await deleteLocation(id)
    if (expandedId === id) setExpandedId(null)
    setConfirmDeleteId(null)
  }, [deleteLocation, expandedId])

  const handleUpdateTags = useCallback((id: number, tags: LocationTag[]) => {
    updateLocation(id, { tags: JSON.stringify(tags) })
  }, [updateLocation])

  const parseTags = (tagsStr: string): LocationTag[] => {
    try { return JSON.parse(tagsStr || '[]') } catch { return [] }
  }

  const handleExtractLocations = async () => {
    const effectiveConfig = resolveRequestConfig(aiConfig, { category: 'location.extract' }).config
    if (!isAIConfigReady(effectiveConfig)) {
      setExtractError(getAIConfigRequiredMessage(effectiveConfig))
      return
    }
    setExtracting(true)
    setExtractError(null)
    setExtractRunId(null)
    setCandidates([])
    try {
      const generated = await generateLocationExtractionCandidateV1({
        scope: await resolveScopeLike(project.id!), aiConfig,
      })
      setExtractRunId(generated.snapshot.run.id)
      setRecoverable(null)
      setCandidates(generated.candidate.locations)
      setSelectedCandidates(new Set(generated.candidate.locations.map((_, index) => index)))
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : '地点提取失败')
      try {
        const recovery = await readRecoverableLocationExtractionV1({ scope: await resolveScopeLike(project.id!) })
        setRecoverable(recovery ? {
          runId: recovery.snapshot.run.id,
          nextCallIndex: recovery.nextCallIndex,
          totalCalls: recovery.totalCalls,
          safeToResume: recovery.safeToResume,
        } : null)
      } catch { /* Preserve the original model/extraction failure. */ }
    } finally {
      setExtracting(false)
    }
  }

  const handleResumeExtraction = async () => {
    if (!recoverable?.safeToResume) return
    const effectiveConfig = resolveRequestConfig(aiConfig, { category: 'location.extract' }).config
    if (!isAIConfigReady(effectiveConfig)) {
      setExtractError(getAIConfigRequiredMessage(effectiveConfig))
      return
    }
    setExtracting(true)
    setExtractError(null)
    try {
      const generated = await resumeLocationExtractionCandidateV1({
        scope: await resolveScopeLike(project.id!), runId: recoverable.runId, aiConfig,
      })
      setExtractRunId(generated.snapshot.run.id)
      setRecoverable(null)
      setCandidates(generated.candidate.locations)
      setSelectedCandidates(new Set(generated.candidate.locations.map((_, index) => index)))
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : '继续地点提取失败')
      try {
        const recovery = await readRecoverableLocationExtractionV1({ scope: await resolveScopeLike(project.id!) })
        setRecoverable(recovery ? {
          runId: recovery.snapshot.run.id,
          nextCallIndex: recovery.nextCallIndex,
          totalCalls: recovery.totalCalls,
          safeToResume: recovery.safeToResume,
        } : null)
      } catch { /* Preserve the original resume failure. */ }
    } finally {
      setExtracting(false)
    }
  }

  const handleAdoptLocations = async () => {
    if (extractRunId == null || candidateAction) return
    setCandidateAction('adopt')
    setExtractError(null)
    try {
      const scope = await resolveScopeLike(project.id!)
      await adoptLocationExtractionCandidateV1({
        scope, runId: extractRunId, selectedIndexes: [...selectedCandidates],
      })
      await loadAll(scope)
      setCandidates([])
      setSelectedCandidates(new Set())
      setExtractRunId(null)
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : '地点采纳与终验失败')
    } finally {
      setCandidateAction(null)
    }
  }

  const handleAbandonExtraction = async () => {
    const runId = extractRunId ?? recoverable?.runId
    if (candidateAction) return
    if (runId == null) {
      setCandidates([])
      setSelectedCandidates(new Set())
      setExtractError(null)
      return
    }
    setCandidateAction('abandon')
    setExtractError(null)
    try {
      await abandonLocationExtractionV1({ scope: await resolveScopeLike(project.id!), runId })
      setCandidates([])
      setSelectedCandidates(new Set())
      setExtractRunId(null)
      setRecoverable(null)
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : '放弃地点提取运行失败')
    } finally {
      setCandidateAction(null)
    }
  }

  // 递归渲染列表项
  const renderListItem = (loc: ImportantLocation, depth: number = 0) => {
    const isExpanded = expandedId === loc.id
    const tags = parseTags(loc.tags)
    const children = locations.filter(l => l.parentId === loc.id)
    const isConfirmingDelete = confirmDeleteId === loc.id

    return (
      <div key={loc.id}>
        <div
          className="border border-border rounded-lg bg-bg-surface overflow-hidden mb-2"
          style={{ marginLeft: depth * 24 }}
        >
          {/* 头部 */}
          <button
            onClick={() => setExpandedId(isExpanded ? null : loc.id!)}
            className="w-full flex items-center gap-2 px-4 py-3 hover:bg-bg-hover transition-colors"
          >
            {isExpanded
              ? <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />
              : <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />}
            <MapPin className="w-4 h-4 text-accent shrink-0" />
            <span className="text-sm font-medium text-text-primary flex-1 text-left truncate">
              {loc.name}
            </span>
            {/* 标签预览 */}
            <div className="flex items-center gap-1 shrink-0">
              {tags.slice(0, 3).map(tag => (
                <span
                  key={tag}
                  className="text-[10px] px-1.5 py-0.5 bg-bg-elevated text-text-muted rounded"
                  title={tag}
                >
                  {TAG_EMOJI[tag] || '📍'} {tag}
                </span>
              ))}
              {tags.length > 3 && (
                <span className="text-[10px] text-text-muted">+{tags.length - 3}</span>
              )}
            </div>
            {children.length > 0 && (
              <span className="text-[10px] text-text-muted bg-bg-elevated px-1.5 py-0.5 rounded shrink-0">
                {children.length} 子地点
              </span>
            )}
          </button>

          {/* 展开编辑 */}
          {isExpanded && (
            <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
              {/* 名称 + 父地点 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-muted mb-1">名称</label>
                  <input
                    value={loc.name}
                    onChange={e => updateLocation(loc.id!, { name: e.target.value })}
                    className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">上级地点</label>
                  <select
                    value={loc.parentId ?? ''}
                    onChange={e => updateLocation(loc.id!, { parentId: e.target.value ? Number(e.target.value) : null })}
                    className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
                  >
                    <option value="">（顶级）</option>
                    {locations
                      .filter(l => l.id !== loc.id)
                      .map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                  </select>
                </div>
              </div>

              {/* 标签 */}
              <div>
                <label className="block text-xs text-text-muted mb-1">地点标签（可多选组合）</label>
                <LocationTagPicker
                  selected={tags}
                  onChange={newTags => handleUpdateTags(loc.id!, newTags)}
                />
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-xs text-text-muted mb-1">描述</label>
                <textarea
                  value={loc.description}
                  onChange={e => updateLocation(loc.id!, { description: e.target.value })}
                  placeholder="地点的详细描述、外观、氛围…"
                  className="w-full h-20 p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
                />
              </div>

              {/* 剧情重要性 */}
              <div>
                <label className="block text-xs text-text-muted mb-1">剧情重要性</label>
                <textarea
                  value={loc.significance}
                  onChange={e => updateLocation(loc.id!, { significance: e.target.value })}
                  placeholder="此地点在故事中的作用、关键事件、与角色的关联…"
                  className="w-full h-16 p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
                />
              </div>

              {/* 操作栏 */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => handleAdd(loc.id!)}
                  className="flex items-center gap-1 px-3 py-1.5 text-accent hover:bg-accent/10 text-xs rounded transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加子地点
                </button>
                {isConfirmingDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-400">确认删除？子地点也会一并删除</span>
                    <button
                      onClick={() => handleDelete(loc.id!)}
                      className="px-2 py-1 text-xs text-white bg-red-500 rounded hover:bg-red-600 transition-colors"
                    >
                      确认
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2 py-1 text-xs text-text-muted hover:text-text-primary transition-colors"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(loc.id!)}
                    className="flex items-center gap-1 px-3 py-1.5 text-red-400 hover:bg-red-500/10 text-xs rounded transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    删除地点
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 子地点递归渲染 */}
        {children.map(child => renderListItem(child, depth + 1))}
      </div>
    )
  }

  // 顶层地点
  const topLevelLocations = locations.filter(l => l.parentId === null)

  if (loading) {
    return (
      <div className="max-w-4xl animate-pulse">
        <div className="h-8 bg-bg-elevated rounded w-48 mb-6" />
        <div className="h-64 bg-bg-elevated rounded" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-xl font-bold text-text-primary mb-1">📍 重要地点</h2>
      <p className="text-sm text-text-muted mb-4">
        管理故事中的重要场景地点，支持标签组合与树状层级
      </p>

      {/* 工具栏 */}
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-text-secondary">
          共 <span className="text-text-primary font-medium">{locations.length}</span> 个地点
        </div>
        <div className="flex items-center gap-2">
          {/* 视图切换 */}
          <div className="flex bg-bg-elevated rounded-lg p-0.5">
            <button
              onClick={() => setView('tree')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
                view === 'tree' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" /> 树状图
            </button>
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm transition-colors ${
                view === 'list' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <List className="w-3.5 h-3.5" /> 列表
            </button>
          </div>
          <button
            onClick={() => handleAdd(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加地点
          </button>
          <button
            onClick={handleExtractLocations}
            disabled={extracting || candidateAction != null || extractRunId != null || recoverable != null}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-accent/30 bg-accent/5 text-accent text-sm rounded-md hover:bg-accent/10 disabled:opacity-50 transition-colors"
          >
            {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {extracting ? '正在分析正文…' : 'AI 从正文提取'}
          </button>
        </div>
      </div>

      {recoverable && (
        <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <div className="flex items-start gap-2 text-sm text-text-primary">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div>
              <div className="font-medium">
                {recoverable.safeToResume ? '发现未完成的地点提取' : '上次调用的模型结果无法判定'}
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                {recoverable.safeToResume
                  ? `已完成 ${recoverable.nextCallIndex}/${recoverable.totalCalls} 个分块；继续时不会重复调用已完成分块。`
                  : '为防止重复计费或重复候选，不会自动重试；请放弃这次运行后重新提取。'}
              </p>
            </div>
          </div>
          {extractError && <p className="text-xs text-red-400">{extractError}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={handleAbandonExtraction}
              disabled={extracting || candidateAction != null}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary disabled:opacity-40"
            >
              {candidateAction === 'abandon' ? '正在放弃…' : '放弃这次运行'}
            </button>
            {recoverable.safeToResume && (
              <button
                onClick={handleResumeExtraction}
                disabled={extracting || candidateAction != null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-40"
              >
                {extracting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <RotateCcw className="h-3.5 w-3.5" />}
                继续提取
              </button>
            )}
          </div>
        </div>
      )}

      {(extracting || (extractError && !recoverable) || extractRunId != null || candidates.length > 0) && (
        <ExtractionReviewPanel
          title="地点候选"
          items={candidates}
          selected={selectedCandidates}
          loading={extracting}
          busy={candidateAction != null}
          error={extractError}
          onToggle={index => setSelectedCandidates(prev => {
            const next = new Set(prev)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
          })}
          onConfirm={handleAdoptLocations}
          onClose={handleAbandonExtraction}
          renderItem={item => (
            <div>
              <div className="font-medium text-sm text-text-primary">{item.name}</div>
              <p className="text-xs text-text-muted mt-0.5">{item.significance || item.description}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {item.tags.map(tag => <span key={tag} className="px-1.5 py-0.5 rounded bg-bg-elevated text-[10px] text-text-muted">{TAG_EMOJI[tag]} {tag}</span>)}
              </div>
            </div>
          )}
        />
      )}

      {/* 树状图视图 */}
      {view === 'tree' && (
        <div className="mb-6">
          <LocationTreeView
            tree={tree}
            onSelect={id => {
              setView('list')
              setExpandedId(id)
            }}
          />
          {locations.length > 0 && (
            <p className="text-xs text-text-muted mt-2 text-center">点击节点可跳转到列表编辑</p>
          )}
        </div>
      )}

      {/* 列表视图 */}
      {view === 'list' && (
        <div>
          {locations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
              <MapPin className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm mb-3">暂无地点</p>
              <button
                onClick={() => handleAdd(null)}
                className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors"
              >
                <Plus className="w-4 h-4" />
                添加第一个地点
              </button>
            </div>
          ) : (
            topLevelLocations.map(loc => renderListItem(loc))
          )}
        </div>
      )}
    </div>
  )
}
