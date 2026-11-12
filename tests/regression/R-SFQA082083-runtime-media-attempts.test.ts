import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { appendProductRuntimeEvent, branchProductRuntimeSession, deleteProductRuntimeSession, readProductRuntimeState, readProductRuntimeStateVersion, preparePreviewProductRuntimeSessionRecordV1, insertPreparedProductRuntimeSessionV1, finalizeInsertedRuntimeBranchProjectionV1 } from '../../src/lib/product/runtime-core'
import { createProductOwnedBranchOriginV1, prepareProductRuntimeStateForBranchV1 } from '../../src/lib/product/runtime-product-adapters'
import { runtimeInstanceTablesV1, transactionTablesForReferenceCascade } from '../../src/lib/registry/lifecycle'
import { scopeTransactionTables } from '../../src/lib/workspace/scope'
import { cloneTtrpgRuntimePreservedExtensionsV1 } from '../../src/lib/ttrpg/runtime-branch'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import * as runtimeMediaLibrary from '../../src/lib/product/runtime-media-library'
import type { MediaProviderTransportV1 } from '../../src/lib/product-production/media-adapters'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import {
  cancelTtrpgRuntimeAssetRequestV1, enqueueTtrpgRuntimeAssetRequestV1, processTtrpgRuntimeAssetRequestV1,
  readTtrpgRuntimeMediaBlobV1, readVisibleTtrpgRuntimeMediaRequestsV1,
  recoverTtrpgRuntimeMediaQueueV1, retryTtrpgRuntimeAssetRequestV1,
} from '../../src/lib/ttrpg/runtime-media'

import { GM, SLOT, seedTtrpgRuntimeMediaAttemptFixtureV1 as fixture } from '../helpers/current-ttrpg-runtime-media-attempt'

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8WgWQAAAABJRU5ErkJggg=='), ch => ch.charCodeAt(0)).buffer

beforeEach(async () => {
  await db.delete(); await db.open()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('No external transport is authorized') }))
})
afterEach(() => {
  try { expect(fetch).not.toHaveBeenCalled() }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() }
})

function barrier() {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  return { wait, release }
}

async function provider(costs: number[], beforeResponse?: (index: number) => Promise<void>) {
  const hash = await sha256MediaData(PNG)
  let index = 0
  const request = vi.fn<MediaProviderTransportV1['request']>(async wire => {
    const at = index++
    await beforeResponse?.(at)
    return { status: 200, contentType: 'image/png', body: PNG,
      json: { packId: 'sfqa082083', packVersion: 1, artifactKey: wire.body.artifactKey,
        fileName: 'isolated.png', declaredContentHash: hash, mimeType: 'image/png', width: 1, height: 1,
        title: 'Isolated attempt receipt', altText: 'Synthetic image', license: 'CC0-1.0', commercialUse: false, source: 'synthetic' },
      providerRequestId: `sfqa082083.receipt.${at}`, usage: null, costUsd: costs[at] ?? 0,
    }
  })
  return { executionLocation: 'browser-direct' as const, request }
}

it('082 does not dispatch an expired worker whose claim was recovered before any send', async () => {
  const f = await fixture(), transport = await provider([0, 0])
  const claimed = barrier(), deliver = barrier()
  const transaction = db.transaction.bind(db)
  let captured = false
  const spy = vi.spyOn(db, 'transaction').mockImplementation(((...args: unknown[]) => {
    const result = Reflect.apply(transaction, db, args)
    if (captured || args[0] !== 'rw' || !args.slice(1, -1).flat(1).includes(db.ttrpgRuntimeAssetRequests)) return result
    return result.then(async (value: unknown) => {
      const row = value as typeof f.row | undefined
      if (!captured && row?.id === f.row.id && row?.status === 'generating') {
        captured = true; claimed.release(); await deliver.wait
      }
      return value
    })
  }) as typeof db.transaction)
  const old = Promise.allSettled([f.execute(transport)])
  try {
    await claimed.wait
    expect(transport.request).not.toHaveBeenCalled()
    const active = (await db.ttrpgRuntimeAssetRequests.get(f.row.id!))!
    expect(await recoverTtrpgRuntimeMediaQueueV1({ sessionId: f.sessionId, now: active.processorLeaseExpiresAt! + 1 })).toBe(1)
    expect((await db.ttrpgRuntimeAssetRequests.get(f.row.id!))?.status).toBe('queued')
    expect((await f.execute(transport)).status).toBe('available')
  } finally { deliver.release(); await old; spy.mockRestore() }
  expect(transport.request).toHaveBeenCalledTimes(1)
})

