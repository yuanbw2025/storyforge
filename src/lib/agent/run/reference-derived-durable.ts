import { chat, resolveRequestConfig } from '../../ai/client'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../ai/config-readiness'
import {
  formatReferenceDerivedBaselineV1,
  readReferenceDerivedBaselineV1,
  type ReferenceDerivedBaselineV1,
  type ReferenceDerivedModeV1,
} from '../../reference-analysis/derived-agent-baseline'
import {
  buildReferenceDerivedMessagesV1,
  parseReferenceDerivedResultStrictV1,
  readReferenceDerivedPromptTemplateSnapshotV1,
  readReferenceDerivedPromptTemplateV1,
} from '../../reference-analysis/derived-agent-plan'
import { assembleContext } from '../../registry/assemble-context'
import { adopt, hashAdoptFieldValueV1 } from '../../registry/adopt'
import type { AIConfig, ChatMessage, WorkspaceScope } from '../../types'
import { readOwnedRows } from '../../workspace/scope'
import { createAgentSkillExecutionBindingV1 } from '../execution-binding'
import { getAgentSkillV1 } from '../skill-registry'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from './checkpoint'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  staleAgentRunVerificationV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { canonicalStringify, hashCanonicalValue } from './hash'
import { createVerificationReceiptV1 } from './verification-receipt'

export const REFERENCE_DERIVED_VERIFIER_SET_V1 = 'reference-derived-terminal-v1' as const
export const REFERENCE_DERIVED_CONTEXT_SOURCE_KEYS_V1 = ['referenceDerivedBaseline'] as const

type RunAI = (messages: ChatMessage[]) => Promise<string>

export interface ReferenceDerivedRequestV1 {
  mode: ReferenceDerivedModeV1
  runId: number
}

export interface ReferenceDerivedCandidateV1 {
  version: 1
  kind: 'reference-derived-candidate'
  portable: false
  projectId: number
  worldId: number
  workId: number
  request: ReferenceDerivedRequestV1
  baseline: ReferenceDerivedBaselineV1
  baselineHash: string
  sourceBaselineHash: string
  originalRunOutputHash: string
  originalReferenceOutputHash: string
  contextManifestHash: string
  contextInputHash: string
  promptTemplateHash: string
  promptHash: string
  modelOutputHash: string
  resultJson: string
  resultHash: string
  candidateHash: string
}

interface ReferenceDerivedAdoptionIntentV1 {
  version: 1
  kind: 'reference-derived-adoption-intent'
  portable: false
  candidate: ReferenceDerivedCandidateV1
  intentHash: string
}

export type ReferenceDerivedBoundaryV1 =
  | 'model.requested'
  | 'model.responded'
  | 'candidate.checkpoint'
  | 'candidate.persisted'

export type ReferenceDerivedAdoptionBoundaryV1 =
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.run-written'
  | 'formal.projection-written'
  | 'formal.written'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

interface PreparedReferenceDerivedInputV1 {
  baseline: ReferenceDerivedBaselineV1
  baselineHash: string
  sourceBaselineHash: string
  originalRunOutputHash: string
  originalReferenceOutputHash: string
  assembled: Awaited<ReturnType<typeof assembleContext>>
  contextInputHash: string
  promptTemplateHash: string
  promptHash: string
  messages: ChatMessage[]
}

function exactKeys(row: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(row)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error(`${label}字段不在允许闭集。`)
  }
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right)
}

function stepId(mode: ReferenceDerivedModeV1): `inspiration:reference-${ReferenceDerivedModeV1}` {
  return `inspiration:reference-${mode}`
}

function skillId(mode: ReferenceDerivedModeV1): `inspiration.reference-${ReferenceDerivedModeV1}` {
  return `inspiration.reference-${mode}`
}

function outputField(mode: ReferenceDerivedModeV1): 'analysisSummary' | 'mergedCharacters' {
  return mode === 'summary' ? 'analysisSummary' : 'mergedCharacters'
}

function runOutputValue(baseline: ReferenceDerivedBaselineV1): string | null | undefined {
  return baseline.output.runPresent ? baseline.output.runValue : undefined
}

