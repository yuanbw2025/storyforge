import { db } from '../../db/schema'
import type {
  AgentRunContractV1,
  AgentRunEventTypeV1,
  AgentRunRecord,
  ChatMessage,
  WorkspaceScope,
} from '../../types'
import { hashChapterText, normalizeChapterText } from '../../ai/chapter-memory/text-normalization'
import { assertRecordInScope, readOwnedRows } from '../../world-engine/scope'
import {
  CONSISTENCY_AGENT_DEEP_SOURCES_V1,
  CONSISTENCY_AGENT_FAST_SOURCES_V1,
  CONSISTENCY_AGENT_INPUT_BUDGET_V1,
  CONSISTENCY_AGENT_OUTPUT_BUDGET_V1,
  hashConsistencyAgentCandidateV1,
  isConsistencyAgentCandidateV1,
  persistConsistencyAgentCandidate,
  runConsistencyAgent,
  type ConsistencyAgentCandidate,
  type ConsistencyAgentMode,
  type ConsistencyAgentRun,
} from '../consistency-agent'
import { AgentTeamBudgetTracker } from '../team-budget'
import {
  beginAgentRunRecoveryV1,
  completeAgentRunRecoveryV1,
  createAgentRunCheckpointV1,
  readLatestVerifiedAgentRunCheckpointV1,
} from './checkpoint'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  staleAgentRunVerificationV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { hashCanonicalValue } from './hash'
import { createVerificationReceiptV1 } from './verification-receipt'

export const CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1 = 'chapter:consistency-audit' as const
export const CONSISTENCY_AUDIT_VERIFIER_SET_V1 = 'chapter-consistency-audit-terminal-v1' as const
export const CONSISTENCY_AUDIT_ADAPTER_VERSION_V1 = 'chapter-consistency-audit-durable-v1' as const

const ACTIVE_STATES = new Set(['planned', 'running', 'paused', 'awaiting_confirmation', 'verifying'])
const AUDIT_IN_FLIGHT = new Map<string, Promise<DurableConsistencyAuditResultV1>>()

export type ConsistencyAuditDurableBoundaryV1 =
  | 'context.assembled'
  | 'model.requested'
  | 'model.responded'
  | 'candidate.checkpoint'
  | 'candidate.persisted'
  | 'compatibility.persisted'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

export interface DurableConsistencyAuditResultV1 {
  snapshot: AgentRunSnapshotV1
  run: ConsistencyAgentRun
  candidate: ConsistencyAgentCandidate
  reusedCheckpoint: boolean
}

export interface RunDurableConsistencyAuditInputV1 {
  scope: WorkspaceScope
  chapterId: number
  chapterTitle: string
  worldGroupId: number | null
  outlineNodeId?: number | null
  chapterContent: string
  mode: ExplicitConsistencyModeV1
  provider?: string
  model?: string
  budget: AgentTeamBudgetTracker
  call: (messages: ChatMessage[]) => Promise<string>
  onDurableBoundary?: (boundary: ConsistencyAuditDurableBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}

type ExplicitConsistencyModeV1 = Exclude<ConsistencyAgentMode, 'background'>

function sourceKeys(mode: ExplicitConsistencyModeV1): readonly string[] {
  return mode === 'fast' ? CONSISTENCY_AGENT_FAST_SOURCES_V1 : CONSISTENCY_AGENT_DEEP_SOURCES_V1
}

function auditObjective(input: {
  chapterId: number
  mode: ExplicitConsistencyModeV1
  sourceTextHash: string
}): string {
  return `章节 #${input.chapterId} ${input.mode} 一致性审计（正文 ${input.sourceTextHash}）`
}

export function buildConsistencyAuditRunContractV1(input: {
  projectId: number
  worldGroupId: number | null
  chapterId: number
  outlineNodeId?: number | null
  mode: ExplicitConsistencyModeV1
  sourceTextHash: string
  runtimeBindingHash: string
}): AgentRunContractV1 {
  const keys = [...sourceKeys(input.mode)]
  return {
    version: 1,
    objective: auditObjective(input),
    workflowKind: 'read-only-audit',
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      chapterIds: [input.chapterId],
      ...(input.outlineNodeId == null ? {} : { outlineNodeIds: [input.outlineNodeId] }),
    },
    permissions: {
      contextSourceKeys: keys,
      writeTargets: [],
    },
    runtimeBindingHash: input.runtimeBindingHash,
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: CONSISTENCY_AGENT_INPUT_BUDGET_V1[input.mode],
      maxOutputTokens: CONSISTENCY_AGENT_OUTPUT_BUDGET_V1[input.mode],
      maxAttemptsPerStep: 1,
      maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'consistency-audit.output', kind: 'output-present', required: true },
      { id: 'consistency-audit.freshness', kind: 'deterministic-check', required: true },
    ],
    verificationPlan: [{
      id: 'consistency-audit.terminal',
      kind: 'terminal',
      verifier: CONSISTENCY_AUDIT_VERIFIER_SET_V1,
      criterionIds: ['consistency-audit.output', 'consistency-audit.freshness'],
    }],
    failurePolicy: {
      onProtocolError: 'fail',
      onVerificationFailure: 'fail',
      onStaleInput: 'pause-for-author',
    },
  }
}

