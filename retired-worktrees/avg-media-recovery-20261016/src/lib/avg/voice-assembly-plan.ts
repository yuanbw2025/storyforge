import type { ProductProductionBriefV3, ProductProductionPlanTaskV3, ProductProductionPlanV3 } from '../types'
import { buildAvgAssemblyPlanV1, buildAvgMediaAssemblyPlanV2, AVG_IMAGE_CAPABILITY_REQUIREMENT_KEY_V1 } from './assembly-plan'
import { AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1, assertAvgVoiceCapabilityDeclarationV1, avgRawVoiceArtifactKeyV1,
  avgVoiceChoiceArtifactKeyV1, avgVoiceReviewArtifactKeyV1, avgVoiceAssemblyGateIdsV3, parseAvgAssemblyBriefV3,
  type AvgAssemblyBriefV3 } from './voice-assembly-contract'
import { AVG_VOICE_TASK_TIMEOUT_MS_V1 } from './voice-request-contract'

/** Private fixed topology, not registered dispatch. Every clip waits for exact
 * adopted rules/scripts, then a separate human audition and explicit choice.
 * The existing stage/package/QA joins own the final playable result.
 */
export function buildAvgVoiceAssemblyPlanV3(input: {
  brief: Pick<ProductProductionBriefV3, 'capabilityRequirements'> & { avgAssembly: AvgAssemblyBriefV3 }
  briefHash: string; buildNumber: number; controlEpoch: number
}): ProductProductionPlanV3 {
  const assembly = parseAvgAssemblyBriefV3(input.brief.avgAssembly)
  const voiceCapabilities = input.brief.capabilityRequirements.filter(c => c.requirementKey === AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1)
  const imageCapabilities = input.brief.capabilityRequirements.filter(c => c.requirementKey === AVG_IMAGE_CAPABILITY_REQUIREMENT_KEY_V1)
  if (voiceCapabilities.length !== 1 || imageCapabilities.length !== (assembly.image ? 1 : 0)
    || input.brief.capabilityRequirements.length !== 1 + imageCapabilities.length) throw new Error('[avg-voice] 组装只接受准确图片/配音能力，不能夹带文本或其他调用')
  const capability = voiceCapabilities[0]!
  assertAvgVoiceCapabilityDeclarationV1(assembly, capability)
  const baseAssembly = { schema: assembly.schema, version: 1 as const, title: assembly.title,
    sceneKeys: assembly.sceneKeys, mediaAssetKeys: assembly.mediaAssetKeys, basePackageHash: assembly.basePackageHash }
  const base = assembly.image ? buildAvgMediaAssemblyPlanV2({ ...input,
    brief: { capabilityRequirements: imageCapabilities, avgAssembly: { ...baseAssembly, ...assembly.image, version: 2 } } })
    : buildAvgAssemblyPlanV1({ ...input, brief: { avgAssembly: baseAssembly } })
  const authorInputs = base.tasks.filter(t => t.executionMode === 'human-import' && ['avg-author-rules', 'avg-author-script'].includes(t.kind))
  const template = authorInputs[0]!
  const additions: ProductProductionPlanTaskV3[] = [], choices: string[] = [], choiceTasks: string[] = []
  for (const requirement of assembly.voice.batch.requirements) {
    const retained = assembly.voice.recovery?.retained.some(item => item.requirementKey === requirement.requirementKey) ?? false
    const taskKey = `avg.voice.generate.${requirement.requirementKey}`, reviewTask = `avg.author.voice-review.${requirement.requirementKey}`
    const choiceTask = `avg.author.voice-choice.${requirement.requirementKey}`
    const raw = avgRawVoiceArtifactKeyV1(requirement.requirementKey), review = avgVoiceReviewArtifactKeyV1(requirement.requirementKey)
    const choice = avgVoiceChoiceArtifactKeyV1(requirement.requirementKey)
    additions.push({ ...structuredClone(template), taskKey, kind: retained ? 'avg-media-voice-reuse' : 'avg-media-voice-generate', lane: 'audio',
      outputArtifactKeys: [raw], inputArtifactKeys: authorInputs.flatMap(t => t.outputArtifactKeys),
      dependsOn: authorInputs.map(t => t.taskKey), requiredReceipts: authorInputs.map(t => ({ taskKey: t.taskKey, receiptHash: null })),
      skillId: retained ? null : 'avg.media-request.v1', executionMode: retained ? 'deterministic' : 'media-provider',
      capabilityRequirementKeys: [AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1], concurrencyGroup: 'media-provider',
      subjectLockKeys: [`voice.${requirement.presetKey}`], maxAttempts: 1, timeoutMs: retained ? 90_000 : AVG_VOICE_TASK_TIMEOUT_MS_V1,
      acceptanceGateIds: [`avg.voice.raw.received.${requirement.requirementKey}`],
      budgetReservation: { modelCalls: 0, inputTokens: 20_000, outputTokens: 0, mediaCalls: retained ? 0 : 1,
        maximumCostUsd: retained ? 0 : capability.maximumRequestCost, durationMs: retained ? 60_000 : AVG_VOICE_TASK_TIMEOUT_MS_V1,
        storageBytes: (retained ? 4 : 96) * 1024 * 1024 } })
    additions.push({ ...structuredClone(template), taskKey: reviewTask, kind: 'avg-author-voice-review', lane: 'qa',
      outputArtifactKeys: [review], inputArtifactKeys: [raw], dependsOn: [taskKey], requiredReceipts: [{ taskKey, receiptHash: null }],
      subjectLockKeys: [review], acceptanceGateIds: [`avg.voice.review.recorded.${requirement.requirementKey}`] })
    additions.push({ ...structuredClone(template), taskKey: choiceTask, kind: 'avg-author-voice-choice', lane: 'audio',
      outputArtifactKeys: [choice], inputArtifactKeys: [raw, review], dependsOn: [taskKey, reviewTask],
      requiredReceipts: [taskKey, reviewTask].map(taskKey => ({ taskKey, receiptHash: null })),
      subjectLockKeys: [choice], acceptanceGateIds: [`avg.voice.choice.confirmed.${requirement.requirementKey}`] })
    choices.push(choice); choiceTasks.push(choiceTask)
  }
  const joins = base.tasks.map(task => task.taskKey === 'avg.author.stage'
    ? { ...task, inputArtifactKeys: [...task.inputArtifactKeys, ...choices], dependsOn: [...task.dependsOn, ...choiceTasks],
      requiredReceipts: [...task.requiredReceipts, ...choiceTasks.map(taskKey => ({ taskKey, receiptHash: null }))] }
    : task.taskKey === 'avg.assembly.verify' ? { ...task, acceptanceGateIds: avgVoiceAssemblyGateIdsV3(assembly) } : task)
  const firstJoin = joins.findIndex(task => task.taskKey === 'avg.author.stage')
  const tasks = [...joins.slice(0, firstJoin), ...additions, ...joins.slice(firstJoin)].map(task =>
    task.executionMode === 'human-import' ? task : { ...task,
      skillId: task.executionMode === 'media-provider' ? 'avg.media-request.v1' : null,
      ...(task.executionMode === 'deterministic' ? { contextProfile: 'avg-task-v1' as const } : {}),
      budgetReservation: { ...task.budgetReservation, inputTokens: Math.max(20_000, task.budgetReservation.inputTokens) } })
  return { ...base, tasks }
}
