import Dexie from 'dexie'
import { db } from '../../db/schema'
import type {
  AgentRunCheckpointRecord,
  AgentRunProjectionV1,
  AnyAgentRunEventV1,
  WorkspaceScope,
} from '../../types'
import { scopeTransactionTables } from '../../workspace/scope'
import { parseAgentRunEventV1 } from './event-schema'
import {
  AgentRunStoreError,
  agentRunScopeTransactionTablesV1,
  appendPrivilegedAgentRunEventInTransactionV1,
  readVerifiedAgentRunInTransactionV1,
  withAgentRunMutationLockV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { canonicalStringify, hashCanonicalValue } from './hash'
import {
  hashAgentRunProjectionBodyV1,
  replayAgentRunEventsV1,
} from './projection'

interface CheckpointHashBodyV1 {
  version: 1
  generation: number
  throughSequence: number
  projectionHash: string
  resumePayloadHash: string | null
}

export interface AgentRunRecoveryPlanV1 {
  checkpointId: number
  checkpointHash: string
  throughSequence: number
  completedStepIds: string[]
  persistedCandidateStepIds: string[]
  confirmedAdoptionStepIds: string[]
  committedAdoptionStepIds: string[]
  resumePayload: unknown | null
  snapshot: AgentRunSnapshotV1
}

export interface VerifiedAgentRunCheckpointV1 {
  checkpoint: AgentRunCheckpointRecord & { id: number }
  projection: AgentRunProjectionV1
  resumePayload: unknown | null
  snapshot: AgentRunSnapshotV1
}

function fail(code: string, message: string): never {
  throw new AgentRunStoreError(code, message)
}

function checkpointHashBody(checkpoint: AgentRunCheckpointRecord): CheckpointHashBodyV1 {
  return {
    version: 1,
    generation: checkpoint.generation,
    throughSequence: checkpoint.throughSequence,
    projectionHash: checkpoint.projectionHash,
    resumePayloadHash: checkpoint.resumePayloadHash ?? null,
  }
}

async function waitForHash(value: unknown): Promise<string> {
  return Dexie.waitFor(hashCanonicalValue(value))
}

function parseResumePayload(checkpoint: AgentRunCheckpointRecord): unknown | null {
  if (checkpoint.resumePayloadJson == null) return null
  try {
    return JSON.parse(checkpoint.resumePayloadJson)
  } catch {
    fail('checkpoint_resume_json', '检查点恢复载荷 JSON 已损坏')
  }
}

function recordToEvent(record: {
  runId: number
  sequence: number
  generation: number
  projectId: number
  worldGroupId?: number | null
  contractHash: string
  type: AnyAgentRunEventV1['type']
  payloadJson: string
  createdAt: number
}): AnyAgentRunEventV1 {
  let payload: unknown
  try {
    payload = JSON.parse(record.payloadJson)
  } catch {
    fail('checkpoint_event_json', `检查点关联事件 ${record.sequence} 的 payloadJson 已损坏`)
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
    payload,
    createdAt: record.createdAt,
  })
}

