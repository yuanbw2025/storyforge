import Dexie from 'dexie'
import { chat, resolveRequestConfig } from '../../ai/client'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../ai/config-readiness'
import { hashChapterText } from '../../ai/chapter-memory/text-normalization'
import { db } from '../../db/schema'
import {
  buildImpactOutlineRegenerationMessagesV1,
  parseImpactOutlineRegenerationResultStrictV1,
  readImpactOutlineRegenerationPromptTemplateSnapshotV1,
  readImpactOutlineRegenerationPromptTemplateV1,
  type ImpactOutlineRegenerationResultV1,
} from '../../consistency/impact-outline-regeneration'
import type { ImpactRemediationItemV1 } from '../../consistency/impact-remediation-plan'
import { assembleContext } from '../../registry/assemble-context'
import { adopt } from '../../registry/adopt'
import type { AIConfig, ChatMessage, WorkspaceScope } from '../../types'
import type { AgentRunRecord } from '../../types/agent-run'
import {
  assertRecordInScope,
  readOwnedRows,
  scopeTransactionTables,
} from '../../world-engine/scope'
import { createAgentSkillExecutionBindingV1 } from '../execution-binding'
import {
  getAgentSkillV1,
  OUTLINE_IMPACT_REGENERATION_CONTEXT_SOURCE_KEYS,
} from '../skill-registry'
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
  readCurrentImpactPostCorrectionReplanV1,
  type ImpactPostCorrectionReplanResultV1,
} from './impact-post-correction-replan-durable'
import { createVerificationReceiptV1 } from './verification-receipt'

export const IMPACT_OUTLINE_REGENERATION_STEP_ID_V1 = 'impact-remediation:outline-regenerate' as const
export const IMPACT_OUTLINE_REGENERATION_SKILL_ID_V1 = 'outline.impact-summary-regenerate' as const
export const IMPACT_OUTLINE_REGENERATION_VERIFIER_SET_V1 = 'impact-outline-regeneration-terminal-v1' as const
export const IMPACT_OUTLINE_REGENERATION_CONTEXT_SOURCE_KEYS_V1 = OUTLINE_IMPACT_REGENERATION_CONTEXT_SOURCE_KEYS

type RunAI = (messages: ChatMessage[]) => Promise<string>

interface TargetOutlineBaselineV1 {
  id: number
  title: string
  summary: string
  type: string
  parentId: number | null
  worldGroupId: number | null
  locked: boolean
}

interface ImpactOutlineRegenerationLineageV1 {
  replanRunId: number
  replanReceiptHash: string
  replanOutputHash: string
  planHash: string
  graphHash: string
  itemId: string
}

export interface ImpactOutlineRegenerationCandidateV1 {
  version: 1
  kind: 'impact-outline-regeneration-candidate'
  portable: false
  projectId: number
  worldId: number
  workId: number
  worldGroupId: number | null
  sourceChapterId: number
  targetOutlineNodeId: number
  durableRunId: number
  item: ImpactRemediationItemV1
  lineage: ImpactOutlineRegenerationLineageV1
  targetBaseline: TargetOutlineBaselineV1
  targetBaselineHash: string
  sourceTextHash: string
  contextManifestHash: string
  contextInputHash: string
  sourceContextHash: string
  promptTemplateHash: string
  promptHash: string
  modelOutputHash: string
  allowedEvidenceRefs: string[]
  result: ImpactOutlineRegenerationResultV1
  resultHash: string
  candidateHash: string
}

interface ImpactOutlineRegenerationAdoptionIntentV1 {
  version: 1
  kind: 'impact-outline-regeneration-adoption-intent'
  portable: false
  candidate: ImpactOutlineRegenerationCandidateV1
  summary: string
  summaryHash: string
  intentHash: string
}

export interface ImpactOutlineRegenerationCompletionV1 {
  snapshot: AgentRunSnapshotV1
  candidate: ImpactOutlineRegenerationCandidateV1
  receiptHash: string
}

export type ImpactOutlineRegenerationBoundaryV1 =
  | 'model.requested'
  | 'model.responded'
  | 'candidate.checkpoint'
  | 'candidate.persisted'

export type ImpactOutlineRegenerationAdoptionBoundaryV1 =
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.written'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

