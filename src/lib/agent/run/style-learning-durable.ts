import { chat, resolveRequestConfig } from '../../ai/client'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../ai/config-readiness'
import { db } from '../../db/schema'
import { assembleContext } from '../../registry/assemble-context'
import { adopt } from '../../registry/adopt'
import {
  buildStyleLearningAgentMessagesV1,
  formatStyleLearningBaselineV1,
  normalizeStyleLearningChapterIdsV1,
  parseStyleLearningResultStrictV1,
  readStyleLearningBaselineV1,
  readStyleLearningPromptTemplateSnapshotV1,
  readStyleLearningPromptTemplateV1,
  styleLearningSourceStateV1,
  styleLearningTargetStateV1,
  type StyleLearningBaselineV1,
} from '../../style/learning-agent'
import type { AIConfig, ChatMessage, WorkspaceScope } from '../../types'
import { readOwnedRows, scopeTransactionTables } from '../../world-engine/scope'
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

export const STYLE_LEARNING_STEP_ID_V1 = 'prose:style-learn' as const
export const STYLE_LEARNING_SKILL_ID_V1 = 'prose.style-learn' as const
export const STYLE_LEARNING_VERIFIER_SET_V1 = 'style-learning-terminal-v1' as const
export const STYLE_LEARNING_CONTEXT_SOURCE_KEYS_V1 = ['styleLearningBaseline'] as const

type RunAI = (messages: ChatMessage[]) => Promise<string>

export interface StyleLearningRequestV1 {
  chapterIds: number[]
}

export interface StyleLearningFormalFieldsV1 {
  profile: string
  enabled: boolean
  sourceChapterIds: string
  sampleCount: number
  sampleWords: number
}

export interface StyleLearningCandidateV1 {
  version: 1
  kind: 'style-learning-candidate'
  portable: false
  projectId: number
  worldId: number
  workId: number
  request: StyleLearningRequestV1
  baseline: StyleLearningBaselineV1
  baselineHash: string
  sourceBaselineHash: string
  originalTargetHash: string
  contextManifestHash: string
  contextInputHash: string
  promptTemplateHash: string
  promptHash: string
  modelOutputHash: string
  result: string
  resultHash: string
  candidateHash: string
}

interface StyleLearningAdoptionIntentV1 {
  version: 1
  kind: 'style-learning-adoption-intent'
  portable: false
  candidate: StyleLearningCandidateV1
  formalFields: StyleLearningFormalFieldsV1
  formalFieldsHash: string
  intentHash: string
}

export type StyleLearningBoundaryV1 =
  | 'model.requested'
  | 'model.responded'
  | 'candidate.checkpoint'
  | 'candidate.persisted'

export type StyleLearningAdoptionBoundaryV1 =
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.written'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

interface PreparedStyleLearningInputV1 {
  baseline: StyleLearningBaselineV1
  baselineHash: string
  sourceBaselineHash: string
  originalTargetHash: string
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
  const evidence = assembled.sourceEvidence?.find(item => item.key === 'styleLearningBaseline')
  const segment = assembled.segments.find(item => item.label === '文风学习正式输入基线')
  if (!segment || evidence?.status !== 'included' || evidence.delivery !== 'full') {
    throw new Error('文风学习正式 baseline 未无损进入 Context Gateway。')
  }
  return segment.content
}

