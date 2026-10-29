import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod, symlink, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { runInNewContext } from 'node:vm'

const repo = resolve(import.meta.dirname, '..')
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sf-temp-lifecycle-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const temp = join(root, 'tmp')
  await mkdir(workspace)
  await mkdir(temp)
  return { root, workspace, temp, env: { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp } }
}
function run(command, args, options = {}) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal, output }))
  })
}
async function leftovers(temp) {
  const names = await readdir(temp)
  const managed = names.includes('storyforge-test-runs-v1')
    ? await readdir(join(temp, 'storyforge-test-runs-v1')) : []
  return [...names.filter(name => /^(storyforge-e2e-snapshot-|storyforge-coverage-)/.test(name)), ...managed]
}
async function createSnapshotFixture(f) {
  const source = await readFile(join(repo, 'scripts/serve-e2e-snapshot.mjs'), 'utf8')
  const entries = runInNewContext(source.match(/const snapshotEntries = (\[[\s\S]*?\n\])/)?.[1])
  for (const entry of entries) {
    const target = join(f.workspace, entry)
    if (/\.(mjs|json|ts|js|html|md)$/.test(entry)) {
      await mkdir(resolve(target, '..'), { recursive: true })
      await writeFile(target, entry === 'package.json' ? '{"type":"module"}' : 'fixture')
    } else await mkdir(target, { recursive: true })
  }
  await writeFile(join(f.workspace, 'src', 'sentinel.txt'), 'original source')
  await writeFile(join(f.workspace, '.env'), 'TEST_SECRET_SENTINEL=do-not-copy')
  await mkdir(join(f.workspace, 'backups'))
  await writeFile(join(f.workspace, 'backups', 'keep.json'), '{"backup":true}')
  await mkdir(join(f.workspace, 'node_modules/vite/bin'), { recursive: true })
  await writeFile(join(f.workspace, 'node_modules/vite/bin/vite.js'), `
    import http from 'node:http'
    const port = Number(process.argv[process.argv.indexOf('--port') + 1])
    http.createServer((request, response) => response.end('fixture')).listen(port, '127.0.0.1')
  `)
}
async function unusedPort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

test('Playwright teardown removes its frozen snapshot and leaves original source and backup intact', { timeout: 30_000, skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t)
  await createSnapshotFixture(f)
  const port = await unusedPort()
  const pwImport = pathToFileURL(join(repo, 'node_modules/@playwright/test/index.mjs')).href
  const repositoryConfig = pathToFileURL(join(repo, 'playwright.config.ts')).href
  await writeFile(join(f.root, 'playwright.config.mjs'), `
    import { defineConfig } from ${JSON.stringify(pwImport)}
    import repositoryConfig from ${JSON.stringify(repositoryConfig)}
    export default defineConfig({
      testDir: ${JSON.stringify(f.root)},
      testMatch: 'probe.spec.mjs', workers: 1, reporter: 'line',
      webServer: {
        command: ${JSON.stringify(JSON.stringify(process.execPath) + ' ' + JSON.stringify(join(repo, 'scripts/serve-e2e-snapshot.mjs')) + ' --port ' + port)},
        cwd: ${JSON.stringify(f.workspace)}, url: 'http://127.0.0.1:${port}', timeout: 10_000,
        gracefulShutdown: repositoryConfig.webServer.gracefulShutdown,
      },
      use: { baseURL: 'http://127.0.0.1:${port}' },
    })
  `)
  await writeFile(join(f.root, 'probe.spec.mjs'), `
    import { test, expect } from ${JSON.stringify(pwImport)}
    test('server responds', async ({ request }) => {
      expect((await request.get('/')).status()).toBe(200)
    })
  `)
  const result = await run(process.execPath, [join(repo, 'node_modules/playwright/cli.js'), 'test', '--config', join(f.root, 'playwright.config.mjs')], { cwd: f.root, env: f.env })
  assert.equal(result.code, 0, result.output)
  assert.deepEqual(await leftovers(f.temp), [], result.output)
  assert.equal(await readFile(join(f.workspace, 'src/sentinel.txt'), 'utf8'), 'original source')
  assert.equal(await readFile(join(f.workspace, 'backups/keep.json'), 'utf8'), '{"backup":true}')
})

test('failed snapshot preparation removes its partial directory', { timeout: 15_000 }, async t => {
  const f = await fixture(t)
  const result = await run(process.execPath, [join(repo, 'scripts/serve-e2e-snapshot.mjs')], { cwd: f.workspace, env: f.env })
  assert.notEqual(result.code, 0)
  assert.deepEqual(await leftovers(f.temp), [])
})

