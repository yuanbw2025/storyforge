/** Validate memory projections against replayed real E15 receipts, including preserved ancestors. */
import type { ProductRuntimeEvent } from '../types'
import { parseTtrpgNarrativeMemoryV1 } from './narrative-memory'
import type { TtrpgOpenMemoryReceipt } from './open-memory-receipt'
import { parseProductRuntimeState, replayProductRuntimeEvents } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { verifyTtrpgOpenMemoryReceiptsV1 } from './open-memory-proof'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'

export async function assertTtrpgNarrativeMemoryBackupV1(backup: Record<string, unknown>): Promise<void> {
  const rows = backup.ttrpgNarrativeMemories, sessions = backup.productRuntimeSessions, events = backup.productRuntimeEvents
  if (!Array.isArray(rows) || !Array.isArray(sessions) || !Array.isArray(events)) throw new Error('[ttrpg-memory-backup] 缺少实例、事件或记忆表')
  const byId = new Map(sessions.map(row => [row._exportId, row]))
  const receipts = new Map<number, readonly TtrpgOpenMemoryReceipt[]>()
  const eventsBySession = new Map<number, typeof events>()
  for (const event of events) { const bucket = eventsBySession.get(event._productRuntimeSessionExportId) ?? []; bucket.push(event); eventsBySession.set(event._productRuntimeSessionExportId, bucket) }
  const ownersWithRows = new Set(rows.map(row => row._productRuntimeSessionExportId))
  for (const session of sessions) {
    if (session.kind !== 'ttrpg') continue
    const ownEvents = eventsBySession.get(session._exportId) ?? []
    const initial = JSON.parse(session.initialStateJson)
    if (!ownersWithRows.has(session._exportId)
      && !initial.ttrpg?.openRun?.memoryReceipts?.length && !ownEvents.some(e => e.type === 'ttrpg.memory.recorded')) continue
    const replayEvents: ProductRuntimeEvent[] = ownEvents.map(event => {
      const payload = JSON.parse(event._portablePayloadJson ?? event.payloadJson)
      if (payload?.envelope && typeof payload.envelope === 'object' && payload.envelope.sessionId === session._exportId) payload.envelope.sessionId = session._exportId + 1
      return { ...event, projectId: 0, sessionId: session._exportId + 1, worldGroupId: session._worldGroupExportId ?? null,
        payloadJson: JSON.stringify(payload) } as ProductRuntimeEvent
    })
    const state = replayProductRuntimeEvents(parseProductRuntimeState(initial), replayEvents)
    const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
    if (!runtime) throw new Error('[ttrpg-memory-backup] 记忆不属于 open 实例')
    await verifyTtrpgOpenMemoryReceiptsV1({ runtime, runtimeSourceHash: session.runtimeSourceHash, events: replayEvents })
    receipts.set(session._exportId, runtime.openRun?.memoryReceipts ?? [])
  }
  const allowed = new Set(['_exportId', '_worldGroupExportId', '_worldExportId', '_workExportId',
    '_productRuntimeSessionExportId', '_sourceSessionExportId', 'revisionKey', 'observerKey', 'reliability', 'audience',
    'knownBy', 'summary', 'fromEventSequence', 'toEventSequence', 'derivedFromHash', 'stale', 'updatedAt'])
  const identities = new Set<string>(), exportIds = new Set<number>()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Object.keys(row).some(key => !allowed.has(key))) throw new Error('[ttrpg-memory-backup] 记忆字段不是准确便携合同')
    const owner = byId.get(row._productRuntimeSessionExportId)
    if (!Number.isSafeInteger(row._exportId) || row._exportId < 0 || exportIds.has(row._exportId) || !owner || owner.kind !== 'ttrpg'
      || owner._worldExportId !== row._worldExportId || owner._workExportId !== row._workExportId
      || (owner._worldGroupExportId ?? null) !== (row._worldGroupExportId ?? null)) throw new Error('[ttrpg-memory-backup] 记忆 owner、作用域或身份不一致')
    exportIds.add(row._exportId)
    const { _exportId, _worldGroupExportId, _worldExportId, _workExportId, _productRuntimeSessionExportId, _sourceSessionExportId, ...fields } = row
    parseTtrpgNarrativeMemoryV1({ ...fields, projectId: 1, worldGroupId: _worldGroupExportId == null ? null : _worldGroupExportId + 1,
      worldId: _worldExportId + 1, workId: _workExportId + 1, sessionId: _productRuntimeSessionExportId + 1,
      sourceSessionId: _sourceSessionExportId == null ? null : _sourceSessionExportId + 1 })
    const receipt = receipts.get(row._productRuntimeSessionExportId)?.find(r => r.draft.revisionKey === row.revisionKey)
    if (!receipt || stable(fields) !== stable({ ...receipt.draft, derivedFromHash: receipt.derivedFromHash, stale: false, updatedAt: receipt.recordedAt })) throw new Error('[ttrpg-memory-backup] 记忆行不匹配实际确认回执')
    if (_sourceSessionExportId != null) {
      const source = byId.get(_sourceSessionExportId)
      if (!source || source.kind !== 'ttrpg' || source._worldExportId !== owner._worldExportId || source._workExportId !== owner._workExportId
        || source.runtimeSourceHash !== owner.runtimeSourceHash || JSON.parse(source.initialStateJson).ttrpg?.sessionKey !== receipt.sourceRef.sessionKey) throw new Error('[ttrpg-memory-backup] 本地来源定位与稳定原实例不一致')
    }
    const identity = `${row._productRuntimeSessionExportId}:${row.revisionKey}`
    if (identities.has(identity)) throw new Error('[ttrpg-memory-backup] 记忆版本重复')
    identities.add(identity)
  }
  for (const [session, values] of receipts) for (const receipt of values ?? []) {
    if (!identities.has(`${session}:${receipt.draft.revisionKey}`)) throw new Error('[ttrpg-memory-backup] 已确认记忆缺少完整表投影')
  }
}
