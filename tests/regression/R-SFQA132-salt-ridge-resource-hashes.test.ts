import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openWorldSemanticResourceCatalogV1 } from '../../src/lib/context-gateway/world-release-client'
import { db } from '../../src/lib/db/schema'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { compileTextOpenWorldPlayerFromWorldReleaseV1 } from '../../src/lib/open-world/player-definition'
import { readProductRuntimeState } from '../../src/lib/open-world/runtime-api'
import { assertProductReleaseUnchanged, parseAnyProductReleaseManifest } from '../../src/lib/product/releases'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { verifyProductReleaseManifest } from '../../src/lib/product-production/runtime-package'
import type { WorkspaceScope } from '../../src/lib/types'
import SaltRidgePage from '../../src/pages/SaltRidgePage'
import { saltRidgeShowcase } from '../../src/lib/salt-ridge/production'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

// Keep the actual landing page, installation and native-format rows under
// test; this leaf observes which session is handed to the full game player.
vi.mock('../../src/components/text-game/TextOpenWorldPlayer', () => ({
  default: ({ initialSessionId }: { initialSessionId: number }) => createElement('div', {
    'data-testid': 'salt-ridge-opened-session', 'data-session-id': initialSessionId,
  }),
}))

let network: ReturnType<typeof vi.fn>
beforeEach(async () => {
  await db.delete()
  await db.open()
  network = vi.fn(async () => { throw Error('SFQA-132 prohibits network and model calls') })
  vi.stubGlobal('fetch', network)
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await db.delete()
})

it('publishes the actual frozen resources through the public showcase and lets the public character compiler use them', async () => {
  const installed = await saltRidgeShowcase.install()
  await assertProductReleaseUnchanged(installed.releaseId)
  const release = await db.productReleases.get(installed.releaseId)
  if (!release || release.worldReleaseId == null) throw Error('public installer did not publish a sourced ProductRelease')
  const published = parseAnyProductReleaseManifest(release.manifestJson)
  const inner = published.textOpenWorldVNext
  if (!inner) throw Error('public installer did not publish a vNext package')
  const catalog = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: release.worldReleaseId,
    expectedProjectId: installed.scope.projectId,
    expectedWorldId: installed.scope.worldId,
  })
  const resources = new Map(catalog.resources.map(row => [row.resourceKey, row]))
  const keys = published.sourceWorld.selection.resourceKeys
  const comparison = inner.sourceManifest.resourceHashes.map(row => resources.get(row.resourceId)?.contentHash === row.contentHash)
  expect(inner.sourceManifest.contentHash).toBe(published.sourceWorld.contentHash)
  expect(inner.sourceManifest.sourceVersion).toBe(catalog.description.worldReference.releaseVersion)
  expect(inner.sourceManifest.selectionHash).toBe(await hashProductProductionValueV2(published.sourceWorld.selection))
  expect(inner.sourceManifest.selectionHash).not.toBe(published.sourceWorld.selection.worldReferenceHash)
  expect(inner.sourceManifest.resourceHashes.map(row => row.resourceId)).toEqual(keys)
  expect(comparison).toHaveLength(32)

  const modules = parseTextOpenWorldModulesV1(inner)
  expect(modules.quests.quests.length).toBeGreaterThanOrEqual(2)
  expect(modules.narrative.endings).toHaveLength(2)
  const session = await createTextOpenWorldInstance({
    scope: installed.scope, productReleaseId: installed.releaseId, title: '132 隔离展示存档',
  })
  expect(session.productReleaseId).toBe(installed.releaseId)
  expect(network).not.toHaveBeenCalled()

  const character = keys.map(key => resources.get(key)).find(row => row?.kind === 'character')
  if (!character) throw Error('fixture has no selected frozen character')
  const input = {
    scope: installed.scope, worldReleaseId: release.worldReleaseId, resourceId: character.resourceKey,
    runtimePackage: inner, build: modules.actors.player.build,
  }
  let compiledSource: string[] | string
  try {
    compiledSource = (await compileTextOpenWorldPlayerFromWorldReleaseV1(input)).identity.sourceRefs
  } catch (error) { compiledSource = String(error) }
  expect({ matches: comparison.filter(Boolean).length, compiledSource }).toEqual({
    matches: 32, compiledSource: [character.resourceKey],
  })

  for (const defect of ['wrong-hash', 'missing'] as const) {
    const invalid = structuredClone(inner)
    invalid.sourceManifest.resourceHashes = invalid.sourceManifest.resourceHashes.flatMap(row => {
      if (row.resourceId !== character.resourceKey) return [row]
      return defect === 'missing' ? [] : [{ ...row, contentHash: inner.sourceManifest.contentHash }]
    })
    await expect(compileTextOpenWorldPlayerFromWorldReleaseV1({ ...input, runtimePackage: invalid }))
      .rejects.toThrow(/资源Hash证据/)
  }
  expect(network).not.toHaveBeenCalled()
}, 120_000)


