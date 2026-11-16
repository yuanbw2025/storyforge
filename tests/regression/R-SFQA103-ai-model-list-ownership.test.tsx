import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AIConfigPanel from '../../src/components/settings/AIConfigPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { useAIConfigStore } from '../../src/stores/ai-config'
import type { AIConfig } from '../../src/lib/types'

const BASE: AIConfig = { provider: 'custom', baseUrl: 'https://sfqa103-a.invalid/v1',
  apiKey: 'SFQA103_SYNTHETIC_A', model: 'manual-model', temperature: 0.4, maxTokens: 1000 }
interface Request {
  url: string
  resolve: (response: Response) => void
  reject: (cause: Error) => void
  settled: boolean
}
let host: HTMLDivElement, root: Root | undefined
let requests: Request[]
const original = useAIConfigStore.getState()
const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const reactFlag = reactEnvironment.IS_REACT_ACT_ENVIRONMENT

async function mount() {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(createElement(DialogProvider, null, createElement(AIConfigPanel))))
}
function refresh() {
  const button = [...host.querySelectorAll('button')].find(row => row.title === '从当前服务刷新模型列表')
  if (!button) throw new Error('Missing actual refresh control')
  return button
}
function list() { return host.querySelector<HTMLSelectElement>('[aria-label="服务返回的模型列表"]') }
function options() { return [...list()?.options ?? []].map(row => row.value).filter(Boolean) }
async function start(count = 1) {
  await act(async () => { for (let index = 0; index < count; index++) refresh().click() })
}
async function respond(index: number, models: string[]) {
  const request = requests[index]
  if (!request || request.settled) throw new Error('Missing unsettled real model-list request')
  request.settled = true
  await act(async () => request.resolve(Response.json({ data: models.map(id => ({ id })) })))
}
async function reject(index: number, error: Error) {
  const request = requests[index]
  if (!request || request.settled) throw new Error('Missing unsettled real model-list request')
  request.settled = true
  await act(async () => request.reject(error))
}
async function configure(partial: Partial<AIConfig>) {
  await act(async () => useAIConfigStore.getState().setConfig(partial))
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear(); sessionStorage.clear(); requests = []
  useAIConfigStore.setState({ config: { ...BASE }, presets: [], taskRoutes: {}, activePresetId: null,
    editingPresetId: null, rememberApiKey: false, embedding: { ...original.embedding, enabled: false } })
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => new Promise<Response>((resolve, reject) => {
    const url = String(input)
    if (!url.endsWith('/models')) { reject(new Error('Unexpected request outside isolated model-list transport')); return }
    requests.push({ url, resolve, reject, settled: false })
  })))
  await mount()
})
afterEach(async () => {
  await act(async () => {
    root?.unmount(); root = undefined
    for (const request of requests) if (!request.settled) {
      request.settled = true; request.resolve(Response.json({ data: [] }))
    }
  })
  host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks()
  useAIConfigStore.setState(original, true)
  localStorage.clear(); sessionStorage.clear()
  if (reactFlag === undefined) delete reactEnvironment.IS_REACT_ACT_ENVIRONMENT
  else Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: reactFlag })
})

