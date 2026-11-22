/**
 * Phase 35-a — 通用词条面板
 *
 * 三栏：领域分类树（左） → 词条列表（中） → 词条详情表单（右，由 fieldSchema 驱动）。
 * 支持内置分类播种、自定义分类增删、词条 CRUD、词条间 ref 关联。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Trash2, EyeOff, Eye, FolderPlus, Boxes, Settings2, X,
  Sparkles, Loader2,
} from 'lucide-react'
import { useCodexStore } from '../../stores/codex'
import {
  CODEX_DOMAIN_LABELS,
  parseFieldSchema, filterCodexEntriesByWorld,
  type CodexDomain, type CodexCategory, type CodexEntry,
} from '../../lib/types/codex'
import type { Project, WorkspaceScope } from '../../lib/types'
import { useDialog } from '../shared/Dialog'
import { useAIConfigStore } from '../../stores/ai-config'
import { useWorldGroupStore } from '../../stores/world-group'
import { resolveRequestConfig } from '../../lib/ai/client'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../lib/ai/config-readiness'
import type { ExtractedCodexEntry } from '../../lib/ai/adapters/structured-extract-adapter'
import { useToast } from '../shared/Toast'
import { resolveScopeLike } from '../../lib/workspace/scope'
import { db } from '../../lib/db/schema'
import { CodexExtractionAdmissionUnavailableV2 } from '../../lib/agent/run/codex-extraction-v2-contract'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import {
  abandonCodexExtractionV1,
  abandonCodexExtractionV2, adoptCodexExtractionCandidateV2, generateCodexExtractionCandidateV2,
  readPendingCodexExtractionCandidateV2, readRecoverableCodexExtractionV2, resumeCodexExtractionCandidateV2,
  saveCodexExtractionAuthorDraftV2,
  type BlockedCodexExtractionRunV2,
  adoptCodexExtractionCandidateV1,
  generateCodexEnrichmentCandidateV1,
  readPendingCodexExtractionCandidateV1,
  readRecoverableCodexExtractionV1,
  resumeCodexExtractionCandidateV1,
} from '../../lib/agent/run/codex-extraction-durable'
import CodexCategoryFieldsEditor from './CodexCategoryFieldsEditor'
import CodexEntryDetail from './CodexEntryDetail'

interface Props {
  /** Deprecated compatibility prop; ordinary new extraction uses frozen V2 admission. */
  experimentalExtractionV2?: boolean
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
  compact?: boolean
  /** Compatibility view: maintain existing legacy records without new production. */
  existingOnly?: boolean
  initialCategoryKey?: string
}

const DOMAINS: CodexDomain[] = ['natural', 'humanity']

