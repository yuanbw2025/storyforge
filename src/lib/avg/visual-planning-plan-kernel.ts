import type { ProductProductionBriefV3,ProductProductionPlanTaskV3,ProductProductionPlanV3 } from '../types'
import { buildAvgImageAssemblyTopologyV1 } from './assembly-plan'
import { avgMediaBriefArtifactKeyV1,type AvgVisualDesignKindV1,type AvgVisualPlanningScopeV1 } from './visual-planning-contract'
import type { AvgAssemblyBriefV1 } from './assembly-contract'
import type { AvgImageProcessingPlanV1 } from './image-processing-contract'
import { avgKey } from './protocol-validation'
import { AVG_VISUAL_TEXT_CAPABILITY_V4 } from './visual-planning-roles'
import { avgVisualPlanningTargetKeysV4 } from './visual-planning-reuse-contract'

export interface AvgVisualPlanningPlanProtocolV1 {
  contextProfile:'avg-visual-planning-v4'|'avg-visual-planning-v5'
  directionKind:string;subjectKind:string;compileKind:string;reuseProposalKind?:string
  imageSkillId:string;compiledArtifactKey:string
  proposalKey:(kind:AvgVisualDesignKindV1|null,subjectKey?:string)=>string
  role:(kind:AvgVisualDesignKindV1|null)=>{skillId:string;outputTokens:number}
}
/** Shared deterministic graph construction. Version-specific callers parse
 * their real contract and batch; this kernel owns no metadata authorization. */
