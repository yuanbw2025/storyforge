import { db } from '../db/schema'
import type { ProductProductionBriefV3 } from '../types'
import type { ProductProductionTaskExecutionInputV1 } from '../product-production/scheduler'
import { assembleContext } from '../registry/assemble-context'
import { preserveProductProductionContextV1 } from '../product-production/context'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assertRecordInScope } from '../workspace/scope'
import { assertAvgTaskHarnessClaimV1, hashAvgTaskRuntimeBindingV1 } from './task-claim'
import { AVG_VISUAL_PLANNING_CONTEXT_V5 } from './visual-planning-roles-v5'
import { parseAvgSystemPlan } from './system-contract'
import { parseAvgProfessionalArtifactV1 } from './artifact-contract'
import { assertAvgVisualPlanningOtherRequestsKnownV4 } from './visual-planning-restart'
import { avgImageReferenceCapabilityV2 } from './media-reference-contract'

/** Reassemble through the registered gateway before dispatch, then require the
 * exact delivered text and exact adopted payload witnesses. No caller-supplied
 * context or Run id can substitute for the actual durable claim. */
export async function readAvgVisualPlanningExecutionSourcesV5(input: ProductProductionTaskExecutionInputV1, brief: ProductProductionBriefV3) {
  const planning = brief.avgVisualPlanning, build = await db.productBuilds.get(input.buildId)
  if (planning?.version!==5 || !build || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })
    || build.productionId !== input.productionId || build.buildNumber !== input.buildNumber || build.status !== 'building'
    || build.controlEpoch !== input.controlEpoch || build.planHash !== input.planHash || build.briefHash !== await hashProductProductionValueV2(brief)) throw new Error('[avg-visual-plan] 执行来源或完整 Brief 已 stale')
  const image=brief.capabilityRequirements.find(c=>c.requirementKey==='avg.media.image')
  if(image?.capabilityHash!==await hashProductProductionValueV2(avgImageReferenceCapabilityV2(planning.imageBinding.adapterId)))throw new Error('[avg-visual-image] 冻结图片模型与能力不一致，未发送任何岗位请求')
  const claim = await assertAvgTaskHarnessClaimV1(input, build.budgetLedgerJson)
  if (claim.child.contract.runtimeBindingHash !== await hashAvgTaskRuntimeBindingV1(input)) throw new Error('[avg-visual-plan] 请求路由不属于当前实际 Harness claim')
  await assertAvgVisualPlanningOtherRequestsKnownV4(input.scope,build)
  const assembled = await assembleContext({ projectId: input.scope.projectId, scope: input.scope,
    productProductionId: input.productionId, productBuildId: input.buildId, productProductionTaskKey: input.task.taskKey,
    productArtifactKeys: input.task.inputArtifactKeys, sourceKeys: [AVG_VISUAL_PLANNING_CONTEXT_V5],
    inputBudgetTokens: input.task.budgetReservation.inputTokens, sourceTransformer: preserveProductProductionContextV1 })
  if (assembled.text !== input.contextText || assembled.overBudgetAfterTrim || assembled.segments.length !== 1
    || canonicalProductProductionJsonV2(assembled.included) !== canonicalProductProductionJsonV2([AVG_VISUAL_PLANNING_CONTEXT_V5])
    || !assembled.sourceEvidence?.length || assembled.sourceEvidence.some(s => s.status !== 'included' || s.delivery !== 'full')) throw new Error('[avg-visual-plan] 实际上下文不是当前完整登记投影')
  const packet = JSON.parse(assembled.segments[0].content) as { schema?: string; version?: number; operation?:unknown; processing?:unknown; rawReuseSource?:unknown; artifacts?: Array<{ artifactKey: string; version: number; contentHash: string }> }
  const suppliedRefs = input.inputArtifacts.map(r => ({ artifactKey: r.artifactKey, version: r.version, contentHash: r.contentHash }))
  // Shared Harness delivers inputs sorted by key; the registered projection
  // preserves the frozen Plan order. Compare the exact set in that order.
  const refs = input.task.inputArtifactKeys.map(key => suppliedRefs.find(r => r.artifactKey === key))
  if (suppliedRefs.length !== refs.length || new Set(suppliedRefs.map(r => r.artifactKey)).size !== refs.length || refs.some(r => !r)
    || packet.schema !== 'storyforge.avg.visual-planning-inputs' || packet.version !== 5
    || canonicalProductProductionJsonV2(packet.artifacts) !== canonicalProductProductionJsonV2(refs)) throw new Error('[avg-visual-plan] Harness 输入与准确作者采用凭证不一致')
  for(const row of input.inputArtifacts){
    if(row.kind==='image'){
      if(input.task.kind!=='avg-media-image-process'||!row.artifactKey.startsWith('avg.media.raw.'))throw new Error('[avg-visual-plan] 只有本地加工可读取准确原图字节')
      // Physical producer/Blob is verified by the registered reader and exact
      // task; this content hash identifies pixels, not raw metadata JSON.
    }else if(await hashProductProductionValueV2(JSON.parse(row.payloadJson))!==row.contentHash)throw new Error('[avg-visual-plan] 新岗位输入只能来自准确已采用的语义工件')
  }
  const rules = input.inputArtifacts.find(r => r.artifactKey === 'avg.system.plan')
  if (!rules) throw new Error('[avg-visual-plan] 缺少准确规则输入')
  const scripts = input.inputArtifacts.filter(r => r.artifactKey.startsWith('avg.content.scene-script.')).map(r => {
    const payload = parseAvgProfessionalArtifactV1(r.payloadJson)
    if (payload.schema !== 'storyforge.avg.scene-script') throw new Error('[avg-visual-plan] 脚本 schema 不一致')
    return payload
  })
  const visual = input.inputArtifacts.filter(r => r.artifactKey === 'avg.media.visual-bible' || /^avg\.media\.(character|environment|prop)-brief\./.test(r.artifactKey))
    .map(r => parseAvgProfessionalArtifactV1(r.payloadJson))
  return { ...claim, planning, build, refs, packet, source: { systemPlan: parseAvgSystemPlan(rules.payloadJson), scripts,
    presentation: { aspectRatio: planning.scope.aspectRatio } }, visual }
}
