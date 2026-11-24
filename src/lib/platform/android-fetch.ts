/**
 * B20d: one complete logical POST can exceed the old 32 MiB bridge cap. The
 * bridge's own native side assembles the whole body before transmission, so
 * chunking here is only a transport-segment concern — each segment carries an
 * exact (index, total) and the full SHA-256 of the whole request body, letting
 * the native assembler reject truncation/tampering/replay. Old native bridges
 * without `openChunked` keep receiving the single `open` call with the full
 * base64 body (byte-identical legacy path).
 */
export interface NativeHttpChunkedOptions {
  id: string; url: string; method: string; headers: Record<string, string>
  chunkIndex: string; totalChunks: string; bodySha256: string; body: string
}
export const NATIVE_BODY_CHUNK_BYTES_V1 = 4 * 1024 * 1024

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

function base64(bytes: Uint8Array): string {
  let result = ''
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(result)
}

const nativeChunkCapabilityCache = new WeakMap<object, Promise<boolean>>()

/** Probe once per bridge object. A missing/rejecting probe (old native plugin)
 * or a version other than 1 means the legacy single-`open` path is used. */
function nativeChunkedBodySupportedV1(native: Pick<NativeHttp, 'open' | 'openChunked' | 'getCapabilities'>): Promise<boolean> {
  const cached = nativeChunkCapabilityCache.get(native)
  if (cached) return cached
  const probe = typeof native.getCapabilities === 'function'
    ? Promise.resolve().then(() => native.getCapabilities!()).then(value => (
      !!value && value.chunkedBodyVersion === 1 && typeof native.openChunked === 'function'
    )).catch(() => false)
    : Promise.resolve(false)
  nativeChunkCapabilityCache.set(native, probe)
  return probe
}

export async function dispatchNativeBodyV1(
  native: Pick<NativeHttp, 'open' | 'openChunked' | 'getCapabilities'>,
  options: { id: string; url: string; method: string; headers: Record<string, string> },
  bytes: Uint8Array | undefined,
  signal?: AbortSignal,
): Promise<{ status: number; headers: Record<string, string> }> {
  signal?.throwIfAborted()
  const openChunked = native.openChunked?.bind(native)
  const chunked = openChunked && bytes && bytes.length > NATIVE_BODY_CHUNK_BYTES_V1
    ? await nativeChunkedBodySupportedV1(native)
    : false
  signal?.throwIfAborted()
  if (!chunked || !bytes || !openChunked) {
    return native.open({ ...options, ...(bytes ? { body: base64(bytes) } : {}) })
  }
  const body = bytes
  const bodySha256 = await sha256Hex(body)
  const totalChunks = Math.ceil(body.length / NATIVE_BODY_CHUNK_BYTES_V1)
  let last: { status: number; headers: Record<string, string> } | null = null
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    signal?.throwIfAborted()
    const chunk = body.subarray(chunkIndex * NATIVE_BODY_CHUNK_BYTES_V1, Math.min((chunkIndex + 1) * NATIVE_BODY_CHUNK_BYTES_V1, body.length))
    last = await openChunked({
      ...options, chunkIndex: String(chunkIndex), totalChunks: String(totalChunks), bodySha256, body: base64(chunk),
    })
    signal?.throwIfAborted()
  }
  return last!
}

export interface NativeHttp {
  open(options: { id: string; url: string; method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string> }>
  /** Explicit capability probe. A Capacitor plugin proxy exposes *any* method
   * name, so `openChunked?.` alone cannot prove the native side implements it. */
  getCapabilities?(): Promise<{ chunkedBodyVersion?: number }>
  /** Optional transport-segment channel. Old bridges without it keep `open`. */
  openChunked?(options: NativeHttpChunkedOptions): Promise<{ status: number; headers: Record<string, string> }>
  read(options: { id: string }): Promise<{ data?: string; done: boolean }>
  cancel(options: { id: string }): Promise<void>
}

/** Pull-based native transport: real SSE chunks, cancellation, verified HTTPS,
 * no hidden retries and no buffering the whole generation into a bridge event. */
export function createAndroidFetch(native: NativeHttp, browserFetch: typeof fetch, origin: string): typeof fetch {
  return createNativeFetch(native, browserFetch, origin)
}

export function createNativeFetch(native: NativeHttp, browserFetch: typeof fetch, origin: string,
  policy = { label: 'Android', allowHttp: false }): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin)
    if (url.origin === origin || !['http:', 'https:'].includes(url.protocol)) return browserFetch(input, init)
    if ((!policy.allowHttp && url.protocol !== 'https:') || url.username || url.password) throw new TypeError(`${policy.label} 模型服务需要不含账号密码的${policy.allowHttp ? ' HTTP(S)' : ' HTTPS'} 地址。`)
    const request = new Request(url, input instanceof Request ? input : undefined)
    const effective = new Request(request, init)
    const signal = effective.signal
    signal.throwIfAborted()
    const id = crypto.randomUUID()
    const bytes = effective.body ? new Uint8Array(await effective.arrayBuffer()) : undefined
    signal.throwIfAborted()
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    let finished = false
    let rejectAbort: (error: unknown) => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
    const cleanup = () => { finished = true; signal.removeEventListener('abort', abort) }
    const cancel = () => { void native.cancel({ id }).catch(() => {}) }
    const abort = () => {
      if (finished) return
      const error = new DOMException('请求已取消；已发送的生成请求不会自动重发。', 'AbortError')
      controller?.error(error)
      rejectAbort(error)
      cancel()
      cleanup()
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      const response = await Promise.race([dispatchNativeBodyV1(native, {
        id, url: url.href, method: effective.method,
        headers: Object.fromEntries(effective.headers.entries()),
      }, bytes, signal), aborted])
      signal.throwIfAborted()
      if (effective.method === 'HEAD' || [204, 205, 304].includes(response.status)) {
        cancel(); cleanup()
        return new Response(null, response)
      }
      const stream = new ReadableStream<Uint8Array>({
        start(value) { controller = value },
        async pull(value) {
          if (finished) return
          try {
            const chunk = await native.read({ id })
            if (finished) return
            if (chunk.done) { value.close(); cleanup() }
            else if (chunk.data) value.enqueue(Uint8Array.from(atob(chunk.data), char => char.charCodeAt(0)))
          } catch {
            if (!finished) { value.error(new TypeError(`${policy.label} 网络流中断；请求结果可能未知，请检查生成记录。`)); cancel(); cleanup() }
          }
        },
        cancel() { cancel(); cleanup() },
      })
      return new Response(stream, response)
    } catch (error) { cancel(); cleanup(); throw error }
  }
}

export async function installAndroidFetch(): Promise<void> {
  const { registerPlugin, Capacitor } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'android') return
  window.fetch = createAndroidFetch(registerPlugin<NativeHttp>('StoryForgeHttp'), window.fetch.bind(window), location.origin)
}
