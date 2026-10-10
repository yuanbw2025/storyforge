import { URL } from 'node:url'
import { Buffer } from 'node:buffer'
import { setTimeout, clearTimeout } from 'node:timers'
import http from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

/** Optional loopback adapter for explicitly configured 2026 stateless stdio servers.
 * It forwards MCP messages; the browser's official SDK owns protocol negotiation. */
export async function startBridge({ origin, token, servers, port = 43127, transportFactory = spec => new StdioClientTransport({ ...spec, stderr: 'ignore' }) }) {
  const allowed = new URL(origin)
  if (allowed.origin !== origin || !['http:','https:'].includes(allowed.protocol) || typeof token !== 'string' || token.length < 32 || !servers || typeof servers !== 'object') throw new Error('Bridge origin, token or server configuration is invalid')
  const children = new Map()
  const reply = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)) }
  const authenticate = value => {
    const actual = Buffer.from(value ?? ''), expected = Buffer.from(`Bearer ${token}`)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }
  async function child(name) {
    if (children.has(name)) return children.get(name)
    const spec = servers[name]
    if (!spec || typeof spec.command !== 'string' || !Array.isArray(spec.args) || !Array.isArray(spec.tools)) throw new Error('Unconfigured server')
    const entry = { transport: transportFactory({ command: spec.command, args: spec.args, ...(spec.env ? { env: spec.env } : {}) }), pending: new Map(), ready: null }
    children.set(name, entry)
    entry.transport.onmessage = message => {
      if (!('id' in message)) return
      const pending = entry.pending.get(String(message.id))
      if (!pending) return
      if (!('result' in message) && !('error' in message)) return
      pending.resolve({ ...message, id: pending.originalId })
    }
    entry.transport.onclose = () => { for (const pending of entry.pending.values()) pending.reject(new Error('Local server closed')); entry.pending.clear(); children.delete(name) }
    entry.ready = entry.transport.start().catch(error => { children.delete(name); throw error })
    await entry.ready
    return entry
  }
  const server = http.createServer(async (request, response) => {
    if (request.headers.host !== `127.0.0.1:${server.address().port}` || request.headers.origin !== origin) { reply(response, 403, { error: 'Origin or Host rejected' }); return }
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id')
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    response.setHeader('Access-Control-Expose-Headers', 'MCP-Protocol-Version')
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
    if (!authenticate(request.headers.authorization)) { reply(response, 401, { error: 'Pairing token required' }); return }
    const name = /^\/mcp\/([a-z][a-z0-9-]*)$/.exec(request.url ?? '')?.[1]
    if (!name || !Object.hasOwn(servers, name)) { reply(response, 404, { error: 'Unknown configured endpoint' }); return }
    if (request.method !== 'POST') { reply(response, 405, { error: 'Only stateless POST transport is supported' }); return }
    let id = null
    try {
      let size = 0; const chunks = []
      for await (const chunk of request) { size += chunk.length; if (size > 1_000_000) throw new Error('Request too large'); chunks.push(chunk) }
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8')); id = message.id ?? null
      if (message.jsonrpc !== '2.0' || !['server/discover','tools/list','tools/call','tasks/get','tasks/cancel','tasks/update'].includes(message.method) || id === null) throw new Error('Unsupported modern MCP method')
      if (message.method === 'tools/call' && !servers[name].tools.includes(message.params?.name)) throw new Error('Tool not allowed by local configuration')
      const entry = await child(name); await entry.ready
      const requestId = `bridge-${randomUUID()}`
      const result = await new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); entry.pending.delete(requestId) }
        const timer = setTimeout(() => { cleanup(); reject(new Error('Local tool timeout; outcome unknown')) }, 30000)
        entry.pending.set(requestId, { originalId: id, resolve: value => { cleanup(); resolve(value) }, reject: error => { cleanup(); reject(error) } })
        void entry.transport.send({ ...message, id: requestId }).catch(error => { cleanup(); reject(error) })
      })
      if (JSON.stringify(result).length > 2_000_000) throw new Error('Response too large')
      reply(response, 200, result)
    } catch { reply(response, 400, { jsonrpc: '2.0', id, error: { code: -32603, message: 'Local bridge rejected or could not finish this request; no automatic retry.' } }) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  return { port: server.address().port, async close() { for (const entry of children.values()) await entry.transport.close(); await new Promise(resolve => server.close(resolve)); server.closeAllConnections() } }
}
