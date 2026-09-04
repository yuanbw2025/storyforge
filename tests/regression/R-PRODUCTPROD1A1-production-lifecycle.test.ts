import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { carryForwardProductBuildArtifactsAcrossBuildsV1 } from '../../src/lib/product-production/artifact-store'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function seedProductionGraph() {
  const now = Date.now()
  const ownership = await createWorkspace({
    name: 'PRODUCTPROD 生产生命周期',
    genres: ['interactive-fiction'],
    status: 'drafting',
    description: '',
    targetWordCount: 1,
    enableMultiWorld: false,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const { projectId, worldId, workId } = ownership.scope
  const revisionId = await db.worldRevisions.add({
    projectId, worldId, parentRevisionId: null, revision: 1, label: '来源修订', manifestJson: '{}',
    contentHash: HASH_A, createdAt: now, updatedAt: now,
  }) as number
  const worldReleaseId = await db.worldReleases.add({
    projectId, worldId, revisionId, version: 1, label: '来源发布', manifestJson: '{}',
    contentHash: HASH_A, sourceWorldCode: 'world.productprod', createdAt: now,
  }) as number
  const productionId = await db.productProductions.add({
    projectId, worldId, workId, productionKey: 'production.harbor', title: '雾港游戏', status: 'producing',
    productType: 'avg',
    stateRevision: 3, controlEpoch: 1, currentBriefRevision: 1, currentBuildNumber: 1,
    currentProductReleaseId: null, lastErrorJson: '{}', createdAt: now, updatedAt: now,
  }) as number
  await db.productProductionBriefs.add({
    projectId, worldId, workId, productionId, revision: 1, parentRevision: null, status: 'authorized',
    sourceWorldReleaseId: worldReleaseId, sourceWorldContentHash: HASH_A, userIntentSummary: '制作一部雾港互动小说',
    unresolvedJson: '[]', estimateJson: '{}', briefJson: '{}', briefHash: HASH_B,
    sourcePlanJson: '{}', sourcePlanHash: HASH_A,
    confirmedBriefJson: '{}', confirmedBriefHash: HASH_C,
    authorizedAt: now, createdAt: now,
  })
  await db.productProductionCommands.add({
    projectId, worldId, workId, productionId, commandId: 'command.start.1', type: 'authorize-start',
    payloadHash: HASH_C, expectedStateRevision: 2, status: 'succeeded', resultJson: '{}', errorCode: null,
    createdAt: now, completedAt: now,
  })
  const buildId = await db.productBuilds.add({
    projectId, worldId, workId, productionId, buildNumber: 1, briefRevision: 1, briefHash: HASH_B,
    parentBuildNumber: null, sourceProductReleaseId: null, status: 'building', resumeState: null,
    stateRevision: 2, controlEpoch: 1, planRevision: 1, planJson: '{}', planHash: HASH_A,
    budgetLedgerJson: '{}', manifestJson: '{}', manifestHash: HASH_B, packageHash: '',
    previewManifestJson: '{}', previewHash: '', qualityReportJson: '{}', qualityReportHash: '',
    compatibilityJson: '{}', rootTerminalReceiptHash: null, adoptionIntentHash: null,
    releasedProductReleaseId: null, failureJson: '{}', authorizedAt: now,
    startedAt: now, completedAt: null, createdAt: now, updatedAt: now,
  }) as number
  await db.productQualityGateReceipts.add({
    projectId, worldId, workId, buildId, gateId: 'browser.performance.desktop', gateVersion: '1',
    verifierId: 'storyforge.playwright-browser-runtime', verifierVersion: '1', status: 'failed',
    receiptJson: '{}', receiptHash: HASH_C, createdAt: now,
  })
  const data = new Uint8Array([83, 70, 45, 71, 65, 77, 69]).buffer
  const contentHash = await sha256(data)
  const blobObjectId = await db.mediaBlobObjects.add({
    projectId, worldId, workId, contentHash, mimeType: 'application/octet-stream', byteSize: data.byteLength,
    backend: 'indexeddb', storageState: 'ready', data, opfsPath: null, leaseOwner: null,
    leaseExpiresAt: null, lastVerifiedAt: now, createdAt: now, updatedAt: now,
  }) as number
  await db.productBuildArtifacts.add({
    projectId, worldId, workId, buildId, artifactKey: 'asset.harbor', requirementKey: 'requirement.visual.1',
    version: 1, kind: 'image', mediaKind: 'background', status: 'accepted', producerRunId: null,
    producerReceiptHash: null, controlEpoch: 1, inputHash: HASH_A, contentHash, payloadJson: '{}',
    metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId, mimeType: 'application/octet-stream',
    byteSize: data.byteLength, parentArtifactHash: null, carriedFrom: null, createdAt: now, updatedAt: now,
  })
  return { projectId, worldId, workId, productionId, buildId, worldReleaseId, contentHash, data }
}

describe('R-PRODUCTPROD-1A1 · current product-production lifecycle', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it.sequential('六张表随项目严格导出导入，所有本地主键与共享二进制都被重映射', async () => {
    const seeded = await seedProductionGraph()
    const exported = await exportProjectJSON(seeded.projectId)
    expect(exported.productProductions).toHaveLength(1)
    expect(exported.productBuildArtifacts?.[0]).toMatchObject({
      _buildExportId: 0,
      _blobObjectExportId: 0,
    })
    expect(exported.productQualityGateReceipts?.[0]).toMatchObject({ _buildExportId: 0 })
    expect(exported.mediaBlobObjects?.[0].data).toMatch(/^data:application\/octet-stream;base64,/)

    const importedProjectId = await importProjectJSON(exported)
    const [production, brief, command, build, artifact, gateReceipt, blob] = await Promise.all([
      db.productProductions.where('projectId').equals(importedProjectId).first(),
      db.productProductionBriefs.where('projectId').equals(importedProjectId).first(),
      db.productProductionCommands.where('projectId').equals(importedProjectId).first(),
      db.productBuilds.where('projectId').equals(importedProjectId).first(),
      db.productBuildArtifacts.where('projectId').equals(importedProjectId).first(),
      db.productQualityGateReceipts.where('projectId').equals(importedProjectId).first(),
      db.mediaBlobObjects.where('projectId').equals(importedProjectId).first(),
    ])
    expect(brief?.productionId).toBe(production?.id)
    expect(command?.productionId).toBe(production?.id)
    expect(build?.productionId).toBe(production?.id)
    expect(artifact?.buildId).toBe(build?.id)
    expect(gateReceipt?.buildId).toBe(build?.id)
    expect(artifact?.blobObjectId).toBe(blob?.id)
    expect(blob).toMatchObject({
      backend: 'indexeddb', storageState: 'ready', contentHash: seeded.contentHash,
      leaseOwner: null, leaseExpiresAt: null,
    })
    expect(Array.from(new Uint8Array(blob!.data!))).toEqual(Array.from(new Uint8Array(seeded.data)))
  })

  it.sequential('损坏的必填生产外键使整个导入事务零写入', async () => {
    const source = await db.projects.where('name').equals('PRODUCTPROD 生产生命周期').first()
    const exported = await exportProjectJSON(source!.id!)
    exported.productBuilds![0]._productionExportId = 999
    const before = await db.projects.count()
    await expect(importProjectJSON(exported)).rejects.toThrow(/生产引用越界|缺失必填外键映射/)
    expect(await db.projects.count()).toBe(before)
  })

  it.sequential('跨 Build 只复用已验收 Artifact，错误父链或损坏媒资时事务零写入', async () => {
    const source = await db.projects.where('name').equals('PRODUCTPROD 生产生命周期').first()
    const ownership = await resolveWorkspaceOwnership(source!.id!)
    const production = await db.productProductions.where('projectId').equals(source!.id!).first()
    const sourceBuild = await db.productBuilds.where('productionId').equals(production!.id!).first()
    const sourceArtifact = await db.productBuildArtifacts.where('buildId').equals(sourceBuild!.id!).first()
    await db.productBuilds.update(sourceBuild!.id!, { status: 'released', completedAt: Date.now() })
    const { id: _sourceBuildId, ...buildFields } = sourceBuild!
    const targetBuildId = await db.productBuilds.add({
      ...buildFields,
      buildNumber: 2,
      parentBuildNumber: sourceBuild!.buildNumber,
      status: 'authorized',
      controlEpoch: 2,
      stateRevision: 1,
      planRevision: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }) as number

    const carried = await carryForwardProductBuildArtifactsAcrossBuildsV1({
      scope: ownership.scope,
      sourceBuildId: sourceBuild!.id!,
      targetBuildId,
      targetControlEpoch: 2,
      artifactKeys: [sourceArtifact!.artifactKey],
    })
    expect(carried).toHaveLength(1)
    expect(carried[0]).toMatchObject({
      buildId: targetBuildId,
      status: 'carried-forward',
      contentHash: sourceArtifact!.contentHash,
      blobObjectId: sourceArtifact!.blobObjectId,
      parentArtifactHash: sourceArtifact!.contentHash,
    })
    expect(await db.productBuildArtifacts.get(sourceArtifact!.id!)).toMatchObject({ status: 'accepted' })
    expect(await db.mediaBlobObjects.where('projectId').equals(source!.id!).count()).toBe(1)

    await db.productBuildArtifacts.delete(carried[0].id!)
    await db.productBuilds.update(targetBuildId, { parentBuildNumber: 999 })
    await expect(carryForwardProductBuildArtifactsAcrossBuildsV1({
      scope: ownership.scope,
      sourceBuildId: sourceBuild!.id!,
      targetBuildId,
      targetControlEpoch: 2,
      artifactKeys: [sourceArtifact!.artifactKey],
    })).rejects.toThrow(/来源\/目标关系不可复用/)
    expect(await db.productBuildArtifacts.where('buildId').equals(targetBuildId).count()).toBe(0)

    await db.productBuilds.update(targetBuildId, { parentBuildNumber: sourceBuild!.buildNumber })
    await db.mediaBlobObjects.update(sourceArtifact!.blobObjectId!, { storageState: 'corrupt' })
    await expect(carryForwardProductBuildArtifactsAcrossBuildsV1({
      scope: ownership.scope,
      sourceBuildId: sourceBuild!.id!,
      targetBuildId,
      targetControlEpoch: 2,
      artifactKeys: [sourceArtifact!.artifactKey],
    })).rejects.toThrow(/媒资对象损坏/)
    expect(await db.productBuildArtifacts.where('buildId').equals(targetBuildId).count()).toBe(0)
    await db.mediaBlobObjects.update(sourceArtifact!.blobObjectId!, { storageState: 'ready' })
  })

  it.sequential('删除 Work 会清理生产根、Brief、命令、Build、Artifact 与共享媒资', async () => {
    const source = await db.projects.where('name').equals('PRODUCTPROD 生产生命周期').first()
    const work = await db.works.where('projectId').equals(source!.id!).first()
    await deleteWork(work!.id!)
    for (const table of [
      db.productProductions, db.productProductionBriefs, db.productProductionCommands,
      db.productBuilds, db.productBuildArtifacts, db.productQualityGateReceipts, db.mediaBlobObjects,
    ]) {
      expect(await table.where('projectId').equals(source!.id!).count()).toBe(0)
    }
  })
})
