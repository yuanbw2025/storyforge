import { chat } from '../../ai/client'
import {
  buildForeshadowSuggestionMessagesV1,
  parseForeshadowSuggestionsStrictV1,
  readForeshadowSuggestionPromptTemplateSnapshotV1,
  type RunOptions,
} from '../../ai/adapters/foreshadow-adapter'
import {
  adoptForeshadowSuggestionsAtomicV1,
  buildForeshadowSuggestionFormalItemsV1,
  formatForeshadowSuggestionBaselineV1,
  readForeshadowSuggestionBaselineV1,
  type ForeshadowSuggestionBaselineV1,
  type ForeshadowSuggestionCandidateItemV1,
  type ForeshadowSuggestionFormalItemV1,
} from '../../foreshadow/suggestions'
import { assembleContext } from '../../registry/assemble-context'
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

export const FORESHADOW_SUGGESTION_STEP_ID_V1 = 'outline:foreshadow-suggestions' as const
export const FORESHADOW_SUGGESTION_VERIFIER_SET_V1 = 'foreshadow-suggestions-terminal-v1' as const
export const FORESHADOW_SUGGESTION_CONTEXT_SOURCE_KEYS_V1 = [
  'canonAssertions', 'worldview', 'storyCore', 'powerSystem', 'cultivationProgress',
  'codex', 'characters', 'creativeRules', 'worldRules', 'historical', 'locations',
  'foreshadowSuggestionBaseline',
] as const

type RunAI = (messages: ChatMessage[]) => Promise<string>

export interface ForeshadowSuggestionRequestV1 {
  worldGroupId: number | null
  parameterValues: Record<string, unknown>
  systemOverride: string | null
  userOverride: string | null
}

export interface ForeshadowSuggestionCandidateV1 {
  version: 1
  kind: 'foreshadow-suggestions-candidate'
  portable: false
  projectId: number
  worldId: number
  workId: number
  request: ForeshadowSuggestionRequestV1
  baseline: ForeshadowSuggestionBaselineV1
  baselineHash: string
  contextManifestHash: string
  contextInputHash: string
  upstreamContextHash: string
  promptTemplateHash: string
  promptHash: string
  modelOutputHash: string
  suggestions: ForeshadowSuggestionCandidateItemV1[]
  suggestionsHash: string
  candidateHash: string
}

interface ForeshadowSuggestionAdoptionIntentV1 {
  version: 1
  kind: 'foreshadow-suggestions-adoption-intent'
  portable: false
  candidate: ForeshadowSuggestionCandidateV1
  selectedIndexes: number[]
  formalItems: ForeshadowSuggestionFormalItemV1[]
  formalItemsHash: string
  intentHash: string
}

export type ForeshadowSuggestionBoundaryV1 =
  | 'model.requested'
  | 'model.responded'
  | 'candidate.checkpoint'
  | 'candidate.persisted'

export type ForeshadowSuggestionAdoptionBoundaryV1 =
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.written'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

