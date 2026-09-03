import { db } from '../../db/schema'
import type { WorkspaceScope } from '../../types'
import { assembleContext } from '../../registry/assemble-context'
import { hashImpactManualCorrectionTargetV1, readCompletedImpactManualCorrectionV1 } from './impact-manual-correction-durable'
import type { CurrentImpactHandoffTargetV2 } from './impact-handoff-durable'
import type { ImpactHandoffV2 } from '../../consistency/impact-handoff'
import { buildEditImpactGraphV1, type EditImpactGraphV1 } from '../../consistency/impact-analysis'
import { buildImpactRemediationPlanV1, type ImpactRemediationPlanV1 } from '../../consistency/impact-remediation-plan'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunChildV1,
  readAgentRunV1,
  readCurrentAgentRunParentV1,
  staleAgentRunVerificationV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from './checkpoint'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import { createVerificationReceiptV1 } from './verification-receipt'
import { hashCanonicalValue } from './hash'
import { assertRecordInScope, readOwnedRows } from '../../workspace/scope'
import type { AgentRunRecord } from '../../types/agent-run'
import { replanImpactRemediationV1 } from '../../consistency/impact-remediation-replan'

export const IMPACT_POST_CORRECTION_REPLAN_STEP_ID_V1 = 'impact-remediation:post-correction-replan' as const
export const IMPACT_POST_CORRECTION_REPLAN_VERIFIER_SET_V1 = 'impact-post-correction-replan-terminal-v1' as const

export interface ImpactPostCorrectionReplanOutputV1 {
  version: 1
  kind: 'impact-post-correction-replan'
  portable: false
  sourceChapterId: number
  manualCorrectionRunId: number
  manualCorrectionReceiptHash: string
  targetPostStateHash: string
  target: CurrentImpactHandoffTargetV2
  previousPlan: ImpactRemediationPlanV1
  graph: EditImpactGraphV1
  plan: ImpactRemediationPlanV1
  resolvedItemIds: string[]
  remainingItemIds: string[]
  newItemIds: string[]
  contextManifestHash: string
  outputHash: string
}

export interface ImpactPostCorrectionReplanResultV1 {
  snapshot: AgentRunSnapshotV1
  output: ImpactPostCorrectionReplanOutputV1
  receiptHash: string
  reused: boolean
}

export type ImpactPostCorrectionReplanBoundaryV1 =
  | 'run.created'
  | 'step.scheduled'
  | 'step.started'
  | 'context.assembled'
  | 'checkpoint.created'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

async function relationFor(input: { runId: number; receiptHash: string }): Promise<string> {
  return `impact-post-correction-replan:${await hashCanonicalValue({ version: 1, ...input })}`
}

function classify(previousPlan: ImpactRemediationPlanV1, plan: ImpactRemediationPlanV1) {
  const previousIds = new Set(previousPlan.items.map(item => item.id))
  const currentIds = new Set(plan.items.map(item => item.id))
  return {
    resolvedItemIds: [...previousIds].filter(id => !currentIds.has(id)).sort(),
    remainingItemIds: [...previousIds].filter(id => currentIds.has(id)).sort(),
    newItemIds: [...currentIds].filter(id => !previousIds.has(id)).sort(),
  }
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

async function parseOutput(value: unknown): Promise<ImpactPostCorrectionReplanOutputV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('修正后重规划检查点无效。')
  const row = value as Record<string, any>
  if (
    row.version !== 1
    || row.kind !== 'impact-post-correction-replan'
    || row.portable !== false
    || !Number.isInteger(row.sourceChapterId)
    || !Number.isInteger(row.manualCorrectionRunId)
    || !isHash(row.manualCorrectionReceiptHash)
    || !isHash(row.targetPostStateHash)
    || !row.target
    || !row.previousPlan
    || !row.graph
    || !row.plan
    || !Array.isArray(row.resolvedItemIds)
    || !Array.isArray(row.remainingItemIds)
    || !Array.isArray(row.newItemIds)
    || !isHash(row.contextManifestHash)
    || !isHash(row.outputHash)
  ) throw new Error('修正后重规划检查点不完整。')
  const { outputHash, ...body } = row
  if (await hashCanonicalValue(body) !== outputHash) throw new Error('修正后重规划输出 hash 不匹配。')
  const expected = classify(row.previousPlan, row.plan)
  for (const key of ['resolvedItemIds', 'remainingItemIds', 'newItemIds'] as const) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(row[key])) throw new Error('修正后重规划差异分类已损坏。')
  }
  return row as ImpactPostCorrectionReplanOutputV1
}

