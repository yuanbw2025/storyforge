/**
 * R-list-models · OpenAI-compatible GET /models helper
 * Guards: URL build (incl. custom-proxy), parse id/name, empty/malformed, HTTP 401, auth header.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listOpenAIModels,
  parseOpenAIModelsResponse,
} from '../../src/lib/ai/list-models'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parseOpenAIModelsResponse', () => {
  it('extracts unique non-empty ids (id preferred, name fallback) and sorts', () => {
    const models = parseOpenAIModelsResponse({
      data: [
        { id: 'm1' },
        { id: 'm2' },
        { name: 'only-name' },
        { id: 'm1' },
        { id: '' },
        { name: '  ' },
        { id: 123 },
        null,
      ],
    })
    expect(models).toEqual(['m1', 'm2', 'only-name'].sort((a, b) => a.localeCompare(b)))
  })

  it('returns [] for empty data', () => {
    expect(parseOpenAIModelsResponse({ data: [] })).toEqual([])
  })

  it('returns [] for missing data / wrong shape', () => {
    expect(parseOpenAIModelsResponse({})).toEqual([])
    expect(parseOpenAIModelsResponse(null)).toEqual([])
    expect(parseOpenAIModelsResponse({ data: 'nope' })).toEqual([])
    expect(parseOpenAIModelsResponse(undefined)).toEqual([])
  })
})

describe('listOpenAIModels', () => {
  it('GETs https://api.example.com/v1/models and parses sample payload', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: 'm1' }, { id: 'm2' }, { name: 'only-name' }],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await listOpenAIModels({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.models).toEqual(
      ['m1', 'm2', 'only-name'].sort((a, b) => a.localeCompare(b)),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/models')
    expect(url.endsWith('/models')).toBe(true)
    expect(init.method).toBe('GET')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test')
  })

  it('proxy base /custom-proxy/... maps to .../models', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'local-a' }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await listOpenAIModels({
      baseUrl: '/custom-proxy/https/api.example.com/v1',
      apiKey: '',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.models).toEqual(['local-a'])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/custom-proxy/https/api.example.com/v1/models')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('HTTP 401 → ok false with Chinese-friendly message', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await listOpenAIModels({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'bad',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message.length).toBeGreaterThan(0)
    expect(result.message).toMatch(/HTTP 401/)
    expect(result.message).toMatch(/Invalid API key|认证/i)
    expect('models' in result).toBe(false)
  })

  it('Authorization header only when apiKey is non-empty', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await listOpenAIModels({ baseUrl: 'https://api.example.com/v1', apiKey: '' })
    const headersEmpty = (fetchMock.mock.calls[0] as [string, RequestInit])[1]
      .headers as Record<string, string>
    expect(headersEmpty.Authorization).toBeUndefined()

    await listOpenAIModels({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x' })
    const headersSet = (fetchMock.mock.calls[1] as [string, RequestInit])[1]
      .headers as Record<string, string>
    expect(headersSet.Authorization).toBe('Bearer sk-x')
  })

  it('empty data → ok true with empty models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      })),
    )

    const result = await listOpenAIModels({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
    })
    expect(result).toEqual({ ok: true, models: [] })
  })

  it('missing data shape → ok true with empty models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      })),
    )

    const result = await listOpenAIModels({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
    })
    expect(result).toEqual({ ok: true, models: [] })
  })

  it('Failed to fetch TypeError → CORS/network Chinese message', async () => {
    const err = new TypeError('Failed to fetch')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw err
      }),
    )

    const result = await listOpenAIModels({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toMatch(/网络|CORS|Base URL/)
  })

  it('AbortError → 请求超时', async () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw err
      }),
    )

    const result = await listOpenAIModels({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toBe('请求超时')
  })
})
