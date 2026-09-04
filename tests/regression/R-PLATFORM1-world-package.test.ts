import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  createWorldPackage,
  importWorldPackage,
  inspectWorldPackage,
} from '../../src/lib/world-engine/world-package'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { hashWorldReleaseValueV1 } from '../../src/lib/world-engine/release-hash'
import { stampNewRecord } from '../../src/lib/workspace/scope'

const ALL_WORLD_PACKAGE_USES = {
  'world-remix': true,
  ttrpg: true,
  'character-interaction': true,
  'ai-town': true,
  'text-adventure': true,
  avg: true,
  'text-open-world': true,
} as const

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value == null || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
    .map(key => [key, canonicalize((value as Record<string, unknown>)[key])]))
}

async function resignPackageIntegrity(pkg: Awaited<ReturnType<typeof createWorldPackage>>): Promise<void> {
  const payload = {
    format: pkg.format,
    packageVersion: pkg.packageVersion,
    manifest: pkg.manifest,
    release: pkg.release,
  }
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(payload)))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  pkg.integrity.digest = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

describe('PLATFORM-1 · 本地世界发布包', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  async function seedProject() {
    const now = Date.now()
    const created = await createWorkspace({
      name: '潮汐之后', genres: ['kehuan'], description: '海平面吞没大陆后的漂浮聚落。',
      status: 'drafting', targetWordCount: 0, enableMultiWorld: true,
    }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
    const groupId = await db.worldGroups.add(stampNewRecord(created.scope, 'worldGroups', {
      projectId: created.scope.projectId, name: '主世界', slug: 'main', order: 0, createdAt: now, updatedAt: now,
    } as any, { owner: 'world' })) as number
    await db.worldviews.add(stampNewRecord(created.scope, 'worldviews', {
      projectId: created.scope.projectId, worldGroupId: groupId,
      worldOrigin: '退潮后海床城市升起。', createdAt: now, updatedAt: now,
    } as any, { owner: 'world' }))
    await db.characters.add(stampNewRecord(created.scope, 'characters', {
      projectId: created.scope.projectId, homeWorldGroupId: groupId,
      name: '守灯人', roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful',
      shortDescription: '看守潮汐灯塔。', appearance: '', personality: '', background: '',
      motivation: '', abilities: '', relationships: '[]', arc: '', createdAt: now, updatedAt: now,
    } as any, { owner: 'world' }))
    const volumeId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
      projectId: created.scope.projectId, parentId: null, type: 'volume', title: '第一卷',
      summary: '世界引擎可选的完整小说语义', order: 0, createdAt: now, updatedAt: now,
    } as any, { owner: 'work' })) as number
    await db.chapters.add(stampNewRecord(created.scope, 'chapters', {
      projectId: created.scope.projectId, outlineNodeId: volumeId, title: '退潮之日',
      content: '<p>作者确认的世界正文</p>', wordCount: 10, status: 'draft', order: 0,
      createdAt: now, updatedAt: now,
    } as any, { owner: 'work' }))
    await db.productMediaAssets.add(stampNewRecord(created.scope, 'productMediaAssets', {
      projectId: created.scope.projectId, assetKey: 'private-cover', version: 1,
      kind: 'background', name: '产品私有背景', mimeType: 'image/png', byteSize: 10,
      contentHash: 'a'.repeat(64), createdAt: now, updatedAt: now,
    } as any, { owner: 'work' }))
    const revision = await createWorldRevision({ scope: created.scope, label: '世界语义版本一' })
    const release = await publishWorldRevision(revision.id!)
    return { ...created, release }
  }

  it('v3 只发布注册表登记的世界语义，并用当前产品身份保留用途、许可与完整性', async () => {
    const seeded = await seedProject()
    const pkg = await createWorldPackage(seeded.release.id!, {
      authorName: '林岚', license: 'CC-BY-4.0',
      allowedUses: {
        ...ALL_WORLD_PACKAGE_USES,
        'character-interaction': false,
        'ai-town': false,
        avg: false,
      },
      contentWarnings: ['灾难'],
    })
    const report = await inspectWorldPackage(pkg)

    expect(report.valid).toBe(true)
    expect(report.importable).toBe(true)
    expect(pkg.manifest.packageId).toBe(`${seeded.world.code}@v1`)
    expect(pkg.packageVersion).toBe(3)
    expect(pkg.manifest.allowedUses['character-interaction']).toBe(false)
    expect(pkg.release.manifest.semanticContract).toBe(3)
    expect(pkg.release.manifest.records.characters).toHaveLength(1)
    expect(pkg.release.manifest.records.chapters).toHaveLength(1)
    expect(pkg.release.manifest.records.productMediaAssets).toBeUndefined()
    expect(pkg.release.manifest.selectedTables).not.toContain('productMediaAssets')
    expect(pkg.release.manifest).not.toHaveProperty('selectedNarrativeModules')
  })

  it('篡改发布信息或混入产品媒资时拒绝导入', async () => {
    const seeded = await seedProject()
    const pkg = await createWorldPackage(seeded.release.id!, {
      authorName: '匿名', license: 'ALL-RIGHTS-RESERVED',
      allowedUses: { ...ALL_WORLD_PACKAGE_USES, ttrpg: false, 'character-interaction': false, 'ai-town': false },
    })
    const tampered = JSON.parse(JSON.stringify(pkg))
    tampered.manifest.description = '被替换的描述'
    const tamperedReport = await inspectWorldPackage(tampered)
    expect(tamperedReport.valid).toBe(false)
    expect(tamperedReport.errors.join('；')).toContain('完整性校验失败')

    const leaked = JSON.parse(JSON.stringify(pkg))
    leaked.release.manifest.semanticSnapshot.productMediaAssets = [{ name: '越界媒资' }]
    const leakedReport = await inspectWorldPackage(leaked)
    expect(leakedReport.valid).toBe(false)
    expect(leakedReport.errors.join('；')).toMatch(/productMediaAssets|完整性校验失败/)
    await expect(importWorldPackage(leaked)).rejects.toThrow('世界分享包预检失败')
    expect(await db.projects.count()).toBe(1)
  })

  it('目录语义身份不可重标，source manifest 必须完整分区', async () => {
    const seeded = await seedProject()
    const pkg = await createWorldPackage(seeded.release.id!, {
      authorName: '匿名', license: 'ALL-RIGHTS-RESERVED',
      allowedUses: { ...ALL_WORLD_PACKAGE_USES },
    })
    const mutations: Array<(copy: typeof pkg) => void> = [
      copy => { copy.release.manifest.resourceCatalog![0]!.resourceId = 'world:forged:semantic:story:forged' },
      copy => { copy.release.manifest.resourceCatalog![0]!.resourceKind = 'forged-kind' },
      copy => {
        const resource = copy.release.manifest.resourceCatalog![0]!
        resource.area = resource.area === 'story' ? 'foundation' : 'story'
      },
    ]
    for (const mutate of mutations) {
      const copy = structuredClone(pkg)
      mutate(copy)
      const report = await inspectWorldPackage(copy)
      expect(report.valid).toBe(false)
      expect(report.errors.join('；')).toContain('resourceCatalog 与 dependency/PROJECT_TABLES 语义身份不一致')
    }

    const partition = structuredClone(pkg)
    partition.release.manifest.sourceManifest!.selectedResourceIds.pop()
    const partitionReport = await inspectWorldPackage(partition)
    expect(partitionReport.valid).toBe(false)
    expect(partitionReport.errors.join('；')).toContain('selected/omitted 未与 PROJECT_TABLES 完整分区')
  })

  it('selected table 即使为空也必须在语义 records 中存在，不能被导入器默认为无事发生', async () => {
    const seeded = await seedProject()
    const pkg = await createWorldPackage(seeded.release.id!, {
      authorName: '匿名', license: 'ALL-RIGHTS-RESERVED',
      allowedUses: { ...ALL_WORLD_PACKAGE_USES },
    })
    const emptySelectedTable = pkg.release.manifest.selectedTables.find(table => (
      Array.isArray(pkg.release.manifest.records[table])
      && pkg.release.manifest.records[table]!.length === 0
    ))
    expect(emptySelectedTable).toBeTruthy()
    const missing = structuredClone(pkg)
    delete missing.release.manifest.records[emptySelectedTable!]
    missing.release.contentHash = await hashWorldReleaseValueV1(missing.release.manifest)
    missing.manifest.releaseHash = missing.release.contentHash
    await resignPackageIntegrity(missing)

    const report = await inspectWorldPackage(missing)
    expect(report.valid).toBe(false)
    expect(report.errors.join('；')).toMatch(/records|selectedTables/)
    await expect(importWorldPackage(missing)).rejects.toThrow('世界分享包预检失败')
  })

  it('导入为新本地编号并保存来源，不覆盖原世界或带入产品媒资', async () => {
    const seeded = await seedProject()
    const pkg = await createWorldPackage(seeded.release.id!, {
      authorName: '林岚', license: 'CC-BY-SA-4.0',
      allowedUses: { ...ALL_WORLD_PACKAGE_USES },
    })
    const importedId = await importWorldPackage(pkg)
    const imported = await db.projects.get(importedId)
    const importedWorld = imported?.activeWorldId == null ? undefined : await db.worlds.get(imported.activeWorldId)

    expect(importedId).not.toBe(seeded.scope.projectId)
    expect(imported).not.toHaveProperty('worldCode')
    expect(imported).not.toHaveProperty('worldVersion')
    expect(importedWorld?.code).toMatch(/^W-[A-Z0-9]{5}-[A-Z0-9]{4}$/)
    expect(importedWorld?.code).not.toBe(seeded.world.code)
    expect(importedWorld?.communityOrigin?.sourceWorldCode).toBe(seeded.world.code)
    expect(importedWorld?.communityOrigin?.license).toBe('CC-BY-SA-4.0')
    expect(await db.worldviews.where('projectId').equals(importedId).count()).toBe(1)
    expect(await db.characters.where('projectId').equals(importedId).count()).toBe(1)
    expect(await db.chapters.where('projectId').equals(importedId).count()).toBe(1)
    expect(await db.productMediaAssets.where('projectId').equals(importedId).count()).toBe(0)
    expect(await db.worldReleases.where('projectId').equals(importedId).count()).toBe(1)
    expect((await db.worlds.get(seeded.scope.worldId))?.code).toBe(seeded.world.code)
  })

  it('未知协议 fail-closed', async () => {
    const report = await inspectWorldPackage({
      format: 'storyforge.world-package', packageVersion: 999, manifest: {},
      integrity: { algorithm: 'SHA-256', digest: '0'.repeat(64) },
    })
    expect(report.valid).toBe(false)
    expect(report.importable).toBe(false)
    await expect(importWorldPackage({ format: 'storyforge.world-package', packageVersion: 999 }))
      .rejects.toThrow('世界分享包预检失败')
  })
})
