import { db } from '../db/schema'
import type { ProductRuntimeSourceV1, ResolvedProductRuntimeSourceV1, ProductRuntimeSession, WorkspaceScope } from '../types'
import { assertProductReleaseUnchanged } from '../product/releases'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { createBuildProductMediaResolver, createReleaseProductMediaResolver } from './media-resolver'
import { verifyProductBuildPreviewManifestV1 } from './preview-manifest'
import { verifyProductReleaseManifestV1 } from './runtime-package'

export async function productRuntimeSourceForSessionV1(session: ProductRuntimeSession): Promise<ProductRuntimeSourceV1> {
  if (session.productReleaseId != null) return { kind: 'release', productReleaseId: session.productReleaseId }
  if (session.productBuildId != null) {
    const build = await db.productBuilds.get(session.productBuildId)
    if (!build?.previewHash) throw new Error('[product-runtime-source] 会话绑定的 Product Build 不存在或尚未冻结')
    return { kind: 'build', productBuildId: build.id!, expectedPreviewHash: build.previewHash }
  }
  throw new Error('[product-runtime-source] 会话没有绑定 Product Release 或 Build')
}

export async function verifyProductRuntimeSessionSourceV1(input: {
  scope: WorkspaceScope
  session: ProductRuntimeSession
}): Promise<Omit<ResolvedProductRuntimeSourceV1, 'mediaResolver'>> {
  return verifyProductRuntimeSource({
    scope: input.scope,
    source: await productRuntimeSourceForSessionV1(input.session),
  })
}

export async function resolveProductRuntimeSource(input: {
  scope: WorkspaceScope
  source: ProductRuntimeSourceV1
}): Promise<ResolvedProductRuntimeSourceV1> {
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
      preview: await verifyProductBuildPreviewManifestV1(
        (await db.productBuilds.get(input.source.productBuildId))?.previewManifestJson ?? '',
      ),
    })
  return { ...verified, mediaResolver }
}

/**
 * Verify the immutable playable source without acquiring media leases. Runtime
 * and session boundaries use this form so source validation can participate in
 * their own atomic transaction; player presentation adds the resolver above.
 */
export async function verifyProductRuntimeSource(input: {
  scope: WorkspaceScope
  source: ProductRuntimeSourceV1
}): Promise<Omit<ResolvedProductRuntimeSourceV1, 'mediaResolver'>> {
  const scope = await resolveScope({ scope: input.scope })
  if (input.source.kind === 'release') {
    const release = await assertProductReleaseUnchanged(input.source.productReleaseId)
    if (!await assertRecordInScope(scope, 'productReleases', release, { owner: 'work' })) {
      throw new Error('[product-runtime-source] ProductRelease 不属于当前 Work')
    }
    const parsed = await verifyProductReleaseManifestV1(release.manifestJson)
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
  const preview = await verifyProductBuildPreviewManifestV1(build.previewManifestJson)
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