it('082 keeps a dispatched unknown attempt out of the queue across reopen and concurrent recovery', async () => {
  const f = await fixture(), sent = barrier(), reply = barrier()
  const transport = await provider([2, 0], async index => { if (index === 0) { sent.release(); await reply.wait } })
  const first = Promise.allSettled([f.execute(transport)])
  let afterRecover: string | undefined
  try {
    await sent.wait
    const active = (await db.ttrpgRuntimeAssetRequests.get(f.row.id!))!
    db.close(); await db.open()
    const input = { sessionId: f.sessionId, now: active.processorLeaseExpiresAt! + 1 }
    const recovered = await Promise.all([recoverTtrpgRuntimeMediaQueueV1(input), recoverTtrpgRuntimeMediaQueueV1(input)])
    expect(recovered.reduce((sum, count) => sum + count, 0)).toBe(1)
    afterRecover = (await db.ttrpgRuntimeAssetRequests.get(f.row.id!))?.status
    await Promise.allSettled([f.execute(transport)])
  } finally { reply.release(); await first }
  expect(transport.request).toHaveBeenCalledTimes(1)
  expect(afterRecover).not.toBe('queued')
  const kept = (await db.ttrpgRuntimeAssetRequests.get(f.row.id!))!
  expect(kept.actualCostUsd).toBe(2)
  expect(kept.mediaAssetId).toBeNull()
})

it('083 blocks a retry before dispatch when the original paid receipt exhausted the session', async () => {
  const f = await fixture(), transport = await provider([11, 1])
  const first = await f.execute(transport)
  expect(first).toMatchObject({ status: 'failed', actualCostUsd: 11, lastErrorCode: 'session-cost-budget-exceeded' })
  try {
    await retryTtrpgRuntimeAssetRequestV1({ requestId: f.row.id!, viewerKey: GM })
    await f.execute(transport)
  } catch { /* The public path may fail before the provider, which is required. */ }
  expect(transport.request).toHaveBeenCalledTimes(1)
  expect((await db.ttrpgRuntimeAssetRequests.get(f.row.id!))!.actualCostUsd).toBe(11)
})

it('083 preserves both measured charges when a paid result fails binding and an affordable retry succeeds', async () => {
  const f = await fixture(), transport = await provider([3, 2])
  vi.spyOn(runtimeMediaLibrary, 'importProductRuntimeMediaAssetV1').mockRejectedValueOnce(new Error('isolated media bind failure'))
  const first = await f.execute(transport)
  expect(first.status).toBe('failed')
  await retryTtrpgRuntimeAssetRequestV1({ requestId: f.row.id!, viewerKey: GM })
  const second = await f.execute(transport)
  expect(second.status).toBe('available')
  expect(transport.request).toHaveBeenCalledTimes(2)
  expect(second.actualCostUsd).toBe(5)
  expect(first.actualCostUsd).toBe(3)
})

