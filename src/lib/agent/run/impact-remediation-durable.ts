import { db } from '../../db/schema'
import type { AgentRunRecord, WorkspaceScope } from '../../types'
import { assembleContext } from '../../registry/assemble-context'
import { buildEditImpactGraphV1 } from '../../consistency/impact-analysis'
import {
  buildImpactRemediationPlanV1,
  type ImpactRemediationPlanV1,
} from '../../consistency/impact-remediation-plan'
import {
  rebuildChapterChunks,
  rebuildProjectNarrativeSummaries,
} from '../../retrieval/retrieval'
import { hashChapterText } from '../../ai/chapter-memory/text-normalization'
import { assertRecordInScope, readOwnedRows } from '../../world-engine/scope'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunChildV1,
  readAgentRunV1,
  readCurrentAgentRunParentV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import { createVerificationReceiptV1 } from './verification-receipt'
import { hashCanonicalValue } from './hash'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from './checkpoint'

export const IMPACT_REMEDIATION_STEP_ID_V1 = 'impact-remediation:deterministic' as const
export const IMPACT_REMEDIATION_VERIFIER_SET_V1 = 'impact-remediation-terminal-v1' as const

export interface ImpactRemediationOutputV1 {
  version: 1
  kind: 'impact-remediation-output'
  portable: false
  planHash: string
  graphHash: string
  sourceTextHash: string
  retrieval: { rebuilt: boolean; count: number }
  summaries: { chapterNodes: number; volumeNodes: number; bookNodes: number; staleNodes: number }
  outputHash: string
}

export interface ImpactRemediationParentV1 {
  runId: number
  receiptHash: string
  relation: string
  artifactHash: string
}

export type ImpactRemediationBoundaryV1 =
  | 'run.created'
  | 'step.scheduled'
  | 'step.started'
  | 'context.assembled'
  | 'baseline.checkpoint'
  | 'derived.rebuilt'
  | 'output.checkpoint'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

interface ImpactRemediationBaselineV1 {
  version: 1
  kind: 'impact-remediation-baseline'
  portable: false
  plan: ImpactRemediationPlanV1
  contextManifestHash: string
}

class ImpactRemediationBoundaryInterruption extends Error {
  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : 'impact-remediation-boundary-interruption')
  }
}