interface PreparedInputV1 {
  baseline: ForeshadowSuggestionBaselineV1
  baselineHash: string
  assembled: Awaited<ReturnType<typeof assembleContext>>
  contextInputHash: string
  upstreamContextHash: string
  messages: ChatMessage[]
  promptTemplateHash: string
  promptHash: string
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

function normalizedRequest(input: {
  worldGroupId: number | null
  options?: RunOptions
}): ForeshadowSuggestionRequestV1 {
  return {
    worldGroupId: input.worldGroupId,
    parameterValues: { ...(input.options?.parameterValues ?? {}) },
    systemOverride: input.options?.overrides?.systemPrompt ?? null,
    userOverride: input.options?.overrides?.userPromptTemplate ?? null,
  }
}

function promptOptions(request: ForeshadowSuggestionRequestV1): RunOptions | undefined {
  const parameterValues = Object.keys(request.parameterValues).length ? request.parameterValues : undefined
  const overrides = request.systemOverride != null || request.userOverride != null
    ? {
        systemPrompt: request.systemOverride ?? undefined,
        userPromptTemplate: request.userOverride ?? undefined,
      }
    : undefined
  return parameterValues || overrides ? { parameterValues, overrides } : undefined
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

function contextInput(assembled: Awaited<ReturnType<typeof assembleContext>>) {
  return {
    included: assembled.included,
    omitted: assembled.omitted,
    trimmed: assembled.trimmed,
    segments: assembled.segments.map(segment => ({ label: segment.label, content: segment.content })),
    sourceEvidence: assembled.sourceEvidence,
  }
}

function upstreamContextInput(assembled: Awaited<ReturnType<typeof assembleContext>>) {
  const excluded = new Set(['foreshadowSuggestionBaseline'])
  const evidence = (assembled.sourceEvidence ?? []).filter(item => !excluded.has(item.key))
  const excludedLabels = new Set(['伏笔建议正式基线'])
  return {
    included: assembled.included.filter(key => !excluded.has(key)),
    omitted: assembled.omitted.filter(key => !excluded.has(key)),
    trimmed: assembled.trimmed.filter(key => !excluded.has(key)),
    segments: assembled.segments
      .filter(segment => !excludedLabels.has(segment.label))
      .map(segment => ({ label: segment.label, content: segment.content })),
    sourceEvidence: evidence,
  }
}

function registeredSegment(
  assembled: Awaited<ReturnType<typeof assembleContext>>,
  key: string,
  label: string,
): string {
  const evidence = assembled.sourceEvidence?.find(item => item.key === key)
  const segment = assembled.segments.find(item => item.label === label)
  if (!segment || evidence?.status !== 'included' || evidence.delivery !== 'full') {
    throw new Error(`伏笔建议登记来源 ${key} 未无损进入 Context Gateway。`)
  }
  return segment.content
}

async function prepareInput(
  scope: WorkspaceScope,
  request: ForeshadowSuggestionRequestV1,
): Promise<PreparedInputV1> {
  const [baseline, assembled] = await Promise.all([
    readForeshadowSuggestionBaselineV1({ scope, worldGroupId: request.worldGroupId }),
    assembleContext({
      projectId: scope.projectId,
      scope,
      worldGroupId: request.worldGroupId,
      sourceKeys: [...FORESHADOW_SUGGESTION_CONTEXT_SOURCE_KEYS_V1],
      inputBudgetMaxTokens: 130_000,
    }),
  ])
  const baselineContext = registeredSegment(
    assembled,
    'foreshadowSuggestionBaseline',
    '伏笔建议正式基线',
  )
  if (baselineContext !== formatForeshadowSuggestionBaselineV1(baseline)) {
    throw new Error('伏笔建议登记 baseline 在读取期间变化；未调用模型，请重试。')
  }
  const characterContext = assembled.segments.find(segment => segment.label === '角色档案')?.content ?? ''
  const worldContext = assembled.segments
    .filter(segment => segment.label !== '角色档案' && segment.label !== '伏笔建议正式基线')
    .map(segment => segment.content)
    .join('\n\n')
  const messages = buildForeshadowSuggestionMessagesV1({
    projectName: baseline.work.title,
    genre: baseline.work.genres.join('、'),
    worldContext,
    characterContext,
    existingForeshadows: baselineContext,
    options: promptOptions(request),
  })
  const modelInput = messages.map(message => message.content).join('\n')
  const missingSegment = assembled.segments.find(segment => !modelInput.includes(segment.content))
  if (missingSegment) {
    throw new Error(`伏笔建议登记来源“${missingSegment.label}”未实际进入模型 Prompt。`)
  }
  return {
    baseline,
    baselineHash: await hashCanonicalValue(baseline),
    assembled,
    contextInputHash: await hashCanonicalValue(contextInput(assembled)),
    upstreamContextHash: await hashCanonicalValue(upstreamContextInput(assembled)),
    messages,
    promptTemplateHash: await hashCanonicalValue(readForeshadowSuggestionPromptTemplateSnapshotV1()),
    promptHash: await hashCanonicalValue(messages),
  }
}

function contract(scope: WorkspaceScope, request: ForeshadowSuggestionRequestV1) {
  const skill = getAgentSkillV1('outline.foreshadow-suggestions', 'outline')
  return {
    version: 1 as const,
    objective: '根据当前 Work 的登记设定生成可选择的新伏笔规划候选',
    workflowKind: 'plan-execute' as const,
    scope: { projectId: scope.projectId, worldGroupId: request.worldGroupId },
    permissions: {
      contextSourceKeys: [...FORESHADOW_SUGGESTION_CONTEXT_SOURCE_KEYS_V1],
      writeTargets: skill.writeTargets.map(target => ({
        table: target.table,
        fields: [...target.fields],
        mode: 'author-confirmed' as const,
      })),
    },
    executionBindings: [{
      stepId: FORESHADOW_SUGGESTION_STEP_ID_V1,
      ...createAgentSkillExecutionBindingV1(skill),
    }],
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 130_000,
      maxOutputTokens: skill.maxOutputTokens,
      maxAttemptsPerStep: 1,
      maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'foreshadow-suggestions.candidate', kind: 'output-present' as const, required: true },
      { id: 'foreshadow-suggestions.author', kind: 'author-confirmed' as const, required: true },
      { id: 'foreshadow-suggestions.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'foreshadow-suggestions.terminal',
      kind: 'terminal' as const,
      verifier: FORESHADOW_SUGGESTION_VERIFIER_SET_V1,
      criterionIds: [
        'foreshadow-suggestions.candidate',
        'foreshadow-suggestions.author',
        'foreshadow-suggestions.post-state',
      ],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

function isForeshadowSuggestionRun(contractJson: unknown): boolean {
  return typeof contractJson === 'string' && contractJson.includes('outline.foreshadow-suggestions')
}

function assertRequest(value: unknown): asserts value is ForeshadowSuggestionRequestV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('伏笔建议请求无效。')
  const row = value as Record<string, unknown>
  exactKeys(row, ['worldGroupId', 'parameterValues', 'systemOverride', 'userOverride'], '伏笔建议请求 ')
  if ((row.worldGroupId !== null && (!Number.isInteger(row.worldGroupId) || (row.worldGroupId as number) <= 0))
    || !row.parameterValues || typeof row.parameterValues !== 'object' || Array.isArray(row.parameterValues)
    || (row.systemOverride !== null && typeof row.systemOverride !== 'string')
    || (row.userOverride !== null && typeof row.userOverride !== 'string')) {
    throw new Error('伏笔建议请求不完整。')
  }
}

function assertBaseline(value: unknown): asserts value is ForeshadowSuggestionBaselineV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('伏笔建议 baseline 无效。')
  const row = value as Record<string, any>
  exactKeys(row, ['version', 'work', 'worldGroupId', 'foreshadows'], '伏笔建议 baseline ')
  if (row.version !== 1 || !row.work || typeof row.work !== 'object' || Array.isArray(row.work)
    || !Array.isArray(row.foreshadows)) throw new Error('伏笔建议 baseline 不完整。')
  exactKeys(row.work, ['id', 'title', 'genres', 'description'], '伏笔建议作品 baseline ')
  if (!Number.isInteger(row.work.id) || typeof row.work.title !== 'string'
    || !Array.isArray(row.work.genres)
    || row.work.genres.some((genre: unknown) => typeof genre !== 'string')
    || typeof row.work.description !== 'string') throw new Error('伏笔建议作品 baseline 无效。')
  for (const item of row.foreshadows) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('伏笔正式记录 baseline 无效。')
    exactKeys(item, [
      'id', 'name', 'type', 'status', 'description', 'plantChapterId', 'echoChapterIds',
      'resolveChapterId', 'notes', 'timelinePosition', 'expectedResolveChapterId', 'importance',
      'urgency', 'worldId', 'workId', 'createdAt', 'updatedAt',
    ], '伏笔正式记录 baseline ')
    if (!Number.isInteger(item.id) || typeof item.name !== 'string' || typeof item.type !== 'string'
      || typeof item.status !== 'string' || typeof item.description !== 'string'
      || typeof item.echoChapterIds !== 'string' || typeof item.notes !== 'string'
      || !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt)) {
      throw new Error('伏笔正式记录 baseline 不完整。')
    }
  }
}

