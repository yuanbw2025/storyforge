import type { ProductBuildArtifactRecordV1,ProductProductionBriefV3,WorkspaceScope } from '../types'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { verifyHistoricalAvgImageRevalidationProducerV1 } from '../product-production/artifact-store'
import { ProductProductionDraftRejectedErrorV1,type ProductProductionTaskExecutionInputV1,type ProductProductionTaskExecutionResultV1 } from '../product-production/scheduler'
import { readAvgCompiledImageDefinitionV5 } from './visual-planning-image-definition-v5'
import { readAvgVisualPlanningExecutionSourcesV5 } from './visual-planning-task-source-v5'
import { inspectAvgVisualRawReuseCompatibilityV5 } from './visual-image-reuse'
import { avgHash,avgRecord } from './protocol-validation'
import type { AvgVisualProductionRequirementV2 } from './media-production-contract-v2'

type Current=Awaited<ReturnType<typeof readAvgCompiledImageDefinitionV5>>
export type AvgVisualRawReuseCompiledV5=Pick<Current,'planning'|'build'|'brief'|'production'|'plan'|'definition'>&{
  source:{artifact:Current['source']['artifact'];scripts:Array<{artifact:Current['source']['scripts'][number]['artifact']}>}
}
type Raw=Pick<ProductBuildArtifactRecordV1,'artifactKey'|'requirementKey'|'kind'|'mediaKind'|'payloadJson'|'metadataJson'|'rightsJson'|'qualityJson'|'contentHash'|'blobObjectId'|'mimeType'|'byteSize'>
const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)

async function origin(scope:WorkspaceScope,compiled:AvgVisualRawReuseCompiledV5,requirement:AvgVisualProductionRequirementV2){
  const source=compiled.planning.rawReuse?.find(row=>row.requirementKey===requirement.requirementKey)
  const task=compiled.plan.tasks.find(row=>row.outputArtifactKeys.includes(`avg.media.raw.${requirement.requirementKey}`))
  if(!source||!task||task.kind!=='avg-media-image-reuse'||task.executionMode!=='deterministic'||task.contextProfile!=='avg-visual-planning-v5'
    ||task.skillId!==null||task.capabilityRequirementKeys.length||task.maxAttempts!==1||task.reuse!==null
    ||task.budgetReservation.modelCalls!==0||task.budgetReservation.mediaCalls!==0||task.budgetReservation.maximumCostUsd!==0
    ||!task.inputArtifactKeys.includes(compiled.definition.compilation.artifactKey))throw new Error('[avg-visual-raw-reuse] V5 Plan 缺少准确单次零请求原图任务')
  const history=await inspectAvgVisualRawReuseCompatibilityV5({scope,source,productionKey:compiled.production.productionKey,
    buildNumber:compiled.build.buildNumber,sourceWorldContentHash:compiled.brief.source.worldContentHash,requirement})
  return {source,task,history,requirement}
}

async function quality(compiled:AvgVisualRawReuseCompiledV5,checked:Awaited<ReturnType<typeof origin>>,sourceContextHash:string){
  return {schema:'storyforge.avg.visual-raw-image-revalidation',version:2,noProviderRequest:true,contentHashVerified:true,decoderVerified:false,
    original:checked.source,currentRequirementHash:checked.history.currentRequirementHash,
    sourceRule:compiled.source.artifact,sourceScripts:compiled.source.scripts.map(s=>s.artifact),
    sourceCompilation:compiled.definition.compilation,sourceContextHash}
}

/** Re-prove the original V5/raw2 request, then verify the current Build's own
 * local zero-call receipt. The old raw request, bytes, rights and fee remain
 * byte-for-byte intact; a new author review and choice are still required. */
export async function inspectAvgRevalidatedRawImageV5(input:{scope:WorkspaceScope;compiled:AvgVisualRawReuseCompiledV5;artifact:Raw}){
  const a=input.artifact,requirement=input.compiled.definition.mediaBatch.requirements.find(r=>a.artifactKey===`avg.media.raw.${r.requirementKey}`)
  if(!requirement)throw new Error('[avg-visual-raw-reuse] V5 本地原图不属于当前编译需求')
  const checked=await origin(input.scope,input.compiled,requirement)
  const q=avgRecord(JSON.parse(a.qualityJson),['schema','version','noProviderRequest','contentHashVerified','decoderVerified','original',
    'currentRequirementHash','sourceRule','sourceScripts','sourceCompilation','sourceContextHash'],'V5 raw revalidation')
  const sourceContextHash=avgHash(q.sourceContextHash,'V5 revalidation context hash')
  if(!same(q,await quality(input.compiled,checked,sourceContextHash))||a.requirementKey!==null||a.kind!=='image'
    ||a.mediaKind!==checked.history.raw.mediaKind||a.payloadJson!==checked.history.raw.payloadJson||a.metadataJson!==checked.history.raw.metadataJson
    ||a.rightsJson!==checked.history.raw.rightsJson||a.contentHash!==checked.history.raw.contentHash||a.blobObjectId!==checked.history.raw.blobObjectId
    ||a.mimeType!==checked.history.raw.mimeType||a.byteSize!==checked.history.raw.byteSize)throw new Error('[avg-visual-raw-reuse] V5 复验不能替换原图、请求、费用、权利或当前编译来源')
  return {payload:checked.history.payload,asset:checked.history.asset,requirement,source:checked.source,sourceContextHash}
}

