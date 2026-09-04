import {
  appendAgentRunEventV1,
  createVerificationReceiptV1,
  hashCanonicalValue,
  readAgentRunV1,
  type AgentRunSnapshotV1,
  type GenerationNodeDurableTraceV1,
} from '../agent/run'
import {
  appendAgentEvent,
  readAgentEvents,
} from '../agent/conversations'
import { db } from '../db/schema'
import {
  parseAgentEventPayload,
  type AgentEvent,
  type AgentRunRecord,
  type WorkspaceScope,
} from '../types'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveScope,
  scopeTransactionTables,
} from '../workspace/scope'
import type { OutlineNode } from '../types'
import {
  assertWorkspaceContentRevisionFreshV1,
  parseWorkspaceContentRevisionV1,
  verifyWorkspaceContentRevisionV1,
  type WorkspaceContentRevisionVectorV1,
} from '../authoring/content-revision'
import {
  adoptGeneratedOutlineItems,
  adoptGeneratedOutlineSummary,
  type GeneratedOutlineItem,
} from './adopt-generation'
import {
  decodeGenerationOperation,
  encodeGenerationOperation,
  type OutlineGenerationRequest,
} from './generation-request'
import { assertOutlineRequestTargetsUnwrittenFutureV1 } from './future-boundary'

export const OUTLINE_GENERATION_CONVERSATION_PURPOSE = 'outline-generation-v1'
export const OUTLINE_GENERATION_CANDIDATE_PAYLOAD_TYPE = 'outline-generation-candidate'

export interface OutlineGenerationBatchRefV1 {
  batchGroupId: string
  batchIndex: number
  batchTotal: number
  predecessorCandidateHash?: string
}

export interface OutlineGenerationCandidatePayloadV1 {
  version: 1
  type: typeof OUTLINE_GENERATION_CANDIDATE_PAYLOAD_TYPE
  runId: number
  stepId: string
  operation: string
  candidateHash: string
  batch?: OutlineGenerationBatchRefV1
  /** Absent on candidates created before WEH-0C. */
  contentRevision?: WorkspaceContentRevisionVectorV1
}

export interface OutlineGenerationCandidateV1 extends OutlineGenerationCandidatePayloadV1 {
  projectId: number
  worldGroupId: number | null
  conversationId: number
  candidateEventId: number
  output: string
}

export const OUTLINE_GENERATION_ADOPTION_INTENT_PAYLOAD_TYPE = 'outline-generation-adoption-intent'
export const OUTLINE_GENERATION_TERMINAL_VERIFIER_V1 = 'outline-generation-terminal-v1'

interface OutlineGenerationAdoptionIntentBaseV1 {
  version: 1
}

export type OutlineGenerationAdoptionIntentV1 =
  | (OutlineGenerationAdoptionIntentBaseV1 & {
      kind: 'single-volume' | 'single-chapter'
      targetId: number
      summary: string
      /** Optional only for historical pending intents; new formal adoption requires it. */
      baseSummary?: string
    })
  | (OutlineGenerationAdoptionIntentBaseV1 & {
      kind: 'volumes'
      items: GeneratedOutlineItem[]
      startingOrder: number
      baseExistingTitles: string[]
    })
  | (OutlineGenerationAdoptionIntentBaseV1 & {
      kind: 'chapters'
      destinationVolumeId: number
      items: GeneratedOutlineItem[]
      startingOrder: number
      baseExistingTitles: string[]
    })

interface OutlineGenerationAdoptionIntentPayloadV1 {
  version: 1
  type: typeof OUTLINE_GENERATION_ADOPTION_INTENT_PAYLOAD_TYPE
  runId: number
  candidateHash: string
  intentHash: string
  intent: OutlineGenerationAdoptionIntentV1
}

export interface OutlineGenerationAdoptionRecoveryResultV1 {
  recoveredRunIds: number[]
  failed: Array<{ runId: number; reason: string }>
}

export type OutlineGenerationAdoptionFaultBoundaryV1 =
  | 'before-confirmation'
  | 'after-intent'
  | 'before-cas'
  | 'after-cas'
  | 'business-write-in-progress'
  | 'after-business-write'
  | 'after-adoption-event'
  | 'verification-in-progress'
  | 'after-terminal-receipt'

export interface OutlineGenerationAdoptionResultV1 {
  evidence: unknown
  receiptHash: string
  postStateHash: string
}

export interface RestoredOutlineGenerationBatchV1 {
  batchGroupId: string
  batchTotal: number
  candidates: OutlineGenerationCandidateV1[]
}

export async function persistOutlineGenerationCandidateV1(input: {
  scope: WorkspaceScope
  conversationId: number
  request: OutlineGenerationRequest
  durable: GenerationNodeDurableTraceV1
  output: string
  batch?: OutlineGenerationBatchRefV1
  contentRevision?: WorkspaceContentRevisionVectorV1
}): Promise<OutlineGenerationCandidateV1 | null> {
  if (!input.output.trim()) return null
  const batch = input.batch == null ? null : parseOutlineGenerationBatchRef(input.batch)
  if (input.batch != null && !batch) throw new Error('批量章纲候选引用不符合受控结构')
  const candidateHash = await hashCanonicalValue(input.output)
  const operation = encodeGenerationOperation(input.request)
  const payload: OutlineGenerationCandidatePayloadV1 = {
    version: 1,
    type: OUTLINE_GENERATION_CANDIDATE_PAYLOAD_TYPE,
    runId: input.durable.runId,
    stepId: input.durable.stepId,
    operation,
    candidateHash,
    ...(batch ? { batch } : {}),
    ...(input.contentRevision ? { contentRevision: input.contentRevision } : {}),
  }
  const candidateEvent = await input.durable.commitCandidate({
    output: input.output,
    candidateHash,
    requiresConfirmation: true,
    persistCandidate: () => appendAgentEvent({
        projectId: input.scope.projectId,
        conversationId: input.conversationId,
        durableRunId: input.durable.runId,
        kind: 'candidate',
        role: 'assistant',
        content: input.output,
        payload,
        scope: input.scope,
      }),
  })
  if (!candidateEvent.id) throw new Error('大纲候选持久化后缺少事件 ID')
  return {
    ...payload,
    projectId: input.scope.projectId,
    worldGroupId: input.durable.projection().worldGroupId,
    conversationId: input.conversationId,
    candidateEventId: candidateEvent.id,
    output: input.output,
  }
}

