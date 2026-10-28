import { describe,expect,it,vi } from 'vitest'
import { agnesImage21FlashAdapterV1,agnesImage25FlashAdapterV1,type ProductMediaRequestV1 } from '../../src/lib/product-production/media-adapters'
import { configuredAgnesImageEndpointHashV1,configuredAgnesImageEndpointHashV2,inspectConfiguredAgnesImageCapabilityV1,
  inspectConfiguredAgnesImageCapabilityV2,resolveConfiguredAgnesImageCapabilityV1,resolveConfiguredAgnesImageCapabilityV2 } from '../../src/lib/product-production/media-transport'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import type { AIConfig,ProviderCapabilityRequirementV1 } from '../../src/lib/types'

const config:AIConfig={provider:'agnes',apiKey:'test-only-private-image-route',baseUrl:'https://image.fixture.invalid/v1',model:'agnes-3.0-flash',temperature:0.7,maxTokens:0}
const requirement:ProviderCapabilityRequirementV1={requirementKey:'avg.media.image',mediaClass:'image',operation:'generate',adapterFamily:'agnes',minimumCapabilityVersion:'1',
  allowedDataClasses:['image-prompt'],maximumRequestCost:null,maximumTotalCost:null,rightsPolicyVersion:'fixture-rights',capabilityHash:'a'.repeat(64),required:true}
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN8AAAAASUVORK5CYII='
const response=()=>new Response(JSON.stringify({data:[{b64_json:png,url:null,revised_prompt:null}]}),{headers:{'content-type':'application/json','x-request-id':'controlled-image25'}})
const request=(adapterId='agnes.image-2.5-flash.v1'):ProductMediaRequestV1=>({schema:'storyforge.product-media-request',version:1,requestId:'image25.fixture',adapterId,
  mediaClass:'image',mediaKind:'background',requirementKey:'avg.media.image',artifactKey:'avg.media.raw.background',prompt:'原创工程图',negativePrompt:'水印',count:1,
  width:576,height:324,durationMs:null,inputHash:'a'.repeat(64),qualityProfile:'internal',environment:'test',allowedDataClasses:['image-prompt'],rightsPolicyVersion:'fixture-rights'})