async function parseCandidate(value: unknown): Promise<ForeshadowSuggestionCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('伏笔建议候选检查点无效。')
  const row = value as Record<string, any>
  exactKeys(row, [
    'version', 'kind', 'portable', 'projectId', 'worldId', 'workId', 'request', 'baseline',
    'baselineHash', 'contextManifestHash', 'contextInputHash', 'upstreamContextHash', 'promptTemplateHash', 'promptHash',
    'modelOutputHash', 'suggestions', 'suggestionsHash', 'candidateHash',
  ], '伏笔建议候选 ')
  if (row.version !== 1 || row.kind !== 'foreshadow-suggestions-candidate' || row.portable !== false
    || ![row.projectId, row.worldId, row.workId].every((id: unknown) => Number.isInteger(id) && (id as number) > 0)
    || ![row.baselineHash, row.contextManifestHash, row.contextInputHash, row.upstreamContextHash, row.promptTemplateHash,
      row.promptHash, row.modelOutputHash, row.suggestionsHash, row.candidateHash].every(isHash)) {
    throw new Error('伏笔建议候选检查点不完整。')
  }
  assertRequest(row.request)
  assertBaseline(row.baseline)
  if (row.baseline.work.id !== row.workId || row.baseline.worldGroupId !== row.request.worldGroupId
    || await hashCanonicalValue(row.baseline) !== row.baselineHash) {
    throw new Error('伏笔建议候选 baseline 不匹配。')
  }
  const suggestions = parseForeshadowSuggestionsStrictV1(
    JSON.stringify({ foreshadows: row.suggestions }),
    row.baseline.foreshadows.map((item: { name: string }) => item.name),
  )
  if (!sameValue(suggestions, row.suggestions) || await hashCanonicalValue(suggestions) !== row.suggestionsHash) {
    throw new Error('伏笔建议候选或 hash 不匹配。')
  }
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('伏笔建议候选 hash 不匹配。')
  return { ...row, suggestions } as ForeshadowSuggestionCandidateV1
}