function parseOutlineCandidatePayload(event: AgentEvent): OutlineGenerationCandidatePayloadV1 | null {
  const payload = parseAgentEventPayload<Partial<OutlineGenerationCandidatePayloadV1>>(event, {})
  const batch = parseOutlineGenerationBatchRef(payload.batch)
  let contentRevision: WorkspaceContentRevisionVectorV1 | undefined
  try {
    contentRevision = payload.contentRevision === undefined
      ? undefined
      : parseWorkspaceContentRevisionV1(payload.contentRevision)
  } catch {
    return null
  }
  if (
    payload.version !== 1
    || payload.type !== OUTLINE_GENERATION_CANDIDATE_PAYLOAD_TYPE
    || !Number.isInteger(payload.runId)
    || typeof payload.stepId !== 'string'
    || typeof payload.operation !== 'string'
    || !decodeGenerationOperation(payload.operation)
    || payload.stepId !== payload.operation
    || typeof payload.candidateHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(payload.candidateHash)
    || (payload.batch != null && !batch)
  ) return null
  return {
    ...payload,
    ...(batch ? { batch } : {}),
    ...(contentRevision ? { contentRevision } : {}),
  } as OutlineGenerationCandidatePayloadV1
}

function parseOutlineGenerationBatchRef(value: unknown): OutlineGenerationBatchRefV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const batch = value as Partial<OutlineGenerationBatchRefV1>
  if (
    typeof batch.batchGroupId !== 'string'
    || !/^[a-zA-Z0-9_-]{8,120}$/.test(batch.batchGroupId)
    || !Number.isInteger(batch.batchIndex)
    || !Number.isInteger(batch.batchTotal)
    || (batch.batchIndex as number) < 0
    || (batch.batchTotal as number) < 1
    || (batch.batchIndex as number) >= (batch.batchTotal as number)
    || (batch.predecessorCandidateHash != null
      && (typeof batch.predecessorCandidateHash !== 'string'
        || !/^[a-f0-9]{64}$/.test(batch.predecessorCandidateHash)))
  ) return null
  return batch as OutlineGenerationBatchRefV1
}

function validId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function validOutlineItems(value: unknown): value is GeneratedOutlineItem[] {
  return Array.isArray(value) && value.length > 0 && value.every(item => (
    item != null
    && typeof item === 'object'
    && typeof (item as GeneratedOutlineItem).title === 'string'
    && (item as GeneratedOutlineItem).title.trim().length > 0
    && typeof (item as GeneratedOutlineItem).summary === 'string'
  ))
}

function parseOutlineAdoptionIntent(value: unknown): OutlineGenerationAdoptionIntentV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const intent = value as Partial<OutlineGenerationAdoptionIntentV1>
  if (intent.version !== 1 || typeof intent.kind !== 'string') return null
  if (intent.kind === 'single-volume' || intent.kind === 'single-chapter') {
    if (!validId(intent.targetId) || typeof intent.summary !== 'string') return null
    if (intent.baseSummary !== undefined && typeof intent.baseSummary !== 'string') return null
    return intent as OutlineGenerationAdoptionIntentV1
  }
  if (intent.kind === 'volumes' || intent.kind === 'chapters') {
    if (
      !validOutlineItems(intent.items)
      || !Number.isInteger(intent.startingOrder)
      || (intent.startingOrder as number) < 0
      || !Array.isArray(intent.baseExistingTitles)
      || !intent.baseExistingTitles.every(title => typeof title === 'string')
    ) return null
    if (intent.kind === 'chapters' && !validId(intent.destinationVolumeId)) return null
    return intent as OutlineGenerationAdoptionIntentV1
  }
  return null
}

function adoptionIntentMatchesCandidate(
  candidate: Pick<OutlineGenerationCandidateV1, 'operation'>,
  intent: OutlineGenerationAdoptionIntentV1,
): boolean {
  const request = decodeGenerationOperation(candidate.operation)
  if (!request) return false
  switch (intent.kind) {
    case 'single-volume':
      return request.kind === 'single-volume' && request.volumeId === intent.targetId
    case 'single-chapter':
      return request.kind === 'single-chapter' && request.chapterId === intent.targetId
    case 'chapters':
      return request.kind === 'chapters' && request.volumeId === intent.destinationVolumeId
    case 'volumes':
      return request.kind === 'volumes'
  }
}

