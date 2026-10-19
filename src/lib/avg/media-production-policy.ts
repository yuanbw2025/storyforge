import type { ProductProductionBriefV3, ProductProductionBudgetV3 } from '../types'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { avgMediaAssemblyGateIdsV2, type AvgAssemblyBriefV2 } from './assembly-contract'
import { AVG_IMAGE_CAPABILITY_REQUIREMENT_KEY_V1 } from './assembly-plan'
import { AVG_VISUAL_BATCH_LIMIT_V1 } from './media-production-contract'

export const AVG_IMAGE_PROMPT_DATA_CLASS_V1 = 'image-prompt'

/** The pure policy reads these fields only. No fabricated World/Work/source
 * object is needed to validate the image part of a later combined AVG Brief. */
export type AvgVisualProductionPolicyInputV2 = Pick<ProductProductionBriefV3,
  'avgAssembly' | 'avgRevision' | 'qualityProfile' | 'capabilityRequirements' | 'productionBudget'
  | 'consultationBudget' | 'externalDataPolicy' | 'fallbackPolicy' | 'completionContract' | 'evolution'> & {
    intent: Pick<ProductProductionBriefV3['intent'], 'productType'>
  }

/** A bounded image-only execution budget. No story/model generation is implied. */
export function avgVisualProductionBudgetV2(count: number, maximumCostUsd: number | null = null, retained = 0, processed = 0): ProductProductionBudgetV3 {
  if (!Number.isSafeInteger(count) || count < 1 || count > AVG_VISUAL_BATCH_LIMIT_V1) throw new Error('[avg-media] 图片批次数量无效')
  if (!Number.isSafeInteger(retained)||retained<0||retained>count) throw new Error('[avg-media] 保留原图数量无效')
  if (!Number.isSafeInteger(processed)||processed<0||processed>count) throw new Error('[avg-process] 加工数量无效')
  return { maximumModelCalls: 0, maximumInputTokens: 100_000 + 20_000 * count, maximumOutputTokens: 0,
    maximumMediaCalls: count-retained, maximumCostUsd, maximumDurationMs: 120_000 + 360_000 * (count-retained)+60_000*retained+60_000*processed,
    maximumStorageBytes: (64 + 96 * (count-retained)+4*retained+36*processed) * 1024 * 1024 }
}

export function avgVisualProductionDataClassesV2(assembly: Pick<AvgAssemblyBriefV2, 'mediaBatch'>): string[] {
  return [...new Set([AVG_IMAGE_PROMPT_DATA_CLASS_V1, ...assembly.mediaBatch.requirements.flatMap(r => r.references.map(ref => ref.dataClass))])].sort()
}

/** A parent's reuse authority cannot silently authorize its next child. A new
 * reviewable evolution draft starts without it; the AVG recovery service may
 * attach a freshly verified selection before any author start. */
export function resetAvgImageRecoveryForEvolutionV1(brief:ProductProductionBriefV3){
  if(brief.avgAssembly?.version!==2||!brief.avgAssembly.imageRecovery)return {}
  const avgAssembly={...brief.avgAssembly};delete avgAssembly.imageRecovery
  return {avgAssembly,productionBudget:avgVisualProductionBudgetV2(avgAssembly.mediaBatch.requirements.length,brief.productionBudget.maximumCostUsd,0,avgAssembly.imageProcessing?.entries.length??0)}
}

/** Pure policy validation also reads frozen/portable V2 records when dispatch
 * is disabled. Commands and the scheduler separately fence new paid starts. */
export function assertAvgVisualProductionPolicyV2<T extends AvgVisualProductionPolicyInputV2>(brief: T): asserts brief is T & { avgAssembly: AvgAssemblyBriefV2 } {
  const a = brief.avgAssembly
  if (!a || a.version !== 2 || brief.intent.productType !== 'avg' || brief.avgRevision || brief.qualityProfile === 'commercial-candidate') {
    throw new Error('[avg-media] 图片生产只接受独立 AVG prototype/internal 组装合同')
  }
  const same = (left: unknown, right: unknown) => canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
  const budget = avgVisualProductionBudgetV2(a.mediaBatch.requirements.length, brief.productionBudget.maximumCostUsd, a.imageRecovery?.retained.length??0,a.imageProcessing?.entries.length??0)
  if (a.imageRecovery) {
    const base=brief.evolution?.base
    if (base?.kind!=='recovery-build'||base.buildNumber!==a.imageRecovery.sourceBuildNumber||base.briefHash!==a.imageRecovery.sourceBriefHash
      ||base.planHash!==a.imageRecovery.sourcePlanHash||base.controlEpoch!==a.imageRecovery.sourceControlEpoch) throw new Error('[avg-media] 图片恢复必须绑定准确的新 Build 谱系')
  }
  const c = brief.capabilityRequirements[0], allowed = avgVisualProductionDataClassesV2(a)
  if (brief.capabilityRequirements.length !== 1 || !c || c.requirementKey !== AVG_IMAGE_CAPABILITY_REQUIREMENT_KEY_V1
    || c.mediaClass !== 'image' || c.operation !== 'generate' || c.adapterFamily !== 'agnes' || c.minimumCapabilityVersion !== '1' || !c.required
    || !same([...c.allowedDataClasses].sort(), allowed) || c.maximumTotalCost !== budget.maximumCostUsd
    || budget.maximumCostUsd === null && c.maximumRequestCost !== null
    || budget.maximumCostUsd !== null && (c.maximumRequestCost === null || c.maximumRequestCost > budget.maximumCostUsd)) {
    throw new Error('[avg-media] 图片生产必须绑定准确的唯一 Agnes 能力、数据类别和费用边界')
  }
  if (a.imageBinding.requirementKey !== c.requirementKey || a.imageBinding.adapterId !== 'agnes.image-2.1-flash.v1') throw new Error('[avg-media] 图片能力与已确认路由不一致')
  if (!same(brief.productionBudget, budget)
    || !same(brief.consultationBudget, { maximumModelCalls: 0, maximumInputTokens: 0, maximumOutputTokens: 0, maximumCostUsd: 0 })) {
    throw new Error('[avg-media] 图片生产预算必须与有限批次闭合，不能夹带文本调用')
  }
  const external = brief.externalDataPolicy
  if (allowed.some(dataClass => !external.allowedDataClasses.includes(dataClass) || external.forbiddenDataClasses.includes(dataClass))
    || a.mediaBatch.requirements.some(r => r.references.length > 0) && !external.allowReferenceImages || external.allowVoiceScripts) {
    throw new Error('[avg-media] 图片需求或参考没有准确的外发授权')
  }
  if (brief.fallbackPolicy.allowTextOnly || brief.fallbackPolicy.allowProceduralAudio || !brief.fallbackPolicy.allowExistingProjectMedia
    || brief.fallbackPolicy.onRequiredCapabilityMissing !== 'pause') throw new Error('[avg-media] 图片能力缺失必须暂停，不能静默替换成程序化结果')
  if (!same([...brief.completionContract.requiredGateIds].sort(), avgMediaAssemblyGateIdsV2(a.mediaBatch,a.imageProcessing).sort())
    || !brief.completionContract.requiresPlayablePreview || brief.completionContract.minimumMediaCoverage !== 1 || brief.completionContract.allowSoftWaivers) {
    throw new Error('[avg-media] 图片生产必须等待准确的原图、作者选择和运行技术门')
  }
}