async function append<T extends AgentRunEventTypeV1>(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: T,
  payload: Parameters<typeof appendAgentRunEventV1<T>>[0]['payload'],
): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({
    scope,
    runId: snapshot.run.id,
    type,
    payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  })
}

async function notify(
  callback: ((boundary: ConsistencyAuditDurableBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>) | undefined,
  boundary: ConsistencyAuditDurableBoundaryV1,
  snapshot: AgentRunSnapshotV1,
): Promise<void> {
  await callback?.(boundary, snapshot)
}

function isMatchingRun(row: AgentRunRecord, objective: string): boolean {
  if (!row.contractJson || !ACTIVE_STATES.has(row.status)) return false
  try {
    const contract = JSON.parse(row.contractJson) as AgentRunContractV1
    return contract.workflowKind === 'read-only-audit'
      && contract.objective === objective
      && contract.verificationPlan.some(step => step.verifier === CONSISTENCY_AUDIT_VERIFIER_SET_V1)
  } catch {
    return false
  }
}

async function assertCandidateFresh(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  candidate: ConsistencyAgentCandidate
}): Promise<void> {
  const chapter = await db.chapters.get(input.candidate.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('一致性审计候选章节不存在或越过当前 Work。')
  }
  if (await hashChapterText(chapter.content ?? '') !== input.candidate.sourceTextHash) {
    throw new Error('一致性审计候选已过期，正文内容发生变化。')
  }
  const durable = input.candidate.durable
  if (!durable
    || durable.runId !== input.snapshot.run.id
    || durable.stepId !== CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1
    || durable.attempt !== 1
    || durable.candidateHash !== await hashConsistencyAgentCandidateV1(input.candidate)) {
    throw new Error('一致性审计候选与 durable Run 证据不匹配。')
  }
  const contextEvent = input.snapshot.events.find(event => (
    event.type === 'context.assembled'
    && event.payload.stepId === CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1
    && event.payload.manifestHash === durable.contextManifestHash
  ))
  if (!contextEvent) throw new Error('一致性审计候选缺少匹配的 ContextManifest。')
}

async function resumeFromCheckpoint(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
): Promise<AgentRunSnapshotV1> {
  if (snapshot.projection.state !== 'paused') return snapshot
  const started = await beginAgentRunRecoveryV1({
    scope,
    runId: snapshot.run.id,
    expectedLastSequence: snapshot.projection.lastSequence,
  })
  return completeAgentRunRecoveryV1({
    scope,
    runId: snapshot.run.id,
    checkpointHash: started.checkpointHash,
    expectedLastSequence: started.snapshot.projection.lastSequence,
  })
}