interface PreparedInputV1 {
  sourceTextHash: string
  targetBaseline: TargetOutlineBaselineV1
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

function targetBaseline(row: Record<string, any>): TargetOutlineBaselineV1 {
  return {
    id: row.id,
    title: row.title ?? '',
    summary: row.summary ?? '',
    type: row.type ?? '',
    parentId: row.parentId ?? null,
    worldGroupId: row.worldGroupId ?? null,
    locked: row.locked === true,
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
  // `chapterOutline` and written progress project the target summary. After the
  // expected adoption those registered sources must change, so terminal
  // freshness is anchored to non-target upstream evidence while the target is
  // checked separately against the frozen post-state. Adjacent outlines exclude
  // the current target and therefore remain valid upstream evidence.
  const keys = new Set([
    'chapterContent',
    'adjacentChapterOutlines',
    'canonAssertions',
    'storyCore',
    'characters',
    'storyArcs',
    'consistencyReport',
  ])
  return (assembled.sourceEvidence ?? [])
    .filter(item => keys.has(item.key))
    .map(item => ({ ...item }))
}

function assertEligibleItem(
  replan: ImpactPostCorrectionReplanResultV1,
  itemId: string,
): ImpactRemediationItemV1 {
  const item = replan.output.plan.items.find(candidate => candidate.id === itemId)
  const activeIds = new Set([
    ...replan.output.remainingItemIds,
    ...replan.output.newItemIds,
  ])
  if (!item || !activeIds.has(item.id) || item.mode !== 'author-confirmed'
    || item.action !== 'review-outline' || item.kind !== 'outline'
    || item.table !== 'outlineNodes' || !Number.isInteger(item.recordId)) {
    throw new Error('当前 H57 plan 中不存在可生成式重建的后续章纲摘要项。')
  }
  return item
}

async function assertExpectedReplanCurrent(input: {
  scope: WorkspaceScope
  expectedReplan: ImpactPostCorrectionReplanResultV1
}): Promise<ImpactPostCorrectionReplanResultV1> {
  const { outputHash, ...body } = input.expectedReplan.output
  if (await hashCanonicalValue(body) !== outputHash) throw new Error('H57 重规划输出已损坏。')
  const current = await readCurrentImpactPostCorrectionReplanV1({
    scope: input.scope,
    chapterId: input.expectedReplan.output.sourceChapterId,
  })
  if (!current
    || current.snapshot.run.id !== input.expectedReplan.snapshot.run.id
    || current.receiptHash !== input.expectedReplan.receiptHash
    || current.output.outputHash !== input.expectedReplan.output.outputHash) {
    throw new Error('H57 重规划已过期，请先恢复当前影响计划。')
  }
  return current
}

async function prepareInput(input: {
  scope: WorkspaceScope
  replan: ImpactPostCorrectionReplanResultV1
  item: ImpactRemediationItemV1
}): Promise<PreparedInputV1> {
  const source = await db.chapters.get(input.replan.output.sourceChapterId)
  if (!source || !await assertRecordInScope(input.scope, 'chapters', source, { owner: 'work' })) {
    throw new Error('生成式重建的来源章节不存在或越界。')
  }
  const target = await db.outlineNodes.get(input.item.recordId!)
  if (!target || !await assertRecordInScope(input.scope, 'outlineNodes', target, { owner: 'work' })) {
    throw new Error('生成式重建的目标章纲不存在或越界。')
  }
  if (target.id === source.outlineNodeId || target.type !== 'chapter') {
    throw new Error('生成式重建当前只允许选择受影响的后续章纲摘要。')
  }
  const baseline = targetBaseline(target as Record<string, any>)
  if (baseline.locked) throw new Error('目标章纲已锁定，不能生成重建候选。')
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    worldGroupId: baseline.worldGroupId,
    chapterId: source.id,
    outlineNodeId: target.id,
    sourceKeys: [...IMPACT_OUTLINE_REGENERATION_CONTEXT_SOURCE_KEYS_V1],
    inputBudgetMaxTokens: 32_000,
  })
  for (const key of ['chapterContent', 'chapterOutline'] as const) {
    const evidence = assembled.sourceEvidence?.find(item => item.key === key)
    if (evidence?.status !== 'included' || evidence.delivery !== 'full') {
      throw new Error(`生成式重建关键 Context “${key}”未无损进入模型。`)
    }
  }
  const allowedEvidenceRefs = [...new Set(assembled.segments.map(segment => segment.label))]
  const template = readImpactOutlineRegenerationPromptTemplateV1()
  const messages = buildImpactOutlineRegenerationMessagesV1({
    registeredContext: assembled.text,
    item: input.item,
    targetTitle: baseline.title,
    allowedEvidenceRefs,
    template,
  })
  const modelInput = messages.map(message => message.content).join('\n')
  const missing = assembled.segments.find(segment => !modelInput.includes(segment.content))
  if (missing) throw new Error(`生成式重建登记来源“${missing.label}”未实际进入模型 Prompt。`)
  return {
    sourceTextHash: await hashChapterText(source.content ?? ''),
    targetBaseline: baseline,
    targetBaselineHash: await hashCanonicalValue(baseline),
    assembled,
    contextInputHash: await hashCanonicalValue(contextInput(assembled)),
    sourceContextHash: await hashCanonicalValue(sourceContextInput(assembled)),
    promptTemplateHash: await hashCanonicalValue(readImpactOutlineRegenerationPromptTemplateSnapshotV1(template)),
    promptHash: await hashCanonicalValue(messages),
    allowedEvidenceRefs,
    messages,
  }
}

