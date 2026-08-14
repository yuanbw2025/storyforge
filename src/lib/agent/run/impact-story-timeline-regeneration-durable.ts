import Dexie from 'dexie'
import { chat, resolveRequestConfig } from '../../ai/client'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../ai/config-readiness'
import { hashChapterText } from '../../ai/chapter-memory/text-normalization'
import {
  buildImpactStoryTimelineRegenerationMessagesV1,
  parseImpactStoryTimelineRegenerationResultStrictV1,
  readImpactStoryTimelineRegenerationPromptTemplateSnapshotV1,
  readImpactStoryTimelineRegenerationPromptTemplateV1,
  type ImpactStoryTimelineRegenerationResultV1,
  type ImpactStoryTimelineTargetV1,
} from '../../consistency/impact-story-timeline-regeneration'
import type { ImpactRemediationItemV1 } from '../../consistency/impact-remediation-plan'
import { db } from '../../db/schema'
import { assembleContext } from '../../registry/assemble-context'
import { adopt } from '../../registry/adopt'
import type { AIConfig, ChatMessage, WorkspaceScope } from '../../types'
import type { AgentRunRecord } from '../../types/agent-run'
import { assertRecordInScope, readOwnedRows, scopeTransactionTables } from '../../world-engine/scope'
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
import {
  assertExpectedImpactReplanCurrentV1,
  assertImpactDependencyProofV1,
  resolveImpactDependencyReadinessV1,
  type ImpactDependencyProofV1,
  type ImpactTargetReadinessV1,
} from './impact-dependency-readiness'
import {
  readCurrentImpactPostCorrectionReplanV1,
  type ImpactPostCorrectionReplanResultV1,
} from './impact-post-correction-replan-durable'
import { createVerificationReceiptV1 } from './verification-receipt'

export const IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1 = 'impact-remediation:story-timeline-regenerate' as const
export const IMPACT_STORY_TIMELINE_REGENERATION_SKILL_ID_V1 = 'prose.story-timeline-extraction' as const
export const IMPACT_STORY_TIMELINE_REGENERATION_VERIFIER_SET_V1 = 'impact-story-timeline-regeneration-terminal-v1' as const
export const IMPACT_STORY_TIMELINE_REGENERATION_CONTEXT_SOURCE_KEYS_V1 = [
  'chapterContent',
  'storyTimelineTarget',
] as const

type RunAI = (messages: ChatMessage[]) => Promise<string>

interface TargetTimelineBaselineV1 extends ImpactStoryTimelineTargetV1 {
  createdAt: number
}

interface ImpactStoryTimelineLineageV1 {
  replanRunId: number
  replanReceiptHash: string
  replanOutputHash: string
  planHash: string
  graphHash: string
  itemId: string
}

export interface ImpactStoryTimelineRegenerationCandidateV1 {
  version: 1
  kind: 'impact-story-timeline-regeneration-candidate'
  portable: false
  projectId: number
  worldId: number
  workId: number
  worldGroupId: number | null
  sourceChapterId: number
  targetChapterId: number
  targetEventId: number
  durableRunId: number
  item: ImpactRemediationItemV1
  lineage: ImpactStoryTimelineLineageV1
  dependencyProofs: ImpactDependencyProofV1[]
  dependencyProofHash: string
  targetBaseline: TargetTimelineBaselineV1
  targetBaselineHash: string
  sourceTextHash: string
  targetChapterTextHash: string
  contextManifestHash: string
  contextInputHash: string
  sourceContextHash: string
  promptTemplateHash: string
  promptHash: string
  modelOutputHash: string
  allowedEvidenceRefs: string[]
  result: ImpactStoryTimelineRegenerationResultV1
  resultHash: string
  candidateHash: string
}

interface ImpactStoryTimelineAdoptionIntentV1 {
  version: 1
  kind: 'impact-story-timeline-regeneration-adoption-intent'
  portable: false
  candidate: ImpactStoryTimelineRegenerationCandidateV1
  formal: Pick<ImpactStoryTimelineRegenerationResultV1, 'storyTime' | 'importance' | 'description'>
  formalHash: string
  intentHash: string
}

export interface ImpactStoryTimelineRegenerationCompletionV1 {
  snapshot: AgentRunSnapshotV1
  candidate: ImpactStoryTimelineRegenerationCandidateV1
  receiptHash: string
}

export type ImpactStoryTimelineRegenerationBoundaryV1 =
  | 'model.requested'
  | 'model.responded'
  | 'candidate.checkpoint'
  | 'candidate.persisted'

export type ImpactStoryTimelineRegenerationAdoptionBoundaryV1 =
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.written'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

interface PreparedInputV1 {
  worldGroupId: number | null
  sourceTextHash: string
  targetChapterTextHash: string
  targetBaseline: TargetTimelineBaselineV1
  targetBaselineHash: string
  assembled: Awaited<ReturnType<typeof assembleContext>>
  contextInputHash: string
  sourceContextHash: string
  promptTemplateHash: string
  promptHash: string
  allowedEvidenceRefs: string[]
  messages: ChatMessage[]
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalStringify(left) === canonicalStringify(right)
}

