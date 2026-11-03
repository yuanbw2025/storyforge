import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { stringify } from 'flatted'
import { parse as parseYaml } from 'yaml'
import { collectShard, createPlan, exactFiles, mergeShards, sha256, validateCollected, verifyReceipts } from './coverage-shards.mjs'
import { requireCIResults, staticCommands } from './run-ci-static.mjs'

/** @typedef {import('./coverage-shards.mjs').Plan} Plan */
/** @typedef {import('./coverage-shards.mjs').Receipt} Receipt */
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
/** @type {Plan} */
const plan = {
  version: 1,
  identity: { source: 'source', tree: 'tree', root: '/fixture', node: 'node', vitest: '2.1.9', provider: '2.1.9',
    lock: 'lock', config: 'config', package: 'package', run: 'run', attempt: 'attempt' },
  coverage: { thresholds: { lines: 100 } }, testTimeout: 20000,
  files: ['a', 'b', 'c', 'd'].map(name => ({ path: 'tests/' + name + '.test.ts', sha256: name })),
  shards: ['a', 'b', 'c', 'd'].map((name, i) => ({ index: i + 1, files: ['tests/' + name + '.test.ts'] })),
}
/** @returns {Receipt[]} */
const receipts = () => plan.shards.map(shard => ({
  version: 1, phase: 'collected-only', index: shard.index, count: 4,
  plan: sha256(JSON.stringify(plan)), identity: { ...plan.identity }, files: [...shard.files], hashes: {},
}))

test('receipt gate requires every unique index and exact test manifest once', () => {
  assert.doesNotThrow(() => verifyReceipts(plan, receipts()))
  assert.throws(() => verifyReceipts(plan, receipts().slice(1)), /Missing/)
  assert.throws(() => verifyReceipts(plan, [...receipts(), receipts()[0]]), /extra/)
  for (const index of [0, 5, 2]) {
    const changed = receipts()
    changed[0].index = index
    assert.throws(() => verifyReceipts(plan, changed), /index|files/)
  }
  for (const files of [[], ['tests/unknown.test.ts'], ['tests/a.test.ts', 'tests/a.test.ts']]) {
    const changed = receipts()
    changed[0].files = files
    assert.throws(() => verifyReceipts(plan, changed), /files|duplicate/)
  }
  assert.throws(() => exactFiles(['a', 'a'], ['a', 'b'], 'manifest'), /duplicate/)
})

test('source, lock, config, versions, paths and run attempts cannot mix', () => {
  for (const key of Object.keys(plan.identity)) {
    const changed = receipts()
    Reflect.set(changed[0].identity, key, 'different')
    assert.throws(() => verifyReceipts(plan, changed), /differs/, key)
  }
  for (const field of ['version', 'phase', 'count', 'plan']) {
    const changed = receipts()
    Reflect.set(changed[0], field, 'different')
    assert.throws(() => verifyReceipts(plan, changed), /complete collection/)
  }
})

test('native blob and JSON must both contain the exact files and successful results', () => {
  const file = '/fixture/tests/a.test.ts'
  const coverageFile = '/fixture/src/logic.ts'
  const coverage = { [coverageFile]: { path: coverageFile, s: {}, f: {}, b: {}, statementMap: {}, fnMap: {}, branchMap: {} } }
  const blob = stringify(['2.1.9', [{ filepath: file }], [], [], coverage])
  const report = { success: true, numTotalTests: 1, numFailedTests: 0, numFailedTestSuites: 0,
    testResults: [{ name: file, status: 'passed' }] }
  assert.deepEqual(validateCollected(plan, 1, blob, report), plan.shards[0].files)
  for (const change of [
    { success: false }, { numTotalTests: 0 }, { numFailedTests: 1 }, { numFailedTestSuites: 1 },
    { testResults: [] }, { testResults: [{ name: file, status: 'failed' }] },
    { testResults: [{ name: '/fixture/tests/b.test.ts', status: 'passed' }] },
  ]) {
    assert.throws(() => validateCollected(plan, 1, blob, { ...report, ...change }), /successful|files/)
  }
  for (const bad of [
    stringify(['2.0.0', [{ filepath: file }], [], [], coverage]),
    stringify(['2.1.9', [{ filepath: file }], [{ message: 'unhandled' }], [], coverage]),
    stringify(['2.1.9', [{ filepath: file }, { filepath: file }], [], [], coverage]),
    stringify(['2.1.9', [{ filepath: file }], [], [], {}]),
    stringify(['2.1.9', [{ filepath: file }], [], [], { total: { lines: { pct: 100 } } }]),
    stringify(['2.1.9', [{ filepath: '/other/tests/a.test.ts' }], [], [], coverage]),
  ]) {
    assert.throws(() => validateCollected(plan, 1, bad, report))
  }
})