function parseOutlineAdoptionIntentPayload(event: AgentEvent): OutlineGenerationAdoptionIntentPayloadV1 | null {
  const payload = parseAgentEventPayload<Partial<OutlineGenerationAdoptionIntentPayloadV1>>(event, {})
  const intent = parseOutlineAdoptionIntent(payload.intent)
  if (
    payload.version !== 1
    || payload.type !== OUTLINE_GENERATION_ADOPTION_INTENT_PAYLOAD_TYPE
    || !Number.isInteger(payload.runId)
    || typeof payload.candidateHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(payload.candidateHash)
    || typeof payload.intentHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(payload.intentHash)
    || !intent
  ) return null
  return { ...payload, intent } as OutlineGenerationAdoptionIntentPayloadV1
}

async function resolveOutlineCandidate(input: OutlineGenerationCandidateV1): Promise<{
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
}> {
  const scope = await resolveScope({ projectId: input.projectId })
  const snapshot = await readAgentRunV1(scope, input.runId)
  if (
    snapshot.run.conversationId !== input.conversationId
    || (snapshot.run.worldGroupId ?? null) !== input.worldGroupId
  ) throw new Error('大纲候选与运行 scope 不匹配')
  const event = (await readAgentEvents(input.conversationId, scope))
    .find(row => row.id === input.candidateEventId)
  const payload = event ? parseOutlineCandidatePayload(event) : null
  if (
    !event
    || !payload
    || payload.runId !== input.runId
    || payload.stepId !== input.stepId
    || payload.candidateHash !== input.candidateHash
    || await hashCanonicalValue(event.content) !== input.candidateHash
  ) throw new Error('大纲候选正文或来源证据已损坏')
  return { scope, snapshot }
}

async function candidateForSnapshot(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
): Promise<OutlineGenerationCandidateV1 | null> {
  const conversationId = snapshot.run.conversationId
  if (conversationId == null) return null
  const step = Object.values(snapshot.projection.steps).find(item => item.candidateHash)
  if (!step?.candidateHash) return null
  const events = await readAgentEvents(conversationId, scope)
  for (const event of [...events].reverse()) {
    if (event.kind !== 'candidate' || event.id == null) continue
    const payload = parseOutlineCandidatePayload(event)
    if (
      !payload
      || payload.runId !== snapshot.run.id
      || payload.stepId !== step.stepId
      || payload.candidateHash !== step.candidateHash
      || await hashCanonicalValue(event.content) !== payload.candidateHash
    ) continue
    return {
      ...payload,
      projectId: snapshot.run.projectId,
      worldGroupId: snapshot.run.worldGroupId ?? null,
      conversationId,
      candidateEventId: event.id,
      output: event.content,
    }
  }
  return null
}

export async function restoreLatestOutlineGenerationCandidateV1(
  projectId: number,
): Promise<OutlineGenerationCandidateV1 | null> {
  const scope = await resolveScope({ projectId })
  const runs = (await readOwnedRows<AgentRunRecord>(scope, 'agentRuns', { owner: 'work' }))
    .filter(run => run.id != null && run.status === 'awaiting_confirmation' && run.conversationId != null)
    .sort((left, right) => right.updatedAt - left.updatedAt)
  for (const run of runs) {
    try {
      const snapshot = await readAgentRunV1(scope, run.id!)
      if (snapshot.projection.state !== 'awaiting_confirmation') continue
      const candidate = await candidateForSnapshot(scope, snapshot)
      if (candidate && !candidate.batch) return candidate
    } catch {
      // A corrupt or cross-scope ledger must not become a recoverable candidate.
    }
  }
  return null
}

export async function restoreLatestOutlineGenerationBatchV1(
  projectId: number,
): Promise<RestoredOutlineGenerationBatchV1 | null> {
  const scope = await resolveScope({ projectId })
  const runs = (await readOwnedRows<AgentRunRecord>(scope, 'agentRuns', { owner: 'work' }))
    .filter(run => run.id != null && run.status === 'awaiting_confirmation' && run.conversationId != null)
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const groups = new Map<string, {
    batchTotal: number
    latestUpdatedAt: number
    candidatesByIndex: Map<number, OutlineGenerationCandidateV1>
  }>()
  for (const run of runs) {
    try {
      const snapshot = await readAgentRunV1(scope, run.id!)
      if (snapshot.projection.state !== 'awaiting_confirmation') continue
      const candidate = await candidateForSnapshot(scope, snapshot)
      const batch = candidate?.batch
      if (!candidate || !batch) continue
      const group = groups.get(batch.batchGroupId) ?? {
        batchTotal: batch.batchTotal,
        latestUpdatedAt: run.updatedAt,
        candidatesByIndex: new Map<number, OutlineGenerationCandidateV1>(),
      }
      if (group.batchTotal !== batch.batchTotal) continue
      group.latestUpdatedAt = Math.max(group.latestUpdatedAt, run.updatedAt)
      if (!group.candidatesByIndex.has(batch.batchIndex)) {
        group.candidatesByIndex.set(batch.batchIndex, candidate)
      }
      groups.set(batch.batchGroupId, group)
    } catch {
      // Invalid run/event evidence cannot be projected into a recoverable batch.
    }
  }
  const latest = [...groups.entries()]
    .sort((left, right) => right[1].latestUpdatedAt - left[1].latestUpdatedAt)[0]
  if (!latest) return null
  return {
    batchGroupId: latest[0],
    batchTotal: latest[1].batchTotal,
    candidates: [...latest[1].candidatesByIndex.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, candidate]) => candidate),
  }
}

