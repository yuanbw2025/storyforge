import Dexie from 'dexie'
import { db } from '../../db/schema'
import type {
  AgentRunProjectionV1,
  AgentRunCheckpointRecord,
  AgentRunEventRecord,
  AgentRunRecord,
  AnyAgentRunEventV1,
  ImportSession,
} from '../../types'
import { assertPortableDocumentImportOriginV1, identifyPrivateReferenceRunsV1 } from '../../import/document-parse-backup-privacy'
import type { TableSpec } from '../../registry/types'
import { extractExactArtifactOwnerRootsV1 } from '../../memory/artifact-roots'
import type { ProjectExportData } from '../../export/json-export'
import { parseAgentRunEventV1 } from './event-schema'
import { readAgentRunNodeProducerTupleV1, readRecord } from './schema-utils'
import { canonicalStringify, hashCanonicalValue } from './hash'
import {
  replayAgentRunEventsV1,
  toAgentRunProjectionBodyV1,
  completedAgentRunEvidencePrefixV1,
} from './projection'
import {
  portableizeAgentRunContractV1,
  rebindPortableAgentRunContractV1,
} from './contract-portability'
import {
  AGENT_RUN_MAXIMUM_RESUME_PAYLOAD_BYTES_V1,
  agentRunUtf8ByteLengthV1,
} from './checkpoint-contract'

type IdMaps = ReadonlyMap<string, ReadonlyMap<number, number>>
type ExportRow = Record<string, any>

interface GenerationHashPair {
  sourceHash: string
  targetHash: string
}

function fail(message: string): never {
  throw new Error(`[agent-run-portability] ${message}`)
}

function parsePayload(row: ExportRow): Record<string, any> {
  if (typeof row.payloadJson !== 'string') fail('事件 payloadJson 缺失')
  try {
    const value = JSON.parse(row.payloadJson)
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('事件 payloadJson 必须是对象')
    return value
  } catch (error) {
    fail(error instanceof Error ? error.message : '事件 payloadJson 无法解析')
  }
}

function indexRowsByRun(rows: ExportRow[]): Map<unknown, ExportRow[]> {
  const index = new Map<unknown, ExportRow[]>()
  for (const row of rows) {
    const runKey: unknown = row._agentRunExportId
    const bucket = index.get(runKey)
    if (bucket) bucket.push(row)
    else index.set(runKey, [row])
  }
  for (const bucket of index.values()) {
    bucket.sort((left, right) => left.sequence - right.sequence)
  }
  return index
}

/** Validate operational links in the same captured coordinate system. Signed
 * Node JSON and opaque checkpoints are neither rewritten nor used as locators. */
