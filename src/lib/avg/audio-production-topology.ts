import type { ProductProductionPlanTaskV3, ProductProductionPlanV3 } from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { assertAvgAudioProcessingPlanTargets, avgAudioProcessingTaskKeyV1, avgProcessedAudioArtifactKeyV1,
  avgAudioProcessingGateIdV1, type AvgAudioProcessingDomainV1 } from './audio-production-contract'
import { AVG_AUDIO_PROCESSING_TASK_DURATION_MS_V1, AVG_AUDIO_PROCESSING_STORAGE_BYTES_V1, avgAudioProcessingInputTokensV1 } from './audio-production-brief'

type Input = { sourcePlan: ProductProductionPlanV3; processing: unknown; targets: Parameters<typeof assertAvgAudioProcessingPlanTargets>[1] }

/** Pure proposal on the existing voice/sound graph, never a second scheduler.
 * Shared task/context/admission and the exact authorized Brief must recognize
 * this successor before it can execute. No current Build or legacy Plan is
 * rewritten, and a topology proposal itself grants no producer authority. */
export async function proposeAvgAudioProcessingTopologyV1(input: Input) {
  // The readonly proposal may validate a supplied graph, but the synchronous
  // factories must not statically import their shared parser back through this
  // helper. Capture caller-owned inputs before the asynchronous module load.
  const frozen = { sourcePlan: structuredClone(input.sourcePlan), processing: structuredClone(input.processing), targets: structuredClone(input.targets) }
  const { parseProductProductionPlanV3 } = await import('../product-production/plan')
  const source = parseProductProductionPlanV3(frozen.sourcePlan, undefined, frozen.sourcePlan.briefHash)
  const result = buildAvgAudioProcessingTopologyV1({ ...frozen, sourcePlan: source })
  return { schema: 'storyforge.avg.audio-processing-topology-proposal' as const, version: 1 as const,
    sourcePlanHash: await hashProductProductionValueV2(source), processingPlanHash: await hashProductProductionValueV2(result.processing), ...result }
}

/** Called by the existing deterministic factories on their just-built graph.
 * Shared parsing must remain outside this synchronous builder to avoid a
 * recursive factory -> parser -> canonical factory cycle. */
export function buildAvgAudioProcessingTopologyV1(input: Input) {
  const source = input.sourcePlan
  if (source.productType !== 'avg') throw new Error('[avg-audio-process] 加工只属于准确AVG生产图')
  const processing = assertAvgAudioProcessingPlanTargets(input.processing, input.targets)
  const plan = structuredClone(source), addedTasks: ProductProductionPlanTaskV3[] = []
  for (const entry of processing.entries) {
    const { domain, requirementKey } = entry
    const rawKey = `avg.${domain}.raw.${requirementKey}`, rawTaskKey = `avg.${domain}.generate.${requirementKey}`
    const reviewKey = `avg.review.audio.${requirementKey}`, choiceKey = `avg.${domain}.choice.${requirementKey}`
    const raw = plan.tasks.find(t => t.taskKey === rawTaskKey)
    const review = plan.tasks.find(t => t.taskKey === `avg.author.${domain}-review.${requirementKey}`)
    const choice = plan.tasks.find(t => t.taskKey === `avg.author.${domain}-choice.${requirementKey}`)
    const expectedKinds = domain === 'voice' ? ['avg-media-voice-generate', 'avg-media-voice-reuse'] : ['avg-sound-music-generate', 'avg-sound-library-import', 'avg-sound-raw-reuse']
    if (!raw || !expectedKinds.includes(raw.kind) || raw.outputArtifactKeys.length !== 1 || raw.outputArtifactKeys[0] !== rawKey
      || raw.maxAttempts !== 1 || raw.executionMode !== (raw.kind === expectedKinds[0] ? 'media-provider' : 'deterministic')
      || !review || review.kind !== `avg-author-${domain}-review` || review.executionMode !== 'human-import'
      || review.outputArtifactKeys.length !== 1 || review.outputArtifactKeys[0] !== reviewKey || !review.inputArtifactKeys.includes(rawKey) || !review.dependsOn.includes(rawTaskKey)
      || !choice || choice.kind !== `avg-author-${domain}-choice` || choice.executionMode !== 'human-import'
      || choice.outputArtifactKeys.length !== 1 || choice.outputArtifactKeys[0] !== choiceKey
      || !choice.inputArtifactKeys.includes(rawKey) || !choice.inputArtifactKeys.includes(reviewKey)
      || !choice.dependsOn.includes(rawTaskKey) || !choice.dependsOn.includes(review.taskKey)) {
      throw new Error('[avg-audio-process] 需求缺少准确原音频producer、独立审听或作者选择，不能拼接另一条生产链')
    }
    const taskKey = avgAudioProcessingTaskKeyV1(domain, requirementKey), output = avgProcessedAudioArtifactKeyV1(domain, requirementKey)
    if (plan.tasks.some(t => t.taskKey === taskKey || t.outputArtifactKeys.includes(output))) throw new Error('[avg-audio-process] 加工任务或输出已存在，不能重复加工旧生产图')
    const task = processingTask(raw, domain, requirementKey)
    plan.tasks.splice(plan.tasks.indexOf(raw) + 1, 0, task)
    for (const consumer of [review, choice]) {
      consumer.inputArtifactKeys.push(output); consumer.dependsOn.push(taskKey)
      consumer.requiredReceipts.push({ taskKey, receiptHash: null })
    }
    addedTasks.push(task)
  }
  if (plan.tasks.length > 100) throw new Error('[avg-audio-process] 加工后的生产图超过100项上界，不能截断需求或绕过审听')
  const terminal = plan.tasks.find(t => t.taskKey === plan.terminalTaskKey)!
  terminal.acceptanceGateIds.push(...addedTasks.flatMap(t => t.acceptanceGateIds))
  return { processing, plan }
}

