import { db } from '../db/schema'
import { canonicalStringify } from '../agent/run/hash'
import type { UpperProductKindV1 } from '../types/product-identity'
import { fail, purposeHash, encodeDeclaration, readWorldSourcePurposeDeclarationV1, validateWorldSourcePurposeProofV1,
  type WorldSourcePurposeProofV1, type WorldSourcePurposeInputV1, type PurposeOrigin } from './source-purpose-contract'

export { parseWorldSourcePurposeProofV1, readWorldSourcePurposeDeclarationV1, validateWorldSourcePurposeProofV1,
  type WorldSourcePurposeProofV1 } from './source-purpose-contract'
export { assertWorldSourcePurposeCasV1, prepareWorldSourcePurposeCasV1, worldSourcePurposeTransactionTablesV1,
  type WorldSourcePurposeCasWitnessV1 } from './source-purpose-cas'

export async function freezeWorldSourcePurposeV1(input: {
  worldReleaseId: number
  expectedProjectId: number
  expectedWorldId: number
  purpose: UpperProductKindV1
  sourceDeclarationHash?: string
}): Promise<WorldSourcePurposeProofV1> {
  input = { ...input }
  if (input.sourceDeclarationHash !== undefined && !/^[a-f0-9]{64}$/.test(input.sourceDeclarationHash)) fail('所选原包声明身份无效。')
  const [{ verifyWorldReleaseRecordV1 }, { readWorldSourceReceiptV1, resolveWorldEditingSourceV1 }, { readWorldPublicationAuthorityV1 }] =
    await Promise.all([import('./release-codec'), import('./source-receipt'), import('./publication-origin')])
  const scope = { projectId: input.expectedProjectId, worldId: input.expectedWorldId }
  const [release, world, derivations, project] = await Promise.all([
    db.worldReleases.get(input.worldReleaseId), db.worlds.get(scope.worldId),
    db.worldDerivations.where('worldId').equals(scope.worldId).toArray(), db.projects.get(scope.projectId),
  ])
  if (!release || !world || release.projectId !== scope.projectId || release.worldId !== scope.worldId ||
    world.projectId !== scope.projectId || !project?.workspaceUid) fail('来源冻结版本缺失或越域。')
  const verified = await verifyWorldReleaseRecordV1(release)
  const selectedRelease = { releaseUid: release.releaseUid, releaseHash: release.contentHash }
  const publicationAuthority = await readWorldPublicationAuthorityV1(release, verified)
  const localWorldRelease = publicationAuthority.author
  const editing = localWorldRelease && (derivations.some(row => row.sourceKind === 'world-release-copy') ||
    (verified.version === 4 && verified.manifest.sourceManifest.lineage?.kind === 'world-copy') ||
    world.communityOrigin !== undefined || 'communityOrigin' in verified.manifest.semanticSnapshot.worlds[0])
  const authorWorld = { workspaceUid: project.workspaceUid, worldCode: world.code }
  let origin: PurposeOrigin
  if (editing) {
    const chosen = await resolveWorldEditingSourceV1(scope)
    const declaration = chosen.captured.declaration
    if (input.sourceDeclarationHash && input.sourceDeclarationHash !== declaration.declarationHash)
      fail('必须使用编辑时明确绑定的原包声明。')
    origin = { kind: 'declared', relation: 'editing-lineage', declarationWire: encodeDeclaration(declaration), authorWorld }
  } else if (input.sourceDeclarationHash) {
    const chosen = await readWorldSourceReceiptV1(scope, input.sourceDeclarationHash)
    if (chosen.row.worldReleaseId !== release.id || chosen.row.releaseUid !== release.releaseUid ||
      chosen.captured.frozenRelease.contentHash !== release.contentHash) fail('所选声明与当前冻结版本不是同一来源。')
    origin = { kind: 'declared', relation: 'installed', declarationWire: encodeDeclaration(chosen.captured.declaration) }
  } else if (localWorldRelease) {
    origin = { kind: 'local-author', authorWorld }
  } else {
    fail('此冻结来源没有明确选择的用途声明（unknown）。')
  }
  const body = { version: 1 as const, purpose: input.purpose, selectedRelease, origin }
  const proof = await validateWorldSourcePurposeProofV1({ ...body, evidenceHash: purposeHash(body) }, selectedRelease, input.purpose)
  const [liveWorld, liveRelease, liveDerivations, liveProject] = await Promise.all([
    db.worlds.get(scope.worldId), db.worldReleases.get(input.worldReleaseId),
    db.worldDerivations.where('worldId').equals(scope.worldId).toArray(), db.projects.get(scope.projectId),
  ])
  if (canonicalStringify({ world, release, derivations, workspaceUid: project.workspaceUid }) !==
    canonicalStringify({ world: liveWorld, release: liveRelease, derivations: liveDerivations, workspaceUid: liveProject?.workspaceUid })
    || publicationAuthority.rows !== (await readWorldPublicationAuthorityV1(release, verified)).rows) fail('冻结来源在核验期间变化。')
  return proof
}


