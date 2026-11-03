// Only the trusted desktop main frame can use this pull-based transport.
// It is not an HTTP listener or a renderer-accessible Node/Electron API.
export function installHttpTransport({ window, ipcMain, origin, fetch: nativeFetch }) {
  const active = new Map()
  const trusted = event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
        || !event.senderFrame.url.startsWith(origin + '/storyforge/')) throw new Error('Untrusted network caller')
  }
  const validId = id => {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid network request ID')
  }
  const cancel = id => {
    const item = active.get(id)
    if (!item) return
    active.delete(id); clearTimeout(item.timer); item.abort.abort()
    void item.reader?.cancel().catch(() => {})
  }
  const clear = () => { for (const id of active.keys()) cancel(id) }
  const touch = (id, item) => {
    clearTimeout(item.timer)
    item.timer = setTimeout(() => cancel(id), 600_000)
    item.timer.unref?.()
  }
  window.webContents.on('destroyed', clear)
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) clear() })
  ipcMain.handle('client-http:open', async (event, options) => {
    trusted(event); validId(options?.id)
    const { id, method } = options
    const url = new URL(options.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || url.origin === origin || !/\/(?:models|embeddings|chat\/completions|messages|responses)\/?$/.test(url.pathname)
        || !['GET', 'POST'].includes(method)) throw new Error('Unsupported model request')
    if (active.has(id) || active.size >= 32) throw new Error('Too many active model requests')
    if (options.body !== undefined && (typeof options.body !== 'string' || options.body.length > 44_739_244
        || options.body.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(options.body))) throw new Error('Invalid model request body')
    const body = options.body === undefined ? undefined : Buffer.from(options.body, 'base64')
    if (body && (body.length > 32 * 1024 * 1024 || method !== 'POST')) throw new Error('Invalid model request body')
    const supplied = new Headers(options.headers)
    const headers = {}
    for (const key of ['authorization', 'content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'x-api-key', 'x-goog-api-key']) {
      if (supplied.has(key)) headers[key] = supplied.get(key)
    }
    const item = { abort: new AbortController() }
    active.set(id, item); touch(id, item)
    try {
      // Preserve Chromium/system proxy support; never copy session cookies or
      // follow redirects carrying author-selected credentials to another URL.
      const response = await nativeFetch(url.href, { method, headers, body, credentials: 'omit', redirect: 'error', signal: item.abort.signal })
      if (active.get(id) !== item) { void response.body?.cancel().catch(() => {}); throw new Error('Cancelled') }
      item.reader = response.body?.getReader()
      const resultHeaders = {}
      for (const key of ['content-type', 'retry-after', 'x-request-id']) if (response.headers.has(key)) resultHeaders[key] = response.headers.get(key)
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
      const chunk = item.pending?.length ? { value: item.pending } : await item.reader?.read() ?? { done: true }
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