function referenceOutputValue(baseline: ReferenceDerivedBaselineV1): string | null | undefined {
  return baseline.output.referencePresent ? baseline.output.referenceValue : undefined
}

function parseStoredResult(
  mode: ReferenceDerivedModeV1,
  resultJson: string,
  baseline: ReferenceDerivedBaselineV1,
) {
  if (mode === 'summary') return parseReferenceDerivedResultStrictV1(mode, resultJson, baseline)
  let characters: unknown
  try { characters = JSON.parse(resultJson) } catch { throw new Error('参考角色聚合候选 JSON 无法解析。') }
  return parseReferenceDerivedResultStrictV1(mode, JSON.stringify({ characters }), baseline)
}

function sourceBaseline(baseline: ReferenceDerivedBaselineV1) {
  const { output: _output, ...source } = baseline
  void _output
  return source
}

function contextInput(assembled: Awaited<ReturnType<typeof assembleContext>>) {
  return {
    included: assembled.included,
    omitted: assembled.omitted,
    trimmed: assembled.trimmed,
    segments: assembled.segments.map(segment => ({ label: segment.label, content: segment.content })),
    sourceEvidence: assembled.sourceEvidence,
  }
}

function registeredBaselineSegment(assembled: Awaited<ReturnType<typeof assembleContext>>): string {
  const evidence = assembled.sourceEvidence?.find(item => item.key === 'referenceDerivedBaseline')
  const segment = assembled.segments.find(item => item.label === '参考分析派生 Agent 正式输入基线')
  if (!segment || evidence?.status !== 'included' || evidence.delivery !== 'full') {
    throw new Error('参考派生 Agent 正式 baseline 未无损进入 Context Gateway。')
  }
  return segment.content
}

async function prepareInput(
  scope: WorkspaceScope,
  request: ReferenceDerivedRequestV1,
): Promise<PreparedReferenceDerivedInputV1> {
  const [baseline, assembled] = await Promise.all([
    readReferenceDerivedBaselineV1({ scope, runId: request.runId, mode: request.mode }),
    assembleContext({
      projectId: scope.projectId,
      scope,
      referenceDerivedMode: request.mode,
      referenceAnalysisRunId: request.runId,
      sourceKeys: [...REFERENCE_DERIVED_CONTEXT_SOURCE_KEYS_V1],
      inputBudgetMaxTokens: 40_000,
    }),
  ])
  if (registeredBaselineSegment(assembled) !== formatReferenceDerivedBaselineV1(baseline)) {
    throw new Error('参考派生 Agent 登记 baseline 在读取期间变化；未调用模型，请重试。')
  }
  const template = readReferenceDerivedPromptTemplateV1(request.mode)
  const messages = buildReferenceDerivedMessagesV1({
    mode: request.mode,
    registeredContext: assembled.text,
    template,
  })
  const modelInput = messages.map(message => message.content).join('\n')
  const missing = assembled.segments.find(segment => !modelInput.includes(segment.content))
  if (missing) throw new Error(`参考派生 Agent 登记来源“${missing.label}”未实际进入模型 Prompt。`)
  return {
    baseline,
    baselineHash: await hashCanonicalValue(baseline),
    sourceBaselineHash: await hashCanonicalValue(sourceBaseline(baseline)),
    originalRunOutputHash: await hashAdoptFieldValueV1(runOutputValue(baseline)),
    originalReferenceOutputHash: await hashAdoptFieldValueV1(referenceOutputValue(baseline)),
    assembled,
    contextInputHash: await hashCanonicalValue(contextInput(assembled)),
    promptTemplateHash: await hashCanonicalValue(readReferenceDerivedPromptTemplateSnapshotV1(request.mode, template)),
    promptHash: await hashCanonicalValue(messages),
    messages,
  }
}

async function append(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
  payload: any,
): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({
    scope,
    runId: snapshot.run.id,
    type,
    payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as any)
}

