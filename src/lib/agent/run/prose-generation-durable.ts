import { db } from '../../db/schema'
import { adopt } from '../../registry/adopt'
import { hashChapterText, CHAPTER_TEXT_NORMALIZATION_VERSION } from '../../ai/chapter-memory/text-normalization'
import type { AgentConversation, AgentEvent, WorkspaceScope } from '../../types'
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
  scopeTransactionTables,
  stampNewRecord,
} from '../../world-engine/scope'

export const PROSE_GENERATION_STEP_ID_V1 = 'prose-generation'
export const PROSE_GENERATION_VERIFIER_SET_V1 = 'prose-generation-terminal-v1'
export const PROSE_GENERATION_CANDIDATE_TYPE_V1 = 'prose-generation-candidate'

/**
 * These are the sources used by the chapter editor's actual generation
 * prompt. Keeping the list here makes the durable contract auditable and
 * prevents a future prompt edit from silently widening the read boundary.
 */
export const PROSE_GENERATION_SOURCE_KEYS_V1 = [
  'contextMemo',
  'chapterOutline',
  'detailedOutline',
  'chapterContinuityHandoff',
  'previousPlanReconciliation',
  'previousChapterEnding',
  'recentChapterSummaries',
  'worldview',
  'storyCore',
  'characterDrivenPlan',
  'powerSystem',
  'cultivationProgress',
  'codex',
  'creativeRules',
  'worldRules',
  'historical',
  'locations',
  'foreshadows',
  'storyArcs',
  'storylineProgress',
  'emotionBeats',
  'stateCards',
  'currentFacts',
  'canonAssertions',
  'characterKnowledge',
  'heldItems',
  'retrievedPassages',
  'references',
  'userStyleProfile',
  'characters',
] as const

export type ProseGenerationOperationV1 = 'generate' | 'continue'

export interface ProseGenerationDurableEvidenceV1 {
  runId: number
  stepId: typeof PROSE_GENERATION_STEP_ID_V1
  attempt: number
  contextManifestHash: string
  candidateHash: string
}

export interface ProseGenerationCandidateV1 {
  version: 1
  type: typeof PROSE_GENERATION_CANDIDATE_TYPE_V1
  projectId: number
  chapterId: number
  chapterTitle: string
  worldGroupId: number | null
  operation: ProseGenerationOperationV1
  /** Hash of the chapter content at the moment the model request started. */
  sourceTextHash: string
  outputText: string
  outputTextHash: string
  /** Expected normalized chapter hash after this candidate is adopted. */
  expectedContentHash: string
  createdAt: number
  durable: ProseGenerationDurableEvidenceV1
}

export function buildProseGenerationRunContractV1(input: {
  projectId: number
  worldGroupId: number | null
  chapterId: number
  operation: ProseGenerationOperationV1
}) {
  return {
    version: 1 as const,
    objective: `${input.operation === 'continue' ? '续写' : '生成'}章节 #${input.chapterId} 正文候选，并等待作者确认后写回`,
    workflowKind: 'long-running-resumable' as const,
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      chapterIds: [input.chapterId],
    },
    permissions: {
      contextSourceKeys: [...PROSE_GENERATION_SOURCE_KEYS_V1],
      writeTargets: [{
        table: 'chapters',
        fields: ['content', 'wordCount'],
        mode: 'author-confirmed' as const,
      }],
    },
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 48_000,
      maxOutputTokens: 16_000,
      maxAttemptsPerStep: 2,
      maxProtocolErrors: 1,
    },
    acceptance: [
      { id: 'prose-generation.candidate', kind: 'output-present' as const, required: true },
      { id: 'prose-generation.confirmed', kind: 'author-confirmed' as const, required: true },
      { id: 'prose-generation.adopted', kind: 'adoption-committed' as const, required: true },
      { id: 'prose-generation.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'prose-generation.terminal',
      kind: 'terminal' as const,
      verifier: PROSE_GENERATION_VERIFIER_SET_V1,
      criterionIds: [
        'prose-generation.candidate',
        'prose-generation.confirmed',
        'prose-generation.adopted',
        'prose-generation.post-state',
      ],
    }],
    failurePolicy: {
      onProtocolError: 'retry' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

export async function createProseGenerationDurableRunV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  chapterId: number
  operation: ProseGenerationOperationV1
}): Promise<AgentRunSnapshotV1> {
  return createAgentRunV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    contract: buildProseGenerationRunContractV1({
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
      chapterId: input.chapterId,
      operation: input.operation,
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

export async function beginProseGenerationStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  contextManifest: ContextManifestV1
  binding: { operation: ProseGenerationOperationV1; sourceTextHash: string; promptHash: string }
}): Promise<AgentRunSnapshotV1> {
  if (input.contextManifest.runId !== input.snapshot.run.id
    || input.contextManifest.stepId !== PROSE_GENERATION_STEP_ID_V1) {
    throw new Error('正文生成 Context Manifest 与 durable run 不匹配。')
  }
  let snapshot = await append(input.scope, input.snapshot, 'step.scheduled', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
  })
  snapshot = await append(input.scope, snapshot, 'step.started', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: 1,
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: 1,
    manifestHash: input.contextManifest.manifestHash,
  })
  return append(input.scope, snapshot, 'model.requested', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: 1,
    bindingHash: await hashCanonicalValue(input.binding),
  })
}

