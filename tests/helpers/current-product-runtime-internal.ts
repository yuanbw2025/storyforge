import type { ProductProductionWorldSourceCatalogV2 } from '../../src/lib/product-production/world-source'
import type { WorkspaceScope, WorldRelease } from '../../src/lib/types'
import { seedCurrentProductBuild } from './current-product-build'
import { createCurrentTtrpgRuntimePackageFixture } from './current-ttrpg-runtime-package'

/** Test composition helper kept outside production source. */
export async function createCurrentProductBuildPreviewFixture(input: {
  scope: WorkspaceScope
  worldRelease: WorldRelease & { id: number }
  sourceCatalog: ProductProductionWorldSourceCatalogV2
  title: string
  worldGroupId?: number | null
  seed?: string
}) {
  const runtimePackage = await createCurrentTtrpgRuntimePackageFixture({
    scope: input.scope,
    worldRelease: input.worldRelease,
    sourceCatalog: input.sourceCatalog,
    playerController: 'human',
    gmMode: 'human',
    title: input.title,
  })
  return seedCurrentProductBuild({
    scope: input.scope,
    worldRelease: input.worldRelease,
    runtimePackage,
    title: input.title,
    worldGroupId: input.worldGroupId,
    seed: input.seed,
  })
}
