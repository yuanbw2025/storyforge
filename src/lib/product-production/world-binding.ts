import { db } from '../db/schema'
import type { ProductProductionBriefV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { hashProductProductionValueV2 } from './hash'
import { parseProductProductionSourcePlanV1, resolveProductProductionWorldScopeV1 } from './source-contracts'

/** Resolve an existing Build's source without rewriting its frozen Brief,
 * reselecting a release, or falling back to a pre-import record ID. */
export async function readProductProductionBuildWorldScopeV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  brief: ProductProductionBriefV3
}) {
  const [build, production] = await Promise.all([
    db.productBuilds.get(input.buildId),
    db.productProductions.get(input.productionId),
  ])
  if (!build || !production || build.productionId !== production.id
    || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })
    || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) {
    throw new Error('[product-production-source] Build/Production 世界来源作用域不一致')
  }
  const row = await db.productProductionBriefs.where('[productionId+revision]')
    .equals([production.id!, build.briefRevision]).first()
  if (!row || row.briefKind === 'text-open-world-creator-v1' || row.status !== 'authorized'
    || !await assertRecordInScope(input.scope, 'productProductionBriefs', row, { owner: 'work' })
    || row.briefHash !== build.briefHash
    || await hashProductProductionValueV2(input.brief) !== row.briefHash
    || await hashProductProductionValueV2(JSON.parse(row.briefJson)) !== row.briefHash
    || row.sourceWorldContentHash !== input.brief.source.worldContentHash) {
    throw new Error('[product-production-source] Build/Brief 冻结来源校验失败')
  }
  const sourcePlan = await parseProductProductionSourcePlanV1(row)
  if (sourcePlan.productInstanceKey !== production.productionKey
    || sourcePlan.worldReference.localReleaseRecordId !== row.sourceWorldReleaseId) {
    throw new Error('[product-production-source] Brief/SourcePlan 本地世界引用不一致')
  }
  return resolveProductProductionWorldScopeV1({ ...input, sourcePlan })
}
