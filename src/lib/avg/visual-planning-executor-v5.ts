import type { ProductProductionBriefV3 } from '../types'
import type { ProductionTextRunnerV1 } from '../product-production/production-executor'
import { ProductProductionDraftRejectedErrorV1,type ProductProductionTaskExecutionInputV1,type ProductProductionTaskExecutorV1,type ProductProductionTaskUsageV1 } from '../product-production/scheduler'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { readAgentRunV1 } from '../agent/run/event-store'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { estimateTokens } from '../ai/context-budget'
import { avgVisualPlanningExecutionReadyV5 } from './visual-planning-brief-v5'
import { AVG_VISUAL_PLANNING_ROLES_V5,avgVisualPlanningMethodV5 } from './visual-planning-roles-v5'
import { AVG_VISUAL_TEXT_CAPABILITY_V4 } from './visual-planning-roles'
import { readAvgVisualPlanningExecutionSourcesV5 } from './visual-planning-task-source-v5'
import { avgVisualRoleTargetV5,prepareAvgVisualRoleProposalV5,isAvgVisualReuseTaskV5 } from './visual-role-proposal-v5'
import { readAvgVisualReuseHistoryV5,assertAvgVisualReuseSemanticInputV5 } from './visual-planning-reuse-v5'
import { validateAvgVisualSemanticV4 } from './visual-role-proposal'
import { parseProductionModelJsonObjectV1 } from '../product-production/model-json-object'
import { hashAvgVisualExactTextV1 } from './visual-planning-evidence'
import { compileAvgVisualPlanningProposalV2 } from './media-source-v2'
import { AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4 } from './visual-planning-plan'
import type { ResolvedProductMediaCapabilityV1 } from '../product-production/media-transport'

/** Same registered runner and durable Harness; explicit new request/evidence
 * grammar. The global start gate remains closed until image consumers join. */