function exactKeys(row: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(row)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error(`${label}字段不在允许闭集。`)
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

function targetBaseline(row: Record<string, any>): TargetTimelineBaselineV1 {
  return {
    id: Number(row.id),
    title: String(row.title ?? ''),
    storyTime: String(row.storyTime ?? ''),
    importance: Number(row.importance),
    description: String(row.description ?? ''),
    chapterId: Number(row.chapterId),
    chapterTitle: String(row.chapterTitle ?? ''),
    order: Number(row.order),
    createdAt: Number(row.createdAt ?? 0),
  }
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

function sourceContextInput(assembled: Awaited<ReturnType<typeof assembleContext>>) {
  return (assembled.sourceEvidence ?? [])
    .filter(item => item.key === 'chapterContent')
    .map(item => ({ ...item }))
}

function assertEligibleItem(
  replan: ImpactPostCorrectionReplanResultV1,
  itemId: string,
): ImpactRemediationItemV1 {
  const item = replan.output.plan.items.find(candidate => candidate.id === itemId)
  const activeIds = new Set([...replan.output.remainingItemIds, ...replan.output.newItemIds])
  if (!item || !activeIds.has(item.id) || item.mode !== 'author-confirmed'
    || item.action !== 'review-derived-state' || item.kind !== 'timeline-event'
    || item.table !== 'storyTimelineEvents' || !Number.isInteger(item.recordId)
    || item.nodeId !== `timeline-event:${item.recordId}`) {
    throw new Error('当前 H57 plan 中不存在可重建的故事年表事件项。')
  }
  return item
}

export async function readImpactStoryTimelineRegenerationReadinessV1(input: {
  scope: WorkspaceScope
  expectedReplan: ImpactPostCorrectionReplanResultV1
  itemId: string
}): Promise<ImpactTargetReadinessV1> {
  const replan = await assertExpectedImpactReplanCurrentV1({
    scope: input.scope,
    expectedReplan: input.expectedReplan,
  })
  const item = assertEligibleItem(replan, input.itemId)
  return resolveImpactDependencyReadinessV1({ scope: input.scope, replan, item })
}

async function prepareInput(input: {
  scope: WorkspaceScope
  replan: ImpactPostCorrectionReplanResultV1
  item: ImpactRemediationItemV1
}): Promise<PreparedInputV1> {
  const source = await db.chapters.get(input.replan.output.sourceChapterId)
  if (!source || !await assertRecordInScope(input.scope, 'chapters', source, { owner: 'work' })) {
    throw new Error('年表重建的影响来源章节不存在或越界。')
  }
  const target = await db.storyTimelineEvents.get(input.item.recordId!)
  if (!target || !await assertRecordInScope(input.scope, 'storyTimelineEvents', target, { owner: 'work' })) {
    throw new Error('年表重建的目标事件不存在或越界。')
  }
  if (!Number.isInteger(target.chapterId) || (target.chapterId ?? 0) < 1) {
    throw new Error('年表重建目标没有有效章节绑定。')
  }
  const targetChapterId = target.chapterId as number
  const chapter = await db.chapters.get(targetChapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('年表重建目标章节不存在或越界。')
  }
  const outline = await db.outlineNodes.get(chapter.outlineNodeId)
  if (!outline || !await assertRecordInScope(input.scope, 'outlineNodes', outline, { owner: 'work' })) {
    throw new Error('年表重建目标章纲不存在或越界。')
  }
  const baseline = targetBaseline(target as Record<string, any>)
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    chapterId: baseline.chapterId,
    storyTimelineEventId: baseline.id,
    sourceKeys: [...IMPACT_STORY_TIMELINE_REGENERATION_CONTEXT_SOURCE_KEYS_V1],
    inputBudgetMaxTokens: 16_000,
  })
  for (const key of IMPACT_STORY_TIMELINE_REGENERATION_CONTEXT_SOURCE_KEYS_V1) {
    const evidence = assembled.sourceEvidence?.find(item => item.key === key)
    if (evidence?.status !== 'included' || evidence.delivery !== 'full') {
      throw new Error(`年表重建关键 Context “${key}”未无损进入模型。`)
    }
  }
  const allowedEvidenceRefs = [...new Set(assembled.segments.map(segment => segment.label))]
  const template = readImpactStoryTimelineRegenerationPromptTemplateV1()
  const messages = buildImpactStoryTimelineRegenerationMessagesV1({
    registeredContext: assembled.text,
    item: input.item,
    target: baseline,
    allowedEvidenceRefs,
    template,
  })
  const modelInput = messages.map(message => message.content).join('\n')
  const missing = assembled.segments.find(segment => !modelInput.includes(segment.content))
  if (missing) throw new Error(`年表重建登记来源“${missing.label}”未实际进入模型 Prompt。`)
  return {
    worldGroupId: outline.worldGroupId ?? null,
    sourceTextHash: await hashChapterText(source.content ?? ''),
    targetChapterTextHash: await hashChapterText(chapter.content ?? ''),
    targetBaseline: baseline,
    targetBaselineHash: await hashCanonicalValue(baseline),
    assembled,
    contextInputHash: await hashCanonicalValue(contextInput(assembled)),
    sourceContextHash: await hashCanonicalValue(sourceContextInput(assembled)),
    promptTemplateHash: await hashCanonicalValue(readImpactStoryTimelineRegenerationPromptTemplateSnapshotV1(template)),
    promptHash: await hashCanonicalValue(messages),
    allowedEvidenceRefs,
    messages,
  }
}

