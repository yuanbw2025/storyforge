import { db } from '../../db/schema'
import {
  getChapterDerivedMemoryStatus,
  hashChapterText,
} from '../../ai/chapter-memory/text-normalization'
import type {
  AgentConversation,
  AgentEvent,
  StateDiffItem,
  WorkspaceScope,
} from '../../types'
import type { ContextManifestV1 } from '../../types/agent-run'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { createVerificationReceiptV1 } from './verification-receipt'
import { hashCanonicalValue } from './hash'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveScopeLike,
  scopeTransactionTables,
  stampNewRecord,
} from '../../workspace/scope'

export const CHAPTER_TRANSITION_STEP_IDS_V1 = {
  retrieval: 'chapter-transition:retrieval',
  state: 'chapter-transition:state-extraction',
  memory: 'chapter-transition:memory',
} as const

export type ChapterTransitionStepIdV1 = typeof CHAPTER_TRANSITION_STEP_IDS_V1[keyof typeof CHAPTER_TRANSITION_STEP_IDS_V1]

export const CHAPTER_TRANSITION_SOURCE_KEYS_V1 = [
  'chapterContent',
  'chapterOutline',
  'detailedOutline',
  'stateCards',
  'currentFacts',
  'characters',
  'characterRelations',
  'itemLedger',
  'foreshadows',
  'canonAssertions',
  'characterKnowledge',
  'retrievedPassages',
] as const

export const CHAPTER_TRANSITION_VERIFIER_SET_V1 = 'chapter-transition-terminal-v1'
export const CHAPTER_TRANSITION_CANDIDATE_TYPE_V1 = 'chapter-transition-state-candidate'

export interface ChapterTransitionDurableEvidenceV1 {
  runId: number
  stepId: ChapterTransitionStepIdV1
  attempt: number
  contextManifestHash: string
  candidateHash: string
}

export interface ChapterTransitionCandidateV1 {
  version: 1
  type: typeof CHAPTER_TRANSITION_CANDIDATE_TYPE_V1
  projectId: number
  chapterId: number
  chapterTitle: string
  worldGroupId: number | null
  sourceTextHash: string
  stateDiffs: StateDiffItem[]
  createdAt: number
  durable: ChapterTransitionDurableEvidenceV1
}

function stepIds(): ChapterTransitionStepIdV1[] {
  return Object.values(CHAPTER_TRANSITION_STEP_IDS_V1)
}

export function buildChapterTransitionRunContractV1(input: {
  projectId: number
  worldGroupId: number | null
  chapterId: number
  runtimeBindingHash: string
}) {
  return {
    version: 1 as const,
    objective: `完成章节 #${input.chapterId} 正文保存后的检索、状态候选与章节记忆派生处理`,
    workflowKind: 'long-running-resumable' as const,
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      chapterIds: [input.chapterId],
    },
    permissions: {
      contextSourceKeys: [...CHAPTER_TRANSITION_SOURCE_KEYS_V1],
      writeTargets: [
        {
          table: 'chapters',
          fields: [
            'summary',
            'summarySourceTextHash',
            'summaryTextNormalizationVersion',
            'continuityHandoff',
            'planReconciliation',
          ],
          mode: 'candidate-only' as const,
        },
        {
          table: 'stateCards',
          fields: ['category', 'entityName', 'fields', 'lastChapterId'],
          mode: 'author-confirmed' as const,
        },
      ],
    },
    runtimeBindingHash: input.runtimeBindingHash,
    budget: {
      maxModelCalls: 2,
      maxToolCalls: 0,
      maxInputTokens: 24_000,
      maxOutputTokens: 8_000,
      maxAttemptsPerStep: 2,
      maxProtocolErrors: 1,
    },
    acceptance: [
      { id: 'chapter-transition.retrieval', kind: 'deterministic-check' as const, required: true },
      { id: 'chapter-transition.state', kind: 'author-confirmed' as const, required: true },
      { id: 'chapter-transition.memory', kind: 'adoption-committed' as const, required: true },
      { id: 'chapter-transition.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'chapter-transition.terminal',
      kind: 'terminal' as const,
      verifier: CHAPTER_TRANSITION_VERIFIER_SET_V1,
      criterionIds: [
        'chapter-transition.retrieval',
        'chapter-transition.state',
        'chapter-transition.memory',
        'chapter-transition.post-state',
      ],
    }],
    failurePolicy: {
      onProtocolError: 'retry' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

export async function createChapterTransitionDurableRunV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  chapterId: number
}): Promise<AgentRunSnapshotV1> {
  return createAgentRunV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    contract: buildChapterTransitionRunContractV1({
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
      chapterId: input.chapterId,
      runtimeBindingHash: await hashCanonicalValue({
        schema: 'storyforge.chapter-transition-runtime',
        version: 1,
        stepIds: CHAPTER_TRANSITION_STEP_IDS_V1,
        verifierSet: CHAPTER_TRANSITION_VERIFIER_SET_V1,
      }),
    }),
  })
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

