import { db } from '../db/schema'
import type {
  ProductBuildRecordV1,
  ProductProductionBriefRecordV1,
  ProductProductionBriefV3,
  ProductProductionCommandRecordV1,
  ProductProductionRecordV1,
  ProductionProductKindV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { readTextOpenWorldCreatorDerivedBuildAuthorityV1 } from '../open-world/creator-derived-authority'
import { parseProductProductionBriefV3 } from './contracts'
import { prepareLegacyPausedProductBuildV1 } from './scheduler'

export interface ProductProductionDetailsV1 {
  production: ProductProductionRecordV1
  brief: ProductProductionBriefRecordV1 | null
  /** Frozen scheduler/runtime envelope. Creator rows retain their own author
   * Brief in `briefJson`; this projection is available only after start. */
  executionBrief: ProductProductionBriefV3 | null
  build: ProductBuildRecordV1 | null
  artifactCount: number
  recentCommands: ProductProductionCommandRecordV1[]
  briefHistory: ProductProductionBriefRecordV1[]
  buildHistory: ProductBuildRecordV1[]
}

export async function readProductProductionDetailsV1(
  scopeInput: WorkspaceScope,
  productionId: number,
  allowedProducts?: readonly ProductionProductKindV1[],
): Promise<ProductProductionDetailsV1> {
  const scope = await resolveScope({ scope: scopeInput })
  const production = await db.productProductions.get(productionId)
  if (!production || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })) {
    throw new Error('[product-production-service] Production 不存在或跨 Work')
  }
  if (allowedProducts && !allowedProducts.includes(production.productType)) {
    throw new Error('[product-production-service] Production 不属于当前产品入口')
  }
  const [brief, build, commandRows, briefRows, buildRows] = await Promise.all([
    production.currentBriefRevision == null ? null : db.productProductionBriefs
      .where('[productionId+revision]').equals([productionId, production.currentBriefRevision]).first(),
    production.currentBuildNumber == null ? null : db.productBuilds
      .where('[productionId+buildNumber]').equals([productionId, production.currentBuildNumber]).first(),
    db.productProductionCommands.where('productionId').equals(productionId).toArray(),
    db.productProductionBriefs.where('productionId').equals(productionId).toArray(),
    db.productBuilds.where('productionId').equals(productionId).toArray(),
  ])
  if (brief && !await assertRecordInScope(scope, 'productProductionBriefs', brief, { owner: 'work' })) {
    throw new Error('[product-production-service] Brief 跨 Work')
  }
  if (build && !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) {
    throw new Error('[product-production-service] Build 跨 Work')
  }
  const recentCommands: ProductProductionCommandRecordV1[] = []
  for (const command of commandRows
    .sort((left, right) => right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0))
    .slice(0, 8)) {
    if (!await assertRecordInScope(scope, 'productProductionCommands', command, { owner: 'work' })) {
      throw new Error('[product-production-service] Command 跨 Work')
    }
    recentCommands.push(command)
  }
  const briefHistory: ProductProductionBriefRecordV1[] = []
  for (const row of briefRows.sort((left, right) => right.revision - left.revision)) {
    if (!await assertRecordInScope(scope, 'productProductionBriefs', row, { owner: 'work' })) {
      throw new Error('[product-production-service] Brief history 跨 Work')
    }
    briefHistory.push(row)
  }
  const buildHistory: ProductBuildRecordV1[] = []
  for (const row of buildRows.sort((left, right) => right.buildNumber - left.buildNumber)) {
    if (!await assertRecordInScope(scope, 'productBuilds', row, { owner: 'work' })) {
      throw new Error('[product-production-service] Build history 跨 Work')
    }
    buildHistory.push(row)
  }
  const storedOpenTtrpgBrief = (() => {
    if (!brief || brief.briefKind === 'text-open-world-creator-v1') return false
    try {
      const value = JSON.parse(brief.briefJson) as Record<string, unknown>
      return value.schema === 'storyforge.ttrpg-production-brief'
        && value.version === 3
        && value.runFormat === 'open'
    } catch {
      return false
    }
  })()
  const executionBrief = brief?.briefKind === 'text-open-world-creator-v1'
    ? brief.status === 'authorized' && build
      ? (await readTextOpenWorldCreatorDerivedBuildAuthorityV1({
          scope,
          buildId: build.id!,
        })).contracts.executionBrief
      : null
    : storedOpenTtrpgBrief ? null : brief ? parseProductProductionBriefV3(brief.briefJson) : null
  return {
    production,
    brief: brief ?? null,
    executionBrief,
    build: build ? await prepareLegacyPausedProductBuildV1(scope, build) : null,
    artifactCount: build?.id == null ? 0 : await db.productBuildArtifacts.where('buildId').equals(build.id).count(),
    recentCommands,
    briefHistory,
    buildHistory,
  }
}
