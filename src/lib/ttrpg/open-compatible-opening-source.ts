/** Actual previous release in the current Work, read without starting or changing production. */
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { verifyProductReleaseManifestV1 } from '../product-production/runtime-package'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { isTtrpgRuntimeContentV2 } from './content-version'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { ttrpgCompatibleOpeningAuthoringBaseV1 } from './open-compatible-opening-contract'

export async function readTtrpgCompatibleOpeningReleaseV1(input: {
  scope: WorkspaceScope; productionId: number; productReleaseId?: number; expectedContentHash?: string
}) {
  const production = await db.productProductions.get(input.productionId)
  let release = input.productReleaseId == null ? undefined : await db.productReleases.get(input.productReleaseId)
  // Imported frozen Brief bytes keep historical IDs. The immutable hash resolves only inside this exact Work/production.
  // An explicitly supplied wrong local ID never falls back to a different release.
  if (input.productReleaseId == null) {
    if (!input.expectedContentHash) throw Error('[ttrpg-opening-source] 缺少准确的发布来源')
    const matches = (await db.productReleases.where('workId').equals(input.scope.workId).toArray()).filter(r =>
      r.projectId === input.scope.projectId && r.worldId === input.scope.worldId && r.productType === 'ttrpg'
      && r.productionKey === production?.productionKey && r.contentHash === input.expectedContentHash)
    if (matches.length !== 1) throw Error('[ttrpg-opening-source] 本作品的准确发布来源缺失或不唯一')
    release = matches[0]
  }

  const sameOwner = (r: { projectId: number; worldId: number; workId: number }) => r.projectId === input.scope.projectId && r.worldId === input.scope.worldId && r.workId === input.scope.workId
  if (!production || !release || !sameOwner(production) || !sameOwner(release) || production.productType !== 'ttrpg'
    || release.productType !== 'ttrpg' || release.productionKey !== production.productionKey
    || input.expectedContentHash !== undefined && input.expectedContentHash !== release.contentHash) throw Error('[ttrpg-opening-source] 原发布不属于本作品或内容已变化')
  const manifest = await verifyProductReleaseManifestV1(release.manifestJson, { ttrpgProtocol: 2 }), content = manifest.runtimePackage.ttrpg
  if (await hash(manifest) !== release.contentHash || !content || !isTtrpgRuntimeContentV2(content)
    || manifest.productionProvenance.productionKey !== production.productionKey) throw Error('[ttrpg-opening-source] 原冻结开放发布校验失败')
  return { production, release, manifest, content }
}
export async function readTtrpgCompatibleOpeningAuthoringBaseV1(input: { scope: WorkspaceScope; productionId: number }) {
  const production = await db.productProductions.get(input.productionId)
  if (!production?.currentProductReleaseId) throw Error('[ttrpg-opening-source] 请先发布原作品，再准备新版本')
  const source = await readTtrpgCompatibleOpeningReleaseV1({ ...input, productReleaseId: production.currentProductReleaseId })
  const row = production.currentBriefRevision == null ? null : await db.productProductionBriefs.where('[productionId+revision]').equals([input.productionId, production.currentBriefRevision]).first()
  if (!row || row.projectId !== input.scope.projectId || row.worldId !== input.scope.worldId || row.workId !== input.scope.workId) throw Error('[ttrpg-opening-source] 本作品制作方案缺失')
  const brief = parseProductProductionBriefV3(row.briefJson)
  if (!brief.ttrpgOpen || await hash(brief) !== row.briefHash) throw Error('[ttrpg-opening-source] 本作品制作方案校验失败')
  return { label: source.release.label, version: source.release.version, releaseHash: source.release.contentHash,
    authoring: ttrpgCompatibleOpeningAuthoringBaseV1(source.content.campaign, brief.ttrpgOpen.settings.openAuthoring.factPolicy) }
}
