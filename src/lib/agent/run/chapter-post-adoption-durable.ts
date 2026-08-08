import { db } from '../../db/schema'
import {
  getChapterDerivedMemoryStatus,
  hashChapterText,
} from '../../ai/chapter-memory/text-normalization'
import type { ContextManifestV1, VerificationReceiptV1 } from '../../types/agent-run'
import type { WorkspaceScope } from '../../types'
import type { ChapterOrganizationCandidate } from '../chapter-organization'
import {
  getAgentSkillV1,
  resolveAgentSkillContextSourceKeysV1,
} from '../skill-registry'
import {
  assertAgentSkillExecutionBindingV1,
  createAgentSkillExecutionBindingV1,
} from '../execution-binding'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunChildV1,
  readCurrentAgentRunParentV1,
  readAgentRunV1,
  staleAgentRunVerificationV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { PROSE_GENERATION_VERIFIER_SET_V1, PROSE_GENERATION_VERIFIER_SET_V2, PROSE_GENERATION_VERIFIER_SET_V3 } from './prose-generation-durable'
import { createVerificationReceiptV1 } from './verification-receipt'
import { hashCanonicalValue } from './hash'
import { verifyContextManifestIntegrityV1 } from './context-manifest'
import {
  assertRecordInScope,
  readOwnedRows,
} from '../../world-engine/scope'

/**
 * HARNESS-20: one durable barrier for the work that follows prose adoption.
 * The organization step reuses ChapterOrganization's parser and adoption
 * implementation; this module only owns orchestration evidence and the
 * terminal receipt for the whole downstream chain.
 */
export const CHAPTER_POST_ADOPTION_STEP_IDS_V1 = {
  retrieval: 'chapter-post-adoption:retrieval',
  organization: 'chapter-post-adoption:organization',
  memory: 'chapter-post-adoption:memory',
} as const

export type ChapterPostAdoptionStepIdV1 = typeof CHAPTER_POST_ADOPTION_STEP_IDS_V1[keyof typeof CHAPTER_POST_ADOPTION_STEP_IDS_V1]

const ORGANIZATION_SKILL_V1 = getAgentSkillV1('prose.organize', 'prose')
const MEMORY_SKILL_V1 = getAgentSkillV1('prose.memory', 'prose')
const PROSE_TERMINAL_VERIFIERS_V1 = new Set<string>([
  PROSE_GENERATION_VERIFIER_SET_V1,
  PROSE_GENERATION_VERIFIER_SET_V2,
  PROSE_GENERATION_VERIFIER_SET_V3,
])

export const CHAPTER_POST_ADOPTION_SOURCE_KEYS_V1 = Object.freeze([...new Set([
  ...resolveAgentSkillContextSourceKeysV1(ORGANIZATION_SKILL_V1),
  ...resolveAgentSkillContextSourceKeysV1(MEMORY_SKILL_V1),
])])

/** Context authorization is declared per executable step, not as one union
 * manifest reused by unrelated readers. */
export const CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1 = Object.freeze({
  retrieval: Object.freeze(['chapterContent', 'characters']),
  organization: Object.freeze(resolveAgentSkillContextSourceKeysV1(ORGANIZATION_SKILL_V1)),
  memory: Object.freeze(resolveAgentSkillContextSourceKeysV1(MEMORY_SKILL_V1)),
})

function sourceKeysForStep(stepId: ChapterPostAdoptionStepIdV1): readonly string[] {
  if (stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization) return CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.organization
  if (stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory) return CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.memory
  return CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.retrieval
}

export const CHAPTER_POST_ADOPTION_VERIFIER_SET_V1 = 'chapter-post-adoption-terminal-v1'
export const CHAPTER_POST_ADOPTION_PARENT_RELATION_V1 = 'prose-post-adoption'

export type ChapterPostAdoptionChainStateV1 =
  | 'prose-completed'
  | 'downstream-processing'
  | 'downstream-awaiting-confirmation'
  | 'downstream-failed'
  | 'downstream-completed'
  | 'upstream-invalid'
  | 'legacy-unlinked'