export default function CodexPanel({ project, fixedDomain, fixedCategoryKeys, embedded, extractionSourceText = '', compact = false, existingOnly = false, initialCategoryKey }: Props) {
  const dialog = useDialog()
  const toast = useToast()
  const aiConfig = useAIConfigStore(s => s.config)
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)
  const worldGroups = useWorldGroupStore(s => s.groups)
  const projectId = project.id!
  const {
    categories, entries, loadAll, loading, loadError, loadedScope,
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
  const [showHidden, setShowHidden] = useState(existingOnly)
  // B1:自定义字段管理弹窗
  const [fieldsEditor, setFieldsEditor] = useState<{ category: CodexCategory; scope: NonNullable<typeof loadedScope> } | null>(null)
  // 词条排序方式:order=手动顺序 / importance=重要度降序 / pinyin=拼音首字母
  const [sortMode, setSortMode] = useState<'order' | 'importance' | 'pinyin'>('order')
  const [extractOpen, setExtractOpen] = useState(false)
  const [extractSessionEpoch, setExtractSessionEpoch] = useState(0)
  const [candidateOperation, setCandidateOperation] = useState<'extract' | 'enrich'>('extract')
  const [extractText, setExtractText] = useState('')
  const [supplementTags, setSupplementTags] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [admitting, setAdmitting] = useState(false)
  const [candidates, setCandidates] = useState<ExtractedCodexEntry[]>([])
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set())
  const [selectionFrozen, setSelectionFrozen] = useState(false)
  const [extractRunId, setExtractRunId] = useState<number | null>(null)
  const [recoverable, setRecoverable] = useState<{
    version?: 2
    canReadOriginal?: boolean
    runId: number
    nextCallIndex: number
    totalCalls: number
    safeToResume: boolean
    requiresNewRequestBinding?: boolean
  } | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [blockedRuns, setBlockedRuns] = useState<BlockedCodexExtractionRunV2[]>([])
  const [candidateVersion, setCandidateVersion] = useState<1 | 2>(1)
  const [draftDirty, setDraftDirty] = useState(false)
  const [authorEdited, setAuthorEdited] = useState<Set<number>>(new Set())
  const extractionEpoch = useRef(0)
  const [v2Prefix, setV2Prefix] = useState<number | null>(null)
  const extractionOwner = useRef<WorkspaceScope | null>(null)
  const generationAbort = useRef<AbortController | null>(null)
  const extractionView = useRef({ project, loadedScope, loading, loadError })
  extractionView.current = { project, loadedScope, loading, loadError }
  const newStartAdmission = useRef<{ operation: 'extract' | 'enrich'; version: 1 | 2; scope: WorkspaceScope } | null>(null)
  const pendingAdmission = useRef<{ epoch: number; scope: WorkspaceScope } | null>(null)
  const assertExtractionScope = useCallback(async (expected: WorkspaceScope) => {
    const check = () => {
      const view = extractionView.current
      if (view.loading || view.loadError || [expected.projectId, expected.worldId, expected.workId].some(id => !Number.isSafeInteger(id) || id < 1)
        || view.project.id !== expected.projectId || view.project.activeWorldId !== expected.worldId || view.project.activeWorkId !== expected.workId
        || view.loadedScope?.projectId !== expected.projectId || view.loadedScope.worldId !== expected.worldId || view.loadedScope.workId !== expected.workId) {
        throw new Error('请回到已加载的原作品再处理；输入和已保存候选仍保留，不创建或转挂运行。')
      }
    }
    check()
    const actual = await resolveScopeLike({ ...expected })
    check()
    if (actual.projectId !== expected.projectId || actual.worldId !== expected.worldId || actual.workId !== expected.workId) throw new Error('原作品作用域已变化。')
    const storedProject = await db.projects.get(expected.projectId)
    check()
    if (storedProject?.activeWorldId !== expected.worldId || storedProject.activeWorkId !== expected.workId) throw new Error('原作品活动指针已变化；输入保留，不创建运行。')
    return { ...expected }
  }, [])
  const extractionScope = useCallback(async () => {
    const original = extractionOwner.current ?? extractionView.current.loadedScope
    if (!original) throw new Error('当前入口没有已核验的原作品；输入保留，不创建运行。')
    const expected = await assertExtractionScope({ ...original })
    extractionOwner.current = expected
    return expected
  }, [assertExtractionScope])
  useEffect(() => {
    const original = pendingAdmission.current?.scope ?? extractionOwner.current
    if (original && (original.projectId !== projectId || original.worldId !== project.activeWorldId || original.workId !== project.activeWorkId)) {
      extractionEpoch.current++
      pendingAdmission.current = null
      newStartAdmission.current = null
      setAdmitting(false)
      generationAbort.current?.abort()
      setExtractError('作品已切换；本页输入不会转挂新作品，未保存的编辑请先复制保留。')
    }
  }, [projectId, project.activeWorldId, project.activeWorkId])

  const authorScope = useMemo(() => project.activeWorldId && project.activeWorkId
    ? { projectId, worldId: project.activeWorldId, workId: project.activeWorkId } : projectId,
  [projectId, project.activeWorldId, project.activeWorkId])
  useEffect(() => { void loadAll(authorScope) }, [authorScope, loadAll])
  const [manualError, setManualError] = useState('')
  const [manualBusy, setManualBusy] = useState(false)
  const perform = async (action: () => void | Promise<void>) => {
    if (manualBusy) return
    setManualBusy(true); setManualError('')
    try { await flushPendingEditsV1(); await action() }
    catch (cause) { setManualError(cause instanceof Error ? cause.message : '词条操作失败，输入已保留。') }
    finally { setManualBusy(false) }
  }
  const ownerReady = loadedScope?.projectId === projectId
    && (typeof authorScope === 'number' || loadedScope.worldId === authorScope.worldId)
  const dataReady = ownerReady && !loading && !loadError


  const activeGroupBelongsToProject = worldGroups.some(group =>
    group.projectId === projectId && group.id === activeGroupId)
  const scopedWorldGroupId = project.enableMultiWorld
    ? (activeGroupBelongsToProject ? activeGroupId! : undefined)
    : null
  const scopeReady = dataReady && scopedWorldGroupId !== undefined
  const scopedEntries = useMemo(
    () => ownerReady && scopedWorldGroupId !== undefined ? filterCodexEntriesByWorld(entries, scopedWorldGroupId) : [],
    [entries, ownerReady, scopedWorldGroupId],
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
    setActiveCatId((visibleCats.find(category => category.builtInKey === initialCategoryKey) ?? visibleCats[0])?.id ?? null)
    setActiveEntryId(null)
  }, [visibleCats, activeCatId, initialCategoryKey])

  const activeCat = categories.find(c => c.id === activeCatId) || null
  const catEntries = useMemo(() => {
    const list = scopedEntries.filter(e => e.categoryId === activeCatId)
    if (sortMode === 'importance') {
      return [...list].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || a.order - b.order)
    }
    if (sortMode === 'pinyin') {
      // localeCompare('zh') 按拼音排序,无需拼音库
      return [...list].sort((a, b) => (typeof a.name === 'string' ? a.name : '').localeCompare(typeof b.name === 'string' ? b.name : '', 'zh-Hans-CN'))
    }
    return [...list].sort((a, b) => a.order - b.order)
  }, [scopedEntries, activeCatId, sortMode])
  // 同分类内重名的词条名集合(用于"已有同名"提示)
  const dupNames = useMemo(() => {
    const count = new Map<string, number>()
    for (const e of scopedEntries) {
      if (e.categoryId !== activeCatId) continue
      const n = typeof e.name === 'string' ? e.name.trim() : ''
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
      message: '当前世界中，该分类及子分类下的所有词条也会被删除（包括各世界组），此操作不可撤销。',
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

  const openExtractor = async (operation: 'extract' | 'enrich') => {
    if (extracting || admitting) return
    if (operation === 'extract' && typeof extractionSourceText !== 'string') {
      toast.error('拆分来源文本格式异常，请先恢复上游字段。')
      return
    }
    if (!scopeReady) {
      toast.error('世界数据尚未加载完成，请稍后再试。')
      return
    }
    const epoch = ++extractionEpoch.current
    newStartAdmission.current = null
    setAdmitting(true)
    let owner: WorkspaceScope
    try {
      const loaded = extractionView.current.loadedScope
      if (!loaded) throw new Error('当前入口没有原作品；输入保留，不创建运行。')
      pendingAdmission.current = { epoch, scope: { ...loaded } }
      owner = await assertExtractionScope({ ...loaded })
    } catch (error) {
      if (epoch === extractionEpoch.current) toast.error(error instanceof Error ? error.message : '原作品尚未就绪，输入已保留。')
      return
    } finally {
      if (pendingAdmission.current?.epoch === epoch) pendingAdmission.current = null
      if (epoch === extractionEpoch.current) setAdmitting(false)
    }
    if (epoch !== extractionEpoch.current) return
    const admission = { operation, version: operation === 'extract' ? 2 as const : 1 as const, scope: Object.freeze({ ...owner }) }
    newStartAdmission.current = Object.freeze(admission)
    setExtractSessionEpoch(epoch)
    extractionOwner.current = { ...owner }
    setAuthorEdited(new Set())
    setCandidateVersion(admission.version)
    setDraftDirty(false)
    setV2Prefix(null)
    setBlockedRuns([])
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

  const reconciliationCategoryId = activeCat?.id
  const reconcileExtractionState = useCallback(async (options?: { stillCurrent?: () => boolean; preserveLocalDraft?: boolean }) => {
    const epoch = extractionEpoch.current
    const stillCurrent = () => epoch === extractionEpoch.current && (options?.stillCurrent?.() ?? true)
    if (!reconciliationCategoryId || !scopeReady) return
    const scope = await extractionScope()
    if (!stillCurrent()) return
    const filter = { scope, categoryId: reconciliationCategoryId, worldGroupId: scopedWorldGroupId ?? null }
    if (candidateOperation === 'extract') {
      const blocked = new Map<number, BlockedCodexExtractionRunV2>()
      const lookup = { onBlockedRun: (run: BlockedCodexExtractionRunV2) => { blocked.set(run.runId, run) } }
      const pending = await readPendingCodexExtractionCandidateV2(filter, lookup)
      if (!stillCurrent()) return
      setBlockedRuns([...blocked.values()])
      if (pending?.candidate) {
        setCandidateVersion(2); setExtractRunId(pending.snapshot.run.id); setRecoverable(null)
        if (options?.preserveLocalDraft && !pending.selectionFrozen) {
          setSelectionFrozen(false); setV2Prefix(pending.snapshot.projection.lastSequence); return
        }
        setCandidates(pending.draft?.entries ?? pending.candidate.entries)
        setAuthorEdited(new Set((pending.draft?.editPaths ?? []).map(path => Number(path.split('.')[1]))))
        setExtractText(pending.materials.source.rawText); setSupplementTags(pending.materials.root.supplementTags)
        setSelectedCandidates(new Set(pending.intent?.review.selectedIndexes ?? pending.candidate.entries.map((_, index) => index)))
        setSelectionFrozen(pending.selectionFrozen); setV2Prefix(pending.snapshot.projection.lastSequence); setDraftDirty(false)
        return
      }
      const recovery = await readRecoverableCodexExtractionV2(filter, lookup)
      if (!stillCurrent()) return
      setBlockedRuns([...blocked.values()])
      if (recovery) {
        setCandidateVersion(2); setExtractRunId(null); setCandidates([]); setSelectionFrozen(false)
        setExtractText(recovery.materials.source.rawText); setSupplementTags(recovery.materials.root.supplementTags)
        const pendingCalls = recovery.calls.filter(call => !recovery.results.some(result => result.body.callId === call.body.callId))
        const canPostprocess = (call: typeof pendingCalls[number]) => recovery.responses.some(row => row.body.callId === call.body.callId
          && ['complete','incomplete'].includes(row.body.response.completion))
        const unknownHTTP = pendingCalls.some(call => !call.body.nativeRequest && !canPostprocess(call))
        setRecoverable({ version: 2, runId: recovery.snapshot.run.id, nextCallIndex: recovery.results.length,
          totalCalls: recovery.plan.frames.length, safeToResume: !unknownHTTP && ['running','planned'].includes(recovery.snapshot.projection.state),
          canReadOriginal: pendingCalls.some(call => Boolean(call.body.nativeRequest)), requiresNewRequestBinding: false })
        setV2Prefix(recovery.snapshot.projection.lastSequence)
        return
      }
    }
    const legacyFilter = { ...filter, operation: candidateOperation }
    const pending = await readPendingCodexExtractionCandidateV1(legacyFilter)
    if (!stillCurrent()) return
    if (pending) {
      setCandidateVersion(1); setExtractRunId(pending.snapshot.run.id); setRecoverable(null); setCandidates(pending.candidate.entries)
      setExtractText((pending.candidate.plan.request.operation ?? 'extract') === 'extract' ? pending.candidate.plan.request.sourceText : pending.candidate.plan.request.authorRequest)
      setSupplementTags(pending.candidate.plan.request.supplementTags)
      setSelectedCandidates(new Set(pending.selectedIndexes ?? pending.candidate.entries.map((_, index) => index)))
      setSelectionFrozen(pending.selectedIndexes != null)
      return
    }
    setExtractRunId(null); setCandidates([]); setSelectedCandidates(new Set()); setSelectionFrozen(false)
    const recovery = await readRecoverableCodexExtractionV1(legacyFilter)
    if (!stillCurrent()) return
    setRecoverable(recovery ? { runId: recovery.snapshot.run.id, nextCallIndex: recovery.nextCallIndex, totalCalls: recovery.totalCalls,
      safeToResume: recovery.safeToResume && !recovery.requiresNewRequestBinding, requiresNewRequestBinding: recovery.requiresNewRequestBinding } : null)
    if (recovery?.request) {
      setCandidateVersion(1)
      setExtractText((recovery.request.operation ?? 'extract') === 'extract' ? recovery.request.sourceText : recovery.request.authorRequest ?? '')
      setSupplementTags(recovery.request.supplementTags)
    }
  }, [reconciliationCategoryId, candidateOperation, extractionScope, scopeReady, scopedWorldGroupId])
  useEffect(() => {
    if (!extractOpen || !reconciliationCategoryId || !scopeReady) return
    const epoch = extractionEpoch.current
    let active = true
    // Read-only consumers have their own immutable scope/ref checks. React's
    // epoch/cleanup suppress stale view updates without altering durable data.
    void reconcileExtractionState({ stillCurrent: () => active }).catch(error => { if (active && epoch === extractionEpoch.current) setExtractError(error instanceof Error ? error.message : 'Codex 提取运行恢复失败') })
    return () => { active = false }
  }, [extractOpen, extractSessionEpoch, reconciliationCategoryId, reconcileExtractionState, scopeReady, projectId, project.activeWorldId, project.activeWorkId, loadedScope?.projectId, loadedScope?.worldId, loadedScope?.workId])

  const blocksCurrentExtraction = candidateOperation === 'extract' && blockedRuns.some(run => !run.target
    || run.target.categoryId === activeCatId && run.target.worldGroupId === (scopedWorldGroupId ?? null))
  const handleExtractEntries = async () => {
    if (admitting || pendingAdmission.current || extracting || !activeCat || !extractText.trim() || blocksCurrentExtraction) return
    const effectiveConfig = resolveRequestConfig(aiConfig, {
      category: candidateOperation === 'extract' ? 'codex.extract' : 'codex.enrich',
    }).config
    if (!isAIConfigReady(effectiveConfig)) { toast.error(getAIConfigRequiredMessage(effectiveConfig)); return }
    // A new dispatch owns the view; an older empty lookup cannot erase its candidate.
    const epoch = ++extractionEpoch.current
    setExtracting(true)
    setExtractError(null)
    try {
      const admission = newStartAdmission.current
      if (!admission || admission.operation !== candidateOperation || admission.version !== (candidateOperation === 'extract' ? 2 : 1)) throw new Error('缺少本次新请求授权；输入已保留，不借用旧授权或降级发送。')
      if (candidateOperation === 'extract') {
        // Re-read before either V1 or V2 starts. A readonly lookup failure is
        // never converted into permission to replace a possibly paid request.
        const scope = await extractionScope(), blocked: BlockedCodexExtractionRunV2[] = []
        const filter = { scope, categoryId: activeCat.id!, worldGroupId: scopedWorldGroupId ?? null }
        const lookup = { onBlockedRun: (run: BlockedCodexExtractionRunV2) => { blocked.push(run) } }
        const pending = await readPendingCodexExtractionCandidateV2(filter, lookup)
        const recovery = await readRecoverableCodexExtractionV2(filter, lookup)
        const legacyPending = await readPendingCodexExtractionCandidateV1({ ...filter, operation: 'extract' })
        const legacyRecovery = await readRecoverableCodexExtractionV1({ ...filter, operation: 'extract' })
        await extractionScope()
        if (epoch !== extractionEpoch.current) return
        setBlockedRuns([...new Map(blocked.map(run => [run.runId, run])).values()])
        if (pending || recovery || legacyPending || legacyRecovery || blocked.some(run => !run.target || run.target.categoryId === filter.categoryId && run.target.worldGroupId === filter.worldGroupId)) {
          // This page has not dispatched: preserve its edited input rather than
          // auto-restoring a different tab's paid source over it.
          setExtractError('原提取运行尚未处理完毕或证据待核验；本页输入与原件已保留，不重新发送。')
          return
        }
      }
      if (candidateOperation === 'extract') {
        const frozenScope = await assertExtractionScope(admission.scope)
        if (epoch !== extractionEpoch.current) return
        const controller = new AbortController(); generationAbort.current = controller
        const generated = await generateCodexExtractionCandidateV2({ scope: frozenScope, aiConfig,
          request: { categoryId: activeCat.id!, worldGroupId: scopedWorldGroupId ?? null, sourceText: extractText, supplementTags }, signal: controller.signal })
        if (epoch !== extractionEpoch.current) return
        setCandidateVersion(2); setExtractRunId(generated.snapshot.run.id); setRecoverable(null); setCandidates(generated.candidate.entries)
        setSelectedCandidates(new Set(generated.candidate.entries.map((_, index) => index))); setSelectionFrozen(false)
        setV2Prefix(generated.snapshot.projection.lastSequence); setDraftDirty(false)
        return
      }
      const shared = {
        scope: await extractionScope(), aiConfig,
      }
      const generated = await generateCodexEnrichmentCandidateV1({
        ...shared,
        request: { categoryId: activeCat.id!, worldGroupId: scopedWorldGroupId ?? null, authorRequest: extractText, supplementTags },
      })
      if (epoch !== extractionEpoch.current) return
      setExtractRunId(generated.snapshot.run.id)
      setRecoverable(null)
      setCandidates(generated.candidate.entries)
      setSelectedCandidates(new Set(generated.candidate.entries.map((_, index) => index)))
      setSelectionFrozen(false)
      if (!generated.candidate.entries.length) toast.info('AI 未提出可单独确认的新词条建议。')
    } catch (error) {
      if (epoch !== extractionEpoch.current) return
      setExtractError(error instanceof Error ? error.message : 'Codex 词条提取失败')
      if (error instanceof CodexExtractionAdmissionUnavailableV2) return
      try {
        await reconcileExtractionState()
      } catch { /* Preserve original failure. */ }
    } finally {
      generationAbort.current = null
      setExtracting(false)
    }
  }

  const handleResumeExtraction = async () => {
    if (!recoverable || (!recoverable.safeToResume && !recoverable.canReadOriginal) || extracting) return
    const epoch = extractionEpoch.current
    setExtracting(true)
    setExtractError(null)
    try {
      if (recoverable.version === 2) {
        await resumeCodexExtractionCandidateV2({ scope: await extractionScope(), runId: recoverable.runId, aiConfig })
        if (epoch !== extractionEpoch.current) return
        await reconcileExtractionState()
        return
      }
      const resumed = await resumeCodexExtractionCandidateV1({
        scope: await extractionScope(), runId: recoverable.runId, aiConfig,
      })
      if (epoch !== extractionEpoch.current) return
      setExtractRunId(resumed.snapshot.run.id)
      setRecoverable(null)
      setCandidates(resumed.candidate.entries)
      setSelectedCandidates(new Set(resumed.candidate.entries.map((_, index) => index)))
      setSelectionFrozen(false)
    } catch (error) {
      if (epoch !== extractionEpoch.current) return
      setExtractError(error instanceof Error ? error.message : '继续 Codex 提取失败')
      try { await reconcileExtractionState() } catch { /* Preserve original failure. */ }
    } finally {
      setExtracting(false)
    }
  }

  const handleAdoptCandidates = async () => {
    if (!activeCat || !scopeReady || extractRunId == null || extracting) return
    const epoch = extractionEpoch.current
    setExtracting(true)
    if (candidateVersion === 2) setSelectionFrozen(true)
    setExtractError(null)
    let result: Awaited<ReturnType<typeof adoptCodexExtractionCandidateV1>>
    try {
      const frozenScope = await extractionScope()
      result = candidateVersion === 2 ? await adoptCodexExtractionCandidateV2({ scope: frozenScope, runId: extractRunId,
        selectedIndexes: [...selectedCandidates], entries: structuredClone(candidates) }) : await adoptCodexExtractionCandidateV1({
        scope: frozenScope, runId: extractRunId, selectedIndexes: [...selectedCandidates] })
    } catch (error) {
      if (epoch !== extractionEpoch.current) { setExtracting(false); return }
      setExtractError(error instanceof Error ? error.message : 'Codex 词条采纳失败')
      try { await reconcileExtractionState({ preserveLocalDraft: candidateVersion === 2 }) } catch { /* Preserve original failure. */ }
      setExtracting(false)
      return
    }
    if (epoch !== extractionEpoch.current) { setExtracting(false); return }
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
    if (candidateVersion === 2 && draftDirty && !await dialog.confirm({ title: '作者稿尚未保存',
      message: '关闭后本页未保存的编辑会丢失；已保存的原答和草稿仍保留。', confirmText: '放弃本页编辑', tone: 'danger' })) return
    const original = extractionOwner.current
    if (close && original && (original.worldId !== project.activeWorldId || original.workId !== project.activeWorkId)) {
      setExtractOpen(false); return
    }
    const epoch = extractionEpoch.current
    setExtracting(true)
    try {
      if (candidateVersion === 2) {
        await abandonCodexExtractionV2({ scope: await extractionScope(), runId })
      } else {
        await abandonCodexExtractionV1({ scope: await extractionScope(), runId })
      }
      if (epoch !== extractionEpoch.current) return
      setExtractRunId(null)
      setRecoverable(null)
      setCandidates([])
      setSelectedCandidates(new Set())
      setSelectionFrozen(false)
      setExtractError(null)
      if (close) setExtractOpen(false)
    } catch (error) {
      if (epoch !== extractionEpoch.current) return
      setExtractError(error instanceof Error ? error.message : '放弃 Codex 提取失败')
    } finally {
      setExtracting(false)
    }
  }

  const updateCandidateDraft = (index: number, patch: Partial<ExtractedCodexEntry>) => {
    if (candidateVersion !== 2 || selectionFrozen || extracting) return
    setCandidates(previous => previous.map((entry, at) => at === index ? { ...entry, ...patch } : entry))
    setAuthorEdited(previous => new Set([...previous, index])); setDraftDirty(true)
  }
  const handleSaveCandidateDraft = async () => {
    if (candidateVersion !== 2 || selectionFrozen || extracting || extractRunId == null || v2Prefix == null) return
    const epoch = extractionEpoch.current
    setExtracting(true); setExtractError(null)
    try {
      const saved = await saveCodexExtractionAuthorDraftV2({ scope: await extractionScope(), runId: extractRunId,
        expectedLastSequence: v2Prefix, entries: structuredClone(candidates), selectedIndexes: [...selectedCandidates] })
      if (epoch !== extractionEpoch.current) return
      setCandidates(saved.draft.entries); setV2Prefix(saved.snapshot.projection.lastSequence); setDraftDirty(false)
      setAuthorEdited(new Set(saved.draft.editPaths.map(path => Number(path.split('.')[1]))))
    } catch (error) { if (epoch === extractionEpoch.current) setExtractError(error instanceof Error ? error.message : '作者稿未保存，请保留本页编辑。') }
    finally { setExtracting(false) }
  }

  return (
    <div className={embedded
      ? `flex min-w-0 flex-col ${compact ? 'max-h-[40rem] overflow-y-auto' : lockedSingle ? 'h-80 overflow-hidden' : 'h-[30rem] overflow-hidden'} border border-border rounded-xl`
      : 'h-full flex flex-col'}>
      {loadError && <div role="alert" className="p-2 text-xs text-red-400">词条读取失败：{loadError}
        <button type="button" onClick={() => { void loadAll(authorScope) }} className="ml-2 underline">重新读取词条</button>
      </div>}
      {manualError && <p role="alert" className="p-2 text-xs text-red-400">{manualError}</p>}
      <div className="contents" inert={!dataReady}>
      {/* 顶部：领域切换(嵌入且锁定领域时隐藏;单分类锁定时整条隐藏) */}
      {!lockedSingle && (
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border">
        {!fixedDomain && !lockedKeys && (
          <>
            <Boxes className="w-5 h-5 text-accent" />
            <h2 className="text-base font-semibold text-text-primary mr-2">设定词条</h2>
            <div className="flex rounded-lg bg-bg-elevated p-0.5">
              {DOMAINS.map(d => (
                <button
                  key={d}
                  onClick={() => { void perform(() => { setDomain(d); setActiveEntryId(null) }) }}
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

      <div className={compact ? 'flex flex-col min-w-0' : 'flex-1 flex min-h-0'}>
        {/* 左：分类列表(单分类锁定时隐藏) */}
        {!lockedSingle && (
        <div className={compact ? 'min-w-0 border-b border-border flex flex-col' : 'w-44 shrink-0 border-r border-border flex flex-col'}>
          <div className={compact ? 'flex flex-wrap gap-1 p-2 max-h-40 overflow-y-auto' : 'flex-1 overflow-y-auto p-2 space-y-0.5'}>
            {visibleCats.map(cat => (
              <div
                key={cat.id}
                onClick={() => { void perform(() => { setActiveCatId(cat.id!); setActiveEntryId(null) }) }}
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
                    onClick={(e) => { e.stopPropagation(); void perform(() => setCategoryHidden(cat.id!, !cat.hidden)) }}
                    className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary"
                    title={cat.hidden ? '取消隐藏' : '隐藏此内置分类'}
                  >
                    {cat.hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); void perform(() => handleDeleteCategory(cat)) }}
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
              onClick={() => { void perform(handleAddCategory) }}
              className="m-2 px-2 py-1.5 text-xs rounded-lg border border-dashed border-border text-text-muted hover:text-accent hover:border-accent/50 inline-flex items-center justify-center gap-1"
            >
              <FolderPlus className="w-3.5 h-3.5" /> 新增分类
            </button>
          )}
        </div>
        )}

        {/* 中：词条列表 */}
        <div className={compact ? 'min-w-0 border-b border-border flex flex-col' : 'w-52 shrink-0 border-r border-border flex flex-col'}>
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
                onClick={() => { void perform(() => setActiveEntryId(entry.id!)) }}
                className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition ${
                  activeEntryId === entry.id ? 'bg-accent/10 text-accent' : 'hover:bg-bg-hover text-text-primary'
                }`}
              >
                <span>{typeof entry.icon === 'string' ? entry.icon : activeCat?.icon || '•'}</span>
                <span className="truncate flex-1">{typeof entry.name === 'string' ? entry.name || '未命名' : '名称格式异常'}</span>
                {typeof entry.name === 'string' && entry.name && dupNames.has(entry.name.trim()) && (
                  <span className="text-amber-400 shrink-0" title="本分类下有同名词条">⚠</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); void perform(() => handleDeleteEntry(entry)) }}
                  className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          {!existingOnly && <div className="m-2 space-y-1.5">
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
              onClick={() => { void perform(handleAddEntry) }}
              disabled={!activeCatId || !scopeReady}
              className="w-full px-2 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40 inline-flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> 新建词条
            </button>
            {/* B1:管理本分类的专属字段(增删改字段 schema) */}
            <button
              onClick={() => { if (activeCat && loadedScope) setFieldsEditor({ category: activeCat, scope: loadedScope }) }}
              disabled={!activeCat}
              className="w-full px-2 py-1.5 text-xs rounded-lg border border-border text-text-secondary hover:text-accent hover:border-accent/50 disabled:opacity-40 inline-flex items-center justify-center gap-1"
              title="自定义本分类下词条的专属字段"
            >
              <Settings2 className="w-3.5 h-3.5" /> 管理字段
            </button>
          </div>}
        </div>

        {/* 右：词条详情 */}
        <div className={compact ? 'min-w-0 min-h-24' : 'flex-1 overflow-y-auto min-w-0'}>
          {activeEntry && activeCat ? (
            <CodexEntryDetail
              key={activeEntry.id}
              entry={activeEntry}
              category={activeCat}
              allCategories={categories}
              allEntries={scopedEntries}
              nameDuplicate={typeof activeEntry.name === 'string' && !!activeEntry.name && dupNames.has(activeEntry.name.trim())}
              onChange={(patch, expected) => updateEntry(activeEntry.id!, patch, { scope: loadedScope!, expected })}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted text-sm">
              {activeCat ? '从左侧选择或「新建词条」添加一个具体条目' : '请选择一个分类'}
            </div>
          )}
        </div>
      </div>

      {/* B1:自定义字段管理弹窗 — 编辑本分类的 fieldSchema(内置类也可改) */}
      {fieldsEditor && (
        <CodexCategoryFieldsEditor
          category={fieldsEditor.category}
          onClose={() => setFieldsEditor(null)}
          onSave={async fieldSchema => { await updateCategory(fieldsEditor.category.id!, { fieldSchema }, { scope: fieldsEditor.scope, expected: fieldsEditor.category }); setFieldsEditor(null) }}
        />
      )}
      {extractOpen && activeCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-bg-surface border border-border rounded-xl p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-text-primary">
                  {candidateOperation === 'extract' ? (candidateVersion === 2 ? 'AI 原文提取' : 'AI 逐字证据拆分') : 'AI 创意补全建议'}「{activeCat.name}」
                </h3>
                <p className="text-xs text-text-muted">
                  {candidateOperation === 'extract'
                    ? candidateVersion === 2 ? '名称须来自本次原文；提供引文时逐字核验。' : '抽取只允许原文中有逐字引文的词条。'
                    : '补全可创造新内容，但会明确标记为“AI 新建建议”。'}
                  候选确认后才原子写入，两种运行分别确认。
                </p>
              </div>
              <button aria-label="关闭词条提取" disabled={extracting} className="disabled:opacity-40" onClick={() => {
                if (admitting) {
                  extractionEpoch.current++
                  pendingAdmission.current = null
                  newStartAdmission.current = null
                  setAdmitting(false)
                  setExtractOpen(false)
                  return
                }
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
            <button onClick={handleExtractEntries} disabled={admitting || !newStartAdmission.current || extracting || !extractText.trim() || extractRunId != null || recoverable != null || blocksCurrentExtraction}
              className="px-3 py-1.5 bg-accent text-white rounded-lg text-sm disabled:opacity-40 inline-flex items-center gap-1.5">
              {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {extracting
                ? candidateOperation === 'extract' ? 'AI 拆分中…' : 'AI 补全中…'
                : candidateOperation === 'extract' ? '开始拆分' : '生成补全建议'}
            </button>
            {candidateVersion === 2 && extracting && generationAbort.current && !selectionFrozen && <button
              onClick={() => generationAbort.current?.abort()} className="rounded border border-border px-3 py-1.5 text-xs">停止生成并保留已存稿</button>}
            {recoverable && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-text-secondary">
                <p>
                  已恢复分块进度 {recoverable.nextCallIndex}/{recoverable.totalCalls}。
                  {recoverable.version === 2 ? '先核对已存原答和原请求；未知结果不会重新发送。' : recoverable.requiresNewRequestBinding ? '旧计划未冻结实际模型配置，输入已保留；请结束旧运行后明确开始新的提取。'
                    : recoverable.safeToResume ? '可从下一分块继续，不重复已有模型调用。' : '模型结果不可判定，系统不会自动重试。'}
                </p>
                <div className="mt-2 flex gap-2">
                  {(recoverable.safeToResume || recoverable.canReadOriginal) && (
                    <button onClick={() => void handleResumeExtraction()} disabled={extracting}
                      className="rounded bg-accent px-2.5 py-1 text-white disabled:opacity-40">{recoverable.version === 2 ? '核对原请求并继续' : '继续提取'}</button>
                  )}
                  <button onClick={() => void handleAbandonExtraction(false)} disabled={extracting}
                    className="rounded border border-border px-2.5 py-1 text-text-muted disabled:opacity-40">放弃旧运行</button>
                </div>
              </div>
            )}
            {blockedRuns.length > 0 && <aside aria-label="原提取运行只读阻塞记录" className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-text-secondary">
              <p>原运行只读阻塞记录（{blockedRuns.length}）：原件和进度保留，以下记录不提供重新发送或改动操作。</p>
              {blocksCurrentExtraction && <p>本分类或目标未核验的原运行尚未解决，当前不能开始新的提取。</p>}
              {blockedRuns.slice(0, 8).map(run => <details key={`${run.scope.workId}:${run.runId}`} className="mt-2">
                <summary>运行 {run.runId} · {run.target ? `分类 ${run.target.categoryId} / 分组 ${run.target.worldGroupId ?? '默认'}` : '目标未核验'}</summary>
                <p>{run.message}</p><p>原作品 {run.scope.workId} · 已核验前缀 {run.lastSequence ?? '未知'} · 原证据引用 {run.evidenceRefCount}</p>
                <ul>{run.originalRefs.map((ref, index) => <li key={index}><code>{ref.artifactKind}: {ref.contentHash}</code></li>)}</ul>
                {run.evidenceRefCount > run.originalRefs.length && <p>此处仅列部分引用；全部原始记录继续保留。</p>}
              </details>)}
              {blockedRuns.length > 8 && <p>此处仅显示最近 8 条阻塞记录。</p>}
            </aside>}
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
                  <div key={index}><label className="flex gap-3 p-3 border border-border rounded-lg bg-bg-base">
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
                      <details className="mt-2 text-xs text-text-secondary">
                        <summary className="cursor-pointer text-accent">查看完整词条</summary>
                        <p className="mt-2 whitespace-pre-wrap break-words">{item.description}</p>
                        <dl className="mt-2 space-y-1">
                          {Object.entries(item.fields).map(([key, value]) => <div key={key}>
                            <dt className="text-text-muted">{parseFieldSchema(activeCat.fieldSchema).find(field => field.key === key)?.label ?? key}</dt>
                            <dd className="whitespace-pre-wrap break-words">{value || '未填写'}</dd>
                          </div>)}
                        </dl>
                        <p className="mt-2">图标：{item.icon || '无'} · 重要度：{item.importance ?? 0}</p>
                        <p>标签：{item.tags.length ? item.tags.join('、') : '无'}</p>
                      </details>
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
                  {candidateVersion === 2 && (
                    <details className="mt-1 rounded border border-border p-3 text-xs text-text-secondary">
                      <summary className="cursor-pointer text-accent">{authorEdited.has(index) ? '作者编辑稿 · 修改后按人工内容采用' : '编辑作者稿'}</summary>
                      <div className="mt-2 grid gap-2">
                        <label>名称<input aria-label={`候选${index + 1}名称`} value={item.name} disabled={selectionFrozen || extracting}
                          onChange={event => updateCandidateDraft(index, { name: event.target.value })} className="block w-full rounded border border-border bg-bg-base p-2" /></label>
                        <label>简介<textarea aria-label={`候选${index + 1}简介`} value={item.summary} disabled={selectionFrozen || extracting}
                          onChange={event => updateCandidateDraft(index, { summary: event.target.value })} className="block w-full rounded border border-border bg-bg-base p-2" /></label>
                        <label>详细描述<textarea aria-label={`候选${index + 1}描述`} value={item.description} rows={5} disabled={selectionFrozen || extracting}
                          onChange={event => updateCandidateDraft(index, { description: event.target.value })} className="block w-full rounded border border-border bg-bg-base p-2" /></label>
                        {parseFieldSchema(activeCat.fieldSchema).filter(field => field.type !== 'ref').map(field => <label key={field.key}>{field.label}
                          <textarea value={item.fields[field.key] ?? ''} disabled={selectionFrozen || extracting} onChange={event => {
                            const fields = { ...item.fields }; if (event.target.value.trim()) fields[field.key] = event.target.value; else delete fields[field.key]
                            updateCandidateDraft(index, { fields })
                          }} className="block w-full rounded border border-border bg-bg-base p-2" /></label>)}
                        <label>图标<input value={item.icon} disabled={selectionFrozen || extracting} onChange={event => updateCandidateDraft(index, { icon: event.target.value })}
                          className="ml-2 rounded border border-border bg-bg-base p-1" /></label>
                        <label>重要度<input type="number" min={0} max={5} value={item.importance} disabled={selectionFrozen || extracting}
                          onChange={event => updateCandidateDraft(index, { importance: Number(event.target.value) })} className="ml-2 rounded border border-border bg-bg-base p-1" /></label>
                        {item.tags.map((tag, at) => <label key={at}>标签 {at + 1}<input value={tag} disabled={selectionFrozen || extracting}
                          onChange={event => updateCandidateDraft(index, { tags: item.tags.map((value, i) => i === at ? event.target.value : value) })} className="ml-2 rounded border border-border bg-bg-base p-1" />
                          <button disabled={selectionFrozen || extracting} onClick={() => updateCandidateDraft(index, { tags: item.tags.filter((_, i) => i !== at) })}>移除</button></label>)}
                        <button disabled={selectionFrozen || extracting} onClick={() => updateCandidateDraft(index, { tags: [...item.tags, ''] })}>添加标签</button>
                        {(item.evidenceQuotes ?? []).map((quote, at) => <label key={at}>原文引文 {at + 1}<textarea value={quote} disabled={selectionFrozen || extracting}
                          onChange={event => updateCandidateDraft(index, { evidenceQuotes: (item.evidenceQuotes ?? []).map((value, i) => i === at ? event.target.value : value) })} className="block w-full rounded border border-border bg-bg-base p-2" />
                          <button disabled={selectionFrozen || extracting} onClick={() => updateCandidateDraft(index, { evidenceQuotes: (item.evidenceQuotes ?? []).filter((_, i) => i !== at) })}>移除引文</button></label>)}
                        <button disabled={selectionFrozen || extracting} onClick={() => updateCandidateDraft(index, { evidenceQuotes: [...(item.evidenceQuotes ?? []), ''] })}>添加原文引文</button>
                      </div>
                    </details>
                  )}
                  </div>
                ))}
                {candidateVersion === 2 && draftDirty && <p className="text-xs text-amber-400">作者稿尚未保存；可保存草稿或直接确认采用当前内容。刷新前请先保存。</p>}
                <div className="flex justify-end gap-2">
                  {candidateVersion === 2 && !selectionFrozen && <button onClick={() => void handleSaveCandidateDraft()} disabled={extracting || !draftDirty}
                    className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-40">保存作者稿</button>}
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
    </div>
  )
}