function contract(input: {
  scope: WorkspaceScope
  sourceChapterId: number
  targetChapterId: number
  targetEventId: number
  worldGroupId: number | null
  parent: ImpactPostCorrectionReplanResultV1
  relation: string
  dependencyProofHash: string
}) {
  const skill = getAgentSkillV1(IMPACT_STORY_TIMELINE_REGENERATION_SKILL_ID_V1, 'prose')
  return {
    version: 1 as const,
    objective: `根据 H57 当前影响计划重建故事年表事件 #${input.targetEventId}（依赖 ${input.dependencyProofHash}）`,
    workflowKind: 'generate-verify-revise' as const,
    lineage: { parent: {
      runId: input.parent.snapshot.run.id,
      receiptHash: input.parent.receiptHash,
      relation: input.relation,
      artifactHash: input.parent.output.outputHash,
    } },
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
      chapterIds: [...new Set([input.sourceChapterId, input.targetChapterId])],
    },
    permissions: {
      contextSourceKeys: [...IMPACT_STORY_TIMELINE_REGENERATION_CONTEXT_SOURCE_KEYS_V1],
      writeTargets: [{
        table: 'storyTimelineEvents',
        fields: ['storyTime', 'importance', 'description'],
        mode: 'author-confirmed' as const,
      }],
    },
    executionBindings: [{
      stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1,
      ...createAgentSkillExecutionBindingV1(skill),
    }],
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 16_000,
      maxOutputTokens: Math.min(skill.maxOutputTokens, 2_000),
      maxAttemptsPerStep: 1,
      maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'impact-story-timeline.candidate', kind: 'output-present' as const, required: true },
      { id: 'impact-story-timeline.dependencies', kind: 'deterministic-check' as const, required: true },
      { id: 'impact-story-timeline.author', kind: 'author-confirmed' as const, required: true },
      { id: 'impact-story-timeline.adoption', kind: 'adoption-committed' as const, required: true },
      { id: 'impact-story-timeline.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'impact-story-timeline.terminal',
      kind: 'terminal' as const,
      verifier: IMPACT_STORY_TIMELINE_REGENERATION_VERIFIER_SET_V1,
      criterionIds: [
        'impact-story-timeline.candidate',
        'impact-story-timeline.dependencies',
        'impact-story-timeline.author',
        'impact-story-timeline.adoption',
        'impact-story-timeline.post-state',
      ],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

function assertItem(value: unknown): asserts value is ImpactRemediationItemV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('年表重建影响项无效。')
  const row = value as Record<string, unknown>
  exactKeys(row, ['id', 'nodeId', 'kind', 'table', 'recordId', 'action', 'mode', 'reason', 'dependencyNodeIds'], '年表重建影响项 ')
  if (typeof row.id !== 'string' || typeof row.nodeId !== 'string' || row.kind !== 'timeline-event'
    || row.table !== 'storyTimelineEvents' || !Number.isInteger(row.recordId)
    || row.action !== 'review-derived-state' || row.mode !== 'author-confirmed'
    || typeof row.reason !== 'string' || !Array.isArray(row.dependencyNodeIds)
    || row.nodeId !== `timeline-event:${row.recordId}`) {
    throw new Error('年表重建影响项不完整。')
  }
}

function assertTargetBaseline(value: unknown): asserts value is TargetTimelineBaselineV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('年表目标 baseline 无效。')
  const row = value as Record<string, unknown>
  exactKeys(row, [
    'id', 'title', 'storyTime', 'importance', 'description',
    'chapterId', 'chapterTitle', 'order', 'createdAt',
  ], '年表目标 baseline ')
  if (!Number.isInteger(row.id) || (row.id as number) < 1
    || typeof row.title !== 'string' || !row.title.trim()
    || typeof row.storyTime !== 'string'
    || !Number.isInteger(row.importance) || (row.importance as number) < 1 || (row.importance as number) > 3
    || typeof row.description !== 'string'
    || !Number.isInteger(row.chapterId) || (row.chapterId as number) < 1
    || typeof row.chapterTitle !== 'string'
    || !Number.isInteger(row.order) || !Number.isFinite(row.createdAt)) {
    throw new Error('年表目标 baseline 不完整。')
  }
}