async function prepareInput(
  scope: WorkspaceScope,
  request: StyleLearningRequestV1,
): Promise<PreparedStyleLearningInputV1> {
  const [baseline, assembled] = await Promise.all([
    readStyleLearningBaselineV1({ scope, chapterIds: request.chapterIds }),
    assembleContext({
      projectId: scope.projectId,
      scope,
      styleLearningChapterIds: request.chapterIds,
      sourceKeys: [...STYLE_LEARNING_CONTEXT_SOURCE_KEYS_V1],
      inputBudgetMaxTokens: 32_000,
    }),
  ])
  if (registeredBaselineSegment(assembled) !== formatStyleLearningBaselineV1(baseline)) {
    throw new Error('文风学习登记 baseline 在读取期间变化；未调用模型，请重试。')
  }
  const template = readStyleLearningPromptTemplateV1()
  const messages = buildStyleLearningAgentMessagesV1({ registeredContext: assembled.text, template })
  const modelInput = messages.map(message => message.content).join('\n')
  const missing = assembled.segments.find(segment => !modelInput.includes(segment.content))
  if (missing) throw new Error(`文风学习登记来源“${missing.label}”未实际进入模型 Prompt。`)
  return {
    baseline,
    baselineHash: await hashCanonicalValue(baseline),
    sourceBaselineHash: await hashCanonicalValue(styleLearningSourceStateV1(baseline)),
    originalTargetHash: await hashCanonicalValue(styleLearningTargetStateV1(baseline.profile)),
    assembled,
    contextInputHash: await hashCanonicalValue(contextInput(assembled)),
    promptTemplateHash: await hashCanonicalValue(readStyleLearningPromptTemplateSnapshotV1(template)),
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

function contract(scope: WorkspaceScope, request: StyleLearningRequestV1) {
  const skill = getAgentSkillV1(STYLE_LEARNING_SKILL_ID_V1, 'prose')
  return {
    version: 1 as const,
    objective: `从 ${request.chapterIds.length} 章与作者保存的改稿证据生成可确认的文风画像`,
    workflowKind: 'generate-verify-revise' as const,
    scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: {
      contextSourceKeys: [...STYLE_LEARNING_CONTEXT_SOURCE_KEYS_V1],
      writeTargets: [{
        table: 'userStyleProfiles',
        fields: ['profile', 'enabled', 'sourceChapterIds', 'sampleCount', 'sampleWords'],
        mode: 'author-confirmed' as const,
      }],
    },
    executionBindings: [{ stepId: STYLE_LEARNING_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 32_000,
      maxOutputTokens: skill.maxOutputTokens,
      maxAttemptsPerStep: 1,
      maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'style-learning.candidate', kind: 'output-present' as const, required: true },
      { id: 'style-learning.author', kind: 'author-confirmed' as const, required: true },
      { id: 'style-learning.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'style-learning.terminal',
      kind: 'terminal' as const,
      verifier: STYLE_LEARNING_VERIFIER_SET_V1,
      criterionIds: ['style-learning.candidate', 'style-learning.author', 'style-learning.post-state'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

function isStyleLearningRun(contractJson: unknown): boolean {
  return typeof contractJson === 'string' && contractJson.includes(STYLE_LEARNING_SKILL_ID_V1)
}

function assertRequest(value: unknown): asserts value is StyleLearningRequestV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('文风学习请求无效。')
  const row = value as Record<string, unknown>
  exactKeys(row, ['chapterIds'], '文风学习请求 ')
  normalizeStyleLearningChapterIdsV1(row.chapterIds as number[])
}

function assertBaseline(value: unknown): asserts value is StyleLearningBaselineV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('文风学习 baseline 无效。')
  const row = value as Record<string, any>
  exactKeys(row, [
    'version', 'projectId', 'worldId', 'workId', 'selectedChapterIds', 'chapters', 'profile',
    'sampleCount', 'sampleWords',
  ], '文风学习 baseline ')
  if (row.version !== 1
    || ![row.projectId, row.worldId, row.workId].every((id: unknown) => Number.isInteger(id) && (id as number) > 0)
    || !Array.isArray(row.selectedChapterIds) || !Array.isArray(row.chapters)
    || !row.profile || typeof row.profile !== 'object' || Array.isArray(row.profile)
    || row.chapters.length !== row.selectedChapterIds.length
    || row.sampleCount !== row.chapters.length
    || typeof row.sampleWords !== 'number') {
    throw new Error('文风学习 baseline 不完整。')
  }
  normalizeStyleLearningChapterIdsV1(row.selectedChapterIds)
}

function assertFormalFields(value: unknown): asserts value is StyleLearningFormalFieldsV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('文风画像冻结字段无效。')
  const row = value as Record<string, unknown>
  exactKeys(row, ['profile', 'enabled', 'sourceChapterIds', 'sampleCount', 'sampleWords'], '文风画像冻结字段 ')
  if (typeof row.profile !== 'string' || typeof row.enabled !== 'boolean'
    || typeof row.sourceChapterIds !== 'string' || typeof row.sampleCount !== 'number'
    || typeof row.sampleWords !== 'number') throw new Error('文风画像冻结字段不完整。')
  const ids = JSON.parse(row.sourceChapterIds)
  normalizeStyleLearningChapterIdsV1(ids)
}

function buildFormalFields(candidate: StyleLearningCandidateV1): StyleLearningFormalFieldsV1 {
  const existing = candidate.baseline.profile
  return {
    profile: candidate.result,
    enabled: existing.present && existing.profile.trim() ? existing.enabled : true,
    sourceChapterIds: JSON.stringify(candidate.request.chapterIds),
    sampleCount: candidate.baseline.sampleCount,
    sampleWords: candidate.baseline.sampleWords,
  }
}

async function parseCandidate(value: unknown): Promise<StyleLearningCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('文风学习候选检查点无效。')
  const row = value as Record<string, any>
  exactKeys(row, [
    'version', 'kind', 'portable', 'projectId', 'worldId', 'workId', 'request', 'baseline',
    'baselineHash', 'sourceBaselineHash', 'originalTargetHash', 'contextManifestHash',
    'contextInputHash', 'promptTemplateHash', 'promptHash', 'modelOutputHash', 'result',
    'resultHash', 'candidateHash',
  ], '文风学习候选 ')
  if (row.version !== 1 || row.kind !== 'style-learning-candidate' || row.portable !== false
    || ![row.projectId, row.worldId, row.workId].every((id: unknown) => Number.isInteger(id) && (id as number) > 0)
    || ![
      row.baselineHash, row.sourceBaselineHash, row.originalTargetHash, row.contextManifestHash,
      row.contextInputHash, row.promptTemplateHash, row.promptHash, row.modelOutputHash,
      row.resultHash, row.candidateHash,
    ].every(isHash)) throw new Error('文风学习候选检查点不完整。')
  assertRequest(row.request)
  assertBaseline(row.baseline)
  const result = parseStyleLearningResultStrictV1(row.result)
  if (!sameValue(row.request.chapterIds, row.baseline.selectedChapterIds)
    || row.projectId !== row.baseline.projectId || row.worldId !== row.baseline.worldId
    || row.workId !== row.baseline.workId
    || await hashCanonicalValue(row.baseline) !== row.baselineHash
    || await hashCanonicalValue(styleLearningSourceStateV1(row.baseline)) !== row.sourceBaselineHash
    || await hashCanonicalValue(styleLearningTargetStateV1(row.baseline.profile)) !== row.originalTargetHash
    || result !== row.result || await hashCanonicalValue({ result }) !== row.resultHash) {
    throw new Error('文风学习候选 baseline、结果或 hash 不匹配。')
  }
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('文风学习候选 hash 不匹配。')
  return row as StyleLearningCandidateV1
}

async function parseState(value: unknown): Promise<{
  candidate: StyleLearningCandidateV1
  intent: StyleLearningAdoptionIntentV1 | null
}> {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'style-learning-adoption-intent') {
    const row = value as Record<string, any>
    exactKeys(row, [
      'version', 'kind', 'portable', 'candidate', 'formalFields', 'formalFieldsHash', 'intentHash',
    ], '文风学习采纳意图 ')
    if (row.version !== 1 || row.portable !== false || !isHash(row.formalFieldsHash) || !isHash(row.intentHash)) {
      throw new Error('文风学习采纳意图不完整。')
    }
    const candidate = await parseCandidate(row.candidate)
    assertFormalFields(row.formalFields)
    if (!sameValue(row.formalFields, buildFormalFields(candidate))
      || await hashCanonicalValue(row.formalFields) !== row.formalFieldsHash) {
      throw new Error('文风学习冻结字段与候选不匹配。')
    }
    const { intentHash, ...body } = row
    if (await hashCanonicalValue(body) !== intentHash) throw new Error('文风学习采纳意图 hash 不匹配。')
    return { candidate, intent: row as StyleLearningAdoptionIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

async function latestState(scope: WorkspaceScope, runId: number) {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('文风学习运行缺少可验证检查点。')
  return parseState(checkpoint.resumePayload)
}

function assertCandidateScope(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: StyleLearningCandidateV1,
): void {
  if (candidate.projectId !== scope.projectId || candidate.worldId !== scope.worldId
    || candidate.workId !== scope.workId || snapshot.run.projectId !== scope.projectId
    || snapshot.contract.executionBindings?.[0]?.stepId !== STYLE_LEARNING_STEP_ID_V1
    || snapshot.contract.permissions.writeTargets.length !== 1) {
    throw new Error('文风学习候选与当前 World/Work 或运行权限不匹配。')
  }
  const actual = snapshot.contract.permissions.writeTargets[0]
  if (actual.table !== 'userStyleProfiles'
    || !sameValue(actual.fields, ['profile', 'enabled', 'sourceChapterIds', 'sampleCount', 'sampleWords'])) {
    throw new Error('文风学习候选与运行写权限不匹配。')
  }
}

async function repairCandidateEventIfNeeded(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: StyleLearningCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const step = snapshot.projection.steps[STYLE_LEARNING_STEP_ID_V1]
  if (step?.candidateHash) return snapshot
  if (step?.status !== 'running') throw new Error('文风学习候选事件无法安全重建。')
  return append(scope, snapshot, 'candidate.persisted', {
    stepId: STYLE_LEARNING_STEP_ID_V1,
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

function formalMatches(baseline: StyleLearningBaselineV1, fields: StyleLearningFormalFieldsV1): boolean {
  const current = baseline.profile
  return current.present
    && current.profile === fields.profile
    && current.enabled === fields.enabled
    && current.sourceChapterIds === fields.sourceChapterIds
    && current.sampleCount === fields.sampleCount
    && current.sampleWords === fields.sampleWords
}

async function currentEvidence(
  scope: WorkspaceScope,
  candidate: StyleLearningCandidateV1,
  intent?: StyleLearningAdoptionIntentV1 | null,
) {
  let prepared: PreparedStyleLearningInputV1 | null = null
  try { prepared = await prepareInput(scope, candidate.request) } catch { /* stale */ }
  return {
    prepared,
    sourceFresh: prepared?.sourceBaselineHash === candidate.sourceBaselineHash,
    contextFresh: prepared?.contextInputHash === candidate.contextInputHash,
    promptFresh: prepared?.promptTemplateHash === candidate.promptTemplateHash
      && prepared?.promptHash === candidate.promptHash,
    originalTargetFresh: prepared?.originalTargetHash === candidate.originalTargetHash,
    postMatches: !!(prepared && intent && formalMatches(prepared.baseline, intent.formalFields)),
  }
}

async function staleBeforeWrite(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: StyleLearningCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const evidence = await currentEvidence(scope, candidate)
  if (evidence.sourceFresh && evidence.contextFresh && evidence.promptFresh && evidence.originalTargetFresh) return snapshot
  const next = await append(scope, snapshot, 'candidate.staled', {
    stepId: STYLE_LEARNING_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    reason: 'style-learning-source-target-or-prompt-changed',
  })
  throw Object.assign(new Error('文风样本、画像、登记上下文或 Prompt 已变化，请重新学习。'), { snapshot: next })
}

export async function generateStyleLearningCandidateV1(input: {
  scope: WorkspaceScope
  chapterIds: readonly number[]
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (
    boundary: StyleLearningBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: StyleLearningCandidateV1 }> {
  if (!input.runAI && !input.aiConfig) throw new Error('文风学习 Agent 缺少 AI 配置。')
  const requestMeta = {
    category: 'style.learn' as const,
    projectId: input.scope.projectId,
    configOverrides: { maxTokens: getAgentSkillV1(STYLE_LEARNING_SKILL_ID_V1).maxOutputTokens },
    contextOverflowPolicy: 'reject' as const,
  }
  if (!input.runAI) {
    const effective = resolveRequestConfig(input.aiConfig!, requestMeta).config
    if (!isAIConfigReady(effective)) throw new Error(getAIConfigRequiredMessage(effective))
  }
  const request: StyleLearningRequestV1 = { chapterIds: normalizeStyleLearningChapterIdsV1(input.chapterIds) }
  assertRequest(request)
  const prepared = await prepareInput(input.scope, request)
  let snapshot = await createAgentRunV1({ scope: input.scope, contract: contract(input.scope, request) })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: STYLE_LEARNING_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: STYLE_LEARNING_STEP_ID_V1, attempt: 1 })
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: STYLE_LEARNING_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: null,
    declaredSourceKeys: [...STYLE_LEARNING_CONTEXT_SOURCE_KEYS_V1],
    assembled: prepared.assembled,
    readerVersion: 'style-learning-context-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: STYLE_LEARNING_STEP_ID_V1,
    attempt: 1,
    manifestHash: manifest.manifestHash,
  })
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: STYLE_LEARNING_STEP_ID_V1,
    attempt: 1,
    bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]),
  })
  let raw: string
  try {
    await input.onDurableBoundary?.('model.requested', snapshot)
    raw = await (input.runAI
      ? input.runAI(prepared.messages)
      : chat(prepared.messages, input.aiConfig!, {
          category: 'style.learn',
          projectId: input.scope.projectId,
          configOverrides: { maxTokens: getAgentSkillV1(STYLE_LEARNING_SKILL_ID_V1).maxOutputTokens },
          contextOverflowPolicy: 'reject',
        }))
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'style-learning-model-outcome-unknown')
    throw error
  }
  snapshot = await append(input.scope, snapshot, 'model.responded', {
    stepId: STYLE_LEARNING_STEP_ID_V1,
    attempt: 1,
    outputHash: await hashCanonicalValue({ raw }),
  })
  try {
    await input.onDurableBoundary?.('model.responded', snapshot)
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'style-learning-model-result-uncheckpointed')
    throw error
  }
  let result: string
  try {
    result = parseStyleLearningResultStrictV1(raw)
  } catch (error) {
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: STYLE_LEARNING_STEP_ID_V1,
      attempt: 1,
      code: 'style-learning-protocol-failed',
      retryable: false,
      category: 'protocol',
      action: 'fail',
    })
    await append(input.scope, snapshot, 'run.failed', { code: 'style-learning-protocol-failed', retryable: false })
    throw error
  }
  const body = {
    version: 1 as const,
    kind: 'style-learning-candidate' as const,
    portable: false as const,
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    request,
    baseline: prepared.baseline,
    baselineHash: prepared.baselineHash,
    sourceBaselineHash: prepared.sourceBaselineHash,
    originalTargetHash: prepared.originalTargetHash,
    contextManifestHash: manifest.manifestHash,
    contextInputHash: prepared.contextInputHash,
    promptTemplateHash: prepared.promptTemplateHash,
    promptHash: prepared.promptHash,
    modelOutputHash: await hashCanonicalValue({ raw }),
    result,
    resultHash: await hashCanonicalValue({ result }),
  }
  const candidate: StyleLearningCandidateV1 = { ...body, candidateHash: await hashCanonicalValue(body) }
  const saved = await createAgentRunCheckpointV1({
    scope: input.scope,
    runId: snapshot.run.id,
    resumePayload: candidate,
  })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: STYLE_LEARNING_STEP_ID_V1,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
  await input.onDurableBoundary?.('candidate.persisted', snapshot)
  return { snapshot, candidate }
}

