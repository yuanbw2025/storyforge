import type { ProductBuildArtifactRecordV1,ProductProductionBriefV3,WorkspaceScope } from '../types'
import { ProductProductionDraftRejectedErrorV1,type ProductProductionTaskExecutionInputV1,type ProductProductionTaskExecutionResultV1 } from '../product-production/scheduler'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { readAvgCompiledImageDefinitionV4 } from './visual-planning-image-definition'
import { readAvgVisualPlanningExecutionSourcesV4 } from './visual-planning-task-source'
import { inspectAvgVisualRawReuseCompatibilityV4 } from './visual-image-reuse'
import { avgHash,avgRecord } from './protocol-validation'
import { assertAvgRawImageArtifactFromDefinitionV1,type AvgRawImagePayloadV1 } from './media-raw-contract'
import type { FrozenRuntimeMediaAssetV2 } from '../types'
import type { AvgVisualProductionRequirementV1 } from './media-production-contract'

type Definition=Awaited<ReturnType<typeof readAvgCompiledImageDefinitionV4>>
export type AvgVerifiedCompiledImageDefinitionV4=Pick<Definition,'definition'|'planning'|'plan'|'production'|'build'|'brief'>&{source:{
  artifact:Definition['source']['artifact'];scripts:Array<{artifact:Definition['source']['scripts'][number]['artifact']}>}}
type Compiled=AvgVerifiedCompiledImageDefinitionV4
type Raw=Pick<ProductBuildArtifactRecordV1,'artifactKey'|'requirementKey'|'kind'|'mediaKind'|'payloadJson'|'metadataJson'|'rightsJson'|'qualityJson'|'contentHash'|'blobObjectId'|'mimeType'|'byteSize'>
const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)

/** Payload/semantic check against a caller-proved current or historical
 * compilation. Physical producer evidence remains the caller's duty. */
export async function inspectAvgCompiledRawImageV4(input:{scope:WorkspaceScope;compiled:Compiled;artifact:Raw}):Promise<{
  payload:AvgRawImagePayloadV1;asset:FrozenRuntimeMediaAssetV2;requirement:AvgVisualProductionRequirementV1
}>{
  if(input.compiled.planning.rawReuse?.some(s=>input.artifact.artifactKey===`avg.media.raw.${s.requirementKey}`)){
    const raw=await inspectAvgRevalidatedRawV4(input);return {payload:raw.payload,asset:raw.asset,requirement:raw.requirement}
  }
  const raw=await assertAvgRawImageArtifactFromDefinitionV1({...input.compiled.definition,
    capability:input.compiled.brief.capabilityRequirements.find(c=>c.requirementKey==='avg.media.image')!,qualityProfile:input.compiled.brief.qualityProfile},input.artifact)
  const q=JSON.parse(input.artifact.qualityJson)
  if(!same(q.sourceCompilation,input.compiled.definition.compilation)||!same(q.sourceRule,input.compiled.source.artifact)
    ||!same(q.sourceScripts,input.compiled.source.scripts.map(s=>s.artifact)))throw new Error('[avg-visual-image] 原图没有绑定准确的已采用编译来源')
  return {...raw,requirement:raw.payload.requirement}
}

async function original(scope:WorkspaceScope,compiled:Compiled,artifactKey:string){
  const requirement=compiled.definition.mediaBatch.requirements.find(r=>artifactKey===`avg.media.raw.${r.requirementKey}`)
  const source=compiled.planning.rawReuse?.find(r=>r.requirementKey===requirement?.requirementKey)
  const task=compiled.plan.tasks.find(t=>t.outputArtifactKeys.includes(artifactKey))
  if(!source||!requirement||!task||task.kind!=='avg-media-image-reuse'||task.executionMode!=='deterministic'
    ||task.contextProfile!=='avg-visual-planning-v4'||task.skillId!==null||task.capabilityRequirementKeys.length
    ||task.maxAttempts!==1||task.budgetReservation.modelCalls!==0||task.budgetReservation.mediaCalls!==0||task.budgetReservation.maximumCostUsd!==0)throw new Error('[avg-visual-raw-reuse] 缺少准确冻结的单次零调用原图任务')
  const history=await inspectAvgVisualRawReuseCompatibilityV4({scope,source,productionKey:compiled.production.productionKey,
    buildNumber:compiled.build.buildNumber,sourceWorldContentHash:compiled.brief.source.worldContentHash,requirement})
  return {history,source,requirement,task}
}

