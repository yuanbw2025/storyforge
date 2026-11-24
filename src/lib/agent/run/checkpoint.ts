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
import { assertExactRunArtifactBodySafeV1 } from '../../memory/evidence-policy'
import {
  hashAgentRunProjectionBodyV1,
  replayAgentRunEventsV1,
} from './projection'
import { agentRunUtf8ByteLengthV1 } from './checkpoint-contract'
import { sha256Text } from '../../ai/chapter-memory/text-normalization'

interface CheckpointHashBodyV1 {
  version: 1
  generation: number
  throughSequence: number
  projectionHash: string
  resumePayloadHash: string | null
}

/** B20d: a checkpoint may store only this small content-addressed reference.
 * The full resume payload body lives in the registered exact artifact table and
 * is pinned by an evidence.artifact.recorded event in the same run. Old
 * checkpoints keep storing their JSON inline; readers resolve either shape. */
export interface AgentRunCheckpointArtifactRefV1 {
  version: 1
  kind: 'agent-run-checkpoint-artifact-v1'
  artifactKind: 'tool-result'
  contentHash: string
  byteLength: number
}

function isCheckpointArtifactRefV1(value: unknown): value is AgentRunCheckpointArtifactRefV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.version === 1
    && record.kind === 'agent-run-checkpoint-artifact-v1'
    && record.artifactKind === 'tool-result'
    && typeof record.contentHash === 'string' && /^[a-f0-9]{64}$/.test(record.contentHash)
    && Number.isSafeInteger(record.byteLength) && (record.byteLength as number) > 0
}

const CHECKPOINT_ARTIFACT_KIND_V1 = 'tool-result' as const

/** Peek whether this run's latest checkpoint stores a content-addressed
 * reference. Callers keep the original narrow transaction table set for inline
 * checkpoints and widen only when the reference actually has to be resolved. */