function assertNodeProducerRelationsV1(
  runs: readonly unknown[],
  nodeRuns: readonly unknown[],
  flows: readonly unknown[],
  works: readonly unknown[],
  groups: readonly unknown[],
  portable: boolean,
): void {
  const id = portable ? '_exportId' : 'id'
  const owner = portable ? '_workOwnerExportId' : 'workId'
  // nodeRuns uses its registered array export index; nodeFlows has _exportId.
  const nodesById = new Map(nodeRuns.map((value, index) => {
    const row = readRecord(value, 'nodeRuns'); return [portable ? index : row[id], row]
  }))
  const flowsById = new Map(flows.map(value => {
    const row = readRecord(value, 'nodeFlows'); return [row[id], row]
  }))
  const worksById = new Map(works.map(value => {
    const row = readRecord(value, 'works'); return [row[id], row]
  }))
  const groupsById = new Map(groups.map(value => {
    const row = readRecord(value, 'worldGroups'); return [row[id], row]
  }))
  const tuples = new Set<string>()
  for (const value of runs) {
    const run = readRecord(value, 'agentRuns')
    const tuple = readAgentRunNodeProducerTupleV1(run, portable ? '_nodeRunExportId' : 'nodeRunId', portable)
    if (!tuple) continue
    if (run[owner] == null || (portable ? run._productRuntimeSessionExportId : run.productRuntimeSessionId) != null
      || (portable ? run._productBuildExportId : run.productBuildId) != null) fail('节点生产关联必须保留原 Work owner')
    const work = worksById.get(run[owner])
    const groupId = run[portable ? '_worldGroupExportId' : 'worldGroupId']
    const group = groupId == null ? null : groupsById.get(groupId)
    if (!work || work[portable ? '_worldExportId' : 'worldId'] == null
      || !portable && run.projectId !== work.projectId
      || groupId != null && (!group
        || group[portable ? '_worldOwnerExportId' : 'worldId'] !== work[portable ? '_worldExportId' : 'worldId']
        || !portable && run.projectId !== group.projectId)) {
      fail('节点生产关联的 Work/世界组不属于同一实际 World')
    }
    if (tuple.nodeRunId === null) continue
    const node = nodesById.get(tuple.nodeRunId)
    const flow = node && flowsById.get(node[portable ? '_flowExportId' : 'flowId'])
    if (!node || !flow || run[owner] == null || run[owner] !== node[owner] || run[owner] !== flow[owner]
      || !portable && (run.projectId !== node.projectId || run.projectId !== flow.projectId)
      || (run[portable ? '_worldGroupExportId' : 'worldGroupId'] ?? null)
        !== (flow[portable ? '_worldGroupExportId' : 'worldGroupId'] ?? null)) {
      fail('节点生产关联缺失或越过原 Work/世界组')
    }
    const key = JSON.stringify([tuple.nodeRunId, tuple.nodeProducerNodeId, tuple.nodeProducerVariantIndex, tuple.nodeProducerAttempt])
    if (tuples.has(key)) fail('节点生产原版本/attempt 存在重复 Run')
    tuples.add(key)
  }
}

function exportedDomainEvents(run: ExportRow, events: ExportRow[]): AnyAgentRunEventV1[] {
  const worldGroupId = run._worldGroupExportId == null ? null : run._worldGroupExportId + 1
  return events.map(event => parseAgentRunEventV1({
    version: 1,
    runId: run._exportId + 1,
    sequence: event.sequence,
    generation: event.generation,
    projectId: 1,
    worldGroupId,
    contractHash: event.contractHash,
    type: event.type,
    createdAt: event.createdAt,
    payload: parsePayload(event),
  }))
}

export async function verifyPortableAgentRunProjectionV1(
  run: Record<string, any>,
  events: Record<string, any>[],
): Promise<{ projection: AgentRunProjectionV1; events: AnyAgentRunEventV1[] }> {
  const domainEvents = exportedDomainEvents(run, events)
  const projection = replayAgentRunEventsV1(domainEvents)
  if (projection.errors.length > 0 || projection.state === 'recovery_required') {
    fail(`run ${run._exportId} 导出前事件不可重放：${projection.errors.join('；')}`)
  }
  let storedProjection: unknown
  try {
    storedProjection = JSON.parse(run.projectionJson)
  } catch {
    fail(`run ${run._exportId} 物化投影 JSON 损坏`)
  }
  const [storedHash, replayHash] = await Promise.all([
    hashCanonicalValue(storedProjection),
    hashCanonicalValue(toAgentRunProjectionBodyV1(projection)),
  ])
  if (
    storedHash !== run.projectionHash
    || replayHash !== run.projectionHash
    || projection.state !== run.status
    || projection.generation !== run.generation
    || projection.lastSequence !== run.lastSequence
    || projection.contractHash !== run.contractHash
    || (projection.terminalReceiptHash ?? null) !== (run.terminalReceiptHash ?? null)
  ) fail(`run ${run._exportId} 导出前物化投影与事件不一致`)
  return { projection, events: domainEvents }
}

/**
 * A Creator Brief may point either at its freshly completed proof, or at the
 * same proof after project import deliberately appended one scope-rebind stale
 * event. Return the completed prefix that still proves the immutable Brief.
 */
