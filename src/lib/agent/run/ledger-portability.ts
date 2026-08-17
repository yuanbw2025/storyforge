import Dexie from 'dexie'
import { db } from '../../db/schema'
import type {
  AgentRunCheckpointRecord,
  AgentRunEventRecord,
  AgentRunRecord,
  AnyAgentRunEventV1,
} from '../../types'
import type { ProjectExportData } from '../../export/json-export'
import { parseAgentRunEventV1 } from './event-schema'
import { canonicalStringify, hashCanonicalValue } from './hash'
import {
  replayAgentRunEventsV1,
  toAgentRunProjectionBodyV1,
} from './projection'
import {
  portableizeAgentRunContractV1,
  rebindPortableAgentRunContractV1,
} from './contract-portability'

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

function rowsForRun(rows: ExportRow[], runKey: number): ExportRow[] {
  return rows
    .filter(row => row._agentRunExportId === runKey)
    .sort((left, right) => left.sequence - right.sequence)
}

async function assertExportedRunProjection(run: ExportRow, events: ExportRow[]): Promise<void> {
  const worldGroupId = run._worldGroupExportId == null ? null : run._worldGroupExportId + 1
  const domainEvents = events.map(event => parseAgentRunEventV1({
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
    || (projection.terminalReceiptHash ?? null) !== (run.terminalReceiptHash ?? null)
  ) fail(`run ${run._exportId} 导出前物化投影与事件不一致`)
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

/** Registry export hook: replace every embedded local ID and generation hash. */
export async function portableizeAgentRunLedgerExportV1(
  data: ProjectExportData,
  idMaps: IdMaps,
): Promise<void> {
  const runs = (data.agentRuns ?? []) as ExportRow[]
  const events = (data.agentRunEvents ?? []) as ExportRow[]
  const checkpoints = (data.agentRunCheckpoints ?? []) as ExportRow[]
  for (const run of runs) {
    if (!Number.isInteger(run._exportId)) fail('agentRuns 缺少便携 _exportId')
    const runEvents = rowsForRun(events, run._exportId)
    if (runEvents.some(event => event._worldGroupExportId !== run._worldGroupExportId)) {
      fail(`run ${run._exportId} 事件世界组与运行不一致`)
    }
    await assertExportedRunProjection(run, runEvents)
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
    for (const checkpoint of rowsForRun(checkpoints, run._exportId)) {
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
  for (const runId of input.runIds) {
    const run = await db.agentRuns.get(runId)
    if (!run || run.id == null) fail(`导入 run ${runId} 不存在`)
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
    } else if (hasNonPortableCheckpoint(checkpoints) && !['failed', 'cancelled'].includes(projection.state)) {
      const cancelled = parseAgentRunEventV1({
        version: 1,
        runId,
        sequence: projection.lastSequence + 1,
        generation: projection.generation,
        projectId: run.projectId,
        worldGroupId: run.worldGroupId ?? null,
        contractHash: run.contractHash,
        type: 'run.cancelled',
        payload: { reason: 'project-import-nonportable-checkpoint' },
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
  }
}
