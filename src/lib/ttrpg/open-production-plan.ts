/** Open authoring tasks live in the existing production scheduler, with an explicit shared production budget. */
import type { ProductProductionBriefV3, ProductProductionPlanV3, ProductProductionPlanTaskV3 } from '../types'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { createCommonProductMediaBundleTasksV3 } from '../product-production/media-plan-tasks'

export const TTRPG_OPEN_PRODUCTION_TASK_KEYS_V1 = [
  'ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer',
  'ttrpg.open.media-plan', 'ttrpg.open.integration', 'ttrpg.open.quality',
] as const

/** Local source record IDs are locators; the frozen UID/hash and all author
 * inputs must remain identical before any open task can cross Builds. */
export function ttrpgOpenEvolutionReuseEnvelopeV1(brief: ProductProductionBriefV3) {
  if (!brief.ttrpgOpen) throw new Error('[ttrpg-open-plan] reuse 需要 open Brief')
  return {
    sourceWorldContentHash: brief.source.worldContentHash, productType: brief.intent.productType,
    scale: brief.scale, media: brief.media, qualityProfile: brief.qualityProfile,
    capabilityRequirements: brief.capabilityRequirements, externalDataPolicy: brief.externalDataPolicy,
    fallbackPolicy: brief.fallbackPolicy, completionContract: brief.completionContract,
    openInput: {
      ...brief.ttrpgOpen,
      worldReference: { ...brief.ttrpgOpen.worldReference, localReleaseRecordId: 0 },
      sourcePlan: { ...brief.ttrpgOpen.sourcePlan, worldReference: { ...brief.ttrpgOpen.sourcePlan.worldReference, localReleaseRecordId: 0 } },
      sourceSelection: brief.source.selection, intent: brief.intent, startingPoint: brief.source.startingPoint,
    },
  }
}

export function ttrpgOpenEvolutionTaskLaneV1(taskKey: string): 'content' | 'visual' | 'audio' | null {
  if (['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer'].includes(taskKey)) return 'content'
  if (taskKey === 'ttrpg.open.media-plan' || taskKey === 'media.visual' || taskKey.startsWith('media.visual.')) return 'visual'
  if (taskKey === 'media.audio' || taskKey.startsWith('media.audio.')) return 'audio'
  return null
}

