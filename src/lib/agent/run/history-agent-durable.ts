import { chat } from '../../ai/client'
import {
  buildHistoryAgentMessagesV1,
  parseHistoryAgentResultStrictV1,
  readHistoryAgentPromptTemplateSnapshotV1,
  readHistoryAgentPromptTemplateV1,
} from '../../history/ai-plan'
import {
  formatHistoryAgentBaselineV1,
  readHistoryAgentBaselineV1,
  type HistoryAgentBaselineV1,
  type HistoryAgentModeV1,
  type HistoryAgentTargetKindV1,
} from '../../history/agent-baseline'
import { assembleContext } from '../../registry/assemble-context'
import { adopt, hashAdoptFieldValueV1 } from '../../registry/adopt'
import type { AIConfig, ChatMessage, WorkspaceScope } from '../../types'
import { readOwnedRows } from '../../world-engine/scope'
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

export const HISTORY_AGENT_VERIFIER_SET_V1 = 'history-agent-terminal-v1' as const
export const HISTORY_AGENT_CONTEXT_SOURCE_KEYS_V1 = ['worldview', 'historyAgentBaseline'] as const

type RunAI = (messages: ChatMessage[]) => Promise<string>

export interface HistoryAgentRequestV1 {
  mode: HistoryAgentModeV1
  targetKind: HistoryAgentTargetKindV1
  targetId: number
  worldGroupId: number | null
}

export interface HistoryAgentCandidateV1 {
  version: 1
  kind: 'history-agent-candidate'
  portable: false
  projectId: number
  worldId: number
  workId: number
  request: HistoryAgentRequestV1
  baseline: HistoryAgentBaselineV1
  baselineHash: string
  sourceBaselineHash: string
  originalOutputHash: string
  contextManifestHash: string
  contextInputHash: string
  promptTemplateHash: string
  promptHash: string
  modelOutputHash: string
  result: string
  resultHash: string
  candidateHash: string
}

interface HistoryAgentAdoptionIntentV1 {
  version: 1
  kind: 'history-agent-adoption-intent'
  portable: false
  candidate: HistoryAgentCandidateV1
  intentHash: string
}

export type HistoryAgentBoundaryV1 =
  | 'model.requested'
  | 'model.responded'
  | 'candidate.checkpoint'
  | 'candidate.persisted'

export type HistoryAgentAdoptionBoundaryV1 =
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.written'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

interface PreparedHistoryAgentInputV1 {
  baseline: HistoryAgentBaselineV1
  baselineHash: string
  sourceBaselineHash: string
  originalOutputHash: string
  assembled: Awaited<ReturnType<typeof assembleContext>>
  contextInputHash: string
  promptTemplateHash: string
  promptHash: string
  messages: ChatMessage[]
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function exactKeys(row: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(row)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error(`${label}字段不在允许闭集。`)
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right)
}

function stepId(mode: HistoryAgentModeV1): `world-origin:history-${HistoryAgentModeV1}` {
  return `world-origin:history-${mode}`
}

function skillId(mode: HistoryAgentModeV1): `world-origin.history-${HistoryAgentModeV1}` {
  return `world-origin.history-${mode}`
}

function targetBinding(request: HistoryAgentRequestV1) {
  return {
    table: request.targetKind === 'event' ? 'historicalTimelineEvents' : 'historicalKeywords',
    field: request.mode === 'consult' ? 'aiConsult' : 'aiBrainstorm',
  } as const
}

function currentOutput(baseline: HistoryAgentBaselineV1): string | null {
  const item = baseline.target.item
  if (baseline.mode === 'consult') return item.aiConsultPresent ? item.aiConsult : null
  return item.aiBrainstormPresent ? item.aiBrainstorm : null
}

function currentOutputValue(baseline: HistoryAgentBaselineV1): string | null | undefined {
  const item = baseline.target.item
  if (baseline.mode === 'consult') return item.aiConsultPresent ? item.aiConsult : undefined
  return item.aiBrainstormPresent ? item.aiBrainstorm : undefined
}

