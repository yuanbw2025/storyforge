import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  assertPlayableWorldBundleRunnable,
  buildPlayableWorldBundleFromRelease,
  parseSimulationCanonSnapshot,
  verifyPlayableWorldBundle,
} from '../../src/lib/simulation/canon-snapshot'
import type { WorldReleaseManifestV2 } from '../../src/lib/types'
import { createWorkspace as createWorkspaceRoot } from '../../src/lib/world-engine/create-workspace'
import { createWorldInstance } from '../../src/lib/world-engine/instances'
import {
  createWorldRevision,
  publishWorldRevision,
  worldReleaseSectionTables,
} from '../../src/lib/world-engine/releases'

const createdAt = 1_780_000_000_000
const contentHash = 'a'.repeat(64)

function manifestFixture(): WorldReleaseManifestV2 {
  const records: Record<string, unknown[]> = {
    worldviews: [{
      summary: '潮汐决定城市道路。',
      worldStructure: '环形群岛',
      updatedAt: createdAt - 10,
    }],
    worldRulesProfiles: [{ globalNote: '满潮时禁止穿越礁门。', entries: {}, customNodes: [] }],
    powerSystems: [{ name: '听潮术', description: '聆听潮汐中的回声。', levels: '["浅听","深听"]' }],
    characters: [
      {
        name: '林舟',
        roleWeight: 'main',
        shortDescription: '旧港旅人',
        personality: '谨慎',
        location: '雾港',
        updatedAt: createdAt - 5,
      },
      {
        name: '守潮人',
        roleWeight: 'npc',
        shortDescription: '礁门守卫',
        location: '雾港',
      },
    ],
    characterRelations: [{
      _fromCharacterIndex: 0,
      _toCharacterIndex: 1,
      relationType: 'ally',
      label: '潮汐盟约',
      description: '共同守护礁门。',
      isBidirectional: true,
    }],
    importantLocations: [{
      _exportId: 0,
      name: '雾港',
      tags: '["港口"]',
      description: '退潮时显露的旧港。',
      significance: '起始地点',
      _parentExportId: null,
    }],
    codexCategories: [
      { _exportId: 0, builtInKey: 'artifact', name: '人工器物' },
      { _exportId: 1, builtInKey: 'faction', name: '势力' },
    ],
    codexEntries: [
      {
        _categoryExportId: 0,
        name: '潮汐钥匙',
        summary: '可开启礁门的世界资产。',
        fields: '{"rank":"上品"}',
      },
      {
        _categoryExportId: 1,
        name: '守潮议会',
        summary: '管理群岛潮路。',
        fields: '{"base":"雾港"}',
      },
    ],
    narrativeModules: [],
    narrativeNodes: [],
  }
  return {
    schema: 'storyforge.world-package',
    version: 2,
    worldCode: 'tide-world',
    worldName: '潮汐界',
    workTitle: '雾港纪事',
    selectedTables: Object.keys(records),
    selectedNarrativeModules: [],
    dependencies: Object.entries(records).map(([table, rows], index) => ({
      table,
      rowCount: rows.length,
      contentHash: String(index + 1).padStart(64, '0'),
    })),
    records,
    portableProject: { description: '潮汐世界发布包' },
  }
}

