import type { ProductProductionBriefV3, ProductProductionBudgetV3 } from '../types'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { buildAvgVisualPlanningPlanV4 } from './visual-planning-plan'
import { AVG_VISUAL_TEXT_CAPABILITY_V4 } from './visual-planning-roles'
import { avgVisualPlanningTargetKeysV4 } from './visual-planning-reuse-contract'

const budgetBuildNumber=(v:NonNullable<ProductProductionBriefV3['avgVisualPlanning']>)=>1+Math.max(0,...(v.proposalReuse??[]).map(r=>r.buildNumber))

export const AVG_VISUAL_PLANNING_TEXT_DATA_CLASS_V4 = 'avg-visual-planning-text'
type Input = Pick<ProductProductionBriefV3, 'avgVisualPlanning' | 'avgAssembly' | 'avgRevision' | 'qualityProfile'
  | 'capabilityRequirements' | 'productionBudget' | 'consultationBudget' | 'externalDataPolicy' | 'fallbackPolicy' | 'completionContract' | 'media'>
  & { intent: Pick<ProductProductionBriefV3['intent'], 'productType'> }

/** All reservations come from the same frozen topology. Human decisions own
 * no calls; received proposals retain known usage independently of adoption. */
export function avgVisualPlanningBudgetV4(input: Pick<Input, 'avgVisualPlanning' | 'capabilityRequirements'>): ProductProductionBudgetV3 {
  if (!input.avgVisualPlanning) throw new Error('[avg-visual-plan] 缺少专业视觉合同')
  const plan = buildAvgVisualPlanningPlanV4({ brief: { ...input, avgVisualPlanning: input.avgVisualPlanning }, briefHash: '0'.repeat(64), buildNumber: budgetBuildNumber(input.avgVisualPlanning), controlEpoch: 0 })
  const sum = (key: keyof Omit<ProductProductionBudgetV3, 'maximumCostUsd'>, field: keyof typeof plan.tasks[number]['budgetReservation']) =>
    [key, plan.tasks.reduce((total, task) => total + Number(task.budgetReservation[field]), 0)] as const
  const values = Object.fromEntries([sum('maximumModelCalls', 'modelCalls'), sum('maximumMediaCalls', 'mediaCalls'),
    sum('maximumInputTokens', 'inputTokens'), sum('maximumOutputTokens', 'outputTokens'),
    sum('maximumDurationMs', 'durationMs'), sum('maximumStorageBytes', 'storageBytes')])
  const costs = plan.tasks.map(t => t.budgetReservation.maximumCostUsd)
  return { ...values, maximumCostUsd: costs.some(c => c === null) ? null : costs.reduce<number>((n, c) => n + c!, 0) } as ProductProductionBudgetV3
}

export function avgVisualPlanningGateIdsV4(input: Pick<Input, 'avgVisualPlanning' | 'capabilityRequirements'>): string[] {
  if (!input.avgVisualPlanning) throw new Error('[avg-visual-plan] 缺少专业视觉合同')
  const plan = buildAvgVisualPlanningPlanV4({ brief: { ...input, avgVisualPlanning: input.avgVisualPlanning }, briefHash: '0'.repeat(64), buildNumber: budgetBuildNumber(input.avgVisualPlanning), controlEpoch: 0 })
  return [...new Set([...plan.tasks.find(t => t.taskKey === plan.terminalTaskKey)!.acceptanceGateIds,
    'avg.visual.requirements.compiled', ...plan.tasks.filter(t => ['avg-author-visual-bible', 'avg-author-media-brief'].includes(t.kind)).flatMap(t => t.acceptanceGateIds)])]
}

export function assertAvgVisualPlanningPolicyV4(brief: Input): void {
  const v = brief.avgVisualPlanning
  if (!v || brief.intent.productType !== 'avg' || brief.avgAssembly || brief.avgRevision || brief.qualityProfile === 'commercial-candidate') {
    throw new Error('[avg-visual-plan] 专业视觉合同只属于独立 AVG prototype/internal 路径，不能借用旧组装或其他产品')
  }
  const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
  const image = brief.capabilityRequirements.find(c => c.requirementKey === 'avg.media.image')
  const text = brief.capabilityRequirements.find(c => c.requirementKey === AVG_VISUAL_TEXT_CAPABILITY_V4)
  const dataClasses = [...new Set(['image-prompt', ...v.scope.referenceCatalog.map(r => r.reference.dataClass)])].sort()
  if (!image || !text || brief.capabilityRequirements.length !== 2 || image.mediaClass !== 'image' || text.mediaClass !== 'text'
    || !image.required || text.required!==(avgVisualPlanningTargetKeysV4(v.scope).length>(v.proposalReuse?.length??0)) || image.operation !== 'generate' || text.operation !== 'generate'
    || image.adapterFamily !== 'agnes' || image.minimumCapabilityVersion !== '1'
    || !same([...image.allowedDataClasses].sort(), dataClasses)
    || !same(text.allowedDataClasses, [AVG_VISUAL_PLANNING_TEXT_DATA_CLASS_V4])) throw new Error('[avg-visual-plan] 专业文本与图片能力/外发数据类别不闭合')
  const budget = avgVisualPlanningBudgetV4(brief)
  if (brief.media.imageCount !== v.scope.templates.length || brief.media.audioLevel !== 'none'
    || brief.media.voiceLineCount !== 0 || brief.media.musicTrackCount !== 0 || brief.media.sfxCount !== 0) throw new Error('[avg-visual-plan] 本合同只生产准确视觉批次，声音须独立能力合同')
  if (!same(brief.productionBudget, budget) || !same(brief.consultationBudget, { maximumModelCalls: 0, maximumInputTokens: 0, maximumOutputTokens: 0, maximumCostUsd: 0 })
    || [image, text].some(c => c.maximumTotalCost !== budget.maximumCostUsd)) throw new Error('[avg-visual-plan] 预算与有限岗位/图片拓扑不一致')
  const allowed = [...dataClasses, AVG_VISUAL_PLANNING_TEXT_DATA_CLASS_V4], external = brief.externalDataPolicy
  if (allowed.some(c => !external.allowedDataClasses.includes(c) || external.forbiddenDataClasses.includes(c))
    || v.scope.referenceCatalog.length > 0 && !external.allowReferenceImages || external.allowVoiceScripts) throw new Error('[avg-visual-plan] 缺少本路径明确外发范围')
  if (brief.fallbackPolicy.allowTextOnly || brief.fallbackPolicy.allowProceduralAudio || !brief.fallbackPolicy.allowExistingProjectMedia
    || brief.fallbackPolicy.onRequiredCapabilityMissing !== 'pause' || !brief.completionContract.requiresPlayablePreview
    || brief.completionContract.minimumMediaCoverage !== 1 || brief.completionContract.allowSoftWaivers
    || !same([...brief.completionContract.requiredGateIds].sort(), avgVisualPlanningGateIdsV4(brief).sort())) throw new Error('[avg-visual-plan] 采用/图像/可播放终态门和停止策略不一致')
}
