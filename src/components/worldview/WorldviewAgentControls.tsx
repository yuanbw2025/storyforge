import AuthorLengthControl from '../shared/AuthorLengthControl'
import { AUTOMATIC_AUTHOR_LENGTH_V1, resolveAuthorLengthIntentV1, authorLengthInstructionNoticeV1,
  type AuthorLengthControlValueV1 } from '../../lib/ai/author-length-intent'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorldviewReceivedContentV2 } from '../../lib/agent/run/master-worldview-v2'
import { Check, Loader2, Sparkles, Trash2 } from 'lucide-react'
import type { PendingMasterCandidate } from '../agent/useMasterCopilot'
import { useMasterCopilot } from '../agent/useMasterCopilot'
import AIFieldModeTabs from '../shared/AIFieldModeTabs'
import PromptRunPanel from '../shared/PromptRunPanel'
import {
  formatWorldviewFieldGenerationRequestV2,
  type WorldviewAgentField,
} from '../../lib/agent/worldview-field-copilot'
import type { FieldGenerationMode } from '../../lib/ai/field-generation-context'
import type { Project } from '../../lib/types'
import HarnessEvidencePanel from '../agent/HarnessEvidencePanel'
import WorldviewFieldCandidateReview, { isWorldviewReviewViewV1, worldviewReviewSessionKeyV1, worldviewEditorSessionKeyV1, readWorldviewEditorSessionKeyV1, type WorldviewReviewViewV1, type WorldviewEditorCompositionV1 } from './WorldviewFieldCandidateReview'
import { db } from '../../lib/db/schema'
import { assertRecordInScope } from '../../lib/workspace/scope'
import CopilotGenerationStatus from '../agent/CopilotGenerationStatus'

/** Parent invocation fence; caller ownership was verified independently above. */
export function acceptWorldviewEditorCompositionV1(value: unknown, live: WorldviewReviewViewV1, current: {viewKey:string;epoch:number}|null) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 5
    || Object.keys(value).some(key => !['version','sessionKey','candidateEventId','compositionActive','tailPending'].includes(key))) return null
  const state = value as WorldviewEditorCompositionV1, editor = readWorldviewEditorSessionKeyV1(state.sessionKey)
  if (!editor || live.status !== 'verified' || state.version !== 1 || editor.viewKey !== live.sessionKey
    || current?.viewKey === live.sessionKey && editor.epoch < current.epoch || state.candidateEventId !== live.eventId
    || typeof state.compositionActive !== 'boolean' || typeof state.tailPending !== 'boolean') return null
  return {state,editor}
}