function contract(scope: WorkspaceScope, request: ReferenceDerivedRequestV1) {
  const skill = getAgentSkillV1(skillId(request.mode), 'inspiration')
  const field = outputField(request.mode)
  return {
    version: 1 as const,
    objective: `为参考分析版本 ${request.runId} 生成可确认的${request.mode === 'summary' ? '全书总结' : '角色聚合卡'}`,
    workflowKind: 'generate-verify-revise' as const,
    scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: {
      contextSourceKeys: [...REFERENCE_DERIVED_CONTEXT_SOURCE_KEYS_V1],
      writeTargets: [
        { table: 'referenceAnalysisRuns', fields: [field], mode: 'author-confirmed' as const },
        { table: 'references', fields: [field], mode: 'author-confirmed' as const },
      ],
    },
    executionBindings: [{ stepId: stepId(request.mode), ...createAgentSkillExecutionBindingV1(skill) }],
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 40_000,
      maxOutputTokens: skill.maxOutputTokens,
      maxAttemptsPerStep: 1,
      maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'reference-derived.candidate', kind: 'output-present' as const, required: true },
      { id: 'reference-derived.author', kind: 'author-confirmed' as const, required: true },
      { id: 'reference-derived.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'reference-derived.terminal',
      kind: 'terminal' as const,
      verifier: REFERENCE_DERIVED_VERIFIER_SET_V1,
      criterionIds: ['reference-derived.candidate', 'reference-derived.author', 'reference-derived.post-state'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

function isReferenceDerivedRun(contractJson: unknown, mode?: ReferenceDerivedModeV1): boolean {
  if (typeof contractJson !== 'string') return false
  return mode
    ? contractJson.includes(skillId(mode))
    : contractJson.includes('inspiration.reference-summary') || contractJson.includes('inspiration.reference-characters')
}

function assertRequest(value: unknown): asserts value is ReferenceDerivedRequestV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参考派生 Agent 请求无效。')
  const row = value as Record<string, unknown>
  exactKeys(row, ['mode', 'runId'], '参考派生 Agent 请求 ')
  if ((row.mode !== 'summary' && row.mode !== 'characters')
    || !Number.isInteger(row.runId) || (row.runId as number) <= 0) {
    throw new Error('参考派生 Agent 请求不完整。')
  }
}

function assertBaseline(value: unknown): asserts value is ReferenceDerivedBaselineV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参考派生 Agent baseline 无效。')
  const row = value as Record<string, any>
  exactKeys(row, ['version', 'mode', 'reference', 'run', 'input', 'output'], '参考派生 Agent baseline ')
  if (row.version !== 1 || (row.mode !== 'summary' && row.mode !== 'characters')
    || !row.reference || !Number.isInteger(row.reference.id)
    || !row.run || !Number.isInteger(row.run.id)
    || row.run.referenceId !== row.reference.id
    || !row.input || row.input.kind !== row.mode
    || !row.output || row.output.field !== outputField(row.mode)) {
    throw new Error('参考派生 Agent baseline 不完整。')
  }
}

async function parseCandidate(value: unknown): Promise<ReferenceDerivedCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参考派生 Agent 候选检查点无效。')
  const row = value as Record<string, any>
  exactKeys(row, [
    'version', 'kind', 'portable', 'projectId', 'worldId', 'workId', 'request', 'baseline',
    'baselineHash', 'sourceBaselineHash', 'originalRunOutputHash', 'originalReferenceOutputHash',
    'contextManifestHash', 'contextInputHash', 'promptTemplateHash', 'promptHash', 'modelOutputHash',
    'resultJson', 'resultHash', 'candidateHash',
  ], '参考派生 Agent 候选 ')
  if (row.version !== 1 || row.kind !== 'reference-derived-candidate' || row.portable !== false
    || ![row.projectId, row.worldId, row.workId].every((id: unknown) => Number.isInteger(id) && (id as number) > 0)
    || ![
      row.baselineHash, row.sourceBaselineHash, row.originalRunOutputHash, row.originalReferenceOutputHash,
      row.contextManifestHash, row.contextInputHash, row.promptTemplateHash, row.promptHash,
      row.modelOutputHash, row.resultHash, row.candidateHash,
    ].every(isHash)
    || typeof row.resultJson !== 'string') {
    throw new Error('参考派生 Agent 候选检查点不完整。')
  }
  assertRequest(row.request)
  assertBaseline(row.baseline)
  const parsed = parseStoredResult(row.request.mode, row.resultJson, row.baseline)
  if (row.request.mode !== row.baseline.mode || row.request.runId !== row.baseline.run.id
    || row.projectId !== row.baseline.run.projectId || row.projectId !== row.baseline.reference.projectId
    || parsed.resultJson !== row.resultJson
    || await hashCanonicalValue(row.baseline) !== row.baselineHash
    || await hashCanonicalValue(sourceBaseline(row.baseline)) !== row.sourceBaselineHash
    || await hashAdoptFieldValueV1(runOutputValue(row.baseline)) !== row.originalRunOutputHash
    || await hashAdoptFieldValueV1(referenceOutputValue(row.baseline)) !== row.originalReferenceOutputHash
    || await hashCanonicalValue({ resultJson: row.resultJson }) !== row.resultHash) {
    throw new Error('参考派生 Agent 候选 baseline 或结果不匹配。')
  }
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('参考派生 Agent 候选 hash 不匹配。')
  return row as ReferenceDerivedCandidateV1
}

