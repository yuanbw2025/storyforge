import { db } from '../../db/schema'
import { hashChapterText } from '../../ai/chapter-memory/text-normalization'
import type { WorkspaceScope } from '../../types'
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
  type ChapterOrganizationCandidate,
  type ChapterOrganizationDurableEvidence,
  type ChapterOrganizationDomain,
} from '../chapter-organization'
import { assertRecordInScope, readOwnedRows, resolveScopeLike } from '../../workspace/scope'

export const CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1 = 'chapter-organization'
export const CHAPTER_ORGANIZATION_DURABLE_VERIFIER_SET_V1 = 'chapter-organization-terminal-v1'

/**
 * 整理本章只写候选事件和作者确认后的既有业务表；业务字段继续由
 * ChapterOrganization 的 parser/adopt 负责。这里的 contract 只声明读取边界，
 * 避免把 agentEvents 当成 AI 可写业务表。
 */
export const CHAPTER_ORGANIZATION_SOURCE_KEYS_V1 = [
  'chapterContent',
  'stateCards',
  'currentFacts',
  'characters',
  'characterRelations',
  'itemLedger',
  'foreshadows',
] as const

export interface ChapterOrganizationDurableRunV1 {
  snapshot: AgentRunSnapshotV1
  evidence: ChapterOrganizationDurableEvidence
}

export async function hashChapterOrganizationCandidateV1(
  candidate: ChapterOrganizationCandidate,
): Promise<string> {
  const { durable: _durable, ...withoutDurableEvidence } = candidate
  return hashCanonicalValue(withoutDurableEvidence)
}

/**
 * Hash the persisted business projection after adoption. Counts are useful for
 * UI summaries, but they cannot prove that the rows which were actually written
 * still match the receipt. Read through the scope/PROJECT_TABLES boundary and
 * include the complete deterministic table snapshots instead.
 */
export async function hashChapterOrganizationPostStateV1(input: {
  scope: WorkspaceScope
  chapterId: number
}): Promise<string> {
  const tableNames = [
    'stateCards',
    'temporalFacts',
    'itemLedger',
    'storyTimelineEvents',
    'characterRelations',
    'foreshadows',
  ] as const
  const entries = await Promise.all(tableNames.map(async tableName => {
    const rows = await readOwnedRows<Record<string, unknown>>(input.scope, tableName)
    return [
      tableName,
      rows
        .map(row => ({ ...row }))
        .sort((left, right) => Number(left.id ?? 0) - Number(right.id ?? 0)),
    ] as const
  }))
  return hashCanonicalValue({
    version: 1,
    chapterId: input.chapterId,
    tables: Object.fromEntries(entries),
  })
}