for (const exitCode of [0, 7]) {
  test(`coverage cleans its private report directory and preserves exit code ${exitCode}`, { timeout: 15_000 }, async t => {
    const f = await fixture(t)
    const executable = join(f.workspace, 'node_modules/vitest/vitest.mjs')
    await mkdir(resolve(executable, '..'), { recursive: true })
    await writeFile(executable, `#!/usr/bin/env node
      import { writeFileSync, mkdirSync } from 'node:fs'
      import { join } from 'node:path'
      const directory = process.argv.find(arg => arg.startsWith('--coverage.reportsDirectory=')).split('=')[1]
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'coverage-summary.json'), '{}')
      writeFileSync(join(directory, 'test-results.json'), JSON.stringify({
        success: true, numTotalTests: 1, numFailedTests: 0,
        numFailedTestSuites: 0, testResults: [{ status: 'passed' }],
      }))
      process.exit(${exitCode})
    `)
    await chmod(executable, 0o755)
    await mkdir(join(f.workspace, 'node_modules/.bin'))
    if (process.platform !== 'win32') await symlink(executable, join(f.workspace, 'node_modules/.bin/vitest'))
    const result = await run(process.execPath, [join(repo, 'scripts/run-isolated-coverage.mjs')], { cwd: f.workspace, env: f.env })
    assert.equal(result.code, exitCode, result.output)
    assert.deepEqual(await leftovers(f.temp), [])
  })
}


const { withTestDirectory, reapAbandonedTestDirectories, assertTestDiskSpace } = await import('./test-temp-directory.mjs')
const helperUrl = pathToFileURL(join(repo, 'scripts/test-temp-directory.mjs')).href

test('concurrent runs can start and finish without reclaiming each other or failing on vanished entries', { timeout: 15_000 }, async t => {
  const f = await fixture(t)
  for (let round = 0; round < 5; round += 1) {
    await Promise.all(Array.from({ length: 4 }, (_, index) => withTestDirectory('validation', async temporary => {
      const sentinel = join(temporary.path, 'result.txt')
      await writeFile(sentinel, String(index))
      await new Promise(resolve => setTimeout(resolve, index * 5))
      assert.equal(await readFile(sentinel, 'utf8'), String(index))
    }, { tempRoot: f.temp })))
  }
  assert.deepEqual(await runDirectories(f.temp), [])
})


for (const code of [0, 9]) {
  test(`one-off validation owns only its temporary output and preserves exit code ${code}`, async t => {
    const f = await fixture(t)
    await writeFile(join(f.workspace, 'source.txt'), 'keep original')
    const result = await run(process.execPath, [
      join(repo, 'scripts/run-test-workspace.mjs'), '--', process.execPath, '--input-type=module', '-e',
      `import { writeFileSync } from 'node:fs'; import { join } from 'node:path';
        writeFileSync(join(process.env.STORYFORGE_TEST_WORKSPACE, 'result.json'), '{}');
        process.exit(${code})`,
    ], { cwd: f.workspace, env: f.env })
    assert.equal(result.code, code, result.output)
    assert.deepEqual(await leftovers(f.temp), [])
    assert.equal(await readFile(join(f.workspace, 'source.txt'), 'utf8'), 'keep original')
  })
}

function startWorker(f, code) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: f.root, env: f.env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => {
      output += chunk
      const match = output.match(/READY (.+)\n/)
      if (match) resolve(match[1])
    })
    child.stderr.on('data', chunk => { output += chunk })
    child.once('error', reject)
    child.once('exit', code => reject(new Error('worker exited before READY: ' + code + ' ' + output)))
  })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const done = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
  return { child, ready, done, exited }
}
async function runDirectories(temp) {
  return (await readdir(join(temp, 'storyforge-test-runs-v1'))).map(name => join(temp, 'storyforge-test-runs-v1', name))
}

test('task failure cleans only the owned payload, never an external symlink target or legacy directory', async t => {
  const f = await fixture(t)
  const backup = join(f.workspace, 'backup.json')
  await writeFile(backup, 'original backup')
  const legacy = join(f.temp, 'storyforge-e2e-snapshot-unmanaged')
  await mkdir(legacy)
  await writeFile(join(legacy, 'source.ts'), 'keep legacy source')
  await assert.rejects(withTestDirectory('e2e', async temporary => {
    await symlink(f.workspace, join(temporary.path, 'external'), 'dir')
    throw new Error('preparation failed')
  }, { tempRoot: f.temp }), /preparation failed/)
  assert.deepEqual(await runDirectories(f.temp), [])
  assert.equal(await readFile(backup, 'utf8'), 'original backup')
  assert.equal(await readFile(join(legacy, 'source.ts'), 'utf8'), 'keep legacy source')
})

test('live owners are preserved even if their lease is older than the retention period', async t => {
  const f = await fixture(t)
  await withTestDirectory('e2e', async temporary => {
    const directory = resolve(temporary.path, '..')
    const file = join(directory, 'owner.json')
    const owner = JSON.parse(await readFile(file, 'utf8'))
    owner.createdAt = 0
    await writeFile(file, JSON.stringify(owner))
    assert.equal(await reapAbandonedTestDirectories({ tempRoot: f.temp }), 0)
    assert.equal((await runDirectories(f.temp)).length, 1)
  }, { tempRoot: f.temp })
  assert.deepEqual(await runDirectories(f.temp), [])
})

