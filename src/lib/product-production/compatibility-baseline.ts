import { productRuntimeContentReaderV1, type ProductRuntimePackageForAdaptersV1 } from '../product/runtime-product-adapters'
import type { ProductBuildArtifactRecordV1, ProductBuildRecordV1, ProductProductionRecordV1,
  } from '../types'
import { parseProductBuildManifestV1 } from './adoption'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from './hash'
import { parseProductRuntimePackageV1, productProductionTerminalArtifactKeysV1 } from './runtime-package'

function fail(detail: string): never {
  throw new Error(`[product-production-compatibility] ${detail}`)
}

/**
 * Read-only comparison input, never authority to resume/reuse/preview/publish
 * the source Build. Stop/archive advance the control fence while retaining
 * the original Manifest and package. Resolve that exact frozen membership;
 * do not guess the current epoch or fall back past a damaged selected package.
 */
export async function resolveProductBuildCompatibilityPackageV1(input: {
  production: ProductProductionRecordV1
  build: ProductBuildRecordV1
  artifacts: readonly ProductBuildArtifactRecordV1[]
}): Promise<{ buildNumber: number; packageHash: string; runtimePackage: ProductRuntimePackageForAdaptersV1 }> {
  const { production, build } = input
  if (!build.id || build.productionId !== production.id
    || build.projectId !== production.projectId || build.worldId !== production.worldId
    || build.workId !== production.workId || !isSha256Hash(build.packageHash)
    || !isSha256Hash(build.manifestHash) || !isSha256Hash(build.rootTerminalReceiptHash)) {
    fail('历史 package Build 归属或封存指针无效')
  }
  const manifest = parseProductBuildManifestV1(build.manifestJson)
  if (canonicalProductProductionJsonV2(manifest) !== build.manifestJson
    || await hashProductProductionValueV2(manifest) !== build.manifestHash
    || manifest.productionKey !== production.productionKey
    || manifest.buildNumber !== build.buildNumber || manifest.briefRevision !== build.briefRevision
    || manifest.briefHash !== build.briefHash || manifest.planHash !== build.planHash
    || manifest.runtimePackageHash !== build.packageHash
    || manifest.controlEpoch < 0 || manifest.controlEpoch > build.controlEpoch) {
    fail('历史 package Manifest 身份、轮次或 hash 不闭合')
  }
  const dedicatedKey = productProductionTerminalArtifactKeysV1(production.productType).runtimePackage
  let members = manifest.artifactReceipts.filter(row => row.artifactKey === dedicatedKey)
  // The old generic open-world package key is valid only when the unchanged
  // historical Manifest explicitly sealed it. New packages keep their key.
  if (members.length === 0 && production.productType === 'text-open-world') {
    members = manifest.artifactReceipts.filter(row => row.artifactKey === 'runtime.package')
  }
  if (members.length !== 1 || members[0].contentHash !== build.packageHash) {
    fail('历史 package Manifest 成员缺失或重复')
  }
  const member = members[0]
  const rows = input.artifacts.filter(row => row.artifactKey === member.artifactKey
    && row.controlEpoch === manifest.controlEpoch
    && (row.status === 'accepted' || row.status === 'carried-forward'))
  if (rows.length !== 1) fail('历史 package Artifact 缺失或重复')
  const row = rows[0]
  if (row.buildId !== build.id || row.projectId !== build.projectId
    || row.worldId !== build.worldId || row.workId !== build.workId
    || row.version !== member.version || row.contentHash !== member.contentHash
    || row.producerReceiptHash !== member.producerReceiptHash) {
    fail('历史 package Artifact 与冻结成员或 owner 不一致')
  }
  const reader = productRuntimeContentReaderV1(production.productType)
  const runtimePackage = reader ? parseProductRuntimePackageV1(row.payloadJson, reader) : parseProductRuntimePackageV1(row.payloadJson)
  if (runtimePackage.productType !== production.productType
    || await hashProductProductionValueV2(runtimePackage) !== build.packageHash) {
    fail('历史 package Artifact 产品或 payload hash 不一致')
  }
  return { buildNumber: build.buildNumber, packageHash: build.packageHash, runtimePackage }
}
