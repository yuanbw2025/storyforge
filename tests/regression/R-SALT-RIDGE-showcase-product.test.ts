import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { parseAnyProductReleaseManifest } from '../../src/lib/product/releases'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import {
  createSaltRidgeShowcaseBriefV1, materializeSaltRidgeShowcase, SALT_RIDGE_SHOWCASE_PRODUCT_KEY,
  saltRidgeShowcase,
} from '../../src/lib/salt-ridge/production'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import { createProductProductionWithBriefV1 } from '../../src/lib/product-production/service'
import { currentProductCatalogChannelV1 } from '../../src/lib/product/product-catalog'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { createSaltRidgeWorldV1, SALT_RIDGE_WORKSPACE_UID } from '../../src/lib/world-engine/salt-ridge-preset'

const originalUrl = window.location.href

beforeEach(async () => {
  window.location.href = 'https://public-showcase.example/storyforge/'
  expect(currentProductCatalogChannelV1()).toBe('production')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('展示安装意外发起外部请求') }))
  await db.delete()
  await db.open()
})

afterEach(async () => {
  try { expect(fetch).not.toHaveBeenCalled() } finally {
    vi.unstubAllGlobals()
    window.location.href = originalUrl
  }
  await db.delete()
})

it('freezes one reusable Salt Ridge source world', async () => {
  const first = await createSaltRidgeWorldV1()
  const repeated = await createSaltRidgeWorldV1()
  expect(repeated).toEqual({ scope: first.scope, worldReleaseId: first.worldReleaseId })
  expect(await db.worldReleases.count()).toBe(1)
  expect(await db.characters.count()).toBe(7)
  expect(await db.importantLocations.count()).toBe(10)
  expect(await db.storyArcs.count()).toBe(3)
})

it('installs one formal release and creates a real playable vNext session', async () => {
  const [installed, duplicate] = await Promise.all([
    saltRidgeShowcase.install(),
    saltRidgeShowcase.install(),
  ])
  expect(duplicate).toEqual(installed)
  expect(await db.productReleases.count()).toBe(1)
  expect(await db.productRuntimeSessions.count()).toBe(0)

  const release = await db.productReleases.get(installed.releaseId)
  const runtimePackage = parseAnyProductReleaseManifest(release!.manifestJson)
  expect(runtimePackage.definition.productKey).toBe(SALT_RIDGE_SHOWCASE_PRODUCT_KEY)
  expect(runtimePackage.textOpenWorldVNext).toBeTruthy()
  const modules = parseTextOpenWorldModulesV1(runtimePackage.textOpenWorldVNext!)
  expect(modules.world.regions).toHaveLength(2)
  expect(modules.narrative.endings).toHaveLength(2)
  expect(modules.combat.encounters.length).toBeGreaterThanOrEqual(1)
  expect(modules.crafting.recipes.length).toBeGreaterThanOrEqual(1)
  expect(modules.economy.vendors.length).toBeGreaterThanOrEqual(1)

  const session = await createTextOpenWorldInstance({
    scope: installed.scope,
    productReleaseId: installed.releaseId,
    title: '盐脊展示旅程',
  })
  expect(session.productReleaseId).toBe(installed.releaseId)
  expect(JSON.parse(session.initialStateJson).textOpenWorld).toBeTruthy()
  expect(await saltRidgeShowcase.install()).toEqual(installed)
  const pinned = await db.productRuntimeSessions.get(session.id!)
  await db.worldReleases.delete(release!.worldReleaseId!)
  expect(await saltRidgeShowcase.findInstalled()).toEqual(installed)
  expect(await db.productRuntimeSessions.get(session.id!)).toEqual(pinned)
  expect(await db.productReleases.count()).toBe(1)
})

it('keeps ordinary production closed even during a public install of the exact same source and Brief', async () => {
  const { scope, worldReleaseId } = await createSaltRidgeWorldV1()
  const brief = await createSaltRidgeShowcaseBriefV1(scope, worldReleaseId)
  const saltRidgeInstall = { installation: 'salt-ridge' } as const
  const title = '盐脊：断流之夜'
  const normal = { scope, worldReleaseId, brief, title }
  const rejected: Promise<unknown>[] = []
  await saltRidgeShowcase.install(message => {
    if (message.includes('正在锁定')) {
      rejected.push(expect(createProductProductionWithBriefV1(normal)).rejects.toThrow(/product-catalog/))
      rejected.push(expect(createProductProductionWithBriefV1({ ...normal, saltRidgeInstall })).rejects.toThrow(/product-catalog/))
      rejected.push(expect(materializeSaltRidgeShowcase(scope, worldReleaseId, saltRidgeInstall, () => {})).rejects.toThrow('凭据'))
    }
  })
  expect(rejected).toHaveLength(3)
  await Promise.all(rejected)
  expect(await db.productProductions.count()).toBe(1)
  expect(await db.productBuilds.count()).toBe(1)
  expect(await db.productReleases.count()).toBe(1)
})

it('refuses unrelated authored content under the same workspace ID and title before making a game or sealing a new world', async () => {
  const foreign = await seedCurrentProductWorld('盐脊 · 断流之夜')
  await db.projects.update(foreign.scope.projectId, { workspaceUid: SALT_RIDGE_WORKSPACE_UID })
  const revisions = await db.worldRevisions.toArray()
  const releases = await db.worldReleases.toArray()
  expect(releases).toHaveLength(1)
  await expect(saltRidgeShowcase.install()).rejects.toThrow('与内置盐脊展示作品不一致')
  expect(await db.worldReleases.toArray()).toEqual(releases)
  await db.worldReleases.delete(releases[0]!.id!)
  await expect(saltRidgeShowcase.install()).rejects.toThrow('与内置盐脊展示作品不一致')
  expect(await db.worldRevisions.toArray()).toEqual(revisions)
  expect(await db.productProductions.count()).toBe(0)
  expect(await db.productReleases.count()).toBe(0)
})

it('installs into the source Work frozen by the original author after the workspace switches to a different Work', async () => {
  const original = await createSaltRidgeWorldV1()
  const other = await createWorldWork(original.scope.projectId, { title: '另一部作品', kind: 'novel', novelProfile: 'long' })
  await switchActiveWork(original.scope.projectId, other.id!)
  const installed = await saltRidgeShowcase.install()
  expect(installed.scope).toEqual(original.scope)
  expect((await db.projects.get(original.scope.projectId))?.activeWorkId).toBe(other.id)
  expect(await db.productProductions.where('workId').equals(other.id!).count()).toBe(0)
  expect(await db.productReleases.where('workId').equals(other.id!).count()).toBe(0)
})
