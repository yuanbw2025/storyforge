import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopDiagnostics } from './diagnostics.mjs'

/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'sf-native-clock-'))
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const diagnostics = desktopDiagnostics(directory, 'v4.0.9+local')
  diagnostics.start()
  t.after(() => { diagnostics.cleanExit(); rmSync(directory, { recursive: true }) })
  return { diagnostics, time: () => now, advance: (/** @type {number} */ ms) => { now += ms },
    read: () => JSON.parse(readFileSync(join(directory, 'native-diagnostics.json'), 'utf8')) }
}
/** @param {number} at @param {string} [action] */
const step = (at, action = 'save') => ({ at: new Date(at).toISOString(), area: 'home', action })

test('retains the original renderer timestamp once a main clock 1ms behind catches up', async t => {
  const f = fixture(t), original = step(f.time() + 1)
  const pending = f.diagnostics.setContext({ enabled: true, trail: [original] })
  f.advance(1)
  await pending
  assert.deepEqual(f.read().context, { enabled: true, trail: [original] })
  f.diagnostics.record('NativeCrash', { process: 'renderer', reason: 'crashed' })
  assert.deepEqual(f.diagnostics.read().at(-1)?.details?.trail, [original])
})
test('does not defer or admit a far-future timestamp', async t => {
  const f = fixture(t)
  await f.diagnostics.setContext({ enabled: true, trail: [step(f.time() + 60_000)] })
  assert.deepEqual(f.read().context, { enabled: true, trail: [] })
})
test('keeps strict future rejection if the wall clock never catches up', async t => {
  const f = fixture(t)
  await f.diagnostics.setContext({ enabled: true, trail: [step(f.time() + 1)] })
  assert.deepEqual(f.read().context, { enabled: true, trail: [] })
})
test('does not extend waiting or admit future context when the wall clock moves backwards', async t => {
  const f = fixture(t)
  const pending = f.diagnostics.setContext({ enabled: true, trail: [step(f.time() + 1)] })
  f.advance(-100); await pending
  assert.deepEqual(f.read().context, { enabled: true, trail: [] })
})
test('a newer full snapshot wins over an older clock-alignment wait', async t => {
  const f = fixture(t), latest = step(f.time(), 'export')
  const pending = f.diagnostics.setContext({ enabled: true, trail: [step(f.time() + 1)] })
  await f.diagnostics.setContext({ enabled: true, trail: [latest] })
  f.advance(1); await pending
  assert.deepEqual(f.read().context, { enabled: true, trail: [latest] })
})
test('revocation immediately scrubs details and cannot be undone by a delayed snapshot', async t => {
  const f = fixture(t)
  f.diagnostics.setContext({ enabled: true, trail: [step(f.time())] })
  f.diagnostics.record('NativeCrash', { process: 'renderer', reason: 'crashed' })
  const pending = f.diagnostics.setContext({ enabled: true, trail: [step(f.time() + 1)] })
  await f.diagnostics.setContext({ enabled: false })
  assert.deepEqual(f.read().context, { enabled: false, trail: [] })
  f.advance(1); await pending
  assert.deepEqual(f.read().context, { enabled: false, trail: [] })
  assert.ok(f.diagnostics.read().every(row => !row.details))
})
test('clean exit invalidates a pending snapshot', async t => {
  const f = fixture(t)
  const pending = f.diagnostics.setContext({ enabled: true, trail: [step(f.time() + 1)] })
  f.diagnostics.cleanExit(); f.advance(1); await pending
  assert.equal(f.read().running, false)
  assert.deepEqual(f.read().context, { enabled: false, trail: [] })
})
test('a new native session invalidates an old pending snapshot', async t => {
  const f = fixture(t)
  const pending = f.diagnostics.setContext({ enabled: true, trail: [step(f.time() + 1)] })
  f.diagnostics.start(); f.advance(1); await pending
  assert.equal(f.read().running, true)
  assert.deepEqual(f.read().context, { enabled: false, trail: [] })
})
test('preserves the five-minute/20-step allowlist and never stores unrelated fields', async t => {
  const f = fixture(t), rows = Array.from({ length: 25 }, (_, i) => ({ ...step(f.time() - 24 + i), text: 'PRIVATE' }))
  await f.diagnostics.setContext({ enabled: true, trail: [step(f.time() - 300_001), ...rows, { ...step(f.time()), area: 'PRIVATE' }], secret: 'PRIVATE' })
  const context = f.read().context
  assert.equal(context.trail.length, 19)
  assert.ok(context.trail.every((/** @type {{ at: string }} */ row) => Date.parse(row.at) <= f.time()))
  assert.equal(JSON.stringify(f.read()).includes('PRIVATE'), false)
})
test('checks the actual five-minute boundary even when all rows fit inside the step cap', async t => {
  const f = fixture(t), boundary = step(f.time() - 300_000), current = step(f.time(), 'export')
  await f.diagnostics.setContext({ enabled: true, trail: [step(f.time() - 300_001), boundary, current] })
  assert.deepEqual(f.read().context.trail, [boundary, current])
})
