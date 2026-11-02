import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { assertCompatiblePins, assertNoDebtInFiles, assertRootCoverage, compareDebt, compileRoots, currentScope, debtEntries, lintNode, portablePins } from './check-engineering.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const options = { strict: true, noEmit: true, skipLibCheck: true, types: [],
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sf-engineering-fault-'))

test('real compiler wrong arguments and undefined helpers fail with an existing debt entry present', () => {
  const root = temporary()
  try {
    const file = path.join(root, 'sample.ts')
    fs.writeFileSync(file, 'existingDebt;\nfunction accept(value: number) { return value }\naccept(1);\n')
    const baseline = debtEntries(compileRoots(root, ['sample.ts'], options).diagnostics)
    assert.equal(baseline.length, 1)
    fs.writeFileSync(file, 'existingDebt;\nfunction accept(value: number) { return value }\naccept("wrong");\nundefinedNewHelper();\n')
    const current = debtEntries(compileRoots(root, ['sample.ts'], options).diagnostics)
    const compared = compareDebt(current, baseline)
    assert.equal(compared.passed, false)
    assert.ok(compared.added.some(entry => entry.diagnostic.code === 'TS2345'))
    assert.ok(compared.added.some(entry => entry.diagnostic.code === 'TS2304' && entry.diagnostic.message.includes('undefinedNewHelper')))
    assert.equal(compared.resolved.length, 0)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('healthy source passes and actual checkJs includes an engineering config semantic error', () => {
  const root = temporary()
  try {
    fs.writeFileSync(path.join(root, 'healthy.ts'), 'export function accept(value: number) { return value }\naccept(1);\n')
    assert.deepEqual(compileRoots(root, ['healthy.ts'], options).diagnostics, [])
    fs.writeFileSync(path.join(root, 'build.config.mjs'), '/** @param {number} value */\nfunction accept(value) { return value }\nexport default accept("wrong");\n')
    const current = debtEntries(compileRoots(root, ['build.config.mjs'], { ...options, allowJs: true, checkJs: true }).diagnostics)
    assert.ok(current.some(entry => entry.diagnostic.code === 'TS2345'))
    assert.equal(compareDebt(current, []).passed, false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('real Node ESLint catches an undefined config identifier without inventing browser globals', async () => {
  const root = temporary()
  try {
    const config = pathToFileURL(path.join(repository, 'eslint.tooling.config.mjs')).href
    fs.writeFileSync(path.join(root, 'eslint.tooling.config.mjs'), `export { default } from ${JSON.stringify(config)};\n`)
    fs.writeFileSync(path.join(root, 'build.config.mjs'), 'console.log(process.version);\nexport default { port: missingBuildPort };\n')
    fs.mkdirSync(path.join(root, 'scripts'))
    fs.writeFileSync(path.join(root, 'scripts/newly-added.mjs'), 'console.log(undefinedNewScriptHelper);\n')
    fs.mkdirSync(path.join(root, 'tests'))
    fs.writeFileSync(path.join(root, 'tests/active.ts'), 'export const active = true;\n')
    fs.mkdirSync(path.join(root, 'tools'))
    fs.writeFileSync(path.join(root, 'tools/contract.d.mts'), 'export declare const declaredPort: number;\n')
    fs.writeFileSync(path.join(root, 'tools/current-config.cts'), 'const ctsPort: number = 443; console.log(ctsPort);\n')
    const scope = currentScope(root, ['build.config.mjs', 'scripts/newly-added.mjs', 'tests/active.ts', 'tools/contract.d.mts', 'tools/current-config.cts'], [])
    assert.ok(scope.tooling.includes('scripts/newly-added.mjs'))
    assert.ok(scope.tooling.includes('tools/contract.d.mts'))
    assert.ok(scope.tooling.includes('tools/current-config.cts'))
    const current = debtEntries(await lintNode(root, scope.tooling))
    assert.equal(current.length, 2)
    assert.ok(current.every(entry => entry.diagnostic.code === 'no-undef'))
    assert.ok(current.some(entry => entry.diagnostic.file === 'scripts/newly-added.mjs' && entry.diagnostic.message.includes('undefinedNewScriptHelper')))
    assert.equal(compareDebt(current, []).passed, false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('duplicate error counts and fixed-debt ratchet cannot be hidden by a total quota', () => {
  const diagnostic = { kind: /** @type {const} */ ('typescript'), file: 'test.ts', code: 'TS2304', message: 'Unknown name', anchor: 'same-line', line: 1, column: 1, start: 0, length: 3 }
  const old = debtEntries([diagnostic])
  const repeated = debtEntries([diagnostic, { ...diagnostic, start: 10, line: 2 }])
  assert.equal(repeated[0].count, 2)
  assert.equal(compareDebt(repeated, old).passed, false)
  assert.equal(compareDebt([], old).passed, false)
  assert.equal(compareDebt(old, old).passed, true)
  assert.throws(() => assertNoDebtInFiles([diagnostic], ['test.ts']), /previously clean/)
  const replaced = debtEntries([{ ...diagnostic, code: 'TS2345', message: 'Different error at the same total count' }])
  assert.equal(replaced[0].count, old[0].count)
  assert.equal(compareDebt(replaced, old).passed, false)
  assert.equal(compareDebt(replaced, old).added.length, 1)
  assert.equal(compareDebt(replaced, old).resolved.length, 1)
})

test('real parsed options from two checkouts have portable pins without changing actual compiler paths or options', () => {
  const first = temporary(), second = temporary()
  /** @param {string} root
   * @param {string} target */
  const readOptions = (root, target) => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.mkdirSync(path.join(root, 'types'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src/fixture.ts'), 'export const fixture: number = 1;\n')
    const file = path.join(root, 'tsconfig.json')
    fs.writeFileSync(file, JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target,
      module: 'NodeNext', moduleResolution: 'NodeNext', baseUrl: '.', rootDir: '.', typeRoots: ['./types'],
      paths: { '@fixture/*': ['./src/*'] } }, files: ['src/fixture.ts'] }))
    const source = ts.readConfigFile(file, ts.sys.readFile)
    assert.equal(source.error, undefined)
    const parsed = ts.parseJsonConfigFileContent(source.config, ts.sys, root, undefined, file)
    assert.deepEqual(parsed.errors, [])
    assert.equal(parsed.options.baseUrl, root)
    assert.equal(parsed.options.rootDir, root)
    assert.deepEqual(parsed.options.typeRoots, [path.join(root, 'types')])
    return parsed.options
  }
  try {
    const a = readOptions(first, 'ES2020'), b = readOptions(second, 'ES2020')
    assert.deepEqual(compileRoots(first, ['src/fixture.ts'], a).diagnostics, [])
    assert.deepEqual(compileRoots(second, ['src/fixture.ts'], b).diagnostics, [])
    const originalA = JSON.stringify(a), originalB = JSON.stringify(b)
    const pinsA = portablePins(first, { compilerOptions: a }), pinsB = portablePins(second, { compilerOptions: b })
    assert.deepEqual(pinsA, pinsB)
    assert.doesNotThrow(() => assertCompatiblePins(pinsA, pinsB))
    assert.equal(JSON.stringify(a), originalA)
    assert.equal(JSON.stringify(b), originalB)
    const changed = readOptions(second, 'ES2022')
    assert.notEqual(changed.target, a.target)
    assert.throws(() => assertCompatiblePins(pinsA, portablePins(second, { compilerOptions: changed })), /pins changed/)
    const outside = `${first}-outside`
    assert.deepEqual(portablePins(first, { rootDir: outside }), { rootDir: outside })
    assert.throws(() => assertCompatiblePins(portablePins(first, { typeRoots: [outside] }), portablePins(second, { typeRoots: [`${second}-outside`] })), /pins changed/)
  } finally {
    fs.rmSync(first, { recursive: true, force: true })
    fs.rmSync(second, { recursive: true, force: true })
  }
})

test('root coverage is exact and a historical exception cannot exclude a new file or changed bytes', () => {
  const root = temporary()
  try {
    fs.mkdirSync(path.join(root, 'tests/raw'), { recursive: true })
    fs.writeFileSync(path.join(root, 'tests/raw/old.ts'), 'export const original = 1\n')
    fs.writeFileSync(path.join(root, 'tests/raw/new.ts'), 'export const current = 2\n')
    fs.writeFileSync(path.join(root, 'script.mjs'), 'export const current = 3\n')
    const historical = { path: 'tests/raw/old.ts', reason: 'Frozen original diagnostic evidence',
      sha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'tests/raw/old.ts'))).digest('hex') }
    const scope = currentScope(root, ['tests/raw/old.ts', 'tests/raw/new.ts', 'script.mjs'], [historical])
    assert.deepEqual(scope.tests, ['tests/raw/new.ts'])
    assert.throws(() => assertRootCoverage(['a.ts', 'b.ts'], [['a.ts']]), /coverage/)
    assert.throws(() => assertRootCoverage(['a.ts', 'b.ts'], [['a.ts'], ['a.ts']]), /coverage/)
    fs.appendFileSync(path.join(root, 'tests/raw/old.ts'), '// changed\n')
    assert.throws(() => currentScope(root, ['tests/raw/old.ts', 'tests/raw/new.ts', 'script.mjs'], [historical]), /Historical bytes changed/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('the actual CI entry retains production checking and reaches engineering semantics', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repository, 'package.json'), 'utf8'))
  assert.match(pkg.scripts.ci, /npx tsc --noEmit/)
  assert.match(pkg.scripts.ci, /npm run check:engineering/)
  assert.doesNotMatch(pkg.scripts.ci, /npm run check:types:open-world-experience/)
  assert.equal(pkg.scripts['check:engineering'], 'node scripts/quality/check-engineering.mjs')
  assert.equal(pkg.scripts['test:engineering-gate'], 'node --test scripts/quality/check-engineering.test.mjs')
})
