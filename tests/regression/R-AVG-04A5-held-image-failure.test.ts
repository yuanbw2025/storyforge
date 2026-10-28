import { describe, expect, it } from 'vitest'
import { avgImageResponseEvidenceV1 } from '../../src/lib/avg/media-production-executor'
import { parseAvgHeldImageQueueFailureV4 } from '../../src/lib/avg/visual-held-image-failure'

async function envelope() {
  return JSON.parse(await avgImageResponseEvidenceV1({status:503,contentType:'application/json; charset=utf-8',providerRequestId:'controlled-request',
    usage:null,costUsd:null,body:null,json:null},JSON.stringify({error:{message:'生图队列已满，请稍后重试',type:'',param:'',code:null}})))
}
describe('strict observed queue-failure evidence, without billing or replay authority',()=>{
  it('reads an actual encoder response while leaving its fee and usage unknown',async()=>{
    const original=await envelope(),before=JSON.stringify(original)
    expect(parseAvgHeldImageQueueFailureV4(before)).toMatchObject({status:503,providerRequestId:'controlled-request'})
    expect(JSON.stringify(original)).toBe(before);expect(original.costUsd).toBeNull();expect(original.usage).toBeNull()
  })
  it.each(['status200','status202','status504','omitted','html','usage','cost','binary','missing-error','operation','contradictory-data','unknown-error-field','processing-code','malformed','empty-message','too-large'] as const)('rejects %s instead of inferring a definitive failed synchronous request',async mode=>{
    const row=await envelope()
    if(mode.startsWith('status'))row.status=Number(mode.slice(6))
    if(mode==='omitted')row.schema='storyforge.avg.image-provider-response-omitted'
    if(mode==='html')row.contentType='text/html'
    if(mode==='usage')row.usage={mediaCalls:1}
    if(mode==='cost')row.costUsd=0
    if(mode==='binary')row.binaryBodyHash='a'.repeat(64)
    if(mode==='missing-error')row.rawText='{}'
    if(mode==='operation')row.rawText=JSON.stringify({task_id:'pending-operation'})
    if(mode==='contradictory-data')row.rawText=JSON.stringify({error:{message:'queue'},data:[{url:'pending-output'}]})
    if(mode==='unknown-error-field')row.rawText=JSON.stringify({error:{message:'queue',operationId:'pending'}})
    if(mode==='processing-code')row.rawText=JSON.stringify({error:{message:'pending',code:'processing'}})
    if(mode==='malformed')row.rawText='{broken'
    if(mode==='empty-message')row.rawText=JSON.stringify({error:{message:''}})
    if(mode==='too-large')row.rawText='x'.repeat(33*1024)
    expect(()=>parseAvgHeldImageQueueFailureV4(JSON.stringify(row))).toThrow()
  })
})
