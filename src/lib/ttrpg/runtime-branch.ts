import { db } from '../db/schema'
import type {
  ProductRuntimeEvent,
  ProductRuntimeSession,
  ProductRuntimeState,
  TtrpgRuntimeAssetRequestRecordV1,
} from '../types'
import { cloneTtrpgSessionParticipantsV2 } from './participants'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { projectTtrpgOpenMemoryRowV1, assertTtrpgOpenMemoryLocatorV1 } from './open-memory-proof'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { cloneTtrpgOpenAudioMediaV1 } from './open-audio-media'
import { runtimeInstanceTablesV1, transactionTablesForReferenceCascade } from '../registry/lifecycle'
import type { CreateProductRuntimeSessionInput } from '../product/runtime-core'

/** Open TTRPG owns cutpoint authorization, source CAS and media/memory cloning. */
export async function createTtrpgRuntimeOwnedBranchV1(input: {
  parent: ProductRuntimeSession; state: ProductRuntimeState; childInput: CreateProductRuntimeSessionInput
  events: ProductRuntimeEvent[]; throughSequence: number
}): Promise<ProductRuntimeSession | null> {
  const { parent, state, childInput, events, throughSequence } = input
  if (!state.ttrpg || !('runFormat' in state.ttrpg) || state.ttrpg.runFormat !== 'open') return null
  if (parent.kind !== 'ttrpg' || childInput.kind !== 'ttrpg' || parent.id == null) {
    throw new Error('[ttrpg] open 分支不属于跑团实例')
  }
  // Preparing a real branch needs source verification; replay imports stay pure.
  const { prepareReleasedProductRuntimeSessionRecordV1, preparePreviewProductRuntimeSessionRecordV1,
    insertPreparedProductRuntimeSessionV1 } = await import('../product/runtime-core')
  const release = parent.productReleaseId == null ? null : await db.productReleases.get(parent.productReleaseId)
  const build = parent.productBuildId == null ? null : await db.productBuilds.get(parent.productBuildId)
  const lineage = { parentSessionId: parent.id, parentThroughSequence: throughSequence }
  const prepared = release
    ? await prepareReleasedProductRuntimeSessionRecordV1({ ...childInput, worldId: parent.worldId, workId: parent.workId,
      productReleaseId: parent.productReleaseId!, origin: 'branch' }, lineage)
    : build ? await preparePreviewProductRuntimeSessionRecordV1({ ...childInput, worldId: parent.worldId, workId: parent.workId,
      productBuildId: parent.productBuildId!, expectedPreviewHash: build.previewHash!, runtimeSourceHash: parent.runtimeSourceHash!,
      origin: 'branch' }, lineage)
      : (() => { throw new Error('[ttrpg] open 分支冻结运行源不存在') })()
  const cutEvents = events.filter(event => event.sequence <= throughSequence).sort((a, b) => a.sequence - b.sequence)
  const tables = [...new Set([db.productReleases, db.productBuilds, ...runtimeInstanceTablesV1(),
    ...transactionTablesForReferenceCascade('productRuntimeSessions'), ...transactionTablesForReferenceCascade('mediaBlobObjects')])]
  return db.transaction('rw', tables, async () => {
    const currentParent = await db.productRuntimeSessions.get(parent.id!)
    const currentSource = release ? await db.productReleases.get(release.id!) : await db.productBuilds.get(build!.id!)
    const currentEvents = (await db.productRuntimeEvents.where('sessionId').equals(parent.id!).toArray())
      .filter(event => event.sequence <= throughSequence).sort((a, b) => a.sequence - b.sequence)
    if (stable(currentParent) !== stable(parent) || stable(currentSource) !== stable(release ?? build)
      || stable(currentEvents) !== stable(cutEvents)) throw new Error('[ttrpg] open 分支创建期间父切点或冻结来源已变化')
    const child = await insertPreparedProductRuntimeSessionV1(prepared)
    await cloneTtrpgRuntimeBranchExtensionsV1({ parent, child, throughSequence, state, events })
    return child
  })
}

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
    ...(input.state.ttrpg && 'runFormat' in input.state.ttrpg && input.state.ttrpg.runFormat === 'open'
      ? { parentSessionKey: parseTtrpgRuntimeStateV2(input.state.ttrpg)!.branchLineage!.parentSessionKey } : {}),
  })

  await cloneTtrpgRuntimePreservedExtensionsV1(input)
}

/** Release continuation shares the same media/memory projection without cloning seats twice. */
export async function cloneTtrpgRuntimePreservedExtensionsV1(input: Parameters<typeof cloneTtrpgRuntimeBranchExtensionsV1>[0]): Promise<void> {
  if (input.parent.id == null || input.child.id == null) return
  const childRuntime = input.state.ttrpg && 'runFormat' in input.state.ttrpg && input.state.ttrpg.runFormat === 'open'
    ? parseTtrpgRuntimeStateV2(input.state.ttrpg) : null
  if (childRuntime) await cloneTtrpgOpenAudioMediaV1({ parent: input.parent, child: input.child, runtime: childRuntime })
  if (childRuntime?.openRun?.memoryReceipts?.length) {
    const parentRows = await db.ttrpgNarrativeMemories.where('sessionId').equals(input.parent.id).toArray()
    const parentKey = childRuntime.branchLineage!.parentSessionKey
    for (const receipt of childRuntime.openRun.memoryReceipts) {
      const original = parentRows.find(row => row.revisionKey === receipt.draft.revisionKey)
      if (!original) throw new Error('[ttrpg-memory] 分支缺少切点记忆原记录')
      if (original.sourceSessionId !== null) assertTtrpgOpenMemoryLocatorV1(receipt, await db.productRuntimeSessions.get(original.sourceSessionId), input.parent)
      const { id: _id, ...fields } = original
      if (stable(fields) !== stable(projectTtrpgOpenMemoryRowV1(receipt, input.parent, original.sourceSessionId))) throw new Error('[ttrpg-memory] 分支原记忆与已确认回执不一致')
      const sourceId = receipt.sourceRef.sessionKey === parentKey ? input.parent.id : original.sourceSessionId
      await db.ttrpgNarrativeMemories.add(projectTtrpgOpenMemoryRowV1(receipt, input.child, sourceId))
    }
  }

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