it('082 cannot retry a transport disconnect with unknown provider outcome', async () => {
  const f = await fixture()
  const transport = await provider([0, 1], async index => {
    if (index === 0) throw new TypeError('Failed to fetch')
  })
  await Promise.allSettled([f.execute(transport)])
  db.close(); await db.open()
  try {
    await retryTtrpgRuntimeAssetRequestV1({ requestId: f.row.id!, viewerKey: GM })
    await f.execute(transport)
  } catch { /* An unknown result must remain blocked across reopen. */ }
  expect(transport.request).toHaveBeenCalledTimes(1)
  const retained = await db.ttrpgRuntimeAssetRequests.get(f.row.id!)
  expect(retained?.actualCostUsd).toBeNull()
  expect(retained?.mediaAssetId).toBeNull()
})

it('083 preserves a measured receipt before adapter parsing and distinguishes cancellation from a refund', async () => {
  const f = await fixture()
  const transport = await provider([4])
  const send = transport.request.getMockImplementation()!
  transport.request.mockImplementation(async (...args) => ({ ...await send(...args), json: null }))
  const failed = await f.execute(transport)
  expect(failed).toMatchObject({ status: 'failed', actualCostUsd: 4, mediaAssetId: null })
  expect((await cancelTtrpgRuntimeAssetRequestV1({ requestId: f.row.id!, viewerKey: GM })).actualCostUsd).toBe(4)
  await expect(enqueueTtrpgRuntimeAssetRequestV1({ sessionId: f.sessionId, viewerKey: GM, slotKey: SLOT,
    requestKey: 'new.over.remaining', adapterId: f.adapter.capability.adapterId, adapter: f.adapter,
    environment: 'test', maximumRequestCostUsd: 7 })).rejects.toThrow(/预算/)
})

it('082/083 preserve unknown holds, original paid candidate bytes and legacy uncertainty across backup and deletion', async () => {
  const f = await fixture()
  const transport = await provider([11])
  const failed = await f.execute(transport)
  expect(failed).toMatchObject({ status: 'failed', actualCostUsd: 11, mediaAssetId: null })
  const originalAsset = await db.productMediaAssets.where('productRuntimeSessionId').equals(f.sessionId).first()
  expect(originalAsset?.contentHash).toBe(await sha256MediaData(PNG))
  const backup = await exportProjectJSON(f.scope.projectId)
  const invalid = structuredClone(backup)
  const forged = JSON.parse(invalid.ttrpgRuntimeAssetRequests[0]!.attemptAccountingJson!)
  forged.attempts[0].candidate.mediaAssetId = originalAsset!.id
  invalid.ttrpgRuntimeAssetRequests[0]!.attemptAccountingJson = JSON.stringify(forged)
  await expect(importProjectJSON(invalid)).rejects.toThrow(/媒资尝试账目/)
  const importedProject = await importProjectJSON(structuredClone(backup))
  const restored = await db.ttrpgRuntimeAssetRequests.where('projectId').equals(importedProject).first()
  expect(restored?.actualCostUsd).toBe(11)
  expect(restored?.attemptAccountingJson).toBe(failed.attemptAccountingJson)
  expect(restored?.mediaAssetId).toBeNull()
  const copyAsset = await db.productMediaAssets.where('productRuntimeSessionId').equals(restored!.sessionId).first()
  expect(copyAsset).toMatchObject({ contentHash: originalAsset!.contentHash, assetKey: originalAsset!.assetKey, ownerKind: 'runtime' })
  expect(copyAsset!.id).not.toBe(originalAsset!.id)
  await expect(readTtrpgRuntimeMediaBlobV1({ scope: { projectId: restored!.projectId, worldId: restored!.worldId, workId: restored!.workId },
    sessionId: restored!.sessionId, viewerKey: GM, mediaAssetId: copyAsset!.id! })).rejects.toThrow(/不能读取/)
  await deleteProductRuntimeSession(restored!.sessionId)
  expect(await db.ttrpgRuntimeAssetRequests.get(restored!.id!)).toBeUndefined()
  expect(await db.productMediaAssets.get(copyAsset!.id!)).toBeUndefined()
  expect(await db.productMediaAssets.get(originalAsset!.id!)).toBeDefined()

  const old = structuredClone(backup)
  delete old.ttrpgRuntimeAssetRequests[0]!.attemptAccountingJson
  old.ttrpgRuntimeAssetRequests[0]!.attemptCount = 0
  old.ttrpgRuntimeAssetRequests[0]!.actualCostUsd = null
  const oldProject = await importProjectJSON(old)
  const legacy = (await db.ttrpgRuntimeAssetRequests.where('projectId').equals(oldProject).first())!
  expect(await readVisibleTtrpgRuntimeMediaRequestsV1({ sessionId: legacy.sessionId, viewerKey: GM }))
    .toEqual([expect.objectContaining({ canRetry: false, hasUnresolvedAttempt: true })])
  await expect(retryTtrpgRuntimeAssetRequestV1({ requestId: legacy.id!, viewerKey: GM })).rejects.toThrow(/不可重试/)
})

