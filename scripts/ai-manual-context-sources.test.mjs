import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { readStaticContextSources } from './ai-manual-context-sources.mjs'

/** @param {import('node:test').TestContext} t @param {Record<string, string>} files */
function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyforge-sfqa141-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(root, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
  }
  return path.join(root, 'source.ts')
}

/** @param {string} expression @param {string} [prefix] */
const source = (expression, prefix = '') => `${prefix}\nexport const CONTEXT_SOURCES = [
  { key: 'fixture', label: 'Fixture', scope: 'runtime', layer: 'L0', budgetTokens: ${expression} },
]`

/** @type {{name: string, expression: string, prefix: string, files: Record<string, string>, expected: number}[]} */
const positives = [
  { name: 'literal', expression: '8000', prefix: '', files: {}, expected: 8000 },
  { name: 'underscored literal', expression: '12_000', prefix: '', files: {}, expected: 12000 },
  { name: 'local const aliases', expression: 'BUDGET', prefix: 'const VALUE = 8000; const BUDGET = VALUE', files: {}, expected: 8000 },
  { name: 'named imported alias', expression: 'BUDGET', prefix: "import { SHARED as BUDGET } from './budgets'", files: { 'budgets.ts': 'export const SHARED = 12_000' }, expected: 12000 },
  { name: 'imported const using a private local alias', expression: 'BUDGET', prefix: "import { BUDGET } from './budgets'", files: { 'budgets.ts': 'const PRIVATE = 8000; export const BUDGET = PRIVATE' }, expected: 8000 },
  { name: 'static parentheses and type wrappers', expression: '(8000 as const) satisfies number', prefix: '', files: {}, expected: 8000 },
]
for (const example of positives) {
  test(`equal numeric budget from ${example.name}`, t => {
    const file = fixture(t, { ...example.files, 'source.ts': source(example.expression, example.prefix) })
    assert.deepEqual(readStaticContextSources(file), [{ key: 'fixture', label: 'Fixture', scope: 'runtime', layer: 'L0', budget: String(example.expected) }])
  })
}

test('source and imported modules are parsed without executing top-level code', t => {
  const file = fixture(t, { 'source.ts': source('BUDGET', "import { BUDGET } from './budgets'; throw new Error('source was evaluated')"),
    'budgets.ts': "throw new Error('budget module was evaluated'); export const BUDGET = 8000" })
  assert.equal(readStaticContextSources(file)[0]?.budget, '8000')
})

/** @type {{name: string, expression: string, prefix?: string, files?: Record<string, string>}[]} */
const negatives = [
  { name: 'unknown identifier', expression: 'UNKNOWN' },
  { name: 'equal but unsupported arithmetic', expression: '4000 * 2' },
  { name: 'function call', expression: '(() => 8000)()' },
  { name: 'conditional expression', expression: 'true ? 8000 : 12000' },
  { name: 'non-number literal', expression: 'true' },
  { name: 'mutable variable', expression: 'BUDGET', prefix: 'let BUDGET = 8000' },
  { name: 'non-exported imported const', expression: 'BUDGET', prefix: "import { BUDGET } from './budgets'", files: { 'budgets.ts': 'const BUDGET = 8000' } },
  { name: 'local const cycle', expression: 'A', prefix: 'const A = B; const B = A' },
  { name: 'imported const cycle', expression: 'A', prefix: "import { A } from './a'", files: { 'a.ts': "import { B } from './b'; export const A = B", 'b.ts': "import { A } from './a'; export const B = A" } },
  { name: 'missing imported module', expression: 'BUDGET', prefix: "import { BUDGET } from './missing'" },
  { name: 'ambiguous imported module', expression: 'BUDGET', prefix: "import { BUDGET } from './budgets'", files: { 'budgets.ts': 'export const BUDGET = 8000', 'budgets/index.ts': 'export const BUDGET = 12000' } },
  { name: 'default import', expression: 'BUDGET', prefix: "import BUDGET from './budgets'", files: { 'budgets.ts': 'export default 8000' } },
  { name: 'namespace property', expression: 'budgets.BUDGET', prefix: "import * as budgets from './budgets'", files: { 'budgets.ts': 'export const BUDGET = 8000' } },
  { name: 'zero budget', expression: '0' },
  { name: 'fractional budget', expression: '1.5' },
]
for (const example of negatives) {
  test(`reject ${example.name} with source key and file/line`, t => {
    const file = fixture(t, { ...example.files, 'source.ts': source(example.expression, example.prefix) })
    assert.throws(() => readStaticContextSources(file), error => error instanceof Error
      && /\[ai-manual\] source "fixture" at .*\.ts:\d+:\d+:/.test(error.message))
  })
}

test('missing budget is an explicit error instead of a skipped source', t => {
  const file = fixture(t, { 'source.ts': source('8000').replace(', budgetTokens: 8000', '') })
  assert.throws(() => readStaticContextSources(file), /source "fixture".*requires one literal budgetTokens property/)
})

test('duplicate source keys fail instead of changing the complete source set', t => {
  const file = fixture(t, { 'source.ts': source('8000').replace('\n]', "\n{ key: 'fixture', label: 'Duplicate', scope: 'runtime', layer: 'L0', budgetTokens: 12000 }\n]") })
  assert.throws(() => readStaticContextSources(file), /duplicate source key/)
})


/** @type {{name: string, member: string, prefix?: string}[]} */
const metadataOverrides = [
  { name: 'literal computed budget override', member: "['budgetTokens']: 12000" },
  { name: 'dynamic computed budget override', member: '[FIELD]: 12000', prefix: "const FIELD = 'budgetTokens'" },
  { name: 'dynamic computed call budget override', member: '[field]: (() => 12000)()', prefix: "const field: string = 'budgetTokens'" },
  { name: 'computed getter', member: "get ['budgetTokens']() { return 12000 }" },
  { name: 'budget getter overriding a property', member: 'get budgetTokens() { return 12000 }' },
  { name: 'key getter overriding a property', member: "get key() { return 'other' }" },
  { name: 'label method overriding a property', member: "label() { return 'other' }" },
  { name: 'scope setter overriding a property', member: 'set scope(value: string) {}' },
  { name: 'layer shorthand overriding a property', member: 'layer', prefix: "const layer = 'L2'" },
]
for (const example of metadataOverrides) {
  test(`reject object metadata override through ${example.name}`, t => {
    const text = source('8000', example.prefix).replace('budgetTokens: 8000 }', `budgetTokens: 8000, ${example.member} }`)
    const file = fixture(t, { 'source.ts': text })
    const expected = example.name.includes('computed')
      ? /source "fixture" at .*\.ts:\d+:\d+: computed source members are unsupported/
      : /requires one literal (budgetTokens|key|label|scope|layer) property/
    assert.throws(() => readStaticContextSources(file), expected)
  })
}

test('ordinary unrelated reader members stay unexecuted', t => {
  const text = source('8000').replace('budgetTokens: 8000 }', `budgetTokens: 8000,
    read() { throw new Error('reader executed') },
    get enabled() { throw new Error('reader getter executed') },
    set observed(value: unknown) { throw new Error('reader setter executed') }
  }`)
  const file = fixture(t, { 'source.ts': text })
  assert.deepEqual(readStaticContextSources(file), [{ key: 'fixture', label: 'Fixture', scope: 'runtime', layer: 'L0', budget: '8000' }])
})