function contract(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  sourceChapterId: number
  targetOutlineNodeId: number
  parent: ImpactPostCorrectionReplanResultV1
  relation: string
}) {
  const skill = getAgentSkillV1(IMPACT_OUTLINE_REGENERATION_SKILL_ID_V1, 'outline')
  return {
    version: 1 as const,
    objective: `根据 H57 当前影响计划重建后续章纲 #${input.targetOutlineNodeId} 的摘要候选`,
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
      chapterIds: [input.sourceChapterId],
      outlineNodeIds: [input.targetOutlineNodeId],
    },
    permissions: {
      contextSourceKeys: [...IMPACT_OUTLINE_REGENERATION_CONTEXT_SOURCE_KEYS_V1],
      writeTargets: [{ table: 'outlineNodes', fields: ['summary'], mode: 'author-confirmed' as const }],
    },
    executionBindings: [{
      stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1,
      ...createAgentSkillExecutionBindingV1(skill),
    }],
    budget: {
      maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 32_000,
      maxOutputTokens: skill.maxOutputTokens, maxAttemptsPerStep: 1, maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'impact-outline.candidate', kind: 'output-present' as const, required: true },
      { id: 'impact-outline.author', kind: 'author-confirmed' as const, required: true },
      { id: 'impact-outline.adoption', kind: 'adoption-committed' as const, required: true },
      { id: 'impact-outline.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'impact-outline.terminal', kind: 'terminal' as const,
      verifier: IMPACT_OUTLINE_REGENERATION_VERIFIER_SET_V1,
      criterionIds: ['impact-outline.candidate', 'impact-outline.author', 'impact-outline.adoption', 'impact-outline.post-state'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

function isImpactOutlineRegenerationRun(row: AgentRunRecord): boolean {
  return row.contractJson.includes(IMPACT_OUTLINE_REGENERATION_SKILL_ID_V1)
}

function assertItem(value: unknown): asserts value is ImpactRemediationItemV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('生成式重建影响项无效。')
  const row = value as Record<string, unknown>
  exactKeys(row, ['id', 'nodeId', 'kind', 'table', 'recordId', 'action', 'mode', 'reason', 'dependencyNodeIds'], '生成式重建影响项 ')
  if (typeof row.id !== 'string' || typeof row.nodeId !== 'string' || row.kind !== 'outline'
    || row.table !== 'outlineNodes' || !Number.isInteger(row.recordId)
    || row.action !== 'review-outline' || row.mode !== 'author-confirmed'
    || typeof row.reason !== 'string' || !Array.isArray(row.dependencyNodeIds)) {
    throw new Error('生成式重建影响项不完整。')
  }
}

function assertTargetBaseline(value: unknown): asserts value is TargetOutlineBaselineV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('目标章纲 baseline 无效。')
  const row = value as Record<string, unknown>
  exactKeys(row, ['id', 'title', 'summary', 'type', 'parentId', 'worldGroupId', 'locked'], '目标章纲 baseline ')
  if (!Number.isInteger(row.id) || typeof row.title !== 'string' || typeof row.summary !== 'string'
    || row.type !== 'chapter' || !(row.parentId == null || Number.isInteger(row.parentId))
    || !(row.worldGroupId == null || Number.isInteger(row.worldGroupId)) || typeof row.locked !== 'boolean') {
    throw new Error('目标章纲 baseline 不完整。')
  }
}

async function parseCandidate(value: unknown): Promise<ImpactOutlineRegenerationCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('生成式重建候选检查点无效。')
  const row = value as Record<string, any>
  exactKeys(row, [
    'version', 'kind', 'portable', 'projectId', 'worldId', 'workId', 'worldGroupId',
    'sourceChapterId', 'targetOutlineNodeId', 'durableRunId', 'item', 'lineage', 'targetBaseline',
    'targetBaselineHash', 'sourceTextHash', 'contextManifestHash', 'contextInputHash',
    'sourceContextHash', 'promptTemplateHash', 'promptHash', 'modelOutputHash',
    'allowedEvidenceRefs', 'result', 'resultHash', 'candidateHash',
  ], '生成式重建候选 ')
  if (row.version !== 1 || row.kind !== 'impact-outline-regeneration-candidate' || row.portable !== false
    || ![row.projectId, row.worldId, row.workId, row.sourceChapterId, row.targetOutlineNodeId, row.durableRunId]
      .every((id: unknown) => Number.isInteger(id) && (id as number) > 0)
    || !(row.worldGroupId == null || Number.isInteger(row.worldGroupId))
    || ![
      row.targetBaselineHash, row.sourceTextHash, row.contextManifestHash, row.contextInputHash,
      row.sourceContextHash, row.promptTemplateHash, row.promptHash, row.modelOutputHash,
      row.resultHash, row.candidateHash,
    ].every(isHash)
    || !Array.isArray(row.allowedEvidenceRefs)) throw new Error('生成式重建候选检查点不完整。')
  assertItem(row.item)
  assertTargetBaseline(row.targetBaseline)
  if (!row.lineage || typeof row.lineage !== 'object' || Array.isArray(row.lineage)) throw new Error('生成式重建 lineage 无效。')
  exactKeys(row.lineage, ['replanRunId', 'replanReceiptHash', 'replanOutputHash', 'planHash', 'graphHash', 'itemId'], '生成式重建 lineage ')
  if (!Number.isInteger(row.lineage.replanRunId)
    || ![row.lineage.replanReceiptHash, row.lineage.replanOutputHash, row.lineage.planHash, row.lineage.graphHash].every(isHash)
    || row.lineage.itemId !== row.item.id || row.targetOutlineNodeId !== row.item.recordId
    || row.targetBaseline.id !== row.targetOutlineNodeId
    || await hashCanonicalValue(row.targetBaseline) !== row.targetBaselineHash) {
    throw new Error('生成式重建 lineage 或目标 baseline 不匹配。')
  }
  const result = parseImpactOutlineRegenerationResultStrictV1(JSON.stringify(row.result), row.allowedEvidenceRefs)
  if (!sameValue(result, row.result) || await hashCanonicalValue(result) !== row.resultHash) {
    throw new Error('生成式重建结果或 hash 不匹配。')
  }
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('生成式重建候选 hash 不匹配。')
  return row as ImpactOutlineRegenerationCandidateV1
}

