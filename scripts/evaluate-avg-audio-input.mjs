/* global AbortSignal, Buffer, console, fetch, process, TextDecoder */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AUDIO_INPUT_ENTRY, AUDIO_INPUT_PROMPT, MAX_MODEL_CALLS, MAX_RESPONSE_BYTES,
  assertOfflineAudioEntry, sha256, inspectWav, makeSilence, parseAudioObservation, assessAudioCapability } from './avg-audio-input-contract.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function writeReceipt(dir, name, value) {
  const target = path.join(dir, name)
  const handle = await fs.open(target + '.pending', 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync() } finally { await handle.close() }
  await fs.rename(target + '.pending', target)
}

async function boundedBody(response) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing response body')
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) throw new Error('Response exceeds evaluation byte budget')
      chunks.push(Buffer.from(value))
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  return Buffer.concat(chunks).toString('utf8')
}

export async function calibrateAudioInputs({ audio, expectedHash, expectedText, profileId, config, outputDir, ledgerRoot, transport = fetch }) {
  assertOfflineAudioEntry()
  outputDir = await externalDestination(outputDir)
  ledgerRoot = await externalDestination(ledgerRoot)
  audio = Buffer.from(audio)
  const source = inspectWav(audio, expectedHash)
  if (typeof expectedText !== 'string' || !expectedText.trim() || expectedText.length > 4096
    || !/^[a-z0-9-]{1,64}$/.test(profileId) || typeof config.apiKey !== 'string' || !config.apiKey
    || typeof config.model !== 'string' || !config.model.trim()) throw new Error('Evaluation configuration/held-out text rejected')
  const endpoint = new URL(config.baseUrl.replace(/\/$/, '') + '/chat/completions')
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('HTTPS configured route required')
  const silence = makeSilence(source)
  const cases = [{ name: 'speech', audio, meta: source },
    { name: 'silence', audio: silence, meta: inspectWav(silence, sha256(silence)) }]
  const runIdentity = sha256(JSON.stringify({ entry: AUDIO_INPUT_ENTRY, profileId, model: config.model, sourceHash: expectedHash }))
  const redact = text => text.replaceAll(config.apiKey, '[credential-redacted]').replaceAll(config.baseUrl, '[endpoint-redacted]')
  const sanitize = value => JSON.parse(redact(JSON.stringify(value, (_key, item) => typeof item === 'string' ? redact(item) : item)))
  const save = (name, value) => writeReceipt(outputDir, name, sanitize(value))
  await fs.mkdir(outputDir, { mode: 0o700 }) // Existing runs are never resumed or overwritten.
  await fs.mkdir(ledgerRoot, { recursive: true, mode: 0o700 })
  const claim = await fs.open(path.join(ledgerRoot, runIdentity + '.json'), 'wx', 0o600)
  try { await claim.writeFile(JSON.stringify({ runIdentity, outputDir, createdAt: new Date().toISOString() })); await claim.sync() } finally { await claim.close() }
  const contractHash = sha256(await fs.readFile(new URL('./avg-audio-input-contract.mjs', import.meta.url)))
  await save('manifest.json', { entryId: AUDIO_INPUT_ENTRY, boundary: 'eval-only', adoptAllowed: false,
    profileId, model: config.model, runIdentity, contractHash,
    runnerHash: sha256(await fs.readFile(fileURLToPath(import.meta.url))),
    registryHash: sha256(await fs.readFile(path.join(root, 'src/lib/agent/ai-entry-registry.json'))), maximumModelCalls: MAX_MODEL_CALLS,
    timeoutMs: 120000, maxOutputTokensPerCall: 1400, maxResponseBytes: MAX_RESPONSE_BYTES,
    promptHash: sha256(AUDIO_INPUT_PROMPT), heldOutTextHash: sha256(expectedText),
    source, silence: cases[1].meta, createdAt: new Date().toISOString(), retryPolicy: 'none; existing source/profile/model identity is permanently claimed' })
  await fs.writeFile(path.join(outputDir, 'source.wav'), audio, { flag: 'wx', mode: 0o600 })
  await fs.writeFile(path.join(outputDir, 'silence.wav'), silence, { flag: 'wx', mode: 0o600 })
  const results = []
  const journal = { runIdentity, attempts: [], state: 'not-sent' }
  for (const input of cases.slice(0, MAX_MODEL_CALLS)) {
    assertOfflineAudioEntry()
    const body = { model: config.model, messages: [{ role: 'user', content: [
      { type: 'text', text: AUDIO_INPUT_PROMPT },
      { type: 'input_audio', input_audio: { data: input.audio.toString('base64'), format: 'wav' } },
    ] }], stream: false, temperature: 0, max_tokens: 1400 }
    const requestBytes = JSON.stringify(body)
    const attempt = { case: input.name, sourceHash: input.meta.sha256, requestBodyHash: sha256(requestBytes),
      state: 'sent', sentAt: new Date().toISOString() }
    journal.attempts.push(attempt)
    journal.state = 'in-flight'
    await save(input.name + '-request.json', JSON.parse(redact(requestBytes)))
    await save('journal.json', journal) // Durable marker before dispatch; no retry/fallback path.
    const started = Date.now()
    let response, raw
    try {
      response = await transport(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
        headers: { Authorization: 'Bearer ' + config.apiKey, 'Content-Type': 'application/json' }, body: requestBytes })
      attempt.httpStatus = response.status
      raw = await boundedBody(response)
    } catch (error) {
      attempt.state = 'result-unknown'
      attempt.error = redact(String(error.message))
      attempt.elapsedMs = Date.now() - started
      journal.state = 'result-unknown'
      await save('journal.json', journal)
      break
    }
    attempt.elapsedMs = Date.now() - started
    attempt.responseHash = sha256(raw)
    attempt.redacted = redact(raw) !== raw
    await save(input.name + '-response.json', { httpStatus: response.status, body: redact(raw) })
    if (response.status !== 200) {
      attempt.state = 'known-http-failure'
      journal.state = 'stopped'
      await save('journal.json', journal)
      break
    }
    let parsed, observation
    try {
      parsed = JSON.parse(raw)
      observation = parseAudioObservation(parsed.choices?.[0]?.message?.content, input.meta.durationMs)
    } catch (error) {
      attempt.state = 'known-response-rejected'
      attempt.error = redact(String(error.message))
      attempt.usage = parsed?.usage ?? null
      journal.state = 'stopped'
      await save('journal.json', journal)
      break
    }
    attempt.state = 'known-response'
    attempt.usage = parsed.usage ?? null
    results.push({ case: input.name, observation, usage: parsed.usage ?? null })
    await save('journal.json', journal)
  }
  const assessment = assessAudioCapability(results, expectedText)
  if (journal.state === 'in-flight') journal.state = 'complete'
  const receipt = { ...assessment, entryId: AUDIO_INPUT_ENTRY, runIdentity, sourceHash: expectedHash,
    attemptedModelCalls: journal.attempts.length, state: journal.state, results, fee: null,
    feeNote: 'No price/credit claim inferred from missing usage or the model directory.', finishedAt: new Date().toISOString() }
  await save('journal.json', journal)
  await save('receipt.json', receipt)
  return sanitize(receipt)
}