async function parseCandidate(value: unknown): Promise<ImpactStoryTimelineRegenerationCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('年表重建候选检查点无效。')
  const row = value as Record<string, any>
  exactKeys(row, [
    'version', 'kind', 'portable', 'projectId', 'worldId', 'workId', 'worldGroupId',
    'sourceChapterId', 'targetChapterId', 'targetEventId', 'durableRunId',
    'item', 'lineage', 'dependencyProofs', 'dependencyProofHash',
    'targetBaseline', 'targetBaselineHash', 'sourceTextHash', 'targetChapterTextHash',
    'contextManifestHash', 'contextInputHash', 'sourceContextHash',
    'promptTemplateHash', 'promptHash', 'modelOutputHash', 'allowedEvidenceRefs',
    'result', 'resultHash', 'candidateHash',
  ], '年表重建候选 ')
  if (row.version !== 1 || row.kind !== 'impact-story-timeline-regeneration-candidate' || row.portable !== false
    || ![
      row.projectId, row.worldId, row.workId, row.sourceChapterId,
      row.targetChapterId, row.targetEventId, row.durableRunId,
    ].every((id: unknown) => Number.isInteger(id) && (id as number) > 0)
    || !(row.worldGroupId == null || Number.isInteger(row.worldGroupId))
    || ![
      row.dependencyProofHash, row.targetBaselineHash, row.sourceTextHash, row.targetChapterTextHash,
      row.contextManifestHash, row.contextInputHash, row.sourceContextHash,
      row.promptTemplateHash, row.promptHash, row.modelOutputHash, row.resultHash, row.candidateHash,
    ].every(isHash)
    || !Array.isArray(row.dependencyProofs) || !Array.isArray(row.allowedEvidenceRefs)) {
    throw new Error('年表重建候选检查点不完整。')
  }
  assertItem(row.item)
  assertTargetBaseline(row.targetBaseline)
  row.dependencyProofs.forEach(assertImpactDependencyProofV1)
  if (await hashCanonicalValue(row.dependencyProofs) !== row.dependencyProofHash) {
    throw new Error('年表重建依赖证明 hash 不匹配。')
  }
  if (!row.lineage || typeof row.lineage !== 'object' || Array.isArray(row.lineage)) throw new Error('年表重建 lineage 无效。')
  exactKeys(row.lineage, ['replanRunId', 'replanReceiptHash', 'replanOutputHash', 'planHash', 'graphHash', 'itemId'], '年表重建 lineage ')
  if (!Number.isInteger(row.lineage.replanRunId)
    || ![row.lineage.replanReceiptHash, row.lineage.replanOutputHash, row.lineage.planHash, row.lineage.graphHash].every(isHash)
    || row.lineage.itemId !== row.item.id || row.targetEventId !== row.item.recordId
    || row.targetBaseline.id !== row.targetEventId || row.targetBaseline.chapterId !== row.targetChapterId
    || await hashCanonicalValue(row.targetBaseline) !== row.targetBaselineHash) {
    throw new Error('年表重建 lineage 或目标 baseline 不匹配。')
  }
  const result = parseImpactStoryTimelineRegenerationResultStrictV1(JSON.stringify(row.result), row.allowedEvidenceRefs)
  if (!sameValue(result, row.result) || await hashCanonicalValue(result) !== row.resultHash) {
    throw new Error('年表重建结果或 hash 不匹配。')
  }
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('年表重建候选 hash 不匹配。')
  return row as ImpactStoryTimelineRegenerationCandidateV1
}

