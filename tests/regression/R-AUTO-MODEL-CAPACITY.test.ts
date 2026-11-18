import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { AIConfig } from '../../src/lib/types'
import { discoverModelCapacityV1, freezeModelCapacityV1, getModelCapacityV1, inheritModelCapacityV1, invalidateModelCapacityV1, modelInputBudgetV1, prepareModelCapacityV1, resetModelCapacityForTestsV1 } from '../../src/lib/ai/model-capacity'
import { resolveAIConfigForTask } from '../../src/lib/ai/task-routing'
import { chat } from '../../src/lib/ai/client'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const config = (patch: Partial<AIConfig> = {}): AIConfig => ({ provider: 'custom', apiKey: 'SYNTHETIC_ONLY', baseUrl: 'https://capacity.invalid/v1', model: 'local-alias', temperature: .4, maxTokens: 1024, ...patch })
const lm = (window: number) => Response.json({ models: [{ type: 'llm', key: 'local-alias', max_context_length: 1000000, loaded_instances: [{ id: 'one', config: { context_length: window } }] }] })
beforeEach(() => { resetModelCapacityForTestsV1() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('010 automatic capacity decisions', () => {
  it('uses traceable exact official identities, never provider defaults on aliases or gateways', () => {
    const official = getModelCapacityV1(config({provider:'openai',baseUrl:'https://api.openai.com/v1',model:'gpt-4o'}))
    expect(official).toMatchObject({confidence:'official',totalWindow:128000,outputLimit:16384})
    expect(official.expiresAt).toBeGreaterThan(official.verifiedAt)
    expect(getModelCapacityV1(config({provider:'openai',model:'gpt-4o'})).confidence).toBe('fallback')
    expect(getModelCapacityV1(config({provider:'openai',baseUrl:'https://api.openai.com/v1',model:'private-gpt-4o-alias'})).confidence).toBe('fallback')
  })
  it('does not subtract independent Gemini output limits from independent input limits', async () => {
    const cfg=config({provider:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',model:'exact-model'})
    const fetcher=vi.fn<typeof fetch>(async()=>Response.json({name:'models/exact-model',inputTokenLimit:10000,outputTokenLimit:2000}))
    const found=await discoverModelCapacityV1(cfg,fetcher)
    expect(found).toMatchObject({confidence:'service',totalWindow:null,inputLimit:10000,outputLimit:2000})
    expect(modelInputBudgetV1(found,2000).inputBudget).toBe(9500)
    expect(fetcher.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/exact-model')
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('error')
  })
  it('uses loaded service allocation, not a theoretical local maximum', async () => {
    const found=await discoverModelCapacityV1(config(),async()=>lm(4096))
    expect(found).toMatchObject({confidence:'service',totalWindow:4096})
    expect(modelInputBudgetV1(found,1024).inputBudget).toBeLessThan(4096-1024)
  })
  it('takes the smallest loaded allocation when an alias can route among instances', async () => {
    const found=await discoverModelCapacityV1(config(),async()=>Response.json({models:[{type:'llm',key:'local-alias',loaded_instances:[{config:{context_length:16000}},{config:{context_length:4000}}]}]}))
    expect(found.totalWindow).toBe(4000)
  })
  it('uses exact running Ollama identity and ignores unloaded and unrelated model limits', async () => {
    const cfg=config({provider:'ollama',baseUrl:'http://localhost:11434/v1',model:'local-alias'})
    const fetcher=vi.fn<typeof fetch>(async()=>Response.json({models:[{model:'local-alias',context_length:6000},{model:'other',context_length:128000}]}))
    expect((await discoverModelCapacityV1(cfg,fetcher)).totalWindow).toBe(6000)
    expect(fetcher.mock.calls[0][0]).toBe('http://localhost:11434/api/ps')
    invalidateModelCapacityV1(cfg)
    expect((await discoverModelCapacityV1(cfg,async()=>Response.json({models:[{model:'other',context_length:128000}]}))).confidence).toBe('fallback')
  })
  it.each([{}, {models:[{key:'local-alias',type:'llm',max_context_length:1000000,loaded_instances:[]}]}, {models:[{key:'local-alias',type:'llm',loaded_instances:[{config:{context_length:'64000'}}]}]}])('missing or malformed metadata stays a conservative unconfirmed fallback',async body=>{
    const found=await discoverModelCapacityV1(config(),async()=>Response.json(body))
    expect(found).toMatchObject({confidence:'fallback',totalWindow:4096})
  })
  it('deduplicates and bounds negative caching; a credential or endpoint switch cannot reuse it', async () => {
    const cfg=config(), fetcher=vi.fn<typeof fetch>(async()=>{throw new TypeError('offline')})
    const [a,b]=await Promise.all([discoverModelCapacityV1(cfg,fetcher),discoverModelCapacityV1(cfg,fetcher)])
    expect(a).toEqual(b);expect(fetcher).toHaveBeenCalledTimes(1)
    await discoverModelCapacityV1({...cfg},fetcher);expect(fetcher).toHaveBeenCalledTimes(1)
    await discoverModelCapacityV1({...cfg,apiKey:'OTHER_SYNTHETIC'},fetcher)
    await discoverModelCapacityV1({...cfg,baseUrl:'https://another.invalid/v1'},fetcher)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(a)).not.toContain(cfg.apiKey);expect(JSON.stringify(a)).not.toContain('capacity.invalid')
    expect(a.expiresAt-a.verifiedAt).toBeLessThanOrEqual(60000)
  })
  it('frozen request evidence survives a refreshed smaller cache; later requests see the smaller service', async () => {
    const cfg=config();await discoverModelCapacityV1(cfg,async()=>lm(32000))
    const frozen=freezeModelCapacityV1(cfg)
    invalidateModelCapacityV1(cfg);await discoverModelCapacityV1({...cfg},async()=>lm(4096))
    expect(getModelCapacityV1(cfg)).toBe(frozen)
    expect(getModelCapacityV1({...cfg}).totalWindow).toBe(4096)
    expect((await prepareModelCapacityV1(cfg)).modelCapacity).toBe(frozen)
  })
  it('a late old response cannot overwrite refreshed metadata',async()=>{
    const cfg=config()
    let release!:(response:Response)=>void
    const old=discoverModelCapacityV1(cfg,()=>new Promise<Response>(resolve=>{release=resolve}))
    invalidateModelCapacityV1(cfg)
    await discoverModelCapacityV1(cfg,async()=>lm(6000))
    release(lm(32000));await old
    expect(getModelCapacityV1({...cfg}).totalWindow).toBe(6000)
  })
  it('routing switches invalidate frozen capability identity instead of inheriting the global limit', async () => {
    const cfg=config();await discoverModelCapacityV1(cfg,async()=>lm(32000));freezeModelCapacityV1(cfg)
    const other=config({baseUrl:'https://another.invalid/v1',model:'other'})
    const routed=resolveAIConfigForTask({category:'chapter.content',requestedConfig:cfg,globalConfig:cfg,presets:[{id:'writer',name:'writer',config:other}],routes:{creation:'writer'}})
    expect(inheritModelCapacityV1(cfg,routed.config).modelCapacity).toBeUndefined()
    expect(getModelCapacityV1(inheritModelCapacityV1(cfg,routed.config)).confidence).toBe('fallback')
  })
  it('bounds unsupported output limits without altering saved output preferences',async()=>{
    const found=await discoverModelCapacityV1(config(),async()=>lm(4000))
    expect(modelInputBudgetV1(found,4001).outputBudget).toBe(2000)
    expect(modelInputBudgetV1(found,0).outputBudget).toBe(2000)
  })
  it('assembly and sending share the same selected-service snapshot, count tools and preserve explicit rejection',async()=>{
    await db.delete();await db.open()
    const {scope}=await seedCurrentWorkspace('capacity isolation')
    const cfg=config({contextWindow:2000000})
    useAIConfigStore.setState({config:cfg,taskRoutes:{},presets:[]})
    let sends=0, output=0
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      if(String(input).endsWith('/api/v1/models'))return lm(16000)
      sends++;output=JSON.parse(String(init?.body)).max_tokens
      return Response.json({choices:[{message:{content:'合成结果'},finish_reason:'stop'}]})
    }))
    const source=CONTEXT_SOURCE_BY_KEY.get('manualText')!, read=source.read
    vi.spyOn(source,'read').mockImplementation(input=>{expect(input.modelConfig).toBeUndefined();return read(input)})
    const assembled=await assembleContext({projectId:scope.projectId,scope,sourceKeys:['manualText'],manualSourceText:'字'.repeat(16000),modelConfig:cfg})
    const capacity=getModelCapacityV1(cfg)
    expect(assembled.inputBudget).toBe(modelInputBudgetV1(capacity,cfg.maxTokens).inputBudget-1024)
    expect(assembled.totalInputTokens).toBeLessThanOrEqual(assembled.inputBudget)
    const narrowed=await assembleContext({projectId:scope.projectId,scope,sourceKeys:['manualText'],manualSourceText:'作者选材',modelConfig:cfg,inputBudgetTokens:1024})
    expect(narrowed.inputBudget).toBe(1024)
    expect(await chat([{role:'user',content:assembled.text}],cfg,{contextOverflowPolicy:'reject'})).toBe('合成结果')
    expect(output).toBe(1024);expect(sends).toBe(1)
    await expect(chat([{role:'user',content:assembled.text}],cfg,{contextOverflowPolicy:'reject'},undefined,undefined,{tools:[{type:'function',function:{name:'big',description:'字'.repeat(16000),parameters:{type:'object'}}}]})).rejects.toThrow('拒绝静默裁剪')
    expect(sends).toBe(1)
    db.close()
  })
})

it.each(['missing-metadata', 'small-allocation'] as const)('rejects an oversized formal request before POST under %s despite a large legacy preference', async mode => {
  const cfg = config({ maxTokens: 1024, contextWindow: 1_000_000 })
  const metadata = vi.fn(async () => mode === 'small-allocation' ? lm(4096) : Response.json({}, { status: 503 }))
  let posts = 0
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'GET') return metadata()
    posts++
    return Response.json({error: 'must not reach transport'}, {status: 401})
  }))
  const result: import('../../src/lib/ai/client').ChatResult = {}
  const request = () => chat([{role: 'user', content: '完整原文不允许静默裁剪。'.repeat(600)}], cfg, {contextOverflowPolicy: 'reject'}, undefined, result)
  await expect(request()).rejects.toThrow('拒绝静默裁剪')
  expect(result.requestLifecycle).toEqual({phase: 'pre-dispatch', responseStatus: null})
  expect(getModelCapacityV1(cfg)).toMatchObject({totalWindow: 4096, confidence: mode === 'small-allocation' ? 'service' : 'fallback'})
  await expect(request()).rejects.toThrow('拒绝静默裁剪')
  expect(metadata).toHaveBeenCalledTimes(1)
  expect(posts).toBe(0)
  expect(cfg.maxTokens).toBe(1024)
})