async function finalizeCandidate(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  candidate: ConsistencyAgentCandidate
  onDurableBoundary?: (boundary: ConsistencyAuditDurableBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<DurableConsistencyAuditResultV1> {
  let snapshot = await resumeFromCheckpoint(input.scope, input.snapshot)
  await assertCandidateFresh({ scope: input.scope, snapshot, candidate: input.candidate })
  const durable = input.candidate.durable!
  let step = snapshot.projection.steps[CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1]
  if (!step?.candidateHash) {
    snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
      stepId: CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1,
      attempt: 1,
      candidateHash: durable.candidateHash,
      requiresConfirmation: false,
    })
    await notify(input.onDurableBoundary, 'candidate.persisted', snapshot)
    step = snapshot.projection.steps[CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1]
  }
  if (step?.candidateHash !== durable.candidateHash) {
    throw new Error('一致性审计 Run 已存在不同候选，拒绝覆盖。')
  }
  const run = await persistConsistencyAgentCandidate(input.candidate)
  await notify(input.onDurableBoundary, 'compatibility.persisted', snapshot)
  if (step.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1,
      attempt: 1,
      outputHash: durable.candidateHash,
    })
    await notify(input.onDurableBoundary, 'step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: CONSISTENCY_AUDIT_VERIFIER_SET_V1,
    })
    await notify(input.onDurableBoundary, 'verification.started', snapshot)
  }
  if (snapshot.projection.state === 'verifying') {
    const postStateHash = await hashCanonicalValue({
      version: 1,
      chapterId: input.candidate.chapterId,
      mode: input.candidate.mode,
      sourceTextHash: input.candidate.sourceTextHash,
      candidateHash: durable.candidateHash,
    })
    const receipt = await createVerificationReceiptV1({
      version: 1,
      runId: snapshot.run.id,
      generation: snapshot.projection.generation,
      contractHash: snapshot.projection.contractHash,
      contextManifestHashes: [durable.contextManifestHash],
      candidateHashes: [durable.candidateHash],
      adoptionEventIds: [],
      postStateHash,
      verifierSetVersion: CONSISTENCY_AUDIT_VERIFIER_SET_V1,
      criteria: [
        {
          id: 'consistency-audit.output',
          status: 'passed',
          evidenceRefs: [`candidate:${durable.candidateHash}`],
        },
        {
          id: 'consistency-audit.freshness',
          status: 'passed',
          evidenceRefs: [`chapter:${input.candidate.chapterId}`, `source:${input.candidate.sourceTextHash}`],
        },
      ],
      acceptedAt: Date.now(),
    })
    snapshot = await append(input.scope, snapshot, 'verification.accepted', {
      receiptHash: receipt.receiptHash,
    })
    await notify(input.onDurableBoundary, 'verification.accepted', snapshot)
  }
  if (snapshot.projection.state !== 'completed'
    || snapshot.projection.memorySettlement?.state !== 'settled') {
    throw new Error('一致性审计未形成完整终态与记忆结算。')
  }
  return { snapshot, run, candidate: input.candidate, reusedCheckpoint: true }
}

async function matchingActiveRun(input: {
  scope: WorkspaceScope
  objective: string
}): Promise<AgentRunSnapshotV1 | null> {
  const rows = await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' })
  const row = rows
    .filter(candidate => isMatchingRun(candidate, input.objective))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))[0]
  return row?.id ? readAgentRunV1(input.scope, row.id) : null
}

async function recoverCandidate(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
): Promise<ConsistencyAgentCandidate | null> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, snapshot.run.id)
  const value = checkpoint?.resumePayload
  return isConsistencyAgentCandidateV1(value) && value.durable?.runId === snapshot.run.id ? value : null
}

/**
 * One explicit author click creates at most one model call and one durable
 * audit Run. A checkpointed report is finalized without another call; an
 * unresolved unknown model outcome is cancelled before a new explicit run.
 */
