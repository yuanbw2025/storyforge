import type { ProductProductionBriefV3, ProductProductionPlanTaskV3, ProductProductionPlanV3 } from '../types'
import { buildAvgAuthorAssemblyTopologyV1 } from './assembly-plan'
import { AVG_SOUND_MUSIC_CAPABILITY_V1, AVG_SOUND_TEXT_CAPABILITY_V1, parseAvgSoundPlanningBriefV1 } from './sound-production-brief'
import { avgKey } from './protocol-validation'
import { avgAudioProcessingForSoundV1, avgAudioProcessingSoundTargetsV1 } from './audio-production-brief'
import { buildAvgAudioProcessingTopologyV1 } from './audio-production-topology'

export { proposeAvgAudioProcessingTopologyV1 } from './audio-production-topology'

export const AVG_SOUND_PROPOSAL_KEY_V1 = 'avg.proposal.sound-plan'
export const AVG_SOUND_PLAN_KEY_V1 = 'avg.media.sound-plan'
export const AVG_SOUND_COMPILED_KEY_V1 = 'avg.media.compiled-sound-requirements'
export type AvgSoundTopologyInputV1 = Pick<ProductProductionBriefV3, 'avgSoundPlanning' | 'capabilityRequirements' | 'avgAudioProcessing'>

/** Fixed production graph. It declares every real cost and author boundary;
 * construction does not dispatch or manufacture producer/adoption evidence. */