export function createAvgVisualPlanningExecutorV5(options:{brief:ProductProductionBriefV3;runText:ProductionTextRunnerV1;
  mediaCapabilities?:ReadonlyMap<string,ResolvedProductMediaCapabilityV1>;imageEndpointRouteHash?:string}):ProductProductionTaskExecutorV1{
  const brief=structuredClone(options.brief)
  if(brief.avgVisualPlanning?.version!==5||!avgVisualPlanningExecutionReadyV5())throw new Error('[avg-visual-plan] 新专业执行尚未开放')
  return async input=>{
    const started=Date.now(),zero=():ProductProductionTaskUsageV1=>({modelCalls:0,inputTokens:0,outputTokens:0,mediaCalls:0,costUsd:0,durationMs:Date.now()-started,storageBytes:0})
    let source:Awaited<ReturnType<typeof readAvgVisualPlanningExecutionSourcesV5>>
    try{
      if(!avgVisualPlanningExecutionReadyV5())throw new Error('[avg-visual-plan] 新专业执行尚未开放')
      if(input.signal.aborted)throw new DOMException('Aborted','AbortError')
      if(input.task.kind==='avg-media-image-reuse'){
        const {executeAvgVisualRawReuseTaskV5}=await import('./visual-image-revalidation-v5')
        return executeAvgVisualRawReuseTaskV5(input,brief)
      }
      if(input.task.kind==='avg-media-image-process'){
        const {executeAvgVisualImageProcessingTaskV5}=await import('./visual-image-processing-v5')
        return executeAvgVisualImageProcessingTaskV5(input,brief)
      }
      if(input.task.kind==='avg-media-image-generate'){
        const {executeAvgMediaImageTaskV2}=await import('./media-production-executor')
        return executeAvgMediaImageTaskV2(input,{brief,mediaCapabilities:options.mediaCapabilities??new Map(),imageEndpointRouteHash:options.imageEndpointRouteHash})
      }
      if(['avg-assembly-integrate','avg-assembly-verify'].includes(input.task.kind)){
        const {db}=await import('../db/schema'),{createAvgAssemblyExecutorV1}=await import('./assembly-executor')
        const build=await db.productBuilds.get(input.buildId),production=build?await db.productProductions.get(build.productionId):null
        if(!production||build!.productionId!==input.productionId)throw new Error('[avg-visual-plan] 组装制作归属已变化')
        return createAvgAssemblyExecutorV1({brief,production})(input)
      }
      if(input.task.executionMode!=='model'&&input.task.kind!=='avg-v5-visual-requirements-compile'&&!isAvgVisualReuseTaskV5(input.task))throw new Error('[avg-visual-plan] 新图片消费执行尚未接通，未发送请求')
      source=await readAvgVisualPlanningExecutionSourcesV5(input,brief)
    }catch(error){throw new ProductProductionDraftRejectedErrorV1(error instanceof Error?error.message:'新专业视觉来源无效',zero())}
    if(input.task.kind==='avg-v5-visual-requirements-compile')return compileTask(input,source,started)
    if(isAvgVisualReuseTaskV5(input.task)){
      try{return await reuseTaskV5(input,source,brief,started)}catch(error){throw new ProductProductionDraftRejectedErrorV1(error instanceof Error?error.message:'V5 历史方案不闭合',zero())}
    }
    const role = AVG_VISUAL_PLANNING_ROLES_V5.find(r => r.skillId === input.task.skillId)!
    const binding = input.capabilityBindings[0], targetArtifactKey = avgVisualRoleTargetV5(input.task, source.planning.scope)
    const system = avgVisualPlanningMethodV5(role.subjectKind), skill = getAgentSkillV1(input.task.skillId!)
    const inputTokens = estimateTokens(system + input.contextText)
    let inputBytes = 0
    try {
      if (!binding || input.capabilityBindings.length !== 1 || binding.requirementKey !== AVG_VISUAL_TEXT_CAPABILITY_V4
        || input.task.capabilityRequirementKeys.length !== 1 || input.task.capabilityRequirementKeys[0] !== binding.requirementKey
        || input.task.budgetReservation.modelCalls !== 1 || input.task.budgetReservation.mediaCalls !== 0 || input.attempt !== 1 || input.task.maxAttempts !== 1
        || input.authorDraftJson || !input.onModelOutput || inputTokens > input.task.budgetReservation.inputTokens
        || input.task.budgetReservation.maximumCostUsd !== null) throw new Error('[avg-visual-plan] 缺少准确单次文本路由、预算或解析前回执；费用不可核实时不能使用现金硬上限')
      const current = await readAgentRunV1(input.scope, input.taskRunId!)
      const snapshot = canonicalProductProductionJsonV2({ schema: 'storyforge.avg.visual-model-input', version: 2,
        taskKey: input.task.taskKey, targetArtifactKey, scopeHash: await hashProductProductionValueV2(source.planning.scope),
        sourceInputHash: source.planning.scope.sourceInputHash, systemPrompt: system, contextText: input.contextText,
        category: 'product-production', maximumOutputTokens: input.task.budgetReservation.outputTokens, binding, promptVersion: skill.promptVersion })
      inputBytes = new TextEncoder().encode(snapshot).byteLength
      await recordAgentRunArtifactV1({ scope: input.scope, runId: input.taskRunId!, stepId: input.task.taskKey, attempt: 1,
        artifactKind: 'source-snapshot', content: snapshot, expectedLastSequence: current.projection.lastSequence })
      // A source/command change during snapshot persistence must stop before
      // the single external request, while retaining the actual input proof.
      await readAvgVisualPlanningExecutionSourcesV5(input, brief)
    } catch (error) { throw new ProductProductionDraftRejectedErrorV1(error instanceof Error ? error.message : '专业视觉请求无效', zero()) }
    // Transport failures retain the established scheduler's authorization,
    // nonretryable-4xx and result-unknown classification. No local retry.
    const response = await options.runText({ projectId: input.scope.projectId, requirementKey: binding.requirementKey,
      category: 'product-production', expectedCapabilityHash: binding.bindingHash, system, contextText: input.contextText,
      maximumOutputTokens: input.task.budgetReservation.outputTokens, signal: input.signal })
    const usage: ProductProductionTaskUsageV1 = { modelCalls: 1, inputTokens: response.usage?.inputTokens ?? inputTokens,
      outputTokens: response.usage?.outputTokens ?? estimateTokens(response.output), mediaCalls: 0, costUsd: null,
      durationMs: Date.now() - started, storageBytes: inputBytes + new TextEncoder().encode(response.output).byteLength }
    try {
      if (await input.onModelOutput!(response.output) === 'discarded-stale') throw new Error('[avg-visual-plan] 已收到的方案在返回时过期，不能写入或重发')
      if (response.bindingReceipt.capabilityHash !== binding.bindingHash) throw new Error('[avg-visual-plan] 实际文本响应路由与冻结绑定不一致')
      // Retain the actual response first, then settle a mid-request source or
      // consent change with its known usage before any producer is admitted.
      await readAvgVisualPlanningExecutionSourcesV5(input,brief)
      const proposal = await prepareAvgVisualRoleProposalV5(response.output, input.task, source.planning.scope)
      const run = await readAgentRunV1(input.scope, input.taskRunId!)
      const events = run.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'source-snapshot'
        && e.payload.stepId === input.task.taskKey && e.payload.attempt === 1)
      if (events.length !== 1 || events[0].type !== 'evidence.artifact.recorded') throw new Error('[avg-visual-plan] 本次调用的实际输入快照不唯一')
      const artifact = { artifactKey: input.task.outputArtifactKeys[0], kind: 'narrative' as const, payload: proposal, metadata: {},
        quality: { schema: 'storyforge.avg.visual-proposal-evidence', version: 2, requestSnapshotHash: events[0].payload.contentHash,
          rawResponseHash: await hashAvgVisualExactTextV1(response.output), scopeHash: proposal.scopeHash, capabilityBindingHash: binding.bindingHash },
        rights: { origin: 'model-proposal', commercialUse: null } }
      usage.storageBytes += new TextEncoder().encode(canonicalProductProductionJsonV2(artifact)).byteLength
      usage.durationMs = Date.now() - started
      return { artifacts: [artifact], passedGateIds: [...input.task.acceptanceGateIds], usage }
    } catch (error) { throw new ProductProductionDraftRejectedErrorV1(error instanceof Error ? error.message : '模型方案无效', usage) }
  }
}

