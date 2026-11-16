import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTtrpgMediaUrls } from '../../src/components/ttrpg/useTtrpgMediaUrls'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import type { MediaProviderTransportV1 } from '../../src/lib/product-production/media-adapters'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { loadTtrpgRuntimeContentV1 } from '../../src/lib/ttrpg/runtime-content'
import { readTtrpgRuntimeMediaBlobV1 } from '../../src/lib/ttrpg/runtime-media'
import { createTtrpgViewerProjectionV1 } from '../../src/lib/ttrpg/viewer-projection'
import { GM, SLOT, seedTtrpgRuntimeMediaAttemptFixtureV1 as fixture } from '../helpers/current-ttrpg-runtime-media-attempt'

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMw6775HwAFLwKaNEqhXwAAAABJRU5ErkJggg=='), ch => ch.charCodeAt(0)).buffer

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

it('037 restored TTRPG viewer and actual media hook resolve exact owned Blob without leaking replay local ID', async () => {
  const f = await fixture()
  const contentHash = await sha256MediaData(png)
  const transport: MediaProviderTransportV1 = {
    executionLocation: 'browser-direct',
    request: async wire => ({ status: 200, contentType: 'image/png', body: png,
      json: { packId: 'sfqa037', packVersion: 1, artifactKey: wire.body.artifactKey,
        fileName: 'isolated.png', declaredContentHash: contentHash, mimeType: 'image/png', width: 1, height: 1,
        title: 'Isolated replay', altText: 'Synthetic image', license: 'CC0-1.0', commercialUse: false, source: 'synthetic' },
      providerRequestId: 'sfqa037.receipt.0', usage: null, costUsd: 0 }),
  }
  const accepted = await f.execute(transport)
  expect(accepted.status).toBe('available')
  const originalHead = await readProductRuntimeStateVersion(f.sessionId)
  const mediaEvent = (await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).toArray())
    .find(row => row.type === 'ttrpg.media.available')!
  const wire = await exportProjectJSON(f.scope.projectId)
  const imported = await importProjectJSON(wire)
  const restored = (await db.ttrpgRuntimeAssetRequests.where('projectId').equals(imported).first())!
  const sessionId = restored.sessionId
  const scope = { projectId: restored.projectId, worldId: restored.worldId, workId: restored.workId }
  const restoredEvent = (await db.productRuntimeEvents.where('sessionId').equals(sessionId).toArray())
    .find(row => row.type === 'ttrpg.media.available')!
  expect(restoredEvent).toMatchObject({
    sequence: mediaEvent.sequence, payloadJson: mediaEvent.payloadJson,
  })
  expect(restoredEvent.baseStateHash).toBe(mediaEvent.baseStateHash)
  const state = await readProductRuntimeState(sessionId)
  const content = await loadTtrpgRuntimeContentV1({ scope, productRuntimeSessionId: sessionId })
  const { media } = createTtrpgViewerProjectionV1({ state, campaign: content.campaign, rulePack: content.rulePack, role: 'gm' })
  const slot = media?.slots.find(row => row.slotKey === SLOT)
  const raw = state.ttrpg?.product.media.slots.find(row => row.slotKey === SLOT)
  expect(restored.mediaAssetId).not.toBe(accepted.mediaAssetId)
  expect(raw?.mediaAssetId).toBe(accepted.mediaAssetId)
  expect((await readProductRuntimeStateVersion(sessionId)).stateHash).toBe(originalHead.stateHash)
  const blob = await readTtrpgRuntimeMediaBlobV1({ scope, sessionId, viewerKey: GM, mediaAssetId: raw!.mediaAssetId! })
  expect(await blob.arrayBuffer()).toEqual(png)
  expect(slot).not.toHaveProperty('mediaAssetId')
  expect(slot?.runtimeAsset).toEqual({
    slotKey: SLOT, requestKey: restored.requestKey, assetKey: raw?.assetKey,
    version: restored.mediaAssetVersion, contentHash,
  })
  const ref = slot!.runtimeAsset!
  const stable = { scope, sessionId, viewerKey: GM, runtimeAsset: ref }
  const assets = vi.spyOn(db.productMediaAssets, 'get')
  let delivered!: () => void
  const loaded = new Promise<void>(resolve => { delivered = resolve })
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    delivered()
    return 'blob:isolated-sfqa037'
  })
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  function Viewer() {
    const urls = useTtrpgMediaUrls({ scope, sessionId, source: content.source, viewerKey: GM, media })
    return urls[SLOT] ? createElement('img', { src: urls[SLOT] }) : null
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () => { root.render(createElement(Viewer)) })
    await act(async () => { await loaded })
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:isolated-sfqa037')
    expect(assets).toHaveBeenCalledWith(restored.mediaAssetId)
    expect(assets).not.toHaveBeenCalledWith(accepted.mediaAssetId)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png', size: png.byteLength }))
  } finally {
    await act(async () => { root.unmount() })
  }
  expect(revoke).toHaveBeenCalledWith('blob:isolated-sfqa037')

  await expect(readTtrpgRuntimeMediaBlobV1({ ...stable, scope: f.scope })).rejects.toThrow(/不能读取/)
  await expect(readTtrpgRuntimeMediaBlobV1({ ...stable, viewerKey: 'foreign.viewer' })).rejects.toThrow(/viewer/)
  for (const wrong of [
    { slotKey: 'wrong.slot' }, { requestKey: 'wrong.request' }, { assetKey: 'wrong.asset' },
    { version: ref.version + 1 }, { contentHash: '0'.repeat(64) },
  ]) await expect(readTtrpgRuntimeMediaBlobV1({ ...stable, runtimeAsset: { ...ref, ...wrong } })).rejects.toThrow(/不能读取/)
  await db.ttrpgRuntimeAssetRequests.delete(restored.id!)
  await expect(readTtrpgRuntimeMediaBlobV1(stable)).rejects.toThrow(/不能读取/)
  expect((await readProductRuntimeStateVersion(sessionId)).stateHash).toBe(originalHead.stateHash)

  await db.delete(); await db.open()
  const fresh = await importProjectJSON(wire)
  const freshRequest = (await db.ttrpgRuntimeAssetRequests.where('projectId').equals(fresh).first())!
  const freshScope = { projectId: freshRequest.projectId, worldId: freshRequest.worldId, workId: freshRequest.workId }
  const freshBlob = await readTtrpgRuntimeMediaBlobV1({ ...stable, scope: freshScope, sessionId: freshRequest.sessionId })
  expect(await freshBlob.arrayBuffer()).toEqual(png)
})