export async function scheduleChapterTransitionStepsV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
}): Promise<AgentRunSnapshotV1> {
  let snapshot = input.snapshot
  for (const stepId of stepIds()) {
    if (!snapshot.projection.steps[stepId]) {
      snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId })
    }
  }
  return snapshot
}

export async function beginChapterTransitionStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  stepId: ChapterTransitionStepIdV1
  contextManifest: ContextManifestV1
  binding?: unknown
  model?: boolean
}): Promise<AgentRunSnapshotV1> {
  if (input.contextManifest.runId !== input.snapshot.run.id
    || input.contextManifest.stepId !== input.stepId) {
    throw new Error('章节后处理 Context Manifest 与 durable step 不匹配。')
  }
  const step = input.snapshot.projection.steps[input.stepId]
  if (!step || step.status !== 'scheduled') {
    throw new Error(`章节后处理 step ${input.stepId} 当前不可启动。`)
  }
  let snapshot = await append(input.scope, input.snapshot, 'step.started', {
    stepId: input.stepId,
    attempt: 1,
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: input.stepId,
    attempt: 1,
    manifestHash: input.contextManifest.manifestHash,
  })
  if (input.model !== false) {
    snapshot = await append(input.scope, snapshot, 'model.requested', {
      stepId: input.stepId,
      attempt: 1,
      bindingHash: await hashCanonicalValue({
        stepId: input.stepId,
        binding: input.binding ?? null,
      }),
    })
  }
  return snapshot
}

export async function recordChapterTransitionOutputV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  stepId: ChapterTransitionStepIdV1
  output: unknown
  candidateHash?: string
  requiresConfirmation?: boolean
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[input.stepId]
  if (!step || step.status !== 'running' || step.attempt !== 1) {
    throw new Error(`章节后处理 step ${input.stepId} 不在运行状态。`)
  }
  const outputHash = await hashCanonicalValue(input.output)
  let snapshot = await append(input.scope, input.snapshot, 'model.responded', {
    stepId: input.stepId,
    attempt: 1,
    outputHash,
  })
  if (input.candidateHash) {
    snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
      stepId: input.stepId,
      attempt: 1,
      candidateHash: input.candidateHash,
      requiresConfirmation: input.requiresConfirmation ?? false,
    })
  }
  return snapshot
}

export async function succeedChapterTransitionStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  stepId: ChapterTransitionStepIdV1
  output: unknown
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[input.stepId]
  if (!step || step.status !== 'running') throw new Error(`章节后处理 step ${input.stepId} 不在运行状态。`)
  return append(input.scope, input.snapshot, 'step.succeeded', {
    stepId: input.stepId,
    attempt: step.attempt,
    outputHash: await hashCanonicalValue(input.output),
  })
}

export async function failChapterTransitionStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  stepId: ChapterTransitionStepIdV1
  code: string
  retryable?: boolean
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[input.stepId]
  if (!step || !['running', 'scheduled'].includes(step.status)) return input.snapshot
  if (step.status === 'scheduled') {
    return append(input.scope, input.snapshot, 'step.started', {
      stepId: input.stepId,
      attempt: 1,
    }).then(next => append(input.scope, next, 'step.failed', {
      stepId: input.stepId,
      attempt: 1,
      code: input.code.slice(0, 160),
      retryable: input.retryable ?? true,
    }))
  }
  return append(input.scope, input.snapshot, 'step.failed', {
    stepId: input.stepId,
    attempt: step.attempt,
    code: input.code.slice(0, 160),
    retryable: input.retryable ?? true,
  })
}