export function buildAvgSoundProductionPlanV1(input: { brief: AvgSoundTopologyInputV1;
  briefHash: string; buildNumber: number; controlEpoch: number }): ProductProductionPlanV3 {
  const sourcePlan = buildAvgSoundProductionBasePlanV1(input)
  if (!input.brief.avgAudioProcessing) return sourcePlan
  const sound = parseAvgSoundPlanningBriefV1(input.brief.avgSoundPlanning)
  const processing = avgAudioProcessingForSoundV1(input.brief.avgAudioProcessing, sound)
  return buildAvgAudioProcessingTopologyV1({ sourcePlan, processing, targets: avgAudioProcessingSoundTargetsV1(sound) }).plan
}
function buildAvgSoundProductionBasePlanV1(input: { brief: AvgSoundTopologyInputV1;
  briefHash: string; buildNumber: number; controlEpoch: number }): ProductProductionPlanV3 {
  const declaration = parseAvgSoundPlanningBriefV1(input.brief.avgSoundPlanning)
  const musicCount = declaration.scope.templates.filter(t => t.source.kind === 'generate-music').length
  const text = input.brief.capabilityRequirements.filter(c => c.requirementKey === AVG_SOUND_TEXT_CAPABILITY_V1)
  const music = input.brief.capabilityRequirements.filter(c => c.requirementKey === AVG_SOUND_MUSIC_CAPABILITY_V1)
  if (text.length !== 1 || music.length !== (musicCount ? 1 : 0) || input.brief.capabilityRequirements.length !== 1 + music.length
    || text[0].mediaClass !== 'text' || !text[0].required || music.some(c => c.mediaClass !== 'music' || !c.required)) {
    throw new Error('[avg-sound] 声音任务只能领取准确策划文字及实际音乐能力，库导入不冒充模型调用')
  }
  const base = buildAvgAuthorAssemblyTopologyV1({ ...input, declaration: declaration.assembly })
  const authors = base.tasks.filter(t => ['avg-author-rules', 'avg-author-script'].includes(t.kind))
  const sources = authors.flatMap(t => t.outputArtifactKeys), parents = authors.map(t => t.taskKey)
  const tasks: ProductProductionPlanTaskV3[] = [], template = authors[0]!
  const add = (taskKey: string, kind: string, mode: ProductProductionPlanTaskV3['executionMode'], output: string,
    inputs: string[], dependencies: string[], gates: string[], reservation: Partial<ProductProductionPlanTaskV3['budgetReservation']> = {},
    skillId: string | null = null, capabilities: string[] = []) => tasks.push({ ...structuredClone(template),
    taskKey: avgKey(taskKey, 'sound task'), kind, lane: kind.includes('review') ? 'qa' : 'audio', executionMode: mode, skillId,
    ...(mode === 'deterministic' ? { contextProfile: 'avg-sound-planning-v1' as const } : {}),
    outputArtifactKeys: [avgKey(output, 'sound output')], inputArtifactKeys: [...inputs], dependsOn: [...dependencies],
    requiredReceipts: dependencies.map(taskKey => ({ taskKey, receiptHash: null })), requirementKeys: [],
    capabilityRequirementKeys: capabilities, concurrencyGroup: 'avg-sound-production', subjectLockKeys: [output],
    maxAttempts: 1, timeoutMs: mode === 'media-provider' ? 900_000 : mode === 'model' ? 360_000 : 90_000,
    failurePolicy: 'pause', acceptanceGateIds: gates,
    budgetReservation: { modelCalls: 0, mediaCalls: 0, inputTokens: 0, outputTokens: 0, maximumCostUsd: 0,
      durationMs: mode === 'human-import' ? 0 : 60_000, storageBytes: mode === 'human-import' ? 0 : 4 * 1024 * 1024, ...reservation } })
  add('avg.sound.propose.plan', 'avg-sound-plan-propose', 'model', AVG_SOUND_PROPOSAL_KEY_V1, sources, parents,
    ['avg.sound.plan.received'], { modelCalls: 1, inputTokens: 24_000, outputTokens: 8_000,
      maximumCostUsd: text[0].maximumRequestCost, durationMs: 360_000 }, 'avg.sound-plan.v1', [AVG_SOUND_TEXT_CAPABILITY_V1])
  add('avg.author.sound-plan', 'avg-author-sound-plan', 'human-import', AVG_SOUND_PLAN_KEY_V1,
    [...sources, AVG_SOUND_PROPOSAL_KEY_V1], [...parents, 'avg.sound.propose.plan'], ['avg.sound.plan.confirmed'])
  add('avg.sound.compile.requirements', 'avg-sound-requirements-compile', 'deterministic', AVG_SOUND_COMPILED_KEY_V1,
    [...sources, AVG_SOUND_PLAN_KEY_V1], [...parents, 'avg.author.sound-plan'], ['avg.sound.requirements.compiled'], { inputTokens: 24_000 })
  const choices: string[] = [], choiceTasks: string[] = []
  for (const requirement of declaration.scope.templates) {
    const key = requirement.requirementKey, generated = requirement.source.kind === 'generate-music'
    const raw = `avg.sound.raw.${key}`, review = `avg.review.audio.${key}`, choice = `avg.sound.choice.${key}`
    const produce = `avg.sound.generate.${key}`, observe = `avg.author.sound-review.${key}`, select = `avg.author.sound-choice.${key}`
    add(produce, generated ? 'avg-sound-music-generate' : 'avg-sound-library-import', generated ? 'media-provider' : 'deterministic', raw,
      [...sources, AVG_SOUND_PLAN_KEY_V1, AVG_SOUND_COMPILED_KEY_V1], [...parents, 'avg.author.sound-plan', 'avg.sound.compile.requirements'],
      [`avg.sound.raw.received.${key}`], { mediaCalls: generated ? 1 : 0, inputTokens: 24_000,
        maximumCostUsd: generated ? music[0].maximumRequestCost : 0, durationMs: generated ? 900_000 : 60_000,
        storageBytes: 36 * 1024 * 1024 }, generated ? 'avg.sound-request.v1' : null, generated ? [AVG_SOUND_MUSIC_CAPABILITY_V1] : [])
    add(observe, 'avg-author-sound-review', 'human-import', review, [raw, AVG_SOUND_COMPILED_KEY_V1], [produce, 'avg.sound.compile.requirements'], [`avg.sound.review.recorded.${key}`])
    add(select, 'avg-author-sound-choice', 'human-import', choice, [raw, review, AVG_SOUND_COMPILED_KEY_V1],
      [produce, observe, 'avg.sound.compile.requirements'], [`avg.sound.choice.confirmed.${key}`])
    choices.push(choice); choiceTasks.push(select)
  }
  const soundGates = tasks.flatMap(t => t.acceptanceGateIds)
  const joins = base.tasks.filter(t => !authors.some(a => a.taskKey === t.taskKey)).map(t => t.taskKey === 'avg.author.stage'
    ? { ...t, inputArtifactKeys: [...t.inputArtifactKeys, ...choices], dependsOn: [...t.dependsOn, ...choiceTasks],
      requiredReceipts: [...t.requiredReceipts, ...choiceTasks.map(taskKey => ({ taskKey, receiptHash: null }))] }
    : t.taskKey === base.terminalTaskKey ? { ...t, acceptanceGateIds: [...t.acceptanceGateIds, ...soundGates] } : t)
  const result = { ...base, tasks: [...authors, ...tasks, ...joins].map(t => t.executionMode === 'deterministic'
    ? { ...t, contextProfile: 'avg-sound-planning-v1' as const, budgetReservation: { ...t.budgetReservation, inputTokens: Math.max(24_000, t.budgetReservation.inputTokens) } } : t) }
  if (result.tasks.length > 100) throw new Error('[avg-sound] 声音生产超出共享任务上界')
  return result
}
