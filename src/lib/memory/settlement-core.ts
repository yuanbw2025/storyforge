import { db } from '../db/schema'
import { ADOPTION_BY_TARGET, ADOPTION_EXTENSIONS } from '../registry/adoption-schema'
import { CONTEXT_SOURCE_BY_KEY } from '../registry/context-sources'
import { FIELD_BY_TARGET } from '../registry/field-registry'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import type {
  AgentRunContract,
  AgentRunProjectionV1,
  AgentRunRecord,
  AnyAgentRunEventV1,
  MemoryArtifactRefV1,
  MemorySettlementReceiptV1,
  WorkspaceScope,
} from '../types'
import { hashCanonicalValue } from '../agent/run/hash'

export interface MemorySettlementSnapshotV1 {
  run: AgentRunRecord & { id: number }
  contract: AgentRunContract
  events: AnyAgentRunEventV1[]
  projection: AgentRunProjectionV1
}

/** Historical ledger data, not a newly created or resumable Run. */
export type FrozenMemorySettlementLedgerV1 = Omit<MemorySettlementSnapshotV1, 'run'> & {
  run: Pick<AgentRunRecord, 'contractHash' | 'createdAt'> & { id: number }
}
export interface FrozenMemorySettlementIdentityV1 { worldCode?: string; workCode?: string }
type SettlementIdentityV1 = { kind: 'scope'; scope: WorkspaceScope }
  | { kind: 'frozen'; identity: FrozenMemorySettlementIdentityV1 }

export function memoryRunExportIdV1(snapshot: FrozenMemorySettlementLedgerV1): string {
  const created = snapshot.events.find(event => event.type === 'run.created')
  if (!created || created.type !== 'run.created') throw new Error('[memory-settlement] Run 缺少创建事件')
  return `RUN-${created.payload.objectiveHash.slice(0, 20)}-${snapshot.run.createdAt}`
}

async function artifactRef(input: Omit<MemoryArtifactRefV1, 'artifactId'>): Promise<MemoryArtifactRefV1> {
  const hash = await hashCanonicalValue(input)
  return { ...input, artifactId: `ART-${hash.slice(0, 24)}` }
}

function assertRunGovernanceRegistered(snapshot: FrozenMemorySettlementLedgerV1): void {
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

async function artifactRefsForRun(
  snapshot: FrozenMemorySettlementLedgerV1,
  origin: SettlementIdentityV1,
): Promise<MemoryArtifactRefV1[]> {
  const refs: MemoryArtifactRefV1[] = []
  let worldCode: string | undefined, workCode: string | undefined
  if (origin.kind === 'frozen') {
    worldCode = origin.identity.worldCode; workCode = origin.identity.workCode
  } else {
    const work = await db.works.get(origin.scope.workId)
    const world = await db.worlds.get(origin.scope.worldId)
    worldCode = world?.code; workCode = work?.code
  }
  const common = {
    runExportId: memoryRunExportIdV1(snapshot),
    worldCode,
    workCode,
  }
  for (const event of snapshot.events) {
    const sourceExportId = `${common.runExportId}:event:${event.sequence}`
    if (event.type === 'evidence.artifact.recorded') {
      refs.push(await artifactRef({
        sourceKind: 'agent-run-artifact',
        sourceExportId: `${common.runExportId}:artifact:${event.payload.artifactKind}:${event.payload.contentHash}`,
        ...common,
        ...(event.payload.stepId == null ? {} : {
          stepId: event.payload.stepId,
          attempt: event.payload.attempt,
        }),
        contentHash: event.payload.contentHash,
        artifactKind: event.payload.artifactKind,
        authority: 'evidence',
      }))
    } else if (event.type === 'candidate.persisted' || event.type === 'candidate.revised') {
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
  return [...new Map(refs.map(ref => [ref.artifactId, ref])).values()]
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId))
}

/**
 * Pure Harness-ledger settlement apart from scoped identity reads. It never
 * writes IndexedDB or the file system and never copies artifact bodies.
 */
async function buildReceiptFromLedger(input: {
  snapshot: FrozenMemorySettlementLedgerV1
  origin: SettlementIdentityV1
  workspaceDirty: boolean
  evaluatedAt: number
}): Promise<MemorySettlementReceiptV1> {
  const { snapshot } = input
  assertRunGovernanceRegistered(snapshot)
  const contextManifestHashes = snapshot.events
    .filter(event => event.type === 'context.assembled')
    .map(event => event.payload.manifestHash)
    .sort()
  const adoptionHashes = snapshot.events
    .filter(event => event.type === 'adoption.committed')
    .map(event => event.payload.adoptionHash)
    .sort()
  const artifactRefs = await artifactRefsForRun(snapshot, input.origin)
  const steps = Object.values(snapshot.projection.steps)
  const hasPendingConfirmation = snapshot.projection.state === 'awaiting_confirmation'
    || steps.some(step => step.status === 'awaiting_confirmation')
  const requiresCommittedAdoption = snapshot.contract.acceptance.some(criterion => (
    criterion.required && criterion.kind === 'adoption-committed'
  )) || snapshot.contract.permissions.writeTargets.some(target => target.mode === 'author-confirmed')
  const adoptedWithoutCommit = requiresCommittedAdoption
    && steps.some(step => step.confirmation === 'adopt' && !step.adoptionHash)
  const terminalWithoutAcceptance = ['failed', 'cancelled', 'recovery_required']
    .includes(snapshot.projection.state)
  const state = snapshot.projection.state === 'completed'
    && !!snapshot.projection.terminalReceiptHash
    && !adoptedWithoutCommit
    ? 'settled' as const
    : !terminalWithoutAcceptance && hasPendingConfirmation
      ? 'awaiting-confirmation' as const
      : 'incomplete' as const
  const portableBody = {
    version: 1 as const,
    runExportId: memoryRunExportIdV1(snapshot),
    state,
    terminalReceiptHash: snapshot.projection.terminalReceiptHash ?? null,
    contextManifestHashes,
    adoptionHashes,
    artifactRefs,
    workspaceDirty: input.workspaceDirty,
    evaluatedAt: input.evaluatedAt,
  }
  return {
    ...portableBody,
    runId: snapshot.run.id,
    contractHash: snapshot.run.contractHash,
    receiptHash: await hashCanonicalValue(portableBody),
  }
}

/** Existing live path: same scoped identity reads, receipt fields and hashes. */
export async function buildMemorySettlementReceiptFromSnapshotV1(input: {
  snapshot: MemorySettlementSnapshotV1; scope: WorkspaceScope; workspaceDirty: boolean; evaluatedAt: number
}): Promise<MemorySettlementReceiptV1> {
  return buildReceiptFromLedger({ ...input, origin: { kind: 'scope', scope: input.scope } })
}

/** Pure historical projection through the same settlement algorithm. The
 * caller must verify this ledger and its frozen identity; no DB lookup,
 * settlement event, resumed execution or adoption permission is issued. */
export async function buildMemorySettlementReceiptFromFrozenLedgerV1(input: {
  snapshot: FrozenMemorySettlementLedgerV1; identity: FrozenMemorySettlementIdentityV1
  workspaceDirty: boolean; evaluatedAt: number
}): Promise<MemorySettlementReceiptV1> {
  const frozen = structuredClone(input)
  return buildReceiptFromLedger({ ...frozen, origin: { kind: 'frozen', identity: frozen.identity } })
}

export async function hashMemoryArtifactIndexV1(
  refs: readonly MemoryArtifactRefV1[],
): Promise<string> {
  return hashCanonicalValue(refs)
}
