import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = readFileSync(path.join(root, '.github/workflows/traffic-archive.yml'), 'utf8')
const files = ['clones.csv', 'views.csv', 'release-assets.csv']
const seedData = {
  'clones.csv': 'date,count,uniques\n2026-01-01,4,3\n',
  'views.csv': 'date,count,uniques\n2026-01-01,7,5\n',
  'release-assets.csv': 'snapshot_date,tag_name,asset_id,asset_name,download_count,size,updated_at,browser_download_url\n2026-01-01,v0,1,old.zip,2,10,2026-01-01,https://example.invalid/old.zip\n',
}

/** @param {string} name */
function step(name) {
  const lines = workflow.split('\n')
  const start = lines.findIndex(line => line === `      - name: ${name}`)
  assert.notEqual(start, -1, `Missing actual workflow step: ${name}`)
  const body = lines.findIndex((line, index) => index > start && line === '        run: |')
  assert.notEqual(body, -1)
  const result = []
  for (const line of lines.slice(body + 1)) {
    if (line.trim() && !line.startsWith('          ')) break
    result.push(line.slice(10))
  }
  assert.match(result.join('\n'), /^set -euo pipefail/)
  return result.join('\n')
}

const prepare = step('Prepare traffic asset branch')
const archive = step('Archive traffic data')
const publish = step('Commit updated data')
const gitEnvironment = {
  PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0',
  GITHUB_TOKEN: '', GH_TOKEN: 'synthetic-traffic-token',
}

/** @param {string} cwd @param {string} bin @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
function command(cwd, bin, args, env = {}) {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8', timeout: 5_000,
    env: { ...gitEnvironment, ...env } })
  if (result.error) throw result.error
  return result
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const result = command(cwd, 'git', args)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout.trim()
}

/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'sfqa033-traffic-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const remote = path.join(directory, 'remote.git'), seed = path.join(directory, 'main')
  git(directory, ['init', '--bare', remote])
  git(directory, ['init', '--initial-branch=main', seed])
  git(seed, ['config', 'user.name', 'Synthetic traffic test'])
  git(seed, ['config', 'user.email', 'traffic@example.invalid'])
  mkdirSync(path.join(seed, 'data/traffic'), { recursive: true })
  mkdirSync(path.join(seed, 'scripts'), { recursive: true })
  for (const [name, value] of Object.entries(seedData)) writeFileSync(path.join(seed, 'data/traffic', name), value)
  for (const name of ['archive-traffic.py', 'archive-release-downloads.py']) {
    copyFileSync(path.join(root, 'scripts', name), path.join(seed, 'scripts', name))
  }
  git(seed, ['add', '.']); git(seed, ['commit', '-m', 'Synthetic historical main'])
  git(seed, ['remote', 'add', 'origin', remote]); git(seed, ['push', 'origin', 'main'])
  const main = git(directory, ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])
  return { directory, remote, seed, main,
    /** @param {string} name */
    clone(name) {
      const checkout = path.join(directory, name)
      git(directory, ['clone', '--branch', 'main', remote, checkout])
      return checkout
    },
  }
}

/** @param {ReturnType<typeof fixture>} f @param {string} checkout */
function prepareArchive(f, checkout) {
  const output = path.join(f.directory, path.basename(checkout) + '.output')
  const result = command(checkout, 'bash', ['-c', prepare], { RUNNER_TEMP: f.directory, GITHUB_OUTPUT: output })
  return { result, scripts: result.status === 0
    ? readFileSync(output, 'utf8').trim().replace(/^scripts_dir=/, '') : '' }
}

/** @param {ReturnType<typeof fixture>} f @param {string} checkout */
function assertMainUnchanged(f, checkout) {
  assert.equal(git(checkout, ['--git-dir', f.remote, 'rev-parse', 'refs/heads/main']), f.main)
  for (const [name, value] of Object.entries(seedData)) {
    assert.equal(command(checkout, 'git', ['--git-dir', f.remote, 'show', `main:data/traffic/${name}`]).stdout, value)
  }
}

