import { db } from '../db/schema'
import type { WorldRelease } from '../types/world-release'
import type { VerifiedWorldReleaseV1 } from './release-codec'

type Row = Record<string, unknown>
type Manifest = VerifiedWorldReleaseV1['manifest']
export type PublicationRelease = Pick<WorldRelease, 'projectId' | 'worldId' | 'revisionId' | 'manifestJson' | 'contentHash' | 'sourceWorldCode'>

async function readPublicationRows(release: PublicationRelease) {
  const [project, world, revision, revisions, works] = await Promise.all([
    db.projects.get(release.projectId), db.worlds.get(release.worldId), db.worldRevisions.get(release.revisionId),
    db.worldRevisions.where('worldId').equals(release.worldId).toArray(),
    db.works.where('worldId').equals(release.worldId).toArray(),
  ])
  return { project, world, revision, revisions, works }
}

function publicationAuthorityRows(release: PublicationRelease, captured: Awaited<ReturnType<typeof readPublicationRows>>) {
  const { project, world, revision, revisions, works } = captured
  let frozenWorkCode: unknown
  try {
    const snapshot = (JSON.parse(release.manifestJson) as Partial<Manifest>).semanticSnapshot
    frozenWorkCode = Array.isArray(snapshot?.works)
      ? snapshot.works.find(row => row?._exportId === snapshot.ownership?.workExportId)?.code : undefined
  } catch { /* A changed malformed release is still compared by the caller. */ }
  const parents: Row[] = [], seen = new Set<number>()
  let current = revision
  while (current) {
    if (current.id == null || seen.has(current.id)) { parents.push({ cycleAt: current.id }); break }
    seen.add(current.id)
    parents.push({ id: current.id, projectId: current.projectId, worldId: current.worldId, parentRevisionId: current.parentRevisionId })
    if (current.parentRevisionId === null) break
    const parentId: number = current.parentRevisionId
    current = revisions.find(row => row.id === parentId)
    if (!current) parents.push({ missingParent: parentId })
  }
  // Mutable manuscript fields and unrelated revisions are not permission.
  // Compare only the selected seal and the stable owner/parent identities.
  return JSON.stringify({
    project: project && { id: project.id, workspaceUid: project.workspaceUid, workspacePurpose: project.workspacePurpose },
    world: world && { id: world.id, projectId: world.projectId, identityKind: world.identityKind, code: world.code },
    revision: revision && { id: revision.id, projectId: revision.projectId, worldId: revision.worldId,
      parentRevisionId: revision.parentRevisionId, manifestJson: revision.manifestJson,
      contentHash: revision.contentHash, publicationOrigin: revision.publicationOrigin },
    parents,
    works: works.filter(row => row.projectId === release.projectId && row.code === frozenWorkCode)
      .map(row => ({ id: row.id, projectId: row.projectId, worldId: row.worldId, code: row.code })).sort((a, b) => a.id! - b.id!),
  })
}

/** Read-only CAS projection; content/hash verification happens before the
 * transaction. This function never grants author authority by itself. */
export async function readWorldPublicationAuthorityRowsV1(release: PublicationRelease) {
  return publicationAuthorityRows(release, await readPublicationRows(release))
}

/** Shared snapshot for the outside-transaction verifier and the inside-
 * transaction CAS. No signature/hash verification or dynamic imports here. */
export async function readWorldPublicationAuthoritySnapshotV1(release: PublicationRelease) {
  const captured = await readPublicationRows(release)
  return { ...captured, rows: publicationAuthorityRows(release, captured) }
}