it('082 retains an unknown hold when the author cancels and the backup is restored', async () => {
  const f = await fixture()
  const transport = await provider([], async () => { throw new TypeError('isolated transport disconnect') })
  expect((await f.execute(transport)).lastErrorCode).toBe('provider-outcome-unknown')
  await cancelTtrpgRuntimeAssetRequestV1({ requestId: f.row.id!, viewerKey: GM })
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = (await db.ttrpgRuntimeAssetRequests.where('projectId').equals(imported).first())!
  expect(restored).toMatchObject({ status: 'cancelled', actualCostUsd: null, processorLeaseId: null })
  await expect(enqueueTtrpgRuntimeAssetRequestV1({ sessionId: restored.sessionId, viewerKey: GM, slotKey: SLOT,
    requestKey: 'new.over.held', adapterId: f.adapter.capability.adapterId, adapter: f.adapter,
    environment: 'test', maximumRequestCostUsd: 6 })).rejects.toThrow(/预算/)
})

it('082 branch cut does not inherit the parent lease or a later paid result as child authority', async () => {
  const f = await fixture(), sent = barrier(), reply = barrier()
  const transport = await provider([2], async () => { sent.release(); await reply.wait })
  const parent = Promise.allSettled([f.execute(transport)])
  let child: Awaited<ReturnType<typeof branchProductRuntimeSession>>
  try {
    await sent.wait
    const cut = await readProductRuntimeStateVersion(f.sessionId)
    child = await branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: cut.sequence, title: 'Isolated cut' })
    const inherited = (await db.ttrpgRuntimeAssetRequests.where('sessionId').equals(child.id!).first())!
    expect(inherited).toMatchObject({ actualCostUsd: null, mediaAssetId: null, processorLeaseId: null })
    await expect(processTtrpgRuntimeAssetRequestV1({ requestId: inherited.id!, transport, adapter: f.adapter }))
      .rejects.toThrow(/不可处理|未结算/)
    await expect(enqueueTtrpgRuntimeAssetRequestV1({ sessionId: child.id!, viewerKey: GM, slotKey: SLOT,
      requestKey: 'branch.over.hold', adapterId: f.adapter.capability.adapterId, adapter: f.adapter,
      environment: 'test', maximumRequestCostUsd: 6 })).rejects.toThrow(/预算/)
    await expect(enqueueTtrpgRuntimeAssetRequestV1({ sessionId: child.id!, viewerKey: GM, slotKey: SLOT,
      requestKey: 'branch.explicit.new', adapterId: f.adapter.capability.adapterId, adapter: f.adapter,
      environment: 'test', maximumRequestCostUsd: 5 })).resolves.toMatchObject({ status: 'queued' })
  } finally { reply.release(); await parent }
  expect(transport.request).toHaveBeenCalledTimes(1)
  expect((await db.ttrpgRuntimeAssetRequests.where('sessionId').equals(f.sessionId).first())!.actualCostUsd).toBe(2)
  const childRows = await db.ttrpgRuntimeAssetRequests.where('sessionId').equals(child.id!).toArray()
  expect(childRows.every(row => row.actualCostUsd === null && row.mediaAssetId === null)).toBe(true)
})