async function quality(compiled:Compiled,origin:Awaited<ReturnType<typeof original>>,sourceContextHash:string){
  return {schema:'storyforge.avg.visual-raw-image-revalidation',version:1,noProviderRequest:true,contentHashVerified:true,decoderVerified:false,
    original:origin.source,currentRequirementHash:origin.history.currentRequirementHash,
    sourceRule:compiled.source.artifact,sourceScripts:compiled.source.scripts.map(s=>s.artifact),
    sourceCompilation:compiled.definition.compilation,sourceContextHash}
}

/** Product semantics only. Shared admission separately verifies the actual
 * zero-call Run/checkpoint/ledger and physical bytes. No old author choice or
 * synthetic request against the current image model is accepted here. */
export async function inspectAvgRevalidatedRawV4(input:{scope:WorkspaceScope;compiled:Compiled;artifact:Raw}){
  const origin=await original(input.scope,input.compiled,input.artifact.artifactKey),a=input.artifact,old=origin.history.raw
  const q=avgRecord(JSON.parse(a.qualityJson),['schema','version','noProviderRequest','contentHashVerified','decoderVerified','original',
    'currentRequirementHash','sourceRule','sourceScripts','sourceCompilation','sourceContextHash'],'V4 raw revalidation')
  if(!same(q,await quality(input.compiled,origin,avgHash(q.sourceContextHash,'revalidation context hash')))
    ||a.requirementKey!==null||a.kind!=='image'||a.mediaKind!==old.mediaKind||a.payloadJson!==old.payloadJson
    ||a.metadataJson!==old.metadataJson||a.rightsJson!==old.rightsJson||a.contentHash!==old.contentHash
    ||a.blobObjectId!==old.blobObjectId||a.mimeType!==old.mimeType||a.byteSize!==old.byteSize)throw new Error('[avg-visual-raw-reuse] 复验不能替换原图、请求、费用、权利或当前编译来源')
  return {...origin,payload:origin.history.payload,asset:origin.history.asset,sourceContextHash:q.sourceContextHash as string}
}

export async function executeAvgVisualRawReuseTaskV4(input:ProductProductionTaskExecutionInputV1,brief:ProductProductionBriefV3):Promise<ProductProductionTaskExecutionResultV1>{
  const started=Date.now(),usage=(storageBytes=0)=>({modelCalls:0,inputTokens:0,outputTokens:0,mediaCalls:0,costUsd:0,durationMs:Date.now()-started,storageBytes})
  try{
    if(input.signal.aborted||input.capabilityBindings.length||input.attempt!==1||input.authorDraftJson)throw new Error('[avg-visual-raw-reuse] 准确零调用领取已失效')
    const claim=await readAvgVisualPlanningExecutionSourcesV4(input,brief)
    const compiled=await readAvgCompiledImageDefinitionV4({scope:input.scope,buildId:input.buildId,
      expectedBuildRevision:claim.build.stateRevision,controlEpoch:input.controlEpoch,expectedBrief:brief})
    const origin=await original(input.scope,compiled,input.task.outputArtifactKeys[0])
    if(!same(origin.task,input.task)||claim.packet.operation!=='revalidate-original-compiled-image'
      ||!same(claim.packet.rawReuseSource,origin.source))throw new Error('[avg-visual-raw-reuse] 实际登记上下文不是准确原图复验')
    const row=origin.history.raw
    const artifact={artifactKey:row.artifactKey,requirementKey:null,kind:'image' as const,mediaKind:row.mediaKind,
      payload:JSON.parse(row.payloadJson),metadata:JSON.parse(row.metadataJson),rights:JSON.parse(row.rightsJson),
      quality:await quality(compiled,origin,await hashProductProductionValueV2(input.contextText)),contentHash:row.contentHash,
      blobObjectId:row.blobObjectId,mimeType:row.mimeType,byteSize:row.byteSize}
    await readAvgVisualPlanningExecutionSourcesV4(input,brief)
    if(input.signal.aborted)throw new Error('[avg-visual-raw-reuse] 原图复验已停止')
    return {artifacts:[artifact],passedGateIds:[...input.task.acceptanceGateIds],usage:usage(new TextEncoder().encode(canonicalProductProductionJsonV2(artifact)).byteLength)}
  }catch(error){throw new ProductProductionDraftRejectedErrorV1(error instanceof Error?error.message:'原图复验失败',usage())}
}
