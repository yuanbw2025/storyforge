import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { createWorldPackage, importWorldPackage, inspectWorldPackage, inspectWorldPackageMetadata, WORLD_PACKAGE_USES, type WorldPackageManifest } from '../../src/lib/world-engine/world-package'

const uses = Object.fromEntries(WORLD_PACKAGE_USES.map(key => [key, true])) as Record<(typeof WORLD_PACKAGE_USES)[number], boolean>
const metadata: WorldPackageManifest = { packageId: 'W-fixture@v1', sourceWorldCode: 'W-fixture', sourceWorldVersion: 1, name: '世界', description: '说明', authorName: '作者', attribution: '精确署名', license: 'CC-BY-4.0', allowedUses: uses, contentWarnings: [], publishedAt: 1, releaseHash: 'a'.repeat(64) }

describe.each([3, 4, 5])('SFQA-020 · version %i metadata codec', version => {
  it('accepts the exact 200/12, 500 and 2000 boundaries without altering declarations', () => {
    const manifest = { ...metadata, description: '说'.repeat(2000), attribution: '署'.repeat(500), contentWarnings: Array.from({ length: 12 }, () => '警'.repeat(200)) }
    const original = structuredClone(manifest)
    expect(inspectWorldPackageMetadata(manifest, version)).toEqual({ manifest, errors: [] })
    expect(manifest).toEqual(original)
  })
  it.each([
    { contentWarnings: ['警'.repeat(201)] },
    { contentWarnings: Array.from({ length: 13 }, () => '警告') },
    { attribution: '署'.repeat(501) },
    { description: '说'.repeat(2001) },
    { authorName: '  ' },
    { allowedUses: { ttrpg: true } },
    { allowedUses: { ...uses, extra: true } },
    { allowedUses: { ...uses, ttrpg: 'true' } },
    { allowedUses: Object.fromEntries(WORLD_PACKAGE_USES.map(key => [key, false])) },
  ])('rejects invalid declarations %j', patch => {
    const report = inspectWorldPackageMetadata({ ...metadata, ...patch }, version)
    expect(report.manifest).toBeNull()
    expect(report.errors.length).toBeGreaterThan(0)
  })
})

describe('SFQA-020 · production and self-inspection use the same contract', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  async function release(formatVersion: 3 | 4, label = '元数据测试封存') {
    const fixture = await seedCurrentWorkspace('分享元数据测试', { purpose: 'world-engine' })
    const revision = await createWorldRevision({ scope: fixture.scope, label, formatVersion })
    return { fixture, release: await publishWorldRevision(revision.id!) }
  }
  it.each([3, 4, 5])('successful v%i export inspects and imports in isolation; installed release bytes stay exact', async version => {
    const seeded = await release(version === 3 ? 3 : 4)
    const original = seeded.release.manifestJson
    const pkg = await createWorldPackage(seeded.release.id!, {
      authorName: '作者', attribution: '  精确署名 · Unicode 雾港  ', license: 'CC-BY-4.0', allowedUses: { ...uses, avg: false },
      contentWarnings: Array.from({ length: 12 }, (_, index) => `${index}`.padEnd(200, '警')),
      ...(version === 5 ? { transport: 'dictionary-v1' as const } : {}),
    })
    expect(pkg.packageVersion).toBe(version)
    expect((await inspectWorldPackage(pkg)).valid).toBe(true)
    expect(pkg.manifest.attribution).toBe('  精确署名 · Unicode 雾港  ')
    const packageBefore = JSON.stringify(pkg)
    await db.delete(); await db.open()
    const projectId = await importWorldPackage(pkg)
    expect((await db.worldReleases.where('projectId').equals(projectId).first())?.manifestJson).toBe(original)
    expect(JSON.stringify(pkg)).toBe(packageBefore)
  })
  it('rejects 201 characters or 13 warnings before any download rather than clipping input', async () => {
    const seeded = await release(3)
    for (const warnings of [['警'.repeat(201)], Array.from({ length: 13 }, () => '警告')]) {
      const before = [...warnings]
      await expect(createWorldPackage(seeded.release.id!, { authorName: '作者', license: 'CC-BY-4.0', allowedUses: uses, contentWarnings: warnings })).rejects.toThrow('最多 12 条，每条最多 200 字')
      expect(warnings).toEqual(before)
    }
  })
  it('rejects overflowing default attribution but does not invent a new author-name length cap', async () => {
    const seeded = await release(3)
    const authorName = '名'.repeat(500)
    await expect(createWorldPackage(seeded.release.id!, { authorName, license: 'CC-BY-4.0', allowedUses: uses })).rejects.toThrow('署名说明')
    const pkg = await createWorldPackage(seeded.release.id!, { authorName, attribution: '作者提供的简短署名', license: 'CC-BY-4.0', allowedUses: uses })
    expect((await inspectWorldPackage(pkg)).valid).toBe(true)
    expect(pkg.manifest.authorName).toBe(authorName)
  })
  it('rejects an overflowing frozen release label as description without changing the release', async () => {
    const seeded = await release(3, '说'.repeat(2001))
    await expect(createWorldPackage(seeded.release.id!, { authorName: '作者', license: 'CC-BY-4.0', allowedUses: uses })).rejects.toThrow('分享说明')
    expect(await db.worldReleases.get(seeded.release.id!)).toEqual(seeded.release)
  })
})