export interface ChapterPostAdoptionDurableEvidenceV1 {
  runId: number
  stepId: typeof CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization
  attempt: number
  contextManifestHash: string
  candidateHash: string
}

function stepIds(): ChapterPostAdoptionStepIdV1[] {
  return Object.values(CHAPTER_POST_ADOPTION_STEP_IDS_V1)
}

function append(
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

function assertChapterPostAdoptionExecutionBindingsV1(snapshot: AgentRunSnapshotV1): void {
  const bindings = new Map((snapshot.contract.executionBindings ?? []).map(binding => [binding.stepId, binding]))
  const organization = bindings.get(CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization)
  const memory = bindings.get(CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory)
  if (!organization || !memory) throw new Error('正文后处理缺少 Skill/Prompt 执行绑定。')
  const { stepId: _organizationStepId, ...organizationBinding } = organization
  const { stepId: _memoryStepId, ...memoryBinding } = memory
  assertAgentSkillExecutionBindingV1(organizationBinding, ORGANIZATION_SKILL_V1, '章节六域整理执行绑定')
  assertAgentSkillExecutionBindingV1(memoryBinding, MEMORY_SKILL_V1, '章节记忆执行绑定')
}

export function buildChapterPostAdoptionRunContractV1(input: {
  projectId: number
  worldGroupId: number | null
  chapterId: number
  parent?: {
    runId: number
    receiptHash: string
    artifactHash: string
  }
}) {
  return {
    version: 1 as const,
    objective: `完成章节 #${input.chapterId} 正文采纳后的检索、六域交接与章节记忆派生处理`,
    workflowKind: 'multi-domain-sequential' as const,
    ...(input.parent ? { lineage: {
      parent: {
        runId: input.parent.runId,
        receiptHash: input.parent.receiptHash,
        relation: CHAPTER_POST_ADOPTION_PARENT_RELATION_V1,
        artifactHash: input.parent.artifactHash,
      },
    } } : {}),
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      chapterIds: [input.chapterId],
    },
    permissions: {
      contextSourceKeys: [...CHAPTER_POST_ADOPTION_SOURCE_KEYS_V1],
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
        { table: 'stateCards', fields: ['category', 'entityName', 'fields', 'lastChapterId'], mode: 'author-confirmed' as const },
        { table: 'temporalFacts', fields: [], mode: 'author-confirmed' as const, adoptionExtension: 'fact-ledger' },
        { table: 'itemLedger', fields: ['itemName', 'action', 'quantity', 'heldByName', 'characterId', 'chapterId', 'chapterTitle', 'note'], mode: 'author-confirmed' as const },
        { table: 'storyTimelineEvents', fields: ['title', 'storyTime', 'importance', 'description', 'chapterId', 'chapterTitle', 'order'], mode: 'author-confirmed' as const },
        { table: 'characterRelations', fields: ['fromCharacterId', 'toCharacterId', 'relationType', 'label', 'description', 'isBidirectional'], mode: 'author-confirmed' as const },
        { table: 'foreshadows', fields: ['status', 'plantChapterId', 'echoChapterIds', 'resolveChapterId', 'notes'], mode: 'author-confirmed' as const },
      ],
    },
    executionBindings: [
      {
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
        ...createAgentSkillExecutionBindingV1(ORGANIZATION_SKILL_V1),
      },
      {
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
        ...createAgentSkillExecutionBindingV1(MEMORY_SKILL_V1),
      },
    ],
    budget: {
      maxModelCalls: 2,
      maxToolCalls: 0,
      maxInputTokens: 48_000,
      maxOutputTokens: 16_000,
      maxAttemptsPerStep: 2,
      maxProtocolErrors: 1,
    },
    acceptance: [
      { id: 'chapter-post-adoption.retrieval', kind: 'deterministic-check' as const, required: true },
      { id: 'chapter-post-adoption.organization', kind: 'author-confirmed' as const, required: true },
      { id: 'chapter-post-adoption.memory', kind: 'adoption-committed' as const, required: true },
      { id: 'chapter-post-adoption.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'chapter-post-adoption.terminal',
      kind: 'terminal' as const,
      verifier: CHAPTER_POST_ADOPTION_VERIFIER_SET_V1,
      criterionIds: [
        'chapter-post-adoption.retrieval',
        'chapter-post-adoption.organization',
        'chapter-post-adoption.memory',
        'chapter-post-adoption.post-state',
      ],
    }],
    failurePolicy: {
      onProtocolError: 'retry' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

export async function createChapterPostAdoptionDurableRunV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  chapterId: number
  parent?: {
    runId: number
    receiptHash: string
    artifactHash: string
  }
}): Promise<AgentRunSnapshotV1> {
  const chapter = await db.chapters.get(input.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('正文后处理创建前找不到来源章节。')
  }
  if (input.parent && await hashChapterText(chapter.content ?? '') !== input.parent.artifactHash) {
    throw new Error('正文后处理创建前发现正文已脱离父 Run 的采纳产物。')
  }
  if (input.parent) {
    const parent = await readAgentRunV1(input.scope, input.parent.runId)
    if (
      parent.projection.state !== 'completed'
      || parent.projection.terminalReceiptHash !== input.parent.receiptHash
      || parent.contract.scope.chapterIds?.length !== 1
      || parent.contract.scope.chapterIds[0] !== input.chapterId
      || !parent.contract.verificationPlan.some(step => (
        step.kind === 'terminal'
        && PROSE_TERMINAL_VERIFIERS_V1.has(step.verifier)
      ))
    ) {
      throw new Error('正文后处理父 Run 不是当前章节的已完成正文生成 Run。')
    }
    const existing = await readAgentRunChildV1({
      scope: input.scope,
      parentRunId: input.parent.runId,
      relation: CHAPTER_POST_ADOPTION_PARENT_RELATION_V1,
    })
    if (existing) {
      const existingParent = existing.contract.lineage?.parent
      if (existingParent?.receiptHash !== input.parent.receiptHash
        || existingParent.artifactHash !== input.parent.artifactHash) {
        throw new Error('正文后处理已有子 Run，但父回执或产物 hash 不一致。')
      }
      return existing
    }
  }
  try {
    return await createAgentRunV1({
      scope: input.scope,
      worldGroupId: input.worldGroupId,
      contract: buildChapterPostAdoptionRunContractV1({
        projectId: input.scope.projectId,
        worldGroupId: input.worldGroupId,
        chapterId: input.chapterId,
        parent: input.parent,
      }),
    })
  } catch (error) {
    // A second tab may win the unique lineage race after the read above.
    if (input.parent && error instanceof Error && error.name === 'ConstraintError') {
      const raced = await readAgentRunChildV1({
        scope: input.scope,
        parentRunId: input.parent.runId,
        relation: CHAPTER_POST_ADOPTION_PARENT_RELATION_V1,
      })
      if (raced) return raced
    }
    throw error
  }
}

