import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { installHttpTransport } from './http-transport.mjs'

/** @param {import("./http-transport.mjs").RelayFetch} fetch */
function fixture(fetch = async () => new Response('data: 中文\n\n')) {
  const handlers = new Map()
  /** @type {Parameters<import("./http-transport.mjs").RelayFetch>[]} */
  const calls = []
  const contents = Object.assign(new EventEmitter(), { mainFrame: { url: 'http://localhost:17831/storyforge/' } })
  const window = { webContents: contents }
  const event = { sender: contents, senderFrame: contents.mainFrame }
  const clear = installHttpTransport({ window, ipcMain: { handle: (key, value) => handlers.set(key, value) },
    origin: 'http://localhost:17831', fetch: (...args) => { calls.push(args); return fetch(...args) } })
  const options = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', url: 'https://relay.example/v1/chat/completions', method: 'POST', headers: { authorization: 'Bearer synthetic-only', cookie: 'session=never-forward', origin: 'forged', 'content-type': 'application/json' }, body: Buffer.from('{}').toString('base64') }
  return { clear, calls, event, contents, options, call: (/** @type {string} */ name, /** @type {{id:string}} */ value, /** @type {import("./http-transport.mjs").Caller} */ caller = event) => handlers.get('client-http:' + name)(caller, value) }
}
test('trusted requests preserve explicit payload and status without cookies, redirect or replay', async () => {
  const f = fixture(async () => new Response('quota', { status: 429, headers: { 'retry-after': '5', 'set-cookie': 'no' } }))
  try {
    const meta = await f.call('open', f.options)
    assert.equal(meta.status, 429); assert.equal(meta.headers['retry-after'], '5'); assert.equal(meta.headers['set-cookie'], undefined)
    const [url, init] = f.calls[0]
    assert.equal(url, f.options.url); assert.equal(init.body?.toString(), '{}')
    assert.deepEqual(init.headers, { authorization: 'Bearer synthetic-only', 'content-type': 'application/json' })
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error')
    assert.equal(Buffer.from((await f.call('read', f.options)).data, 'base64').toString(), 'quota')
    assert.deepEqual(await f.call('read', f.options), { done: true }); assert.equal(f.calls.length, 1)
  } finally { f.clear() }
})
test('foreign windows, iframes and origins cannot dispatch or cancel privileged HTTP', async () => {
  const f = fixture()
  for (const event of [{ sender: {}, senderFrame: f.contents.mainFrame }, { sender: f.contents, senderFrame: { ...f.contents.mainFrame } }]) {
    await assert.rejects(f.call('open', f.options, event), /Untrusted/)
    assert.throws(() => f.call('cancel', f.options, event), /Untrusted/)
  }
  f.contents.mainFrame.url = 'https://attacker.example/storyforge/'
  await assert.rejects(f.call('open', f.options), /Untrusted/)
  assert.equal(f.calls.length, 0)
})
test('non-model URLs, URL credentials, invalid bodies and methods cannot dispatch', async () => {
  const f = fixture()
  for (const change of [{ url: 'file:///tmp/models' }, { url: 'https://user:pass@relay.example/v1/models' },
    { url: 'http://localhost:17831/v1/models' }, { url: 'https://relay.example/admin' }, { method: 'DELETE' }, { body: '*' }, { id: 'invalid' }]) {
    await assert.rejects(f.call('open', { ...f.options, ...change }))
  }
  assert.equal(f.calls.length, 0)
})
test('pulls bounded chunks without corrupting long UTF-8 responses and clears on EOF', async () => {
  const text = '中文'.repeat(50000), f = fixture(async () => new Response(text))
  try {
    await f.call('open', f.options)
    const parts = []
    for (;;) {
      const chunk = await f.call('read', f.options)
      if (chunk.done) break
      const bytes = Buffer.from(chunk.data, 'base64'); assert.ok(bytes.length <= 65536); parts.push(bytes)
    }
    assert.equal(Buffer.concat(parts).toString(), text)
    await assert.rejects(f.call('read', f.options), /unavailable/)
  } finally { f.clear() }
})
test('cancel during opening, renderer navigation and unknown failures never resend', async () => {
  const f = fixture((_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('cancelled')))))
  const first = f.call('open', f.options); f.call('cancel', f.options)
  await assert.rejects(first); assert.equal(f.calls.length, 1)
  const second = f.call('open', f.options); f.contents.emit('did-start-navigation', {}, '', false, true)
  await assert.rejects(second); assert.equal(f.calls.length, 2)
  const broken = fixture(async () => { throw new Error('secret provider detail') })
  await assert.rejects(broken.call('open', broken.options), error => error instanceof Error && !error.message.includes('secret'))
  assert.equal(broken.calls.length, 1)
})
test('duplicate IDs and bounded concurrency reject before another dispatch, destruction releases all', async () => {
  const f = fixture()
  try {
    await f.call('open', f.options)
    await assert.rejects(f.call('open', f.options), /active/)
    for (let i = 1; i < 32; i++) await f.call('open', { ...f.options, id: i.toString(16).padStart(36, '0') })
    await assert.rejects(f.call('open', { ...f.options, id: 'b'.repeat(36) }), /active/)
    assert.equal(f.calls.length, 32)
    f.contents.emit('destroyed')
    assert.ok(f.calls.every(([, options]) => options.signal?.aborted))
    await assert.rejects(f.call('read', f.options), /unavailable/)
  } finally { f.clear() }
})

