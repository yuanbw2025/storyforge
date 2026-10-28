import { describe,expect,it } from 'vitest'
import { avgImageProcessingRecipeFixture,avgImageProcessingReceiptFixture } from '../helpers/avg-image-processing-fixture'
import { parseAvgImageProcessingRecipeV1,parseAvgImageProcessingPlanV1,deriveAvgImageProcessingGeometryV1,assertAvgImageProcessingReceiptV1 } from '../../src/lib/avg/image-processing-contract'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'

describe('AVG explicit local image processing geometry and receipt',()=>{
 it('fits a portrait into a fixed stage canvas with explicit padding and anchor, without stretching',()=>{
   const r=avgImageProcessingRecipeFixture()
   expect(deriveAvgImageProcessingGeometryV1(r,768,1024)).toEqual({source:{x:0,y:0,width:768,height:1024},destination:{x:167,y:0,width:243,height:324}})
   expect(deriveAvgImageProcessingGeometryV1({...r,anchor:{x:10000,y:0}},768,1024).destination.x).toBe(333)
 })
 it('covers by cropping within the source, with a bounded source rectangle at both extreme anchors',()=>{
   const r={...avgImageProcessingRecipeFixture(),fit:'cover' as const}
   expect(deriveAvgImageProcessingGeometryV1(r,768,1024)).toEqual({source:{x:0,y:296,width:768,height:432},destination:{x:0,y:0,width:576,height:324}})
   expect(deriveAvgImageProcessingGeometryV1({...r,anchor:{x:10000,y:10000}},768,1024).source.y).toBe(592)
   expect(deriveAvgImageProcessingGeometryV1({...r,anchor:{x:0,y:0}},768,1024).source.y).toBe(0)
 })
 it('applies the explicit crop before fitting, including non-divisible source boundaries',()=>{
   const r={...avgImageProcessingRecipeFixture(),crop:{x:5000,y:0,width:5000,height:10000}}
   expect(deriveAvgImageProcessingGeometryV1(r,641,360).source).toEqual({x:320,y:0,width:321,height:360})
   expect(deriveAvgImageProcessingGeometryV1({...r,crop:{x:9999,y:9999,width:1,height:1}},641,360).source).toEqual({x:640,y:359,width:1,height:1})
 })
 it('rejects out-of-bounds, sparse, duplicate, unknown, unbounded and inferred operation inputs',()=>{
   const r=avgImageProcessingRecipeFixture()
   for(const value of [{...r,crop:{x:9000,y:0,width:2000,height:10000}},{...r,width:8192},{...r,anchor:{x:0.5,y:0}},{...r,background:{red:0,green:0,blue:0,alpha:256}},{...r,mask:'automatic'},{...r,declaration:''}])expect(()=>parseAvgImageProcessingRecipeV1(value)).toThrow()
   for(const entries of [[],[{requirementKey:'desk',recipe:r},{requirementKey:'desk',recipe:r}],Array(1)])expect(()=>parseAvgImageProcessingPlanV1({schema:'storyforge.avg.image-processing-plan',version:1,entries})).toThrow()
   expect(()=>deriveAvgImageProcessingGeometryV1(r,8192,8192)).toThrow(/像素/)
 })
 it('binds original bytes, recipe, geometry, measured output and renderer without local IDs or provider-cost claims',async()=>{
   const recipe=avgImageProcessingRecipeFixture(),receipt=await avgImageProcessingReceiptFixture({recipe,source:{contentHash:'a'.repeat(64),mimeType:'image/png',byteSize:31,width:640,height:360},data:new Uint8Array([1,2,3]).buffer})
   expect(await assertAvgImageProcessingReceiptV1(recipe,receipt)).toEqual(receipt)
   await expect(assertAvgImageProcessingReceiptV1({...recipe,fit:'cover'},receipt)).rejects.toThrow(/不一致/)
   await expect(assertAvgImageProcessingReceiptV1(recipe,{...receipt,output:{...receipt.output,hasAlpha:true}})).rejects.toThrow(/hash/)
   const changed={...receipt,geometry:{...receipt.geometry,destination:{...receipt.geometry.destination,x:1}}},{receiptHash:_old,...body}=changed;void _old
   await expect(assertAvgImageProcessingReceiptV1(recipe,{...body,receiptHash:await hashProductProductionValueV2(body)})).rejects.toThrow(/几何/)
   await expect(assertAvgImageProcessingReceiptV1(recipe,{...receipt,blobObjectId:1})).rejects.toThrow(/未知/)
 })
})
