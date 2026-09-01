import { db } from '../db/schema'
import type { PlayableGameSourceV1, ResolvedPlayableGamePackageV2, SimulationSession, WorkspaceScope } from '../types'
import { assertGameReleaseUnchanged } from '../text-game/releases'
import { assertRecordInScope, resolveScope } from '../world-engine/scope'
import { createBuildGameMediaResolver, createReleaseGameMediaResolver } from './media-resolver'
import { verifyGameBuildPreviewManifestV1 } from './preview-manifest'
import { verifyGameReleaseManifestV3 } from './runtime-package'

export async function playableGameSourceForSessionV2(session: SimulationSession): Promise<PlayableGameSourceV1> {
  if (session.gameReleaseId != null) return { kind: 'release', gameReleaseId: session.gameReleaseId }
  if (session.gameBuildId != null) {
    const build = await db.gameBuilds.get(session.gameBuildId)
    if (!build?.previewHash) throw new Error('[playable-game-source] 会话绑定的 Product Build 不存在或尚未冻结')
    return { kind: 'build', gameBuildId: build.id!, expectedPreviewHash: build.previewHash }
  }
  throw new Error('[playable-game-source] 会话没有绑定 Product Release 或 Build')
}

export async function verifyPlayableSessionPackageV2(input: {
  scope: WorkspaceScope
  session: SimulationSession
}): Promise<Omit<ResolvedPlayableGamePackageV2, 'mediaResolver'>> {
  return verifyPlayableGamePackageSource({
    scope: input.scope,
    source: await playableGameSourceForSessionV2(input.session),
  })
}

export async function resolvePlayableGameSource(input: {
  scope: WorkspaceScope
  source: PlayableGameSourceV1
}): Promise<ResolvedPlayableGamePackageV2> {
  const verified = await verifyPlayableGamePackageSource(input)
  const mediaResolver = input.source.kind === 'release'
    ? await createReleaseGameMediaResolver({ scope: input.scope, runtimePackage: verified.runtimePackage })
    : await createBuildGameMediaResolver({
      scope: input.scope,
      gameBuildId: input.source.gameBuildId,
      preview: await verifyGameBuildPreviewManifestV1(
        (await db.gameBuilds.get(input.source.gameBuildId))?.previewManifestJson ?? '',
      ),
    })
  return { ...verified, mediaResolver }
}

/**
 * Verify the immutable playable source without acquiring media leases. Runtime
 * and session boundaries use this form so source validation can participate in
 * their own atomic transaction; player presentation adds the resolver above.
 */
export async function verifyPlayableGamePackageSource(input: {
  scope: WorkspaceScope
  source: PlayableGameSourceV1
}): Promise<Omit<ResolvedPlayableGamePackageV2, 'mediaResolver'>> {
  const scope = await resolveScope({ scope: input.scope })
  if (input.source.kind === 'release') {
    const release = await assertGameReleaseUnchanged(input.source.gameReleaseId)
    if (!await assertRecordInScope(scope, 'gameReleases', release, { owner: 'work' })) {
      throw new Error('[playable-game-source] GameRelease 不属于当前 Work')
    }
    const parsed = await verifyGameReleaseManifestV3(release.manifestJson)
    const runtimePackage = parsed.runtimePackage
    const packageHash = parsed.packageHash
    return {
      source: input.source,
      runtimePackage,
      packageHash,
      runtimeSourceHash: packageHash,
    }
  }

  const build = await db.gameBuilds.get(input.source.gameBuildId)
  if (!build || !await assertRecordInScope(scope, 'gameBuilds', build, { owner: 'work' })) {
    throw new Error('[playable-game-source] GameBuild 不存在或跨 Work')
  }
  if (build.status !== 'preview-ready' && build.status !== 'release-ready' && build.status !== 'released') {
    throw new Error('[playable-game-source] GameBuild 尚未达到可预览状态')
  }
  const [production, brief] = await Promise.all([
    db.gameProductions.get(build.productionId),
    db.gameProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first(),
  ])
  if (!production || !brief || production.workId !== scope.workId || brief.briefHash !== build.briefHash) {
    throw new Error('[playable-game-source] Build 的 Production/Brief 绑定损坏')
  }
  const preview = await verifyGameBuildPreviewManifestV1(build.previewManifestJson)
  if (preview.previewHash !== input.source.expectedPreviewHash || preview.previewHash !== build.previewHash
    || preview.packageHash !== build.packageHash || preview.buildManifestHash !== build.manifestHash
    || preview.productionKey !== production.productionKey || preview.buildNumber !== build.buildNumber) {
    throw new Error('[playable-game-source] Build Preview 指针或 hash 不一致')
  }
  if (preview.runtimePackage.sourceWorld.contentHash !== brief.sourceWorldContentHash) {
    throw new Error('[playable-game-source] Build Preview 的冻结世界来源证据损坏')
  }
  return {
    source: input.source,
    runtimePackage: preview.runtimePackage,
    packageHash: preview.packageHash,
    runtimeSourceHash: preview.packageHash,
  }
}