function isTransitionCandidate(value: unknown): value is ChapterTransitionCandidateV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<ChapterTransitionCandidateV1>
  return candidate.version === 1
    && candidate.type === CHAPTER_TRANSITION_CANDIDATE_TYPE_V1
    && typeof candidate.projectId === 'number'
    && typeof candidate.chapterId === 'number'
    && typeof candidate.sourceTextHash === 'string'
    && Array.isArray(candidate.stateDiffs)
    && !!candidate.durable
    && typeof candidate.durable.runId === 'number'
}

export async function hashChapterTransitionCandidateV1(
  candidate: Omit<ChapterTransitionCandidateV1, 'durable'>,
): Promise<string> {
  return hashCanonicalValue(candidate)
}

export async function persistChapterTransitionCandidateV1(input: {
  scope: WorkspaceScope
  candidate: ChapterTransitionCandidateV1
}): Promise<{ conversation: AgentConversation & { id: number }; event: AgentEvent & { id: number } }> {
  const chapter = await db.chapters.get(input.candidate.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('章节后处理候选的章节不存在或越界。')
  }
  const now = Date.now()
  const conversation = stampNewRecord(input.scope, 'agentConversations', {
    projectId: input.scope.projectId,
    worldGroupId: input.candidate.worldGroupId,
    purpose: 'chapter.transition',
    title: `章节后处理 · ${input.candidate.chapterTitle}`,
    status: 'archived',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as AgentConversation
  return db.transaction(
    'rw',
    scopeTransactionTables(db.agentConversations, db.agentEvents),
    async () => {
      const conversationId = await db.agentConversations.add(conversation) as number
      const event = stampNewRecord(input.scope, 'agentEvents', {
        projectId: input.scope.projectId,
        conversationId,
        durableRunId: input.candidate.durable.runId,
        sequence: 1,
        kind: 'candidate',
        content: `章节后处理状态候选 ${input.candidate.stateDiffs.length} 条`,
        payload: JSON.stringify(input.candidate),
        createdAt: now,
      }, { owner: 'work' }) as AgentEvent
      const eventId = await db.agentEvents.add(event) as number
      return {
        conversation: { ...conversation, id: conversationId },
        event: { ...event, id: eventId },
      }
    },
  )
}

export async function readLatestChapterTransitionCandidateV1(input: {
  scope: WorkspaceScope
  chapterId: number
}): Promise<ChapterTransitionCandidateV1 | null> {
  const events = await readOwnedRows<AgentEvent>(input.scope, 'agentEvents', { owner: 'work' })
  const matches = events
    .map(event => {
      try { return { event, value: JSON.parse(event.payload) as unknown } } catch { return null }
    })
    .filter((value): value is { event: AgentEvent; value: ChapterTransitionCandidateV1 } => (
      !!value && isTransitionCandidate(value.value)
        && value.value.chapterId === input.chapterId
        && value.value.projectId === input.scope.projectId
    ))
    .sort((left, right) => right.event.createdAt - left.event.createdAt)
  return matches[0]?.value ?? null
}

export async function isChapterTransitionCandidateCurrentV1(
  candidate: ChapterTransitionCandidateV1,
): Promise<boolean> {
  const scope = await resolveScopeLike(candidate.projectId)
  const chapter = await db.chapters.get(candidate.chapterId)
  return Boolean(
    chapter
    && await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })
    && await hashChapterText(chapter.content ?? '') === candidate.sourceTextHash
  )
}

/** Recover the candidate-event/ledger crash window and return only a current,
 * still-awaiting author decision candidate. */
