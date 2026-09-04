import { describe, expect, it, vi } from 'vitest'
import {
  agnesImage21FlashAdapterV1,
  detectProductImageDimensionsV1,
  elevenLabsMusicAdapterV2,
  listProductMediaProviderCapabilitiesV1,
  openAIGptImage2AdapterV1,
  proceduralAudioAdapterV1,
  resolveProductMediaProviderAdapterV1,
  type ProductMediaRequestV1,
  type MediaProviderTransportV1,
  type MediaTransportResponseV1,
} from '../../src/lib/product-production/media-adapters'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]).buffer

function base64(data: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(data)))
}

function request(overrides: Partial<ProductMediaRequestV1> = {}): ProductMediaRequestV1 {
  return {
    schema: 'storyforge.product-media-request', version: 1, requestId: 'request.1',
    adapterId: 'openai.gpt-image-2.v1', mediaClass: 'image', mediaKind: 'background',
    requirementKey: 'visual.opening', artifactKey: 'media.visual.opening',
    prompt: '暮色中的港口灯塔，原创构图。', negativePrompt: '文字，水印', count: 1,
    width: 1024, height: 1024, durationMs: null, inputHash: 'a'.repeat(64),
    qualityProfile: 'internal', environment: 'test', allowedDataClasses: ['world-selection'],
    rightsPolicyVersion: 'storyforge-rights-v1', ...overrides,
  }
}

function transport(input: {
  executionLocation?: MediaProviderTransportV1['executionLocation']
  response: MediaTransportResponseV1
  externalAsset?: ArrayBuffer
}) {
  const call = vi.fn(async () => input.response)
  const fetchExternalAsset = vi.fn(async () => input.externalAsset ?? PNG)
  return {
    value: {
      executionLocation: input.executionLocation ?? 'trusted-relay',
      request: call,
      fetchExternalAsset,
    } satisfies MediaProviderTransportV1,
    call,
    fetchExternalAsset,
  }
}