export async function verifyPortableCompletedAgentRunEvidenceV1(
  run: Record<string, any>,
  events: Record<string, any>[],
): Promise<{ projection: AgentRunProjectionV1; events: AnyAgentRunEventV1[] }> {
  const verified = await verifyPortableAgentRunProjectionV1(run, events)
  if (verified.projection.state === 'completed' && verified.projection.terminalReceiptHash) {
    return verified
  }
  const last = verified.events[verified.events.length - 1]
  if (verified.projection.state !== 'running'
    || last?.type !== 'verification.staled'
    || last.payload.reason !== 'project-import-scope-rebound') {
    fail(`run ${run._exportId} 不含可接受的完成态证据`)
  }
  const completed = completedAgentRunEvidencePrefixV1(verified.events)
  if (!completed) {
    fail(`run ${run._exportId} 的导入失效事件没有匹配完成态前缀`)
  }
  return { projection: completed, events: verified.events.slice(0, -1) }
}

async function portableGenerationHashes(input: {
  run: ExportRow
  events: ExportRow[]
  idMaps: IdMaps
}): Promise<Map<number, GenerationHashPair>> {
  const hashes = new Map<number, GenerationHashPair>()
  const latest = await portableizeAgentRunContractV1({
    contractJson: input.run.contractJson,
    contractHash: input.run.contractHash,
    idMaps: input.idMaps,
  })

  for (const event of input.events) {
    if (event.type !== 'contract.accepted' && event.type !== 'contract.revised') continue
    const payload = parsePayload(event)
    const snapshotJson = payload.contractJson
      ?? (event.type === 'contract.accepted' && input.run.generation === 1 ? input.run.contractJson : null)
    if (snapshotJson == null) {
      fail(`run ${input.run._exportId} generation ${event.generation} 缺少契约快照，无法便携重映射`)
    }
    const portable = await portableizeAgentRunContractV1({
      contractJson: snapshotJson,
      contractHash: event.contractHash,
      idMaps: input.idMaps,
    })
    hashes.set(event.generation, { sourceHash: event.contractHash, targetHash: portable.contractHash })
    payload.contractJson = portable.contractJson
    event.payloadJson = canonicalStringify(payload)
  }

  const current = hashes.get(input.run.generation)
  if (!current || current.sourceHash !== input.run.contractHash || current.targetHash !== latest.contractHash) {
    fail(`run ${input.run._exportId} 当前契约与事件代际不一致`)
  }
  input.run.contractJson = latest.contractJson
  input.run.contractHash = latest.contractHash
  return hashes
}

/** The registered reference source, private execution ledger and exact evidence remain local.
 * All pruning and ordinary import proofs apply only to detached backup rows. */