test('unowned entries and a symlinked management root cannot be cleaned', async t => {
  const f = await fixture(t)
  await writeFile(join(f.workspace, 'backup.json'), 'keep')
  await symlink(f.workspace, join(f.temp, 'storyforge-test-runs-v1'), 'dir')
  await assert.rejects(withTestDirectory('e2e', async () => {}, { tempRoot: f.temp }), /unowned or linked/)
  assert.equal(await readFile(join(f.workspace, 'backup.json'), 'utf8'), 'keep')
})

test('insufficient disk space rejects a new run before copying payload', async t => {
  const f = await fixture(t)
  await assert.rejects(assertTestDiskSpace(f.temp, Number.MAX_SAFE_INTEGER), /5 GiB reserve/)
  assert.deepEqual(await readdir(f.temp), [])
})

test('missing coverage executable still removes the owned directory', async t => {
  const f = await fixture(t)
  const result = await run(process.execPath, [join(repo, 'scripts/run-isolated-coverage.mjs')], { cwd: f.workspace, env: f.env })
  assert.notEqual(result.code, 0)
  assert.deepEqual(await leftovers(f.temp), [])
})

test('SIGTERM cleans a run and forcibly stops only its own child when that child ignores termination', { skip: process.platform === 'win32', timeout: 15_000 }, async t => {
  const f = await fixture(t)
  const worker = startWorker(f, `
    import { withTestDirectory } from ${JSON.stringify(helperUrl)}
    try {
      process.exitCode = await withTestDirectory('e2e', async temporary => {
        return temporary.run(process.execPath, ['--input-type=module', '-e',
          "process.on('SIGTERM', () => {}); console.log('READY running'); setInterval(() => {}, 1000)"])
      })
    } catch (error) { process.exitCode = error.exitCode ?? 1 }
  `)
  t.after(() => worker.child.kill('SIGKILL'))
  await worker.ready
  worker.child.kill('SIGTERM')
  assert.equal((await worker.done).code, 143)
  assert.deepEqual(await leftovers(f.temp), [])
})

test('a killed owner is reclaimed on a later run, while unmarked entries remain untouched', { skip: process.platform === 'win32', timeout: 15_000 }, async t => {
  const f = await fixture(t)
  const worker = startWorker(f, `
    import { withTestDirectory } from ${JSON.stringify(helperUrl)}
    await withTestDirectory('e2e', async temporary => {
      console.log('READY ' + temporary.path)
      await new Promise(() => setInterval(() => {}, 1000))
    })
  `)
  t.after(() => worker.child.kill('SIGKILL'))
  const payload = await worker.ready
  const directory = resolve(payload, '..')
  worker.child.kill('SIGKILL')
  await worker.done
  const unknown = join(f.temp, 'storyforge-test-runs-v1', 'e2e-unknown')
  await mkdir(unknown)
  await writeFile(join(unknown, 'backup.json'), 'must remain')
  // Newly orphaned directories get a day of grace by default.
  assert.equal(await reapAbandonedTestDirectories({ tempRoot: f.temp }), 0)
  const held = await open(join(payload, 'still-in-use.txt'), 'w')
  try {
    assert.equal(await reapAbandonedTestDirectories({ tempRoot: f.temp, minimumAgeMs: 0 }), 0)
  } finally { await held.close() }
  const previousPath = process.env.PATH
  try {
    process.env.PATH = join(f.root, 'missing-executables')
    assert.equal(await reapAbandonedTestDirectories({ tempRoot: f.temp, minimumAgeMs: 0 }), 0)
  } finally { process.env.PATH = previousPath }
  assert.equal(await reapAbandonedTestDirectories({ tempRoot: f.temp, minimumAgeMs: 0 }), 1)
  assert.deepEqual(await runDirectories(f.temp), [unknown])
  assert.equal(await readFile(join(unknown, 'backup.json'), 'utf8'), 'must remain')
  await assert.rejects(readFile(join(directory, 'owner.json')), { code: 'ENOENT' })
})

test('a surviving child prevents orphan cleanup after its owner is killed', { skip: process.platform === 'win32', timeout: 15_000 }, async t => {
  const f = await fixture(t)
  const worker = startWorker(f, `
    import { withTestDirectory } from ${JSON.stringify(helperUrl)}
    await withTestDirectory('e2e', async temporary => temporary.run(process.execPath,
      ['--input-type=module', '-e', "console.log('READY child'); setInterval(() => {}, 1000)"]))
  `)
  await worker.ready
  const [directory] = await runDirectories(f.temp)
  const owner = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8'))
  t.after(async () => {
    worker.child.kill('SIGKILL')
    try { process.kill(-owner.childGroupId, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
    await worker.done
  })
  try {
    worker.child.kill('SIGKILL')
    await worker.exited
    assert.equal(await reapAbandonedTestDirectories({ tempRoot: f.temp, minimumAgeMs: 0 }), 0)
    assert.deepEqual(await runDirectories(f.temp), [directory])
  } finally {
    process.kill(-owner.childGroupId, 'SIGKILL')
    await worker.done
  }
})
