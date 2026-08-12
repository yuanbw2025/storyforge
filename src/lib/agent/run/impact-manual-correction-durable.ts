import { db } from '../../db/schema'
import type { WorkspaceScope } from '../../types'
import { assembleContext } from '../../registry/assemble-context'
import type { ImpactHandoffV2 } from '../../consistency/impact-handoff'
import type { ImpactRemediationPlanV1 } from '../../consistency/impact-remediation-plan'
import { hashChapterText } from '../../ai/chapter-memory/text-normalization'
import { assertRecordInScope, getTableSpec } from '../../world-engine/scope'
import {
  resolveCurrentImpactHandoffTargetV2,
  validateCurrentImpactHandoffV2,
  type CurrentImpactHandoffTargetV2,
} from './impact-handoff-durable'
import { readFrozenImpactAuthorReviewsV1 } from './impact-review-durable'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunChildV1,
  readAgentRunV1,
  staleAgentRunVerificationV1,
  type AgentRunSnapshotV1,
} from './event-store'
import {
  beginAgentRunRecoveryV1,
  completeAgentRunRecoveryV1,
  createAgentRunCheckpointV1,
  readLatestVerifiedAgentRunCheckpointV1,
} from './checkpoint'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import { createVerificationReceiptV1 } from './verification-receipt'
import { hashCanonicalValue } from './hash'

export const IMPACT_MANUAL_CORRECTION_STEP_ID_V1 = 'impact-remediation:manual-correction' as const
export const IMPACT_MANUAL_CORRECTION_VERIFIER_SET_V1 = 'impact-manual-correction-terminal-v1' as const

interface ImpactManualCorrectionBaselineV1 {
  version: 1
  kind: 'impact-manual-correction-baseline'
  portable: false
  projectId: number
  handoff: ImpactHandoffV2
  plan: ImpactRemediationPlanV1
  target: CurrentImpactHandoffTargetV2
  targetPreStateHash: string
  contextManifestHash: string
}

export interface ImpactManualCorrectionStateV1 {
  snapshot: AgentRunSnapshotV1
  baseline: ImpactManualCorrectionBaselineV1
  reused: boolean
}

export interface ImpactManualCorrectionCompletionV1 {
  snapshot: AgentRunSnapshotV1
  receiptHash: string
  targetPreStateHash: string
  targetPostStateHash: string
  reused: boolean
}

async function childRelation(handoff: ImpactHandoffV2): Promise<string> {
  return `impact-correction:${await hashCanonicalValue({
    version: 1,
    itemId: handoff.itemId,
    planHash: handoff.planHash,
    targetTable: handoff.table,
    targetRecordId: handoff.recordId,
  })}`
}

