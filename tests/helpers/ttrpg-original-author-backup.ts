import { db } from '../../src/lib/db/schema'
import { exportProjectJSON } from '../../src/lib/export/json-export'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'

// A product backup carries frozen references, not the separate author's authority.
// Export that real workspace while it still exists; never manufacture a same-R source.
export async function exportOriginalAuthorSource(productionId: number) {
  const production = (await db.productProductions.get(productionId))!
  const brief = (await db.productProductionBriefs.where('[productionId+revision]').equals([productionId,production.currentBriefRevision!]).first())!
  const proof = parseProductProductionBriefV3(brief.briefJson).source.sourcePurpose
  if (!proof || proof.origin.kind !== 'local-author') throw new Error('Expected the original authored source proof')
  const origin = proof.origin.authorWorld
  const authors = await db.projects.where('workspaceUid').equals(origin.workspaceUid).toArray()
  if (authors.length !== 1 || !authors[0].id || authors[0].id === production.projectId) throw new Error('Expected the separate original author workspace')
  const author = authors[0]
  const worlds = (await db.worlds.where('projectId').equals(author.id!).toArray()).filter(row => row.code === origin.worldCode)
  if (worlds.length !== 1 || !worlds[0].id) throw new Error('Expected the original author World')
  const releases = (await db.worldReleases.where('worldId').equals(worlds[0].id).toArray()).filter(row =>
    row.projectId === author.id && row.releaseUid === proof.selectedRelease.releaseUid && row.contentHash === proof.selectedRelease.releaseHash)
  if (releases.length !== 1) throw new Error('Expected the exact original authored release')
  return { backup: await exportProjectJSON(author.id!), proof, authorWorld: origin, manifestJson: releases[0].manifestJson }
}