export async function recordProseGenerationModelOutputV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  output: string
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  if (!step || step.status !== 'running' || step.attempt !== 1) {
    throw new Error('正文生成 durable step 不在模型响应状态。')
  }
  return append(input.scope, input.snapshot, 'model.responded', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: 1,
    outputHash: await hashCanonicalValue(input.output),
  })
}

function isProseGenerationCandidate(value: unknown): value is ProseGenerationCandidateV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<ProseGenerationCandidateV1>
  return candidate.version === 1
    && candidate.type === PROSE_GENERATION_CANDIDATE_TYPE_V1
    && typeof candidate.projectId === 'number'
    && typeof candidate.chapterId === 'number'
    && (candidate.operation === 'generate' || candidate.operation === 'continue')
    && typeof candidate.sourceTextHash === 'string'
    && typeof candidate.outputText === 'string'
    && typeof candidate.outputTextHash === 'string'
    && typeof candidate.expectedContentHash === 'string'
    && !!candidate.durable
    && candidate.durable.stepId === PROSE_GENERATION_STEP_ID_V1
}

export async function hashProseGenerationCandidateV1(
  candidate: Omit<ProseGenerationCandidateV1, 'durable'>,
): Promise<string> {
  return hashCanonicalValue(candidate)
}

export async function persistProseGenerationCandidateV1(input: {
  scope: WorkspaceScope
  candidate: ProseGenerationCandidateV1
}): Promise<{ conversation: AgentConversation & { id: number }; event: AgentEvent & { id: number } }> {
  const chapter = await db.chapters.get(input.candidate.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('正文生成候选的章节不存在或越界。')
  }
  const now = Date.now()
  const conversation = stampNewRecord(input.scope, 'agentConversations', {
    projectId: input.scope.projectId,
    worldGroupId: input.candidate.worldGroupId,
    title: `${input.candidate.operation === 'continue' ? '续写' : '生成正文'} · ${input.candidate.chapterTitle}`,
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
        sequence: 1,
        kind: 'candidate',
        content: `正文生成候选 ${input.candidate.outputText.length} 字`,
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

export async function recordProseGenerationCandidateV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  candidate: ProseGenerationCandidateV1
}): Promise<AgentRunSnapshotV1> {
  const durable = input.candidate.durable
  if (durable.runId !== input.snapshot.run.id) throw new Error('正文生成候选 durable evidence 不匹配。')
  const step = input.snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  if (!step || step.status !== 'running' || step.attempt !== durable.attempt) {
    throw new Error('正文生成 durable step 不在候选持久化状态。')
  }
  const alreadyResponded = input.snapshot.events.some(event => (
    event.type === 'model.responded'
      && event.payload.stepId === PROSE_GENERATION_STEP_ID_V1
      && event.payload.attempt === durable.attempt
  ))
  let snapshot = input.snapshot
  if (!alreadyResponded) {
    snapshot = await append(input.scope, snapshot, 'model.responded', {
      stepId: PROSE_GENERATION_STEP_ID_V1,
      attempt: durable.attempt,
      outputHash: durable.candidateHash,
    })
  }
  return append(input.scope, snapshot, 'candidate.persisted', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: durable.attempt,
    candidateHash: durable.candidateHash,
    requiresConfirmation: true,
  })
}

export async function readLatestProseGenerationCandidateV1(input: {
  scope: WorkspaceScope
  chapterId: number
}): Promise<ProseGenerationCandidateV1 | null> {
  const events = await readOwnedRows<AgentEvent>(input.scope, 'agentEvents', { owner: 'work' })
  const matches = events
    .map(event => {
      try { return { event, value: JSON.parse(event.payload) as unknown } } catch { return null }
    })
    .filter((value): value is { event: AgentEvent; value: ProseGenerationCandidateV1 } => (
      !!value
      && isProseGenerationCandidate(value.value)
      && value.value.chapterId === input.chapterId
      && value.value.projectId === input.scope.projectId
    ))
    .sort((left, right) => right.event.createdAt - left.event.createdAt)
  return matches[0]?.value ?? null
}

