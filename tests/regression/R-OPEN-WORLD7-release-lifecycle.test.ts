import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import {
  branchTextOpenWorldSessionFromCheckpointV1,
  createTextOpenWorldCheckpointV1,
  inspectTextOpenWorldCheckpointV1,
} from '../../src/lib/open-world/checkpoints'
import { verifyTextOpenWorldVNextSessionBindingV1 } from '../../src/lib/open-world/session-binding'
import { acceptTextOpenWorldSourcePinBundleV1 } from '../../src/lib/open-world/source-pin'
import {
  putMediaBlobObject,
  readProductMediaBlobData,
} from '../../src/lib/product-production/media-blob-store'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import {
  type ProductQualityGateReceiptV1,
  verifyProductQualityGateReceiptRecordV1,
} from '../../src/lib/product-production/quality-receipts'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import { deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { assertProductReleaseUnchanged } from '../../src/lib/product/releases'
import type { ProductMediaAsset, ProductMediaBlob, ProductRelease } from '../../src/lib/types'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { createTextOpenWorldCreatorReleaseFixtureV1 } from '../helpers/text-open-world-creator-release'

function bytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer
}

async function seedPublishedCreatorWorkspace() {
  const fixture = await createTextOpenWorldCreatorReleaseFixtureV1('world-release')
  await acceptTextOpenWorldSourcePinBundleV1({
    scope: fixture.scope,
    buildId: fixture.creator.buildId,
    controlEpoch: fixture.creator.controlEpoch,
    bundle: fixture.pinBundle,
  })
  const now = Date.now()
  const release: ProductRelease = {
    ...fixture.scope,
    productionKey: fixture.creator.productionKey,
    productType: 'text-open-world',
    worldReleaseId: fixture.localWorldReleaseId,
    version: 1,
    label: fixture.releaseAuthorization.releaseLabel,
    manifestJson: JSON.stringify(fixture.manifest),
    contentHash: await hashProductProductionValueV2(fixture.manifest),
    createdAt: now,
  }
  release.id = await db.productReleases.add(release) as number
  await db.productBuilds.update(fixture.creator.buildId, {
    status: 'released',
    manifestHash: fixture.manifest.productionProvenance.buildManifestHash,
    packageHash: fixture.manifest.packageHash,
    rootTerminalReceiptHash: fixture.manifest.productionProvenance.rootTerminalReceiptHash,
    releasedProductReleaseId: release.id,
    completedAt: now,
    updatedAt: now,
  })
  await db.productProductions.update(fixture.creator.productionId, {
    status: 'released',
    currentProductReleaseId: release.id,
    updatedAt: now,
  })
  const session = await createTextOpenWorldInstance({
    scope: fixture.scope,
    productReleaseId: release.id,
    title: 'G7-12 正式旅程',
    seed: 'g7-12-release-lifecycle',
  })

  const measuredJson = canonicalProductProductionJsonV2({
    schema: 'storyforge.text-open-world-release-lifecycle-evidence',
    version: 1,
    packageHash: fixture.manifest.packageHash,
    summary: '正式发布闭包已通过全生命周期验收。',
  })
  const receiptBody: Omit<ProductQualityGateReceiptV1, 'receiptHash'> = {
    schema: 'storyforge.product-quality-gate-receipt',
    version: 1,
    gateId: 'text-open-world.release-lifecycle',
    gateVersion: '1',
    verifierId: 'storyforge.text-open-world-release-lifecycle',
    verifierVersion: '1',
    verifierKind: 'deterministic',
    inputHashes: [fixture.manifest.packageHash],
    environmentHash: null,
    measuredJson,
    status: 'passed',
    thresholdProfileId: 'storyforge.text-open-world-release-lifecycle.v1',
    thresholdProfileVersion: '1',
    evidenceRefs: ['tests/regression/R-OPEN-WORLD7-release-lifecycle.test.ts'],
    createdAt: now + 1,
  }
  const receipt: ProductQualityGateReceiptV1 = {
    ...receiptBody,
    receiptHash: await hashProductProductionValueV2(receiptBody),
  }
  await db.productQualityGateReceipts.add(stampNewRecord(fixture.scope, 'productQualityGateReceipts', {
    ...fixture.scope,
    buildId: fixture.creator.buildId,
    gateId: receipt.gateId,
    gateVersion: receipt.gateVersion,
    verifierId: receipt.verifierId,
    verifierVersion: receipt.verifierVersion,
    status: receipt.status,
    receiptJson: canonicalProductProductionJsonV2(receipt),
    receiptHash: receipt.receiptHash,
    createdAt: receipt.createdAt,
  }, { owner: 'work' }))

  const mediaData = bytes('text-open-world-g7-12-release-map')
  const blobObject = await putMediaBlobObject({
    scope: fixture.scope,
    data: mediaData,
    mimeType: 'image/png',
    backend: 'indexeddb',
  })
  const mediaAssetId = await db.productMediaAssets.add(stampNewRecord(fixture.scope, 'productMediaAssets', {
    ...fixture.scope,
    ownerKind: 'release',
    productType: 'text-open-world',
    productReleaseId: release.id,
    productRuntimeSessionId: null,
    assetKey: 'map.release.g7-12',
    version: 1,
    kind: 'ui',
    name: 'G7-12 发布地图',
    mimeType: blobObject.mimeType,
    byteSize: blobObject.byteSize,
    width: 64,
    height: 64,
    durationMs: null,
    contentHash: blobObject.contentHash,
    source: 'deterministic-test-fixture',
    license: 'test-only',
    altText: '盐脊发布地图',
    characterTag: '',
    sceneTag: 'region.salt-ridge',
    createdAt: now + 2,
    updatedAt: now + 2,
  } satisfies ProductMediaAsset, { owner: 'work' })) as number
  await db.productMediaBlobs.add(stampNewRecord(fixture.scope, 'productMediaBlobs', {
    ...fixture.scope,
    mediaAssetId,
    blobObjectId: blobObject.id!,
    data: null,
    createdAt: now + 2,
  } satisfies ProductMediaBlob, { owner: 'work' }))

  await executeTextOpenWorldActionV1({
    sessionId: session.id!,
    actionKey: 'action.investigate-channel',
    targetKey: 'location.salt-port',
    commandId: 'command.g7-12.investigate',
    requestedAt: now + 3,
  })
  const checkpoint = await createTextOpenWorldCheckpointV1({
    sessionId: session.id!,
    name: 'G7-12 调查完成',
  })
  const branch = await branchTextOpenWorldSessionFromCheckpointV1({
    checkpointId: checkpoint.id!,
    title: 'G7-12 检查点分支',
    seed: 'g7-12-branch',
  })
  return { fixture, release, session, checkpoint, branch, receipt, mediaData, blobObject }
}

