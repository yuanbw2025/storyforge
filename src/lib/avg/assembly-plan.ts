import type { ProductProductionBriefV3, ProductProductionPlanTaskV3, ProductProductionPlanV3 } from '../types'
import { AVG_ASSEMBLY_GATE_IDS_V1, parseAvgAssemblyBriefV1 } from './assembly-contract'

/** Pure topology, frozen by the shared planner/scheduler before author adoption. */
export function buildAvgAssemblyPlanV1(input: { brief: ProductProductionBriefV3; briefHash: string; buildNumber: number; controlEpoch: number }): ProductProductionPlanV3 {
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
