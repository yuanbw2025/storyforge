import { db } from '../db/schema'
import type {
  ProductRuntimeEvent,
  ProductRuntimeSession,
  ProductRuntimeState,
  TtrpgRuntimeAssetRequestRecordV1,
} from '../types'
import { cloneTtrpgSessionParticipantsV2 } from './participants'

/**
 * Clone the TTRPG-owned side tables represented by a replayed branch state.
 * Shared ProductRuntime only coordinates this hook; it never interprets these
 * product-private rows.
 */
export async function cloneTtrpgRuntimeBranchExtensionsV1(input: {
  parent: ProductRuntimeSession
  child: ProductRuntimeSession
  throughSequence: number
  state: ProductRuntimeState
  events: ProductRuntimeEvent[]
}): Promise<void> {
  if (input.parent.id == null || input.child.id == null) return

  await cloneTtrpgSessionParticipantsV2({
    parentSessionId: input.parent.id,
    child: input.child,
  })

  const media = input.state.ttrpg?.product?.media
  if (!media || input.child.worldId == null || input.child.workId == null) return
  const childWorldId = input.child.worldId
  const childWorkId = input.child.workId

  const reflectedSlots = media.slots.filter(
    slot => slot.requestKey != null && slot.status !== 'placeholder',
  )
  if (reflectedSlots.length === 0) return

  const parentRows = await db.ttrpgRuntimeAssetRequests
    .where('sessionId')
    .equals(input.parent.id)
    .toArray()
  const now = Date.now()
  const rows: TtrpgRuntimeAssetRequestRecordV1[] = reflectedSlots.map(slot => {
    const source = parentRows.find(
      row => row.requestKey === slot.requestKey && row.slotKey === slot.slotKey,
    )
    if (!source) throw new Error(`TTRPG 分支缺少媒资请求证据:${slot.requestKey}`)

    const failuresThroughBranch = input.events.filter(event => {
      if (
        event.sequence > input.throughSequence
        || event.type !== 'ttrpg.media.failed'
      ) return false
      try {
        return JSON.parse(event.payloadJson).requestKey === slot.requestKey
      } catch {
        return false
      }
    }).length
    const available = slot.status === 'available'
    const status = slot.status as Exclude<
      TtrpgRuntimeAssetRequestRecordV1['status'],
      'generating'
    >
    const cloned: TtrpgRuntimeAssetRequestRecordV1 = {
      ...source,
      projectId: input.child.projectId,
      worldGroupId: input.child.worldGroupId ?? null,
      worldId: childWorldId,
      workId: childWorkId,
      sessionId: input.child.id!,
      status,
      attemptCount: Math.min(
        source.maximumAttempts,
        failuresThroughBranch + (available ? 1 : 0),
      ),
      actualCostUsd: available ? source.actualCostUsd : null,
      mediaAssetId: available ? slot.mediaAssetId : null,
      mediaAssetVersion: available ? slot.mediaAssetVersion : null,
      mediaContentHash: available ? slot.mediaContentHash : null,
      processorLeaseId: null,
      processorLeaseExpiresAt: null,
      lastErrorCode: slot.status === 'failed' ? slot.lastErrorCode : null,
      lastErrorDetail: null,
      terminalEventSequence: ['available', 'failed', 'cancelled'].includes(slot.status)
        ? slot.updatedAtSequence
        : null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }
    delete cloned.id
    return cloned
  })
  await db.ttrpgRuntimeAssetRequests.bulkAdd(rows)
}
