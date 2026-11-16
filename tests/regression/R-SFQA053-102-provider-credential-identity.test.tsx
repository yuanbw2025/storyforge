import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EmbeddingConfigCard from '../../src/components/settings/EmbeddingConfigCard'
import AIConfigPanel from '../../src/components/settings/AIConfigPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { db } from '../../src/lib/db/schema'
import { chat, resolveRequestConfig } from '../../src/lib/ai/client'
import { clearLogs, getLogs } from '../../src/lib/ai/logger'
import { isEmbeddingReady } from '../../src/lib/ai/adapters/embedding-adapter'
import { requestedAIConfig } from '../../src/lib/node-authoring/executor'
import type { AuthoringInputEnvelope, AuthoringNodeInstance } from '../../src/lib/node-authoring/contracts'
import type { AIConfig } from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { getAIConfigPresetSessionApiKey, useAIConfigStore } from '../../src/stores/ai-config'
import { useProjectStore } from '../../src/stores/project'

const KEY_A = 'SYNTHETIC_PROVIDER_A_ONLY'
const KEY_B = 'SYNTHETIC_PROVIDER_B_ONLY'
const KEY_QWEN = 'SYNTHETIC_QWEN_ONLY'
const AMBIGUOUS_ENDPOINTS = [
  '/\\different-service.invalid/openai-proxy/v1',
  '/\n/different-service.invalid/openai-proxy/v1',
  '/\t/different-service.invalid/openai-proxy/v1',
  '/\\storyforge-credential.invalid/openai-proxy/v1',
]
const NONCANONICAL_ABSOLUTE = [
  'https:api.openai.com/v1',
  'https:/api.openai.com/v1',
  'https://api.openai.com/v1#',
  'https://api.openai.com/v1\u0000',
]
const BASE: AIConfig = { provider: 'custom', apiKey: KEY_A, baseUrl: 'https://provider-a.invalid/v1', model: 'diagnostic-a', temperature: 0.4, maxTokens: 1000 }
const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let root: Root | undefined, host: HTMLDivElement | undefined
let previousReactFlag: boolean | undefined
const sent: Array<{ url: string; authorization: string | null }> = []

