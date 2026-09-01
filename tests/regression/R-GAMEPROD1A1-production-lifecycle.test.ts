import Dexie from 'dexie'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { carryForwardGameBuildArtifactsAcrossBuildsV1 } from '../../src/lib/game-production/artifact-store'
import { deleteWork } from '../../src/lib/world-engine/lifecycle'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function seedProductionGraph() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'GAMEPROD 生产生命周期', genre: 'interactive-fiction', genres: ['interactive-fiction'],
    status: 'drafting', description: '', targetWordCount: 1, createdAt: now, updatedAt: now,
  } as never) as number
  const ownership = await ensureWorkspaceOwnership(projectId)
  const { worldId, workId } = ownership.scope
  const revisionId = await db.worldRevisions.add({
    projectId, worldId, parentRevisionId: null, revision: 1, label: '来源修订', manifestJson: '{}',
    contentHash: HASH_A, createdAt: now, updatedAt: now,
  }) as number
  const worldReleaseId = await db.worldReleases.add({
    projectId, worldId, revisionId, version: 1, label: '来源发布', manifestJson: '{}',
    contentHash: HASH_A, sourceWorldCode: 'world.gameprod', createdAt: now,
  }) as number
  const productionId = await db.gameProductions.add({
    projectId, worldId, workId, productionKey: 'production.harbor', title: '雾港游戏', status: 'producing',
    stateRevision: 3, controlEpoch: 1, currentBriefRevision: 1, currentBuildNumber: 1,
    currentGameReleaseId: null, lastErrorJson: '{}', createdAt: now, updatedAt: now,
  }) as number
  await db.gameProductionBriefs.add({
    projectId, worldId, workId, productionId, revision: 1, parentRevision: null, status: 'authorized',
    sourceWorldReleaseId: worldReleaseId, sourceWorldContentHash: HASH_A, userIntentSummary: '制作一部雾港互动小说',
    unresolvedJson: '[]', estimateJson: '{}', briefJson: '{}', briefHash: HASH_B, authorizedAt: now, createdAt: now,
  })
  await db.gameProductionCommands.add({
    projectId, worldId, workId, productionId, commandId: 'command.start.1', type: 'authorize-start',
    payloadHash: HASH_C, expectedStateRevision: 2, status: 'succeeded', resultJson: '{}', errorCode: null,
    createdAt: now, completedAt: now,
  })
  const buildId = await db.gameBuilds.add({
    projectId, worldId, workId, productionId, buildNumber: 1, briefRevision: 1, briefHash: HASH_B,
    parentBuildNumber: null, sourceGameReleaseId: null, status: 'building', resumeState: null,
    stateRevision: 2, controlEpoch: 1, planRevision: 1, planJson: '{}', planHash: HASH_A,
    budgetLedgerJson: '{}', manifestJson: '{}', manifestHash: HASH_B, packageHash: '',
    previewManifestJson: '{}', previewHash: '', qualityReportJson: '{}', qualityReportHash: '',
    compatibilityJson: '{}', rootTerminalReceiptHash: null, adoptionIntentHash: null,
    releasedGameReleaseId: null, failureJson: '{}', authorizedAt: now,
    startedAt: now, completedAt: null, createdAt: now, updatedAt: now,
  }) as number
  await db.gameQualityGateReceipts.add({
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
  await db.gameBuildArtifacts.add({
    projectId, worldId, workId, buildId, artifactKey: 'asset.harbor', requirementKey: 'requirement.visual.1',
    version: 1, kind: 'image', mediaKind: 'background', status: 'accepted', producerRunId: null,
    producerReceiptHash: null, controlEpoch: 1, inputHash: HASH_A, contentHash, payloadJson: '{}',
    metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId, mimeType: 'application/octet-stream',
    byteSize: data.byteLength, parentArtifactHash: null, carriedFrom: null, createdAt: now, updatedAt: now,
  })
  return { projectId, worldId, workId, productionId, buildId, worldReleaseId, contentHash, data }
}

describe('R-GAMEPROD-1A1 · v63 production tables and lifecycle', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('v62 升级到 v63 只补 nullable 关联字段且六张新表保持为空', async () => {
    const databaseName = `gameprod-v63-${crypto.randomUUID()}`
    const v62Stores = {
      avgMediaBlobs: '++id, projectId, worldId, workId, &mediaAssetId',
      agentRuns: '++id, projectId, workId, simulationSessionId, status',
      simulationSessions: '++id, projectId, worldId, workId, gameReleaseId, status',
    }
    const legacy = new Dexie(databaseName)
    legacy.version(62).stores(v62Stores)
    await legacy.open()
    await legacy.table('avgMediaBlobs').add({ projectId: 1, worldId: 2, workId: 3, mediaAssetId: 4, data: new ArrayBuffer(0) })
    await legacy.table('agentRuns').add({ projectId: 1, workId: 3, simulationSessionId: null, status: 'planned' })
    await legacy.table('simulationSessions').add({ projectId: 1, worldId: 2, workId: 3, gameReleaseId: null, status: 'active' })
    legacy.close()

    const upgraded = new Dexie(databaseName)
    upgraded.version(62).stores(v62Stores)
    upgraded.version(63).stores({
      gameProductions: '++id, projectId, worldId, workId, &[workId+productionKey]',
      gameProductionBriefs: '++id, projectId, worldId, workId, productionId',
      gameProductionCommands: '++id, projectId, worldId, workId, productionId',
      gameBuilds: '++id, projectId, worldId, workId, productionId',
      gameBuildArtifacts: '++id, projectId, worldId, workId, buildId',
      mediaBlobObjects: '++id, projectId, worldId, workId, &[workId+contentHash]',
      avgMediaBlobs: '++id, projectId, worldId, workId, &mediaAssetId, blobObjectId',
      agentRuns: '++id, projectId, workId, simulationSessionId, gameBuildId, status',
      simulationSessions: '++id, projectId, worldId, workId, gameReleaseId, gameBuildId, runtimeSourceHash, status',
    }).upgrade(async transaction => {
      await transaction.table('avgMediaBlobs').toCollection().modify(row => { row.blobObjectId = null })
      await transaction.table('agentRuns').toCollection().modify(row => { row.gameBuildId = null })
      await transaction.table('simulationSessions').toCollection().modify(row => {
        row.gameBuildId = null
        row.runtimeSourceHash = null
      })
    })
    try {
      await upgraded.open()
      expect(await upgraded.table('avgMediaBlobs').toCollection().first()).toMatchObject({ blobObjectId: null })
      expect(await upgraded.table('agentRuns').toCollection().first()).toMatchObject({ gameBuildId: null })
      expect(await upgraded.table('simulationSessions').toCollection().first()).toMatchObject({
        gameBuildId: null, runtimeSourceHash: null,
      })
      for (const tableName of [
        'gameProductions', 'gameProductionBriefs', 'gameProductionCommands',
        'gameBuilds', 'gameBuildArtifacts', 'mediaBlobObjects',
      ]) expect(await upgraded.table(tableName).count()).toBe(0)
    } finally {
      upgraded.close()
      await Dexie.delete(databaseName)
    }
  })

  it.sequential('六张表随项目严格导出导入，所有本地主键与共享二进制都被重映射', async () => {
    const seeded = await seedProductionGraph()
    const exported = await exportProjectJSON(seeded.projectId)
    expect(exported.gameProductions).toHaveLength(1)
    expect(exported.gameBuildArtifacts?.[0]).toMatchObject({
      _buildExportId: 0,
      _blobObjectExportId: 0,
    })
    expect(exported.gameQualityGateReceipts?.[0]).toMatchObject({ _buildExportId: 0 })
    expect(exported.mediaBlobObjects?.[0].data).toMatch(/^data:application\/octet-stream;base64,/)

    const importedProjectId = await importProjectJSON(exported)
    const [production, brief, command, build, artifact, gateReceipt, blob] = await Promise.all([
      db.gameProductions.where('projectId').equals(importedProjectId).first(),
      db.gameProductionBriefs.where('projectId').equals(importedProjectId).first(),
      db.gameProductionCommands.where('projectId').equals(importedProjectId).first(),
      db.gameBuilds.where('projectId').equals(importedProjectId).first(),
      db.gameBuildArtifacts.where('projectId').equals(importedProjectId).first(),
      db.gameQualityGateReceipts.where('projectId').equals(importedProjectId).first(),
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
    const source = await db.projects.where('name').equals('GAMEPROD 生产生命周期').first()
    const exported = await exportProjectJSON(source!.id!)
    exported.gameBuilds![0]._productionExportId = 999
    const before = await db.projects.count()
    await expect(importProjectJSON(exported)).rejects.toThrow(/缺失必填外键映射/)
    expect(await db.projects.count()).toBe(before)
  })

  it.sequential('跨 Build 只复用已验收 Artifact，错误父链或损坏媒资时事务零写入', async () => {
    const source = await db.projects.where('name').equals('GAMEPROD 生产生命周期').first()
    const ownership = await ensureWorkspaceOwnership(source!.id!)
    const production = await db.gameProductions.where('projectId').equals(source!.id!).first()
    const sourceBuild = await db.gameBuilds.where('productionId').equals(production!.id!).first()
    const sourceArtifact = await db.gameBuildArtifacts.where('buildId').equals(sourceBuild!.id!).first()
    await db.gameBuilds.update(sourceBuild!.id!, { status: 'released', completedAt: Date.now() })
    const { id: _sourceBuildId, ...buildFields } = sourceBuild!
    const targetBuildId = await db.gameBuilds.add({
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

    const carried = await carryForwardGameBuildArtifactsAcrossBuildsV1({
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
    expect(await db.gameBuildArtifacts.get(sourceArtifact!.id!)).toMatchObject({ status: 'accepted' })
    expect(await db.mediaBlobObjects.where('projectId').equals(source!.id!).count()).toBe(1)

    await db.gameBuildArtifacts.delete(carried[0].id!)
    await db.gameBuilds.update(targetBuildId, { parentBuildNumber: 999 })
    await expect(carryForwardGameBuildArtifactsAcrossBuildsV1({
      scope: ownership.scope,
      sourceBuildId: sourceBuild!.id!,
      targetBuildId,
      targetControlEpoch: 2,
      artifactKeys: [sourceArtifact!.artifactKey],
    })).rejects.toThrow(/来源\/目标关系不可复用/)
    expect(await db.gameBuildArtifacts.where('buildId').equals(targetBuildId).count()).toBe(0)

    await db.gameBuilds.update(targetBuildId, { parentBuildNumber: sourceBuild!.buildNumber })
    await db.mediaBlobObjects.update(sourceArtifact!.blobObjectId!, { storageState: 'corrupt' })
    await expect(carryForwardGameBuildArtifactsAcrossBuildsV1({
      scope: ownership.scope,
      sourceBuildId: sourceBuild!.id!,
      targetBuildId,
      targetControlEpoch: 2,
      artifactKeys: [sourceArtifact!.artifactKey],
    })).rejects.toThrow(/媒资对象损坏/)
    expect(await db.gameBuildArtifacts.where('buildId').equals(targetBuildId).count()).toBe(0)
    await db.mediaBlobObjects.update(sourceArtifact!.blobObjectId!, { storageState: 'ready' })
  })

  it.sequential('删除 Work 会清理生产根、Brief、命令、Build、Artifact 与共享媒资', async () => {
    const source = await db.projects.where('name').equals('GAMEPROD 生产生命周期').first()
    const work = await db.works.where('projectId').equals(source!.id!).first()
    await deleteWork(work!.id!)
    for (const table of [
      db.gameProductions, db.gameProductionBriefs, db.gameProductionCommands,
      db.gameBuilds, db.gameBuildArtifacts, db.gameQualityGateReceipts, db.mediaBlobObjects,
    ]) {
      expect(await table.where('projectId').equals(source!.id!).count()).toBe(0)
    }
  })
})
