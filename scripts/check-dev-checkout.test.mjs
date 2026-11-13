import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

const source = new URL('../package.json', import.meta.url)
const scripts = JSON.parse(readFileSync(source, 'utf8')).scripts
const required = ['vite.config.ts', 'vite.adventure-player.config.ts', 'tsconfig.json', 'tsconfig.tests.json', 'tsconfig.tooling.json', 'index.html', 'src/entry.ts', 'src/main.tsx']
function fixture(t, missing) {
  const root = mkdtempSync(join(tmpdir(), 'storyforge checkout '))
  // Retain fixtures for failure diagnostics; never touch an existing checkout.
  for (const file of required.filter(file => file !== missing)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), '')
  }
  const guard = new URL('./check-dev-checkout.mjs', import.meta.url)
  if (existsSync(guard)) {
    mkdirSync(join(root, 'scripts'), { recursive: true })
    cpSync(guard, join(root, 'scripts/check-dev-checkout.mjs'))
  }
  writeFileSync(join(root, 'vite-stub.cjs'), "require('node:fs').writeFileSync('vite-started', 'yes')")
  writeFileSync(join(root, 'author-note.txt'), 'keep my local edits')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { ...scripts, dev: 'node vite-stub.cjs' } }))
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' })
  t.diagnostic('isolated fixture: ' + root)
  assert.equal(readFileSync(join(root, 'author-note.txt'), 'utf8'), 'keep my local edits')
  return { result, root }
}

test('npm dev refuses a missing Vite config before launching Vite', t => {
  const { result, root } = fixture(t, 'vite.config.ts')
  assert.notEqual(result.status, 0)
  assert.equal(existsSync(join(root, 'vite-started')), false)
  assert.match(result.stderr, /vite\.config\.ts/)
  assert.match(result.stderr, /core\.longpaths=true/)
})

test('npm dev refuses a truncated checkout missing TypeScript config', t => {
  const { result, root } = fixture(t, 'tsconfig.tooling.json')
  assert.notEqual(result.status, 0)
  assert.equal(existsSync(join(root, 'vite-started')), false)
})

test('npm dev refuses a missing actual browser entry', t => {
  const { result, root } = fixture(t, 'src/entry.ts')
  assert.notEqual(result.status, 0)
  assert.equal(existsSync(join(root, 'vite-started')), false)
})

test('complete source ZIP without Git metadata can start normally', t => {
  const { result, root } = fixture(t)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(join(root, 'vite-started')), true)
})