async function executeDurableConsistencyAuditV1(
  input: RunDurableConsistencyAuditInputV1,
): Promise<DurableConsistencyAuditResultV1> {
  const chapter = await db.chapters.get(input.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('一致性审计章节不存在或越过当前 Work。')
  }
  const sourceTextHash = await hashChapterText(normalizeChapterText(input.chapterContent))
  if (await hashChapterText(chapter.content ?? '') !== sourceTextHash) {
    throw new Error('编辑器正文尚未稳定保存，不能创建一致性审计 Run。')
  }
  const runtimeBindingHash = await hashCanonicalValue({
    version: 1,
    adapterVersion: CONSISTENCY_AUDIT_ADAPTER_VERSION_V1,
    provider: input.provider?.trim() || 'unknown-provider',
    model: input.model?.trim() || 'unknown-model',
    mode: input.mode,
  })
  const contract = buildConsistencyAuditRunContractV1({
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    chapterId: input.chapterId,
    outlineNodeId: input.outlineNodeId,
    mode: input.mode,
    sourceTextHash,
    runtimeBindingHash,
  })
  const existing = await matchingActiveRun({ scope: input.scope, objective: contract.objective })
  if (existing) {
    const checkpointed = await recoverCandidate(input.scope, existing)
    if (checkpointed) {
      return finalizeCandidate({
        scope: input.scope,
        snapshot: existing,
        candidate: checkpointed,
        onDurableBoundary: input.onDurableBoundary,
      })
    }
    await append(input.scope, existing, 'run.cancelled', {
      reason: 'author-explicitly-restarted-consistency-audit-without-checkpoint',
    })
  }

  let snapshot = await createAgentRunV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    contract,
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', {
    stepId: CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1,
  })
  snapshot = await append(input.scope, snapshot, 'step.started', {
    stepId: CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1,
    attempt: 1,
  })
  snapshot = await append(input.scope, snapshot, 'budget.reserved', {
    stepId: CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1,
    modelCalls: 1,
    toolCalls: 0,
    tokens: contract.budget.maxInputTokens + contract.budget.maxOutputTokens,
  })
  let manifestHash = ''
  let modelRequested = false
  let modelResponded = false
  let candidate: ConsistencyAgentCandidate
  try {
    candidate = await runConsistencyAgent({
      projectId: input.scope.projectId,
      chapterId: input.chapterId,
      chapterTitle: input.chapterTitle,
      worldGroupId: input.worldGroupId,
      outlineNodeId: input.outlineNodeId,
      chapterContent: input.chapterContent,
      mode: input.mode,
      provider: input.provider as Parameters<typeof runConsistencyAgent>[0]['provider'],
      model: input.model,
      budget: input.budget,
      call: input.call,
      trace: {
        contextAssembled: async ({ assembled }) => {
          const manifest = await createContextManifestFromAssemblyV1({
            runId: snapshot.run.id,
            stepId: CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1,
            attempt: 1,
            projectId: input.scope.projectId,
            worldGroupId: input.worldGroupId,
            declaredSourceKeys: [...sourceKeys(input.mode)],
            assembled,
            readerVersion: CONSISTENCY_AUDIT_ADAPTER_VERSION_V1,
          })
          manifestHash = manifest.manifestHash
          snapshot = await append(input.scope, snapshot, 'context.assembled', {
            stepId: CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1,
            attempt: 1,
            manifestHash,
          })
          await notify(input.onDurableBoundary, 'context.assembled', snapshot)
        },
        modelRequested: async ({ messages }) => {
          snapshot = await append(input.scope, snapshot, 'model.requested', {
            stepId: CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1,
            attempt: 1,
            bindingHash: await hashCanonicalValue({ runtimeBindingHash, messages }),
          })
          modelRequested = true
          await notify(input.onDurableBoundary, 'model.requested', snapshot)
        },
        modelResponded: async ({ raw }) => {
          snapshot = await append(input.scope, snapshot, 'model.responded', {
            stepId: CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1,
            attempt: 1,
            outputHash: await hashCanonicalValue({ raw }),
          })
          modelResponded = true
          await notify(input.onDurableBoundary, 'model.responded', snapshot)
        },
      },
    })
  } catch (error) {
    const used = input.budget.snapshot()
    if (snapshot.projection.state === 'running') {
      snapshot = await append(input.scope, snapshot, 'budget.settled', {
        stepId: CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1,
        modelCalls: used.calls,
        toolCalls: 0,
        tokens: used.usedTokens,
      })
    }
    if (snapshot.projection.state === 'running' && modelRequested && !modelResponded) {
      await append(input.scope, snapshot, 'run.paused', {
        reason: 'consistency-audit-model-outcome-unknown',
        recoverable: false,
      })
    } else if (snapshot.projection.state === 'running') {
      snapshot = await append(input.scope, snapshot, 'step.failed', {
        stepId: CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1,
        attempt: 1,
        code: modelResponded ? 'consistency-audit-protocol-failed' : 'consistency-audit-preflight-failed',
        retryable: false,
        category: modelResponded ? 'protocol' : 'deterministic',
        action: 'fail',
      })
      await append(input.scope, snapshot, 'run.failed', {
        code: modelResponded ? 'consistency-audit-protocol-failed' : 'consistency-audit-preflight-failed',
        retryable: false,
      })
    }
    throw error
  }
  if (!manifestHash) throw new Error('一致性审计没有生成 ContextManifest。')
  const used = input.budget.snapshot()
  snapshot = await append(input.scope, snapshot, 'budget.settled', {
    stepId: CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1,
    modelCalls: used.calls,
    toolCalls: 0,
    tokens: used.usedTokens,
  })
  const candidateHash = await hashConsistencyAgentCandidateV1(candidate)
  const durableCandidate: ConsistencyAgentCandidate = {
    ...candidate,
    durable: {
      runId: snapshot.run.id,
      stepId: CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1,
      attempt: 1,
      contextManifestHash: manifestHash,
      candidateHash,
    },
  }
  const checkpoint = await createAgentRunCheckpointV1({
    scope: input.scope,
    runId: snapshot.run.id,
    resumePayload: durableCandidate,
    expectedLastSequence: snapshot.projection.lastSequence,
  })
  snapshot = checkpoint.snapshot
  await notify(input.onDurableBoundary, 'candidate.checkpoint', snapshot)
  const finalized = await finalizeCandidate({
    scope: input.scope,
    snapshot,
    candidate: durableCandidate,
    onDurableBoundary: input.onDurableBoundary,
  })
  return { ...finalized, reusedCheckpoint: false }
}

