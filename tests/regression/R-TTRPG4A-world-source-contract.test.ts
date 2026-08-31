import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { db } from '../../src/lib/db/schema'
import {
  createTtrpgWorldSourceSelectionV1,
  loadTtrpgWorldSourceCatalogV1,
  parseTtrpgWorldSourceSelectionV1,
  validateTtrpgWorldSourceSelectionV1,
} from '../../src/lib/ttrpg/world-source'
import type { WorldReleaseManifestV2 } from '../../src/lib/types'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'

async function workspace() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'TTRPG 世界来源契约', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '', targetWordCount: 80_000,
    workspacePurpose: 'world-engine', workspacePurposeDecision: 'explicit',
    createdAt: now, updatedAt: now,
  } as never) as number
  const owned = await ensureWorkspaceOwnership(projectId)
  const [characterA, characterB] = await db.characters.bulkAdd([
    {
      projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      isCrossWorld: true, name: '守门人', role: 'protagonist', roleWeight: 'main',
      shortDescription: '守住雾门的人', background: '知道失踪队伍的旧路线', createdAt: now, updatedAt: now,
    },
    {
      projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      isCrossWorld: true, name: '引路者', role: 'supporting', roleWeight: 'secondary',
      shortDescription: '声称能穿过雾门', background: '隐瞒了路线代价', createdAt: now, updatedAt: now,
    },
  ] as never[], { allKeys: true }) as number[]
  await db.characterRelations.add({
    projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
    fromCharacterId: characterA, toCharacterId: characterB,
    relationType: 'ally', label: '互不信任的同盟', description: '共同目标之外仍各有秘密',
    isBidirectional: true, createdAt: now, updatedAt: now,
  } as never)
  const parentLocationId = await db.importantLocations.add({
    projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
    parentId: null, name: '雾港', tags: '[]', description: '封锁中的港城', significance: '战役区域',
    sortOrder: 0, createdAt: now, updatedAt: now,
  } as never) as number
  await db.importantLocations.add({
    projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
    parentId: parentLocationId, name: '潮门', tags: '[]', description: '城外唯一航道', significance: '开场地点',
    sortOrder: 0, createdAt: now, updatedAt: now,
  } as never)
  const revision = await createWorldRevision({
    scope: owned.scope,
    label: '冻结 TTRPG 来源',
    selectedTables: ['characters', 'characterRelations', 'importantLocations'],
    selectedNarrativeModuleIds: [],
  })
  const release = await publishWorldRevision(revision.id!)
  return { ...owned, release, characterA }
}

