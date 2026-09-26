import { afterEach, beforeEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { parseAnyProductReleaseManifest } from '../../src/lib/product/releases'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import {
  SALT_RIDGE_SHOWCASE_PRODUCT_KEY,
  saltRidgeShowcase,
} from '../../src/lib/salt-ridge/production'
import { createSaltRidgeWorldV1 } from '../../src/lib/world-engine/salt-ridge-preset'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
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
  expect(await db.productReleases.count()).toBe(1)
})
