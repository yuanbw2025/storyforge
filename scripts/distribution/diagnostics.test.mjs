import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { beginLauncherSession, readLauncherFailure, recordLauncherFailure } from './diagnostics.mjs'

test('a real fatal Node exception writes a safe receipt without suppressing termination', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-fatal-diagnostics-'))
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      "const {monitorLauncherFailures}=await import(process.argv[1]); monitorLauncherFailures(process.argv[2]); throw new Error('PRIVATE-SENTINEL');",
      new URL('./diagnostics.mjs', import.meta.url).href, directory], { stdio: 'ignore', timeout: 5_000 })
    assert.equal(result.status, 1)
    assert.equal(readLauncherFailure(directory).code, 'UNCAUGHT')
    assert.ok(!readFileSync(join(directory, 'last-failure.json'), 'utf8').includes('PRIVATE-SENTINEL'))
  } finally { rmSync(directory, { recursive: true }) }
})

test('launcher failures preserve only allowlisted metadata and normal shutdown is not a crash', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-diagnostics-'))
  try {
    const stop = beginLauncherSession(directory)
    recordLauncherFailure({ code: 'EADDRINUSE', message: 'SECRET manuscript', stack: 'SECRET API Key' }, directory)
    assert.equal(readLauncherFailure(directory).code, 'EADDRINUSE')
    assert.ok(!readFileSync(join(directory, 'last-failure.json'), 'utf8').includes('SECRET'))
    stop()
    beginLauncherSession(directory, () => false)()
    assert.equal(readLauncherFailure(directory).kind, 'error')
  } finally { rmSync(directory, { recursive: true }) }
})

test('interruption is uncertain, proven crashes survive restart, and corrupt metadata is ignored', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-diagnostics-'))
  try {
    writeFileSync(join(directory, 'session.json'), JSON.stringify({ running: true, pid: 999999, startedAt: new Date().toISOString() }))
    beginLauncherSession(directory, () => false)
    assert.equal(readLauncherFailure(directory).kind, 'interrupted')
    recordLauncherFailure({ code: 'UNCAUGHT' }, directory)
    beginLauncherSession(directory, () => false)()
    assert.equal(readLauncherFailure(directory).code, 'UNCAUGHT')
    writeFileSync(join(directory, 'last-failure.json'), '{broken')
    assert.equal(readLauncherFailure(directory), null)
    writeFileSync(join(directory, 'last-failure.json'), 'x'.repeat(10_000))
    assert.equal(readLauncherFailure(directory), null)
    writeFileSync(join(directory, 'last-failure.json'), JSON.stringify({ occurredAt: new Date().toISOString(), kind: 'error', code: 'SECRET' }))
    assert.equal(readLauncherFailure(directory), null)
  } finally { rmSync(directory, { recursive: true }) }
})