export async function recoverChapterTransitionCandidateV1(input: {
  scope: WorkspaceScope
  candidate: ChapterTransitionCandidateV1
}): Promise<ChapterTransitionCandidateV1 | null> {
  if (!await isChapterTransitionCandidateCurrentV1(input.candidate)) return null
  let snapshot = await readAgentRunV1(input.scope, input.candidate.durable.runId)
  let step = snapshot.projection.steps[CHAPTER_TRANSITION_STEP_IDS_V1.state]
  if (step?.status === 'running' && !step.candidateHash) {
    snapshot = await recordChapterTransitionOutputV1({
      scope: input.scope,
      snapshot,
      stepId: CHAPTER_TRANSITION_STEP_IDS_V1.state,
      output: input.candidate.stateDiffs,
      candidateHash: input.candidate.durable.candidateHash,
      requiresConfirmation: input.candidate.stateDiffs.length > 0,
    })
    step = snapshot.projection.steps[CHAPTER_TRANSITION_STEP_IDS_V1.state]
  }
  return step?.status === 'awaiting_confirmation'
    && step.candidateHash === input.candidate.durable.candidateHash
    ? input.candidate
    : null
}

export async function commitChapterTransitionStateAdoptionV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: ChapterTransitionCandidateV1
  written: number
}): Promise<AgentRunSnapshotV1> {
  const chapter = await db.chapters.get(input.candidate.chapterId)
  if (!chapter || await hashChapterText(chapter.content ?? '') !== input.candidate.sourceTextHash) {
    await markChapterTransitionStaleV1({
      scope: input.scope,
      runId: input.runId,
      stepId: CHAPTER_TRANSITION_STEP_IDS_V1.state,
      candidateHash: input.candidate.durable.candidateHash,
      reason: '正文 hash 已变化；状态候选不可写回。',
    })
    throw new Error('章节正文已变化，这批状态候选已过期；请重新生成。')
  }
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const step = snapshot.projection.steps[CHAPTER_TRANSITION_STEP_IDS_V1.state]
  if (!step || step.status !== 'awaiting_confirmation' || step.candidateHash !== input.candidate.durable.candidateHash) {
    throw new Error('章节后处理状态候选不在等待确认状态。')
  }
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: CHAPTER_TRANSITION_STEP_IDS_V1.state,
    candidateHash: input.candidate.durable.candidateHash,
    decision: 'adopt',
  })
  snapshot = await append(input.scope, snapshot, 'adoption.started', {
    stepId: CHAPTER_TRANSITION_STEP_IDS_V1.state,
    candidateHash: input.candidate.durable.candidateHash,
    intentHash: await hashCanonicalValue({ chapterId: input.candidate.chapterId, written: input.written }),
  })
  snapshot = await append(input.scope, snapshot, 'adoption.committed', {
    stepId: CHAPTER_TRANSITION_STEP_IDS_V1.state,
    candidateHash: input.candidate.durable.candidateHash,
    adoptionHash: await hashCanonicalValue({
      version: 1,
      candidateHash: input.candidate.durable.candidateHash,
      chapterId: input.candidate.chapterId,
      written: input.written,
    }),
  })
  return succeedChapterTransitionStepV1({
    scope: input.scope,
    snapshot,
    stepId: CHAPTER_TRANSITION_STEP_IDS_V1.state,
    output: { candidateHash: input.candidate.durable.candidateHash, written: input.written },
  })
}

export async function markChapterTransitionStaleV1(input: {
  scope: WorkspaceScope
  runId: number
  stepId: ChapterTransitionStepIdV1
  candidateHash: string
  reason: string
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  const step = snapshot.projection.steps[input.stepId]
  if (!step || step.status === 'stale' || ['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)) return snapshot
  return append(input.scope, snapshot, 'candidate.staled', {
    stepId: input.stepId,
    candidateHash: input.candidateHash,
    reason: input.reason.slice(0, 1_000),
  })
}

async function postStateHash(input: { scope: WorkspaceScope; chapterId: number }): Promise<string> {
  const chapter = await db.chapters.get(input.chapterId)
  const [chunks, summaries, stateCards] = await Promise.all([
    readOwnedRows<Record<string, unknown>>(input.scope, 'retrievalChunks', { owner: 'work' }),
    readOwnedRows<Record<string, unknown>>(input.scope, 'narrativeSummaryNodes', { owner: 'work' }),
    readOwnedRows<Record<string, unknown>>(input.scope, 'stateCards', { owner: 'work' }),
  ])
  return hashCanonicalValue({
    version: 1,
    chapterId: input.chapterId,
    chapter: chapter ? {
      content: chapter.content,
      summary: chapter.summary,
      summarySourceTextHash: chapter.summarySourceTextHash,
      continuityHandoff: chapter.continuityHandoff,
      planReconciliation: chapter.planReconciliation,
    } : null,
    retrievalChunks: chunks.filter(row => row.sourceChapterId === input.chapterId).sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0)),
    narrativeSummaries: summaries.sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0)),
    stateCards: stateCards.sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0)),
  })
}

