import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { createBridge, allowedRequest, validateInput, PREFIX } from './bridge.mjs'

const input = () => ({ id: randomUUID(), model: 'model', messages: [{ role: 'user', content: 'private prompt' }] })
async function fixture(t, generate, journalDir = mkdtempSync(join(tmpdir(), 'sf-bridge-test-')), keepJournal = false) {
  const runtime = { account: async () => ({ state: 'ready' }), models: async () => [], generate, close() {} }
  const bridge = createBridge({ runtime, journalDir })
  const server = createServer((req, res) => bridge.middleware(req, res, () => { res.writeHead(404); res.end() }))
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const request = (path, body, headers = {}) => fetch(`${base}${PREFIX}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-StoryForge-Codex': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  t.after(async () => { bridge.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); if (!keepJournal) rmSync(journalDir, { recursive: true, force: true }) })
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
  for (const patch of [{ cwd: '/tmp' }, { tools: [] }, { baseUrl: 'https://api.openai.com' }, { messages: [{ role: 'developer', content: '' }] }, { model: '' }, { outputSchema: [] }, { receiptRetention: null }, { receiptRetention: 'unknown' }]) assert.throws(() => validateInput({ ...input(), ...patch }))
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
  assert.equal(record.requestHash, createHash('sha256').update(JSON.stringify(body)).digest('hex'))
  assert.equal(record.requestHashAlgorithm, 'sha256-json-request-v1')
  assert.equal('hash' in record, false)
  const listed = (await (await f.request('/requests')).json()).records.find(r => r.id === body.id)
  assert.equal(listed.requestHash, record.requestHash)
  const raw = readFileSync(join(f.journalDir, 'receipts.json'), 'utf8')
  assert.equal(raw.includes('private prompt'), false)
  if (process.platform !== 'win32') assert.equal(statSync(join(f.journalDir, 'receipts.json')).mode & 0o777, 0o600)
  assert.throws(() => createBridge({ journalDir: f.journalDir }), /已有/)
})
test('a completed original receipt keeps exact request identity, raw and usage after restart, with read-only lookup and zero new generation', async t => {
  const original = await fixture(t, async (_input, notify) => {
    notify({ dispatched: true }); notify({ text: '{"title":"retained original"}', usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 } })
  }, undefined, true)
  const body = { ...input(), responseFormat: 'json_object', outputSchema: { type: 'object', properties: { title: { type: 'string' } } } }
  await original.request('/requests', body); await tick()
  const saved = await (await original.request(`/requests/${body.id}`)).json()
  assert.equal(saved.status, 'completed')
  assert.equal(saved.requestHash, createHash('sha256').update(JSON.stringify(body)).digest('hex'))
  original.bridge.close()
  let calls = 0
  const reopened = await fixture(t, async () => { calls++ }, original.journalDir)
  const restored = await (await reopened.request(`/requests/${body.id}`)).json()
  assert.deepEqual(restored, saved)
  assert.equal((await (await reopened.request('/requests')).json()).records[0].requestHash, saved.requestHash)
  assert.equal(calls, 0)
  assert.equal(readFileSync(join(reopened.journalDir, 'receipts.json'), 'utf8').includes('private prompt'), false)
})
const retainedInput = () => ({ ...input(), receiptRetention: 'until-owner-ack-v1' })
const hashText = text => createHash('sha256').update(text).digest('hex')
const acknowledgement = record => ({ decision: 'owner-record-saved-v1', model: record.model,
  requestHash: record.requestHash, rawResponseHash: hashText(record.text) })
test('unacknowledged owner receipts survive age and history pruning; exact owner handoff permits later retirement', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-retained-')), body = retainedInput()
  const held = { id: body.id, hash: hashText(JSON.stringify(body)), model: body.model, createdAt: Date.now() - 48 * 3600_000,
    status: 'completed', text: 'old original raw', dispatched: true, receiptRetention: body.receiptRetention }
  writeFileSync(join(directory, 'receipts.json'), JSON.stringify([held, ...Array.from({ length: 100 }, () => ({
    id: randomUUID(), hash: 'b'.repeat(64), model: 'model', createdAt: Date.now(), status: 'completed', text: 'ordinary', dispatched: true,
  }))]))
  let calls = 0
  const f = await fixture(t, async () => { calls++ }, directory)
  const record = await (await f.request(`/requests/${body.id}`)).json()
  assert.equal(record.text, held.text); assert.equal(record.requestHash, held.hash)
  assert.equal((await (await f.request('/requests')).json()).records.length, 100)
  const ownerSavedRaw = record.text
  assert.equal((await f.request(`/requests/${body.id}/acknowledge`, acknowledgement(record))).status, 200)
  assert.equal((await f.request(`/requests/${body.id}`)).status, 404)
  assert.equal(ownerSavedRaw, held.text); assert.equal(calls, 0)
})
test('owner handoff rejects wrong identity, raw, missing decision and active results without releasing retention', async t => {
  const f = await fixture(t, async (_input, notify) => { notify({ dispatched: true }); notify({ text: 'exact original' }) })
  const body = retainedInput(); await f.request('/requests', body); await tick()
  const record = await (await f.request(`/requests/${body.id}`)).json(), good = acknowledgement(record)
  const before = readFileSync(join(f.journalDir, 'receipts.json'), 'utf8')
  for (const patch of [{ requestHash: 'f'.repeat(64) }, { rawResponseHash: 'e'.repeat(64) }, { model: 'foreign' }]) {
    assert.equal((await f.request(`/requests/${body.id}/acknowledge`, { ...good, ...patch })).status, 409)
  }
  assert.equal((await f.request(`/requests/${body.id}/acknowledge`, { ...good, decision: 'unconfirmed' })).status, 400)
  assert.equal(readFileSync(join(f.journalDir, 'receipts.json'), 'utf8'), before)
  const once = await (await f.request(`/requests/${body.id}/acknowledge`, good)).json()
  const twice = await (await f.request(`/requests/${body.id}/acknowledge`, good)).json()
  assert.deepEqual(twice, once); assert.equal(once.status, 'completed')
  const active = await fixture(t, async (_input, notify, signal) => {
    notify({ dispatched: true }); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
  })
  const pending = retainedInput(); await active.request('/requests', pending)
  const pendingRecord = await (await active.request(`/requests/${pending.id}`)).json()
  assert.equal((await active.request(`/requests/${pending.id}/acknowledge`, acknowledgement(pendingRecord))).status, 409)
})
test('the 33rd durable request is refused instead of deleting any uncollected original; owner handoff frees one slot', async t => {
  let calls = 0
  const f = await fixture(t, async (_input, notify) => { calls++; notify({ dispatched: true }); notify({ text: 'retained' }) })
  const originals = []
  for (let n = 0; n < 32; n++) { const body = retainedInput(); originals.push(body); assert.equal((await f.request('/requests', body)).status, 202) }
  await tick()
  const next = retainedInput()
  assert.equal((await f.request('/requests', next)).status, 409)
  assert.equal((await (await f.request('/requests')).json()).records.length, 32); assert.equal(calls, 32)
  const original = await (await f.request(`/requests/${originals[0].id}`)).json()
  await f.request(`/requests/${original.id}/acknowledge`, acknowledgement(original))
  assert.equal((await f.request('/requests', next)).status, 202); await tick(); assert.equal(calls, 33)
})
test('restart preserves held partial/unknown evidence without turning it into a completed reply', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-retained-unknown-')), body = retainedInput()
  writeFileSync(join(directory, 'receipts.json'), JSON.stringify([{ id: body.id, hash: hashText(JSON.stringify(body)), model: body.model,
    createdAt: Date.now() - 48 * 3600_000, status: 'running', text: 'partial original', dispatched: true, receiptRetention: body.receiptRetention }]))
  let calls = 0
  const f = await fixture(t, async () => { calls++ }, directory)
  const record = await (await f.request(`/requests/${body.id}`)).json()
  assert.equal(record.status, 'unknown'); assert.equal(record.text, 'partial original'); assert.equal(calls, 0)
  const ack = await (await f.request(`/requests/${body.id}/acknowledge`, acknowledgement(record))).json()
  assert.equal(ack.status, 'unknown'); assert.equal((await f.request(`/requests/${body.id}`)).status, 404)
})
test('unrecognized retention metadata blocks startup and preserves original journal bytes', t => {
  for (const patch of [{ receiptRetention: 'future-unknown' }, { receiptRetention: 'until-owner-ack-v1', ownerAcknowledgedAt: 'invalid' }]) {
    const directory = mkdtempSync(join(tmpdir(), 'sf-retention-corrupt-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const bytes = JSON.stringify([{ id: randomUUID(), hash: 'a'.repeat(64), model: 'model', createdAt: Date.now(), text: 'retain original', status: 'completed', ...patch }])
    writeFileSync(join(directory, 'receipts.json'), bytes)
    assert.throws(() => createBridge({ journalDir: directory }), /恢复记录无法读取/)
    assert.equal(readFileSync(join(directory, 'receipts.json'), 'utf8'), bytes)
  }
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
