import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON } from '../../src/lib/export/json-export'
import {
  createWorldPackage,
  createWorldPackageV2,
  importWorldPackage,
  inspectWorldPackage,
  type WorldPackageV2,
} from '../../src/lib/product/world-package'
import { migrateLegacyWorldPackageV1 } from '../../src/lib/product/world-package-migration'
import type { WorldReleaseManifestV2, Worldview } from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/world-engine/create-workspace'
import { createWorldRevision, publishWorldRevision, stableJson } from '../../src/lib/world-engine/releases'
import { stampNewRecord } from '../../src/lib/world-engine/scope'

const PACKAGE_OPTIONS = {
  authorName: '边界测试作者',
  license: 'CC-BY-4.0' as const,
  allowedUses: { writing: true, ttrpg: true, characterChat: true, textGame: true },
}

function projectInput(name: string) {
  return {
    name,
    genre: 'other',
    genres: ['other'],
    status: 'drafting' as const,
    description: '',
    targetWordCount: 100_000,
    enableMultiWorld: false,
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
    .map(key => [key, canonicalize((value as Record<string, unknown>)[key])]))
}

async function sha(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function worldview(scope: { projectId: number; worldId: number; workId: number }, now: number): Worldview {
  return stampNewRecord(scope, 'worldviews', {
    projectId: scope.projectId,
    geography: '', history: '', society: '', culture: '', economy: '', rules: '',
    summary: '纯语义世界摘要', races: '潮民与羽民', createdAt: now, updatedAt: now,
  }, { owner: 'world' })
}

async function seedMixedWorld(name = '混合旧世界') {
  const created = await createWorkspace(projectInput(name), {
    purpose: 'world-engine', kind: 'novel', novelProfile: 'long',
  })
  const now = Date.now()
  await db.worldviews.add(worldview(created.scope, now))
  const moduleId = await db.narrativeModules.add(stampNewRecord(created.scope, 'narrativeModules', {
    projectId: created.scope.projectId,
    worldId: null,
    workId: created.scope.workId,
    kind: 'main',
    title: '旧产品主线',
    description: '',
    status: 'ready',
    sourceProjection: 'custom',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as any) as number
  await db.gameDefinitions.add(stampNewRecord(created.scope, 'gameDefinitions', {
    projectId: created.scope.projectId,
    worldId: created.scope.worldId,
    workId: created.scope.workId,
    gameKey: 'legacy-game',
    productType: 'storygame',
    title: '旧文字游戏',
    description: '',
    status: 'draft',
    narrativeModuleId: moduleId,
    enabledCapabilitiesJson: '["narrative"]',
    initialVariablesJson: '{}',
    rulesetVersion: 1,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }))
  await db.avgMediaAssets.add(stampNewRecord(created.scope, 'avgMediaAssets', {
    projectId: created.scope.projectId,
    worldId: created.scope.worldId,
    workId: created.scope.workId,
    assetKey: 'legacy-bg', version: 1, kind: 'background', name: '旧背景', mimeType: 'image/png',
    byteSize: 10, width: 1, height: 1, durationMs: null, contentHash: 'a'.repeat(64),
    source: 'legacy', license: 'private', altText: '', characterTag: '', sceneTag: '',
    createdAt: now, updatedAt: now,
  }, { owner: 'work' }))
  return created
}

async function legacyMixedPackage(): Promise<WorldPackageV2> {
  const source = await seedMixedWorld()
  const portable = await exportProjectJSON(source.scope.projectId) as unknown as Record<string, unknown>
  const selectedTables = ['worldviews', 'narrativeModules', 'gameDefinitions', 'avgMediaAssets']
  const records = Object.fromEntries(selectedTables.map(table => [table, portable[table] as unknown[]]))
  const dependencies = await Promise.all(selectedTables.map(async table => ({
    table,
    rowCount: records[table].length,
    contentHash: await sha(JSON.stringify(canonicalize(records[table]))),
  })))
  const releaseManifest: WorldReleaseManifestV2 = {
    schema: 'storyforge.world-package',
    version: 2,
    worldCode: source.world.code,
    worldName: source.world.name,
    workTitle: source.work.title,
    selectedTables,
    selectedNarrativeModules: [{ exportId: 0, kind: 'main', title: '旧产品主线' }],
    dependencies,
    records,
    portableProject: portable,
  }
  const releaseHash = await sha(stableJson(releaseManifest))
  const manifest = {
    packageId: `${source.world.code}@v1`,
    sourceWorldCode: source.world.code,
    sourceWorldVersion: 1,
    name: source.world.name,
    description: '旧混合发布',
    authorName: '旧作者',
    attribution: '旧作者',
    license: 'CC-BY-4.0' as const,
    allowedUses: { writing: true, ttrpg: true, characterChat: true, textGame: true },
    contentWarnings: [],
    publishedAt: 1,
    releaseHash,
    narrativeModules: releaseManifest.selectedNarrativeModules,
  }
  const withoutIntegrity = {
    format: 'storyforge.world-package' as const,
    packageVersion: 2 as const,
    manifest,
    release: { label: '旧版', version: 1, contentHash: releaseHash, manifest: releaseManifest },
  }
  return {
    ...withoutIntegrity,
    integrity: {
      algorithm: 'SHA-256',
      digest: await sha(JSON.stringify(canonicalize(withoutIntegrity))),
    },
  }
}

describe('ARCH-02 · WorldRelease 纯语义边界与旧包迁移', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('新修订只封存注册语义资源，分享与导入均拒绝产品/媒资渗漏', async () => {
    const source = await seedMixedWorld('新纯语义世界')
    const revision = await createWorldRevision({ scope: source.scope, label: '纯语义修订' })
    const release = await publishWorldRevision(revision.id!)
    const frozen = JSON.parse(release.manifestJson) as WorldReleaseManifestV2
    expect(frozen.semanticContract).toBe(3)
    expect(frozen.selectedTables).toContain('worldviews')
    expect(frozen.selectedTables).not.toContain('narrativeModules')
    expect(frozen.selectedTables).not.toContain('gameDefinitions')
    expect(frozen.selectedTables).not.toContain('avgMediaAssets')
    expect(frozen.selectedNarrativeModules).toEqual([])

    const pkg = await createWorldPackageV2(release.id!, PACKAGE_OPTIONS)
    const report = await inspectWorldPackage(pkg)
    expect(report.valid, report.errors.join('；')).toBe(true)
    expect(report.importable).toBe(true)
    expect(report.migrationRequired).toBe(false)
    expect(report.classification?.contract).toBe('semantic-v3')

    const importedId = await importWorldPackage(pkg)
    expect(await db.worldviews.where('projectId').equals(importedId).count()).toBe(1)
    expect(await db.gameDefinitions.where('projectId').equals(importedId).count()).toBe(0)
    expect(await db.avgMediaAssets.where('projectId').equals(importedId).count()).toBe(0)
    await expect(createWorldPackage(source.scope.projectId, PACKAGE_OPTIONS)).rejects.toThrow('v1 仅供历史读取与迁移')
  })

  it('旧混合包只读分类后拆为纯语义世界与独立产品恢复工作区，不静默丢数据', async () => {
    const pkg = await legacyMixedPackage()
    const report = await inspectWorldPackage(pkg)
    expect(report.valid, report.errors.join('；')).toBe(true)
    expect(report.importable).toBe(false)
    expect(report.migrationRequired).toBe(true)
    expect(report.classification?.tables.find(table => table.table === 'worldviews')?.role).toBe('world-semantic')
    expect(report.classification?.tables.find(table => table.table === 'gameDefinitions')?.role).toBe('product-content')
    expect(report.classification?.tables.find(table => table.table === 'avgMediaAssets')?.role).toBe('product-media')
    await expect(importWorldPackage(pkg)).rejects.toThrow('需要先执行分类迁移')

    const migrated = await migrateLegacyWorldPackageV1(pkg)
    const semanticManifest = JSON.parse((await db.worldReleases.get(migrated.semanticReleaseId))!.manifestJson) as WorldReleaseManifestV2
    expect(semanticManifest.semanticContract).toBe(3)
    expect(semanticManifest.selectedTables).not.toContain('gameDefinitions')
    expect(await db.gameDefinitions.where('projectId').equals(migrated.semanticProjectId).count()).toBe(0)
    expect(await db.avgMediaAssets.where('projectId').equals(migrated.semanticProjectId).count()).toBe(0)
    expect(migrated.productRecoveryProjectId).not.toBeNull()
    expect(await db.gameDefinitions.where('projectId').equals(migrated.productRecoveryProjectId!).count()).toBe(1)
    expect(await db.avgMediaAssets.where('projectId').equals(migrated.productRecoveryProjectId!).count()).toBe(1)
    expect(await db.worldReleaseMigrations.get(migrated.receipt.id!)).toMatchObject({
      semanticReleaseId: migrated.semanticReleaseId,
      productRecoveryWorkspaceUid: expect.any(String),
    })
  })
})