async function createWorkspace(name: string) {
  return createWorkspaceRoot({
    name,
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: 'OUTLET-1 集成测试',
    targetWordCount: 100_000,
    enableMultiWorld: true,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
}

describe('OUTLET-1 · WorldRelease 到可运行世界', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('从 portable records 确定性映射角色、地点、关系、物品和势力并通过双层 hash 验证', async () => {
    const manifest = manifestFixture()
    const first = await buildPlayableWorldBundleFromRelease({ manifest, worldContentHash: contentHash, createdAt })
    const repeated = await buildPlayableWorldBundleFromRelease({
      manifest: structuredClone(manifest),
      worldContentHash: contentHash,
      createdAt,
    })

    expect(repeated).toEqual(first)
    expect(first.bundleHash).toMatch(/^[0-9a-f]{64}$/)
    expect(await verifyPlayableWorldBundle(first)).toBe(true)
    expect(parseSimulationCanonSnapshot(JSON.stringify(first.canonSnapshot)))
      .toEqual(first.canonSnapshot)
    expect(first.canonSnapshot.sources.every(source => source.recordId === null)).toBe(true)
    expect(first.canonSnapshot.sources.map(source => source.sourceKey)).toEqual(expect.arrayContaining([
      'release-character:0',
      'release-character:1',
      'release-location:0',
      'release-item:0',
      'release-faction:1',
      'release-power-system:0',
    ]))
    expect(first.initialState.entities).toMatchObject({
      'release-character:0': {
        name: '林舟',
        locationKey: 'release-location:0',
      },
      'release-character:1': {
        name: '守潮人',
        locationKey: 'release-location:0',
      },
      'release-location:0': { name: '雾港', kind: 'location' },
      'release-item:0': { name: '潮汐钥匙', kind: 'item' },
      'release-faction:1': { name: '守潮议会', kind: 'faction' },
    })
    const relationRefs = JSON.parse(first.initialState.entities['release-character:0'].attributes.relationRefs as string)
    expect(relationRefs).toEqual([expect.objectContaining({
      otherCharacterKey: 'release-character:1',
      direction: 'bidirectional',
      relationType: 'ally',
    })])
    expect(first.diagnostics).toEqual([])

    const tampered = structuredClone(first)
    tampered.initialState.entities['release-character:0'].name = '篡改角色'
    expect(await verifyPlayableWorldBundle(tampered)).toBe(false)
  })

  it('对悬空关系、同名地点和重复稳定 key 给出确定性诊断，不静默猜测', async () => {
    const manifest = manifestFixture()
    manifest.records.importantLocations.push({
      _exportId: 1,
      name: '雾港',
      description: '另一个同名港口。',
    })
    manifest.records.importantLocations.push({
      _exportId: 1,
      name: '重复便携地点',
    })
    manifest.records.characterRelations.push({
      _fromCharacterIndex: 0,
      _toCharacterIndex: 999,
      relationType: 'enemy',
    })

    const bundle = await buildPlayableWorldBundleFromRelease({ manifest, worldContentHash: contentHash, createdAt })
    expect(bundle.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'CHARACTER_LOCATION_AMBIGUOUS',
      'CHARACTER_RELATION_UNRESOLVED',
      'DUPLICATE_SOURCE_KEY',
    ]))
    expect(bundle.initialState.entities['release-character:0'].locationKey).toBeNull()
    expect(bundle.diagnostics.filter(item => item.severity === 'error').length).toBeGreaterThanOrEqual(3)
    expect(await verifyPlayableWorldBundle(bundle)).toBe(true)
    expect(() => assertPlayableWorldBundleRunnable(bundle)).toThrow('CHARACTER_LOCATION_AMBIGUOUS')
  })

  it('真实 WorldRelease 在草稿删除后仍能提供冻结产品输入，但不能绕过生产阶段直接开跑团', async () => {
    const ownership = await createWorkspace('真实发布实体注入')
    const scope = ownership.scope
    const locationId = await db.importantLocations.add({
      projectId: scope.projectId,
      worldId: scope.worldId,
      name: '雾港',
      tags: '["港口"]',
      description: '冻结地点',
      significance: '跑团起点',
      parentId: null,
      sortOrder: 0,
      createdAt,
      updatedAt: createdAt,
    } as any) as number
    const characterId = await db.characters.add({
      projectId: scope.projectId,
      worldId: scope.worldId,
      name: '林舟',
      role: 'protagonist',
      roleWeight: 'main',
      moralAxis: 'neutral',
      orderAxis: 'neutral',
      shortDescription: '冻结角色',
      appearance: '',
      personality: '谨慎',
      background: '',
      motivation: '',
      abilities: '',
      relationships: '',
      arc: '',
      location: '雾港',
      createdAt,
      updatedAt: createdAt,
    } as any) as number
    const artifactCategoryId = await db.codexCategories.add({
      projectId: scope.projectId,
      worldId: scope.worldId,
      domain: 'humanity',
      parentId: null,
      name: '人工器物',
      builtInKey: 'artifact',
      fieldSchema: '[]',
      order: 0,
      worldGroupId: null,
      createdAt,
      updatedAt: createdAt,
    } as any) as number
    await db.codexEntries.add({
      projectId: scope.projectId,
      worldId: scope.worldId,
      worldGroupId: null,
      categoryId: artifactCategoryId,
      name: '潮汐钥匙',
      summary: '冻结器物',
      description: '开启礁门',
      fields: '{}',
      refs: '{}',
      tags: '[]',
      order: 0,
      createdAt,
      updatedAt: createdAt,
    } as any)
    const selectedTables = [
      ...worldReleaseSectionTables('foundation'),
      ...worldReleaseSectionTables('characters'),
    ]
    const revision = await createWorldRevision({
      scope,
      label: 'OUTLET-1 完整实体修订',
      selectedTables,
    })
    const release = await publishWorldRevision(revision.id!)
    const manifest = JSON.parse(release.manifestJson) as WorldReleaseManifestV2

    await db.characters.delete(characterId)
    await db.importantLocations.delete(locationId)
    await db.codexEntries.clear()
    const bundle = await buildPlayableWorldBundleFromRelease({
      manifest,
      worldContentHash: release.contentHash,
      createdAt: release.createdAt,
    })

    expect(Object.values(bundle.initialState.entities)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '林舟', kind: 'character', locationKey: 'release-location:0' }),
      expect.objectContaining({ name: '雾港', kind: 'location' }),
      expect.objectContaining({ name: '潮汐钥匙', kind: 'item' }),
    ]))
    expect(bundle.initialState.narrative).toBeNull()
    expect(bundle.canonSnapshot.sources.map(source => source.sourceKey))
      .toEqual(expect.arrayContaining(['release-character:0', 'release-location:0', 'release-item:0']))
    expect(await verifyPlayableWorldBundle(bundle)).toBe(true)

    await expect(createWorldInstance({
      scope,
      kind: 'ttrpg',
      title: '不得直接运行的跑团',
      releaseId: release.id!,
      seed: 'outlet-fixed',
    })).rejects.toThrow('必须绑定不可变 GameRelease')
  })
})
