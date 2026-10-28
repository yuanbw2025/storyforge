import { db } from '../db/schema'
import type { ProductRuntimeSourceV1, ResolvedProductRuntimeSourceV1, ProductRuntimeSession, ProductRuntimePackageV1, ProductRuntimePackageV2, VerifiedProductRuntimeSourceEnvelope, WorkspaceScope } from '../types'
import { assertProductReleaseUnchanged } from '../product/releases'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { createBuildProductMediaResolver, createReleaseProductMediaResolver } from './media-resolver'
import { verifyProductBuildPreviewManifest } from './preview-manifest'
import { verifyProductReleaseManifest, requirePlayableProductRuntimePackage } from './runtime-package'
import { avgExecutableModule } from '../avg/executable-module'

export type ResolvedProductRuntimeSourceWithTtrpgV2 = ResolvedProductRuntimeSourceV1
type RuntimeSourceInput = { scope: WorkspaceScope; source: ProductRuntimeSourceV1 }
type RuntimeSessionSourceInput = { scope: WorkspaceScope; session: ProductRuntimeSession }
type LegacyResolvedRuntimeSource = Omit<ResolvedProductRuntimeSourceV1, 'runtimePackage'> & {
  runtimePackage: ProductRuntimePackageV1 | ProductRuntimePackageV2
}
type LegacyVerifiedRuntimeSource = Omit<LegacyResolvedRuntimeSource, 'mediaResolver'>
type VersionedVerifiedRuntimeSource = Omit<ResolvedProductRuntimeSourceV1, 'mediaResolver'>
import { runtimeSourceManifestFromBuildRecordsV1,
  runtimeSourceManifestFromReleaseV1 } from '../product/runtime-source-manifest'
import { assertProductRuntimeSourceSnapshotV3 } from '../product/runtime-source-branch'

export async function productRuntimeSourceForSessionV1(
  session: Pick<ProductRuntimeSession, 'productReleaseId' | 'productBuildId'>,
): Promise<ProductRuntimeSourceV1> {
  if (session.productReleaseId != null) return { kind: 'release', productReleaseId: session.productReleaseId }
  if (session.productBuildId != null) {
    const build = await db.productBuilds.get(session.productBuildId)
    if (!build?.previewHash) throw new Error('[product-runtime-source] 会话绑定的 Product Build 不存在或尚未冻结')
    return { kind: 'build', productBuildId: build.id!, expectedPreviewHash: build.previewHash }
  }
  throw new Error('[product-runtime-source] 会话没有绑定 Product Release 或 Build')
}

export function verifyProductRuntimeSessionSourceV1(input: RuntimeSessionSourceInput & { ttrpgProtocol: 2 }): Promise<VersionedVerifiedRuntimeSource>
export function verifyProductRuntimeSessionSourceV1(input: RuntimeSessionSourceInput & { ttrpgProtocol?: 1 }): Promise<LegacyVerifiedRuntimeSource>
export function verifyProductRuntimeSessionSourceV1(input: RuntimeSessionSourceInput & { ttrpgProtocol?: 1 | 2 }): Promise<VersionedVerifiedRuntimeSource>
export async function verifyProductRuntimeSessionSourceV1(input: RuntimeSessionSourceInput & { ttrpgProtocol?: 1 | 2 }): Promise<VersionedVerifiedRuntimeSource> {
  const verified = await verifyProductRuntimeSource({
    scope: input.scope,
    source: await productRuntimeSourceForSessionV1(input.session),
    ttrpgProtocol: input.ttrpgProtocol,
  })
  await assertProductRuntimeSourceSnapshotV3({ session: input.session, manifest: verified.sourceManifest })
  return verified
}

export function resolveProductRuntimeSource(input: RuntimeSourceInput & { ttrpgProtocol: 2 }): Promise<ResolvedProductRuntimeSourceWithTtrpgV2>
export function resolveProductRuntimeSource(input: RuntimeSourceInput & { ttrpgProtocol?: 1 }): Promise<LegacyResolvedRuntimeSource>
export async function resolveProductRuntimeSource(input: RuntimeSourceInput & { ttrpgProtocol?: 1 | 2 }): Promise<ResolvedProductRuntimeSourceWithTtrpgV2> {
  const verified = await verifyProductRuntimeSource(input)
  const mediaResolver = input.source.kind === 'release'
    ? await createReleaseProductMediaResolver({
        scope: input.scope,
        productReleaseId: input.source.productReleaseId,
        runtimePackage: verified.runtimePackage,
      })
    : await createBuildProductMediaResolver({
      scope: input.scope,
      productBuildId: input.source.productBuildId,
      preview: await verifyProductBuildPreviewManifest(
        (await db.productBuilds.get(input.source.productBuildId))?.previewManifestJson ?? '',
        input.ttrpgProtocol === 2 ? { ttrpgProtocol: 2 } : undefined,
      ),
    })
  return { ...verified, mediaResolver }
}