async function verifyCheckpointAgainstSnapshot(
  checkpoint: AgentRunCheckpointRecord & { id: number },
  snapshot: AgentRunSnapshotV1,
): Promise<AgentRunProjectionV1> {
  if (
    checkpoint.runId !== snapshot.run.id
    || checkpoint.projectId !== snapshot.run.projectId
    || (checkpoint.worldGroupId ?? null) !== (snapshot.run.worldGroupId ?? null)
  ) fail('checkpoint_scope', '检查点与运行作用域不一致')
  if (
    checkpoint.generation !== snapshot.run.generation
    || checkpoint.contractHash !== snapshot.run.contractHash
  ) fail('checkpoint_stale', '检查点来自旧契约代际，不能恢复当前运行')

  const events = await db.agentRunEvents.where('runId').equals(snapshot.run.id).sortBy('sequence')
  const throughEvents = events
    .filter(event => event.sequence <= checkpoint.throughSequence)
    .map(recordToEvent)
  const projection = replayAgentRunEventsV1(throughEvents)
  if (projection.errors.length > 0 || projection.state === 'recovery_required') {
    fail('checkpoint_replay', projection.errors.join('；') || '检查点之前的事件流不可重放')
  }
  let storedProjection: unknown
  try {
    storedProjection = JSON.parse(checkpoint.projectionJson)
  } catch {
    fail('checkpoint_projection_json', '检查点投影 JSON 已损坏')
  }
  // Dexie.waitFor spins an IndexedDB keep-alive loop while WebCrypto resolves.
  // Concurrent loops in one transaction can starve one another under sustained
  // checkpoint replay, so keep these integrity checks deliberately sequential.
  const storedProjectionHash = await waitForHash(storedProjection)
  const replayProjectionHash = await Dexie.waitFor(hashAgentRunProjectionBodyV1(projection))
  if (
    storedProjectionHash !== checkpoint.projectionHash
    || replayProjectionHash !== checkpoint.projectionHash
  ) fail('checkpoint_projection_hash', '检查点投影与事件重放不一致')

  const resumePayload = parseResumePayload(checkpoint)
  const resumePayloadHash = resumePayload == null ? null : await waitForHash(resumePayload)
  if (resumePayloadHash !== (checkpoint.resumePayloadHash ?? null)) {
    fail('checkpoint_resume_hash', '检查点恢复载荷哈希不匹配')
  }
  const expectedCheckpointHash = await waitForHash(checkpointHashBody(checkpoint))
  if (expectedCheckpointHash !== checkpoint.checkpointHash) {
    fail('checkpoint_hash', '检查点内容哈希不匹配')
  }

  const checkpointEventRecord = events.find(event => event.sequence === checkpoint.throughSequence + 1)
  if (!checkpointEventRecord) fail('checkpoint_event_missing', '检查点缺少对应的 checkpoint.created 事件')
  const checkpointEvent = recordToEvent(checkpointEventRecord)
  if (
    checkpointEvent.type !== 'checkpoint.created'
    || checkpointEvent.payload.throughSequence !== checkpoint.throughSequence
    || checkpointEvent.payload.checkpointHash !== checkpoint.checkpointHash
  ) fail('checkpoint_event_mismatch', 'checkpoint.created 事件与检查点不一致')
  return projection
}

async function latestCheckpoint(runId: number): Promise<(AgentRunCheckpointRecord & { id: number }) | null> {
  const checkpoints = await db.agentRunCheckpoints.where('runId').equals(runId).sortBy('throughSequence')
  return checkpoints.length > 0
    ? checkpoints[checkpoints.length - 1] as AgentRunCheckpointRecord & { id: number }
    : null
}

function recoveryPlan(
  checkpoint: AgentRunCheckpointRecord & { id: number },
  projection: AgentRunProjectionV1,
  snapshot: AgentRunSnapshotV1,
): AgentRunRecoveryPlanV1 {
  return {
    checkpointId: checkpoint.id,
    checkpointHash: checkpoint.checkpointHash,
    throughSequence: checkpoint.throughSequence,
    completedStepIds: Object.values(projection.steps)
      .filter(step => step.status === 'succeeded')
      .map(step => step.stepId),
    persistedCandidateStepIds: Object.values(projection.steps)
      .filter(step => !!step.candidateHash)
      .map(step => step.stepId),
    confirmedAdoptionStepIds: Object.values(projection.steps)
      .filter(step => step.confirmation === 'adopt')
      .map(step => step.stepId),
    committedAdoptionStepIds: Object.values(projection.steps)
      .filter(step => !!step.adoptionHash)
      .map(step => step.stepId),
    resumePayload: parseResumePayload(checkpoint),
    snapshot,
  }
}

