import type {
  AnyProductBuildPreviewManifest, ProductReleaseManifestV1, ProductRuntimePackageV1,
  ProductRuntimeSourceManifestV1, ProductSourcePlan,
  ProductBuildRecordV1, ProductProductionBriefRecordV1,
} from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { validateProductSourcePlan } from './source-contracts'
import { parseProductProductionSourcePlanV1 } from '../product-production/source-contracts'
import { verifyProductBuildPreviewManifest } from '../product-production/preview-manifest'

/** Only the neutral source envelope is consumed here. Product-private payloads
 * remain on the original object for whole-package hashing and their own parser. */
type RuntimePackageSourceEnvelopeV1 = Pick<ProductRuntimePackageV1, 'productType' | 'sourceWorld'>

function fail(message: string): never {
  throw new Error(`[product-runtime-source-manifest] ${message}`)
}

async function createManifest(input: {
  sourcePlan: ProductSourcePlan
  runtimePackage: RuntimePackageSourceEnvelopeV1
  packageHash: string
  sourceKind: ProductRuntimeSourceManifestV1['sourceKind']
  sourceIdentityHash: string
  inheritedSourceManifestHash: string | null
}): Promise<ProductRuntimeSourceManifestV1 | null> {
  if (input.sourcePlan.version === 1) return null
  const sourcePlan = await validateProductSourcePlan(input.sourcePlan)
  if (sourcePlan.version !== 2) fail('增强运行来源缺少 V2 计划')
  const { runtimePackage } = input
  const productType = runtimePackage.productType
  if (productType !== 'character-interaction' && productType !== 'avg') fail('增强运行来源产品不受支持')
  const selection = runtimePackage.sourceWorld.selection
  const roles = Object.fromEntries(Object.entries(selection.roleBindings).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => [key, [...values].sort()]))
  if (sourcePlan.productType !== productType
    || sourcePlan.worldReference.releaseHash !== runtimePackage.sourceWorld.contentHash
    || selection.version !== sourcePlan.worldReference.version
    || selection.worldReferenceHash !== sourcePlan.worldReference.referenceHash
    || canonicalProductProductionJsonV2([...selection.resourceKeys].sort()) !== canonicalProductProductionJsonV2(sourcePlan.exact.authorResourceKeys)
    || canonicalProductProductionJsonV2(roles) !== canonicalProductProductionJsonV2(sourcePlan.configuration.roleBindings)
    || await hashProductProductionValueV2(runtimePackage) !== input.packageHash) {
    fail('运行包与冻结来源计划不一致')
  }
  for (const hash of [input.sourceIdentityHash, input.packageHash, input.inheritedSourceManifestHash]) {
    if (hash !== null && !/^[a-f0-9]{64}$/.test(hash)) fail('来源 hash 无效')
  }
  if ((input.sourceKind === 'release') !== (input.inheritedSourceManifestHash !== null)) fail('来源证据类型不一致')
  const body: Omit<ProductRuntimeSourceManifestV1, 'manifestHash'> = {
    schema: 'storyforge.product-runtime-source-manifest', version: 1, productType,
    sourceKind: input.sourceKind, sourceIdentityHash: input.sourceIdentityHash, packageHash: input.packageHash,
    sourceWorldContentHash: sourcePlan.worldReference.releaseHash, sourcePlanHash: sourcePlan.planHash,
    worldReferenceHash: sourcePlan.worldReference.referenceHash,
    inheritedSourceManifestHash: input.inheritedSourceManifestHash,
    readMode: 'frozen-product-package', directWorldReads: [],
  }
  return { ...body, manifestHash: await hashProductProductionValueV2(body) }
}

/** Caller verifies the immutable release before deriving this system receipt. */
export async function runtimeSourceManifestFromReleaseV1(
  manifest: Pick<ProductReleaseManifestV1, 'sourceContracts' | 'packageHash' | 'releaseIdentityHash'>
    & { runtimePackage: RuntimePackageSourceEnvelopeV1 },
): Promise<ProductRuntimeSourceManifestV1 | null> {
  if (manifest.sourceContracts.sourcePlan.schema !== 'storyforge.product-source-plan') return null
  return createManifest({ sourcePlan: manifest.sourceContracts.sourcePlan, runtimePackage: manifest.runtimePackage,
    packageHash: manifest.packageHash, sourceKind: 'release', sourceIdentityHash: manifest.releaseIdentityHash,
    inheritedSourceManifestHash: manifest.sourceContracts.sourceManifest.manifestHash })
}

