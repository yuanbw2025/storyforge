import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beginDiagnosticWriteProbe } from './diagnostic-write-probe.mjs'
import { desktopDiagnostics } from './diagnostics.mjs'

test('native write evidence refuses an author profile before touching the application', async () => {
  const absentApp = /** @type {import('playwright').ElectronApplication} */ (/** @type {unknown} */ (undefined))
  await assert.rejects(beginDiagnosticWriteProbe(absentApp, '/author/profile'), /isolated smoke profile/)
})

test('probe observes the real native parser clock and writes without admitting future or private context', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'storyforge-client-smoke-'))
  const fakeApp = { evaluateHandle: async (/** @type {Function} */ callback, /** @type {string} */ value) => {
    const result = await callback({ app: { getPath: () => directory } }, value)
    return { evaluate: (/** @type {Function} */ read) => read(result) }
  } }
  let probe
  try {
    probe = await beginDiagnosticWriteProbe(/** @type {import('playwright').ElectronApplication} */ (/** @type {unknown} */ (fakeApp)), directory)
    const diagnostics = desktopDiagnostics(directory, 'v4.0.9+local')
    diagnostics.start()
    diagnostics.setContext({ enabled: true, trail: [{ at: new Date(Date.now() + 60_000).toISOString(), area: 'home', action: 'save', text: 'PRIVATE' }] })
    const rejected = JSON.parse(readFileSync(join(directory, 'native-diagnostics.json'), 'utf8')).context
    assert.deepEqual(rejected, { enabled: true, trail: [] })
    diagnostics.setContext({ enabled: true, trail: [{ at: new Date().toISOString(), area: 'home', action: 'save', text: 'PRIVATE' }] })
    diagnostics.record('NativeCrash', { process: 'renderer', reason: 'crashed' })
    assert.equal(diagnostics.read()[0]?.details?.trail[0]?.action, 'save')
    diagnostics.setContext({ enabled: false }); assert.equal(diagnostics.read()[0]?.details, undefined)
    const receipt = await probe.evaluate(value => value.finish()); probe = undefined
    assert.ok(receipt.events.some(row => row.kind === 'diagnostic-clock'))
    assert.ok(receipt.events.some(row => row.kind === 'write' && row.count === 1))
    assert.equal(JSON.stringify(receipt).includes('PRIVATE'), false)
  } finally { await probe?.evaluate(value => value.finish()); rmSync(directory, { recursive: true }); }
})

test('isolated native probe delegates real writes, restores builtins, and only retains bounded technical metadata', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'storyforge-client-smoke-'))
  const original = { write: fs.writeFileSync, rename: fs.renameSync, now: Date.now }
  let probe
  const fakeApp = { evaluateHandle: async (/** @type {Function} */ callback, /** @type {string} */ value) => {
    const result = await callback({ app: { getPath: () => directory } }, value)
    return { evaluate: (/** @type {Function} */ read) => read(result) }
  } }
  try {
    probe = await beginDiagnosticWriteProbe(/** @type {import('playwright').ElectronApplication} */ (/** @type {unknown} */ (fakeApp)), directory)
    const file = join(directory, 'native-diagnostics.json')
    const content = JSON.stringify({ secret: 'PRIVATE-SYNTHETIC', context: { enabled: true, trail: [{ at: new Date().toISOString(), area: 'home', action: 'save', text: 'PRIVATE-SYNTHETIC' }] } })
    fs.writeFileSync(file + '.tmp', content); fs.renameSync(file + '.tmp', file)
    assert.equal(readFileSync(file, 'utf8'), content)
    assert.throws(() => fs.renameSync(file + '.tmp', file), { code: 'ENOENT' })
    const evidence = await probe.evaluate(value => value.finish()); probe = undefined
    assert.equal(fs.writeFileSync, original.write); assert.equal(fs.renameSync, original.rename); assert.equal(Date.now, original.now)
    assert.deepEqual(evidence.events.map((/** @type {Record<string, unknown>} */ row) => [row.kind, row.result]), [['write', 'ok'], ['rename', 'ok'], ['rename', 'ENOENT']])
    assert.equal(evidence.events[0].count, 1)
    assert.equal(typeof evidence.events[0].latestAt, 'number')
    assert.equal(JSON.stringify(evidence).includes('PRIVATE-SYNTHETIC'), false)
    assert.equal(JSON.stringify(evidence).includes(directory), false)
  } finally { await probe?.evaluate(value => value.finish()); rmSync(directory, { recursive: true }); }
})