export async function beginOutlineGenerationAdoptionV1(
  candidate: OutlineGenerationCandidateV1,
  intent?: OutlineGenerationAdoptionIntentV1,
): Promise<void> {
  const { scope, snapshot } = await resolveOutlineCandidate(candidate)
  const step = snapshot.projection.steps[candidate.stepId]
  if (!step) throw new Error('大纲候选对应步骤不存在')
  const parsedIntent = intent == null ? null : parseOutlineAdoptionIntent(intent)
  if (intent != null && !parsedIntent) throw new Error('大纲采纳计划不符合受控结构')
  if (parsedIntent && !adoptionIntentMatchesCandidate(candidate, parsedIntent)) {
    throw new Error('大纲采纳计划与候选生成目标不匹配')
  }
  const intentHash = parsedIntent == null ? undefined : await hashCanonicalValue(parsedIntent)
  const adoptionStarted = snapshot.events.find(event => (
    event.type === 'adoption.started'
    && event.payload.stepId === candidate.stepId
    && event.payload.candidateHash === candidate.candidateHash
  ))
  if (
    step.status === 'running'
    && step.confirmation === 'adopt'
    && adoptionStarted?.type === 'adoption.started'
  ) {
    if (intentHash != null && adoptionStarted.payload.intentHash !== intentHash) {
      throw new Error('已确认候选的采纳计划与当前计划不一致')
    }
    return
  }
  if (step.status !== 'awaiting_confirmation') throw new Error('大纲候选当前不等待作者确认')

  await db.transaction(
    'rw',
    scopeTransactionTables(
      db.agentConversations,
      db.agentEvents,
      db.agentRuns,
      db.agentRunEvents,
    ),
    async () => {
      if (parsedIntent && intentHash) {
        const payload: OutlineGenerationAdoptionIntentPayloadV1 = {
          version: 1,
          type: OUTLINE_GENERATION_ADOPTION_INTENT_PAYLOAD_TYPE,
          runId: candidate.runId,
          candidateHash: candidate.candidateHash,
          intentHash,
          intent: parsedIntent,
        }
        await appendAgentEvent({
          projectId: candidate.projectId,
          conversationId: candidate.conversationId,
          kind: 'plan',
          content: '已冻结作者确认的大纲采纳计划。',
          payload,
          scope,
        })
      }
      await appendAgentRunEventV1({
        scope,
        runId: candidate.runId,
        type: 'confirmation.recorded',
        payload: {
          stepId: candidate.stepId,
          candidateHash: candidate.candidateHash,
          decision: 'adopt',
        },
      })
      await appendAgentRunEventV1({
        scope,
        runId: candidate.runId,
        type: 'adoption.started',
        payload: {
          stepId: candidate.stepId,
          candidateHash: candidate.candidateHash,
          ...(intentHash ? { intentHash } : {}),
        },
      })
      await appendAgentEvent({
        projectId: candidate.projectId,
        conversationId: candidate.conversationId,
        kind: 'confirmation',
        content: '作者已确认采纳大纲候选。',
        payload: {
          version: 1,
          runId: candidate.runId,
          candidateEventId: candidate.candidateEventId,
          decision: 'adopted',
        },
        scope,
      })
    },
  )
}

export async function commitOutlineGenerationAdoptionV1(
  candidate: OutlineGenerationCandidateV1,
  adoptionEvidence: unknown,
  intent?: OutlineGenerationAdoptionIntentV1,
  options: {
    faultInjector?: (boundary: OutlineGenerationAdoptionFaultBoundaryV1) => void | Promise<void>
  } = {},
): Promise<{ receiptHash: string; postStateHash: string } | null> {
  let resolved = await resolveOutlineCandidate(candidate)
  let step = resolved.snapshot.projection.steps[candidate.stepId]
  if (step?.status === 'succeeded' && step.adoptionHash) {
    const frozen = await adoptionIntentForSnapshot(resolved.scope, resolved.snapshot, candidate)
    if (frozen) return verifyOutlineGenerationAdoptionV1(candidate, frozen.intent)
    return null
  }
  if (step?.status === 'awaiting_confirmation') {
    await beginOutlineGenerationAdoptionV1(candidate, intent)
    resolved = await resolveOutlineCandidate(candidate)
    step = resolved.snapshot.projection.steps[candidate.stepId]
  }
  if (!step || step.status !== 'running' || step.confirmation !== 'adopt') {
    throw new Error('大纲候选尚未进入可提交采纳状态')
  }
  const adoptionHash = await hashCanonicalValue({
    candidateHash: candidate.candidateHash,
    evidence: adoptionEvidence,
  })
  await db.transaction(
    'rw',
    scopeTransactionTables(db.agentRuns, db.agentRunEvents),
    async () => {
      await appendAgentRunEventV1({
        scope: resolved.scope,
        runId: candidate.runId,
        type: 'adoption.committed',
        payload: {
          stepId: candidate.stepId,
          candidateHash: candidate.candidateHash,
          adoptionHash,
        },
      })
      await appendAgentRunEventV1({
        scope: resolved.scope,
        runId: candidate.runId,
        type: 'step.succeeded',
        payload: {
          stepId: candidate.stepId,
          attempt: 1,
          outputHash: candidate.candidateHash,
        },
      })
    },
  )
  await options.faultInjector?.('after-adoption-event')
  resolved = await resolveOutlineCandidate(candidate)
  const frozen = await adoptionIntentForSnapshot(resolved.scope, resolved.snapshot, candidate)
  if (!frozen) return null
  await options.faultInjector?.('verification-in-progress')
  const receipt = await verifyOutlineGenerationAdoptionV1(candidate, frozen.intent)
  await options.faultInjector?.('after-terminal-receipt')
  return receipt
}