async function parseState(value: unknown): Promise<{
  candidate: ImpactStoryTimelineRegenerationCandidateV1
  intent: ImpactStoryTimelineAdoptionIntentV1 | null
}> {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'impact-story-timeline-regeneration-adoption-intent') {
    const row = value as Record<string, any>
    exactKeys(row, ['version', 'kind', 'portable', 'candidate', 'formal', 'formalHash', 'intentHash'], '年表重建采纳意图 ')
    if (row.version !== 1 || row.portable !== false || !row.formal || !isHash(row.formalHash) || !isHash(row.intentHash)) {
      throw new Error('年表重建采纳意图不完整。')
    }
    const candidate = await parseCandidate(row.candidate)
    const formal = {
      storyTime: candidate.result.storyTime,
      importance: candidate.result.importance,
      description: candidate.result.description,
    }
    if (!sameValue(formal, row.formal) || await hashCanonicalValue(formal) !== row.formalHash) {
      throw new Error('年表重建冻结正式值与候选不匹配。')
    }
    const { intentHash, ...body } = row
    if (await hashCanonicalValue(body) !== intentHash) throw new Error('年表重建采纳意图 hash 不匹配。')
    return { candidate, intent: row as ImpactStoryTimelineAdoptionIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

async function latestState(scope: WorkspaceScope, runId: number) {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('年表重建运行缺少可信检查点。')
  return parseState(checkpoint.resumePayload)
}

async function repairCandidateEventIfNeeded(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: ImpactStoryTimelineRegenerationCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const step = snapshot.projection.steps[IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1]
  if (step?.candidateHash) return snapshot
  if (step?.status !== 'running') throw new Error('年表重建候选事件无法安全恢复。')
  return append(scope, snapshot, 'candidate.persisted', {
    stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
}

async function pauseUnsafeRun(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, reason: string) {
  if (['running', 'awaiting_confirmation'].includes(snapshot.projection.state)) {
    return append(scope, snapshot, 'run.paused', { reason, recoverable: false })
  }
  return snapshot
}

function assertCandidateScope(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: ImpactStoryTimelineRegenerationCandidateV1,
): void {
  if (candidate.projectId !== scope.projectId || candidate.worldId !== scope.worldId || candidate.workId !== scope.workId
    || snapshot.run.projectId !== scope.projectId || snapshot.run.id !== candidate.durableRunId
    || (snapshot.run.worldGroupId ?? null) !== candidate.worldGroupId
    || snapshot.contract.lineage?.parent.runId !== candidate.lineage.replanRunId
    || snapshot.contract.lineage.parent.receiptHash !== candidate.lineage.replanReceiptHash
    || snapshot.contract.lineage.parent.artifactHash !== candidate.lineage.replanOutputHash
    || snapshot.contract.executionBindings?.[0]?.stepId !== IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1) {
    throw new Error('年表重建候选与当前 Work 或 H57 lineage 不匹配。')
  }
  const target = snapshot.contract.permissions.writeTargets[0]
  if (snapshot.contract.permissions.writeTargets.length !== 1 || target.table !== 'storyTimelineEvents'
    || !sameValue(target.fields, ['storyTime', 'importance', 'description']) || target.mode !== 'author-confirmed') {
    throw new Error('年表重建 Run 写权限已损坏。')
  }
}

async function currentEvidence(
  scope: WorkspaceScope,
  candidate: ImpactStoryTimelineRegenerationCandidateV1,
  intent?: ImpactStoryTimelineAdoptionIntentV1 | null,
) {
  const currentReplan = await readCurrentImpactPostCorrectionReplanV1({
    scope,
    chapterId: candidate.sourceChapterId,
  }).catch(() => null)
  const lineageFresh = !!currentReplan
    && currentReplan.snapshot.run.id === candidate.lineage.replanRunId
    && currentReplan.receiptHash === candidate.lineage.replanReceiptHash
    && currentReplan.output.outputHash === candidate.lineage.replanOutputHash
    && currentReplan.output.plan.planHash === candidate.lineage.planHash
    && currentReplan.output.graph.graphHash === candidate.lineage.graphHash
  const item = currentReplan?.output.plan.items.find(row => row.id === candidate.item.id)
  const itemFresh = lineageFresh && !!item && sameValue(item, candidate.item)
  let dependencyFresh = false
  if (currentReplan && itemFresh && item) {
    try {
      const readiness = await resolveImpactDependencyReadinessV1({ scope, replan: currentReplan, item })
      dependencyFresh = readiness.ready
        && readiness.proofHash === candidate.dependencyProofHash
        && sameValue(readiness.proofs, candidate.dependencyProofs)
    } catch {
      dependencyFresh = false
    }
  }
  let prepared: PreparedInputV1 | null = null
  if (currentReplan && item) {
    try { prepared = await prepareInput({ scope, replan: currentReplan, item }) } catch { /* stale */ }
  }
  const currentTarget = await db.storyTimelineEvents.get(candidate.targetEventId)
  const target = currentTarget && await assertRecordInScope(scope, 'storyTimelineEvents', currentTarget, { owner: 'work' })
    ? targetBaseline(currentTarget as Record<string, any>)
    : null
  const targetOriginalFresh = !!target && sameValue(target, candidate.targetBaseline)
  const targetPostMatches = !!target && !!intent
    && target.id === candidate.targetBaseline.id
    && target.title === candidate.targetBaseline.title
    && target.chapterId === candidate.targetBaseline.chapterId
    && target.chapterTitle === candidate.targetBaseline.chapterTitle
    && target.order === candidate.targetBaseline.order
    && target.createdAt === candidate.targetBaseline.createdAt
    && target.storyTime === intent.formal.storyTime
    && target.importance === intent.formal.importance
    && target.description === intent.formal.description
  return {
    lineageFresh,
    itemFresh,
    dependencyFresh,
    prepared,
    sourceFresh: prepared?.sourceTextHash === candidate.sourceTextHash
      && prepared?.targetChapterTextHash === candidate.targetChapterTextHash
      && prepared?.sourceContextHash === candidate.sourceContextHash,
    contextFresh: prepared?.contextInputHash === candidate.contextInputHash,
    promptFresh: prepared?.promptHash === candidate.promptHash,
    templateFresh: prepared?.promptTemplateHash === candidate.promptTemplateHash,
    targetOriginalFresh,
    targetPostMatches,
    target,
  }
}

async function nextRelation(input: {
  scope: WorkspaceScope
  replan: ImpactPostCorrectionReplanResultV1
  itemId: string
}): Promise<string> {
  const itemHash = await hashCanonicalValue({ itemId: input.itemId })
  const prefix = `impact-story-timeline-regen:${input.replan.output.outputHash.slice(0, 24)}:${itemHash.slice(0, 24)}:`
  const rows = await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' })
  const count = rows.filter(row => row.parentRunId === input.replan.snapshot.run.id && row.parentRelation?.startsWith(prefix)).length
  return `${prefix}${count + 1}`
}

export async function generateImpactStoryTimelineRegenerationCandidateV1(input: {
  scope: WorkspaceScope
  expectedReplan: ImpactPostCorrectionReplanResultV1
  itemId: string
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (
    boundary: ImpactStoryTimelineRegenerationBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ImpactStoryTimelineRegenerationCandidateV1 }> {
  if (!input.runAI && !input.aiConfig) throw new Error('年表重建缺少 AI 配置。')
  const requestMeta = {
    category: 'story.timeline' as const,
    projectId: input.scope.projectId,
    configOverrides: { maxTokens: 2_000 },
    contextOverflowPolicy: 'reject' as const,
  }
  if (!input.runAI) {
    const effective = resolveRequestConfig(input.aiConfig!, requestMeta).config
    if (!isAIConfigReady(effective)) throw new Error(getAIConfigRequiredMessage(effective))
  }
  const replan = await assertExpectedImpactReplanCurrentV1({ scope: input.scope, expectedReplan: input.expectedReplan })
  const item = assertEligibleItem(replan, input.itemId)
  const readiness = await resolveImpactDependencyReadinessV1({ scope: input.scope, replan, item })
  if (!readiness.ready) throw new Error(`年表重建依赖未就绪：${readiness.blockers.join('；')}`)
  const prepared = await prepareInput({ scope: input.scope, replan, item })
  const relation = await nextRelation({ scope: input.scope, replan, itemId: item.id })
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    worldGroupId: prepared.worldGroupId,
    contract: contract({
      scope: input.scope,
      sourceChapterId: replan.output.sourceChapterId,
      targetChapterId: prepared.targetBaseline.chapterId,
      targetEventId: prepared.targetBaseline.id,
      worldGroupId: prepared.worldGroupId,
      parent: replan,
      relation,
      dependencyProofHash: readiness.proofHash,
    }),
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1, attempt: 1 })
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: prepared.worldGroupId,
    declaredSourceKeys: [...IMPACT_STORY_TIMELINE_REGENERATION_CONTEXT_SOURCE_KEYS_V1],
    assembled: prepared.assembled,
    boundary: { chapterId: prepared.targetBaseline.chapterId },
    readerVersion: 'impact-story-timeline-regeneration-context-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1,
    attempt: 1,
    manifestHash: manifest.manifestHash,
  })
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1,
    attempt: 1,
    bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]),
  })
  let raw: string
  try {
    await input.onDurableBoundary?.('model.requested', snapshot)
    raw = await (input.runAI
      ? input.runAI(prepared.messages)
      : chat(prepared.messages, input.aiConfig!, {
          category: 'story.timeline',
          projectId: input.scope.projectId,
          configOverrides: { maxTokens: 2_000 },
          contextOverflowPolicy: 'reject',
        }))
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'impact-story-timeline-model-outcome-unknown')
    throw error
  }
  snapshot = await append(input.scope, snapshot, 'model.responded', {
    stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1,
    attempt: 1,
    outputHash: await hashCanonicalValue({ raw }),
  })
  try {
    await input.onDurableBoundary?.('model.responded', snapshot)
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'impact-story-timeline-model-result-uncheckpointed')
    throw error
  }
  let result: ImpactStoryTimelineRegenerationResultV1
  try {
    result = parseImpactStoryTimelineRegenerationResultStrictV1(raw, prepared.allowedEvidenceRefs)
  } catch (error) {
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1,
      attempt: 1,
      code: 'impact-story-timeline-protocol-failed',
      retryable: false,
      category: 'protocol',
      action: 'fail',
    })
    await append(input.scope, snapshot, 'run.failed', { code: 'impact-story-timeline-protocol-failed', retryable: false })
    throw error
  }
  const lineage: ImpactStoryTimelineLineageV1 = {
    replanRunId: replan.snapshot.run.id,
    replanReceiptHash: replan.receiptHash,
    replanOutputHash: replan.output.outputHash,
    planHash: replan.output.plan.planHash,
    graphHash: replan.output.graph.graphHash,
    itemId: item.id,
  }
  const body = {
    version: 1 as const,
    kind: 'impact-story-timeline-regeneration-candidate' as const,
    portable: false as const,
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    worldGroupId: prepared.worldGroupId,
    sourceChapterId: replan.output.sourceChapterId,
    targetChapterId: prepared.targetBaseline.chapterId,
    targetEventId: prepared.targetBaseline.id,
    durableRunId: snapshot.run.id,
    item,
    lineage,
    dependencyProofs: readiness.proofs,
    dependencyProofHash: readiness.proofHash,
    targetBaseline: prepared.targetBaseline,
    targetBaselineHash: prepared.targetBaselineHash,
    sourceTextHash: prepared.sourceTextHash,
    targetChapterTextHash: prepared.targetChapterTextHash,
    contextManifestHash: manifest.manifestHash,
    contextInputHash: prepared.contextInputHash,
    sourceContextHash: prepared.sourceContextHash,
    promptTemplateHash: prepared.promptTemplateHash,
    promptHash: prepared.promptHash,
    modelOutputHash: await hashCanonicalValue({ raw }),
    allowedEvidenceRefs: prepared.allowedEvidenceRefs,
    result,
    resultHash: await hashCanonicalValue(result),
  }
  const candidate: ImpactStoryTimelineRegenerationCandidateV1 = { ...body, candidateHash: await hashCanonicalValue(body) }
  const saved = await createAgentRunCheckpointV1({
    scope: input.scope,
    runId: snapshot.run.id,
    resumePayload: candidate,
  })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
  await input.onDurableBoundary?.('candidate.persisted', snapshot)
  return { snapshot, candidate }
}