export async function excludePrivateReferenceExecutionFromBackupV1(
  rows: Map<string, ExportRow[]>, specs: readonly TableSpec[], readImportSessions: () => Promise<ImportSession[]>,
): Promise<void> {
  const root = specs.find(spec => spec.portableData?.kind === 'agent-run-root')
  if (!root || root.portableData?.kind !== 'agent-run-root') return
  const privateIds = await identifyPrivateReferenceRunsV1(rows.get(root.name) ?? [], root.portableData.contractField, readImportSessions)
  if (!privateIds.size) return
  const children = specs.filter(spec => spec.portableData?.kind === 'agent-run-child'
    && spec.exportRemap?.some(ref => ref.remapVia === root.name))
  const childByName = new Map(children.map(spec => [spec.name, spec]))
  const isPrivateRow = (spec: TableSpec, row: ExportRow) => {
    if (spec.name === root.name) return privateIds.has(row.id)
    const data = childByName.get(spec.name)?.portableData
    return data?.kind === 'agent-run-child' && privateIds.has(row[data.parentField])
  }
  const identity = (row: ExportRow) => `${row.artifactKind}:${row.contentHash}`
  const privateArtifacts = new Set<string>()
  const otherArtifacts = new Set<string>()
  for (const spec of children) {
    for (const row of rows.get(spec.name) ?? []) {
      if (row.type !== 'evidence.artifact.recorded') continue
      const key = identity(parsePayload(row))
      const target = isPrivateRow(spec, row) ? privateArtifacts : otherArtifacts
      target.add(key)
    }
  }
  const at = (value: unknown, path: string[]): boolean => {
    if (!path.length) return typeof value === 'number' && privateIds.has(value)
    if (!value || typeof value !== 'object') return false
    const [key, ...rest] = path
    if (key === '*') return Object.values(value).some(child => at(child, rest))
    return at((value as Record<string, unknown>)[key], rest)
  }
  for (const spec of specs) {
    for (const [index, row] of (rows.get(spec.name) ?? []).entries()) {
      if (isPrivateRow(spec, row)) continue
      for (const ref of spec.exportRemap ?? []) {
        if (ref.remapVia === root.name && privateIds.has(row[ref.field]))
          fail(`${spec.name}[${index}].${ref.field} 不能引用本机私有参考分析 Run。`)
      }
      for (const ref of spec.exportRefRemap ?? []) {
        if (ref.kind === 'narrative-source-refs-v1' || ref.remapVia !== root.name || row[ref.field] == null) continue
        const raw = row[ref.field]
        const value = typeof raw === 'string' ? JSON.parse(raw) : raw
        const matching = ref.kind === 'object-array-id' && at(value, ['*', ref.itemField])
          || ref.kind === 'id-array' && at(value, ['*'])
          || ref.kind === 'json-id-paths' && ref.paths.some(path => at(value, path.split('.')))
        if (matching) fail(`${spec.name}[${index}].${ref.field} 不能引用本机私有参考分析 Run。`)
      }
      for (const ref of spec.exactArtifactRoots ? extractExactArtifactOwnerRootsV1(row, spec.exactArtifactRoots) : []) {
        if (privateArtifacts.has(identity(ref))) fail(`${spec.name}[${index}] 引用了本机私有参考分析证据。`)
      }
    }
  }
  if ([...privateArtifacts].some(key => otherArtifacts.has(key))) fail('本机私有参考分析证据同时被其它 Run 引用。')
  for (const spec of [root, ...children]) rows.set(spec.name, (rows.get(spec.name) ?? []).filter(row => !isPrivateRow(spec, row)))
  for (const spec of specs.filter(spec => spec.portableData?.kind === 'exact-run-artifact')) {
    rows.set(spec.name, (rows.get(spec.name) ?? []).filter(row => !privateArtifacts.has(identity(row))))
  }
}