async function parseState(value: unknown): Promise<{
  candidate: ReferenceDerivedCandidateV1
  intent: ReferenceDerivedAdoptionIntentV1 | null
}> {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'reference-derived-adoption-intent') {
    const row = value as Record<string, any>
    exactKeys(row, ['version', 'kind', 'portable', 'candidate', 'intentHash'], '参考派生 Agent 采纳意图 ')
    if (row.version !== 1 || row.portable !== false || !isHash(row.intentHash)) {
      throw new Error('参考派生 Agent 采纳意图不完整。')
    }
    const candidate = await parseCandidate(row.candidate)
    const body = { version: 1 as const, kind: 'reference-derived-adoption-intent' as const, portable: false as const, candidate }
    if (await hashCanonicalValue(body) !== row.intentHash) throw new Error('参考派生 Agent 采纳意图 hash 不匹配。')
    return { candidate, intent: row as ReferenceDerivedAdoptionIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

async function latestState(scope: WorkspaceScope, runId: number) {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('参考派生 Agent 运行缺少可验证检查点。')
  return parseState(checkpoint.resumePayload)
}

function assertCandidateScope(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: ReferenceDerivedCandidateV1,
): void {
  if (candidate.projectId !== scope.projectId || candidate.worldId !== scope.worldId
    || candidate.workId !== scope.workId || snapshot.run.projectId !== scope.projectId
    || snapshot.contract.executionBindings?.[0]?.stepId !== stepId(candidate.request.mode)
    || snapshot.contract.permissions.writeTargets.length !== 2) {
    throw new Error('参考派生 Agent 候选与当前 World/Work 或运行权限不匹配。')
  }
  const field = outputField(candidate.request.mode)
  const actual = snapshot.contract.permissions.writeTargets
  if (actual[0]?.table !== 'referenceAnalysisRuns' || !sameValue(actual[0]?.fields, [field])
    || actual[1]?.table !== 'references' || !sameValue(actual[1]?.fields, [field])) {
    throw new Error('参考派生 Agent 候选与运行写权限不匹配。')
  }
}

async function repairCandidateEventIfNeeded(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: ReferenceDerivedCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const step = snapshot.projection.steps[stepId(candidate.request.mode)]
  if (step?.candidateHash) return snapshot
  if (step?.status !== 'running') throw new Error('参考派生 Agent 候选事件无法安全重建。')
  return append(scope, snapshot, 'candidate.persisted', {
    stepId: stepId(candidate.request.mode),
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
}

async function pauseUnsafeRun(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, reason: string) {
  if (snapshot.projection.state === 'running' || snapshot.projection.state === 'awaiting_confirmation'
    || snapshot.projection.state === 'verifying') {
    return append(scope, snapshot, 'run.paused', { reason, recoverable: false })
  }
  return snapshot
}

async function currentEvidence(scope: WorkspaceScope, candidate: ReferenceDerivedCandidateV1) {
  let prepared: PreparedReferenceDerivedInputV1 | null = null
  try { prepared = await prepareInput(scope, candidate.request) } catch { /* stale */ }
  const baseline = prepared?.baseline
  const runValue = baseline ? runOutputValue(baseline) : undefined
  const referenceValue = baseline ? referenceOutputValue(baseline) : undefined
  const runMatches = runValue === candidate.resultJson
  const projectionRequired = candidate.baseline.run.status === 'active'
  const projectionMatches = !projectionRequired || referenceValue === candidate.resultJson
  return {
    prepared,
    sourceFresh: prepared?.sourceBaselineHash === candidate.sourceBaselineHash,
    contextFresh: prepared?.contextInputHash === candidate.contextInputHash,
    promptFresh: prepared?.promptTemplateHash === candidate.promptTemplateHash
      && prepared?.promptHash === candidate.promptHash,
    originalRunFresh: prepared?.originalRunOutputHash === candidate.originalRunOutputHash,
    originalReferenceFresh: prepared?.originalReferenceOutputHash === candidate.originalReferenceOutputHash,
    runMatches,
    projectionMatches,
    postMatches: runMatches && projectionMatches,
  }
}

async function staleBeforeWrite(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: ReferenceDerivedCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const evidence = await currentEvidence(scope, candidate)
  const projectionFresh = candidate.baseline.run.status !== 'active' || evidence.originalReferenceFresh
  if (evidence.sourceFresh && evidence.contextFresh && evidence.promptFresh
    && evidence.originalRunFresh && projectionFresh) return snapshot
  const next = await append(scope, snapshot, 'candidate.staled', {
    stepId: stepId(candidate.request.mode),
    candidateHash: candidate.candidateHash,
    reason: 'reference-derived-source-output-or-prompt-changed',
  })
  throw Object.assign(new Error('参考分析版本、派生字段、登记上下文或 Prompt 已变化，请重新生成。'), { snapshot: next })
}

export async function generateReferenceDerivedCandidateV1(input: {
  scope: WorkspaceScope
  mode: ReferenceDerivedModeV1
  runId: number
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (
    boundary: ReferenceDerivedBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ReferenceDerivedCandidateV1 }> {
  if (!input.runAI && !input.aiConfig) throw new Error('参考派生 Agent 缺少 AI 配置。')
  const category = input.mode === 'summary' ? 'reference.summary' : 'reference.characters'
  const requestMeta = {
    category,
    projectId: input.scope.projectId,
    configOverrides: { maxTokens: getAgentSkillV1(skillId(input.mode)).maxOutputTokens },
    contextOverflowPolicy: 'reject' as const,
  }
  if (!input.runAI) {
    const effective = resolveRequestConfig(input.aiConfig!, requestMeta).config
    if (!isAIConfigReady(effective)) throw new Error(getAIConfigRequiredMessage(effective))
  }
  const request: ReferenceDerivedRequestV1 = { mode: input.mode, runId: input.runId }
  assertRequest(request)
  const prepared = await prepareInput(input.scope, request)
  let snapshot = await createAgentRunV1({ scope: input.scope, contract: contract(input.scope, request) })
  const currentStepId = stepId(input.mode)
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: currentStepId })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: currentStepId, attempt: 1 })
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: currentStepId,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: null,
    declaredSourceKeys: [...REFERENCE_DERIVED_CONTEXT_SOURCE_KEYS_V1],
    assembled: prepared.assembled,
    readerVersion: 'reference-derived-context-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: currentStepId,
    attempt: 1,
    manifestHash: manifest.manifestHash,
  })
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: currentStepId,
    attempt: 1,
    bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]),
  })
  let raw: string
  try {
    await input.onDurableBoundary?.('model.requested', snapshot)
    raw = await (input.runAI
      ? input.runAI(prepared.messages)
      : chat(prepared.messages, input.aiConfig!, {
          category: input.mode === 'summary' ? 'reference.summary' : 'reference.characters',
          projectId: input.scope.projectId,
          configOverrides: { maxTokens: getAgentSkillV1(skillId(input.mode)).maxOutputTokens },
          contextOverflowPolicy: 'reject',
        }))
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'reference-derived-model-outcome-unknown')
    throw error
  }
  snapshot = await append(input.scope, snapshot, 'model.responded', {
    stepId: currentStepId,
    attempt: 1,
    outputHash: await hashCanonicalValue({ raw }),
  })
  try {
    await input.onDurableBoundary?.('model.responded', snapshot)
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'reference-derived-model-result-uncheckpointed')
    throw error
  }
  let resultJson: string
  try {
    resultJson = parseReferenceDerivedResultStrictV1(input.mode, raw, prepared.baseline).resultJson
  } catch (error) {
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: currentStepId,
      attempt: 1,
      code: 'reference-derived-protocol-failed',
      retryable: false,
      category: 'protocol',
      action: 'fail',
    })
    await append(input.scope, snapshot, 'run.failed', { code: 'reference-derived-protocol-failed', retryable: false })
    throw error
  }
  const body = {
    version: 1 as const,
    kind: 'reference-derived-candidate' as const,
    portable: false as const,
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    request,
    baseline: prepared.baseline,
    baselineHash: prepared.baselineHash,
    sourceBaselineHash: prepared.sourceBaselineHash,
    originalRunOutputHash: prepared.originalRunOutputHash,
    originalReferenceOutputHash: prepared.originalReferenceOutputHash,
    contextManifestHash: manifest.manifestHash,
    contextInputHash: prepared.contextInputHash,
    promptTemplateHash: prepared.promptTemplateHash,
    promptHash: prepared.promptHash,
    modelOutputHash: await hashCanonicalValue({ raw }),
    resultJson,
    resultHash: await hashCanonicalValue({ resultJson }),
  }
  const candidate: ReferenceDerivedCandidateV1 = { ...body, candidateHash: await hashCanonicalValue(body) }
  const saved = await createAgentRunCheckpointV1({
    scope: input.scope,
    runId: snapshot.run.id,
    resumePayload: candidate,
  })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: currentStepId,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
  await input.onDurableBoundary?.('candidate.persisted', snapshot)
  return { snapshot, candidate }
}