/**
 * Verify the immutable playable source without acquiring media leases. Runtime
 * and session boundaries use this form so source validation can participate in
 * their own atomic transaction; player presentation adds the resolver above.
 */
export function verifyProductRuntimeSource(input: RuntimeSourceInput & { ttrpgProtocol: 2 }): Promise<VersionedVerifiedRuntimeSource>
export function verifyProductRuntimeSource(input: RuntimeSourceInput & { ttrpgProtocol?: 1 }): Promise<LegacyVerifiedRuntimeSource>
export function verifyProductRuntimeSource(input: RuntimeSourceInput & { ttrpgProtocol?: 1 | 2 }): Promise<VersionedVerifiedRuntimeSource>
export async function verifyProductRuntimeSource(input: {
  scope: WorkspaceScope
  ttrpgProtocol?: 1 | 2
  source: ProductRuntimeSourceV1
}): Promise<Omit<ResolvedProductRuntimeSourceV1, 'mediaResolver'>> {
  const verified = await verifyProductRuntimeSourceEnvelope(input)
  return { ...verified, runtimePackage: requirePlayableProductRuntimePackage(verified.runtimePackage) }
}

/** Version-aware inspection preserves the actual package hash and source pin.
 * Runtime admission remains explicit and does not downgrade the V2 carrier. */
export async function verifyProductRuntimeSourceEnvelope(input: {
  scope: WorkspaceScope
  ttrpgProtocol?: 1 | 2
  source: ProductRuntimeSourceV1
}): Promise<VerifiedProductRuntimeSourceEnvelope> {
  const scope = await resolveScope({ scope: input.scope })
  if (input.source.kind === 'release') {
    const release = await assertProductReleaseUnchanged(input.source.productReleaseId, input.ttrpgProtocol === 2 ? { ttrpgProtocol: 2 } : undefined)
    if (!await assertRecordInScope(scope, 'productReleases', release, { owner: 'work' })) {
      throw new Error('[product-runtime-source] ProductRelease 不属于当前 Work')
    }
    const parsed = await verifyProductReleaseManifest(release.manifestJson, input.ttrpgProtocol === 2 ? { ttrpgProtocol: 2 } : undefined)
    const runtimePackage = parsed.runtimePackage
    const packageHash = parsed.packageHash
    const sourceManifest = await runtimeSourceManifestFromReleaseV1(parsed)
    return {
      source: input.source,
      runtimePackage,
      packageHash,
      runtimeSourceHash: packageHash,
      ...(sourceManifest ? { sourceManifest } : {}),
    }
  }

  const build = await db.productBuilds.get(input.source.productBuildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) {
    throw new Error('[product-runtime-source] ProductBuild 不存在或跨 Work')
  }
  if (build.status !== 'preview-ready' && build.status !== 'release-ready' && build.status !== 'released') {
    throw new Error('[product-runtime-source] ProductBuild 尚未达到可预览状态')
  }
  const [production, brief] = await Promise.all([
    db.productProductions.get(build.productionId),
    db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first(),
  ])
  if (!production || !brief
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productProductionBriefs', brief, { owner: 'work' })
    || brief.briefHash !== build.briefHash) {
    throw new Error('[product-runtime-source] Build 的 Production/Brief 绑定损坏')
  }
  const preview = await verifyProductBuildPreviewManifest(build.previewManifestJson, input.ttrpgProtocol === 2 ? { ttrpgProtocol: 2 } : undefined)
  if (avgExecutableModule(preview.runtimePackage) && preview.runtimePackage.definition.productKey !== production.productionKey) throw new Error('[product-runtime-source] AVG 产品身份与 Production 不一致')
  if (preview.previewHash !== input.source.expectedPreviewHash || preview.previewHash !== build.previewHash
    || preview.packageHash !== build.packageHash || preview.buildManifestHash !== build.manifestHash
    || preview.productionKey !== production.productionKey || preview.buildNumber !== build.buildNumber
    || preview.runtimePackage.productType !== production.productType) {
    throw new Error('[product-runtime-source] Build Preview 指针或 hash 不一致')
  }
  if (preview.runtimePackage.sourceWorld.contentHash !== brief.sourceWorldContentHash) {
    throw new Error('[product-runtime-source] Build Preview 的冻结世界来源证据损坏')
  }
  const sourceManifest = await runtimeSourceManifestFromBuildRecordsV1({ build, brief })
  return {
    source: input.source,
    runtimePackage: preview.runtimePackage,
    packageHash: preview.packageHash,
    runtimeSourceHash: preview.packageHash,
    ...(sourceManifest ? { sourceManifest } : {}),
  }
}