function contract(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  sourceChapterId: number
  parentRunId: number
  parentReceiptHash: string
  parentArtifactHash: string
  relation: string
}) {
  return {
    version: 1 as const,
    objective: `重规划人工修正后的影响 ${input.sourceChapterId}`,
    workflowKind: 'plan-execute' as const,
    lineage: { parent: {
      runId: input.parentRunId,
      receiptHash: input.parentReceiptHash,
      relation: input.relation,
      artifactHash: input.parentArtifactHash,
    } },
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
      chapterIds: [input.sourceChapterId],
    },
    permissions: { contextSourceKeys: ['chapterContent'], writeTargets: [] },
    budget: {
      maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1, maxOutputTokens: 1,
      maxAttemptsPerStep: 1, maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'impact-replan.parent-fresh', kind: 'deterministic-check' as const, required: true },
      { id: 'impact-replan.current-plan', kind: 'post-state-matches' as const, required: true },
      { id: 'impact-replan.diff-classified', kind: 'deterministic-check' as const, required: true },
    ],
    verificationPlan: [{
      id: 'impact-replan.terminal', kind: 'terminal' as const,
      verifier: IMPACT_POST_CORRECTION_REPLAN_VERIFIER_SET_V1,
      criterionIds: ['impact-replan.parent-fresh', 'impact-replan.current-plan', 'impact-replan.diff-classified'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

async function readExisting(input: {
  scope: WorkspaceScope
  handoff: ImpactHandoffV2
  relation: string
}): Promise<ImpactPostCorrectionReplanResultV1 | null> {
  const correction = await readCompletedImpactManualCorrectionV1(input)
  const snapshot = await readAgentRunChildV1({
    scope: input.scope,
    parentRunId: correction.snapshot.run.id,
    relation: input.relation,
  })
  if (!snapshot) return null
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, snapshot.run.id)
  if (!checkpoint) throw new Error('修正后重规划 Run 缺少可信输出检查点。')
  const output = await parseOutput(checkpoint.resumePayload)
  if (
    output.manualCorrectionRunId !== correction.snapshot.run.id
    || output.manualCorrectionReceiptHash !== correction.receiptHash
    || output.targetPostStateHash !== correction.targetPostStateHash
    || output.previousPlan.planHash !== correction.baseline.plan.planHash
  ) throw new Error('修正后重规划与人工修正完成证明不一致。')
  const targetHash = await hashImpactManualCorrectionTargetV1({ scope: input.scope, target: correction.baseline.target })
  const currentGraph = await buildEditImpactGraphV1(input.scope, output.sourceChapterId)
  const currentPlan = await buildImpactRemediationPlanV1(currentGraph)
  if (targetHash !== output.targetPostStateHash || currentPlan.planHash !== output.plan.planHash) {
    if (snapshot.projection.state === 'completed') {
      await staleAgentRunVerificationV1({
        scope: input.scope,
        runId: snapshot.run.id,
        reason: 'impact-post-correction-plan-or-target-changed',
      })
    }
    throw new Error('修正后重规划已过期；目标或当前影响计划再次变化。')
  }
  if (snapshot.projection.state !== 'completed' || !snapshot.projection.terminalReceiptHash) {
    throw new Error('修正后重规划 Run 尚未完成。')
  }
  return { snapshot, output, receiptHash: snapshot.projection.terminalReceiptHash, reused: true }
}

/** Build and sign the current plan immediately after a fresh manual correction. */
export async function executeImpactPostCorrectionReplanV1(input: {
  scope: WorkspaceScope
  handoff: ImpactHandoffV2
  onDurableBoundary?: (
    boundary: ImpactPostCorrectionReplanBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<ImpactPostCorrectionReplanResultV1> {
  const correction = await readCompletedImpactManualCorrectionV1(input)
  const relation = await relationFor({ runId: correction.snapshot.run.id, receiptHash: correction.receiptHash })
  const child = await readAgentRunChildV1({
    scope: input.scope,
    parentRunId: correction.snapshot.run.id,
    relation,
  })
  if (child?.projection.state === 'completed') {
    const existing = await readExisting({ ...input, relation })
    if (existing) return existing
  }
  const replanned = await replanImpactRemediationV1({
    scope: input.scope,
    previousPlan: correction.baseline.plan,
    reason: 'graph-stale',
  })
  const { graph, plan } = replanned
  const diff = classify(correction.baseline.plan, plan)
  const parent = await readAgentRunV1(input.scope, correction.snapshot.run.id)
  let snapshot = child
  if (!snapshot) {
    snapshot = await createAgentRunV1({
      scope: input.scope,
      worldGroupId: parent.run.worldGroupId ?? null,
      contract: contract({
        scope: input.scope,
        worldGroupId: parent.run.worldGroupId ?? null,
        sourceChapterId: correction.baseline.handoff.sourceChapterId,
        parentRunId: correction.snapshot.run.id,
        parentReceiptHash: correction.receiptHash,
        parentArtifactHash: correction.targetPostStateHash,
        relation,
      }),
    })
    await input.onDurableBoundary?.('run.created', snapshot)
  }
  if (
    snapshot.contract.lineage?.parent.runId !== correction.snapshot.run.id
    || snapshot.contract.lineage.parent.receiptHash !== correction.receiptHash
    || snapshot.contract.lineage.parent.artifactHash !== correction.targetPostStateHash
  ) throw new Error('修正后重规划 partial Run 的父 lineage 已损坏。')
  const step = snapshot.projection.steps[IMPACT_POST_CORRECTION_REPLAN_STEP_ID_V1]
  if (!step) {
    snapshot = await appendAgentRunEventV1({
      scope: input.scope, runId: snapshot.run.id, type: 'step.scheduled',
      payload: { stepId: IMPACT_POST_CORRECTION_REPLAN_STEP_ID_V1 },
    })
    await input.onDurableBoundary?.('step.scheduled', snapshot)
  }
  if (snapshot.projection.steps[IMPACT_POST_CORRECTION_REPLAN_STEP_ID_V1]?.status === 'scheduled') {
    snapshot = await appendAgentRunEventV1({
      scope: input.scope, runId: snapshot.run.id, type: 'step.started',
      payload: { stepId: IMPACT_POST_CORRECTION_REPLAN_STEP_ID_V1, attempt: 1 },
    })
    await input.onDurableBoundary?.('step.started', snapshot)
  }
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    worldGroupId: parent.run.worldGroupId ?? null,
    chapterId: correction.baseline.handoff.sourceChapterId,
    sourceKeys: ['chapterContent'],
    inputBudgetMaxTokens: 8_000,
  })
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: IMPACT_POST_CORRECTION_REPLAN_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: parent.run.worldGroupId ?? null,
    declaredSourceKeys: ['chapterContent'],
    assembled,
    readerVersion: 'impact-post-correction-replan-context-v1',
  })
  const contextEvent = snapshot.events.find(event => (
    event.type === 'context.assembled'
    && event.payload.stepId === IMPACT_POST_CORRECTION_REPLAN_STEP_ID_V1
  ))
  if (contextEvent?.type === 'context.assembled' && contextEvent.payload.manifestHash !== manifest.manifestHash) {
    throw new Error('修正后重规划恢复时 Context Manifest 已变化。')
  }
  if (!contextEvent) {
    snapshot = await appendAgentRunEventV1({
      scope: input.scope, runId: snapshot.run.id, type: 'context.assembled',
      payload: { stepId: IMPACT_POST_CORRECTION_REPLAN_STEP_ID_V1, attempt: 1, manifestHash: manifest.manifestHash },
    })
    await input.onDurableBoundary?.('context.assembled', snapshot)
  }
  const body = {
    version: 1 as const,
    kind: 'impact-post-correction-replan' as const,
    portable: false as const,
    sourceChapterId: correction.baseline.handoff.sourceChapterId,
    manualCorrectionRunId: correction.snapshot.run.id,
    manualCorrectionReceiptHash: correction.receiptHash,
    targetPostStateHash: correction.targetPostStateHash,
    target: correction.baseline.target,
    previousPlan: correction.baseline.plan,
    graph,
    plan,
    ...diff,
    contextManifestHash: manifest.manifestHash,
  }
  const output: ImpactPostCorrectionReplanOutputV1 = { ...body, outputHash: await hashCanonicalValue(body) }
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, snapshot.run.id)
  if (checkpoint) {
    const persisted = await parseOutput(checkpoint.resumePayload)
    if (persisted.outputHash !== output.outputHash) throw new Error('修正后重规划恢复输出已与当前状态不一致。')
  } else {
    const created = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: output })
    snapshot = created.snapshot
    await input.onDurableBoundary?.('checkpoint.created', snapshot)
  }
  const currentStep = snapshot.projection.steps[IMPACT_POST_CORRECTION_REPLAN_STEP_ID_V1]
  if (currentStep?.status === 'running') {
    snapshot = await appendAgentRunEventV1({
      scope: input.scope, runId: snapshot.run.id, type: 'step.succeeded',
      payload: { stepId: IMPACT_POST_CORRECTION_REPLAN_STEP_ID_V1, attempt: 1, outputHash: output.outputHash },
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  } else if (currentStep?.outputHash !== output.outputHash) {
    throw new Error('修正后重规划已成功步骤的 output hash 不匹配。')
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await appendAgentRunEventV1({
      scope: input.scope, runId: snapshot.run.id, type: 'verification.started',
      payload: { verifierSetVersion: IMPACT_POST_CORRECTION_REPLAN_VERIFIER_SET_V1 },
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  if (snapshot.projection.state !== 'verifying') {
    throw new Error(`修正后重规划 Run 当前为 ${snapshot.projection.state}，不能签发终态回执。`)
  }
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [manifest.manifestHash],
    candidateHashes: [], adoptionEventIds: [],
    postStateHash: output.outputHash,
    verifierSetVersion: IMPACT_POST_CORRECTION_REPLAN_VERIFIER_SET_V1,
    lineage: {
      runId: correction.snapshot.run.id,
      receiptHash: correction.receiptHash,
      relation,
      artifactHash: correction.targetPostStateHash,
    },
    criteria: [
      { id: 'impact-replan.parent-fresh', status: 'passed', evidenceRefs: [`manual-correction:${correction.receiptHash}`] },
      { id: 'impact-replan.current-plan', status: 'passed', evidenceRefs: [`plan:${plan.planHash}`, `graph:${graph.graphHash}`] },
      { id: 'impact-replan.diff-classified', status: 'passed', evidenceRefs: [`output:${output.outputHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await appendAgentRunEventV1({
    scope: input.scope, runId: snapshot.run.id, type: 'verification.accepted',
    payload: { receiptHash: receipt.receiptHash },
  })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, output, receiptHash: receipt.receiptHash, reused: false }
}

/** Recover the latest fresh post-correction plan for a source chapter. */
export async function readCurrentImpactPostCorrectionReplanV1(input: {
  scope: WorkspaceScope
  chapterId: number
}): Promise<ImpactPostCorrectionReplanResultV1 | null> {
  const chapter = await db.chapters.get(input.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('修正后重规划来源章节不存在或越界。')
  }
  const rows = await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' })
  const candidates = rows
    .filter(row => row.status === 'completed' && row.parentRunId != null && row.parentRelation?.startsWith('impact-post-correction-replan:'))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of candidates) {
    if (row.id == null) continue
    try {
      const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, row.id)
      if (!checkpoint) continue
      const output = await parseOutput(checkpoint.resumePayload)
      if (output.sourceChapterId !== input.chapterId) continue
      const graph = await buildEditImpactGraphV1(input.scope, input.chapterId)
      const plan = await buildImpactRemediationPlanV1(graph)
      const targetHash = await hashImpactManualCorrectionTargetV1({ scope: input.scope, target: output.target })
      if (plan.planHash !== output.plan.planHash || targetHash !== output.targetPostStateHash) {
        await staleAgentRunVerificationV1({ scope: input.scope, runId: row.id, reason: 'impact-post-correction-current-plan-changed' })
        continue
      }
      const snapshot = await readAgentRunV1(input.scope, row.id)
      if (
        snapshot.contract.lineage?.parent.runId !== output.manualCorrectionRunId
        || snapshot.contract.lineage.parent.receiptHash !== output.manualCorrectionReceiptHash
        || snapshot.contract.lineage.parent.artifactHash !== output.targetPostStateHash
      ) continue
      try {
        await readCurrentAgentRunParentV1(input.scope, snapshot)
      } catch {
        await staleAgentRunVerificationV1({ scope: input.scope, runId: row.id, reason: 'impact-post-correction-parent-stale' })
        continue
      }
      if (!snapshot.projection.terminalReceiptHash) continue
      return { snapshot, output, receiptHash: snapshot.projection.terminalReceiptHash, reused: true }
    } catch {
      // Damaged or stale historical outputs remain auditable but are not current.
    }
  }
  return null
}
