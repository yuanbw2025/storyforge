import { db } from '../../db/schema'
import type { AgentRunRecord, WorkspaceScope } from '../../types'
import { assembleContext } from '../../registry/assemble-context'
import {
  buildEditImpactGraphV1,
  type EditImpactGraphV1,
} from '../../consistency/impact-analysis'
import {
  buildImpactRemediationPlanV1,
  type ImpactRemediationPlanV1,
} from '../../consistency/impact-remediation-plan'
import { hashChapterText } from '../../ai/chapter-memory/text-normalization'
import { assertRecordInScope, readOwnedRows } from '../../workspace/scope'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import { createVerificationReceiptV1 } from './verification-receipt'
import { hashCanonicalValue } from './hash'

export const IMPACT_REVIEW_STEP_ID_V1 = 'impact-remediation:author-review' as const
export const IMPACT_REVIEW_VERIFIER_SET_V1 = 'impact-remediation-author-review-terminal-v1' as const

export type ImpactReviewDecisionV1 = 'acknowledged' | 'needs-manual-action'

export interface ImpactReviewOutputV1 {
  planHash: string
  graphHash: string
  sourceTextHash: string
  itemId: string
  decision: ImpactReviewDecisionV1
  note: string
}

export interface ImpactAuthorReviewRecordV1 {
  runId: number
  receiptHash: string
  recordedAt: number
  output: ImpactReviewOutputV1
}

function reviewObjective(input: {
  planHash: string
  itemId: string
  decision: ImpactReviewDecisionV1
}): string {
  return `作者复核影响项 ${input.itemId}（计划 ${input.planHash}，决定 ${input.decision}）`
}

