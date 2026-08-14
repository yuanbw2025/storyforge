import { chat } from '../../ai/client'
import {
  adoptCultivationProgressExtractionAtomicV1,
  buildCultivationProgressExpectedProjectionV1,
  buildCultivationProgressExtractionMessagesV1,
  formatCultivationProgressExtractionBaselineV1,
  parseCultivationProgressExtractionStrictV1,
  readCultivationProgressExtractionBaselineV1,
  readCultivationProgressExtractionPromptTemplateSnapshotV1,
  type CultivationProgressExpectedProjectionV1,
  type CultivationProgressExtractionBaselineV1,
  type CultivationProgressExtractionCandidateItemV1,
  type CultivationProgressFormalItemV1,
} from '../../cultivation/progress'
import { assembleContext } from '../../registry/assemble-context'
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

export const CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1 = 'prose:cultivation-progress-extraction' as const
export const CULTIVATION_PROGRESS_EXTRACTION_VERIFIER_SET_V1 = 'cultivation-progress-extraction-terminal-v1' as const
export const CULTIVATION_PROGRESS_EXTRACTION_CONTEXT_SOURCE_KEYS_V1 = [
  'chapterContent',
  'cultivationProgressExtractionBaseline',
] as const

type RunAI = (messages: ChatMessage[]) => Promise<string>

export interface CultivationProgressExtractionCandidateV1 {
  version: 1
  kind: 'cultivation-progress-extraction-candidate'
  portable: false
  projectId: number
  worldId: number
  workId: number
  chapterId: number
  worldGroupId: number | null
  baseline: CultivationProgressExtractionBaselineV1
  baselineHash: string
  contextManifestHash: string
  contextInputHash: string
  promptTemplateHash: string
  promptHash: string
  modelOutputHash: string
  events: CultivationProgressExtractionCandidateItemV1[]
  eventsHash: string
  candidateHash: string
}

interface CultivationProgressExtractionAdoptionIntentV1 {
  version: 1
  kind: 'cultivation-progress-extraction-adoption-intent'
  portable: false
  candidate: CultivationProgressExtractionCandidateV1
  selectedIndexes: number[]
  projection: CultivationProgressExpectedProjectionV1
  projectionHash: string
  transitionTimestamp: number
  intentHash: string
}

export type CultivationProgressExtractionBoundaryV1 =
  | 'model.requested'
  | 'model.responded'
  | 'candidate.checkpoint'
  | 'candidate.persisted'

export type CultivationProgressExtractionAdoptionBoundaryV1 =
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.written'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