it('083 branches an accepted cut into the child owner and can still read it after parent removal and backup', async () => {
  const f = await fixture(), transport = await provider([3])
  const accepted = await f.execute(transport)
  expect(accepted).toMatchObject({ status: 'available', actualCostUsd: 3 })
  const parentHead = await readProductRuntimeStateVersion(f.sessionId)
  const child = await branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: parentHead.sequence, title: 'Accepted cut' })
  const inherited = (await db.ttrpgRuntimeAssetRequests.where('sessionId').equals(child.id!).first())!
  expect(inherited).toMatchObject({ status: 'available', actualCostUsd: 3, processorLeaseId: null })
  expect(inherited.mediaAssetId).not.toBe(accepted.mediaAssetId)
  expect((await readProductRuntimeState(child.id!)).ttrpg?.product.media.slots[0]?.mediaAssetId).toBe(inherited.mediaAssetId)
  await expect(readTtrpgRuntimeMediaBlobV1({ scope: f.scope, sessionId: child.id!, viewerKey: GM,
    mediaAssetId: accepted.mediaAssetId! })).rejects.toThrow(/不能读取/)
  await deleteProductRuntimeSession(f.sessionId)
  expect(await (await readTtrpgRuntimeMediaBlobV1({ scope: f.scope, sessionId: child.id!, viewerKey: GM,
    mediaAssetId: inherited.mediaAssetId! })).arrayBuffer()).toEqual(PNG)

  const copy = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = (await db.ttrpgRuntimeAssetRequests.where('projectId').equals(copy).first())!
  expect(restored.mediaAssetId).not.toBe(inherited.mediaAssetId)
  expect(restored.actualCostUsd).toBe(3)
  const scope = { projectId: restored.projectId, worldId: restored.worldId, workId: restored.workId }
  const replayed = (await readProductRuntimeState(restored.sessionId)).ttrpg!.product.media.slots[0]!
  expect(await (await readTtrpgRuntimeMediaBlobV1({ scope, sessionId: restored.sessionId, viewerKey: GM,
    mediaAssetId: replayed.mediaAssetId! })).arrayBuffer()).toEqual(PNG)
})

it('082 recovery keeps an imported in-flight request from calling the provider under the old lease', async () => {
  const f = await fixture(), sent = barrier(), reply = barrier()
  const transport = await provider([2], async () => { sent.release(); await reply.wait })
  const pending = Promise.allSettled([f.execute(transport)])
  try {
    await sent.wait
    const copy = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const restored = (await db.ttrpgRuntimeAssetRequests.where('projectId').equals(copy).first())!
    await expect(processTtrpgRuntimeAssetRequestV1({ requestId: restored.id!, transport, adapter: f.adapter }))
      .rejects.toThrow(/不可处理/)
    await recoverTtrpgRuntimeMediaQueueV1({ sessionId: restored.sessionId, now: (restored.processorLeaseExpiresAt ?? Date.now()) + 1 })
    const kept = (await db.ttrpgRuntimeAssetRequests.get(restored.id!))!
    expect(kept).toMatchObject({ status: 'failed', lastErrorCode: 'provider-outcome-unknown', actualCostUsd: null, processorLeaseId: null })
    await expect(retryTtrpgRuntimeAssetRequestV1({ requestId: restored.id!, viewerKey: GM })).rejects.toThrow(/不可重试/)
  } finally { reply.release(); await pending }
  expect(transport.request).toHaveBeenCalledTimes(1)
})

