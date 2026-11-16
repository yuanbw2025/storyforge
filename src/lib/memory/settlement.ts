import { db } from '../db/schema'
import { exportProjectJSON } from '../export/json-export'
import { deriveStrictExportProjectSnapshot, type StrictProjectExportSnapshot } from '../export/registry-export'
import type {
  MemoryArtifactIndexV1,
  MemorySettlementReceiptV1,
  WorkspaceScope,
} from '../types'
import { isWorkspaceUid } from './identity'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import {
  readAgentRunV1,
  verifyRecordedMemorySettlementV1,
  type AgentRunSnapshotV1,
} from '../agent/run/event-store'
import { replayAgentRunEventsV1 } from '../agent/run/projection'
import { expectedNodeProducerImportRetirementReasonV1 } from '../agent/run/ledger-portability'
import { inspectAgentRunArtifactAvailabilityV1 } from './artifact-store'
import {
  buildMemorySettlementReceiptFromSnapshotV1,
  hashMemoryArtifactIndexV1,
  memoryRunExportIdV1,
} from './settlement-core'

const MEMORY_SETTLEMENT_TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled'])

/** The strict registered snapshot has already verified the complete Node/Flow/
 * Work/group joins. Bind this later scoped replay to that captured tuple before
 * deriving an incomplete historical index; a reason string grants no exception. */
function verifiedImportedNodeCancellationV1(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  captured: StrictProjectExportSnapshot | null,
): boolean {
  const last = snapshot.events[snapshot.events.length - 1]
  if (snapshot.projection.state !== 'cancelled' || last?.type !== 'run.cancelled'
    || snapshot.projection.memorySettlement) return false
  const events = snapshot.events.slice(0, -1)
  const prefix = replayAgentRunEventsV1(events)
  const reason = expectedNodeProducerImportRetirementReasonV1({ run: { ...snapshot.run }, projection: prefix, events })
  if (reason === null) return false
  if (prefix.errors.length || prefix.generation !== snapshot.run.generation || prefix.generation !== last.generation
    || prefix.contractHash !== snapshot.run.contractHash || prefix.contractHash !== last.contractHash
    || prefix.lastSequence + 1 !== last.sequence
    || canonicalStringify(last.payload) !== canonicalStringify({ reason })) {
    throw new Error('[memory-settlement] 节点只读取消缺少同代原始前缀/准确尾事件')
  }
  if (!captured) throw new Error('[memory-settlement] 节点只读取消缺少已核验的关联快照')
  const coordinate = (table: string, id: number | null | undefined): number | null => {
    if (id == null) return null
    const value = captured.exportIds.get(table)?.get(id)
    if (value == null) throw new Error('[memory-settlement] 节点只读取消的关联坐标缺失')
    return value
  }
  const runId = coordinate('agentRuns', snapshot.run.id)
  const workId = coordinate('works', scope.workId)
  const worldId = coordinate('worlds', scope.worldId)
  const rows = captured.data.agentRuns.filter(row => row._exportId === runId)
  const portable = rows[0]
  const work = captured.data.works.find(row => row._exportId === workId)
  if (rows.length !== 1 || !portable || snapshot.run.projectId !== scope.projectId || snapshot.run.workId !== scope.workId
    || workId == null || worldId == null || work?._worldExportId !== worldId || portable._workOwnerExportId !== workId
    || (portable._worldGroupExportId ?? null) !== coordinate('worldGroups', snapshot.run.worldGroupId)
    || portable._nodeRunExportId !== coordinate('nodeRuns', snapshot.run.nodeRunId)
    || portable.nodeProducerNodeId !== snapshot.run.nodeProducerNodeId
    || portable.nodeProducerVariantIndex !== snapshot.run.nodeProducerVariantIndex
    || portable.nodeProducerAttempt !== snapshot.run.nodeProducerAttempt
    || portable.generation !== snapshot.projection.generation || portable.lastSequence !== snapshot.projection.lastSequence
    || portable.status !== snapshot.projection.state) {
    throw new Error('[memory-settlement] 节点只读取消与已核验的 owner/原始关联不一致')
  }
  if (!Number.isSafeInteger(last.createdAt) || !Number.isSafeInteger(snapshot.run.updatedAt) || last.createdAt > Date.now()
    || snapshot.run.updatedAt < last.createdAt || snapshot.run.updatedAt > Date.now()) {
    throw new Error('[memory-settlement] 节点只读取消的尾事件时间无效')
  }
  return true
}