/** Frozen054 V1 binding only. No lookup or write authority is granted to the main V2 route. */
function useLegacyWorldviewReviewFence({field,project,activeGroupId,copilot,candidate,hasDraft}:{
  field:WorldviewAgentField;project:Project;activeGroupId:number|null;
  copilot:ReturnType<typeof useMasterCopilot>;candidate?:PendingMasterCandidate;hasDraft:boolean
}) {
  const candidateEventId=candidate?.event.id
  const visibleDraft=hasDraft
  // The child cannot certify its own current World/Work/group. Read only the
  // actual existing conversation, never getOrCreate or mutate an owner record.
  const viewIdentity = {
    projectId: project.id ?? 0, worldId: project.activeWorldId ?? 0, workId: project.activeWorkId ?? 0,
    worldGroupId: project.enableMultiWorld ? activeGroupId : null, field,
    eventId: candidateEventId ?? 0, conversationId: candidate?.event.conversationId ?? 0,
    taskId: candidate?.payload.taskId ?? '', runId: candidate?.payload.runId ?? 0,
    runStepId: candidate?.payload.runStepId ?? '', runGeneration: candidate?.payload.runGeneration ?? 0,
    skillId: candidate?.payload.skillId ?? '',
  }
  const viewKey = worldviewReviewSessionKeyV1(viewIdentity)
  const member = candidate && copilot.pendingCandidates.some(item => item.event.id === candidate.event.id
    && item.event.conversationId === candidate.event.conversationId && item.payload.taskId === candidate.payload.taskId
    && item.payload.runId === candidate.payload.runId && item.payload.runStepId === candidate.payload.runStepId
    && item.payload.runGeneration === candidate.payload.runGeneration)
  const shapeValid = !!candidate && !!member && (!project.enableMultiWorld || Number.isSafeInteger(activeGroupId) && Number(activeGroupId) > 0)
    && isWorldviewReviewViewV1(candidate, { ...viewIdentity, version: 'worldview-review-view-v1', status: 'verified', generation: 1, sessionKey: viewKey })
  const lookupGeneration = useRef(0)
  const [ownerProof, setOwnerProof] = useState<{ key: string; generation: number; verified: boolean }>({ key: '', generation: 0, verified: false })
  const viewBinding: WorldviewReviewViewV1 = { ...viewIdentity, version: 'worldview-review-view-v1', sessionKey: viewKey,
    status: shapeValid && ownerProof.key === viewKey && ownerProof.generation === lookupGeneration.current && ownerProof.verified ? 'verified' : 'unknown', generation: ownerProof.generation }
  const [compositionState, setCompositionState] = useState<WorldviewEditorCompositionV1 | null>(null)
  const compositionRef = useRef<WorldviewEditorCompositionV1 | null>(null)
  const editorEpoch = useRef<{ viewKey: string; epoch: number } | null>(null)
  if (editorEpoch.current?.viewKey !== viewKey) { compositionRef.current = null; editorEpoch.current = null }
  const liveView = useRef<{ binding: WorldviewReviewViewV1; busy: boolean; hasDraft: boolean; candidate?: PendingMasterCandidate } | null>(null)
  liveView.current = { binding: viewBinding, busy: copilot.busy, hasDraft: !!visibleDraft, candidate }
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true
    const generation = ++lookupGeneration.current
    if (liveView.current) liveView.current.binding.status = 'unknown'
    setOwnerProof({ key: viewKey, generation, verified: false })
    if (shapeValid) void (async () => {
      const row = await db.agentConversations.get(viewIdentity.conversationId)
      const scope = { projectId: viewIdentity.projectId, worldId: viewIdentity.worldId, workId: viewIdentity.workId }
      const verified = !!row && row.projectId === scope.projectId && row.workId === scope.workId
        && row.purpose === 'master-authoring' && row.status === 'active' && (row.worldGroupId ?? null) === viewIdentity.worldGroupId
        && await assertRecordInScope(scope, 'agentConversations', row, { owner: 'work' })
      if (active && lookupGeneration.current === generation && liveView.current?.binding.sessionKey === viewKey)
        setOwnerProof({ key: viewKey, generation, verified })
    })().catch(() => { if (active && lookupGeneration.current === generation) setOwnerProof({ key: viewKey, generation, verified: false }) })
    return () => { active = false }
  }, [viewKey, shapeValid, viewIdentity.conversationId, viewIdentity.projectId, viewIdentity.worldId, viewIdentity.workId, viewIdentity.worldGroupId])
  const onEditorCompositionStateChange = useCallback((state: WorldviewEditorCompositionV1) => {
    const live = liveView.current
    if (!mounted.current || !live) return
    const accepted = acceptWorldviewEditorCompositionV1(state, live.binding, editorEpoch.current)
    if (!accepted) return
    editorEpoch.current = accepted.editor
    compositionRef.current = accepted.state
    setCompositionState(accepted.state)
  }, [])
  const currentSession = (allowComposition = false, allowDraft = true) => {
    const live = liveView.current, composition = compositionRef.current
    return mounted.current && live?.binding.sessionKey === viewKey && live.binding.status === 'verified' && !!live.candidate && isWorldviewReviewViewV1(live.candidate, live.binding) && !live.busy
      && (allowDraft || !live.hasDraft) && (allowComposition || !composition || editorEpoch.current?.viewKey !== viewKey || !composition.compositionActive && !composition.tailPending)
  }
  const compositionLocked = editorEpoch.current?.viewKey === viewKey && compositionState?.sessionKey === worldviewEditorSessionKeyV1(viewKey, editorEpoch.current.epoch) && (compositionState.compositionActive || compositionState.tailPending)
  const candidateBlocked = copilot.busy || viewBinding.status !== 'verified' || compositionLocked
  return {viewBinding,onEditorCompositionStateChange,currentSession,candidateBlocked}
}