function isImpactStoryTimelineRun(row: AgentRunRecord): boolean {
  return row.parentRelation?.startsWith('impact-story-timeline-regen:') === true
    && row.contractJson.includes(IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1)
}

export async function readPendingImpactStoryTimelineRegenerationCandidateV1(input: {
  scope: WorkspaceScope
  sourceChapterId: number
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ImpactStoryTimelineRegenerationCandidateV1 } | null> {
  const replan = await readCurrentImpactPostCorrectionReplanV1({ scope: input.scope, chapterId: input.sourceChapterId })
  if (!replan) return null
  const rows = (await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => row.parentRunId === replan.snapshot.run.id
      && ['running', 'awaiting_confirmation'].includes(row.status)
      && isImpactStoryTimelineRun(row))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      let snapshot = await readAgentRunV1(input.scope, row.id)
      const state = await latestState(input.scope, row.id)
      assertCandidateScope(input.scope, snapshot, state.candidate)
      snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, state.candidate)
      const evidence = await currentEvidence(input.scope, state.candidate)
      if (snapshot.projection.state === 'awaiting_confirmation' && !state.intent
        && evidence.lineageFresh && evidence.itemFresh && evidence.dependencyFresh && evidence.sourceFresh
        && evidence.contextFresh && evidence.promptFresh && evidence.templateFresh && evidence.targetOriginalFresh) {
        return { snapshot, candidate: state.candidate }
      }
    } catch {
      // Damaged or stale candidates remain auditable but are never offered.
    }
  }
  return null
}

