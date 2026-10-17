import { db } from '../db/schema'
import type { ProductRuntimeSourceV1, ResolvedProductRuntimeSourceV1, ProductRuntimeSession, WorkspaceScope } from '../types'
import type { ProductRuntimePackageWithTtrpgV2 } from '../ttrpg/content-version'
import { assertProductReleaseUnchanged } from '../product/releases'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { createBuildProductMediaResolver, createReleaseProductMediaResolver } from './media-resolver'
import { verifyProductBuildPreviewManifestV1 } from './preview-manifest'
import {
  verifyProductReleaseManifestV1,
  type ProductTtrpgProtocol2ReaderV1,
} from './runtime-package'

export type ResolvedProductRuntimeSourceWithTtrpgV2 = Omit<
  ResolvedProductRuntimeSourceV1,
  'runtimePackage'
> & {
  runtimePackage: ProductRuntimePackageWithTtrpgV2
}

type RuntimeSourceInput = { scope: WorkspaceScope; source: ProductRuntimeSourceV1 }
type RuntimeSessionSourceInput = { scope: WorkspaceScope; session: ProductRuntimeSession }
type LegacyVerifiedRuntimeSource = Omit<ResolvedProductRuntimeSourceV1, 'mediaResolver'>
type VersionedVerifiedRuntimeSource = Omit<ResolvedProductRuntimeSourceWithTtrpgV2, 'mediaResolver'>

export async function productRuntimeSourceForSessionV1(session: ProductRuntimeSession): Promise<ProductRuntimeSourceV1> {
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
  return verifyProductRuntimeSource({
    scope: input.scope,
    source: await productRuntimeSourceForSessionV1(input.session),
    ttrpgProtocol: input.ttrpgProtocol,
  })
}

export function resolveProductRuntimeSource(input: RuntimeSourceInput & { ttrpgProtocol: 2 }): Promise<ResolvedProductRuntimeSourceWithTtrpgV2>
export function resolveProductRuntimeSource(input: RuntimeSourceInput & { ttrpgProtocol?: 1 }): Promise<ResolvedProductRuntimeSourceV1>
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
      preview: input.ttrpgProtocol === 2
        ? await verifyProductBuildPreviewManifestV1((await db.productBuilds.get(input.source.productBuildId))?.previewManifestJson ?? '', { ttrpgProtocol: 2 })
        : await verifyProductBuildPreviewManifestV1((await db.productBuilds.get(input.source.productBuildId))?.previewManifestJson ?? ''),
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
export async function verifyProductRuntimeSource(input: RuntimeSourceInput & { ttrpgProtocol?: 1 | 2 }): Promise<VersionedVerifiedRuntimeSource> {
  const scope = await resolveScope({ scope: input.scope })
  if (input.source.kind === 'release') {
    const release = await assertProductReleaseUnchanged(input.source.productReleaseId, input.ttrpgProtocol === 2 ? { ttrpgProtocol: 2 } : undefined)
    if (!await assertRecordInScope(scope, 'productReleases', release, { owner: 'work' })) {
      throw new Error('[product-runtime-source] ProductRelease 不属于当前 Work')
    }
    const reader: ProductTtrpgProtocol2ReaderV1 | undefined =
      input.ttrpgProtocol === 2 ? { ttrpgProtocol: 2 } : undefined
    const parsed = reader
      ? await verifyProductReleaseManifestV1(release.manifestJson, reader)
      : await verifyProductReleaseManifestV1(release.manifestJson)
    const runtimePackage = parsed.runtimePackage
    const packageHash = parsed.packageHash
    return {
      source: input.source,
      runtimePackage,
      packageHash,
      runtimeSourceHash: packageHash,
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
  if (!production || !brief || production.workId !== scope.workId || brief.briefHash !== build.briefHash) {
    throw new Error('[product-runtime-source] Build 的 Production/Brief 绑定损坏')
  }
  const reader: ProductTtrpgProtocol2ReaderV1 | undefined =
    input.ttrpgProtocol === 2 ? { ttrpgProtocol: 2 } : undefined
  const preview = reader
    ? await verifyProductBuildPreviewManifestV1(build.previewManifestJson, reader)
    : await verifyProductBuildPreviewManifestV1(build.previewManifestJson)
  if (preview.previewHash !== input.source.expectedPreviewHash || preview.previewHash !== build.previewHash
    || preview.packageHash !== build.packageHash || preview.buildManifestHash !== build.manifestHash
    || preview.productionKey !== production.productionKey || preview.buildNumber !== build.buildNumber
    || preview.runtimePackage.productType !== production.productType) {
    throw new Error('[product-runtime-source] Build Preview 指针或 hash 不一致')
  }
  if (preview.runtimePackage.sourceWorld.contentHash !== brief.sourceWorldContentHash) {
    throw new Error('[product-runtime-source] Build Preview 的冻结世界来源证据损坏')
  }
  return {
    source: input.source,
    runtimePackage: preview.runtimePackage,
    packageHash: preview.packageHash,
    runtimeSourceHash: preview.packageHash,
  }
}