function node(presetId?: string): AuthoringNodeInstance {
  return { id: 'synthetic-node', templateId: 'processor.free-generation', templateVersion: 1, title: '合成配置选择', x: 0, y: 0,
    config: presetId ? { aiPresetId: presetId } : {}, inputs: [], outputs: [] }
}
function switchToB() {
  useAIConfigStore.getState().setConfig({ provider: 'deepseek', apiKey: KEY_B, baseUrl: 'https://provider-b.invalid/v1', model: 'diagnostic-b' })
}
async function mountEmbeddingCard() {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(createElement(EmbeddingConfigCard)))
}
async function mountSettingsPanel() {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(createElement(DialogProvider, null, createElement(AIConfigPanel))))
}
async function click(label: string) {
  const button = [...host!.querySelectorAll('button')].find(item => item.textContent?.includes(label))
  expect(button, label).toBeTruthy()
  await act(async () => button!.click())
}
async function waitForIndexCompletion() {
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(host!.textContent).toMatch(/检索索引已就绪|完成:扫描/)
  })
}

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear(); sent.length = 0; clearLogs()
  await db.delete(); await db.open()
  previousReactFlag = reactEnvironment.IS_REACT_ACT_ENVIRONMENT; reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  useProjectStore.setState({ currentProjectId: null })
  useAIConfigStore.setState({ config: { ...BASE }, presets: [], taskRoutes: {}, rememberApiKey: false, activePresetId: null, editingPresetId: null,
    embedding: { enabled: true, provider: 'openai', apiKey: KEY_A, baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small' } })
  // Every request is fulfilled locally; no real profile, credentials or network.
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    sent.push({ url, authorization: new Headers(init?.headers).get('Authorization') })
    if (url.endsWith('/embeddings')) {
      const body = JSON.parse(String(init?.body)) as { input: string[] }
      return Response.json({ data: body.input.map((_text, index) => ({ index, embedding: [1, 0, 0] })) })
    }
    if (url.endsWith('/chat/completions')) return Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: 'synthetic reply' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
    throw new Error('Unexpected synthetic test request')
  }))
})
afterEach(async () => {
  await act(async () => root?.unmount()); host?.remove(); root = undefined; host = undefined
  // A native read transaction drains prior usage writes before deleting this
  // test-only database; it does not change the request or usage implementation.
  await db.transaction('r', db.tables, () => Promise.all(db.tables.map(table => table.count())))
  await db.delete(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks()
  if (previousReactFlag === undefined) delete reactEnvironment.IS_REACT_ACT_ENVIRONMENT
  else reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousReactFlag
})

describe('SFQA053 preset and transport keep one credential authority', () => {
  it('ordinary preset application restores its own session key', () => {
    const id = useAIConfigStore.getState().saveAsPreset('合成A')
    expect(useAIConfigStore.getState().presets[0]!.config.apiKey).toBe('')
    expect(getAIConfigPresetSessionApiKey(id)).toBe(KEY_A)
    switchToB(); useAIConfigStore.getState().applyPreset(id)
    expect(useAIConfigStore.getState().config.apiKey).toBe(KEY_A)
  })
  it.each([false, true])('the actual request selected by a node uses A credentials, remember=%s', async remember => {
    useAIConfigStore.getState().setRememberApiKey(remember)
    const id = useAIConfigStore.getState().saveAsPreset('合成A'); switchToB()
    const selected = requestedAIConfig(node(id))
    const resolved = resolveRequestConfig(selected, { category: 'node.creation' })
    await expect(chat([{ role: 'user', content: 'synthetic owned text' }], selected, { category: 'node.creation', transportRetryPolicy: 'none' })).resolves.toBe('synthetic reply')
    expect(sent).toEqual([{ url: 'https://provider-a.invalid/v1/chat/completions', authorization: `Bearer ${KEY_A}` }])
    expect(resolved.config.apiKey).toBe(KEY_A)
    expect(JSON.stringify(node(id))).not.toContain(KEY_A)
    expect(JSON.stringify(getLogs())).not.toContain(KEY_A)
    expect(JSON.stringify(getLogs())).not.toContain(KEY_B)
  })
  it('a deleted selected preset reports an actionable error instead of using the global connection', () => {
    const id = useAIConfigStore.getState().saveAsPreset('合成A')
    useAIConfigStore.getState().deletePreset(id); switchToB()
    expect(() => requestedAIConfig(node(id))).toThrow(/预设/)
    expect(sent).toEqual([])
  })
  it('a keyless preset cannot borrow credentials from a different endpoint of the same provider', () => {
    useAIConfigStore.getState().setConfig({ apiKey: '' })
    const id = useAIConfigStore.getState().saveAsPreset('无Key的自定义服务')
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://other-custom.invalid/v1', apiKey: KEY_B })
    expect(requestedAIConfig(node(id)).apiKey).toBe('')
    useAIConfigStore.getState().applyPreset(id)
    expect(useAIConfigStore.getState().config.apiKey).toBe('')
  })
  it('independent session presets keep their own keys without changing the global selection', () => {
    const first = useAIConfigStore.getState().saveAsPreset('A')
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://provider-c.invalid/v1', apiKey: 'SYNTHETIC_C_ONLY', model: 'diagnostic-c' })
    const second = useAIConfigStore.getState().saveAsPreset('C'); switchToB()
    const current = { ...useAIConfigStore.getState().config }
    expect(requestedAIConfig(node(first)).apiKey).toBe(KEY_A)
    expect(requestedAIConfig(node(second)).apiKey).toBe('SYNTHETIC_C_ONLY')
    expect(useAIConfigStore.getState().config).toEqual(current)
  })
  it('the connected AI profile takes precedence and retains its own credential', () => {
    const first = useAIConfigStore.getState().saveAsPreset('A')
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://provider-c.invalid/v1', apiKey: 'SYNTHETIC_C_ONLY' })
    const second = useAIConfigStore.getState().saveAsPreset('C'); switchToB()
    const control: AuthoringInputEnvelope = { sourceNodeId: 'profile', sourcePortId: 'out', targetPortId: 'profile',
      semantic: 'control.ai-profile', cardinality: 'one', state: 'control', content: second, sourceHash: 'synthetic', tokens: 1 }
    expect(requestedAIConfig(node(first), [control]).apiKey).toBe('SYNTHETIC_C_ONLY')
  })
  it('a cloud preset requiring a key stops before a request when its own key is missing', () => {
    useAIConfigStore.getState().setConfig({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '' })
    const id = useAIConfigStore.getState().saveAsPreset('缺少云端Key'); switchToB()
    expect(() => requestedAIConfig(node(id))).toThrow(/API Key/)
    expect(sent).toEqual([])
  })
  it.each(['custom', 'ollama', 'codex'] as const)('preserves the existing keyless %s contract without borrowing B', provider => {
    useAIConfigStore.getState().setConfig({ provider, baseUrl: 'http://localhost:11434/v1', apiKey: '' })
    const id = useAIConfigStore.getState().saveAsPreset('合法无Key'); switchToB()
    expect(requestedAIConfig(node(id)).apiKey).toBe('')
    expect(requestedAIConfig(node(id)).provider).toBe(provider)
  })
  it('an identical endpoint can reuse its explicitly configured key while preserving preset generation settings', () => {
    useAIConfigStore.getState().setConfig({ apiKey: '' })
    const id = useAIConfigStore.getState().saveAsPreset('同服务不同模型')
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://provider-a.invalid/v1/', model: 'another-model', apiKey: KEY_A, temperature: 0.9 })
    expect(requestedAIConfig(node(id))).toMatchObject({ apiKey: KEY_A, model: BASE.model, temperature: BASE.temperature })
  })
  it('no explicit profile uses a detached current config without modifying saved preferences', () => {
    const cfg = requestedAIConfig(node()); cfg.apiKey = KEY_B
    expect(useAIConfigStore.getState().config.apiKey).toBe(KEY_A)
  })
  it.each(AMBIGUOUS_ENDPOINTS)('ambiguous preset URL cannot borrow official service credentials: %s', baseUrl => {
    expect(new URL(baseUrl + '/chat/completions', 'https://author-app.invalid').origin).not.toBe('https://author-app.invalid')
    useAIConfigStore.getState().setConfig({ provider: 'openai', baseUrl, apiKey: '' })
    const id = useAIConfigStore.getState().saveAsPreset('新地址无Key')
    useAIConfigStore.getState().setConfig({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: KEY_A })
    expect(() => requestedAIConfig(node(id))).toThrow(/API Key/)
    useAIConfigStore.getState().applyPreset(id)
    expect(useAIConfigStore.getState().config.apiKey).toBe('')
    expect(sent).toEqual([])
  })
  it('a normal registered proxy preset can reuse its identical official service credential', () => {
    useAIConfigStore.getState().setConfig({ provider: 'openai', baseUrl: '/openai-proxy/v1', apiKey: '' })
    const id = useAIConfigStore.getState().saveAsPreset('正常同服务代理')
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://api.openai.com/v1', apiKey: KEY_A })
    expect(requestedAIConfig(node(id)).apiKey).toBe(KEY_A)
  })
  it.each(NONCANONICAL_ABSOLUTE)('a noncanonical absolute preset cannot borrow another connection key: %s', baseUrl => {
    useAIConfigStore.getState().setConfig({ provider: 'openai', baseUrl, apiKey: '' })
    const id = useAIConfigStore.getState().saveAsPreset('非标准新地址')
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://api.openai.com/v1', apiKey: KEY_A })
    expect(() => requestedAIConfig(node(id))).toThrow(/API Key/)
  })
  it('chat preset comparison follows the actual chat builder whitespace normalization', () => {
    useAIConfigStore.getState().setConfig({ provider: 'openai', baseUrl: ' https://api.openai.com/v1/ ', apiKey: '' })
    const id = useAIConfigStore.getState().saveAsPreset('正常聊天根地址')
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://api.openai.com/v1', apiKey: KEY_A })
    expect(requestedAIConfig(node(id)).apiKey).toBe(KEY_A)
  })
  it('a manual chat destination change clears a key that was not explicitly supplied for the new service', () => {
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://different-service.invalid/v1' })
    expect(useAIConfigStore.getState().config.apiKey).toBe('')
  })
})

describe('SFQA102 actual embedding controls and downstream index requests', () => {
  it('changing cloud destination clears the previous credential', async () => {
    await mountEmbeddingCard(); await click('通义 · v3')
    const cfg = useAIConfigStore.getState().embedding
    expect(cfg.provider).toBe('qwen'); expect(cfg.apiKey).toBe(''); expect(isEmbeddingReady(cfg)).toBe(false)
    expect(sent).toEqual([])
  })
  it('the supported local destination remains ready without an Authorization header', async () => {
    const created = await createWorkspace({ name: '合成本地检索', description: '', genres: [], targetWordCount: 10_000, status: 'drafting' }, { kind: 'novel', novelProfile: 'long', importedNovelText: '林岚收好车票，走进旧车站。' })
    useProjectStore.setState({ currentProjectId: created.scope.projectId })
    await mountEmbeddingCard(); await click('本地 Ollama · bge-m3'); await click('为当前项目历史章节建立检索索引'); await waitForIndexCompletion()
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every(item => item.url === 'http://localhost:11434/v1/embeddings' && item.authorization === null)).toBe(true)
  })
  it('a cloud switch sends no old key, then the actual index uses only its newly supplied key', async () => {
    const created = await createWorkspace({ name: '合成云检索', description: '', genres: [], targetWordCount: 10_000, status: 'drafting' }, { kind: 'novel', novelProfile: 'long', importedNovelText: '林岚收好车票，走进旧车站。' })
    useProjectStore.setState({ currentProjectId: created.scope.projectId })
    await mountEmbeddingCard(); await click('通义 · v3'); await click('为当前项目历史章节建立检索索引'); await waitForIndexCompletion()
    expect(sent).toEqual([])
    await act(async () => useAIConfigStore.getState().setEmbeddingConfig({ apiKey: KEY_QWEN }))
    await click('为当前项目历史章节建立检索索引'); await waitForIndexCompletion()
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every(item => item.authorization === `Bearer ${KEY_QWEN}` && /(?:qwen-proxy|dashscope\.aliyuncs\.com)/.test(item.url))).toBe(true)
  })
  it('the actual registered proxy/direct toggle preserves the same service credential', async () => {
    await mountEmbeddingCard(); await click('切换到本地代理')
    expect(useAIConfigStore.getState().embedding.apiKey).toBe(KEY_A)
    await click('切换到直连')
    expect(useAIConfigStore.getState().embedding.apiKey).toBe(KEY_A)
  })
  it('same-service preset, model and enabled edits preserve its own credential', async () => {
    await mountEmbeddingCard(); await click('通义 · v3')
    await act(async () => useAIConfigStore.getState().setEmbeddingConfig({ apiKey: KEY_QWEN }))
    await click('通义 · v3')
    await act(async () => useAIConfigStore.getState().setEmbeddingConfig({ model: 'same-authority-model', enabled: false }))
    expect(useAIConfigStore.getState().embedding.apiKey).toBe(KEY_QWEN)
  })
  it.each([
    'https://other-provider.invalid/v1',
    'https://api.openai.com/another-tenant/v1',
    'http://api.openai.com/v1',
    'https://api.openai.com/v1?tenant=other',
  ])('same provider with a different authorized endpoint clears the old key: %s', baseUrl => {
    useAIConfigStore.getState().setEmbeddingConfig({ baseUrl })
    expect(useAIConfigStore.getState().embedding.apiKey).toBe('')
  })
  it.each([false, true])('remember/session persistence and reload keep the newly selected identity, remember=%s', async remember => {
    useAIConfigStore.getState().setRememberApiKey(remember)
    useAIConfigStore.getState().setEmbeddingConfig({ provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'text-embedding-v3' })
    expect(useAIConfigStore.getState().embedding.apiKey).toBe('')
    const stored = JSON.parse(localStorage.getItem('storyforge-embedding-config')!) as { apiKey: string; provider: string }
    expect(stored.apiKey).toBe(''); expect(stored.provider).toBe('qwen')
    expect(sessionStorage.getItem('storyforge-embedding-key-session')).toBeNull()
    useAIConfigStore.getState().setEmbeddingConfig({ apiKey: KEY_QWEN })
    vi.resetModules()
    const reloaded = await import('../../src/stores/ai-config')
    expect(reloaded.useAIConfigStore.getState().embedding).toMatchObject({ provider: 'qwen', apiKey: KEY_QWEN })
    expect(JSON.parse(localStorage.getItem('storyforge-embedding-config')!).apiKey).toBe(remember ? KEY_QWEN : '')
    if (remember) expect(sessionStorage.getItem('storyforge-embedding-key-session')).toBeNull()
    else expect(sessionStorage.getItem('storyforge-embedding-key-session')).toContain(KEY_QWEN)
  })
  it.each(AMBIGUOUS_ENDPOINTS)('ambiguous embedding URL clears the official service key: %s', baseUrl => {
    useAIConfigStore.getState().setEmbeddingConfig({ baseUrl })
    expect(useAIConfigStore.getState().embedding.apiKey).toBe('')
  })
  it.each(['/\\different-service.invalid/v1', '/\n/different-service.invalid/v1'])('ambiguous unknown relative destination cannot preserve a same-path key: %s', baseUrl => {
    useAIConfigStore.getState().setEmbeddingConfig({ provider: 'custom', baseUrl: '/v1', apiKey: KEY_A })
    useAIConfigStore.getState().setEmbeddingConfig({ baseUrl })
    expect(useAIConfigStore.getState().embedding.apiKey).toBe('')
  })
  it('the same normal unknown relative service path retains its own credential', () => {
    useAIConfigStore.getState().setEmbeddingConfig({ provider: 'custom', baseUrl: '/gateway/v1', apiKey: KEY_A })
    useAIConfigStore.getState().setEmbeddingConfig({ baseUrl: '/gateway/v1/' })
    expect(useAIConfigStore.getState().embedding.apiKey).toBe(KEY_A)
  })
  it.each([...NONCANONICAL_ABSOLUTE, 'https://api.openai.com/v1 '])('a noncanonical embedding destination does not retain the official service key: %s', baseUrl => {
    useAIConfigStore.getState().setEmbeddingConfig({ baseUrl })
    expect(useAIConfigStore.getState().embedding.apiKey).toBe('')
  })
  it('nonidentity edits preserve an explicitly saved key even while its URL is incomplete', () => {
    useAIConfigStore.getState().setEmbeddingConfig({ baseUrl: 'unfinished custom address', apiKey: KEY_A })
    useAIConfigStore.getState().setEmbeddingConfig({ model: 'other-model', enabled: false })
    expect(useAIConfigStore.getState().embedding.apiKey).toBe(KEY_A)
  })
})

