import { vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { avgV5FormalFixture } from './avg-v5-formal-fixture'
import { deterministicRegionMapPngV1,createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import { importAvgMediaV1 } from '../../src/lib/avg/editor-service'
import { freezeAvgVisualPlanningScopeV2 } from '../../src/lib/avg/media-source-v2'
import { avgVisualPlanningBudgetV5,avgVisualPlanningGateIdsV5 } from '../../src/lib/avg/visual-planning-policy-v5'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { resolveConfiguredTextCapabilityV1 } from '../../src/lib/product-production/capabilities'
import { resolveAvgImageExecutionCapabilityV4 } from '../../src/lib/avg/media-capability'
import { avgImageReferenceCapabilityV2,type AvgImageAdapterIdV4 } from '../../src/lib/avg/media-reference-contract'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { stageAvgAuthorArtifactV1 } from '../../src/lib/avg/author-artifacts'
import type { AvgImageProcessingPlanV1 } from '../../src/lib/avg/image-processing-contract'
import type { ProductBuildArtifactRecordV1 } from '../../src/lib/types'

/** All domain rows come from public author/production/Harness commands. The
 * caller opens only the closed feature fence in isolated fake-indexeddb data;
 * original model bytes travel through the real configured runner and HTTP. */
export async function avgV5RegisteredProposalsFixture(options:{malformed?:boolean;missingGeneratedProof?:boolean;onResponse?:()=>Promise<void>;
  imageResponse?:(body:Record<string,unknown>,index:number)=>Promise<Response>;imageAdapterId?:AvgImageAdapterIdV4;imageProcessing?:AvgImageProcessingPlanV1;progress?:(phase:string)=>void}={}){
  options.progress?.('owner:begin')
  const {owner,author,brief}=await avgV5FormalFixture(),calls:Array<{body:any;packet:any}>=[],imageCalls:Array<Record<string,unknown>>=[]
  options.progress?.('owner:ready')
  if(options.imageResponse)for(const b of author.mediaBriefs)for(const output of b.outputs)output.prompt+=` 工程目标 ${output.requirementKey}`
  const data=await deterministicRegionMapPngV1({width:32,height:32,palette:['#253746','#9f8772','#d1cbb8']})
  options.progress?.('reference-png:ready')
  const catalog=[]
  for(const entry of brief.avgVisualPlanning.scope.referenceCatalog){
    const asset=await importAvgMediaV1({scope:owner.scope,data,mimeType:'image/png',kind:'background',name:`原创工程参考 ${entry.referenceKey}`,
      license:'本测试原创色块；只证明字节和授权声明流，不证明人物身份或商用质量',altText:'原创色块',characterTag:''})
    catalog.push({...entry,reference:{...entry.reference,assetKey:asset.assetKey,assetVersion:asset.version,contentHash:asset.contentHash,byteSize:asset.byteSize,license:asset.license}})
  }
  options.progress?.('reference-imports:ready')
  if(options.missingGeneratedProof)catalog[0].reference.generatedSource=absentAvgV5GeneratedProof(catalog[0].reference.contentHash)
  const {sourceInputHash:_hash,aspectRatio:_ratio,...unhashed}=brief.avgVisualPlanning.scope
  brief.avgVisualPlanning.scope=await freezeAvgVisualPlanningScopeV2({...unhashed,referenceCatalog:catalog},author.source)
  options.progress?.('scope:ready')
  const text=await resolveConfiguredTextCapabilityV1({projectId:owner.scope.projectId,category:'product-production',requirementKey:'avg.visual.planning.text'})
  brief.capabilityRequirements.find(c=>c.mediaClass==='text')!.capabilityHash=text.receipt.capabilityHash
  const imageAdapterId=options.imageAdapterId??'agnes.image-2.1-flash.v1',imageRequirement=brief.capabilityRequirements.find(c=>c.mediaClass==='image')!
  imageRequirement.capabilityHash=await hashProductProductionValueV2(avgImageReferenceCapabilityV2(imageAdapterId))
  const image=await resolveAvgImageExecutionCapabilityV4({projectId:owner.scope.projectId,requirement:imageRequirement,adapterId:imageAdapterId})
  brief.avgVisualPlanning.imageBinding={...image.binding,endpointRouteHash:image.endpointRouteHash}
  if(options.imageProcessing)brief.avgVisualPlanning.imageProcessing=structuredClone(options.imageProcessing)
  brief.productionBudget=avgVisualPlanningBudgetV5(brief);brief.completionContract.requiredGateIds=avgVisualPlanningGateIdsV5(brief)
  const parsed=parseProductProductionBriefV3(brief)
  const saved=await executeProductProductionCommand({scope:owner.scope,productionId:owner.productionId,command:{type:'save-brief-revision',commandId:'v5.actual.save',
    expectedStateRevision:owner.details.production.stateRevision,parentRevision:owner.details.brief!.revision,brief:parsed}})
  if(!saved.ok)throw new Error(JSON.stringify(saved))
  const prepared=await readProductProductionDetailsV1(owner.scope,owner.productionId,['avg'])
  const started=await executeProductProductionCommand({scope:owner.scope,productionId:owner.productionId,command:{type:'authorize-start',commandId:'v5.actual.start',
    expectedStateRevision:prepared.production.stateRevision,briefRevision:prepared.brief!.revision,briefHash:prepared.brief!.briefHash,authorizationNonce:'explicit-isolated-engineering-author-start'}})
  if(!started.ok)throw new Error(JSON.stringify(started))
  options.progress?.('actual-start:ready')
  const details=await readProductProductionDetailsV1(owner.scope,owner.productionId,['avg']),buildId=details.build!.id!
  const fetcher=vi.fn(async(target:RequestInfo|URL,init?:RequestInit)=>{
    if(options.imageResponse&&String(target)==='https://v5-proposal.fixture.invalid/v1/images/generations'){
      const body=JSON.parse(String(init?.body));imageCalls.push(body);return options.imageResponse(body,imageCalls.length-1)
    }
    if(String(target)!=='https://v5-proposal.fixture.invalid/v1/chat/completions')throw new Error('Unexpected network route; V5 proposal checks never generate images')
    const body=JSON.parse(String(init?.body)),context=String(body.messages.find((m:{role:string})=>m.role==='user').content)
    const packet=JSON.parse(context.slice(context.indexOf('{'),context.lastIndexOf('}')+1));calls.push({body,packet})
    options.progress?.(`role-http:${calls.length}`)
    const payload=String(body.messages.find((m:{role:string})=>m.role==='system').content).includes('storyforge.avg.visual-bible')?author.visualBible
      :author.mediaBriefs.find(b=>b.subjectKey===packet.subjects[0].subjectKey)!
    await options.onResponse?.()
    return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:options.malformed?'{broken new proposal':JSON.stringify(payload)}}],usage:{prompt_tokens:200,completion_tokens:200}}),{headers:{'content-type':'application/json'}})
  });vi.stubGlobal('fetch',fetcher)
  const executor=createConfiguredProductProductionExecutorV1({production:details.production,brief:parsed,
    ...(options.imageResponse?{mediaCapabilities:new Map([['avg.media.image',image.resolved]]),avgImageEndpointRouteHash:image.endpointRouteHash}:{})})
  const capabilityBindings=[{requirementKey:text.receipt.requirementKey,adapterId:text.receipt.adapterId,bindingHash:text.receipt.capabilityHash,provider:text.receipt.provider,model:text.receipt.model},image.binding]
  const s={...owner,author,brief:parsed,buildId,executor,capabilityBindings,calls,imageCalls,image,fetcher}
  await runProductProductionSchedulerCycleV1(s)
  options.progress?.('initial-cycle:ready')
  const build=(await db.productBuilds.get(buildId))!,plan=parseProductProductionPlanV3(build.planJson,parsed,build.briefHash)
  return {...s,plan}
}
export type AvgV5RegisteredFixture=Awaited<ReturnType<typeof avgV5RegisteredProposalsFixture>>
/** Deliberately unverified metadata for rejection tests; never seeded as a
 * Run, producer, adopted source or positive rights/byte evidence. */