/** For a new action, authority comes from the exact original source, not the
 * digest alone or a same-R search in arbitrary workspaces. */


export async function revalidateWorldSourcePurposeV1(input: WorldSourcePurposeInputV1) {
  input = { ...input, proof: input.proof && structuredClone(input.proof) }
  const { verifyWorldReleaseRecordV1 } = await import('./release-codec')
  const release = await db.worldReleases.get(input.worldReleaseId)
  if (!release || release.projectId !== input.expectedProjectId || release.worldId !== input.expectedWorldId)
    fail('当前选择的冻结版本缺失或越域。')
  const selected = { releaseUid: release.releaseUid, releaseHash: release.contentHash }
  await verifyWorldReleaseRecordV1(release)
  if (!input.proof) {
    const current = await freezeWorldSourcePurposeV1(input)
    if (current.origin.kind !== 'local-author') fail('旧计划缺少用途选择；请重新冻结来源。')
    return current
  }
  const proof = await validateWorldSourcePurposeProofV1(input.proof, selected, input.purpose)
  if (proof.origin.kind === 'declared' && proof.origin.relation === 'installed') {
    const current = await freezeWorldSourcePurposeV1({ ...input, sourceDeclarationHash: readWorldSourcePurposeDeclarationV1(proof.origin).declarationHash })
    if (canonicalStringify(current) !== canonicalStringify(proof)) fail('所选原包声明已失效。')
    return current
  }
  const origin = proof.origin.authorWorld
  // A complete restored author World can prove ownership directly. Its
  // workspace UID may be remapped on same-database import; never rewrite
  // the original frozen citation or recover authority for a foreign cache.
  if (release.sourceWorldCode === origin.worldCode) {
    const directWorld = await db.worlds.get(input.expectedWorldId)
    if (directWorld?.code === origin.worldCode && directWorld.projectId === input.expectedProjectId) {
      const direct = await freezeWorldSourcePurposeV1({
        ...input, ...(proof.origin.kind === 'declared' ? { sourceDeclarationHash: readWorldSourcePurposeDeclarationV1(proof.origin).declarationHash } : {}),
      })
      if (direct.origin.kind === 'local-author' && proof.origin.kind === 'local-author') return proof
      if (direct.origin.kind === 'declared' && direct.origin.relation === 'editing-lineage' &&
        proof.origin.kind === 'declared' && proof.origin.relation === 'editing-lineage' &&
        readWorldSourcePurposeDeclarationV1(direct.origin).declarationHash === readWorldSourcePurposeDeclarationV1(proof.origin).declarationHash) return proof
      fail('恢复后的原作者世界无法核实同一来源。')
    }
  }
  const projects = await db.projects.where('workspaceUid').equals(origin.workspaceUid).toArray()
  const author = projects.length === 1 ? projects[0] : null
  const worlds = author?.id != null ? await db.worlds.where('projectId').equals(author.id).filter(row => row.code === origin.worldCode).toArray() : []
  const world = worlds.length === 1 ? worlds[0] : null
  if (!author?.id || !world?.id) fail('已明确选择的原作者世界目前不可核实。')
  const candidates = (await db.worldReleases.where('worldId').equals(world.id).toArray()).filter(row =>
    row.projectId === author.id && row.releaseUid === selected.releaseUid && row.contentHash === selected.releaseHash)
  if (candidates.length !== 1 || candidates[0].id == null) fail('原作者冻结版本目前不可核实。')
  const current = await freezeWorldSourcePurposeV1({ worldReleaseId: candidates[0].id,
    expectedProjectId: author.id, expectedWorldId: world.id, purpose: input.purpose,
    ...(proof.origin.kind === 'declared' ? { sourceDeclarationHash: readWorldSourcePurposeDeclarationV1(proof.origin).declarationHash } : {}),
  })
  if (canonicalStringify(current) !== canonicalStringify(proof)) fail('原作者用途证据变化。')
  return current
}
