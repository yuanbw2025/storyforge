import { describe, expect, it, vi } from 'vitest'
import { createDesktopFetch } from '../../src/lib/platform/desktop-fetch'

function fixture() {
  const native = { open: vi.fn(async () => ({ status: 200, headers: { 'content-type': 'application/json' } })),
    read: vi.fn(async () => ({ done: true })), cancel: vi.fn(async () => {}) }
  const browser = vi.fn(async () => new Response('browser'))
  return { native, browser, fetch: createDesktopFetch(native, browser, 'http://localhost:17831') }
}
describe('Desktop model transport selection', () => {
  it.each(['models', 'chat/completions', 'embeddings', 'messages', 'responses'])('uses desktop networking for custom %s only once', async endpoint => {
    const f = fixture(); const response = await f.fetch(`https://custom.example/prefix/v1/${endpoint}`, {
      method: endpoint === 'models' ? 'GET' : 'POST', headers: { Authorization: 'Bearer synthetic-only' },
    })
    await response.text()
    expect(f.native.open).toHaveBeenCalledTimes(1); expect(f.browser).not.toHaveBeenCalled()
    expect(f.native.open.mock.calls[0][0]).toMatchObject({ url: `https://custom.example/prefix/v1/${endpoint}` })
  })
  it('preserves explicit local HTTP models, local assets/proxies and non-model browser requests', async () => {
    const f = fixture(); await (await f.fetch('http://127.0.0.1:11434/v1/models')).text()
    expect(f.native.open).toHaveBeenCalledTimes(1)
    for (const url of ['/storyforge/assets/app.js', '/openai-proxy/v1/models', 'https://site.example/metrics', 'https://site.example/releases/latest']) {
      expect(await (await f.fetch(url)).text()).toBe('browser')
    }
    expect(f.browser).toHaveBeenCalledTimes(4); expect(f.native.open).toHaveBeenCalledTimes(1)
  })
  it('does not try browser or native again after dispatch error, and abort before dispatch sends nothing', async () => {
    const f = fixture(); const abort = new AbortController(); abort.abort()
    await expect(f.fetch('https://custom.example/v1/models', { signal: abort.signal })).rejects.toThrow()
    expect(f.native.open).not.toHaveBeenCalled()
    f.native.open.mockRejectedValueOnce(new Error('unknown dispatch'))
    await expect(f.fetch('https://custom.example/v1/models')).rejects.toThrow('unknown dispatch')
    expect(f.native.open).toHaveBeenCalledTimes(1); expect(f.browser).not.toHaveBeenCalled()
  })
})