async function adoptionIntentForSnapshot(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: OutlineGenerationCandidateV1,
): Promise<{ intent: OutlineGenerationAdoptionIntentV1; intentHash: string } | null> {
  const started = [...snapshot.events].reverse().find(event => (
    event.type === 'adoption.started'
    && event.payload.stepId === candidate.stepId
    && event.payload.candidateHash === candidate.candidateHash
  ))
  if (started?.type !== 'adoption.started' || !started.payload.intentHash) return null
  const events = await readAgentEvents(candidate.conversationId, scope)
  for (const event of [...events].reverse()) {
    if (event.kind !== 'plan') continue
    const payload = parseOutlineAdoptionIntentPayload(event)
    if (
      !payload
      || payload.runId !== candidate.runId
      || payload.candidateHash !== candidate.candidateHash
      || payload.intentHash !== started.payload.intentHash
      || await hashCanonicalValue(payload.intent) !== payload.intentHash
      || !adoptionIntentMatchesCandidate(candidate, payload.intent)
    ) continue
    return { intent: payload.intent, intentHash: payload.intentHash }
  }
  return null
}

function normalizedTitle(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
}

async function executeOutlineAdoptionIntent(
  candidate: OutlineGenerationCandidateV1,
  scope: WorkspaceScope,
  intent: OutlineGenerationAdoptionIntentV1,
  faultInjector?: (boundary: OutlineGenerationAdoptionFaultBoundaryV1) => void | Promise<void>,
): Promise<unknown> {
  const request = decodeGenerationOperation(candidate.operation)
  if (!request) throw new Error('大纲候选操作无法解析，已阻止采纳。')
  await assertOutlineRequestTargetsUnwrittenFutureV1({
    scope,
    worldGroupId: candidate.worldGroupId,
    request,
  })
  if (intent.kind === 'single-volume' || intent.kind === 'single-chapter') {
    const result = await adoptGeneratedOutlineSummary(
      candidate.projectId,
      intent.targetId,
      intent.summary,
    )
    if (!result.written) throw new Error(result.reason ?? '定点大纲采纳没有写入')
    await faultInjector?.('business-write-in-progress')
    return { recovered: true, kind: intent.kind, targetIds: [intent.targetId], result }
  }
  if (!('items' in intent)) throw new Error('不支持的大纲采纳计划')

  const parentId = intent.kind === 'chapters' ? intent.destinationVolumeId : null
  const type = intent.kind === 'chapters' ? 'chapter' as const : 'volume' as const
  let writtenCount = 0
  let firstId: number | null = null
  const skippedReasons = new Set<string>()
  for (let index = 0; index < intent.items.length; index++) {
    const itemResult = await adoptGeneratedOutlineItems({
      projectId: candidate.projectId,
      workspaceScope: scope,
      worldGroupId: candidate.worldGroupId,
      parentId,
      type,
      items: [intent.items[index]],
      startingOrder: intent.startingOrder + index,
    })
    writtenCount += itemResult.writtenCount
    if (firstId == null) firstId = itemResult.firstId
    itemResult.skippedReasons.forEach(reason => skippedReasons.add(reason))
    if (index === 0) await faultInjector?.('business-write-in-progress')
  }
  const result = { writtenCount, firstId, skippedReasons: [...skippedReasons] }
  const seenTitles = new Set(intent.baseExistingTitles.map(normalizedTitle))
  const expected = intent.items
    .map((item, index) => ({ item, order: intent.startingOrder + index }))
    .filter(({ item }) => {
      const title = normalizedTitle(item.title)
      if (seenTitles.has(title)) return false
      seenTitles.add(title)
      return true
    })
  if (expected.length === 0) throw new Error('冻结的采纳计划在确认时没有可写入条目')
  const rows = await readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' })
  const targetIds = expected.map(({ item, order }) => rows.find(row => (
    row.type === type
    && (row.parentId ?? null) === parentId
    && row.order === order
    && normalizedTitle(row.title) === normalizedTitle(item.title)
    && row.summary === item.summary
  ))?.id)
  if (targetIds.some(id => id == null)) {
    throw new Error('恢复采纳后业务表与作者确认计划仍不一致')
  }
  return { recovered: true, kind: intent.kind, targetIds, result }
}

async function assertOutlineAdoptionPreWriteCas(
  scope: WorkspaceScope,
  intent: OutlineGenerationAdoptionIntentV1,
): Promise<void> {
  if (intent.kind === 'single-volume' || intent.kind === 'single-chapter') {
    if (typeof intent.baseSummary !== 'string') {
      throw new Error('正式定点大纲采纳缺少确认时基线摘要')
    }
    const row = await db.outlineNodes.get(intent.targetId)
    if (
      !row
      || !await assertRecordInScope(scope, 'outlineNodes', row, { owner: 'work' })
      || row.summary !== intent.baseSummary
    ) throw new Error('大纲目标在作者确认后已变化，采纳 CAS 已阻断')
    return
  }
  const parentId = intent.kind === 'chapters' ? intent.destinationVolumeId : null
  const type = intent.kind === 'chapters' ? 'chapter' : 'volume'
  const rows = (await readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }))
    .filter(row => row.type === type && (row.parentId ?? null) === parentId)
    .sort((left, right) => left.order - right.order)
  const currentTitles = rows.map(row => normalizedTitle(row.title))
  if (!('baseExistingTitles' in intent)) throw new Error('大纲列表采纳缺少确认时基线标题')
  const frozenTitles = intent.baseExistingTitles.map(normalizedTitle)
  if (JSON.stringify(currentTitles) !== JSON.stringify(frozenTitles)) {
    throw new Error('大纲列表在作者确认后已变化，采纳 CAS 已阻断')
  }
}