async function restoreOriginalInstall() {
  const prefix = resolve('tests/fixtures/salt-ridge/sfqa132-original-public-install')
  const bytes = readFileSync(`${prefix}.json.gz`)
  const provenance = JSON.parse(readFileSync(`${prefix}.provenance.json`, 'utf8'))
  const raw = gunzipSync(bytes)
  const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
  expect(digest(bytes)).toBe(provenance.compressedSHA256)
  expect(digest(raw)).toBe(provenance.uncompressedSHA256)
  const fixture = JSON.parse(raw.toString('utf8')) as {
    baseline: string
    installed: { scope: WorkspaceScope; releaseId: number }
    sessionId: number
    tables: Record<string, object[]>
  }
  expect(fixture.baseline).toBe(provenance.baselineCommit)
  expect(await db.projects.count()).toBe(0)
  // Restore the bytes/IDs as they existed on disk in an older install. This
  // intentionally does not run export/import or claim to test ID remapping.
  await db.transaction('rw', db.tables, async () => {
    for (const [table, rows] of Object.entries(fixture.tables)) await db.table(table).bulkAdd(rows)
  })
  const release = await assertProductReleaseUnchanged(fixture.installed.releaseId)
  expect(digest(release.manifestJson)).toBe(provenance.originalManifestSHA256)
  return { ...fixture, release }
}

