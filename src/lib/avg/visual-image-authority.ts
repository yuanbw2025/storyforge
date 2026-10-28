import { db } from '../db/schema'
import type { ProductProductionBriefV3, WorkspaceScope } from '../types'
import { resolveScope, assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { avgImageReferenceCapabilityV2 } from './media-reference-contract'

export interface AvgCompiledImageReadInput {
  scope:WorkspaceScope; buildId:number; expectedBuildRevision:number; controlEpoch:number
  expectedBrief?:ProductProductionBriefV3; purpose?:'assembly'|'frozen-verification'
}
/** Shared current/frozen authority checks. The explicit original version is
 * checked before narrowing; no synthesized legacy Brief or permission cache. */
export async function readAvgCompiledImageAuthority<V extends 4|5>(input:AvgCompiledImageReadInput,version:V){
  const scope = await resolveScope({ scope: input.scope }), build = await db.productBuilds.get(input.buildId)
  const frozen=input.purpose==='frozen-verification'
  if (!build?.id || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || !(frozen?['building','validating','preview-ready','release-ready','released']:input.purpose==='assembly'?['building','integrating']:['building']).includes(build.status)
    || (frozen? !build.packageHash||!build.previewHash||!build.rootTerminalReceiptHash:!!build.packageHash||!!build.previewHash||build.releasedProductReleaseId!=null)
    || build.stateRevision !== input.expectedBuildRevision || build.controlEpoch !== input.controlEpoch) throw new Error('[avg-visual-image] 准确当前 Build 已 stale 或跨 Work')
  const production = await db.productProductions.get(build.productionId)
  const briefRow = await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
  if (!production || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || production.productType !== 'avg' || !frozen&&(production.status !== 'producing' || production.currentBuildNumber !== build.buildNumber
    || production.controlEpoch !== build.controlEpoch || production.currentBriefRevision !== build.briefRevision)
    || !briefRow || !await assertRecordInScope(scope, 'productProductionBriefs', briefRow, { owner: 'work' })
    || briefRow.status !== 'authorized' || briefRow.briefHash !== build.briefHash || briefRow.authorizedAt !== build.authorizedAt) throw new Error('[avg-visual-image] 缺少准确当前授权来源')
  const brief = parseProductProductionBriefV3(briefRow.briefJson), planning = brief.avgVisualPlanning
  const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
  if (planning?.version!==version || await hashProductProductionValueV2(brief) !== build.briefHash
    || input.expectedBrief && !same(input.expectedBrief, brief)) throw new Error('[avg-visual-image] 实际完整 Brief 或版本不一致')
  const capability = brief.capabilityRequirements.find(c => c.requirementKey === 'avg.media.image')!
  if (capability.capabilityHash !== await hashProductProductionValueV2(avgImageReferenceCapabilityV2(planning.imageBinding.adapterId))) throw new Error('[avg-visual-image] 图片能力不是准确冻结模型的参考输入协议')
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  const compiler = plan.tasks.find(t => t.kind === `avg-v${version}-visual-requirements-compile`)
  if (!compiler || plan.controlEpoch !== build.controlEpoch || plan.buildNumber !== build.buildNumber
    || await hashProductProductionValueV2(plan) !== build.planHash || !same(plan, JSON.parse(build.planJson))) throw new Error('[avg-visual-image] 编译任务不属于当前准确固定 Plan')
  return {scope,build:{...build,id:build.id},production,briefRow,brief,
    planning:planning as Extract<NonNullable<ProductProductionBriefV3['avgVisualPlanning']>,{version:V}>,
    capability,plan,compiler,frozen,same}
}