function contract(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  handoff: ImpactHandoffV2
  reviewRunId: number
  reviewReceiptHash: string
  relation: string
}) {
  return {
    version: 1 as const,
    objective: `证明人工修正 ${input.handoff.itemId}`,
    workflowKind: 'long-running-resumable' as const,
    lineage: {
      parent: {
        runId: input.reviewRunId,
        receiptHash: input.reviewReceiptHash,
        relation: input.relation,
        artifactHash: input.handoff.planHash,
      },
    },
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
      chapterIds: [input.handoff.sourceChapterId],
      ...(input.handoff.sourceOutlineNodeId == null
        ? {}
        : { outlineNodeIds: [input.handoff.sourceOutlineNodeId] }),
    },
    permissions: {
      contextSourceKeys: ['chapterContent'],
      writeTargets: [],
    },
    budget: {
      // RunContract V1 currently requires a positive model ceiling even for a
      // zero-model durable workflow. No model event is emitted by this unit.
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 1,
      maxOutputTokens: 1,
      maxAttemptsPerStep: 1,
      maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'impact-correction.target-changed', kind: 'deterministic-check' as const, required: true },
      { id: 'impact-correction.post-state', kind: 'post-state-matches' as const, required: true },
      { id: 'impact-correction.lineage', kind: 'deterministic-check' as const, required: true },
    ],
    verificationPlan: [{
      id: 'impact-correction.terminal',
      kind: 'terminal' as const,
      verifier: IMPACT_MANUAL_CORRECTION_VERIFIER_SET_V1,
      criterionIds: [
        'impact-correction.target-changed',
        'impact-correction.post-state',
        'impact-correction.lineage',
      ],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

function targetStateBody(record: Record<string, unknown>): Record<string, unknown> {
  // updatedAt alone is not a business correction. Keep identity, ownership and
  // every other persisted field in the hash so changing the wrong row cannot
  // satisfy the verifier.
  const { updatedAt: _updatedAt, ...body } = record
  return body
}

export async function hashImpactManualCorrectionTargetV1(input: {
  scope: WorkspaceScope
  target: CurrentImpactHandoffTargetV2
}): Promise<string> {
  const spec = getTableSpec(input.target.table)
  const record = await spec.table.get(input.target.recordId) as Record<string, unknown> | undefined
  if (!record || !await assertRecordInScope(input.scope, input.target.table, record)) {
    throw new Error('人工修正目标不存在或不属于当前 World/Work。')
  }
  return hashCanonicalValue({
    version: 1,
    table: input.target.table,
    recordId: input.target.recordId,
    state: targetStateBody(record),
  })
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function parseBaseline(value: unknown): ImpactManualCorrectionBaselineV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('人工修正检查点基线无效。')
  const row = value as Record<string, any>
  if (
    row.version !== 1
    || row.kind !== 'impact-manual-correction-baseline'
    || row.portable !== false
    || !Number.isInteger(row.projectId)
    || !row.handoff
    || !row.plan
    || !row.target
    || !isHash(row.targetPreStateHash)
    || !isHash(row.contextManifestHash)
  ) throw new Error('人工修正检查点基线不完整。')
  if (
    row.plan.planHash !== row.handoff.planHash
    || row.plan.graphHash !== row.handoff.graphHash
    || row.plan.source?.sourceTextHash !== row.handoff.sourceTextHash
    || row.target.table !== (row.handoff.action === 'review-source' ? 'chapters' : row.handoff.table)
    || !Number.isInteger(row.target.recordId)
    || !Number.isInteger(row.target.moduleRecordId)
  ) throw new Error('人工修正检查点基线证据不一致。')
  return row as ImpactManualCorrectionBaselineV1
}

async function assertFrozenLineage(input: {
  scope: WorkspaceScope
  baseline: ImpactManualCorrectionBaselineV1
  snapshot: AgentRunSnapshotV1
}): Promise<void> {
  const { baseline, scope, snapshot } = input
  if (baseline.projectId !== scope.projectId) {
    throw new Error('人工修正检查点不便携；项目导入后必须重新建立当前交接。')
  }
  if (
    snapshot.contract.lineage?.parent.runId !== baseline.handoff.reviewRunId
    || snapshot.contract.lineage.parent.receiptHash !== baseline.handoff.reviewReceiptHash
    || snapshot.contract.lineage.parent.artifactHash !== baseline.plan.planHash
  ) throw new Error('人工修正 Run 的父复核 lineage 已损坏。')

  const chapter = await db.chapters.get(baseline.handoff.sourceChapterId)
  if (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('人工修正来源章节不存在或越界。')
  }
  const correctsSourceChapter = baseline.target.table === 'chapters'
    && baseline.target.recordId === baseline.handoff.sourceChapterId
  if (!correctsSourceChapter && await hashChapterText(chapter.content ?? '') !== baseline.handoff.sourceTextHash) {
    throw new Error('人工修正期间来源正文已变化，旧完成证明不能继续。')
  }

  const reviews = await readFrozenImpactAuthorReviewsV1({ scope, plan: baseline.plan })
  const latest = reviews.find(record => record.output.itemId === baseline.handoff.itemId)
  if (
    !latest
    || latest.output.decision !== 'needs-manual-action'
    || latest.runId !== baseline.handoff.reviewRunId
    || latest.receiptHash !== baseline.handoff.reviewReceiptHash
  ) throw new Error('人工修正引用的 needs-manual-action 已被覆盖或损坏。')

  const target = await resolveCurrentImpactHandoffTargetV2({ scope, handoff: baseline.handoff })
  if (
    !target
    || target.table !== baseline.target.table
    || target.recordId !== baseline.target.recordId
    || target.moduleRecordId !== baseline.target.moduleRecordId
  ) throw new Error('人工修正目标已删除、越界或不再匹配原交接。')
}

async function readExisting(input: {
  scope: WorkspaceScope
  handoff: ImpactHandoffV2
  relation: string
}): Promise<ImpactManualCorrectionStateV1 | null> {
  const snapshot = await readAgentRunChildV1({
    scope: input.scope,
    parentRunId: input.handoff.reviewRunId,
    relation: input.relation,
  })
  if (!snapshot) return null
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, snapshot.run.id)
  if (!checkpoint) throw new Error('人工修正 Run 缺少可信 pre-state 检查点。')
  const baseline = parseBaseline(checkpoint.resumePayload)
  if (
    baseline.handoff.reviewRunId !== input.handoff.reviewRunId
    || baseline.handoff.reviewReceiptHash !== input.handoff.reviewReceiptHash
    || baseline.handoff.itemId !== input.handoff.itemId
    || baseline.handoff.planHash !== input.handoff.planHash
  ) throw new Error('人工修正 Run 与当前交接地址不一致。')
  await assertFrozenLineage({ scope: input.scope, baseline, snapshot })
  if (snapshot.projection.state === 'completed') {
    const expectedPostStateHash = snapshot.projection.steps[IMPACT_MANUAL_CORRECTION_STEP_ID_V1]?.outputHash
    const currentPostStateHash = await hashImpactManualCorrectionTargetV1({
      scope: input.scope,
      target: baseline.target,
    })
    if (!expectedPostStateHash || currentPostStateHash !== expectedPostStateHash) {
      await staleAgentRunVerificationV1({
        scope: input.scope,
        runId: snapshot.run.id,
        reason: 'impact-manual-correction-target-changed-after-verification',
      })
      throw new Error('人工修正完成证明已过期；目标在终验后再次变化，请返回来源重新规划。')
    }
  }
  return { snapshot, baseline, reused: true }
}

/** Freeze the exact target state after authenticating the current handoff. */
export async function beginImpactManualCorrectionV1(input: {
  scope: WorkspaceScope
  handoff: ImpactHandoffV2
}): Promise<ImpactManualCorrectionStateV1> {
  const relation = await childRelation(input.handoff)
  const existing = await readExisting({ ...input, relation })
  if (existing) return existing

  const current = await validateCurrentImpactHandoffV2(input)
  if (!current) throw new Error('人工修正只能从当前可信 handoff 开始。')
  const reviewRun = await readAgentRunV1(input.scope, current.review.runId)
  const targetPreStateHash = await hashImpactManualCorrectionTargetV1({
    scope: input.scope,
    target: current.target,
  })
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    worldGroupId: reviewRun.run.worldGroupId ?? null,
    contract: contract({
      scope: input.scope,
      worldGroupId: reviewRun.run.worldGroupId ?? null,
      handoff: input.handoff,
      reviewRunId: current.review.runId,
      reviewReceiptHash: current.review.receiptHash,
      relation,
    }),
  })
  snapshot = await appendAgentRunEventV1({
    scope: input.scope,
    runId: snapshot.run.id,
    type: 'step.scheduled',
    payload: { stepId: IMPACT_MANUAL_CORRECTION_STEP_ID_V1 },
  })
  snapshot = await appendAgentRunEventV1({
    scope: input.scope,
    runId: snapshot.run.id,
    type: 'step.started',
    payload: { stepId: IMPACT_MANUAL_CORRECTION_STEP_ID_V1, attempt: 1 },
  })
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    worldGroupId: reviewRun.run.worldGroupId ?? null,
    chapterId: input.handoff.sourceChapterId,
    sourceKeys: ['chapterContent'],
    inputBudgetMaxTokens: 8_000,
  })
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: IMPACT_MANUAL_CORRECTION_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: reviewRun.run.worldGroupId ?? null,
    declaredSourceKeys: ['chapterContent'],
    assembled,
    readerVersion: 'impact-manual-correction-context-v1',
  })
  snapshot = await appendAgentRunEventV1({
    scope: input.scope,
    runId: snapshot.run.id,
    type: 'context.assembled',
    payload: {
      stepId: IMPACT_MANUAL_CORRECTION_STEP_ID_V1,
      attempt: 1,
      manifestHash: manifest.manifestHash,
    },
  })
  const baseline: ImpactManualCorrectionBaselineV1 = {
    version: 1,
    kind: 'impact-manual-correction-baseline',
    portable: false,
    projectId: input.scope.projectId,
    handoff: input.handoff,
    plan: current.plan,
    target: current.target,
    targetPreStateHash,
    contextManifestHash: manifest.manifestHash,
  }
  await createAgentRunCheckpointV1({
    scope: input.scope,
    runId: snapshot.run.id,
    resumePayload: baseline,
  })
  snapshot = await appendAgentRunEventV1({
    scope: input.scope,
    runId: snapshot.run.id,
    type: 'run.paused',
    payload: { reason: 'awaiting-manual-correction-save', recoverable: true },
  })
  return { snapshot, baseline, reused: false }
}

