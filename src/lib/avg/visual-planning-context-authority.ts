import { db } from '../db/schema'
import type { AssembleContextInput } from '../registry/types'
import type { ProductProductionBriefV3 } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'

/** Shared exact Work/production/Brief/Plan authority. Version selection is a
 * runtime check; it never converts the stored contract or its reference proof. */
export async function readAvgVisualContextAuthority<V extends 4|5>(input:AssembleContextInput,expectedVersion:V){
  const { scope } = input
  if (!scope || input.projectId !== scope.projectId || !input.productBuildId || !input.productProductionId || !input.productProductionTaskKey) throw new Error('[avg-visual-plan] 缺少准确 Work/Build/任务')
  const build = await db.productBuilds.get(input.productBuildId), production = await db.productProductions.get(input.productProductionId)
  if (!build || !production || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' }) || build.productionId !== production.id
    || production.productType !== 'avg' || production.status !== 'producing' || production.currentBuildNumber !== build.buildNumber
    || production.controlEpoch !== build.controlEpoch || production.currentBriefRevision !== build.briefRevision || build.status !== 'building') throw new Error('[avg-visual-plan] 制作来源已 stale 或跨 Work')
  const row = await db.productProductionBriefs.where('[productionId+revision]').equals([production.id!, build.briefRevision]).first()
  if (!row || !await assertRecordInScope(scope, 'productProductionBriefs', row, { owner: 'work' }) || row.status !== 'authorized'
    || row.briefHash !== build.briefHash || row.authorizedAt !== build.authorizedAt) throw new Error('[avg-visual-plan] 缺少准确已授权 Brief')
  const brief = parseProductProductionBriefV3(row.briefJson)
  if (brief.avgVisualPlanning?.version!==expectedVersion || await hashProductProductionValueV2(brief) !== build.briefHash) throw new Error('[avg-visual-plan] 专业视觉 Brief 内容或版本不一致')
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash), task = plan.tasks.find(t => t.taskKey === input.productProductionTaskKey)
  if (!task || await hashProductProductionValueV2(plan) !== build.planHash || plan.buildNumber !== build.buildNumber || plan.controlEpoch !== build.controlEpoch
    || canonicalProductProductionJsonV2(input.productArtifactKeys ?? []) !== canonicalProductProductionJsonV2(task.inputArtifactKeys)) throw new Error('[avg-visual-plan] Plan 或准确依赖选择不一致')
  return {scope,build,production,row,brief,plan,task,planning:brief.avgVisualPlanning as Extract<NonNullable<ProductProductionBriefV3['avgVisualPlanning']>,{version:V}>}
}
export async function assertAvgVisualContextFresh(context:Pick<Awaited<ReturnType<typeof readAvgVisualContextAuthority>>,'build'|'production'>){
  const {build,production}=context
  const current = await db.productBuilds.get(build.id!), owner = await db.productProductions.get(production.id!)
  if (!current || !owner || current.stateRevision !== build.stateRevision || current.controlEpoch !== build.controlEpoch
    || current.briefHash !== build.briefHash || current.planHash !== build.planHash || current.status !== build.status
    || owner.status !== production.status || owner.controlEpoch !== production.controlEpoch || owner.currentBriefRevision !== production.currentBriefRevision
    || owner.currentBuildNumber !== production.currentBuildNumber) throw new Error('[avg-visual-plan] 读取期间制作状态已变化')
}
