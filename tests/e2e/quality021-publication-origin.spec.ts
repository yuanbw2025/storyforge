import { expect, test } from '@playwright/test'

test('SFQA021: a same-code foreign cache remains readonly across real browser backup/reload while an author restore stays usable', async ({ page, context, browser, baseURL }) => {
  if (!baseURL) throw Error('Missing isolated browser URL')
  const localOrigin = new URL(baseURL).origin
  const isolate = async (target: typeof context) => {
    await target.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
    await target.route('**/*', route => {
      const url = new URL(route.request().url())
      return ['http:', 'https:'].includes(url.protocol) && url.origin !== localOrigin ? route.abort() : route.continue()
    })
  }
  await isolate(context)
  await page.goto('./world/worlds')
  const payload = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as <T>(p: string) => Promise<T>
    const { seedCurrentProductWorld } = await load<typeof import('../helpers/current-product-world')>('/storyforge/tests/helpers/current-product-world.ts')
    const { createWorldPackage } = await load<typeof import('../../src/lib/world-engine/world-package')>('/storyforge/src/lib/world-engine/world-package.ts')
    const { exportProjectJSON } = await load<typeof import('../../src/lib/export/json-export')>('/storyforge/src/lib/export/json-export.ts')
    const author = await seedCurrentProductWorld('浏览器真实封存作者')
    const metadata = { authorName: '合成外部作者', attribution: '保留原声明', license: 'CC-BY-4.0', contentWarnings: [],
      allowedUses: { 'world-remix': true, ttrpg: false, 'character-interaction': false, 'ai-town': false,
        'text-adventure': false, avg: true, 'text-open-world': false } } satisfies Parameters<typeof createWorldPackage>[1]
    const wire = await createWorldPackage(author.release.id!, metadata)
    return JSON.stringify({ wire, metadata, authorBackup: await exportProjectJSON(author.scope.projectId) })
  })
  const fresh = await browser.newContext({ baseURL })
  try {
    await isolate(fresh)
    const receiver = await fresh.newPage()
    await receiver.goto('./world/worlds')
    const result = await receiver.evaluate(async payload => {
      const data = JSON.parse(payload)
      const load = new Function('p', 'return import(p)') as <T>(p: string) => Promise<T>
      const [{ db }, workspaces, packages, receipts, releases, backups] = await Promise.all([
        load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
        load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts'),
        load<typeof import('../../src/lib/world-engine/world-package')>('/storyforge/src/lib/world-engine/world-package.ts'),
        load<typeof import('../../src/lib/world-engine/source-receipt')>('/storyforge/src/lib/world-engine/source-receipt.ts'),
        load<typeof import('../../src/lib/world-engine/releases')>('/storyforge/src/lib/world-engine/releases.ts'),
        load<typeof import('../../src/lib/export/json-export')>('/storyforge/src/lib/export/json-export.ts'),
      ])
      const target = await workspaces.createWorkspace({ name: '同编号接收世界', description: '', genres: ['other'],
        status: 'drafting', targetWordCount: 0 }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
      await db.worlds.update(target.scope.worldId, { code: data.wire.manifest.sourceWorldCode })
      const stored = await receipts.installWorldSourcePackageV1(target.scope, data.wire)
      const cached = (await db.worldReleases.get(stored.worldReleaseId))!
      let repack = '', publish = ''
      try { await packages.createWorldPackage(cached.id!, data.metadata) } catch (error) { repack = String(error) }
      try { await releases.publishWorldRevision(cached.revisionId) } catch (error) { publish = String(error) }
      const restored = await backups.importProjectJSON(await backups.exportProjectJSON(target.scope.projectId))
      const copied = (await db.worldReleases.where('projectId').equals(restored).toArray())[0]
      let restoredRepack = ''
      try { await packages.createWorldPackage(copied.id!, data.metadata) } catch (error) { restoredRepack = String(error) }
      const authorId = await backups.importProjectJSON(data.authorBackup)
      const authorRelease = (await db.worldReleases.where('projectId').equals(authorId).toArray())[0]
      const authorPacket = await packages.createWorldPackage(authorRelease.id!, data.metadata)
      return { repack, publish, restoredRepack, restoredId: copied.id!, originalBytes: cached.manifestJson,
        sameBytes: copied.manifestJson === cached.manifestJson, authorHash: authorPacket.manifest.releaseHash,
        expectedAuthorHash: data.wire.manifest.releaseHash, runs: await db.agentRuns.count() }
    }, payload)
    expect(result.repack).toContain('外来冻结缓存')
    expect(result.publish).toContain('只读缓存')
    expect(result.restoredRepack).toContain('外来冻结缓存')
    expect(result.sameBytes).toBe(true)
    expect(result.authorHash).toBe(result.expectedAuthorHash)
    expect(result.runs).toBe(0)
    await receiver.reload()
    const readback = await receiver.evaluate(async id => {
      const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")') as () => Promise<typeof import('../../src/lib/db/schema')>)()
      const row = await db.worldReleases.get(id)
      const revision = await db.worldRevisions.get(row!.revisionId)
      return { bytes: row!.manifestJson, origin: revision!.publicationOrigin!.kind }
    }, result.restoredId)
    expect(readback).toEqual({ bytes: result.originalBytes, origin: 'reference-cache' })
  } finally { await fresh.close() }
})
