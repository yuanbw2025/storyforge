import type { ProductProductionBriefV3, ProductProductionBudgetV3 } from '../types'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { avgMediaAssemblyGateIdsV2 } from './assembly-contract'
import { AVG_IMAGE_CAPABILITY_REQUIREMENT_KEY_V1 } from './assembly-plan'
import { assertAvgVisualProductionPolicyV2, avgVisualProductionBudgetV2, avgVisualProductionDataClassesV2,
  type AvgVisualProductionPolicyInputV2 } from './media-production-policy'
import { AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1, assertAvgVoiceCapabilityDeclarationV1,
  avgVoiceAssemblyGateIdsV3, parseAvgAssemblyBriefV3, type AvgAssemblyBriefV3 } from './voice-assembly-contract'
import { AVG_VOICE_TASK_TIMEOUT_MS_V1 } from './voice-request-contract'
import type { AvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import { avgAudioProcessingForVoiceV3, addAvgAudioProcessingBudgetV1, avgAudioProcessingGateIdsV1 } from './audio-production-brief'
import type { AvgAudioProductionProcessingPlanV1 } from './audio-production-contract'

export type AvgVoiceProductionBriefV3 = Omit<ProductProductionBriefV3, 'avgAssembly'> & { avgAssembly: AvgStoredAssemblyBriefV3 }
export type AvgVoiceProductionPolicyInputV3 = Omit<AvgVisualProductionPolicyInputV2, 'avgAssembly'> & {
  avgAssembly: AvgAssemblyBriefV3
  media: ProductProductionBriefV3['media']
  avgAudioProcessing?: AvgAudioProductionProcessingPlanV1
}
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

/** Finite resources per batch even when the author has no total cash ceiling.
 * Image retention/processing keeps the established V2 resource accounting. */
export function avgVoiceProductionBudgetV3(value: AvgAssemblyBriefV3, maximumCostUsd: number | null = null,
  processing?: AvgAudioProductionProcessingPlanV1): ProductProductionBudgetV3 {
  const base = avgVoiceProductionBaseBudgetV3(value, maximumCostUsd)
  return processing ? addAvgAudioProcessingBudgetV1(base, avgAudioProcessingForVoiceV3(processing, value), 'voice') : base
}
function avgVoiceProductionBaseBudgetV3(value: AvgAssemblyBriefV3, maximumCostUsd: number | null = null): ProductProductionBudgetV3 {
  const a = parseAvgAssemblyBriefV3(value), count = a.voice.batch.requirements.length
  if (maximumCostUsd !== null && (!Number.isFinite(maximumCostUsd) || maximumCostUsd < 0 || maximumCostUsd > Number.MAX_SAFE_INTEGER)) {
    throw new Error('[avg-voice] 配音费用边界无效')
  }
  const base = a.image ? avgVisualProductionBudgetV2(a.image.mediaBatch.requirements.length, maximumCostUsd,
    a.image.imageRecovery?.retained.length ?? 0, a.image.imageProcessing?.entries.length ?? 0)
    : { maximumModelCalls: 0, maximumInputTokens: 100_000, maximumOutputTokens: 0, maximumCostUsd,
      maximumMediaCalls: 0, maximumDurationMs: 120_000, maximumStorageBytes: 64 * 1024 * 1024 }
  const retained = a.voice.recovery?.retained.length ?? 0
  return { ...base, maximumInputTokens: base.maximumInputTokens + 20_000 * (count + (a.image?.imageProcessing?.entries.length ?? 0)),
    maximumMediaCalls: base.maximumMediaCalls + count - retained,
    maximumDurationMs: base.maximumDurationMs + AVG_VOICE_TASK_TIMEOUT_MS_V1 * (count - retained) + 60_000 * retained,
    maximumStorageBytes: base.maximumStorageBytes + (96 * (count - retained) + 4 * retained) * 1024 * 1024 }
}

export function avgVoiceProductionDataClassesV3(a: AvgAssemblyBriefV3): string[] {
  return [...new Set(['voice-script', ...(a.image ? avgVisualProductionDataClassesV2(a.image) : [])])].sort()
}

/** Structural policy only. Current Work/start/SourcePlan/source proof, actual
 * stored-voice hashes, account capability and quote checks remain mandatory.
 * The image projection below is never an execution/producer authority Brief.
 */
export function assertAvgVoiceProductionPolicyV3(brief: AvgVoiceProductionPolicyInputV3): void {
  const a = parseAvgAssemblyBriefV3(brief.avgAssembly)
  if (brief.intent.productType !== 'avg' || brief.avgRevision || brief.qualityProfile === 'commercial-candidate') {
    throw new Error('[avg-voice] 配音生产只接受独立 AVG prototype/internal 组装合同')
  }
  if (brief.media.audioLevel !== 'full' || brief.media.voiceLineCount < a.voice.batch.requirements.length
    || !brief.media.requiredMediaKinds.includes('voice')) throw new Error('[avg-voice] 产品媒资目录须明确包含本批逐句配音')
  const budget = avgVoiceProductionBudgetV3(a, brief.productionBudget.maximumCostUsd, brief.avgAudioProcessing)
  if (a.voice.recovery) {
    const recovery = a.voice.recovery, base = brief.evolution?.base
    if (base?.kind !== 'recovery-build' || base.buildNumber !== recovery.sourceBuildNumber
      || base.briefHash !== recovery.sourceBriefHash || base.planHash !== recovery.sourcePlanHash
      || base.controlEpoch !== recovery.sourceControlEpoch) throw new Error('[avg-voice] 配音恢复必须绑定准确的作者版本谱系')
  }
  if (!same(budget, brief.productionBudget) || !same(brief.consultationBudget,
    { maximumModelCalls: 0, maximumInputTokens: 0, maximumOutputTokens: 0, maximumCostUsd: 0 })) throw new Error('[avg-voice] 配音预算必须与有限批次闭合，不能夹带文本调用')
  const voices = brief.capabilityRequirements.filter(c => c.requirementKey === AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1)
  const images = brief.capabilityRequirements.filter(c => c.requirementKey === AVG_IMAGE_CAPABILITY_REQUIREMENT_KEY_V1)
  if (voices.length !== 1 || images.length !== (a.image ? 1 : 0) || brief.capabilityRequirements.length !== voices.length + images.length) {
    throw new Error('[avg-voice] 配音组装只能包含准确的图片/语音能力')
  }
  const capability = voices[0]!
  assertAvgVoiceCapabilityDeclarationV1(a, capability)
  if (capability.maximumTotalCost !== budget.maximumCostUsd || budget.maximumCostUsd === null && capability.maximumRequestCost !== null
    || budget.maximumCostUsd !== null && (capability.maximumRequestCost === null || capability.maximumRequestCost > budget.maximumCostUsd)) {
    throw new Error('[avg-voice] 配音能力与整体费用边界不一致')
  }
  const allowed = avgVoiceProductionDataClassesV3(a), external = brief.externalDataPolicy
  if (!same([...external.allowedDataClasses].sort(), allowed) || !external.allowVoiceScripts
    || allowed.some(c => external.forbiddenDataClasses.includes(c))
    || external.allowReferenceImages !== !!a.image?.mediaBatch.requirements.some(r => r.references.length > 0)) {
    throw new Error('[avg-voice] 准确台词或图片参考缺少对应外发授权，不能借用其他产品的类别')
  }
  if (brief.fallbackPolicy.allowTextOnly || brief.fallbackPolicy.allowProceduralAudio || !brief.fallbackPolicy.allowExistingProjectMedia
    || brief.fallbackPolicy.onRequiredCapabilityMissing !== 'pause') throw new Error('[avg-voice] 缺少配音能力必须暂停，不能静默换模型、程序音或无声完成')
  const processingGates = brief.avgAudioProcessing ? avgAudioProcessingGateIdsV1(avgAudioProcessingForVoiceV3(brief.avgAudioProcessing, a)) : []
  if (!same([...brief.completionContract.requiredGateIds].sort(), [...avgVoiceAssemblyGateIdsV3(a), ...processingGates].sort())
    || !brief.completionContract.requiresPlayablePreview || brief.completionContract.minimumMediaCoverage !== 1
    || brief.completionContract.allowSoftWaivers) throw new Error('[avg-voice] 配音完成须包含逐句原始音频、审听、作者选择和可玩技术门')
  if (a.image) {
    const image = { schema: a.schema, version: 2 as const, title: a.title, sceneKeys: a.sceneKeys,
      mediaAssetKeys: a.mediaAssetKeys, basePackageHash: a.basePackageHash, ...a.image }
    assertAvgVisualProductionPolicyV2({ ...brief, avgAssembly: image, capabilityRequirements: images,
      productionBudget: avgVisualProductionBudgetV2(image.mediaBatch.requirements.length, budget.maximumCostUsd,
        image.imageRecovery?.retained.length ?? 0, image.imageProcessing?.entries.length ?? 0),
      externalDataPolicy: { ...external, allowedDataClasses: avgVisualProductionDataClassesV2(image), allowVoiceScripts: false },
      completionContract: { ...brief.completionContract, requiredGateIds: avgMediaAssemblyGateIdsV2(image.mediaBatch, image.imageProcessing) } })
  }
}
