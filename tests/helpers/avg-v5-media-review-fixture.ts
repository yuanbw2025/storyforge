import { vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import * as readiness from '../../src/lib/avg/visual-planning-brief-v5'
import * as decoder from '../../src/lib/avg/image-decoder'
import { detectProductImageDimensionsV1 } from '../../src/lib/product-production/media-adapters'
import { deterministicRegionMapPngV1 } from '../../src/lib/product-production/production-executor'
import { runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { avgV5RegisteredProposalsFixture,adoptAvgV5CompiledSources,type AvgV5RegisteredFixture } from './avg-v5-registered-proposals-fixture'
import { readAvgImageConsumptionDefinitionV5 } from '../../src/lib/avg/image-consumption-v5'
import { AVG_VISUAL_REVIEW_CRITERIA_V1 } from '../../src/lib/avg/visual-review-contract'
import type { AvgReviewIssuesV2 } from '../../src/lib/avg/visual-review-contract-v2'
import type { AvgImageProcessingPlanV1 } from '../../src/lib/avg/image-processing-contract'
import type { AvgVisualProductionRequirementV2 } from '../../src/lib/avg/media-production-contract-v2'

/** All saved Work/Brief/Run/compiler/raw rows use the actual commands and
 * configured transport. Only unavailable Happy DOM decoder observations are
 * controlled; this is never actual art, alpha-edge or human acceptance. */
export async function avgV5MediaReviewFixture(progress?:(phase:string)=>void,options:{imageProcessing?:AvgImageProcessingPlanV1;
  beforeImages?:(s:AvgV5RegisteredFixture)=>Promise<void>;executor?:(s:AvgV5RegisteredFixture)=>AvgV5RegisteredFixture['executor']}={}){
  vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
  vi.spyOn(decoder,'inspectAvgImageBytesV1').mockImplementation(async input=>{
    const d=detectProductImageDimensionsV1(input.data)
    if(!d)throw new Error('Controlled original PNG has no dimensions')
    return {...d,hasAlpha:input.assetKey.includes('.keeper.')}
  })
  const s:AvgV5RegisteredFixture=await avgV5RegisteredProposalsFixture({progress,imageProcessing:options.imageProcessing,imageResponse:async(body,index)=>{
    const r=s.brief.avgVisualPlanning!.scope.templates.find(t=>String(body.prompt).includes(t.parameters.requirementKey))!.parameters
    progress?.(`image-png:${index}:begin`)
    const bytes=new Uint8Array(await deterministicRegionMapPngV1({width:r.width,height:r.height,palette:['#253746','#9f8772','#d1cbb8']}))
    progress?.(`image-png:${index}:ready`)
    let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384))
    return new Response(JSON.stringify({data:[{b64_json:btoa(binary)}]}),{headers:{'content-type':'application/json','x-request-id':`controlled-v5-review-${index}`}})
  }})
  await adoptAvgV5CompiledSources(s);progress?.('actual-compiler:ready')
  await options.beforeImages?.(s)
  if(options.executor)s.executor=options.executor(s)
  await runProductProductionUntilBlockedV1(s);progress?.('actual-five-images:ready')
  const rows=await db.productBuildArtifacts.where('buildId').equals(s.buildId).filter(r=>r.status==='accepted'&&r.kind==='image'&&r.artifactKey.startsWith('avg.media.raw.')).toArray()
  if(rows.length!==5||s.imageCalls.length!==5)throw new Error('Actual V5 review fixture did not receive its exact five raw producers')
  const compiled=await readAvgImageConsumptionDefinitionV5({scope:s.scope,buildId:s.buildId,brief:s.brief})
  progress?.('actual-image-definition:ready')
  return {...s,rows,compiled}
}

/** Explicit simulated author answers for exercising the command boundary;
 * never a default or automatically generated professional review. */
export async function avgV5ReviewReport(r:AvgVisualProductionRequirementV2,rawHash:string,mode:'pass'|'unknown'|'fail'='unknown'):Promise<AvgReviewIssuesV2>{
  const checks=AVG_VISUAL_REVIEW_CRITERIA_V1.map(criterion=>{
    const applicable=criterion==='identity'?r.references.some(ref=>ref.purpose==='identity')
      :criterion==='continuity'?r.references.length>0:criterion==='alpha-edge'?r.alpha==='required':true
    return {criterion,result:!applicable?'not-applicable' as const:mode==='unknown'?'unknown' as const:'pass' as const,
      note:'仅受控工程观察；不代表真实艺术、身份或商业验收'}
  })
  const referenceChecks=await Promise.all(r.references.map(async ref=>({assetKey:ref.assetKey,assetVersion:ref.assetVersion,contentHash:ref.contentHash,
    policyHash:await hashProductProductionValueV2(ref.contentPolicy),permittedFeatures:mode==='unknown'?'unknown' as const:'pass' as const,
    excludedFeatures:mode==='unknown'?'unknown' as const:'pass' as const,note:`本次${mode}状态仅模拟作者回答，不证明实际参考遵从`})))
  const result:AvgReviewIssuesV2={schema:'storyforge.avg.review-issues',version:2,targetKey:r.requirementKey,observations:['visual'],
    unobserved:mode==='unknown'?['真实画面与参考内容尚未人工核对']:[],issues:[],
    visualEvidence:{imageHash:rawHash,referenceHashes:mode==='unknown'?[]:r.references.map(ref=>ref.contentHash),checks,
      note:`本次${mode}状态仅受控工程观察；不得据此签实际艺术验收`},
    referencePolicy:{requirementHash:await hashProductProductionValueV2(r),checks:referenceChecks}}
  if(mode==='fail'){
    result.referencePolicy.checks[0].excludedFeatures='fail'
    result.issues=[{issueKey:'reference.0.excluded',locationKey:r.references[0].assetKey,evidence:'受控工程失败：出现排除物件',severity:'blocking',owner:'media',
      allowedChange:'仅重做违规画面，不改原始台词或世界',impact:'参考用途不符合',recheck:'核对原图与准确排除声明'}]
  }
  return result
}