// MEMINT-0 keeps exact evidence, retention and working-context replay behind
// the existing settlement boundary instead of exposing a parallel memory API.
export { planExactArtifactRetentionV1 } from './artifact-retention'
export { assertExactRunArtifactBodySafeV1, ExactRunArtifactPolicyError } from './evidence-policy'
export {
  inspectAgentRunArtifactAvailabilityV1,
  markAndSweepAgentRunArtifactsV1,
  pruneAgentRunArtifactsExplicitlyV1,
  readAgentRunArtifactExactV1,
  recordAgentRunArtifactV1,
  AgentRunArtifactStoreError,
} from './artifact-store'
export { assertMemoryPlaneContractV1, memoryPlaneForTableV1 } from './plane-contract'
export {
  createWorkingContextCompactionCheckpointV1,
  parseWorkingContextCompactionCheckpointV1,
  readWorkingContextReplayV1,
  WorkingContextContractError,
} from './working-context'

async function workspaceDirtyForSettlement(projectId: number): Promise<boolean> {
  const binding = await db.workspaceDocuments
    .where('[projectId+tableName+recordId]')
    .equals([projectId, '__recovery__', projectId])
    .first()
  if (!binding?.baselineCanonicalHash) return true
  const backup = await exportProjectJSON(projectId)
  backup.exportedAt = 0
  return await hashCanonicalValue(backup) !== binding.baselineCanonicalHash
}

/**
 * Shared evidence barrier for every governed Harness run. It derives memory
 * references from the existing ledger and never copies candidate or manuscript
 * bodies. A run is settled only when its terminal receipt and all adopted
 * candidate commits agree; disk dirty remains an explicit postcondition.
 */
export async function evaluateMemorySettlementBarrierV1(input: {
  scope: WorkspaceScope
  runId: number
  workspaceDirty?: boolean
}): Promise<MemorySettlementReceiptV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  return buildMemorySettlementReceiptFromSnapshotV1({
    snapshot,
    scope: input.scope,
    workspaceDirty: input.workspaceDirty ?? await workspaceDirtyForSettlement(input.scope.projectId),
    evaluatedAt: Date.now(),
  })
}

