import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Loader2,
  PencilLine,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import {
  abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeV1,
  authorizeTextOpenWorldCreatorArtifactRepairV1,
  cancelTextOpenWorldCreatorArtifactEditIntakeV1,
  confirmTextOpenWorldCreatorArtifactEditIntentV1,
  generateTextOpenWorldCreatorArtifactEditCandidateV1,
  prepareTextOpenWorldCreatorArtifactEditV1,
  previewTextOpenWorldCreatorArtifactRepairV1,
  readLatestTextOpenWorldCreatorArtifactEditStateV1,
  rejectTextOpenWorldCreatorArtifactEditCandidateV1,
  resumeTextOpenWorldCreatorArtifactEditIntakeV1,
  reviseTextOpenWorldCreatorArtifactEditCandidateV1,
} from '../../lib/product-production/service'
import type {
  TextOpenWorldCreatorEditCandidateV1,
  TextOpenWorldCreatorEditFieldV1,
  TextOpenWorldCreatorEditIntentV1,
  TextOpenWorldCreatorEditPatchOperationV1,
} from '../../lib/open-world/creator-artifact-edit-contract'
import { TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1 } from '../../lib/open-world/creator-artifact-edit-contract'
import type { TextOpenWorldCreatorEditTargetContextV1 } from '../../lib/open-world/creator-artifact-edit-context'
import type {
  TextOpenWorldCreatorArtifactEditSelectionV1 as TextOpenWorldCreatorArtifactEditSelectionContractV1,
} from '../../lib/open-world/creator-artifact-edit'
import type { TextOpenWorldCreatorRepairImpactPlanV1 } from '../../lib/open-world/creator-artifact-repair-contract'

export type TextOpenWorldCreatorArtifactEditSelectionV1 =
  TextOpenWorldCreatorArtifactEditSelectionContractV1

export interface TextOpenWorldCreatorArtifactEditorProps {
  selection: TextOpenWorldCreatorArtifactEditSelectionV1
  eligible: boolean
  ineligibleReason?: string
  onRepairBuildCreated?: (result: {
    productionId: number
    baseBuildNumber: number
    targetBuildNumber: number
  }) => void | Promise<void>
}

interface CreatorRepairPreviewV1 {
  productionId: number
  productionStateRevision: number
  baseBuildId: number
  baseBuildNumber: number
  basePlanHash: string
  targetPlanHash: string
  impactPlan: TextOpenWorldCreatorRepairImpactPlanV1
}

interface EditableValueV1 {
  descriptor: TextOpenWorldCreatorEditFieldV1
  value: unknown
  baseValue: unknown
}

