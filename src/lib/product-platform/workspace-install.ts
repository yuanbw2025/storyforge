/** Product-owned immutable installation proofs; no authoring admission is granted. */
import type { CreateWorkspaceInput, WorkKind } from '../types'
import type { ProductionProductKindV1 } from '../types/product-identity'
import { allocateWorkspace } from '../workspace/workspace-allocation'


function frozenProductWorkKindV1(productType: ProductionProductKindV1): WorkKind {
  switch (productType) {
    case 'ttrpg': case 'character-interaction': case 'ai-town': case 'avg': return productType
    case 'text-adventure': case 'text-open-world': return 'avg'
  }
  throw new Error(`[workspace] 未登记的冻结产品身份：${String(productType)}`)
}

/** Install an immutable product copy, never authorize its authoring engine. */
export async function createWorkspaceForProductDistributionV1(input: CreateWorkspaceInput, evidence: {
  bundle: unknown
  expectedBundleHash: string
  expectedProductType: ProductionProductKindV1
}) {
  const snapshot = structuredClone({ input, evidence })
  const { verifyProductDistributionBundleV2 } = await import('./distribution-bundle')
  const bundle = await verifyProductDistributionBundleV2(snapshot.evidence.bundle)
  const productType = bundle.productRelease.manifest.productType
  if (bundle.bundleHash !== snapshot.evidence.expectedBundleHash || productType !== snapshot.evidence.expectedProductType) {
    throw new Error('[workspace] 冻结产品与目录身份或哈希不一致')
  }
  const workspace = await allocateWorkspace(snapshot.input, {
    purpose: 'independent-work', kind: frozenProductWorkKindV1(productType),
  })
  return { workspace, bundle }
}

/** The web player also proves the complete Adventure review envelope. */
export async function createWorkspaceForAdventureWebPackageV1(input: CreateWorkspaceInput, evidence: {
  package: unknown
  expectedCandidatePackageHash: string
}) {
  const snapshot = structuredClone({ input, evidence })
  const { verifyTextAdventureCommunityPackageV1 } = await import('../adventure/community-package')
  const candidate = await verifyTextAdventureCommunityPackageV1(snapshot.evidence.package)
  if (candidate.candidatePackageHash !== snapshot.evidence.expectedCandidatePackageHash) {
    throw new Error('[workspace] 文字冒险冻结包与安装身份不一致')
  }
  const workspace = await allocateWorkspace(snapshot.input, {
    purpose: 'independent-work', kind: frozenProductWorkKindV1(candidate.distributionBundle.productRelease.manifest.productType),
  })
  return { workspace, package: candidate }
}