export async function readAvgVisualRawReuseEvidenceV5(input:{scope:WorkspaceScope;compiled:AvgVisualRawReuseCompiledV5;artifact:{artifactKey:string;version:number;contentHash:string}}){
  const boundary={scope:input.scope,buildId:input.compiled.build.id!,expectedBuildRevision:input.compiled.build.stateRevision,
    expectedBriefHash:input.compiled.build.briefHash,expectedPlanHash:input.compiled.build.planHash,sourceControlEpoch:input.compiled.plan.controlEpoch}
  const proof=await verifyHistoricalAvgImageRevalidationProducerV1({...boundary,...input.artifact})
  const checked=await inspectAvgRevalidatedRawImageV5({scope:input.scope,compiled:input.compiled,artifact:proof.artifact})
  return {raw:proof.artifact,provenance:proof.provenance,original:checked.source,requirement:checked.requirement,asset:checked.asset,payload:checked.payload}
}

/** V5 raw2 lineage plus the current Build's actual zero-call producer. */
export async function executeAvgVisualRawReuseTaskV5(input:ProductProductionTaskExecutionInputV1,brief:ProductProductionBriefV3):Promise<ProductProductionTaskExecutionResultV1>{
  const started=Date.now(),usage=(storageBytes=0)=>({modelCalls:0,inputTokens:0,outputTokens:0,mediaCalls:0,costUsd:0,durationMs:Date.now()-started,storageBytes})
  try{
    if(input.signal.aborted||input.capabilityBindings.length||input.attempt!==1||input.authorDraftJson)throw new Error('[avg-visual-raw-reuse] V5 准确零调用领取已失效')
    const claim=await readAvgVisualPlanningExecutionSourcesV5(input,brief)
    const compiled=await readAvgCompiledImageDefinitionV5({scope:input.scope,buildId:input.buildId,expectedBuildRevision:claim.build.stateRevision,
      controlEpoch:input.controlEpoch,expectedBrief:brief})
    const requirement=compiled.definition.mediaBatch.requirements.find(r=>input.task.taskKey===`avg.media.generate.${r.requirementKey}`)
    if(!requirement)throw new Error('[avg-visual-raw-reuse] V5 当前任务不属于准确原图需求')
    const checked=await origin(input.scope,compiled,requirement),sameTask=same(checked.task,input.task)
    if(!sameTask||claim.packet.operation!=='revalidate-original-compiled-image'||!same(claim.packet.rawReuseSource,checked.source))throw new Error('[avg-visual-raw-reuse] 登记上下文不是准确 V5 原图复验')
    const old=checked.history.raw,sourceContextHash=await hashProductProductionValueV2(input.contextText)
    const artifact={artifactKey:input.task.outputArtifactKeys[0],requirementKey:null,kind:'image' as const,mediaKind:old.mediaKind,
      payload:JSON.parse(old.payloadJson),metadata:JSON.parse(old.metadataJson),rights:JSON.parse(old.rightsJson),
      quality:await quality(compiled,checked,sourceContextHash),contentHash:old.contentHash,blobObjectId:old.blobObjectId,
      mimeType:old.mimeType,byteSize:old.byteSize}
    await readAvgVisualPlanningExecutionSourcesV5(input,brief)
    await inspectAvgVisualRawReuseCompatibilityV5({scope:input.scope,source:checked.source,productionKey:compiled.production.productionKey,
      buildNumber:compiled.build.buildNumber,sourceWorldContentHash:compiled.brief.source.worldContentHash,requirement})
    if(input.signal.aborted)throw new Error('[avg-visual-raw-reuse] V5 本地复验已停止')
    return {artifacts:[artifact],passedGateIds:[...input.task.acceptanceGateIds],usage:usage(new TextEncoder().encode(canonicalProductProductionJsonV2(artifact)).byteLength)}
  }catch(error){throw new ProductProductionDraftRejectedErrorV1(error instanceof Error?error.message:'V5 原图复验失败',usage())}
}
