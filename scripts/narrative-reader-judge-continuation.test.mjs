import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { sha256 } from './narrative-reader-contract.mjs'

const runProcess = promisify(execFile)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const artifactRoot = 'tests/acceptance/narrative-world'
const rawRoot = `${artifactRoot}/raw`
const completeParent = `${rawRoot}/reader-semantic-judge-20261015-v4`
const incompleteParent = `${rawRoot}/reader-incomplete-judge-20261016-v2`
const protocolPath = `${artifactRoot}/reader-judge-protocol-20261015-v2.json`
const judge = resolve(root, 'scripts/evaluate-narrative-reader-judge-local-codex.mjs')

/** @param {import('node:test').TestContext} t */
function isolatedJudge(t, incomplete = false) {
  const frozenParent = incomplete ? incompleteParent : completeParent
  const scratch = mkdtempSync(resolve(root, rawRoot, 'test-judge-continuation-'))
  const parent = resolve(scratch, 'parent')
  const originalManifest = readFileSync(resolve(root, frozenParent, 'manifest.json'))
  mkdirSync(resolve(parent, 'calls'), { recursive: true })
  writeFileSync(resolve(parent, 'manifest.json'), originalManifest)
  for (const name of readdirSync(resolve(root, frozenParent, 'calls'))) {
    cpSync(resolve(root, frozenParent, 'calls', name), resolve(parent, 'calls', name))
  }
  const log = resolve(scratch, 'dispatch.ndjson')
  const executable = resolve(scratch, 'fake-codex.mjs')
  writeFileSync(executable, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
const send = value => process.stdout.write(JSON.stringify(value) + '\\n')
const model = process.env.SFQA137_SYNTHETIC_MODEL
const features = Object.fromEntries([...String(process.argv.find(arg => arg.startsWith('features='))).matchAll(/"([^"]+)"=false/g)]
  .map(match => [match[1], false]))
let threadStarted = false
let historicalFileChanged = false
function mutateHistoricalFile(phase) {
  if (!historicalFileChanged && process.env.SFQA137_MUTATE_HISTORICAL_FILE && phase === (process.env.SFQA137_MUTATION_PHASE || 'startup')) {
    historicalFileChanged = true
    appendFileSync(process.env.SFQA137_MUTATE_HISTORICAL_FILE, '\\n')
  }
}
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line)
  if (id == null) continue
  let result
  switch (method) {
    case 'initialize': result = { userAgent: 'storyforge/0.162.0' }; break
    case 'config/read':
      mutateHistoricalFile('startup')
      result = { config: { model_provider: 'storyforge-subscription', web_search: 'disabled',
      features, model_providers: { 'storyforge-subscription': { request_max_retries: 0, stream_max_retries: 0 } } } }; break
    case 'skills/list': result = { data: [] }; break
    case 'account/read':
      if (threadStarted) mutateHistoricalFile('last-account')
      result = { account: { type: 'chatgpt' } }; break
    case 'model/list': result = { data: [{ model }] }; break
    case 'thread/start': threadStarted = true; result = { thread: { id: 'isolated-thread' }, model, modelProvider: 'storyforge-subscription', instructionSources: [] }; break
    case 'turn/start': {
      const threadId = params.threadId, turnId = 'isolated-turn'
      const hash = createHash('sha256').update(params.input[0].text).digest('hex')
      appendFileSync(process.env.SFQA137_SYNTHETIC_LOG, hash + '\\n')
      send({ id, result: { turn: { id: turnId } } })
      send({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', id: 'only-output',
        phase: 'final_answer', text: 'synthetic ungradable output' } } })
      send({ method: 'thread/tokenUsage/updated', params: { threadId, turnId, tokenUsage: { last: { inputTokens: 90, outputTokens: 5, totalTokens: 95 } } } })
      send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } })
      continue
    }
    case 'thread/unsubscribe': result = {}; break
    default: send({ id, error: { code: -32601 } }); continue
  }
  send({ id, result })
}
`, { mode: 0o700 })
  const env = { ...process.env, STORYFORGE_CODEX_BIN: executable, SFQA137_SYNTHETIC_LOG: log,
    SFQA137_SYNTHETIC_MODEL: JSON.parse(readFileSync(resolve(root, protocolPath), 'utf8')).model }
  /** @param {string} name */
  const output = name => relative(root, resolve(scratch, name))
  /** @param {string} name @param {string[]} extra
   * @param {string | null} parentName @param {Record<string, string>} syntheticEnv */
  async function run(name, extra = [], parentName = 'parent', syntheticEnv = {}) {
    const source = incomplete
      ? ['--incomplete-reader-diagnostic', `${artifactRoot}/reader-incomplete-diagnostic-20261015-v1.json`,
        '--reader-coverage-policy', `${artifactRoot}/reader-judge-coverage-policy-20261016-v1.json`]
      : ['--reader-report', `${artifactRoot}/reader-comparison-20261015-v2.json`]
    const args = [judge, ...source, '--protocol', protocolPath, '--output', output(name),
      ...(parentName == null ? [] : ['--continue-unstarted-from', output(parentName)]), '--max-calls', '1', ...extra]
    try {
      return { ok: true, ...(await runProcess(process.execPath, args, { cwd: root, env: { ...env, ...syntheticEnv }, timeout: 20_000 })) }
    } catch (error) {
      if (!(error instanceof Error) || !('stderr' in error) || typeof error.stderr !== 'string'
        || !('stdout' in error) || typeof error.stdout !== 'string') throw error
      return { ok: false, stderr: error.stderr, stdout: error.stdout }
    }
  }
  t.after(() => {
    assert.deepEqual(readFileSync(resolve(root, frozenParent, 'manifest.json')), originalManifest)
    for (const entry of readdirSync(scratch, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifest = resolve(scratch, entry.name, 'manifest.json')
      try { readFileSync(manifest) }
      catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue; throw error }
      const own = sha256({ parent: output(entry.name) })
      rmSync(resolve(root, rawRoot, 'judge-continuation-claims', `${own}.json`), { force: true })
    }
    rmSync(scratch, { recursive: true, force: true })
  })
  return { run, output, originalManifest, parentRun: output('parent'), scratch,
    log: () => {
      try { return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) }
      catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []; throw error }
    } }
}

test('a settled judge parent can authorize only one sequential child, without sending its remaining input twice', async t => {
  const fixture = isolatedJudge(t)
  const first = await fixture.run('first')
  assert.equal(first.ok, true, first.stderr)
  const second = await fixture.run('second')
  assert.deepEqual({ success: second.ok, sent: fixture.log().length, unique: new Set(fixture.log()).size },
    { success: false, sent: 1, unique: 1 })
})

test('concurrent sibling claims permit a single synthetic judge dispatch', async t => {
  const fixture = isolatedJudge(t)
  const results = await Promise.all([fixture.run(`left-${randomUUID()}`), fixture.run(`right-${randomUUID()}`)])
  assert.deepEqual({ success: results.filter(item => item.ok).length, sent: fixture.log().length, unique: new Set(fixture.log()).size },
    { success: 1, sent: 1, unique: 1 }, results.map(item => item.stderr).filter(Boolean).join('\n'))
})


/** @param {ReturnType<typeof isolatedJudge>} fixture @param {string} name */
function readRun(fixture, name) {
  const dir = resolve(root, fixture.output(name))
  /** @param {string} file */
  const read = file => JSON.parse(readFileSync(resolve(dir, file), 'utf8'))
  return {
    manifest: read('manifest.json'),
    calls: readdirSync(resolve(dir, 'calls')).filter(file => file.endsWith('.result.json')).map(file => read(`calls/${file}`)),
    summaries: readdirSync(dir).filter(file => file.startsWith('summary-')).sort().map(read),
  }
}

test('the same claimed child can resume and its only descendant excludes every attempted input', async t => {
  const fixture = isolatedJudge(t)
  const copied = resolve(root, fixture.parentRun, 'calls')
  const failedFile = readdirSync(copied).filter(name => name.endsWith('.result.json')).find(name => (
    JSON.parse(readFileSync(resolve(copied, name), 'utf8')).status === 'failed'
  ))
  assert.ok(failedFile, 'Expected a real frozen failed call')
  const oldPath = resolve(copied, failedFile), old = JSON.parse(readFileSync(oldPath, 'utf8'))
  const unknown = { ...old, status: 'unknown-or-interrupted' }
  writeFileSync(oldPath, JSON.stringify(unknown))
  const first = await fixture.run('first')
  assert.equal(first.ok, true, first.stderr)
  const resume = await fixture.run('first', ['--resume', '--dry-run'])
  assert.equal(resume.ok, true, resume.stderr)
  assert.equal(fixture.log().length, 1)
  const child = readRun(fixture, 'first')
  assert.equal(child.calls[0].status, 'invalid-judgment')
  assert.equal(child.summaries.length, 2)
  assert.equal(child.summaries[1].invalidJudgmentActualCalls, 1)
  assert.ok(!child.summaries[1].rows.some((/** @type {{judgePromptHash: string}} */ row) => row.judgePromptHash === child.calls[0].promptHash))
  assert.ok(child.manifest.continuation.inheritedPromptHashes.includes(old.promptHash))
  assert.ok(child.manifest.continuation.unresolvedPromptHashes.includes(old.promptHash))
  const next = await fixture.run('next', [], 'first')
  assert.equal(next.ok, true, next.stderr)
  const grandchild = readRun(fixture, 'next')
  assert.ok(grandchild.manifest.continuation.inheritedPromptHashes.includes(old.promptHash))
  assert.ok(grandchild.manifest.continuation.inheritedPromptHashes.includes(child.calls[0].promptHash))
  assert.ok(grandchild.manifest.continuation.unresolvedPromptHashes.includes(child.calls[0].promptHash))
  assert.equal(new Set(fixture.log()).size, 2)
  assert.notEqual(grandchild.calls[0].promptHash, old.promptHash)
  assert.notEqual(grandchild.calls[0].promptHash, child.calls[0].promptHash)
  assert.deepEqual(JSON.parse(readFileSync(oldPath, 'utf8')), unknown)
  const deniedParent = await fixture.run('first', ['--resume'])
  assert.equal(deniedParent.ok, false)
  assert.match(deniedParent.stderr, /already authorized a continuation/)
  assert.equal(fixture.log().length, 2)
})

test('a legacy successor is recognized before a new fork can create a claim or dispatch', async t => {
  const fixture = isolatedJudge(t)
  const legacy = JSON.parse(readFileSync(resolve(root, rawRoot, 'reader-semantic-judge-20261015-v5', 'manifest.json'), 'utf8'))
  legacy.continuation = { ...legacy.continuation, run: fixture.parentRun, manifestSha256: sha256(fixture.originalManifest) }
  const directory = resolve(root, fixture.output('legacy-child'))
  mkdirSync(directory)
  const bytes = JSON.stringify(legacy) + '\n'
  writeFileSync(resolve(directory, 'manifest.json'), bytes)
  const result = await fixture.run('fresh-fork')
  assert.equal(result.ok, false)
  assert.match(result.stderr, /already has a different continuation/)
  assert.deepEqual(fixture.log(), [])
  assert.equal(readFileSync(resolve(directory, 'manifest.json'), 'utf8'), bytes)
})

test('the incomplete matrix stays diagnostic through a claimed continuation with an invalid judgment', async t => {
  const fixture = isolatedJudge(t, true)
  const result = await fixture.run('diagnostic')
  assert.equal(result.ok, true, result.stderr)
  const child = readRun(fixture, 'diagnostic')
  assert.equal(child.manifest.continuation.inheritedPromptHashes.length, 453)
  assert.equal(child.calls.length, 1)
  assert.equal(child.calls[0].status, 'invalid-judgment')
  const summary = child.summaries[0]
  assert.equal(summary.schema, 'storyforge.narrative-reader-incomplete-judge-results')
  assert.equal(summary.complete, false)
  assert.equal(summary.executionComplete, false)
  assert.equal(summary.accepted, false)
  assert.ok(summary.totalObservations > summary.eligibleObservations)
  assert.equal(summary.invalidJudgmentActualCalls, 1)
  assert.ok(!summary.rows.some((/** @type {{judgePromptHash: string}} */ row) => row.judgePromptHash === child.calls[0].promptHash))
})

test('changing parent manifest bytes does not create a second continuation identity for the same run', async t => {
  const fixture = isolatedJudge(t)
  const first = await fixture.run('first')
  assert.equal(first.ok, true, first.stderr)
  const parent = resolve(root, fixture.parentRun, 'manifest.json')
  const bytes = readFileSync(parent, 'utf8')
  try {
    writeFileSync(parent, bytes + '\n')
    const second = await fixture.run('second')
    assert.deepEqual({ success: second.ok, sent: fixture.log().length }, { success: false, sent: 1 })
  } finally {
    // These are test-owned copies, never a historical run.
    writeFileSync(parent, bytes)
  }
})


test('cannot resume a parent through an alias after its child sends', async t => {
  const fixture = isolatedJudge(t)
  const parent = await fixture.run('fresh', [], null)
  assert.equal(parent.ok, true, parent.stderr)
  const child = await fixture.run('child', [], 'fresh')
  assert.equal(child.ok, true, child.stderr)
  const before = fixture.log()
  assert.equal(before.length, 2)
  assert.equal(new Set(before).size, 2)
  symlinkSync(resolve(root, fixture.output('fresh')), resolve(root, fixture.output('alias')), 'dir')
  const resume = await fixture.run('alias', ['--resume'], null)
  assert.deepEqual({ resumed: resume.ok, after: fixture.log() }, { resumed: false, after: before })
  assert.match(resume.stderr, /canonical/)
  const nested = resolve(root, fixture.output('alias-for-new'))
  symlinkSync(fixture.scratch, nested, 'dir')
  const freshAlias = await fixture.run('alias-for-new/new-run', [], null)
  assert.equal(freshAlias.ok, false)
  assert.match(freshAlias.stderr, /canonical/)
  assert.deepEqual(fixture.log(), before)
})

test('a historical file changed during actual runtime startup blocks the next judge dispatch', async t => {
  const fixture = isolatedJudge(t)
  const directory = resolve(root, fixture.parentRun, 'calls')
  const name = readdirSync(directory).find(item => item.endsWith('.result.json'))
  assert.ok(name, 'Expected a frozen result file')
  const path = resolve(directory, name)
  const before = readFileSync(path, 'utf8')
  const next = await fixture.run('child', [], 'parent', { SFQA137_MUTATE_HISTORICAL_FILE: path })
  assert.equal(readFileSync(path, 'utf8'), before + '\n')
  assert.deepEqual({ success: next.ok, sent: fixture.log().length }, { success: false, sent: 0 })
  assert.match(next.stderr, /Historical judge evidence changed/)
})


test('a historical file changed after thread creation blocks the actual turn', async t => {
  const fixture = isolatedJudge(t)
  const directory = resolve(root, fixture.parentRun, 'calls')
  const name = readdirSync(directory).find(item => item.endsWith('.result.json'))
  assert.ok(name, 'Expected a frozen result file')
  const path = resolve(directory, name)
  const before = readFileSync(path, 'utf8')
  const next = await fixture.run('child', [], 'parent', {
    SFQA137_MUTATE_HISTORICAL_FILE: path, SFQA137_MUTATION_PHASE: 'last-account',
  })
  assert.equal(readFileSync(path, 'utf8'), before + '\n')
  assert.deepEqual({ success: next.ok, sent: fixture.log().length }, { success: false, sent: 0 })
  const childCalls = resolve(root, fixture.output('child'), 'calls')
  const resultName = readdirSync(childCalls).find(item => item.endsWith('.result.json'))
  assert.ok(resultName, 'Expected the original failed receipt')
  const receipt = JSON.parse(readFileSync(resolve(childCalls, resultName), 'utf8'))
  assert.equal(receipt.status, 'failed')
  assert.equal(receipt.dispatched, false)
  assert.match(receipt.error, /Historical judge evidence changed/)
})
