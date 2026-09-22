import { db } from '../db/schema'
import {
  assertProductReleaseUnchanged,
  classifyTextOpenWorldRuntimePackageShapeV1,
} from '../product/releases'
import { verifyProductReleaseManifestV1 } from '../product-production/runtime-package'
import type {
  ProductRelease,
  ProductReleaseManifestV1,
  ProductRuntimeSession,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'

export const TEXT_OPEN_WORLD_PLAYER_VERSION_PROJECTION_VERSION_V1 = 1 as const

export type TextOpenWorldPlayerVersionDiagnosticCodeV1 =
  | 'build-preview-excluded'
  | 'current-release-missing'
  | 'current-release-out-of-scope'
  | 'current-release-damaged'
  | 'session-release-binding-damaged'
  | 'release-damaged'

export interface TextOpenWorldPlayerVersionDiagnosticV1 {
  code: TextOpenWorldPlayerVersionDiagnosticCodeV1
  releaseVersion: number | null
  message: string
}

export type TextOpenWorldPlayerCompatibilityDeclarationV1 =
  | 'direct-release-lineage'
  | 'runtime-package-hash'
  | 'release-lineage-and-runtime-package-hash'
  | 'not-declared'

export interface TextOpenWorldPlayerReleaseVersionV1 {
  /** Local command locator. Player UI must never render this value. */
  actionIdentity: { productReleaseId: number }
  version: number
  label: string
  createdAt: number
  relationToPinned: 'older' | 'pinned' | 'newer'
  verified: true
  /** Only newer releases make a compatibility claim against this Session's pinned package. */
  declaredCompatibleWithPinnedRelease: boolean | null
  compatibilityDeclaration: TextOpenWorldPlayerCompatibilityDeclarationV1 | null
  /** Only an active Session and a verified direct compatible child Release qualify. */
  canMigratePinnedSession: boolean
}

export interface TextOpenWorldPlayerPinnedReleaseV1 {
  version: number
  label: string
  createdAt: number
  isLatestVerifiedRelease: boolean
  /** Old saves remain executable against their immutable pinned Release. */
  canContinueWithoutUpgrade: true
}

export interface TextOpenWorldPlayerVersionCompatibilityProjectionV1 {
  version: typeof TEXT_OPEN_WORLD_PLAYER_VERSION_PROJECTION_VERSION_V1
  availability: 'ready' | 'unavailable' | 'build-preview-excluded'
  productionKey: string | null
  pinnedRelease: TextOpenWorldPlayerPinnedReleaseV1 | null
  releases: TextOpenWorldPlayerReleaseVersionV1[]
  diagnostics: TextOpenWorldPlayerVersionDiagnosticV1[]
  migration: {
    available: boolean
    reason: 'compatible-release-available' | 'no-compatible-newer-release' | 'not-applicable'
  }
}

export interface VerifiedTextOpenWorldPlayerReleaseV1 {
  release: ProductRelease & { id: number }
  manifest: ProductReleaseManifestV1
}

const NO_MIGRATION = {
  available: false,
  reason: 'not-applicable',
} as const

function fail(message: string): never {
  throw new Error(`[text-open-world-player-versions] ${message}`)
}

function unavailable(
  availability: 'unavailable' | 'build-preview-excluded',
  diagnostic: TextOpenWorldPlayerVersionDiagnosticV1,
): TextOpenWorldPlayerVersionCompatibilityProjectionV1 {
  return {
    version: TEXT_OPEN_WORLD_PLAYER_VERSION_PROJECTION_VERSION_V1,
    availability,
    productionKey: null,
    pinnedRelease: null,
    releases: [],
    diagnostics: [diagnostic],
    migration: { ...NO_MIGRATION },
  }
}

function safeReleaseVersion(release: ProductRelease): number | null {
  return Number.isSafeInteger(release.version) && release.version > 0 ? release.version : null
}

function assertPublicReleaseRoot(release: ProductRelease): asserts release is ProductRelease & { id: number } {
  if (!Number.isSafeInteger(release.id) || release.id! <= 0
    || !Number.isSafeInteger(release.version) || release.version <= 0
    || !Number.isSafeInteger(release.createdAt) || release.createdAt < 0
    || typeof release.label !== 'string' || !release.label.trim() || release.label.length > 2_000
    || typeof release.productionKey !== 'string' || !release.productionKey.trim()
    || release.productionKey.length > 500) {
    fail('Release 根记录元数据无效')
  }
}

export async function verifyOwnedTextOpenWorldPlayerReleaseV1(
  scope: WorkspaceScope,
  release: ProductRelease,
): Promise<VerifiedTextOpenWorldPlayerReleaseV1> {
  assertPublicReleaseRoot(release)
  if (!await assertRecordInScope(scope, 'productReleases', release, { owner: 'work' })) {
    fail('Release 不属于当前 Work')
  }
  const unchanged = await assertProductReleaseUnchanged(release.id)
  assertPublicReleaseRoot(unchanged)
  if (!await assertRecordInScope(scope, 'productReleases', unchanged, { owner: 'work' })) {
    fail('Release 不属于当前 Work')
  }
  const manifest = await verifyProductReleaseManifestV1(unchanged.manifestJson)
  classifyTextOpenWorldRuntimePackageShapeV1(manifest.runtimePackage)
  if (unchanged.productType !== 'text-open-world'
    || manifest.productType !== 'text-open-world'
    || unchanged.productionKey !== manifest.productionProvenance.productionKey
    || unchanged.productionKey !== manifest.lineage.productInstanceKey
    || unchanged.version !== manifest.lineage.releaseVersion) {
    fail('Release 根记录与核验清单身份不一致')
  }
  return { release: unchanged, manifest }
}

export function textOpenWorldPlayerCompatibilityDeclarationV1(
  pinned: VerifiedTextOpenWorldPlayerReleaseV1,
  candidate: VerifiedTextOpenWorldPlayerReleaseV1,
): TextOpenWorldPlayerCompatibilityDeclarationV1 {
  const directLineage = candidate.manifest.lineage.parentRelease?.releaseUid
    === pinned.manifest.lineage.releaseUid
    && candidate.manifest.lineage.parentRelease.releaseHash === pinned.manifest.releaseIdentityHash
    && candidate.manifest.lineage.compatibility.status === 'compatible'
  const runtimePackageHash = candidate.manifest.runtimePackage.textOpenWorldVNext
    ?.compatibility.compatiblePreviousPackageHashes.includes(pinned.manifest.packageHash) === true
  if (directLineage && runtimePackageHash) return 'release-lineage-and-runtime-package-hash'
  if (directLineage) return 'direct-release-lineage'
  if (runtimePackageHash) return 'runtime-package-hash'
  return 'not-declared'
}

function sessionBelongsToScope(session: ProductRuntimeSession, scope: WorkspaceScope): boolean {
  return session.projectId === scope.projectId
    && session.worldId === scope.worldId
    && session.workId === scope.workId
}

function isVNextOnlyRelease(release: VerifiedTextOpenWorldPlayerReleaseV1): boolean {
  const runtime = release.manifest.runtimePackage
  return runtime.textOpenWorldVNext != null
    && runtime.interaction == null
    && runtime.adventure == null
    && runtime.openWorldEvolution == null
    && runtime.openWorld == null
}

/**
 * Read-only, disclosure-safe version projection for one current text-open-world Session.
 *
 * It never returns RuntimePackage/manifest payloads and never reads Build Preview as a
 * formal release. Only a verified direct compatible child is exposed as a
 * migration target; the actual state-specific preview still fails closed.
 */
export async function projectTextOpenWorldPlayerVersionCompatibilityV1(input: {
  scope: WorkspaceScope
  currentSessionId: number
}): Promise<TextOpenWorldPlayerVersionCompatibilityProjectionV1> {
  if (!Number.isSafeInteger(input.currentSessionId) || input.currentSessionId <= 0) {
    fail('currentSessionId 无效')
  }
  const scope = await resolveScope({ scope: input.scope })
  const session = await db.productRuntimeSessions.get(input.currentSessionId)
  if (!session || !sessionBelongsToScope(session, scope)) fail('Session 不存在或跨 Work')
  if (session.kind !== 'text-open-world') fail('Session 不是文字开放世界实例')

  if (session.productReleaseId == null) {
    return unavailable('build-preview-excluded', {
      code: 'build-preview-excluded',
      releaseVersion: null,
      message: '制作预览不属于正式版本目录。',
    })
  }

  const currentRoot = await db.productReleases.get(session.productReleaseId)
  if (!currentRoot) {
    return unavailable('unavailable', {
      code: 'current-release-missing',
      releaseVersion: null,
      message: '当前存档绑定的正式发布不存在。',
    })
  }
  if (!await assertRecordInScope(scope, 'productReleases', currentRoot, { owner: 'work' })) {
    return unavailable('unavailable', {
      code: 'current-release-out-of-scope',
      releaseVersion: safeReleaseVersion(currentRoot),
      message: '当前存档绑定的正式发布不属于当前作品。',
    })
  }

  let pinned: VerifiedTextOpenWorldPlayerReleaseV1
  try {
    pinned = await verifyOwnedTextOpenWorldPlayerReleaseV1(scope, currentRoot)
  } catch {
    return unavailable('unavailable', {
      code: 'current-release-damaged',
      releaseVersion: safeReleaseVersion(currentRoot),
      message: '当前存档绑定的正式发布未通过完整性核验。',
    })
  }
  if (session.runtimeSourceHash !== pinned.manifest.packageHash) {
    return unavailable('unavailable', {
      code: 'session-release-binding-damaged',
      releaseVersion: pinned.release.version,
      message: '当前存档与正式发布的冻结运行包不一致。',
    })
  }

  const familyRoots = (await db.productReleases.where('workId').equals(scope.workId).toArray())
    .filter(release => release.productionKey === pinned.release.productionKey)
  const verified: VerifiedTextOpenWorldPlayerReleaseV1[] = []
  const diagnostics: TextOpenWorldPlayerVersionDiagnosticV1[] = []
  for (const release of familyRoots) {
    if (!await assertRecordInScope(scope, 'productReleases', release, { owner: 'work' })) continue
    try {
      verified.push(await verifyOwnedTextOpenWorldPlayerReleaseV1(scope, release))
    } catch {
      diagnostics.push({
        code: 'release-damaged',
        releaseVersion: safeReleaseVersion(release),
        message: '同产品族的一个正式发布未通过完整性核验，已从可用版本中排除。',
      })
    }
  }
  verified.sort((left, right) => right.release.version - left.release.version
    || right.release.createdAt - left.release.createdAt
    || right.release.id - left.release.id)
  diagnostics.sort((left, right) => (right.releaseVersion ?? -1) - (left.releaseVersion ?? -1))

  const releases = verified.map(({ release, manifest }) => {
    const relationToPinned = release.id === pinned.release.id
      ? 'pinned' as const
      : release.version < pinned.release.version ? 'older' as const : 'newer' as const
    const declaration = relationToPinned === 'newer'
      ? textOpenWorldPlayerCompatibilityDeclarationV1(pinned, { release, manifest })
      : null
    const directCompatibleChild = declaration === 'direct-release-lineage'
      || declaration === 'release-lineage-and-runtime-package-hash'
    return {
      actionIdentity: { productReleaseId: release.id },
      version: release.version,
      label: release.label.trim(),
      createdAt: release.createdAt,
      relationToPinned,
      verified: true as const,
      declaredCompatibleWithPinnedRelease: declaration == null
        ? null
        : declaration !== 'not-declared',
      compatibilityDeclaration: declaration,
      canMigratePinnedSession: relationToPinned === 'newer'
        && session.status === 'active'
        && isVNextOnlyRelease(pinned)
        && isVNextOnlyRelease({ release, manifest })
        && directCompatibleChild,
    }
  })

  const migrationAvailable = releases.some(release => release.canMigratePinnedSession)

  return {
    version: TEXT_OPEN_WORLD_PLAYER_VERSION_PROJECTION_VERSION_V1,
    availability: 'ready',
    productionKey: pinned.release.productionKey,
    pinnedRelease: {
      version: pinned.release.version,
      label: pinned.release.label.trim(),
      createdAt: pinned.release.createdAt,
      isLatestVerifiedRelease: releases[0]?.relationToPinned === 'pinned',
      canContinueWithoutUpgrade: true,
    },
    releases,
    diagnostics,
    migration: migrationAvailable
      ? { available: true, reason: 'compatible-release-available' }
      : { available: false, reason: 'no-compatible-newer-release' },
  }
}