export function buildChapterOrganizationRunContractV1(input: {
  projectId: number
  worldGroupId: number | null
  chapterId: number
  runtimeBindingHash: string
}) {
  return {
    version: 1 as const,
    objective: `整理章节 #${input.chapterId} 的状态、事实、物品、年表、关系与伏笔候选`,
    workflowKind: 'long-running-resumable' as const,
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      chapterIds: [input.chapterId],
    },
    permissions: {
      contextSourceKeys: [...CHAPTER_ORGANIZATION_SOURCE_KEYS_V1],
      writeTargets: [
        {
          table: 'stateCards',
          fields: ['category', 'entityName', 'fields', 'lastChapterId'],
          mode: 'author-confirmed' as const,
        },
        {
          table: 'itemLedger',
          fields: ['itemName', 'action', 'quantity', 'heldByName', 'characterId', 'chapterId', 'chapterTitle', 'note'],
          mode: 'author-confirmed' as const,
        },
        {
          table: 'storyTimelineEvents',
          fields: ['title', 'storyTime', 'importance', 'description', 'chapterId', 'chapterTitle', 'order'],
          mode: 'author-confirmed' as const,
        },
        {
          table: 'characterRelations',
          fields: ['fromCharacterId', 'toCharacterId', 'relationType', 'label', 'description', 'isBidirectional'],
          mode: 'author-confirmed' as const,
        },
        {
          table: 'foreshadows',
          fields: ['status', 'plantChapterId', 'echoChapterIds', 'resolveChapterId', 'notes'],
          mode: 'author-confirmed' as const,
        },
      ],
    },
    runtimeBindingHash: input.runtimeBindingHash,
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 24_000,
      maxOutputTokens: 8_000,
      maxAttemptsPerStep: 2,
      maxProtocolErrors: 1,
    },
    acceptance: [
      { id: 'chapter-organization.candidate', kind: 'output-present' as const, required: true },
      { id: 'chapter-organization.confirmed', kind: 'author-confirmed' as const, required: true },
      { id: 'chapter-organization.adopted', kind: 'adoption-committed' as const, required: true },
      { id: 'chapter-organization.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [
      {
        id: 'chapter-organization.candidate-persistence',
        kind: 'protocol' as const,
        verifier: 'chapter-organization-candidate-v1',
        criterionIds: ['chapter-organization.candidate'],
      },
      {
        id: 'chapter-organization.adoption',
        kind: 'adoption' as const,
        verifier: 'chapter-organization-adoption-v1',
        criterionIds: ['chapter-organization.confirmed', 'chapter-organization.adopted'],
      },
      {
        id: 'chapter-organization.terminal',
        kind: 'terminal' as const,
        verifier: CHAPTER_ORGANIZATION_DURABLE_VERIFIER_SET_V1,
        criterionIds: ['chapter-organization.post-state'],
      },
    ],
    failurePolicy: {
      onProtocolError: 'retry' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

export async function createChapterOrganizationDurableRunV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  chapterId: number
}): Promise<AgentRunSnapshotV1> {
  return createAgentRunV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    contract: buildChapterOrganizationRunContractV1({
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
      chapterId: input.chapterId,
      runtimeBindingHash: await hashCanonicalValue({
        schema: 'storyforge.chapter-organization-runtime',
        version: 1,
        stepId: CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1,
        verifierSet: CHAPTER_ORGANIZATION_DURABLE_VERIFIER_SET_V1,
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

export async function beginChapterOrganizationDurableStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  contextManifest: ContextManifestV1
  binding?: unknown
}): Promise<AgentRunSnapshotV1> {
  if (input.contextManifest.runId !== input.snapshot.run.id
    || input.contextManifest.stepId !== CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1) {
    throw new Error('整理本章 Context Manifest 与 durable run 不匹配。')
  }
  let snapshot = await append(input.scope, input.snapshot, 'step.scheduled', {
    stepId: CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1,
  })
  snapshot = await append(input.scope, snapshot, 'step.started', {
    stepId: CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1,
    attempt: 1,
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1,
    attempt: 1,
    manifestHash: input.contextManifest.manifestHash,
  })
  return append(input.scope, snapshot, 'model.requested', {
    stepId: CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1,
    attempt: 1,
    bindingHash: await hashCanonicalValue({
      stepId: CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1,
      binding: input.binding ?? null,
    }),
  })
}

export async function recordChapterOrganizationCandidateV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  candidate: ChapterOrganizationCandidate
}): Promise<ChapterOrganizationDurableRunV1> {
  const durable = input.candidate.durable
  if (!durable || durable.runId !== input.snapshot.run.id) {
    throw new Error('整理本章候选缺少匹配的 durable evidence。')
  }
  const existingStep = input.snapshot.projection.steps[durable.stepId]
  if (existingStep?.candidateHash === durable.candidateHash) {
    return { snapshot: input.snapshot, evidence: durable }
  }
  if (!existingStep || existingStep.status !== 'running' || existingStep.attempt !== durable.attempt) {
    throw new Error('整理本章 durable step 不在可持久化候选的运行状态。')
  }
  const alreadyResponded = input.snapshot.events.some(event => (
    event.type === 'model.responded'
      && event.payload.stepId === durable.stepId
      && event.payload.attempt === durable.attempt
      && event.payload.outputHash === durable.candidateHash
  ))
  let snapshot = input.snapshot
  if (!alreadyResponded) {
    snapshot = await append(input.scope, snapshot, 'model.responded', {
      stepId: durable.stepId,
      attempt: durable.attempt,
      outputHash: durable.candidateHash,
    })
  }
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: durable.stepId,
    attempt: durable.attempt,
    candidateHash: durable.candidateHash,
    requiresConfirmation: true,
  })
  return { snapshot, evidence: durable }
}

