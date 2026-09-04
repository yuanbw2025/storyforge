/**
 * Phase 35-a — 通用词条面板
 *
 * 三栏：领域分类树（左） → 词条列表（中） → 词条详情表单（右，由 fieldSchema 驱动）。
 * 支持内置分类播种、自定义分类增删、词条 CRUD、词条间 ref 关联。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Plus, Trash2, EyeOff, Eye, FolderPlus, Boxes, Settings2, X,
  Sparkles, Loader2,
} from 'lucide-react'
import { useCodexStore } from '../../stores/codex'
import {
  CODEX_DOMAIN_LABELS, filterCodexEntriesByWorld,
  type CodexDomain, type CodexCategory, type CodexEntry,
} from '../../lib/types/codex'
import type { Project } from '../../lib/types'
import { useDialog } from '../shared/Dialog'
import { useAIConfigStore } from '../../stores/ai-config'
import { useWorldGroupStore } from '../../stores/world-group'
import { resolveRequestConfig } from '../../lib/ai/client'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../lib/ai/config-readiness'
import type { ExtractedCodexEntry } from '../../lib/ai/adapters/structured-extract-adapter'
import { useToast } from '../shared/Toast'
import { resolveScopeLike } from '../../lib/workspace/scope'
import {
  abandonCodexExtractionV1,
  adoptCodexExtractionCandidateV1,
  generateCodexEnrichmentCandidateV1,
  generateCodexExtractionCandidateV1,
  readPendingCodexExtractionCandidateV1,
  readRecoverableCodexExtractionV1,
  resumeCodexExtractionCandidateV1,
} from '../../lib/agent/run/codex-extraction-durable'
import CodexCategoryFieldsEditor from './CodexCategoryFieldsEditor'
import CodexEntryDetail from './CodexEntryDetail'

interface Props {
  project: Project
  /** B3:嵌入自然/人文面板时锁定领域并隐藏顶部切换标签(独立面板不传=完整两栏切换) */
  fixedDomain?: CodexDomain
  /**
   * 锁定到指定内置分类(builtInKey 列表)——用于"世界观每个方面下面只显示对应那一类词条"。
   * 传 1 个 key:单分类模式(隐藏左侧分类树,只剩该类的词条)。
   * 传多个 key(如自然资源 mineral/herb/beast):只显示这几类,可在它们间切换。
   */
  fixedCategoryKeys?: string[]
  /** 嵌入模式:去掉外层标题/高度占满,适配面板内嵌 */
  embedded?: boolean
  /** 当前方面上方的整段全貌，作为 AI 拆分词条的默认来源。 */
  extractionSourceText?: string
}

const DOMAINS: CodexDomain[] = ['natural', 'humanity']

