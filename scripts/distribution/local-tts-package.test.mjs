// Packaging/HTTP evidence only: synthetic runtime records, no Python/weights,
// inference, adopted audio or independent listening acceptance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createPortableServer } from './server.mjs'
import { syntheticJob, syntheticRuntime } from '../../tests/helpers/local-voice-product-fixture.mjs'
import { productProfile, qwenProductProfiles, digest, stable } from '../ttrpg-local-tts/product-contract.mjs'

const require = createRequire(import.meta.url)
const { localTtsResourceFiles } = require('./local-tts-files.cjs')
const root = fileURLToPath(new URL('../../', import.meta.url)), prefix = '/storyforge/local-tts/v1'
function kit(directory) {
  for (const file of localTtsResourceFiles()) {
    const to = join(directory, file); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(root, file), to)
  }
}
async function start(options = {}) {
  const server = createPortableServer(options)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, url: 'http://127.0.0.1:' + server.address().port }
}
async function close(server) { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)) }
function environment(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const prior = process.env[key]
    if (value === undefined) delete process.env[key]; else process.env[key] = value
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior })
  }
}

test('unpacked voice resources verify every current profile without a checkout, Git or node_modules', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'sf-tts-package-'))
  try {
    kit(temp)
    const packed = await import(pathToFileURL(join(temp, 'scripts/ttrpg-local-tts/product-contract.mjs')))
    for (const profile of packed.productProfiles) packed.assertProductImplementation(profile)
    assert.deepEqual(packed.productProfiles, [productProfile, ...qwenProductProfiles])
    assert.equal(readFileSync(join(temp, 'scripts/ttrpg-local-tts/product-worker.py'), 'utf8'), readFileSync(join(root, 'scripts/ttrpg-local-tts/product-worker.py'), 'utf8'))
    assert.match(readFileSync(join(temp, 'scripts/ttrpg-local-tts/MLX-Audio-LICENSE'), 'utf8'), /MIT/)
    assert.deepEqual(readdirSync(temp).sort(), ['LICENSE', 'scripts', 'src'])
    // Packaging never repins a changed worker to make its hash pass.
    writeFileSync(join(temp, 'scripts/ttrpg-local-tts/product-worker.py'), '# changed worker\n')
    assert.throws(() => localTtsResourceFiles(temp), /source changed/)
    assert.throws(() => packed.assertProductImplementation(packed.productProfiles[0]), /bytes changed/)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})

test('Electron and the portable copier retain the same physical resource layout and exact bytes', () => {
  const config = require('../../electron-builder.config.cjs'), files = localTtsResourceFiles()
  assert.equal(config.asar, true)
  assert.deepEqual(config.extraResources, files.map(file => ({ from: file, to: 'local-tts/' + file })))
  const python = process.platform === 'win32' ? 'python' : 'python3'
  const temp = mkdtempSync(join(tmpdir(), 'sf-tts-portable-copy-'))
  try {
    const script = `import importlib.util, pathlib, sys\nspec=importlib.util.spec_from_file_location('portable',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\nm.copy_local_tts_resources(pathlib.Path(sys.argv[2]))`
    const child = spawnSync(python, ['-B', '-c', script, join(root, 'scripts/distribution/build-portable.py'), temp], { encoding: 'utf8', timeout: 15000 })
    assert.equal(child.status, 0, child.stderr)
    for (const file of files) assert.deepEqual(readFileSync(join(temp, file)), readFileSync(join(root, file)), file)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})

test('disabled installed voice responds explicitly, keeps the app usable and does not load an arbitrary module', async t => {
  environment(t, { STORYFORGE_TTRPG_LOCAL_TTS_RUNTIME_DIR: undefined })
  const temp = mkdtempSync(join(tmpdir(), 'sf-tts-disabled-'))
  writeFileSync(join(temp, 'index.html'), '<html>app usable</html>')
  const { server, url } = await start({ webRoot: temp, localTtsRoot: join(temp, 'not-installed') })
  try {
    assert.equal(await (await fetch(url + '/storyforge/')).text(), '<html>app usable</html>')
    assert.equal((await fetch(url + prefix + '/profile')).status, 403)
    const response = await fetch(url + prefix + '/profile', { headers: { 'X-StoryForge-TTS': '1' } })
    assert.equal(response.status, 503)
    assert.match(response.headers.get('content-type'), /application\/json/)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { error: 'selected-local-voice-unavailable', automaticRetryAllowed: false })
    assert.deepEqual(readdirSync(temp), ['index.html'])
  } finally { await close(server); rmSync(temp, { recursive: true, force: true }) }
})