async function writeFormalAtomic(
  scope: WorkspaceScope,
  candidate: ImpactStoryTimelineRegenerationCandidateV1,
  intent: ImpactStoryTimelineAdoptionIntentV1,
): Promise<void> {
  await db.transaction('rw', scopeTransactionTables(db.chapters, db.storyTimelineEvents), async () => {
    const source = await db.chapters.get(candidate.sourceChapterId)
    const targetChapter = await db.chapters.get(candidate.targetChapterId)
    const target = await db.storyTimelineEvents.get(candidate.targetEventId)
    if (!source || !await assertRecordInScope(scope, 'chapters', source, { owner: 'work' })
      || await Dexie.waitFor(hashChapterText(source.content ?? '')) !== candidate.sourceTextHash) {
      throw new Error('年表重建 CAS 失败：影响来源正文已变化。')
    }
    if (!targetChapter || !await assertRecordInScope(scope, 'chapters', targetChapter, { owner: 'work' })
      || await Dexie.waitFor(hashChapterText(targetChapter.content ?? '')) !== candidate.targetChapterTextHash) {
      throw new Error('年表重建 CAS 失败：目标章节正文已变化。')
    }
    if (!target || !await assertRecordInScope(scope, 'storyTimelineEvents', target, { owner: 'work' })
      || !sameValue(targetBaseline(target as Record<string, any>), candidate.targetBaseline)) {
      throw new Error('年表重建 CAS 失败：目标事件已变化。')
    }
    const result = await adopt({
      projectId: scope.projectId,
      scope,
      recordId: candidate.targetEventId,
      target: 'storyTimelineEvents',
      mode: 'merge-diffs',
      data: intent.formal,
    })
    if (result.written.length !== 1 || result.unknown.length || result.typeErrors.length
      || result.fkErrors.length || result.skipped.length) {
      throw new Error(`年表重建未完整通过注册表：${result.skipped[0]?.reason ?? '字段校验失败'}。`)
    }
  })
}

function hasEvent(snapshot: AgentRunSnapshotV1, type: string): boolean {
  return snapshot.events.some(event => event.type === type)
}

