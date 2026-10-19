import { describe, expect, it } from 'vitest'
import { freezeAvgImageRequestV1, parseAvgMediaReferencesV1 } from '../../src/lib/avg/media-reference-contract'
import type { ProductMediaRequestV1 } from '../../src/lib/product-production/media-adapters'

const source=()=>({schema:'storyforge.avg.generated-reference-source',version:1,productionKey:'avg.original',requirementKey:'base.image',
  raw:{schema:'storyforge.avg.retained-raw-image-proof',version:1,buildNumber:1,briefHash:'a'.repeat(64),planHash:'b'.repeat(64),controlEpoch:0,
    taskKey:'avg.media.generate.base.image',artifactKey:'avg.media.raw.base.image',artifactVersion:1,contentHash:'c'.repeat(64),
    inputHash:'d'.repeat(64),producerReceiptHash:'e'.repeat(64),candidateHash:'f'.repeat(64),proofHash:'a'.repeat(64)},
  choice:{artifactKey:'avg.media.choice.base.image',version:1,contentHash:'b'.repeat(64),authorReceiptHash:'d'.repeat(64)}})
const reference=()=>({assetKey:'avg.generated.base',assetVersion:1,contentHash:'c'.repeat(64),mimeType:'image/png',byteSize:100,
  purpose:'identity',allowedChange:'保留身份，只改变表情',dataClass:'avg-authorized-reference',license:'author-reviewed-provider-terms',
  providerInputAllowed:true,derivativeUseAllowed:true,crop:null,mask:null})

describe('AVG generated reference portable source contract',()=>{
  it('keeps old reference bytes unchanged and hashes the exact original adoption separately from pixel identity',async()=>{
    const old=reference(),generated={...old,generatedSource:source()}
    expect(parseAvgMediaReferencesV1([old])).toEqual([old])
    expect(parseAvgMediaReferencesV1([old])[0]).not.toHaveProperty('generatedSource')
    const request:ProductMediaRequestV1={schema:'storyforge.product-media-request',version:1,requestId:'avg.reference.contract',adapterId:'agnes.image-2.1-flash.v1',
      mediaClass:'image',mediaKind:'background',requirementKey:'avg.media.image',artifactKey:'avg.media.raw.next',prompt:'原创工程图',negativePrompt:'',count:1,width:576,height:324,
      durationMs:null,inputHash:'a'.repeat(64),qualityProfile:'prototype',environment:'test',allowedDataClasses:['avg-authorized-reference'],rightsPolicyVersion:'avg-rights.v1'}
    const freeze=(refs:unknown[])=>freezeAvgImageRequestV1({request,resolutionTier:'1K',references:parseAvgMediaReferencesV1(refs)})
    const plain=await freeze([old]),first=await freeze([generated])
    const revised=structuredClone(generated);revised.generatedSource.choice.version++
    const second=await freeze([revised])
    expect(first.inputHash).not.toBe(plain.inputHash);expect(second.inputHash).not.toBe(first.inputHash)
    expect(first.references[0].contentHash).toBe(second.references[0].contentHash)
    expect(first.references[0].generatedSource).toEqual(source())
  })
  it('rejects missing consent, wrong pixels/requirements, local IDs and invalid optional origins',()=>{
    const ref={...reference(),generatedSource:source()}
    for(const invalid of [
      {...ref,providerInputAllowed:false},{...ref,derivativeUseAllowed:false},
      {...ref,contentHash:'e'.repeat(64)},{...ref,generatedSource:null},{...ref,generatedSource:undefined},
      {...ref,generatedSource:{...source(),buildId:42}},
      {...ref,generatedSource:{...source(),requirementKey:'other.image'}},
      {...ref,generatedSource:{...source(),choice:{...source().choice,producerRunId:42}}},
    ])expect(()=>parseAvgMediaReferencesV1([invalid])).toThrow()
  })
})