async function parseState(value: unknown): Promise<{
  candidate: ImpactOutlineRegenerationCandidateV1
  intent: ImpactOutlineRegenerationAdoptionIntentV1 | null
}> {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'impact-outline-regeneration-adoption-intent') {
    const row = value as Record<string, any>
    exactKeys(row, ['version', 'kind', 'portable', 'candidate', 'summary', 'summaryHash', 'intentHash'], '生成式重建采纳意图 ')
    if (row.version !== 1 || row.portable !== false || typeof row.summary !== 'string'
      || !isHash(row.summaryHash) || !isHash(row.intentHash)) throw new Error('生成式重建采纳意图不完整。')
    const candidate = await parseCandidate(row.candidate)
    if (row.summary !== candidate.result.summary || await hashCanonicalValue({ summary: row.summary }) !== row.summaryHash) {
      throw new Error('生成式重建冻结摘要与候选不匹配。')
    }
    const { intentHash, ...body } = row
    if (await hashCanonicalValue(body) !== intentHash) throw new Error('生成式重建采纳意图 hash 不匹配。')
    return { candidate, intent: row as ImpactOutlineRegenerationAdoptionIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

async function latestState(scope: WorkspaceScope, runId: number) {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('生成式重建运行缺少可信检查点。')
  return parseState(checkpoint.resumePayload)
}

async function repairCandidateEventIfNeeded(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: ImpactOutlineRegenerationCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const step = snapshot.projection.steps[IMPACT_OUTLINE_REGENERATION_STEP_ID_V1]
  if (step?.candidateHash) return snapshot
  if (step?.status !== 'running') throw new Error('生成式重建候选事件无法安全恢复。')
  return append(scope, snapshot, 'candidate.persisted', {
    stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1,
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
  candidate: ImpactOutlineRegenerationCandidateV1,
): void {
  if (candidate.projectId !== scope.projectId || candidate.worldId !== scope.worldId || candidate.workId !== scope.workId
    || snapshot.run.projectId !== scope.projectId
    || snapshot.run.id !== candidate.durableRunId
    || snapshot.contract.lineage?.parent.runId !== candidate.lineage.replanRunId
    || snapshot.contract.lineage.parent.receiptHash !== candidate.lineage.replanReceiptHash
    || snapshot.contract.lineage.parent.artifactHash !== candidate.lineage.replanOutputHash
    || snapshot.contract.executionBindings?.[0]?.stepId !== IMPACT_OUTLINE_REGENERATION_STEP_ID_V1) {
    throw new Error('生成式重建候选与当前 Work 或 H57 lineage 不匹配。')
  }
  const target = snapshot.contract.permissions.writeTargets[0]
  if (snapshot.contract.permissions.writeTargets.length !== 1 || target.table !== 'outlineNodes'
    || !sameValue(target.fields, ['summary']) || target.mode !== 'author-confirmed') {
    throw new Error('生成式重建 Run 写权限已损坏。')
  }
}

async function currentEvidence(
  scope: WorkspaceScope,
  candidate: ImpactOutlineRegenerationCandidateV1,
  intent?: ImpactOutlineRegenerationAdoptionIntentV1 | null,
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
  let prepared: PreparedInputV1 | null = null
  if (currentReplan && item) {
    try { prepared = await prepareInput({ scope, replan: currentReplan, item }) } catch { /* stale */ }
  }
  const currentTarget = await db.outlineNodes.get(candidate.targetOutlineNodeId)
  const target = currentTarget && await assertRecordInScope(scope, 'outlineNodes', currentTarget, { owner: 'work' })
    ? targetBaseline(currentTarget as Record<string, any>)
    : null
  const targetOriginalFresh = !!target && sameValue(target, candidate.targetBaseline)
  const targetPostMatches = !!target && !!intent
    && target.id === candidate.targetOutlineNodeId
    && target.title === candidate.targetBaseline.title
    && target.type === candidate.targetBaseline.type
    && target.parentId === candidate.targetBaseline.parentId
    && target.worldGroupId === candidate.targetBaseline.worldGroupId
    && !target.locked
    && target.summary === intent.summary
  return {
    lineageFresh,
    itemFresh,
    prepared,
    sourceFresh: prepared?.sourceTextHash === candidate.sourceTextHash
      && prepared?.sourceContextHash === candidate.sourceContextHash,
    contextFresh: prepared?.contextInputHash === candidate.contextInputHash,
    promptFresh: prepared?.promptTemplateHash === candidate.promptTemplateHash
      && prepared?.promptHash === candidate.promptHash,
    templateFresh: prepared?.promptTemplateHash === candidate.promptTemplateHash,
    targetOriginalFresh,
    targetPostMatches,
  }
}

async function nextRelation(input: {
  scope: WorkspaceScope
  replan: ImpactPostCorrectionReplanResultV1
  itemId: string
}): Promise<string> {
  const itemHash = await hashCanonicalValue({ itemId: input.itemId })
  const prefix = `impact-outline-regen:${input.replan.output.outputHash.slice(0, 24)}:${itemHash.slice(0, 24)}:`
  const rows = await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' })
  const count = rows.filter(row => row.parentRunId === input.replan.snapshot.run.id && row.parentRelation?.startsWith(prefix)).length
  return `${prefix}${count + 1}`
}

export async function generateImpactOutlineRegenerationCandidateV1(input: {
  scope: WorkspaceScope
  expectedReplan: ImpactPostCorrectionReplanResultV1
  itemId: string
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (
    boundary: ImpactOutlineRegenerationBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ImpactOutlineRegenerationCandidateV1 }> {
  if (!input.runAI && !input.aiConfig) throw new Error('生成式重建缺少 AI 配置。')
  const requestMeta = {
    category: 'outline.impact-regenerate' as const,
    projectId: input.scope.projectId,
    configOverrides: { maxTokens: getAgentSkillV1(IMPACT_OUTLINE_REGENERATION_SKILL_ID_V1).maxOutputTokens },
    contextOverflowPolicy: 'reject' as const,
  }
  if (!input.runAI) {
    const effective = resolveRequestConfig(input.aiConfig!, requestMeta).config
    if (!isAIConfigReady(effective)) throw new Error(getAIConfigRequiredMessage(effective))
  }
  const replan = await assertExpectedReplanCurrent({ scope: input.scope, expectedReplan: input.expectedReplan })
  const item = assertEligibleItem(replan, input.itemId)
  const prepared = await prepareInput({ scope: input.scope, replan, item })
  const relation = await nextRelation({ scope: input.scope, replan, itemId: item.id })
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    worldGroupId: prepared.targetBaseline.worldGroupId,
    contract: contract({
      scope: input.scope,
      worldGroupId: prepared.targetBaseline.worldGroupId,
      sourceChapterId: replan.output.sourceChapterId,
      targetOutlineNodeId: item.recordId!,
      parent: replan,
      relation,
    }),
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1, attempt: 1 })
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: prepared.targetBaseline.worldGroupId,
    declaredSourceKeys: [...IMPACT_OUTLINE_REGENERATION_CONTEXT_SOURCE_KEYS_V1],
    assembled: prepared.assembled,
    boundary: { chapterId: replan.output.sourceChapterId, outlineNodeId: item.recordId! },
    readerVersion: 'impact-outline-regeneration-context-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1,
    attempt: 1,
    manifestHash: manifest.manifestHash,
  })
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1,
    attempt: 1,
    bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]),
  })
  let raw: string
  try {
    await input.onDurableBoundary?.('model.requested', snapshot)
    raw = await (input.runAI
      ? input.runAI(prepared.messages)
      : chat(prepared.messages, input.aiConfig!, {
          category: 'outline.impact-regenerate',
          projectId: input.scope.projectId,
          configOverrides: { maxTokens: getAgentSkillV1(IMPACT_OUTLINE_REGENERATION_SKILL_ID_V1).maxOutputTokens },
          contextOverflowPolicy: 'reject',
        }))
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'impact-outline-model-outcome-unknown')
    throw error
  }
  snapshot = await append(input.scope, snapshot, 'model.responded', {
    stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1,
    attempt: 1,
    outputHash: await hashCanonicalValue({ raw }),
  })
  try {
    await input.onDurableBoundary?.('model.responded', snapshot)
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'impact-outline-model-result-uncheckpointed')
    throw error
  }
  let result: ImpactOutlineRegenerationResultV1
  try {
    result = parseImpactOutlineRegenerationResultStrictV1(raw, prepared.allowedEvidenceRefs)
  } catch (error) {
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1,
      attempt: 1,
      code: 'impact-outline-protocol-failed', retryable: false, category: 'protocol', action: 'fail',
    })
    await append(input.scope, snapshot, 'run.failed', { code: 'impact-outline-protocol-failed', retryable: false })
    throw error
  }
  const lineage: ImpactOutlineRegenerationLineageV1 = {
    replanRunId: replan.snapshot.run.id,
    replanReceiptHash: replan.receiptHash,
    replanOutputHash: replan.output.outputHash,
    planHash: replan.output.plan.planHash,
    graphHash: replan.output.graph.graphHash,
    itemId: item.id,
  }
  const body = {
    version: 1 as const,
    kind: 'impact-outline-regeneration-candidate' as const,
    portable: false as const,
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    worldGroupId: prepared.targetBaseline.worldGroupId,
    sourceChapterId: replan.output.sourceChapterId,
    targetOutlineNodeId: item.recordId!,
    durableRunId: snapshot.run.id,
    item,
    lineage,
    targetBaseline: prepared.targetBaseline,
    targetBaselineHash: prepared.targetBaselineHash,
    sourceTextHash: prepared.sourceTextHash,
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
  const candidate: ImpactOutlineRegenerationCandidateV1 = { ...body, candidateHash: await hashCanonicalValue(body) }
  const saved = await createAgentRunCheckpointV1({
    scope: input.scope,
    runId: snapshot.run.id,
    resumePayload: candidate,
  })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
  await input.onDurableBoundary?.('candidate.persisted', snapshot)
  return { snapshot, candidate }
}