describe('R-PRODUCTPROD-1E · central media provider adapters', () => {
  it('从 PNG/JPEG/WebP provider bytes 读取真实尺寸，不信任请求元数据', () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x02, 0x40,
    ]).buffer
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
      0x02, 0x40, 0x04, 0x00, 0x03, 0x01, 0x11, 0x00,
      0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    ]).buffer
    const webp = new Uint8Array(30)
    webp.set([0x52, 0x49, 0x46, 0x46], 0)
    webp.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 8)
    webp.set([0xff, 0x03, 0x00, 0x3f, 0x02, 0x00], 24)
    expect(detectProductImageDimensionsV1(png)).toEqual({ width: 1024, height: 576 })
    expect(detectProductImageDimensionsV1(jpeg)).toEqual({ width: 1024, height: 576 })
    expect(detectProductImageDimensionsV1(webp.buffer)).toEqual({ width: 1024, height: 576 })
    expect(detectProductImageDimensionsV1(PNG)).toBeNull()
  })

  it('Agnes 图片 adapter 复用 browser transport，并按官方 2.1 接口请求 Base64 图片', async () => {
    const direct = transport({
      executionLocation: 'browser-direct',
      response: {
        status: 200, contentType: 'application/json', body: null,
        json: {
          created: 1, background: 'auto', output_format: 'png', quality: 'auto', size: '1312x736',
          data: [{ url: null, b64_json: base64(PNG), revised_prompt: null }],
        },
        providerRequestId: 'agnes-image-1', usage: null, costUsd: null,
      },
    })
    const candidates = await agnesImage21FlashAdapterV1.generate(request({
      adapterId: 'agnes.image-2.1-flash.v1', width: 1200, height: 675,
      qualityProfile: 'commercial-candidate',
    }), direct.value, new AbortController().signal)
    expect(direct.call).toHaveBeenCalledWith({
      adapterId: 'agnes.image-2.1-flash.v1', requestId: 'request.1', method: 'POST',
      endpoint: '/v1/images/generations', allowedDataClasses: ['world-selection'],
      body: {
        model: 'agnes-image-2.1-flash',
        prompt: '暮色中的港口灯塔，原创构图。\nAvoid: 文字，水印',
        size: '1K', ratio: '16:9', return_base64: true,
        extra_body: { response_format: 'b64_json' },
      },
    }, expect.any(AbortSignal))
    expect(candidates[0]).toMatchObject({
      adapterId: 'agnes.image-2.1-flash.v1', mimeType: 'image/png',
      metadata: {
        providerBackground: 'auto', providerOutputFormat: 'png',
        providerQuality: 'auto', providerResolvedSize: '1312x736',
      },
      rights: { origin: 'generated', commercialUse: true, requiresProviderTermsReview: true },
      providerReceipt: { executionLocation: 'browser-direct', providerRequestId: 'agnes-image-1' },
    })
    await expect(agnesImage21FlashAdapterV1.parseAndVerify(candidates[0])).resolves.toMatchObject({
      contentHash: candidates[0].contentHash,
    })

    const unknownMetadata = transport({
      executionLocation: 'browser-direct',
      response: {
        status: 200, contentType: 'application/json', body: null,
        json: { created: 1, data: [{ b64_json: base64(PNG) }], provider_trace: 'not-allowed' },
        providerRequestId: null, usage: null, costUsd: null,
      },
    })
    await expect(agnesImage21FlashAdapterV1.generate(request({
      adapterId: 'agnes.image-2.1-flash.v1',
    }), unknownMetadata.value, new AbortController().signal)).rejects.toThrow(/未允许字段/)
  })

  it('Agnes 图片兼容有界 Data URI、换行、无 padding 与 URL-safe Base64，仍以真实 MIME 验证', async () => {
    const raw = base64(PNG)
    const variants = [
      `data:image/png;base64,${raw}`,
      `${raw.slice(0, 5)}\n${raw.slice(5)}`,
      raw.replace(/=+$/, ''),
      raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    ]
    for (const [index, encoded] of variants.entries()) {
      const direct = transport({
        executionLocation: 'browser-direct',
        response: {
          status: 200, contentType: 'application/json', body: null,
          json: { created: index + 1, data: [{ url: null, b64_json: encoded, revised_prompt: null }] },
          providerRequestId: `agnes-image-variant-${index}`, usage: null, costUsd: null,
        },
      })
      await expect(agnesImage21FlashAdapterV1.generate(request({
        adapterId: 'agnes.image-2.1-flash.v1',
      }), direct.value, new AbortController().signal)).resolves.toMatchObject([{
        mimeType: 'image/png', byteSize: PNG.byteLength,
      }])
    }

    const malformed = transport({
      executionLocation: 'browser-direct',
      response: {
        status: 200, contentType: 'application/json', body: null,
        json: { created: 1, data: [{ url: null, b64_json: 'not;base64!', revised_prompt: null }] },
        providerRequestId: null, usage: null, costUsd: null,
      },
    })
    await expect(agnesImage21FlashAdapterV1.generate(request({
      adapterId: 'agnes.image-2.1-flash.v1',
    }), malformed.value, new AbortController().signal)).rejects.toThrow(/provider base64 无效/)
  })

  it('Agnes 图片在 b64_json 为空时通过受治理 transport 下载官方 URL，不持久化完整签名地址', async () => {
    const direct = transport({
      executionLocation: 'browser-direct', externalAsset: PNG,
      response: {
        status: 200, contentType: 'application/json', body: null,
        json: {
          created: 1,
          data: [{ url: 'https://storage.googleapis.com/agnes-aigc/generated.png?signature=secret', b64_json: null, revised_prompt: null }],
        },
        providerRequestId: 'agnes-image-url-1', usage: null, costUsd: null,
      },
    })
    const candidates = await agnesImage21FlashAdapterV1.generate(request({
      adapterId: 'agnes.image-2.1-flash.v1',
    }), direct.value, new AbortController().signal)
    expect(direct.fetchExternalAsset).toHaveBeenCalledWith({
      url: 'https://storage.googleapis.com/agnes-aigc/generated.png?signature=secret',
      maximumBytes: 100 * 1024 * 1024,
    }, expect.any(AbortSignal))
    expect(candidates[0]).toMatchObject({
      mimeType: 'image/png',
      metadata: { providerDelivery: 'url', providerAssetOrigin: 'https://storage.googleapis.com' },
    })
    expect(JSON.stringify(candidates[0].metadata)).not.toContain('signature=secret')
  })

  it('Agnes 角色立绘显式请求透明 PNG，背景图不伪造透明要求', async () => {
    const direct = transport({
      executionLocation: 'browser-direct',
      response: {
        status: 200, contentType: 'application/json', body: null,
        json: { created: 1, data: [{ url: null, b64_json: base64(PNG), revised_prompt: null }] },
        providerRequestId: 'agnes-character-alpha-1', usage: null, costUsd: null,
      },
    })
    const candidates = await agnesImage21FlashAdapterV1.generate(request({
      adapterId: 'agnes.image-2.1-flash.v1', mediaKind: 'character-pose',
    }), direct.value, new AbortController().signal)
    expect(direct.call.mock.calls[0][0].body).toMatchObject({
      model: 'agnes-image-2.1-flash', background: 'transparent', output_format: 'png',
      extra_body: { response_format: 'b64_json' },
    })
    expect(candidates[0].metadata).toMatchObject({ requestedTransparentBackground: true })
  })

  it('OpenAI 图片 adapter 只发去敏请求并验证 base64、真实 MIME 与 hash', async () => {
    const relay = transport({
      response: {
        status: 200, contentType: 'application/json', body: null,
        json: { created: 1, data: [{ b64_json: base64(PNG), revised_prompt: '港口灯塔' }], usage: { images: 1 } },
        providerRequestId: 'provider-image-1', usage: { images: 1 }, costUsd: 0.04,
      },
    })
    const candidates = await openAIGptImage2AdapterV1.generate(request(), relay.value, new AbortController().signal)
    expect(relay.call).toHaveBeenCalledTimes(1)
    expect(relay.call.mock.calls[0][0]).toEqual({
      adapterId: 'openai.gpt-image-2.v1', requestId: 'request.1', method: 'POST',
      endpoint: '/v1/images/generations', allowedDataClasses: ['world-selection'],
      body: {
        model: 'gpt-image-2', prompt: '暮色中的港口灯塔，原创构图。', n: 1,
        size: '1024x1024', output_format: 'png', quality: 'high',
      },
    })
    expect(JSON.stringify(relay.call.mock.calls[0][0])).not.toMatch(/api[-_]?key|authorization/i)
    expect(candidates[0]).toMatchObject({
      mimeType: 'image/png', byteSize: 8,
      rights: { origin: 'generated', commercialUse: true, requiresProviderTermsReview: true },
      providerReceipt: { providerRequestId: 'provider-image-1', executionLocation: 'trusted-relay', costUsd: 0.04 },
    })
    await expect(openAIGptImage2AdapterV1.parseAndVerify(candidates[0])).resolves.toMatchObject({
      contentHash: candidates[0].contentHash,
    })
  })

  it('拒绝 provider 响应未知字段、伪 MIME 和被篡改的候选 bytes', async () => {
    const safety = transport({
      response: {
        status: 400, contentType: 'application/json', body: null,
        json: { error: { code: 'content_policy_violation' } },
        providerRequestId: 'blocked-1', usage: null, costUsd: null,
      },
    })
    await expect(openAIGptImage2AdapterV1.generate(request(), safety.value, new AbortController().signal))
      .rejects.toThrow(/provider-safety-refusal/)

    const unknown = transport({
      response: {
        status: 200, contentType: 'application/json', body: null,
        json: { data: [{ b64_json: base64(PNG) }], secret_debug: true },
        providerRequestId: null, usage: null, costUsd: null,
      },
    })
    await expect(openAIGptImage2AdapterV1.generate(request(), unknown.value, new AbortController().signal))
      .rejects.toThrow(/未允许字段/)

    const wrongMime = transport({
      response: {
        status: 200, contentType: 'application/json', body: null,
        json: { data: [{ b64_json: base64(MP3) }] }, providerRequestId: null, usage: null, costUsd: null,
      },
    })
    await expect(openAIGptImage2AdapterV1.generate(request(), wrongMime.value, new AbortController().signal))
      .rejects.toThrow(/真实 MIME/)

    const validRelay = transport({
      response: {
        status: 200, contentType: 'application/json', body: null,
        json: { data: [{ b64_json: base64(PNG) }] }, providerRequestId: null, usage: null, costUsd: null,
      },
    })
    const [valid] = await openAIGptImage2AdapterV1.generate(request(), validRelay.value, new AbortController().signal)
    const tampered = { ...valid, data: MP3, byteSize: MP3.byteLength }
    await expect(openAIGptImage2AdapterV1.parseAndVerify(tampered)).rejects.toThrow(/候选验证失败/)
  })

  it('ElevenLabs 商业候选强制 trusted relay，并验证音频字节而非响应 Content-Type', async () => {
    const commercial = request({
      adapterId: 'elevenlabs.music.v2', mediaClass: 'music', mediaKind: 'bgm',
      durationMs: 30_000, width: null, height: null, qualityProfile: 'commercial-candidate',
    })
    const local = transport({
      executionLocation: 'local-relay',
      response: {
        status: 200, contentType: 'audio/mpeg', body: MP3, json: null,
        providerRequestId: 'music-1', usage: null, costUsd: 0.2,
      },
    })
    await expect(elevenLabsMusicAdapterV2.generate(commercial, local.value, new AbortController().signal))
      .rejects.toThrow(/trusted-relay/)
    expect(local.call).not.toHaveBeenCalled()

    const trusted = transport({
      response: {
        status: 200, contentType: 'application/octet-stream', body: MP3, json: null,
        providerRequestId: 'music-1', usage: { seconds: 30 }, costUsd: 0.2,
      },
    })
    await expect(elevenLabsMusicAdapterV2.generate(commercial, trusted.value, new AbortController().signal))
      .resolves.toMatchObject([{ mimeType: 'audio/mpeg', mediaClass: 'music' }])
  })

  it('本地 procedural SFX 明确不能冒充商业音乐，未实现目录适配器也显式失败', async () => {
    const browserTransport: MediaProviderTransportV1 = {
      executionLocation: 'browser-direct',
      request: vi.fn(async () => { throw new Error('procedural 不应发网络请求') }),
    }
    const sfx = request({
      adapterId: 'procedural-audio.v1', mediaClass: 'sfx', mediaKind: 'sfx',
      width: null, height: null, durationMs: 500, qualityProfile: 'prototype',
    })
    await expect(proceduralAudioAdapterV1.generate(sfx, browserTransport, new AbortController().signal))
      .resolves.toMatchObject([{ mimeType: 'audio/wav', rights: { commercialUse: false } }])
    await expect(proceduralAudioAdapterV1.generate({
      ...sfx, qualityProfile: 'commercial-candidate',
    }, browserTransport, new AbortController().signal)).rejects.toThrow(/商业候选/)

    expect(listProductMediaProviderCapabilitiesV1().map(item => item.adapterId)).toEqual([
      'agnes.image-2.1-flash.v1', 'elevenlabs.music.v2', 'elevenlabs.sound-effects.v2', 'existing-project-media.v1',
      'fixture.media.v1', 'local-import-media.v1', 'openai.gpt-image-2.v1', 'procedural-audio.v1',
    ])
    expect(() => resolveProductMediaProviderAdapterV1('existing-project-media.v1')).toThrow(/catalog-service/)
  })
})