describe('053/102 stored credentials bind the exact saved owner and save generation', () => {
  const GLOBAL = 'storyforge-ai-api-key-session'
  const EMBEDDING = 'storyforge-embedding-key-session'
  const PRESET_KEYS = 'storyforge-ai-preset-api-keys-session'
  async function freshStore() {
    vi.resetModules()
    return import('../../src/stores/ai-config')
  }
  function failWrite(storage: Storage, name: string) {
    const original = storage.setItem.bind(storage)
    let failures = 0
    const spy = vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      if (key === name) { failures++; throw new DOMException('synthetic quota failure', 'QuotaExceededError') }
      original(key, value)
    })
    return { spy, count: () => failures }
  }
  it('failed preset session update cannot make freshly loaded B use A key', async () => {
    const id = useAIConfigStore.getState().saveAsPreset('原A')
    const oldSession = sessionStorage.getItem(PRESET_KEYS)
    switchToB()
    const fault = failWrite(sessionStorage, PRESET_KEYS)
    expect(() => useAIConfigStore.getState().updatePresetFromCurrent(id)).toThrow('synthetic quota failure')
    expect(fault.count()).toBe(1); fault.spy.mockRestore()
    expect(sessionStorage.getItem(PRESET_KEYS)).toBe(oldSession)
    const fresh = await freshStore()
    expect(fresh.useAIConfigStore.getState().presets.find(item => item.id === id)?.config.baseUrl).toBe('https://provider-b.invalid/v1')
    expect(fresh.getAIConfigPresetSessionApiKey(id)).toBe('')
    fresh.useAIConfigStore.getState().setConfig({ provider: 'qwen', baseUrl: 'https://provider-c.invalid/v1', apiKey: 'SYNTHETIC_C_ONLY' })
    fresh.useAIConfigStore.getState().applyPreset(id)
    expect(fresh.useAIConfigStore.getState().config.apiKey).toBe('')
    expect(sent).toEqual([])
  })
  it.each(['global', 'embedding'] as const)('a failed %s session write cannot pair B metadata with A key after reload', async kind => {
    const store = useAIConfigStore.getState()
    if (kind === 'global') store.setConfig({ ...BASE })
    else store.setEmbeddingConfig({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: KEY_A })
    const key = kind === 'global' ? GLOBAL : EMBEDDING, oldSession = sessionStorage.getItem(key)
    const fault = failWrite(sessionStorage, key)
    const save = () => kind === 'global'
      ? store.setConfig({ provider: 'deepseek', baseUrl: 'https://provider-b.invalid/v1', apiKey: KEY_B })
      : store.setEmbeddingConfig({ provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: KEY_QWEN })
    expect(save).toThrow('synthetic quota failure')
    expect(fault.count()).toBe(1); fault.spy.mockRestore()
    expect(sessionStorage.getItem(key)).toBe(oldSession)
    const fresh = (await freshStore()).useAIConfigStore.getState()
    expect(kind === 'global' ? fresh.config.apiKey : fresh.embedding.apiKey).toBe('')
    expect(sent).toEqual([])
  })
  it.each(['global', 'embedding'] as const)('a failed first local %s write preserves the complete old A/A pair', async kind => {
    const store = useAIConfigStore.getState()
    if (kind === 'global') store.setConfig({ ...BASE })
    else store.setEmbeddingConfig({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: KEY_A })
    const local = kind === 'global' ? 'storyforge-ai-config' : 'storyforge-embedding-config'
    const oldMetadata = localStorage.getItem(local), oldSession = sessionStorage.getItem(kind === 'global' ? GLOBAL : EMBEDDING)
    const fault = failWrite(localStorage, local)
    expect(() => kind === 'global'
      ? store.setConfig({ baseUrl: 'https://provider-b.invalid/v1', apiKey: KEY_B })
      : store.setEmbeddingConfig({ baseUrl: 'https://provider-b.invalid/v1', apiKey: KEY_B })).toThrow('synthetic quota failure')
    expect(fault.count()).toBe(1); fault.spy.mockRestore()
    expect(localStorage.getItem(local)).toBe(oldMetadata)
    expect(sessionStorage.getItem(kind === 'global' ? GLOBAL : EMBEDDING)).toBe(oldSession)
    const fresh = (await freshStore()).useAIConfigStore.getState()
    expect(kind === 'global' ? fresh.config.apiKey : fresh.embedding.apiKey).toBe(KEY_A)
  })
  it('even a same-endpoint credential replacement needs its matching save generation', async () => {
    useAIConfigStore.getState().setConfig({ ...BASE })
    const fault = failWrite(sessionStorage, GLOBAL)
    expect(() => useAIConfigStore.getState().setConfig({ apiKey: KEY_B })).toThrow('synthetic quota failure')
    fault.spy.mockRestore()
    expect((await freshStore()).useAIConfigStore.getState().config.apiKey).toBe('')
  })
  it('a local metadata update from another tab cannot consume this tab’s older session key', async () => {
    useAIConfigStore.getState().setConfig({ ...BASE })
    const oldSession = sessionStorage.getItem(GLOBAL)
    switchToB()
    // Model separate-tab sessionStorage while sharing the newer localStorage.
    sessionStorage.setItem(GLOBAL, oldSession!)
    const fresh = (await freshStore()).useAIConfigStore.getState()
    expect(fresh.config.baseUrl).toBe('https://provider-b.invalid/v1')
    expect(fresh.config.apiKey).toBe('')
  })
  it('old unbound temporary global keys stay stored but are not sent or silently rebound during model normalization', async () => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ ...BASE, provider: 'deepseek', model: 'deepseek-chat', apiKey: '' }))
    localStorage.setItem('storyforge-ai-api-key-remember', 'false'); sessionStorage.setItem(GLOBAL, KEY_A)
    const fresh = (await freshStore()).useAIConfigStore.getState()
    expect(fresh.config.apiKey).toBe('')
    expect(sessionStorage.getItem(GLOBAL)).toBe(KEY_A)
    expect(sent).toEqual([])
  })
  it('old unbound embedding keys require explicit saving once, then restore normally', async () => {
    localStorage.setItem('storyforge-embedding-config', JSON.stringify({ enabled: true, provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small', apiKey: '' }))
    sessionStorage.setItem(EMBEDDING, KEY_A)
    const first = (await freshStore()).useAIConfigStore
    expect(first.getState().embedding.apiKey).toBe('')
    expect(sessionStorage.getItem(EMBEDDING)).toBe(KEY_A)
    first.getState().setEmbeddingConfig({ apiKey: KEY_A })
    expect((await freshStore()).useAIConfigStore.getState().embedding.apiKey).toBe(KEY_A)
  })
  it('old unbound preset keys cannot bypass the public session getter', async () => {
    const id = 'legacy-preset'
    localStorage.setItem('storyforge-ai-presets', JSON.stringify([{ id, name: '旧临时预设', config: { ...BASE, apiKey: '' } }]))
    const raw = JSON.stringify({ [id]: KEY_A }); sessionStorage.setItem(PRESET_KEYS, raw)
    const fresh = await freshStore()
    expect(fresh.getAIConfigPresetSessionApiKey(id)).toBe('')
    expect(sessionStorage.getItem(PRESET_KEYS)).toBe(raw)
  })
})


describe('SFQA053/102 credential configuration UI', () => {
  it.each(['LM Studio', '本地 Ollama'])('the %s shortcut cannot forward an existing remote key to localhost', async label => {
    useAIConfigStore.setState({ config: { ...BASE } })
    await mountSettingsPanel()
    await click(label)
    const config = useAIConfigStore.getState().config
    expect(config.baseUrl).toBe(label === 'LM Studio' ? 'http://localhost:1234/v1' : 'http://localhost:11434/v1')
    expect(config.apiKey).toBe('')
    expect(sent).toEqual([])
  })
  it.each(['chat', 'embedding'] as const)('an unmatched %s temporary key gives an actionable hint without showing the key', async kind => {
    if (kind === 'chat') {
      useAIConfigStore.setState({ config: { ...BASE, apiKey: '' } })
      sessionStorage.setItem('storyforge-ai-api-key-session', KEY_A)
      await mountSettingsPanel()
    } else {
      useAIConfigStore.setState({ embedding: { ...useAIConfigStore.getState().embedding, apiKey: '' } })
      sessionStorage.setItem('storyforge-embedding-key-session', KEY_A)
      await mountEmbeddingCard()
    }
    expect(host!.textContent).toContain('临时 API Key 未能与当前配置匹配')
    expect(host!.textContent).toContain('重新填写')
    expect(host!.textContent).not.toContain(KEY_A)
    expect(sent).toEqual([])
    await act(async () => {
      if (kind === 'chat') useAIConfigStore.getState().setConfig({ apiKey: KEY_A })
      else useAIConfigStore.getState().setEmbeddingConfig({ apiKey: KEY_A })
    })
    expect(host!.textContent).not.toContain('临时 API Key 未能与当前配置匹配')
  })
})


describe('053/102 query namespaces and provider default resets', () => {
  it.each(['?tenant=a', '?'])('query-bearing /v1 and /v1/ cannot borrow a key across distinct actual paths: %s', query => {
    const from = 'https://api.openai.com/v1' + query, to = 'https://api.openai.com/v1/' + query
    expect(new URL(from + '/embeddings').pathname).not.toBe(new URL(to + '/embeddings').pathname)
    useAIConfigStore.getState().setEmbeddingConfig({ provider: 'openai', baseUrl: from, apiKey: KEY_A })
    useAIConfigStore.getState().setEmbeddingConfig({ baseUrl: to })
    expect(useAIConfigStore.getState().embedding.apiKey).toBe('')
    useAIConfigStore.getState().setConfig({ provider: 'openai', baseUrl: to, apiKey: '' })
    const id = useAIConfigStore.getState().saveAsPreset('另一query路径')
    useAIConfigStore.getState().setConfig({ baseUrl: from, apiKey: KEY_A })
    expect(() => requestedAIConfig(node(id))).toThrow(/API Key/)
    useAIConfigStore.getState().applyPreset(id)
    expect(useAIConfigStore.getState().config.apiKey).toBe('')
  })
  it.each(['?tenant=a', '?'])('an identical query URL retains its own key and can reuse that exact connection: %s', query => {
    const baseUrl = 'https://api.openai.com/v1' + query
    useAIConfigStore.getState().setEmbeddingConfig({ provider: 'openai', baseUrl, apiKey: KEY_A })
    useAIConfigStore.getState().setEmbeddingConfig({ baseUrl })
    expect(useAIConfigStore.getState().embedding.apiKey).toBe(KEY_A)
    useAIConfigStore.getState().setConfig({ provider: 'openai', baseUrl, apiKey: '' })
    const id = useAIConfigStore.getState().saveAsPreset('相同query服务')
    useAIConfigStore.getState().setConfig({ baseUrl, apiKey: KEY_A })
    expect(requestedAIConfig(node(id)).apiKey).toBe(KEY_A)
  })
  it.each(['https://api.openai.com/v1', '/openai-proxy/v1'])('a provider default reset preserves credentials only at its registered equivalent endpoint: %s', baseUrl => {
    useAIConfigStore.getState().setConfig({ provider: 'openai', baseUrl, apiKey: KEY_A })
    useAIConfigStore.getState().switchProvider('openai')
    expect(useAIConfigStore.getState().config.apiKey).toBe(KEY_A)
    expect(useAIConfigStore.getState().config.baseUrl).toBe('https://api.openai.com/v1')
  })
  it('reselecting a provider cannot transfer a private endpoint key into its default official endpoint', () => {
    useAIConfigStore.getState().setConfig({ provider: 'openai', baseUrl: 'https://private-compatible.invalid/v1', apiKey: KEY_A })
    useAIConfigStore.getState().switchProvider('openai')
    expect(useAIConfigStore.getState().config).toMatchObject({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '' })
  })
  it('selecting another provider clears credentials while Codex keeps its existing keyless contract', () => {
    useAIConfigStore.getState().switchProvider('openai')
    expect(useAIConfigStore.getState().config.apiKey).toBe('')
    useAIConfigStore.getState().setConfig({ apiKey: KEY_A })
    useAIConfigStore.getState().switchProvider('codex')
    expect(useAIConfigStore.getState().config).toMatchObject({ provider: 'codex', apiKey: '', baseUrl: '/storyforge/local-codex/v1' })
  })
})