async function parseState(value: unknown): Promise<{
  candidate: ForeshadowSuggestionCandidateV1
  intent: ForeshadowSuggestionAdoptionIntentV1 | null
}> {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'foreshadow-suggestions-adoption-intent') {
    const row = value as Record<string, any>
    exactKeys(row, [
      'version', 'kind', 'portable', 'candidate', 'selectedIndexes', 'formalItems',
      'formalItemsHash', 'intentHash',
    ], '伏笔建议采纳意图 ')
    if (row.version !== 1 || row.portable !== false || !Array.isArray(row.selectedIndexes)
      || !Array.isArray(row.formalItems) || !isHash(row.formalItemsHash) || !isHash(row.intentHash)) {
      throw new Error('伏笔建议采纳意图不完整。')
    }
    const candidate = await parseCandidate(row.candidate)
    const emptySelectionIsValid = candidate.suggestions.length === 0 && row.selectedIndexes.length === 0
    if ((!emptySelectionIsValid && row.selectedIndexes.length < 1)
      || new Set(row.selectedIndexes).size !== row.selectedIndexes.length
      || row.selectedIndexes.some((index: unknown, position: number) => (
        !Number.isInteger(index) || (index as number) < 0 || (index as number) >= candidate.suggestions.length
        || (position > 0 && row.selectedIndexes[position - 1] >= (index as number))
      ))) throw new Error('伏笔建议采纳选择无效。')
    const formalItems = buildForeshadowSuggestionFormalItemsV1(
      row.selectedIndexes.map((index: number) => candidate.suggestions[index]),
    )
    if (!sameValue(formalItems, row.formalItems)
      || await hashCanonicalValue(formalItems) !== row.formalItemsHash) {
      throw new Error('伏笔建议正式选择不匹配。')
    }
    const body = {
      version: 1 as const,
      kind: 'foreshadow-suggestions-adoption-intent' as const,
      portable: false as const,
      candidate,
      selectedIndexes: row.selectedIndexes,
      formalItems,
      formalItemsHash: row.formalItemsHash,
    }
    if (await hashCanonicalValue(body) !== row.intentHash) throw new Error('伏笔建议采纳意图 hash 不匹配。')
    return { candidate, intent: { ...row, candidate, formalItems } as ForeshadowSuggestionAdoptionIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

async function latestState(scope: WorkspaceScope, runId: number) {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('伏笔建议运行缺少可验证检查点。')
  return parseState(checkpoint.resumePayload)
}

function assertCandidateScope(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: ForeshadowSuggestionCandidateV1,
): void {
  if (candidate.projectId !== scope.projectId || candidate.worldId !== scope.worldId
    || candidate.workId !== scope.workId || snapshot.run.projectId !== scope.projectId
    || (snapshot.run.worldGroupId ?? null) !== candidate.request.worldGroupId) {
    throw new Error('伏笔建议候选与当前 World/Work/世界组不匹配。')
  }
}

function formalMatches(item: ForeshadowSuggestionFormalItemV1, row: Record<string, any> | undefined): boolean {
  return !!row?.id
    && row.name === item.name
    && row.type === item.type
    && row.description === item.description
    && row.status === 'planned'
    && (row.plantChapterId ?? null) === null
    && String(row.echoChapterIds ?? '') === '[]'
    && (row.resolveChapterId ?? null) === null
    && String(row.notes ?? '') === ''
}

function expectedPostMatches(
  current: ForeshadowSuggestionBaselineV1,
  candidate: ForeshadowSuggestionCandidateV1,
  intent: ForeshadowSuggestionAdoptionIntentV1,
): boolean {
  if (!sameValue(current.work, candidate.baseline.work)
    || current.worldGroupId !== candidate.baseline.worldGroupId) return false
  const originals = new Map(candidate.baseline.foreshadows.map(row => [row.id, row]))
  for (const original of candidate.baseline.foreshadows) {
    if (!sameValue(current.foreshadows.find(row => row.id === original.id), original)) return false
  }
  const extras = current.foreshadows.filter(row => !originals.has(row.id))
  if (extras.length !== intent.formalItems.length) return false
  return intent.formalItems.every(item => extras.filter(row => formalMatches(item, row)).length === 1)
}

async function currentEvidence(
  scope: WorkspaceScope,
  candidate: ForeshadowSuggestionCandidateV1,
  intent?: ForeshadowSuggestionAdoptionIntentV1 | null,
) {
  let current: ForeshadowSuggestionBaselineV1 | null = null
  try {
    current = await readForeshadowSuggestionBaselineV1({
      scope,
      worldGroupId: candidate.request.worldGroupId,
    })
  } catch { /* stale */ }
  const templateFresh = await hashCanonicalValue(readForeshadowSuggestionPromptTemplateSnapshotV1())
    === candidate.promptTemplateHash
  let upstreamFresh = false
  try {
    upstreamFresh = (await prepareInput(scope, candidate.request)).upstreamContextHash === candidate.upstreamContextHash
  } catch { /* stale */ }
  return {
    current,
    templateFresh,
    upstreamFresh,
    baselineFresh: current != null && sameValue(current, candidate.baseline),
    postMatches: !!current && !!intent && expectedPostMatches(current, candidate, intent),
  }
}

async function pauseUnsafeRun(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, reason: string) {
  if (snapshot.projection.state === 'running' || snapshot.projection.state === 'awaiting_confirmation') {
    return append(scope, snapshot, 'run.paused', { reason, recoverable: false })
  }
  return snapshot
}

async function staleBeforeWrite(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: ForeshadowSuggestionCandidateV1,
): Promise<AgentRunSnapshotV1> {
  let prepared: PreparedInputV1 | null = null
  try { prepared = await prepareInput(scope, candidate.request) } catch { /* stale */ }
  if (prepared && prepared.baselineHash === candidate.baselineHash
    && prepared.contextInputHash === candidate.contextInputHash
    && prepared.upstreamContextHash === candidate.upstreamContextHash
    && prepared.promptTemplateHash === candidate.promptTemplateHash
    && prepared.promptHash === candidate.promptHash) return snapshot
  const next = await append(scope, snapshot, 'candidate.staled', {
    stepId: FORESHADOW_SUGGESTION_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    reason: 'foreshadow-suggestions-source-or-prompt-changed',
  })
  throw Object.assign(new Error('伏笔建议登记上下文、正式 baseline 或 Prompt 已变化，请重新生成。'), { snapshot: next })
}

export async function generateForeshadowSuggestionCandidateV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  options?: RunOptions
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (
    boundary: ForeshadowSuggestionBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ForeshadowSuggestionCandidateV1 }> {
  if (!input.runAI && !input.aiConfig) throw new Error('伏笔建议缺少 AI 配置。')
  const request = normalizedRequest(input)
  const prepared = await prepareInput(input.scope, request)
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    contract: contract(input.scope, request),
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: FORESHADOW_SUGGESTION_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: FORESHADOW_SUGGESTION_STEP_ID_V1, attempt: 1 })
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: FORESHADOW_SUGGESTION_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: [...FORESHADOW_SUGGESTION_CONTEXT_SOURCE_KEYS_V1],
    assembled: prepared.assembled,
    readerVersion: 'foreshadow-suggestions-context-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: FORESHADOW_SUGGESTION_STEP_ID_V1,
    attempt: 1,
    manifestHash: manifest.manifestHash,
  })
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: FORESHADOW_SUGGESTION_STEP_ID_V1,
    attempt: 1,
    bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]),
  })
  let raw: string
  try {
    await input.onDurableBoundary?.('model.requested', snapshot)
    raw = await (input.runAI
      ? input.runAI(prepared.messages)
      : chat(prepared.messages, input.aiConfig!, {
          category: 'foreshadow.suggest',
          projectId: input.scope.projectId,
          configOverrides: { maxTokens: getAgentSkillV1('outline.foreshadow-suggestions').maxOutputTokens },
          contextOverflowPolicy: 'reject',
        }))
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'foreshadow-suggestions-model-outcome-unknown')
    throw error
  }
  snapshot = await append(input.scope, snapshot, 'model.responded', {
    stepId: FORESHADOW_SUGGESTION_STEP_ID_V1,
    attempt: 1,
    outputHash: await hashCanonicalValue({ raw }),
  })
  try {
    await input.onDurableBoundary?.('model.responded', snapshot)
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'foreshadow-suggestions-model-result-uncheckpointed')
    throw error
  }
  let suggestions: ForeshadowSuggestionCandidateItemV1[]
  try {
    suggestions = parseForeshadowSuggestionsStrictV1(
      raw,
      prepared.baseline.foreshadows.map(item => item.name),
    )
  } catch (error) {
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: FORESHADOW_SUGGESTION_STEP_ID_V1,
      attempt: 1,
      code: 'foreshadow-suggestions-protocol-failed',
      retryable: false,
      category: 'protocol',
      action: 'fail',
    })
    await append(input.scope, snapshot, 'run.failed', { code: 'foreshadow-suggestions-protocol-failed', retryable: false })
    throw error
  }
  const body = {
    version: 1 as const,
    kind: 'foreshadow-suggestions-candidate' as const,
    portable: false as const,
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    request,
    baseline: prepared.baseline,
    baselineHash: prepared.baselineHash,
    contextManifestHash: manifest.manifestHash,
    contextInputHash: prepared.contextInputHash,
    upstreamContextHash: prepared.upstreamContextHash,
    promptTemplateHash: prepared.promptTemplateHash,
    promptHash: prepared.promptHash,
    modelOutputHash: await hashCanonicalValue({ raw }),
    suggestions,
    suggestionsHash: await hashCanonicalValue(suggestions),
  }
  const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
  const saved = await createAgentRunCheckpointV1({
    scope: input.scope,
    runId: snapshot.run.id,
    resumePayload: candidate,
  })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: FORESHADOW_SUGGESTION_STEP_ID_V1,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
  await input.onDurableBoundary?.('candidate.persisted', snapshot)
  return { snapshot, candidate }
}