interface PreparedInputV1 {
  baseline: CultivationProgressExtractionBaselineV1
  baselineHash: string
  assembled: Awaited<ReturnType<typeof assembleContext>>
  contextInputHash: string
  messages: ChatMessage[]
  promptTemplateHash: string
  promptHash: string
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function assertExactKeys(row: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(row)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error(`${label}字段不在允许闭集。`)
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right)
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

function registeredSegment(
  assembled: Awaited<ReturnType<typeof assembleContext>>,
  key: string,
  label: string,
): string {
  const evidence = assembled.sourceEvidence?.find(item => item.key === key)
  const segment = assembled.segments.find(item => item.label === label)
  if (!segment || evidence?.status !== 'included' || evidence.delivery !== 'full') {
    throw new Error(`修炼进度登记来源 ${key} 未无损进入 Context Gateway。`)
  }
  return segment.content
}

async function prepareInput(
  scope: WorkspaceScope,
  chapterId: number,
  worldGroupId: number | null,
): Promise<PreparedInputV1> {
  const [baseline, assembled] = await Promise.all([
    readCultivationProgressExtractionBaselineV1({ scope, chapterId, worldGroupId }),
    assembleContext({
      projectId: scope.projectId,
      scope,
      chapterId,
      worldGroupId,
      sourceKeys: [...CULTIVATION_PROGRESS_EXTRACTION_CONTEXT_SOURCE_KEYS_V1],
      inputBudgetMaxTokens: 130_000,
    }),
  ])
  if (!baseline.characters.length) {
    throw new Error('本章世界没有已关联有效修炼体系的角色，请先在角色卡设置主修体系。')
  }
  const chapterContent = registeredSegment(assembled, 'chapterContent', '章节正文')
  const baselineContext = registeredSegment(
    assembled,
    'cultivationProgressExtractionBaseline',
    '修炼进度角色、体系 DAG 与既有事件闭集',
  )
  if (chapterContent !== baseline.chapter.content
    || baselineContext !== formatCultivationProgressExtractionBaselineV1(baseline)) {
    throw new Error('修炼进度登记来源在读取期间变化；未调用模型，请重试。')
  }
  if (chapterContent.trim().length < 20) throw new Error('目标章节正文不足 20 字，无法可靠提取修炼进度。')
  const messages = buildCultivationProgressExtractionMessagesV1({ chapterContent, baselineContext })
  return {
    baseline,
    baselineHash: await hashCanonicalValue(baseline),
    assembled,
    contextInputHash: await hashCanonicalValue(contextInput(assembled)),
    messages,
    promptTemplateHash: await hashCanonicalValue(readCultivationProgressExtractionPromptTemplateSnapshotV1()),
    promptHash: await hashCanonicalValue(messages),
  }
}

function contract(scope: WorkspaceScope, chapterId: number, worldGroupId: number | null) {
  const skill = getAgentSkillV1('prose.cultivation-progress-extraction', 'prose')
  return {
    version: 1 as const,
    objective: `从已写章节 #${chapterId} 抽取作者可确认的修炼进度候选`,
    workflowKind: 'plan-execute' as const,
    scope: { projectId: scope.projectId, worldGroupId },
    permissions: {
      contextSourceKeys: [...CULTIVATION_PROGRESS_EXTRACTION_CONTEXT_SOURCE_KEYS_V1],
      writeTargets: skill.writeTargets.map(target => ({
        table: target.table,
        fields: [...target.fields],
        mode: 'author-confirmed' as const,
        ...(target.adoptionExtension ? { adoptionExtension: target.adoptionExtension } : {}),
      })),
    },
    executionBindings: [{
      stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1,
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
      { id: 'cultivation-progress.candidate', kind: 'output-present' as const, required: true },
      { id: 'cultivation-progress.author', kind: 'author-confirmed' as const, required: true },
      { id: 'cultivation-progress.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'cultivation-progress.terminal',
      kind: 'terminal' as const,
      verifier: CULTIVATION_PROGRESS_EXTRACTION_VERIFIER_SET_V1,
      criterionIds: [
        'cultivation-progress.candidate',
        'cultivation-progress.author',
        'cultivation-progress.post-state',
      ],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

function isCultivationRun(contractJson: unknown, chapterId?: number): boolean {
  return typeof contractJson === 'string'
    && contractJson.includes('prose.cultivation-progress-extraction')
    && (chapterId == null || contractJson.includes(`从已写章节 #${chapterId} `))
}

function assertBaselineShape(value: unknown): asserts value is CultivationProgressExtractionBaselineV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('修炼进度 baseline 无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, ['version', 'chapter', 'chapterSequence', 'characters', 'systems', 'progress'], '修炼进度 baseline ')
  if (row.version !== 1 || !row.chapter || typeof row.chapter !== 'object' || Array.isArray(row.chapter)
    || !Array.isArray(row.chapterSequence) || !Array.isArray(row.characters)
    || !Array.isArray(row.systems) || !Array.isArray(row.progress)) {
    throw new Error('修炼进度 baseline 不完整。')
  }
  assertExactKeys(row.chapter, ['id', 'title', 'outlineNodeId', 'worldGroupId', 'content', 'updatedAt'], '修炼进度章节 baseline ')
  if (!Number.isInteger(row.chapter.id) || !Number.isInteger(row.chapter.outlineNodeId)
    || (row.chapter.worldGroupId !== null && !Number.isInteger(row.chapter.worldGroupId))
    || typeof row.chapter.title !== 'string' || typeof row.chapter.content !== 'string'
    || !Number.isFinite(row.chapter.updatedAt)
    || row.chapterSequence.some((id: unknown) => !Number.isInteger(id))) {
    throw new Error('修炼进度章节 baseline 无效。')
  }
  for (const character of row.characters) {
    if (!character || typeof character !== 'object' || Array.isArray(character)) throw new Error('修炼进度角色 baseline 无效。')
    assertExactKeys(character, ['id', 'name', 'cultivationSystemId', 'homeWorldGroupId', 'isCrossWorld', 'updatedAt'], '修炼进度角色 baseline ')
    if (!Number.isInteger(character.id) || typeof character.name !== 'string'
      || !Number.isInteger(character.cultivationSystemId)
      || (character.homeWorldGroupId !== null && !Number.isInteger(character.homeWorldGroupId))
      || typeof character.isCrossWorld !== 'boolean' || !Number.isFinite(character.updatedAt)) {
      throw new Error('修炼进度角色 baseline 不完整。')
    }
  }
  for (const system of row.systems) {
    if (!system || typeof system !== 'object' || Array.isArray(system)) throw new Error('修炼体系 baseline 无效。')
    assertExactKeys(system, ['id', 'name', 'worldGroupId', 'stages', 'stagesJson', 'updatedAt'], '修炼体系 baseline ')
    if (!Number.isInteger(system.id) || typeof system.name !== 'string'
      || (system.worldGroupId !== null && !Number.isInteger(system.worldGroupId))
      || !Array.isArray(system.stages) || typeof system.stagesJson !== 'string'
      || !Number.isFinite(system.updatedAt)) throw new Error('修炼体系 baseline 不完整。')
  }
  for (const progress of row.progress) {
    if (!progress || typeof progress !== 'object' || Array.isArray(progress)) throw new Error('修炼事件 baseline 无效。')
    assertExactKeys(progress, [
      'id', 'worldGroupId', 'characterId', 'characterName', 'cultivationSystemId',
      'cultivationSystemName', 'stageId', 'stageName', 'transition', 'sourceChapterId',
      'sourceChapterTitle', 'sourceQuote', 'sourceOffset', 'trigger', 'status',
      'createdAt', 'updatedAt',
    ], '修炼事件 baseline ')
    if (!Number.isInteger(progress.id) || !Number.isFinite(progress.createdAt)
      || !Number.isFinite(progress.updatedAt) || !Number.isFinite(progress.sourceOffset)) {
      throw new Error('修炼事件 baseline 不完整。')
    }
  }
}

async function parseCandidate(value: unknown): Promise<CultivationProgressExtractionCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('修炼进度候选检查点无效。')
  const row = value as Record<string, any>
  assertExactKeys(row, [
    'version', 'kind', 'portable', 'projectId', 'worldId', 'workId', 'chapterId',
    'worldGroupId', 'baseline', 'baselineHash', 'contextManifestHash', 'contextInputHash',
    'promptTemplateHash', 'promptHash', 'modelOutputHash', 'events', 'eventsHash', 'candidateHash',
  ], '修炼进度候选 ')
  if (row.version !== 1 || row.kind !== 'cultivation-progress-extraction-candidate' || row.portable !== false
    || ![row.projectId, row.worldId, row.workId, row.chapterId].every((id: unknown) => Number.isInteger(id) && (id as number) > 0)
    || (row.worldGroupId !== null && (!Number.isInteger(row.worldGroupId) || row.worldGroupId <= 0))
    || ![row.baselineHash, row.contextManifestHash, row.contextInputHash, row.promptTemplateHash,
      row.promptHash, row.modelOutputHash, row.eventsHash, row.candidateHash].every(isHash)) {
    throw new Error('修炼进度候选检查点不完整。')
  }
  assertBaselineShape(row.baseline)
  if (row.baseline.chapter.id !== row.chapterId || row.baseline.chapter.worldGroupId !== row.worldGroupId
    || await hashCanonicalValue(row.baseline) !== row.baselineHash) {
    throw new Error('修炼进度候选 baseline 不匹配。')
  }
  if (!Array.isArray(row.events)) throw new Error('修炼进度候选事件无效。')
  const events = parseCultivationProgressExtractionStrictV1({
    raw: JSON.stringify({
      events: row.events.map((event: Record<string, unknown>) => ({
        characterId: event.characterId,
        cultivationSystemId: event.cultivationSystemId,
        stageId: event.stageId,
        trigger: event.trigger,
        quote: event.evidenceQuote,
      })),
    }),
    baseline: row.baseline,
  })
  if (!sameValue(events, row.events) || await hashCanonicalValue(events) !== row.eventsHash) {
    throw new Error('修炼进度候选事件或 hash 不匹配。')
  }
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('修炼进度候选 hash 不匹配。')
  return { ...row, events } as CultivationProgressExtractionCandidateV1
}

function assertProjectionShape(value: unknown): asserts value is CultivationProgressExpectedProjectionV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('修炼进度正式投影无效。')
  const row = value as Record<string, unknown>
  assertExactKeys(row, ['formalItems', 'originalTransitions'], '修炼进度正式投影 ')
  if (!Array.isArray(row.formalItems) || !Array.isArray(row.originalTransitions)) {
    throw new Error('修炼进度正式投影不完整。')
  }
}

async function parseState(value: unknown): Promise<{
  candidate: CultivationProgressExtractionCandidateV1
  intent: CultivationProgressExtractionAdoptionIntentV1 | null
}> {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'cultivation-progress-extraction-adoption-intent') {
    const row = value as Record<string, any>
    assertExactKeys(row, [
      'version', 'kind', 'portable', 'candidate', 'selectedIndexes', 'projection',
      'projectionHash', 'transitionTimestamp', 'intentHash',
    ], '修炼进度采纳意图 ')
    if (row.version !== 1 || row.portable !== false || !Array.isArray(row.selectedIndexes)
      || !isHash(row.projectionHash) || !Number.isInteger(row.transitionTimestamp)
      || !isHash(row.intentHash)) throw new Error('修炼进度采纳意图不完整。')
    const candidate = await parseCandidate(row.candidate)
    const emptySelectionIsValid = candidate.events.length === 0 && row.selectedIndexes.length === 0
    if ((!emptySelectionIsValid && row.selectedIndexes.length < 1)
      || new Set(row.selectedIndexes).size !== row.selectedIndexes.length
      || row.selectedIndexes.some((index: unknown, position: number) => (
        !Number.isInteger(index) || (index as number) < 0 || (index as number) >= candidate.events.length
        || (position > 0 && row.selectedIndexes[position - 1] >= (index as number))
      ))) throw new Error('修炼进度采纳选择无效。')
    assertProjectionShape(row.projection)
    const projection = buildCultivationProgressExpectedProjectionV1(
      candidate.baseline,
      row.selectedIndexes.map((index: number) => candidate.events[index]),
    )
    if (!sameValue(projection, row.projection) || await hashCanonicalValue(projection) !== row.projectionHash) {
      throw new Error('修炼进度采纳投影不匹配。')
    }
    const body = {
      version: 1 as const,
      kind: 'cultivation-progress-extraction-adoption-intent' as const,
      portable: false as const,
      candidate,
      selectedIndexes: row.selectedIndexes,
      projection,
      projectionHash: row.projectionHash,
      transitionTimestamp: row.transitionTimestamp,
    }
    if (await hashCanonicalValue(body) !== row.intentHash) throw new Error('修炼进度采纳意图 hash 不匹配。')
    return { candidate, intent: { ...row, candidate, projection } as CultivationProgressExtractionAdoptionIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

async function latestState(scope: WorkspaceScope, runId: number) {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('修炼进度运行缺少可验证检查点。')
  return parseState(checkpoint.resumePayload)
}

function assertCandidateScope(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: CultivationProgressExtractionCandidateV1,
): void {
  if (candidate.projectId !== scope.projectId || candidate.worldId !== scope.worldId
    || candidate.workId !== scope.workId || snapshot.run.projectId !== scope.projectId
    || snapshot.run.worldGroupId !== candidate.worldGroupId) {
    throw new Error('修炼进度候选与当前 World/Work 不匹配。')
  }
}

function formalMatches(item: CultivationProgressFormalItemV1, row: Record<string, any> | undefined): boolean {
  return !!row?.id
    && row.worldGroupId === item.worldGroupId
    && row.characterId === item.characterId
    && row.characterName === item.characterName
    && row.cultivationSystemId === item.cultivationSystemId
    && row.cultivationSystemName === item.cultivationSystemName
    && row.stageId === item.stageId
    && row.stageName === item.stageName
    && row.transition === item.transition
    && row.sourceChapterId === item.sourceChapterId
    && row.sourceChapterTitle === item.sourceChapterTitle
    && row.sourceQuote === item.sourceQuote
    && row.sourceOffset === item.sourceOffset
    && row.trigger === item.trigger
    && row.status === item.status
}

function upstreamBaseline(baseline: CultivationProgressExtractionBaselineV1) {
  const { progress: _progress, ...upstream } = baseline
  return upstream
}

function expectedPostMatches(
  current: CultivationProgressExtractionBaselineV1,
  candidate: CultivationProgressExtractionCandidateV1,
  intent: CultivationProgressExtractionAdoptionIntentV1,
): boolean {
  if (!sameValue(upstreamBaseline(current), upstreamBaseline(candidate.baseline))) return false
  const originals = new Map(candidate.baseline.progress.map(row => [row.id, row]))
  const currentById = new Map(current.progress.map(row => [row.id, row]))
  const expectedTransitions = new Map(intent.projection.originalTransitions.map(row => [row.id, row.transition]))
  for (const original of candidate.baseline.progress) {
    const actual = currentById.get(original.id)
    if (!actual) return false
    const transition = expectedTransitions.get(original.id) ?? original.transition
    const expected = transition === original.transition
      ? original
      : { ...original, transition, updatedAt: intent.transitionTimestamp }
    if (!sameValue(actual, expected)) return false
  }
  const extras = current.progress.filter(row => !originals.has(row.id))
  if (extras.length !== intent.projection.formalItems.length) return false
  return intent.projection.formalItems.every(item => (
    extras.filter(row => formalMatches(item, row as Record<string, any>)).length === 1
  ))
}

async function currentEvidence(
  scope: WorkspaceScope,
  candidate: CultivationProgressExtractionCandidateV1,
  intent?: CultivationProgressExtractionAdoptionIntentV1 | null,
) {
  let current: CultivationProgressExtractionBaselineV1 | null = null
  try {
    current = await readCultivationProgressExtractionBaselineV1({
      scope,
      chapterId: candidate.chapterId,
      worldGroupId: candidate.worldGroupId,
    })
  } catch { /* stale */ }
  const templateFresh = await hashCanonicalValue(readCultivationProgressExtractionPromptTemplateSnapshotV1())
    === candidate.promptTemplateHash
  const baselineFresh = current != null && sameValue(current, candidate.baseline)
  const postMatches = !!current && !!intent && expectedPostMatches(current, candidate, intent)
  return { current, templateFresh, baselineFresh, postMatches }
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
  candidate: CultivationProgressExtractionCandidateV1,
): Promise<AgentRunSnapshotV1> {
  let prepared: PreparedInputV1 | null = null
  try {
    prepared = await prepareInput(scope, candidate.chapterId, candidate.worldGroupId)
  } catch { /* stale */ }
  if (prepared
    && prepared.baselineHash === candidate.baselineHash
    && prepared.contextInputHash === candidate.contextInputHash
    && prepared.promptTemplateHash === candidate.promptTemplateHash
    && prepared.promptHash === candidate.promptHash) return snapshot
  const next = await append(scope, snapshot, 'candidate.staled', {
    stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    reason: 'cultivation-progress-source-or-prompt-changed',
  })
  throw Object.assign(new Error('章节、章序、角色、体系 DAG、既有进度、Context 或 Prompt 已变化，请重新分析。'), { snapshot: next })
}

export async function generateCultivationProgressExtractionCandidateV1(input: {
  scope: WorkspaceScope
  chapterId: number
  worldGroupId: number | null
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (
    boundary: CultivationProgressExtractionBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: CultivationProgressExtractionCandidateV1 }> {
  if (!input.runAI && !input.aiConfig) throw new Error('修炼进度提取缺少 AI 配置。')
  const prepared = await prepareInput(input.scope, input.chapterId, input.worldGroupId)
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    contract: contract(input.scope, input.chapterId, input.worldGroupId),
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1, attempt: 1 })
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: [...CULTIVATION_PROGRESS_EXTRACTION_CONTEXT_SOURCE_KEYS_V1],
    assembled: prepared.assembled,
    readerVersion: 'cultivation-progress-extraction-context-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1,
    attempt: 1,
    manifestHash: manifest.manifestHash,
  })
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1,
    attempt: 1,
    bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]),
  })
  let raw: string
  try {
    await input.onDurableBoundary?.('model.requested', snapshot)
    raw = await (input.runAI
      ? input.runAI(prepared.messages)
      : chat(prepared.messages, input.aiConfig!, {
          category: 'cultivation.progress',
          projectId: input.scope.projectId,
          configOverrides: { maxTokens: getAgentSkillV1('prose.cultivation-progress-extraction').maxOutputTokens },
          contextOverflowPolicy: 'reject',
        }))
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'cultivation-progress-model-outcome-unknown')
    throw error
  }
  snapshot = await append(input.scope, snapshot, 'model.responded', {
    stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1,
    attempt: 1,
    outputHash: await hashCanonicalValue({ raw }),
  })
  try {
    await input.onDurableBoundary?.('model.responded', snapshot)
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'cultivation-progress-model-result-uncheckpointed')
    throw error
  }
  let events: CultivationProgressExtractionCandidateItemV1[]
  try {
    events = parseCultivationProgressExtractionStrictV1({ raw, baseline: prepared.baseline })
  } catch (error) {
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1,
      attempt: 1,
      code: 'cultivation-progress-protocol-failed',
      retryable: false,
      category: 'protocol',
      action: 'fail',
    })
    await append(input.scope, snapshot, 'run.failed', { code: 'cultivation-progress-protocol-failed', retryable: false })
    throw error
  }
  const body = {
    version: 1 as const,
    kind: 'cultivation-progress-extraction-candidate' as const,
    portable: false as const,
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    chapterId: input.chapterId,
    worldGroupId: input.worldGroupId,
    baseline: prepared.baseline,
    baselineHash: prepared.baselineHash,
    contextManifestHash: manifest.manifestHash,
    contextInputHash: prepared.contextInputHash,
    promptTemplateHash: prepared.promptTemplateHash,
    promptHash: prepared.promptHash,
    modelOutputHash: await hashCanonicalValue({ raw }),
    events,
    eventsHash: await hashCanonicalValue(events),
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
    stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1,
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
  candidate: CultivationProgressExtractionCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const step = snapshot.projection.steps[CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1]
  if (step?.candidateHash) return snapshot
  if (step?.status !== 'running') throw new Error('修炼进度候选事件无法安全重建。')
  return append(scope, snapshot, 'candidate.persisted', {
    stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
}

export async function readPendingCultivationProgressExtractionCandidateV1(input: {
  scope: WorkspaceScope
  chapterId?: number
}): Promise<{
  snapshot: AgentRunSnapshotV1
  candidate: CultivationProgressExtractionCandidateV1
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => ['awaiting_confirmation', 'running'].includes(row.status)
      && isCultivationRun(row.contractJson, input.chapterId))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      let snapshot = await readAgentRunV1(input.scope, row.id)
      const { candidate, intent } = await latestState(input.scope, row.id)
      assertCandidateScope(input.scope, snapshot, candidate)
      if (input.chapterId != null && candidate.chapterId !== input.chapterId) continue
      snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
      if (snapshot.projection.state === 'awaiting_confirmation' && !intent) return { snapshot, candidate }
    } catch {
      // Damaged or unrelated local run remains auditable but is not offered.
    }
  }
  return null
}

