import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { StoryForgeDB } from '../../../src/lib/db/schema'
import {
  PRODUCTION_PRODUCT_KINDS_V1,
  TEXT_GAME_PRODUCT_KINDS_V1,
  UPPER_PRODUCT_KINDS_V1,
} from '../../../src/lib/types'

const databaseNames: string[] = []

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(name => Dexie.delete(name)))
})

/** Historical names are confined to this one-way DB-upgrade fixture. */
const LEGACY_V91_STORES = {
  projects: '++id, name, createdAt, updatedAt',
  worlds: '++id, projectId, code, [projectId+updatedAt]',
  works: '++id, projectId, worldId, [projectId+worldId], [worldId+updatedAt], status',
  worldReleases: '++id, releaseUid, projectId, worldId, revisionId, version, contentHash, createdAt',
  chapters: '++id, projectId, worldId, workId, outlineNodeId, order, status',
  gameProductions: '++id, projectId, worldId, workId, productType, &[workId+productionKey], [workId+productType], status, currentGameReleaseId, updatedAt',
  gameProductionBriefs: '++id, projectId, worldId, workId, productionId, &[productionId+revision], &[productionId+briefHash], [productionId+status], sourceWorldReleaseId, sourcePlanHash, confirmedBriefHash, createdAt',
  gameProductionCommands: '++id, projectId, worldId, workId, productionId, &[productionId+commandId], [productionId+status], type, createdAt',
  gameBuilds: '++id, projectId, worldId, workId, productionId, &[productionId+buildNumber], [productionId+status], sourceGameReleaseId, packageHash, previewHash, releasedGameReleaseId, updatedAt',
  gameBuildArtifacts: '++id, projectId, worldId, workId, buildId, &[buildId+artifactKey+version], [buildId+status], [buildId+requirementKey], producerRunId, blobObjectId, contentHash, createdAt',
  gameQualityGateReceipts: '++id, projectId, worldId, workId, buildId, &[buildId+gateId+receiptHash], [buildId+gateId], [buildId+status], gateId, status, createdAt',
  gameReleases: '++id, projectId, worldId, workId, productType, productionKey, worldReleaseId, &[workId+productionKey+version], [workId+productType], contentHash, createdAt',
  gameRulePacks: '++id, projectId, worldId, workId, &[workId+ruleSystemId+ruleSystemVersion], [workId+status], contentHash, updatedAt',
  simulationSessions: '++id, projectId, worldGroupId, worldId, workId, gameReleaseId, gameBuildId, runtimeSourceHash, kind, status, parentSessionId, updatedAt',
  simulationEvents: '++id, projectId, worldGroupId, sessionId, &[sessionId+sequence], &[sessionId+commandId], type, createdAt',
  simulationCheckpoints: '++id, projectId, worldGroupId, sessionId, [sessionId+throughSequence], createdAt',
  ttrpgSessionParticipants: '++id, projectId, worldGroupId, worldId, workId, sessionId, &[sessionId+seatKey], &[sessionId+viewerKey], [sessionId+actorKey], role, controller, assignmentState, updatedAt',
  ttrpgRuntimeAssetRequests: '++id, projectId, worldGroupId, worldId, workId, sessionId, &[sessionId+requestKey], [sessionId+slotKey], [sessionId+status], priority, mediaAssetId, processorLeaseExpiresAt, updatedAt',
  productMediaAssets: '++id, projectId, worldId, workId, &[workId+assetKey+version], [workId+kind], contentHash, updatedAt',
  productMediaBlobs: '++id, projectId, worldId, workId, &mediaAssetId, blobObjectId',
  mediaBlobObjects: '++id, projectId, worldId, workId, &[workId+contentHash], mimeType, disposition, storageState, leaseExpiresAt, byteSize, updatedAt',
  agentRuns: '++id, projectId, workId, simulationSessionId, gameBuildId, worldGroupId, conversationId, parentRunId, &[parentRunId+parentRelation], status, updatedAt',
  agentRunEvents: '++id, projectId, worldGroupId, runId, &[runId+sequence], type, createdAt',
  agentRunCheckpoints: '++id, projectId, worldGroupId, runId, &[runId+throughSequence], createdAt',
}

