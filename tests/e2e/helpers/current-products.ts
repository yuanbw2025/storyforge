import { expect, type Locator, type Page } from '@playwright/test'

export interface CurrentTtrpgSeedSeat {
  seatKey: string
  label: string
  controller: 'human' | 'ai' | 'open'
  role: 'player' | 'assistant-gm'
  characterMode: 'world-template' | 'quick-card' | 'manual' | 'ai-generated'
  sourceCharacterResourceKey: string | null
  characterName: string
  rankTier: 'D' | 'C' | 'B' | 'A' | null
  privateGoal: string
}

export interface CurrentTtrpgSeedInput {
  title: string
  gmMode: 'human' | 'ai'
  playerController: 'human' | 'ai'
  ruleOrigin?: 'builtin-storyforge' | 'builtin-rank-lite' | 'builtin-d20-fantasy' | 'builtin-d100-investigation'
  seats?: CurrentTtrpgSeedSeat[]
}

/**
 * Browser-side seed for runtime-heavy E2E tests. The fixture still traverses
 * the current neutral WorldRelease -> source catalog -> TTRPG compiler ->
 * Product Build path; it does not revive a retired per-product authoring table.
 */
export async function seedCurrentTtrpgProduct(page: Page, input: CurrentTtrpgSeedInput) {
  await page.goto('./')
  return page.evaluate(async seed => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 },
      { createCurrentTtrpgRuntimePackageFixture },
      { seedCurrentProductBuild },
    ] = await Promise.all([
      importer('/storyforge/tests/helpers/current-product-world.ts'),
      importer('/storyforge/tests/helpers/current-ttrpg-runtime-package.ts'),
      importer('/storyforge/tests/helpers/current-product-build.ts'),
    ])
    const world = await seedCurrentProductWorld(seed.title)
    const release = world.release
    const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({
      scope: world.scope,
      worldReleaseId: release.id,
      productType: 'ttrpg',
    })
    const runtimePackage = await createCurrentTtrpgRuntimePackageFixture({
      scope: world.scope,
      worldRelease: release,
      sourceCatalog,
      title: seed.title,
      gmMode: seed.gmMode,
      playerController: seed.playerController,
      ruleOrigin: seed.ruleOrigin,
      seats: seed.seats,
    })
    const built = await seedCurrentProductBuild({
      scope: world.scope,
      worldRelease: release,
      runtimePackage,
      title: seed.title,
    })
    return {
      projectId: world.scope.projectId,
      sessionId: built.session.id,
      buildId: built.buildId,
      productionId: built.productionId,
      releaseHash: release.contentHash,
      packageHash: built.preview.packageHash,
      ruleTitle: runtimePackage.ttrpg?.rulePack.content.title ?? '',
    }
  }, input)
}

export async function openCurrentTtrpgPlayer(page: Page): Promise<Locator> {
  await page.reload()
  await page.getByTestId('product-tab-ttrpg').click()
  const guide = page.getByTestId('formal-ttrpg-campaign-guide')
  await expect(guide).toBeVisible({ timeout: 20_000 })
  return guide
}