export function buildAvgVisualPlanningTopologyV1(input:{
  brief:Pick<ProductProductionBriefV3,'capabilityRequirements'>;briefHash:string;buildNumber:number;controlEpoch:number
},v:{assembly:AvgAssemblyBriefV1;scope:Pick<AvgVisualPlanningScopeV1,'templates'>;imageProcessing?:AvgImageProcessingPlanV1;
  proposalReuse?:Array<{buildNumber:number;artifact:{artifactKey:string}}>;
  rawReuse?:Array<{requirementKey:string;raw:{buildNumber:number}}>},
  mediaBatch:Parameters<typeof buildAvgImageAssemblyTopologyV1>[0]['declaration']['mediaBatch'],protocol:AvgVisualPlanningPlanProtocolV1):ProductProductionPlanV3 {
  const image = input.brief.capabilityRequirements.filter(c => c.requirementKey === 'avg.media.image')
  const text = input.brief.capabilityRequirements.filter(c => c.requirementKey === AVG_VISUAL_TEXT_CAPABILITY_V4)
  if (image.length !== 1 || text.length !== 1 || input.brief.capabilityRequirements.length !== 2
    || image[0].mediaClass !== 'image' || image[0].required !== (v.scope.templates.length>(v.rawReuse?.length??0))
    || text[0].mediaClass !== 'text' || text[0].required !== (avgVisualPlanningTargetKeysV4(v.scope).length>(v.proposalReuse?.length??0))) throw new Error('[avg-visual-plan] 必须冻结准确图片和实际仍需调用的专业文本能力')
  if(v.rawReuse?.some(r=>r.raw.buildNumber>=input.buildNumber))throw new Error('[avg-visual-raw-reuse] 原图来源必须早于当前版本')
  if(v.proposalReuse?.some(r=>r.buildNumber>=input.buildNumber))throw new Error('[avg-visual-reuse] 来源必须早于当前版本')
  // Topology fields only. The caller provides its actual versioned batch,
  // without manufacturing a legacy Brief/request or granting any execution.
  const base = buildAvgImageAssemblyTopologyV1({ briefHash:input.briefHash,buildNumber:input.buildNumber,controlEpoch:input.controlEpoch,
    capabilityRequirements:image.map(c=>({...c,required:true})),declaration:{...v.assembly,mediaBatch,...(v.imageProcessing?{imageProcessing:v.imageProcessing}:{})} })
  const sourceTasks = base.tasks.filter(t => ['avg-author-rules', 'avg-author-script'].includes(t.kind))
  const sourceKeys = sourceTasks.flatMap(t => t.outputArtifactKeys), sourceTaskKeys = sourceTasks.map(t => t.taskKey)
  const template = sourceTasks[0]!, additions: ProductProductionPlanTaskV3[] = []
  const addDirection = (kind: AvgVisualDesignKindV1 | null, subjectKey?: string) => {
    const role = protocol.role(kind), proposal = protocol.proposalKey(kind, subjectKey)
    const canonical = kind === null ? 'avg.media.visual-bible' : avgMediaBriefArtifactKeyV1(kind, subjectKey!)
    const modelTask = kind === null ? 'avg.visual.propose.direction' : avgKey(`avg.visual.propose.${kind}.${subjectKey}`, 'proposal task')
    const authorTask = kind === null ? 'avg.author.visual-bible' : avgKey(`avg.author.${kind}-brief.${subjectKey}`, 'author task')
    const parents = [...sourceTaskKeys, ...(kind === null ? [] : ['avg.author.visual-bible'])]
    const inputs = [...sourceKeys, ...(kind === null ? [] : ['avg.media.visual-bible'])]
    const reused=v.proposalReuse?.some(r=>r.artifact.artifactKey===canonical)??false
    if(reused&&!protocol.reuseProposalKind)throw new Error('[avg-visual-plan] 此协议未登记方案复用')
    additions.push({ ...structuredClone(template), taskKey: modelTask, kind: reused?protocol.reuseProposalKind!:kind === null ? protocol.directionKind : protocol.subjectKind,
      lane: 'visual', executionMode: 'model', skillId: role.skillId, outputArtifactKeys: [proposal], inputArtifactKeys: inputs,
      dependsOn: parents, requiredReceipts: parents.map(taskKey => ({ taskKey, receiptHash: null })),
      capabilityRequirementKeys: [AVG_VISUAL_TEXT_CAPABILITY_V4], concurrencyGroup: 'avg-visual-planning', subjectLockKeys: [canonical],
      maxAttempts: 1, timeoutMs: 360_000, acceptanceGateIds: [`${proposal}.received`],
      budgetReservation: { modelCalls: 1, inputTokens: 24_000, outputTokens: role.outputTokens, mediaCalls: 0,
        maximumCostUsd: text[0].maximumRequestCost, durationMs: 360_000, storageBytes: 4 * 1024 * 1024 },
      ...(reused?{executionMode:'deterministic' as const,skillId:null,contextProfile:protocol.contextProfile,
        capabilityRequirementKeys:[],timeoutMs:60_000,budgetReservation:{modelCalls:0,inputTokens:24_000,outputTokens:0,mediaCalls:0,
          maximumCostUsd:0,durationMs:60_000,storageBytes:4*1024*1024}}:{}) })
    const authorParents = [...parents, modelTask]
    additions.push({ ...structuredClone(template), taskKey: authorTask, kind: kind === null ? 'avg-author-visual-bible' : 'avg-author-media-brief',
      lane: 'visual', outputArtifactKeys: [canonical], inputArtifactKeys: [...inputs, proposal], dependsOn: authorParents,
      requiredReceipts: authorParents.map(taskKey => ({ taskKey, receiptHash: null })), subjectLockKeys: [canonical], acceptanceGateIds: [`${canonical}.confirmed`] })
    return { canonical, authorTask }
  }
  const adopted = [addDirection(null)]
  const subjects = new Map(v.scope.templates.map(t => [t.parameters.family.subjectKey, t.subjectKind]))
  for (const [subject, kind] of subjects) adopted.push(addDirection(kind, subject))
  const compileTask = 'avg.visual.compile.requirements', compileInputs = [...sourceKeys, ...adopted.map(a => a.canonical)]
  const compileParents = [...sourceTaskKeys, ...adopted.map(a => a.authorTask)]
  additions.push({ ...structuredClone(template), taskKey: compileTask, kind: protocol.compileKind, lane: 'visual', executionMode: 'deterministic', contextProfile: protocol.contextProfile,
    inputArtifactKeys: compileInputs, outputArtifactKeys: [protocol.compiledArtifactKey], dependsOn: compileParents,
    requiredReceipts: compileParents.map(taskKey => ({ taskKey, receiptHash: null })), subjectLockKeys: [protocol.compiledArtifactKey],
    acceptanceGateIds: ['avg.visual.requirements.compiled'], budgetReservation: { modelCalls: 0, inputTokens: 24_000, outputTokens: 0, mediaCalls: 0,
      maximumCostUsd: 0, durationMs: 60_000, storageBytes: 4 * 1024 * 1024 } })
  const tasks = base.tasks.map(task => task.taskKey === base.terminalTaskKey ? { ...task,
    acceptanceGateIds: [...task.acceptanceGateIds, 'avg.visual.requirements.compiled', ...adopted.map(a => `${a.canonical}.confirmed`)] }
    : task.kind === 'avg-media-image-generate' ? { ...task,
    skillId: protocol.imageSkillId,
    inputArtifactKeys: [...task.inputArtifactKeys, protocol.compiledArtifactKey],
    dependsOn: [...task.dependsOn, compileTask], requiredReceipts: [...task.requiredReceipts, { taskKey: compileTask, receiptHash: null }],
    ...(v.rawReuse?.some(r=>task.taskKey===`avg.media.generate.${r.requirementKey}`)?{kind:'avg-media-image-reuse' as const,
      executionMode:'deterministic' as const,skillId:null,contextProfile:protocol.contextProfile,capabilityRequirementKeys:[],maxAttempts:1,reuse:null,timeoutMs:60_000,
      budgetReservation:{modelCalls:0,inputTokens:24_000,outputTokens:0,mediaCalls:0,maximumCostUsd:0,durationMs:60_000,storageBytes:4*1024*1024}}:{}) }
    :task.kind==='avg-media-image-process'?{...task,contextProfile:protocol.contextProfile,
      inputArtifactKeys:[...sourceKeys,protocol.compiledArtifactKey,...task.inputArtifactKeys],
      dependsOn:[...sourceTaskKeys,compileTask,...task.dependsOn],requiredReceipts:[...sourceTaskKeys,compileTask,...task.dependsOn].map(taskKey=>({taskKey,receiptHash:null})),
      budgetReservation:{...task.budgetReservation,inputTokens:24_000}}:task)
  const firstImage = tasks.findIndex(t => t.taskKey.startsWith('avg.media.generate.'))
  tasks.splice(firstImage, 0, ...additions)
  if (tasks.length > 100) throw new Error('[avg-visual-plan] 方案候选、作者采用、消费和终态超出共享任务上界')
  return { ...base, tasks }
}
