import { db } from '../db/schema'
import type {
  ProductBuildRecordV1,
  ProductProductionBriefV3,
  ProductProductionBriefRecordV1,
  ProductProductionCommandRecordV1,
  ProductProductionPlanV3,
  ProductProductionRecordV1,
  TextOpenWorldCreatorBriefV1,
  TextOpenWorldCreatorProductionSourcePlanV1,
  TextOpenWorldCreatorProductionStartV1,
  WorkspaceScope,
} from '../types'
import type { TextOpenWorldCreatorRepairExecutionAuthorityV1 } from './creator-artifact-repair-authority'
import type { TextOpenWorldCreatorMediaExecutionAuthorityV1 } from './creator-media-authority'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductProductionPlanV3 } from '../product-production/plan'

function fail(message: string): never {
  throw new Error(`[text-open-world-creator-derived-authority] ${message}`)
}

export interface TextOpenWorldCreatorDerivedContractsV1 {
  creatorBrief: TextOpenWorldCreatorBriefV1
  sourcePlan: TextOpenWorldCreatorProductionSourcePlanV1
  start: TextOpenWorldCreatorProductionStartV1
  executionBrief: ProductProductionBriefV3
}

export type TextOpenWorldCreatorDerivedBuildAuthorityV1 =
  | {
      origin: 'creator-start-v1'
      production: ProductProductionRecordV1 & { id: number }
      build: ProductBuildRecordV1 & { id: number }
      briefRow: ProductProductionBriefRecordV1 & { id: number }
      contracts: TextOpenWorldCreatorDerivedContractsV1
      productionPlan: ProductProductionPlanV3
      authorizationHash: string
      commandChain: Array<ProductProductionCommandRecordV1 & { id: number }>
      repair: null
      media: null
    }
  | {
      origin: 'creator-repair-v1'
      production: ProductProductionRecordV1 & { id: number }
      build: ProductBuildRecordV1 & { id: number }
      briefRow: ProductProductionBriefRecordV1 & { id: number }
      contracts: TextOpenWorldCreatorDerivedContractsV1
      productionPlan: ProductProductionPlanV3
      authorizationHash: string
      commandChain: Array<ProductProductionCommandRecordV1 & { id: number }>
      repair: TextOpenWorldCreatorRepairExecutionAuthorityV1
      media: null
    }
  | {
      origin: 'creator-media-v1'
      production: ProductProductionRecordV1 & { id: number }
      build: ProductBuildRecordV1 & { id: number }
      briefRow: ProductProductionBriefRecordV1 & { id: number }
      contracts: TextOpenWorldCreatorDerivedContractsV1
      productionPlan: ProductProductionPlanV3
      authorizationHash: string
      commandChain: Array<ProductProductionCommandRecordV1 & { id: number }>
      repair: null
      media: TextOpenWorldCreatorMediaExecutionAuthorityV1
    }

/**
 * Resolve any Creator Build in a mixed start -> repair -> media lineage. The
 * specific authority readers remain responsible for their own command and CAS
 * proof; this router only prevents downstream code from assuming that every
 * derived Build is an artifact repair.
 */
export async function readTextOpenWorldCreatorDerivedBuildAuthorityV1(input: {
  scope: WorkspaceScope
  buildId: number
}): Promise<TextOpenWorldCreatorDerivedBuildAuthorityV1> {
  const scope = await resolveScope({ scope: input.scope })
  const buildValue = await db.productBuilds.get(input.buildId)
  if (!buildValue?.id
    || !await assertRecordInScope(scope, 'productBuilds', buildValue, { owner: 'work' })) {
    fail('Build 不存在或越界')
  }
  const build = buildValue as ProductBuildRecordV1 & { id: number }
  if (build.parentBuildNumber != null) {
    const candidates: TextOpenWorldCreatorDerivedBuildAuthorityV1[] = []
    try {
      const { readTextOpenWorldCreatorRepairExecutionAuthorityV1 } = await import(
        './creator-artifact-repair-authority'
      )
      const repair = await readTextOpenWorldCreatorRepairExecutionAuthorityV1({ scope, buildId: build.id })
      candidates.push({
        origin: 'creator-repair-v1',
        production: repair.production,
        build: repair.targetBuild,
        briefRow: repair.briefRow,
        contracts: {
          creatorBrief: repair.creatorBrief,
          sourcePlan: repair.sourcePlan,
          start: repair.start,
          executionBrief: repair.executionBrief,
        },
        productionPlan: repair.targetProductionPlan,
        authorizationHash: repair.authorization.authorizationHash,
        commandChain: repair.commandChain,
        repair,
        media: null,
      })
    } catch { /* another registered Creator derived-build authority may own it */ }
    try {
      const { readTextOpenWorldCreatorMediaExecutionAuthorityV1 } = await import('./creator-media-authority')
      const media = await readTextOpenWorldCreatorMediaExecutionAuthorityV1({ scope, buildId: build.id })
      candidates.push({
        origin: 'creator-media-v1',
        production: media.production,
        build: media.targetBuild,
        briefRow: media.briefRow,
        contracts: {
          creatorBrief: media.creatorBrief,
          sourcePlan: media.sourcePlan,
          start: media.start,
          executionBrief: media.executionBrief,
        },
        productionPlan: media.targetProductionPlan,
        authorizationHash: media.authorization.authorizationHash,
        commandChain: media.commandChain,
        repair: null,
        media,
      })
    } catch { /* reported below without leaking an unrelated parser diagnostic */ }
    if (candidates.length !== 1) fail('派生 Build 缺少唯一 Creator repair/media 权威')
    return candidates[0]
  }
  const [productionValue, briefValue] = await Promise.all([
    db.productProductions.get(build.productionId),
    db.productProductionBriefs.where('[productionId+revision]')
      .equals([build.productionId, build.briefRevision]).first(),
  ])
  if (!productionValue?.id || !briefValue?.id
    || !await assertRecordInScope(scope, 'productProductions', productionValue, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productProductionBriefs', briefValue, { owner: 'work' })
    || productionValue.productType !== 'text-open-world'
    || briefValue.briefKind !== 'text-open-world-creator-v1'
    || briefValue.status !== 'authorized'
    || build.productionId !== productionValue.id
    || build.briefRevision !== briefValue.revision
    || build.briefHash !== briefValue.briefHash) fail('Creator 初始 Build/Brief/Production 身份不闭合')
  const production = productionValue as ProductProductionRecordV1 & { id: number }
  const briefRow = briefValue as ProductProductionBriefRecordV1 & { id: number }
  // Keep the Creator-start parser behind the read boundary. Static loading here
  // would close a production-contract -> artifact-store -> derived-authority ->
  // production-contract cycle before the source limits are initialized.
  const { readTextOpenWorldCreatorExecutionBriefV1 } = await import('./creator-production-start')
  const contracts = await readTextOpenWorldCreatorExecutionBriefV1({ briefRow, planJson: build.planJson })
  const productionPlan = parseProductProductionPlanV3(build.planJson, undefined, build.briefHash)
  if (canonicalProductProductionJsonV2(productionPlan) !== build.planJson
    || await hashProductProductionValueV2(productionPlan) !== build.planHash) {
    fail('Creator 初始 Build Plan Hash 不闭合')
  }
  return {
    origin: 'creator-start-v1',
    production,
    build,
    briefRow,
    contracts,
    productionPlan,
    authorizationHash: contracts.start.startHash,
    commandChain: [],
    repair: null,
    media: null,
  }
}