export async function readRecoverableCultivationProgressExtractionRunV1(input: {
  scope: WorkspaceScope
  chapterId?: number
}): Promise<{
  snapshot: AgentRunSnapshotV1
  safeToResume: boolean
  candidate?: CultivationProgressExtractionCandidateV1
  selectedIndexes?: number[]
  adoptionPending?: boolean
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => ['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(row.status)
      && isCultivationRun(row.contractJson, input.chapterId))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    const snapshot = await readAgentRunV1(input.scope, row.id)
    try {
      const state = await latestState(input.scope, row.id)
      assertCandidateScope(input.scope, snapshot, state.candidate)
      if (input.chapterId != null && state.candidate.chapterId !== input.chapterId) continue
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

export async function adoptCultivationProgressExtractionCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  selectedIndexes?: readonly number[]
  onDurableBoundary?: (
    boundary: CultivationProgressExtractionAdoptionBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{
  snapshot: AgentRunSnapshotV1
  candidate: CultivationProgressExtractionCandidateV1
  receiptHash: string
  written: number
}> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate
  let intent = state.intent
  assertCandidateScope(input.scope, snapshot, candidate)
  const indexes = intent?.selectedIndexes
    ?? [...new Set(input.selectedIndexes ?? [])].sort((left, right) => left - right)
  const emptySelectionIsValid = candidate.events.length === 0 && indexes.length === 0
  if ((!emptySelectionIsValid && indexes.length < 1)
    || indexes.some(index => !Number.isInteger(index) || index < 0 || index >= candidate.events.length)) {
    throw new Error('请选择有效的修炼进度候选。')
  }
  if (intent && input.selectedIndexes && !sameValue(intent.selectedIndexes, [...input.selectedIndexes].sort((a, b) => a - b))) {
    throw new Error('修炼进度采纳选择与冻结意图不一致。')
  }
  let evidence = await currentEvidence(input.scope, candidate, intent)
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && intent) {
    if (!evidence.postMatches || !evidence.templateFresh) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope,
        runId: snapshot.run.id,
        reason: 'cultivation-progress-terminal-evidence-stale',
      })
      await append(input.scope, snapshot, 'candidate.staled', {
        stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: 'cultivation-progress-terminal-evidence-stale',
      })
      throw new Error('修炼进度完成回执已过期。')
    }
    return {
      snapshot,
      candidate,
      receiptHash: snapshot.projection.terminalReceiptHash,
      written: intent.projection.formalItems.length,
    }
  }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    snapshot = await staleBeforeWrite(input.scope, snapshot, candidate)
    if (!intent) {
      const projection = buildCultivationProgressExpectedProjectionV1(
        candidate.baseline,
        indexes.map(index => candidate.events[index]),
      )
      const body = {
        version: 1 as const,
        kind: 'cultivation-progress-extraction-adoption-intent' as const,
        portable: false as const,
        candidate,
        selectedIndexes: indexes,
        projection,
        projectionHash: await hashCanonicalValue(projection),
        transitionTimestamp: Date.now(),
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
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      intentHash: intent.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  } else if (snapshot.projection.steps[CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1]?.confirmation !== 'adopt' || !intent) {
    throw new Error('修炼进度候选不在可恢复采纳状态。')
  }
  let adoptionHash = snapshot.projection.steps[CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1]?.adoptionHash
  if (!adoptionHash) {
    evidence = await currentEvidence(input.scope, candidate, intent)
    if (!evidence.postMatches) {
      if (!evidence.baselineFresh || !evidence.templateFresh) {
        await pauseUnsafeRun(input.scope, snapshot, 'cultivation-progress-formal-state-diverged')
        throw new Error('修炼进度正式状态与冻结 baseline 或意图不一致。')
      }
      await adoptCultivationProgressExtractionAtomicV1({
        scope: input.scope,
        baseline: candidate.baseline,
        projection: intent.projection,
        transitionTimestamp: intent.transitionTimestamp,
      })
      evidence = await currentEvidence(input.scope, candidate, intent)
    }
    if (!evidence.postMatches) {
      await pauseUnsafeRun(input.scope, snapshot, 'cultivation-progress-post-state-diverged')
      throw new Error('修炼进度写入后正式状态与冻结意图不一致。')
    }
    await input.onDurableBoundary?.('formal.written', snapshot)
    adoptionHash = await hashCanonicalValue({
      intentHash: intent.intentHash,
      projectionHash: intent.projectionHash,
      written: intent.projection.formalItems.length,
    })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      adoptionHash,
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  evidence = await currentEvidence(input.scope, candidate, intent)
  if (!evidence.postMatches || !evidence.templateFresh) {
    await pauseUnsafeRun(input.scope, snapshot, 'cultivation-progress-terminal-evidence-stale')
    throw new Error('修炼进度在采纳后、终验前发生漂移，本次回执不会通过。')
  }
  if (snapshot.projection.steps[CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1]?.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1,
      attempt: 1,
      outputHash: adoptionHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: CULTIVATION_PROGRESS_EXTRACTION_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  const postStateHash = await hashCanonicalValue({
    baselineHash: candidate.baselineHash,
    projectionHash: intent.projectionHash,
    transitionTimestamp: intent.transitionTimestamp,
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
    verifierSetVersion: CULTIVATION_PROGRESS_EXTRACTION_VERIFIER_SET_V1,
    criteria: [
      { id: 'cultivation-progress.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'cultivation-progress.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'cultivation-progress.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return {
    snapshot,
    candidate,
    receiptHash: receipt.receiptHash,
    written: intent.projection.formalItems.length,
  }
}

export async function rejectCultivationProgressExtractionCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate, intent } = await latestState(input.scope, input.runId)
  assertCandidateScope(input.scope, snapshot, candidate)
  if (snapshot.projection.state !== 'awaiting_confirmation' || intent) {
    throw new Error('修炼进度候选不在可拒绝状态。')
  }
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    decision: 'reject',
  })
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-cultivation-progress-extraction' })
}

export async function abandonCultivationProgressExtractionRunV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  if (!['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(snapshot.projection.state)) {
    throw new Error('修炼进度运行不在可放弃状态。')
  }
  const state = await latestState(input.scope, input.runId).catch(() => null)
  if (state?.intent || snapshot.projection.steps[CULTIVATION_PROGRESS_EXTRACTION_STEP_ID_V1]?.confirmation === 'adopt') {
    throw new Error('修炼进度采纳选择已冻结，不能取消；请继续写入与终验。')
  }
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-abandoned-cultivation-progress-extraction' })
}