async function assertChapterPostAdoptionLineageCurrentV1(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
): Promise<void> {
  const lineage = snapshot.contract.lineage?.parent
  if (!lineage) return
  await readCurrentAgentRunParentV1(scope, snapshot)
  const chapterId = snapshot.contract.scope.chapterIds?.[0]
  const chapter = chapterId == null ? null : await db.chapters.get(chapterId)
  if (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('正文后处理父子链找不到来源章节。')
  }
  if (!lineage.artifactHash || await hashChapterText(chapter.content ?? '') !== lineage.artifactHash) {
    throw new Error('正文后处理父子链的正文产物已经变化。')
  }
}

export function chapterPostAdoptionChainStateV1(
  snapshot: AgentRunSnapshotV1 | null,
): ChapterPostAdoptionChainStateV1 {
  if (!snapshot?.contract.lineage?.parent) return 'legacy-unlinked'
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash) return 'downstream-completed'
  const steps = Object.values(snapshot.projection.steps)
  if (snapshot.projection.state === 'awaiting_confirmation' || steps.some(step => step.status === 'awaiting_confirmation')) {
    return 'downstream-awaiting-confirmation'
  }
  if (
    snapshot.projection.state === 'failed'
    || snapshot.projection.state === 'paused'
    || snapshot.projection.state === 'recovery_required'
    || steps.some(step => step.status === 'failed' || step.status === 'stale')
  ) {
    return 'downstream-failed'
  }
  return 'downstream-processing'
}

