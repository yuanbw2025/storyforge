import { db } from '../db/schema'
import type { WorkspaceScope, ProductProductionBriefV3, ProviderCapabilityRequirementV1 } from '../types'
import type { AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import type { AvgVisualPlanningScopeV1 } from './visual-planning-contract'
import { avgVisualPlanningExecutionReadyV4, parseAvgVisualPlanningBriefV4 } from './visual-planning-brief'
import { freezeAvgVisualPlanningScopeV1 } from './media-source'
import { readAvgDraftReferenceBytesV1,readAvgDraftReferenceBytesV2 } from './editor-service'
import { verifyAvgReferenceBytesV1, avgImageReferenceCapabilityV2,type AvgImageAdapterIdV4 } from './media-reference-contract'
import { validateAvgGeneratedReferencesV1 } from './media-generated-reference'
import { resolveConfiguredTextCapabilityV1 } from '../product-production/capabilities'
import { resolveAvgImageExecutionCapabilityV2,resolveAvgImageExecutionCapabilityV4 } from './media-capability'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { AVG_VISUAL_TEXT_CAPABILITY_V4 } from './visual-planning-roles'
import { avgVisualPlanningBudgetV4, avgVisualPlanningGateIdsV4, AVG_VISUAL_PLANNING_TEXT_DATA_CLASS_V4 } from './visual-planning-policy'
import { buildAvgVisualPlanningPlanV4 } from './visual-planning-plan'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { readAvgVisualProposalEvidenceV4,readAvgVisualProposalEvidenceV5 } from './visual-planning-evidence'
import { avgVisualPlanningExecutionReadyV5,parseAvgVisualPlanningBriefV5 } from './visual-planning-brief-v5'
import { buildAvgVisualPlanningPlanV5 } from './visual-planning-plan-v5'
import type { ProductProductionCapabilityBindingV1 } from '../product-production/scheduler'
import { readProductProductionDetailsV1, stopProductProductionV1 } from '../product-production/service'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { stageAvgAuthorArtifactV1 } from './author-artifacts'
import { executeProductProductionCommand } from '../product-production/commands'
import { avgText } from './protocol-validation'

import type { AvgVisualPlanningScopeV2 } from './visual-planning-contract-v2'
import { freezeAvgVisualPlanningScopeV2 } from './media-source-v2'
import { avgVisualPlanningBudgetV5,avgVisualPlanningGateIdsV5,AVG_VISUAL_PLANNING_TEXT_DATA_CLASS_V5 } from './visual-planning-policy-v5'

export type AvgVisualPlanningDraftV5=Omit<AvgVisualPlanningScopeV2,'sourceInputHash'|'aspectRatio'>
export type AvgVisualPlanningDraftV4 = Omit<AvgVisualPlanningScopeV1, 'sourceInputHash' | 'aspectRatio'>

/** Validate before creating or changing a Production. This resolves existing
 * non-secret capabilities, never sends a provider request or saves a draft. */
export async function prepareAvgVisualPlanningConfigurationV4(scope: WorkspaceScope, workspace: AvgAuthorWorkspaceV1, value: AvgVisualPlanningDraftV4,adapterId:AvgImageAdapterIdV4='agnes.image-2.1-flash.v1') {
  if (!avgVisualPlanningExecutionReadyV4()) throw new Error('[avg-visual-plan] 专业视觉制作尚未启用')
  if (workspace.mediaBatch || workspace.voiceProduction || workspace.imageProcessing || workspace.presentation.stage.assets.some(a => !a.mimeType.startsWith('image/'))) {
    throw new Error('[avg-visual-plan] 本专业视觉批次不能混入旧生成/配音/加工方案；请保留原制作记录')
  }
  const planning = await freezeAvgVisualPlanningScopeV1(value, workspace)
  for (const template of planning.templates) {
    const refs = planning.referenceCatalog.filter(r => template.allowedReferenceKeys.includes(r.referenceKey)).map(r => r.reference)
    await validateAvgGeneratedReferencesV1(scope, refs, template.parameters.family)
    for (const reference of refs) await verifyAvgReferenceBytesV1(reference, await readAvgDraftReferenceBytesV1(scope, reference))
  }
  return resolveVisualConfigurationCapabilities(scope,planning,adapterId,AVG_VISUAL_PLANNING_TEXT_DATA_CLASS_V4)
}

async function resolveVisualConfigurationCapabilities<S extends AvgVisualPlanningScopeV1|AvgVisualPlanningScopeV2>(scope:WorkspaceScope,planning:S,adapterId:AvgImageAdapterIdV4,textDataClass:string){
  const text = await resolveConfiguredTextCapabilityV1({ projectId: scope.projectId, category: 'product-production', requirementKey: AVG_VISUAL_TEXT_CAPABILITY_V4 })
  const textRequirement: ProviderCapabilityRequirementV1 = { requirementKey: AVG_VISUAL_TEXT_CAPABILITY_V4, mediaClass: 'text', operation: 'generate',
    adapterFamily: 'text-model', minimumCapabilityVersion: '1', allowedDataClasses: [textDataClass],
    maximumRequestCost: null, maximumTotalCost: null, rightsPolicyVersion: 'storyforge-avg-visual-text-rights.v1', capabilityHash: text.receipt.capabilityHash, required: true }
  const imageRequirement: ProviderCapabilityRequirementV1 = { requirementKey: 'avg.media.image', mediaClass: 'image', operation: 'generate',
    adapterFamily: 'agnes', minimumCapabilityVersion: '1', allowedDataClasses: [...new Set(['image-prompt', ...planning.referenceCatalog.map(r => r.reference.dataClass)])],
    maximumRequestCost: null, maximumTotalCost: null, rightsPolicyVersion: 'storyforge-avg-image-rights.v1',
    capabilityHash: await hashProductProductionValueV2(avgImageReferenceCapabilityV2(adapterId)), required: true }
  const image = adapterId==='agnes.image-2.1-flash.v1'?await resolveAvgImageExecutionCapabilityV2({ projectId: scope.projectId, requirement: imageRequirement })
    :await resolveAvgImageExecutionCapabilityV4({projectId:scope.projectId,requirement:imageRequirement,adapterId})
  return { planning, capabilities: [textRequirement, imageRequirement], imageBinding: { ...image.binding, endpointRouteHash: image.endpointRouteHash } }
}

/** New V2 references are read with their actual family/content policy before
 * resolving a route. Preparation never sends a provider request or writes DB. */
export async function prepareAvgVisualPlanningConfigurationV5(scope:WorkspaceScope,workspace:AvgAuthorWorkspaceV1,value:AvgVisualPlanningDraftV5,adapterId:AvgImageAdapterIdV4='agnes.image-2.1-flash.v1'){
  if(!avgVisualPlanningExecutionReadyV5())throw new Error('[avg-visual-plan] 新专业视觉制作尚未启用')
  if(workspace.mediaBatch||workspace.voiceProduction||workspace.imageProcessing||workspace.presentation.stage.assets.some(a=>!a.mimeType.startsWith('image/')))throw new Error('[avg-visual-plan] 本专业视觉批次不能混入旧生成/配音/加工方案；请保留原制作记录')
  const planning=await freezeAvgVisualPlanningScopeV2(value,workspace)
  await assertNewReferences(scope,planning)
  return resolveVisualConfigurationCapabilities(scope,planning,adapterId,AVG_VISUAL_PLANNING_TEXT_DATA_CLASS_V5)
}
async function assertNewReferences(scope:WorkspaceScope,planning:AvgVisualPlanningScopeV2){
  for(const {referenceKey,reference} of planning.referenceCatalog){
    const families=[...new Map(planning.templates.filter(t=>t.allowedReferenceKeys.includes(referenceKey)).map(t=>[JSON.stringify([t.parameters.family.subjectKey,t.parameters.family.familyKey,t.parameters.family.revision]),t.parameters.family])).values()]
    if(reference.purpose==='identity'&&families.length)for(const family of families)await verifyAvgReferenceBytesV1(reference,await readAvgDraftReferenceBytesV2(scope,reference,family))
    else await verifyAvgReferenceBytesV1(reference,await readAvgDraftReferenceBytesV2(scope,reference))
  }
}

/** Reuse the common owner/source/scale preparation. Its in-memory assembly
 * value is replaced before the single reviewable V4 Brief is persisted. */
export function completeAvgVisualPlanningBriefV4(base: ProductProductionBriefV3, configuration: Awaited<ReturnType<typeof prepareAvgVisualPlanningConfigurationV4>>) {
  if (base.avgAssembly?.version !== 1 || base.avgVisualPlanning) throw new Error('[avg-visual-plan] 专业视觉准备缺少准确原生来源')
  const { avgAssembly: assembly, ...source } = base, { planning, capabilities, imageBinding } = configuration
  const avgVisualPlanning = parseAvgVisualPlanningBriefV4({ schema: 'storyforge.avg.visual-planning-brief', version: 4,
    assembly: { ...assembly, mediaAssetKeys: [...new Set([...assembly.mediaAssetKeys, ...planning.templates.filter(t => t.parameters.consumer.domain !== 'reference').map(t => t.parameters.assetKey)])] },
    scope: planning, imageBinding })
  return completeVisualFields(source,avgVisualPlanning,capabilities)
}

export function completeAvgVisualPlanningBriefV5(base:ProductProductionBriefV3,configuration:Awaited<ReturnType<typeof prepareAvgVisualPlanningConfigurationV5>>){
  if(base.avgAssembly?.version!==1||base.avgVisualPlanning)throw new Error('[avg-visual-plan] 专业视觉准备缺少准确原生来源')
  const {avgAssembly:assembly,...source}=base,{planning,capabilities,imageBinding}=configuration
  const avgVisualPlanning=parseAvgVisualPlanningBriefV5({schema:'storyforge.avg.visual-planning-brief',version:5,
    assembly:{...assembly,mediaAssetKeys:[...new Set([...assembly.mediaAssetKeys,...planning.templates.filter(t=>t.parameters.consumer.domain!=='reference').map(t=>t.parameters.assetKey)])]},scope:planning,imageBinding})
  return completeVisualFields(source,avgVisualPlanning,capabilities)
}

function completeVisualFields<V extends NonNullable<ProductProductionBriefV3['avgVisualPlanning']>>(source:Omit<ProductProductionBriefV3,'avgAssembly'|'avgVisualPlanning'>,avgVisualPlanning:V,capabilities:ProviderCapabilityRequirementV1[]){
  const planning=avgVisualPlanning.scope
  const input = { avgVisualPlanning, capabilityRequirements: capabilities }
  return { ...source, ...input, productionBudget: (avgVisualPlanning.version===5?avgVisualPlanningBudgetV5:avgVisualPlanningBudgetV4)(input),
    media: { visualLevel: 'key-scenes', audioLevel: 'none', imageCount: planning.templates.length, voiceLineCount: 0, musicTrackCount: 0, sfxCount: 0,
      requiredMediaKinds: [...new Set(planning.templates.map(t => t.parameters.mediaKind))] },
    externalDataPolicy: { allowedDataClasses: [...new Set([...capabilities.flatMap(c => c.allowedDataClasses)])], forbiddenDataClasses: [],
      allowReferenceImages: planning.referenceCatalog.length > 0, allowVoiceScripts: false },
    fallbackPolicy: { allowTextOnly: false, allowExistingProjectMedia: true, allowProceduralAudio: false, onRequiredCapabilityMissing: 'pause' },
    completionContract: { requiresPlayablePreview: true, requiredGateIds: (avgVisualPlanning.version===5?avgVisualPlanningGateIdsV5:avgVisualPlanningGateIdsV4)(input), minimumMediaCoverage: 1, allowSoftWaivers: false } }
}

export async function assertAvgVisualPlanningDraftMatchesV4(scope: WorkspaceScope, workspace: AvgAuthorWorkspaceV1, brief: ProductProductionBriefV3) {
  const v = brief.avgVisualPlanning
  if (v?.version!==4 || !avgVisualPlanningExecutionReadyV4() || workspace.mediaBatch || workspace.voiceProduction || workspace.imageProcessing) throw new Error('[avg-visual-plan] 专业视觉方案或实验状态已变化')
  const { sourceInputHash: _hash, aspectRatio: _ratio, ...value } = v.scope
  const frozen = await freezeAvgVisualPlanningScopeV1(value, workspace)
  if (canonicalProductProductionJsonV2(frozen) !== canonicalProductProductionJsonV2(v.scope)) throw new Error('[avg-visual-plan] 规则、对白或图片用途已变化，请重新准备方案')
  for (const { reference } of v.scope.referenceCatalog) await verifyAvgReferenceBytesV1(reference, await readAvgDraftReferenceBytesV1(scope, reference))
}

export async function assertAvgVisualPlanningDraftMatchesV5(scope:WorkspaceScope,workspace:AvgAuthorWorkspaceV1,brief:ProductProductionBriefV3){
  const v=brief.avgVisualPlanning
  if(v?.version!==5||!avgVisualPlanningExecutionReadyV5()||workspace.mediaBatch||workspace.voiceProduction||workspace.imageProcessing)throw new Error('[avg-visual-plan] 新专业视觉方案或实验状态已变化')
  const {sourceInputHash:_hash,aspectRatio:_ratio,...value}=v.scope
  const frozen=await freezeAvgVisualPlanningScopeV2(value,workspace)
  if(canonicalProductProductionJsonV2(frozen)!==canonicalProductProductionJsonV2(v.scope))throw new Error('[avg-visual-plan] 规则、对白或图片用途已变化，请重新准备方案')
  await assertNewReferences(scope,v.scope)
}

/** Resolve pending routes only. Completed requests use their verified original
 * bindings, allowing deterministic adoption/assembly without current secrets. */
export function resolveAvgVisualPlanningExecutionV4(scope: WorkspaceScope, brief: ProductProductionBriefV3, buildId?: number) {
  return resolveVisualExecution(scope,brief,buildId,4)
}

/** Resume only the actual version. Received roles/images retain their proven
 * bindings without requiring a new secret or authorizing another request. */
export function resolveAvgVisualPlanningExecutionV5(scope: WorkspaceScope, brief: ProductProductionBriefV3, buildId?: number) {
  return resolveVisualExecution(scope,brief,buildId,5)
}

async function resolveVisualExecution(scope:WorkspaceScope,brief:ProductProductionBriefV3,buildId:number|undefined,version:4|5){
  const v=brief.avgVisualPlanning
  if(!v||v.version!==version||!(version===5?avgVisualPlanningExecutionReadyV5():avgVisualPlanningExecutionReadyV4()))throw new Error('[avg-visual-plan] 专业视觉制作尚未启用')
  const identity={briefHash:'0'.repeat(64),buildNumber:1+Math.max(0,...(v.proposalReuse??[]).map(r=>r.buildNumber),...(v.rawReuse??[]).map(r=>r.raw.buildNumber)),controlEpoch:0}
  const plan=v.version===5?buildAvgVisualPlanningPlanV5({...identity,brief:{...brief,avgVisualPlanning:v}})
    :buildAvgVisualPlanningPlanV4({...identity,brief:{...brief,avgVisualPlanning:v}})
  const bindings: ProductProductionCapabilityBindingV1[] = []
  const modelTasks = plan.tasks.filter(t => t.executionMode === 'model')
  for (const task of modelTasks) {
    const rows = buildId === undefined ? [] : await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([buildId, task.outputArtifactKeys[0]])
      .filter(r => r.status === 'accepted').toArray()
    if (rows.length !== 1) break
    const row = await verifyAcceptedProductBuildArtifactV1({ scope, buildId: buildId!, artifactKey: rows[0].artifactKey, version: rows[0].version, contentHash: rows[0].contentHash })
    bindings.push((await (version===5?readAvgVisualProposalEvidenceV5(scope,row):readAvgVisualProposalEvidenceV4(scope,row))).binding)
  }
  let textBinding = bindings[0]
  if (bindings.length !== modelTasks.length) {
    const text = await resolveConfiguredTextCapabilityV1({ projectId: scope.projectId, category: 'product-production', requirementKey: AVG_VISUAL_TEXT_CAPABILITY_V4,
      expectedCapabilityHash: brief.capabilityRequirements.find(c => c.requirementKey === AVG_VISUAL_TEXT_CAPABILITY_V4)!.capabilityHash })
    textBinding = { requirementKey: text.receipt.requirementKey, adapterId: text.receipt.adapterId, bindingHash: text.receipt.capabilityHash,
      provider: text.receipt.provider, model: text.receipt.model }
  }
  if (modelTasks.length && (!textBinding || textBinding.bindingHash !== brief.capabilityRequirements.find(c => c.requirementKey === AVG_VISUAL_TEXT_CAPABILITY_V4)!.capabilityHash
    || bindings.some(b => canonicalProductProductionJsonV2(b) !== canonicalProductProductionJsonV2(textBinding)))) throw new Error('[avg-visual-plan] 已接收专业方案与冻结文本路由不一致')
  const providerTemplates=v.scope.templates.filter(t=>!v.rawReuse?.some(r=>r.requirementKey===t.parameters.requirementKey))
  let imagesReceived = providerTemplates.length===0 || buildId !== undefined
  for (const template of providerTemplates) {
    const rows = buildId === undefined ? [] : await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([buildId, `avg.media.raw.${template.parameters.requirementKey}`])
      .filter(r => r.status === 'accepted').toArray()
    if (rows.length !== 1) { imagesReceived = false; break }
    await verifyAcceptedProductBuildArtifactV1({ scope, buildId: buildId!, artifactKey: rows[0].artifactKey, version: rows[0].version, contentHash: rows[0].contentHash })
  }
  const capability = brief.capabilityRequirements.find(c => c.requirementKey === 'avg.media.image')!
  const configured = imagesReceived ? null : await resolveAvgImageExecutionCapabilityV4({ projectId: scope.projectId, requirement: capability,adapterId:v.imageBinding.adapterId })
  if (configured && (configured.binding.bindingHash !== v.imageBinding.bindingHash || configured.endpointRouteHash !== v.imageBinding.endpointRouteHash)) throw new Error('[avg-visual-plan] 图片路由已变化，请重新核对方案')
  return { capabilityBindings: [...(textBinding?[textBinding]:[]), { requirementKey: v.imageBinding.requirementKey, adapterId: v.imageBinding.adapterId, bindingHash: v.imageBinding.bindingHash }],
    mediaCapabilities: new Map(configured ? [['avg.media.image', configured.resolved]] : []), avgImageEndpointRouteHash: configured?.endpointRouteHash }
}

interface VisualProposalSelectionV4 {
  scope: WorkspaceScope; productionId: number; expectedBuildId: number; expectedBuildRevision: number
  artifactKey: string; proposal: { artifactKey: string; version: number; contentHash: string }
}
async function selectedVisualProposal(input: VisualProposalSelectionV4,version:4|5=4) {
  const details = await readProductProductionDetailsV1(input.scope,input.productionId,['avg']), build = details.build, brief = details.executionBrief
  if (!build?.id || brief?.avgVisualPlanning?.version!==version || build.id !== input.expectedBuildId || build.stateRevision !== input.expectedBuildRevision
    || build.status !== 'building' || details.production.status !== 'producing') throw new Error('[avg-visual-plan] 视觉方案选择已过期，请刷新后重新核对')
  const plan = parseProductProductionPlanV3(build.planJson,brief,build.briefHash)
  const task = plan.tasks.find(t => ['avg-author-visual-bible','avg-author-media-brief'].includes(t.kind) && t.outputArtifactKeys.includes(input.artifactKey))
  if (!task || !task.inputArtifactKeys.includes(input.proposal.artifactKey)) throw new Error('[avg-visual-plan] 方案不属于准确专业作者输入')
  const row = await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:build.id,...input.proposal})
  await (version===5?readAvgVisualProposalEvidenceV5:readAvgVisualProposalEvidenceV4)(input.scope,row)
  return { details,build,task }
}
export async function stageAvgVisualPlanningAuthorInputV4(input: VisualProposalSelectionV4 & { payload: unknown; declaration: string }) {
  return stageVisualAuthorInput(input,4)
}
export function stageAvgVisualPlanningAuthorInputV5(input:Parameters<typeof stageAvgVisualPlanningAuthorInputV4>[0]){
  return stageVisualAuthorInput(input,5)
}
async function stageVisualAuthorInput(input:Parameters<typeof stageAvgVisualPlanningAuthorInputV4>[0],version:4|5){
  const {build,task}=await selectedVisualProposal(input,version)
  return stageAvgAuthorArtifactV1({scope:input.scope,buildId:build.id!,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,
    taskKey:task.taskKey,artifactKey:input.artifactKey,kind:'narrative',payload:input.payload,declaration:input.declaration})
}

