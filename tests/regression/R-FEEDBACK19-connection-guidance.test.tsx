import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AIConnectionTestSection from '../../src/components/settings/AIConnectionTestSection'
import { useAIConfigStore } from '../../src/stores/ai-config'
import type { AIProvider } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: ReturnType<typeof createRoot> | undefined
async function render(provider: AIProvider, isDevelopment: boolean, message: string) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(createElement(AIConnectionTestSection, {
    testing: false, result: { ok: false, message }, configReady: true, provider,
    logCount: 1, showLogs: false, isDevelopment, onTest() {}, onToggleLogs() {},
  })))
  return host.textContent!
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host?.remove(); vi.unstubAllGlobals() })
describe('Feedback #19: actionable CORS diagnostics', () => {
  it('explains custom gateway configuration without promising an unavailable proxy', async () => {
    const text = await render('custom', true, '网络错误 CORS')
    expect(text).toContain('没有内置通用代理')
    expect(text).toContain('OPTIONS'); expect(text).toContain('Authorization')
    expect(text).not.toContain('切换到本地代理')
  })
  it('keeps official local proxy advice scoped to official endpoints', async () => {
    expect(await render('deepseek', true, 'CORS')).toContain('仅转发到该服务商官方地址')
  })
  it('does not advertise dev proxy or claim Gemini is CORS-compatible on deployed sites', async () => {
    const text = await render('gemini', false, '网络错误')
    expect(text).toContain('同源反向代理'); expect(text).not.toContain('本地代理')
  })
  it('does not misdiagnose HTTP 401 as CORS', async () => {
    expect(await render('custom', true, 'HTTP 401')).not.toContain('OPTIONS')
  })
  it.each(['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.'])('recognizes browser network failure: %s', async message => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(message)))
    useAIConfigStore.setState({ config: { provider: 'custom', model: 'test-model', baseUrl: 'https://test.invalid/v1', apiKey: 'test-only-key', maxTokens: 100 } })
    const result = await useAIConfigStore.getState().testConnection()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('无法据此判断 Key 是否正确')
    expect(result.message).toContain('CORS')
  })
})
