import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const script = fileURLToPath(new URL('./build-upgrade-fixture.mjs', import.meta.url))
function source(parent, name, version, schema) {
  const root = path.join(parent, name)
  mkdirSync(path.join(root, 'tests/helpers'), { recursive: true })
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }))
  const entry = `globalThis.__nativeUpgrade = { schema: ${schema} }\n`
  writeFileSync(path.join(root, 'tests/helpers/native-upgrade-fixture.ts'), entry)
  return { root, entry }
}
test('separate previous/current producers bind their own source version and bytes, regardless of cwd', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'storyforge-fixture-sources-'))
  try {
    const previous = source(directory, 'previous', '4.0.4', 11)
    const current = source(directory, 'current', '4.0.5', 13)
    for (const [selected, version, schema] of [[previous, '4.0.4', 11], [current, '4.0.5', 13]]) {
      const output = path.join(directory, version + '.js')
      const result = spawnSync(process.execPath, [script, selected.root, output, version], { cwd: current.root, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      const context = vm.createContext({})
      vm.runInContext(readFileSync(output, 'utf8'), context)
      assert.equal(context.__nativeUpgrade.schema, schema)
      assert.equal(context.__nativeUpgradeSource.version, version)
      assert.equal(context.__nativeUpgradeSource.entrySha256, createHash('sha256').update(selected.entry).digest('hex'))
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('a mismatched expected source version fails before an output can be used', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'storyforge-fixture-version-'))
  try {
    const previous = source(directory, 'previous', '4.0.4', 11)
    const output = path.join(directory, 'wrong.js')
    const result = spawnSync(process.execPath, [script, previous.root, output, '4.0.5'], { cwd: previous.root, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /source version/i)
    assert.throws(() => readFileSync(output))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