async function checkpointUsesArtifactRefV1(runId: number): Promise<boolean> {
  const row = await db.agentRunCheckpoints
    .where('[runId+throughSequence]')
    .between([runId, Dexie.minKey], [runId, Dexie.maxKey])
    .last() as AgentRunCheckpointRecord | undefined
  if (!row || row.resumePayloadJson == null) return false
  try {
    return isCheckpointArtifactRefV1(JSON.parse(row.resumePayloadJson))
  } catch {
    return false
  }
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

interface VerifiedCheckpointBodyV1 {
  projection: AgentRunProjectionV1
  resumePayload: unknown | null
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

function parseStoredResumePayload(checkpoint: AgentRunCheckpointRecord): unknown | null {
  if (checkpoint.resumePayloadJson == null) return null
  if (typeof checkpoint.resumePayloadJson !== 'string') {
    fail('checkpoint_resume_json', '检查点恢复载荷必须是 JSON 字符串')
  }
  try {
    return JSON.parse(checkpoint.resumePayloadJson)
  } catch {
    fail('checkpoint_resume_json', '检查点恢复载荷 JSON 已损坏')
  }
}

/** Resolve a content-addressed checkpoint reference inside the caller's read
 * transaction. The artifact must be pinned by this run's event ledger, still
 * available (not pruned), and byte/hash exact; no partial or truncated body is
 * ever returned as a resume state. */
async function resolveCheckpointArtifactRefV1(
  ref: AgentRunCheckpointArtifactRefV1,
  projectId: number,
  events: readonly { type: string; payload: unknown }[],
): Promise<unknown> {
  const pinned = events.some(event => {
    if (event.type !== 'evidence.artifact.recorded') return false
    const payload = event.payload as { artifactKind?: unknown; contentHash?: unknown; byteLength?: unknown }
    return payload.artifactKind === ref.artifactKind
      && payload.contentHash === ref.contentHash
      && payload.byteLength === ref.byteLength
  })
  if (!pinned) fail('checkpoint_artifact_unpinned', '检查点工件没有本 Run 的登记事件')
  const row = await db.agentRunArtifacts
    .where('[projectId+artifactKind+contentHash]')
    .equals([projectId, ref.artifactKind, ref.contentHash])
    .first()
  if (!row || row.retentionState !== 'available' || row.content == null) {
    fail('checkpoint_artifact_missing', '检查点工件已裁剪或缺失')
  }
  const content = row.content
  const contentHash = await Dexie.waitFor(sha256Text(content))
  if (contentHash !== ref.contentHash || agentRunUtf8ByteLengthV1(content) !== ref.byteLength) {
    fail('checkpoint_artifact_hash', '检查点工件全文 hash 或长度不匹配')
  }
  try {
    return JSON.parse(content)
  } catch {
    fail('checkpoint_artifact_json', '检查点工件正文 JSON 已损坏')
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
  options: { maximumResumePayloadBytes?: number } = {},
): Promise<VerifiedCheckpointBodyV1> {
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

  // Only an explicit caller read boundary applies; stored model material has no default text quota.
  const maximumResumePayloadBytes = options.maximumResumePayloadBytes ?? null
  if (maximumResumePayloadBytes !== null && (!Number.isSafeInteger(maximumResumePayloadBytes) || maximumResumePayloadBytes < 0)) {
    fail('checkpoint_resume_budget', '检查点恢复载荷预算无效')
  }
  if (maximumResumePayloadBytes !== null && checkpoint.resumePayloadJson != null
    && agentRunUtf8ByteLengthV1(checkpoint.resumePayloadJson) > maximumResumePayloadBytes) {
    fail('checkpoint_resume_budget', '检查点恢复载荷超过安全读取预算')
  }
  const storedResumePayload = parseStoredResumePayload(checkpoint)
  const resumePayloadHash = storedResumePayload == null ? null : await waitForHash(storedResumePayload)
  if (resumePayloadHash !== (checkpoint.resumePayloadHash ?? null)) {
    fail('checkpoint_resume_hash', '检查点恢复载荷哈希不匹配')
  }
  const resumePayload = isCheckpointArtifactRefV1(storedResumePayload)
    ? (maximumResumePayloadBytes !== null && storedResumePayload.byteLength > maximumResumePayloadBytes
      ? fail('checkpoint_resume_budget', '检查点恢复载荷超过安全读取预算')
      : await resolveCheckpointArtifactRefV1(storedResumePayload, snapshot.run.projectId, snapshot.events))
    : storedResumePayload
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
  return { projection, resumePayload }
}

async function latestCheckpoint(runId: number): Promise<(AgentRunCheckpointRecord & { id: number }) | null> {
  const checkpoint = await db.agentRunCheckpoints
    .where('[runId+throughSequence]')
    .between([runId, Dexie.minKey], [runId, Dexie.maxKey])
    .last()
  return checkpoint == null ? null : checkpoint as AgentRunCheckpointRecord & { id: number }
}

function recoveryPlan(
  checkpoint: AgentRunCheckpointRecord & { id: number },
  projection: AgentRunProjectionV1,
  snapshot: AgentRunSnapshotV1,
  resumePayload: unknown | null,
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
    resumePayload,
    snapshot,
  }
}

export async function createAgentRunCheckpointInTransactionV1(input: {
  snapshot: AgentRunSnapshotV1
  resumePayload?: unknown
  /** B20d opt-in: persist a large payload as a content-addressed exact
   * artifact and store only the small reference in the checkpoint record. */
  resumePayloadArtifact?: { content: unknown }
  now?: number
}): Promise<{ checkpoint: AgentRunCheckpointRecord & { id: number }; snapshot: AgentRunSnapshotV1 }> {
  let snapshot = input.snapshot
  let storedResumePayload = input.resumePayload
  if (input.resumePayloadArtifact) {
    if (input.resumePayload !== undefined) fail('checkpoint_payload_conflict', '检查点不能同时写入内联和引用载荷')
    const content = canonicalStringify(input.resumePayloadArtifact.content)
    assertExactRunArtifactBodySafeV1({ artifactKind: CHECKPOINT_ARTIFACT_KIND_V1, body: content })
    try {
      assertExactRunArtifactBodySafeV1({ artifactKind: CHECKPOINT_ARTIFACT_KIND_V1, body: JSON.parse(content) })
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
    const contentHash = await Dexie.waitFor(sha256Text(content))
    const byteLength = agentRunUtf8ByteLengthV1(content)
    const existing = await db.agentRunArtifacts
      .where('[projectId+artifactKind+contentHash]')
      .equals([snapshot.run.projectId, CHECKPOINT_ARTIFACT_KIND_V1, contentHash])
      .first()
    if (existing) {
      if (existing.retentionState !== 'available' || existing.content == null) fail('checkpoint_artifact_missing', '同 hash 检查点工件已裁剪')
      if (existing.content !== content || existing.byteLength !== byteLength) fail('checkpoint_artifact_hash', '同 hash 检查点工件正文不一致')
    } else {
      const now = input.now ?? Date.now()
      await db.agentRunArtifacts.add({
        projectId: snapshot.run.projectId,
        artifactKind: CHECKPOINT_ARTIFACT_KIND_V1,
        contentHash,
        encoding: 'utf-8',
        byteLength,
        content,
        retentionState: 'available',
        pruneReceiptJson: null,
        pruneReceiptHash: null,
        createdAt: now,
        updatedAt: now,
      })
    }
    const payload = { artifactKind: CHECKPOINT_ARTIFACT_KIND_V1, contentHash, byteLength }
    if (!snapshot.events.some(event => event.type === 'evidence.artifact.recorded'
      && (event.payload as { artifactKind?: unknown; contentHash?: unknown; byteLength?: unknown }).artifactKind === payload.artifactKind
      && (event.payload as { contentHash?: unknown }).contentHash === payload.contentHash
      && (event.payload as { byteLength?: unknown }).byteLength === payload.byteLength)) {
      snapshot = await appendPrivilegedAgentRunEventInTransactionV1(snapshot, parseAgentRunEventV1({
        version: 1,
        runId: snapshot.run.id,
        sequence: snapshot.projection.lastSequence + 1,
        generation: snapshot.projection.generation,
        projectId: snapshot.run.projectId,
        worldGroupId: snapshot.run.worldGroupId ?? null,
        contractHash: snapshot.run.contractHash,
        type: 'evidence.artifact.recorded',
        createdAt: input.now ?? Date.now(),
        payload,
      }))
    }
    storedResumePayload = {
      version: 1,
      kind: 'agent-run-checkpoint-artifact-v1',
      artifactKind: CHECKPOINT_ARTIFACT_KIND_V1,
      contentHash,
      byteLength,
    } satisfies AgentRunCheckpointArtifactRefV1
  }
  const resumePayloadJson = storedResumePayload === undefined
    ? null
    : canonicalStringify(storedResumePayload)
  const resumePayloadHash = storedResumePayload === undefined
    ? null
    : await waitForHash(storedResumePayload)
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
  resumePayloadArtifact?: { content: unknown }
  expectedLastSequence?: number
  now?: number
}): Promise<{ checkpoint: AgentRunCheckpointRecord & { id: number }; snapshot: AgentRunSnapshotV1 }> {
  const artifactTables = input.resumePayloadArtifact ? [db.agentRunArtifacts] : []
  return withAgentRunMutationLockV1(input.runId, () => db.transaction(
    'rw',
    input.productRuntimeSessionId == null
      ? agentRunScopeTransactionTablesV1(input.runId, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, ...artifactTables)
      : scopeTransactionTables(db.productRuntimeSessions, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, ...artifactTables),
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
        ...(input.resumePayloadArtifact ? { resumePayloadArtifact: input.resumePayloadArtifact } : {}),
        now: input.now,
      })
    },
  ))
}

