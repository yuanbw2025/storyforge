import { liveQuery } from 'dexie'
import {useDialog} from '../shared/Dialog'
import {downloadJSON,exportProjectJSON} from '../../lib/export/json-export'
import ComicFields from './ComicFields'
import {readComicAuthorDraft,saveComicAuthorDraft} from '../../lib/comic/authoring'
import {queueCandidateDraftV1,flushCandidateDraftsV1} from '../../lib/agent/candidate-draft-coordinator'
import {registerPendingDraftFlusherV1,flushPendingEditsV1} from '../../lib/authoring/pending-edit-coordinator'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Play, RefreshCw, Sparkles, X } from 'lucide-react'
import type { AdaptationProject, AdaptationSourceUnit, ComicPage, ComicPanel, ComicReviewIssueV1, WorkspaceScope } from '../../lib/types'
import { listAdaptationAnalysisV1 } from '../../lib/adaptation/analysis'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../lib/ai/config-readiness'
import {
  adoptComicProfessionalCandidateV1,
  generateComicProfessionalCandidateV1,
  readPendingComicProfessionalCandidateV1,
  listComicProfessionalTasksV1,
  readComicProfessionalTaskV1,
  stopWaitingComicProfessionalTaskV1,
  recoverComicProfessionalCandidateV1,
  type ComicProfessionalTaskV1,
  rejectComicProfessionalCandidateV1,
  type ComicProfessionalPayloadV1,
  type ComicProfessionalStageV1,
} from '../../lib/comic/durable-production'
import { adoptComicReviewIssuesV1, createComicPanelScaffoldFromConfirmedPlanV1, listComicProductionV1, startComicProductionV1, updateComicReviewIssueStatusV1 } from '../../lib/comic/production'
import { useAIConfigStore } from '../../stores/ai-config'

interface Props { stages?: ComicProfessionalStageV1[]; scope: WorkspaceScope; adaptation: AdaptationProject; sourceUnits: AdaptationSourceUnit[]; pages: ComicPage[]; panels: ComicPanel[]; subjectCount: number; onChanged: () => Promise<void> }
const LABELS: Record<ComicProfessionalStageV1, string> = {
  'source-analysis': '1 来源事实', 'causal-graph': '2 因果图', 'adaptation-brief': '3 改编 Brief', 'decision-pass': '4 删改决定',
  'script-adaptation': '5 漫画脚本', 'page-rhythm': '6 分页节奏', 'panel-plan': '7 页格分镜', 'visual-bible': '8 视觉圣经',
  'image-request': '9 图片请求', 'visual-continuity-review': '10 视觉监修', 'targeted-repair': '11 定点修复', 'page-review': '12 页级审校',
}
function comicTaskStatus(task: ComicProfessionalTaskV1): string {
  if (!task.verified) return '证据无法核验'
  if (task.resuming) return '作者采纳待恢复'
  if (!task.controlVerified || task.candidateState === 'unverified') return '证据需要核验'
  if (task.canRecoverCandidate) return '候选已保存，状态待恢复'
  if (task.hasUnresolvedRequest) return '原请求结果未确认'
  if (task.status === 'running' && task.diagnostics.length) return task.requestedAttempts === 0 ? '准备中断，终态待核验' : '保存中断，终态待核验'
  if (task.status === 'awaiting_confirmation') return task.stoppedWaiting ? '晚到候选' : '等待作者确认'
  return ({ completed: '已完成', failed: '运行失败', cancelled: '运行已结束', paused: '运行已暂停', planned: '准备中', running: '处理中', verifying: '核验中', recovering: '恢复中', recovery_required: '需要核验' } as Record<string, string>)[task.status] ?? task.status
}
function payloadKeys(payload: unknown): string[] { return Array.isArray(payload) ? payload.flatMap(item => item && typeof item === 'object' && typeof item.stableKey === 'string' ? [item.stableKey] : []) : [] }