async function externalFile(input) {
  if (!input || !path.isAbsolute(input)) throw new Error('Explicit absolute private input/output paths required')
  const real = await fs.realpath(input)
  const relative = path.relative(root, real)
  if (!relative.startsWith('..' + path.sep) && relative !== '..') throw new Error('Evaluation media/receipts must stay outside this repository')
  return real
}

async function externalDestination(input) {
  if (!input || !path.isAbsolute(input)) throw new Error('Absolute private destination required')
  let ancestor = path.dirname(path.resolve(input))
  let suffix = path.basename(path.resolve(input))
  for (;;) {
    try { return path.join(await externalFile(ancestor), suffix) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      suffix = path.join(path.basename(ancestor), suffix)
      ancestor = path.dirname(ancestor)
    }
  }
}

async function main() {
  const { values } = parseArgs({ options: { audio: { type: 'string' }, sha256: { type: 'string' },
    'expected-file': { type: 'string' }, output: { type: 'string' }, profile: { type: 'string', default: 'agnes-primary' },
    purpose: { type: 'string', default: 'media' }, model: { type: 'string' }, execute: { type: 'boolean', default: false } }, strict: true })
  assertOfflineAudioEntry()
  const audioPath = await externalFile(values.audio)
  const expectedPath = await externalFile(values['expected-file'])
  if (!(await fs.lstat(audioPath)).isFile() || !(await fs.lstat(expectedPath)).isFile()
    || (await fs.stat(audioPath)).size > 2 * 1024 * 1024 || (await fs.stat(expectedPath)).size > 8192) throw new Error('Private input size/type rejected')
  const audio = await fs.readFile(audioPath)
  const source = inspectWav(audio, values.sha256)
  const expectedText = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(expectedPath)).trim()
  if (!expectedText || expectedText.length > 4096 || !['media', 'comparison'].includes(values.purpose)) throw new Error('Held-out text or explicit purpose rejected')
  if (!values.output || !path.isAbsolute(values.output)) throw new Error('Absolute fresh private output directory required')
  const outputDir = path.join(await externalFile(path.dirname(values.output)), path.basename(values.output))
  try { await fs.lstat(outputDir); throw new Error('Output already exists; run will not be resumed') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const apiHome = process.env.STORYFORGE_LOCAL_API_HOME || path.join(os.homedir(), '.config/storyforge/api')
  const local = await import(pathToFileURL(path.join(apiHome, 'lib/local-api.mjs')).href)
  const config = local.loadAIConfig(values.profile, { purpose: values.purpose,
    ...(values.model ? { model: values.model, allowUnverifiedModel: true } : {}) })
  if (!values.execute) {
    console.log(JSON.stringify({ dryRun: true, modelCalls: 0, profileId: values.profile, model: config.model, source,
      maximumModelCalls: MAX_MODEL_CALLS, expectedTextSent: false, authorDatabaseAccess: false }))
    return
  }
  const ledgerRoot = path.join(os.homedir(), '.local/share/storyforge-evaluations/avg-audio-input/identities')
  const receipt = await calibrateAudioInputs({ audio, expectedHash: values.sha256, expectedText,
    profileId: values.profile, config, outputDir, ledgerRoot })
  console.log(JSON.stringify({ outcome: receipt.outcome, attemptedModelCalls: receipt.attemptedModelCalls,
    state: receipt.state, sourceHash: receipt.sourceHash, authorReviewChanged: false }))
  if (receipt.outcome !== 'sample-transcription-capability-evidenced') process.exitCode = 2
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Audio evaluation stopped; inspect the private receipt. No automatic retry.'); process.exitCode = 1 })
}