async function repairCandidateEventIfNeeded(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: ForeshadowSuggestionCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const step = snapshot.projection.steps[FORESHADOW_SUGGESTION_STEP_ID_V1]
  if (step?.candidateHash) return snapshot
  if (step?.status !== 'running') throw new Error('伏笔建议候选事件无法安全重建。')
  return append(scope, snapshot, 'candidate.persisted', {
    stepId: FORESHADOW_SUGGESTION_STEP_ID_V1,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
}

export async function readPendingForeshadowSuggestionCandidateV1(input: {
  scope: WorkspaceScope
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ForeshadowSuggestionCandidateV1 } | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => ['awaiting_confirmation', 'running'].includes(row.status)
      && isForeshadowSuggestionRun(row.contractJson))
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
      // Damaged or unrelated local runs remain auditable but are not offered.
    }
  }
  return null
}

export async function readRecoverableForeshadowSuggestionRunV1(input: {
  scope: WorkspaceScope
}): Promise<{
  snapshot: AgentRunSnapshotV1
  safeToResume: boolean
  candidate?: ForeshadowSuggestionCandidateV1
  selectedIndexes?: number[]
  adoptionPending?: boolean
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => ['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(row.status)
      && isForeshadowSuggestionRun(row.contractJson))
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
        selectedIndexes: state.intent ? [...state.intent.selectedIndexes] : undefined,
        adoptionPending: state.intent != null,
      }
    } catch {
      return { snapshot, safeToResume: false }
    }
  }
  return null
}

export async function adoptForeshadowSuggestionCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  selectedIndexes?: readonly number[]
  onDurableBoundary?: (
    boundary: ForeshadowSuggestionAdoptionBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ForeshadowSuggestionCandidateV1; receiptHash: string; written: number }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate
  let intent = state.intent
  assertCandidateScope(input.scope, snapshot, candidate)
  const indexes = intent?.selectedIndexes
    ?? [...new Set(input.selectedIndexes ?? [])].sort((left, right) => left - right)
  const emptySelectionIsValid = candidate.suggestions.length === 0 && indexes.length === 0
  if ((!emptySelectionIsValid && indexes.length < 1)
    || indexes.some(index => !Number.isInteger(index) || index < 0 || index >= candidate.suggestions.length)) {
    throw new Error('请选择有效的伏笔候选。')
  }
  if (intent && input.selectedIndexes
    && !sameValue(intent.selectedIndexes, [...input.selectedIndexes].sort((left, right) => left - right))) {
    throw new Error('伏笔建议采纳选择与冻结意图不一致。')
  }
  let evidence = await currentEvidence(input.scope, candidate, intent)
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && intent) {
    if (!evidence.postMatches || !evidence.templateFresh || !evidence.upstreamFresh) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope,
        runId: snapshot.run.id,
        reason: 'foreshadow-suggestions-terminal-evidence-stale',
      })
      await append(input.scope, snapshot, 'candidate.staled', {
        stepId: FORESHADOW_SUGGESTION_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: 'foreshadow-suggestions-terminal-evidence-stale',
      })
      throw new Error('伏笔建议完成回执已过期。')
    }
    return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash, written: intent.formalItems.length }
  }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    snapshot = await staleBeforeWrite(input.scope, snapshot, candidate)
    if (!intent) {
      const formalItems = buildForeshadowSuggestionFormalItemsV1(indexes.map(index => candidate.suggestions[index]))
      const body = {
        version: 1 as const,
        kind: 'foreshadow-suggestions-adoption-intent' as const,
        portable: false as const,
        candidate,
        selectedIndexes: indexes,
        formalItems,
        formalItemsHash: await hashCanonicalValue(formalItems),
      }
      intent = { ...body, intentHash: await hashCanonicalValue(body) }
      const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent })
      snapshot = saved.snapshot
      await input.onDurableBoundary?.('intent.checkpoint', snapshot)
    }
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: FORESHADOW_SUGGESTION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: FORESHADOW_SUGGESTION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      intentHash: intent.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  } else if (snapshot.projection.steps[FORESHADOW_SUGGESTION_STEP_ID_V1]?.confirmation !== 'adopt' || !intent) {
    throw new Error('伏笔建议候选不在可恢复采纳状态。')
  }
  let adoptionHash = snapshot.projection.steps[FORESHADOW_SUGGESTION_STEP_ID_V1]?.adoptionHash
  if (!adoptionHash) {
    evidence = await currentEvidence(input.scope, candidate, intent)
    if (!evidence.postMatches) {
      if (!evidence.baselineFresh || !evidence.templateFresh) {
        await pauseUnsafeRun(input.scope, snapshot, 'foreshadow-suggestions-formal-state-diverged')
        throw new Error('伏笔正式状态与冻结 baseline 或意图不一致。')
      }
      await adoptForeshadowSuggestionsAtomicV1({
        scope: input.scope,
        worldGroupId: candidate.request.worldGroupId,
        baseline: candidate.baseline,
        formalItems: intent.formalItems,
      })
      evidence = await currentEvidence(input.scope, candidate, intent)
    }
    if (!evidence.postMatches) {
      await pauseUnsafeRun(input.scope, snapshot, 'foreshadow-suggestions-post-state-diverged')
      throw new Error('伏笔写入后正式状态与冻结意图不一致。')
    }
    await input.onDurableBoundary?.('formal.written', snapshot)
    adoptionHash = await hashCanonicalValue({
      intentHash: intent.intentHash,
      formalItemsHash: intent.formalItemsHash,
      written: intent.formalItems.length,
    })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: FORESHADOW_SUGGESTION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      adoptionHash,
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  evidence = await currentEvidence(input.scope, candidate, intent)
  if (!evidence.postMatches || !evidence.templateFresh || !evidence.upstreamFresh) {
    await pauseUnsafeRun(input.scope, snapshot, 'foreshadow-suggestions-terminal-evidence-stale')
    throw new Error('伏笔在采纳后、终验前发生漂移，本次回执不会通过。')
  }
  if (snapshot.projection.steps[FORESHADOW_SUGGESTION_STEP_ID_V1]?.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: FORESHADOW_SUGGESTION_STEP_ID_V1,
      attempt: 1,
      outputHash: adoptionHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: FORESHADOW_SUGGESTION_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  const postStateHash = await hashCanonicalValue({
    baselineHash: candidate.baselineHash,
    formalItemsHash: intent.formalItemsHash,
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
    verifierSetVersion: FORESHADOW_SUGGESTION_VERIFIER_SET_V1,
    criteria: [
      { id: 'foreshadow-suggestions.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'foreshadow-suggestions.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'foreshadow-suggestions.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, candidate, receiptHash: receipt.receiptHash, written: intent.formalItems.length }
}

export async function rejectForeshadowSuggestionCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate, intent } = await latestState(input.scope, input.runId)
  assertCandidateScope(input.scope, snapshot, candidate)
  if (snapshot.projection.state !== 'awaiting_confirmation' || intent) {
    throw new Error('伏笔建议候选不在可拒绝状态。')
  }
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: FORESHADOW_SUGGESTION_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    decision: 'reject',
  })
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-foreshadow-suggestions' })
}

export async function abandonForeshadowSuggestionRunV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  if (!['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(snapshot.projection.state)) {
    throw new Error('伏笔建议运行不在可放弃状态。')
  }
  const state = await latestState(input.scope, input.runId).catch(() => null)
  if (state?.intent || snapshot.projection.steps[FORESHADOW_SUGGESTION_STEP_ID_V1]?.confirmation === 'adopt') {
    throw new Error('伏笔建议采纳选择已冻结，不能取消；请继续写入与终验。')
  }
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-abandoned-foreshadow-suggestions' })
}