export async function readPendingReferenceDerivedCandidateV1(input: {
  scope: WorkspaceScope
  mode?: ReferenceDerivedModeV1
  analysisRunId?: number
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ReferenceDerivedCandidateV1 } | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => ['awaiting_confirmation', 'running'].includes(row.status)
      && isReferenceDerivedRun(row.contractJson, input.mode))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      let snapshot = await readAgentRunV1(input.scope, row.id)
      const { candidate, intent } = await latestState(input.scope, row.id)
      assertCandidateScope(input.scope, snapshot, candidate)
      if (input.analysisRunId != null && candidate.request.runId !== input.analysisRunId) continue
      snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
      if (snapshot.projection.state === 'awaiting_confirmation' && !intent) return { snapshot, candidate }
    } catch {
      // Damaged or unrelated local runs remain auditable but are not offered.
    }
  }
  return null
}

export async function readRecoverableReferenceDerivedRunV1(input: {
  scope: WorkspaceScope
  mode?: ReferenceDerivedModeV1
  analysisRunId?: number
}): Promise<{
  snapshot: AgentRunSnapshotV1
  safeToResume: boolean
  candidate?: ReferenceDerivedCandidateV1
  adoptionPending?: boolean
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => ['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(row.status)
      && isReferenceDerivedRun(row.contractJson, input.mode))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    const snapshot = await readAgentRunV1(input.scope, row.id)
    try {
      const state = await latestState(input.scope, row.id)
      assertCandidateScope(input.scope, snapshot, state.candidate)
      if (input.analysisRunId != null && state.candidate.request.runId !== input.analysisRunId) continue
      return {
        snapshot,
        safeToResume: true,
        candidate: state.candidate,
        adoptionPending: state.intent != null,
      }
    } catch {
      return { snapshot, safeToResume: false }
    }
  }
  return null
}