export async function readChapterPostAdoptionChainStatusV1(input: {
  scope: WorkspaceScope
  parentRunId: number
}): Promise<{
  state: ChapterPostAdoptionChainStateV1
  parent: AgentRunSnapshotV1
  child: AgentRunSnapshotV1 | null
}> {
  const parent = await readAgentRunV1(input.scope, input.parentRunId)
  const child = await readAgentRunChildV1({
    scope: input.scope,
    parentRunId: input.parentRunId,
    relation: CHAPTER_POST_ADOPTION_PARENT_RELATION_V1,
  })
  if (parent.projection.state !== 'completed' || !parent.projection.terminalReceiptHash) {
    return { state: 'upstream-invalid', parent, child }
  }
  if (!child) return { state: 'prose-completed', parent, child: null }
  try {
    const currentParent = await readCurrentAgentRunParentV1(input.scope, child)
    const chapterId = child.contract.scope.chapterIds?.[0]
    const chapter = chapterId == null ? null : await db.chapters.get(chapterId)
    if (!currentParent || !chapter || await hashChapterText(chapter.content ?? '') !== child.contract.lineage?.parent.artifactHash) {
      return { state: 'upstream-invalid', parent, child }
    }
  } catch {
    return { state: 'upstream-invalid', parent, child }
  }
  return { state: chapterPostAdoptionChainStateV1(child), parent, child }
}

/** Find the newest linked post-adoption child for a chapter after refresh. */
export async function readLatestChapterPostAdoptionRunV1(input: {
  scope: WorkspaceScope
  chapterId: number
}): Promise<AgentRunSnapshotV1 | null> {
  const rows = await db.agentRuns
    .where('projectId').equals(input.scope.projectId)
    .reverse().sortBy('updatedAt')
  for (const row of rows) {
    if (row.parentRelation !== CHAPTER_POST_ADOPTION_PARENT_RELATION_V1 || row.id == null) continue
    try {
      const snapshot = await readAgentRunV1(input.scope, row.id)
      if (snapshot.contract.scope.chapterIds?.includes(input.chapterId)) return snapshot
    } catch {
      // A corrupt/foreign row must not hide a later valid child run.
    }
  }
  return null
}