export default function CodexPanel({ project, fixedDomain, fixedCategoryKeys, embedded, extractionSourceText = '' }: Props) {
  const dialog = useDialog()
  const toast = useToast()
  const aiConfig = useAIConfigStore(s => s.config)
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)
  const worldGroups = useWorldGroupStore(s => s.groups)
  const projectId = project.id!
  const {
    categories, entries, loadAll,
    addCategory, deleteCategory, setCategoryHidden, updateCategory,
    addEntry, updateEntry, deleteEntry,
  } = useCodexStore()

  // 锁定单一分类:隐藏分类树,只展示该类词条
  const lockedKeys = fixedCategoryKeys
  const lockedSingle = (lockedKeys?.length ?? 0) === 1

  const [domainState, setDomain] = useState<CodexDomain>(fixedDomain ?? 'natural')
  const domain = fixedDomain ?? domainState
  const [activeCatId, setActiveCatId] = useState<number | null>(null)
  const [activeEntryId, setActiveEntryId] = useState<number | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  // B1:自定义字段管理弹窗
  const [showFieldsEditor, setShowFieldsEditor] = useState(false)
  // 词条排序方式:order=手动顺序 / importance=重要度降序 / pinyin=拼音首字母
  const [sortMode, setSortMode] = useState<'order' | 'importance' | 'pinyin'>('order')
  const [extractOpen, setExtractOpen] = useState(false)
  const [candidateOperation, setCandidateOperation] = useState<'extract' | 'enrich'>('extract')
  const [extractText, setExtractText] = useState('')
  const [supplementTags, setSupplementTags] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [candidates, setCandidates] = useState<ExtractedCodexEntry[]>([])
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set())
  const [selectionFrozen, setSelectionFrozen] = useState(false)
  const [extractRunId, setExtractRunId] = useState<number | null>(null)
  const [recoverable, setRecoverable] = useState<{
    runId: number
    nextCallIndex: number
    totalCalls: number
    safeToResume: boolean
  } | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)

  useEffect(() => { loadAll(projectId) }, [projectId, loadAll])

  const activeGroupBelongsToProject = worldGroups.some(group =>
    group.projectId === projectId && group.id === activeGroupId)
  const scopedWorldGroupId = project.enableMultiWorld
    ? (activeGroupBelongsToProject ? activeGroupId! : undefined)
    : null
  const scopeReady = scopedWorldGroupId !== undefined
  const scopedEntries = useMemo(
    () => scopeReady ? filterCodexEntriesByWorld(entries, scopedWorldGroupId) : [],
    [entries, scopeReady, scopedWorldGroupId],
  )

  // 当前领域的分类（按 order）。若锁定了 builtInKey 列表,则只取那几类(跨域亦可)。
  const domainCats = useMemo(
    () => {
      if (lockedKeys && lockedKeys.length) {
        return categories
          .filter(c => c.builtInKey && lockedKeys.includes(c.builtInKey))
          .sort((a, b) => lockedKeys.indexOf(a.builtInKey!) - lockedKeys.indexOf(b.builtInKey!))
      }
      return categories.filter(c => c.domain === domain).sort((a, b) => a.order - b.order)
    },
    [categories, domain, lockedKeys],
  )
  const visibleCats = useMemo(
    () => domainCats.filter(c => showHidden || !c.hidden),
    [domainCats, showHidden],
  )

  // 默认选中第一个可见分类
  useEffect(() => {
    if (activeCatId && visibleCats.some(c => c.id === activeCatId)) return
    setActiveCatId(visibleCats[0]?.id ?? null)
    setActiveEntryId(null)
  }, [visibleCats, activeCatId])

  const activeCat = categories.find(c => c.id === activeCatId) || null
  const catEntries = useMemo(() => {
    const list = scopedEntries.filter(e => e.categoryId === activeCatId)
    if (sortMode === 'importance') {
      return [...list].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || a.order - b.order)
    }
    if (sortMode === 'pinyin') {
      // localeCompare('zh') 按拼音排序,无需拼音库
      return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN'))
    }
    return [...list].sort((a, b) => a.order - b.order)
  }, [scopedEntries, activeCatId, sortMode])
  // 同分类内重名的词条名集合(用于"已有同名"提示)
  const dupNames = useMemo(() => {
    const count = new Map<string, number>()
    for (const e of scopedEntries) {
      if (e.categoryId !== activeCatId) continue
      const n = (e.name || '').trim()
      if (n) count.set(n, (count.get(n) ?? 0) + 1)
    }
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([k]) => k))
  }, [scopedEntries, activeCatId])
  const activeEntry = catEntries.find(e => e.id === activeEntryId) || null

  // ── 分类操作 ──
  const handleAddCategory = async () => {
    const name = (await dialog.prompt({
      title: `在「${CODEX_DOMAIN_LABELS[domain]}」下新增自定义分类`,
      placeholder: '输入分类名称',
    }))?.trim()
    if (!name) return
    const id = await addCategory({
      projectId, domain, parentId: null, name, icon: '📁',
      fieldSchema: '[]', hidden: false,
      order: domainCats.length,
    })
    setActiveCatId(id)
    setActiveEntryId(null)
  }

  const handleDeleteCategory = async (cat: CodexCategory) => {
    if (cat.builtInKey) return
    const ok = await dialog.confirm({
      title: `删除自定义分类「${cat.name}」？`,
      message: '其下所有世界中的词条也会被删除，此操作不可撤销。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!ok) return
    await deleteCategory(cat.id!)
  }

  // ── 词条操作 ──
  const handleAddEntry = async () => {
    if (!activeCatId) return
    if (!scopeReady) {
      toast.error('世界数据尚未加载完成，请稍后再试。')
      return
    }
    const id = await addEntry({
      projectId, categoryId: activeCatId,
      name: '新词条', summary: '', description: '',
      fields: '{}', refs: '{}',
      order: catEntries.length, worldGroupId: scopedWorldGroupId,
    })
    setActiveEntryId(id)
  }

  const handleDeleteEntry = async (entry: CodexEntry) => {
    const ok = await dialog.confirm({
      title: `删除词条「${entry.name}」？`,
      message: '此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!ok) return
    await deleteEntry(entry.id!)
    if (activeEntryId === entry.id) setActiveEntryId(null)
  }

  const openExtractor = (operation: 'extract' | 'enrich') => {
    if (!scopeReady) {
      toast.error('世界数据尚未加载完成，请稍后再试。')
      return
    }
    setCandidateOperation(operation)
    setExtractText(operation === 'extract' ? extractionSourceText : '')
    setCandidates([])
    setSelectedCandidates(new Set())
    setSelectionFrozen(false)
    setExtractRunId(null)
    setRecoverable(null)
    setExtractError(null)
    setExtractOpen(true)
  }

  useEffect(() => {
    if (!extractOpen || !activeCat?.id || !scopeReady) return
    let active = true
    void resolveScopeLike(projectId).then(async scope => {
      const filter = {
        scope, categoryId: activeCat.id!, worldGroupId: scopedWorldGroupId ?? null,
        operation: candidateOperation,
      }
      const pending = await readPendingCodexExtractionCandidateV1(filter)
      return { pending, recoverable: pending ? null : await readRecoverableCodexExtractionV1(filter) }
    }).then(result => {
      if (!active) return
      if (result.pending) {
        setExtractRunId(result.pending.snapshot.run.id)
        setCandidates(result.pending.candidate.entries)
        setExtractText((result.pending.candidate.plan.request.operation ?? 'extract') === 'extract'
          ? result.pending.candidate.plan.request.sourceText
          : result.pending.candidate.plan.request.authorRequest)
        setSupplementTags(result.pending.candidate.plan.request.supplementTags)
        setSelectedCandidates(new Set(
          result.pending.selectedIndexes ?? result.pending.candidate.entries.map((_, index) => index),
        ))
        setSelectionFrozen(result.pending.selectedIndexes != null)
      } else if (result.recoverable) {
        setRecoverable({
          runId: result.recoverable.snapshot.run.id,
          nextCallIndex: result.recoverable.nextCallIndex,
          totalCalls: result.recoverable.totalCalls,
          safeToResume: result.recoverable.safeToResume,
        })
        if (result.recoverable.request) {
          setExtractText((result.recoverable.request.operation ?? 'extract') === 'extract'
            ? result.recoverable.request.sourceText
            : result.recoverable.request.authorRequest ?? '')
          setSupplementTags(result.recoverable.request.supplementTags)
        }
      }
    }).catch(error => {
      if (active) setExtractError(error instanceof Error ? error.message : 'Codex 提取运行恢复失败')
    })
    return () => { active = false }
  }, [activeCat?.id, candidateOperation, extractOpen, projectId, scopeReady, scopedWorldGroupId])

  const reconcileExtractionState = async () => {
    if (!activeCat?.id || !scopeReady) return
    const scope = await resolveScopeLike(projectId)
    const filter = {
      scope, categoryId: activeCat.id, worldGroupId: scopedWorldGroupId ?? null,
      operation: candidateOperation,
    }
    const pending = await readPendingCodexExtractionCandidateV1(filter)
    if (pending) {
      setExtractRunId(pending.snapshot.run.id)
      setRecoverable(null)
      setCandidates(pending.candidate.entries)
      setExtractText((pending.candidate.plan.request.operation ?? 'extract') === 'extract'
        ? pending.candidate.plan.request.sourceText
        : pending.candidate.plan.request.authorRequest)
      setSupplementTags(pending.candidate.plan.request.supplementTags)
      setSelectedCandidates(new Set(
        pending.selectedIndexes ?? pending.candidate.entries.map((_, index) => index),
      ))
      setSelectionFrozen(pending.selectedIndexes != null)
      return
    }
    setExtractRunId(null)
    setCandidates([])
    setSelectedCandidates(new Set())
    setSelectionFrozen(false)
    const recovery = await readRecoverableCodexExtractionV1(filter)
    setRecoverable(recovery ? {
      runId: recovery.snapshot.run.id,
      nextCallIndex: recovery.nextCallIndex,
      totalCalls: recovery.totalCalls,
      safeToResume: recovery.safeToResume,
    } : null)
    if (recovery?.request) {
      setExtractText((recovery.request.operation ?? 'extract') === 'extract'
        ? recovery.request.sourceText
        : recovery.request.authorRequest ?? '')
      setSupplementTags(recovery.request.supplementTags)
    }
  }

  const handleExtractEntries = async () => {
    if (!activeCat || !extractText.trim()) return
    const effectiveConfig = resolveRequestConfig(aiConfig, {
      category: candidateOperation === 'extract' ? 'codex.extract' : 'codex.enrich',
    }).config
    if (!isAIConfigReady(effectiveConfig)) { toast.error(getAIConfigRequiredMessage(effectiveConfig)); return }
    setExtracting(true)
    setExtractError(null)
    try {
      const shared = {
        scope: await resolveScopeLike(projectId), aiConfig,
      }
      const generated = candidateOperation === 'extract'
        ? await generateCodexExtractionCandidateV1({
            ...shared,
            request: {
              categoryId: activeCat.id!, worldGroupId: scopedWorldGroupId ?? null,
              sourceText: extractText, supplementTags,
            },
          })
        : await generateCodexEnrichmentCandidateV1({
            ...shared,
            request: {
              categoryId: activeCat.id!, worldGroupId: scopedWorldGroupId ?? null,
              authorRequest: extractText, supplementTags,
            },
          })
      setExtractRunId(generated.snapshot.run.id)
      setRecoverable(null)
      setCandidates(generated.candidate.entries)
      setSelectedCandidates(new Set(generated.candidate.entries.map((_, index) => index)))
      setSelectionFrozen(false)
      if (!generated.candidate.entries.length) toast.info(candidateOperation === 'extract'
        ? 'AI 未从这段内容中识别出可独立登记的词条。'
        : 'AI 未提出可单独确认的新词条建议。')
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : 'Codex 词条提取失败')
      try {
        await reconcileExtractionState()
      } catch { /* Preserve original failure. */ }
    } finally {
      setExtracting(false)
    }
  }

  const handleResumeExtraction = async () => {
    if (!recoverable?.safeToResume || extracting) return
    setExtracting(true)
    setExtractError(null)
    try {
      const resumed = await resumeCodexExtractionCandidateV1({
        scope: await resolveScopeLike(projectId), runId: recoverable.runId, aiConfig,
      })
      setExtractRunId(resumed.snapshot.run.id)
      setRecoverable(null)
      setCandidates(resumed.candidate.entries)
      setSelectedCandidates(new Set(resumed.candidate.entries.map((_, index) => index)))
      setSelectionFrozen(false)
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : '继续 Codex 提取失败')
      try { await reconcileExtractionState() } catch { /* Preserve original failure. */ }
    } finally {
      setExtracting(false)
    }
  }

  const handleAdoptCandidates = async () => {
    if (!activeCat || !scopeReady || extractRunId == null) return
    setExtracting(true)
    setExtractError(null)
    let result: Awaited<ReturnType<typeof adoptCodexExtractionCandidateV1>>
    try {
      result = await adoptCodexExtractionCandidateV1({
        scope: await resolveScopeLike(projectId),
        runId: extractRunId,
        selectedIndexes: [...selectedCandidates],
      })
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : 'Codex 词条采纳失败')
      try { await reconcileExtractionState() } catch { /* Preserve original failure. */ }
      setExtracting(false)
      return
    }
    setExtractOpen(false)
    setExtractRunId(null)
    setCandidates([])
    setSelectionFrozen(false)
    try {
      await loadAll(projectId)
      toast.success(`已原子写入 ${result.written} 个词条。`)
    } catch {
      toast.error(`已原子写入 ${result.written} 个词条，但界面刷新失败；重新打开页面即可恢复。`)
    } finally {
      setExtracting(false)
    }
  }

  const handleAbandonExtraction = async (close = true) => {
    const runId = extractRunId ?? recoverable?.runId
    if (runId == null || extracting) return
    setExtracting(true)
    try {
      await abandonCodexExtractionV1({ scope: await resolveScopeLike(projectId), runId })
      setExtractRunId(null)
      setRecoverable(null)
      setCandidates([])
      setSelectedCandidates(new Set())
      setSelectionFrozen(false)
      setExtractError(null)
      if (close) setExtractOpen(false)
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : '放弃 Codex 提取失败')
    } finally {
      setExtracting(false)
    }
  }

  return (
    <div className={embedded
      ? `flex flex-col ${lockedSingle ? 'h-80' : 'h-[30rem]'} border border-border rounded-xl overflow-hidden`
      : 'h-full flex flex-col'}>
      {/* 顶部：领域切换(嵌入且锁定领域时隐藏;单分类锁定时整条隐藏) */}
      {!lockedSingle && (
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        {!fixedDomain && (
          <>
            <Boxes className="w-5 h-5 text-accent" />
            <h2 className="text-base font-semibold text-text-primary mr-2">设定词条</h2>
            <div className="flex rounded-lg bg-bg-elevated p-0.5">
              {DOMAINS.map(d => (
                <button
                  key={d}
                  onClick={() => { setDomain(d); setActiveEntryId(null) }}
                  className={`px-3 py-1 text-sm rounded-md transition ${
                    domain === d ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  {CODEX_DOMAIN_LABELS[d]}
                </button>
              ))}
            </div>
          </>
        )}
        {fixedDomain && <span className="text-sm font-medium text-text-secondary">📚 词条({CODEX_DOMAIN_LABELS[fixedDomain]})</span>}
        <button
          onClick={() => setShowHidden(v => !v)}
          className="ml-auto text-xs text-text-muted hover:text-text-primary inline-flex items-center gap-1"
          title="显示/隐藏被隐藏的分类"
        >
          {showHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          {showHidden ? '隐藏项已显示' : '显示隐藏项'}
        </button>
      </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* 左：分类列表(单分类锁定时隐藏) */}
        {!lockedSingle && (
        <div className="w-44 shrink-0 border-r border-border flex flex-col">
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {visibleCats.map(cat => (
              <div
                key={cat.id}
                onClick={() => { setActiveCatId(cat.id!); setActiveEntryId(null) }}
                className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition ${
                  activeCatId === cat.id ? 'bg-accent/10 text-accent' : 'hover:bg-bg-hover text-text-primary'
                } ${cat.hidden ? 'opacity-50' : ''}`}
              >
                <span>{cat.icon || '📁'}</span>
                <span className="truncate flex-1">{cat.name}</span>
                <span className="text-[10px] text-text-muted">
                  {scopedEntries.filter(e => e.categoryId === cat.id).length || ''}
                </span>
                {cat.builtInKey ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); setCategoryHidden(cat.id!, !cat.hidden) }}
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary"
                    title={cat.hidden ? '取消隐藏' : '隐藏此内置分类'}
                  >
                    {cat.hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat) }}
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400"
                    title="删除自定义分类"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {!lockedKeys && (
            <button
              onClick={handleAddCategory}
              className="m-2 px-2 py-1.5 text-xs rounded-lg border border-dashed border-border text-text-muted hover:text-accent hover:border-accent/50 inline-flex items-center justify-center gap-1"
            >
              <FolderPlus className="w-3.5 h-3.5" /> 新增分类
            </button>
          )}
        </div>
        )}

        {/* 中：词条列表 */}
        <div className="w-52 shrink-0 border-r border-border flex flex-col">
          {/* 排序下拉 */}
          <div className="px-2 pt-2 pb-1 flex items-center gap-1.5">
            <span className="text-[10px] text-text-muted shrink-0">排序</span>
            <select
              value={sortMode}
              onChange={e => setSortMode(e.target.value as typeof sortMode)}
              className="flex-1 text-[11px] bg-bg-elevated border border-border rounded px-1.5 py-1 text-text-secondary"
            >
              <option value="order">默认顺序</option>
              <option value="importance">按重要度</option>
              <option value="pinyin">按拼音首字母</option>
            </select>
          </div>
          <div className="flex-1 overflow-y-auto p-2 pt-1 space-y-0.5">
            {catEntries.length === 0 && (
              <p className="text-xs text-text-muted px-2 py-3 text-center">暂无词条</p>
            )}
            {catEntries.map(entry => (
              <div
                key={entry.id}
                onClick={() => setActiveEntryId(entry.id!)}
                className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition ${
                  activeEntryId === entry.id ? 'bg-accent/10 text-accent' : 'hover:bg-bg-hover text-text-primary'
                }`}
              >
                <span>{entry.icon || activeCat?.icon || '•'}</span>
                <span className="truncate flex-1">{entry.name || '未命名'}</span>
                {entry.name && dupNames.has(entry.name.trim()) && (
                  <span className="text-amber-400 shrink-0" title="本分类下有同名词条">⚠</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteEntry(entry) }}
                  className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="m-2 space-y-1.5">
            <button
              onClick={() => openExtractor('extract')}
              disabled={!activeCatId || !scopeReady}
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-accent/30 text-accent hover:bg-accent/10 disabled:opacity-40 inline-flex items-center justify-center gap-1"
            >
              <Sparkles className="w-3.5 h-3.5" /> AI 从内容拆分词条
            </button>
            <button
              onClick={() => openExtractor('enrich')}
              disabled={!activeCatId || !scopeReady}
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-violet-500/30 text-violet-400 hover:bg-violet-500/10 disabled:opacity-40 inline-flex items-center justify-center gap-1"
            >
              <Sparkles className="w-3.5 h-3.5" /> AI 补全新词条建议
            </button>
            <button
              onClick={handleAddEntry}
              disabled={!activeCatId || !scopeReady}
              className="w-full px-2 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40 inline-flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> 新建词条
            </button>
            {/* B1:管理本分类的专属字段(增删改字段 schema) */}
            <button
              onClick={() => setShowFieldsEditor(true)}
              disabled={!activeCat}
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-border text-text-secondary hover:text-accent hover:border-accent/50 disabled:opacity-40 inline-flex items-center justify-center gap-1"
              title="自定义本分类下词条的专属字段"
            >
              <Settings2 className="w-3.5 h-3.5" /> 管理字段
            </button>
          </div>
        </div>

        {/* 右：词条详情 */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {activeEntry && activeCat ? (
            <CodexEntryDetail
              key={activeEntry.id}
              entry={activeEntry}
              category={activeCat}
              allCategories={categories}
              allEntries={scopedEntries}
              nameDuplicate={!!activeEntry.name && dupNames.has(activeEntry.name.trim())}
              onChange={(patch) => updateEntry(activeEntry.id!, patch)}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted text-sm">
              {activeCat ? '从左侧选择或「新建词条」添加一个具体条目' : '请选择一个分类'}
            </div>
          )}
        </div>
      </div>

      {/* B1:自定义字段管理弹窗 — 编辑本分类的 fieldSchema(内置类也可改) */}
      {showFieldsEditor && activeCat && (
        <CodexCategoryFieldsEditor
          category={activeCat}
          onClose={() => setShowFieldsEditor(false)}
          onSave={(fieldSchema) => { updateCategory(activeCat.id!, { fieldSchema }); setShowFieldsEditor(false) }}
        />
      )}
      {extractOpen && activeCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-bg-surface border border-border rounded-xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-text-primary">
                  {candidateOperation === 'extract' ? 'AI 逐字证据拆分' : 'AI 创意补全建议'}「{activeCat.name}」
                </h3>
                <p className="text-xs text-text-muted">
                  {candidateOperation === 'extract'
                    ? '抽取只允许原文中有逐字引文的词条。'
                    : '补全可创造新内容，但会明确标记为“AI 新建建议”。'}
                  候选确认后才原子写入，两种运行分别确认。
                </p>
              </div>
              <button disabled={extracting} className="disabled:opacity-40" onClick={() => {
                if (extracting) return
                if (selectionFrozen) setExtractOpen(false)
                else if (extractRunId != null || recoverable) void handleAbandonExtraction(true)
                else setExtractOpen(false)
              }}><X className="w-4 h-4 text-text-muted" /></button>
            </div>
            <textarea value={extractText} onChange={e => setExtractText(e.target.value)} rows={8}
              disabled={extractRunId != null || recoverable != null}
              placeholder={candidateOperation === 'extract'
                ? '粘贴或编辑要拆分的整段设定内容'
                : '说明希望补全的方向，例如“为当前种族补充两个可推动剧情的民族分支”'}
              className="w-full p-3 bg-bg-base border border-border rounded-lg text-sm text-text-primary resize-y disabled:opacity-60" />
            <label className="flex items-start gap-2 text-xs text-text-secondary">
              <input type="checkbox" checked={supplementTags} onChange={e => setSupplementTags(e.target.checked)}
                disabled={extractRunId != null || recoverable != null} className="mt-0.5 accent-accent disabled:opacity-60" />
              <span>AI 补充词条标签 <span className="text-amber-400">⚠ 会增加少量 token 消耗</span></span>
            </label>
            <button onClick={handleExtractEntries} disabled={extracting || !extractText.trim() || extractRunId != null || recoverable != null}
              className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm disabled:opacity-40 inline-flex items-center gap-1.5">
              {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {extracting
                ? candidateOperation === 'extract' ? 'AI 拆分中…' : 'AI 补全中…'
                : candidateOperation === 'extract' ? '开始拆分' : '生成补全建议'}
            </button>
            {recoverable && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-text-secondary">
                <p>
                  已恢复分块进度 {recoverable.nextCallIndex}/{recoverable.totalCalls}。
                  {recoverable.safeToResume ? '可从下一分块继续，不重复已有模型调用。' : '模型结果不可判定，系统不会自动重试。'}
                </p>
                <div className="mt-2 flex gap-2">
                  {recoverable.safeToResume && (
                    <button onClick={() => void handleResumeExtraction()} disabled={extracting}
                      className="rounded bg-accent px-2.5 py-1 text-white disabled:opacity-40">继续提取</button>
                  )}
                  <button onClick={() => void handleAbandonExtraction(false)} disabled={extracting}
                    className="rounded border border-border px-2.5 py-1 text-text-muted disabled:opacity-40">放弃旧运行</button>
                </div>
              </div>
            )}
            {extractError && <p className="rounded bg-error/10 p-2 text-xs text-error">{extractError}</p>}
            {extractRunId != null && (
              <div className="space-y-2 border-t border-border pt-3">
                {candidates.length === 0 && (
                  <p className="rounded-lg border border-border bg-bg-base p-3 text-xs text-text-muted">
                    本次模型调用未识别出新增词条。确认后将保存零写入回执，正式词条不会变化。
                  </p>
                )}
                {selectionFrozen && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-text-secondary">
                    作者选择已冻结。此运行只可沿同一选择继续写入与终验，不会重复调用模型。
                  </p>
                )}
                {candidates.map((item, index) => (
                  <label key={`${item.name}-${index}`} className="flex gap-3 p-3 border border-border rounded-lg bg-bg-base">
                    <input type="checkbox" checked={selectedCandidates.has(index)} disabled={selectionFrozen} onChange={() => {
                      setSelectedCandidates(prev => {
                        const next = new Set(prev)
                        if (next.has(index)) next.delete(index); else next.add(index)
                        return next
                      })
                    }} className="mt-1 accent-accent" />
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-text-primary">{item.name}</div>
                      <div className="text-xs text-text-muted">{item.summary}</div>
                      {item.provenance === 'ai-created-suggestion' ? (
                        <div className="mt-1 text-[10px] text-violet-400">AI 新建建议 · 非原文抽取</div>
                      ) : item.evidenceQuotes?.length ? (
                        <div className="mt-1 space-y-0.5 text-[10px] text-emerald-400">
                          {item.evidenceQuotes.map((quote, quoteIndex) => (
                            <div key={quoteIndex}>原文证据：“{quote}”</div>
                          ))}
                        </div>
                      ) : null}
                      {item.tags.length > 0 && <div className="mt-1 text-[10px] text-accent">{item.tags.map(t => `#${t}`).join(' ')}</div>}
                    </div>
                  </label>
                ))}
                <div className="flex justify-end gap-2">
                  {!selectionFrozen && (
                    <button onClick={() => void handleAbandonExtraction(true)} disabled={extracting}
                      className="px-3 py-1.5 text-xs text-text-muted disabled:opacity-40">否决并关闭</button>
                  )}
                  <button onClick={handleAdoptCandidates}
                    disabled={(candidates.length > 0 && !selectedCandidates.size) || extracting}
                    className="px-3 py-1.5 text-xs bg-accent text-white rounded disabled:opacity-40">
                    {selectionFrozen
                      ? '继续写入与终验'
                      : candidates.length > 0 ? `写入所选 ${selectedCandidates.size} 项` : '确认无新增词条'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
