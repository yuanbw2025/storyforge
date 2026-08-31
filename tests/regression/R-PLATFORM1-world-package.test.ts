import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { db } from '../../src/lib/db/schema'
import {
  createWorldPackageV2,
  importWorldPackage,
  inspectWorldPackage,
  WORLD_PACKAGE_V1_REQUIRED_TABLES,
} from '../../src/lib/product/world-package'
import { migrateLegacyWorldPackageV1 } from '../../src/lib/product/world-package-migration'
import type { WorldReleaseManifestV2 } from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/world-engine/create-workspace'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { stampNewRecord } from '../../src/lib/world-engine/scope'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
    .map(key => [key, canonicalize((value as Record<string, unknown>)[key])]))
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
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
      name: '潮汐之后', genre: 'kehuan', genres: ['kehuan'], description: '海平面吞没大陆后的漂浮聚落。',
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
      name: '守灯人', role: 'protagonist', description: '看守潮汐灯塔。', createdAt: now, updatedAt: now,
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
    await db.avgMediaAssets.add(stampNewRecord(created.scope, 'avgMediaAssets', {
      projectId: created.scope.projectId, assetKey: 'private-cover', version: 1,
      kind: 'background', name: '产品私有背景', mimeType: 'image/png', byteSize: 10,
      contentHash: 'a'.repeat(64), createdAt: now, updatedAt: now,
    } as any, { owner: 'work' }))
    const revision = await createWorldRevision({ scope: created.scope, label: '世界语义版本一' })
    const release = await publishWorldRevision(revision.id!)
    return { ...created, release }
  }

  it('v2 只发布注册表登记的世界语义，并保留用途、许可与完整性', async () => {
    const seeded = await seedProject()
    const pkg = await createWorldPackageV2(seeded.release.id!, {
      authorName: '林岚', license: 'CC-BY-4.0',
      allowedUses: { writing: true, ttrpg: true, characterChat: false, textGame: false },
      contentWarnings: ['灾难'],
    })
    const report = await inspectWorldPackage(pkg)

    expect(report.valid).toBe(true)
    expect(report.importable).toBe(true)
    expect(pkg.manifest.packageId).toBe(`${seeded.world.code}@v1`)
    expect(pkg.manifest.allowedUses.characterChat).toBe(false)
    expect(pkg.release.manifest.semanticContract).toBe(3)
    expect((pkg.release.manifest.portableProject as any).characters).toHaveLength(1)
    expect((pkg.release.manifest.portableProject as any).chapters).toHaveLength(1)
    expect((pkg.release.manifest.portableProject as any).avgMediaAssets).toBeUndefined()
    expect(pkg.release.manifest.selectedTables).not.toContain('avgMediaAssets')
    expect(pkg.release.manifest.selectedNarrativeModules).toEqual([])
  })

  it('篡改发布信息或混入产品媒资时拒绝导入', async () => {
    const seeded = await seedProject()
    const pkg = await createWorldPackageV2(seeded.release.id!, {
      authorName: '匿名', license: 'ALL-RIGHTS-RESERVED',
      allowedUses: { writing: true, ttrpg: false, characterChat: false, textGame: false },
    })
    const tampered = JSON.parse(JSON.stringify(pkg))
    tampered.manifest.description = '被替换的描述'
    const tamperedReport = await inspectWorldPackage(tampered)
    expect(tamperedReport.valid).toBe(false)
    expect(tamperedReport.errors.join('；')).toContain('完整性校验失败')

    const leaked = JSON.parse(JSON.stringify(pkg))
    leaked.release.manifest.portableProject.avgMediaAssets = [{ name: '越界媒资' }]
    const leakedReport = await inspectWorldPackage(leaked)
    expect(leakedReport.valid).toBe(false)
    expect(leakedReport.errors.join('；')).toMatch(/avgMediaAssets|完整性校验失败/)
    await expect(importWorldPackage(leaked)).rejects.toThrow('世界分享包预检失败')
    expect(await db.projects.count()).toBe(1)
  })

  it('导入为新本地编号并保存来源，不覆盖原世界或带入产品媒资', async () => {
    const seeded = await seedProject()
    const pkg = await createWorldPackageV2(seeded.release.id!, {
      authorName: '林岚', license: 'CC-BY-SA-4.0',
      allowedUses: { writing: true, ttrpg: true, characterChat: true, textGame: true },
    })
    const importedId = await importWorldPackage(pkg)
    const imported = await db.projects.get(importedId)

    expect(importedId).not.toBe(seeded.scope.projectId)
    expect(imported?.worldCode).toMatch(/^W-[A-Z0-9]{5}-[A-Z0-9]{4}$/)
    expect(imported?.worldCode).not.toBe(seeded.world.code)
    expect(imported?.communityOrigin?.sourceWorldCode).toBe(seeded.world.code)
    expect(imported?.communityOrigin?.license).toBe('CC-BY-SA-4.0')
    expect(await db.worldviews.where('projectId').equals(importedId).count()).toBe(1)
    expect(await db.characters.where('projectId').equals(importedId).count()).toBe(1)
    expect(await db.chapters.where('projectId').equals(importedId).count()).toBe(1)
    expect(await db.avgMediaAssets.where('projectId').equals(importedId).count()).toBe(0)
    expect(await db.worldReleases.where('projectId').equals(importedId).count()).toBe(1)
    expect((await db.projects.get(seeded.scope.projectId))?.worldCode).toBe(seeded.world.code)
  })

  it('历史 v1 包仍可预检，但必须经过分类迁移，不能绕过纯语义边界直接导入', async () => {
    const legacyBackup = JSON.parse(readFileSync(
      path.resolve(__dirname, '../fixtures/legacy-export-v3.json'),
      'utf8',
    )) as Record<string, unknown>
    const portableProject = Object.fromEntries([
      ['version', legacyBackup.version],
      ['exportedAt', legacyBackup.exportedAt],
      ['project', legacyBackup.project],
      ...WORLD_PACKAGE_V1_REQUIRED_TABLES.map(table => [table, legacyBackup[table] ?? []]),
    ])
    const manifest = {
      packageId: 'W-LEGACY-0001@v1',
      sourceWorldCode: 'W-LEGACY-0001',
      sourceWorldVersion: 1,
      name: '历史 v1 世界',
      description: 'WORLD-2 之前导出的世界包',
      authorName: '历史作者',
      attribution: '历史作者 · 历史 v1 世界',
      license: 'CC-BY-4.0',
      allowedUses: { writing: true, ttrpg: true, characterChat: false, textGame: false },
      contentWarnings: [],
      publishedAt: 1,
    }
    const payload = {
      format: 'storyforge.world-package',
      packageVersion: 1,
      manifest,
      portableProject,
    }
    const pkg = {
      ...payload,
      integrity: { algorithm: 'SHA-256', digest: await digest(payload) },
    }

    const report = await inspectWorldPackage(pkg)
    expect(report.valid, report.errors.join('；')).toBe(true)
    expect(report.importable).toBe(false)
    expect(report.migrationRequired).toBe(true)
    await expect(importWorldPackage(pkg)).rejects.toThrow('需要先执行分类迁移')
    const migrated = await migrateLegacyWorldPackageV1(pkg)
    const semanticRelease = await db.worldReleases.get(migrated.semanticReleaseId)
    const semanticManifest = JSON.parse(semanticRelease!.manifestJson) as WorldReleaseManifestV2
    expect(semanticManifest.semanticContract).toBe(3)
    expect(await db.worldviews.where('projectId').equals(migrated.semanticProjectId).count()).toBe(2)
    expect(semanticManifest.selectedTables).not.toContain('avgMediaAssets')
  })
})