it('083 counts a prior paid request after a new request replaces its slot in the branch cut', async () => {
  const f = await fixture(), transport = await provider([4])
  const send = transport.request.getMockImplementation()!
  transport.request.mockImplementation(async (...args) => ({ ...await send(...args), json: null }))
  expect(await f.execute(transport)).toMatchObject({ status: 'failed', actualCostUsd: 4 })
  await cancelTtrpgRuntimeAssetRequestV1({ requestId: f.row.id!, viewerKey: GM })
  const enqueue = (sessionId: number, requestKey: string, maximumRequestCostUsd: number) =>
    enqueueTtrpgRuntimeAssetRequestV1({ sessionId, viewerKey: GM, slotKey: SLOT, requestKey,
      adapterId: f.adapter.capability.adapterId, adapter: f.adapter, environment: 'test', maximumRequestCostUsd })
  await enqueue(f.sessionId, 'current.replaces.old', 2)
  const head = await readProductRuntimeStateVersion(f.sessionId)
  const child = await branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: head.sequence, title: 'Paid predecessor cut' })
  await expect(enqueue(child.id!, 'new.must.count.old.payment', 7)).rejects.toThrow(/预算/)
  const old = await db.ttrpgRuntimeAssetRequests.where('[sessionId+requestKey]').equals([child.id!, f.row.requestKey]).first()
  expect(old).toMatchObject({ actualCostUsd: 4, status: 'cancelled', mediaAssetId: null, processorLeaseId: null })
  await expect(retryTtrpgRuntimeAssetRequestV1({ requestId: old!.id!, viewerKey: GM })).rejects.toThrow(/不可重试/)
  const grandchild = await branchProductRuntimeSession({ parentSessionId: child.id!, throughSequence: 0, title: 'Same inherited cost' })
  await expect(enqueue(grandchild.id!, 'grandchild.must.count.old.payment', 7)).rejects.toThrow(/预算/)
  const copy = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restoredGrandchild = await db.productRuntimeSessions.where('projectId').equals(copy)
    .filter(row => row.title === 'Same inherited cost').first()
  expect(restoredGrandchild?.id).toBeDefined()
  await expect(enqueue(restoredGrandchild!.id!, 'restored.must.count.old.payment', 7)).rejects.toThrow(/预算/)
  expect(transport.request).toHaveBeenCalledTimes(1)
})

it('083 does not release multiple legacy unknown attempts by branching', async () => {
  const f = await fixture(), transport = await provider([], async () => { throw new TypeError('prior uncertain request') })
  expect((await f.execute(transport)).lastErrorCode).toBe('provider-outcome-unknown')
  // Restore the legacy scalar shape after an old unrecorded duplicate dispatch.
  await db.ttrpgRuntimeAssetRequests.update(f.row.id!, { attemptAccountingJson: undefined, attemptCount: 2 })
  const head = await readProductRuntimeStateVersion(f.sessionId)
  const child = await branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: head.sequence, title: 'Two legacy holds cut' })
  await expect(enqueueTtrpgRuntimeAssetRequestV1({ sessionId: child.id!, viewerKey: GM, slotKey: SLOT,
    requestKey: 'new.cannot.drop.legacy.hold', adapterId: f.adapter.capability.adapterId, adapter: f.adapter,
    environment: 'test', maximumRequestCostUsd: 1 })).rejects.toThrow(/预算/)
  expect(transport.request).toHaveBeenCalledTimes(1)
})

it('083 an older cut does not inherit requests or measured fees created after that cut', async () => {
  const f = await fixture()
  await cancelTtrpgRuntimeAssetRequestV1({ requestId: f.row.id!, viewerKey: GM })
  const cut = await readProductRuntimeStateVersion(f.sessionId)
  const enqueue = (sessionId: number, requestKey: string, maximumRequestCostUsd: number) =>
    enqueueTtrpgRuntimeAssetRequestV1({ sessionId, viewerKey: GM, slotKey: SLOT, requestKey,
      adapterId: f.adapter.capability.adapterId, adapter: f.adapter, environment: 'test', maximumRequestCostUsd })
  const later = await enqueue(f.sessionId, 'parent.future.payment', 5)
  const transport = await provider([8])
  expect(await processTtrpgRuntimeAssetRequestV1({ requestId: later.id!, adapter: f.adapter, transport, environment: 'test' }))
    .toMatchObject({ status: 'available', actualCostUsd: 8 })
  const child = await branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: cut.sequence, title: 'Before future payment' })
  const inherited = await db.ttrpgRuntimeAssetRequests.where('sessionId').equals(child.id!).toArray()
  expect(inherited.map(row => [row.requestKey, row.actualCostUsd, row.mediaAssetId])).toEqual([[f.row.requestKey, null, null]])
  await expect(enqueue(child.id!, 'new.independent.budget', 10)).resolves.toMatchObject({ status: 'queued' })
})