test('static/build partition preserves every original CI command and rejects ambiguous changes', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repository, 'package.json'), 'utf8'))
  const actual = staticCommands(pkg.scripts.ci).map(command => command.join(' '))
  assert.deepEqual(actual, pkg.scripts.ci.split(' && ').filter((/** @type {string} */ command) => command !== 'npm run test:coverage'))
  assert.ok(actual.includes('npm run check:engineering'))
  assert.ok(actual.includes('npm run build'))
  assert.ok(actual.includes('npm run check:bundle-size'))
  for (const command of ['npm run build', 'npm run test:coverage && npm run test:coverage',
    'npm run test:coverage && npm run build || true', 'npm run test:coverage; npm run build']) {
    assert.throws(() => staticCommands(command))
  }
})

test('verify blocks any required failed/cancelled/skipped/missing job and retains the existing main-only AVG policy', () => {
  const names = ['checks', 'coverage-plan', 'coverage-shards', 'coverage-merge', 'browser', 'avg-media-experimental']
  const needs = Object.fromEntries(names.map(name => [name, { result: 'success' }]))
  assert.doesNotThrow(() => requireCIResults(needs, 'pull_request'))
  for (const name of names) {
    for (const result of ['failure', 'cancelled', 'skipped', '']) {
      assert.throws(() => requireCIResults({ ...needs, [name]: { result } }, 'pull_request'), /Incomplete/)
    }
    const missing = { ...needs }
    delete missing[name]
    assert.throws(() => requireCIResults(missing, 'pull_request'), /Missing/)
  }
  assert.throws(() => requireCIResults({ ...needs, extra: { result: 'success' } }, 'pull_request'), /unexpected/)
  const main = { ...needs, 'avg-media-experimental': { result: 'skipped' } }
  assert.doesNotThrow(() => requireCIResults(main, 'push'))
  assert.throws(() => requireCIResults(main, 'pull_request'))
})

test('workflow requires the collector, full native merge, static/build and full browser gates without soft failures', () => {
  const workflow = parseYaml(fs.readFileSync(path.join(repository, '.github/workflows/ci.yml'), 'utf8'))
  const jobs = workflow.jobs
  assert.deepEqual(jobs['coverage-shards'].strategy.matrix.shard, [1, 2, 3, 4])
  assert.equal(jobs['coverage-shards'].strategy['fail-fast'], false)
  assert.deepEqual(jobs.verify.needs, ['checks', 'coverage-plan', 'coverage-shards', 'coverage-merge', 'browser', 'avg-media-experimental'])
  assert.deepEqual(jobs['coverage-merge'].needs, ['coverage-plan', 'coverage-shards'])
  assert.match(jobs.verify.if, /always\(\)/)
  assert.match(jobs['coverage-merge'].if, /always\(\)/)
  for (const job of Object.values(jobs)) {
    assert.equal(job['continue-on-error'], undefined)
    for (const step of job.steps) assert.equal(step['continue-on-error'], undefined)
  }
  assert.ok(jobs.browser.steps.some((/** @type {{run?: string}} */ step) => step.run === 'npm run ci:e2e'))
  assert.ok(jobs.checks.steps.some((/** @type {{run?: string}} */ step) => step.run === 'node scripts/quality/run-ci-static.mjs'))
})