export async function verifyChapterTransitionRunV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  if (snapshot.projection.state === 'completed' && snapshot.run.terminalReceiptHash) {
    return { snapshot, receiptHash: snapshot.run.terminalReceiptHash }
  }
  const steps = stepIds().map(stepId => snapshot.projection.steps[stepId])
  if (steps.some(step => !step || step.status !== 'succeeded')) {
    throw new Error('章节后处理尚未完成全部必需步骤。')
  }
  const chapterId = snapshot.contract.scope.chapterIds?.[0]
  if (chapterId == null) throw new Error('章节后处理运行缺少章节作用域。')
  const chapter = chapterId == null ? null : await db.chapters.get(chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('章节后处理终态校验找不到来源章节。')
  }
  const memory = await getChapterDerivedMemoryStatus(chapter)
  if (memory.summary !== 'verified' || memory.handoff !== 'verified') {
    throw new Error('章节后处理终态校验发现 summary/handoff 缺失或已过期。')
  }
  const [chapterChunks, chapterSummaryNodes] = await Promise.all([
    readOwnedRows<Record<string, unknown>>(input.scope, 'retrievalChunks', { owner: 'work' })
      .then(rows => rows.filter(row => row.sourceChapterId === chapterId)),
    readOwnedRows<Record<string, unknown>>(input.scope, 'narrativeSummaryNodes', { owner: 'work' })
      .then(rows => rows.filter(row => row.level === 'chapter' && row.sourceChapterId === chapterId)),
  ])
  if (
    chapterChunks.length === 0
    || chapterChunks.some(row => row.sourceTextHash !== memory.currentSourceTextHash)
    || chapterSummaryNodes.length === 0
    || chapterSummaryNodes.some(row => row.sourceHash !== memory.currentSourceTextHash)
  ) {
    throw new Error('章节后处理终态校验发现检索块或叙事摘要未匹配当前正文。')
  }
  const contextManifestHashes = stepIds().map(stepId => {
    const event = snapshot.events.find((item): item is Extract<typeof item, { type: 'context.assembled' }> => (
      item.type === 'context.assembled' && item.payload.stepId === stepId
    ))
    return event?.payload.manifestHash ?? ''
  })
  if (contextManifestHashes.some(hash => !hash)) throw new Error('章节后处理缺少 Context Manifest 证据。')
  const candidateHashes = steps
    .map(step => step?.candidateHash ?? step?.outputHash ?? '')
    .filter(Boolean)
  const adoptionEventIds = (await db.agentRunEvents.where('runId').equals(input.runId).toArray())
    .filter(row => row.id != null && row.type === 'adoption.committed')
    .map(row => row.id!)
  const postState = await postStateHash({ scope: input.scope, chapterId })
  snapshot = await append(input.scope, snapshot, 'verification.started', {
    verifierSetVersion: CHAPTER_TRANSITION_VERIFIER_SET_V1,
  })
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: input.runId,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes,
    candidateHashes,
    adoptionEventIds,
    postStateHash: postState,
    verifierSetVersion: CHAPTER_TRANSITION_VERIFIER_SET_V1,
    criteria: [
      { id: 'chapter-transition.retrieval', status: 'passed', evidenceRefs: [`step:${CHAPTER_TRANSITION_STEP_IDS_V1.retrieval}`] },
      { id: 'chapter-transition.state', status: 'passed', evidenceRefs: [`step:${CHAPTER_TRANSITION_STEP_IDS_V1.state}`] },
      { id: 'chapter-transition.memory', status: 'passed', evidenceRefs: [`step:${CHAPTER_TRANSITION_STEP_IDS_V1.memory}`] },
      { id: 'chapter-transition.post-state', status: 'passed', evidenceRefs: [`post-state:${postState}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, receiptHash: receipt.receiptHash }
}

export async function resolveChapterTransitionScope(projectId: number): Promise<WorkspaceScope> {
  return resolveScopeLike(projectId)
}