/** Registry export hook: replace every embedded local ID and generation hash. */
export async function portableizeAgentRunLedgerExportV1(
  data: ProjectExportData,
  idMaps: IdMaps,
  options: { freezeContextEvidence?: boolean } = {},
): Promise<void> {
  const runs = (data.agentRuns ?? []) as ExportRow[]
  const events = (data.agentRunEvents ?? []) as ExportRow[]
  const checkpoints = (data.agentRunCheckpoints ?? []) as ExportRow[]
  assertNodeProducerRelationsV1(runs, (data.nodeRuns ?? []) as ExportRow[], (data.nodeFlows ?? []) as ExportRow[],
    (data.works ?? []) as ExportRow[], (data.worldGroups ?? []) as ExportRow[], true)
  // The generic optional scalar mapper emits null for absent native fields.
  // Do not add a new coordinate to legacy capsules that never had a tuple.
  for (const run of runs) {
    if (readAgentRunNodeProducerTupleV1(run, '_nodeRunExportId', true) === null) delete run._nodeRunExportId
  }
  // Large production histories must not rescan the entire ledger for each run.
  // Buckets retain row identity while leaving the exported arrays in their original order.
  const eventsByRun = indexRowsByRun(events)
  const checkpointsByRun = indexRowsByRun(checkpoints)
  const localRunIds = new Map([...(idMaps.get('agentRuns') ?? [])].map(([local,portable]) => [portable,local]))
  for (const run of runs) {
    if (!Number.isInteger(run._exportId)) fail('agentRuns 缺少便携 _exportId')
    const runEvents = eventsByRun.get(run._exportId) ?? []
    if (runEvents.some(event => event._worldGroupExportId !== run._worldGroupExportId)) {
      fail(`run ${run._exportId} 事件世界组与运行不一致`)
    }
    await verifyPortableAgentRunProjectionV1(run, runEvents)
    // World封存 preserves existing upper-product evidence as data; only a full
    // workspace backup may enter those owners to freeze additional proof.
    if (options.freezeContextEvidence !== false) {
      const localRunId = localRunIds.get(run._exportId)
      if (localRunId == null) fail(`run ${run._exportId} 缺少原始导出映射`)
      const { freezeTtrpgWorldContextBindingsForExportV1 } = await import('../../product/world-context-portability')
      const worldBindings = await freezeTtrpgWorldContextBindingsForExportV1(localRunId)
      if (worldBindings !== undefined) run.portableWorldContextBindingsJson = worldBindings
      const { freezeTtrpgOpenRunOriginForExportV1 } = await import('../../ttrpg/open-run-portability')
      const runtimeOrigin = await freezeTtrpgOpenRunOriginForExportV1(localRunId, { contractHash: run.contractHash, lastSequence: run.lastSequence })
      if (runtimeOrigin !== undefined) run.portableRuntimeOriginJson = runtimeOrigin
      const { freezePublishedRootOriginForExportV1 } = await import('../../product-production/published-root-origin')
      const rootOrigin = await freezePublishedRootOriginForExportV1(localRunId)
      if (rootOrigin !== undefined) run.portablePublishedRootOriginJson = rootOrigin
    }
    const hashes = await portableGenerationHashes({ run, events: runEvents, idMaps })
    for (const event of runEvents) {
      const pair = hashes.get(event.generation)
      if (!pair || event.contractHash !== pair.sourceHash) {
        fail(`run ${run._exportId} 事件 ${event.sequence} 的契约代际哈希不一致`)
      }
      const payload = parsePayload(event)
      if (event.type === 'contract.revised') {
        const previous = hashes.get(event.generation - 1)
        if (!previous || payload.previousContractHash !== previous.sourceHash) {
          fail(`run ${run._exportId} 契约修订缺少连续上一代`)
        }
        payload.previousContractHash = previous.targetHash
        event.payloadJson = canonicalStringify(payload)
      }
      event.contractHash = pair.targetHash
    }
    for (const checkpoint of checkpointsByRun.get(run._exportId) ?? []) {
      if (checkpoint.resumePayloadJson != null
        && (typeof checkpoint.resumePayloadJson !== 'string'
          || agentRunUtf8ByteLengthV1(checkpoint.resumePayloadJson)
            > AGENT_RUN_MAXIMUM_RESUME_PAYLOAD_BYTES_V1)) {
        fail(`run ${run._exportId} 检查点 ${checkpoint.throughSequence} 恢复载荷超过安全便携预算`)
      }
      if (checkpoint._worldGroupExportId !== run._worldGroupExportId) {
        fail(`run ${run._exportId} 检查点世界组与运行不一致`)
      }
      const pair = hashes.get(checkpoint.generation)
      if (!pair || checkpoint.contractHash !== pair.sourceHash) {
        fail(`run ${run._exportId} 检查点 ${checkpoint.throughSequence} 的契约代际哈希不一致`)
      }
      checkpoint.contractHash = pair.targetHash
    }
  }
}

function storedEventToDomain(record: AgentRunEventRecord): AnyAgentRunEventV1 {
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
    payload: JSON.parse(record.payloadJson),
  })
}

