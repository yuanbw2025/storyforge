import type { WorkspaceScope } from '../types'

/** Only the built-in installer receives a live permit. Stored objects and
 * concurrent production commands cannot recreate it from their contents. */
export interface SaltRidgeInstallPermit { readonly installation: 'salt-ridge' }

const active = new WeakMap<SaltRidgeInstallPermit, { scope: WorkspaceScope; worldReleaseId: number; contentHash: string; referenceHash: string }>()

export function admitsSaltRidgeInstall(
  permit: SaltRidgeInstallPermit | undefined, productType: string, scope: WorkspaceScope, worldReleaseId: number | null,
  identity?: { contentHash?: string; referenceHash?: string },
): boolean {
  const grant = permit && active.get(permit)
  return !!grant && productType === 'text-open-world' && grant.worldReleaseId === worldReleaseId
    && (identity?.contentHash === undefined || identity.contentHash === grant.contentHash)
    && (identity?.referenceHash === undefined || identity.referenceHash === grant.referenceHash)
    && grant.scope.projectId === scope.projectId && grant.scope.worldId === scope.worldId && grant.scope.workId === scope.workId
}

export async function installFrozenSaltRidge(onProgress: (message: string) => void) {
  const { createSaltRidgeWorldV1, verifySaltRidgeShowcaseSourceV1 } = await import('../world-engine/salt-ridge-preset')
  const { materializeSaltRidgeShowcase } = await import('./production')
  const { scope: currentScope, worldReleaseId } = await createSaltRidgeWorldV1()
  const { contentHash, scope } = await verifySaltRidgeShowcaseSourceV1(currentScope, worldReleaseId)
  const { describeWorldSemanticReleaseV1 } = await import('../context-gateway/world-release-client')
  const { description } = await describeWorldSemanticReleaseV1({
    localReleaseRecordId: worldReleaseId, expectedProjectId: scope.projectId, expectedWorldId: scope.worldId,
  })
  const reference = description.worldReference
  if (reference.releaseHash !== contentHash) throw new Error('盐脊展示冻结来源已变化')
  const permit: SaltRidgeInstallPermit = Object.freeze({ installation: 'salt-ridge' })
  active.set(permit, { scope: { ...scope }, worldReleaseId, contentHash, referenceHash: reference.referenceHash })
  try {
    return await materializeSaltRidgeShowcase(scope, worldReleaseId, permit, onProgress)
  } finally {
    active.delete(permit)
  }
}