describe('TOW-G7-12 · 正式发布数据全生命周期', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('当前v10备份完整重映射Release、质量回执、媒资字节、事件、检查点和分支', async () => {
    const seeded = await seedPublishedCreatorWorkspace()
    const backup = await exportProjectJSON(seeded.fixture.scope.projectId)
    expect(backup.version).toBe(10)
    expect(backup.productQualityGateReceipts).toHaveLength(1)
    expect(backup.productMediaAssets).toHaveLength(1)
    expect(backup.productMediaBlobs).toHaveLength(1)
    expect(backup.mediaBlobObjects).toHaveLength(1)
    expect(backup.productRuntimeSessions).toHaveLength(2)
    expect(backup.productRuntimeCheckpoints).toHaveLength(1)
    expect(backup.mediaBlobObjects[0]!.data).toMatch(/^data:image\/png;base64,/)

    const importedProjectId = await importProjectJSON(structuredClone(backup))
    const importedOwnership = await resolveWorkspaceOwnership(importedProjectId)
    const importedBuild = await db.productBuilds.where('projectId').equals(importedProjectId).first()
    const importedRelease = await db.productReleases.where('projectId').equals(importedProjectId).first()
    const importedReceipt = await db.productQualityGateReceipts.where('projectId').equals(importedProjectId).first()
    const importedAsset = await db.productMediaAssets.where('projectId').equals(importedProjectId).first()
    const importedBlob = await db.productMediaBlobs.where('projectId').equals(importedProjectId).first()
    const sessions = await db.productRuntimeSessions.where('projectId').equals(importedProjectId).toArray()
    const importedParent = sessions.find(item => item.parentSessionId == null)!
    const importedBranch = sessions.find(item => item.parentSessionId != null)!
    const importedCheckpoint = await db.productRuntimeCheckpoints.where('projectId').equals(importedProjectId).first()

    expect(importedRelease).toMatchObject({
      worldId: importedOwnership.scope.worldId,
      workId: importedOwnership.scope.workId,
      contentHash: seeded.release.contentHash,
    })
    expect(importedReceipt).toMatchObject({
      buildId: importedBuild?.id,
      receiptHash: seeded.receipt.receiptHash,
    })
    await expect(verifyProductQualityGateReceiptRecordV1(importedReceipt!))
      .resolves.toMatchObject({ gateId: seeded.receipt.gateId, status: 'passed' })
    expect(importedAsset).toMatchObject({
      productReleaseId: importedRelease?.id,
      productRuntimeSessionId: null,
      ownerKind: 'release',
      contentHash: seeded.blobObject.contentHash,
    })
    expect(importedBlob).toMatchObject({ mediaAssetId: importedAsset?.id })
    await expect(readProductMediaBlobData({
      scope: importedOwnership.scope,
      blob: importedBlob!,
      expected: {
        contentHash: importedAsset!.contentHash,
        byteSize: importedAsset!.byteSize,
        mimeType: importedAsset!.mimeType,
      },
    })).resolves.toEqual(seeded.mediaData)
    expect(importedBranch).toMatchObject({
      parentSessionId: importedParent.id,
      parentThroughSequence: importedCheckpoint?.throughSequence,
      productReleaseId: importedRelease?.id,
    })
    expect(importedCheckpoint).toMatchObject({ sessionId: importedParent.id })
    await expect(inspectTextOpenWorldCheckpointV1(importedCheckpoint!.id!))
      .resolves.toMatchObject({ valid: true, code: 'valid' })
    await expect(assertProductReleaseUnchanged(importedRelease!.id!)).resolves.toBeDefined()
    await expect(verifyTextOpenWorldVNextSessionBindingV1(importedParent)).resolves.toBeDefined()

    await deleteProductRuntimeSession(importedBranch.id!)
    expect(await db.productRuntimeSessions.get(importedParent.id!)).toBeDefined()
    expect(await db.productReleases.get(importedRelease!.id!)).toBeDefined()

    const importedWorldReleaseIds = (await db.worldReleases.where('projectId').equals(importedProjectId).toArray())
      .map(item => item.id!)
    await deleteWork(importedOwnership.scope.workId)
    for (const table of [
      db.productProductions,
      db.productProductionBriefs,
      db.productProductionCommands,
      db.productBuilds,
      db.productBuildArtifacts,
      db.productQualityGateReceipts,
      db.productReleases,
      db.productRuntimeSessions,
      db.productRuntimeEvents,
      db.productRuntimeCheckpoints,
      db.productMediaAssets,
      db.productMediaBlobs,
      db.mediaBlobObjects,
    ]) expect(await table.where('projectId').equals(importedProjectId).count()).toBe(0)
    for (const worldReleaseId of importedWorldReleaseIds) {
      expect(await db.worldReleases.get(worldReleaseId)).toBeDefined()
    }
  }, 120_000)

  it('质量回执、媒资字节、检查点或备份版本被篡改时不留下任何导入项目', async () => {
    const seeded = await seedPublishedCreatorWorkspace()
    const backup = await exportProjectJSON(seeded.fixture.scope.projectId)
    const before = await db.projects.count()

    const receiptTampered = structuredClone(backup)
    receiptTampered.productQualityGateReceipts[0]!.receiptHash = 'f'.repeat(64)
    await expect(importProjectJSON(receiptTampered))
      .rejects.toThrow(/ProductQualityGateReceipt 内容或Hash无效/)
    expect(await db.projects.count()).toBe(before)

    const mediaTampered = structuredClone(backup)
    const dataUrl = mediaTampered.mediaBlobObjects[0]!.data as unknown as string
    mediaTampered.mediaBlobObjects[0]!.data = `${dataUrl.slice(0, -4)}AAAA` as never
    await expect(importProjectJSON(mediaTampered)).rejects.toThrow(/二进制(大小|哈希)与记录不一致/)
    expect(await db.projects.count()).toBe(before)

    const checkpointTampered = structuredClone(backup)
    const state = JSON.parse(checkpointTampered.productRuntimeCheckpoints[0]!.stateJson)
    state.clock = Number(state.clock ?? 0) + 1
    checkpointTampered.productRuntimeCheckpoints[0]!.stateJson = JSON.stringify(state)
    await expect(importProjectJSON(checkpointTampered)).rejects.toThrow(/ProductRuntimeCheckpoint Hash 不匹配/)
    expect(await db.projects.count()).toBe(before)

    const oldVersion = structuredClone(backup)
    oldVersion.version = 9
    await expect(importProjectJSON(oldVersion)).rejects.toThrow(/只接受当前备份版本 v10/)
    expect(await db.projects.count()).toBe(before)
  }, 120_000)
})