export async function createAgentRunCheckpointInTransactionV1(input: {
  snapshot: AgentRunSnapshotV1
  resumePayload?: unknown
  now?: number
}): Promise<{ checkpoint: AgentRunCheckpointRecord & { id: number }; snapshot: AgentRunSnapshotV1 }> {
  const resumePayloadJson = input.resumePayload === undefined
    ? null
    : canonicalStringify(input.resumePayload)
  const resumePayloadHash = input.resumePayload === undefined
    ? null
    : await waitForHash(input.resumePayload)
  const snapshot = input.snapshot
  if (['completed', 'failed', 'cancelled', 'recovery_required'].includes(snapshot.projection.state)) {
    fail('checkpoint_terminal', `终态 ${snapshot.projection.state} 不能创建检查点`)
  }

  const throughSequence = snapshot.projection.lastSequence
  const base: AgentRunCheckpointRecord = {
    projectId: snapshot.run.projectId,
    worldGroupId: snapshot.run.worldGroupId ?? null,
    runId: snapshot.run.id,
    throughSequence,
    generation: snapshot.run.generation,
    contractHash: snapshot.run.contractHash,
    checkpointHash: '0'.repeat(64),
    projectionJson: snapshot.run.projectionJson,
    projectionHash: snapshot.run.projectionHash,
    resumePayloadJson,
    resumePayloadHash,
    createdAt: input.now ?? Date.now(),
  }
  base.checkpointHash = await waitForHash(checkpointHashBody(base))
  const checkpointId = await db.agentRunCheckpoints.add(base) as number
  const checkpoint = { ...base, id: checkpointId }
  const event = parseAgentRunEventV1({
    version: 1,
    runId: snapshot.run.id,
    sequence: throughSequence + 1,
    generation: snapshot.run.generation,
    projectId: snapshot.run.projectId,
    worldGroupId: snapshot.run.worldGroupId ?? null,
    contractHash: snapshot.run.contractHash,
    type: 'checkpoint.created',
    payload: { throughSequence, checkpointHash: checkpoint.checkpointHash },
    createdAt: checkpoint.createdAt,
  })
  const next = await appendPrivilegedAgentRunEventInTransactionV1(snapshot, event)
  return { checkpoint, snapshot: next }
}

export async function createAgentRunCheckpointV1(input: {
  scope: WorkspaceScope
  runId: number
  productRuntimeSessionId?: number
  resumePayload?: unknown
  expectedLastSequence?: number
  now?: number
}): Promise<{ checkpoint: AgentRunCheckpointRecord & { id: number }; snapshot: AgentRunSnapshotV1 }> {
  return withAgentRunMutationLockV1(input.runId, () => db.transaction(
    'rw',
    input.productRuntimeSessionId == null
      ? agentRunScopeTransactionTablesV1(input.runId, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints)
      : scopeTransactionTables(db.productRuntimeSessions, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints),
    async () => {
      const snapshot = await readVerifiedAgentRunInTransactionV1(input.scope, input.runId)
      if (
        input.productRuntimeSessionId != null
        && snapshot.run.productRuntimeSessionId !== input.productRuntimeSessionId
      ) fail('checkpoint_scope', '运行实例 owner 与检查点参数不一致')
      if (
        input.expectedLastSequence != null
        && input.expectedLastSequence !== snapshot.projection.lastSequence
      ) fail('sequence_conflict', '运行已推进，拒绝在过期序号创建检查点')
      return createAgentRunCheckpointInTransactionV1({
        snapshot,
        resumePayload: input.resumePayload,
        now: input.now,
      })
    },
  ))
}

export async function verifyAgentRunCheckpointV1(
  scope: WorkspaceScope,
  checkpointId: number,
): Promise<boolean> {
  try {
    const run = await db.agentRunCheckpoints.get(checkpointId)
    if (!run) fail('checkpoint_not_found', '检查点不存在')
    return await db.transaction(
      'r',
      agentRunScopeTransactionTablesV1(run.runId, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints),
      async () => {
        const checkpoint = await db.agentRunCheckpoints.get(checkpointId)
        if (!checkpoint || checkpoint.id == null) fail('checkpoint_not_found', '检查点不存在')
        const snapshot = await readVerifiedAgentRunInTransactionV1(scope, checkpoint.runId)
        await verifyCheckpointAgainstSnapshot(
          checkpoint as AgentRunCheckpointRecord & { id: number },
          snapshot,
        )
        return true
      },
    )
  } catch (error) {
    if (error instanceof AgentRunStoreError) return false
    throw error
  }
}

/** Read the latest checkpoint only after replay, scope and payload hashes agree. */
export async function readLatestVerifiedAgentRunCheckpointV1(
  scope: WorkspaceScope,
  runId: number,
  options: { owner?: 'work' | 'instance' } = {},
): Promise<VerifiedAgentRunCheckpointV1 | null> {
  return db.transaction(
    'r',
    options.owner === 'instance'
      ? scopeTransactionTables(db.productRuntimeSessions, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints)
      : agentRunScopeTransactionTablesV1(runId, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints),
    async () => {
      const snapshot = await readVerifiedAgentRunInTransactionV1(scope, runId)
      const checkpoint = await latestCheckpoint(runId)
      if (!checkpoint) return null
      const projection = await verifyCheckpointAgainstSnapshot(checkpoint, snapshot)
      return {
        checkpoint,
        projection,
        resumePayload: parseResumePayload(checkpoint),
        snapshot,
      }
    },
  )
}