export function buildTtrpgOpenProductionPlanV3(input: {
  brief: ProductProductionBriefV3; briefHash: string; buildNumber: number; controlEpoch: number
}): ProductProductionPlanV3 {
  const { brief } = input, budget = brief.productionBudget
  if (!brief.ttrpgOpen || brief.ttrpg || brief.intent.productType !== 'ttrpg') throw new Error('[ttrpg-open-plan] 需要独立 open 制作契约')
  const attempts = Math.min(2, Math.floor(budget.maximumModelCalls / 4))
  const audioCalls = brief.media.musicTrackCount + brief.media.sfxCount + brief.media.voiceLineCount
  const mediaLaneCount = Number(brief.media.imageCount > 0) + Number(audioCalls > 0)
  const inputTokens = Math.floor(budget.maximumInputTokens / (4 + mediaLaneCount))
  const outputTokens = Math.floor(budget.maximumOutputTokens / 4)
  const durationMs = Math.floor(budget.maximumDurationMs / (6 + mediaLaneCount))
  const storageBytes = Math.floor(budget.maximumStorageBytes / (6 + mediaLaneCount))
  const maximumCostUsd = budget.maximumCostUsd === null ? null : budget.maximumCostUsd / (4 + mediaLaneCount)
  if (attempts < 1 || inputTokens < 1 || outputTokens < 1 || durationMs < 1 || storageBytes < 1) {
    throw new Error('[ttrpg-open-plan] 六项制作任务缺少明确授权的模型/token/时长/存储预算')
  }
  const definitions = [
    { taskKey: 'ttrpg.open.source-facts', skillId: 'product-production.ttrpg-open-source-facts.v1', lane: 'content', dependsOn: [],
      inputArtifactKeys: [], outputArtifactKeys: ['ttrpg.open.source-facts'] },
    { taskKey: 'ttrpg.open.rule-system', skillId: 'product-production.ttrpg-open-rule-system.v1', lane: 'content', dependsOn: ['ttrpg.open.source-facts'],
      inputArtifactKeys: ['ttrpg.open.source-facts'], outputArtifactKeys: ['ttrpg.open.rule-system'] },
    { taskKey: 'ttrpg.open.situation-layer', skillId: 'product-production.ttrpg-open-situation-layer.v1', lane: 'content',
      dependsOn: ['ttrpg.open.source-facts', 'ttrpg.open.rule-system'], inputArtifactKeys: ['ttrpg.open.source-facts', 'ttrpg.open.rule-system'],
      outputArtifactKeys: ['ttrpg.open.situation-layer'] },
    { taskKey: 'ttrpg.open.media-plan', skillId: 'product-production.media-requirements.v1', lane: 'planning',
      dependsOn: ['ttrpg.open.rule-system', 'ttrpg.open.situation-layer'], inputArtifactKeys: ['ttrpg.open.rule-system', 'ttrpg.open.situation-layer'],
      outputArtifactKeys: ['media.requirements'] },
    { taskKey: 'ttrpg.open.integration', skillId: null, lane: 'integration', dependsOn: ['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer', 'ttrpg.open.media-plan'],
      inputArtifactKeys: ['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer', 'media.requirements'],
      outputArtifactKeys: ['ttrpg.rule-pack', 'ttrpg.campaign-pack', 'runtime.package'] },
    { taskKey: 'ttrpg.open.quality', skillId: null, lane: 'qa', dependsOn: ['ttrpg.open.integration'],
      inputArtifactKeys: ['ttrpg.rule-pack', 'ttrpg.campaign-pack', 'runtime.package'], outputArtifactKeys: ['quality.report'] },
  ] as const
  const tasks: ProductProductionPlanTaskV3[] = definitions.map((definition, index) => {
    const model = definition.skillId !== null
    const maximumOutput = model ? Math.min(outputTokens, getAgentSkillV1(definition.skillId!).maxOutputTokens) : 0
    const timeoutMs = Math.min(durationMs, 180_000)
    return { taskKey: definition.taskKey, lane: definition.lane, kind: definition.taskKey,
      skillId: definition.skillId, executionMode: model ? 'model' : 'deterministic', dependsOn: [...definition.dependsOn],
      requiredReceipts: definition.dependsOn.map(taskKey => ({ taskKey, receiptHash: null })),
      inputArtifactKeys: [...definition.inputArtifactKeys], outputArtifactKeys: [...definition.outputArtifactKeys],
      requirementKeys: [], capabilityRequirementKeys: model ? brief.capabilityRequirements
        .filter(requirement => requirement.mediaClass === 'text').map(requirement => requirement.requirementKey) : [],
      concurrencyGroup: model ? 'text-provider' : 'cpu', subjectLockKeys: [`ttrpg.open:${definition.taskKey}`], priority: 100 - index,
      budgetReservation: { modelCalls: model ? attempts : 0, inputTokens: model ? inputTokens : 0,
        outputTokens: maximumOutput, mediaCalls: 0, maximumCostUsd: model ? maximumCostUsd : 0,
        durationMs, storageBytes }, maxAttempts: model ? attempts : 1, timeoutMs, failurePolicy: 'pause', fallbackTaskKey: null,
      acceptanceGateIds: index === 5 ? [...brief.completionContract.requiredGateIds] : [], reuse: null }
  })
  const mediaTasks = createCommonProductMediaBundleTasksV3({ brief, dependsOn: ['ttrpg.open.media-plan'],
    inputArtifactKeys: ['media.requirements', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer'],
    visualArtifactKeys: Array.from({ length: brief.media.imageCount }, (_, index) => `media.visual.${String(index + 1).padStart(3, '0')}`),
    audioArtifactKeys: Array.from({ length: audioCalls }, (_, index) => `media.audio.${String(index + 1).padStart(3, '0')}`),
    durationMs, storageBytes, maximumCostUsd, failurePolicy: 'pause' })
  const integration = tasks.find(task => task.taskKey === 'ttrpg.open.integration')!
  for (const task of mediaTasks) task.budgetReservation.inputTokens = inputTokens
  integration.dependsOn.push(...mediaTasks.map(task => task.taskKey))
  integration.requiredReceipts.push(...mediaTasks.map(task => ({ taskKey: task.taskKey, receiptHash: null })))
  integration.inputArtifactKeys.push(...mediaTasks.flatMap(task => task.outputArtifactKeys))
  tasks.splice(4, 0, ...mediaTasks)
  return { schema: 'storyforge.product-production-plan', version: 3, buildNumber: input.buildNumber, productType: 'ttrpg',
    briefHash: input.briefHash, controlEpoch: input.controlEpoch, concurrency: { maximumCostBearingTasks: 2,
      maximumTextProviderTasks: 2, maximumMediaProviderTasks: 1 }, tasks, terminalTaskKey: 'ttrpg.open.quality' }
}
