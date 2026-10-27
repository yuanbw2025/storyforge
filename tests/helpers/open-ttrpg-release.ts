/** Synthetic five-contract release fixture; never normal author/provider acceptance. */
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import type { ProductRuntimePackageWithTtrpgV2 } from '../../src/lib/ttrpg/content-version'
import { createFixtureProductReleaseManifestV1 } from './product-release-v1'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'

export async function seedOpenFixtureReleaseV1(scope: WorkspaceScope, runtimePackage: ProductRuntimePackageWithTtrpgV2,
  previous?: { id: number; version: number; manifest: Awaited<ReturnType<typeof createFixtureProductReleaseManifestV1>> }) {
  const version = previous ? previous.version + 1 : 1
  const manifest = await createFixtureProductReleaseManifestV1({ runtimePackage, releaseVersion: version,
    productionKey: previous?.manifest.productionProvenance.productionKey ?? `open-source-fixture-${crypto.randomUUID()}`,
    ...(previous ? { parentRelease: { releaseUid: previous.manifest.lineage.releaseUid, releaseHash: previous.manifest.lineage.releaseHash } } : {}) }, { ttrpgProtocol: 2 })
  const id = await db.productReleases.add({ ...scope, productionKey: manifest.productionProvenance.productionKey, productType: 'ttrpg', worldReleaseId: null,
    version, label: `开放续团夹具 v${version}`, manifestJson: JSON.stringify(manifest), contentHash: await hashProductProductionValueV2(manifest), createdAt: Date.now() })
  return { id: Number(id), version, manifest }
}
