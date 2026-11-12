import assert from 'node:assert/strict'
import test from 'node:test'
import { inertModule, onlyUnchangedImports, unchangedFunctions } from './affected-exports.mjs'

const path = 'helpers.ts'
const original = 'function base(){return 1}\nexport function read(){return base()}\nexport function fixture(){return 0}'
const changed = original.replace('return 1', 'return 2')
test('changed helpers select their callers, independent named imports retain their scope', () => {
  const same = unchangedFunctions(path, original, changed)
  assert.deepEqual([...same], ['fixture'])
  for (const [code, expected] of [
    ["import { fixture as setup } from './helpers'", true],
    ["import { read, fixture } from './helpers'", false],
    ["import * as helpers from './helpers'", false],
    ["import type { Shape } from './helpers'", true],
    ["import {fixture} from './helpers'; vi.mock('./helpers')", false],
    ["import {fixture} from './helpers'; import('./helpers')", false],
  ]) assert.equal(onlyUnchangedImports('test.ts', String(code), './helpers', same), expected)
})

test('explicitly erased type imports do not run modules; value, side-effect and mock imports still do', () => {
  const unchanged = new Set()
  const type = "import type { Shape } from './helpers'"
  assert.equal(onlyUnchangedImports('test.ts', type, './helpers', unchanged), true)
  for (const executable of ["import './helpers'", "import { read } from './helpers'", "vi.mock('./helpers')"]) {
    assert.equal(onlyUnchangedImports('test.ts', type + '\n' + executable, './helpers', unchanged), false)
  }
})

test('changed initialization or externally modified bindings keep their direct consumers', () => {
  assert.equal(unchangedFunctions(path, original, changed + '\nsetup()').size, 0)
  const init = '\nconst store = base()'
  assert.equal(unchangedFunctions(path, original + init, changed + init).size, 0)
  const bound = "import { id } from './id'; export function read(){return id()}"
  assert.deepEqual([...unchangedFunctions(path, bound, bound, () => true)], [])
  const extra = "import { id } from './id';" + changed
  assert.equal(unchangedFunctions(path, original, extra).size, 0)
  assert.deepEqual([...unchangedFunctions(path, original, extra, () => false, () => true)], ['fixture'])
  assert.equal(inertModule(path, 'const pattern = /abc/; export function id(){return pattern}'), true)
  assert.equal(inertModule(path, "import './startup'; export function id(){}"), false)
  assert.equal(inertModule(path, 'const id = register()'), false)
})
