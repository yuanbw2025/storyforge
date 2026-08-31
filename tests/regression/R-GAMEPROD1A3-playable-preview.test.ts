import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { publishAvgGame, seedAvgAcceptanceGame } from '../../src/lib/avg/authoring'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { hashGameProductionValueV2 } from '../../src/lib/game-production/hash'
import { createGameBuildPreviewManifestV1, verifyGameBuildPreviewManifestV1 } from '../../src/lib/game-production/preview-manifest'
import { resolvePlayableGameSource } from '../../src/lib/game-production/preview-source'
import { createGameReleaseManifestV2, gameRuntimePackageFromReleaseV1 } from '../../src/lib/game-production/runtime-package'
import { parseAnyGameReleaseManifest } from '../../src/lib/text-game/releases'
import { branchSimulationSession, readSimulationState } from '../../src/lib/simulation/runtime'
import type { GameBuildRecordV1, GameRuntimePackageV2, WorkspaceScope, WorldRelease } from '../../src/lib/types'
import { assertInstanceBinding, createPlayableGameInstance } from '../../src/lib/world-engine/instances'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

async function workspace(name: string) {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspacePurpose: 'world-engine', workspacePurposeDecision: 'explicit',
    name, genre: 'interactive-fiction', genres: ['interactive-fiction'], status: 'drafting',
    description: '', targetWordCount: 1, createdAt: now, updatedAt: now,
  } as never) as number
  return ensureWorkspaceOwnership(projectId)
}

function storyPackage(worldContentHash: string): GameRuntimePackageV2 {
  return {
    schema: 'storyforge.game-runtime-package',
    version: 2,
    productType: 'storygame',
    definition: {
      gameKey: 'preview.story', title: '可玩预览', description: '', enabledCapabilities: ['narrative'],
      rulesetVersion: 1, initialVariables: {},
    },
    sourceWorld: {
      contentHash: worldContentHash,
      selection: {
        schema: 'storyforge.world-game-source', version: 2, productType: 'storygame',
        worldContentHash, narrativeModuleExportIds: [], characterExportIds: [], characterRelationExportIds: [],
        importantLocationExportIds: [], artifactExportIds: [], codexEntryExportIds: [], storyArcExportIds: [],
        avgMediaAssetExportIds: [], productSource: { kind: 'storygame', narrativeModuleExportIds: [] },
      },
    },
    narrative: {
      moduleKind: 'main', moduleTitle: '预览短篇', entryNodeKey: 'ending.preview',
      nodes: [{
        key: 'ending.preview', kind: 'ending', title: '抵达', summary: '', conditionJson: '{}',
        effectsJson: '[]', successorKeys: [],
      }],
      beats: [{
        beatKey: 'beat.preview', nodeKey: 'ending.preview', kind: 'narration', speakerKey: null,
        text: '预览已经可玩。', order: 0,
      }],
      choices: [],
    },
  }
}

async function insertPreviewBuild(input: {
  scope: WorkspaceScope
  sourceWorldRelease: WorldRelease
  runtimePackage: GameRuntimePackageV2
  mediaBindings?: Array<{ assetKey: string; artifactKey: string; blobContentHash: string }>
}) {
  const now = Date.now()
  const productionKey = `production.${crypto.randomUUID()}`
  const productionId = await db.gameProductions.add({
    projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId,
    productionKey, title: input.runtimePackage.definition.title, status: 'preview-ready', stateRevision: 4,
    controlEpoch: 1, currentBriefRevision: 1, currentBuildNumber: 1, currentGameDefinitionId: null,
    currentGameReleaseId: null, lastErrorJson: '{}', createdAt: now, updatedAt: now,
  }) as number
  await db.gameProductionBriefs.add({
    projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId,
    productionId, revision: 1, parentRevision: null, status: 'authorized',
    sourceWorldReleaseId: input.sourceWorldRelease.id!, sourceWorldContentHash: input.sourceWorldRelease.contentHash,
    userIntentSummary: '创建可玩预览', unresolvedJson: '[]', estimateJson: '{}', briefJson: '{}',
    briefHash: HASH_A, authorizedAt: now, createdAt: now,
  })
  const preview = await createGameBuildPreviewManifestV1({
    productionKey,
    buildNumber: 1,
    buildManifestHash: HASH_B,
    runtimePackage: input.runtimePackage,
    mediaBindings: input.mediaBindings,
  })
  const row: GameBuildRecordV1 = {
    projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId,
    productionId, buildNumber: 1, briefRevision: 1, briefHash: HASH_A, parentBuildNumber: null,
    sourceGameReleaseId: null, status: 'preview-ready', resumeState: null, stateRevision: 5, controlEpoch: 1,
    planRevision: 1, planJson: '{}', planHash: HASH_A, budgetLedgerJson: '{}', manifestJson: '{}',
    manifestHash: HASH_B, packageHash: preview.packageHash, previewManifestJson: JSON.stringify(preview),
    previewHash: preview.previewHash, qualityReportJson: '{}', qualityReportHash: HASH_A,
    compatibilityJson: '{}', rootTerminalReceiptHash: HASH_A, adoptionIntentHash: null,
    adoptedGameDefinitionId: null, releasedGameReleaseId: null, failureJson: '{}', authorizedAt: now,
    startedAt: now, completedAt: now, createdAt: now, updatedAt: now,
  }
  const id = await db.gameBuilds.add(row) as number
  return { productionId, build: { ...row, id }, preview }
}