/** Project-wide derived directory for the readable workspace; no artifact body is duplicated. */
export async function buildMemoryArtifactIndexV1(
  projectId: number,
  options: { projectedWorkspaceDirty?: boolean } = {},
): Promise<MemoryArtifactIndexV1> {
  const project = await db.projects.get(projectId)
  if (!project || !isWorkspaceUid(project.workspaceUid)) throw new Error('[memory-settlement] Workspace identity 缺失')
  const runs = await db.agentRuns.where('projectId').equals(projectId).sortBy('createdAt')
  // The readable disk index must survive numeric-ID rebinding. AgentRun's
  // stored contractHash is local because the contract contains local scope
  // IDs; use the registry export boundary's portable contract hash instead.
  const portableSnapshot = runs.length > 0
    ? await deriveStrictExportProjectSnapshot(projectId)
    : null
  const portableRunRows = (portableSnapshot?.data.agentRuns ?? []) as Array<{
    _exportId?: number
    contractHash?: string
  }>
  const runExportIds = portableSnapshot?.exportIds.get('agentRuns')
  const portableContractHashByRunId = new Map<number, string>()
  for (const run of runs) {
    if (run.id == null) continue
    const exportId = runExportIds?.get(run.id)
    const portableHash = exportId == null
      ? undefined
      : portableRunRows.find(row => row._exportId === exportId)?.contractHash
    if (!portableHash) throw new Error(`[memory-settlement] Run ${run.id} 缺少便携契约 hash`)
    portableContractHashByRunId.set(run.id, portableHash)
  }
  const workspaceDirty = options.projectedWorkspaceDirty
    ?? await workspaceDirtyForSettlement(projectId)
  const entries: MemoryArtifactIndexV1['runs'][number][] = []
  for (const run of runs) {
    if (run.id == null || run.workId == null) continue
    const work = await db.works.get(run.workId)
    if (!work) continue
    const scope = { projectId, worldId: work.worldId, workId: run.workId }
    const snapshot = await readAgentRunV1(scope, run.id)
    const importedNodeCancellation = verifiedImportedNodeCancellationV1(scope, snapshot, portableSnapshot)
    if (MEMORY_SETTLEMENT_TERMINAL_STATES.has(snapshot.projection.state) && !importedNodeCancellation) {
      await verifyRecordedMemorySettlementV1({ snapshot, scope })
    }
    const settlementEventCandidate = [...snapshot.events]
      .reverse()
      .find(event => event.type === 'memory.settlement.recorded')
    const settlementEvent = settlementEventCandidate?.type === 'memory.settlement.recorded'
      && snapshot.projection.memorySettlement?.receiptHash === settlementEventCandidate.payload.receiptHash
      ? settlementEventCandidate
      : undefined
    if (MEMORY_SETTLEMENT_TERMINAL_STATES.has(snapshot.projection.state) && !settlementEvent && !importedNodeCancellation) {
      throw new Error(`[memory-settlement] Run ${run.id} 缺少当前终态记忆结算事件`)
    }
    const receipt = await buildMemorySettlementReceiptFromSnapshotV1({
      snapshot,
      scope,
      workspaceDirty,
      evaluatedAt: settlementEvent?.createdAt ?? 0,
    })
    const artifactIndexHash = await hashMemoryArtifactIndexV1(receipt.artifactRefs)
    const artifactAvailability = await Promise.all(receipt.artifactRefs
      .filter(ref => ref.sourceKind === 'agent-run-artifact' && ref.artifactKind != null)
      .map(ref => inspectAgentRunArtifactAvailabilityV1({
        projectId,
        artifactKind: ref.artifactKind!,
        contentHash: ref.contentHash,
      })))
    if (settlementEvent?.type === 'memory.settlement.recorded') {
      const recorded = await buildMemorySettlementReceiptFromSnapshotV1({
        snapshot,
        scope,
        workspaceDirty: settlementEvent.payload.workspaceDirty,
        evaluatedAt: settlementEvent.createdAt,
      })
      const payload = settlementEvent.payload
      const valid = recorded.receiptHash === payload.receiptHash
        && recorded.state === payload.state
        && recorded.terminalReceiptHash === payload.terminalReceiptHash
        && artifactIndexHash === payload.artifactIndexHash
        && JSON.stringify(recorded.contextManifestHashes) === JSON.stringify(payload.contextManifestHashes)
        && JSON.stringify(recorded.adoptionHashes) === JSON.stringify(payload.adoptionHashes)
        && snapshot.projection.memorySettlement?.receiptHash === payload.receiptHash
      if (!valid) throw new Error(`[memory-settlement] Run ${run.id} 的终态记忆结算完整性验证失败`)
    }
    entries.push({
      runExportId: memoryRunExportIdV1(snapshot),
      contractHash: portableContractHashByRunId.get(run.id)
        ?? (() => { throw new Error(`[memory-settlement] Run ${run.id} 缺少便携契约 hash`) })(),
      state: receipt.state,
      terminalReceiptHash: receipt.terminalReceiptHash,
      settlementReceiptHash: settlementEvent?.type === 'memory.settlement.recorded'
        ? settlementEvent.payload.receiptHash
        : null,
      settlementSource: settlementEvent?.type === 'memory.settlement.recorded'
        ? 'terminal-event'
        : 'derived-current',
      settlementRecordedAt: settlementEvent?.createdAt ?? null,
      contextManifestHashes: receipt.contextManifestHashes,
      adoptionHashes: receipt.adoptionHashes,
      artifactRefs: receipt.artifactRefs,
      artifactAvailability: artifactAvailability.sort((left, right) => (
        left.artifactKind.localeCompare(right.artifactKind)
        || left.contentHash.localeCompare(right.contentHash)
      )),
      artifactIndexHash,
    })
  }
  const body = {
    version: 1 as const,
    workspaceUid: project.workspaceUid,
    workspaceDirty,
    runs: entries,
  }
  return { ...body, indexHash: await hashCanonicalValue(body) }
}
