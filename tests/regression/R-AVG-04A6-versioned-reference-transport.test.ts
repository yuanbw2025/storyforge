import { describe, expect, it, vi } from 'vitest'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import type { MediaProviderTransportV1, ProductMediaRequestV1 } from '../../src/lib/product-production/media-adapters'
import { ProductProductionResultUnknownErrorV1 } from '../../src/lib/product-production/scheduler'
import { freezeAvgImageRequestV1, parseAvgMediaReferencesV1 } from '../../src/lib/avg/media-reference-contract'
import { assertAvgImageRequestV2, avgReferenceMetadataV2, freezeAvgImageRequestV2, parseAvgMediaReferencesV2 } from '../../src/lib/avg/media-reference-contract-v2'
import { createAvgReferenceImageAdapterV1, createAvgReferenceImageAdapterV2 } from '../../src/lib/avg/media-reference-adapter'

const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer
const signal = () => new AbortController().signal
const request = (): ProductMediaRequestV1 => ({ schema:'storyforge.product-media-request',version:1,requestId:'avg.reference.v2.test',
  adapterId:'agnes.image-2.5-flash.v1',mediaClass:'image',mediaKind:'background',requirementKey:'avg.media.image',artifactKey:'avg.media.raw.test',
  prompt:'原创昏暗房间，普通机械开关关闭且不发光。',negativePrompt:'人物、文字、隐藏道具',count:1,width:576,height:324,durationMs:null,
  inputHash:'a'.repeat(64),qualityProfile:'internal',environment:'test',allowedDataClasses:['avg-authorized-reference'],rightsPolicyVersion:'test-rights.v1' })
async function reference() {
  return parseAvgMediaReferencesV2([{ schema:'storyforge.avg.media-reference',version:2,assetKey:'avg.reference.style',assetVersion:1,
    contentHash:await sha256MediaData(bytes),mimeType:'image/png',byteSize:bytes.byteLength,purpose:'style',allowedChange:'只用配色与质感，重新设计构图与灯光。',
    dataClass:'avg-authorized-reference',license:'原创受控工程输入，仅本次允许外发与衍生',providerInputAllowed:true,derivativeUseAllowed:true,crop:null,mask:null,
    contentPolicy:{permittedFeatures:['灰绿色、暖木与米白配色','柔和手绘纹理'],excludedFeatures:['蜡封信件','发光按钮','窗户及桌面布局']} }])[0]!
}
async function setup() {
  const first=await reference(),second={...first,assetKey:'avg.reference.detail',purpose:'detail' as const,contentPolicy:{permittedFeatures:['木材纹理'],excludedFeatures:['具体桌子轮廓']}}
  const frozen=await freezeAvgImageRequestV2({request:request(),references:[first,second],resolutionTier:'1K',
    targetFamily:{subjectKey:'room',familyKey:'room.lighting',variantKey:'dark',revision:1}})
  const readReference=vi.fn(async()=>bytes.slice(0)),adapter=await createAvgReferenceImageAdapterV2({frozen,readReference})
  const dispatch=vi.fn<MediaProviderTransportV1['request']>(async()=>({status:200,contentType:'application/json',body:null,
    json:{data:[{b64_json:base64}]},providerRequestId:'controlled-v2',usage:null,costUsd:null}))
  const transport:MediaProviderTransportV1={executionLocation:'browser-direct',request:dispatch}
  return {first,second,frozen,readReference,adapter,dispatch,transport,executable:{...frozen.request,inputHash:frozen.inputHash}}
}

