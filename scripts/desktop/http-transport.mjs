import { createHash } from 'node:crypto'
/** @typedef {{sender: unknown, senderFrame: {url: string} | null}} Caller */
/** @typedef {{id:string,url:string,method:string,headers:Record<string,string>,body?:string}} OpenOptions */
/** @typedef {{abort:AbortController,timer?:ReturnType<typeof setTimeout>,reader?:ReadableStreamDefaultReader<Uint8Array>,pending?:Buffer,reading?:boolean}} ActiveRequest */
/** @typedef {(url:string,init:RequestInit & {body?:Buffer})=>Promise<Response>} RelayFetch */
/** @typedef {{chunks:(Buffer|null)[],total:number,hash:string,url:string,method:string,headers:Record<string,string>,received:number}} PendingBody */
const NATIVE_BODY_CHUNK_BYTES = 4 * 1024 * 1024
// Only the trusted desktop main frame can use this pull-based transport.
// It is not an HTTP listener or a renderer-accessible Node/Electron API.
/** @param {{window:{webContents:{mainFrame:{url:string},on:import("node:events").EventEmitter["on"]}},ipcMain:{handle:(channel:string,handler:(event:Caller,options:OpenOptions)=>unknown)=>unknown},origin:string,fetch:RelayFetch}} dependencies */
export function installHttpTransport({ window, ipcMain, origin, fetch: nativeFetch }) {
  /** @type {Map<string, ActiveRequest>} */
  const active = new Map()
  /** @type {Map<string, PendingBody>} */
  const pendingBodies = new Map()
  /** @type {Set<string>} */
  const cancelledBodyIds = new Set()
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const pendingBodyTimers = new Map()
  /** @param {Caller} event */
  const trusted = event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
        || !event.senderFrame?.url.startsWith(origin + '/storyforge/')) throw new Error('Untrusted network caller')
  }
  /** @param {unknown} id */
  const validId = id => {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid network request ID')
  }
  /** @param {string} id */
  const cancel = id => {
    if (pendingBodies.has(id)) cancelledBodyIds.add(id)
    clearTimeout(pendingBodyTimers.get(id)); pendingBodyTimers.delete(id)
    pendingBodies.delete(id)
    const item = active.get(id)
    if (!item) return
    active.delete(id); clearTimeout(item.timer); item.abort.abort()
    void item.reader?.cancel().catch(() => {})
  }
  const clear = () => {
    for (const id of active.keys()) cancel(id)
    for (const id of pendingBodies.keys()) { cancelledBodyIds.add(id); pendingBodies.delete(id) }
    for (const timer of pendingBodyTimers.values()) clearTimeout(timer)
    pendingBodyTimers.clear()
  }
  /** @param {string} id @param {ActiveRequest} item */
  const touch = (id, item) => {
    clearTimeout(item.timer)
    item.timer = setTimeout(() => cancel(id), 600_000)
    item.timer.unref?.()
  }
  window.webContents.on('destroyed', clear)
  window.webContents.on('did-start-navigation', (/** @type {unknown} */ _event, /** @type {string} */ _url, /** @type {boolean} */ _inPlace, /** @type {boolean} */ isMainFrame) => { if (isMainFrame) clear() })
  ipcMain.handle('client-http:capabilities', event => {
    trusted(event)
    return { chunkedBodyVersion: 1 }
  })
  ipcMain.handle('client-http:open', async (event, options) => {
    trusted(event); validId(options?.id)
    cancelledBodyIds.delete(options.id)
    const { id, method } = options
    const url = new URL(options.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || url.origin === origin || !/\/(?:models|embeddings|chat\/completions|messages|responses)\/?$/.test(url.pathname)
        || !['GET', 'POST'].includes(method)) throw new Error('Unsupported model request')
    if (active.has(id) || active.size >= 32) throw new Error('Too many active model requests')
    if (options.body !== undefined && (typeof options.body !== 'string' || options.body.length % 4 !== 0
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(options.body))) throw new Error('Invalid model request body')
    const body = options.body === undefined ? undefined : Buffer.from(options.body, 'base64')
    // B20d: the 32 MiB application ceiling is gone. One complete POST keeps
    // its full body; large requests use bridge-internal segments via
    // `client-http:openChunked`, which always reassemble to this single body.
    if (body && method !== 'POST') throw new Error('Invalid model request body')
    const supplied = new Headers(options.headers)
    /** @type {Record<string,string>} */
    const headers = {}
    for (const key of ['authorization', 'content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'x-api-key', 'x-goog-api-key']) {
      { const value = supplied.get(key); if (value !== null) headers[key] = value }
    }
    /** @type {ActiveRequest} */
    const item = { abort: new AbortController() }
    active.set(id, item); touch(id, item)
    try {
      // Preserve Chromium/system proxy support; never copy session cookies or
      // follow redirects carrying author-selected credentials to another URL.
      const response = await nativeFetch(url.href, { method, headers, body, credentials: 'omit', redirect: 'error', signal: item.abort.signal })
      if (active.get(id) !== item) { void response.body?.cancel().catch(() => {}); throw new Error('Cancelled') }
      item.reader = response.body?.getReader()
      /** @type {Record<string,string>} */
      const resultHeaders = {}
      for (const key of ['content-type', 'retry-after', 'x-request-id']) { const value = response.headers.get(key); if (value !== null) resultHeaders[key] = value }
      return { status: response.status, headers: resultHeaders }
    } catch {
      cancel(id)
      throw new Error('桌面网络请求失败或已取消；不会自动换地址或重发。')
    }
  })
  ipcMain.handle('client-http:openChunked', async (event, options) => {
    trusted(event); validId(options?.id)
    const { id, bodySha256 } = options
    const chunkIndex = Number(options.chunkIndex), totalChunks = Number(options.totalChunks)
    if (cancelledBodyIds.has(id) || active.has(id)) throw new Error('Cancelled or active model request')
    if (!Number.isSafeInteger(chunkIndex) || !Number.isSafeInteger(totalChunks) || totalChunks < 1
        || chunkIndex < 0 || chunkIndex >= totalChunks || typeof bodySha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(bodySha256) || typeof options.body !== 'string'
        || options.body.length === 0 || options.body.length % 4 !== 0
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(options.body)) throw new Error('Invalid model request chunk')
    const chunk = Buffer.from(options.body, 'base64')
    if (chunk.length > NATIVE_BODY_CHUNK_BYTES) throw new Error('Invalid model request chunk')
    let pending = pendingBodies.get(id)
    if (!pending) {
      const url = new URL(options.url)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
          || url.origin === origin || !/\/(?:models|embeddings|chat\/completions|messages|responses)\/?$/.test(url.pathname)
          || !['GET', 'POST'].includes(options.method)) throw new Error('Unsupported model request')
      if (active.has(id) || active.size >= 32) throw new Error('Too many active model requests')
      const supplied = new Headers(options.headers)
      /** @type {Record<string,string>} */
      const headers = {}
      for (const key of ['authorization', 'content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'x-api-key', 'x-goog-api-key']) {
        { const value = supplied.get(key); if (value !== null) headers[key] = value }
      }
      if (pendingBodies.size >= 32) throw new Error('Too many pending model request bodies')
      pending = { chunks: [], total: totalChunks, hash: bodySha256,
        url: options.url, method: options.method, headers, received: 0 }
      pendingBodies.set(id, pending)
      const timer = setTimeout(() => cancel(id), 600_000)
      timer.unref?.(); pendingBodyTimers.set(id, timer)
    } else if (pending.chunks[chunkIndex] !== undefined || pending.total !== totalChunks || pending.hash !== bodySha256
        || pending.url !== options.url || pending.method !== options.method
        || JSON.stringify(pending.headers) !== JSON.stringify((() => {
          const supplied = new Headers(options.headers)
          /** @type {Record<string,string>} */
          const headers = {}
          for (const key of ['authorization', 'content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'x-api-key', 'x-goog-api-key']) {
            { const value = supplied.get(key); if (value !== null) headers[key] = value }
          }
          return headers
        })())) throw new Error('Inconsistent model request chunk')
    pending.chunks[chunkIndex] = chunk
    pending.received += 1
    if (pending.received !== pending.total) return { status: 0, headers: {} }
    // All segments arrived: one complete POST with the reassembled body.
    const bytes = Buffer.concat(Array.from({ length: pending.total }, (_, index) => {
      const part = pending.chunks[index]
      if (!part) throw new Error('Incomplete model request body')
      return part
    }))
    pendingBodies.delete(id)
    clearTimeout(pendingBodyTimers.get(id)); pendingBodyTimers.delete(id)
    if (createHash('sha256').update(bytes).digest('hex') !== pending.hash) throw new Error('Model request body hash mismatch')
    if (pending.method !== 'POST') throw new Error('Invalid model request body')
    if (active.has(id) || active.size >= 32) throw new Error('Too many active model requests')
    /** @type {ActiveRequest} */
    const item = { abort: new AbortController() }
    active.set(id, item); touch(id, item)
    try {
      const response = await nativeFetch(pending.url, { method: pending.method, headers: pending.headers,
        body: bytes, credentials: 'omit', redirect: 'error', signal: item.abort.signal })
      if (active.get(id) !== item) { void response.body?.cancel().catch(() => {}); throw new Error('Cancelled') }
      item.reader = response.body?.getReader()
      /** @type {Record<string,string>} */
      const resultHeaders = {}
      for (const key of ['content-type', 'retry-after', 'x-request-id']) { const value = response.headers.get(key); if (value !== null) resultHeaders[key] = value }
      return { status: response.status, headers: resultHeaders }
    } catch {
      cancel(id)
      throw new Error('桌面网络请求失败或已取消；不会自动换地址或重发。')
    }
  })
  ipcMain.handle('client-http:read', async (event, { id }) => {
    trusted(event); validId(id)
    const item = active.get(id)
    if (!item || item.reading) throw new Error('Network stream unavailable')
    item.reading = true; touch(id, item)
    try {
      const chunk = item.pending?.length ? { value: item.pending, done: false } : await item.reader?.read() ?? { done: true }
      if (active.get(id) !== item) throw new Error('Cancelled')
      if (chunk.done) { cancel(id); return { done: true } }
      const bytes = Buffer.from(chunk.value)
      item.pending = bytes.subarray(64 * 1024)
      return { done: false, data: bytes.subarray(0, 64 * 1024).toString('base64') }
    } catch { cancel(id); throw new Error('桌面网络流中断；结果可能未知，请检查生成记录。') }
    finally { item.reading = false }
  })
  ipcMain.handle('client-http:cancel', (event, { id }) => { trusted(event); validId(id); cancel(id) })
  return clear
}