export async function adoptImpactStoryTimelineRegenerationCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  onDurableBoundary?: (
    boundary: ImpactStoryTimelineRegenerationAdoptionBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<ImpactStoryTimelineRegenerationCompletionV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate
  let intent = state.intent
  assertCandidateScope(input.scope, snapshot, candidate)
  snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
  let evidence = await currentEvidence(input.scope, candidate, intent)
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && intent) {
    if (!evidence.lineageFresh || !evidence.itemFresh || !evidence.dependencyFresh || !evidence.sourceFresh
      || !evidence.templateFresh || !evidence.targetPostMatches) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope,
        runId: snapshot.run.id,
        reason: 'impact-story-timeline-terminal-evidence-stale',
      })
      throw new Error('年表重建完成回执已过期。')
    }
    return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash }
  }
  if (snapshot.projection.state === 'awaiting_confirmation' && !intent) {
    if (!evidence.lineageFresh || !evidence.itemFresh || !evidence.dependencyFresh || !evidence.sourceFresh
      || !evidence.contextFresh || !evidence.promptFresh || !evidence.templateFresh || !evidence.targetOriginalFresh) {
      snapshot = await append(input.scope, snapshot, 'candidate.staled', {
        stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: 'impact-story-timeline-source-target-context-or-parent-changed',
      })
      throw new Error('来源、目标、登记 Context、Prompt 或 H57 plan 已变化，请重新生成。')
    }
    const formal = {
      storyTime: candidate.result.storyTime,
      importance: candidate.result.importance,
      description: candidate.result.description,
    }
    const body = {
      version: 1 as const,
      kind: 'impact-story-timeline-regeneration-adoption-intent' as const,
      portable: false as const,
      candidate,
      formal,
      formalHash: await hashCanonicalValue(formal),
    }
    intent = { ...body, intentHash: await hashCanonicalValue(body) }
    const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent })
    snapshot = saved.snapshot
    await input.onDurableBoundary?.('intent.checkpoint', snapshot)
  }
  if (!intent) throw new Error('年表重建缺少冻结采纳意图。')
  if (snapshot.projection.steps[IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1]?.confirmation !== 'adopt') {
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
  }
  if (!hasEvent(snapshot, 'adoption.started')) {
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      intentHash: intent.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  }
  evidence = await currentEvidence(input.scope, candidate, intent)
  if (!evidence.lineageFresh || !evidence.itemFresh || !evidence.dependencyFresh || !evidence.sourceFresh || !evidence.templateFresh
    || (!evidence.targetPostMatches && (!evidence.contextFresh || !evidence.promptFresh))) {
    await pauseUnsafeRun(input.scope, snapshot, 'impact-story-timeline-source-or-parent-changed-after-confirmation')
    throw new Error('确认后来源 Context、Prompt 模板或 H57 plan 已变化，正式写入已停止。')
  }
  if (!evidence.targetPostMatches) {
    if (!evidence.targetOriginalFresh) {
      await pauseUnsafeRun(input.scope, snapshot, 'impact-story-timeline-target-diverged')
      throw new Error('确认后目标事件已变化，正式写入已停止。')
    }
    await writeFormalAtomic(input.scope, candidate, intent)
    await input.onDurableBoundary?.('formal.written', snapshot)
  }
  if (!hasEvent(snapshot, 'adoption.committed')) {
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      adoptionHash: await hashCanonicalValue({
        intentHash: intent.intentHash,
        table: 'storyTimelineEvents',
        recordId: candidate.targetEventId,
        formal: intent.formal,
      }),
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  if (snapshot.projection.steps[IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1]?.status !== 'succeeded') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1,
      attempt: 1,
      outputHash: candidate.resultHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state !== 'verifying' && !snapshot.projection.terminalReceiptHash) {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: IMPACT_STORY_TIMELINE_REGENERATION_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  evidence = await currentEvidence(input.scope, candidate, intent)
  if (!evidence.lineageFresh || !evidence.itemFresh || !evidence.dependencyFresh || !evidence.sourceFresh
    || !evidence.templateFresh || !evidence.targetPostMatches) {
    await pauseUnsafeRun(input.scope, snapshot, 'impact-story-timeline-terminal-evidence-stale')
    throw new Error('年表重建终验时父计划、来源或正式事件已变化。')
  }
  const postStateHash = await hashCanonicalValue({
    table: 'storyTimelineEvents',
    recordId: candidate.targetEventId,
    formal: intent.formal,
    parentArtifactHash: candidate.lineage.replanOutputHash,
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
    verifierSetVersion: IMPACT_STORY_TIMELINE_REGENERATION_VERIFIER_SET_V1,
    lineage: {
      runId: candidate.lineage.replanRunId,
      receiptHash: candidate.lineage.replanReceiptHash,
      relation: snapshot.run.parentRelation!,
      artifactHash: candidate.lineage.replanOutputHash,
    },
    criteria: [
      { id: 'impact-story-timeline.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'impact-story-timeline.dependencies', status: 'passed', evidenceRefs: [`dependencies:${candidate.dependencyProofHash}`] },
      { id: 'impact-story-timeline.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'impact-story-timeline.adoption', status: 'passed', evidenceRefs: [`formal:${intent.formalHash}`] },
      { id: 'impact-story-timeline.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, candidate, receiptHash: receipt.receiptHash }
}

export async function rejectImpactStoryTimelineRegenerationCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate, intent } = await latestState(input.scope, input.runId)
  assertCandidateScope(input.scope, snapshot, candidate)
  snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
  if (snapshot.projection.state !== 'awaiting_confirmation' || intent) {
    throw new Error('年表重建候选不在可拒绝状态。')
  }
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: IMPACT_STORY_TIMELINE_REGENERATION_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    decision: 'reject',
  })
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-impact-story-timeline-regeneration' })
}

export async function readCompletedImpactStoryTimelineRegenerationsV1(input: {
  scope: WorkspaceScope
  sourceChapterId: number
}): Promise<ImpactStoryTimelineRegenerationCompletionV1[]> {
  const replan = await readCurrentImpactPostCorrectionReplanV1({ scope: input.scope, chapterId: input.sourceChapterId })
  if (!replan) return []
  const rows = (await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => row.parentRunId === replan.snapshot.run.id && row.status === 'completed' && isImpactStoryTimelineRun(row))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  const completed: ImpactStoryTimelineRegenerationCompletionV1[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row.id) continue
    try {
      let snapshot = await readAgentRunV1(input.scope, row.id)
      const state = await latestState(input.scope, row.id)
      assertCandidateScope(input.scope, snapshot, state.candidate)
      if (!state.intent || !snapshot.projection.terminalReceiptHash || seen.has(state.candidate.item.id)) continue
      const evidence = await currentEvidence(input.scope, state.candidate, state.intent)
      if (!evidence.lineageFresh || !evidence.itemFresh || !evidence.dependencyFresh || !evidence.sourceFresh
        || !evidence.templateFresh || !evidence.targetPostMatches) {
        snapshot = await staleAgentRunVerificationV1({
          scope: input.scope,
          runId: row.id,
          reason: 'impact-story-timeline-completion-stale',
        })
        continue
      }
      seen.add(state.candidate.item.id)
      completed.push({ snapshot, candidate: state.candidate, receiptHash: snapshot.projection.terminalReceiptHash })
    } catch {
      // Damaged historical completions remain auditable but are not current evidence.
    }
  }
  return completed
}
