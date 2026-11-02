import { expect, test, type BrowserContext } from '@playwright/test'

test('SFQA021 F1: real IndexedDB rejects altered declarations and preserves their bytes through backup, fresh storage and reload', async ({ page, browser, context, baseURL }) => {
  if (!baseURL) throw new Error('Expected the isolated browser origin')
  const allowedOrigin = new URL(baseURL).origin, externalRequests: string[] = []
  const isolate = async (target: BrowserContext) => {
    await target.addInitScript(() => { localStorage.setItem('storyforge_guide_completed', 'e2e') })
    await target.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== allowedOrigin) {
        externalRequests.push(url.origin); await route.abort(); return
      }
      await route.continue()
    })
  }
  await isolate(context)
  await page.goto('./world/worlds')
  const seed = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [{ createSfqa021WorldSharingCarrierV1 }, { db }, { PROJECT_TABLES }, { exportProjectJSON, importProjectJSON }, { inspectCommunityWorldOriginV1 }] = await Promise.all([
      load<typeof import('../helpers/sfqa021-world-sharing-carrier')>('/storyforge/tests/helpers/sfqa021-world-sharing-carrier.ts'),
      load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
      load<typeof import('../../src/lib/registry/project-tables')>('/storyforge/src/lib/registry/project-tables.ts'),
      load<typeof import('../../src/lib/export/json-export')>('/storyforge/src/lib/export/json-export.ts'),
      load<typeof import('../../src/lib/world-engine/source-declaration')>('/storyforge/src/lib/world-engine/source-declaration.ts'),
    ])
    const f = await createSfqa021WorldSharingCarrierV1(5)
    const originalPacket = JSON.stringify(f.pkg), originalRelease = f.release.manifestJson
    const backup = await exportProjectJSON(f.target.scope.projectId), corrupt = structuredClone(backup)
    const origin = corrupt.worlds[0].communityOrigin
    if (!origin) throw new Error('Missing the real World origin carrier')
    Reflect.set(origin, 'attribution', '实际存储必须拒绝的署名篡改')
    const counts = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    let rejected = ''
    try { await importProjectJSON(corrupt) } catch (cause) { rejected = String(cause) }
    const countsAfter = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    const restoredProjectId = await importProjectJSON(backup)
    const restored = await db.worlds.where('projectId').equals(restoredProjectId).first()
    const inspection = inspectCommunityWorldOriginV1(restored?.communityOrigin)
    return { backupJson: JSON.stringify(backup), origin: f.origin, counts, countsAfter, rejected, restoredProjectId,
      originalWorldId: f.target.scope.worldId, restoredWorldId: restored?.id,
      restoredOrigin: restored?.communityOrigin, status: inspection.status,
      declarationHash: inspection.declaration?.declarationHash,
      originalReleasePreserved: (await db.worldReleases.get(f.release.id!))?.manifestJson === originalRelease,
      packetUnchanged: JSON.stringify(f.pkg) === originalPacket, runs: await db.agentRuns.count() }
  })
  expect(seed.rejected).toContain('communityOrigin')
  expect(seed.countsAfter).toEqual(seed.counts)
  expect(seed.restoredWorldId).not.toBe(seed.originalWorldId)
  expect(seed.restoredOrigin).toEqual(seed.origin)
  expect(seed.status).toBe('self-consistent')
  expect(seed.originalReleasePreserved).toBe(true); expect(seed.packetUnchanged).toBe(true); expect(seed.runs).toBe(0)

  const fresh = await browser.newContext({ baseURL })
  try {
    await isolate(fresh)
    const receiver = await fresh.newPage()
    await receiver.goto('./world/worlds')
    const restored = await receiver.evaluate(async (backupJson: string) => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const [{ db }, { importProjectJSON }, { inspectCommunityWorldOriginV1 }] = await Promise.all([
        load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
        load<typeof import('../../src/lib/export/json-export')>('/storyforge/src/lib/export/json-export.ts'),
        load<typeof import('../../src/lib/world-engine/source-declaration')>('/storyforge/src/lib/world-engine/source-declaration.ts'),
      ])
      const before = await db.projects.count(), id = await importProjectJSON(JSON.parse(backupJson))
      const world = await db.worlds.where('projectId').equals(id).first()
      const report = inspectCommunityWorldOriginV1(world?.communityOrigin)
      return { before, origin: world?.communityOrigin, status: report.status,
        declarationHash: report.declaration?.declarationHash, runs: await db.agentRuns.count() }
    }, seed.backupJson)
    expect(restored.before).toBe(0)
    expect(restored.origin).toEqual(seed.origin)
    expect(restored.status).toBe('self-consistent')
    expect(restored.declarationHash).toBe(seed.declarationHash)
    expect(restored.runs).toBe(0)
  } finally { await fresh.close() }

  await page.reload()
  const afterReload = await page.evaluate(async projectId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")') as () => Promise<typeof import('../../src/lib/db/schema')>)()
    return (await db.worlds.where('projectId').equals(projectId).first())?.communityOrigin
  }, seed.restoredProjectId)
  expect(afterReload).toEqual(seed.origin)
  expect(externalRequests).toEqual([])
})
