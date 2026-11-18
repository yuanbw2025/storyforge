import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import FailureFeedbackPanel from '../../src/components/shared/FailureFeedbackPanel'
import { TELEMETRY_KEY, setTelemetryPreferences, telemetryPreferences, recordClientActivity, recordClientError, flushClientTelemetry, deleteClientTelemetry } from '../../src/lib/feedback/client-telemetry'
import { APP_BUILD_ID } from '../../src/lib/version'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let container: HTMLDivElement | undefined
beforeEach(() => { localStorage.clear(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true) })
afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); root = undefined; vi.restoreAllMocks(); vi.useRealTimers() })
it('does not collect without consent, deduplicates active days, and drops pending data on opt out', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => { const body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ accepted: body.events.map((row: { id: string }) => row.id), discarded: [] })) })
  recordClientActivity(); await flushClientTelemetry(); expect(fetcher).not.toHaveBeenCalled(); expect(localStorage.getItem(TELEMETRY_KEY)).toBeNull()
  setTelemetryPreferences(true, false); recordClientActivity(); recordClientActivity(); await flushClientTelemetry()
  expect(fetcher).toHaveBeenCalledTimes(1)
  const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body)); expect(sent.events).toHaveLength(1)
  expect(sent.events[0].kind).toBe('active'); expect(sent.events[0]).not.toHaveProperty('attempts')
  const identity = sent.installationId
  setTelemetryPreferences(true, true); recordClientError({ occurredAt: new Date().toISOString(), source: 'react', name: 'Error', build: APP_BUILD_ID, frames: [] })
  setTelemetryPreferences(false, false); await flushClientTelemetry()
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).id).toBe(identity)
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue).toEqual([])
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('sanitizes forged persisted errors before sending and never records a background active day', async () => {
  setTelemetryPreferences(false, true)
  recordClientError({ occurredAt: new Date().toISOString(), source: 'react', name: 'Error', build: APP_BUILD_ID, frames: ['/storyforge/assets/index-abc.js:2:4'] })
  const state = JSON.parse(localStorage.getItem(TELEMETRY_KEY)!); state.queue[0].error.message = 'sk-SECRET manuscript'; state.queue[0].client.apiKey = 'SECRET'; state.queue[0].payload = 'SECRET'; localStorage.setItem(TELEMETRY_KEY, JSON.stringify(state))
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ accepted: [], discarded: [] })))
  await flushClientTelemetry(); expect(String(fetcher.mock.calls[0][1]?.body)).not.toContain('SECRET')
  setTelemetryPreferences(true, false); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden'); recordClientActivity()
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue).toHaveLength(0)
})
it('backs off after a failed upload, keeps its event id, and forgets only after a deletion receipt', async () => {
  vi.useFakeTimers(); const time = Date.now()
  setTelemetryPreferences(true, false); recordClientActivity()
  const first = JSON.parse(localStorage.getItem(TELEMETRY_KEY)!); const id = first.queue[0].id
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'))
  await flushClientTelemetry(); await flushClientTelemetry(); expect(fetcher).toHaveBeenCalledTimes(1)
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue[0].id).toBe(id)
  vi.setSystemTime(time + 301000); await flushClientTelemetry(); expect(fetcher).toHaveBeenCalledTimes(2)
  await expect(deleteClientTelemetry()).rejects.toThrow(); expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).id).toBe(first.id)
  fetcher.mockResolvedValue(new Response(JSON.stringify({ deleted: true }))); await deleteClientTelemetry()
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).id).not.toBe(first.id)
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).analytics).toBe(false)
})
it('stops this session when saving opt-out fails and does not falsely confirm durable deletion settings', async () => {
  setTelemetryPreferences(true, true); recordClientActivity()
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ deleted: true })))
  const storage = localStorage
  vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage), setItem: () => { throw new DOMException('full', 'QuotaExceededError') } })
  try {
    expect(setTelemetryPreferences(false, false)).toBe(false)
    expect(telemetryPreferences()).toMatchObject({ analytics: false, errors: false })
    recordClientActivity(Date.now() + 86_400_000)
    recordClientError({ occurredAt: new Date().toISOString(), source: 'react', name: 'Error', build: APP_BUILD_ID, frames: [] })
    await flushClientTelemetry(); expect(fetcher).not.toHaveBeenCalled()
    await expect(deleteClientTelemetry()).rejects.toThrow('本机无法保存关闭选择')
    await flushClientTelemetry(); expect(fetcher).toHaveBeenCalledTimes(1)
  } finally { vi.unstubAllGlobals(); setTelemetryPreferences(false, false) }
})
async function fill(label: string, value: string) {
  const wrapper = [...container!.querySelectorAll('label')].find(node => node.textContent?.startsWith(label))!
  const element = wrapper.querySelector('input,textarea') as HTMLInputElement | HTMLTextAreaElement
  const prototype = element.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) })
}
it('reports a non-crashing bug in-app, preserves input on failure, retries with the same id, and supports suggestions', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => { if (String(url).endsWith('/capabilities')) return new Response(JSON.stringify({feedbackForm:2,feedbackImages:1})); throw new TypeError('network') })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(createElement(FailureFeedbackPanel)))
  await act(async () => [...container!.querySelectorAll('button')].find(node => node.textContent === '报告 Bug')!.click())
  await fill('标题', '按钮没有响应'); await fill('问题描述', '点击导出按钮后没有任何变化'); await fill('涉及模块', '世界引擎'); await fill('复现步骤', '点击导出'); await fill('实际结果', '没有响应'); await fill('期望结果', '完成导出')
  const send = () => act(async () => container!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await send(); expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toContain('点击导出')
  const posts = () => fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
  const first = JSON.parse(String(posts()[0][1]?.body)); expect(first.kind).toBe('bug'); expect(first).not.toHaveProperty('diagnostics')
  fetcher.mockImplementation(async (url, init) => new Response(JSON.stringify(String(url).endsWith('/capabilities') ? {feedbackForm:2,feedbackImages:1} : { accepted: true, id: JSON.parse(String(init?.body)).id })))
  await send(); expect(JSON.parse(String(posts()[1][1]?.body)).id).toBe(first.id); expect(container.textContent).toContain('提交成功')
  await act(async () => [...container!.querySelectorAll('button')].find(node => node.textContent === '功能建议')!.click())
  await fill('标题', '希望增加导出格式'); await fill('涉及模块', '导出'); await fill('建议与使用场景', '我希望将作品导出为其他格式'); await fill('希望怎样改进', '增加其他格式')
  await send(); expect(JSON.parse(String(posts()[2][1]?.body)).kind).toBe('feature')
})

