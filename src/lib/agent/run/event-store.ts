import Dexie from 'dexie'
import { db } from '../../db/schema'
import type {
  AcceptedAgentRunContractV1,
  AgentRunContractV1,
  AgentRunEventPayloadByTypeV1,
  AgentRunEventRecord,
  AgentRunEventTypeV1,
  AgentRunProjectionV1,
  AgentRunRecord,
  AnyAgentRunEventV1,
  WorkspaceScope,
} from '../../types'
import {
  assertRecordInScope,
  resolveScope,
  scopeTransactionTables,
  stampNewRecord,
} from '../../world-engine/scope'
import { acceptAgentRunContractV1, parseAgentRunContractV1 } from './contract'
import { parseAgentRunEventV1 } from './event-schema'
import { canonicalStringify, hashCanonicalValue } from './hash'
import {
  hashAgentRunProjectionBodyV1,
  replayAgentRunEventsV1,
  toAgentRunProjectionBodyV1,
} from './projection'

export class AgentRunStoreError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[agent-run:${code}] ${message}`)
    this.name = 'AgentRunStoreError'
  }
}

export interface AgentRunSnapshotV1 {
  run: AgentRunRecord & { id: number }
  contract: AgentRunContractV1
  events: AnyAgentRunEventV1[]
  projection: AgentRunProjectionV1
}

export interface CreateAgentRunV1Input {
  scope: WorkspaceScope
  worldGroupId?: number | null
  conversationId?: number | null
  contract: unknown
  now?: number
}

export interface AppendAgentRunEventV1Input<T extends AgentRunEventTypeV1> {
  scope: WorkspaceScope
  runId: number
  type: T
  payload: AgentRunEventPayloadByTypeV1[T]
  expectedLastSequence?: number
  now?: number
}

const RESERVED_EVENT_TYPES = new Set<AgentRunEventTypeV1>([
  'run.created',
  'contract.accepted',
  'contract.revised',
  'verification.staled',
  'checkpoint.created',
  'recovery.started',
  'recovery.completed',
])

const RUN_MUTATION_TAILS = new Map<number, Promise<void>>()

/** Serialize same-tab mutations; IndexedDB's unique sequence index remains the
 * cross-tab authority, while this avoids overlapping WebCrypto keep-alives. */
export function withAgentRunMutationLockV1<T>(
  runId: number,
  mutation: () => Promise<T>,
): Promise<T> {
  const prior = RUN_MUTATION_TAILS.get(runId) ?? Promise.resolve()
  const result = prior.then(mutation, mutation)
  const tail = result.then(() => undefined, () => undefined)
  RUN_MUTATION_TAILS.set(runId, tail)
  return result.finally(() => {
    if (RUN_MUTATION_TAILS.get(runId) === tail) RUN_MUTATION_TAILS.delete(runId)
  })
}

function fail(code: string, message: string): never {
  throw new AgentRunStoreError(code, message)
}

function sameNullableId(left: number | null | undefined, right: number | null | undefined): boolean {
  return (left ?? null) === (right ?? null)
}

function sameNullableText(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? null) === (right ?? null)
}

async function waitForHash(value: unknown): Promise<string> {
  return Dexie.waitFor(hashCanonicalValue(value))
}

async function assertContractScope(
  scope: WorkspaceScope,
  contract: AgentRunContractV1,
  expectedWorldGroupId: number | null,
): Promise<void> {
  if (contract.scope.projectId !== scope.projectId) {
    fail('contract_scope', 'RunContract.projectId 与 WorkspaceScope 不一致')
  }
  if (!sameNullableId(contract.scope.worldGroupId, expectedWorldGroupId)) {
    fail('contract_scope', 'RunContract.worldGroupId 与运行作用域不一致')
  }

  if (expectedWorldGroupId != null) {
    const group = await db.worldGroups.get(expectedWorldGroupId)
    if (!group || group.projectId !== scope.projectId) {
      fail('world_scope', 'RunContract 引用了不属于当前工作区的世界组')
    }
  }

  for (const outlineNodeId of contract.scope.outlineNodeIds ?? []) {
    const node = await db.outlineNodes.get(outlineNodeId)
    if (!node || !await assertRecordInScope(scope, 'outlineNodes', node, { owner: 'work' })) {
      fail('outline_scope', `RunContract 引用了越界大纲节点 ${outlineNodeId}`)
    }
    if (!sameNullableId(node.worldGroupId, expectedWorldGroupId)) {
      fail('outline_world_scope', `大纲节点 ${outlineNodeId} 不属于 RunContract 世界组`)
    }
  }

  for (const chapterId of contract.scope.chapterIds ?? []) {
    const chapter = await db.chapters.get(chapterId)
    if (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
      fail('chapter_scope', `RunContract 引用了越界章节 ${chapterId}`)
    }
    const node = await db.outlineNodes.get(chapter.outlineNodeId)
    if (!node || !await assertRecordInScope(scope, 'outlineNodes', node, { owner: 'work' })) {
      fail('chapter_outline_scope', `章节 ${chapterId} 的大纲节点越界或不存在`)
    }
    if (!sameNullableId(node.worldGroupId, expectedWorldGroupId)) {
      fail('chapter_world_scope', `章节 ${chapterId} 不属于 RunContract 世界组`)
    }
  }
}

async function assertOptionalConversationScope(
  scope: WorkspaceScope,
  conversationId: number | null,
  worldGroupId: number | null,
): Promise<void> {
  if (conversationId == null) return
  const conversation = await db.agentConversations.get(conversationId)
  if (!conversation || !await assertRecordInScope(scope, 'agentConversations', conversation, { owner: 'work' })) {
    fail('conversation_scope', '关联对话不存在或越过当前 Work')
  }
  if (!sameNullableId(conversation.worldGroupId, worldGroupId)) {
    fail('conversation_world_scope', '关联对话与运行的世界组不一致')
  }
}

function recordToEvent(record: AgentRunEventRecord): AnyAgentRunEventV1 {
  let payload: unknown
  try {
    payload = JSON.parse(record.payloadJson)
  } catch {
    fail('event_payload_json', `事件 ${record.id ?? '?'} 的 payloadJson 已损坏`)
  }
  return parseAgentRunEventV1({
    version: 1,
    runId: record.runId,
    sequence: record.sequence,
    generation: record.generation,
    projectId: record.projectId,
    worldGroupId: record.worldGroupId ?? null,
    contractHash: record.contractHash,
    type: record.type,
    createdAt: record.createdAt,
    payload,
  })
}

async function readRunEvents(run: AgentRunRecord & { id: number }): Promise<AnyAgentRunEventV1[]> {
  const records = await db.agentRunEvents.where('runId').equals(run.id).sortBy('sequence')
  return records.map(recordToEvent)
}

async function verifyContractRecord(run: AgentRunRecord & { id: number }): Promise<AgentRunContractV1> {
  let raw: unknown
  try {
    raw = JSON.parse(run.contractJson)
  } catch {
    fail('contract_json', '运行契约 JSON 已损坏')
  }
  const contract = parseAgentRunContractV1(raw)
  const contractHash = await waitForHash(contract)
  if (contractHash !== run.contractHash || run.contractVersion !== 1) {
    fail('contract_hash', '运行契约哈希或版本不匹配')
  }
  if (
    contract.scope.projectId !== run.projectId
    || !sameNullableId(contract.scope.worldGroupId, run.worldGroupId)
  ) {
    fail('contract_scope', '运行契约内嵌作用域与运行行不一致')
  }
  const parent = contract.lineage?.parent
  if (
    !sameNullableId(parent?.runId, run.parentRunId)
    || !sameNullableText(parent?.relation, run.parentRelation)
    || !sameNullableText(parent?.receiptHash, run.parentReceiptHash)
    || !sameNullableText(parent?.artifactHash, run.parentArtifactHash)
  ) {
    fail('contract_lineage', '运行契约父子来源与物化列不一致')
  }
  return contract
}

async function assertParentLineageForCreationV1(
  scope: WorkspaceScope,
  contract: AgentRunContractV1,
): Promise<void> {
  const lineage = contract.lineage?.parent
  if (!lineage) return
  const parent = await readVerifiedAgentRunInTransactionV1(scope, lineage.runId)
  if (
    parent.projection.state !== 'completed'
    || !parent.projection.terminalReceiptHash
    || parent.projection.terminalReceiptHash !== lineage.receiptHash
  ) {
    fail('parent_receipt', '父运行没有匹配的 fresh terminal receipt')
  }
  if (
    parent.contract.scope.projectId !== contract.scope.projectId
    || !sameNullableId(parent.contract.scope.worldGroupId, contract.scope.worldGroupId)
  ) {
    fail('parent_scope', '父运行与子运行不属于同一项目/世界作用域')
  }
  const existing = await db.agentRuns
    .where('[parentRunId+parentRelation]')
    .equals([lineage.runId, lineage.relation])
    .first()
  if (existing) fail('duplicate_child', '同一父运行和关系已经存在子运行')
}

async function verifyMaterializedProjection(
  run: AgentRunRecord & { id: number },
  events: AnyAgentRunEventV1[],
): Promise<AgentRunProjectionV1> {
  const projection = replayAgentRunEventsV1(events)
  if (projection.errors.length > 0 || projection.state === 'recovery_required') {
    fail('event_replay', projection.errors.join('；') || '事件流需要恢复')
  }
  let storedBody: unknown
  try {
    storedBody = JSON.parse(run.projectionJson)
  } catch {
    fail('projection_json', '运行物化投影 JSON 已损坏')
  }
  // Dexie.waitFor keeps the current IndexedDB transaction alive while WebCrypto
  // resolves. Run the two small hashes sequentially so one transaction never
  // owns competing keep-alive loops during repeated durable event appends.
  const storedHash = await waitForHash(storedBody)
  const replayHash = await Dexie.waitFor(hashAgentRunProjectionBodyV1(projection))
  if (storedHash !== run.projectionHash || replayHash !== run.projectionHash) {
    fail('projection_hash', '物化投影与事件重放结果不一致')
  }
  if (
    run.status !== projection.state
    || run.generation !== projection.generation
    || run.lastSequence !== projection.lastSequence
    || (run.terminalReceiptHash ?? null) !== (projection.terminalReceiptHash ?? null)
  ) {
    fail('projection_columns', '运行物化列与事件投影不一致')
  }
  return projection
}

/** @internal Checkpoint code reuses this inside the same Dexie transaction. */
export async function readVerifiedAgentRunInTransactionV1(
  scope: WorkspaceScope,
  runId: number,
): Promise<AgentRunSnapshotV1> {
  await resolveScope({ scope })
  const run = await db.agentRuns.get(runId)
  if (!run || run.id == null) fail('not_found', `运行 ${runId} 不存在`)
  if (!await assertRecordInScope(scope, 'agentRuns', run, { owner: 'work' })) {
    fail('scope', `运行 ${runId} 不属于当前 Work`)
  }
  const contract = await verifyContractRecord(run as AgentRunRecord & { id: number })
  const events = await readRunEvents(run as AgentRunRecord & { id: number })
  const projection = await verifyMaterializedProjection(run as AgentRunRecord & { id: number }, events)
  return { run: run as AgentRunRecord & { id: number }, contract, events, projection }
}

function eventRecord(event: AnyAgentRunEventV1): AgentRunEventRecord {
  return {
    projectId: event.projectId,
    worldGroupId: event.worldGroupId,
    runId: event.runId,
    sequence: event.sequence,
    generation: event.generation,
    contractHash: event.contractHash,
    type: event.type,
    payloadJson: canonicalStringify(event.payload),
    createdAt: event.createdAt,
  }
}

async function persistProjection(
  runId: number,
  projection: AgentRunProjectionV1,
  updatedAt: number,
  contract?: AcceptedAgentRunContractV1,
): Promise<{ projectionJson: string; projectionHash: string }> {
  const projectionBody = toAgentRunProjectionBodyV1(projection)
  const projectionHash = await waitForHash(projectionBody)
  const projectionJson = canonicalStringify(projectionBody)
  await db.agentRuns.update(runId, {
    status: projection.state,
    generation: projection.generation,
    lastSequence: projection.lastSequence,
    projectionJson,
    projectionHash,
    terminalReceiptHash: projection.terminalReceiptHash ?? null,
    ...(contract ? {
      contractVersion: 1 as const,
      contractJson: canonicalStringify(contract.contract),
      contractHash: contract.contractHash,
    } : {}),
    updatedAt,
  })
  return { projectionJson, projectionHash }
}

/** @internal Appends an already-built privileged event in the caller transaction. */
export async function appendPrivilegedAgentRunEventInTransactionV1(
  snapshot: AgentRunSnapshotV1,
  event: AnyAgentRunEventV1,
  contract?: AcceptedAgentRunContractV1,
): Promise<AgentRunSnapshotV1> {
  if (event.sequence !== snapshot.projection.lastSequence + 1) {
    fail('sequence_conflict', '追加事件序号已过期')
  }
  const projection = replayAgentRunEventsV1([...snapshot.events, event])
  if (projection.errors.length > 0 || projection.state === 'recovery_required') {
    fail('invalid_transition', projection.errors.join('；') || `无法追加 ${event.type}`)
  }
  await db.agentRunEvents.add(eventRecord(event))
  const materialized = await persistProjection(snapshot.run.id, projection, event.createdAt, contract)
  return {
    run: {
      ...snapshot.run,
      status: projection.state,
      generation: projection.generation,
      lastSequence: projection.lastSequence,
      projectionJson: materialized.projectionJson,
      projectionHash: materialized.projectionHash,
      terminalReceiptHash: projection.terminalReceiptHash ?? null,
      updatedAt: event.createdAt,
      ...(contract ? {
        contractJson: canonicalStringify(contract.contract),
        contractHash: contract.contractHash,
      } : {}),
    },
    contract: contract?.contract ?? snapshot.contract,
    events: [...snapshot.events, event],
    projection,
  }
}

export async function createAgentRunV1(input: CreateAgentRunV1Input): Promise<AgentRunSnapshotV1> {
  const accepted = await acceptAgentRunContractV1(input.contract)
  const worldGroupId = input.worldGroupId ?? null
  if (!sameNullableId(worldGroupId, accepted.contract.scope.worldGroupId)) {
    fail('contract_scope', '创建参数 worldGroupId 与 RunContract 不一致')
  }
  const conversationId = input.conversationId ?? null
  const now = input.now ?? Date.now()

  const create = () => db.transaction(
    'rw',
    scopeTransactionTables(
      db.worldGroups,
      db.outlineNodes,
      db.chapters,
      db.agentConversations,
      db.agentRuns,
      db.agentRunEvents,
    ),
    async () => {
      await assertContractScope(input.scope, accepted.contract, worldGroupId)
      await assertOptionalConversationScope(input.scope, conversationId, worldGroupId)
      await assertParentLineageForCreationV1(input.scope, accepted.contract)

      const parent = accepted.contract.lineage?.parent

      const root = stampNewRecord(input.scope, 'agentRuns', {
        projectId: input.scope.projectId,
        workId: input.scope.workId,
        worldGroupId,
        conversationId,
        parentRunId: parent?.runId ?? null,
        parentRelation: parent?.relation ?? null,
        parentReceiptHash: parent?.receiptHash ?? null,
        parentArtifactHash: parent?.artifactHash ?? null,
        status: 'planned' as const,
        contractVersion: 1 as const,
        contractJson: canonicalStringify(accepted.contract),
        contractHash: accepted.contractHash,
        generation: 1,
        lastSequence: 0,
        projectionJson: '{}',
        projectionHash: '0'.repeat(64),
        terminalReceiptHash: null,
        createdAt: now,
        updatedAt: now,
      }, { owner: 'work' })
      const runId = await db.agentRuns.add(root) as number
      const objectiveHash = await waitForHash(accepted.contract.objective)
      const created = parseAgentRunEventV1({
        version: 1,
        runId,
        sequence: 1,
        generation: 1,
        projectId: input.scope.projectId,
        worldGroupId,
        contractHash: accepted.contractHash,
        type: 'run.created',
        createdAt: now,
        payload: { objectiveHash },
      })
      const acceptedEvent = parseAgentRunEventV1({
        version: 1,
        runId,
        sequence: 2,
        generation: 1,
        projectId: input.scope.projectId,
        worldGroupId,
        contractHash: accepted.contractHash,
        type: 'contract.accepted',
        createdAt: now,
        payload: { contractJson: canonicalStringify(accepted.contract) },
      })
      const projection = replayAgentRunEventsV1([created, acceptedEvent])
      await db.agentRunEvents.bulkAdd([eventRecord(created), eventRecord(acceptedEvent)])
      await persistProjection(runId, projection, now)
      const run = await db.agentRuns.get(runId)
      if (!run) fail('create_failed', '运行根写入后不可见')
      return {
        run: run as AgentRunRecord & { id: number },
        contract: accepted.contract,
        events: [created, acceptedEvent],
        projection,
      }
    },
  )
  const parentRunId = accepted.contract.lineage?.parent.runId
  return parentRunId == null ? create() : withAgentRunMutationLockV1(parentRunId, create)
}

export async function readAgentRunV1(
  scope: WorkspaceScope,
  runId: number,
): Promise<AgentRunSnapshotV1> {
  return db.transaction(
    'r',
    scopeTransactionTables(db.agentRuns, db.agentRunEvents),
    () => readVerifiedAgentRunInTransactionV1(scope, runId),
  )
}

/** Read and verify the exact child for a parent/relation pair. */
export async function readAgentRunChildV1(input: {
  scope: WorkspaceScope
  parentRunId: number
  relation: string
}): Promise<AgentRunSnapshotV1 | null> {
  const row = await db.agentRuns
    .where('[parentRunId+parentRelation]')
    .equals([input.parentRunId, input.relation])
    .first()
  if (!row?.id) return null
  return readAgentRunV1(input.scope, row.id)
}

/** Verify that a child still points at the parent's current terminal receipt. */
export async function readCurrentAgentRunParentV1(
  scope: WorkspaceScope,
  child: AgentRunSnapshotV1,
): Promise<AgentRunSnapshotV1 | null> {
  const lineage = child.contract.lineage?.parent
  if (!lineage) return null
  const parent = await readAgentRunV1(scope, lineage.runId)
  if (
    parent.projection.state !== 'completed'
    || parent.projection.terminalReceiptHash !== lineage.receiptHash
  ) fail('parent_receipt', '父运行 terminal receipt 已缺失、过期或不匹配')
  if (
    parent.contract.scope.projectId !== child.contract.scope.projectId
    || !sameNullableId(parent.contract.scope.worldGroupId, child.contract.scope.worldGroupId)
  ) fail('parent_scope', '父运行与子运行作用域不匹配')
  return parent
}

/** Invalidate a completed receipt when durable upstream/post-state evidence is no longer fresh. */
export async function staleAgentRunVerificationV1(input: {
  scope: WorkspaceScope
  runId: number
  reason: string
  now?: number
}): Promise<AgentRunSnapshotV1> {
  return withAgentRunMutationLockV1(input.runId, () => db.transaction(
    'rw',
    scopeTransactionTables(db.agentRuns, db.agentRunEvents),
    async () => {
      const snapshot = await readVerifiedAgentRunInTransactionV1(input.scope, input.runId)
      const previousReceiptHash = snapshot.projection.terminalReceiptHash
      if (snapshot.projection.state !== 'completed' || !previousReceiptHash) return snapshot
      const event = parseAgentRunEventV1({
        version: 1,
        runId: input.runId,
        sequence: snapshot.projection.lastSequence + 1,
        generation: snapshot.projection.generation,
        projectId: snapshot.run.projectId,
        worldGroupId: snapshot.run.worldGroupId ?? null,
        contractHash: snapshot.run.contractHash,
        type: 'verification.staled',
        createdAt: input.now ?? Date.now(),
        payload: {
          previousReceiptHash,
          reason: input.reason.slice(0, 1_000),
        },
      })
      return appendPrivilegedAgentRunEventInTransactionV1(snapshot, event)
    },
  ))
}

export async function appendAgentRunEventV1<T extends AgentRunEventTypeV1>(
  input: AppendAgentRunEventV1Input<T>,
): Promise<AgentRunSnapshotV1> {
  if (RESERVED_EVENT_TYPES.has(input.type)) {
    fail('reserved_event', `${input.type} 只能通过专用运行 API 写入`)
  }
  return withAgentRunMutationLockV1(input.runId, () => db.transaction(
    'rw',
    scopeTransactionTables(db.agentRuns, db.agentRunEvents),
    async () => {
      const snapshot = await readVerifiedAgentRunInTransactionV1(input.scope, input.runId)
      if (
        input.expectedLastSequence != null
        && input.expectedLastSequence !== snapshot.projection.lastSequence
      ) fail('sequence_conflict', '运行已被其它执行者推进，请刷新后重试')
      const event = parseAgentRunEventV1({
        version: 1,
        runId: input.runId,
        sequence: snapshot.projection.lastSequence + 1,
        generation: snapshot.projection.generation,
        projectId: snapshot.run.projectId,
        worldGroupId: snapshot.run.worldGroupId ?? null,
        contractHash: snapshot.run.contractHash,
        type: input.type,
        createdAt: input.now ?? Date.now(),
        payload: input.payload,
      })
      return appendPrivilegedAgentRunEventInTransactionV1(snapshot, event)
    },
  ))
}

export async function reviseAgentRunContractV1(input: {
  scope: WorkspaceScope
  runId: number
  contract: unknown
  expectedLastSequence?: number
  now?: number
}): Promise<AgentRunSnapshotV1> {
  const accepted = await acceptAgentRunContractV1(input.contract)
  return withAgentRunMutationLockV1(input.runId, () => db.transaction(
    'rw',
    scopeTransactionTables(
      db.worldGroups,
      db.outlineNodes,
      db.chapters,
      db.agentRuns,
      db.agentRunEvents,
    ),
    async () => {
      const snapshot = await readVerifiedAgentRunInTransactionV1(input.scope, input.runId)
      if (
        input.expectedLastSequence != null
        && input.expectedLastSequence !== snapshot.projection.lastSequence
      ) fail('sequence_conflict', '运行已被其它执行者推进，请刷新后重试')
      if (canonicalStringify(snapshot.contract.lineage ?? null) !== canonicalStringify(accepted.contract.lineage ?? null)) {
        fail('lineage_immutable', '运行创建后不得修改父子来源关系')
      }
      await assertContractScope(input.scope, accepted.contract, snapshot.run.worldGroupId ?? null)
      const event = parseAgentRunEventV1({
        version: 1,
        runId: input.runId,
        sequence: snapshot.projection.lastSequence + 1,
        generation: snapshot.projection.generation + 1,
        projectId: snapshot.run.projectId,
        worldGroupId: snapshot.run.worldGroupId ?? null,
        contractHash: accepted.contractHash,
        type: 'contract.revised',
        createdAt: input.now ?? Date.now(),
        payload: {
          previousContractHash: snapshot.run.contractHash,
          contractJson: canonicalStringify(accepted.contract),
        },
      })
      return appendPrivilegedAgentRunEventInTransactionV1(snapshot, event, accepted)
    },
  ))
}

export async function deleteAgentRunV1(
  scope: WorkspaceScope,
  runId: number,
): Promise<boolean> {
  return withAgentRunMutationLockV1(runId, () => db.transaction(
    'rw',
    scopeTransactionTables(db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints),
    async () => {
      const run = await db.agentRuns.get(runId)
      if (!run) return false
      await resolveScope({ scope })
      if (!await assertRecordInScope(scope, 'agentRuns', run, { owner: 'work' })) {
        fail('scope', `运行 ${runId} 不属于当前 Work`)
      }
      const runIds: number[] = []
      const pending = [runId]
      while (pending.length > 0) {
        const current = pending.shift()!
        runIds.push(current)
        const children = await db.agentRuns.where('parentRunId').equals(current).primaryKeys()
        pending.push(...children.filter((id): id is number => typeof id === 'number'))
      }
      await db.agentRunEvents.where('runId').anyOf(runIds).delete()
      await db.agentRunCheckpoints.where('runId').anyOf(runIds).delete()
      await db.agentRuns.bulkDelete(runIds)
      return true
    },
  ))
}