interface CreatorEditViewStateV1 {
  runId: number | null
  runState: string | null
  blockerKind: 'model-outcome-unknown' | 'intake-ready' | 'impact-analysis-pending' | null
  intakeMode: 'direct' | 'agent' | null
  blockedReason: string | null
  candidate: TextOpenWorldCreatorEditCandidateV1 | null
  intent: TextOpenWorldCreatorEditIntentV1 | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function preparedContext(value: unknown): TextOpenWorldCreatorEditTargetContextV1 {
  const outer = record(value)
  const candidate = record(outer?.targetContext) ?? record(outer?.context) ?? outer
  if (!candidate
    || candidate.schema !== 'storyforge.text-open-world-creator-edit-target-context'
    || !Array.isArray(candidate.editableFields)) {
    throw new Error('编辑准备没有返回可验证的目标上下文')
  }
  return candidate as unknown as TextOpenWorldCreatorEditTargetContextV1
}

function candidateFrom(value: unknown): TextOpenWorldCreatorEditCandidateV1 | null {
  const outer = record(value)
  const candidates = [
    outer?.candidate,
    record(outer?.state)?.candidate,
    record(outer?.checkpoint)?.candidate,
    record(record(outer?.snapshot)?.projection)?.candidate,
  ]
  for (const item of candidates) {
    const row = record(item)
    if (row?.schema === 'storyforge.text-open-world-creator-edit-candidate') {
      return row as unknown as TextOpenWorldCreatorEditCandidateV1
    }
  }
  return null
}

function intentFrom(value: unknown): TextOpenWorldCreatorEditIntentV1 | null {
  const outer = record(value)
  const candidates = [outer?.intent, record(outer?.state)?.intent, record(outer?.checkpoint)?.intent]
  for (const item of candidates) {
    const row = record(item)
    if (row?.schema === 'storyforge.text-open-world-creator-edit-intent') {
      return row as unknown as TextOpenWorldCreatorEditIntentV1
    }
  }
  return null
}

function viewState(value: unknown): CreatorEditViewStateV1 {
  const outer = record(value)
  if (!outer) {
    return {
      runId: null,
      runState: null,
      blockerKind: null,
      intakeMode: null,
      blockedReason: null,
      candidate: null,
      intent: null,
    }
  }
  const state = record(outer.state)
  const snapshot = record(outer.snapshot)
  const run = record(snapshot?.run) ?? record(outer.run)
  const runId = [outer.runId, state?.runId, run?.id].find(item => Number.isSafeInteger(item))
  const runState = [outer.runState, state?.runState, run?.status, run?.state]
    .find(item => typeof item === 'string')
  const blockerKind = outer.kind === 'model-outcome-unknown'
    || outer.kind === 'intake-ready'
    || outer.kind === 'impact-analysis-pending'
    ? outer.kind
    : null
  const blockedReason = blockerKind
    && typeof outer.message === 'string' ? outer.message : null
  return {
    runId: runId == null ? null : Number(runId),
    runState: typeof runState === 'string' ? runState : null,
    blockerKind,
    intakeMode: blockerKind === 'intake-ready'
      && (outer.mode === 'direct' || outer.mode === 'agent') ? outer.mode : null,
    blockedReason,
    candidate: candidateFrom(value),
    intent: intentFrom(value),
  }
}

function semanticFieldValues(context: TextOpenWorldCreatorEditTargetContextV1): EditableValueV1[] {
  const semanticFields = new Map(context.semanticDraft.fields.map(field => [field.fieldId, field.value]))
  return context.editableFields.map(descriptor => {
    if (!semanticFields.has(descriptor.fieldId)) {
      throw new Error(`编辑目标字段缺少当前值：${descriptor.fieldId}`)
    }
    const value = semanticFields.get(descriptor.fieldId)
    return { descriptor, value, baseValue: value }
  })
}

function normalizedJson(value: unknown): string {
  return JSON.stringify(value)
}

function displayValue(field: EditableValueV1): string | number | boolean {
  if (field.descriptor.valueKind === 'string-array') {
    return Array.isArray(field.value) ? field.value.join('\n') : ''
  }
  if (field.descriptor.valueKind === 'number') {
    return typeof field.value === 'number' ? field.value : ''
  }
  if (field.descriptor.valueKind === 'boolean') return field.value === true
  return typeof field.value === 'string' ? field.value : ''
}

function warningCodes(candidate: TextOpenWorldCreatorEditCandidateV1 | null): string[] {
  if (!candidate) return []
  return [...new Set(candidate.validation.issues
    .filter(issue => issue.severity === 'warning')
    .map(issue => issue.code))].sort((left, right) => left.localeCompare(right))
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export default function TextOpenWorldCreatorArtifactEditor(
  props: TextOpenWorldCreatorArtifactEditorProps,
) {
  const selectionKey = [
    props.selection.scope.projectId,
    props.selection.scope.worldId,
    props.selection.scope.workId,
    props.selection.productionId,
    props.selection.buildId,
    props.selection.expectedSnapshotHash,
    props.selection.artifactKey,
    props.selection.entityIdentity ?? 'artifact',
  ].join(':')
  const generation = useRef(0)
  const [context, setContext] = useState<TextOpenWorldCreatorEditTargetContextV1 | null>(null)
  const [fields, setFields] = useState<EditableValueV1[]>([])
  const [mode, setMode] = useState<'direct' | 'agent'>('direct')
  const [authorInstruction, setAuthorInstruction] = useState('')
  const [state, setState] = useState<CreatorEditViewStateV1>({
    runId: null,
    runState: null,
    blockerKind: null,
    intakeMode: null,
    blockedReason: null,
    candidate: null,
    intent: null,
  })
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [repairPreview, setRepairPreview] = useState<CreatorRepairPreviewV1 | null>(null)
  const [repairPreviewLoading, setRepairPreviewLoading] = useState(false)
  const [repairPreviewAttempted, setRepairPreviewAttempted] = useState(false)
  const [repairAcknowledged, setRepairAcknowledged] = useState(false)
  const [repairCreated, setRepairCreated] = useState(false)
  const [abandonUnknownOutcomeArmed, setAbandonUnknownOutcomeArmed] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const restore = useCallback(async () => {
    if (!props.eligible) return
    const current = ++generation.current
    setLoading(true)
    setError('')
    try {
      const [prepared, latest] = await Promise.all([
        prepareTextOpenWorldCreatorArtifactEditV1(props.selection),
        readLatestTextOpenWorldCreatorArtifactEditStateV1({ selection: props.selection }),
      ])
      if (generation.current !== current) return
      const nextContext = preparedContext(prepared)
      const nextState = viewState(latest)
      const nextFields = semanticFieldValues(nextContext)
      if (nextState.candidate) {
        const operations = new Map(nextState.candidate.patch.operations
          .map(operation => [operation.fieldId, operation.value]))
        for (const field of nextFields) {
          if (operations.has(field.descriptor.fieldId)) field.value = operations.get(field.descriptor.fieldId)
        }
        // A formal Agent run is exactly one model call. Every later revision is
        // a deterministic author Patch over the persisted candidate.
        setMode('direct')
      }
      setContext(nextContext)
      setFields(nextFields)
      setState(nextState)
      setAbandonUnknownOutcomeArmed(false)
      setAcknowledgedWarnings(nextState.intent?.warningAcknowledgementCodes ?? [])
      if (nextState.intent) {
        setNotice('修改意图已确认，等待影响分析；当前 Build 未被改写。')
      }
    } catch (cause) {
      if (generation.current === current) setError(errorMessage(cause))
    } finally {
      if (generation.current === current) setLoading(false)
    }
  }, [props.eligible, props.selection])

  useEffect(() => {
    setContext(null)
    setFields([])
    setMode('direct')
    setAuthorInstruction('')
    setState({
      runId: null,
      runState: null,
      blockerKind: null,
      intakeMode: null,
      blockedReason: null,
      candidate: null,
      intent: null,
    })
    setAbandonUnknownOutcomeArmed(false)
    setAcknowledgedWarnings([])
    setRepairPreview(null)
    setRepairPreviewLoading(false)
    setRepairPreviewAttempted(false)
    setRepairAcknowledged(false)
    setRepairCreated(false)
    setError('')
    setNotice('')
    void restore()
    return () => { generation.current += 1 }
  }, [restore, selectionKey])

  const loadRepairPreview = useCallback(async () => {
    if (!state.intent || repairCreated) return
    const current = ++generation.current
    setRepairPreviewLoading(true)
    setRepairPreviewAttempted(true)
    setRepairPreview(null)
    setRepairAcknowledged(false)
    setError('')
    try {
      const preview = await previewTextOpenWorldCreatorArtifactRepairV1({
        scope: props.selection.scope,
        productionId: props.selection.productionId,
        buildId: props.selection.buildId,
      })
      if (generation.current === current) setRepairPreview(preview)
    } catch (cause) {
      if (generation.current === current) setError(errorMessage(cause))
    } finally {
      if (generation.current === current) setRepairPreviewLoading(false)
    }
  }, [props.selection, repairCreated, state.intent])

  useEffect(() => {
    if (state.intent && !repairPreview && !repairPreviewLoading
      && !repairPreviewAttempted && !repairCreated) {
      void loadRepairPreview()
    }
  }, [loadRepairPreview, repairCreated, repairPreview, repairPreviewAttempted,
    repairPreviewLoading, state.intent])

  const operations = useMemo<TextOpenWorldCreatorEditPatchOperationV1[]>(() => fields
    .filter(field => normalizedJson(field.value) !== normalizedJson(field.baseValue))
    .map(field => ({
      op: 'replace',
      fieldId: field.descriptor.fieldId,
      baseValueHash: field.descriptor.baseValueHash,
      value: field.value,
    })), [fields])
  const warnings = useMemo(() => warningCodes(state.candidate), [state.candidate])
  const allWarningsAcknowledged = warnings.every(code => acknowledgedWarnings.includes(code))
  const tooManyOperations = operations.length
    > TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumPatchOperations
  const candidateConfirmable = state.candidate != null
    && ['ready', 'usable-with-warnings'].includes(state.candidate.status)
    && allWarningsAcknowledged
    && state.intent == null

  const updateField = (fieldId: string, value: unknown) => {
    setFields(current => current.map(field => field.descriptor.fieldId === fieldId
      ? { ...field, value }
      : field))
  }

  const chooseMode = (next: 'direct' | 'agent', focus = false) => {
    if (next === 'agent' && state.candidate) return
    setMode(next)
    if (focus) {
      queueMicrotask(() => document
        .getElementById(`text-open-world-creator-edit-tab-${next}`)?.focus())
    }
  }

  const resetFields = () => {
    setFields(current => current.map(field => ({ ...field, value: field.baseValue })))
    setAuthorInstruction('')
    setError('')
    setNotice('已恢复本次目标的基线字段；当前 Build 始终未被改写。')
  }

  const acceptCandidateResult = (raw: unknown) => {
    const next = viewState(raw)
    if (!next.candidate) throw new Error('本次执行没有形成可复核的修改候选')
    setState(next)
    setMode('direct')
    setAcknowledgedWarnings([])
    const candidateOperations = new Map(next.candidate.patch.operations
      .map(operation => [operation.fieldId, operation.value]))
    setFields(current => current.map(field => candidateOperations.has(field.descriptor.fieldId)
      ? { ...field, value: candidateOperations.get(field.descriptor.fieldId) }
      : field))
    setNotice(next.candidate.mode === 'agent'
      ? 'Agent 修改候选已持久化；后续修订只改字段且不会再次调用模型。当前 Build 未被改写。'
      : '修改候选已持久化；尚未改写当前 Build。')
  }

  const submitCandidate = async () => {
    if (!context || state.intent) return
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      const raw = state.candidate && state.runId != null
        ? await reviseTextOpenWorldCreatorArtifactEditCandidateV1({
          selection: props.selection,
          runId: state.runId,
          operations,
        })
        : await generateTextOpenWorldCreatorArtifactEditCandidateV1(mode === 'direct'
          ? { selection: props.selection, mode, operations }
          : { selection: props.selection, mode, authorInstruction: authorInstruction.trim() })
      acceptCandidateResult(raw)
    } catch (cause) {
      const message = errorMessage(cause)
      try {
        await restore()
      } finally {
        setError(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const reject = async () => {
    if (state.runId == null || !state.candidate || state.intent) return
    setSubmitting(true)
    setError('')
    try {
      await rejectTextOpenWorldCreatorArtifactEditCandidateV1({
        selection: props.selection,
        runId: state.runId,
      })
      setState({
        runId: null,
        runState: 'rejected',
        blockerKind: null,
        intakeMode: null,
        blockedReason: null,
        candidate: null,
        intent: null,
      })
      setFields(current => current.map(field => ({ ...field, value: field.baseValue })))
      setMode('direct')
      setAuthorInstruction('')
      setAcknowledgedWarnings([])
      setNotice('修改方案已拒绝；当前 Build 未被改写。')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  const confirmCandidate = async () => {
    if (!candidateConfirmable || state.runId == null) return
    setSubmitting(true)
    setError('')
    try {
      const raw = await confirmTextOpenWorldCreatorArtifactEditIntentV1({
        selection: props.selection,
        runId: state.runId,
        warningAcknowledgementCodes: warnings,
      })
      const next = viewState(raw)
      setState(current => ({
        runId: next.runId ?? current.runId,
        runState: next.runState ?? 'completed',
        blockerKind: next.blockerKind,
        intakeMode: next.intakeMode,
        blockedReason: next.blockedReason,
        candidate: next.candidate ?? current.candidate,
        intent: next.intent,
      }))
      setNotice('修改意图已确认，等待影响分析；当前 Build 未被改写。')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  const resumeIntake = async () => {
    if (state.blockerKind !== 'intake-ready' || state.runId == null) return
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      const raw = await resumeTextOpenWorldCreatorArtifactEditIntakeV1({
        selection: props.selection,
        runId: state.runId,
      })
      acceptCandidateResult(raw)
    } catch (cause) {
      const message = errorMessage(cause)
      try {
        await restore()
      } finally {
        setError(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const cancelIntake = async () => {
    if (state.blockerKind !== 'intake-ready' || state.runId == null) return
    setSubmitting(true)
    setError('')
    try {
      await cancelTextOpenWorldCreatorArtifactEditIntakeV1({
        selection: props.selection,
        runId: state.runId,
      })
      await restore()
      setNotice('尚未调用模型的修改请求已取消；没有产生模型费用，当前 Build 未被改写。')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  const abandonUnknownOutcome = async () => {
    if (state.blockerKind !== 'model-outcome-unknown'
      || state.runId == null || !abandonUnknownOutcomeArmed) return
    setSubmitting(true)
    setError('')
    try {
      await abandonTextOpenWorldCreatorArtifactEditUnknownModelOutcomeV1({
        selection: props.selection,
        runId: state.runId,
        acknowledgePossibleCharge: true,
      })
      setAbandonUnknownOutcomeArmed(false)
      await restore()
      setNotice('结果未知的模型请求已由作者明确放弃；系统没有自动重发。当前 Build 未被改写。')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  const authorizeRepair = async () => {
    if (!repairPreview || !repairAcknowledged || repairCreated) return
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      const receipt = await authorizeTextOpenWorldCreatorArtifactRepairV1({
        scope: props.selection.scope,
        productionId: repairPreview.productionId,
        expectedStateRevision: repairPreview.productionStateRevision,
        baseBuildNumber: repairPreview.baseBuildNumber,
        expectedBasePlanHash: repairPreview.basePlanHash,
        expectedHandoffSetHash: repairPreview.impactPlan.handoffSetHash,
        expectedImpactPlanHash: repairPreview.impactPlan.impactPlanHash,
        expectedTargetPlanHash: repairPreview.targetPlanHash,
      })
      if (!receipt.ok) {
        throw new Error(typeof receipt.result.message === 'string'
          ? receipt.result.message
          : `修复 Build 创建失败：${receipt.errorCode ?? 'unknown'}`)
      }
      setRepairCreated(true)
      setNotice(`修复 Build #${repairPreview.impactPlan.targetBuildNumber} 已创建；原 Build 保持不变，等待执行受影响任务。`)
      await props.onRepairBuildCreated?.({
        productionId: repairPreview.productionId,
        baseBuildNumber: repairPreview.baseBuildNumber,
        targetBuildNumber: repairPreview.impactPlan.targetBuildNumber,
      })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  if (!props.eligible) {
    return <section
      className="mt-5 rounded-lg border border-border bg-bg-base p-4"
      data-testid="text-open-world-creator-artifact-editor-unavailable"
    >
      <h4 className="text-xs font-semibold">受治理内容修改</h4>
      <p className="mt-2 text-xs leading-5 text-text-muted">
        {props.ineligibleReason ?? '只有当前 Build 中完整性与产品生产验证均通过的可编辑内容才能创建修改方案。'}
      </p>
    </section>
  }

  return <section
    className="mt-5 rounded-xl border border-accent/30 bg-bg-base p-4"
    data-testid="text-open-world-creator-artifact-editor"
    aria-busy={loading || submitting}
  >
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <PencilLine className="h-4 w-4 text-accent" aria-hidden="true" />编辑受治理内容
        </h4>
        <p className="mt-1 max-w-2xl text-[11px] leading-5 text-text-muted">
          此处只生成可复核修改候选。确认后会进入影响分析，由下一轮修复 Build 承接；当前 Build、正式 Artifact 与已发布版本不会被原地改写。
        </p>
      </div>
      <button
        type="button"
        onClick={() => void restore()}
        disabled={loading || submitting}
        className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-[11px] disabled:opacity-40"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
        恢复修改进度
      </button>
    </div>

    {error && <div role="alert" className="mt-3 rounded border border-danger/40 bg-danger/5 p-3 text-xs text-danger">
      <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />{error}
    </div>}
    {notice && <p role="status" className="mt-3 rounded border border-accent/30 bg-accent/5 p-3 text-xs leading-5">
      <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5 text-accent" aria-hidden="true" />{notice}
    </p>}

    {loading && !context ? <p className="py-6 text-center text-xs text-text-muted">
      <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" aria-hidden="true" />正在核验目标、完整 sibling 与当前 Build 快照…
    </p> : context && <>
      <dl className="mt-4 grid gap-2 text-[10px] sm:grid-cols-2">
        <div className="rounded border border-border p-2"><dt className="text-text-muted">精确目标</dt><dd className="mt-1 break-all font-mono">{context.target.artifactKey}{context.target.entityIdentity ? ` · ${context.target.entityIdentity}` : ' · 整体 Artifact'}</dd></div>
        <div className="rounded border border-border p-2"><dt className="text-text-muted">完整 sibling</dt><dd className="mt-1">{context.ownerSiblingGroup.outputArtifactKeys.length} 个 · {context.ownerSiblingGroup.ownerTaskKey}</dd></div>
      </dl>

      {state.blockerKind === 'intake-ready' && <div
        className="mt-4 rounded border border-accent/40 bg-accent/5 p-3 text-xs leading-5"
        data-testid="text-open-world-creator-edit-intake-ready"
      >
        <strong>修改请求已安全保存，尚未调用模型/形成候选。</strong>
        <p className="mt-1">
          {state.blockedReason} Run #{state.runId ?? '未知'} · {state.intakeMode ?? '模式未知'}；
          页面恢复不会自动继续，也不会产生新的模型费用。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={submitting || state.runId == null}
            onClick={() => void cancelIntake()}
            className="rounded border border-border px-3 py-2 text-[11px] disabled:opacity-40"
          >取消未调用请求</button>
          <button
            type="button"
            disabled={submitting || state.runId == null}
            onClick={() => void resumeIntake()}
            className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-[11px] font-medium text-white disabled:opacity-40"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            继续生成修改候选
          </button>
        </div>
      </div>}

      {state.blockerKind === 'model-outcome-unknown' && <div
        className="mt-4 rounded border border-warning/40 bg-warning/5 p-3 text-xs leading-5"
        data-testid="text-open-world-creator-edit-model-outcome-blocker"
      >
        <strong>模型结果状态未知，已阻止同组再次生成。</strong>
        <p className="mt-1">{state.blockedReason} Run #{state.runId ?? '未知'} 保留审计证据；当前 Build 未被改写。</p>
        {!abandonUnknownOutcomeArmed ? <button
          type="button"
          disabled={submitting || state.runId == null}
          onClick={() => setAbandonUnknownOutcomeArmed(true)}
          className="mt-3 rounded border border-warning/60 px-3 py-2 text-[11px] disabled:opacity-40"
        >放弃这个结果未知的请求</button> : <div
          className="mt-3 rounded border border-danger/40 bg-danger/5 p-3"
          data-testid="text-open-world-creator-edit-abandon-confirmation"
        >
          <strong className="text-danger">远端模型请求可能已经产生费用。</strong>
          <p className="mt-1">放弃只会关闭当前 Run，不会找回响应，也不会自动重试。之后可重新生成一次新的修改候选。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setAbandonUnknownOutcomeArmed(false)}
              className="rounded border border-border px-3 py-2 text-[11px] disabled:opacity-40"
            >返回</button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void abandonUnknownOutcome()}
              className="rounded bg-danger px-3 py-2 text-[11px] font-medium text-white disabled:opacity-40"
            >我已知晓，确认放弃</button>
          </div>
        </div>}
      </div>}

      {state.blockerKind === 'impact-analysis-pending' && <div
        className="mt-4 rounded border border-accent/40 bg-accent/5 p-3 text-xs leading-5"
        data-testid="text-open-world-creator-edit-impact-analysis-blocker"
      >
        <strong>同一内容组已有确认修改，正在等待影响分析。</strong>
        <p className="mt-1">{state.blockedReason} Run #{state.runId ?? '未知'} 保留完整交接证据；在修复 Build 承接前不会创建相互冲突的新修改。</p>
      </div>}

      {!state.intent && !state.blockedReason && <div className="mt-4">
        <div role="tablist" aria-label="内容修改方式" className="grid grid-cols-2 gap-1 rounded-lg bg-bg-surface p-1">
          <button
            id="text-open-world-creator-edit-tab-direct"
            type="button"
            role="tab"
            aria-selected={mode === 'direct'}
            aria-controls="text-open-world-creator-edit-panel-direct"
            tabIndex={mode === 'direct' ? 0 : -1}
            onClick={() => chooseMode('direct')}
            onKeyDown={event => {
              if (!state.candidate && ['ArrowLeft', 'ArrowRight', 'End'].includes(event.key)) {
                event.preventDefault()
                chooseMode('agent', true)
              }
            }}
            className={`rounded px-3 py-2 text-xs ${mode === 'direct' ? 'bg-accent text-white' : 'text-text-muted'}`}
          ><PencilLine className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />直接修改字段</button>
          <button
            id="text-open-world-creator-edit-tab-agent"
            type="button"
            role="tab"
            aria-selected={mode === 'agent'}
            aria-controls="text-open-world-creator-edit-panel-agent"
            tabIndex={mode === 'agent' ? 0 : -1}
            onClick={() => chooseMode('agent')}
            onKeyDown={event => {
              if (['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) {
                event.preventDefault()
                chooseMode('direct', true)
              }
            }}
            disabled={state.candidate != null}
            title={state.candidate ? '候选形成后只能使用确定性字段修订，避免追加模型调用。' : undefined}
            className={`rounded px-3 py-2 text-xs disabled:opacity-40 ${mode === 'agent' ? 'bg-accent text-white' : 'text-text-muted'}`}
          ><Bot className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />让 Agent 修改</button>
        </div>

        {state.candidate && <p className="mt-2 text-[10px] leading-4 text-text-muted">
          候选已经形成；后续只允许确定性字段修订，不会追加第二次模型调用。
        </p>}

        {mode === 'direct' ? <div
          id="text-open-world-creator-edit-panel-direct"
          role="tabpanel"
          aria-labelledby="text-open-world-creator-edit-tab-direct"
          className="mt-3 max-h-[36rem] space-y-3 overflow-y-auto pr-1"
        >
          {fields.map(field => <label key={field.descriptor.fieldId} className="block rounded border border-border p-3 text-xs">
            <span className="font-medium">{field.descriptor.label}</span>
            <code className="ml-2 break-all text-[9px] text-text-muted">{field.descriptor.fieldId}</code>
            {field.descriptor.valueKind === 'boolean' ? <span className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={displayValue(field) === true}
                onChange={event => updateField(field.descriptor.fieldId, event.target.checked)}
              />启用
            </span> : field.descriptor.valueKind === 'number' ? <input
              type="number"
              aria-label={field.descriptor.label}
              value={displayValue(field) as string | number}
              onChange={event => updateField(field.descriptor.fieldId,
                event.target.value === '' ? '' : Number(event.target.value))}
              className="mt-2 w-full rounded border border-border bg-bg-elevated px-3 py-2 text-text-primary"
            /> : <textarea
              aria-label={field.descriptor.label}
              value={displayValue(field) as string}
              onChange={event => updateField(
                field.descriptor.fieldId,
                field.descriptor.valueKind === 'string-array'
                  ? event.target.value.split('\n').map(item => item.trim()).filter(Boolean)
                  : event.target.value,
              )}
              rows={field.descriptor.valueKind === 'string-array' ? 4 : 3}
              placeholder={field.descriptor.valueKind === 'string-array' ? '每行一项' : undefined}
              className="mt-2 w-full resize-y rounded border border-border bg-bg-elevated px-3 py-2 text-text-primary"
            />}
            <span className="mt-1 block text-[9px] text-text-muted">{field.descriptor.valueKind} · replace-only · 稳定 ID 与集合顺序保持不变</span>
          </label>)}
          {!fields.length && <p className="rounded border border-dashed border-border p-5 text-center text-xs text-text-muted">该精确目标没有作者可修改字段。</p>}
        </div> : <div
          id="text-open-world-creator-edit-panel-agent"
          role="tabpanel"
          aria-labelledby="text-open-world-creator-edit-tab-agent"
          className="mt-3"
        >
          <label className="block text-xs font-medium">修改要求
            <textarea
              value={authorInstruction}
              onChange={event => setAuthorInstruction(event.target.value)}
              rows={5}
              maxLength={8_000}
              placeholder="说明要修改什么、必须保留什么。Agent 只会对上方精确目标的已登记字段生成一次候选。"
              className="mt-2 w-full resize-y rounded border border-border bg-bg-elevated px-3 py-2 text-text-primary"
            />
          </label>
          <p className="mt-2 text-[10px] leading-5 text-text-muted">Agent 模式需要已配置的文本模型；没有 AI Key 时仍可切回“直接修改字段”。</p>
        </div>}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <button type="button" onClick={resetFields} disabled={submitting} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">恢复基线</button>
            {mode === 'direct' && <span className={`ml-2 text-[10px] ${tooManyOperations ? 'text-danger' : 'text-text-muted'}`}>
              已改 {operations.length}/{TEXT_OPEN_WORLD_CREATOR_ARTIFACT_EDIT_LIMITS_V1.maximumPatchOperations} 个字段
            </span>}
          </div>
          <button
            type="button"
            onClick={() => void submitCandidate()}
            disabled={submitting || tooManyOperations
              || (mode === 'direct' ? operations.length === 0 : !authorInstruction.trim())}
            className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {state.candidate ? '修订修改候选' : '生成修改候选'}
          </button>
        </div>
      </div>}

      {state.candidate && <section className="mt-4 rounded-lg border border-border bg-bg-elevated p-4" aria-labelledby="text-open-world-edit-candidate-title">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h5 id="text-open-world-edit-candidate-title" className="text-xs font-semibold">修改候选</h5>
            <code className="mt-1 block break-all text-[9px] text-text-muted">{state.candidate.candidateHash}</code>
          </div>
          <span className="rounded-full border border-border px-2 py-1 text-[10px]">{state.candidate.status}</span>
        </div>

        <dl className="mt-3 grid gap-2 text-[10px] sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-border bg-bg-base p-2"><dt className="text-text-muted">修改字段</dt><dd className="mt-1">{state.candidate.patch.operations.length}</dd></div>
          <div className="rounded border border-border bg-bg-base p-2"><dt className="text-text-muted">完整 sibling 重建</dt><dd className="mt-1">{state.candidate.rebuiltArtifacts.length}/{state.candidate.ownerSiblingGroup.outputArtifactKeys.length}</dd></div>
          <div className="rounded border border-border bg-bg-base p-2"><dt className="text-text-muted">模式 / Run</dt><dd className="mt-1">{state.candidate.mode} · {state.runState ?? '状态未知'}</dd></div>
          <div className="rounded border border-border bg-bg-base p-2"><dt className="text-text-muted">模型调用 / Tokens / 耗时</dt><dd className="mt-1">{state.candidate.modelUsage.modelCalls} / {state.candidate.modelUsage.inputTokens + state.candidate.modelUsage.outputTokens} / {state.candidate.modelUsage.durationMs} ms{state.candidate.modelUsage.costUsd == null ? '' : ` · $${state.candidate.modelUsage.costUsd.toFixed(4)}`}</dd></div>
        </dl>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <section className="rounded border border-border bg-bg-base p-3">
            <h6 className="text-[11px] font-medium">完整 sibling 输出</h6>
            <ul className="mt-2 space-y-1.5 text-[10px]">
              {state.candidate.rebuiltArtifacts.map(artifact => <li key={artifact.artifactKey} className="break-all font-mono">
                {artifact.artifactKey} · v{artifact.nextVersion} · {artifact.contentHash.slice(0, 12)}…
              </li>)}
            </ul>
          </section>
          <section className="rounded border border-border bg-bg-base p-3">
            <h6 className="text-[11px] font-medium">验证 Gates</h6>
            <p className="mt-2 text-[10px] text-text-muted">通过 {state.candidate.validation.passedGateIds.length}/{state.candidate.validation.requiredGateIds.length}</p>
            <ul className="mt-2 space-y-1 text-[10px]">
              {state.candidate.validation.requiredGateIds.map(gate => <li key={gate}>
                {state.candidate!.validation.passedGateIds.includes(gate) ? '✓' : '○'} {gate}
              </li>)}
            </ul>
          </section>
        </div>

        {!!state.candidate.validation.issues.length && <section className="mt-3">
          <h6 className="text-[11px] font-medium">验证问题</h6>
          <ul className="mt-2 space-y-2">
            {state.candidate.validation.issues.map((issue, index) => <li
              key={`${issue.code}:${issue.fieldId ?? ''}:${index}`}
              className={`rounded border p-2 text-[10px] ${issue.severity === 'error' ? 'border-danger/40 bg-danger/5' : 'border-warning/40 bg-warning/5'}`}
            >
              <code>{issue.severity} · {issue.code}</code>
              <p className="mt-1 leading-4">{issue.message}</p>
            </li>)}
          </ul>
        </section>}

        {!!warnings.length && !state.intent && <fieldset className="mt-3 rounded border border-warning/40 bg-warning/5 p-3">
          <legend className="px-1 text-[11px] font-medium">逐项确认警告</legend>
          <div className="space-y-2">
            {warnings.map(code => {
              const candidate = state.candidate!
              const issue = candidate.validation.issues.find(item => item.code === code)
              return <label key={code} className="flex items-start gap-2 text-[10px] leading-4">
                <input
                  type="checkbox"
                  checked={acknowledgedWarnings.includes(code)}
                  onChange={event => setAcknowledgedWarnings(current => event.target.checked
                    ? [...new Set([...current, code])]
                    : current.filter(item => item !== code))}
                />
                <span><code>{code}</code>{issue ? `：${issue.message}` : ''}</span>
              </label>
            })}
          </div>
        </fieldset>}

        {!state.intent && <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => void reject()}
            disabled={submitting || state.runId == null}
            className="inline-flex items-center justify-center gap-1.5 rounded border border-danger/50 px-3 py-2 text-xs text-danger disabled:opacity-40"
          ><XCircle className="h-3.5 w-3.5" aria-hidden="true" />拒绝此修改方案</button>
          <button
            type="button"
            onClick={() => void confirmCandidate()}
            disabled={submitting || !candidateConfirmable || state.runId == null}
            className="inline-flex items-center justify-center gap-1.5 rounded bg-accent px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
          ><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />确认修改方案并进入影响分析</button>
        </div>}
      </section>}

      {state.intent && <section
        className="mt-4 rounded-lg border border-accent/40 bg-accent/5 p-4"
        aria-labelledby="text-open-world-repair-impact-title"
        data-testid="text-open-world-creator-repair-impact"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h5 id="text-open-world-repair-impact-title" className="text-xs font-semibold">
              修改影响与局部修复 Build
            </h5>
            <p className="mt-1 max-w-2xl text-[10px] leading-5 text-text-muted">
              系统按冻结任务 DAG 重算直接修改、下游失效与可复用任务。此处确认的是新 Build 的施工范围，不会覆盖原 Build 或已发布版本。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadRepairPreview()}
            disabled={repairPreviewLoading || submitting || repairCreated}
            className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-[10px] disabled:opacity-40"
          >
            {repairPreviewLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            重新分析影响
          </button>
        </div>

        {repairPreviewLoading && <p className="mt-4 text-xs text-text-muted">
          <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          正在核验全部确认交接、基础 Artifact 与下游依赖…
        </p>}

        {repairPreview && <>
          <dl className="mt-4 grid gap-2 text-[10px] sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded border border-border bg-bg-base p-2"><dt className="text-text-muted">Build</dt><dd className="mt-1">#{repairPreview.baseBuildNumber} → #{repairPreview.impactPlan.targetBuildNumber}</dd></div>
            <div className="rounded border border-border bg-bg-base p-2"><dt className="text-text-muted">直接修改任务</dt><dd className="mt-1">{repairPreview.impactPlan.targetTaskKeys.length}</dd></div>
            <div className="rounded border border-border bg-bg-base p-2"><dt className="text-text-muted">影响闭包任务</dt><dd className="mt-1">{repairPreview.impactPlan.staleTaskKeys.length}</dd></div>
            <div className="rounded border border-border bg-bg-base p-2"><dt className="text-text-muted">安全复用任务</dt><dd className="mt-1">{repairPreview.impactPlan.reuseTaskKeys.length}</dd></div>
            <div className="rounded border border-border bg-bg-base p-2"><dt className="text-text-muted">预计模型 / 媒资调用</dt><dd className="mt-1">{repairPreview.impactPlan.estimatedRerunBudget.modelCalls} / {repairPreview.impactPlan.estimatedRerunBudget.mediaCalls}</dd></div>
          </dl>

          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <section className="rounded border border-border bg-bg-base p-3">
              <h6 className="text-[11px] font-medium">直接采用确认修改</h6>
              <ul className="mt-2 space-y-1 text-[10px]">
                {repairPreview.impactPlan.targetTaskKeys.map(key => <li key={key}><code>{key}</code></li>)}
              </ul>
            </section>
            <section className="rounded border border-border bg-bg-base p-3">
              <h6 className="text-[11px] font-medium">下游重新生成与验证</h6>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[10px]">
                {repairPreview.impactPlan.staleTaskKeys
                  .filter(key => !repairPreview.impactPlan.targetTaskKeys.includes(key))
                  .map(key => <li key={key}><code>{key}</code></li>)}
              </ul>
            </section>
            <section className="rounded border border-border bg-bg-base p-3">
              <h6 className="text-[11px] font-medium">预算上限估算</h6>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                <div><dt className="text-text-muted">Tokens</dt><dd>{(repairPreview.impactPlan.estimatedRerunBudget.inputTokens + repairPreview.impactPlan.estimatedRerunBudget.outputTokens).toLocaleString('zh-CN')}</dd></div>
                <div><dt className="text-text-muted">最长耗时</dt><dd>{Math.ceil(repairPreview.impactPlan.estimatedRerunBudget.durationMs / 1000)} 秒</dd></div>
                <div><dt className="text-text-muted">新增存储</dt><dd>{repairPreview.impactPlan.estimatedRerunBudget.storageBytes.toLocaleString('zh-CN')} B</dd></div>
                <div><dt className="text-text-muted">最高成本</dt><dd>{repairPreview.impactPlan.estimatedRerunBudget.maximumCostUsd == null ? '未定价' : `$${repairPreview.impactPlan.estimatedRerunBudget.maximumCostUsd.toFixed(4)}`}</dd></div>
              </dl>
            </section>
          </div>

          {!repairCreated && <div className="mt-4 rounded border border-warning/40 bg-warning/5 p-3">
            <label className="flex items-start gap-2 text-[10px] leading-5">
              <input
                type="checkbox"
                checked={repairAcknowledged}
                onChange={event => setRepairAcknowledged(event.target.checked)}
              />
              <span>我已核对：直接修改会在新 Build 中采用，所有下游失效任务将重新执行，其余任务只在逐项复验通过后跨 Build 复用。</span>
            </label>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => void authorizeRepair()}
                disabled={submitting || !repairAcknowledged}
                className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                确认范围并创建修复 Build
              </button>
            </div>
          </div>}
        </>}
      </section>}
    </>}
  </section>
}
