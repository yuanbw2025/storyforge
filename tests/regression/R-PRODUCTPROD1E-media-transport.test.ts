import { describe, expect, it, vi } from 'vitest'
import {
  createTrustedRelayMediaTransportV1,
  inspectConfiguredAgnesImageCapabilityV1,
  inspectTrustedRelayMediaConfigurationV1,
  resolveConfiguredAgnesImageCapabilityV1,
  resolveTrustedRelayMediaCapabilityV1,
} from '../../src/lib/product-production/media-transport'
import type { AIConfig, ProviderCapabilityRequirementV1 } from '../../src/lib/types'

function requirement(mediaClass: 'image' | 'music' | 'sfx'): ProviderCapabilityRequirementV1 {
  return {
    requirementKey: `media.${mediaClass}`, mediaClass, operation: 'generate',
    adapterFamily: `${mediaClass}-generation`, minimumCapabilityVersion: '1',
    allowedDataClasses: ['world-selection'], maximumRequestCost: null, maximumTotalCost: null,
    rightsPolicyVersion: 'storyforge-rights-v1', capabilityHash: 'a'.repeat(64), required: true,
  }
}

function usageHeader(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_')
}

describe('R-PRODUCTPROD-1E · trusted media relay transport', () => {
  it('Agnes 图片能力直接复用现有全局配置，持久化 binding 不复制 Key', async () => {
    const config: AIConfig = {
      provider: 'agnes', apiKey: 'test-existing-agnes-key', model: 'agnes-2.0-flash',
      baseUrl: 'https://apihub.agnes-ai.com/v1', temperature: 0.7, maxTokens: 0,
    }
    expect(inspectConfiguredAgnesImageCapabilityV1({ projectId: 1, config })).toEqual({
      ready: true, provider: 'agnes', model: 'agnes-image-2.1-flash',
      endpointOrigin: 'https://apihub.agnes-ai.com', credentialSource: 'existing-ai-config',
      credentialPresent: true, issue: null,
    })
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      created: 1, data: [{ url: null, b64_json: 'iVBORw0KGgo=', revised_prompt: null }],
    }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'agnes.request.1' } }))
    const resolved = await resolveConfiguredAgnesImageCapabilityV1({
      projectId: 1, requirement: requirement('image'), config, fetcher, now: 10,
    })
    expect(resolved.binding).toMatchObject({
      requirementKey: 'media.image', adapterId: 'agnes.image-2.1-flash.v1',
    })
    expect(resolved.receipt).toMatchObject({
      schema: 'storyforge.configured-agnes-image-binding-receipt',
      provider: 'agnes', model: 'agnes-image-2.1-flash',
      endpointOrigin: 'https://apihub.agnes-ai.com', credentialSource: 'existing-ai-config',
      executionLocation: 'browser-direct', credentialPresent: true, boundAt: 10,
    })
    expect(JSON.stringify(resolved.receipt)).not.toContain(config.apiKey)
    expect(JSON.stringify(resolved.receipt)).not.toMatch(/api[-_]?key|authorization|bearer/i)

    const response = await resolved.transport.request({
      adapterId: 'agnes.image-2.1-flash.v1', requestId: 'request.1', method: 'POST',
      endpoint: '/v1/images/generations', body: {
        model: 'agnes-image-2.1-flash', prompt: '原创灯塔', size: '1K', ratio: '16:9', return_base64: true,
        extra_body: { response_format: 'b64_json' },
      }, allowedDataClasses: ['world-selection'],
    }, new AbortController().signal)
    expect(String(fetcher.mock.calls[0][0])).toBe('https://apihub.agnes-ai.com/v1/images/generations')
    const init = fetcher.mock.calls[0][1]!
    expect(init.credentials).toBe('omit')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${config.apiKey}`)
    expect(String(init.body)).not.toContain(config.apiKey)
    expect(response).toMatchObject({ status: 200, providerRequestId: 'agnes.request.1', costUsd: null })
  })

  it('授权前区分未配置、安全配置和无效部署地址，且只暴露 origin', () => {
    expect(inspectTrustedRelayMediaConfigurationV1({ relayUrl: null, environment: 'production' }))
      .toEqual({
        configured: false, ready: false, relayOrigin: null,
        issue: '外部媒体可信中继尚未由部署方配置。',
      })
    expect(inspectTrustedRelayMediaConfigurationV1({
      relayUrl: 'https://media.storyforge.example/private/path', environment: 'production',
    })).toEqual({
      configured: true, ready: true, relayOrigin: 'https://media.storyforge.example', issue: null,
    })
    const invalid = inspectTrustedRelayMediaConfigurationV1({
      relayUrl: 'https://user:pass@media.storyforge.example', environment: 'production',
    })
    expect(invalid).toMatchObject({ configured: true, ready: false, relayOrigin: null })
    expect(invalid.issue).toMatch(/不能包含凭据/)
  })

  it('Agnes URL 图片回退只允许受信 HTTPS 存储域，下载不携带 Key、cookie 或 referrer', async () => {
    const config: AIConfig = {
      provider: 'agnes', apiKey: 'test-existing-agnes-key', model: 'agnes-2.0-flash',
      baseUrl: 'https://apihub.agnes-ai.com/v1', temperature: 0.7, maxTokens: 0,
    }
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer
    const fetcher = vi.fn(async (target: RequestInfo | URL) => {
      const url = String(target)
      if (url.includes('/images/generations')) return new Response('{}', { status: 200 })
      return new Response(png, {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(png.byteLength) },
      })
    })
    const resolved = await resolveConfiguredAgnesImageCapabilityV1({
      projectId: 1, requirement: requirement('image'), config, fetcher,
    })
    await expect(resolved.transport.fetchExternalAsset?.({
      url: 'https://storage.googleapis.com/agnes-aigc/generated.png?token=opaque', maximumBytes: 1_024,
    }, new AbortController().signal)).resolves.toEqual(png)
    const init = fetcher.mock.calls[0][1]!
    expect(init).toMatchObject({
      method: 'GET', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer',
    })
    expect(init.headers).toBeUndefined()
    await expect(resolved.transport.fetchExternalAsset?.({
      url: 'https://platform-outputs.agnes-ai.space/outputs/generated.png?token=opaque', maximumBytes: 1_024,
    }, new AbortController().signal)).resolves.toEqual(png)
    await expect(resolved.transport.fetchExternalAsset?.({
      url: 'https://evil.example/generated.png', maximumBytes: 1_024,
    }, new AbortController().signal)).rejects.toThrow(/允许的 HTTPS 存储域:evil\.example/)
    await expect(resolved.transport.fetchExternalAsset?.({
      url: 'http://storage.googleapis.com/agnes-aigc/generated.png', maximumBytes: 1_024,
    }, new AbortController().signal)).rejects.toThrow(/允许的 HTTPS 存储域/)
  })

  it('只把去敏 envelope 发给固定 Relay，并读取有界 provider receipt', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      data: [{ b64_json: 'iVBORw0KGgo=' }],
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-storyforge-provider-request-id': 'provider.image.1',
        'x-storyforge-provider-cost-usd': '0.04',
        'x-storyforge-provider-usage-b64': usageHeader({ images: 1 }),
      },
    }))
    const transport = createTrustedRelayMediaTransportV1({
      relayUrl: 'https://media.storyforge.example/relay', environment: 'production', fetcher,
    })
    const response = await transport.request({
      adapterId: 'openai.gpt-image-2.v1', requestId: 'request.1', method: 'POST',
      endpoint: '/v1/images/generations', body: { model: 'gpt-image-2', prompt: '原创灯塔' },
      allowedDataClasses: ['world-selection'],
    }, new AbortController().signal)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0][0])).toBe('https://media.storyforge.example/relay/v1/storyforge/game-media/execute')
    const init = fetcher.mock.calls[0][1]!
    expect(init.credentials).toBe('include')
    expect(JSON.parse(String(init.body))).toEqual({
      schema: 'storyforge.media-relay-request', version: 1,
      adapterId: 'openai.gpt-image-2.v1', requestId: 'request.1',
      upstream: { method: 'POST', endpoint: '/v1/images/generations', body: { model: 'gpt-image-2', prompt: '原创灯塔' } },
      allowedDataClasses: ['world-selection'],
    })
    expect(String(init.body)).not.toMatch(/api[-_]?key|authorization|bearer/i)
    expect(response).toMatchObject({
      status: 200, providerRequestId: 'provider.image.1', usage: { images: 1 }, costUsd: 0.04,
    })
  })

  it('拒绝生产 HTTP、URL 内凭据、疑似 Key 和超大响应', async () => {
    expect(() => createTrustedRelayMediaTransportV1({
      relayUrl: 'http://media.example.com', environment: 'production', fetcher: vi.fn(),
    })).toThrow(/HTTPS/)
    expect(() => createTrustedRelayMediaTransportV1({
      relayUrl: 'https://user:pass@media.example.com', environment: 'production', fetcher: vi.fn(),
    })).toThrow(/凭据/)
    const transport = createTrustedRelayMediaTransportV1({
      relayUrl: 'http://127.0.0.1:8787', environment: 'test',
      fetcher: vi.fn(async () => new Response('', { headers: { 'content-length': String(121 * 1024 * 1024) } })),
    })
    await expect(transport.request({
      adapterId: 'openai.gpt-image-2.v1', requestId: 'request.2', method: 'POST',
      endpoint: '/v1/images/generations', body: { apiKey: 'sk-never' }, allowedDataClasses: [],
    }, new AbortController().signal)).rejects.toThrow(/疑似凭据/)
  })

  it('按媒资类型解析商业 adapter，binding/receipt 不含 Key', async () => {
    for (const [mediaClass, adapterId] of [
      ['image', 'openai.gpt-image-2.v1'],
      ['music', 'elevenlabs.music.v2'],
      ['sfx', 'elevenlabs.sound-effects.v2'],
    ] as const) {
      const resolved = await resolveTrustedRelayMediaCapabilityV1({
        requirement: requirement(mediaClass), relayUrl: 'https://media.storyforge.example',
        environment: 'production', fetcher: vi.fn(), now: 1,
      })
      expect(resolved.binding).toMatchObject({ requirementKey: `media.${mediaClass}`, adapterId })
      expect(resolved.receipt).toMatchObject({
        relayOrigin: 'https://media.storyforge.example', credentialSource: 'relay-session',
      })
      expect(JSON.stringify(resolved.receipt)).not.toMatch(/api[-_]?key|authorization|bearer/i)
    }
  })
})