describe('ARCH-08 · current product identity and persistence reset', () => {
  it('closes product identities and keeps only the three declared text-game products', () => {
    expect(TEXT_GAME_PRODUCT_KINDS_V1).toEqual(['text-adventure', 'avg', 'text-open-world'])
    expect(PRODUCTION_PRODUCT_KINDS_V1).toEqual([
      'ttrpg', 'character-interaction', 'text-adventure', 'avg', 'text-open-world',
    ])
    expect(UPPER_PRODUCT_KINDS_V1).toEqual([
      'ttrpg', 'character-interaction', 'ai-town', 'text-adventure', 'avg', 'text-open-world',
    ])
    expect(PRODUCTION_PRODUCT_KINDS_V1).not.toContain('ai-town')
  })

  it('v92 preserves author/world content but removes every pre-reset upper-product row and store', async () => {
    const name = `storyforge-arch08-${crypto.randomUUID()}`
    databaseNames.push(name)
    const legacy = new Dexie(name)
    legacy.version(91).stores(LEGACY_V91_STORES)
    await legacy.open()

    await legacy.table('projects').add({ id: 1, name: '保留作者项目', createdAt: 1, updatedAt: 1 })
    await legacy.table('worlds').add({ id: 2, projectId: 1, code: 'world.keep', name: '保留世界', updatedAt: 1 })
    await legacy.table('works').add({ id: 3, projectId: 1, worldId: 2, kind: 'longform', status: 'active', title: '保留长篇', updatedAt: 1 })
    await legacy.table('worldReleases').add({ id: 4, releaseUid: 'release.keep', projectId: 1, worldId: 2, revisionId: 1, version: 1, contentHash: 'a'.repeat(64), createdAt: 1 })
    await legacy.table('chapters').add({ id: 5, projectId: 1, worldId: 2, workId: 3, order: 0, status: 'draft', title: '保留正文', content: '正文仍在。' })

    await legacy.table('gameProductions').add({ id: 10, projectId: 1, worldId: 2, workId: 3, productType: 'avg', productionKey: 'old.production', status: 'building' })
    await legacy.table('gameProductionBriefs').add({ id: 11, projectId: 1, worldId: 2, workId: 3, productionId: 10, revision: 1, briefHash: 'b', status: 'confirmed' })
    await legacy.table('gameProductionCommands').add({ id: 12, projectId: 1, worldId: 2, workId: 3, productionId: 10, commandId: 'old.command', status: 'completed' })
    await legacy.table('gameBuilds').add({ id: 13, projectId: 1, worldId: 2, workId: 3, productionId: 10, buildNumber: 1, status: 'completed' })
    await legacy.table('gameBuildArtifacts').add({ id: 14, projectId: 1, worldId: 2, workId: 3, buildId: 13, artifactKey: 'old', version: 1, status: 'accepted' })
    await legacy.table('gameQualityGateReceipts').add({ id: 15, projectId: 1, worldId: 2, workId: 3, buildId: 13, gateId: 'old', receiptHash: 'c', status: 'passed' })
    await legacy.table('gameReleases').add({ id: 16, projectId: 1, worldId: 2, workId: 3, productType: 'avg', productionKey: 'old.production', worldReleaseId: 4, version: 1, contentHash: 'd'.repeat(64) })
    await legacy.table('gameRulePacks').add({ id: 17, projectId: 1, worldId: 2, workId: 3, ruleSystemId: 'old', ruleSystemVersion: '1', status: 'draft', contentHash: 'e'.repeat(64) })
    await legacy.table('simulationSessions').add({ id: 20, projectId: 1, worldId: 2, workId: 3, gameReleaseId: 16, kind: 'avg', status: 'active' })
    await legacy.table('simulationEvents').add({ id: 21, projectId: 1, sessionId: 20, sequence: 1, type: 'old.event' })
    await legacy.table('simulationCheckpoints').add({ id: 22, projectId: 1, sessionId: 20, throughSequence: 1 })
    await legacy.table('ttrpgSessionParticipants').add({ id: 23, projectId: 1, worldId: 2, workId: 3, sessionId: 20, seatKey: 'old', viewerKey: 'old', actorKey: 'old' })
    await legacy.table('ttrpgRuntimeAssetRequests').add({ id: 24, projectId: 1, worldId: 2, workId: 3, sessionId: 20, requestKey: 'old', slotKey: 'old', status: 'pending' })
    await legacy.table('agentRuns').add({ id: 30, projectId: 1, workId: 3, simulationSessionId: 20, gameBuildId: 13, status: 'running' })
    await legacy.table('agentRunEvents').add({ id: 31, projectId: 1, runId: 30, sequence: 1, type: 'old' })
    await legacy.table('agentRunCheckpoints').add({ id: 32, projectId: 1, runId: 30, throughSequence: 1 })
    legacy.close()

    const upgraded = new StoryForgeDB(name)
    try {
      await upgraded.open()
      expect(upgraded.verno).toBe(94)
      expect(await upgraded.projects.get(1)).toMatchObject({ name: '保留作者项目' })
      expect(await upgraded.worlds.get(2)).toMatchObject({ name: '保留世界' })
      expect(await upgraded.works.get(3)).toMatchObject({ title: '保留长篇' })
      expect(await upgraded.worldReleases.get(4)).toMatchObject({ contentHash: 'a'.repeat(64) })
      expect(await upgraded.chapters.get(5)).toMatchObject({ content: '正文仍在。' })

      expect(await upgraded.productProductions.count()).toBe(0)
      expect(await upgraded.productProductionBriefs.count()).toBe(0)
      expect(await upgraded.productProductionCommands.count()).toBe(0)
      expect(await upgraded.productBuilds.count()).toBe(0)
      expect(await upgraded.productBuildArtifacts.count()).toBe(0)
      expect(await upgraded.productQualityGateReceipts.count()).toBe(0)
      expect(await upgraded.productReleases.count()).toBe(0)
      expect(await upgraded.ttrpgRulePacks.count()).toBe(0)
      expect(await upgraded.productRuntimeSessions.count()).toBe(0)
      expect(await upgraded.productRuntimeEvents.count()).toBe(0)
      expect(await upgraded.productRuntimeCheckpoints.count()).toBe(0)
      expect(await upgraded.agentRuns.count()).toBe(0)

      const activeTables = new Set(upgraded.tables.map(table => table.name))
      for (const retired of Object.keys(LEGACY_V91_STORES).filter(table => table.startsWith('game') || table.startsWith('simulation'))) {
        expect(activeTables.has(retired)).toBe(false)
      }
    } finally {
      upgraded.close()
    }
  })

  it('v93 moves public identity, version and import provenance exclusively to World', async () => {
    const name = `storyforge-arch-root-${crypto.randomUUID()}`
    databaseNames.push(name)
    const previous = new Dexie(name)
    previous.version(92).stores({
      projects: '++id, &workspaceUid, workspacePurpose, workspacePurposeDecision, name, createdAt, updatedAt',
      worlds: '++id, projectId, identityKind, code, [projectId+identityKind], [projectId+updatedAt]',
    })
    await previous.open()
    const origin = {
      packageId: 'pkg.source', sourceWorldCode: 'W-SOURCE-0001', sourceWorldVersion: 4,
      authorName: '作者', license: 'CC-BY-4.0', importedAt: 100,
    }
    await previous.table('projects').add({
      id: 1, workspaceUid: 'workspace:arch-root', workspacePurpose: 'world-engine',
      workspacePurposeDecision: 'explicit', worldCode: 'W-MIRROR-0001', worldVersion: 4,
      communityOrigin: origin, activeWorldId: 2, activeWorkId: null,
      name: '镜像待清理', createdAt: 1, updatedAt: 1,
    })
    await previous.table('worlds').add({
      id: 2, projectId: 1, identityKind: 'world-draft', code: 'W-AUTHORITY-0001',
      name: '唯一世界根', description: '', currentVersion: 4, createdAt: 1, updatedAt: 1,
    })
    previous.close()

    const current = new StoryForgeDB(name)
    await current.open()
    const project = await current.projects.get(1) as unknown as Record<string, unknown>
    const world = await current.worlds.get(2)
    expect(project.workspacePurpose).toBe('world-engine')
    expect(project).not.toHaveProperty('workspacePurposeDecision')
    expect(project).not.toHaveProperty('worldCode')
    expect(project).not.toHaveProperty('worldVersion')
    expect(project).not.toHaveProperty('communityOrigin')
    expect(world).toMatchObject({
      identityKind: 'world-draft', code: 'W-AUTHORITY-0001', currentVersion: 4,
      communityOrigin: origin,
    })
    current.close()
  })
})
