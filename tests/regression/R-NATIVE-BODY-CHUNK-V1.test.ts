import { describe, expect, it, vi } from 'vitest'
import {
  dispatchNativeBodyV1,
  NATIVE_BODY_CHUNK_BYTES_V1,
} from '../../src/lib/platform/android-fetch'

const options = {
  id: 'req-1',
  url: 'https://api.example.com/v1/chat/completions',
  method: 'POST',
  headers: { 'content-type': 'application/json' },
}

function bytesOf(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) bytes[i] = i % 256
  return bytes
}

describe('B20d · 完整 POST 传输门：桥内分片对应一个完整请求', () => {
  it('小于等于分片大小：保持单次 open 调用（旧桥路径字节一致）', async () => {
    const native = { open: vi.fn(async () => ({ status: 200, headers: {} })) }
    const body = bytesOf(1024)
    await dispatchNativeBodyV1(native, options, body)
    expect(native.open).toHaveBeenCalledTimes(1)
    const call = native.open.mock.calls[0][0] as { body: string }
    expect(Buffer.from(call.body, 'base64').equals(Buffer.from(body))).toBe(true)
  })

  it('无分片能力或探针不支持的旧桥：即使大 body 也走原单次 open，不丢保护', async () => {
    const native = { open: vi.fn(async () => ({ status: 200, headers: {} })) }
    const body = bytesOf(NATIVE_BODY_CHUNK_BYTES_V1 + 1)
    await dispatchNativeBodyV1(native, options, body)
    expect(native.open).toHaveBeenCalledTimes(1)
    const call = native.open.mock.calls[0][0] as { body: string }
    expect(Buffer.from(call.body, 'base64').equals(Buffer.from(body))).toBe(true)
  })

  it('超过分片大小且有分片能力：逐片带 index/total/全文 SHA-256，拼接后与原文一致', async () => {
    const chunks: { chunkIndex: string; totalChunks: string; bodySha256: string; body: string }[] = []
    const native = {
      getCapabilities: vi.fn(async () => ({ chunkedBodyVersion: 1 })),
      open: vi.fn(async () => { throw new Error('大 body 不应走旧 open') }),
      openChunked: vi.fn(async (args: { chunkIndex: string; totalChunks: string; bodySha256: string; body: string }) => {
        chunks.push(args)
        return { status: 200, headers: {} }
      }),
    }
    const body = bytesOf(NATIVE_BODY_CHUNK_BYTES_V1 * 2 + 100)
    await dispatchNativeBodyV1(native, options, body)
    expect(native.open).not.toHaveBeenCalled()
    expect(chunks).toHaveLength(3)
    expect(chunks.map(chunk => chunk.chunkIndex)).toEqual(['0', '1', '2'])
    expect(new Set(chunks.map(chunk => chunk.totalChunks)).size).toBe(1)
    expect(new Set(chunks.map(chunk => chunk.bodySha256)).size).toBe(1)
    // 拼接恢复与原文一致（尾部完整）。
    const restored = Buffer.concat(chunks.map(chunk => Buffer.from(chunk.body, 'base64')))
    expect(restored.equals(Buffer.from(body))).toBe(true)
    // 全文 hash 与原文 SHA-256 一致。
    const expected = Buffer.from(await crypto.subtle.digest('SHA-256', body as unknown as ArrayBuffer)).toString('hex')
    expect(chunks[0]!.bodySha256).toBe(expected)
  })

  it('Capacitor 代理看似有方法但能力探针缺失时仍走旧桥（防误判）', async () => {
    const native = {
      open: vi.fn(async () => ({ status: 200, headers: {} })),
      openChunked: vi.fn(async () => { throw new Error('旧原生插件不存在此方法') }),
      // no getCapabilities: proxy may still expose a truthy openChunked stub
    }
    const body = bytesOf(NATIVE_BODY_CHUNK_BYTES_V1 + 1)
    const result = await dispatchNativeBodyV1(native, options, body)
    expect(result.status).toBe(200)
    expect(native.open).toHaveBeenCalledTimes(1)
    expect(native.openChunked).not.toHaveBeenCalled()
  })

  it('取消/中止由调用方 AbortSignal 处理，不在此处吞错', async () => {
    const native = {
      getCapabilities: vi.fn(async () => ({ chunkedBodyVersion: 1 })),
      open: vi.fn(async () => ({ status: 200, headers: {} })),
      openChunked: vi.fn(async () => { throw new Error('bridge-refused') }),
    }
    await expect(dispatchNativeBodyV1(native, options, bytesOf(NATIVE_BODY_CHUNK_BYTES_V1 + 1))).rejects.toThrow('bridge-refused')
  })

  it('派发前或分片间中止：不发起任何 open/openChunked', async () => {
    const native = {
      getCapabilities: vi.fn(async () => ({ chunkedBodyVersion: 1 })),
      open: vi.fn(async () => ({ status: 200, headers: {} })),
      openChunked: vi.fn(async () => ({ status: 200, headers: {} })),
    }
    const controller = new AbortController(); controller.abort()
    await expect(dispatchNativeBodyV1(native, options, bytesOf(1024), controller.signal)).rejects.toThrow()
    expect(native.open).not.toHaveBeenCalled(); expect(native.openChunked).not.toHaveBeenCalled()
  })
})