it('continues the actual old save and starts a distinct corrected version only on explicit new journey', async () => {
  const { installed, sessionId, release: oldRelease } = await restoreOriginalInstall()
  const oldSession = await db.productRuntimeSessions.get(sessionId)
  const oldRuntime = await readProductRuntimeState(sessionId)
  if (oldRelease.worldReleaseId == null) throw Error('fixture lost its frozen WorldRelease locator')
  const oldWorld = await db.worldReleases.get(oldRelease.worldReleaseId)
  const oldManifest = await verifyProductReleaseManifest(oldRelease.manifestJson)
  const oldBuild = await db.productBuilds.toCollection().first()
  const oldSource = parseAnyProductReleaseManifest(oldRelease.manifestJson).textOpenWorldVNext!.sourceManifest
  expect(oldSource.resourceHashes.every(row => row.contentHash === oldSource.contentHash)).toBe(true)
  expect(oldSession?.productReleaseId).toBe(oldRelease.id)

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const button = (text: string) => [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === text)
  const playerSession = () => host.querySelector('[data-testid="salt-ridge-opened-session"]')?.getAttribute('data-session-id')
  const waitFor = async (assertion: () => unknown) => {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
      try { assertion(); return } catch { /* wait for the page's actual async read or write */ }
    }
    assertion()
  }
  const render = async () => {
    await act(async () => { root.render(createElement(MemoryRouter, null, createElement(SaltRidgePage))) })
    await waitFor(() => expect(button('继续最近旅程')).toBeDefined())
  }
  const click = async (text: string, done: () => unknown) => {
    const node = button(text)
    if (!node) throw Error(`缺少盐脊按钮：${text}`)
    await act(async () => { node.click() })
    await waitFor(done)
  }
  try {
    await render()
    await click('继续最近旅程', () => expect(playerSession()).toBe(String(sessionId)))
    expect(await db.productReleases.count()).toBe(1)
    expect(await db.productRuntimeSessions.count()).toBe(1)
    expect(await db.productRuntimeSessions.get(sessionId)).toEqual(oldSession)
    await click('返回作品介绍', () => expect(button('开启新旅程')).toBeDefined())
    await click('开启新旅程', () => expect(playerSession(), host.querySelector('[role="alert"]')?.textContent).toMatch(/^\d+$/))
    const newSessionId = Number(playerSession())
    expect(newSessionId).not.toBe(sessionId)
    const newSession = await db.productRuntimeSessions.get(newSessionId)
    expect(newSession?.productReleaseId).not.toBe(oldRelease.id)
    expect((await readProductRuntimeState(newSessionId)).textOpenWorld).not.toBeNull()
    const newRelease = await assertProductReleaseUnchanged(newSession!.productReleaseId!)
    const newManifest = await verifyProductReleaseManifest(newRelease.manifestJson)
    expect(newRelease.productionKey).toBe(oldRelease.productionKey)
    expect(newRelease.worldReleaseId).toBe(oldRelease.worldReleaseId)
    expect(newRelease.version).toBe(oldRelease.version + 1)
    expect(newManifest.lineage.parentRelease).toEqual({
      releaseUid: oldManifest.lineage.releaseUid, releaseHash: oldManifest.lineage.releaseHash,
    })
    const builds = await db.productBuilds.where('productionId').equals(oldBuild!.productionId).sortBy('buildNumber')
    expect(builds).toHaveLength(2)
    expect(builds[1]).toMatchObject({
      parentBuildNumber: oldBuild!.buildNumber, sourceProductReleaseId: oldRelease.id, releasedProductReleaseId: newRelease.id,
    })
    expect(await db.productReleases.count()).toBe(2)
    expect(await db.productRuntimeSessions.count()).toBe(2)
    const catalog = await openWorldSemanticResourceCatalogV1({
      localReleaseRecordId: oldRelease.worldReleaseId,
      expectedProjectId: installed.scope.projectId, expectedWorldId: installed.scope.worldId,
    })
    const resources = new Map(catalog.resources.map(row => [row.resourceKey, row.contentHash]))
    const next = parseAnyProductReleaseManifest(newRelease.manifestJson).textOpenWorldVNext!.sourceManifest
    expect(next.resourceHashes).toHaveLength(32)
    expect(next.resourceHashes.every(row => resources.get(row.resourceId) === row.contentHash)).toBe(true)
    expect(await db.productReleases.get(oldRelease.id!)).toEqual(oldRelease)
    expect(await db.worldReleases.get(oldRelease.worldReleaseId)).toEqual(oldWorld)
    expect(await db.productRuntimeSessions.get(sessionId)).toEqual(oldSession)
    expect(await readProductRuntimeState(sessionId)).toEqual(oldRuntime)
    expect(await saltRidgeShowcase.findInstalled(oldRelease.id)).toEqual(installed)
    expect(await saltRidgeShowcase.install()).toEqual({ scope: installed.scope, releaseId: newRelease.id })
    expect(network).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
}, 120_000)


it('keeps a frozen old journey readable without a local source-world row', async () => {
  const { installed, sessionId, release } = await restoreOriginalInstall()
  // Published runtime is self-contained. This isolated negative control
  // removes only the source locator, leaving the old verified release intact.
  if (release.worldReleaseId == null) throw Error('fixture lost its frozen WorldRelease locator')
  await db.worldReleases.delete(release.worldReleaseId)
  expect(await saltRidgeShowcase.findInstalled(release.id)).toEqual(installed)
  expect((await readProductRuntimeState(sessionId)).textOpenWorld).not.toBeNull()
  expect(await db.productReleases.get(release.id!)).toEqual(release)
  expect(network).not.toHaveBeenCalled()
})