/** Recover the narrow crash window after the candidate event was stored but
 * before candidate.persisted reached the durable ledger. */
export async function recoverChapterOrganizationCandidateV1(input: {
  scope: WorkspaceScope
  candidate: ChapterOrganizationCandidate
}): Promise<AgentRunSnapshotV1 | null> {
  const durable = input.candidate.durable
  if (!durable) return null
  const snapshot = await readAgentRunV1(input.scope, durable.runId)
  return (await recordChapterOrganizationCandidateV1({
    scope: input.scope,
    snapshot,
    candidate: input.candidate,
  })).snapshot
}

export async function failChapterOrganizationDurableStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  code: string
  retryable?: boolean
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1]
  if (!step || step.status !== 'running') return input.snapshot
  return append(input.scope, input.snapshot, 'step.failed', {
    stepId: CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1,
    attempt: step.attempt,
    code: input.code.slice(0, 160),
    retryable: input.retryable ?? true,
  })
}

export async function markChapterOrganizationStaleV1(input: {
  scope: WorkspaceScope
  runId: number
  reason: string
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  const step = snapshot.projection.steps[CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1]
  if (
    !step?.candidateHash
    || step.status === 'stale'
    || ['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)
  ) return snapshot
  return append(input.scope, snapshot, 'candidate.staled', {
    stepId: CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1,
    candidateHash: step.candidateHash,
    reason: input.reason.slice(0, 1_000),
  })
}

export async function commitChapterOrganizationDurableAdoptionV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: ChapterOrganizationCandidate
  written: Record<ChapterOrganizationDomain, number>
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash?: string }> {
  const durable = input.candidate.durable
  if (!durable || durable.runId !== input.runId) throw new Error('整理本章候选 durable evidence 不匹配。')
  const chapter = await db.chapters.get(input.candidate.chapterId)
  if (!chapter || !await assertRecordInScope(await resolveScopeLike(input.scope), 'chapters', chapter, { owner: 'work' })) {
    throw new Error('整理本章 durable 采纳的章节不存在或越界。')
  }
  if (await hashChapterText(chapter.content ?? '') !== input.candidate.sourceTextHash) {
    await markChapterOrganizationStaleV1({
      scope: input.scope,
      runId: input.runId,
      reason: '正文 hash 已变化；旧整理候选不可提交。',
    })
    throw new Error('章节正文已变化，这批整理候选已过期；请重新运行“整理本章”。')
  }
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const step = snapshot.projection.steps[durable.stepId]
  if (!step || !step.candidateHash || step.candidateHash !== durable.candidateHash) {
    throw new Error('整理本章 durable 候选与运行账本不一致。')
  }
  if (snapshot.projection.state === 'completed') return { snapshot }
  if (snapshot.projection.state !== 'awaiting_confirmation' && snapshot.projection.state !== 'running') {
    throw new Error(`整理本章 durable run 当前状态 ${snapshot.projection.state} 不可采纳。`)
  }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: durable.stepId,
      candidateHash: durable.candidateHash,
      decision: 'adopt',
    })
  }
  const started = snapshot.events.some(event => (
    event.type === 'adoption.started'
      && event.payload.stepId === durable.stepId
      && event.payload.candidateHash === durable.candidateHash
  ))
  if (!started) {
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: durable.stepId,
      candidateHash: durable.candidateHash,
      intentHash: await hashCanonicalValue({
        kind: 'chapter-organization-adoption',
        candidateHash: durable.candidateHash,
        chapterId: input.candidate.chapterId,
      }),
    })
  }
  const adoptionHash = await hashCanonicalValue({
    version: 1,
    candidateHash: durable.candidateHash,
    chapterId: input.candidate.chapterId,
    sourceTextHash: input.candidate.sourceTextHash,
    written: input.written,
  })
  snapshot = await append(input.scope, snapshot, 'adoption.committed', {
    stepId: durable.stepId,
    candidateHash: durable.candidateHash,
    adoptionHash,
  })
  snapshot = await append(input.scope, snapshot, 'step.succeeded', {
    stepId: durable.stepId,
    attempt: durable.attempt,
    outputHash: durable.candidateHash,
  })
  const verification = await verifyChapterOrganizationDurableRunV1({
    scope: input.scope,
    runId: input.runId,
    candidate: input.candidate,
    written: input.written,
    snapshot,
  })
  return { snapshot: verification.snapshot, receiptHash: verification.receiptHash }
}