export async function scheduleChapterPostAdoptionStepsV1(input: {
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

export async function beginChapterPostAdoptionStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  stepId: ChapterPostAdoptionStepIdV1
  contextManifest: ContextManifestV1
  binding?: unknown
  model?: boolean
}): Promise<AgentRunSnapshotV1> {
  await assertChapterPostAdoptionLineageCurrentV1(input.scope, input.snapshot)
  if (input.contextManifest.runId !== input.snapshot.run.id || input.contextManifest.stepId !== input.stepId) {
    throw new Error('正文后处理 Context Manifest 与 durable step 不匹配。')
  }
  if (
    input.contextManifest.scope.projectId !== input.snapshot.contract.scope.projectId
    || input.contextManifest.scope.worldGroupId !== input.snapshot.contract.scope.worldGroupId
  ) throw new Error('正文后处理 Context Manifest 与运行作用域不匹配。')
  const expectedSourceKeys = sourceKeysForStep(input.stepId)
  const actualSourceKeys = input.contextManifest.sources.map(source => source.key)
  if (
    actualSourceKeys.length !== expectedSourceKeys.length
    || expectedSourceKeys.some((key, index) => actualSourceKeys[index] !== key)
  ) throw new Error(`正文后处理 step ${input.stepId} Context Manifest 来源不匹配。`)
  if (!await verifyContextManifestIntegrityV1(input.contextManifest)) {
    throw new Error(`正文后处理 step ${input.stepId} Context Manifest 完整性校验失败。`)
  }
  const step = input.snapshot.projection.steps[input.stepId]
  if (!step || !['scheduled', 'failed'].includes(step.status)) throw new Error(`正文后处理 step ${input.stepId} 当前不可启动。`)
  const attempt = step.status === 'scheduled' ? 1 : step.attempt + 1
  if (input.contextManifest.attempt !== attempt) {
    throw new Error(`正文后处理 step ${input.stepId} Context Manifest attempt 不匹配。`)
  }
  if (input.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory) {
    const organization = input.snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization]
    if (!organization || organization.status === 'scheduled') {
      throw new Error('正文后处理章节记忆必须在六域整理尝试之后启动。')
    }
  }
  if (input.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval) {
    const memory = input.snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory]
    if (!memory || memory.status !== 'succeeded') {
      throw new Error('正文后处理检索重建必须在章节记忆成功之后启动。')
    }
  }
  let snapshot = await append(input.scope, input.snapshot, 'step.started', { stepId: input.stepId, attempt })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: input.stepId,
    attempt,
    manifestHash: input.contextManifest.manifestHash,
  })
  if (input.model !== false) {
    snapshot = await append(input.scope, snapshot, 'model.requested', {
      stepId: input.stepId,
      attempt,
      bindingHash: await hashCanonicalValue({ stepId: input.stepId, binding: input.binding ?? null }),
    })
  }
  return snapshot
}

export async function recordChapterPostAdoptionOutputV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  stepId: ChapterPostAdoptionStepIdV1
  output: unknown
  candidateHash?: string
  requiresConfirmation?: boolean
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[input.stepId]
  if (!step || step.status !== 'running' || step.attempt < 1) {
    throw new Error(`正文后处理 step ${input.stepId} 不在运行状态。`)
  }
  let snapshot = await append(input.scope, input.snapshot, 'model.responded', {
    stepId: input.stepId,
    attempt: step.attempt,
    outputHash: await hashCanonicalValue(input.output),
  })
  if (input.candidateHash) {
    snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
      stepId: input.stepId,
      attempt: step.attempt,
      candidateHash: input.candidateHash,
      requiresConfirmation: input.requiresConfirmation ?? false,
    })
  }
  return snapshot
}

/** Recover the candidate-event/ledger crash window without another model call. */
export async function recoverChapterPostAdoptionOrganizationV1(input: {
  scope: WorkspaceScope
  candidate: ChapterOrganizationCandidate & { durable: ChapterPostAdoptionDurableEvidenceV1 }
}): Promise<AgentRunSnapshotV1 | null> {
  const chapter = await db.chapters.get(input.candidate.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) return null
  if (await hashChapterText(chapter.content ?? '') !== input.candidate.sourceTextHash) return null
  let snapshot = await readAgentRunV1(input.scope, input.candidate.durable.runId)
  assertChapterPostAdoptionExecutionBindingsV1(snapshot)
  await assertChapterPostAdoptionLineageCurrentV1(input.scope, snapshot)
  const step = snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization]
  if (!step) return null
  if (step.status === 'running' && !step.candidateHash) {
    snapshot = await recordChapterPostAdoptionOutputV1({
      scope: input.scope,
      snapshot,
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
      output: input.candidate,
      candidateHash: input.candidate.durable.candidateHash,
      requiresConfirmation: true,
    })
  }
  const recovered = snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization]
  return (recovered?.status === 'awaiting_confirmation' || recovered?.status === 'running' || recovered?.status === 'failed')
    && recovered.candidateHash === input.candidate.durable.candidateHash
    ? snapshot
    : null
}

export async function succeedChapterPostAdoptionStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  stepId: ChapterPostAdoptionStepIdV1
  output: unknown
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[input.stepId]
  if (!step || step.status !== 'running') throw new Error(`正文后处理 step ${input.stepId} 不在运行状态。`)
  return append(input.scope, input.snapshot, 'step.succeeded', {
    stepId: input.stepId,
    attempt: step.attempt,
    outputHash: await hashCanonicalValue(input.output),
  })
}

export async function failChapterPostAdoptionStepV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  stepId: ChapterPostAdoptionStepIdV1
  code: string
  retryable?: boolean
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[input.stepId]
  if (!step || !['running', 'scheduled'].includes(step.status)) return input.snapshot
  let snapshot = input.snapshot
  if (step.status === 'scheduled') {
    snapshot = await append(input.scope, snapshot, 'step.started', { stepId: input.stepId, attempt: 1 })
  }
  return append(input.scope, snapshot, 'step.failed', {
    stepId: input.stepId,
    attempt: step.status === 'scheduled' ? 1 : step.attempt,
    code: input.code.slice(0, 160),
    retryable: input.retryable ?? true,
  })
}

export async function markChapterPostAdoptionOrganizationStaleV1(input: {
  scope: WorkspaceScope
  runId: number
  candidateHash: string
  reason: string
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  const step = snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization]
  if (!step || step.status === 'stale' || ['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)) return snapshot
  return append(input.scope, snapshot, 'candidate.staled', {
    stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
    candidateHash: input.candidateHash,
    reason: input.reason.slice(0, 1_000),
  })
}

/** Open the author-confirmed adoption boundary before business writes start.
 * This makes a crash or partial-domain failure observable in the run ledger. */
export async function beginChapterPostAdoptionOrganizationAdoptionV1(input: {
  scope: WorkspaceScope
  runId: number
  candidateHash: string
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const step = snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization]
  if (!step || step.candidateHash !== input.candidateHash) {
    throw new Error('正文后处理六域交接候选与运行账本不一致。')
  }
  const wasFailed = step.status === 'failed'
  if (step.status === 'awaiting_confirmation') {
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
      candidateHash: input.candidateHash,
      decision: 'adopt',
    })
  } else if (step.status === 'failed') {
    if (step.failureCode !== 'chapter_organization_partial_adoption') {
      throw new Error('正文后处理六域交接步骤不是可恢复的部分采纳失败。')
    }
    snapshot = await append(input.scope, snapshot, 'step.started', {
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
      attempt: step.attempt + 1,
    })
  } else if (step.status !== 'running') {
    throw new Error(`正文后处理六域交接当前状态 ${step.status} 不可开始采纳。`)
  }
  const started = !wasFailed && snapshot.events.some(event => (
    event.type === 'adoption.started'
      && event.payload.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization
      && event.payload.candidateHash === input.candidateHash
  ))
  if (!started) {
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
      candidateHash: input.candidateHash,
      intentHash: await hashCanonicalValue({
        kind: 'chapter-organization-adoption',
        candidateHash: input.candidateHash,
      }),
    })
  }
  return snapshot
}

export async function rejectChapterPostAdoptionOrganizationAdoptionV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  candidateHash: string
  code?: string
}): Promise<AgentRunSnapshotV1> {
  const step = input.snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization]
  if (!step || step.status !== 'running' || step.candidateHash !== input.candidateHash) {
    throw new Error('正文后处理六域交接不在可记录失败的运行状态。')
  }
  return append(input.scope, input.snapshot, 'adoption.rejected', {
    stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
    candidateHash: input.candidateHash,
    code: (input.code ?? 'chapter_organization_partial_adoption').slice(0, 160),
  })
}

