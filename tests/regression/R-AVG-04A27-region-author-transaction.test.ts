import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie, { type Transaction } from 'dexie'
import { db } from '../../src/lib/db/schema'
import type { ProductBuildArtifactRecordV1 } from '../../src/lib/types'
import { putMediaBlobObject } from '../../src/lib/product-production/media-blob-store'
import * as mediaBlobs from '../../src/lib/product-production/media-blob-store'
import { inspectAvgProcessedImageBytesV1 } from '../../src/lib/avg/image-processing-source'
import { prepareNativeAvgAssembly, startNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { avgRegionProcessedFixture } from '../helpers/avg-region-processed-fixture'
import { avgProfessionalFamilyScopeFixtureV4 } from '../helpers/avg-professional-family-scope-fixture'

const api = vi.hoisted(() => ({ read: vi.fn(), verify: vi.fn(), decode: vi.fn() }))
vi.mock('../../src/lib/avg/image-region-composite-source', () => ({ readAvgRegionCompositeInputsV1: api.read }))
vi.mock('../../src/lib/avg/image-region-composite-worker-client', () => ({ verifyAvgRegionCompositeWorkerV1: api.verify }))
vi.mock('../../src/lib/avg/image-decoder', () => ({ inspectAvgImageBytesV1: api.decode }))
beforeEach(async () => { await db.delete(); await db.open(); api.read.mockReset(); api.verify.mockReset(); api.decode.mockReset() })
afterEach(async () => { vi.restoreAllMocks(); db.close(); await db.delete() })

describe('V3 image observation inside the author rw transaction', () => {
  it('reads source tables in the held transaction and leaves it only for pure pixel verification, without deadlock or artifact writes', async () => {
    const owner = await startNativeAvgAssembly(await prepareNativeAvgAssembly()), f = await avgRegionProcessedFixture()
    const blob = await putMediaBlobObject({ scope: owner.scope, data: f.result.data, mimeType: 'image/png', expectedContentHash: f.result.receipt.output.contentHash })
    const now = Date.now(), payload = f.payload, build = owner.details.build!
    // Scalar carriers only: the byte inspector relies on its caller's prior
    // producer validation. This test grants neither producer nor adoption.
    const raw: ProductBuildArtifactRecordV1 = { projectId: owner.scope.projectId!, worldId: owner.scope.worldId!, workId: owner.scope.workId!,
      buildId: owner.buildId, artifactKey: payload.raw.artifactKey, requirementKey: null, version: payload.raw.version, kind: 'image', mediaKind: 'character-expression', status: 'accepted',
      producerRunId: null, producerReceiptHash: payload.raw.producerReceiptHash, controlEpoch: build.controlEpoch, inputHash: 'a'.repeat(64), contentHash: payload.raw.contentHash,
      payloadJson: '{}', metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null, mimeType: 'image/png', byteSize: payload.sourceAsset.byteSize,
      parentArtifactHash: null, carriedFrom: null, createdAt: now, updatedAt: now }
    const processed: ProductBuildArtifactRecordV1 = { ...raw, artifactKey: `avg.media.processed.${payload.requirementKey}`, contentHash: blob.contentHash,
      blobObjectId: blob.id!, byteSize: blob.byteSize, qualityJson: JSON.stringify({ processingReceiptHash: payload.receipt.receiptHash,
        rawProducerReceiptHash: raw.producerReceiptHash, noProviderRequest: true, decoderVerified: true }) }
    const asset = { ...payload.sourceAsset, version: 2, contentHash: blob.contentHash, blobContentHash: blob.contentHash, byteSize: blob.byteSize }
    const template = avgProfessionalFamilyScopeFixtureV4().planning.templates.find(t => t.parameters.mediaKind === 'character-expression')!
    const requirement = { ...template.parameters, requirementKey: payload.requirementKey, prompt: 'Synthetic transaction input', negativePrompt: 'None', invariants: [], forbiddenDepictions: [] }
    let held: Transaction | undefined
    api.read.mockImplementation(async () => {
      expect(Dexie.currentTransaction).toBe(held)
      // This real IDB get would wait on our rw lock if the whole proof left
      // the transaction, reproducing the native author-review deadlock.
      expect((await db.productBuilds.get(owner.buildId))!.id).toBe(owner.buildId)
      return { evidence: payload.inputEvidence, input: { ...f.pixels, inputProof: payload.receipt.inputProof } }
    })
    api.verify.mockImplementation(async () => { expect(Dexie.currentTransaction).toBeFalsy(); return payload.receipt })
    api.decode.mockImplementation(async () => { expect(Dexie.currentTransaction).toBeFalsy(); return { width: 64, height: 64, hasAlpha: true } })
    const readBytes=mediaBlobs.readVerifiedMediaBlobObjectData
    const io=vi.spyOn(mediaBlobs,'readVerifiedMediaBlobObjectData').mockImplementation(async row=>{
      expect(Dexie.currentTransaction).toBeFalsy()
      // OPFS has asynchronous file I/O before hashing; the caller must keep
      // the author transaction alive without moving any DB reads out.
      await new Promise(resolve=>setTimeout(resolve,10));return readBytes(row)
    })
    const before = { artifacts: await db.productBuildArtifacts.count(), runs: await db.agentRuns.count(), blobs: await db.mediaBlobObjects.count() }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const observed = await db.transaction('rw', db.tables, async () => {
        held = Dexie.currentTransaction; timer = setTimeout(() => held!.abort(), 2000)
        return inspectAvgProcessedImageBytesV1({ scope: owner.scope, raw, processed, image: { payload, asset, requirement } })
      })
      expect(observed.measured).toEqual({ width: 64, height: 64, hasAlpha: true })
    } finally { clearTimeout(timer) }
    expect(api.read).toHaveBeenCalledTimes(1); expect(api.verify).toHaveBeenCalledTimes(1); expect(io).toHaveBeenCalledTimes(2)
    expect({ artifacts: await db.productBuildArtifacts.count(), runs: await db.agentRuns.count(), blobs: await db.mediaBlobObjects.count() }).toEqual(before)
  }, 10_000)
})