function sourceBaseline(baseline: HistoryAgentBaselineV1) {
  const {
    aiConsult: _consult,
    aiConsultPresent: _consultPresent,
    aiBrainstorm: _storm,
    aiBrainstormPresent: _stormPresent,
    updatedAt: _updatedAt,
    ...item
  } = baseline.target.item
  void _consult
  void _storm
  void _consultPresent
  void _stormPresent
  void _updatedAt
  return {
    version: baseline.version,
    mode: baseline.mode,
    worldGroupId: baseline.worldGroupId,
    history: baseline.history,
    target: { kind: baseline.target.kind, item },
  }
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
  const evidence = assembled.sourceEvidence?.find(item => item.key === 'historyAgentBaseline')
  const segment = assembled.segments.find(item => item.label === '历史 Agent 正式输入基线')
  if (!segment || evidence?.status !== 'included' || evidence.delivery !== 'full') {
    throw new Error('历史 Agent 正式 baseline 未无损进入 Context Gateway。')
  }
  return segment.content
}

async function prepareInput(
  scope: WorkspaceScope,
  request: HistoryAgentRequestV1,
): Promise<PreparedHistoryAgentInputV1> {
  const [baseline, assembled] = await Promise.all([
    readHistoryAgentBaselineV1({
      scope,
      worldGroupId: request.worldGroupId,
      mode: request.mode,
      targetKind: request.targetKind,
      targetId: request.targetId,
    }),
    assembleContext({
      projectId: scope.projectId,
      scope,
      worldGroupId: request.worldGroupId,
      historyAgentMode: request.mode,
      historyAgentTargetKind: request.targetKind,
      historyAgentTargetId: request.targetId,
      sourceKeys: [...HISTORY_AGENT_CONTEXT_SOURCE_KEYS_V1],
      inputBudgetMaxTokens: 40_000,
    }),
  ])
  if (registeredBaselineSegment(assembled) !== formatHistoryAgentBaselineV1(baseline)) {
    throw new Error('历史 Agent 登记 baseline 在读取期间变化；未调用模型，请重试。')
  }
  const template = readHistoryAgentPromptTemplateV1(request.mode)
  const messages = buildHistoryAgentMessagesV1({
    mode: request.mode,
    registeredContext: assembled.text,
    template,
  })
  const modelInput = messages.map(message => message.content).join('\n')
  const missing = assembled.segments.find(segment => !modelInput.includes(segment.content))
  if (missing) throw new Error(`历史 Agent 登记来源“${missing.label}”未实际进入模型 Prompt。`)
  return {
    baseline,
    baselineHash: await hashCanonicalValue(baseline),
    sourceBaselineHash: await hashCanonicalValue(sourceBaseline(baseline)),
    originalOutputHash: await hashAdoptFieldValueV1(currentOutputValue(baseline)),
    assembled,
    contextInputHash: await hashCanonicalValue(contextInput(assembled)),
    promptTemplateHash: await hashCanonicalValue(readHistoryAgentPromptTemplateSnapshotV1(request.mode, template)),
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

function contract(scope: WorkspaceScope, request: HistoryAgentRequestV1) {
  const skill = getAgentSkillV1(skillId(request.mode), 'world-origin')
  const target = targetBinding(request)
  return {
    version: 1 as const,
    objective: `为${request.targetKind === 'event' ? '历史事件' : '历史关键词'} ${request.targetId} 生成可确认的${request.mode === 'consult' ? '考据' : '头脑风暴'}结果`,
    workflowKind: 'generate-verify-revise' as const,
    scope: { projectId: scope.projectId, worldGroupId: request.worldGroupId },
    permissions: {
      contextSourceKeys: [...HISTORY_AGENT_CONTEXT_SOURCE_KEYS_V1],
      writeTargets: [{ table: target.table, fields: [target.field], mode: 'author-confirmed' as const }],
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
      { id: 'history-agent.candidate', kind: 'output-present' as const, required: true },
      { id: 'history-agent.author', kind: 'author-confirmed' as const, required: true },
      { id: 'history-agent.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'history-agent.terminal',
      kind: 'terminal' as const,
      verifier: HISTORY_AGENT_VERIFIER_SET_V1,
      criterionIds: ['history-agent.candidate', 'history-agent.author', 'history-agent.post-state'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

function isHistoryAgentRun(contractJson: unknown, mode?: HistoryAgentModeV1): boolean {
  if (typeof contractJson !== 'string') return false
  return mode
    ? contractJson.includes(skillId(mode))
    : contractJson.includes('world-origin.history-consult') || contractJson.includes('world-origin.history-storm')
}

function assertRequest(value: unknown): asserts value is HistoryAgentRequestV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('历史 Agent 请求无效。')
  const row = value as Record<string, unknown>
  exactKeys(row, ['mode', 'targetKind', 'targetId', 'worldGroupId'], '历史 Agent 请求 ')
  if ((row.mode !== 'consult' && row.mode !== 'storm')
    || (row.targetKind !== 'event' && row.targetKind !== 'keyword')
    || !Number.isInteger(row.targetId) || (row.targetId as number) <= 0
    || (row.worldGroupId !== null && (!Number.isInteger(row.worldGroupId) || (row.worldGroupId as number) <= 0))) {
    throw new Error('历史 Agent 请求不完整。')
  }
}

function assertBaseline(value: unknown): asserts value is HistoryAgentBaselineV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('历史 Agent baseline 无效。')
  const row = value as Record<string, any>
  exactKeys(row, ['version', 'mode', 'worldGroupId', 'history', 'target'], '历史 Agent baseline ')
  if (row.version !== 1 || (row.mode !== 'consult' && row.mode !== 'storm')
    || !row.target || typeof row.target !== 'object' || Array.isArray(row.target)
    || (row.target.kind !== 'event' && row.target.kind !== 'keyword')
    || !row.target.item || typeof row.target.item !== 'object' || Array.isArray(row.target.item)
    || !Number.isInteger(row.target.item.id) || !Number.isInteger(row.target.item.projectId)) {
    throw new Error('历史 Agent baseline 不完整。')
  }
  if (typeof row.target.item.description !== 'string'
    || (row.target.item.aiConsult !== null && typeof row.target.item.aiConsult !== 'string')
    || (row.target.item.aiBrainstorm !== null && typeof row.target.item.aiBrainstorm !== 'string')) {
    throw new Error('历史 Agent 目标 baseline 无效。')
  }
}

async function parseCandidate(value: unknown): Promise<HistoryAgentCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('历史 Agent 候选检查点无效。')
  const row = value as Record<string, any>
  exactKeys(row, [
    'version', 'kind', 'portable', 'projectId', 'worldId', 'workId', 'request', 'baseline',
    'baselineHash', 'sourceBaselineHash', 'originalOutputHash', 'contextManifestHash',
    'contextInputHash', 'promptTemplateHash', 'promptHash', 'modelOutputHash', 'result',
    'resultHash', 'candidateHash',
  ], '历史 Agent 候选 ')
  if (row.version !== 1 || row.kind !== 'history-agent-candidate' || row.portable !== false
    || ![row.projectId, row.worldId, row.workId].every((id: unknown) => Number.isInteger(id) && (id as number) > 0)
    || ![
      row.baselineHash, row.sourceBaselineHash, row.originalOutputHash, row.contextManifestHash,
      row.contextInputHash, row.promptTemplateHash, row.promptHash, row.modelOutputHash,
      row.resultHash, row.candidateHash,
    ].every(isHash)) throw new Error('历史 Agent 候选检查点不完整。')
  assertRequest(row.request)
  assertBaseline(row.baseline)
  if (row.request.mode !== row.baseline.mode || row.request.targetKind !== row.baseline.target.kind
    || row.request.targetId !== row.baseline.target.item.id || row.request.worldGroupId !== row.baseline.worldGroupId
    || row.projectId !== row.baseline.target.item.projectId
    || await hashCanonicalValue(row.baseline) !== row.baselineHash
    || await hashCanonicalValue(sourceBaseline(row.baseline)) !== row.sourceBaselineHash
    || await hashAdoptFieldValueV1(currentOutputValue(row.baseline)) !== row.originalOutputHash) {
    throw new Error('历史 Agent 候选 baseline 不匹配。')
  }
  const result = parseHistoryAgentResultStrictV1(row.request.mode, row.result)
  if (result !== row.result || await hashCanonicalValue({ result }) !== row.resultHash) {
    throw new Error('历史 Agent 结果或 hash 不匹配。')
  }
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('历史 Agent 候选 hash 不匹配。')
  return row as HistoryAgentCandidateV1
}

async function parseState(value: unknown): Promise<{
  candidate: HistoryAgentCandidateV1
  intent: HistoryAgentAdoptionIntentV1 | null
}> {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'history-agent-adoption-intent') {
    const row = value as Record<string, any>
    exactKeys(row, ['version', 'kind', 'portable', 'candidate', 'intentHash'], '历史 Agent 采纳意图 ')
    if (row.version !== 1 || row.portable !== false || !isHash(row.intentHash)) {
      throw new Error('历史 Agent 采纳意图不完整。')
    }
    const candidate = await parseCandidate(row.candidate)
    const body = { version: 1 as const, kind: 'history-agent-adoption-intent' as const, portable: false as const, candidate }
    if (await hashCanonicalValue(body) !== row.intentHash) throw new Error('历史 Agent 采纳意图 hash 不匹配。')
    return { candidate, intent: row as HistoryAgentAdoptionIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

async function latestState(scope: WorkspaceScope, runId: number) {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('历史 Agent 运行缺少可验证检查点。')
  return parseState(checkpoint.resumePayload)
}

function assertCandidateScope(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: HistoryAgentCandidateV1,
): void {
  if (candidate.projectId !== scope.projectId || candidate.worldId !== scope.worldId
    || candidate.workId !== scope.workId || snapshot.run.projectId !== scope.projectId
    || (snapshot.run.worldGroupId ?? null) !== candidate.request.worldGroupId
    || snapshot.contract.executionBindings?.[0]?.stepId !== stepId(candidate.request.mode)
    || snapshot.contract.permissions.writeTargets.length !== 1) {
    throw new Error('历史 Agent 候选与当前 World/Work/世界组或运行权限不匹配。')
  }
  const expected = targetBinding(candidate.request)
  const actual = snapshot.contract.permissions.writeTargets[0]
  if (actual.table !== expected.table || !sameValue(actual.fields, [expected.field])) {
    throw new Error('历史 Agent 候选与运行写权限不匹配。')
  }
}

async function repairCandidateEventIfNeeded(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: HistoryAgentCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const step = snapshot.projection.steps[stepId(candidate.request.mode)]
  if (step?.candidateHash) return snapshot
  if (step?.status !== 'running') throw new Error('历史 Agent 候选事件无法安全重建。')
  return append(scope, snapshot, 'candidate.persisted', {
    stepId: stepId(candidate.request.mode),
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
}

async function pauseUnsafeRun(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, reason: string) {
  if (snapshot.projection.state === 'running' || snapshot.projection.state === 'awaiting_confirmation') {
    return append(scope, snapshot, 'run.paused', { reason, recoverable: false })
  }
  return snapshot
}

async function currentEvidence(scope: WorkspaceScope, candidate: HistoryAgentCandidateV1) {
  let prepared: PreparedHistoryAgentInputV1 | null = null
  try { prepared = await prepareInput(scope, candidate.request) } catch { /* stale */ }
  const output = prepared ? currentOutput(prepared.baseline) : null
  return {
    prepared,
    sourceFresh: prepared?.sourceBaselineHash === candidate.sourceBaselineHash,
    contextFresh: prepared?.contextInputHash === candidate.contextInputHash,
    promptFresh: prepared?.promptTemplateHash === candidate.promptTemplateHash
      && prepared?.promptHash === candidate.promptHash,
    originalOutputFresh: prepared?.originalOutputHash === candidate.originalOutputHash,
    postMatches: output === candidate.result,
  }
}

async function staleBeforeWrite(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: HistoryAgentCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const evidence = await currentEvidence(scope, candidate)
  if (evidence.sourceFresh && evidence.contextFresh && evidence.promptFresh && evidence.originalOutputFresh) return snapshot
  const next = await append(scope, snapshot, 'candidate.staled', {
    stepId: stepId(candidate.request.mode),
    candidateHash: candidate.candidateHash,
    reason: 'history-agent-source-output-or-prompt-changed',
  })
  throw Object.assign(new Error('历史条目、结果字段、登记上下文或 Prompt 已变化，请重新生成。'), { snapshot: next })
}

export async function generateHistoryAgentCandidateV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  mode: HistoryAgentModeV1
  targetKind: HistoryAgentTargetKindV1
  targetId: number
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (
    boundary: HistoryAgentBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: HistoryAgentCandidateV1 }> {
  if (!input.runAI && !input.aiConfig) throw new Error('历史 Agent 缺少 AI 配置。')
  const request: HistoryAgentRequestV1 = {
    mode: input.mode,
    targetKind: input.targetKind,
    targetId: input.targetId,
    worldGroupId: input.worldGroupId,
  }
  assertRequest(request)
  const prepared = await prepareInput(input.scope, request)
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    contract: contract(input.scope, request),
  })
  const currentStepId = stepId(input.mode)
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: currentStepId })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: currentStepId, attempt: 1 })
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: currentStepId,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: [...HISTORY_AGENT_CONTEXT_SOURCE_KEYS_V1],
    assembled: prepared.assembled,
    readerVersion: 'history-agent-context-v1',
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
          category: input.mode === 'consult' ? 'history.consult' : 'history.storm',
          projectId: input.scope.projectId,
          configOverrides: { maxTokens: getAgentSkillV1(skillId(input.mode)).maxOutputTokens },
          contextOverflowPolicy: 'reject',
        }))
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'history-agent-model-outcome-unknown')
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
    await pauseUnsafeRun(input.scope, snapshot, 'history-agent-model-result-uncheckpointed')
    throw error
  }
  let result: string
  try {
    result = parseHistoryAgentResultStrictV1(input.mode, raw)
  } catch (error) {
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: currentStepId,
      attempt: 1,
      code: 'history-agent-protocol-failed',
      retryable: false,
      category: 'protocol',
      action: 'fail',
    })
    await append(input.scope, snapshot, 'run.failed', { code: 'history-agent-protocol-failed', retryable: false })
    throw error
  }
  const body = {
    version: 1 as const,
    kind: 'history-agent-candidate' as const,
    portable: false as const,
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    request,
    baseline: prepared.baseline,
    baselineHash: prepared.baselineHash,
    sourceBaselineHash: prepared.sourceBaselineHash,
    originalOutputHash: prepared.originalOutputHash,
    contextManifestHash: manifest.manifestHash,
    contextInputHash: prepared.contextInputHash,
    promptTemplateHash: prepared.promptTemplateHash,
    promptHash: prepared.promptHash,
    modelOutputHash: await hashCanonicalValue({ raw }),
    result,
    resultHash: await hashCanonicalValue({ result }),
  }
  const candidate: HistoryAgentCandidateV1 = { ...body, candidateHash: await hashCanonicalValue(body) }
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