/** Same-tab single-flight guard for one chapter/mode/source. The event ledger's
 * unique run sequences remain the authority after a Run has been allocated. */
export async function runDurableConsistencyAuditV1(
  input: RunDurableConsistencyAuditInputV1,
): Promise<DurableConsistencyAuditResultV1> {
  const sourceTextHash = await hashChapterText(input.chapterContent)
  const key = [
    input.scope.projectId,
    input.scope.workId,
    input.chapterId,
    input.mode,
    sourceTextHash,
  ].join(':')
  const existing = AUDIT_IN_FLIGHT.get(key)
  if (existing) return existing
  const pending = executeDurableConsistencyAuditV1(input)
  AUDIT_IN_FLIGHT.set(key, pending)
  return pending.finally(() => {
    if (AUDIT_IN_FLIGHT.get(key) === pending) AUDIT_IN_FLIGHT.delete(key)
  })
}

/** Mark a completed explicit audit stale when its chapter source changed.
 * Background/post-adoption reports keep their own lifecycle authorities. */
export async function refreshDurableConsistencyAuditFreshnessV1(input: {
  scope: WorkspaceScope
  candidate: ConsistencyAgentCandidate
}): Promise<{ current: boolean; snapshot: AgentRunSnapshotV1 | null }> {
  const durable = input.candidate.durable
  if (!durable || durable.stepId !== CONSISTENCY_AUDIT_DURABLE_STEP_ID_V1) {
    const chapter = await db.chapters.get(input.candidate.chapterId)
    return {
      current: Boolean(
        chapter
        && await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })
        && await hashChapterText(chapter.content ?? '') === input.candidate.sourceTextHash
      ),
      snapshot: null,
    }
  }
  const snapshot = await readAgentRunV1(input.scope, durable.runId)
  const chapter = await db.chapters.get(input.candidate.chapterId)
  const current = Boolean(
    chapter
    && await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })
    && await hashChapterText(chapter.content ?? '') === input.candidate.sourceTextHash
  )
  if (current || snapshot.projection.state !== 'completed') return { current, snapshot }
  return {
    current: false,
    snapshot: await staleAgentRunVerificationV1({
      scope: input.scope,
      runId: snapshot.run.id,
      reason: `chapter-source-changed:${input.candidate.sourceTextHash}`,
    }),
  }
}