it('does not requeue an acknowledged native occurrence when the diagnostic history is replayed', async () => {
  vi.useFakeTimers()
  const occurrence = {
    occurredAt: new Date(Date.now() - 120_000).toISOString(),
    source: 'native' as const, name: 'NativeInterrupted', build: 'v4.0.3+local', frames: [],
  }
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ accepted: body.events.map((row: { id: string }) => row.id), discarded: [] }))
  })
  setTelemetryPreferences(false, true)
  recordClientError(occurrence)
  await flushClientTelemetry()
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue).toEqual([])
  await vi.advanceTimersByTimeAsync(61_000)
  // Native history can outlive the rotating 20-row browser summary. The same
  // occurrence must not become a fresh server event when collected again.
  recordClientError(occurrence)
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue).toEqual([])
  await flushClientTelemetry()
  expect(fetcher).toHaveBeenCalledTimes(1)
  recordClientError({ ...occurrence, occurredAt: new Date().toISOString() })
  await flushClientTelemetry()
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('keeps distinct native occurrences within the same minute and clears their replay cache on withdrawal', async () => {
  setTelemetryPreferences(false, true)
  const first = { occurredAt: new Date(Date.now() - 2_000).toISOString(), source: 'native' as const, name: 'NativeCrash', build: APP_BUILD_ID, frames: [] }
  recordClientError(first)
  recordClientError({ ...first, occurredAt: new Date(Date.now() - 1_000).toISOString() })
  recordClientError(first)
  const state = JSON.parse(localStorage.getItem(TELEMETRY_KEY)!)
  expect(state.queue).toHaveLength(2)
  expect(new Set(state.queue.map((row: { id: string }) => row.id)).size).toBe(2)
  expect(state.nativeSeen).toHaveLength(2)
  setTelemetryPreferences(false, false)
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!)).toMatchObject({ queue: [], nativeSeen: [] })
})
it('bounds and sanitizes remembered native metadata, expires it and accepts legacy states without a cache', async () => {
  setTelemetryPreferences(false, true)
  const original = JSON.parse(localStorage.getItem(TELEMETRY_KEY)!)
  delete original.nativeSeen
  localStorage.setItem(TELEMETRY_KEY, JSON.stringify(original))
  const occurrence = { occurredAt: new Date().toISOString(), source: 'native' as const, name: 'NativeCrash', build: APP_BUILD_ID, frames: [] }
  recordClientError(occurrence)
  const state = JSON.parse(localStorage.getItem(TELEMETRY_KEY)!)
  state.nativeSeen = [
    ...Array.from({ length: 25 }, (_, i) => ({ ...occurrence, occurredAt: new Date(Date.now() - i * 1_000).toISOString(), message: 'PRIVATE-SENTINEL' })),
    { ...occurrence, occurredAt: new Date(Date.now() - 8 * 86_400_000).toISOString() },
    { ...occurrence, source: 'invalid-source' },
  ]
  localStorage.setItem(TELEMETRY_KEY, JSON.stringify(state))
  recordClientError({ ...occurrence, occurredAt: new Date(Date.now() - 100_000).toISOString() })
  const saved = JSON.parse(localStorage.getItem(TELEMETRY_KEY)!)
  expect(saved.nativeSeen.length).toBeLessThanOrEqual(20)
  expect(saved.nativeSeen.every((row: { occurredAt: string; source: string }) => row.source === 'native' && Date.parse(row.occurredAt) >= Date.now() - 7 * 86_400_000)).toBe(true)
  expect(JSON.stringify(saved)).not.toContain('PRIVATE-SENTINEL')
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ deleted: true })))
  await deleteClientTelemetry()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!)).toMatchObject({ queue: [], nativeSeen: [], errors: false })
})
it('replayed native history retains the existing id and bounded retry count after an unknown upload result', async () => {
  vi.useFakeTimers()
  setTelemetryPreferences(false, true)
  const occurrence = { occurredAt: new Date(Date.now() - 120_000).toISOString(), source: 'native' as const, name: 'NativeInterrupted', build: APP_BUILD_ID, frames: [] }
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network result unknown'))
  recordClientError(occurrence)
  const id = JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue[0].id
  for (let attempt = 0; attempt < 5; attempt++) {
    await flushClientTelemetry()
    recordClientError(occurrence)
    const pending = JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue
    expect(pending).toHaveLength(attempt === 4 ? 0 : 1)
    if (pending.length) expect(pending[0].id).toBe(id)
    await vi.advanceTimersByTimeAsync(301_000)
  }
  recordClientError(occurrence)
  await flushClientTelemetry()
  expect(fetcher).toHaveBeenCalledTimes(5)
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue).toEqual([])
})
