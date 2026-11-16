import { db } from '../db/schema'
import { createWorkspaceForAdventureWebPackageV1 } from '../product-platform/workspace-install'
import { importTextAdventureCommunityPackageV1, verifyTextAdventureCommunityPackageV1 } from './community-package'

/** Dedicated game DB only. Reuse governed workspace and product import lifecycles. */
export async function installAdventureWebPackageV1(value: unknown) {
  value = structuredClone(value)
  let candidate = await verifyTextAdventureCommunityPackageV1(value)
  const hash = candidate.candidatePackageHash
  const uid = `WS-${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
  const title = candidate.dossier.title
  // Workspace identity is committed before installation; a failed media import can
  // be retried in the same empty workspace without duplicating player saves.
  let project = await db.projects.where('workspaceUid').equals(uid).first()
  if (!project) {
    const created = await createWorkspaceForAdventureWebPackageV1({
      workspaceUid: uid, name: title, genres: ['other'], status: 'drafting', description: '', targetWordCount: 0,
    }, { package: candidate, expectedCandidatePackageHash: hash })
    project = created.workspace.project
    candidate = created.package
  }
  if (!project.id || !project.activeWorldId || !project.activeWorkId) throw new Error('游戏存档工作区不完整。')
  const scope = { projectId: project.id, worldId: project.activeWorldId, workId: project.activeWorkId }
  const imported = await importTextAdventureCommunityPackageV1({ scope, package: candidate })
  return { project, scope, release: imported.release, title }
}
