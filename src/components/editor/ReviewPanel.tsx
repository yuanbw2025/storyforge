/**
 * 质量审校面板 — Phase F
 *
 * 集成三套质量检测：审校(F1)、去AI味(F2)、追读力(F3)
 */
import { useEffect, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import { X, ShieldCheck, Bot, TrendingUp, Loader2, ScanSearch } from 'lucide-react'
import { describeResolvedAIRequestSettingsV1, resolveRequestConfig, type ChatResult } from '../../lib/ai/client'
import { executeRegisteredAIEntryV1 } from '../../lib/agent/formal-ai-entry'
import { useReviewResultStore, selectChapterReview, type ReviewTab } from '../../stores/review-result'
import {
  type ConsistencyAuditMode,
  type ConsistencyAuditResult,
} from '../../lib/ai/adapters/consistency-audit-adapter'
import {
  toConsistencyAuditResult,
  CONSISTENCY_AGENT_OUTPUT_BUDGET_V1,
  type ConsistencyAgentRun,
} from '../../lib/agent/consistency-agent'
import { AgentTeamBudgetTracker } from '../../lib/agent/team-budget'
import { runDurableConsistencyAuditV1 } from '../../lib/agent/run/consistency-audit-durable'
import { resolveScopeLike } from '../../lib/workspace/scope'
import { useAIConfigStore } from '../../stores/ai-config'
import { runWholeChapterQualityReviewV1, readLatestWholeChapterQualityReviewV1, type DurableQualityReviewV1 } from '../../lib/agent/run/quality-review-durable'
import type { QualityReviewModeV1 } from '../../lib/prose/quality-review'
import { captureWorkspaceContentRevisionV1 } from '../../lib/authoring/content-revision'
import { db } from '../../lib/db/schema'
import { createWholeChapterQualityCallV1, createQualityRevisionCallV1 } from '../../lib/prose/quality-transport'
import { WholeQualityReportView, QualityRevisionScopeControls, QualityRevisionComparisonView } from './QualityReviewViews'
import { runQualityRevisionV1, readLatestQualityRevisionV1, readLatestUnfinishedQualityRevisionV1, adoptQualityRevisionV1, rejectQualityRevisionV1, abandonQualityRevisionV1, type QualityRevisionViewV1, type QualityRevisionRecoveryV1 } from '../../lib/agent/run/quality-revision-durable'

interface Props {
  projectId: number
  /** 当前章节 id — 审校结果按章缓存到 store，收起/切标签不丢（bug G7 / B1） */
  chapterId: number
  /** NS-6：审计证据需用它做世界隔离 + 召回定位（多世界正确性） */
  outlineNodeId?: number | null
  worldGroupId?: number | null
  chapterContent: string
  chapterTitle: string
  worldContext: string
  characterContext: string
  prevChapterSummary: string
  nextChapterSummary: string
  foreshadowContext: string
  stateContext: string
  onClose: () => void
  consistencyRun?: ConsistencyAgentRun | null
  consistencyCurrent?: boolean
  onConsistencyRun?: (run: ConsistencyAgentRun) => void
  onBeforeConsistencyRun?: () => Promise<void>
  onQualityRevisionAdopted?: () => Promise<void>
  qualityConfigOverride?: import('../../lib/types').AIConfig
  qualityGenerationOverrides?: { temperature?: number; maxTokens?: number }
  qualityAuthorRequest?: string
}

type TabType = ReviewTab

const TABS: { key: TabType; label: string; icon: typeof ShieldCheck }[] = [
  { key: 'consistency', label: '一致性', icon: ScanSearch },
  { key: 'review', label: '审校', icon: ShieldCheck },
  { key: 'antiAI', label: '表达与重复', icon: Bot },
  { key: 'readability', label: '追读力', icon: TrendingUp },
]

export default function ReviewPanel(props: Props) {
  const { projectId, chapterId, outlineNodeId, worldGroupId, chapterContent, chapterTitle,
    onClose } = props

  const [auditMode, setAuditMode] = useState<ConsistencyAuditMode>('fast')
  const [consistencyRunning, setConsistencyRunning] = useState(false)
  const [consistencyError, setConsistencyError] = useState('')
  const [localConsistencyRun, setLocalConsistencyRun] = useState<ConsistencyAgentRun | null>(
    props.consistencyRun ?? null,
  )

  // 结果与当前标签都存 store（按 chapterId），故收起再展开 / 切一级标签回来都还在
  const cached = useReviewResultStore(selectChapterReview(chapterId))
  const {
    consistency: consistencyResult,
    activeTab,
  } = cached
  const setConsistency = useReviewResultStore(s => s.setConsistency)
  const setActiveTab = (tab: TabType) => useReviewResultStore.getState().setActiveTab(chapterId, tab)

  useEffect(() => {
    setLocalConsistencyRun(props.consistencyRun ?? null)
    if (props.consistencyRun) {
      setConsistency(chapterId, toConsistencyAuditResult(props.consistencyRun.candidate))
    }
  }, [chapterId, props.consistencyRun, setConsistency])

  const [qualityReports, setQualityReports] = useState<Partial<Record<QualityReviewModeV1, DurableQualityReviewV1>>>({})
  const [qualityRunning, setQualityRunning] = useState(false)
  const [qualityError, setQualityError] = useState('')
  const qualityGeneration = useRef(0)
  const qualityTarget = useRef('')
  const qualityAbort = useRef<AbortController | null>(null)
  const consistencyAbort = useRef<AbortController | null>(null)
  useEffect(() => () => { qualityAbort.current?.abort(); consistencyAbort.current?.abort() }, [projectId, chapterId])
  qualityTarget.current = `${projectId}:${chapterId}`
  const [revisionHash, setRevisionHash] = useState('')
  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    void (async () => {
      const scope = await resolveScopeLike(projectId)
      if (!active) return
      const subscription = liveQuery(() => Promise.all([
        db.works.get(scope.workId),
        captureWorkspaceContentRevisionV1({ scope, worldGroupId: worldGroupId ?? null }),
      ])).subscribe({
        next: ([work, revision]) => { if (active) setRevisionHash(`${revision.vectorHash}:${JSON.stringify(work)}`) },
        error: error => { if (active) setQualityError(error instanceof Error ? error.message : '作品版本读取失败。') },
      })
      unsubscribe = () => subscription.unsubscribe()
    })().catch(error => { if (active) setQualityError(error instanceof Error ? error.message : '作品版本读取失败。') })
    return () => { active = false; unsubscribe?.() }
  }, [projectId, worldGroupId])
  const mode: QualityReviewModeV1 = activeTab === 'antiAI' ? 'style' : activeTab === 'readability' ? 'readability' : 'quality'
  const reviewRequestKey = `${projectId}:${chapterId}:${mode}`
  const reviewRequestSource = props.qualityAuthorRequest ?? ''
  const [reviewRequests, setReviewRequests] = useState<Record<string, { source: string; text: string }>>({})
  const reviewRequestDraft = reviewRequests[reviewRequestKey]
  const reviewAuthorRequest = reviewRequestDraft?.source === reviewRequestSource ? reviewRequestDraft.text : reviewRequestSource
  const [selectedIssues, setSelectedIssues] = useState<string[]>([])
  const [extraParagraphs, setExtraParagraphs] = useState<number[]>([])
  const [protectedText, setProtectedText] = useState('')
  const [revisionView, setRevisionView] = useState<QualityRevisionViewV1 | null>(null)
  const [revisionRecovery, setRevisionRecovery] = useState<QualityRevisionRecoveryV1 | null>(null)
  const [revisionBusy, setRevisionBusy] = useState(false)
  const [revisionError, setRevisionError] = useState('')
  const selectedReportHash = qualityReports[mode]?.report.artifactHash
  const revisionRequestKey = `${reviewRequestKey}:${selectedReportHash ?? ''}`
  const [revisionRequests, setRevisionRequests] = useState<Record<string, string>>({})
  const revisionAuthorRequest = revisionRequests[revisionRequestKey] ?? ''
  useEffect(() => { setSelectedIssues([]); setExtraParagraphs([]); setProtectedText('') }, [chapterId, selectedReportHash])
  useEffect(() => {
    if (revisionBusy) return
    let active = true
    void resolveScopeLike(projectId).then(scope => Promise.all([readLatestQualityRevisionV1({ scope, chapterId }), readLatestUnfinishedQualityRevisionV1({ scope, chapterId })]))
      .then(([view, recovery]) => { if (active) { setRevisionView(view); setRevisionRecovery(recovery) } })
      .catch(error => { if (active) setRevisionError(error instanceof Error ? error.message : '修订记录恢复失败。') })
    return () => { active = false }
  }, [projectId, chapterId, chapterContent, revisionHash, revisionBusy])
  useEffect(() => {
    if (qualityRunning) return
    let active = true
    const generation = ++qualityGeneration.current
    setQualityReports({})
    void (async () => {
      const scope = await resolveScopeLike(projectId)
      const reports = await Promise.all((['quality', 'style', 'readability'] as const).map(async reviewMode => [reviewMode, await readLatestWholeChapterQualityReviewV1({ scope, chapterId, mode: reviewMode })] as const))
      if (active && generation === qualityGeneration.current) setQualityReports(Object.fromEntries(reports.filter(([, report]) => report)))
    })().catch(error => { if (active) setQualityError(error instanceof Error ? error.message : '报告恢复失败。') })
    return () => { active = false }
  }, [projectId, chapterId, chapterContent, qualityRunning, revisionHash])

  const handleRunQuality = async () => {
    if (qualityAbort.current) return
    const controller = new AbortController()
    qualityAbort.current = controller
    const generation = ++qualityGeneration.current
    const target = qualityTarget.current
    setQualityError(''); setQualityRunning(true)
    try {
      if (outlineNodeId == null) throw new Error('全文评审缺少目标章纲。')
      await props.onBeforeConsistencyRun?.()
      if (qualityTarget.current !== target || controller.signal.aborted) return
      const scope = await resolveScopeLike(projectId)
      const result = await runWholeChapterQualityReviewV1({ scope, chapterId, outlineNodeId, worldGroupId: worldGroupId ?? null, mode,
        configOverride: props.qualityConfigOverride, generationOverrides: props.qualityGenerationOverrides, authorRequest: reviewAuthorRequest, signal: controller.signal,
        call: createWholeChapterQualityCallV1(projectId, mode, controller.signal),
      })
      if (generation === qualityGeneration.current && qualityTarget.current === target) setQualityReports(value => ({ ...value, [mode]: result }))
    } catch (error) { if (generation === qualityGeneration.current && qualityTarget.current === target) setQualityError(controller.signal.aborted ? '评审已停止，未自动重发。' : error instanceof Error ? error.message : '全文评审未完成。') }
    finally { if (qualityAbort.current === controller) qualityAbort.current = null; setQualityRunning(false) }
  }

  const handleRunConsistency = async () => {
    if (consistencyAbort.current) return
    const target = `${projectId}:${chapterId}`
    setConsistencyError('')
    setConsistencyRunning(true)
    const controller = new AbortController()
    consistencyAbort.current = controller
    try {
      await props.onBeforeConsistencyRun?.()
      if (controller.signal.aborted || qualityTarget.current !== target) return
      const config = useAIConfigStore.getState().config
      const meta = {
        category: auditMode === 'fast' ? 'review.consistency.fast' : 'review.consistency.deep',
        projectId,
        configOverrides: { maxTokens: CONSISTENCY_AGENT_OUTPUT_BUDGET_V1[auditMode] },
        contextOverflowPolicy: 'reject' as const,
        transportRetryPolicy: 'none' as const,
      }
      const resolution = resolveRequestConfig(config, meta)
      const savedChapter = await db.chapters.get(chapterId)
      if (!savedChapter) throw new Error('一致性审计章节不存在。')
      const budget = new AgentTeamBudgetTracker(
        useAIConfigStore.getState().agentTeamBudgetProfile,
      )
      const result = await runDurableConsistencyAuditV1({
        scope: await resolveScopeLike(projectId),
        chapterId,
        outlineNodeId,
        worldGroupId: worldGroupId ?? null,
        chapterTitle,
        chapterContent: savedChapter.content ?? '',
        mode: auditMode,
        provider: resolution.config.provider,
        model: resolution.config.model,
        requestSettings: describeResolvedAIRequestSettingsV1(resolution, false, { responseFormat: 'json_object' }),
        budget,
        call: async messages => {
          const delivery: ChatResult = {}
          const raw = await executeRegisteredAIEntryV1('prose.review.consistency', messages, resolution.config, {
            ...meta, category: auditMode === 'fast' ? 'review.consistency.fast' : 'review.consistency.deep',
          },
            controller.signal, delivery, { responseFormat: 'json_object' }, resolution)
          return { raw, completion: delivery.finishReason === 'stop' ? 'complete' : 'incomplete', finishReason: delivery.finishReason }
        },
      })
      if (controller.signal.aborted || qualityTarget.current !== target) return
      const { run, candidate } = result
      setLocalConsistencyRun(run)
      setConsistency(chapterId, toConsistencyAuditResult(candidate))
      props.onConsistencyRun?.(run)
    } catch (error) {
      if (!controller.signal.aborted && qualityTarget.current === target) setConsistencyError(error instanceof Error ? error.message : '一致性 Agent 运行失败')
    } finally {
      if (consistencyAbort.current === controller) {
        consistencyAbort.current = null
        setConsistencyRunning(false)
      }
    }
  }

  const handleRun = () => {
    if (activeTab === 'consistency') void handleRunConsistency()
    else void handleRunQuality()
  }
  const qualityResult = qualityReports[mode]
  const currentResult = activeTab === 'consistency' ? consistencyResult : qualityResult
  const consistencyMeta = localConsistencyRun?.candidate

  const handleRevision = async () => {
    if (qualityAbort.current || !qualityResult?.current || outlineNodeId == null) return
    const controller = new AbortController(); qualityAbort.current = controller
    const target = qualityTarget.current
    setRevisionBusy(true); setRevisionError('')
    try {
      await props.onBeforeConsistencyRun?.()
      if (qualityTarget.current !== target || controller.signal.aborted) return
      const scope = await resolveScopeLike(projectId)
      const view = await runQualityRevisionV1({ scope, chapterId, outlineNodeId, worldGroupId: worldGroupId ?? null, mode, reportRunId: qualityResult.runId, reportHash: qualityResult.report.artifactHash, selectedIssueIds: selectedIssues, additionalParagraphs: extraParagraphs, protectedQuotes: protectedText.split('\n').filter(line => line.trim()), authorRequest: revisionAuthorRequest, signal: controller.signal, configOverride: props.qualityConfigOverride, generationOverrides: props.qualityGenerationOverrides,
        revise: createQualityRevisionCallV1(projectId, 'revision', controller.signal),
        recheck: createQualityRevisionCallV1(projectId, 'recheck', controller.signal),
      })
      if (qualityTarget.current === target) setRevisionView(view)
    } catch (error) { if (qualityTarget.current === target) setRevisionError(error instanceof Error ? error.message : '范围修订未完成。') }
    finally { if (qualityAbort.current === controller) qualityAbort.current = null; setRevisionBusy(false) }
  }

  const decideRevision = async (adopt: boolean) => {
    const candidate = revisionView?.candidate
    if (!candidate || revisionBusy) return
    setRevisionBusy(true); setRevisionError('')
    try {
      await props.onBeforeConsistencyRun?.()
      const scope = await resolveScopeLike(projectId)
      if (adopt) { await adoptQualityRevisionV1({ scope, candidate }); await props.onQualityRevisionAdopted?.() }
      else await rejectQualityRevisionV1({ scope, candidate })
      setRevisionView(await readLatestQualityRevisionV1({ scope, chapterId }))
    } catch (error) { setRevisionError(error instanceof Error ? error.message : '作者决定未保存。') }
    finally { setRevisionBusy(false) }
  }

  const endRevisionRun = async (runId: number) => {
    if (revisionBusy) return
    const target = qualityTarget.current
    setRevisionBusy(true); setRevisionError('')
    try {
      const scope = await resolveScopeLike(projectId)
      if (qualityTarget.current !== target) return
      await abandonQualityRevisionV1({ scope, chapterId, runId })
      const [view, recovery] = await Promise.all([readLatestQualityRevisionV1({ scope, chapterId }), readLatestUnfinishedQualityRevisionV1({ scope, chapterId })])
      if (qualityTarget.current === target) { setRevisionView(view); setRevisionRecovery(recovery) }
    } catch (error) { if (qualityTarget.current === target) setRevisionError(error instanceof Error ? error.message : '运行未能结束。') }
    finally { setRevisionBusy(false) }
  }

  return (
    <div className="bg-bg-surface border border-border rounded-xl overflow-hidden shadow-lg">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-elevated border-b border-border">
        <div className="flex items-center gap-1">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                activeTab === tab.key
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRun}
            disabled={consistencyRunning || qualityRunning || revisionBusy || !chapterContent}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {consistencyRunning || qualityRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            {consistencyRunning || qualityRunning ? '检测中...' : '开始检测'}
          </button>
          <button aria-label="关闭质量审校" onClick={() => { qualityAbort.current?.abort(); onClose() }} className="p-1 text-text-muted hover:text-text-primary rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="p-4 max-h-[50vh] overflow-y-auto">
        {activeTab !== 'consistency' && <label className="mb-3 block text-xs">本轮评审补充要求（可选）
          <textarea aria-label="本轮评审补充要求" maxLength={16000} rows={3} className="mt-1 w-full rounded border border-border bg-bg-base p-2" value={reviewAuthorRequest} disabled={qualityRunning || revisionBusy} placeholder="写下你担心的问题、评审重点或希望保留的写法。" onChange={event => setReviewRequests(value => ({ ...value, [reviewRequestKey]: { source: reviewRequestSource, text: event.target.value } }))} />
        </label>}
        {activeTab === 'consistency' && (
          <div className="mb-3 flex gap-2">
            {([
              ['fast', 'Fast Guard · 高置信硬冲突'],
              ['deep', 'Deep Audit · 因果/动机/伏笔'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setAuditMode(value)}
                className={`px-2 py-1 text-xs rounded ${auditMode === value ? 'bg-accent/10 text-accent' : 'bg-bg-elevated text-text-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {activeTab === 'consistency' && consistencyMeta && (
          <div className={`mb-3 rounded-lg border px-3 py-2 text-[11px] ${
            props.consistencyCurrent === false
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
              : 'border-border bg-bg-base text-text-muted'
          }`}>
            <p>
              {props.consistencyCurrent === false ? '正文或作品资料已变化，以下报告已过期。' : '当前正文报告'}
              {' · '}{consistencyMeta.mode === 'background' ? '自动 Fast Guard' : consistencyMeta.mode === 'fast' ? 'Fast Guard' : 'Deep Audit'}
              {' · '}{consistencyMeta.budget.calls}/{consistencyMeta.budget.maxCalls} 次模型调用
              {' · '}约 {consistencyMeta.budget.usedTokens.toLocaleString()} / {consistencyMeta.budget.maxTokens.toLocaleString()} tokens
            </p>
            {consistencyMeta.context.included.length > 0 && (
              <p className="mt-1">
                输入证据 {consistencyMeta.context.inputTokens.toLocaleString()} / {consistencyMeta.context.inputBudget.toLocaleString()} tokens
                {' · '}纳入 {consistencyMeta.context.included.length}
                {' · '}省略 {consistencyMeta.context.omitted.length}
                {' · '}裁剪 {consistencyMeta.context.trimmed.length}
                {' · '}截断 {consistencyMeta.context.truncated?.length ?? '未记录'}
              </p>
            )}
            {(consistencyMeta.context.trimmed.length > 0 || (consistencyMeta.context.truncated?.length ?? 0) > 0) && (
              <p className="mt-1 text-warning">部分资料未完整读取，以下结果只覆盖实际收到的内容。</p>
            )}
            {!consistencyMeta.context.contentRevisionHash && consistencyMeta.mode !== 'background' && (
              <p className="mt-1 text-warning">这份报告未记录作品资料版本，只对应当时正文。</p>
            )}
          </div>
        )}
        {(consistencyError || qualityError) && (
          <div className="text-xs text-error bg-error/10 px-3 py-2 rounded-lg mb-3">
            {qualityError || consistencyError}
          </div>
        )}

        {!currentResult && !consistencyRunning && !qualityRunning && (
          <div className="text-center py-8 text-text-muted text-sm">
            点击「开始检测」运行{activeTab === 'consistency' ? (auditMode === 'fast' ? ' Fast Guard' : ' Deep Audit') : activeTab === 'review' ? '审校' : activeTab === 'antiAI' ? '表达与重复评审' : '追读力评估'}
          </div>
        )}

        {(consistencyRunning || qualityRunning) && (
          <div className="flex items-center justify-center py-8 gap-2 text-text-muted text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            AI 正在分析...
          </div>
        )}

        {activeTab === 'consistency' && consistencyResult && !consistencyRunning && (
          <ConsistencyResultView result={consistencyResult} />
        )}

        {activeTab !== 'consistency' && qualityResult && !qualityRunning && <>
          <WholeQualityReportView result={qualityResult} selected={selectedIssues} disabled={revisionBusy || !qualityResult.current} toggle={id => setSelectedIssues(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id])} />
          {qualityResult.current && qualityResult.report.issues.length > 0 && <div className="mt-4 space-y-3 rounded border border-border p-3">
            <p className="text-sm font-medium">按选中问题修稿</p>
            <p className="text-xs text-text-muted">默认只允许修改问题所在段落。你可以增加相关段落，并保护要保留的原句；本轮再调用最多两次模型，先看修订与复核结果，再确认写回。</p>
            <QualityRevisionScopeControls chapterText={chapterContent} extraParagraphs={extraParagraphs} protectedText={protectedText} disabled={revisionBusy} setExtraParagraphs={setExtraParagraphs} setProtectedText={setProtectedText} />
            <label className="block text-xs">本轮修稿要求（可选）
              <textarea aria-label="本轮修稿要求" maxLength={16000} rows={3} className="mt-1 w-full rounded border border-border bg-bg-base p-2" value={revisionAuthorRequest} disabled={revisionBusy || qualityRunning} placeholder="说明选中问题要怎样修改，以及要保留的动作、人物表达或收尾。" onChange={event => setRevisionRequests(value => ({ ...value, [revisionRequestKey]: event.target.value }))} />
            </label>
            <button className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-50" disabled={revisionBusy || qualityRunning || !selectedIssues.length} onClick={() => void handleRevision()}>{revisionBusy ? '修订与复核中…' : '生成修订并复核'}</button>
          </div>}
        </>}
        {revisionError && <p className="mt-3 rounded bg-error/10 p-3 text-xs text-error">{revisionError}</p>}
        {revisionRecovery && !revisionView && <div data-testid="quality-revision-incomplete-run" role="status" className="mt-3 space-y-2 rounded border border-border p-3 text-xs">
          <p>有一轮修订尚未完成，尚无可采纳的预演。原稿保留；结束该轮不会调用模型。</p>
          <button disabled={revisionBusy} className="rounded border border-border px-3 py-2 disabled:opacity-50" onClick={() => void endRevisionRun(revisionRecovery.runId)}>结束未完成运行</button>
        </div>}
        {revisionView && <QualityRevisionComparisonView view={revisionView}>
          {revisionView.current && revisionView.candidate && revisionView.state === 'awaiting_confirmation' && <div className="flex gap-2"><button disabled={revisionBusy} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-50" onClick={() => void decideRevision(true)}>确认采纳修订</button><button disabled={revisionBusy} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-50" onClick={() => void decideRevision(false)}>放弃修订</button></div>}
          {(['running', 'paused', 'recovery_required'].includes(revisionView.state) || revisionView.state === 'awaiting_confirmation' && Boolean(revisionView.protectionError)) && !revisionBusy && <button className="rounded border border-border px-3 py-2 text-xs" onClick={() => void endRevisionRun(revisionView.runId)}>结束未完成运行</button>}
        </QualityRevisionComparisonView>}
      </div>
    </div>
  )
}

function ConsistencyResultView({ result }: { result: ConsistencyAuditResult }) {
  if (!result.findings.length) {
    return <p className="text-sm text-text-muted">本次未发现可定位的一致性问题，仍需核对关键事实和结算。</p>
  }
  return (
    <div className="space-y-3">
      {result.findings.map((finding, index) => (
        <div key={index} className="p-3 bg-bg-base rounded-lg border border-border">
          <div className="flex items-center gap-2 text-xs">
            <span className={
              finding.severity === 'hard' ? 'text-error'
                : finding.severity === 'risk' ? 'text-warning' : 'text-text-muted'
            }>
              {finding.severity === 'hard' ? '硬冲突' : finding.severity === 'risk' ? '软风险' : '信息不足'}
            </span>
            <span className="text-text-muted">{finding.category}</span>
          </div>
          <p className="mt-1 text-xs text-text-primary">{finding.reason}</p>
          {finding.citationWarning && <p className="mt-1 text-[11px] text-warning">附带引文与所选位置不一致，以下已显示原文，请核对意见。</p>}
          <p className="mt-1 text-[11px] text-text-muted border-l-2 border-border pl-2">正文：“{finding.quote}”</p>
          {finding.evidence.map((evidence, evidenceIndex) => (
            <p key={evidenceIndex} className="mt-1 text-[11px] text-accent/80">
              证据 {evidence.sourceType}#{evidence.sourceId}：“{evidence.quote}”
            </p>
          ))}
          {finding.suggestion && <p className="mt-1 text-xs text-accent">建议：{finding.suggestion}</p>}
        </div>
      ))}
    </div>
  )
}