describe('R-GAMEPROD-1A3 · playable Build Preview and Release equality', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('Preview 与发布后的 Release v2 解析为 canonical 相同的 RuntimePackage', async () => {
    const owned = await workspace('Preview Release 同包')
    const revision = await createWorldRevision({ scope: owned.scope, label: '空世界来源' })
    const worldRelease = await publishWorldRevision(revision.id!)
    const runtimePackage = storyPackage(worldRelease.contentHash)
    const { build, preview } = await insertPreviewBuild({ scope: owned.scope, sourceWorldRelease: worldRelease, runtimePackage })
    const resolvedPreview = await resolvePlayableGameSource({
      scope: owned.scope,
      source: { kind: 'build', gameBuildId: build.id!, expectedPreviewHash: preview.previewHash },
    })
    expect(resolvedPreview.runtimePackage).toEqual(runtimePackage)
    expect(resolvedPreview.runtimeSourceHash).toBe(preview.packageHash)

    const manifest = await createGameReleaseManifestV2({
      runtimePackage,
      productionProvenance: {
        productionKey: preview.productionKey,
        buildNumber: preview.buildNumber,
        buildManifestHash: preview.buildManifestHash,
        rootTerminalReceiptHash: HASH_A,
      },
    })
    const releaseContentHash = await hashGameProductionValueV2(manifest)
    const gameReleaseId = await db.gameReleases.add({
      projectId: owned.scope.projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      gameDefinitionId: null, worldReleaseId: worldRelease.id!, version: 1, label: '正式发布 v2',
      manifestJson: JSON.stringify(manifest), contentHash: releaseContentHash, createdAt: Date.now(),
    }) as number
    const resolvedRelease = await resolvePlayableGameSource({
      scope: owned.scope, source: { kind: 'release', gameReleaseId },
    })
    expect(resolvedRelease.packageHash).toBe(resolvedPreview.packageHash)
    expect(resolvedRelease.runtimePackage).toEqual(resolvedPreview.runtimePackage)

    const previewSession = await createPlayableGameInstance({
      scope: owned.scope,
      source: { kind: 'build', gameBuildId: build.id!, expectedPreviewHash: preview.previewHash },
      title: 'Build 可玩预览',
    })
    const releaseSession = await createPlayableGameInstance({
      scope: owned.scope,
      source: { kind: 'release', gameReleaseId },
      title: 'Release 正式游玩',
    })
    expect(previewSession).toMatchObject({
      gameBuildId: build.id!, gameReleaseId: null, runtimeSourceHash: preview.packageHash,
    })
    expect(releaseSession).toMatchObject({
      gameBuildId: null, gameReleaseId, runtimeSourceHash: preview.packageHash,
    })
    expect(await readSimulationState(previewSession.id!)).toEqual(await readSimulationState(releaseSession.id!))
    await expect(assertInstanceBinding(previewSession.id!, owned.scope)).resolves.toMatchObject({ id: previewSession.id })
    const branch = await branchSimulationSession({
      parentSessionId: previewSession.id!, throughSequence: 3, title: 'Build Preview 分支',
    })
    expect(branch).toMatchObject({
      parentSessionId: previewSession.id, gameBuildId: build.id!, gameReleaseId: null,
      runtimeSourceHash: preview.packageHash,
    })
    await expect(assertInstanceBinding(branch.id!, owned.scope)).resolves.toMatchObject({ id: branch.id })

    await expect(resolvePlayableGameSource({
      scope: owned.scope,
      source: { kind: 'build', gameBuildId: build.id!, expectedPreviewHash: HASH_A },
    })).rejects.toThrow(/Preview 指针或 hash/)
  })

  it('Build Preview 会话严格往返重映射，篡改或错误指针不会写入新会话', async () => {
    const owned = await workspace('Preview Session 生命周期')
    const revision = await createWorldRevision({ scope: owned.scope, label: '预览来源' })
    const worldRelease = await publishWorldRevision(revision.id!)
    const { build, preview } = await insertPreviewBuild({
      scope: owned.scope,
      sourceWorldRelease: worldRelease,
      runtimePackage: storyPackage(worldRelease.contentHash),
    })
    const before = await db.simulationSessions.count()
    await expect(createPlayableGameInstance({
      scope: owned.scope,
      source: { kind: 'build', gameBuildId: build.id!, expectedPreviewHash: HASH_A },
      title: '错误预览',
    })).rejects.toThrow(/Preview 指针或 hash/)
    expect(await db.simulationSessions.count()).toBe(before)

    const session = await createPlayableGameInstance({
      scope: owned.scope,
      source: { kind: 'build', gameBuildId: build.id!, expectedPreviewHash: preview.previewHash },
      title: '可导出预览',
    })
    const exported = await exportProjectJSON(owned.scope.projectId)
    const importedProjectId = await importProjectJSON(exported)
    const importedOwnership = await ensureWorkspaceOwnership(importedProjectId)
    const [importedBuild, importedSession] = await Promise.all([
      db.gameBuilds.where('projectId').equals(importedProjectId).first(),
      db.simulationSessions.where('projectId').equals(importedProjectId).first(),
    ])
    expect(importedSession).toMatchObject({
      gameBuildId: importedBuild!.id,
      gameReleaseId: null,
      runtimeSourceHash: session.runtimeSourceHash,
    })
    await expect(assertInstanceBinding(importedSession!.id!, importedOwnership.scope))
      .resolves.toMatchObject({ id: importedSession!.id })

    await db.gameBuilds.update(importedBuild!.id!, { packageHash: HASH_A })
    await expect(assertInstanceBinding(importedSession!.id!, importedOwnership.scope))
      .rejects.toThrow(/Preview 指针或 hash/)
  })

  it('AVG Build resolver 只读取 accepted Artifact 绑定，并通过共享对象 lease 返回冻结 bytes', async () => {
    const owned = await workspace('AVG Build Preview 媒资')
    const definition = await seedAvgAcceptanceGame({ scope: owned.scope })
    const publication = await publishAvgGame({ scope: owned.scope, gameDefinitionId: definition.id! })
    const runtimePackage = gameRuntimePackageFromReleaseV1(parseAnyGameReleaseManifest(publication.gameRelease.manifestJson))
    const mediaBindings = runtimePackage.presentation!.assets.map(asset => ({
      assetKey: asset.assetKey,
      artifactKey: `artifact.${asset.assetKey}`,
      blobContentHash: asset.blobContentHash,
    }))
    const { build, preview } = await insertPreviewBuild({
      scope: owned.scope, sourceWorldRelease: publication.worldRelease, runtimePackage, mediaBindings,
    })
    const now = Date.now()
    for (const [index, asset] of runtimePackage.presentation!.assets.entries()) {
      const metadata = await db.avgMediaAssets
        .where('[workId+assetKey+version]').equals([owned.scope.workId, asset.assetKey, asset.version]).first()
      const blob = await db.avgMediaBlobs.where('mediaAssetId').equals(metadata!.id!).first()
      await db.gameBuildArtifacts.add({
        projectId: owned.scope.projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
        buildId: build.id!, artifactKey: mediaBindings[index].artifactKey, requirementKey: `media.${index}`,
        version: 1, kind: asset.mimeType.startsWith('audio/') ? 'audio' : 'image', mediaKind: asset.kind,
        status: 'accepted', producerRunId: null, producerReceiptHash: null, controlEpoch: 1,
        inputHash: HASH_A, contentHash: asset.blobContentHash, payloadJson: '{}', metadataJson: '{}',
        qualityJson: '{}', rightsJson: '{}', blobObjectId: blob!.blobObjectId!, mimeType: asset.mimeType,
        byteSize: asset.byteSize, parentArtifactHash: null, carriedFrom: null, createdAt: now, updatedAt: now,
      })
    }
    const resolved = await resolvePlayableGameSource({
      scope: owned.scope,
      source: { kind: 'build', gameBuildId: build.id!, expectedPreviewHash: preview.previewHash },
    })
    const first = runtimePackage.presentation!.assets[0]
    const blob = await resolved.mediaResolver.read(first.assetKey)
    expect(blob).toMatchObject({ size: first.byteSize, type: first.mimeType })
    const linkedObject = await db.mediaBlobObjects
      .where('[workId+contentHash]').equals([owned.scope.workId, first.blobContentHash]).first()
    expect((await db.mediaBlobObjects.get(linkedObject!.id!))?.leaseOwner).toMatch(/^preview:/)
    resolved.mediaResolver.dispose()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect((await db.mediaBlobObjects.get(linkedObject!.id!))?.leaseOwner).toBeNull()
  }, 40_000)

  it('发布新的 Release v2 后，历史 Release v1 与既有存档仍固定在原 contentHash', async () => {
    const owned = await workspace('Release v1 到 v2 兼容')
    const definition = await seedAvgAcceptanceGame({ scope: owned.scope })
    const legacyPublication = await publishAvgGame({ scope: owned.scope, gameDefinitionId: definition.id! })
    const legacyRelease = structuredClone(legacyPublication.gameRelease)
    const legacyPackage = gameRuntimePackageFromReleaseV1(
      parseAnyGameReleaseManifest(legacyRelease.manifestJson),
    )
    const legacySession = await createPlayableGameInstance({
      scope: owned.scope,
      source: { kind: 'release', gameReleaseId: legacyRelease.id! },
      title: '历史 v1 存档',
    })
    const legacyInitialState = await readSimulationState(legacySession.id!)

    const evolvedPackage: GameRuntimePackageV2 = {
      ...structuredClone(legacyPackage),
      definition: {
        ...structuredClone(legacyPackage.definition),
        title: `${legacyPackage.definition.title} · v2 演化`,
      },
    }
    const evolvedManifest = await createGameReleaseManifestV2({
      runtimePackage: evolvedPackage,
      productionProvenance: {
        productionKey: 'production.legacy-compatibility',
        buildNumber: 2,
        buildManifestHash: HASH_B,
        rootTerminalReceiptHash: HASH_A,
      },
    })
    const evolvedReleaseId = await db.gameReleases.add({
      projectId: owned.scope.projectId,
      worldId: owned.scope.worldId,
      workId: owned.scope.workId,
      gameDefinitionId: null,
      worldReleaseId: legacyPublication.worldRelease.id!,
      version: legacyRelease.version + 1,
      label: '商业生产 Release v2',
      manifestJson: JSON.stringify(evolvedManifest),
      contentHash: await hashGameProductionValueV2(evolvedManifest),
      createdAt: Date.now() + 1,
    }) as number
    const evolvedSession = await createPlayableGameInstance({
      scope: owned.scope,
      source: { kind: 'release', gameReleaseId: evolvedReleaseId },
      title: '新 v2 存档',
    })

    expect(await db.gameReleases.get(legacyRelease.id!)).toEqual(legacyRelease)
    expect(await db.simulationSessions.get(legacySession.id!)).toMatchObject({
      gameReleaseId: legacyRelease.id,
      gameBuildId: null,
      runtimeSourceHash: legacyRelease.contentHash,
    })
    expect(await readSimulationState(legacySession.id!)).toEqual(legacyInitialState)
    await expect(assertInstanceBinding(legacySession.id!, owned.scope)).resolves.toMatchObject({
      id: legacySession.id,
      runtimeSourceHash: legacyRelease.contentHash,
    })
    expect(evolvedSession).toMatchObject({
      gameReleaseId: evolvedReleaseId,
      gameBuildId: null,
      runtimeSourceHash: await hashGameProductionValueV2(evolvedPackage),
    })
    expect(evolvedSession.runtimeSourceHash).not.toBe(legacySession.runtimeSourceHash)
  }, 40_000)

  it('Preview parser 拒绝未知字段和 package/preview 篡改', async () => {
    const pkg = storyPackage(HASH_A)
    const preview = await createGameBuildPreviewManifestV1({
      productionKey: 'production.parser', buildNumber: 1, buildManifestHash: HASH_B, runtimePackage: pkg,
    })
    await expect(verifyGameBuildPreviewManifestV1({
      ...preview,
      runtimePackage: { ...preview.runtimePackage, definition: { ...preview.runtimePackage.definition, title: '篡改' } },
    })).rejects.toThrow(/packageHash/)
    await expect(verifyGameBuildPreviewManifestV1({ ...preview, fallbackSummary: ['新增降级'] }))
      .rejects.toThrow(/previewHash/)
    await expect(verifyGameBuildPreviewManifestV1({ ...preview, hidden: true })).rejects.toThrow(/字段不符合合同/)
  })
})