/** @param {'pass'|'global'|'directory'} scenario */
function fixture(scenario) {
  const parent = path.join(repository, 'test-results')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'coverage-control-'))
  const write = (/** @type {string} */ file, /** @type {string} */ content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  write('.gitignore', '.reports/\nnode_modules/\n')
  write('package.json', '{"type":"module"}\n')
  fs.copyFileSync(path.join(repository, 'package-lock.json'), path.join(root, 'package-lock.json'))
  const thresholds = scenario === 'directory'
    ? { lines: 75, functions: 75, statements: 75, branches: 75, 'src/strict/*.js': { lines: 100, functions: 100 } }
    : { lines: 100, functions: 100, statements: 100, branches: 100 }
  write('vitest.config.ts', 'export default ' + JSON.stringify({
    test: { environment: 'node', globals: true, include: ['tests/*.test.js'],
      coverage: { provider: 'v8', include: ['src/**/*.js'], reporter: ['json-summary'], thresholds } },
  }) + ';\n')
  write('src/logic.js', ['a', 'b', 'c', 'd'].map((name, i) => 'export function ' + name + '() { return ' + i + ' }\n').join(''))
  if (scenario !== 'pass') write(scenario === 'directory' ? 'src/strict/missed.js' : 'src/missed.js', 'export function missed() { return 0 }\n')
  for (const [i, name] of ['a', 'b', 'c', 'd'].entries()) {
    write('tests/' + name + '.test.js', "import { appendFileSync, mkdirSync } from 'node:fs';\n"
      + "import { " + name + " } from '../src/logic.js';\n"
      + "test('" + name + "', () => { mkdirSync('.reports', {recursive:true}); appendFileSync('.reports/executions', '" + name + "'); expect(" + name + "()).toBe(" + i + "); });\n")
  }
  const git = (/** @type {string[]} */ args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git(['init', '-q'])
  git(['add', '.'])
  git(['-c', 'user.name=CI fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Isolated coverage fixture'])
  return root
}

test('real four-shard Vitest collects each original test once, merges maps and enforces global and directory thresholds', async t => {
  const originalSha = process.env.GITHUB_SHA
  // These are independent, disposable fixture repositories, not the PR checkout.
  delete process.env.GITHUB_SHA
  t.after(() => { if (originalSha === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = originalSha })
  for (const scenario of /** @type {const} */ (['pass', 'global', 'directory'])) {
    await t.test(scenario, async () => {
      const root = fixture(scenario)
      try {
        const manifest = path.join(root, '.reports/plan.json')
        const original = await createPlan(root, 4)
        assert.equal(fs.existsSync(path.join(root, '.reports/executions')), false, 'discovery must not execute tests')
        fs.mkdirSync(path.dirname(manifest), { recursive: true })
        fs.writeFileSync(manifest, JSON.stringify(original))
        const artifacts = path.join(root, '.reports/shards')
        for (let index = 1; index <= 4; index++) {
          const output = path.join(artifacts, 'shard-' + index)
          if (scenario === 'pass' && index === 1) {
            execFileSync(process.execPath, [path.join(repository, 'scripts/run-isolated-coverage.mjs'),
              '--shard', index + '/4', '--manifest', manifest, '--output', output], { cwd: root, stdio: 'inherit' })
          } else await collectShard(root, index + '/4', manifest, output)
        }
        const executions = fs.readFileSync(path.join(root, '.reports/executions'), 'utf8')
        assert.equal([...executions].sort().join(''), 'abcd')
        const output = path.join(root, '.reports/merged')
        if (scenario === 'pass') {
          await mergeShards(root, manifest, artifacts, output)
          const receipt = JSON.parse(fs.readFileSync(path.join(output, 'receipt.json'), 'utf8'))
          assert.equal(receipt.phase, 'merged-thresholds-passed')
          assert.equal(receipt.files, 4)
          assert.equal(receipt.tests, 4)
          const summary = JSON.parse(fs.readFileSync(path.join(output, 'coverage/coverage-summary.json'), 'utf8'))
          assert.equal(summary.total.functions.pct, 100)
          assert.equal(summary.total.lines.pct, 100)
          // Corruption and stale bytes must stop before the native merge runs.
          fs.appendFileSync(path.join(artifacts, 'shard-1/blob.json'), '\n')
          await assert.rejects(mergeShards(root, manifest, artifacts, path.join(root, '.reports/corrupt')), /Corrupt/)
          fs.appendFileSync(path.join(root, 'src/logic.js'), '// uncommitted\n')
          await assert.rejects(mergeShards(root, manifest, artifacts, path.join(root, '.reports/drift')), /unchanged committed/)
        } else {
          await assert.rejects(mergeShards(root, manifest, artifacts, output), /Vitest failed/)
          assert.equal(fs.existsSync(path.join(output, 'receipt.json')), false, 'failed thresholds cannot publish success')
        }
        assert.equal(fs.readFileSync(path.join(root, '.reports/executions'), 'utf8'), executions, 'merge must not rerun tests')
      } finally { fs.rmSync(root, { recursive: true, force: true }) }
    })
  }
})

test('a real failed test cannot publish a collected receipt', async t => {
  const originalSha = process.env.GITHUB_SHA
  delete process.env.GITHUB_SHA
  t.after(() => { if (originalSha === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = originalSha })
  const root = fixture('pass')
  try {
    fs.appendFileSync(path.join(root, 'tests/a.test.js'), "test('intentional failure control', () => expect(true).toBe(false));\n")
    execFileSync(process.execPath, ['--check', 'tests/a.test.js'], { cwd: root })
    execFileSync('git', ['add', 'tests/a.test.js'], { cwd: root })
    execFileSync('git', ['-c', 'user.name=CI fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Failing test control'], { cwd: root })
    const original = await createPlan(root, 4)
    const shard = original.shards.find(entry => entry.files.includes('tests/a.test.js'))
    assert.ok(shard)
    const manifest = path.join(root, '.reports/plan.json')
    fs.mkdirSync(path.dirname(manifest), { recursive: true })
    fs.writeFileSync(manifest, JSON.stringify(original))
    const output = path.join(root, '.reports/failed-shard')
    await assert.rejects(collectShard(root, shard.index + '/4', manifest, output), /Vitest failed/)
    assert.equal(fs.existsSync(path.join(output, 'receipt.json')), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