export default function ComicPipelinePanel({ scope, adaptation, sourceUnits, pages, panels, subjectCount, onChanged, stages }: Props) {
  const scopeKey = `${scope.projectId}:${scope.worldId}:${scope.workId}`
  const taskScope = useMemo(() => ({ projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId }), [scope.projectId, scope.worldId, scope.workId])
  const alive = useRef(true)
  const visibleScope = useRef(scopeKey); visibleScope.current = scopeKey
  const selectionSerial = useRef(0)
  const inspectionSerial = useRef(0)
  const activeGeneration = useRef<{ key: string; scope: WorkspaceScope; runId: number | null; stopped: boolean } | null>(null)
  const isCurrentScope = useCallback((key: string) => alive.current && visibleScope.current === key, [])
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const [taskState, setTaskState] = useState<{ key: string; rows: ComicProfessionalTaskV1[] }>({ key: scopeKey, rows: [] })
  const tasks = useMemo(() => taskState.key === scopeKey ? taskState.rows : [], [scopeKey, taskState])
  const [taskBusy, setTaskBusy] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [activeRunId, setActiveRunId] = useState<number | null>(null)
  const [inspection, setInspection] = useState<{ key: string; runId: number; detail?: Awaited<ReturnType<typeof readComicProfessionalTaskV1>>; error?: string } | null>(null)
  const [counts, setCounts] = useState({ facts: 0, edges: 0, decisions: 0, beats: 0, plans: 0, issues: 0 })
  const [covered, setCovered] = useState<string[]>([]); const [issues, setIssues] = useState<ComicReviewIssueV1[]>([])
  const [sourceKey, setSourceKey] = useState(''); const [pageKey, setPageKey] = useState(''); const [panelKey, setPanelKey] = useState('')
  const [candidateState, setCandidate] = useState<{ scopeKey: string; runId: number; stage: ComicProfessionalStageV1; text: string; recovering?: boolean } | null>(null); const [accepted, setAccepted] = useState<Set<string>>(new Set()); const [authorVisualInspectionConfirmed, setAuthorVisualInspectionConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const candidate = candidateState?.scopeKey === scopeKey ? candidateState : null
  const [expanded, setExpanded] = useState(!['producing', 'review', 'complete'].includes(adaptation.status))
  const dialog=useDialog()
  const [instruction,setInstruction]=useState('')
  const draftPrefix=`comic:${scope.workId}:candidate:`
  useEffect(()=>registerPendingDraftFlusherV1(()=>flushCandidateDraftsV1(draftPrefix)),[draftPrefix])
  const aiConfig = useAIConfigStore(state => state.config)
  const reload = useCallback(async () => {
    const key = scopeKey
    if (adaptation.projectId !== taskScope.projectId || adaptation.worldId !== taskScope.worldId || adaptation.workId !== taskScope.workId) return
    const [analysis, production] = await Promise.all([
      listAdaptationAnalysisV1({ scope: taskScope, adaptationProjectId: adaptation.id!, manifestVersion: adaptation.activeSourceManifestVersion }),
      listComicProductionV1(taskScope),
    ])
    if (!isCurrentScope(key)) return
    const facts = analysis.facts.filter(row => row.authorStatus === 'confirmed')
    setCounts({ facts: facts.length, edges: analysis.edges.filter(row => row.authorStatus === 'confirmed').length, decisions: analysis.decisions.filter(row => row.authorStatus === 'confirmed').length, beats: production.scriptBeats.length, plans: production.pagePlans.length, issues: production.reviewIssues.filter(row => row.status === 'open').length })
    setCovered([...new Set(facts.flatMap(row => row.sourceUnitKeys))]); setIssues(production.reviewIssues)
  }, [adaptation.activeSourceManifestVersion, adaptation.id, adaptation.projectId, adaptation.worldId, adaptation.workId, isCurrentScope, scopeKey, taskScope])

  useEffect(() => { const key = scopeKey; void reload().catch(cause => { if (isCurrentScope(key)) setError(cause instanceof Error ? cause.message : '读取漫画专业流程失败') }) }, [reload, adaptation.revision, isCurrentScope, scopeKey])
  useEffect(() => { const usable = sourceUnits.filter(row => row.sourceKind !== 'work'); setSourceKey(current => current && usable.some(row => row.sourceUnitKey === current) ? current : usable.find(row => !covered.includes(row.sourceUnitKey))?.sourceUnitKey ?? usable[0]?.sourceUnitKey ?? '') }, [covered, sourceUnits])
  useEffect(() => { setPageKey(current => current && pages.some(row => row.stableKey === current) ? current : pages[0]?.stableKey ?? '') }, [pages])
  useEffect(() => { const page = pages.find(row => row.stableKey === pageKey); const rows = panels.filter(row => row.pageId === page?.id); setPanelKey(current => current && rows.some(row => row.stableKey === current) ? current : rows[0]?.stableKey ?? '') }, [pageKey, pages, panels])
  const showTaskCandidate = useCallback(async (runId: number, key: string, serial: number) => {
    const detail = await readComicProfessionalTaskV1(taskScope, runId)
    if (!detail.candidate || (!detail.task.resuming && detail.task.status !== 'awaiting_confirmation')) throw new Error('本任务当前只能查看证据，不能作为待确认候选打开。')
    const saved = detail.task.resuming ? null : await readComicAuthorDraft(taskScope, `candidate:${runId}`)
    let draft: { text?: string; accepted?: string[]; visualConfirmed?: boolean } | null = null
    try { const parsed = saved ? JSON.parse(saved) : null; if (parsed?.comicAuthorCandidate === 1) draft = parsed } catch { /* Existing raw author drafts remain readable. */ }
    if (!isCurrentScope(key) || selectionSerial.current !== serial) return
    setCandidate({ scopeKey: key, runId, stage: detail.candidate.stage, recovering: detail.task.resuming,
      text: draft?.text ?? saved ?? JSON.stringify(detail.authorPayload ?? detail.candidate.payload, null, 2) })
    setAccepted(new Set(draft?.accepted ?? payloadKeys(detail.candidate.payload)))
    setAuthorVisualInspectionConfirmed(draft?.visualConfirmed === true)
    setExpanded(true)
  }, [isCurrentScope, taskScope])
  useEffect(() => {
    let active = true
    const key = scopeKey
    selectionSerial.current += 1
    const serial = selectionSerial.current
    setCandidate(null); setAccepted(new Set()); setAuthorVisualInspectionConfirmed(false)
    setError(''); setBusy(false); setGenerating(false); setActiveRunId(null); setTaskBusy(null); setInspection(null)
    setTaskState({ key, rows: [] })
    const subscription = liveQuery(() => listComicProfessionalTasksV1(taskScope)).subscribe({
      next: rows => { if (active && isCurrentScope(key)) setTaskState({ key, rows }) },
      error: cause => { if (active && isCurrentScope(key)) setError(cause instanceof Error ? cause.message : '读取漫画任务失败') },
    })
    void readPendingComicProfessionalCandidateV1(taskScope).then(async pending => {
      if (pending && active && isCurrentScope(key) && selectionSerial.current === serial) await showTaskCandidate(pending.snapshot.run.id, key, serial)
    }).catch(cause => { if (active && isCurrentScope(key)) setError(cause instanceof Error ? cause.message : '恢复漫画候选失败') })
    return () => { active = false; subscription.unsubscribe() }
  }, [isCurrentScope, scopeKey, showTaskCandidate, taskScope])
  useEffect(() => {
    const operation = activeGeneration.current
    if (!operation || operation.key !== scopeKey || operation.runId == null || operation.stopped) return
    const task = tasks.find(row => row.id === operation.runId)
    if (task?.stoppedWaiting) { operation.stopped = true; setGenerating(false); setBusy(false) }
  }, [scopeKey, tasks])
  const inspectTask = async (runId: number) => {
    const key = scopeKey; const serial = ++inspectionSerial.current
    try {
      const detail = await readComicProfessionalTaskV1(taskScope, runId)
      if (isCurrentScope(key) && inspectionSerial.current === serial) setInspection({ key, runId, detail })
    } catch (cause) {
      if (isCurrentScope(key) && inspectionSerial.current === serial) setInspection({ key, runId, error: cause instanceof Error ? cause.message : '运行证据无法核验' })
    }
  }
  const stopTaskWaiting = async (runId: number) => {
    const key = scopeKey
    setTaskBusy(runId)
    try {
      const detail = await readComicProfessionalTaskV1(taskScope, runId)
      await stopWaitingComicProfessionalTaskV1(taskScope, runId, { generation: detail.task.generation, lastSequence: detail.task.lastSequence })
      const operation = activeGeneration.current
      if (operation?.key === key && operation.runId === runId) operation.stopped = true
      const rows = await listComicProfessionalTasksV1(taskScope)
      if (isCurrentScope(key)) {
        if (operation?.key === key && operation.runId === runId) { setBusy(false); setGenerating(false) }
        setTaskState({ key, rows })
      }
    } catch (cause) { if (isCurrentScope(key)) setError(cause instanceof Error ? cause.message : '记录停止等待失败') }
    finally { if (isCurrentScope(key)) setTaskBusy(null) }
  }
  const recoverTaskCandidate = async (runId: number) => {
    const key = scopeKey; const serial = ++selectionSerial.current
    setTaskBusy(runId)
    try {
      await flushPendingEditsV1()
      const detail = await readComicProfessionalTaskV1(taskScope, runId)
      if (!detail.candidate) throw new Error('任务没有已保存的候选，不能通过恢复重新调用模型。')
      await recoverComicProfessionalCandidateV1(taskScope, runId, { generation: detail.task.generation, lastSequence: detail.task.lastSequence, candidateHash: detail.candidate.candidateHash })
      await showTaskCandidate(runId, key, serial)
    } catch (cause) { if (isCurrentScope(key)) setError(cause instanceof Error ? cause.message : '恢复已保存候选失败') }
    finally { if (isCurrentScope(key)) setTaskBusy(null) }
  }
  const openTaskCandidate = async (runId: number) => {
    const key = scopeKey; const serial = ++selectionSerial.current
    setTaskBusy(runId)
    try { await flushPendingEditsV1(); await showTaskCandidate(runId, key, serial) }
    catch (cause) { if (isCurrentScope(key)) setError(cause instanceof Error ? cause.message : '打开候选失败') }
    finally { if (isCurrentScope(key)) setTaskBusy(null) }
  }

  const openIssues = useMemo(() => issues.filter(row => row.status === 'open' && (!row.panelKey || row.panelKey === panelKey) && row.pageKey === pageKey), [issues, pageKey, panelKey])
  const candidateRows = useMemo(() => { if (!candidate) return []; try { const parsed = JSON.parse(candidate.text); return Array.isArray(parsed) ? parsed : [] } catch { return [] } }, [candidate])
  const persistCandidateState=(text:string,selected:Set<string>,visualConfirmed:boolean)=>{if(!candidate||candidate.recovering)return;queueCandidateDraftV1({key:draftPrefix+candidate.runId,draft:JSON.stringify({comicAuthorCandidate:1,text,accepted:[...selected],visualConfirmed}),debounceMs:200,persist:body=>saveComicAuthorDraft({ ...taskScope },`candidate:${candidate.runId}`,body),onError:c=>{if(isCurrentScope(scopeKey))setError(c.message)}})}
  const editCandidate=(text:string)=>{if(!candidate||candidate.recovering)return;setCandidate({...candidate,text});let next=accepted;try{const old=payloadKeys(JSON.parse(candidate.text));next=new Set(payloadKeys(JSON.parse(text)).filter(k=>accepted.has(k)||!old.includes(k)));setAccepted(next)}catch{/* keep incomplete draft */}persistCandidateState(text,next,authorVisualInspectionConfirmed)}
  const run = async (stage: ComicProfessionalStageV1) => {
    if (busy || candidate || (activeGeneration.current?.key === scopeKey && !activeGeneration.current.stopped)) return
    const config = { ...aiConfig }
    if (!isAIConfigReady(config)) return setError(getAIConfigRequiredMessage(config))
    const operation = { key: scopeKey, scope: { ...taskScope }, runId: null as number | null, stopped: false }
    activeGeneration.current = operation
    selectionSerial.current += 1
    setBusy(true); setGenerating(true); setActiveRunId(null); setError(''); setExpanded(true)
    try {
      const currentTasks = await listComicProfessionalTasksV1(operation.scope)
      if (!isCurrentScope(operation.key) || activeGeneration.current !== operation || operation.stopped) return
      const unknown = currentTasks.filter(task => task.hasUnresolvedRequest && task.stage === stage)
      if (unknown.length && !await dialog.confirm({ title: '原请求结果仍未确认', message: `任务 ${unknown.map(task => `#${task.id}`).join('、')} 可能仍在供应商端处理或计费。本次将创建独立的新请求，不是恢复原请求。`, confirmText: '明确发起新请求' })) return
      if (!isCurrentScope(operation.key) || activeGeneration.current !== operation || operation.stopped) return
      const generated = await generateComicProfessionalCandidateV1({ scope: operation.scope, adaptationProjectId: adaptation.id!, stage, aiConfig: config,
        authorInstruction: instruction, sourceUnitKeys: stage === 'source-analysis' ? [sourceKey] : undefined,
        targetPageKeys: ['visual-continuity-review', 'page-review'].includes(stage) ? [pageKey] : undefined,
        targetPanelKeys: ['image-request', 'targeted-repair'].includes(stage) ? [panelKey] : undefined,
        targetIssueKeys: stage === 'targeted-repair' ? openIssues.map(row => row.stableKey) : undefined,
        onTaskCreated: task => { operation.runId = task.runId; if (isCurrentScope(operation.key) && activeGeneration.current === operation) setActiveRunId(task.runId) },
      })
      if (isCurrentScope(operation.key) && activeGeneration.current === operation && !operation.stopped) {
        setCandidate({ scopeKey: operation.key, runId: generated.snapshot.run.id, stage, text: JSON.stringify(generated.candidate.payload, null, 2) })
        setAccepted(new Set(payloadKeys(generated.candidate.payload))); setAuthorVisualInspectionConfirmed(false)
      }
    } catch (cause) {
      if (isCurrentScope(operation.key) && activeGeneration.current === operation && !operation.stopped) setError(cause instanceof Error ? cause.message : '专业阶段生成失败')
    } finally {
      if (activeGeneration.current === operation) {
        activeGeneration.current = null
        if (isCurrentScope(operation.key) && !operation.stopped) { setBusy(false); setGenerating(false); setActiveRunId(null) }
      }
    }
  }

  const accept = async () => {
    if (!candidate || busy) return
    const key = scopeKey; const selected = candidate; const capturedScope = { ...taskScope }
    setBusy(true); setError('')
    try {
      await flushPendingEditsV1()
      let allowReplaceDownstream = false
      if (!selected.recovering && ['script-adaptation', 'page-rhythm', 'panel-plan', 'visual-bible'].includes(selected.stage) && (pages.length || subjectCount)) {
        if (!await dialog.confirm({ title: '确认替换现有规划？', message: '将先下载完整备份。脚本、分页和分镜重做会替换相关页格、图片候选及审查；视觉设定修改保留媒资并要求重新验图。已发布版本保留。', confirmText: '备份并采纳' })) return
        if (!isCurrentScope(key)) return
        await downloadJSON(await exportProjectJSON(capturedScope.projectId), '漫画采纳前备份.json'); allowReplaceDownstream = true
      }
      if (!isCurrentScope(key)) return
      const parsed = JSON.parse(selected.text) as ComicProfessionalPayloadV1
      const authorPayload = Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object' && accepted.has((item as { stableKey: string }).stableKey)) : parsed
      await adoptComicProfessionalCandidateV1({ scope: capturedScope, runId: selected.runId, allowReplaceDownstream, authorPayload: selected.recovering ? undefined : authorPayload as ComicProfessionalPayloadV1, authorVisualInspectionConfirmed })
      if (isCurrentScope(key)) { setCandidate(null); setAccepted(new Set()); setAuthorVisualInspectionConfirmed(false); await reload(); if (isCurrentScope(key)) await onChanged() }
    } catch (cause) {
      const pending = await readPendingComicProfessionalCandidateV1(capturedScope).catch(() => null)
      if (isCurrentScope(key)) {
        if (!pending || pending.snapshot.run.id !== selected.runId) { setCandidate(null); setAccepted(new Set()); setAuthorVisualInspectionConfirmed(false); await reload(); if (isCurrentScope(key)) await onChanged() }
        if (isCurrentScope(key)) setError(cause instanceof Error ? cause.message : '采纳候选失败')
      }
    } finally { if (isCurrentScope(key)) setBusy(false) }
  }
  const reject = async () => {
    if (!candidate || busy) return
    const key = scopeKey; const selected = candidate; const capturedScope = { ...taskScope }
    setBusy(true); setError('')
    try {
      await rejectComicProfessionalCandidateV1(capturedScope, selected.runId)
      if (isCurrentScope(key)) { setCandidate(null); setAccepted(new Set()); setAuthorVisualInspectionConfirmed(false) }
    } catch (cause) { if (isCurrentScope(key)) setError(cause instanceof Error ? cause.message : '放弃候选失败') }
    finally { if (isCurrentScope(key)) setBusy(false) }
  }

  const createPanelScaffold = async () => { if (busy || candidate || pages.length) return; setBusy(true); setError(''); try { await createComicPanelScaffoldFromConfirmedPlanV1({ scope, expectedAdaptationRevision: adaptation.revision, sourceManifestVersion: adaptation.activeSourceManifestVersion }); await reload(); await onChanged() } catch (cause) { setError(cause instanceof Error ? cause.message : '建立基础分镜失败') } finally { setBusy(false) } }
  const confirmPageNarrative = async () => { if (busy || candidate || !pageKey) return; const page = pages.find(row => row.stableKey === pageKey); const targetPanels = panels.filter(row => row.pageId === page?.id); if (!page || !targetPanels.length) return setError('目标页没有可审校分镜'); setBusy(true); setError(''); try { await adoptComicReviewIssuesV1({ scope, expectedAdaptationRevision: adaptation.revision, sourceManifestVersion: adaptation.activeSourceManifestVersion, reviewKind: 'page', targetPageKeys: [page.stableKey], expectedPanelRevisions: Object.fromEntries(targetPanels.map(row => [row.stableKey, row.revision])), candidates: [] }); await reload(); await onChanged() } catch (cause) { setError(cause instanceof Error ? cause.message : '作者页级审校失败') } finally { setBusy(false) } }
  const readyBrief = adaptation.briefSourceManifestVersion === adaptation.activeSourceManifestVersion
  const buttons: Array<{ stage: ComicProfessionalStageV1; ready: boolean; detail: string }> = [
    { stage: 'source-analysis', ready: Boolean(sourceKey), detail: `${covered.length}/${sourceUnits.filter(row => row.sourceKind !== 'work').length} 单元 · ${counts.facts} 事实` }, { stage: 'causal-graph', ready: counts.facts > 0, detail: `${counts.edges} 因果边` }, { stage: 'adaptation-brief', ready: counts.edges > 0, detail: readyBrief ? '已确认' : '待确认' }, { stage: 'decision-pass', ready: readyBrief, detail: `${counts.decisions} 决定` },
    { stage: 'script-adaptation', ready: counts.decisions > 0, detail: `${counts.beats} 节拍` }, { stage: 'page-rhythm', ready: counts.beats > 0, detail: `${counts.plans}/${adaptation.targetSpec.format === 'page-comic' ? adaptation.targetSpec.chapterCount * adaptation.targetSpec.targetPagesPerChapter : 0} 页` }, { stage: 'panel-plan', ready: counts.plans > 0, detail: `${pages.length} 页 · ${panels.length} 格` }, { stage: 'visual-bible', ready: counts.plans > 0 && pages.length > 0, detail: `${subjectCount} Subject` },
    { stage: 'image-request', ready: Boolean(panelKey && subjectCount), detail: panelKey || '选择目标格' }, { stage: 'visual-continuity-review', ready: Boolean(pageKey && subjectCount), detail: '机器证据 + 作者验图' }, { stage: 'targeted-repair', ready: Boolean(panelKey && openIssues.length), detail: `${openIssues.length} 个目标问题` }, { stage: 'page-review', ready: Boolean(pageKey), detail: '叙事/顺序/排字' },
  ]
  const completionFlags = [covered.length >= sourceUnits.filter(row => row.sourceKind !== 'work').length && counts.facts > 0, counts.edges > 0, readyBrief, counts.decisions > 0, counts.beats > 0, counts.plans > 0, pages.length > 0, subjectCount > 0, panels.length > 0 && panels.every(row => !!row.visualPrompt), panels.length > 0 && panels.every(row => row.visualReviewRevision === row.revision), counts.issues === 0 && panels.length > 0 && panels.every(row => row.visualReviewRevision === row.revision), pages.length > 0 && pages.every(page => page.status === 'reviewed' || page.status === 'locked')]
  const completed = completionFlags.filter(Boolean).length
  if (adaptation.projectId !== scope.projectId || adaptation.worldId !== scope.worldId || adaptation.workId !== scope.workId) return <p>正在读取当前漫画作品…</p>
  return <section className={`comic-pipeline ${expanded ? 'expanded' : 'collapsed'}`}><header><div><span>PROFESSIONAL PIPELINE · MANIFEST V{adaptation.activeSourceManifestVersion}</span><h3>{stages ? '当前内容的创作辅助' : '十二步小说转漫画'}</h3><p>{completed}/12 个制作关口已有结果 · {counts.issues} 个开放问题</p></div><button className="comic-pipeline-toggle" onClick={() => setExpanded(current => !current)} aria-expanded={expanded}><span>{expanded ? '收起专业流程' : '展开专业流程'}</span><ChevronDown /></button></header>
    {(tasks.length > 0 || generating) && <section className="comic-professional-candidate" aria-label="漫画任务记录" data-testid="comic-task-history">
      <header><strong>任务记录</strong><span>重新打开页面不会自动重发请求</span></header>
      {generating && <p role="status">正在处理本次请求{activeRunId ? ` #${activeRunId}` : '，准备运行记录'}。停止等待无法撤销供应商端已派发的请求。</p>}
      {tasks.map(task => <article key={task.id} data-testid={`comic-task-${task.id}`}>
        <strong>#{task.id} · {task.stage ? LABELS[task.stage] : '岗位证据无法核验'} · {comicTaskStatus(task)}</strong>
        {task.verified && <p>已记录请求 {task.requestedAttempts} 次 / 返回 {task.respondedAttempts} 次{task.hasUnresolvedRequest ? '；原请求结果未确认，可能仍被处理或计费。' : ''}</p>}
        {task.stoppedWaiting && <p>已停止等待；保留原运行和晚到候选，不会自动重发或继续模型修复。</p>}
        {task.diagnostics.map((message, index) => <p key={index}>{message.length > 600 ? `${message.slice(0, 600)}…（查看完整运行证据）` : message}</p>)}
        <div><button onClick={() => void inspectTask(task.id)}>查看运行证据</button>
          {task.canStopWaiting && <button onClick={() => void stopTaskWaiting(task.id)} disabled={taskBusy !== null || (busy && !generating)}>停止等待</button>}
          {task.canRecoverCandidate && <button onClick={() => void recoverTaskCandidate(task.id)} disabled={taskBusy !== null || busy}>恢复已保存候选（不调用模型）</button>}
          {(task.resuming || (task.candidateState === 'available' && task.status === 'awaiting_confirmation')) && <button onClick={() => void openTaskCandidate(task.id)} disabled={taskBusy !== null || busy}>{task.resuming ? '打开已确认的采纳' : task.stoppedWaiting ? '查看晚到候选' : '打开待确认候选'}</button>}
        </div>
      </article>)}
      {inspection?.key === scopeKey && <details open><summary>任务 #{inspection.runId} 的只读证据</summary>
        {inspection.error ? <p role="alert">{inspection.error}</p> : inspection.detail && <>
          <p>{inspection.detail.task.rawResponseReferences.length ? '存在原响应引用；引用本身不代表正文已核验。' : '当前没有可核验的原响应正文。请求、返回哈希和错误记录仍保留。'}</p>
          <pre>{JSON.stringify({ task: inspection.detail.task, events: inspection.detail.snapshot.events, candidate: inspection.detail.candidate, authorPayload: inspection.detail.authorPayload }, null, 2)}</pre>
        </>}
      </details>}
    </section>}
    {expanded && <div className="comic-pipeline-body"><p className="comic-pipeline-note">每个岗位只生成自己的候选；协议错误最多自动修复一次并记入运行事件，作者确认后才写正式表。成图、排字、审查和发布各自保留证据。</p>
    <div className="comic-pipeline-targets"><label>来源分析单元<select value={sourceKey} onChange={event => setSourceKey(event.target.value)}>{sourceUnits.filter(row => row.sourceKind !== 'work').map(row => <option key={row.sourceUnitKey} value={row.sourceUnitKey}>{covered.includes(row.sourceUnitKey) ? '✓ ' : ''}{row.label} · {row.wordCount} 字</option>)}</select></label><label>目标页<select value={pageKey} onChange={event => setPageKey(event.target.value)}>{pages.map(row => <option key={row.stableKey} value={row.stableKey}>{row.stableKey} · {row.summary}</option>)}</select></label><label>目标格<select value={panelKey} onChange={event => setPanelKey(event.target.value)}>{panels.filter(row => row.pageId === pages.find(page => page.stableKey === pageKey)?.id).map(row => <option key={row.stableKey} value={row.stableKey}>{row.stableKey} · {row.moment ?? row.action}</option>)}</select></label>{counts.plans > 0 && pages.length === 0 && <button onClick={() => void createPanelScaffold()} disabled={busy || !!candidate}><Play />作者建立基础分镜</button>}{pageKey && <button onClick={() => void confirmPageNarrative()} disabled={busy || !!candidate || adaptation.status === 'complete'}><Check />作者确认本页叙事无问题</button>}{pages.length > 0 && subjectCount > 0 && !['producing', 'review', 'complete'].includes(adaptation.status) && <button className="primary" onClick={() => void (async () => { setBusy(true); setError(''); try { await startComicProductionV1({ scope, expectedAdaptationRevision: adaptation.revision }); await onChanged() } catch (cause) { setError(cause instanceof Error ? cause.message : '进入生产失败') } finally { setBusy(false) } })()} disabled={busy}><Play />进入图片生产</button>}</div>
    <label className="comic-field">本次创作要求<textarea value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder="补充这一环节希望保留、强调或避免的内容"/></label><div className="comic-pipeline-steps">{buttons.map((item, index) => (!stages || stages.includes(item.stage)) && <button key={item.stage} className={completionFlags[index] ? 'complete' : ''} onClick={() => void run(item.stage)} disabled={busy || !!candidate || !item.ready || adaptation.status === 'complete'}><b>{index + 1}</b><span><strong>{LABELS[item.stage].replace(/^\d+\s*/, '')}</strong><small>{item.detail}</small></span><Sparkles /></button>)}</div>
    {candidate && <div className="comic-professional-candidate"><header><strong>{LABELS[candidate.stage]}{candidate.recovering ? ' · 已确认作者采纳待恢复' : '候选 · 尚未写入'}</strong><span>{candidate.recovering ? '保留冻结作者意图，不重新生成' : '可编辑后确认'}</span></header>{candidateRows.length > 0 && <div className="comic-candidate-items">{candidateRows.map((item: any, index) => <label key={item.stableKey ?? index}><input type="checkbox" disabled={busy || candidate.recovering} checked={accepted.has(item.stableKey)} onChange={event => setAccepted(current => { const next = new Set(current); if (event.target.checked) next.add(item.stableKey); else next.delete(item.stableKey); persistCandidateState(candidate.text,next,authorVisualInspectionConfirmed); return next })} /><span><strong>{item.stableKey}</strong><small>{item.statement ?? item.rationale ?? item.visualAction ?? item.goal ?? item.moment ?? item.problem ?? ''}</small></span></label>)}</div>}<fieldset disabled={candidate.recovering||busy}>{(()=>{try{return <ComicFields value={JSON.parse(candidate.text)} onChange={value=>editCandidate(JSON.stringify(value,null,2))}/>}catch{return <p>草稿格式待修正，请展开结构数据。</p>}})()}</fieldset><details><summary>高级：候选结构数据</summary><textarea disabled={candidate.recovering} value={candidate.text} onChange={e=>editCandidate(e.target.value)} spellCheck={false}/></details>{candidate.stage === 'visual-continuity-review' && <label className="comic-visual-confirm"><input type="checkbox" disabled={busy || candidate.recovering} checked={authorVisualInspectionConfirmed} onChange={event => {setAuthorVisualInspectionConfirmed(event.target.checked);persistCandidateState(candidate.text,accepted,event.target.checked)}} /><span>我已查看目标页全部实际成图，并核对人物、服装、道具、空间与光线连续性。AI 当前只核对媒资元数据，不读取图片像素。</span></label>}<footer><button onClick={() => void reject()} disabled={busy || candidate.recovering}><X />放弃</button><button className="primary" onClick={() => void accept()} disabled={busy || (!candidate.recovering && candidate.stage === 'visual-continuity-review' && !authorVisualInspectionConfirmed)}><Check />{candidate.recovering ? '继续完成已确认的采纳' : '作者确认并采纳'}</button></footer></div>}
    {issues.length > 0 && <details className="comic-review-list"><summary>审查问题（{counts.issues} 项开放）</summary>{issues.map(issue => <article key={issue.id} className={issue.status}><strong>{issue.category} · {issue.severity} · {issue.pageKey}{issue.panelKey ? ` / ${issue.panelKey}` : ''}</strong><p>{issue.problem}</p><blockquote>{issue.evidence}</blockquote>{issue.status === 'open' && <button onClick={() => void (async () => { await updateComicReviewIssueStatusV1({ scope, issueId: issue.id!, status: 'dismissed' }); await reload(); await onChanged() })()}>作者驳回</button>}</article>)}</details>}
    </div>}
    {error && <p className="comic-pipeline-error" role="alert"><RefreshCw />{error}</p>}
  </section>
}