describe('SFQA103 · mounted settings model-list ownership', () => {
  it('does not publish endpoint A options after a switch to B', async () => {
    await start(); expect(requests).toHaveLength(1)
    await configure({ baseUrl: 'https://sfqa103-b.invalid/v1', apiKey: 'SFQA103_SYNTHETIC_B' })
    await respond(0, ['only-at-A'])
    expect(options()).toEqual([])
    expect(useAIConfigStore.getState().config.model).toBe('manual-model')
    expect(refresh().disabled).toBe(false)
  })

  it('does not publish options from the old private credential at the same endpoint', async () => {
    await start()
    await configure({ apiKey: 'SFQA103_SYNTHETIC_REPLACEMENT' })
    await respond(0, ['prior-credential-only'])
    expect(options()).toEqual([])
    expect(useAIConfigStore.getState().config.model).toBe('manual-model')
  })

  it('invalidates a provider change even when endpoint and private credential are equal', async () => {
    await start()
    await configure({ provider: 'agnes', baseUrl: BASE.baseUrl, apiKey: BASE.apiKey })
    await respond(0, ['previous-provider-only'])
    expect(options()).toEqual([])
    expect(useAIConfigStore.getState().config.model).toBe('manual-model')
  })

  it('a newer refresh wins when same-owner requests resolve out of order', async () => {
    await start(2); expect(requests).toHaveLength(2)
    await respond(1, ['newer-response'])
    await respond(0, ['older-response'])
    expect(options()).toEqual(['newer-response'])
  })

  it('an old failure cannot erase the current request success', async () => {
    await start(2); expect(requests).toHaveLength(2)
    await respond(1, ['current-success'])
    await reject(0, new Error('old request failure'))
    expect(options()).toEqual(['current-success'])
    expect(host.textContent).not.toContain('old request failure')
  })

  it('an old finally cannot clear the current request loading', async () => {
    await start(2); expect(requests).toHaveLength(2)
    await respond(0, ['older-while-current-pending'])
    expect(refresh().disabled).toBe(true)
    expect(refresh().textContent).toContain('刷新中')
    expect(options()).toEqual([])
    await respond(1, ['current'])
    expect(refresh().disabled).toBe(false)
    expect(options()).toEqual(['current'])
  })

  it('keeps a previous option from writing into a new destination before React commits its rerender', async () => {
    await start(); await respond(0, ['only-at-A'])
    const oldList = list()
    if (!oldList) throw new Error('Missing current actual returned-model select')
    await act(async () => {
      useAIConfigStore.getState().setConfig({ baseUrl: 'https://sfqa103-b.invalid/v1', apiKey: 'SFQA103_SYNTHETIC_B' })
      oldList.value = 'only-at-A'; oldList.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(useAIConfigStore.getState().config.model).toBe('manual-model')
    expect(options()).toEqual([])
  })

  it('invalidates an A to B to A owner change even within one React batch', async () => {
    await start()
    await act(async () => {
      const store = useAIConfigStore.getState()
      store.setConfig({ baseUrl: 'https://sfqa103-b.invalid/v1', apiKey: 'SFQA103_SYNTHETIC_B' })
      store.setConfig({ baseUrl: BASE.baseUrl, apiKey: BASE.apiKey })
    })
    await respond(0, ['superseded-before-owner-return'])
    expect(options()).toEqual([])
  })

  it('clears the old loading owner so B can refresh while A remains pending', async () => {
    await start()
    await configure({ baseUrl: 'https://sfqa103-b.invalid/v1', apiKey: 'SFQA103_SYNTHETIC_B' })
    expect(refresh().disabled).toBe(false)
    await start(); expect(requests.map(row => row.url)).toEqual([
      'https://sfqa103-a.invalid/v1/models', 'https://sfqa103-b.invalid/v1/models',
    ])
    await respond(1, ['only-at-B']); await respond(0, [])
    expect(options()).toEqual(['only-at-B'])
    expect(host.textContent).not.toContain('空模型列表')
  })

  it('retains same-owner results and manual editing while a refresh is pending', async () => {
    await start(); await respond(0, ['current-option'])
    await start(); expect(options()).toEqual(['current-option'])
    const manual = host.querySelector<HTMLInputElement>('[placeholder="手动输入模型名"]')
    if (!manual) throw new Error('Missing actual manual model control')
    expect(manual.disabled).toBe(false)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(manual, 'author-chosen-model')
      manual.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await respond(1, ['fresh-option'])
    expect(useAIConfigStore.getState().config.model).toBe('author-chosen-model')
    expect(options()).toEqual(['fresh-option'])
  })

  it('accepts normalized same-owner success and the current selected option', async () => {
    await configure({ baseUrl: 'https://sfqa103-a.invalid/v1/chat/completions' })
    await start(); expect(requests[0].url).toBe('https://sfqa103-a.invalid/v1/models')
    await respond(0, ['available-model'])
    const current = list()
    if (!current) throw new Error('Missing returned current option')
    await act(async () => { current.value = 'available-model'; current.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(useAIConfigStore.getState().config.model).toBe('available-model')
    expect(useAIConfigStore.getState().config.baseUrl).toBe(BASE.baseUrl)
    expect(JSON.stringify(localStorage)).not.toContain(BASE.apiKey)
  })

  it('keeps current empty and error results visible without overwriting the manual model', async () => {
    await start(); await respond(0, [])
    expect(host.textContent).toContain('空模型列表')
    expect(refresh().disabled).toBe(false)
    await start(); await reject(1, new Error('current service failure'))
    expect(host.textContent).toContain('current service failure')
    expect(refresh().disabled).toBe(false)
    expect(useAIConfigStore.getState().config.model).toBe('manual-model')
  })

  it('does not publish an unmounted panel response into a later mounted panel', async () => {
    await start()
    await act(async () => root!.unmount()); root = undefined; host.remove()
    await configure({ baseUrl: 'https://sfqa103-b.invalid/v1', apiKey: 'SFQA103_SYNTHETIC_B' })
    await mount(); await start(); await respond(1, ['mounted-B'])
    await respond(0, ['unmounted-A'])
    expect(options()).toEqual(['mounted-B'])
    expect(useAIConfigStore.getState().config.model).toBe('manual-model')
  })
})