test('chunked large body sends exactly one complete POST with verified SHA-256 and blocked tampering', async () => {
  const f = fixture()
  const body = Buffer.alloc(4 * 1024 * 1024 + 17, 0x5a)
  const hash = createHash('sha256').update(body).digest('hex')
  const chunkSize = 4 * 1024 * 1024
  const send = async (index, total, data, digest = hash, url = f.options.url, method = f.options.method) =>
    f.call('openChunked', { ...f.options, chunkIndex: String(index), totalChunks: String(total), bodySha256: digest,
      body: data.toString('base64'), url, method })
  try {
    const capabilities = await f.call('capabilities', { id: f.options.id })
    assert.equal(capabilities.chunkedBodyVersion, 1)
    const first = await send(0, 2, body.subarray(0, chunkSize))
    assert.equal(first.status, 0)
    assert.equal(f.calls.length, 0)
    const second = await send(1, 2, body.subarray(chunkSize))
    assert.equal(second.status, 200)
    assert.equal(f.calls.length, 1)
    const [, init] = f.calls[0]
    assert.equal(Buffer.compare(init.body, body), 0)
    assert.equal(init.method, 'POST')
    assert.equal(Buffer.from((await f.call('read', f.options)).data, 'base64').toString(), 'data: 中文\n\n')
  } finally { f.clear() }
})
test('incomplete sequence, duplicate index, wrong hash, inconsistent url or cancel never dispatch', async () => {
  const body = Buffer.alloc(4 * 1024 * 1024 + 1, 0x41)
  const hash = createHash('sha256').update(body).digest('hex')
  const make = () => fixture()
  const base = { chunkIndex: '0', totalChunks: '2', bodySha256: hash, body: body.subarray(0, 4 * 1024 * 1024).toString('base64') }
  const cases = [
    ['incomplete', async f => { await f.call('openChunked', { ...f.options, ...base }); assert.equal(f.calls.length, 0) }],
    ['duplicate', async f => { await f.call('openChunked', { ...f.options, ...base }); await assert.rejects(f.call('openChunked', { ...f.options, ...base }), /Inconsistent|chunk/) }],
    ['hash', async f => { await f.call('openChunked', { ...f.options, ...base }); await assert.rejects(f.call('openChunked', { ...f.options, ...base, chunkIndex: '1', bodySha256: '0'.repeat(64), body: body.subarray(4 * 1024 * 1024).toString('base64') }), /Inconsistent|chunk/) }],
    ['url', async f => { await f.call('openChunked', { ...f.options, ...base }); await assert.rejects(f.call('openChunked', { ...f.options, ...base, chunkIndex: '1', url: 'https://other.example/v1/chat/completions', body: body.subarray(4 * 1024 * 1024).toString('base64') }), /Inconsistent|chunk/) }],
    ['cancel', async f => { await f.call('openChunked', { ...f.options, ...base }); await f.call('cancel', { id: f.options.id }); await assert.rejects(f.call('openChunked', { ...f.options, ...base, chunkIndex: '1', body: body.subarray(4 * 1024 * 1024).toString('base64') }), /Cancelled|chunk/) }],
  ]
  for (const [label, run] of cases) {
    const f = make()
    try { await run(f); assert.equal(f.calls.length, 0, label) } finally { f.clear() }
  }
})
test('legacy single open still accepts bodies above the old 32MiB cap as one complete POST', async () => {
  const f = fixture()
  const body = Buffer.alloc(33 * 1024 * 1024, 0x31)
  try {
    const meta = await f.call('open', { ...f.options, body: body.toString('base64') })
    assert.equal(meta.status, 200)
    assert.equal(f.calls.length, 1)
    assert.equal(Buffer.compare(f.calls[0][1].body, body), 0)
  } finally { f.clear() }
})
