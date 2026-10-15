import type { ProductBuildRecordV1, ProductProductionBriefV3, ProductEvolutionBaseV1 } from '../types'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'

/** A failed/stopped native assembly remains evidence. Recovery creates a child
 * Build with a fresh start/author confirmation, without rewriting that evidence. */
export async function deriveAvgAssemblyRecoveryBaseV1(build: ProductBuildRecordV1, value: ProductProductionBriefV3): Promise<ProductEvolutionBaseV1> {
  const brief=parseProductProductionBriefV3(value)
  if(!brief.avgAssembly||brief.intent.productType!=='avg'||!['cancelled','failed','recovery-required'].includes(build.status)
    ||build.previewHash||build.packageHash||build.manifestJson!=='{}'||build.manifestHash!==await hashProductProductionValueV2({})||build.releasedProductReleaseId!=null
    ||await hashProductProductionValueV2(brief)!==build.briefHash)throw new Error('[avg] 当前记录不能作为作者组装恢复基线')
  let controlEpoch=build.controlEpoch
  if(build.planRevision===0){
    if(build.planJson!=='{}'||build.planHash!==await hashProductProductionValueV2({}))throw new Error('[avg] 尚未执行的恢复基线 Plan 不一致')
  }else{
    const plan=parseProductProductionPlanV3(build.planJson,brief,build.briefHash)
    if(await hashProductProductionValueV2(plan)!==build.planHash||plan.controlEpoch>build.controlEpoch)throw new Error('[avg] 恢复基线的冻结 Plan/hash 不一致')
    controlEpoch=plan.controlEpoch
  }
  return {kind:'recovery-build',buildNumber:build.buildNumber,briefHash:build.briefHash,planHash:build.planHash,controlEpoch}
}