describe('R-AVG-04A6 explicit V2 outbound reference transport foundation',()=>{
  it('sends exact ordered bytes and declared permitted/excluded features, with unknown price and no purpose guarantee',async()=>{
    const s=await setup(),[candidate]=await s.adapter.generate(s.executable,s.transport,signal())
    expect(s.readReference.mock.calls).toEqual([[s.first],[s.second]]);expect(s.dispatch).toHaveBeenCalledTimes(1)
    const call=s.dispatch.mock.calls[0][0]
    expect(call.body).toMatchObject({model:'agnes-image-2.5-flash',extra_body:{image:[`data:image/png;base64,${base64}`,`data:image/png;base64,${base64}`]}})
    expect(call.body.prompt).toContain('"excludedFeatures":["蜡封信件","发光按钮","窗户及桌面布局"]')
    expect(call.body.prompt).toContain('Do not copy excludedFeatures')
    expect(candidate.metadata.avgReferenceTransmission).toMatchObject({version:2,inputHash:s.frozen.inputHash,referencePurposeGuaranteed:false,
      references:[{...s.first,inputIndex:1},{...s.second,inputIndex:2}]})
    expect(candidate.providerReceipt.costUsd).toBeNull();expect(candidate.providerReceipt.usage).toBeNull()
    await expect(s.adapter.parseAndVerify(candidate)).resolves.toMatchObject({contentHash:await sha256MediaData(bytes)})
    const lineage=structuredClone(candidate.metadata.avgReferenceTransmission) as {version:number;references:Array<{contentPolicy:{excludedFeatures:string[]}}>}
    lineage.references[0].contentPolicy.excludedFeatures=[]
    await expect(s.adapter.parseAndVerify({...candidate,metadata:{...candidate.metadata,avgReferenceTransmission:lineage}})).rejects.toThrow(/回执/)
  })
  it('keeps both strict V1 boundaries and the original V1 frozen bytes/hash',async()=>{
    const s=await setup(),old=await freezeAvgImageRequestV1({request:request(),resolutionTier:'1K',references:[avgReferenceMetadataV2(s.first)]})
    expect(()=>parseAvgMediaReferencesV1([s.first])).toThrow()
    expect(()=>parseAvgMediaReferencesV2([old.references[0]])).toThrow()
    await expect(createAvgReferenceImageAdapterV1({frozen:s.frozen as never,readReference:s.readReference})).rejects.toThrow()
    await expect(createAvgReferenceImageAdapterV2({frozen:old as never,readReference:s.readReference})).rejects.toThrow()
    expect(await freezeAvgImageRequestV1({request:request(),resolutionTier:'1K',references:old.references})).toEqual(old)
    expect(s.frozen.inputHash).not.toBe(old.inputHash);expect(s.dispatch).not.toHaveBeenCalled()
  })
  it.each(['schema','version','grant','derivative','crop','mask','empty-permitted','contradictory','duplicate-feature','unknown-policy','extra-field','oversize-policy'] as const)('rejects %s before resolving or dispatching anything',async mode=>{
    const r:Record<string,any>=await reference()
    if(mode==='schema')r.schema='unregistered';if(mode==='version')r.version=3
    if(mode==='grant')r.providerInputAllowed=false;if(mode==='derivative')r.derivativeUseAllowed=false
    if(mode==='crop')r.crop={x:0};if(mode==='mask')r.mask={asset:'other'}
    if(mode==='empty-permitted')r.contentPolicy.permittedFeatures=[]
    if(mode==='contradictory')r.contentPolicy.excludedFeatures=[r.contentPolicy.permittedFeatures[0]]
    if(mode==='duplicate-feature')r.contentPolicy.permittedFeatures.push(r.contentPolicy.permittedFeatures[0])
    if(mode==='unknown-policy')r.contentPolicy.guaranteed=true
    if(mode==='extra-field')r.scopeBypass=true
    if(mode==='oversize-policy')r.contentPolicy.permittedFeatures=['x'.repeat(501)]
    expect(()=>parseAvgMediaReferencesV2([r])).toThrow()
  })
  it('includes policy changes in the frozen identity and refuses stale/altered dispatch',async()=>{
    const s=await setup(),changed=structuredClone(s.frozen)
    changed.references[0].contentPolicy.excludedFeatures.push('new-feature')
    await expect(assertAvgImageRequestV2(changed)).rejects.toThrow(/stale/)
    const refrozen=await freezeAvgImageRequestV2(changed)
    expect(refrozen.inputHash).not.toBe(s.frozen.inputHash)
    const {inputHash:hash,...body}=refrozen
    expect(hash).toBe(await hashProductProductionValueV2(body))
    await expect(s.adapter.generate({...s.executable,inputHash:refrozen.inputHash},s.transport,signal())).rejects.toThrow(/冻结/)
    expect(s.dispatch).not.toHaveBeenCalled()
  })
  it('freezes the target identity instead of trusting a separate mutable family at dispatch',async()=>{
    const s=await setup(),changed=structuredClone(s.frozen)
    changed.targetFamily.subjectKey='other-subject'
    await expect(assertAvgImageRequestV2(changed)).rejects.toThrow(/stale/)
    expect((await freezeAvgImageRequestV2(changed)).inputHash).not.toBe(s.frozen.inputHash)
    await expect(freezeAvgImageRequestV2({...s.frozen,targetFamily:undefined} as never)).rejects.toThrow()
    const originalFamily=structuredClone(s.frozen.targetFamily)
    s.frozen.targetFamily.subjectKey='mutated-after-adapter-creation'
    const [candidate]=await s.adapter.generate(s.executable,s.transport,signal())
    expect(candidate.metadata.avgReferenceTransmission).toMatchObject({targetFamily:originalFamily})
  })
  it.each(['missing-source','wrong-bytes','already-aborted','abort-after-read'] as const)('keeps %s before dispatch without text-only fallback',async mode=>{
    const s=await setup(),abort=new AbortController(),reader=vi.fn(async()=>{
      if(mode==='missing-source')throw Error('cross-work or missing original proof')
      if(mode==='abort-after-read')abort.abort()
      return mode==='wrong-bytes'?bytes.slice(0,25):bytes.slice(0)
    }),adapter=await createAvgReferenceImageAdapterV2({frozen:s.frozen,readReference:reader})
    if(mode==='already-aborted')abort.abort()
    await expect(adapter.generate(s.executable,s.transport,abort.signal)).rejects.toThrow()
    expect(s.dispatch).not.toHaveBeenCalled();if(mode==='already-aborted')expect(reader).not.toHaveBeenCalled()
  })
  it.each(['operation','network'] as const)('retains an unknown %s after one dispatch and grants no hidden retry',async mode=>{
    const s=await setup()
    if(mode==='network')s.dispatch.mockRejectedValueOnce(new TypeError('network lost'))
    else s.dispatch.mockResolvedValueOnce({status:202,contentType:'application/json',body:null,json:{operation_id:'pending.v2'},providerRequestId:null,usage:null,costUsd:null})
    await expect(s.adapter.generate(s.executable,s.transport,signal())).rejects.toBeInstanceOf(ProductProductionResultUnknownErrorV1)
    expect(s.dispatch).toHaveBeenCalledTimes(1)
  })
})