async function reuseTaskV5(input:ProductProductionTaskExecutionInputV1,source:Awaited<ReturnType<typeof readAvgVisualPlanningExecutionSourcesV5>>,
  brief:ProductProductionBriefV3,started:number){
  const targetArtifactKey=avgVisualRoleTargetV5(input.task,source.planning.scope),selected=source.planning.proposalReuse?.find(r=>r.artifact.artifactKey===targetArtifactKey)
  if(!selected||input.capabilityBindings.length||input.attempt!==1||input.authorDraftJson)throw new Error('[avg-visual-reuse] V5 本次零调用领取或冻结选择不准确')
  const history=await readAvgVisualReuseHistoryV5({scope:input.scope,build:source.build,brief,task:input.task,source:selected})
  assertAvgVisualReuseSemanticInputV5(input.contextText,history,selected)
  const scopeHash=await hashProductProductionValueV2(source.planning.scope),snapshot=canonicalProductProductionJsonV2({schema:'storyforge.avg.visual-reuse-input',version:2,
    taskKey:input.task.taskKey,targetArtifactKey,scopeHash,sourceInputHash:source.planning.scope.sourceInputHash,contextText:input.contextText,source:selected,
    originalRequestHash:await hashAvgVisualExactTextV1(history.original.modelRequestText),rawResponseHash:selected.rawResponseHash})
  const current=await readAgentRunV1(input.scope,input.taskRunId!)
  await recordAgentRunArtifactV1({scope:input.scope,runId:input.taskRunId!,stepId:input.task.taskKey,attempt:1,artifactKind:'source-snapshot',content:snapshot,
    expectedLastSequence:current.projection.lastSequence})
  await readAvgVisualPlanningExecutionSourcesV5(input,brief)
  await readAvgVisualReuseHistoryV5({scope:input.scope,build:source.build,brief,task:input.task,source:selected})
  const payload={schema:'storyforge.avg.visual-role-proposal',version:4,targetArtifactKey,scopeHash,payload:history.payload,
    modelPayload:validateAvgVisualSemanticV4(parseProductionModelJsonObjectV1(history.original.rawText,input.task.taskKey),source.planning.scope,targetArtifactKey)}
  const artifact={artifactKey:input.task.outputArtifactKeys[0],kind:'narrative' as const,payload,metadata:{},
    quality:{schema:'storyforge.avg.visual-proposal-reuse-evidence',version:2,requestSnapshotHash:await hashAvgVisualExactTextV1(snapshot),
      rawResponseHash:selected.rawResponseHash,scopeHash,capabilityBindingHash:history.original.binding.bindingHash,source:selected},
    rights:{origin:'history-reuse',commercialUse:null}}
  return {artifacts:[artifact],passedGateIds:[...input.task.acceptanceGateIds],usage:{modelCalls:0,inputTokens:0,outputTokens:0,mediaCalls:0,costUsd:0,
    durationMs:Date.now()-started,storageBytes:new TextEncoder().encode(snapshot+canonicalProductProductionJsonV2(artifact)).byteLength}}
}

async function compileTask(input: ProductProductionTaskExecutionInputV1, source: Awaited<ReturnType<typeof readAvgVisualPlanningExecutionSourcesV5>>, started: number) {
  const visualBible = source.visual.find(p => p.schema === 'storyforge.avg.visual-bible')
  const mediaBriefs = source.visual.filter(p => p.schema === 'storyforge.avg.media-brief')
  const payload = await compileAvgVisualPlanningProposalV2({ scope: source.planning.scope, source: source.source, visualBible, mediaBriefs })
  const artifact = { artifactKey: AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4, kind: 'asset-manifest' as const, payload, metadata: {},
    quality: { schema: 'storyforge.avg.visual-compilation-evidence', version: 2, scopeHash: await hashProductProductionValueV2(source.planning.scope), inputs: source.refs },
    rights: { origin: 'deterministic-visual-compilation' } }
  return { artifacts: [artifact], passedGateIds: [...input.task.acceptanceGateIds], usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0,
    mediaCalls: 0, costUsd: 0, durationMs: Date.now() - started, storageBytes: new TextEncoder().encode(canonicalProductProductionJsonV2(artifact)).byteLength } }
}
