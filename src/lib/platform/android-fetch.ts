export interface NativeHttp {
  open(options: { id: string; url: string; method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string> }>
  read(options: { id: string }): Promise<{ data?: string; done: boolean }>
  cancel(options: { id: string }): Promise<void>
}
function base64(bytes: Uint8Array): string {
  let result = ''
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(result)
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
    if (bytes && bytes.length > 32 * 1024 * 1024) throw new TypeError(`${policy.label} 单次请求体不能超过 32 MiB。`)
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
      const response = await Promise.race([native.open({
        id, url: url.href, method: effective.method,
        headers: Object.fromEntries(effective.headers.entries()), ...(bytes ? { body: base64(bytes) } : {}),
      }), aborted])
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