/** @param {ReturnType<typeof fixture>} f @param {string} checkout @param {string} scripts @param {boolean} [empty] @param {boolean} [fail] */
function collect(f, checkout, scripts, empty = false, fail = false) {
  const shim = path.join(f.directory, path.basename(checkout) + '-http')
  mkdirSync(shim)
  writeFileSync(path.join(shim, 'payload.json'), JSON.stringify({ empty, fail }))
  writeFileSync(path.join(shim, 'sitecustomize.py'), `
import io, json, os, urllib.request
from pathlib import Path
mode = json.loads((Path(__file__).parent / 'payload.json').read_text())
def urlopen(request, *args, **kwargs):
    if request.get_header('Authorization') != 'Bearer synthetic-traffic-token':
        raise ValueError('Expected synthetic credential only')
    url = request.full_url
    if not url.startswith('https://api.github.com/repos/quality/unit/'):
        raise ValueError('Unexpected network target')
    if '/traffic/' in url:
        kind = url.rsplit('/', 1)[-1]
        value = {kind: [] if mode['empty'] else [{'timestamp': '2026-11-04T00:00:00Z', 'count': 9, 'uniques': 6}]}
    elif '/releases?' in url:
        if mode['fail']:
            raise OSError('synthetic API outage')
        value = [] if mode['empty'] else [{'tag_name': 'v1', 'assets': [{'id': 2, 'name': 'new.zip', 'download_count': 8, 'size': 20}]}]
    else:
        raise ValueError('Unexpected network request')
    return io.BytesIO(json.dumps(value).encode())
urllib.request.urlopen = urlopen
`)
  return command(checkout, 'bash', ['-c', archive], {
    REPO: 'quality/unit', ARCHIVE_SCRIPTS: scripts, PYTHONPATH: shim,
  })
}

test('only main controls archival; asset pushes do not start full CI and no credential is logged', () => {
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.match(publish, /git push origin "HEAD:refs\/heads\/\$\{branch\}"/)
  assert.doesNotMatch(publish, /--force|\bgh\s+pr\b|git push\s*(?:\n|$)/)
  assert.doesNotMatch(workflow, /set -x|echo[^\n]*(?:GH_TOKEN|TRAFFIC_TOKEN|github\.token)/)
  assert.match(workflow, /failure\(\) && steps\.archive-data\.outcome == 'success'/)
  assert.match(workflow, /traffic-archive-unpublished-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/)
  assert.match(workflow, /if-no-files-found: error\n\s+retention-days: 14/)
  const ci = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
  assert.match(ci, /push:\s*\n\s*branches: \[main\]/)
  assert.doesNotMatch(ci, /workflow_run:/)
})

test('first creation inherits all historical CSVs and atomically publishes only asset data', { timeout: 10_000 }, t => {
  const f = fixture(t), checkout = f.clone('first'), ready = prepareArchive(f, checkout)
  assert.equal(ready.result.status, 0, ready.result.stderr)
  assert.equal(collect(f, checkout, ready.scripts).status, 0)
  assert.equal(command(checkout, 'bash', ['-c', publish]).status, 0)
  assertMainUnchanged(f, checkout)
  const names = git(checkout, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).split('\n').sort()
  assert.deepEqual(names, files.map(name => `data/traffic/${name}`).sort())
  for (const name of files) assert.match(readFileSync(path.join(checkout, 'data/traffic', name), 'utf8'), /2026-01-01/)
  assert.match(readFileSync(path.join(checkout, 'data/traffic/clones.csv'), 'utf8'), /2026-11-04,9,6/)
})

test('existing asset history survives an empty API response and uses current main scripts', { timeout: 10_000 }, t => {
  const f = fixture(t), first = f.clone('first'), initial = prepareArchive(f, first)
  assert.equal(initial.result.status, 0); assert.equal(collect(f, first, initial.scripts).status, 0)
  assert.equal(command(first, 'bash', ['-c', publish]).status, 0)
  const assetHead = git(first, ['rev-parse', 'HEAD'])
  const retained = files.map(name => readFileSync(path.join(first, 'data/traffic', name), 'utf8'))
  for (const name of ['archive-traffic.py', 'archive-release-downloads.py']) {
    const file = path.join(f.seed, 'scripts', name)
    writeFileSync(file, readFileSync(file, 'utf8') + '\n# reviewed main successor\n')
  }
  git(f.seed, ['add', 'scripts']); git(f.seed, ['commit', '-m', 'Current main scripts'])
  git(f.seed, ['push', 'origin', 'main']); f.main = git(f.seed, ['rev-parse', 'HEAD'])
  const checkout = f.clone('later'), ready = prepareArchive(f, checkout)
  assert.equal(ready.result.status, 0, ready.result.stderr)
  assert.equal(git(checkout, ['rev-parse', 'HEAD']), assetHead)
  assert.match(readFileSync(path.join(ready.scripts, 'archive-traffic.py'), 'utf8'), /reviewed main successor/)
  assert.equal(collect(f, checkout, ready.scripts, true).status, 0)
  assert.deepEqual(files.map(name => readFileSync(path.join(checkout, 'data/traffic', name), 'utf8')), retained)
  assert.equal(command(checkout, 'bash', ['-c', publish]).status, 0)
  assert.equal(git(checkout, ['rev-parse', 'HEAD']), assetHead)
  assertMainUnchanged(f, checkout)
})

