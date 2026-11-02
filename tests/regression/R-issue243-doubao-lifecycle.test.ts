import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AIConfig } from '../../src/lib/types/ai'
const official = 'https://ark.cn-beijing.volces.com/api/v3'
const retired = 'doubao-1-5-pro-32k-250115'
const active = 'doubao-seed-2-0-lite-260428'
const config = (baseUrl = official): AIConfig => ({ provider: 'doubao', baseUrl, model: retired, apiKey: 'synthetic-only', temperature: 0.2, maxTokens: 1000 })
afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.resetModules() })
describe('issue243 · 豆包官方型号生命周期', () => {
  it('新建配置使用官方LTS项，目录仍保留旧型号并说明期限', async () => {
    const { PROVIDER_PRESETS, PROVIDER_MODELS } = await import('../../src/lib/types/ai')
    expect(PROVIDER_PRESETS.doubao).toEqual({ baseUrl: official, model: active })
    expect(PROVIDER_MODELS.doubao.some(row => row.value === active)).toBe(true)
    expect(PROVIDER_MODELS.doubao.find(row => row.value === retired)?.desc).toContain('2026-09-21')
    expect(PROVIDER_MODELS.doubao.find(row => row.value === 'deepseek-v4-pro-260425')?.desc).toContain('2026-11-24')
  })
  it.each([retired, 'deepseek-v4-flash-260425'])('已EOS型号在官方直连和登记代理显示准确日期：%s', async model => {
    const { getModelRetirement } = await import('../../src/lib/ai/provider-model-lifecycle')
    for (const baseUrl of [official, '/doubao-proxy/api/v3', '/storyforge/doubao-proxy/api/v3']) {
      expect(getModelRetirement({ ...config(baseUrl), model })).toMatchObject({ provider: 'doubao', model, retiredOn: '2026-09-21' })
    }
    expect(getModelRetirement({ ...config(), model: active })).toBeUndefined()
    expect(getModelRetirement({ ...config(), model: 'deepseek-v4-pro-260425' })).toBeUndefined()
  })
  it.each(['https://example.invalid/v1', 'https://ark.cn-beijing.volces.com.example.invalid/api/v3', official + '?route=private'])('不以标签给私人目标加官方退役结论：%s', async baseUrl => {
    const { getModelRetirement } = await import('../../src/lib/ai/provider-model-lifecycle')
    expect(getModelRetirement(config(baseUrl))).toBeUndefined()
  })
  it('旧配置加载、保存为预设和重新应用保持原ID、地址和会话凭据', async () => {
    const old = { ...config(), apiKey: '' }; const raw = JSON.stringify(old)
    localStorage.setItem('storyforge-ai-config', raw)
    sessionStorage.setItem('storyforge-ai-api-key-session', 'synthetic-only')
    let store = (await import('../../src/stores/ai-config')).useAIConfigStore
    expect(store.getState().config).toEqual(config())
    expect(localStorage.getItem('storyforge-ai-config')).toBe(raw)
    const id = store.getState().saveAsPreset('旧型号合成预设')
    vi.resetModules(); store = (await import('../../src/stores/ai-config')).useAIConfigStore
    store.getState().applyPreset(id)
    expect(store.getState().config).toEqual(config())
  })
  it('新建请求使用LTS；旧型号404保留原请求并只发一次，不偷偷换型号', async () => {
    const store = (await import('../../src/stores/ai-config')).useAIConfigStore
    store.getState().switchProvider('doubao');store.getState().setConfig({ apiKey: 'synthetic-only' })
    const bodies: Array<{model: string}> = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init.body));bodies.push(body)
      return body.model === retired ? new Response('{"error":{"message":"synthetic retired model"}}', { status: 404 }) : new Response(JSON.stringify({ choices: [{ message: { content: '合成回执' }, finish_reason: 'stop' }] }), { status: 200 })
    }))
    const { chat } = await import('../../src/lib/ai/client')
    await expect(chat([{role:'user',content:'合成协议'}],store.getState().config)).resolves.toBe('合成回执')
    expect(bodies[0].model).toBe(active)
    const old = config();await expect(chat([{role:'user',content:'合成协议'}],old)).rejects.toThrow(/404/)
    expect(bodies).toHaveLength(2);expect(bodies[1].model).toBe(retired);expect(old.model).toBe(retired)
  })
})
