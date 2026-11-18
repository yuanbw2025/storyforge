import { describe, it, expect } from 'vitest'
import { calculateBudget, trimMessagesToFit, type ContextSegment } from '../../src/lib/ai/context-budget'
import { getModelCapacityV1 } from '../../src/lib/ai/model-capacity'
import type { AIConfig } from '../../src/lib/types'
const seg=(tokens:number):ContextSegment=>({label:'x',layer:'L1',content:'x',tokens,trimmable:true})
describe('010 retires manual capacity overrides',()=>{
  it('legacy numeric preview overrides cannot expand or shrink the automatic policy',()=>{
    const baseline=calculateBudget('ollama','alias',[seg(100)])
    expect(calculateBudget('ollama','alias',[seg(100)],170000)).toEqual(baseline)
    expect(calculateBudget('ollama','alias',[seg(100)],10)).toEqual(baseline)
  })
  it('physical transmission ignores legacy values and retains oversized-input evidence',()=>{
    const messages=[{role:'user' as const,content:'字'.repeat(6000)}]
    const baseline=trimMessagesToFit(messages,'ollama','alias',1024)
    const legacy=trimMessagesToFit(messages,'ollama','alias',1024,2000000)
    expect(legacy).toEqual(baseline)
    expect(legacy.trimmed).toBe(true)
  })
  it('previews a verified endpoint using the same capability decision as transmission',()=>{
    const cfg:AIConfig={provider:'openai',baseUrl:'https://api.openai.com/v1',model:'gpt-4o',apiKey:'SYNTHETIC_ONLY',temperature:.5,maxTokens:1024}
    const budget=calculateBudget(cfg.provider,cfg.model,[seg(100)],cfg)
    const dispatch=trimMessagesToFit([{role:'user',content:'text'}],cfg.provider,cfg.model,cfg.maxTokens,undefined,0,getModelCapacityV1(cfg))
    expect(budget.maxContext).toBe(128000)
    expect(budget.inputBudget).toBe(dispatch.inputBudget)
  })
})