test('publishing unchanged CSVs still creates the first historical asset ref without a commit', { timeout: 10_000 }, t => {
  const f = fixture(t), checkout = f.clone('unchanged'), ready = prepareArchive(f, checkout)
  assert.equal(ready.result.status, 0)
  // Isolate the no-staged-diff publishing branch; empty API preservation is
  // exercised above with the real Python writers and their CSV line endings.
  assert.equal(command(checkout, 'bash', ['-c', publish]).status, 0)
  assert.equal(git(checkout, ['--git-dir', f.remote, 'rev-parse', 'refs/heads/traffic-assets']), f.main)
  assertMainUnchanged(f, checkout)
})

test('missing or empty asset history is rejected rather than replaced from a partial fetch', { timeout: 10_000 }, t => {
  const f = fixture(t), damaged = f.clone('damaged')
  git(damaged, ['switch', '-c', 'traffic-assets'])
  git(damaged, ['config', 'user.name', 'Synthetic test']); git(damaged, ['config', 'user.email', 'traffic@example.invalid'])
  writeFileSync(path.join(damaged, 'data/traffic/clones.csv'), 'date,count,uniques\n')
  git(damaged, ['add', '.']); git(damaged, ['commit', '-m', 'Synthetic missing history'])
  git(damaged, ['push', 'origin', 'traffic-assets'])
  const checkout = f.clone('blocked'), ready = prepareArchive(f, checkout)
  assert.notEqual(ready.result.status, 0)
  assert.match(ready.result.stderr, /Retained archive history missing/)
  assertMainUnchanged(f, checkout)
})

test('an unavailable remote is a hard read failure, not permission to create an empty replacement', { timeout: 10_000 }, t => {
  const f = fixture(t), checkout = f.clone('remote-failure')
  git(checkout, ['remote', 'set-url', 'origin', path.join(f.directory, 'unavailable.git')])
  const ready = prepareArchive(f, checkout)
  assert.notEqual(ready.result.status, 0)
  assert.equal(git(checkout, ['branch', '--show-current']), 'main')
  for (const [name, value] of Object.entries(seedData)) {
    assert.equal(readFileSync(path.join(checkout, 'data/traffic', name), 'utf8'), value)
  }
  assertMainUnchanged(f, checkout)
})

test('a failed data read publishes nothing and retains the prior remote asset history', { timeout: 10_000 }, t => {
  const f = fixture(t), checkout = f.clone('read-failure'), ready = prepareArchive(f, checkout)
  assert.equal(ready.result.status, 0)
  const failure = collect(f, checkout, ready.scripts, false, true)
  assert.notEqual(failure.status, 0); assert.match(failure.stderr, /synthetic API outage/)
  assert.notEqual(command(checkout, 'git', ['--git-dir', f.remote, 'show-ref', '--verify', 'refs/heads/traffic-assets']).status, 0)
  assertMainUnchanged(f, checkout)
})

test('a rejected push preserves remote history and the completed local archival commit', { timeout: 10_000 }, t => {
  const f = fixture(t), first = f.clone('first'), initial = prepareArchive(f, first)
  assert.equal(initial.result.status, 0); assert.equal(collect(f, first, initial.scripts, true).status, 0)
  assert.equal(command(first, 'bash', ['-c', publish]).status, 0)
  const previousAssetHead = git(first, ['--git-dir', f.remote, 'rev-parse', 'refs/heads/traffic-assets'])
  const checkout = f.clone('reject'), ready = prepareArchive(f, checkout)
  assert.equal(ready.result.status, 0); assert.equal(collect(f, checkout, ready.scripts).status, 0)
  const hook = path.join(f.remote, 'hooks/pre-receive')
  writeFileSync(hook, '#!/bin/sh\necho "synthetic traffic push rejection" >&2\nexit 1\n'); chmodSync(hook, 0o755)
  const failure = command(checkout, 'bash', ['-c', publish])
  assert.notEqual(failure.status, 0); assert.match(failure.stderr, /synthetic traffic push rejection/)
  const retainedLocalCommit = git(checkout, ['rev-parse', 'HEAD'])
  assert.notEqual(retainedLocalCommit, f.main)
  assert.match(git(checkout, ['show', 'HEAD:data/traffic/clones.csv']), /2026-11-04,9,6/)
  assert.equal(git(checkout, ['--git-dir', f.remote, 'rev-parse', 'refs/heads/traffic-assets']), previousAssetHead)
  assertMainUnchanged(f, checkout)
  t.diagnostic(JSON.stringify({ scenario: 'push rejected', exitCode: failure.status,
    mainHeadUnchanged: f.main, retainedLocalCommit, remoteAssetHeadUnchanged: previousAssetHead }))
})

test('the publishing step refuses to run on main', { timeout: 10_000 }, t => {
  const f = fixture(t), checkout = f.clone('wrong-branch')
  assert.notEqual(command(checkout, 'bash', ['-c', publish]).status, 0)
  assertMainUnchanged(f, checkout)
})