export async function readPendingImpactOutlineRegenerationCandidateV1(input: {
  scope: WorkspaceScope
  sourceChapterId: number
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ImpactOutlineRegenerationCandidateV1 } | null> {
  const replan = await readCurrentImpactPostCorrectionReplanV1({ scope: input.scope, chapterId: input.sourceChapterId })
  if (!replan) return null
  const rows = (await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => row.parentRunId === replan.snapshot.run.id
      && ['running', 'awaiting_confirmation'].includes(row.status)
      && isImpactOutlineRegenerationRun(row))
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
        && evidence.lineageFresh && evidence.itemFresh && evidence.sourceFresh
        && evidence.contextFresh && evidence.promptFresh && evidence.targetOriginalFresh) {
        return { snapshot, candidate: state.candidate }
      }
    } catch {
      // Damaged or stale candidates remain auditable but are never offered.
    }
  }
  return null
}

async function writeSummaryAtomic(
  scope: WorkspaceScope,
  candidate: ImpactOutlineRegenerationCandidateV1,
  intent: ImpactOutlineRegenerationAdoptionIntentV1,
): Promise<void> {
  await db.transaction('rw', scopeTransactionTables(db.chapters, db.outlineNodes), async () => {
    const source = await db.chapters.get(candidate.sourceChapterId)
    const target = await db.outlineNodes.get(candidate.targetOutlineNodeId)
    if (!source || !await assertRecordInScope(scope, 'chapters', source, { owner: 'work' })
      || await Dexie.waitFor(hashChapterText(source.content ?? '')) !== candidate.sourceTextHash) {
      throw new Error('生成式重建 CAS 失败：来源正文已变化。')
    }
    if (!target || !await assertRecordInScope(scope, 'outlineNodes', target, { owner: 'work' })
      || !sameValue(targetBaseline(target as Record<string, any>), candidate.targetBaseline)) {
      throw new Error('生成式重建 CAS 失败：目标章纲已变化。')
    }
    const result = await adopt({
      projectId: scope.projectId,
      scope,
      recordId: candidate.targetOutlineNodeId,
      target: 'outlineNodes',
      mode: 'merge-diffs',
      data: { summary: intent.summary },
    })
    if (result.written.length !== 1 || result.unknown.length || result.typeErrors.length
      || result.fkErrors.length || result.skipped.length) {
      throw new Error(`生成式重建摘要未完整通过注册表：${result.skipped[0]?.reason ?? '字段校验失败'}。`)
    }
  })
}