async function notifyBoundary(
  callback: ((boundary: ImpactRemediationBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>) | undefined,
  boundary: ImpactRemediationBoundaryV1,
  snapshot: AgentRunSnapshotV1,
): Promise<void> {
  if (!callback) return
  try {
    await callback(boundary, snapshot)
  } catch (error) {
    // Test/process interruption is not a business failure. In particular, an
    // interruption after derived writes must leave the running step resumable.
    throw new ImpactRemediationBoundaryInterruption(error)
  }
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

async function parseCheckpoint(value: unknown): Promise<ImpactRemediationBaselineV1 | ImpactRemediationOutputV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('影响重建检查点无效。')
  const row = value as Record<string, any>
  if (row.version !== 1 || row.portable !== false) throw new Error('影响重建检查点版本无效。')
  if (row.kind === 'impact-remediation-baseline') {
    if (!row.plan || !isHash(row.contextManifestHash)) throw new Error('影响重建基线不完整。')
    return row as ImpactRemediationBaselineV1
  }
  if (
    row.kind !== 'impact-remediation-output'
    || !isHash(row.planHash)
    || !isHash(row.graphHash)
    || !isHash(row.sourceTextHash)
    || !row.retrieval
    || !row.summaries
    || !isHash(row.outputHash)
  ) throw new Error('影响重建输出不完整。')
  const { outputHash, ...body } = row
  if (await hashCanonicalValue(body) !== outputHash) throw new Error('影响重建输出 hash 不匹配。')
  return row as ImpactRemediationOutputV1
}

function assertCheckpointMatchesPlan(
  persisted: ImpactRemediationBaselineV1 | ImpactRemediationOutputV1,
  plan: ImpactRemediationPlanV1,
): void {
  const persistedPlanHash = persisted.kind === 'impact-remediation-baseline' ? persisted.plan.planHash : persisted.planHash
  const persistedGraphHash = persisted.kind === 'impact-remediation-baseline' ? persisted.plan.graphHash : persisted.graphHash
  const persistedSourceTextHash = persisted.kind === 'impact-remediation-baseline'
    ? persisted.plan.source.sourceTextHash
    : persisted.sourceTextHash
  if (
    persistedPlanHash !== plan.planHash
    || persistedGraphHash !== plan.graphHash
    || persistedSourceTextHash !== plan.source.sourceTextHash
  ) throw new Error('影响重建检查点与当前冻结计划不一致。')
}

function assertExistingContract(
  snapshot: AgentRunSnapshotV1,
  plan: ImpactRemediationPlanV1,
  parent?: ImpactRemediationParentV1,
): void {
  if (snapshot.contract.objective !== `按影响处理计划 ${plan.planHash} 重建章节派生检索与摘要缓存`) {
    throw new Error('影响重建 Run 契约与当前计划不一致。')
  }
  if (parent) {
    const actual = snapshot.contract.lineage?.parent
    if (
      !actual
      || actual.runId !== parent.runId
      || actual.receiptHash !== parent.receiptHash
      || actual.relation !== parent.relation
      || actual.artifactHash !== parent.artifactHash
    ) throw new Error('影响重建 Run 父证据与当前重规划不一致。')
  }
}

function remediationContract(input: {
  projectId: number
  worldGroupId: number | null
  sourceChapterId: number
  planHash: string
  parent?: ImpactRemediationParentV1
}) {
  return {
    version: 1 as const,
    objective: `按影响处理计划 ${input.planHash} 重建章节派生检索与摘要缓存`,
    workflowKind: 'plan-execute' as const,
    ...(input.parent ? { lineage: { parent: input.parent } } : {}),
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      chapterIds: [input.sourceChapterId],
    },
    permissions: {
      contextSourceKeys: ['chapterContent'],
      // These are deterministic derived caches. They are intentionally not AI
      // write targets and therefore do not bypass FIELD_REGISTRY/adopt().
      writeTargets: [],
    },
    budget: {
      // RunContract currently requires a positive ceiling even for zero-model work.
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 1,
      maxOutputTokens: 1,
      maxAttemptsPerStep: 1,
      maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'impact-remediation.deterministic', kind: 'deterministic-check' as const, required: true },
      { id: 'impact-remediation.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'impact-remediation.terminal',
      kind: 'terminal' as const,
      verifier: IMPACT_REMEDIATION_VERIFIER_SET_V1,
      criterionIds: ['impact-remediation.deterministic', 'impact-remediation.post-state'],
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

async function knownEntities(scope: WorkspaceScope): Promise<string[]> {
  const [characters, entries, locations] = await Promise.all([
    readOwnedRows<any>(scope, 'characters', { owner: 'world' }),
    readOwnedRows<any>(scope, 'codexEntries', { owner: 'world' }),
    readOwnedRows<any>(scope, 'importantLocations', { owner: 'world' }),
  ])
  return [
    ...characters.map(row => row.name),
    ...entries.map(row => row.name),
    ...locations.map(row => row.name),
  ].filter((name): name is string => typeof name === 'string' && name.length >= 2)
}

async function assertCurrentPlan(
  scope: WorkspaceScope,
  plan: ImpactRemediationPlanV1,
): Promise<{ graphHash: string; sourceTextHash: string }> {
  const graph = await buildEditImpactGraphV1(scope, plan.source.recordId)
  const current = await buildImpactRemediationPlanV1(graph)
  if (current.planHash !== plan.planHash
    || current.graphHash !== plan.graphHash
    || current.source.sourceTextHash !== plan.source.sourceTextHash) {
    throw new Error('影响处理计划已过期，正文、影响图或计划 hash 已变化。')
  }
  return { graphHash: graph.graphHash, sourceTextHash: graph.source.sourceTextHash }
}

async function postStateHash(scope: WorkspaceScope, chapterId: number, planHash: string): Promise<string> {
  const graph = await buildEditImpactGraphV1(scope, chapterId)
  return hashCanonicalValue({
    version: 1,
    planHash,
    graphHash: graph.graphHash,
    sourceTextHash: graph.source.sourceTextHash,
  })
}

async function readExistingCompletedRun(
  scope: WorkspaceScope,
  plan: ImpactRemediationPlanV1,
): Promise<AgentRunSnapshotV1 | null> {
  const rows = await readOwnedRows<AgentRunRecord>(scope, 'agentRuns', { owner: 'work' })
  for (const row of rows.sort((left, right) => (right.id ?? 0) - (left.id ?? 0))) {
    if (!row.id || !row.contractJson || row.status !== 'completed') continue
    try {
      const contract = JSON.parse(row.contractJson) as Record<string, any>
      if (contract.objective !== `按影响处理计划 ${plan.planHash} 重建章节派生检索与摘要缓存`) continue
      return await readAgentRunV1(scope, row.id)
    } catch {
      // A malformed historical run must not become a reusable completion proof.
    }
  }
  return null
}

/** Execute only deterministic impact-plan items; author-confirmed items remain untouched. */
export async function executeImpactRemediationV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  plan: ImpactRemediationPlanV1
  parent?: ImpactRemediationParentV1
  onDurableBoundary?: (
    boundary: ImpactRemediationBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{
  snapshot: AgentRunSnapshotV1
  receiptHash: string
  output: ImpactRemediationOutputV1
  reused: boolean
}> {
  const deterministic = input.plan.items.filter(item => item.mode === 'deterministic')
  if (!deterministic.length) throw new Error('当前影响计划没有可确定性重建的项目。')
  if (input.plan.source.table !== 'chapters' || input.plan.source.recordId == null) {
    throw new Error('影响处理计划来源章节无效。')
  }
  const chapter = await db.chapters.get(input.plan.source.recordId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('影响处理计划来源章节不存在或越界。')
  }
  if (await hashChapterText(chapter.content ?? '') !== input.plan.source.sourceTextHash) {
    throw new Error('影响处理计划已过期，来源正文 hash 已变化。')
  }
  let existing = input.parent
    ? await readAgentRunChildV1({
        scope: input.scope,
        parentRunId: input.parent.runId,
        relation: input.parent.relation,
      })
    : await readExistingCompletedRun(input.scope, input.plan)
  if (existing) assertExistingContract(existing, input.plan, input.parent)
  if (existing && input.parent) await readCurrentAgentRunParentV1(input.scope, existing)
  if (existing?.projection.terminalReceiptHash) {
    const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, existing.run.id)
    const persisted = checkpoint ? await parseCheckpoint(checkpoint.resumePayload) : null
    if (persisted?.kind === 'impact-remediation-output') {
      assertCheckpointMatchesPlan(persisted, input.plan)
      return {
        snapshot: existing,
        receiptHash: existing.projection.terminalReceiptHash,
        output: persisted,
        reused: true,
      }
    }
    if (input.parent) throw new Error('影响重建子 Run 已完成，但缺少可验证的输出检查点。')
    existing = null
  }
  // A partial run may have been interrupted after rebuilding derived caches but
  // before persisting its output checkpoint. Those writes legitimately change
  // the graph. The frozen plan plus unchanged chapter text is therefore the
  // recovery boundary; deterministic cache rebuilds are safe to re-enter.
  const current = existing
    ? { graphHash: input.plan.graphHash, sourceTextHash: input.plan.source.sourceTextHash }
    : await assertCurrentPlan(input.scope, input.plan)
  let snapshot = existing
  if (!snapshot) {
    snapshot = await createAgentRunV1({
      scope: input.scope,
      worldGroupId: input.worldGroupId,
      contract: remediationContract({
        projectId: input.scope.projectId,
        worldGroupId: input.worldGroupId,
        sourceChapterId: input.plan.source.recordId,
        planHash: input.plan.planHash,
        parent: input.parent,
      }),
    })
    await notifyBoundary(input.onDurableBoundary, 'run.created', snapshot)
  }
  if (!snapshot.projection.steps[IMPACT_REMEDIATION_STEP_ID_V1]) {
    snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: IMPACT_REMEDIATION_STEP_ID_V1 })
    await notifyBoundary(input.onDurableBoundary, 'step.scheduled', snapshot)
  }
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
    stepId: IMPACT_REMEDIATION_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: ['chapterContent'],
    assembled,
    readerVersion: 'impact-remediation-context-v1',
  })
  if (snapshot.projection.steps[IMPACT_REMEDIATION_STEP_ID_V1]?.status === 'scheduled') {
    snapshot = await append(input.scope, snapshot, 'step.started', { stepId: IMPACT_REMEDIATION_STEP_ID_V1, attempt: 1 })
    await notifyBoundary(input.onDurableBoundary, 'step.started', snapshot)
  }
  const contextEvent = snapshot.events.find(event => event.type === 'context.assembled' && event.payload.stepId === IMPACT_REMEDIATION_STEP_ID_V1)
  if (contextEvent?.type === 'context.assembled' && contextEvent.payload.manifestHash !== manifest.manifestHash) {
    throw new Error('影响重建恢复时 Context Manifest 已变化。')
  }
  if (!contextEvent) {
    snapshot = await append(input.scope, snapshot, 'context.assembled', {
      stepId: IMPACT_REMEDIATION_STEP_ID_V1,
      attempt: 1,
      manifestHash: manifest.manifestHash,
    })
    await notifyBoundary(input.onDurableBoundary, 'context.assembled', snapshot)
  }

  const latestCheckpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, snapshot.run.id)
  let persisted = latestCheckpoint ? await parseCheckpoint(latestCheckpoint.resumePayload) : null
  if (persisted) assertCheckpointMatchesPlan(persisted, input.plan)
  if (!persisted) {
    const created = await createAgentRunCheckpointV1({
      scope: input.scope,
      runId: snapshot.run.id,
      resumePayload: {
        version: 1,
        kind: 'impact-remediation-baseline',
        portable: false,
        plan: input.plan,
        contextManifestHash: manifest.manifestHash,
      } satisfies ImpactRemediationBaselineV1,
    })
    snapshot = created.snapshot
    persisted = await parseCheckpoint(created.checkpoint.resumePayloadJson ? JSON.parse(created.checkpoint.resumePayloadJson) : null)
    await notifyBoundary(input.onDurableBoundary, 'baseline.checkpoint', snapshot)
  }

  try {
    let output: ImpactRemediationOutputV1
    if (persisted.kind === 'impact-remediation-output') {
      output = persisted
    } else {
      const entities = deterministic.some(item => item.action === 'rebuild-retrieval')
        ? await knownEntities(input.scope)
        : []
      const retrieval = deterministic.some(item => item.action === 'rebuild-retrieval')
        ? await rebuildChapterChunks({
            projectId: input.scope.projectId,
            chapter,
            worldGroupId: input.worldGroupId,
            knownEntities: entities,
            scope: input.scope,
          })
        : { rebuilt: false, count: 0 }
      const summaries = deterministic.some(item => item.action === 'rebuild-summary')
        ? await rebuildProjectNarrativeSummaries({ projectId: input.scope.projectId, scope: input.scope })
        : { chapterNodes: 0, volumeNodes: 0, bookNodes: 0, staleNodes: 0 }
      await notifyBoundary(input.onDurableBoundary, 'derived.rebuilt', snapshot)
      const latestChapter = await db.chapters.get(input.plan.source.recordId)
      if (await hashChapterText(latestChapter?.content ?? '') !== current.sourceTextHash) {
        throw new Error('影响处理执行期间正文发生变化，结果不签发终态回执。')
      }
      const body = {
        version: 1 as const,
        kind: 'impact-remediation-output' as const,
        portable: false as const,
        planHash: input.plan.planHash,
        graphHash: current.graphHash,
        sourceTextHash: current.sourceTextHash,
        retrieval,
        summaries,
      }
      output = { ...body, outputHash: await hashCanonicalValue(body) }
      const created = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: output })
      snapshot = created.snapshot
      await notifyBoundary(input.onDurableBoundary, 'output.checkpoint', snapshot)
    }
    if (snapshot.projection.steps[IMPACT_REMEDIATION_STEP_ID_V1]?.status === 'running') {
      snapshot = await append(input.scope, snapshot, 'step.succeeded', {
        stepId: IMPACT_REMEDIATION_STEP_ID_V1,
        attempt: 1,
        outputHash: output.outputHash,
      })
      await notifyBoundary(input.onDurableBoundary, 'step.succeeded', snapshot)
    }
    if (snapshot.projection.state === 'running') {
      snapshot = await append(input.scope, snapshot, 'verification.started', {
        verifierSetVersion: IMPACT_REMEDIATION_VERIFIER_SET_V1,
      })
      await notifyBoundary(input.onDurableBoundary, 'verification.started', snapshot)
    }
    const finalPostStateHash = await postStateHash(input.scope, input.plan.source.recordId, input.plan.planHash)
    const receipt = await createVerificationReceiptV1({
      version: 1,
      runId: snapshot.run.id,
      generation: snapshot.projection.generation,
      contractHash: snapshot.projection.contractHash,
      contextManifestHashes: [manifest.manifestHash],
      candidateHashes: [],
      adoptionEventIds: [],
      postStateHash: finalPostStateHash,
      verifierSetVersion: IMPACT_REMEDIATION_VERIFIER_SET_V1,
      ...(input.parent ? { lineage: input.parent } : {}),
      criteria: [
        { id: 'impact-remediation.deterministic', status: 'passed', evidenceRefs: [`output:${output.outputHash}`, `plan:${input.plan.planHash}`] },
        { id: 'impact-remediation.post-state', status: 'passed', evidenceRefs: [`post-state:${finalPostStateHash}`] },
      ],
      acceptedAt: Date.now(),
    })
    snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
    await notifyBoundary(input.onDurableBoundary, 'verification.accepted', snapshot)
    return { snapshot, receiptHash: receipt.receiptHash, output, reused: false }
  } catch (error) {
    if (error instanceof ImpactRemediationBoundaryInterruption) throw error.original
    try {
      snapshot = await append(input.scope, snapshot, 'step.failed', {
        stepId: IMPACT_REMEDIATION_STEP_ID_V1,
        attempt: 1,
        code: error instanceof Error ? 'impact_remediation_failed' : 'impact_remediation_unknown',
        retryable: false,
      })
    } catch {
      // Preserve the original failure if the failure evidence cannot be appended.
    }
    throw error
  }
}