test('installed HTTP uses the original pinned bridge for profiles, immutable waiting jobs and original stop; no model starts', async t => {
  const temp = mkdtempSync(join(tmpdir(), 'sf-tts-installed-')), runtime = syntheticRuntime(), native = join(temp, 'native')
  kit(join(temp, 'local-tts')); mkdirSync(native)
  writeFileSync(join(native, 'product-asset-admission-v1.json'), stable({ schema: 'storyforge.ttrpg-qwen-product-assets', version: 1,
    status: 'verified-assets-only', modelCalls: 0, adoptionAllowed: false, humanRightsAcceptance: 'unproven',
    nativeAssetProfileSha256: qwenProductProfiles[0].nativeAssetProfileSha256, productProfileIds: qwenProductProfiles.map(p => p.profileId) }))
  environment(t, { STORYFORGE_TTRPG_LOCAL_TTS_RUNTIME_DIR: runtime, STORYFORGE_TTRPG_QWEN_TTS_RUNTIME_DIR: native })
  const { server, url } = await start({ webRoot: temp, localTtsRoot: join(temp, 'local-tts') })
  const headers = { 'X-StoryForge-TTS': '1', 'Content-Type': 'application/json' }
  const post = (path, body) => fetch(url + prefix + path, { method: 'POST', headers, body: JSON.stringify(body) })
  try {
    assert.equal((await fetch(url + prefix + '/profile', { headers: { ...headers, Origin: 'https://foreign.example' } })).status, 403)
    assert.equal((await fetch(url + prefix + '/profile', { headers: { ...headers, 'Sec-Fetch-Site': 'same-site' } })).status, 403)
    assert.equal((await fetch(url + prefix + '/profile')).status, 403)
    assert.deepEqual(readdirSync(runtime).sort(), ['owner.json', 'runtime-profile.json', 'setup-receipt.json'])
    if (process.platform === 'win32') {
      // The current pinned worker is macOS ARM64; shipping its helper does not
      // manufacture a Windows runtime. Ordinary startup remains usable.
      assert.equal((await fetch(url + prefix + '/profile', { headers })).status, 503)
      return
    }
    for (const profile of [productProfile, ...qwenProductProfiles]) {
      const response = await fetch(url + prefix + '/profile?profileId=' + profile.profileId, { headers })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { kind: 'local-offline-speech-v1', profileHash: digest(stable(profile)), profile })
    }
    assert.equal((await fetch(url + '/storyforge/local-tts/v2/profile', { headers })).status, 404)
    assert.equal((await fetch(url + prefix + '/profile?profileId=unregistered', { headers })).status, 409)
    const input = syntheticJob(1, qwenProductProfiles[0])
    const created = await post('/jobs', input)
    assert.equal(created.status, 200); assert.equal((await created.json()).status, 'waiting-for-slot')
    assert.equal((await (await post('/jobs', input)).json()).status, 'waiting-for-slot')
    assert.equal((await post('/jobs', { ...input, command: 'start-now' })).status, 409)
    const jobDirectory = join(runtime, 'product-jobs-v2', digest(input.jobKey))
    assert.deepEqual(readdirSync(jobDirectory).sort(), ['input.json', 'job.json'])
    assert.equal((await (await fetch(url + prefix + '/jobs/' + input.jobKey, { headers })).json()).status, 'waiting-for-slot')
    const cancelled = await post('/jobs/' + input.jobKey + '/cancel', { decision: 'request-stop-original-local-voice-job' })
    assert.equal((await cancelled.json()).cancellationConfirmed, true)
    // An explicit later start cannot revive the original cancelled claim.
    const stopped = await post('/jobs/' + input.jobKey + '/start', { inputArtifactHash: input.inputArtifactHash })
    assert.equal((await stopped.json()).status, 'cancelled-before-start')
    assert.ok(readdirSync(jobDirectory).every(file => !['worker-started.json', 'progress.json', 'audio.wav', 'calls.jsonl'].includes(file)))
    assert.equal((await fetch(url + '/storyforge/scripts/ttrpg-local-tts/product-worker.py', { headers })).status, 404)
  } finally { await close(server); rmSync(temp, { recursive: true, force: true }); rmSync(runtime, { recursive: true, force: true }) }
})