export async function readPendingHistoryAgentCandidateV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  mode?: HistoryAgentModeV1
  targetKind?: HistoryAgentTargetKindV1
  targetId?: number
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: HistoryAgentCandidateV1 } | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => ['awaiting_confirmation', 'running'].includes(row.status)
      && (row.worldGroupId ?? null) === input.worldGroupId
      && isHistoryAgentRun(row.contractJson, input.mode))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      let snapshot = await readAgentRunV1(input.scope, row.id)
      const { candidate, intent } = await latestState(input.scope, row.id)
      assertCandidateScope(input.scope, snapshot, candidate)
      if (input.targetKind && candidate.request.targetKind !== input.targetKind) continue
      if (input.targetId != null && candidate.request.targetId !== input.targetId) continue
      snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
      if (snapshot.projection.state === 'awaiting_confirmation' && !intent) return { snapshot, candidate }
    } catch {
      // Damaged or unrelated local runs remain auditable but are not offered.
    }
  }
  return null
}

export async function readRecoverableHistoryAgentRunV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  mode?: HistoryAgentModeV1
}): Promise<{
  snapshot: AgentRunSnapshotV1
  safeToResume: boolean
  candidate?: HistoryAgentCandidateV1
  adoptionPending?: boolean
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => ['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(row.status)
      && (row.worldGroupId ?? null) === input.worldGroupId
      && isHistoryAgentRun(row.contractJson, input.mode))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    const snapshot = await readAgentRunV1(input.scope, row.id)
    try {
      const state = await latestState(input.scope, row.id)
      assertCandidateScope(input.scope, snapshot, state.candidate)
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

export async function adoptHistoryAgentCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  onDurableBoundary?: (
    boundary: HistoryAgentAdoptionBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: HistoryAgentCandidateV1; receiptHash: string }> {
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
        reason: 'history-agent-terminal-evidence-stale',
      })
      await append(input.scope, snapshot, 'candidate.staled', {
        stepId: stepId(candidate.request.mode),
        candidateHash: candidate.candidateHash,
        reason: 'history-agent-terminal-evidence-stale',
      })
      throw new Error('历史 Agent 完成回执已过期。')
    }
    return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash }
  }
  if (snapshot.projection.state === 'awaiting_confirmation' && !intent) {
    snapshot = await staleBeforeWrite(input.scope, snapshot, candidate)
    const body = {
      version: 1 as const,
      kind: 'history-agent-adoption-intent' as const,
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
  if (!intent) throw new Error('历史 Agent 采纳缺少冻结意图。')
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
    await pauseUnsafeRun(input.scope, snapshot, 'history-agent-source-changed-after-confirmation')
    throw new Error('历史 Agent 冻结后上游输入已变化，正式写入已停止。')
  }
  const binding = targetBinding(candidate.request)
  if (!evidence.postMatches) {
    if (!evidence.originalOutputFresh) {
      await pauseUnsafeRun(input.scope, snapshot, 'history-agent-output-field-diverged')
      throw new Error('历史 Agent 目标结果字段已变化，正式写入已停止。')
    }
    const result = await adopt({
      projectId: input.scope.projectId,
      scope: input.scope,
      worldGroupId: candidate.request.worldGroupId,
      target: binding.table,
      recordId: candidate.request.targetId,
      mode: 'replace',
      data: { [binding.field]: candidate.result },
      compareAndSet: {
        kind: 'record-field-value-hash',
        field: binding.field,
        expectedHash: candidate.originalOutputHash,
      },
    })
    if (result.written.length !== 1 || result.unknown.length || result.typeErrors.length
      || result.fkErrors.length || result.skipped.length) {
      evidence = await currentEvidence(input.scope, candidate)
      if (!evidence.postMatches) {
        await pauseUnsafeRun(input.scope, snapshot, 'history-agent-formal-write-rejected')
        throw new Error(`历史 Agent 正式写入失败：${result.skipped[0]?.reason ?? '字段校验未通过'}。`)
      }
    }
    await input.onDurableBoundary?.('formal.written', snapshot)
  }
  if (!hasEvent(snapshot, 'adoption.committed')) {
    const adoptionHash = await hashCanonicalValue({
      intentHash: intent.intentHash,
      target: binding.table,
      recordId: candidate.request.targetId,
      fields: [binding.field],
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
      verifierSetVersion: HISTORY_AGENT_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  evidence = await currentEvidence(input.scope, candidate)
  if (!evidence.sourceFresh || !evidence.contextFresh || !evidence.promptFresh || !evidence.postMatches) {
    await pauseUnsafeRun(input.scope, snapshot, 'history-agent-terminal-evidence-stale')
    throw new Error('历史 Agent 终验时正式状态或输入证据已变化。')
  }
  const postStateHash = await hashCanonicalValue({
    table: binding.table,
    recordId: candidate.request.targetId,
    field: binding.field,
    value: candidate.result,
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
    verifierSetVersion: HISTORY_AGENT_VERIFIER_SET_V1,
    criteria: [
      { id: 'history-agent.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'history-agent.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'history-agent.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, candidate, receiptHash: receipt.receiptHash }
}

export async function rejectHistoryAgentCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate, intent } = await latestState(input.scope, input.runId)
  assertCandidateScope(input.scope, snapshot, candidate)
  snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
  if (snapshot.projection.state !== 'awaiting_confirmation' || intent) {
    throw new Error('历史 Agent 候选不在可拒绝状态。')
  }
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: stepId(candidate.request.mode),
    candidateHash: candidate.candidateHash,
    decision: 'reject',
  })
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-history-agent-result' })
}

export async function abandonHistoryAgentRunV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  if (!['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(snapshot.projection.state)) {
    throw new Error('历史 Agent 运行不在可放弃状态。')
  }
  const state = await latestState(input.scope, input.runId).catch(() => null)
  if (state?.intent || Object.values(snapshot.projection.steps).some(step => step.confirmation === 'adopt')) {
    throw new Error('历史 Agent 采纳意图已冻结，不能取消；请继续写入与终验。')
  }
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-abandoned-history-agent-run' })
}