describe('explicit Agnes Image 2.5 capability without rewriting prior 2.1 identity',()=>{
  it('keeps exact legacy receipt/route identity and binds a distinct explicit 2.5 route without a request',async()=>{
    const fetcher=vi.fn(async()=>response()),input={projectId:1,config,requirement,fetcher,now:100}
    const old=await resolveConfiguredAgnesImageCapabilityV1(input),next=await resolveConfiguredAgnesImageCapabilityV2(input)
    const identity={schema:'storyforge.configured-agnes-image-capability',version:1,requirementKey:requirement.requirementKey,adapterId:'agnes.image-2.1-flash.v1',
      adapterVersion:1,provider:'agnes',model:'agnes-image-2.1-flash',endpointOrigin:'https://image.fixture.invalid',executionLocation:'browser-direct',credentialSource:'existing-ai-config',credentialPresent:true}
    expect(old.binding.bindingHash).toBe(await hashProductProductionValueV2(identity))
    expect(old.receipt).toMatchObject({version:1,adapterId:'agnes.image-2.1-flash.v1',model:'agnes-image-2.1-flash'})
    expect(next.receipt).toMatchObject({version:2,adapterId:'agnes.image-2.5-flash.v1',model:'agnes-image-2.5-flash'})
    expect(next.binding.bindingHash).not.toBe(old.binding.bindingHash)
    const legacyRoute=await configuredAgnesImageEndpointHashV1(input)
    expect(legacyRoute).toBe(await hashProductProductionValueV2({schema:'storyforge.agnes-image-route',version:1,method:'POST',origin:'https://image.fixture.invalid',path:'/v1/images/generations',model:'agnes-image-2.1-flash'}))
    expect(await configuredAgnesImageEndpointHashV2(input)).not.toBe(legacyRoute)
    expect(inspectConfiguredAgnesImageCapabilityV1(input).model).toBe('agnes-image-2.1-flash')
    expect(inspectConfiguredAgnesImageCapabilityV2(input).model).toBe('agnes-image-2.5-flash')
    expect(fetcher).not.toHaveBeenCalled();expect(config.model).toBe('agnes-3.0-flash')
  })

  it.each(['2.1','2.5'] as const)('sends exactly the selected %s model and preserves actual bytes, unknown fees and terms-review requirement',async version=>{
    const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>response())
    const resolved=await(version==='2.1'?resolveConfiguredAgnesImageCapabilityV1:resolveConfiguredAgnesImageCapabilityV2)({projectId:1,config,requirement,fetcher})
    const [image]=await resolved.adapter.generate(request(`agnes.image-${version}-flash.v1`),resolved.transport,new AbortController().signal)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url,init]=fetcher.mock.calls[0];expect(String(url)).toBe('https://image.fixture.invalid/v1/images/generations')
    expect(JSON.parse(String(init!.body))).toMatchObject({model:`agnes-image-${version}-flash`,size:'1K',ratio:'16:9',return_base64:true,extra_body:{response_format:'b64_json'}})
    expect(init).toMatchObject({credentials:'omit',headers:{authorization:`Bearer ${config.apiKey}`}})
    expect(image.mimeType).toBe('image/png');expect(image.data?.byteLength).toBe(atob(png).length)
    expect(image.providerReceipt.costUsd).toBeNull();expect(image.rights.requiresProviderTermsReview).toBe(true)
    expect(JSON.stringify({...image,data:null,receipt:resolved.receipt})).not.toContain(config.apiKey)
    expect(await resolved.adapter.parseAndVerify(image)).toMatchObject({contentHash:image.contentHash})
    expect(await resolved.adapter.estimate(request(`agnes.image-${version}-flash.v1`))).toMatchObject({estimatedCostUsd:null})
  })

  it.each(['adapter','model','legacy-masquerade'] as const)('rejects %s mismatches before sending credentials or requests',async mode=>{
    const fetcher=vi.fn(async()=>response()),resolved=await(mode==='legacy-masquerade'?resolveConfiguredAgnesImageCapabilityV1:resolveConfiguredAgnesImageCapabilityV2)({projectId:1,config,requirement,fetcher})
    await expect(resolved.transport.request({requestId:'mismatch',method:'POST',endpoint:'/v1/images/generations',allowedDataClasses:[],
      adapterId:mode==='adapter'?'agnes.image-2.1-flash.v1':resolved.binding.adapterId,
      body:{model:mode==='model'?'agnes-image-2.1-flash':'agnes-image-2.5-flash',prompt:'工程'}} ,new AbortController().signal)).rejects.toThrow(/合同/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['received503','unknown-network','malformed-image'] as const)('retains %s as a single 2.5 attempt without fallback or retry',async failure=>{
    const fetcher=vi.fn(async()=>{if(failure==='unknown-network')throw new TypeError('Failed to fetch')
      return failure==='received503'?new Response(JSON.stringify({error:{message:'queue full'}}),{status:503}):new Response(JSON.stringify({data:[{url:null,b64_json:null}]}))})
    const resolved=await resolveConfiguredAgnesImageCapabilityV2({projectId:1,config,requirement,fetcher})
    await expect(resolved.adapter.generate(request(),resolved.transport,new AbortController().signal)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps URL delivery on trusted storage with no credential forwarding and no provider regeneration',async()=>{
    const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0)).buffer
    const fetcher=vi.fn(async(url:RequestInfo|URL,_init?:RequestInit)=>String(url).includes('/images/generations')
      ?new Response(JSON.stringify({data:[{url:'https://storage.googleapis.com/agnes-aigc/fixture.png',b64_json:null}]}))
      :new Response(bytes,{headers:{'content-type':'image/png'}}))
    const resolved=await resolveConfiguredAgnesImageCapabilityV2({projectId:1,config,requirement,fetcher})
    const [image]=await resolved.adapter.generate(request(),resolved.transport,new AbortController().signal)
    expect(image.data).toEqual(bytes);expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1][1]).toMatchObject({method:'GET',credentials:'omit',referrerPolicy:'no-referrer'})
    expect(fetcher.mock.calls[1][1]!.headers).toBeUndefined()
    await expect(resolved.transport.fetchExternalAsset!({url:'https://untrusted.fixture.invalid/a.png',maximumBytes:1024},new AbortController().signal)).rejects.toThrow(/允许/)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each(['wrong-provider','no-key','wrong-media','unsafe-endpoint'] as const)('rejects %s before binding and preserves the existing configuration',async mode=>{
    const fetcher=vi.fn(async()=>response()),input={...config,...(mode==='wrong-provider'?{provider:'deepseek' as const}:mode==='no-key'?{apiKey:''}:mode==='unsafe-endpoint'?{baseUrl:'http://not-loopback.invalid/v1'}:{})}
    await expect(resolveConfiguredAgnesImageCapabilityV2({projectId:1,config:input,requirement:mode==='wrong-media'?{...requirement,mediaClass:'music'}:requirement,fetcher})).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled();expect(config.model).toBe('agnes-3.0-flash')
  })

  it('does not let either adapter parse or dispatch the other model contract',async()=>{
    const transport={executionLocation:'browser-direct' as const,request:vi.fn(async()=>({status:200,contentType:'application/json',body:null,json:{data:[{b64_json:png}]},providerRequestId:null,usage:null,costUsd:null}))}
    await expect(agnesImage25FlashAdapterV1.generate(request('agnes.image-2.1-flash.v1'),transport,new AbortController().signal)).rejects.toThrow()
    await expect(agnesImage21FlashAdapterV1.generate(request(),transport,new AbortController().signal)).rejects.toThrow()
    expect(transport.request).not.toHaveBeenCalled()
  })
})