export async function verifyChapterOrganizationDurableRunV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: ChapterOrganizationCandidate
  written: Record<ChapterOrganizationDomain, number>
  snapshot?: AgentRunSnapshotV1
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string }> {
  const durable = input.candidate.durable
  if (!durable || durable.runId !== input.runId) throw new Error('整理本章 durable evidence 不匹配。')
  let snapshot = input.snapshot ?? await readAgentRunV1(input.scope, input.runId)
  if (snapshot.projection.state === 'completed' && snapshot.run.terminalReceiptHash) {
    return { snapshot, receiptHash: snapshot.run.terminalReceiptHash }
  }
  const step = snapshot.projection.steps[durable.stepId]
  const adoption = snapshot.events.find(event => (
    event.type === 'adoption.committed'
      && event.payload.stepId === durable.stepId
      && event.payload.candidateHash === durable.candidateHash
  ))
  const adoptionRecord = (await db.agentRunEvents.where('runId').equals(input.runId).toArray())
    .find(event => {
      if (event.type !== 'adoption.committed' || event.id == null) return false
      try {
        const payload = JSON.parse(event.payloadJson) as Record<string, unknown>
        return payload.stepId === durable.stepId && payload.candidateHash === durable.candidateHash
      } catch {
        return false
      }
    })
  if (!step || step.status !== 'succeeded' || !adoption || !adoptionRecord?.id) {
    throw new Error('整理本章 durable 运行尚未满足终态验证条件。')
  }
  const chapter = await db.chapters.get(input.candidate.chapterId)
  if (!chapter || await hashChapterText(chapter.content ?? '') !== input.candidate.sourceTextHash) {
    throw new Error('整理本章 durable 终态验证发现正文已变化。')
  }
  snapshot = await append(input.scope, snapshot, 'verification.started', {
    verifierSetVersion: CHAPTER_ORGANIZATION_DURABLE_VERIFIER_SET_V1,
  })
  const postStateHash = await hashChapterOrganizationPostStateV1({
    scope: input.scope,
    chapterId: input.candidate.chapterId,
  })
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: input.runId,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [durable.contextManifestHash],
    candidateHashes: [durable.candidateHash],
    adoptionEventIds: [adoptionRecord.id],
    postStateHash,
    verifierSetVersion: CHAPTER_ORGANIZATION_DURABLE_VERIFIER_SET_V1,
    criteria: [
      { id: 'chapter-organization.candidate', status: 'passed', evidenceRefs: [`candidate:${durable.candidateHash}`] },
      { id: 'chapter-organization.confirmed', status: 'passed', evidenceRefs: [`run:${input.runId}:confirmation`] },
      { id: 'chapter-organization.adopted', status: 'passed', evidenceRefs: [`event:${adoptionRecord.id}`] },
      { id: 'chapter-organization.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, receiptHash: receipt.receiptHash }
}
