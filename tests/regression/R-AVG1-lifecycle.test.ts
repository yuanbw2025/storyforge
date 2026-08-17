import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteAvgGameDraft, publishAvgGame, seedAvgAcceptanceGame } from '../../src/lib/avg/authoring'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { createAvgGameInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

describe('AVG-1 · binary and registry lifecycle', () => {
  beforeAll(async () => { await db.delete(); await db.open() }); afterAll(() => db.close())
  it('Blob 随严格项目备份往返并重映射，删草稿保留不可变发布与存档', async () => {
    const now = Date.now(); const projectId = await db.projects.add({ name: 'AVG 生命周期', genre: 'visual', genres: ['visual'], status: 'drafting', description: '', targetWordCount: 1, createdAt: now, updatedAt: now } as any) as number
    const owned = await ensureWorkspaceOwnership(projectId); const definition = await seedAvgAcceptanceGame({ scope: owned.scope }); const published = await publishAvgGame({ scope: owned.scope, gameDefinitionId: definition.id! }); await createAvgGameInstance({ scope: owned.scope, gameReleaseId: published.gameRelease.id!, title: 'AVG 存档' })
    const exported = await exportProjectJSON(projectId); expect(exported.avgMediaBlobs?.[0].data).toMatch(/^data:/); expect(exported.avgPresentationModules).toHaveLength(1)
    const importedId = await importProjectJSON(exported); const importedAsset = await db.avgMediaAssets.where('projectId').equals(importedId).first(); const importedBlob = await db.avgMediaBlobs.where('projectId').equals(importedId).first(); expect(importedBlob?.mediaAssetId).toBe(importedAsset?.id); expect(importedBlob?.data).toBeInstanceOf(ArrayBuffer); expect(importedBlob?.data.byteLength).toBeGreaterThan(0)
    expect(await db.simulationSessions.where('projectId').equals(importedId).filter(row => row.kind === 'avg').count()).toBe(1)
    const corrupt = structuredClone(exported); const portable = corrupt.avgMediaBlobs![0].data; const [prefix, body] = portable.split(','); corrupt.avgMediaBlobs![0].data = `${prefix},${body[0] === 'A' ? 'B' : 'A'}${body.slice(1)}`; const projectCount = await db.projects.count(); await expect(importProjectJSON(corrupt)).rejects.toThrow('二进制哈希'); expect(await db.projects.count()).toBe(projectCount)
    await deleteAvgGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! }); expect(await db.avgPresentationModules.where('gameDefinitionId').equals(definition.id!).count()).toBe(0); expect(await db.gameReleases.get(published.gameRelease.id!)).toMatchObject({ gameDefinitionId: null })
  }, 40_000)
})