export async function beginAgentRunRecoveryV1(input: {
  scope: WorkspaceScope
  runId: number
  expectedLastSequence?: number
  now?: number
}): Promise<AgentRunRecoveryPlanV1> {
  return withAgentRunMutationLockV1(input.runId, () => db.transaction(
    'rw',
    agentRunScopeTransactionTablesV1(input.runId, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints),
    async () => {
      const snapshot = await readVerifiedAgentRunInTransactionV1(input.scope, input.runId)
      const checkpoint = await latestCheckpoint(input.runId)
      if (!checkpoint) fail('checkpoint_missing', '运行没有可用检查点')
      const checkpointProjection = await verifyCheckpointAgainstSnapshot(checkpoint, snapshot)

      if (snapshot.projection.state === 'recovering') {
        const last = snapshot.events[snapshot.events.length - 1]
        if (last?.type !== 'recovery.started' || last.payload.checkpointHash !== checkpoint.checkpointHash) {
          fail('recovery_state', '运行停在无法确认来源的 recovering 状态')
        }
        return recoveryPlan(checkpoint, checkpointProjection, snapshot)
      }
      if (snapshot.projection.state !== 'paused') {
        fail('recovery_state', `只有 paused 运行可以恢复，当前为 ${snapshot.projection.state}`)
      }
      if (
        input.expectedLastSequence != null
        && input.expectedLastSequence !== snapshot.projection.lastSequence
      ) fail('sequence_conflict', '运行已推进，恢复基线已过期')
      const event = parseAgentRunEventV1({
        version: 1,
        runId: snapshot.run.id,
        sequence: snapshot.projection.lastSequence + 1,
        generation: snapshot.run.generation,
        projectId: snapshot.run.projectId,
        worldGroupId: snapshot.run.worldGroupId ?? null,
        contractHash: snapshot.run.contractHash,
        type: 'recovery.started',
        payload: { checkpointHash: checkpoint.checkpointHash },
        createdAt: input.now ?? Date.now(),
      })
      const recovering = await appendPrivilegedAgentRunEventInTransactionV1(snapshot, event)
      return recoveryPlan(checkpoint, checkpointProjection, recovering)
    },
  ))
}

export async function completeAgentRunRecoveryV1(input: {
  scope: WorkspaceScope
  runId: number
  checkpointHash: string
  expectedLastSequence?: number
  now?: number
}): Promise<AgentRunSnapshotV1> {
  return withAgentRunMutationLockV1(input.runId, () => db.transaction(
    'rw',
    agentRunScopeTransactionTablesV1(input.runId, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints),
    async () => {
      const snapshot = await readVerifiedAgentRunInTransactionV1(input.scope, input.runId)
      if (snapshot.projection.state !== 'recovering') {
        fail('recovery_state', `运行当前不是 recovering，而是 ${snapshot.projection.state}`)
      }
      if (
        input.expectedLastSequence != null
        && input.expectedLastSequence !== snapshot.projection.lastSequence
      ) fail('sequence_conflict', '运行已推进，恢复完成基线已过期')
      const checkpoint = await latestCheckpoint(input.runId)
      if (!checkpoint || checkpoint.checkpointHash !== input.checkpointHash) {
        fail('checkpoint_stale', '恢复完成引用的不是最新检查点')
      }
      await verifyCheckpointAgainstSnapshot(checkpoint, snapshot)
      const event = parseAgentRunEventV1({
        version: 1,
        runId: snapshot.run.id,
        sequence: snapshot.projection.lastSequence + 1,
        generation: snapshot.run.generation,
        projectId: snapshot.run.projectId,
        worldGroupId: snapshot.run.worldGroupId ?? null,
        contractHash: snapshot.run.contractHash,
        type: 'recovery.completed',
        payload: { checkpointHash: checkpoint.checkpointHash },
        createdAt: input.now ?? Date.now(),
      })
      return appendPrivilegedAgentRunEventInTransactionV1(snapshot, event)
    },
  ))
}
