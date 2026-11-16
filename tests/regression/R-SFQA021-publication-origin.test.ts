import { afterEach, beforeEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createWorldPackage } from '../../src/lib/world-engine/world-package'
import { installWorldSourcePackageV1 } from '../../src/lib/world-engine/source-receipt'
import { createWorldRevision, publishWorldRevision, sealPreparedNarrativeWorldRevisionV4 } from '../../src/lib/world-engine/releases'
import { captureWorldReleaseInputV4 } from '../../src/lib/world-engine/narrative-release-capture'
import { compileWorldReleaseContentV4 } from '../../src/lib/world-engine/narrative-release-v4'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())
const metadata = { authorName: '合成作者', attribution: '保留声明', license: 'CC-BY-4.0', contentWarnings: [],
  allowedUses: { 'world-remix': true, ttrpg: false, 'character-interaction': false,
    'ai-town': false, 'text-adventure': false, avg: true, 'text-open-world': false } } satisfies Parameters<typeof createWorldPackage>[1]

async function sameCodeCache() {
  const producer = await seedCurrentProductWorld('外部设备的实际发布')
  const world = await db.worlds.get(producer.scope.worldId)
  const wire = await createWorldPackage(producer.release.id!, metadata)
  await db.delete(); await db.open()
  const target = await createWorkspace({ name: '接收世界', description: '', genres: ['other'],
    status: 'drafting', targetWordCount: 0 }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  await db.worlds.update(target.scope.worldId, { code: world!.code })
  const installed = await installWorldSourcePackageV1(target.scope, wire)
  const cached = await db.worldReleases.get(installed.worldReleaseId)
  return { target, installed, cached: cached!, wire }
}

it('cannot re-sign an externally cached R when its public world code matches the receiver', async () => {
  const { installed } = await sameCodeCache()
  await expect(createWorldPackage(installed.worldReleaseId, { ...metadata, authorName: '冒充接收作者' }))
    .rejects.toThrow(/外来冻结缓存|本地封存|作者来源/)
})

it('cannot promote that readonly cached revision through the real publish API', async () => {
  const { cached } = await sameCodeCache()
  await expect(publishWorldRevision(cached.revisionId)).rejects.toThrow(/只读|本地封存|作者来源/)
})

it('keeps the actual author publication usable through legacy and repeated same-database restores without rewriting frozen bytes', async () => {
  const author = await seedCurrentProductWorld('完整原作者备份')
  const original = author.release.manifestJson
  // A genuine pre-origin backup: the full frozen author roots and chain exist.
  const legacy = await exportProjectJSON(author.scope.projectId)
  for (const row of legacy.worldRevisions) Reflect.deleteProperty(row, 'publicationOrigin')
  const once = await importProjectJSON(legacy)
  const first = (await db.worldReleases.where('projectId').equals(once).toArray())[0]
  expect(first.manifestJson).toBe(original)
  expect((await db.projects.get(once))?.workspaceUid).not.toBe((await db.projects.get(author.scope.projectId))?.workspaceUid)
  await expect(createWorldPackage(first.id!, metadata)).resolves.toHaveProperty('manifest')
  const twice = await importProjectJSON(await exportProjectJSON(once))
  const second = (await db.worldReleases.where('projectId').equals(twice).toArray())[0]
  expect(second.manifestJson).toBe(original)
  await expect(createWorldPackage(second.id!, metadata)).resolves.toHaveProperty('manifest')
})

it('preserves foreign same-code cached bytes through backup without promoting its origin', async () => {
  const { target, cached } = await sameCodeCache()
  const restored = await importProjectJSON(await exportProjectJSON(target.scope.projectId))
  const copy = (await db.worldReleases.where('projectId').equals(restored).toArray())[0]
  expect(copy.manifestJson).toBe(cached.manifestJson)
  await expect(createWorldPackage(copy.id!, metadata)).rejects.toThrow(/外来冻结缓存|本地封存|作者来源/)
})

it('does not infer authority for an unmarked legacy foreign cache from the matching public code', async () => {
  const { target, cached } = await sameCodeCache()
  const legacy = await exportProjectJSON(target.scope.projectId)
  for (const row of legacy.worldRevisions) Reflect.deleteProperty(row, 'publicationOrigin')
  const restored = await importProjectJSON(legacy)
  const copy = (await db.worldReleases.where('projectId').equals(restored).toArray())[0]
  expect(copy.manifestJson).toBe(cached.manifestJson)
  await expect(createWorldPackage(copy.id!, metadata)).rejects.toThrow(/外来冻结缓存|本地封存|作者来源/)
})

it('a transported author marker alone cannot grant a foreign cache author ownership at either import boundary', async () => {
  const { target } = await sameCodeCache()
  const backup = await exportProjectJSON(target.scope.projectId)
  Reflect.set(backup.worldRevisions[0].publicationOrigin!, 'kind', 'author-seal')
  const before = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
  const bytes = JSON.stringify(backup)
  await expect(importProjectJSON(backup)).rejects.toThrow(/作者来源|owner/)
  await expect(deriveImportProjectJSON(backup)).rejects.toThrow(/作者来源|owner/)
  expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(before)
  expect(JSON.stringify(backup)).toBe(bytes)
})

it.each(['unknown-key', 'wrong-hash'] as const)('rejects %s in the origin record without any import writes', async kind => {
  const f = await seedCurrentProductWorld('来源完整性')
  const backup = await exportProjectJSON(f.scope.projectId)
  const origin = backup.worldRevisions[0].publicationOrigin!
  if (kind === 'unknown-key') Reflect.set(origin, 'localAuthor', true)
  else origin.contentHash = 'f'.repeat(64)
  const before = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
  await expect(importProjectJSON(backup)).rejects.toThrow(/来源记录/)
  await expect(deriveImportProjectJSON(backup)).rejects.toThrow(/来源记录/)
  expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(before)
})

it('stamps real V3 and prepared V4 author seals outside unchanged semantic bytes and keeps repeat publishing idempotent', async () => {
  const f = await seedCurrentProductWorld('实际封存 writer')
  const v3 = await createWorldRevision({ scope: f.scope, label: 'V3 新封存' })
  expect(v3.publicationOrigin).toMatchObject({ kind: 'author-seal', contentHash: v3.contentHash })
  const capture = await captureWorldReleaseInputV4({ scope: f.scope })
  const compiled = await compileWorldReleaseContentV4(capture.input)
  const v4 = await sealPreparedNarrativeWorldRevisionV4({ scope: f.scope, label: 'V4 准备后封存',
    capturedInput: capture.input, result: compiled })
  expect(v4.manifestJson).toBe(compiled.manifestJson)
  expect(v4.publicationOrigin).toMatchObject({ kind: 'author-seal', contentHash: compiled.contentHash })
  const published = await publishWorldRevision(v4.id!)
  expect((await publishWorldRevision(v4.id!)).id).toBe(published.id)
  await expect(createWorldPackage(published.id!, metadata)).resolves.toHaveProperty('manifest')
})