async function verifyImportedCheckpoint(
  checkpoint: AgentRunCheckpointRecord,
  events: AgentRunEventRecord[],
): Promise<void> {
  const throughEvents = events
    .filter(event => event.sequence <= checkpoint.throughSequence)
    .map(storedEventToDomain)
  const projection = replayAgentRunEventsV1(throughEvents)
  if (projection.errors.length > 0 || projection.state === 'recovery_required') {
    fail(`检查点 ${checkpoint.throughSequence} 之前的事件不可重放`)
  }
  let storedProjection: unknown
  try {
    storedProjection = JSON.parse(checkpoint.projectionJson)
  } catch {
    fail(`检查点 ${checkpoint.throughSequence} 投影 JSON 损坏`)
  }
  const [storedHash, replayHash] = await Promise.all([
    hashCanonicalValue(storedProjection),
    hashCanonicalValue(toAgentRunProjectionBodyV1(projection)),
  ])
  if (storedHash !== checkpoint.projectionHash || replayHash !== checkpoint.projectionHash) {
    fail(`检查点 ${checkpoint.throughSequence} 投影哈希不一致`)
  }
  let resumePayload: unknown = null
  if (checkpoint.resumePayloadJson != null) {
    if (agentRunUtf8ByteLengthV1(checkpoint.resumePayloadJson)
      > AGENT_RUN_MAXIMUM_RESUME_PAYLOAD_BYTES_V1) {
      fail(`检查点 ${checkpoint.throughSequence} 恢复载荷超过安全导入预算`)
    }
    try {
      resumePayload = JSON.parse(checkpoint.resumePayloadJson)
    } catch {
      fail(`检查点 ${checkpoint.throughSequence} 恢复载荷 JSON 损坏`)
    }
  }
  const resumeHash = resumePayload == null ? null : await hashCanonicalValue(resumePayload)
  if (resumeHash !== (checkpoint.resumePayloadHash ?? null)) {
    fail(`检查点 ${checkpoint.throughSequence} 恢复载荷哈希不一致`)
  }
  const checkpointHash = await hashCanonicalValue({
    version: 1,
    generation: checkpoint.generation,
    throughSequence: checkpoint.throughSequence,
    projectionHash: checkpoint.projectionHash,
    resumePayloadHash: checkpoint.resumePayloadHash ?? null,
  })
  if (checkpointHash !== checkpoint.checkpointHash) {
    fail(`检查点 ${checkpoint.throughSequence} 内容哈希不一致`)
  }
}

function hasNonPortableCheckpoint(checkpoints: AgentRunCheckpointRecord[]): boolean {
  return checkpoints.some(checkpoint => {
    if (checkpoint.resumePayloadJson == null) return false
    try {
      const payload = JSON.parse(checkpoint.resumePayloadJson) as Record<string, unknown>
      return payload?.portable === false
    } catch {
      // verifyImportedCheckpoint reports the authoritative corruption error.
      return false
    }
  })
}

/** A prior import invalidated the local receipt, not the completed history.
 * Re-import must not treat that exact, verifiable prefix as pending execution.
 * Keep the stale event and checkpoint; this grants no fresh receipt or resume. */
function hasImportedCompletedPrefix(projection: AgentRunProjectionV1, events: AnyAgentRunEventV1[]): boolean {
  const last = events[events.length - 1]
  if (projection.state !== 'running' || last?.type !== 'verification.staled'
    || last.payload.reason !== 'project-import-scope-rebound') return false
  const prefix = replayAgentRunEventsV1(events.slice(0, -1))
  return prefix.errors.length === 0 && prefix.state === 'completed' && !!prefix.terminalReceiptHash
    && prefix.terminalReceiptHash === last.payload.previousReceiptHash
}

/** Pure expected transition for strict backup/memory consumers. Callers must
 * first verify the complete row relation and replayed event prefix. A Node slot
 * is local execution correlation even before its first checkpoint exists. */
export function expectedNodeProducerImportRetirementReasonV1(input: {
  run: Record<string, unknown>
  projection: AgentRunProjectionV1
  events: AnyAgentRunEventV1[]
  portable?: boolean
}): 'project-import-node-producer-readonly' | null {
  const tuple = readAgentRunNodeProducerTupleV1(input.run,
    input.portable ? '_nodeRunExportId' : 'nodeRunId', input.portable)
  if (!tuple || ['completed', 'failed', 'cancelled'].includes(input.projection.state)
    || hasImportedCompletedPrefix(input.projection, input.events)) return null
  if (input.projection.errors.length || input.projection.state === 'recovery_required') fail('节点生产导入前缀尚未核验')
  return 'project-import-node-producer-readonly'
}