/** Re-read the same governed row and sign completion only after real change. */
export async function completeImpactManualCorrectionV1(input: {
  scope: WorkspaceScope
  handoff: ImpactHandoffV2
}): Promise<ImpactManualCorrectionCompletionV1> {
  const relation = await childRelation(input.handoff)
  const existing = await readExisting({ ...input, relation })
  if (!existing) throw new Error('人工修正尚未建立 pre-state，不能验证完成。')
  if (existing.snapshot.projection.state === 'completed' && existing.snapshot.projection.terminalReceiptHash) {
    const post = existing.snapshot.projection.steps[IMPACT_MANUAL_CORRECTION_STEP_ID_V1]?.outputHash
    if (!post) throw new Error('人工修正完成 Run 缺少 post-state hash。')
    return {
      snapshot: existing.snapshot,
      receiptHash: existing.snapshot.projection.terminalReceiptHash,
      targetPreStateHash: existing.baseline.targetPreStateHash,
      targetPostStateHash: post,
      reused: true,
    }
  }
  if (existing.snapshot.projection.state !== 'paused') {
    throw new Error(`人工修正 Run 当前为 ${existing.snapshot.projection.state}，不能签发完成证明。`)
  }
  const targetPostStateHash = await hashImpactManualCorrectionTargetV1({
    scope: input.scope,
    target: existing.baseline.target,
  })
  if (targetPostStateHash === existing.baseline.targetPreStateHash) {
    throw new Error('目标正式状态没有变化；仅导航、打开或更新时间变化不能算修正完成。')
  }

  const recovery = await beginAgentRunRecoveryV1({
    scope: input.scope,
    runId: existing.snapshot.run.id,
    expectedLastSequence: existing.snapshot.projection.lastSequence,
  })
  let snapshot = await completeAgentRunRecoveryV1({
    scope: input.scope,
    runId: existing.snapshot.run.id,
    checkpointHash: recovery.checkpointHash,
    expectedLastSequence: recovery.snapshot.projection.lastSequence,
  })
  snapshot = await appendAgentRunEventV1({
    scope: input.scope,
    runId: snapshot.run.id,
    type: 'step.succeeded',
    payload: {
      stepId: IMPACT_MANUAL_CORRECTION_STEP_ID_V1,
      attempt: 1,
      outputHash: targetPostStateHash,
    },
  })
  snapshot = await appendAgentRunEventV1({
    scope: input.scope,
    runId: snapshot.run.id,
    type: 'verification.started',
    payload: { verifierSetVersion: IMPACT_MANUAL_CORRECTION_VERIFIER_SET_V1 },
  })
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [existing.baseline.contextManifestHash],
    candidateHashes: [],
    adoptionEventIds: [],
    postStateHash: targetPostStateHash,
    verifierSetVersion: IMPACT_MANUAL_CORRECTION_VERIFIER_SET_V1,
    lineage: {
      runId: input.handoff.reviewRunId,
      receiptHash: input.handoff.reviewReceiptHash,
      relation: snapshot.contract.lineage!.parent.relation,
      artifactHash: input.handoff.planHash,
    },
    criteria: [
      {
        id: 'impact-correction.target-changed',
        status: 'passed',
        evidenceRefs: [
          `target:${existing.baseline.target.table}#${existing.baseline.target.recordId}`,
          `pre-state:${existing.baseline.targetPreStateHash}`,
          `post-state:${targetPostStateHash}`,
        ],
      },
      {
        id: 'impact-correction.post-state',
        status: 'passed',
        evidenceRefs: [`post-state:${targetPostStateHash}`],
      },
      {
        id: 'impact-correction.lineage',
        status: 'passed',
        evidenceRefs: [
          `review-run:${input.handoff.reviewRunId}`,
          `review-receipt:${input.handoff.reviewReceiptHash}`,
          `plan:${input.handoff.planHash}`,
        ],
      },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await appendAgentRunEventV1({
    scope: input.scope,
    runId: snapshot.run.id,
    type: 'verification.accepted',
    payload: { receiptHash: receipt.receiptHash },
  })
  return {
    snapshot,
    receiptHash: receipt.receiptHash,
    targetPreStateHash: existing.baseline.targetPreStateHash,
    targetPostStateHash,
    reused: false,
  }
}
