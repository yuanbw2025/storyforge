import Dexie from 'dexie'
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
import { cloneProductRuntimeMediaBindingV1 } from '../product/runtime-media-library'
import { inheritRuntimeMediaCostAtCut, readRuntimeMediaAccounting } from './runtime-media-attempt-accounting'

// Current bindings carry null data; compare any legacy inline buffers without
// trusting a runtime row merely because its declared TypeScript type is current.
function sameLegacyBindingBytes(left: unknown, right: unknown): boolean {
  if (left === null) return right === null
  if (!(left instanceof ArrayBuffer) || !(right instanceof ArrayBuffer) || left.byteLength !== right.byteLength) return false
  const compared = new Uint8Array(right)
  return new Uint8Array(left).every((value, index) => value === compared[index])
}

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
  // Keep replay imports pure. Only load the already-used creation boundary
  // here, while preserving the original native transaction across module load.
  const { parseProductRuntimeState, finalizeInsertedRuntimeBranchProjectionV1 } =
    await Dexie.waitFor(import('../product/runtime-core'))
  const originalInitial = parseProductRuntimeState(input.child.initialStateJson)
  if (stable(originalInitial) !== stable(input.state)) throw new Error('TTRPG 分支初态与已验证插入记录不一致')
  const remappedInitial = structuredClone(originalInitial)

  const reflectedSlots = media.slots.filter(
    slot => slot.requestKey != null && slot.status !== 'placeholder',
  )

  const parentRows = await db.ttrpgRuntimeAssetRequests
    .where('sessionId')
    .equals(input.parent.id)
    .toArray()
  const historicalMediaEvents = new Map<string, ProductRuntimeEvent[]>()
  for (const event of input.events) {
    if (event.sequence > input.throughSequence || !event.type.startsWith('ttrpg.media.')) continue
    try {
      const requestKey = JSON.parse(event.payloadJson).requestKey
      if (typeof requestKey !== 'string') continue
      const prior = historicalMediaEvents.get(requestKey)
      if (prior) prior.push(event)
      else historicalMediaEvents.set(requestKey, [event])
    } catch { /* Replay already validates the cut; no unparseable event proves a debit. */ }
  }
  // Generic branching accepts an appended suffix after its preparation.
  // Read the real head in the same native transaction as the attempt rows.
  const parentHead = await db.productRuntimeEvents.where('[sessionId+sequence]')
    .between([input.parent.id, 0], [input.parent.id, Number.MAX_SAFE_INTEGER], true, true).last()
  const atHead = (parentHead?.sequence ?? 0) === input.throughSequence
  function inheritedCost(source: TtrpgRuntimeAssetRequestRecordV1) {
    const events = historicalMediaEvents.get(source.requestKey) ?? []
    const terminals = events.filter(event => event.type === 'ttrpg.media.available' || event.type === 'ttrpg.media.failed')
    const observedAttempts = Math.max(terminals.length, ...terminals.map(event =>
      Number(event.commandId?.match(/\.(\d+)$/)?.[1] ?? 0)))
    const latestTerminal = Math.max(0, ...terminals.map(event => event.sequence))
    const hasPendingRequest = events.some(event => event.type === 'ttrpg.media.requested' && event.sequence > latestTerminal)
    const measuredAtCut = source.actualCostUsd !== null && source.terminalEventSequence !== null &&
      (events.some(event => event.sequence === source.terminalEventSequence &&
        (event.type === 'ttrpg.media.available' || event.type === 'ttrpg.media.failed' || event.type === 'ttrpg.media.cancelled')) ||
        (atHead && input.parent.parentThroughSequence !== null && source.status === 'available'))
    const possibleAttempts = atHead ? Math.max(source.attemptCount, 1)
      : Math.max(1, observedAttempts + (hasPendingRequest ? 1 : 0))
    return inheritRuntimeMediaCostAtCut(source, input.throughSequence, { atHead, possibleAttempts, measuredAtCut })
  }
  const now = Date.now()
  const rows: TtrpgRuntimeAssetRequestRecordV1[] = []
  let remappedInitialMedia = false
  for (const slot of reflectedSlots) {
    const source = parentRows.find(
      row => row.requestKey === slot.requestKey && row.slotKey === slot.slotKey,
    )
    if (!source) throw new Error(`TTRPG 分支缺少媒资请求证据:${slot.requestKey}`)

    const failuresThroughBranch = (historicalMediaEvents.get(source.requestKey) ?? [])
      .filter(event => event.type === 'ttrpg.media.failed').length
    const available = slot.status === 'available'
    const status = slot.status as Exclude<
      TtrpgRuntimeAssetRequestRecordV1['status'],
      'generating'
    >
    let localMediaAssetId: number | null = null
    if (available && slot.mediaAssetId !== null) {
      // Use the immutable cutpoint version, not the current request's latest candidate.
      const assets = await db.productMediaAssets.where('productRuntimeSessionId').equals(input.parent.id!)
        .filter(asset => asset.assetKey === slot.assetKey && asset.version === slot.mediaAssetVersion &&
          asset.contentHash === slot.mediaContentHash).toArray()
      const asset = assets[0]
      if (assets.length !== 1 || !asset?.id) throw new Error('TTRPG 分支缺少切点媒资原版本')
      const bindings = await db.productMediaBlobs.where('mediaAssetId').equals(asset.id).toArray()
      if (bindings.length !== 1) throw new Error('TTRPG 分支缺少切点媒资强绑定')
      await cloneProductRuntimeMediaBindingV1({ asset, binding: bindings[0], targetSessionId: input.child.id! })
      const local = await db.productMediaAssets.where('productRuntimeSessionId').equals(input.child.id!)
        .filter(row => row.assetKey === asset.assetKey && row.version === asset.version && row.contentHash === asset.contentHash).first()
      if (!local?.id) throw new Error('TTRPG 分支缺少子实例媒资绑定')
      const localBindings = await db.productMediaBlobs.where('mediaAssetId').equals(local.id).toArray()
      const omitBindingIdentity = ({ id: _id, mediaAssetId: _assetId, createdAt: _createdAt, ...value }: typeof bindings[number]) => value
      if (localBindings.length !== 1 || !sameLegacyBindingBytes(bindings[0].data, localBindings[0]?.data)
        || stable(omitBindingIdentity(localBindings[0])) !== stable(omitBindingIdentity(bindings[0]))) {
        throw new Error('TTRPG 子实例媒资与本次克隆的原强绑定不一致')
      }
      localMediaAssetId = local.id
      const expectedSlot = remappedInitial.ttrpg?.product?.media.slots[media.slots.indexOf(slot)]
      if (!expectedSlot || stable(expectedSlot) !== stable(slot)) throw new Error('TTRPG 分支媒资切点已变化')
      expectedSlot.mediaAssetId = local.id
      slot.mediaAssetId = local.id
      remappedInitialMedia = true
    }
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
      ...inheritedCost(source),
      mediaAssetId: localMediaAssetId,
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
    rows.push(cloned)
  }
  // A slot is a current projection, not a billing ledger. Preserve the
  // prefix's older, replaced request costs with no child slot or send authority.
  const reflected = new Set(rows.map(row => row.requestKey))
  for (const source of parentRows) {
    if (reflected.has(source.requestKey)) continue
    const inherited = readRuntimeMediaAccounting(source)?.inherited
    const requestedAtCut = historicalMediaEvents.get(source.requestKey)?.some(event => event.type === 'ttrpg.media.requested')
    if (!inherited && !requestedAtCut) continue
    const cost = inheritedCost(source)
    const { id: _sourceId, ...original } = source
    rows.push({
      ...original, ...cost, projectId: input.child.projectId, worldGroupId: input.child.worldGroupId ?? null,
      worldId: childWorldId, workId: childWorkId, sessionId: input.child.id!,
      status: 'cancelled', attemptCount: 0,
      mediaAssetId: null, mediaAssetVersion: null, mediaContentHash: null,
      processorLeaseId: null, processorLeaseExpiresAt: null, lastErrorCode: null,
      lastErrorDetail: null, terminalEventSequence: null, revision: 1, createdAt: now, updatedAt: now,
    })
  }
  await db.ttrpgRuntimeAssetRequests.bulkAdd(rows)
  if (remappedInitialMedia) {
    // Only exact child asset IDs from the verified clone may change. The
    // shared kernel owns the one-time write to the newly inserted session.
    if (stable(input.state) !== stable(remappedInitial)) throw new Error('TTRPG 分支投影含有媒资重映射之外的修改')
    const projection = await finalizeInsertedRuntimeBranchProjectionV1(input)
    Object.assign(input.child, projection)
  }
}