async function assertOutlineAdoptionRecoveryState(
  candidate: OutlineGenerationCandidateV1,
  scope: WorkspaceScope,
  intent: OutlineGenerationAdoptionIntentV1,
): Promise<void> {
  if (intent.kind === 'single-volume' || intent.kind === 'single-chapter') {
    const row = await db.outlineNodes.get(intent.targetId)
    if (!row || !await assertRecordInScope(scope, 'outlineNodes', row, { owner: 'work' })) {
      throw new Error('恢复采纳时大纲目标已不存在或越出作用域')
    }
    if (typeof intent.baseSummary === 'string'
      && row.summary !== intent.baseSummary
      && row.summary !== intent.summary) {
      throw new Error('恢复采纳时目标摘要包含确认后的并发修改')
    }
    return
  }
  if (!('baseExistingTitles' in intent) || !('items' in intent)) {
    throw new Error('恢复采纳缺少冻结列表基线')
  }
  const parentId = intent.kind === 'chapters' ? intent.destinationVolumeId : null
  const type = intent.kind === 'chapters' ? 'chapter' : 'volume'
  const rows = (await readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }))
    .filter(row => row.type === type && (row.parentId ?? null) === parentId)
  const baseTitles = new Set(intent.baseExistingTitles.map(normalizedTitle))
  const expected = intent.items.map((item, index) => ({
    title: normalizedTitle(item.title),
    summary: item.summary,
    order: intent.startingOrder + index,
  }))
  for (const row of rows) {
    if (baseTitles.has(normalizedTitle(row.title))) continue
    const matchesFrozenWrite = expected.some(item => (
      item.title === normalizedTitle(row.title)
      && item.summary === row.summary
      && item.order === row.order
      && (row.worldGroupId ?? null) === candidate.worldGroupId
    ))
    if (!matchesFrozenWrite) {
      throw new Error('恢复采纳时列表包含确认后的并发修改')
    }
  }
}