export async function commitChapterPostAdoptionOrganizationV1(input: {
  scope: WorkspaceScope
  runId: number
  candidate: ChapterOrganizationCandidate & { durable: ChapterPostAdoptionDurableEvidenceV1 }
  written: Record<string, number>
}): Promise<AgentRunSnapshotV1> {
  const chapter = await db.chapters.get(input.candidate.chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('正文后处理采纳的章节不存在或越界。')
  }
  if (await hashChapterText(chapter.content ?? '') !== input.candidate.sourceTextHash) {
    await markChapterPostAdoptionOrganizationStaleV1({
      scope: input.scope,
      runId: input.runId,
      candidateHash: input.candidate.durable.candidateHash,
      reason: '正文 hash 已变化；六域交接候选不可提交。',
    })
    throw new Error('章节正文已变化，这批六域交接候选已过期；请重新运行。')
  }
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  assertChapterPostAdoptionExecutionBindingsV1(snapshot)
  const step = snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization]
  if (!step || !['awaiting_confirmation', 'running'].includes(step.status) || step.candidateHash !== input.candidate.durable.candidateHash) {
    throw new Error('正文后处理六域交接候选不在等待确认状态。')
  }
  if (step.status === 'awaiting_confirmation') {
    snapshot = await beginChapterPostAdoptionOrganizationAdoptionV1({
      scope: input.scope,
      runId: input.runId,
      candidateHash: input.candidate.durable.candidateHash,
    })
  }
  if (!snapshot.events.some(event => (
    event.type === 'adoption.started'
      && event.payload.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization
      && event.payload.candidateHash === input.candidate.durable.candidateHash
  ))) {
    throw new Error('正文后处理缺少六域交接 adoption.started 证据。')
  }
  snapshot = await append(input.scope, snapshot, 'adoption.committed', {
    stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
    candidateHash: input.candidate.durable.candidateHash,
    adoptionHash: await hashCanonicalValue({
      version: 1,
      candidateHash: input.candidate.durable.candidateHash,
      chapterId: input.candidate.chapterId,
      sourceTextHash: input.candidate.sourceTextHash,
      written: input.written,
    }),
  })
  return succeedChapterPostAdoptionStepV1({
    scope: input.scope,
    snapshot,
    stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
    output: { candidateHash: input.candidate.durable.candidateHash, written: input.written },
  })
}

async function postStateHash(input: { scope: WorkspaceScope; chapterId: number }): Promise<string> {
  const chapter = await db.chapters.get(input.chapterId)
  const [chunks, summaries, stateCards, facts, inventory, timeline, relations, foreshadows] = await Promise.all([
    readOwnedRows<Record<string, unknown>>(input.scope, 'retrievalChunks', { owner: 'work' }),
    readOwnedRows<Record<string, unknown>>(input.scope, 'narrativeSummaryNodes', { owner: 'work' }),
    readOwnedRows<Record<string, unknown>>(input.scope, 'stateCards', { owner: 'work' }),
    readOwnedRows<Record<string, unknown>>(input.scope, 'temporalFacts', { owner: 'work' }),
    readOwnedRows<Record<string, unknown>>(input.scope, 'itemLedger', { owner: 'work' }),
    readOwnedRows<Record<string, unknown>>(input.scope, 'storyTimelineEvents', { owner: 'work' }),
    readOwnedRows<Record<string, unknown>>(input.scope, 'characterRelations', { owner: 'world' }),
    readOwnedRows<Record<string, unknown>>(input.scope, 'foreshadows', { owner: 'work' }),
  ])
  const sortRows = (rows: Record<string, unknown>[]) => rows.sort((a, b) => Number(a.id ?? 0) - Number(b.id ?? 0))
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
    retrievalChunks: sortRows(chunks.filter(row => row.sourceChapterId === input.chapterId)),
    narrativeSummaries: sortRows(summaries.filter(row => row.level === 'chapter' && row.sourceChapterId === input.chapterId)),
    stateCards: sortRows(stateCards),
    facts: sortRows(facts.filter(row => row.sourceChapterId === input.chapterId)),
    inventory: sortRows(inventory.filter(row => row.chapterId === input.chapterId)),
    timeline: sortRows(timeline.filter(row => row.chapterId === input.chapterId)),
    relations: sortRows(relations),
    foreshadows: sortRows(foreshadows),
  })
}

