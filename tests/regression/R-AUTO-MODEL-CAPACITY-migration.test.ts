import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => { vi.resetModules(); localStorage.clear(); sessionStorage.clear() })
const legacy = {provider:'custom',apiKey:'SYNTHETIC_SESSION_ONLY',baseUrl:'https://migration.invalid/v1',model:'kept-alias',temperature:.3,maxTokens:8192,contextWindow:12345}
describe('010 legacy capacity preference migration',()=>{
  it('removes global and preset manual limits while preserving every unrelated setting',async()=>{
    localStorage.setItem('storyforge-ai-config',JSON.stringify({...legacy,apiKey:''}))
    localStorage.setItem('storyforge-ai-presets',JSON.stringify([{id:'old',name:'保留预设',config:{...legacy,apiKey:''}}]))
    localStorage.setItem('storyforge-ai-task-routes',JSON.stringify({creation:'old'}))
    const {useAIConfigStore}=await import('../../src/stores/ai-config')
    const state=useAIConfigStore.getState()
    expect(state.config).toMatchObject({provider:legacy.provider,model:legacy.model,baseUrl:legacy.baseUrl,temperature:.3,maxTokens:8192})
    expect(state.config.contextWindow).toBeUndefined()
    expect(state.presets[0]).toMatchObject({id:'old',name:'保留预设'})
    expect(state.presets[0].config.contextWindow).toBeUndefined()
    expect(state.taskRoutes.creation).toBe('old')
    expect(JSON.parse(localStorage.getItem('storyforge-ai-config')!).contextWindow).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('storyforge-ai-presets')!)[0].config.contextWindow).toBeUndefined()
  })
  it('keeps session credential ownership intact during a reload migration',async()=>{
    const first=await import('../../src/stores/ai-config')
    first.useAIConfigStore.getState().setConfig(legacy as never)
    const saved=JSON.parse(localStorage.getItem('storyforge-ai-config')!)
    localStorage.setItem('storyforge-ai-config',JSON.stringify({...saved,contextWindow:999999}))
    vi.resetModules()
    const next=await import('../../src/stores/ai-config')
    expect(next.useAIConfigStore.getState().config.apiKey).toBe(legacy.apiKey)
    expect(next.useAIConfigStore.getState().config.contextWindow).toBeUndefined()
    const migrated=JSON.parse(localStorage.getItem('storyforge-ai-config')!)
    expect(migrated._sessionCredentialId).toBe(saved._sessionCredentialId)
    expect(migrated.apiKey).toBe('')
    expect(migrated.contextWindow).toBeUndefined()
  })
})