async function rebindGenerationHashes(input: {
  run: AgentRunRecord & { id: number }
  events: AgentRunEventRecord[]
  projectId: number
  idMaps: IdMaps
}): Promise<Map<number, GenerationHashPair>> {
  const hashes = new Map<number, GenerationHashPair>()
  for (const event of input.events) {
    if (event.type !== 'contract.accepted' && event.type !== 'contract.revised') continue
    const payload = parsePayload(event as unknown as ExportRow)
    if (typeof payload.contractJson !== 'string') {
      fail(`导入 run ${input.run.id} generation ${event.generation} 缺少便携契约快照`)
    }
    const rebound = await rebindPortableAgentRunContractV1({
      contractJson: payload.contractJson,
      contractHash: event.contractHash,
      projectId: input.projectId,
      idMaps: input.idMaps,
    })
    hashes.set(event.generation, { sourceHash: event.contractHash, targetHash: rebound.contractHash })
    payload.contractJson = rebound.contractJson
    event.payloadJson = canonicalStringify(payload)
  }
  const latest = hashes.get(input.run.generation)
  if (!latest || latest.targetHash !== input.run.contractHash) {
    fail(`导入 run ${input.run.id} 当前契约与事件代际不一致`)
  }
  return hashes
}

/**
 * Registry import finalizer. It rebinds every generation, rebuilds materialized
 * state from the strict event stream, and invalidates cloned terminal receipts.
 */