function hasEvent(snapshot: AgentRunSnapshotV1, type: string): boolean {
  return snapshot.events.some(event => event.type === type)
}

async function writeFieldWithCas(input: {
  scope: WorkspaceScope
  target: 'referenceAnalysisRuns' | 'references'
  recordId: number
  field: 'analysisSummary' | 'mergedCharacters'
  expectedHash: string
  resultJson: string
}): Promise<void> {
  const result = await adopt({
    projectId: input.scope.projectId,
    scope: input.scope,
    target: input.target,
    recordId: input.recordId,
    mode: 'replace',
    data: { [input.field]: input.resultJson },
    compareAndSet: {
      kind: 'record-field-value-hash',
      field: input.field,
      expectedHash: input.expectedHash,
    },
  })
  if (result.written.length !== 1 || result.unknown.length || result.typeErrors.length
    || result.fkErrors.length || result.skipped.length) {
    throw new Error(result.skipped[0]?.reason ?? '字段校验未通过')
  }
}

export async function adoptReferenceDerivedCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  onDurableBoundary?: (
    boundary: ReferenceDerivedAdoptionBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ReferenceDerivedCandidateV1; receiptHash: string }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate
  let intent = state.intent
  assertCandidateScope(input.scope, snapshot, candidate)
  snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
  let evidence = await currentEvidence(input.scope, candidate)
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && intent) {
    if (!evidence.sourceFresh || !evidence.contextFresh || !evidence.promptFresh || !evidence.postMatches) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope,
        runId: snapshot.run.id,
        reason: 'reference-derived-terminal-evidence-stale',
      })
      await append(input.scope, snapshot, 'candidate.staled', {
        stepId: stepId(candidate.request.mode),
        candidateHash: candidate.candidateHash,
        reason: 'reference-derived-terminal-evidence-stale',
      })
      throw new Error('参考派生 Agent 完成回执已过期。')
    }
    return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash }
  }
  if (snapshot.projection.state === 'awaiting_confirmation' && !intent) {
    snapshot = await staleBeforeWrite(input.scope, snapshot, candidate)
    const body = {
      version: 1 as const,
      kind: 'reference-derived-adoption-intent' as const,
      portable: false as const,
      candidate,
    }
    intent = { ...body, intentHash: await hashCanonicalValue(body) }
    const saved = await createAgentRunCheckpointV1({
      scope: input.scope,
      runId: snapshot.run.id,
      resumePayload: intent,
    })
    snapshot = saved.snapshot
    await input.onDurableBoundary?.('intent.checkpoint', snapshot)
  }
  if (!intent) throw new Error('参考派生 Agent 采纳缺少冻结意图。')
  if (snapshot.projection.steps[stepId(candidate.request.mode)]?.confirmation !== 'adopt') {
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: stepId(candidate.request.mode),
      candidateHash: candidate.candidateHash,
      decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
  }
  if (!hasEvent(snapshot, 'adoption.started')) {
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: stepId(candidate.request.mode),
      candidateHash: candidate.candidateHash,
      intentHash: intent.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  }
  evidence = await currentEvidence(input.scope, candidate)
  if (!evidence.sourceFresh || !evidence.contextFresh || !evidence.promptFresh) {
    await pauseUnsafeRun(input.scope, snapshot, 'reference-derived-source-changed-after-confirmation')
    throw new Error('参考派生 Agent 冻结后上游输入已变化，正式写入已停止。')
  }
  const field = outputField(candidate.request.mode)
  if (!evidence.runMatches) {
    if (!evidence.originalRunFresh) {
      await pauseUnsafeRun(input.scope, snapshot, 'reference-derived-run-field-diverged')
      throw new Error('参考分析版本派生字段已变化，正式写入已停止。')
    }
    try {
      await writeFieldWithCas({
        scope: input.scope,
        target: 'referenceAnalysisRuns',
        recordId: candidate.request.runId,
        field,
        expectedHash: candidate.originalRunOutputHash,
        resultJson: candidate.resultJson,
      })
    } catch (error) {
      evidence = await currentEvidence(input.scope, candidate)
      if (!evidence.runMatches) {
        await pauseUnsafeRun(input.scope, snapshot, 'reference-derived-run-write-rejected')
        throw new Error(`参考分析版本写入失败：${error instanceof Error ? error.message : String(error)}。`)
      }
    }
    await input.onDurableBoundary?.('formal.run-written', snapshot)
  }
  evidence = await currentEvidence(input.scope, candidate)
  if (!evidence.sourceFresh || !evidence.contextFresh || !evidence.promptFresh) {
    await pauseUnsafeRun(input.scope, snapshot, 'reference-derived-source-changed-before-projection')
    throw new Error('参考派生 Agent 写入版本后来源状态变化，兼容投影已停止。')
  }
  if (candidate.baseline.run.status === 'active' && !evidence.projectionMatches) {
    if (!evidence.originalReferenceFresh) {
      await pauseUnsafeRun(input.scope, snapshot, 'reference-derived-projection-field-diverged')
      throw new Error('当前参考资料兼容投影已变化，正式写入已停止。')
    }
    try {
      await writeFieldWithCas({
        scope: input.scope,
        target: 'references',
        recordId: candidate.baseline.reference.id,
        field,
        expectedHash: candidate.originalReferenceOutputHash,
        resultJson: candidate.resultJson,
      })
    } catch (error) {
      evidence = await currentEvidence(input.scope, candidate)
      if (!evidence.projectionMatches) {
        await pauseUnsafeRun(input.scope, snapshot, 'reference-derived-projection-write-rejected')
        throw new Error(`参考资料兼容投影写入失败：${error instanceof Error ? error.message : String(error)}。`)
      }
    }
    await input.onDurableBoundary?.('formal.projection-written', snapshot)
  }
  evidence = await currentEvidence(input.scope, candidate)
  if (!evidence.postMatches) {
    await pauseUnsafeRun(input.scope, snapshot, 'reference-derived-formal-write-incomplete')
    throw new Error('参考派生 Agent 正式写入未完整收敛。')
  }
  await input.onDurableBoundary?.('formal.written', snapshot)
  if (!hasEvent(snapshot, 'adoption.committed')) {
    const adoptionHash = await hashCanonicalValue({
      intentHash: intent.intentHash,
      runId: candidate.request.runId,
      referenceId: candidate.baseline.reference.id,
      field,
      projectionRequired: candidate.baseline.run.status === 'active',
    })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: stepId(candidate.request.mode),
      candidateHash: candidate.candidateHash,
      adoptionHash,
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  const step = snapshot.projection.steps[stepId(candidate.request.mode)]
  if (step?.status !== 'succeeded') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: stepId(candidate.request.mode),
      attempt: 1,
      outputHash: candidate.resultHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state !== 'verifying' && !snapshot.projection.terminalReceiptHash) {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: REFERENCE_DERIVED_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  evidence = await currentEvidence(input.scope, candidate)
  if (!evidence.sourceFresh || !evidence.contextFresh || !evidence.promptFresh || !evidence.postMatches) {
    await pauseUnsafeRun(input.scope, snapshot, 'reference-derived-terminal-evidence-stale')
    throw new Error('参考派生 Agent 终验时正式状态或输入证据已变化。')
  }
  const postStateHash = await hashCanonicalValue({
    runId: candidate.request.runId,
    referenceId: candidate.baseline.reference.id,
    field,
    value: candidate.resultJson,
    projectionRequired: candidate.baseline.run.status === 'active',
    sourceBaselineHash: candidate.sourceBaselineHash,
  })
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [candidate.contextManifestHash],
    candidateHashes: [candidate.candidateHash],
    adoptionEventIds: [],
    postStateHash,
    verifierSetVersion: REFERENCE_DERIVED_VERIFIER_SET_V1,
    criteria: [
      { id: 'reference-derived.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'reference-derived.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'reference-derived.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, candidate, receiptHash: receipt.receiptHash }
}

export async function rejectReferenceDerivedCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate, intent } = await latestState(input.scope, input.runId)
  assertCandidateScope(input.scope, snapshot, candidate)
  snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
  if (snapshot.projection.state !== 'awaiting_confirmation' || intent) {
    throw new Error('参考派生 Agent 候选不在可拒绝状态。')
  }
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: stepId(candidate.request.mode),
    candidateHash: candidate.candidateHash,
    decision: 'reject',
  })
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-reference-derived-result' })
}

export async function abandonReferenceDerivedRunV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  if (!['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(snapshot.projection.state)) {
    throw new Error('参考派生 Agent 运行不在可放弃状态。')
  }
  const state = await latestState(input.scope, input.runId).catch(() => null)
  if (state?.intent || Object.values(snapshot.projection.steps).some(step => step.confirmation === 'adopt')) {
    throw new Error('参考派生 Agent 采纳意图已冻结，不能取消；请继续写入与终验。')
  }
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-abandoned-reference-derived-run' })
}