it('083 a real late fee after cancellation is inherited at the actual head, never backdated to an earlier cut', async () => {
  const f = await fixture(), sent = barrier(), reply = barrier()
  const transport = await provider([8], async () => { sent.release(); await reply.wait })
  const pending = Promise.allSettled([f.execute(transport)])
  const enqueue = (sessionId: number, requestKey: string, maximumRequestCostUsd: number) =>
    enqueueTtrpgRuntimeAssetRequestV1({ sessionId, viewerKey: GM, slotKey: SLOT, requestKey,
      adapterId: f.adapter.capability.adapterId, adapter: f.adapter, environment: 'test', maximumRequestCostUsd })
  let cancelledCut: number
  let prior: Awaited<ReturnType<typeof branchProductRuntimeSession>>
  try {
    await sent.wait
    const active = (await db.ttrpgRuntimeAssetRequests.get(f.row.id!))!
    await recoverTtrpgRuntimeMediaQueueV1({ sessionId: f.sessionId, now: active.processorLeaseExpiresAt! + 1 })
    const cancelled = await cancelTtrpgRuntimeAssetRequestV1({ requestId: f.row.id!, viewerKey: GM })
    expect(cancelled).toMatchObject({ status: 'cancelled', actualCostUsd: null })
    cancelledCut = (await readProductRuntimeStateVersion(f.sessionId)).sequence
    prior = await branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: cancelledCut, title: 'Unresolved before receipt' })
  } finally { reply.release(); await pending }
  expect(await db.ttrpgRuntimeAssetRequests.get(f.row.id!))
    .toMatchObject({ status: 'cancelled', actualCostUsd: 8, mediaAssetId: null, processorLeaseId: null })
  await expect(enqueue(f.sessionId, 'parent.already.paid', 4)).rejects.toThrow(/预算/)
  const current = await branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: cancelledCut, title: 'Measured at current head' })
  await expect(enqueue(current.id!, 'child.already.paid', 4)).rejects.toThrow(/预算/)
  expect(await db.ttrpgRuntimeAssetRequests.where('sessionId').equals(current.id!).first())
    .toMatchObject({ status: 'cancelled', actualCostUsd: 8, mediaAssetId: null, processorLeaseId: null })
  await appendProductRuntimeEvent({ sessionId: f.sessionId, type: 'narrative.recorded', payload: { text: 'Advance past the ambiguous cut.' } })
  const earlier = await branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: cancelledCut, title: 'Historical hold' })
  for (const child of [prior, earlier]) {
    expect(await db.ttrpgRuntimeAssetRequests.where('sessionId').equals(child.id!).first())
      .toMatchObject({ actualCostUsd: null, mediaAssetId: null, processorLeaseId: null })
    await expect(enqueue(child.id!, 'child.exceeds.old.hold', 6)).rejects.toThrow(/预算/)
    await expect(enqueue(child.id!, 'child.within.old.hold', 4)).resolves.toMatchObject({ status: 'queued' })
  }
  expect(transport.request).toHaveBeenCalledTimes(1)
})