export default function WorldviewAgentControls({
  field,
  project,
  activeGroupId,
  copilot,
  candidate,
  otherPendingWorldviewLabel,
  hasOtherPendingCandidates,
  onRunningChange,
  onAdopted,
  buttonLabel = 'AI 生成',
  resizableInputs = false,
}: {
  field: WorldviewAgentField
  project: Project
  activeGroupId: number | null
  copilot: ReturnType<typeof useMasterCopilot>
  candidate?: PendingMasterCandidate
  otherPendingWorldviewLabel?: string
  hasOtherPendingCandidates: boolean
  onRunningChange: (running: boolean) => void
  onAdopted: (candidate: PendingMasterCandidate) => Promise<void>
  buttonLabel?: string
  resizableInputs?: boolean
}) {
  const [hint, setHint] = useState('')
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const [systemOverride, setSystemOverride] = useState<string | null>(null)
  const [userOverride, setUserOverride] = useState<string | null>(null)
  const [mode, setMode] = useState<FieldGenerationMode>('expand')
  const [length, setLength] = useState<AuthorLengthControlValueV1>(AUTOMATIC_AUTHOR_LENGTH_V1)
  const [receivedContent, setReceivedContent] = useState<WorldviewReceivedContentV2 | null>(null)
  const [receivedError, setReceivedError] = useState<string | null>(null)
  const [readingReceived, setReadingReceived] = useState(false)
  const receivedReadOwner = useRef(0)
  const receivedRunId = copilot.receivedWorldviewRun?.field === field ? copilot.receivedWorldviewRun.runId : null
  useEffect(() => {
    receivedReadOwner.current += 1
    setReceivedContent(null); setReceivedError(null); setReadingReceived(false)
    return () => { receivedReadOwner.current += 1 }
  }, [receivedRunId, field, project.id, project.activeWorldId, project.activeWorkId, activeGroupId])
  const readReceived = async () => {
    const owner = ++receivedReadOwner.current
    setReadingReceived(true); setReceivedError(null)
    try {
      const content = await copilot.readReceivedWorldviewContent()
      if (receivedReadOwner.current === owner) setReceivedContent(content)
    } catch (error) {
      if (receivedReadOwner.current === owner) setReceivedError(error instanceof Error ? error.message : '暂时无法核对已收到的内容。')
    } finally {
      if (receivedReadOwner.current === owner) setReadingReceived(false)
    }
  }
  const candidateEventId = candidate?.event.id
  const visibleDraft = copilot.readVisibleCandidateDraft(candidateEventId)
  const legacyReview = candidate?.payload.skillId === 'world-origin.worldview-field'
  const legacyFence = useLegacyWorldviewReviewFence({field,project,activeGroupId,copilot,candidate:legacyReview?candidate:undefined,hasDraft:!!visibleDraft})
  const candidateBlocked = legacyReview ? legacyFence.candidateBlocked : copilot.busy
  const currentSession = (allowComposition=false,allowDraft=true) => !legacyReview || legacyFence.currentSession(allowComposition,allowDraft)
  const basis = mode === 'expand' ? length.basis ?? 'additional-text' : 'final-text'
  const effectiveLength: AuthorLengthControlValueV1 = { ...length, basis }
  const changeMode = (next: FieldGenerationMode) => {
    setMode(next)
    setLength(current => ({ ...current, basis: next === 'expand' ? 'additional-text' : 'final-text' }))
  }
  let lengthError = ''
  try { resolveAuthorLengthIntentV1({control:effectiveLength,basis,instruction:hint}) }
  catch (error) { lengthError = error instanceof Error ? error.message : '篇幅要求无效。' }

  const handleGenerate = async () => {
    onRunningChange(true)
    try {
      const request = formatWorldviewFieldGenerationRequestV2({
        field,
        mode,
        hint,
      })
      await copilot.submitTargetedRequest(request, {
        agentId: 'world-origin',
        skillId: 'world-origin.worldview-field.v2',
        targetField: field,
        authorLengthIntent: resolveAuthorLengthIntentV1({control:effectiveLength,basis,instruction:hint,
          explicitParameter:Object.prototype.hasOwnProperty.call(parameterValues,'wordCount') ? parameterValues.wordCount : undefined}),
        instruction: request,
        promptExecution: {
          version: 1,
          moduleKey: 'worldview.dimension',
          ...(Object.keys(parameterValues).length ? { parameterValues } : {}),
          ...(systemOverride === null ? {} : { systemOverride }),
          ...(userOverride === null ? {} : { userOverride }),
        },
      })
    } finally {
      onRunningChange(false)
    }
  }

  const blocked = copilot.loading
    || copilot.busy
    || copilot.pendingCandidates.length > 0
    || Boolean(lengthError)
    || (project.enableMultiWorld === true && activeGroupId == null)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <AIFieldModeTabs value={mode} onChange={changeMode} />
        <input
          value={hint}
          onChange={event => setHint(event.target.value)}
          placeholder="给 AI 的补充说明（可选）"
          className="min-w-0 flex-1 basis-40 px-2 py-1.5 bg-bg-base border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={handleGenerate}
          disabled={blocked}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded disabled:opacity-50 shrink-0 bg-accent/10 text-accent hover:bg-accent/20"
        >
          {copilot.busy
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Sparkles className="w-3.5 h-3.5" />}
          {buttonLabel}
        </button>
      </div>

      <PromptRunPanel
        moduleKey="worldview.dimension"
        parameterValues={parameterValues}
        onParamChange={setParameterValues}
        systemOverride={systemOverride}
        onSystemOverrideChange={setSystemOverride}
        userOverride={userOverride}
        onUserOverrideChange={setUserOverride}
      />

      <AuthorLengthControl value={effectiveLength} onChange={setLength} disabled={copilot.busy}
        basis={basis} allowBasisChoice={mode === 'expand'} plan={copilot.activeTaskLengthPlan}
        notice={authorLengthInstructionNoticeV1(hint,basis)} />
      {copilot.activeLengthProgress && <p role="status" className="text-xs text-text-secondary">
        已保存 {copilot.activeLengthProgress.rounds} 轮完整稿，当前计入 {copilot.activeLengthProgress.words} 字。
        {copilot.activeLengthProgress.status === 'revise-length' ? '正在按原要求调整字数…' : ''}
      </p>}

      {lengthError && (
        <p className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          {lengthError}
        </p>
      )}

      {copilot.error && (
        <p className="rounded border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {copilot.error}
        </p>
      )}

      {!copilot.busy && copilot.endableWorldviewRun && !copilot.pendingCandidates.length && <div className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs">
        <p>未完成任务 #{copilot.endableWorldviewRun.runId} 的原答和记录会保留；结束后可明确开始新任务，未知请求不会自动重发。</p>
        <button type="button" onClick={() => { void copilot.endInterruptedWorldviewRun() }} className="mt-1 text-accent">结束此未完成任务</button>
      </div>}
      {receivedRunId != null && !copilot.busy && !copilot.pendingCandidates.length && <div className="rounded border border-border bg-bg-surface px-3 py-2 text-xs">
        <button type="button" disabled={readingReceived} onClick={() => { void readReceived() }} className="text-accent">
          {readingReceived ? '正在读取已收到的内容…' : '查看已收到的内容'}
        </button>
        <p className="mt-1 text-text-secondary">上次未完成任务 #{receivedRunId} 保存的公开内容仅供核对，不是可采纳候选。</p>
        {receivedError && <p role="alert" className="mt-1 text-error">{receivedError}</p>}
        {receivedContent && <div>
          {receivedContent.kind === 'prefix' || receivedContent.completion !== 'complete'
            ? <p role="status" className="mt-1 text-warning">回答未完整完成；以下仅为已经收到并保存的内容，不会自动重发。</p>
            : <p className="mt-1 text-text-secondary">原答未通过候选校验，原文保留如下。</p>}
          {receivedContent.text
            ? <pre role="region" aria-label="已收到的原始内容" tabIndex={0} className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-base p-2">{receivedContent.text}</pre>
            : <p className="mt-1 text-text-secondary">服务未返回可显示的公开正文。</p>}
        </div>}
      </div>}
      <CopilotGenerationStatus busy={copilot.busy && !copilot.pendingCandidates.length} onStop={copilot.stop} />

      {hasOtherPendingCandidates && (
        <p className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          主 Agent 还有其他待确认候选，请先在右侧副驾中处理。
        </p>
      )}

      {!candidate && otherPendingWorldviewLabel && (
        <p className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          “{otherPendingWorldviewLabel}”还有待确认候选，请先处理后再生成其他字段。
        </p>
      )}

      {candidate && (
        <section className="border border-accent/30 bg-bg-surface p-4 rounded-lg">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">待确认 · {candidate.payload.label}</h3>
              {candidate.payload.worldviewFieldOperation && (
                <p className="mt-0.5 text-[10px] text-text-muted">
                  模式：{{
                    create: '新建', expand: '扩写', rewrite: '重写', polish: '润色',
                  }[candidate.payload.worldviewFieldOperation]}
                  {candidate.payload.worldviewFieldOutputBudget
                    ? ` · 输出上限 ${candidate.payload.worldviewFieldOutputBudget.effectiveMaxTokens.toLocaleString()} tokens`
                    : ''}
                </p>
              )}
            </div>
            <span className="text-[11px] text-text-muted">
              {candidate.payload.contextEvidence
                ? `参考资料约 ${candidate.payload.contextEvidence.estimatedInputTokens.toLocaleString()} tokens（非实际用量）`
                : `${candidate.payload.contextSources.length} 个输入来源`}
            </span>
          </div>
          <WorldviewFieldCandidateReview
            resizableInputs={resizableInputs}
            candidate={candidate}
            busy={copilot.busy || visibleDraft?.status === 'discarding'}
            visibleDraft={visibleDraft}
            viewBinding={legacyReview?legacyFence.viewBinding:undefined}
            onEditorCompositionStateChange={legacyReview?legacyFence.onEditorCompositionStateChange:undefined}
            onUpdate={(content, rawValue) => {
              if (candidateEventId != null && currentSession(true)) void copilot.updateCandidate(candidateEventId, content, { rawValue })
            }}
            onInvalidEdit={(rawValue, error) => {
              if (candidateEventId != null && currentSession(true)) void copilot.updateCandidate(candidateEventId, rawValue, { rawValue, error })
            }}
          />
          {visibleDraft && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <p role={visibleDraft.error ? 'alert' : 'status'} className={visibleDraft.error ? 'text-error' : 'text-text-muted'}>
                {visibleDraft.error ?? (visibleDraft.status === 'discarding' ? '正在读取已保存候选…' : '正在保存当前候选编辑…')}
              </p>
              <button type="button" className="text-text-secondary underline disabled:opacity-50"
                disabled={candidateBlocked || visibleDraft.status === 'discarding'}
                onClick={() => { if (candidateEventId != null && currentSession()) void copilot.discardVisibleCandidateDraft(candidateEventId) }}>
                放弃未保存修改
              </button>
            </div>
          )}
          {candidate.payload.worldviewFieldV2 && <p role="status" className="mb-2 text-xs text-text-secondary">
            当前计入 {candidate.payload.worldviewFieldV2.lengthObservation.measuredWords} 字；
            {candidate.payload.worldviewFieldV2.reason}
          </p>}
          <HarnessEvidencePanel
            contextEvidence={candidate.payload.contextEvidence}
            lifecycle={candidate.lifecycle}
            promptExecutionEvidence={candidate.payload.promptExecutionEvidence}
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={candidateBlocked}
              onClick={() => { if (currentSession()) void copilot.rejectCandidate(candidate) }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary rounded disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              拒绝
            </button>
            <button
              type="button"
              disabled={candidateBlocked || Boolean(visibleDraft)}
              onClick={() => { if (currentSession(false, false)) void onAdopted(candidate) }}
              className="flex items-center gap-1 bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 rounded disabled:opacity-50"
            >
              {copilot.busy
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Check className="h-3.5 w-3.5" />}
              采纳
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