export async function finalizeImportedAgentRunLedgersV1(input: {
  projectId: number
  runIds: readonly number[]
  idMaps: IdMaps
}): Promise<void> {
  const imported = await db.agentRuns.bulkGet([...input.runIds])
  const linked = imported.filter((row): row is AgentRunRecord => row != null)
  const tuples = linked.map(row => readAgentRunNodeProducerTupleV1(row as unknown as Record<string, unknown>))
  // Avoid adding Node tables to legacy/domain-specific subtransactions.
  if (tuples.some(tuple => tuple !== null)) {
    assertNodeProducerRelationsV1(linked,
      await db.nodeRuns.where('projectId').equals(input.projectId).toArray(),
      await db.nodeFlows.where('projectId').equals(input.projectId).toArray(),
      await db.works.where('projectId').equals(input.projectId).toArray(),
      await db.worldGroups.where('projectId').equals(input.projectId).toArray(), false)
  }
  for (const runId of input.runIds) {
    const run = await db.agentRuns.get(runId)
    if (!run || run.id == null) fail(`导入 run ${runId} 不存在`)
    if (run.portableDocumentImportOriginJson !== undefined) {
      await Dexie.waitFor(assertPortableDocumentImportOriginV1(run, JSON.parse(run.contractJson)))
    }
    if (run.portableWorldContextBindingsJson !== undefined) {
      await Dexie.waitFor((async () => {
        const { assertPortableWorldContextBindingsV1 } = await import('../../product/world-context-portability')
        await assertPortableWorldContextBindingsV1(run.portableWorldContextBindingsJson)
      })())
    }
    if (run.portablePublishedRootOriginJson !== undefined) {
      await Dexie.waitFor((async () => {
        const { assertImportedPublishedRootOriginOwnerV1 } = await import('../../product-production/published-root-origin')
        await assertImportedPublishedRootOriginOwnerV1(run)
      })())
    }
    const events = await db.agentRunEvents.where('runId').equals(runId).sortBy('sequence')
    const hashes = await Dexie.waitFor(rebindGenerationHashes({
      run: run as AgentRunRecord & { id: number },
      events,
      projectId: input.projectId,
      idMaps: input.idMaps,
    }))
    for (const event of events) {
      const pair = hashes.get(event.generation)
      if (!pair || event.contractHash !== pair.sourceHash) {
        fail(`导入 run ${runId} 事件 ${event.sequence} 的契约代际不一致`)
      }
      const payload = parsePayload(event as unknown as ExportRow)
      if (event.type === 'contract.revised') {
        const previous = hashes.get(event.generation - 1)
        if (!previous || payload.previousContractHash !== previous.sourceHash) {
          fail(`导入 run ${runId} 契约修订链不连续`)
        }
        payload.previousContractHash = previous.targetHash
        event.payloadJson = canonicalStringify(payload)
      }
      event.contractHash = pair.targetHash
      await db.agentRunEvents.update(event.id!, {
        contractHash: event.contractHash,
        payloadJson: event.payloadJson,
      })
    }

    const checkpoints = await db.agentRunCheckpoints.where('runId').equals(runId).sortBy('throughSequence')
    for (const checkpoint of checkpoints) {
      const pair = hashes.get(checkpoint.generation)
      if (!pair || checkpoint.contractHash !== pair.sourceHash) {
        fail(`导入 run ${runId} 检查点代际不一致`)
      }
      checkpoint.contractHash = pair.targetHash
      await db.agentRunCheckpoints.update(checkpoint.id!, { contractHash: checkpoint.contractHash })
      await Dexie.waitFor(verifyImportedCheckpoint(checkpoint, events))
    }

    let domainEvents = events.map(storedEventToDomain)
    let projection = replayAgentRunEventsV1(domainEvents)
    if (projection.errors.length > 0 || projection.state === 'recovery_required') {
      fail(`导入 run ${runId} 无法重放：${projection.errors.join('；')}`)
    }
    let appendedImportTerminalEvent = false
    const nodeRetirementReason = expectedNodeProducerImportRetirementReasonV1({
      run: run as unknown as Record<string, unknown>, projection, events: domainEvents,
    })
    if (projection.state === 'completed' && projection.terminalReceiptHash) {
      const staled = parseAgentRunEventV1({
        version: 1,
        runId,
        sequence: projection.lastSequence + 1,
        generation: projection.generation,
        projectId: run.projectId,
        worldGroupId: run.worldGroupId ?? null,
        contractHash: run.contractHash,
        type: 'verification.staled',
        payload: {
          previousReceiptHash: projection.terminalReceiptHash,
          reason: 'project-import-scope-rebound',
        },
        createdAt: Date.now(),
      })
      await db.agentRunEvents.add({
        projectId: staled.projectId,
        worldGroupId: staled.worldGroupId,
        runId,
        sequence: staled.sequence,
        generation: staled.generation,
        contractHash: staled.contractHash,
        type: staled.type,
        payloadJson: canonicalStringify(staled.payload),
        createdAt: staled.createdAt,
      })
      domainEvents = [...domainEvents, staled]
      projection = replayAgentRunEventsV1(domainEvents)
      appendedImportTerminalEvent = true
    } else if ((nodeRetirementReason !== null || hasNonPortableCheckpoint(checkpoints)) && !['failed', 'cancelled'].includes(projection.state)
      && !hasImportedCompletedPrefix(projection, domainEvents)) {
      const cancelled = parseAgentRunEventV1({
        version: 1,
        runId,
        sequence: projection.lastSequence + 1,
        generation: projection.generation,
        projectId: run.projectId,
        worldGroupId: run.worldGroupId ?? null,
        contractHash: run.contractHash,
        type: 'run.cancelled',
        payload: { reason: nodeRetirementReason ?? 'project-import-nonportable-checkpoint' },
        createdAt: Date.now(),
      })
      await db.agentRunEvents.add({
        projectId: cancelled.projectId,
        worldGroupId: cancelled.worldGroupId,
        runId,
        sequence: cancelled.sequence,
        generation: cancelled.generation,
        contractHash: cancelled.contractHash,
        type: cancelled.type,
        payloadJson: canonicalStringify(cancelled.payload),
        createdAt: cancelled.createdAt,
      })
      domainEvents = [...domainEvents, cancelled]
      projection = replayAgentRunEventsV1(domainEvents)
      appendedImportTerminalEvent = true
    }
    const projectionBody = toAgentRunProjectionBodyV1(projection)
    await db.agentRuns.update(runId, {
      status: projection.state,
      generation: projection.generation,
      lastSequence: projection.lastSequence,
      projectionJson: canonicalStringify(projectionBody),
      projectionHash: await Dexie.waitFor(hashCanonicalValue(projectionBody)),
      terminalReceiptHash: projection.terminalReceiptHash ?? null,
      // Pure ID/hash rebinding is transport work, not a new Harness action.
      // Preserve the original timestamp unless import appended a real stale or
      // cancellation event that changes the durable run lifecycle.
      updatedAt: appendedImportTerminalEvent ? Date.now() : run.updatedAt,
    })
    if (run.portableRuntimeOriginJson !== undefined) {
      const { readTtrpgOpenRunOriginV1 } = await Dexie.waitFor(import('../../ttrpg/open-run-portability'))
      await readTtrpgOpenRunOriginV1(runId, 'archive')
    }

  }
}
