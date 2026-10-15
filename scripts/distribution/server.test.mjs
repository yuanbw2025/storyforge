import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request, createServer } from 'node:http'
import { createPortableServer } from './server.mjs'
import { providerProxies } from './proxies.mjs'

function get(port, path, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
    }); req.on('error', reject); req.end()
  })
}
test('portable package serves deep links/assets, preserves origin and rejects foreign hosts/origins/traversal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-distribution-')); const web = join(dir, 'web'); mkdirSync(web)
  writeFileSync(join(web, 'index.html'), '<html>current release</html>'); writeFileSync(join(web, 'app.js'), 'current app'); writeFileSync(join(web, 'worker.mjs'), 'module worker')
  writeFileSync(join(dir, 'private.txt'), 'private')
  const server = createPortableServer({ webRoot: web, readDiagnostics: () => ({ occurredAt: '2026-10-15T01:00:00.000Z', kind: 'error', code: 'EADDRINUSE' }) }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    assert.equal((await get(port, '/')).headers.location, '/storyforge/')
    assert.equal((await get(port, '/storyforge/home/settings')).body, '<html>current release</html>')
    assert.equal((await get(port, '/storyforge/app.js')).headers['content-type'], 'text/javascript; charset=utf-8')
    assert.equal((await get(port, '/storyforge/worker.mjs')).headers['content-type'], 'text/javascript; charset=utf-8')
    assert.equal((await get(port, '/storyforge/missing.js')).status, 404)
    assert.equal((await get(port, '/storyforge/', { host: 'attacker.example' })).status, 403)
    assert.equal((await get(port, '/deepseek-proxy/v1/models', { origin: 'https://attacker.example' })).status, 403)
    assert.equal((await get(port, '/deepseek-proxy/v1/models', { 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal((await get(port, '/storyforge/%2e%2e%2fprivate.txt')).status, 403)
    assert.equal((await get(port, '/storyforge/%')).status, 400)
    assert.equal((await get(port, '/storyforge/', {}, 'POST')).status, 405)
    assert.equal((await get(port, '/deepseek-proxy/v1/models', {}, 'DELETE')).status, 405)
    assert.equal((await get(port, '/storyforge/local-codex/v1/status')).status, 403)
    const diagnostics = await get(port, '/storyforge/local-diagnostics/launcher')
    assert.equal(JSON.parse(diagnostics.body).code, 'EADDRINUSE')
    assert.equal(diagnostics.headers['cache-control'], 'no-store')
    assert.equal((await get(port, '/storyforge/local-diagnostics/launcher', { origin: 'https://attacker.example' })).status, 403)
    assert.equal((await get(port, '/storyforge/local-diagnostics/launcher', {}, 'POST')).status, 405)
    if (process.platform !== 'win32') {
      symlinkSync(join(dir, 'private.txt'), join(web, 'escape.txt'))
      assert.equal((await get(port, '/storyforge/escape.txt')).status, 403)
    }
    assert.ok(Object.values(providerProxies).every(route => new URL(route.target).protocol === 'https:'))
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }) }
})

test('provider proxy streams to a fixed upstream without leaking browser cookies or accepting cross-origin calls', async () => {
  const received = []
  const fixture = createServer((req, res) => {
    received.push({ path: req.url, headers: req.headers, method: req.method })
    req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: first\n\n'); setTimeout(() => res.end('data: last\n\n'), 5) })
  })
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const server = createPortableServer({ requestProvider: (options, callback) => {
    assert.equal(options.hostname, 'api.deepseek.com'); assert.equal(options.port, 443)
    return request({ ...options, hostname: '127.0.0.1', port: fixture.address().port }, callback)
  } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const response = await get(port, '/deepseek-proxy/v1/chat/completions?stream=true', { authorization: 'Bearer fixture-only', cookie: 'browser-secret=fixture', 'content-type': 'application/json' }, 'POST')
    assert.equal(response.body, 'data: first\n\ndata: last\n\n')
    assert.equal(received[0].path, '/v1/chat/completions?stream=true')
    assert.equal(received[0].headers.authorization, 'Bearer fixture-only')
    assert.equal(received[0].headers.cookie, undefined)
    assert.equal((await get(port, '/deepseek-proxy/v1/chat/completions', { origin: 'https://attacker.example' }, 'POST')).status, 403)
    assert.equal(received.length, 1)
  } finally { await new Promise(resolve => server.close(resolve)); await new Promise(resolve => fixture.close(resolve)) }
})
