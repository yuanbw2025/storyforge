/* global process */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./test-release-apk-upgrade.sh', import.meta.url))

function runProbe(failBaseline = false) {
  const directory = mkdtempSync(path.join(tmpdir(), 'storyforge-upgrade-order-'))
  const bin = path.join(directory, 'bin')
  const sdk = path.join(directory, 'sdk')
  const trace = path.join(directory, 'adb-trace.jsonl')
  mkdirSync(bin)
  mkdirSync(path.join(sdk, 'build-tools/35.0.0'), { recursive: true })
  mkdirSync(path.join(directory, 'release-test'))
  for (const name of ['old', 'new', 'runner']) {
    writeFileSync(path.join(directory, `release-test/upgrade-test-${name}.apk`), name)
  }
  writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '4.0.3' }))
  writeFileSync(path.join(sdk, 'build-tools/35.0.0/apksigner'), `#!/usr/bin/env node
console.log('Signer #1 certificate SHA-256 digest: 4bc440d0734135945d9cc143bb45723fa750e1a6d03bfb9753c165e9c3c056f0')
`, { mode: 0o700 })
  writeFileSync(path.join(bin, 'adb'), `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.ADB_TRACE, JSON.stringify(args) + '\\n')
const calls = fs.readFileSync(process.env.ADB_TRACE, 'utf8').trim().split('\\n').map(line => JSON.parse(line))
if (args.includes('instrument')) {
  const phase = args[args.indexOf('phase') + 1]
  const replaced = calls.some(call => call[0] === 'install' && call[1] === '-r')
  console.log(process.env.FAIL_BASELINE === '1' && phase === 'baseline' && !replaced
    ? 'FAILURES!!! Tests run: 1, Failures: 1' : 'OK (1 test)')
} else if (args.includes('dumpsys')) console.log('versionName=4.0.3')
`, { mode: 0o700 })
  const result = spawnSync('bash', [script], {
    cwd: directory,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, ANDROID_HOME: sdk, PREVIOUS_CLIENT_VERSION: '4.0.2', ADB_TRACE: trace, FAIL_BASELINE: failBaseline ? '1' : '0' },
    encoding: 'utf8',
  })
  return { directory, result, calls: readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line)) }
}

test('formal replacement follows a successful old-package restart and preserves separate evidence', () => {
  const probe = runProbe()
  try {
    assert.equal(probe.result.status, 0, probe.result.stdout + probe.result.stderr)
    const phases = probe.calls.filter(call => call.includes('instrument'))
    assert.deepEqual(phases.map(call => call[call.indexOf('phase') + 1]), ['seed', 'baseline', 'restore', 'restart'])
    assert.deepEqual(phases.map(call => call[call.indexOf('expectedVersion') + 1]), ['4.0.2', '4.0.2', '4.0.3', '4.0.3'])
    const baseline = probe.calls.indexOf(phases[1])
    const replacement = probe.calls.findIndex(call => call[0] === 'install' && call[1] === '-r')
    assert.ok(baseline < replacement)
    for (const name of ['seed', 'baseline-restart', 'restore', 'restart']) {
      assert.match(readFileSync(path.join(probe.directory, `release-test/${name}.txt`), 'utf8'), /OK \(1 test\)/)
    }
  } finally { rmSync(probe.directory, { recursive: true, force: true }) }
})

test('old-package baseline failure stops before replacement even when instrumentation exits zero', () => {
  const probe = runProbe(true)
  try {
    assert.notEqual(probe.result.status, 0)
    assert.equal(probe.calls.some(call => call[0] === 'install' && call[1] === '-r'), false)
    assert.match(readFileSync(path.join(probe.directory, 'release-test/baseline-restart.txt'), 'utf8'), /FAILURES/)
  } finally { rmSync(probe.directory, { recursive: true, force: true }) }
})
