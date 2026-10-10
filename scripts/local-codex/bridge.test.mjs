import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createBridge, allowedRequest, validateInput, PREFIX } from './bridge.mjs'

const input = () => ({ id: randomUUID(), model: 'model', messages: [{ role: 'user', content: 'private prompt' }] })
async function fixture(t, generate, journalDir = mkdtempSync(join(tmpdir(), 'sf-bridge-test-'))) {
  const runtime = { account: async () => ({ state: 'ready' }), models: async () => [], generate, close() {} }
  const bridge = createBridge({ runtime, journalDir })
  const server = createServer((req, res) => bridge.middleware(req, res, () => { res.writeHead(404); res.end() }))
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const request = (path, body, headers = {}) => fetch(`${base}${PREFIX}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-StoryForge-Codex': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  t.after(async () => { bridge.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(journalDir, { recursive: true, force: true }) })
  return { request, bridge, journalDir }
}
const tick = () => new Promise(r => setTimeout(r, 10))

test('loopback, host, origin and custom header must all match; LAN and cross-site rejected', () => {
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:1111', origin: 'http://localhost:1111', 'x-storyforge-codex': '1', 'sec-fetch-site': 'same-origin' } }
  assert.equal(allowedRequest(req), true)
  for (const patch of [{ host: 'attacker.test:1111' }, { origin: 'https://attacker.test' }, { 'x-storyforge-codex': undefined }, { 'sec-fetch-site': 'cross-site' }]) assert.equal(allowedRequest({ ...req, headers: { ...req.headers, ...patch } }), false)
  assert.equal(allowedRequest({ ...req, socket: { remoteAddress: '192.168.1.2' } }), false)
})
test('only bounded text protocol is accepted; no cwd, baseURL, tools or role injection', () => {
  assert.deepEqual(validateInput(input()).model, 'model')
  for (const patch of [{ cwd: '/tmp' }, { tools: [] }, { baseUrl: 'https://api.openai.com' }, { messages: [{ role: 'developer', content: '' }] }, { model: '' }, { outputSchema: [] }]) assert.throws(() => validateInput({ ...input(), ...patch }))
})
test('same request ID does not generate twice, conflict rejected; journal contains no prompts', async t => {
  let calls = 0
  const f = await fixture(t, async (_input, notify) => { calls++; notify({ dispatched: true }); notify({ text: '候选' }) })
  const body = input()
  assert.equal((await f.request('/requests', body)).status, 202)
  assert.equal((await f.request('/requests', body)).status, 200)
  assert.equal((await f.request('/requests', { ...body, model: 'different' })).status, 409)
  const record = await (await f.request(`/requests/${body.id}`)).json()
  assert.equal(calls, 1); assert.equal(record.status, 'completed'); assert.equal(record.text, '候选')
  const raw = readFileSync(join(f.journalDir, 'receipts.json'), 'utf8')
  assert.equal(raw.includes('private prompt'), false)
  if (process.platform !== 'win32') assert.equal(statSync(join(f.journalDir, 'receipts.json')).mode & 0o777, 0o600)
  assert.throws(() => createBridge({ journalDir: f.journalDir }), /已有/)
})
test('foreign origins and preflight cannot start runtime or return data', async t => {
  let calls = 0
  const f = await fixture(t, async () => { calls++ })
  assert.equal((await f.request('/requests', input(), { Origin: 'https://evil.test' })).status, 403)
  assert.equal(calls, 0)
})
test('queued cancellation prevents dispatch; disconnect does not call account/logout', async t => {
  let calls = 0
  const f = await fixture(t, async (_input, notify, signal) => { calls++; notify({ dispatched: true }); await new Promise(r => signal.addEventListener('abort', r, { once: true })) })
  const first = input(); const second = input()
  await f.request('/requests', first); await f.request('/requests', second)
  await f.request(`/requests/${second.id}/cancel`, {})
  await f.request('/disconnect', {}); await tick()
  assert.equal(calls, 1)
  assert.equal((await (await f.request(`/requests/${first.id}`)).json()).status, 'unknown')
})
test('unfinished journal reopens as unknown, preserves completed records, and never replays', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-restart-')); const id = randomUUID()
  writeFileSync(join(directory, 'receipts.json'), JSON.stringify([{ id, createdAt: Date.now(), status: 'running', text: 'partial', dispatched: true }]))
  let calls = 0
  const f = await fixture(t, async () => { calls++ }, directory)
  assert.equal((await (await f.request(`/requests/${id}`)).json()).status, 'unknown')
  assert.equal(calls, 0)
})
test('quota/transport failure after dispatch is unknown and never retried', async t => {
  let calls = 0
  const f = await fixture(t, async (_input, notify) => { calls++; notify({ dispatched: true }); throw new Error('quota') })
  const body = input(); await f.request('/requests', body)
  const record = await (await f.request(`/requests/${body.id}`)).json()
  assert.equal(record.status, 'unknown'); assert.equal(calls, 1)
})