function hasEvent(snapshot: AgentRunSnapshotV1, type: string): boolean {
  return snapshot.events.some(event => event.type === type)
}

export async function adoptImpactOutlineRegenerationCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  onDurableBoundary?: (
    boundary: ImpactOutlineRegenerationAdoptionBoundaryV1,
    snapshot: AgentRunSnapshotV1,
  ) => void | Promise<void>
}): Promise<ImpactOutlineRegenerationCompletionV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate
  let intent = state.intent
  assertCandidateScope(input.scope, snapshot, candidate)
  snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
  let evidence = await currentEvidence(input.scope, candidate, intent)
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && intent) {
    if (!evidence.lineageFresh || !evidence.itemFresh || !evidence.sourceFresh
      || !evidence.templateFresh || !evidence.targetPostMatches) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope, runId: snapshot.run.id, reason: 'impact-outline-terminal-evidence-stale',
      })
      throw new Error('生成式重建完成回执已过期。')
    }
    return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash }
  }
  if (snapshot.projection.state === 'awaiting_confirmation' && !intent) {
    if (!evidence.lineageFresh || !evidence.itemFresh || !evidence.sourceFresh
      || !evidence.contextFresh || !evidence.promptFresh || !evidence.targetOriginalFresh) {
      snapshot = await append(input.scope, snapshot, 'candidate.staled', {
        stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: 'impact-outline-source-target-context-or-parent-changed',
      })
      throw new Error('来源、目标、登记 Context、Prompt 或 H57 plan 已变化，请重新生成。')
    }
    const body = {
      version: 1 as const,
      kind: 'impact-outline-regeneration-adoption-intent' as const,
      portable: false as const,
      candidate,
      summary: candidate.result.summary,
      summaryHash: await hashCanonicalValue({ summary: candidate.result.summary }),
    }
    intent = { ...body, intentHash: await hashCanonicalValue(body) }
    const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent })
    snapshot = saved.snapshot
    await input.onDurableBoundary?.('intent.checkpoint', snapshot)
  }
  if (!intent) throw new Error('生成式重建缺少冻结采纳意图。')
  if (snapshot.projection.steps[IMPACT_OUTLINE_REGENERATION_STEP_ID_V1]?.confirmation !== 'adopt') {
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
  }
  if (!hasEvent(snapshot, 'adoption.started')) {
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      intentHash: intent.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  }
  evidence = await currentEvidence(input.scope, candidate, intent)
  if (!evidence.lineageFresh || !evidence.itemFresh || !evidence.sourceFresh || !evidence.templateFresh
    || (!evidence.targetPostMatches && (!evidence.contextFresh || !evidence.promptFresh))) {
    await pauseUnsafeRun(input.scope, snapshot, 'impact-outline-source-or-parent-changed-after-confirmation')
    throw new Error('确认后来源 Context、Prompt 模板或 H57 plan 已变化，正式写入已停止。')
  }
  if (!evidence.targetPostMatches) {
    if (!evidence.targetOriginalFresh) {
      await pauseUnsafeRun(input.scope, snapshot, 'impact-outline-target-diverged')
      throw new Error('确认后目标章纲已变化，正式写入已停止。')
    }
    await writeSummaryAtomic(input.scope, candidate, intent)
    await input.onDurableBoundary?.('formal.written', snapshot)
  }
  if (!hasEvent(snapshot, 'adoption.committed')) {
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      adoptionHash: await hashCanonicalValue({
        intentHash: intent.intentHash,
        table: 'outlineNodes',
        recordId: candidate.targetOutlineNodeId,
        summary: intent.summary,
      }),
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  if (snapshot.projection.steps[IMPACT_OUTLINE_REGENERATION_STEP_ID_V1]?.status !== 'succeeded') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1,
      attempt: 1,
      outputHash: candidate.resultHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state !== 'verifying' && !snapshot.projection.terminalReceiptHash) {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: IMPACT_OUTLINE_REGENERATION_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  evidence = await currentEvidence(input.scope, candidate, intent)
  if (!evidence.lineageFresh || !evidence.itemFresh || !evidence.sourceFresh
    || !evidence.templateFresh || !evidence.targetPostMatches) {
    await pauseUnsafeRun(input.scope, snapshot, 'impact-outline-terminal-evidence-stale')
    throw new Error('生成式重建终验时父计划、来源或正式摘要已变化。')
  }
  const postStateHash = await hashCanonicalValue({
    table: 'outlineNodes',
    recordId: candidate.targetOutlineNodeId,
    summary: intent.summary,
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
    verifierSetVersion: IMPACT_OUTLINE_REGENERATION_VERIFIER_SET_V1,
    lineage: {
      runId: candidate.lineage.replanRunId,
      receiptHash: candidate.lineage.replanReceiptHash,
      relation: snapshot.run.parentRelation!,
      artifactHash: candidate.lineage.replanOutputHash,
    },
    criteria: [
      { id: 'impact-outline.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'impact-outline.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'impact-outline.adoption', status: 'passed', evidenceRefs: [`summary:${intent.summaryHash}`] },
      { id: 'impact-outline.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, candidate, receiptHash: receipt.receiptHash }
}

export async function rejectImpactOutlineRegenerationCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate, intent } = await latestState(input.scope, input.runId)
  assertCandidateScope(input.scope, snapshot, candidate)
  snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
  if (snapshot.projection.state !== 'awaiting_confirmation' || intent) {
    throw new Error('生成式重建候选不在可拒绝状态。')
  }
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: IMPACT_OUTLINE_REGENERATION_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    decision: 'reject',
  })
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-impact-outline-regeneration' })
}

