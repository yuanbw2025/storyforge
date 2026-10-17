import type { ProductProductionBriefV3, ProductProductionPlanTaskV3, ProductProductionPlanV3 } from '../types'
import { AVG_ASSEMBLY_GATE_IDS_V1, avgMediaAssemblyGateIdsV2, parseAvgAssemblyBriefV1, parseAvgAssemblyBriefV2, type AvgAssemblyBriefV2 } from './assembly-contract'
import { parseAvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import { buildAvgVoiceAssemblyPlanV3 } from './voice-assembly-plan'
import { avgMediaChoiceArtifactKeyV1, avgRawMediaArtifactKeyV1, avgVisualReviewArtifactKeyV1 } from './media-production-contract'
import { avgProcessedImageArtifactKeyV1 } from './image-processing-contract'

export const AVG_IMAGE_CAPABILITY_REQUIREMENT_KEY_V1 = 'avg.media.image'

/** Pure topology, frozen by the shared planner/scheduler before author adoption. */
export function buildAvgAssemblyPlanV1(input: { brief: Pick<ProductProductionBriefV3, 'avgAssembly'>; briefHash: string; buildNumber: number; controlEpoch: number }): ProductProductionPlanV3 {
  const assembly = parseAvgAssemblyBriefV1(input.brief.avgAssembly)
  const scripts = assembly.sceneKeys.map(key => `avg.content.scene-script.${key}`)
  const media = assembly.mediaAssetKeys.map((_,i) => `avg.media.${i}`)
  const tasks: ProductProductionPlanTaskV3[] = []
  const add = (taskKey: string, kind: string, lane: ProductProductionPlanTaskV3['lane'], outputArtifactKeys: string[],
    inputArtifactKeys: string[], dependsOn: string[], human: boolean, gates: readonly string[]) => {
    tasks.push({ taskKey, kind, lane, outputArtifactKeys, inputArtifactKeys, dependsOn,
      skillId: null, executionMode: human ? 'human-import' : 'deterministic',
      requiredReceipts: dependsOn.map(taskKey => ({ taskKey, receiptHash: null })),
      requirementKeys: [], capabilityRequirementKeys: [], concurrencyGroup: 'avg-author-assembly', subjectLockKeys: outputArtifactKeys,
      priority: 50, maxAttempts: 1, timeoutMs: 90_000, failurePolicy: 'pause', fallbackTaskKey: null, reuse: null,
      acceptanceGateIds: [...gates], budgetReservation: { modelCalls:0,inputTokens:human?0:50_000,outputTokens:0,mediaCalls:0,
        maximumCostUsd:0,durationMs:human?0:60_000,storageBytes:human?0:taskKey === 'avg.assembly.integrate'?16*1024*1024:4*1024*1024 } })
  }
  add('avg.author.rules','avg-author-rules','planning',['avg.system.plan'],[],[],true,['avg.rules.confirmed'])
  assembly.sceneKeys.forEach((key,i) => add(`avg.author.script.${key}`,'avg-author-script','content',[scripts[i]],['avg.system.plan'],['avg.author.rules'],true,['avg.scripts.confirmed']))
  const upstream = tasks.map(task => task.taskKey)
  add('avg.author.stage','avg-author-stage','visual',['avg.author.stage'],['avg.system.plan',...scripts],upstream,true,['avg.stage.confirmed'])
  add('avg.assembly.integrate','avg-assembly-integrate','integration',['runtime.package',...media],['avg.system.plan',...scripts,'avg.author.stage'],['avg.author.stage'],false,['runtime.package.valid','avg.media.bytes.valid','avg.rights.declared'])
  add('avg.assembly.verify','avg-assembly-verify','qa',['quality.report'],['runtime.package',...media,'avg.system.plan',...scripts,'avg.author.stage'],['avg.assembly.integrate'],false,AVG_ASSEMBLY_GATE_IDS_V1)
  return { schema:'storyforge.product-production-plan',version:3,productType:'avg',briefHash:input.briefHash,buildNumber:input.buildNumber,
    controlEpoch:input.controlEpoch,concurrency:{ maximumCostBearingTasks:1,maximumTextProviderTasks:1,maximumMediaProviderTasks:1 },
    tasks,terminalTaskKey:'avg.assembly.verify' }
}

/** Private bounded V2 topology. The shared parser/executor must admit this as a
 * complete unit; V1 callers above cannot acquire its provider budget or tasks. */
export function buildAvgMediaAssemblyPlanV2(input: {
  brief: Pick<ProductProductionBriefV3, 'capabilityRequirements'> & { avgAssembly: AvgAssemblyBriefV2 }
  briefHash: string; buildNumber: number; controlEpoch: number
}): ProductProductionPlanV3 {
  const assembly = parseAvgAssemblyBriefV2(input.brief.avgAssembly)
  const { mediaBatch } = assembly
  const baseAssembly = { schema: assembly.schema, title: assembly.title, sceneKeys: assembly.sceneKeys,
    mediaAssetKeys: assembly.mediaAssetKeys, basePackageHash: assembly.basePackageHash }
  const base = buildAvgAssemblyPlanV1({ ...input, brief: { avgAssembly: { ...baseAssembly, version: 1 } } })
  const capability = input.brief.capabilityRequirements.filter(r => r.requirementKey === AVG_IMAGE_CAPABILITY_REQUIREMENT_KEY_V1)
  if (capability.length !== 1 || capability[0].mediaClass !== 'image' || !capability[0].required
    || input.brief.capabilityRequirements.length !== 1) throw new Error('[avg-media] 视觉生产必须绑定唯一冻结图片能力，不能夹带文本或其他调用')
  const authorInputs = base.tasks.filter(t => t.executionMode === 'human-import' && t.taskKey !== 'avg.author.stage')
  const template = authorInputs[0]!
  const choices: string[] = [], choiceTaskKeys: string[] = [], mediaTasks: ProductProductionPlanTaskV3[] = []
  for (const requirement of mediaBatch.requirements) {
    const retained = assembly.imageRecovery?.retained.some(r=>r.requirementKey===requirement.requirementKey)??false
    const rawKey = avgRawMediaArtifactKeyV1(requirement.requirementKey), choiceKey = avgMediaChoiceArtifactKeyV1(requirement.requirementKey)
    const taskKey = `avg.media.generate.${requirement.requirementKey}`, choiceTaskKey = `avg.author.media.${requirement.requirementKey}`
    mediaTasks.push({ ...structuredClone(template), taskKey, kind: retained?'avg-media-image-reuse':'avg-media-image-generate', lane: 'visual',
      outputArtifactKeys: [rawKey], inputArtifactKeys: authorInputs.flatMap(t => t.outputArtifactKeys),
      dependsOn: authorInputs.map(t => t.taskKey), requiredReceipts: authorInputs.map(t => ({ taskKey: t.taskKey, receiptHash: null })),
      skillId: retained?null:'product-production.media-request.v1', executionMode: retained?'deterministic':'media-provider', capabilityRequirementKeys: [AVG_IMAGE_CAPABILITY_REQUIREMENT_KEY_V1],
      concurrencyGroup: 'media-provider', subjectLockKeys: [requirement.family.familyKey],
      maxAttempts: 1, timeoutMs: retained?90_000:360_000, acceptanceGateIds: [`avg.media.raw.received.${requirement.requirementKey}`],
      budgetReservation: { modelCalls: 0, inputTokens: 20_000, outputTokens: 0, mediaCalls: retained?0:1,
        maximumCostUsd: retained?0:capability[0].maximumRequestCost, durationMs: retained?60_000:360_000, storageBytes: (retained?4:96) * 1024 * 1024 },
    })
    const processing = assembly.imageProcessing?.entries.find(e=>e.requirementKey===requirement.requirementKey)
    const processedKey=avgProcessedImageArtifactKeyV1(requirement.requirementKey),processTaskKey=`avg.media.process.${requirement.requirementKey}`
    if(processing)mediaTasks.push({...structuredClone(template),taskKey:processTaskKey,kind:'avg-media-image-process',executionMode:'deterministic',lane:'visual',
      outputArtifactKeys:[processedKey],inputArtifactKeys:[rawKey],dependsOn:[taskKey],requiredReceipts:[{taskKey,receiptHash:null}],
      subjectLockKeys:[requirement.family.familyKey],timeoutMs:90_000,acceptanceGateIds:[`avg.media.processed.received.${requirement.requirementKey}`],
      budgetReservation:{modelCalls:0,inputTokens:0,outputTokens:0,mediaCalls:0,maximumCostUsd:0,durationMs:60_000,storageBytes:36*1024*1024}})
    const imageInputs=[rawKey,...(processing?[processedKey]:[])],imageTasks=[taskKey,...(processing?[processTaskKey]:[])]
    const reviewKey=avgVisualReviewArtifactKeyV1(requirement.requirementKey),reviewTaskKey=`avg.author.visual-review.${requirement.requirementKey}`
    if(mediaBatch.visualReviewPolicy)mediaTasks.push({...structuredClone(template),taskKey:reviewTaskKey,kind:'avg-author-visual-review',lane:'qa',
      outputArtifactKeys:[reviewKey],inputArtifactKeys:imageInputs,dependsOn:imageTasks,requiredReceipts:imageTasks.map(taskKey=>({taskKey,receiptHash:null})),subjectLockKeys:[reviewKey],acceptanceGateIds:[`avg.media.review.recorded.${requirement.requirementKey}`]})
    const choiceDependencies=[...imageTasks,...(mediaBatch.visualReviewPolicy?[reviewTaskKey]:[])]
    mediaTasks.push({ ...structuredClone(template), taskKey: choiceTaskKey, kind: 'avg-author-media-choice', lane: 'visual',
      outputArtifactKeys: [choiceKey], inputArtifactKeys: [...imageInputs,...(mediaBatch.visualReviewPolicy?[reviewKey]:[])], dependsOn: choiceDependencies,
      requiredReceipts: choiceDependencies.map(taskKey=>({taskKey,receiptHash:null})), subjectLockKeys: [choiceKey], acceptanceGateIds: [`avg.media.choice.confirmed.${requirement.requirementKey}`],
    })
    choices.push(choiceKey); choiceTaskKeys.push(choiceTaskKey)
  }
  const joins = base.tasks.filter(t => !authorInputs.some(author => author.taskKey === t.taskKey)).map(t => {
    if (t.taskKey === 'avg.author.stage') return { ...t, inputArtifactKeys: [...t.inputArtifactKeys, ...choices],
      dependsOn: [...t.dependsOn, ...choiceTaskKeys], requiredReceipts: [...t.requiredReceipts, ...choiceTaskKeys.map(taskKey => ({ taskKey, receiptHash: null }))] }
    if (t.taskKey === 'avg.assembly.verify') return { ...t, acceptanceGateIds: avgMediaAssemblyGateIdsV2(mediaBatch,assembly.imageProcessing) }
    return t
  })
  return { ...base, tasks: [...authorInputs, ...mediaTasks, ...joins] }
}

export function buildAvgNativeAssemblyPlan(input: {
  brief: ProductProductionBriefV3; briefHash: string; buildNumber: number; controlEpoch: number
}): ProductProductionPlanV3 {
  const assembly = input.brief.avgAssembly
  if (!assembly) throw new Error('[avg] 缺少原生制作 Brief')
  if (assembly.version === 3) {
    const resolved = parseAvgStoredAssemblyBriefV3(assembly)
    return buildAvgVoiceAssemblyPlanV3({ ...input, brief: { ...input.brief, avgAssembly: resolved.assembly } })
  }
  return assembly.version === 1 ? buildAvgAssemblyPlanV1(input)
    : buildAvgMediaAssemblyPlanV2({ ...input, brief: { ...input.brief, avgAssembly: assembly } })
}
