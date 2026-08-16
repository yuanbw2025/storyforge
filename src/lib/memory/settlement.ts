import { db } from '../db/schema'
import { exportProjectJSON } from '../export/json-export'
import { ADOPTION_BY_TARGET, ADOPTION_EXTENSIONS } from '../registry/adoption-schema'
import { CONTEXT_SOURCE_BY_KEY } from '../registry/context-sources'
import { FIELD_BY_TARGET } from '../registry/field-registry'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import type {
  MemoryArtifactIndexV1,
  MemoryArtifactRefV1,
  MemorySettlementReceiptV1,
  WorkspaceScope,
} from '../types'
import { isWorkspaceUid } from './identity'
import { hashCanonicalValue } from '../agent/run/hash'
import { readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'

function runExportId(snapshot: AgentRunSnapshotV1): string {
  return `RUN-${snapshot.run.contractHash.slice(0, 20)}-${snapshot.run.createdAt}`
}

async function artifactRef(input: Omit<MemoryArtifactRefV1, 'artifactId'>): Promise<MemoryArtifactRefV1> {
  const hash = await hashCanonicalValue(input)
  return { ...input, artifactId: `ART-${hash.slice(0, 24)}` }
}

function assertRunGovernanceRegistered(snapshot: AgentRunSnapshotV1): void {
  for (const key of snapshot.contract.permissions.contextSourceKeys) {
    if (!CONTEXT_SOURCE_BY_KEY.has(key)) throw new Error(`[memory-settlement] 未登记 Context source: ${key}`)
  }
  const extensionTargets = new Set(ADOPTION_EXTENSIONS.map(extension => extension.target))
  for (const target of snapshot.contract.permissions.writeTargets) {
    if (!REGISTRY_BY_NAME.has(target.table)) {
      throw new Error(`[memory-settlement] 写目标 ${target.table} 未登记 PROJECT_TABLES`)
    }
    if (target.mode === 'none') continue
    const registeredFields = new Set((FIELD_BY_TARGET.get(target.table) ?? []).map(field => field.field))
    const unknown = target.fields.filter(field => !registeredFields.has(field))
    const extension = target.adoptionExtension != null && extensionTargets.has(target.table)
    if (unknown.length && !extension) {
      throw new Error(`[memory-settlement] 写目标 ${target.table} 存在未登记字段: ${unknown.join(',')}`)
    }
    if (!ADOPTION_BY_TARGET.has(target.table) && !extension && target.fields.length > 0) {
      // Singleton targets are governed by FIELD_REGISTRY without a collection schema.
      if (!FIELD_BY_TARGET.has(target.table)) throw new Error(`[memory-settlement] ${target.table} 缺少采纳治理`)
    }
  }
}

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

async function artifactRefsForRun(snapshot: AgentRunSnapshotV1, scope: WorkspaceScope): Promise<MemoryArtifactRefV1[]> {
  const refs: MemoryArtifactRefV1[] = []
  const work = await db.works.get(scope.workId)
  const world = await db.worlds.get(scope.worldId)
  const common = {
    runExportId: runExportId(snapshot),
    worldCode: world?.code,
    workCode: work?.code,
  }
  for (const event of snapshot.events) {
    const sourceExportId = `${common.runExportId}:event:${event.sequence}`
    if (event.type === 'candidate.persisted' || event.type === 'candidate.revised') {
      const candidateHash = event.payload.candidateHash
      const step = snapshot.projection.steps[event.payload.stepId]
      const authority = step?.confirmation === 'reject'
        ? 'rejected' as const
        : step?.adoptionHash
          ? 'accepted' as const
          : 'candidate' as const
      refs.push(await artifactRef({
        sourceKind: 'agent-run-event', sourceExportId, ...common,
        stepId: event.payload.stepId, attempt: event.payload.attempt,
        contentHash: candidateHash, authority,
      }))
    } else if (event.type === 'model.responded') {
      refs.push(await artifactRef({
        sourceKind: 'agent-run-event', sourceExportId, ...common,
        stepId: event.payload.stepId, attempt: event.payload.attempt,
        contentHash: event.payload.outputHash, authority: 'evidence',
      }))
    } else if (event.type === 'adoption.committed') {
      refs.push(await artifactRef({
        sourceKind: 'domain-record', sourceExportId, ...common,
        stepId: event.payload.stepId, contentHash: event.payload.adoptionHash, authority: 'accepted',
      }))
    } else if (event.type === 'verification.accepted') {
      refs.push(await artifactRef({
        sourceKind: 'agent-run-event', sourceExportId, ...common,
        contentHash: event.payload.receiptHash, authority: 'evidence',
      }))
    }
  }
  return refs.sort((left, right) => left.artifactId.localeCompare(right.artifactId))
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
  assertRunGovernanceRegistered(snapshot)
  const contextManifestHashes = snapshot.events
    .filter(event => event.type === 'context.assembled')
    .map(event => event.payload.manifestHash)
    .sort()
  const adoptionHashes = snapshot.events
    .filter(event => event.type === 'adoption.committed')
    .map(event => event.payload.adoptionHash)
    .sort()
  const artifactRefs = await artifactRefsForRun(snapshot, input.scope)
  const steps = Object.values(snapshot.projection.steps)
  const hasPendingConfirmation = snapshot.projection.state === 'awaiting_confirmation'
    || steps.some(step => step.status === 'awaiting_confirmation')
  const adoptedWithoutCommit = steps.some(step => step.confirmation === 'adopt' && !step.adoptionHash)
  const state = snapshot.projection.state === 'completed'
    && !!snapshot.projection.terminalReceiptHash
    && !adoptedWithoutCommit
    ? 'settled' as const
    : hasPendingConfirmation
      ? 'awaiting-confirmation' as const
      : 'incomplete' as const
  const body = {
    version: 1 as const,
    runId: snapshot.run.id,
    contractHash: snapshot.run.contractHash,
    state,
    terminalReceiptHash: snapshot.projection.terminalReceiptHash ?? null,
    contextManifestHashes,
    adoptionHashes,
    artifactRefs,
    workspaceDirty: input.workspaceDirty ?? await workspaceDirtyForSettlement(input.scope.projectId),
    evaluatedAt: Date.now(),
  }
  return { ...body, receiptHash: await hashCanonicalValue(body) }
}

/** Project-wide derived directory for the readable workspace; no artifact body is duplicated. */
export async function buildMemoryArtifactIndexV1(projectId: number): Promise<MemoryArtifactIndexV1> {
  const project = await db.projects.get(projectId)
  if (!project || !isWorkspaceUid(project.workspaceUid)) throw new Error('[memory-settlement] Workspace identity 缺失')
  const runs = await db.agentRuns.where('projectId').equals(projectId).sortBy('createdAt')
  const workspaceDirty = await workspaceDirtyForSettlement(projectId)
  const entries: MemoryArtifactIndexV1['runs'][number][] = []
  for (const run of runs) {
    if (run.id == null || run.workId == null) continue
    const work = await db.works.get(run.workId)
    if (!work) continue
    const receipt = await evaluateMemorySettlementBarrierV1({
      scope: { projectId, worldId: work.worldId, workId: run.workId },
      runId: run.id,
      workspaceDirty,
    })
    entries.push({
      runExportId: `RUN-${run.contractHash.slice(0, 20)}-${run.createdAt}`,
      contractHash: receipt.contractHash,
      state: receipt.state,
      terminalReceiptHash: receipt.terminalReceiptHash,
      contextManifestHashes: receipt.contextManifestHashes,
      adoptionHashes: receipt.adoptionHashes,
      artifactRefs: receipt.artifactRefs,
    })
  }
  const body = { version: 1 as const, workspaceUid: project.workspaceUid, runs: entries }
  return { ...body, indexHash: await hashCanonicalValue(body) }
}