export function absentAvgV5GeneratedProof(contentHash:string){
  return {schema:'storyforge.avg.generated-reference-source' as const,version:1 as const,productionKey:'missing.generated.reference',requirementKey:'missing.reference',
    raw:{schema:'storyforge.avg.retained-raw-image-proof' as const,version:1 as const,buildNumber:1,briefHash:'a'.repeat(64),planHash:'b'.repeat(64),controlEpoch:0,
      taskKey:'avg.media.generate.missing.reference',artifactKey:'avg.media.raw.missing.reference',artifactVersion:1,contentHash,
      inputHash:'c'.repeat(64),producerReceiptHash:'d'.repeat(64),candidateHash:'e'.repeat(64),proofHash:'f'.repeat(64)},
    choice:{artifactKey:'avg.media.choice.missing.reference',version:1,contentHash:'1'.repeat(64),authorReceiptHash:'2'.repeat(64)}}
}
export async function adoptAvgV5Artifact(s:AvgV5RegisteredFixture,key:string,payload:unknown){
  const build=(await db.productBuilds.get(s.buildId))!,task=s.plan.tasks.find(t=>t.executionMode==='human-import'&&t.outputArtifactKeys.includes(key))!
  const candidate=await stageAvgAuthorArtifactV1({scope:s.scope,buildId:s.buildId,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,
    taskKey:task.taskKey,artifactKey:key,kind:key==='avg.system.plan'?'product-module':'narrative',payload,declaration:'作者明确核对本项工程候选及参考用途；不代表图像/艺术或商业验收'})
  return confirmAvgV5PendingCandidate(s,candidate)
}
export async function confirmAvgV5PendingCandidate(s:AvgV5RegisteredFixture,candidate:ProductBuildArtifactRecordV1){
  const current=(await db.productBuilds.get(s.buildId))!,production=(await db.productProductions.get(s.productionId))!
  const result=await executeProductProductionCommand({scope:s.scope,productionId:s.productionId,command:{type:'adopt-avg-artifact',commandId:`v5.author.${crypto.randomUUID()}`,
    expectedStateRevision:production.stateRevision,expectedBuildRevision:current.stateRevision,controlEpoch:current.controlEpoch,buildNumber:current.buildNumber,
    artifactKey:candidate.artifactKey,candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash}})
  if(!result.ok)throw new Error(JSON.stringify(result))
  return candidate
}
export async function adoptAvgV5Sources(s:AvgV5RegisteredFixture){
  await adoptAvgV5Artifact(s,'avg.system.plan',s.author.source.systemPlan)
  for(const script of s.author.source.scripts)await adoptAvgV5Artifact(s,`avg.content.scene-script.${script.sceneKey}`,script)
}
export async function avgV5Accepted(s:AvgV5RegisteredFixture,key:string):Promise<ProductBuildArtifactRecordV1|undefined>{
  return db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,key]).filter(r=>r.status==='accepted').first()
}
export async function cycleAvgV5Until(s:AvgV5RegisteredFixture,key:string){
  for(let i=0;i<12;i++){if(await avgV5Accepted(s,key))return;await runProductProductionSchedulerCycleV1(s)}
  throw new Error(`Actual V5 Harness did not reach ${key}: ${(await db.productBuilds.get(s.buildId))!.failureJson}`)
}

/** Shared actual author-to-compiler graph for downstream media fixtures. */
export async function adoptAvgV5CompiledSources(s:AvgV5RegisteredFixture){
  await adoptAvgV5Sources(s);await cycleAvgV5Until(s,'avg.proposal.visual-bible')
  await adoptAvgV5Artifact(s,'avg.media.visual-bible',s.author.visualBible)
  const targets=s.plan.tasks.filter(t=>t.kind==='avg-v5-subject-visual-proposal').map(t=>t.outputArtifactKeys[0])
  await cycleAvgV5Until(s,targets[targets.length-1])
  for(const key of targets){const p=JSON.parse((await avgV5Accepted(s,key))!.payloadJson);await adoptAvgV5Artifact(s,p.targetArtifactKey,p.payload)}
  await cycleAvgV5Until(s,'avg.media.compiled-visual-requirements')
}
