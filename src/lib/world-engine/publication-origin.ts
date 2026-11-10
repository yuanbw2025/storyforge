import { db } from '../db/schema'
import type { WorldRelease, WorldRevisionOriginV1 } from '../types/world-release'
import { assertWorldRevisionOriginV1 } from './publication-origin-contract'
import { verifyWorldReleaseManifestV1, type VerifiedWorldReleaseV1 } from './release-codec'

type Row = Record<string, unknown>
type Manifest = VerifiedWorldReleaseV1['manifest']

/** Called by the actual seal or cache writer, never copied from package data. */
export function worldRevisionOriginV1(kind: WorldRevisionOriginV1['kind'], manifest: Manifest, contentHash: string): WorldRevisionOriginV1 {
  return { version: 1, kind, sourceWorkspaceUid: manifest.sourceManifest.sourceWorkspaceUid,
    worldCode: manifest.worldCode, contentHash }
}

function matchesOrigin(origin: unknown, manifest: Manifest, contentHash: string): origin is WorldRevisionOriginV1 {
  try { assertWorldRevisionOriginV1(origin) } catch { return false }
  return origin.contentHash === contentHash && origin.worldCode === manifest.worldCode
    && origin.sourceWorkspaceUid === manifest.sourceManifest.sourceWorkspaceUid
}

function ownsFrozenRoots(manifest: Manifest, world: Row, works: Row[]) {
  const snapshot = manifest.semanticSnapshot
  const rootWorld = snapshot.worlds.find(row => row._exportId === snapshot.ownership.worldExportId)
  const rootWork = snapshot.works.find(row => row._exportId === snapshot.ownership.workExportId)
  return world.identityKind === 'world-draft' && world.code === manifest.worldCode
    && rootWorld?.code === world.code && rootWork?.code !== undefined
    && works.filter(row => row.code === rootWork.code).length === 1
    && snapshot.project.workspaceUid === manifest.sourceManifest.sourceWorkspaceUid
}

/** Public code is a lookup key. Authority requires the exact sealed revision
 * and owned frozen World/Work roots; an explicit cache can never be promoted. */
export async function readWorldPublicationAuthorityV1(release: Pick<WorldRelease, 'projectId' | 'worldId' | 'revisionId' | 'manifestJson' | 'contentHash' | 'sourceWorldCode'>, verified: VerifiedWorldReleaseV1) {
  const [project, world, revision, revisions, works] = await Promise.all([
    db.projects.get(release.projectId), db.worlds.get(release.worldId), db.worldRevisions.get(release.revisionId),
    db.worldRevisions.where('worldId').equals(release.worldId).toArray(),
    db.works.where('worldId').equals(release.worldId).toArray(),
  ])
  const rows = JSON.stringify({ project, world, revision, revisions, works })
  if (!project || project.workspacePurpose !== 'world-engine' || !world || world.projectId !== release.projectId
    || !revision || revision.projectId !== release.projectId || revision.worldId !== release.worldId
    || revision.manifestJson !== release.manifestJson || revision.contentHash !== release.contentHash
    || release.sourceWorldCode !== world.code || !ownsFrozenRoots(verified.manifest, world as unknown as Row,
      works.filter(row => row.projectId === release.projectId) as unknown as Row[])) return { author: false, rows }
  const seen = new Set<number>()
  let current: typeof revision | undefined = revision
  while (current) {
    if (current.id == null || seen.has(current.id) || current.projectId !== release.projectId) return { author: false, rows }
    seen.add(current.id)
    if (current.parentRevisionId === null) break
    current = revisions.find(row => row.id === current!.parentRevisionId)
    if (!current) return { author: false, rows }
  }
  const origin = revision.publicationOrigin
  const author = origin === undefined
    ? verified.manifest.sourceManifest.sourceWorkspaceUid === project.workspaceUid
    : matchesOrigin(origin, verified.manifest, release.contentHash) && origin.kind === 'author-seal'
  return { author, rows }
}

/** Validate the complete detached backup before any writes. Legacy ownership
 * can be reconstructed only while its original workspace UID still matches.
 * Existing origin claims also require real owner roots, exact frozen hashes
 * and the whole linked revision tree; the marker alone grants nothing. */
export async function preparePortableWorldRevisionOriginsV1(value: Record<string, unknown>) {
  const rows = (name: string): Row[] => Array.isArray(value[name]) ? value[name] as Row[] : []
  const worlds = rows('worlds'), works = rows('works'), revisions = rows('worldRevisions'), releases = rows('worldReleases')
  const project = value.project as Row
  const prepared = new Map<number, WorldRevisionOriginV1>()
  for (const revision of revisions) {
    const claimed = revision.publicationOrigin
    if (claimed !== undefined) assertWorldRevisionOriginV1(claimed)
    // Older incomplete/ambiguous rows remain readable; no new authority is
    // manufactured from a world code or a transported declaration.
    let verified: VerifiedWorldReleaseV1
    try {
      verified = await verifyWorldReleaseManifestV1({ manifest: revision.manifestJson, expectedContentHash: revision.contentHash as string })
    } catch (error) {
      if (claimed !== undefined) throw error
      continue
    }
    if (claimed !== undefined && !matchesOrigin(claimed, verified.manifest, revision.contentHash as string)) {
      throw Error('[world-publication-origin] 来源记录与冻结修订不匹配')
    }
    if (claimed?.kind === 'reference-cache') { prepared.set(revision._exportId as number, claimed); continue }
    const world = worlds.find(row => row._exportId === revision._worldExportId)
    const completeOwner = project.workspacePurpose === 'world-engine' && world
      && ownsFrozenRoots(verified.manifest, world, works.filter(row => row._worldExportId === world._exportId))
    const linked = releases.filter(row => row._revisionExportId === revision._exportId)
    const completeReleases = linked.every(row => row._worldExportId === revision._worldExportId
      && row.manifestJson === revision.manifestJson && row.contentHash === revision.contentHash
      && row.sourceWorldCode === verified.manifest.worldCode)
    const visited = new Set<unknown>()
    let ancestor: Row | undefined = revision
    let completeTree = true
    while (ancestor) {
      if (visited.has(ancestor._exportId) || ancestor._worldExportId !== revision._worldExportId) { completeTree = false; break }
      visited.add(ancestor._exportId)
      if (ancestor._parentExportId == null) break
      const parentId: unknown = ancestor._parentExportId
      ancestor = revisions.find(row => row._exportId === parentId)
      if (!ancestor) completeTree = false
    }
    const author = completeOwner && completeReleases && completeTree
      && (claimed?.kind === 'author-seal' || verified.manifest.sourceManifest.sourceWorkspaceUid === project.workspaceUid)
    if (claimed?.kind === 'author-seal' && !author) throw Error('[world-publication-origin] 作者来源缺少完整本地封存 owner 链')
    if (author) prepared.set(revision._exportId as number, worldRevisionOriginV1('author-seal', verified.manifest, revision.contentHash as string))
  }
  return prepared
}