export async function verifyChapterPostAdoptionRunV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string; receipt?: VerificationReceiptV1 }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  assertChapterPostAdoptionExecutionBindingsV1(snapshot)
  try {
    await assertChapterPostAdoptionLineageCurrentV1(input.scope, snapshot)
  } catch (error) {
    if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope,
        runId: input.runId,
        reason: 'parent-run-or-source-artifact-stale',
      })
    }
    throw error
  }
  if (snapshot.projection.state === 'completed' && snapshot.run.terminalReceiptHash) {
    return { snapshot, receiptHash: snapshot.run.terminalReceiptHash }
  }
  const steps = stepIds().map(stepId => snapshot.projection.steps[stepId])
  if (steps.some(step => !step || step.status !== 'succeeded')) {
    throw new Error('正文后处理尚未完成全部必需步骤。')
  }
  const chapterId = snapshot.contract.scope.chapterIds?.[0]
  if (chapterId == null) throw new Error('正文后处理运行缺少章节作用域。')
  const chapter = await db.chapters.get(chapterId)
  if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('正文后处理终态校验找不到来源章节。')
  }
  const memory = await getChapterDerivedMemoryStatus(chapter)
  if (memory.summary !== 'verified' || memory.handoff !== 'verified') {
    throw new Error('正文后处理终态校验发现 summary/handoff 缺失或已过期。')
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
    || chapterSummaryNodes.some(row => row.status !== 'verified')
  ) {
    throw new Error('正文后处理终态校验发现检索块或叙事摘要未匹配当前正文。')
  }
  const organizationStep = snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization]
  const organizationCandidateHash = organizationStep?.candidateHash
  if (!organizationCandidateHash) throw new Error('正文后处理缺少六域交接候选 hash。')
  const organizationAdoption = snapshot.events.find(event => (
    event.type === 'adoption.committed'
      && event.payload.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization
      && event.payload.candidateHash === organizationCandidateHash
  ))
  if (!organizationAdoption) throw new Error('正文后处理缺少六域交接采纳证据。')
  const contextManifestHashes = stepIds().map(stepId => (
    [...snapshot.events].reverse().find((event): event is Extract<typeof event, { type: 'context.assembled' }> => (
      event.type === 'context.assembled' && event.payload.stepId === stepId
    ))
  )?.payload.manifestHash ?? '')
  if (contextManifestHashes.some(hash => !hash)) throw new Error('正文后处理缺少 Context Manifest 证据。')
  const candidateHashes = steps.map(step => step?.candidateHash ?? step?.outputHash ?? '').filter(Boolean)
  const adoptionEventIds = (await db.agentRunEvents.where('runId').equals(input.runId).toArray())
    .filter(row => row.id != null && row.type === 'adoption.committed')
    .map(row => row.id!)
  const postState = await postStateHash({ scope: input.scope, chapterId })
  snapshot = await append(input.scope, snapshot, 'verification.started', {
    verifierSetVersion: CHAPTER_POST_ADOPTION_VERIFIER_SET_V1,
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
    verifierSetVersion: CHAPTER_POST_ADOPTION_VERIFIER_SET_V1,
    ...(snapshot.contract.lineage?.parent ? { lineage: snapshot.contract.lineage.parent } : {}),
    criteria: [
      { id: 'chapter-post-adoption.retrieval', status: 'passed', evidenceRefs: [`step:${CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval}`] },
      { id: 'chapter-post-adoption.organization', status: 'passed', evidenceRefs: [`event:${organizationCandidateHash}`] },
      { id: 'chapter-post-adoption.memory', status: 'passed', evidenceRefs: [`step:${CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory}`] },
      { id: 'chapter-post-adoption.post-state', status: 'passed', evidenceRefs: [`post-state:${postState}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, receiptHash: receipt.receiptHash, receipt }
}