function reviewContract(input: {
  projectId: number
  worldGroupId: number | null
  chapterId: number
  planHash: string
  itemId: string
  decision: ImpactReviewDecisionV1
  runtimeBindingHash: string
}) {
  return {
    version: 1 as const,
    objective: reviewObjective(input),
    workflowKind: 'plan-execute' as const,
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      chapterIds: [input.chapterId],
    },
    permissions: {
      contextSourceKeys: ['chapterContent'],
      writeTargets: [],
    },
    runtimeBindingHash: input.runtimeBindingHash,
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 1,
      maxOutputTokens: 1,
      maxAttemptsPerStep: 1,
      maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'impact-review.decision', kind: 'author-confirmed' as const, required: true },
      { id: 'impact-review.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'impact-review.terminal',
      kind: 'terminal' as const,
      verifier: IMPACT_REVIEW_VERIFIER_SET_V1,
      criterionIds: ['impact-review.decision', 'impact-review.post-state'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
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

async function assertCurrentPlan(
  scope: WorkspaceScope,
  plan: ImpactRemediationPlanV1,
): Promise<{ graphHash: string; sourceTextHash: string }> {
  const graph = await buildEditImpactGraphV1(scope, plan.source.recordId)
  const current = await buildImpactRemediationPlanV1(graph)
  if (
    current.planHash !== plan.planHash
    || current.graphHash !== plan.graphHash
    || current.source.sourceTextHash !== plan.source.sourceTextHash
  ) throw new Error('影响复核计划已过期，正文、影响图或计划 hash 已变化。')
  return { graphHash: graph.graphHash, sourceTextHash: graph.source.sourceTextHash }
}

async function postStateHash(input: {
  planHash: string
  graphHash: string
  sourceTextHash: string
  itemId: string
  decision: ImpactReviewDecisionV1
  note: string
}): Promise<string> {
  return hashCanonicalValue({ version: 1, ...input })
}

async function readExistingCompletedRun(
  scope: WorkspaceScope,
  plan: ImpactRemediationPlanV1,
  itemId: string,
  decision: ImpactReviewDecisionV1,
): Promise<AgentRunSnapshotV1 | null> {
  const rows = await readOwnedRows<AgentRunRecord>(scope, 'agentRuns', { owner: 'work' })
  const objective = reviewObjective({ planHash: plan.planHash, itemId, decision })
  for (const row of rows.sort((left, right) => (right.id ?? 0) - (left.id ?? 0))) {
    if (!row.id || row.status !== 'completed' || !row.contractJson) continue
    try {
      if ((JSON.parse(row.contractJson) as Record<string, unknown>).objective !== objective) continue
      return await readAgentRunV1(scope, row.id)
    } catch {
      // Ignore malformed historical runs; they are not completion evidence.
    }
  }
  return null
}

function readRecordedReviewOutput(
  snapshot: AgentRunSnapshotV1,
  plan: ImpactRemediationPlanV1,
): ImpactReviewOutputV1 | null {
  const event = [...snapshot.events].reverse().find(candidate => (
    candidate.type === 'confirmation.recorded'
    && candidate.payload.reviewItemId !== undefined
    && candidate.payload.reviewDecision !== undefined
    && candidate.payload.note !== undefined
  ))
  if (!event || event.type !== 'confirmation.recorded') return null
  return {
    planHash: plan.planHash,
    graphHash: plan.graphHash,
    sourceTextHash: plan.source.sourceTextHash,
    itemId: event.payload.reviewItemId!,
    decision: event.payload.reviewDecision!,
    note: event.payload.note!,
  }
}

export async function readVerifiedImpactAuthorReviewRecordV1(
  scope: WorkspaceScope,
  plan: ImpactRemediationPlanV1,
  row: AgentRunRecord,
): Promise<ImpactAuthorReviewRecordV1 | null> {
  if (!row.id || row.status !== 'completed' || !row.contractJson) return null
  const snapshot = await readAgentRunV1(scope, row.id)
  if (snapshot.projection.state !== 'completed' || !snapshot.projection.terminalReceiptHash) return null
  const output = readRecordedReviewOutput(snapshot, plan)
  if (!output || !plan.items.some(item => item.id === output.itemId && item.mode === 'author-confirmed')) return null
  if (snapshot.contract.objective !== reviewObjective({
    planHash: plan.planHash,
    itemId: output.itemId,
    decision: output.decision,
  })) return null
  if (
    snapshot.contract.workflowKind !== 'plan-execute'
    || snapshot.contract.scope.projectId !== scope.projectId
    || snapshot.contract.scope.chapterIds?.length !== 1
    || snapshot.contract.scope.chapterIds[0] !== plan.source.recordId
  ) return null
  const confirmation = [...snapshot.events].reverse().find(event => (
    event.type === 'confirmation.recorded'
    && event.payload.reviewItemId === output.itemId
    && event.payload.reviewDecision === output.decision
    && event.payload.note === output.note
  ))
  const receipt = [...snapshot.events].reverse().find(event => event.type === 'verification.accepted')
  if (!confirmation || confirmation.type !== 'confirmation.recorded' || !receipt || receipt.type !== 'verification.accepted') return null
  const outputHash = await hashCanonicalValue(output)
  const step = snapshot.projection.steps[IMPACT_REVIEW_STEP_ID_V1]
  if (
    confirmation.payload.candidateHash !== outputHash
    || step?.candidateHash !== outputHash
    || step.outputHash !== outputHash
    || receipt.payload.receiptHash !== snapshot.projection.terminalReceiptHash
  ) return null
  return {
    runId: snapshot.run.id,
    receiptHash: receipt.payload.receiptHash,
    recordedAt: receipt.createdAt,
    output,
  }
}

/**
 * Replay review receipts against the exact historical plan evidence supplied
 * by a trusted downstream Run. Unlike readImpactAuthorReviewsV1 this helper
 * deliberately does not require that plan to still be current: a legitimate
 * manual edit is expected to make the old impact graph stale before its
 * completion proof can be signed.
 */
export async function readFrozenImpactAuthorReviewsV1(input: {
  scope: WorkspaceScope
  plan: ImpactRemediationPlanV1
}): Promise<ImpactAuthorReviewRecordV1[]> {
  const itemOrder = new Map(input.plan.items.map((item, index) => [item.id, index]))
  const latest = new Map<string, ImpactAuthorReviewRecordV1>()
  const rows = await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' })
  for (const row of rows.sort((left, right) => (left.id ?? 0) - (right.id ?? 0))) {
    try {
      const record = await readVerifiedImpactAuthorReviewRecordV1(input.scope, input.plan, row)
      const previous = record ? latest.get(record.output.itemId) : undefined
      if (record && (!previous || record.recordedAt >= previous.recordedAt)) {
        latest.set(record.output.itemId, record)
      }
    } catch {
      // Damaged or unrelated runs remain auditable but are not review evidence.
    }
  }
  return [...latest.values()].sort((left, right) => (
    (itemOrder.get(left.output.itemId) ?? Number.MAX_SAFE_INTEGER)
    - (itemOrder.get(right.output.itemId) ?? Number.MAX_SAFE_INTEGER)
  ))
}

/** Replay the latest valid author review for each item in a current impact plan. */
export async function readImpactAuthorReviewsV1(input: {
  scope: WorkspaceScope
  plan: ImpactRemediationPlanV1
}): Promise<ImpactAuthorReviewRecordV1[]> {
  if (input.plan.source.table !== 'chapters' || input.plan.source.recordId == null) {
    throw new Error('影响复核计划来源章节无效。')
  }
  await assertCurrentPlan(input.scope, input.plan)
  const reviews = await readFrozenImpactAuthorReviewsV1(input)
  if (reviews.length === 0) return reviews
  const rows = await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' })
  const consumedReviewRunIds = new Set(rows
    .filter(row => (
      row.parentRunId != null
      && row.parentRelation?.startsWith('impact-correction:')
      && row.status === 'completed'
      && row.terminalReceiptHash != null
    ))
    .map(row => row.parentRunId!))
  return reviews.filter(review => !consumedReviewRunIds.has(review.runId))
}

/**
 * Rebuild the current graph/plan and recover author review receipts after an
 * editor remount. Historical plans are never revived: only receipts that
 * validate against the freshly rebuilt plan are returned.
 */
export async function readCurrentImpactAuthorReviewStateV1(input: {
  scope: WorkspaceScope
  chapterId: number
}): Promise<{
  graph: EditImpactGraphV1
  plan: ImpactRemediationPlanV1
  reviews: ImpactAuthorReviewRecordV1[]
} | null> {
  if (!Number.isInteger(input.chapterId) || input.chapterId < 1) {
    throw new Error('影响复核恢复的来源章节无效。')
  }
  const chapter = await db.chapters.get(input.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('影响复核恢复的来源章节不存在或越界。')
  }
  const graph = await buildEditImpactGraphV1(input.scope, input.chapterId)
  const plan = await buildImpactRemediationPlanV1(graph)
  const reviews = await readImpactAuthorReviewsV1({ scope: input.scope, plan })
  return reviews.length > 0 ? { graph, plan, reviews } : null
}

/** Record an author-confirmed impact item without mutating any Canon table. */
export async function executeImpactAuthorReviewV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  plan: ImpactRemediationPlanV1
  itemId: string
  decision: ImpactReviewDecisionV1
  note: string
}): Promise<{
  snapshot: AgentRunSnapshotV1
  receiptHash: string
  output: ImpactReviewOutputV1
  reused: boolean
}> {
  const item = input.plan.items.find(candidate => candidate.id === input.itemId)
  if (!item || item.mode !== 'author-confirmed') throw new Error('只能复核影响计划中的作者确认项。')
  const note = input.note.trim()
  if (note.length < 2 || note.length > 2_000) throw new Error('作者复核理由需要 2-2000 个字符。')
  if (input.plan.source.table !== 'chapters' || input.plan.source.recordId == null) {
    throw new Error('影响复核计划来源章节无效。')
  }
  const chapter = await db.chapters.get(input.plan.source.recordId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('影响复核计划来源章节不存在或越界。')
  }
  if (await hashChapterText(chapter.content ?? '') !== input.plan.source.sourceTextHash) {
    throw new Error('影响复核计划已过期，来源正文 hash 已变化。')
  }
  const current = await assertCurrentPlan(input.scope, input.plan)
  const existing = await readExistingCompletedRun(input.scope, input.plan, input.itemId, input.decision)
  if (existing?.projection.terminalReceiptHash) {
    const receiptEvent = [...existing.events].reverse().find(event => event.type === 'verification.accepted')
    const recordedOutput = readRecordedReviewOutput(existing, input.plan)
    if (receiptEvent?.payload.receiptHash && recordedOutput) {
      return {
        snapshot: existing,
        receiptHash: receiptEvent.payload.receiptHash,
        output: recordedOutput,
        reused: true,
      }
    }
  }
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    contract: reviewContract({
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
      chapterId: input.plan.source.recordId,
      planHash: input.plan.planHash,
      itemId: input.itemId,
      decision: input.decision,
      runtimeBindingHash: await hashCanonicalValue({
        schema: 'storyforge.impact-author-review-runtime',
        version: 1,
        stepId: IMPACT_REVIEW_STEP_ID_V1,
        verifierSet: IMPACT_REVIEW_VERIFIER_SET_V1,
      }),
    }),
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: IMPACT_REVIEW_STEP_ID_V1 })
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    chapterId: input.plan.source.recordId,
    sourceKeys: ['chapterContent'],
    inputBudgetMaxTokens: 8_000,
  })
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: IMPACT_REVIEW_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: ['chapterContent'],
    assembled,
    readerVersion: 'impact-author-review-context-v1',
  })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: IMPACT_REVIEW_STEP_ID_V1, attempt: 1 })
  snapshot = await append(input.scope, snapshot, 'context.assembled', { stepId: IMPACT_REVIEW_STEP_ID_V1, attempt: 1, manifestHash: manifest.manifestHash })
  const output: ImpactReviewOutputV1 = {
    planHash: input.plan.planHash,
    graphHash: current.graphHash,
    sourceTextHash: current.sourceTextHash,
    itemId: input.itemId,
    decision: input.decision,
    note,
  }
  const outputHash = await hashCanonicalValue(output)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: IMPACT_REVIEW_STEP_ID_V1,
    attempt: 1,
    candidateHash: outputHash,
    requiresConfirmation: true,
  })
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: IMPACT_REVIEW_STEP_ID_V1,
    candidateHash: outputHash,
    decision: 'adopt',
    reviewItemId: input.itemId,
    reviewDecision: input.decision,
    note,
  })
  snapshot = await append(input.scope, snapshot, 'step.succeeded', { stepId: IMPACT_REVIEW_STEP_ID_V1, attempt: 1, outputHash })
  snapshot = await append(input.scope, snapshot, 'verification.started', { verifierSetVersion: IMPACT_REVIEW_VERIFIER_SET_V1 })
  const postState = await postStateHash(output)
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [manifest.manifestHash],
    candidateHashes: [outputHash],
    adoptionEventIds: [],
    postStateHash: postState,
    verifierSetVersion: IMPACT_REVIEW_VERIFIER_SET_V1,
    criteria: [
      { id: 'impact-review.decision', status: 'passed', evidenceRefs: [`item:${input.itemId}`, `decision:${input.decision}`, `output:${outputHash}`] },
      { id: 'impact-review.post-state', status: 'passed', evidenceRefs: [`post-state:${postState}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, receiptHash: receipt.receiptHash, output, reused: false }
}
