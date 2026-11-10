/* global document */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

/** Synthetic-only relay with deliberately no CORS headers. Runs in the actual
 * isolated native-window smoke, including packaged Windows and both Macs. */
/** @param {import("@playwright/test").ElectronApplication} app @param {import("@playwright/test").Page} page */
export async function verifyDesktopRelay(app, page) {
  /** @type {{method:string|undefined,url:string,authorization:string|undefined,cookie:string|undefined,body:string}[]} */
  const records = []
  let cancelled = false
  const server = createServer((req, res) => {
    const record = { method: req.method, url: req.url ?? "", authorization: req.headers.authorization, cookie: req.headers.cookie, body: '' }
    records.push(record)
    req.on('data', chunk => { record.body += chunk })
    req.on('end', () => {
      if (record.url.includes('redirect=1')) { res.writeHead(302, { Location: '/private' }); res.end(); return }
      if (record.url.includes('unauthorized=1')) { res.writeHead(401); res.end('synthetic denial'); return }
      res.setHeader('content-type', record.url.includes('chat/completions') ? 'text/event-stream' : 'application/json')
      if (record.url.includes('abort=1')) {
        res.write('data: first\n\n'); res.on('close', () => { cancelled = true }); return
      }
      if (record.url.includes('chat/completions')) {
        const bytes = Buffer.from('data: 中文\n\ndata: [DONE]\n\n')
        res.write(bytes.subarray(0, 7)); setTimeout(() => res.end(bytes.subarray(7)), 50); return
      }
      res.end(JSON.stringify(record.url.includes('embeddings') ? { data: [{ embedding: [0.1, 0.2] }] } : { data: [{ id: 'fixture-model' }] }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/v1`
  try {
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const contents = /** @type {import("electron").WebContents & {getLastWebPreferences(): import("electron").WebPreferences | null}} */ (BrowserWindow.getAllWindows()[0].webContents)
      return contents.getLastWebPreferences() ?? {}
    })
    assert.equal(preferences.webSecurity, true); assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true)
    const result = await page.evaluate(async base => {
      const headers = { Authorization: 'Bearer synthetic-desktop-relay', 'content-type': 'application/json' }
      // An ordinary iframe fetch retains browser CORS. No security switch was used.
      const iframe = document.createElement('iframe'); document.body.append(iframe)
      let browserBlocked = false
      const frame = iframe.contentWindow
      if (!frame) throw new Error("Missing browser control frame")
      try { await frame.fetch(base + '/models', { headers }) } catch { browserBlocked = true }
      iframe.remove()
      const models = await (await fetch(base + '/models', { headers })).json()
      const chat = await (await fetch(base + '/chat/completions', { method: 'POST', headers, body: '{"stream":true}' })).text()
      const embeddings = await (await fetch(base + '/embeddings', { method: 'POST', headers, body: '{"input":"synthetic"}' })).json()
      const denied = await fetch(base + '/models?unauthorized=1', { headers })
      let redirectBlocked = false
      try { await fetch(base + '/models?redirect=1', { headers }) } catch { redirectBlocked = true }
      const controller = new AbortController()
      const stream = await fetch(base + '/chat/completions?abort=1', { method: 'POST', headers, body: '{}', signal: controller.signal })
      if (!stream.body) throw new Error("Missing response stream")
      const reader = stream.body.getReader(); await reader.read(); controller.abort()
      let abortRejected = false
      try { await reader.read() } catch { abortRejected = true }
      return { browserBlocked, models, chat, embeddings, denied: denied.status, redirectBlocked, abortRejected }
    }, base)
    assert.equal(result.browserBlocked, true)
    assert.equal(result.models.data[0].id, 'fixture-model'); assert.equal(result.chat, 'data: 中文\n\ndata: [DONE]\n\n')
    assert.deepEqual(result.embeddings.data[0].embedding, [0.1, 0.2]); assert.equal(result.denied, 401)
    assert.equal(result.redirectBlocked, true); assert.equal(result.abortRejected, true)
    for (let i = 0; i < 50 && !cancelled; i++) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(cancelled, true)
    assert.equal(records.filter(x => x.method === 'POST' && x.url === '/v1/chat/completions').length, 1)
    assert.equal(records.filter(x => x.url === '/v1/models?unauthorized=1').length, 1)
    assert.equal(records.filter(x => x.url === '/private').length, 0)
    const outbound = records.filter(x => x.method !== 'OPTIONS')
    assert.ok(outbound.every(x => x.authorization === 'Bearer synthetic-desktop-relay' && !x.cookie))
    assert.equal(outbound.find(x => x.url === '/v1/embeddings')?.body, '{"input":"synthetic"}')
    console.log('Desktop relay: browser CORS retained; native model/chat/embedding, UTF-8 stream, 401, redirect refusal and cancellation passed with synthetic data only.')
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(() => resolve(undefined))) }
}