export async function verifyAgentRunCheckpointV1(
  scope: WorkspaceScope,
  checkpointId: number,
  options: { productRuntimeSessionId?: number } = {},
): Promise<boolean> {
  const productRuntimeSessionId = options.productRuntimeSessionId
  try {
    const run = await db.agentRunCheckpoints.get(checkpointId)
    if (!run) fail('checkpoint_not_found', '检查点不存在')
    const artifactTables = await checkpointUsesArtifactRefV1(run.runId) ? [db.agentRunArtifacts] : []
    return await db.transaction(
      'r',
      productRuntimeSessionId == null
        ? agentRunScopeTransactionTablesV1(run.runId, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, ...artifactTables)
        : scopeTransactionTables(db.productRuntimeSessions, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, ...artifactTables),
      async () => {
        const checkpoint = await db.agentRunCheckpoints.get(checkpointId)
        if (!checkpoint || checkpoint.id == null) fail('checkpoint_not_found', '检查点不存在')
        const snapshot = await readVerifiedAgentRunInTransactionV1(scope, checkpoint.runId)
        if (productRuntimeSessionId != null && snapshot.run.productRuntimeSessionId !== productRuntimeSessionId) fail('checkpoint_scope', '检查点核验的实例 owner 不匹配')
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
  options: {
    owner?: 'work' | 'instance'
    maximumResumePayloadBytes?: number
  } = {},
): Promise<VerifiedAgentRunCheckpointV1 | null> {
  const artifactTables = await checkpointUsesArtifactRefV1(runId) ? [db.agentRunArtifacts] : []
  return db.transaction(
    'r',
    options.owner === 'instance'
      ? scopeTransactionTables(db.productRuntimeSessions, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, ...artifactTables)
      : agentRunScopeTransactionTablesV1(runId, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, ...artifactTables),
    async () => {
      const snapshot = await readVerifiedAgentRunInTransactionV1(scope, runId)
      const checkpoint = await latestCheckpoint(runId)
      if (!checkpoint) return null
      const verified = await verifyCheckpointAgainstSnapshot(checkpoint, snapshot, {
        maximumResumePayloadBytes: options.maximumResumePayloadBytes,
      })
      return {
        checkpoint,
        projection: verified.projection,
        resumePayload: verified.resumePayload,
        snapshot,
      }
    },
  )
}

export async function beginAgentRunRecoveryV1(input: {
  scope: WorkspaceScope
  runId: number
  productRuntimeSessionId?: number
  expectedLastSequence?: number
  now?: number
}): Promise<AgentRunRecoveryPlanV1> {
  const productRuntimeSessionId = input.productRuntimeSessionId
  const artifactTables = await checkpointUsesArtifactRefV1(input.runId) ? [db.agentRunArtifacts] : []
  return withAgentRunMutationLockV1(input.runId, () => db.transaction(
    'rw',
    productRuntimeSessionId == null
      ? agentRunScopeTransactionTablesV1(input.runId, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, ...artifactTables)
      : scopeTransactionTables(db.productRuntimeSessions, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, ...artifactTables),
    async () => {
      const snapshot = await readVerifiedAgentRunInTransactionV1(input.scope, input.runId)
      if (productRuntimeSessionId != null && snapshot.run.productRuntimeSessionId !== productRuntimeSessionId) fail('checkpoint_scope', '恢复开始的实例 owner 不匹配')
      const checkpoint = await latestCheckpoint(input.runId)
      if (!checkpoint) fail('checkpoint_missing', '运行没有可用检查点')
      const verified = await verifyCheckpointAgainstSnapshot(checkpoint, snapshot)
      const checkpointProjection = verified.projection

      if (snapshot.projection.state === 'recovering') {
        const last = snapshot.events[snapshot.events.length - 1]
        if (last?.type !== 'recovery.started' || last.payload.checkpointHash !== checkpoint.checkpointHash) {
          fail('recovery_state', '运行停在无法确认来源的 recovering 状态')
        }
        return recoveryPlan(checkpoint, checkpointProjection, snapshot, verified.resumePayload)
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
      return recoveryPlan(checkpoint, checkpointProjection, recovering, verified.resumePayload)
    },
  ))
}

export async function completeAgentRunRecoveryV1(input: {
  scope: WorkspaceScope
  runId: number
  productRuntimeSessionId?: number
  checkpointHash: string
  expectedLastSequence?: number
  now?: number
}): Promise<AgentRunSnapshotV1> {
  const productRuntimeSessionId = input.productRuntimeSessionId
  const artifactTables = await checkpointUsesArtifactRefV1(input.runId) ? [db.agentRunArtifacts] : []
  return withAgentRunMutationLockV1(input.runId, () => db.transaction(
    'rw',
    productRuntimeSessionId == null
      ? agentRunScopeTransactionTablesV1(input.runId, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, ...artifactTables)
      : scopeTransactionTables(db.productRuntimeSessions, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, ...artifactTables),
    async () => {
      const snapshot = await readVerifiedAgentRunInTransactionV1(input.scope, input.runId)
      if (productRuntimeSessionId != null && snapshot.run.productRuntimeSessionId !== productRuntimeSessionId) fail('checkpoint_scope', '恢复完成的实例 owner 不匹配')
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