export async function readCompletedImpactOutlineRegenerationsV1(input: {
  scope: WorkspaceScope
  sourceChapterId: number
}): Promise<ImpactOutlineRegenerationCompletionV1[]> {
  const replan = await readCurrentImpactPostCorrectionReplanV1({ scope: input.scope, chapterId: input.sourceChapterId })
  if (!replan) return []
  const rows = (await readOwnedRows<AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => row.parentRunId === replan.snapshot.run.id && row.status === 'completed'
      && isImpactOutlineRegenerationRun(row))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  const completed: ImpactOutlineRegenerationCompletionV1[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row.id) continue
    try {
      let snapshot = await readAgentRunV1(input.scope, row.id)
      const state = await latestState(input.scope, row.id)
      assertCandidateScope(input.scope, snapshot, state.candidate)
      if (!state.intent || !snapshot.projection.terminalReceiptHash || seen.has(state.candidate.item.id)) continue
      const evidence = await currentEvidence(input.scope, state.candidate, state.intent)
      if (!evidence.lineageFresh || !evidence.itemFresh || !evidence.sourceFresh
        || !evidence.templateFresh || !evidence.targetPostMatches) {
        snapshot = await staleAgentRunVerificationV1({
          scope: input.scope, runId: row.id, reason: 'impact-outline-completion-stale',
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