export async function isProseGenerationCandidateCurrentV1(
  candidate: ProseGenerationCandidateV1,
): Promise<boolean> {
  const chapter = await db.chapters.get(candidate.chapterId)
  return Boolean(chapter && await hashChapterText(chapter.content ?? '') === candidate.sourceTextHash)
}

/** Recover an event-store crash window without calling the model again. */
export async function recoverProseGenerationCandidateV1(input: {
  scope: WorkspaceScope
  candidate: ProseGenerationCandidateV1
}): Promise<AgentRunSnapshotV1 | null> {
  if (!await isProseGenerationCandidateCurrentV1(input.candidate)) return null
  const snapshot = await readAgentRunV1(input.scope, input.candidate.durable.runId)
  const step = snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  if (step?.candidateHash === input.candidate.durable.candidateHash) return snapshot
  if (step?.status !== 'running') return null
  return recordProseGenerationCandidateV1({
    scope: input.scope,
    snapshot,
    candidate: input.candidate,
  })
}

export async function failProseGenerationStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  code: string
  retryable?: boolean
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  if (!step || !['running', 'scheduled'].includes(step.status)) return input.snapshot
  let snapshot = input.snapshot
  if (step.status === 'scheduled') {
    snapshot = await append(input.scope, snapshot, 'step.started', {
      stepId: PROSE_GENERATION_STEP_ID_V1,
      attempt: 1,
    })
  }
  return append(input.scope, snapshot, 'step.failed', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: step.status === 'scheduled' ? 1 : step.attempt,
    code: input.code.slice(0, 160),
    retryable: input.retryable ?? true,
  })
}

export async function markProseGenerationStaleV1(input: {
  scope: WorkspaceScope
  runId: number
  reason: string
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  const step = snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  if (!step?.candidateHash || step.status === 'stale' || ['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)) {
    return snapshot
  }
  return append(input.scope, snapshot, 'candidate.staled', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    candidateHash: step.candidateHash,
    reason: input.reason.slice(0, 1_000),
  })
}

export async function rejectProseGenerationCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: ProseGenerationCandidateV1
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  const step = snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  if (
    step?.status !== 'awaiting_confirmation'
    || step.candidateHash !== input.candidate.durable.candidateHash
  ) return snapshot
  return append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    candidateHash: input.candidate.durable.candidateHash,
    decision: 'reject',
  })
}

async function prosePostStateHash(input: { scope: WorkspaceScope; chapterId: number }): Promise<string> {
  const chapter = await db.chapters.get(input.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('正文生成终态校验找不到章节。')
  }
  return hashCanonicalValue({
    version: 1,
    chapterId: input.chapterId,
    content: chapter.content,
    wordCount: chapter.wordCount,
  })
}

export async function commitProseGenerationAdoptionV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: ProseGenerationCandidateV1
  contentHtml: string
  wordCount: number
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string }> {
  if (!await isProseGenerationCandidateCurrentV1(input.candidate)) {
    await markProseGenerationStaleV1({
      scope: input.scope,
      runId: input.runId,
      reason: '正文 hash 已变化；旧正文候选不可提交。',
    })
    throw new Error('章节正文已变化，这批正文候选已过期；请重新生成。')
  }
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const step = snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  if (!step || step.status !== 'awaiting_confirmation' || step.candidateHash !== input.candidate.durable.candidateHash) {
    throw new Error('正文生成候选不在等待作者确认状态。')
  }
  const outputContentHash = await hashChapterText(input.contentHtml)
  if (outputContentHash !== input.candidate.expectedContentHash) {
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: PROSE_GENERATION_STEP_ID_V1,
      candidateHash: input.candidate.durable.candidateHash,
      decision: 'adopt',
    })
    snapshot = await append(input.scope, snapshot, 'adoption.rejected', {
      stepId: PROSE_GENERATION_STEP_ID_V1,
      candidateHash: input.candidate.durable.candidateHash,
      code: 'prose_adoption_output_mismatch',
    })
    throw new Error('正文编辑器的待写入内容与作者确认的候选不一致。')
  }
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    candidateHash: input.candidate.durable.candidateHash,
    decision: 'adopt',
  })
  snapshot = await append(input.scope, snapshot, 'adoption.started', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    candidateHash: input.candidate.durable.candidateHash,
    intentHash: await hashCanonicalValue({
      chapterId: input.candidate.chapterId,
      operation: input.candidate.operation,
      sourceTextHash: input.candidate.sourceTextHash,
    }),
  })
  let result
  try {
    result = await adopt({
      projectId: input.scope.projectId,
      scope: input.scope,
      target: 'chapters',
      recordId: input.candidate.chapterId,
      mode: 'replace',
      data: {
        content: input.contentHtml,
        wordCount: input.wordCount,
      },
      compareAndSet: {
        kind: 'chapter-source-text-hash',
        expectedHash: input.candidate.sourceTextHash,
        textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
      },
    })
  } catch (error) {
    const current = await readAgentRunV1(input.scope, input.runId)
    if (current.projection.state === 'running') {
      await append(input.scope, current, 'adoption.rejected', {
        stepId: PROSE_GENERATION_STEP_ID_V1,
        candidateHash: input.candidate.durable.candidateHash,
        code: error instanceof Error ? error.message : 'prose_adoption_failed',
      })
    }
    throw error
  }
  if (!result.written.some(item => item.id === input.candidate.chapterId && item.fields.includes('content'))) {
    const current = await readAgentRunV1(input.scope, input.runId)
    if (current.projection.state === 'running') {
      await append(input.scope, current, 'adoption.rejected', {
        stepId: PROSE_GENERATION_STEP_ID_V1,
        candidateHash: input.candidate.durable.candidateHash,
        code: result.skipped[0]?.reason || 'prose_adoption_skipped',
      })
    }
    throw new Error(result.skipped[0]?.reason || '正文候选没有写入章节。')
  }
  const adoptionHash = await hashCanonicalValue({
    version: 1,
    candidateHash: input.candidate.durable.candidateHash,
    chapterId: input.candidate.chapterId,
    sourceTextHash: input.candidate.sourceTextHash,
    outputContentHash,
    wordCount: input.wordCount,
  })
  snapshot = await append(input.scope, snapshot, 'adoption.committed', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    candidateHash: input.candidate.durable.candidateHash,
    adoptionHash,
  })
  snapshot = await append(input.scope, snapshot, 'step.succeeded', {
    stepId: PROSE_GENERATION_STEP_ID_V1,
    attempt: input.candidate.durable.attempt,
    outputHash: input.candidate.durable.candidateHash,
  })
  return verifyProseGenerationRunV1({
    scope: input.scope,
    runId: input.runId,
    candidate: input.candidate,
    snapshot,
  })
}

