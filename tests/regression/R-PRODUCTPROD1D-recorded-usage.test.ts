import { describe,expect,it } from 'vitest'
import { projectProductProductionRecordedUsageV1 } from '../../src/lib/product-production/scheduler'

const usage={modelCalls:1,inputTokens:100,outputTokens:20,mediaCalls:0,costUsd:0.25,durationMs:30,storageBytes:1000}
function ledger(){return {schema:'storyforge.product-production-budget-ledger',version:2,rootRunId:null,rootClaim:null,tasks:{},attempts:[
  {controlEpoch:0,taskKey:'model.first',runId:1,attempt:1,idempotencyKey:'a'.repeat(64),outcome:'settled',usage,usageKnown:true,errorCode:null},
  {controlEpoch:1,taskKey:'image.failed',runId:2,attempt:1,idempotencyKey:'b'.repeat(64),outcome:'failed',usage:{...usage,modelCalls:0,mediaCalls:1,costUsd:null},usageKnown:true,errorCode:'http-503'},
]}}
describe('recorded lifetime usage without a live Brief',()=>{
  it('includes failed attempts and earlier epochs without turning unknown cost into zero',()=>{
    expect(projectProductProductionRecordedUsageV1(JSON.stringify(ledger()))).toEqual({modelCalls:1,inputTokens:200,outputTokens:40,mediaCalls:1,costUsd:null,durationMs:60,storageBytes:2000})
  })
  it('keeps held upper-bound usage in the same accounting and leaves the ledger unchanged',()=>{
    const value=ledger();value.attempts[1].usageKnown=false;value.attempts[1].errorCode='result-unknown'
    const text=JSON.stringify(value);expect(projectProductProductionRecordedUsageV1(text)).toMatchObject({modelCalls:1,mediaCalls:1,costUsd:null})
    expect(JSON.stringify(value)).toBe(text)
  })
  it('reads an unstarted empty ledger and rejects corrupt or incomplete records',()=>{
    expect(projectProductProductionRecordedUsageV1('{}')).toEqual({modelCalls:0,inputTokens:0,outputTokens:0,mediaCalls:0,costUsd:0,durationMs:0,storageBytes:0})
    expect(()=>projectProductProductionRecordedUsageV1('{bad')).toThrow()
    const value=ledger();value.attempts[0].usageKnown=true;Object.assign(value.attempts[0],{usage:null})
    expect(()=>projectProductProductionRecordedUsageV1(JSON.stringify(value))).toThrow()
  })
})
