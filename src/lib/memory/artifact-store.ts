import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { db } from '../db/schema'
import type {
  AgentRunArtifactRecordV1,
  AgentRunEventPayloadByTypeV1,
  ExactRunArtifactAvailabilityV1,
  ExactRunArtifactKindV1,
  WorkspaceScope,
} from '../types'
import { assertExactRunArtifactBodySafeV1 } from './evidence-policy'
import {
  agentRunScopeTransactionTablesV1,
  appendPrivilegedAgentRunEventInTransactionV1,
  readVerifiedAgentRunInTransactionV1,
  withAgentRunMutationLockV1,
  type AgentRunSnapshotV1,
} from '../agent/run/event-store'
import { parseAgentRunEventV1 } from '../agent/run/event-schema'

const HASH = /^[a-f0-9]{64}$/

export class AgentRunArtifactStoreError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[agent-run-artifact:${code}] ${message}`)
    this.name = 'AgentRunArtifactStoreError'
  }
}

function fail(code: string, message: string): never {
  throw new AgentRunArtifactStoreError(code, message)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function assertSafeContent(artifactKind: ExactRunArtifactKindV1, content: string): void {
  assertExactRunArtifactBodySafeV1({ artifactKind, body: content })
  try {
    assertExactRunArtifactBodySafeV1({ artifactKind, body: JSON.parse(content) })
  } catch (error) {
    if (error instanceof SyntaxError) return
    throw error
  }
}

function sameEvidenceEvent(
  event: AgentRunSnapshotV1['events'][number],
  payload: AgentRunEventPayloadByTypeV1['evidence.artifact.recorded'],
): boolean {
  return event.type === 'evidence.artifact.recorded'
    && event.payload.artifactKind === payload.artifactKind
    && event.payload.contentHash === payload.contentHash
    && event.payload.byteLength === payload.byteLength
    && event.payload.stepId === payload.stepId
    && event.payload.attempt === payload.attempt
}

export async function recordAgentRunArtifactV1(input: {
  scope: WorkspaceScope
  runId: number
  productRuntimeSessionId?: number
  artifactKind: ExactRunArtifactKindV1
  content: string
  stepId?: string
  attempt?: number
  expectedLastSequence?: number
  now?: number
}): Promise<{
  artifact: AgentRunArtifactRecordV1 & { id: number }
  snapshot: AgentRunSnapshotV1
  bodyCreated: boolean
  eventCreated: boolean
}> {
  if ((input.stepId == null) !== (input.attempt == null)) fail('step-attempt', 'stepId 与 attempt 必须同时提供')
  assertSafeContent(input.artifactKind, input.content)
  const contentHash = await sha256Text(input.content)
  const length = byteLength(input.content)
  const payload: AgentRunEventPayloadByTypeV1['evidence.artifact.recorded'] = {
    artifactKind: input.artifactKind,
    contentHash,
    byteLength: length,
    ...(input.stepId == null ? {} : { stepId: input.stepId, attempt: input.attempt }),
  }
  return withAgentRunMutationLockV1(input.runId, () => db.transaction(
    'rw',
    agentRunScopeTransactionTablesV1(
      input.runId,
      db.agentRunArtifacts,
      db.agentRuns,
      db.agentRunEvents,
      db.worlds,
      db.works,
      db.productRuntimeSessions,
    ),
    async () => {
      let snapshot = await readVerifiedAgentRunInTransactionV1(input.scope, input.runId)
      if ((snapshot.run.productRuntimeSessionId ?? undefined) !== input.productRuntimeSessionId) {
        fail('runtime-owner', '运行实例 owner 与 artifact 参数不一致')
      }
      if (input.expectedLastSequence != null && snapshot.projection.lastSequence !== input.expectedLastSequence) {
        fail('sequence-conflict', '运行已被其它执行者推进，请刷新后重试')
      }
      let artifact = await db.agentRunArtifacts
        .where('[projectId+artifactKind+contentHash]')
        .equals([input.scope.projectId, input.artifactKind, contentHash])
        .first()
      let bodyCreated = false
      if (artifact) {
        if (artifact.retentionState !== 'available' || artifact.content == null) {
          fail('evidence-pruned', '同 hash 的 exact artifact 已裁剪，不得静默复活')
        }
        if (artifact.content !== input.content || artifact.byteLength !== length) {
          fail('hash-collision', '同 hash artifact 正文或 byte length 不一致')
        }
      } else {
        const now = input.now ?? Date.now()
        const id = await db.agentRunArtifacts.add({
          projectId: input.scope.projectId,
          artifactKind: input.artifactKind,
          contentHash,
          encoding: 'utf-8',
          byteLength: length,
          content: input.content,
          retentionState: 'available',
          pruneReceiptJson: null,
          pruneReceiptHash: null,
          createdAt: now,
          updatedAt: now,
        })
        artifact = (await db.agentRunArtifacts.get(id))!
        bodyCreated = true
      }
      if (snapshot.events.some(event => sameEvidenceEvent(event, payload))) {
        return { artifact: artifact as AgentRunArtifactRecordV1 & { id: number }, snapshot, bodyCreated, eventCreated: false }
      }
      const event = parseAgentRunEventV1({
        version: 1,
        runId: input.runId,
        sequence: snapshot.projection.lastSequence + 1,
        generation: snapshot.projection.generation,
        projectId: snapshot.run.projectId,
        worldGroupId: snapshot.run.worldGroupId ?? null,
        contractHash: snapshot.run.contractHash,
        type: 'evidence.artifact.recorded',
        createdAt: input.now ?? Date.now(),
        payload,
      })
      snapshot = await appendPrivilegedAgentRunEventInTransactionV1(snapshot, event)
      return { artifact: artifact as AgentRunArtifactRecordV1 & { id: number }, snapshot, bodyCreated, eventCreated: true }
    },
  ))
}

export async function inspectAgentRunArtifactAvailabilityV1(input: {
  projectId: number
  artifactKind: ExactRunArtifactKindV1
  contentHash: string
}): Promise<ExactRunArtifactAvailabilityV1> {
  if (!HASH.test(input.contentHash)) fail('hash', 'contentHash 必须是 SHA-256')
  const row = await db.agentRunArtifacts
    .where('[projectId+artifactKind+contentHash]')
    .equals([input.projectId, input.artifactKind, input.contentHash])
    .first()
  if (!row) return { artifactKind: input.artifactKind, contentHash: input.contentHash, state: 'missing', byteLength: null, pruneReceiptHash: null }
  if (row.retentionState === 'evidence-pruned') {
    return {
      artifactKind: row.artifactKind,
      contentHash: row.contentHash,
      state: 'evidence-pruned',
      byteLength: row.byteLength,
      pruneReceiptHash: row.pruneReceiptHash,
    }
  }
  if (row.content == null || await sha256Text(row.content) !== row.contentHash || byteLength(row.content) !== row.byteLength) {
    return {
      artifactKind: row.artifactKind,
      contentHash: row.contentHash,
      state: 'corrupt',
      byteLength: row.byteLength,
      pruneReceiptHash: null,
    }
  }
  return {
    artifactKind: row.artifactKind,
    contentHash: row.contentHash,
    state: 'available',
    byteLength: row.byteLength,
    pruneReceiptHash: null,
  }
}

export async function readAgentRunArtifactExactV1(input: {
  projectId: number
  artifactKind: ExactRunArtifactKindV1
  contentHash: string
}): Promise<string> {
  const availability = await inspectAgentRunArtifactAvailabilityV1(input)
  if (availability.state !== 'available') fail(availability.state, `exact artifact 当前不可读: ${availability.state}`)
  const row = await db.agentRunArtifacts
    .where('[projectId+artifactKind+contentHash]')
    .equals([input.projectId, input.artifactKind, input.contentHash])
    .first()
  if (!row?.content) fail('missing', 'exact artifact 正文不存在')
  return row.content
}

export { markAndSweepAgentRunArtifactsV1, pruneAgentRunArtifactsExplicitlyV1 } from './artifact-retention-store'