export async function verifyProseGenerationRunV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: ProseGenerationCandidateV1
  snapshot?: AgentRunSnapshotV1
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string }> {
  let snapshot = input.snapshot ?? await readAgentRunV1(input.scope, input.runId)
  if (snapshot.projection.state === 'completed' && snapshot.run.terminalReceiptHash) {
    return { snapshot, receiptHash: snapshot.run.terminalReceiptHash }
  }
  const step = snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]
  const adoption = snapshot.events.find(event => (
    event.type === 'adoption.committed'
      && event.payload.stepId === PROSE_GENERATION_STEP_ID_V1
      && event.payload.candidateHash === input.candidate.durable.candidateHash
  ))
  const adoptionRecord = (await db.agentRunEvents.where('runId').equals(input.runId).toArray())
    .find(event => {
      if (event.type !== 'adoption.committed' || event.id == null) return false
      try {
        const payload = JSON.parse(event.payloadJson) as Record<string, unknown>
        return payload.stepId === PROSE_GENERATION_STEP_ID_V1
          && payload.candidateHash === input.candidate.durable.candidateHash
      } catch {
        return false
      }
    })
  if (!step || step.status !== 'succeeded' || !adoption || adoptionRecord?.id == null) {
    throw new Error('正文生成 durable 运行尚未满足终态验证条件。')
  }
  const chapter = await db.chapters.get(input.candidate.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('正文生成终态校验找不到来源章节。')
  }
  if (await hashChapterText(chapter.content ?? '') !== input.candidate.expectedContentHash) {
    throw new Error('正文生成终态校验发现章节正文与候选不一致。')
  }
  snapshot = await append(input.scope, snapshot, 'verification.started', {
    verifierSetVersion: PROSE_GENERATION_VERIFIER_SET_V1,
  })
  const postStateHash = await prosePostStateHash({
    scope: input.scope,
    chapterId: input.candidate.chapterId,
  })
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: input.runId,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [input.candidate.durable.contextManifestHash],
    candidateHashes: [input.candidate.durable.candidateHash],
    adoptionEventIds: [adoptionRecord.id],
    postStateHash,
    verifierSetVersion: PROSE_GENERATION_VERIFIER_SET_V1,
    criteria: [
      { id: 'prose-generation.candidate', status: 'passed', evidenceRefs: [`candidate:${input.candidate.durable.candidateHash}`] },
      { id: 'prose-generation.confirmed', status: 'passed', evidenceRefs: [`run:${input.runId}:confirmation`] },
      { id: 'prose-generation.adopted', status: 'passed', evidenceRefs: [`event:${adoptionRecord.id}`] },
      { id: 'prose-generation.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, receiptHash: receipt.receiptHash }
}
