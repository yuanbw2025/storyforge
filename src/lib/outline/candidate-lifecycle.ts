import {
  appendAgentRunEventV1,
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
  readOwnedRows,
  resolveScope,
  scopeTransactionTables,
} from '../world-engine/scope'
import type { OutlineNode } from '../types'
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

export const OUTLINE_GENERATION_CONVERSATION_PURPOSE = 'outline-generation-v1'
export const OUTLINE_GENERATION_CANDIDATE_PAYLOAD_TYPE = 'outline-generation-candidate'

export interface OutlineGenerationCandidatePayloadV1 {
  version: 1
  type: typeof OUTLINE_GENERATION_CANDIDATE_PAYLOAD_TYPE
  runId: number
  stepId: string
  operation: string
  candidateHash: string
}

export interface OutlineGenerationCandidateV1 extends OutlineGenerationCandidatePayloadV1 {
  projectId: number
  worldGroupId: number | null
  conversationId: number
  candidateEventId: number
  output: string
}

export const OUTLINE_GENERATION_ADOPTION_INTENT_PAYLOAD_TYPE = 'outline-generation-adoption-intent'

interface OutlineGenerationAdoptionIntentBaseV1 {
  version: 1
}

export type OutlineGenerationAdoptionIntentV1 =
  | (OutlineGenerationAdoptionIntentBaseV1 & {
      kind: 'single-volume' | 'single-chapter'
      targetId: number
      summary: string
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

export async function persistOutlineGenerationCandidateV1(input: {
  scope: WorkspaceScope
  conversationId: number
  request: OutlineGenerationRequest
  durable: GenerationNodeDurableTraceV1
  output: string
}): Promise<OutlineGenerationCandidateV1 | null> {
  if (!input.output.trim()) return null
  const candidateHash = await hashCanonicalValue(input.output)
  const operation = encodeGenerationOperation(input.request)
  const payload: OutlineGenerationCandidatePayloadV1 = {
    version: 1,
    type: OUTLINE_GENERATION_CANDIDATE_PAYLOAD_TYPE,
    runId: input.durable.runId,
    stepId: input.durable.stepId,
    operation,
    candidateHash,
  }
  const candidateEvent = await input.durable.commitCandidate({
    output: input.output,
    candidateHash,
    requiresConfirmation: true,
    persistCandidate: () => appendAgentEvent({
        projectId: input.scope.projectId,
        conversationId: input.conversationId,
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
  ) return null
  return payload as OutlineGenerationCandidatePayloadV1
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
      if (candidate) return candidate
    } catch {
      // A corrupt or cross-scope ledger must not become a recoverable candidate.
    }
  }
  return null
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
): Promise<void> {
  let resolved = await resolveOutlineCandidate(candidate)
  let step = resolved.snapshot.projection.steps[candidate.stepId]
  if (step?.status === 'succeeded' && step.adoptionHash) return
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
): Promise<unknown> {
  if (intent.kind === 'single-volume' || intent.kind === 'single-chapter') {
    const result = await adoptGeneratedOutlineSummary(
      candidate.projectId,
      intent.targetId,
      intent.summary,
    )
    if (!result.written) throw new Error(result.reason ?? '定点大纲采纳没有写入')
    return { recovered: true, kind: intent.kind, targetIds: [intent.targetId], result }
  }
  if (!('items' in intent)) throw new Error('不支持的大纲采纳计划')

  const parentId = intent.kind === 'chapters' ? intent.destinationVolumeId : null
  const type = intent.kind === 'chapters' ? 'chapter' as const : 'volume' as const
  const result = await adoptGeneratedOutlineItems({
    projectId: candidate.projectId,
    workspaceScope: scope,
    worldGroupId: candidate.worldGroupId,
    parentId,
    type,
    items: intent.items,
    startingOrder: intent.startingOrder,
  })
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

export async function recoverPendingOutlineGenerationAdoptionsV1(
  projectId: number,
): Promise<OutlineGenerationAdoptionRecoveryResultV1> {
  const scope = await resolveScope({ projectId })
  const result: OutlineGenerationAdoptionRecoveryResultV1 = { recoveredRunIds: [], failed: [] }
  const runs = (await readOwnedRows<AgentRunRecord>(scope, 'agentRuns', { owner: 'work' }))
    .filter(run => run.id != null && run.status === 'running' && run.conversationId != null)
    .sort((left, right) => left.updatedAt - right.updatedAt)
  for (const run of runs) {
    try {
      const snapshot = await readAgentRunV1(scope, run.id!)
      const step = Object.values(snapshot.projection.steps).find(item => (
        item.candidateHash
        && item.confirmation === 'adopt'
        && (item.status === 'running' || (item.status === 'succeeded' && !item.adoptionHash))
      ))
      if (!step?.candidateHash) continue
      const candidate = await candidateForSnapshot(scope, snapshot)
      if (!candidate) throw new Error('已确认运行缺少可校验的持久化候选')
      if (step.adoptionHash) {
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
      } else {
        const intent = await adoptionIntentForSnapshot(scope, snapshot, candidate)
        if (!intent) throw new Error('已确认运行缺少哈希匹配的采纳计划')
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