function processingTask(raw: ProductProductionPlanTaskV3, domain: AvgAudioProcessingDomainV1, key: string): ProductProductionPlanTaskV3 {
  const rawKey = `avg.${domain}.raw.${key}`, taskKey = avgAudioProcessingTaskKeyV1(domain, key), output = avgProcessedAudioArtifactKeyV1(domain, key)
  const kinds = domain === 'voice' ? ['avg-media-voice-generate', 'avg-media-voice-reuse'] : ['avg-sound-music-generate', 'avg-sound-library-import', 'avg-sound-raw-reuse']
  if (raw.taskKey !== `avg.${domain}.generate.${key}` || !kinds.includes(raw.kind) || raw.maxAttempts !== 1
    || raw.executionMode !== (raw.kind === kinds[0] ? 'media-provider' : 'deterministic')
    || raw.outputArtifactKeys.length !== 1 || raw.outputArtifactKeys[0] !== rawKey) throw new Error('[avg-audio-process] 加工须绑定准确单次原音频producer')
  const task: ProductProductionPlanTaskV3 = { ...structuredClone(raw), taskKey, kind: 'avg-audio-process', lane: 'audio',
    skillId: null, executionMode: 'deterministic', contextProfile: domain === 'voice' ? 'avg-task-v1' : 'avg-sound-planning-v1',
    inputArtifactKeys: [...raw.inputArtifactKeys, rawKey], outputArtifactKeys: [output],
    dependsOn: [...raw.dependsOn, raw.taskKey], requiredReceipts: [...structuredClone(raw.requiredReceipts), { taskKey: raw.taskKey, receiptHash: null }],
    requirementKeys: [], capabilityRequirementKeys: [], concurrencyGroup: 'avg-local-audio-processing', subjectLockKeys: [output],
    maxAttempts: 1, timeoutMs: AVG_AUDIO_PROCESSING_TASK_DURATION_MS_V1, failurePolicy: 'pause', fallbackTaskKey: null, reuse: null,
    acceptanceGateIds: [avgAudioProcessingGateIdV1(domain, key)],
    budgetReservation: { modelCalls: 0, mediaCalls: 0, inputTokens: avgAudioProcessingInputTokensV1(domain), outputTokens: 0,
      maximumCostUsd: 0, durationMs: AVG_AUDIO_PROCESSING_TASK_DURATION_MS_V1, storageBytes: AVG_AUDIO_PROCESSING_STORAGE_BYTES_V1 } }
  delete task.authorRevision
  return task
}

/** Structural task admission only; exact frozen Brief/canonical graph and
 * real context/Run/producer/byte/adoption proofs remain independent gates. */
export function assertAvgAudioProcessingTaskShapeV1(task: ProductProductionPlanTaskV3, tasks: ProductProductionPlanTaskV3[], productType: string) {
  const match = /^avg\.(voice|sound)\.processed\.(.+)$/.exec(task.outputArtifactKeys[0] ?? '')
  if (productType !== 'avg' || !match) throw new Error('[avg-audio-process] 加工任务不是准确AVG声音输出')
  const domain = match[1] as AvgAudioProcessingDomainV1, key = match[2]
  const raw = tasks.find(t => t.taskKey === `avg.${domain}.generate.${key}`)
  if (!raw || canonicalProductProductionJsonV2(task) !== canonicalProductProductionJsonV2(processingTask(raw, domain, key))) {
    throw new Error('[avg-audio-process] 加工任务、零调用预算、原依赖、配方投影或单次边界不一致')
  }
  for (const suffix of ['review', 'choice']) {
    const author = tasks.find(t => t.taskKey === `avg.author.${domain}-${suffix}.${key}`)
    if (!author || author.kind !== `avg-author-${domain}-${suffix}` || author.executionMode !== 'human-import'
      || author.outputArtifactKeys.length !== 1 || author.outputArtifactKeys[0] !== (suffix === 'review' ? `avg.review.audio.${key}` : `avg.${domain}.choice.${key}`)
      || !author.inputArtifactKeys.includes(task.outputArtifactKeys[0]) || !author.inputArtifactKeys.includes(raw.outputArtifactKeys[0])
      || !author.dependsOn.includes(task.taskKey) || !author.dependsOn.includes(raw.taskKey)) {
      throw new Error('[avg-audio-process] 加工候选缺少独立审听/选择依赖，不能绕过作者采用')
    }
    if (suffix === 'choice' && (!author.inputArtifactKeys.includes(`avg.review.audio.${key}`)
      || !author.dependsOn.includes(`avg.author.${domain}-review.${key}`))) throw new Error('[avg-audio-process] 选择不能绕过准确独立审听')
  }
}