async function preparedBranchAuthority() {
  const f = await fixture()
  const parent = (await db.productRuntimeSessions.get(f.sessionId))!
  const events = await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).toArray()
  const state = await readProductRuntimeState(f.sessionId), throughSequence = state.lastSequence
  const initial = await prepareProductRuntimeStateForBranchV1({ parent, state, events, throughSequence })
  initial.lastSequence = 0
  const build = (await db.productBuilds.get(parent.productBuildId!))!
  const child = await preparePreviewProductRuntimeSessionRecordV1({
    projectId: parent.projectId, worldId: parent.worldId!, workId: parent.workId!,
    worldGroupId: parent.worldGroupId, kind: 'ttrpg', title: 'Exact new branch transaction',
    productBuildId: build.id!, expectedPreviewHash: build.previewHash!, runtimeSourceHash: parent.runtimeSourceHash!,
    origin: 'branch', initialState: initial,
    canonSnapshot: await createProductOwnedBranchOriginV1({ parent, state: initial, events, throughSequence }),
  }, { parentSessionId: parent.id!, parentThroughSequence: throughSequence })
  const tables = scopeTransactionTables(...runtimeInstanceTablesV1(),
    ...transactionTablesForReferenceCascade('productRuntimeSessions'))
  return { parent, child, state: initial, throughSequence, events, tables }
}

it('083 consumes projection authority once and cannot rewrite the committed child in a later transaction', async () => {
  const f = await preparedBranchAuthority()
  await db.transaction('rw', f.tables, async () => {
    await insertPreparedProductRuntimeSessionV1(f.child)
    Object.assign(f.child, await finalizeInsertedRuntimeBranchProjectionV1(f))
    await expect(finalizeInsertedRuntimeBranchProjectionV1(f)).rejects.toThrow('原创建事务内完成一次')
  })
  const saved = await db.productRuntimeSessions.get(f.child.id!)
  await db.transaction('rw', f.tables, async () => {
    await expect(finalizeInsertedRuntimeBranchProjectionV1(f)).rejects.toThrow('原创建事务内完成一次')
  })
  expect(await db.productRuntimeSessions.get(f.child.id!)).toEqual(saved)
})

it('083 refuses unused insertion authority after the original transaction commits', async () => {
  const f = await preparedBranchAuthority()
  await db.transaction('rw', f.tables, () => insertPreparedProductRuntimeSessionV1(f.child))
  const saved = await db.productRuntimeSessions.get(f.child.id!)
  await db.transaction('rw', f.tables, async () => {
    await expect(finalizeInsertedRuntimeBranchProjectionV1(f)).rejects.toThrow('原创建事务内完成一次')
  })
  expect(await db.productRuntimeSessions.get(f.child.id!)).toEqual(saved)
})

it('083 rejects changed inserted identity and rolls back the actual new row', async () => {
  const f = await preparedBranchAuthority(), before = await db.productRuntimeSessions.toArray()
  await expect(db.transaction('rw', f.tables, async () => {
    await insertPreparedProductRuntimeSessionV1(f.child)
    f.child.runtimeSourceHash = 'forged-source'
    await db.productRuntimeSessions.update(f.child.id!, { runtimeSourceHash: f.child.runtimeSourceHash })
    await finalizeInsertedRuntimeBranchProjectionV1(f)
  })).rejects.toThrow('新实例、父切点或初始投影已变化')
  expect(await db.productRuntimeSessions.toArray()).toEqual(before)
})

it('083 rejects a non-media projection change at the actual TTRPG adapter before committing the child', async () => {
  const f = await preparedBranchAuthority(), before = await db.productRuntimeSessions.toArray()
  await expect(db.transaction('rw', f.tables, async () => {
    await insertPreparedProductRuntimeSessionV1(f.child)
    f.state.clock += 1
    await cloneTtrpgRuntimePreservedExtensionsV1(f)
  })).rejects.toThrow('分支初态与已验证插入记录不一致')
  expect(await db.productRuntimeSessions.toArray()).toEqual(before)
})