/** Single formal adoption command: freeze intent → CAS → idempotent write → receipt. */
export async function adoptOutlineGenerationCandidateV1(input: {
  candidate: OutlineGenerationCandidateV1
  intent: OutlineGenerationAdoptionIntentV1
  /** Development/test-only deterministic interruption hook. */
  faultInjector?: (boundary: OutlineGenerationAdoptionFaultBoundaryV1) => void | Promise<void>
}): Promise<OutlineGenerationAdoptionResultV1> {
  const inject = async (boundary: OutlineGenerationAdoptionFaultBoundaryV1) => {
    if (input.faultInjector && !import.meta.env.PROD) await input.faultInjector(boundary)
  }
  await inject('before-confirmation')
  const resolved = await resolveOutlineCandidate(input.candidate)
  if (input.candidate.contentRevision) {
    try {
      await assertWorkspaceContentRevisionFreshV1(input.candidate.contentRevision, {
        scope: resolved.scope,
        worldGroupId: input.candidate.worldGroupId,
      })
    } catch (error) {
      await staleOutlineGenerationCandidateV1(
        input.candidate,
        error instanceof Error ? error.message : 'content_revision_changed',
      )
      throw new Error(`大纲候选已过期：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const request = decodeGenerationOperation(input.candidate.operation)
  if (!request) throw new Error('大纲候选操作无法解析，已阻止采纳。')
  await assertOutlineRequestTargetsUnwrittenFutureV1({
    scope: resolved.scope,
    worldGroupId: input.candidate.worldGroupId,
    request,
  })
  await beginOutlineGenerationAdoptionV1(input.candidate, input.intent)
  await inject('after-intent')
  const { scope } = resolved
  await inject('before-cas')
  await assertOutlineAdoptionPreWriteCas(scope, input.intent)
  await inject('after-cas')
  const evidence = await executeOutlineAdoptionIntent(
    input.candidate,
    scope,
    input.intent,
    input.faultInjector && !import.meta.env.PROD ? input.faultInjector : undefined,
  )
  await inject('after-business-write')
  const receipt = await commitOutlineGenerationAdoptionV1(
    input.candidate,
    evidence,
    input.intent,
    { faultInjector: input.faultInjector && !import.meta.env.PROD ? input.faultInjector : undefined },
  )
  if (!receipt) throw new Error('正式大纲采纳没有生成终态凭证')
  return { evidence, ...receipt }
}

async function readOutlineAdoptionPostState(
  candidate: OutlineGenerationCandidateV1,
  scope: WorkspaceScope,
  intent: OutlineGenerationAdoptionIntentV1,
): Promise<unknown> {
  if (!adoptionIntentMatchesCandidate(candidate, intent)) {
    throw new Error('终态验证的大纲采纳计划与候选不匹配')
  }
  if (intent.kind === 'single-volume' || intent.kind === 'single-chapter') {
    const row = await db.outlineNodes.get(intent.targetId)
    if (
      !row
      || !await assertRecordInScope(scope, 'outlineNodes', row, { owner: 'work' })
      || row.summary !== intent.summary
    ) throw new Error('大纲采纳后的目标摘要与作者确认计划不一致')
    return {
      id: row.id,
      type: row.type,
      parentId: row.parentId ?? null,
      title: row.title,
      summary: row.summary,
      order: row.order,
      worldGroupId: row.worldGroupId ?? null,
    }
  }
  if (!('items' in intent)) throw new Error('终态验证遇到不支持的大纲采纳计划')

  const parentId = intent.kind === 'chapters' ? intent.destinationVolumeId : null
  const type = intent.kind === 'chapters' ? 'chapter' as const : 'volume' as const
  const seenTitles = new Set(intent.baseExistingTitles.map(normalizedTitle))
  const expected = intent.items
    .map((item, index) => ({ item, order: intent.startingOrder + index }))
    .filter(({ item }) => {
      const title = normalizedTitle(item.title)
      if (seenTitles.has(title)) return false
      seenTitles.add(title)
      return true
    })
  if (expected.length === 0) throw new Error('作者确认计划没有可验证的大纲写入条目')
  const rows = await readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' })
  return expected.map(({ item, order }) => {
    const row = rows.find(candidateRow => (
      candidateRow.type === type
      && (candidateRow.parentId ?? null) === parentId
      && candidateRow.order === order
      && normalizedTitle(candidateRow.title) === normalizedTitle(item.title)
      && candidateRow.summary === item.summary
      && (candidateRow.worldGroupId ?? null) === candidate.worldGroupId
    ))
    if (!row) throw new Error(`大纲采纳后缺少已确认条目：${item.title}`)
    return {
      id: row.id,
      type: row.type,
      parentId: row.parentId ?? null,
      title: row.title,
      summary: row.summary,
      order: row.order,
      worldGroupId: row.worldGroupId ?? null,
    }
  })
}

export async function verifyOutlineGenerationAdoptionV1(
  candidate: OutlineGenerationCandidateV1,
  intent: OutlineGenerationAdoptionIntentV1,
): Promise<{ receiptHash: string; postStateHash: string }> {
  const resolved = await resolveOutlineCandidate(candidate)
  let snapshot = resolved.snapshot
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash) {
    return {
      receiptHash: snapshot.projection.terminalReceiptHash,
      postStateHash: await hashCanonicalValue(await readOutlineAdoptionPostState(candidate, resolved.scope, intent)),
    }
  }
  const step = snapshot.projection.steps[candidate.stepId]
  if (!step || step.status !== 'succeeded' || !step.adoptionHash) {
    throw new Error('大纲运行尚未完成采纳，不能签发终态凭证')
  }
  try {
    const postStateHash = await hashCanonicalValue(
      await readOutlineAdoptionPostState(candidate, resolved.scope, intent),
    )
    const contextManifestHashes = [...new Set(snapshot.events
      .filter(event => event.type === 'context.assembled')
      .map(event => event.type === 'context.assembled' ? event.payload.manifestHash : ''))]
      .filter(Boolean)
    if (contextManifestHashes.length === 0) throw new Error('大纲运行缺少 Context Manifest 证据')
    if (snapshot.projection.state === 'running') {
      snapshot = await appendAgentRunEventV1({
        scope: resolved.scope,
        runId: candidate.runId,
        type: 'verification.started',
        payload: { verifierSetVersion: OUTLINE_GENERATION_TERMINAL_VERIFIER_V1 },
        expectedLastSequence: snapshot.projection.lastSequence,
      })
    }
    if (snapshot.projection.state !== 'verifying') {
      throw new Error(`大纲运行状态 ${snapshot.projection.state} 不能签发终态凭证`)
    }
    const adoptionEventIds = (await db.agentRunEvents.where('runId').equals(candidate.runId).toArray())
      .filter(event => event.type === 'adoption.committed' && event.id != null)
      .map(event => event.id!)
    if (adoptionEventIds.length !== 1) throw new Error('大纲运行缺少唯一采纳提交事件')
    const receipt = await createVerificationReceiptV1({
      version: 1,
      runId: candidate.runId,
      generation: snapshot.projection.generation,
      contractHash: snapshot.projection.contractHash,
      contextManifestHashes,
      candidateHashes: [candidate.candidateHash],
      adoptionEventIds,
      postStateHash,
      verifierSetVersion: OUTLINE_GENERATION_TERMINAL_VERIFIER_V1,
      criteria: [
        { id: 'outline.output', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
        { id: 'outline.confirmed', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
        { id: 'outline.adopted', status: 'passed', evidenceRefs: adoptionEventIds.map(id => `event:${id}`) },
        { id: 'outline.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
      ],
      acceptedAt: Date.now(),
    })
    await appendAgentRunEventV1({
      scope: resolved.scope,
      runId: candidate.runId,
      type: 'verification.accepted',
      payload: { receiptHash: receipt.receiptHash },
      expectedLastSequence: snapshot.projection.lastSequence,
    })
    return { receiptHash: receipt.receiptHash, postStateHash }
  } catch (error) {
    const current = await readAgentRunV1(resolved.scope, candidate.runId)
    let rejected = current
    if (rejected.projection.state === 'running') {
      rejected = await appendAgentRunEventV1({
        scope: resolved.scope,
        runId: candidate.runId,
        type: 'verification.started',
        payload: { verifierSetVersion: OUTLINE_GENERATION_TERMINAL_VERIFIER_V1 },
        expectedLastSequence: rejected.projection.lastSequence,
      })
    }
    if (rejected.projection.state === 'verifying') {
      await appendAgentRunEventV1({
        scope: resolved.scope,
        runId: candidate.runId,
        type: 'verification.rejected',
        payload: {
          codes: [(error instanceof Error ? error.message : String(error)).slice(0, 160)],
          retryable: false,
        },
        expectedLastSequence: rejected.projection.lastSequence,
      })
    }
    throw error
  }
}

export async function recoverPendingOutlineGenerationAdoptionsV1(
  projectId: number,
): Promise<OutlineGenerationAdoptionRecoveryResultV1> {
  const scope = await resolveScope({ projectId })
  const result: OutlineGenerationAdoptionRecoveryResultV1 = { recoveredRunIds: [], failed: [] }
  const runs = (await readOwnedRows<AgentRunRecord>(scope, 'agentRuns', { owner: 'work' }))
    .filter(run => run.id != null && (run.status === 'running' || run.status === 'verifying') && run.conversationId != null)
    .sort((left, right) => left.updatedAt - right.updatedAt)
  for (const run of runs) {
    try {
      const snapshot = await readAgentRunV1(scope, run.id!)
      const step = Object.values(snapshot.projection.steps).find(item => (
        item.candidateHash
        && item.confirmation === 'adopt'
        && (item.status === 'running' || item.status === 'succeeded')
      ))
      if (!step?.candidateHash) continue
      const candidate = await candidateForSnapshot(scope, snapshot)
      if (!candidate) throw new Error('已确认运行缺少可校验的持久化候选')
      if (step.status === 'succeeded' && step.adoptionHash) {
        const frozen = await adoptionIntentForSnapshot(scope, snapshot, candidate)
        if (!frozen) throw new Error('已采纳运行缺少哈希匹配的采纳计划')
        await verifyOutlineGenerationAdoptionV1(candidate, frozen.intent)
      } else if (step.adoptionHash) {
        await appendAgentRunEventV1({
          scope,
          runId: candidate.runId,
          type: 'step.succeeded',
          payload: {
            stepId: candidate.stepId,
            attempt: step.attempt,
            outputHash: candidate.candidateHash,
          },
        })
        const refreshed = await readAgentRunV1(scope, candidate.runId)
        const frozen = await adoptionIntentForSnapshot(scope, refreshed, candidate)
        if (!frozen) throw new Error('已采纳运行缺少哈希匹配的采纳计划')
        await verifyOutlineGenerationAdoptionV1(candidate, frozen.intent)
      } else {
        const intent = await adoptionIntentForSnapshot(scope, snapshot, candidate)
        if (!intent) throw new Error('已确认运行缺少哈希匹配的采纳计划')
        if (candidate.contentRevision) {
          const revision = await verifyWorkspaceContentRevisionV1(candidate.contentRevision, {
            scope,
            worldGroupId: candidate.worldGroupId,
          })
          const unsafeChanges = revision.changedTables.filter(table => table !== 'outlineNodes')
          if (unsafeChanges.length) {
            throw new Error(`恢复采纳时其它 Canon 已变化：${unsafeChanges.join('、')}`)
          }
        }
        await assertOutlineAdoptionRecoveryState(candidate, scope, intent.intent)
        const evidence = await executeOutlineAdoptionIntent(candidate, scope, intent.intent)
        await commitOutlineGenerationAdoptionV1(candidate, {
          ...evidence as Record<string, unknown>,
          intentHash: intent.intentHash,
        })
      }
      result.recoveredRunIds.push(candidate.runId)
    } catch (error) {
      result.failed.push({
        runId: run.id!,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return result
}

export async function rejectOutlineGenerationCandidateV1(
  candidate: OutlineGenerationCandidateV1,
  reason: string,
): Promise<void> {
  const { scope, snapshot } = await resolveOutlineCandidate(candidate)
  const step = snapshot.projection.steps[candidate.stepId]
  if (!step || step.status === 'failed' || step.status === 'stale') return
  const content = reason.trim() || '作者未采纳大纲候选。'
  await db.transaction(
    'rw',
    scopeTransactionTables(
      db.agentConversations,
      db.agentEvents,
      db.agentRuns,
      db.agentRunEvents,
    ),
    async () => {
      if (step.status === 'awaiting_confirmation') {
        await appendAgentRunEventV1({
          scope,
          runId: candidate.runId,
          type: 'confirmation.recorded',
          payload: {
            stepId: candidate.stepId,
            candidateHash: candidate.candidateHash,
            decision: 'reject',
          },
        })
      } else if (step.status === 'running' && step.confirmation === 'adopt') {
        await appendAgentRunEventV1({
          scope,
          runId: candidate.runId,
          type: 'adoption.rejected',
          payload: {
            stepId: candidate.stepId,
            candidateHash: candidate.candidateHash,
            code: content.slice(0, 120),
          },
        })
      }
      await appendAgentEvent({
        projectId: candidate.projectId,
        conversationId: candidate.conversationId,
        kind: 'confirmation',
        content,
        payload: {
          version: 1,
          runId: candidate.runId,
          candidateEventId: candidate.candidateEventId,
          decision: 'rejected',
        },
        scope,
      })
      await appendAgentRunEventV1({
        scope,
        runId: candidate.runId,
        type: 'run.failed',
        payload: {
          code: step.status === 'awaiting_confirmation' ? 'author_rejected' : 'adoption_rejected',
          retryable: false,
        },
      })
    },
  )
}

export async function staleOutlineGenerationCandidateV1(
  candidate: OutlineGenerationCandidateV1,
  reason = '已被新的大纲生成替代',
): Promise<void> {
  const { scope, snapshot } = await resolveOutlineCandidate(candidate)
  const step = snapshot.projection.steps[candidate.stepId]
  if (!step || step.status === 'stale' || step.status === 'failed') return
  if (step.status !== 'awaiting_confirmation') throw new Error('只能标旧等待确认的大纲候选')
  await appendAgentRunEventV1({
    scope,
    runId: candidate.runId,
    type: 'candidate.staled',
    payload: {
      stepId: candidate.stepId,
      candidateHash: candidate.candidateHash,
      reason: reason.trim().slice(0, 200) || 'superseded',
    },
  })
}