export async function readPendingStyleLearningCandidateV1(input: {
  scope: WorkspaceScope
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: StyleLearningCandidateV1 } | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => ['awaiting_confirmation', 'running'].includes(row.status) && isStyleLearningRun(row.contractJson))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      let snapshot = await readAgentRunV1(input.scope, row.id)
      const { candidate, intent } = await latestState(input.scope, row.id)
      assertCandidateScope(input.scope, snapshot, candidate)
      snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
      if (snapshot.projection.state === 'awaiting_confirmation' && !intent) return { snapshot, candidate }
    } catch {
      // Damaged runs remain auditable but are never offered as a safe candidate.
    }
  }
  return null
}

export async function readRecoverableStyleLearningRunV1(input: {
  scope: WorkspaceScope
}): Promise<{
  snapshot: AgentRunSnapshotV1
  safeToResume: boolean
  candidate?: StyleLearningCandidateV1
  adoptionPending?: boolean
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => ['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(row.status)
      && isStyleLearningRun(row.contractJson))
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

async function writeFormalFieldsAtomic(
  scope: WorkspaceScope,
  candidate: StyleLearningCandidateV1,
  intent: StyleLearningAdoptionIntentV1,
): Promise<void> {
  await db.transaction('rw', scopeTransactionTables(db.chapters, db.userStyleProfiles), async () => {
    const current = await readStyleLearningBaselineV1({ scope, chapterIds: candidate.request.chapterIds })
    if (!sameValue(styleLearningSourceStateV1(current), styleLearningSourceStateV1(candidate.baseline))
      || !sameValue(styleLearningTargetStateV1(current.profile), styleLearningTargetStateV1(candidate.baseline.profile))) {
      throw new Error('文风学习 CAS 失败：样本、反馈或原画像已变化。')
    }
    const result = await adopt({
      projectId: scope.projectId,
      scope,
      target: 'userStyleProfiles',
      mode: 'replace',
      data: { ...intent.formalFields },
    })
    if (result.written.length !== 1 || result.unknown.length || result.typeErrors.length
      || result.fkErrors.length || result.skipped.length) {
      throw new Error(`文风画像未完整通过注册表校验：${result.skipped[0]?.reason ?? '字段校验失败'}。`)
    }
  })
}

export async function adoptStyleLearningCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  onDurableBoundary?: (
    boundary: StyleLearningAdoptionBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: StyleLearningCandidateV1; receiptHash: string }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate
  let intent = state.intent
  assertCandidateScope(input.scope, snapshot, candidate)
  snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
  let evidence = await currentEvidence(input.scope, candidate, intent)
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && intent) {
    if (!evidence.sourceFresh || !evidence.contextFresh || !evidence.promptFresh || !evidence.postMatches) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope,
        runId: snapshot.run.id,
        reason: 'style-learning-terminal-evidence-stale',
      })
      await append(input.scope, snapshot, 'candidate.staled', {
        stepId: STYLE_LEARNING_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: 'style-learning-terminal-evidence-stale',
      })
      throw new Error('文风学习完成回执已过期。')
    }
    return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash }
  }
  if (snapshot.projection.state === 'awaiting_confirmation' && !intent) {
    snapshot = await staleBeforeWrite(input.scope, snapshot, candidate)
    const formalFields = buildFormalFields(candidate)
    const body = {
      version: 1 as const,
      kind: 'style-learning-adoption-intent' as const,
      portable: false as const,
      candidate,
      formalFields,
      formalFieldsHash: await hashCanonicalValue(formalFields),
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
  if (!intent) throw new Error('文风学习采纳缺少冻结意图。')
  if (snapshot.projection.steps[STYLE_LEARNING_STEP_ID_V1]?.confirmation !== 'adopt') {
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: STYLE_LEARNING_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
  }
  if (!hasEvent(snapshot, 'adoption.started')) {
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: STYLE_LEARNING_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      intentHash: intent.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  }
  evidence = await currentEvidence(input.scope, candidate, intent)
  if (!evidence.sourceFresh || !evidence.contextFresh || !evidence.promptFresh) {
    await pauseUnsafeRun(input.scope, snapshot, 'style-learning-source-changed-after-confirmation')
    throw new Error('文风学习冻结后样本、反馈、登记 Context 或 Prompt 已变化，正式写入已停止。')
  }
  if (!evidence.postMatches) {
    if (!evidence.originalTargetFresh) {
      await pauseUnsafeRun(input.scope, snapshot, 'style-learning-target-diverged')
      throw new Error('文风画像目标字段已变化，正式写入已停止。')
    }
    await writeFormalFieldsAtomic(input.scope, candidate, intent)
    await input.onDurableBoundary?.('formal.written', snapshot)
  }
  if (!hasEvent(snapshot, 'adoption.committed')) {
    const adoptionHash = await hashCanonicalValue({
      intentHash: intent.intentHash,
      table: 'userStyleProfiles',
      fields: intent.formalFields,
    })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: STYLE_LEARNING_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      adoptionHash,
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  const step = snapshot.projection.steps[STYLE_LEARNING_STEP_ID_V1]
  if (step?.status !== 'succeeded') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: STYLE_LEARNING_STEP_ID_V1,
      attempt: 1,
      outputHash: candidate.resultHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state !== 'verifying' && !snapshot.projection.terminalReceiptHash) {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: STYLE_LEARNING_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  evidence = await currentEvidence(input.scope, candidate, intent)
  if (!evidence.sourceFresh || !evidence.contextFresh || !evidence.promptFresh || !evidence.postMatches) {
    await pauseUnsafeRun(input.scope, snapshot, 'style-learning-terminal-evidence-stale')
    throw new Error(`文风学习终验时正式状态或输入证据已变化（source=${evidence.sourceFresh} context=${evidence.contextFresh} prompt=${evidence.promptFresh} post=${evidence.postMatches}）。`)
  }
  const postStateHash = await hashCanonicalValue({
    table: 'userStyleProfiles',
    fields: intent.formalFields,
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
    verifierSetVersion: STYLE_LEARNING_VERIFIER_SET_V1,
    criteria: [
      { id: 'style-learning.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'style-learning.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'style-learning.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, candidate, receiptHash: receipt.receiptHash }
}

export async function rejectStyleLearningCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate, intent } = await latestState(input.scope, input.runId)
  assertCandidateScope(input.scope, snapshot, candidate)
  snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
  if (snapshot.projection.state !== 'awaiting_confirmation' || intent) {
    throw new Error('文风学习候选不在可拒绝状态。')
  }
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: STYLE_LEARNING_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    decision: 'reject',
  })
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-style-learning-result' })
}

export async function abandonStyleLearningRunV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  if (!['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(snapshot.projection.state)) {
    throw new Error('文风学习运行不在可放弃状态。')
  }
  const state = await latestState(input.scope, input.runId).catch(() => null)
  if (state?.intent || Object.values(snapshot.projection.steps).some(step => step.confirmation === 'adopt')) {
    throw new Error('文风学习采纳意图已冻结，不能取消；请继续写入与终验。')
  }
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-abandoned-style-learning-run' })
}
