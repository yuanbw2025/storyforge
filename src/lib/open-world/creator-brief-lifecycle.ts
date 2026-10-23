import { db } from '../db/schema'
import type { ProductBuildRecordV1, ProductProductionRecordV1, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'

/** A replacement Brief starts a new Build; cancelled evidence stays on its original Build. */
export function canReviseStoppedTextOpenWorldCreatorBriefV1(
  production: ProductProductionRecordV1,
  build: ProductBuildRecordV1 | null | undefined,
): boolean {
  return production.productType === 'text-open-world'
    && Boolean(production.creatorSourceBindingHash)
    && production.status === 'stopped'
    && production.currentProductReleaseId == null
    && build != null
    && build.productionId === production.id
    && build.buildNumber === production.currentBuildNumber
    && build.status === 'cancelled'
    && build.releasedProductReleaseId == null
}

export async function assertTextOpenWorldCreatorBriefLifecycleV1(input: {
  scope: WorkspaceScope
  production: ProductProductionRecordV1
  phase: 'revise' | 'start'
}): Promise<void> {
  const { scope, production, phase } = input
  const fail = (): never => {
    throw new Error('[text-open-world-creator-brief] 当前制作不能修订或重新授权简报；请先停止未发布 Build，保留原产物后确认新修订。')
  }
  if (production.productType !== 'text-open-world'
    || !production.creatorSourceBindingHash
    || production.currentProductReleaseId != null
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || !(phase === 'start' ? production.status === 'brief-ready'
      : ['consulting', 'brief-ready', 'stopped'].includes(production.status))) fail()

  const builds = await db.productBuilds.where('productionId').equals(production.id!).toArray()
  if (production.currentBuildNumber == null) {
    if (builds.length || production.status === 'stopped') fail()
    return
  }
  const build = builds.find(row => row.buildNumber === production.currentBuildNumber)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || build.status !== 'cancelled' || build.releasedProductReleaseId != null
    || builds.some(row => row.buildNumber > build.buildNumber)
    || !['stopped', 'brief-ready'].includes(production.status)
    || (phase === 'start' && (production.currentBriefRevision ?? 0) <= build.briefRevision)) fail()
}
