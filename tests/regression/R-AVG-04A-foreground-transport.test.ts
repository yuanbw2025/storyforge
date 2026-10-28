import { describe,it,expect,vi } from 'vitest'
import type { MediaProviderTransportV1 } from '../../src/lib/product-production/media-adapters'
import { compileAvgForegroundRequirementV1 } from '../../src/lib/avg/image-foreground-contract'
import { AVG_RESERVED_MAGENTA_INVARIANT_V1,AVG_RESERVED_MAGENTA_FORBIDDEN_V1 } from '../../src/lib/avg/image-foreground-contract'
import { prepareAvgRawImageRequestFromBatchV1 } from '../../src/lib/avg/media-raw-contract'
import { prepareAvgRawImageRequestFromBatchV2 } from '../../src/lib/avg/media-request-v2'
import { createAvgReferenceImageAdapterV1,createAvgReferenceImageAdapterV2 } from '../../src/lib/avg/media-reference-adapter'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { DECLARED_MAGENTA_ALPHA_MATTING_ID_V1 } from '../../src/lib/product-production/character-alpha-matting'

const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)).buffer
const policy={schema:'storyforge.avg.foreground-policy' as const,version:1 as const,method:'reserved-magenta' as const,reservedColor:'#FF00FF' as const,
 subjectUsesReservedColor:false as const,algorithm:DECLARED_MAGENTA_ALPHA_MATTING_ID_V1,declaration:'纯接口准备探针，只允许保留底色，不授原图/作者/生产权限。'}

describe('AVG foreground constraints reach actual Agnes transport serialization',()=>{
 it.each([{name:'ordinary-21',adapterId:'agnes.image-2.1-flash.v1',version:1,references:false},
  {name:'professional-v4-25',adapterId:'agnes.image-2.5-flash.v1',version:1,references:true},
  {name:'professional-v5-25',adapterId:'agnes.image-2.5-flash.v1',version:2,references:true}] as const)('$name sends reservation/exclusion and exact declared references to controlled transport once',async mode=>{
  const capability={requirementKey:'avg.media.image',mediaClass:'image' as const,operation:'generate' as const,adapterFamily:'agnes',minimumCapabilityVersion:'1',
   allowedDataClasses:['image-prompt','avg-authorized-reference'],maximumRequestCost:null,maximumTotalCost:null,rightsPolicyVersion:'wire-probe-fixture-only',capabilityHash:'a'.repeat(64),required:true}
  const baseReference={assetKey:'probe.author.identity',assetVersion:1,contentHash:await sha256MediaData(bytes),mimeType:'image/png',byteSize:bytes.byteLength,
   purpose:'identity' as const,allowedChange:'仅保持公开脸型与服装轮廓，背景按当前明确声明重新绘制',dataClass:'avg-authorized-reference',license:'原创工程像素元数据，不签商用或外部确权',
   providerInputAllowed:true,derivativeUseAllowed:true,crop:null,mask:null}
  const references=mode.references?[mode.version===2?{...baseReference,schema:'storyforge.avg.media-reference' as const,version:2 as const,
   contentPolicy:{permittedFeatures:['脸型与服装轮廓'],excludedFeatures:['原背景','新增物件']}}:baseReference]:[]
  const requirement=compileAvgForegroundRequirementV1(policy,{requirementKey:'keeper.pose',revision:1,assetKey:'probe.keeper.pose',name:'原请求准备探针',altText:'探针',
   family:{subjectKey:'keeper',familyKey:'keeper.neutral',variantKey:'pose',revision:1},
   consumer:{consumerKey:'keeper.actor',domain:'stage' as const,slot:'actor',subjectKey:'keeper',sceneKey:'desk',lineKey:null,required:true,fallback:'none' as const},
   triggerBeatKey:'line.desk',itemVariantKey:null,mediaKind:'character-pose' as const,prompt:'原创工程人物，不是文学或美术验收',negativePrompt:'不得加入文字',invariants:['保持公开造型'],forbiddenDepictions:['新增剧情物件'],
   width:576,height:768,resolutionTier:'1K' as const,alpha:'required' as const,references})
  const batch={schema:'storyforge.avg.visual-production-batch' as const,version:mode.version,batchKey:'wire.probe',revision:1,aspectRatio:'16:9' as const,
   sourceInputHash:'c'.repeat(64),visualReviewPolicy:'author-visual-v1' as const,requirements:[requirement]}
  const prepare={batch,capability,qualityProfile:'prototype' as const,requirementKey:requirement.requirementKey,idempotencyKey:`probe.${mode.name}`,adapterId:mode.adapterId}
  const frozen=mode.version===1?await prepareAvgRawImageRequestFromBatchV1(prepare as never):await prepareAvgRawImageRequestFromBatchV2(prepare as never)
  const readReference=vi.fn(async()=>bytes.slice(0)),adapter=mode.version===1?await createAvgReferenceImageAdapterV1({frozen:frozen as never,readReference})
   :await createAvgReferenceImageAdapterV2({frozen:frozen as never,readReference})
  const transport=vi.fn<MediaProviderTransportV1['request']>(async()=>({status:503,contentType:'application/json',body:null,json:{error:{message:'controlled fixture stop after capture, not real Agnes failure'}},providerRequestId:'probe-controlled',usage:null,costUsd:null}))
  const fetch=vi.fn(()=>{throw new Error('No real network is allowed')});vi.stubGlobal('fetch',fetch)
  try{
   await expect(adapter.generate({...frozen.request,inputHash:frozen.inputHash},{executionLocation:'browser-direct',request:transport},new AbortController().signal)).rejects.toThrow()
   expect(transport).toHaveBeenCalledTimes(1)
   const call=transport.mock.calls[0][0] as {adapterId:string;endpoint:string;method:string;body:Record<string,any>}
   expect(call.adapterId).toBe(mode.adapterId);expect(call.endpoint).toBe('/v1/images/generations');expect(call.method).toBe('POST')
   expect(call.body.prompt).toContain(AVG_RESERVED_MAGENTA_INVARIANT_V1);expect(call.body.prompt).toContain(AVG_RESERVED_MAGENTA_FORBIDDEN_V1)
   expect(call.body.prompt).toContain('保持公开造型');expect(call.body.prompt).toContain('新增剧情物件')
   expect(call.body.model).toBe(mode.adapterId.includes('2.5')?'agnes-image-2.5-flash':'agnes-image-2.1-flash');expect(call.body.size).toBe('1K')
   if(mode.references){expect(call.body.extra_body.image).toEqual([`data:image/png;base64,${base64}`]);expect(readReference).toHaveBeenCalledTimes(1)}
   else{expect(call.body.extra_body.image).toBeUndefined();expect(readReference).not.toHaveBeenCalled()}
   if(mode.version===2){expect(call.body.prompt).toContain('"permittedFeatures":["脸型与服装轮廓"]');expect(call.body.prompt).toContain('"excludedFeatures":["原背景","新增物件"]')}
   expect(fetch).not.toHaveBeenCalled()
  }finally{vi.unstubAllGlobals()}
 })
})