/** Explicit batch refusal: record the exact proposal and author's reason in
 * the existing pause receipt, then stop while retaining the Build. No retry. */
export async function refuseAvgVisualPlanningBatchV4(input: VisualProposalSelectionV4 & { reason: string }) {
  return refuseVisualBatch(input,4)
}
export function refuseAvgVisualPlanningBatchV5(input:Parameters<typeof refuseAvgVisualPlanningBatchV4>[0]){
  return refuseVisualBatch(input,5)
}
async function refuseVisualBatch(input:Parameters<typeof refuseAvgVisualPlanningBatchV4>[0],version:4|5){
  const reason=avgText(input.reason,'退回依据',2000),{details}=await selectedVisualProposal(input,version)
  const receipt=await executeProductProductionCommand({scope:input.scope,productionId:input.productionId,command:{type:'pause',
    commandId:`avg.visual.refuse.${crypto.randomUUID()}`,expectedStateRevision:details.production.stateRevision,
    reason:canonicalProductProductionJsonV2({decision:'author-refused-visual-batch',proposal:input.proposal,reason})}})
  if(!receipt.ok)throw new Error(String(receipt.result.message??receipt.errorCode))
  const paused=await readProductProductionDetailsV1(input.scope,input.productionId,['avg'])
  await stopProductProductionV1({scope:input.scope,production:paused.production})
}
