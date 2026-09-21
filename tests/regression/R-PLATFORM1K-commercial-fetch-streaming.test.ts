import { describe, expect, it, vi } from 'vitest'
import { createCommercialFetchHandlerV1 } from '../../src/lib/commercial/fetch-service'
import {
  createCommercialReleaseDeliveryGatewayV1,
  type CommercialReleaseDeliveryGatewayHandlerV1,
  type CommercialReleaseDeliveryGatewayRequestV1,
  type CommercialReleaseDeliveryGatewayResponseV1,
} from '../../src/lib/commercial/release-delivery-gateway'

const ORIGIN = 'https://app.storyforge.test'
const URL = 'https://api.storyforge.test/v1/commercial/releases/register'

function admittedDeliveryGateway(
  handler: (
    request: CommercialReleaseDeliveryGatewayRequestV1,
  ) => Promise<CommercialReleaseDeliveryGatewayResponseV1>,
) {
  return Object.assign(handler, {
    preflightDistributionUpload: async () => null,
  })
}

function streamedRequest(input: {
  chunks: Uint8Array[]
  contentLength?: string
  onCancel?: () => void
  authorization?: string
  signal?: AbortSignal
}): Request {
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = input.chunks[index]
      if (chunk) {
        index += 1
        controller.enqueue(chunk)
      } else {
        controller.close()
      }
    },
    cancel() { input.onCancel?.() },
  }, { highWaterMark: 0 })
  const request = new Request(URL, {
    method: 'POST', body,
    headers: {
      origin: ORIGIN, 'content-type': 'application/json',
      ...(input.contentLength ? { 'content-length': input.contentLength } : {}),
      ...(input.authorization ? { authorization: input.authorization } : {}),
    },
    signal: input.signal,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
  if (input.contentLength) request.headers.set('content-length', input.contentLength)
  return request
}

function hangingRequest(input: {
  authorization?: string
  signal?: AbortSignal
  onCancel?: () => void
} = {}): Request {
  const body = new ReadableStream<Uint8Array>({
    pull() { return new Promise<void>(() => undefined) },
    cancel() { input.onCancel?.() },
  })
  return new Request(URL, {
    method: 'POST', body, signal: input.signal,
    headers: {
      origin: ORIGIN, 'content-type': 'application/json',
      ...(input.authorization ? { authorization: input.authorization } : {}),
    },
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

describe('PLATFORM-1K · commercial fetch streaming limits', () => {
  it.each([
    ['非法声明', 'not-a-number'],
    ['声明超限', '1000001'],
  ])('%s Content-Length 在返回前取消尚未读取的流', async (_label, contentLength) => {
    let cancelled = false
    const deliveryGateway = vi.fn(async () => ({ status: 201, headers: {}, body: { ok: true } }))
    const handler = createCommercialFetchHandlerV1({
      commercialGateway: async () => ({ status: 200, headers: {}, body: {} }),
      deliveryGateway: admittedDeliveryGateway(deliveryGateway),
      allowedOrigins: [ORIGIN], maximumDistributionBytes: 1_000_000,
    })
    const request = streamedRequest({
      chunks: [new TextEncoder().encode('{}')], contentLength,
      onCancel: () => { cancelled = true },
    })
    expect(request.headers.get('content-length')).toBe(contentLength)
    const response = await handler(request)
    expect(response.status).toBe(413)
    expect(cancelled).toBe(true)
    expect(deliveryGateway).not.toHaveBeenCalled()
  })

  it.each([
    ['缺失 Content-Length', undefined],
    ['伪造偏小 Content-Length', '16'],
  ])('%s 时按流字节计数，超限立即取消且不进入网关', async (_label, contentLength) => {
    let cancelled = false
    const deliveryGateway = vi.fn(async () => ({ status: 201, headers: {}, body: { ok: true } }))
    const handler = createCommercialFetchHandlerV1({
      commercialGateway: async () => ({ status: 200, headers: {}, body: {} }),
      deliveryGateway: admittedDeliveryGateway(deliveryGateway),
      allowedOrigins: [ORIGIN], maximumDistributionBytes: 1_000_000,
    })
    const response = await handler(streamedRequest({
      chunks: [new Uint8Array(600_000), new Uint8Array(600_000)],
      contentLength, onCancel: () => { cancelled = true },
    }))
    await expect(response.json()).resolves.toMatchObject({ code: 'payload_too_large' })
    expect(response.status).toBe(413)
    expect(cancelled).toBe(true)
    expect(deliveryGateway).not.toHaveBeenCalled()
  })

  it('大包并发预算满时先返回 429，并在首个流结束后释放名额', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const encoder = new TextEncoder()
    const firstBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{'))
        void gate.then(() => {
          controller.enqueue(encoder.encode('}'))
          controller.close()
        })
      },
    })
    const deliveryGateway = vi.fn(async () => ({ status: 201, headers: {}, body: { accepted: true } }))
    const handler = createCommercialFetchHandlerV1({
      commercialGateway: async () => ({ status: 200, headers: {}, body: {} }),
      deliveryGateway: admittedDeliveryGateway(deliveryGateway),
      allowedOrigins: [ORIGIN], maximumDistributionBytes: 1_000_000,
      maximumConcurrentDistributionUploads: 1,
    })
    const first = handler(new Request(URL, {
      method: 'POST', body: firstBody,
      headers: { origin: ORIGIN, 'content-type': 'application/json' }, duplex: 'half',
    } as RequestInit & { duplex: 'half' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    const limited = await handler(streamedRequest({ chunks: [encoder.encode('{}')] }))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('1')
    await expect(limited.json()).resolves.toMatchObject({ code: 'upload_concurrency_limited' })

    release()
    await expect(first).resolves.toMatchObject({ status: 201 })
    const afterRelease = await handler(streamedRequest({ chunks: [encoder.encode('{}')] }))
    expect(afterRelease.status).toBe(201)
    expect(deliveryGateway).toHaveBeenCalledTimes(2)
  })

  it('未认证大包在读取正文和占用上传槽之前拒绝并取消流', async () => {
    let cancelled = false
    const actualGateway = createCommercialReleaseDeliveryGatewayV1({
      service: null as never,
      identity: {
        authenticate: async token => token === 'token-valid-upload-123456'
          ? { userId: 'user.creator', permissions: [] }
          : null,
      },
    })
    const deliveryGateway = Object.assign(
      vi.fn(async () => ({ status: 201, headers: {}, body: { accepted: true } })),
      {
        preflightDistributionUpload: actualGateway.preflightDistributionUpload,
      },
    ) satisfies CommercialReleaseDeliveryGatewayHandlerV1
    const handler = createCommercialFetchHandlerV1({
      commercialGateway: async () => ({ status: 200, headers: {}, body: {} }),
      deliveryGateway, allowedOrigins: [ORIGIN], maximumDistributionBytes: 1_000_000,
      maximumConcurrentDistributionUploads: 1,
    })

    const rejected = await handler(hangingRequest({
      authorization: 'Bearer token-invalid-upload-1234',
      onCancel: () => { cancelled = true },
    }))
    expect(rejected.status).toBe(401)
    await expect(rejected.json()).resolves.toMatchObject({ code: 'unauthorized' })
    expect(cancelled).toBe(true)
    expect(deliveryGateway).not.toHaveBeenCalled()

    const admitted = await handler(streamedRequest({
      chunks: [new TextEncoder().encode('{}')],
      authorization: 'Bearer token-valid-upload-123456',
    }))
    expect(admitted.status).toBe(201)
    expect(deliveryGateway).toHaveBeenCalledOnce()
  })

  it('两个 slowloris 流超时后取消 reader、释放全部槽，并保留 429 Retry-After', async () => {
    let cancelled = 0
    const deliveryGateway = vi.fn(async () => ({ status: 201, headers: {}, body: { accepted: true } }))
    const handler = createCommercialFetchHandlerV1({
      commercialGateway: async () => ({ status: 200, headers: {}, body: {} }),
      deliveryGateway: admittedDeliveryGateway(deliveryGateway),
      allowedOrigins: [ORIGIN], maximumDistributionBytes: 1_000_000,
      maximumConcurrentDistributionUploads: 2, maximumDistributionBodyReadMs: 25,
    })
    const first = handler(hangingRequest({ onCancel: () => { cancelled += 1 } }))
    const second = handler(hangingRequest({ onCancel: () => { cancelled += 1 } }))
    await new Promise(resolve => setTimeout(resolve, 0))

    const limited = await handler(streamedRequest({ chunks: [new TextEncoder().encode('{}')] }))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('1')
    await expect(limited.json()).resolves.toMatchObject({ code: 'upload_concurrency_limited' })

    const timedOut = await Promise.all([first, second])
    expect(timedOut.map(response => response.status)).toEqual([408, 408])
    await expect(Promise.all(timedOut.map(response => response.json()))).resolves.toMatchObject([
      { code: 'body_timeout' }, { code: 'body_timeout' },
    ])
    expect(cancelled).toBe(2)
    expect(deliveryGateway).not.toHaveBeenCalled()

    const afterTimeout = await handler(streamedRequest({ chunks: [new TextEncoder().encode('{}')] }))
    expect(afterTimeout.status).toBe(201)
    expect(deliveryGateway).toHaveBeenCalledOnce()
  })

  it('AbortSignal 中止挂起正文后取消 reader 并立即释放上传槽', async () => {
    let cancelled = false
    const controller = new AbortController()
    const deliveryGateway = vi.fn(async () => ({ status: 201, headers: {}, body: { accepted: true } }))
    const handler = createCommercialFetchHandlerV1({
      commercialGateway: async () => ({ status: 200, headers: {}, body: {} }),
      deliveryGateway: admittedDeliveryGateway(deliveryGateway),
      allowedOrigins: [ORIGIN], maximumDistributionBytes: 1_000_000,
      maximumConcurrentDistributionUploads: 1, maximumDistributionBodyReadMs: 1_000,
    })
    const pending = handler(hangingRequest({
      signal: controller.signal, onCancel: () => { cancelled = true },
    }))
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort()

    const aborted = await pending
    expect(aborted.status).toBe(408)
    await expect(aborted.json()).resolves.toMatchObject({ code: 'request_aborted' })
    expect(cancelled).toBe(true)

    const afterAbort = await handler(streamedRequest({ chunks: [new TextEncoder().encode('{}')] }))
    expect(afterAbort.status).toBe(201)
    expect(deliveryGateway).toHaveBeenCalledOnce()
  })

  it('现有小型命令仍把精确 rawBody 交给普通商业网关', async () => {
    const commercialGateway = vi.fn(async request => ({
      status: 200, headers: { 'x-storyforge-next-cursor': '50' }, body: { rawBody: request.rawBody },
    }))
    const handler = createCommercialFetchHandlerV1({
      commercialGateway,
      deliveryGateway: async () => ({ status: 500, headers: {}, body: {} }),
      allowedOrigins: [ORIGIN], maximumCommandBytes: 2_000,
    })
    const rawBody = '{"query":"潮钟"}'
    const response = await handler(new Request('https://api.storyforge.test/v1/commercial/discover', {
      method: 'POST', body: rawBody,
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-storyforge-next-cursor')).toBe('50')
    expect(response.headers.get('access-control-expose-headers')).toContain('x-storyforge-next-cursor')
    await expect(response.json()).resolves.toEqual({ rawBody })
    expect(commercialGateway).toHaveBeenCalledOnce()
  })
})