/** Preview has no release SourceManifest; do not invent production read evidence. */
export async function runtimeSourceManifestFromPreviewV1(input: {
  preview: AnyProductBuildPreviewManifest
  sourcePlan: ProductSourcePlan
}): Promise<ProductRuntimeSourceManifestV1 | null> {
  return createManifest({ sourcePlan: input.sourcePlan, runtimePackage: input.preview.runtimePackage,
    packageHash: input.preview.packageHash, sourceKind: 'build-preview', sourceIdentityHash: input.preview.previewHash,
    inheritedSourceManifestHash: null })
}

/** Same validation for live and portable rows; no database lookup or ID authority. */
export async function runtimeSourceManifestFromBuildRecordsV1(input: {
  build: Pick<ProductBuildRecordV1, 'briefHash' | 'previewManifestJson' | 'previewHash' | 'packageHash' | 'manifestHash'>
  brief: Pick<ProductProductionBriefRecordV1, 'briefKind' | 'sourcePlanJson' | 'sourcePlanHash' | 'briefJson' | 'briefHash'>
}): Promise<ProductRuntimeSourceManifestV1 | null> {
  if (input.brief.briefKind === 'text-open-world-creator-v1') return null
  let rawPlan: unknown
  try { rawPlan = JSON.parse(input.brief.sourcePlanJson) } catch { fail('预览来源计划不是 JSON') }
  // Historical V1 preview contracts remain byte-compatible. V2 selection can
  // never be downgraded to that path by changing the plan version alone.
  if (rawPlan && typeof rawPlan === 'object' && 'version' in rawPlan && rawPlan.version === 1) {
    const preview = JSON.parse(input.build.previewManifestJson)
    if (preview?.runtimePackage?.sourceWorld?.selection?.version === 2) fail('增强选择不能降级为旧来源计划')
    return null
  }
  const sourcePlan = await parseProductProductionSourcePlanV1(input.brief)
  const preview = await verifyProductBuildPreviewManifest(input.build.previewManifestJson)
  if (input.build.briefHash !== input.brief.briefHash || input.build.previewHash !== preview.previewHash
    || input.build.packageHash !== preview.packageHash || input.build.manifestHash !== preview.buildManifestHash) {
    fail('预览会话的 Build 或 Brief 绑定损坏')
  }
  return runtimeSourceManifestFromPreviewV1({ preview, sourcePlan })
}

export function productRuntimeSourceSnapshotV2(manifest: ProductRuntimeSourceManifestV1) {
  return { schema: 'storyforge.product-runtime-source', version: 2, productType: manifest.productType,
    runtimeSourceHash: manifest.packageHash, sourceWorldContentHash: manifest.sourceWorldContentHash,
    sourceManifest: structuredClone(manifest) }
}

/** Compare the whole system-derived receipt, including the empty direct-read set. */
export function assertProductRuntimeSourceSnapshotV2(input: {
  canonSnapshot: unknown
  manifest: ProductRuntimeSourceManifestV1 | null | undefined
}): void {
  let snapshot = input.canonSnapshot
  if (typeof snapshot === 'string') {
    try { snapshot = JSON.parse(snapshot) } catch { fail('会话来源快照不是 JSON') }
  }
  if (input.manifest) {
    if (canonicalProductProductionJsonV2(snapshot) !== canonicalProductProductionJsonV2(productRuntimeSourceSnapshotV2(input.manifest))) {
      fail('会话来源计划、继承证据或实际读取记录不一致')
    }
  } else if (snapshot && typeof snapshot === 'object'
    && 'schema' in snapshot && snapshot.schema === 'storyforge.product-runtime-source'
    && 'version' in snapshot && snapshot.version !== 1) {
    fail('旧来源不能声明增强运行来源快照')
  }
}
