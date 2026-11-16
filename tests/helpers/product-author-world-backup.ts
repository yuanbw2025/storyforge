import { db } from '../../src/lib/db/schema'
import { exportProjectJSON } from '../../src/lib/export/json-export'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseWorldSourcePurposeProofV1 } from '../../src/lib/world-engine/source-purpose-contract'

export async function readOriginalAuthorWorld(sourcePurpose: unknown, productProjectId: number) {
  const proof = parseWorldSourcePurposeProofV1(sourcePurpose)
  if (proof.origin.kind !== 'local-author') throw new Error('Expected a local author world')
  const { workspaceUid, worldCode } = proof.origin.authorWorld
  const projects = await db.projects.where('workspaceUid').equals(workspaceUid).toArray()
  const projectId = projects[0]?.id
  if (projects.length !== 1 || projectId == null || projectId === productProjectId)
    throw new Error('Expected one separate original author workspace')
  const worlds = await db.worlds.where('projectId').equals(projectId).filter(world => world.code === worldCode).toArray()
  const worldId = worlds[0]?.id
  if (worlds.length !== 1 || worldId == null) throw new Error('Expected the exact original author world')
  const { releaseUid, releaseHash } = proof.selectedRelease
  const releases = await db.worldReleases.where('worldId').equals(worldId).filter(release =>
    release.projectId === projectId && release.releaseUid === releaseUid && release.contentHash === releaseHash).toArray()
  if (releases.length !== 1) throw new Error('Expected the exact original authored frozen release')
  return { projectId, workspaceUid, worldCode, manifestJson: releases[0].manifestJson }
}

export async function exportOriginalAuthorSource(productionId: number) {
  const production = await db.productProductions.get(productionId)
  if (production?.currentBriefRevision == null) throw new Error('Expected a production with a current brief')
  const brief = await db.productProductionBriefs.where('[productionId+revision]')
    .equals([productionId, production.currentBriefRevision]).first()
  if (!brief) throw new Error('Expected the recorded production brief')
  const sourcePurpose = parseProductProductionBriefV3(brief.briefJson).source.sourcePurpose
  const author = await readOriginalAuthorWorld(sourcePurpose, production.projectId)
  return { backup: await exportProjectJSON(author.projectId), sourcePurpose, worldManifestJson: author.manifestJson }
}