describe('TTRPG-4A · product-owned World SourceSelection', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只从不可变 Manifest V2 建 catalog，以便携根、依赖闭包和 selectionHash 冻结选择', async () => {
    const owned = await workspace()
    const catalog = await loadTtrpgWorldSourceCatalogV1({
      scope: owned.scope, worldReleaseId: owned.release.id!,
    })
    const locations = catalog.tables.find(table => table.table === 'importantLocations')!
    expect(catalog).toMatchObject({
      productType: 'ttrpg', worldReleaseId: owned.release.id,
      worldContentHash: owned.release.contentHash,
      sourceWorldCode: owned.release.sourceWorldCode,
    })
    expect(catalog.sourceWorldExportId).toBeGreaterThanOrEqual(0)
    expect(catalog.sourceWorkExportId).toBeGreaterThanOrEqual(0)
    expect(catalog.unselectableReleaseTables).toEqual([])
    expect(catalog.tables.find(table => table.table === 'characters')?.records.map(item => item.exportId)).toEqual([0, 1])
    expect(catalog.tables.find(table => table.table === 'characterRelations')?.records[0].dependencies).toEqual([
      { table: 'characters', exportId: 0 },
      { table: 'characters', exportId: 1 },
    ])

    const selection = await createTtrpgWorldSourceSelectionV1({
      catalog,
      recordSelections: [
        { table: 'importantLocations', granularity: 'tree-subgraph', exportIds: locations.records.map(item => item.exportId) },
      ],
      narrativeSubgraphs: [],
    })
    expect(selection.selectionHash).toMatch(/^[a-f0-9]{64}$/)
    expect(selection.sourceWorldExportId).toBe(catalog.sourceWorldExportId)
    expect(selection.sourceWorkExportId).toBe(catalog.sourceWorkExportId)
    await expect(validateTtrpgWorldSourceSelectionV1({ scope: owned.scope, selection })).resolves.toEqual(selection)

    // Mutable authoring rows can continue changing; the verified frozen source does not drift.
    await db.importantLocations.toCollection().modify({ name: '当前工作表的新名字' })
    const afterMutation = await loadTtrpgWorldSourceCatalogV1({ scope: owned.scope, worldReleaseId: owned.release.id! })
    expect(afterMutation.tables.find(table => table.table === 'importantLocations')?.records.map(item => item.label))
      .not.toContain('当前工作表的新名字')
  })

  it('拒绝字段注入、hash 篡改、Dexie ID 冒充便携 ID和不完整引用闭包', async () => {
    const owned = await workspace()
    const catalog = await loadTtrpgWorldSourceCatalogV1({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const locations = catalog.tables.find(table => table.table === 'importantLocations')!
    const base = await createTtrpgWorldSourceSelectionV1({
      catalog,
      recordSelections: [
        { table: 'importantLocations', granularity: 'tree-subgraph', exportIds: locations.records.map(item => item.exportId) },
      ],
      narrativeSubgraphs: [],
    })
    expect(() => parseTtrpgWorldSourceSelectionV1({ ...base, sourceProjectDexieId: owned.scope.projectId }))
      .toThrow('字段不精确')
    await expect(validateTtrpgWorldSourceSelectionV1({
      scope: owned.scope, selection: { ...base, sourceWorldCode: `${base.sourceWorldCode}-tampered` },
    })).rejects.toThrow('selectionHash')

    const dexieIdSelection = await createTtrpgWorldSourceSelectionV1({
      catalog,
      recordSelections: [{ table: 'importantLocations', granularity: 'record-set', exportIds: [999_999] }],
      narrativeSubgraphs: [],
    })
    await expect(validateTtrpgWorldSourceSelectionV1({ scope: owned.scope, selection: dexieIdSelection }))
      .rejects.toThrow('不属于冻结包')

    const child = locations.records.find(item => item.parentExportId != null)!
    const missingParent = await createTtrpgWorldSourceSelectionV1({
      catalog,
      recordSelections: [
        { table: 'importantLocations', granularity: 'tree-subgraph', exportIds: [child.exportId] },
      ],
      narrativeSubgraphs: [],
    })
    await expect(validateTtrpgWorldSourceSelectionV1({ scope: owned.scope, selection: missingParent }))
      .rejects.toThrow('缺少便携依赖 importantLocations')
  })

  it('把严格发布包内位置作为 release-scoped 坐标，而不是要求世界记录额外增加永久 ID', async () => {
    const owned = await workspace()
    const release = (await db.worldReleases.get(owned.release.id!))!
    const manifest = JSON.parse(release.manifestJson) as WorldReleaseManifestV2
    const locationRows = manifest.records.importantLocations as Array<Record<string, unknown>>
    delete locationRows[0]._exportId
    const locationDependency = manifest.dependencies.find(item => item.table === 'importantLocations')!
    locationDependency.contentHash = await hashCanonicalValue(locationRows)
    const contentHash = await hashCanonicalValue(manifest)
    await db.worldReleases.update(release.id!, { manifestJson: JSON.stringify(manifest), contentHash })

    const catalog = await loadTtrpgWorldSourceCatalogV1({ scope: owned.scope, worldReleaseId: release.id! })
    const locations = catalog.tables.find(table => table.table === 'importantLocations')!
    expect(locations.records.map(item => item.exportId)).toEqual([0, 1])
    expect(catalog.unselectableReleaseTables).toEqual([])
    const selection = await createTtrpgWorldSourceSelectionV1({
      catalog,
      recordSelections: [{
        table: 'importantLocations', granularity: 'tree-subgraph',
        exportIds: locations.records.map(item => item.exportId),
      }],
      narrativeSubgraphs: [],
    })
    await expect(validateTtrpgWorldSourceSelectionV1({ scope: owned.scope, selection })).resolves.toEqual(selection)
  })
})
