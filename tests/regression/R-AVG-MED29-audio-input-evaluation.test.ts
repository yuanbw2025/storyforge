// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const contractUrl = pathToFileURL(path.join(repo, 'scripts/avg-audio-input-contract.mjs')).href
const evaluatorUrl = pathToFileURL(path.join(repo, 'scripts/evaluate-avg-audio-input.mjs')).href
const { inspectWav, makeSilence, sha256, assertOfflineAudioEntry, parseAudioObservation } = await import(/* @vite-ignore */ contractUrl)
const { calibrateAudioInputs } = await import(/* @vite-ignore */ evaluatorUrl)

const heldOut = '校准工件只用于测试。'
const config = { baseUrl: 'https://unit.invalid/v1', apiKey: 'unit-test-secret-value', model: 'unit-audio-model' }
const speech = { perception: 'heard', speechPresent: true, transcript: heldOut, observations: [], limitations: [] }
const quiet = { perception: 'heard', speechPresent: false, transcript: '', observations: [], limitations: [] }
const response = (observation: unknown, status = 200) => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify(observation) } }], usage: { prompt_tokens: 7, completion_tokens: 9, total_tokens: 16 },
}), { status })

describe('AVG-MED29 explicit audio capability evaluation', () => {
  let temp: string
  let audio: Buffer
  beforeEach(async () => {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'storyforge-audio-eval-test-'))
    audio = makeSilence({ sampleRate: 24000, channels: 1 })
    for (let offset = 44; offset < audio.length; offset += 2) audio.writeInt16LE(Math.round(Math.sin(offset / 19) * 1200), offset)
  })
  afterEach(async () => { await fs.rm(temp, { recursive: true, force: true }) })

  const options = () => ({ audio, expectedHash: sha256(audio), expectedText: heldOut, profileId: 'unit-test', config,
    outputDir: path.join(temp, 'run'), ledgerRoot: path.join(temp, 'identities') })
  const read = async (name: string) => JSON.parse(await fs.readFile(path.join(temp, 'run', name), 'utf8'))

  it('requires exact WAV bytes/hash, valid PCM bounds and finite observation intervals', () => {
    expect(inspectWav(audio, sha256(audio))).toMatchObject({ sampleRate: 24000, channels: 1, durationMs: 800 })
    expect(() => inspectWav(audio, '0'.repeat(64))).toThrow(/hash/)
    const invalid = Buffer.from(audio); invalid.writeUInt16LE(32, 34)
    expect(() => inspectWav(invalid, sha256(invalid))).toThrow(/format/)
    const long = makeSilence({ sampleRate: 48000 * 30, channels: 1 })
    expect(() => inspectWav(long, sha256(long))).toThrow()
    expect(() => parseAudioObservation(JSON.stringify({ ...speech, observations: [{ fromMs: 0, toMs: 99999, observation: 'invented' }] }), 800)).toThrow(/schema/)
    expect(() => parseAudioObservation(JSON.stringify({ ...speech, authorApproved: true }), 800)).toThrow(/schema/)
  })

  it('sends two blind bounded attachments, journals before dispatch and preserves exact bytes/usage', async () => {
    const bodies: { messages: { content: { type: string; text?: string; input_audio?: { data: string } }[] }[] }[] = []
    const result = await calibrateAudioInputs({ ...options(), transport: async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); bodies.push(body)
      expect(JSON.stringify(body)).not.toContain(heldOut)
      expect(body).toMatchObject({ stream: false, max_tokens: 1400, temperature: 0 })
      expect(init.redirect).toBe('error')
      expect((await read('journal.json')).attempts.at(-1).state).toBe('sent')
      return response(bodies.length === 1 ? speech : quiet)
    } })
    expect(bodies).toHaveLength(2)
    expect(bodies[0].messages[0].content[0]).toEqual(bodies[1].messages[0].content[0])
    expect(Buffer.from(bodies[0].messages[0].content[1].input_audio!.data, 'base64')).toEqual(audio)
    expect(Buffer.from(bodies[1].messages[0].content[1].input_audio!.data, 'base64').subarray(44).some(byte => byte !== 0)).toBe(false)
    expect(result).toMatchObject({ outcome: 'sample-transcription-capability-evidenced', attemptedModelCalls: 2,
      state: 'complete', authorReviewChanged: false, adoptionAllowed: false, releaseAllowed: false, fee: null })
    expect((await read('journal.json')).attempts.map((item: { usage: unknown }) => item.usage)).toEqual([
      { prompt_tokens: 7, completion_tokens: 9, total_tokens: 16 }, { prompt_tokens: 7, completion_tokens: 9, total_tokens: 16 },
    ])
    expect(await fs.readFile(path.join(temp, 'run/source.wav'))).toEqual(audio)
    expect((await fs.stat(path.join(temp, 'run/receipt.json'))).mode & 0o777).toBe(0o600)
  })

  it.each([400, 401, 402, 403, 429, 503])('retains HTTP %i and stops without control dispatch/retry/fallback', async status => {
    let calls = 0
    const result = await calibrateAudioInputs({ ...options(), transport: async () => { calls++; return response(null, status) } })
    expect(calls).toBe(1)
    expect(result).toMatchObject({ state: 'stopped', attemptedModelCalls: 1, outcome: 'not-evidenced' })
    expect((await read('speech-response.json')).httpStatus).toBe(status)
    expect((await read('journal.json')).attempts[0]).toMatchObject({ state: 'known-http-failure', httpStatus: status })
  })

  it('marks a disconnect unknown and blocks the same identity in a different output directory', async () => {
    let calls = 0
    const transport = async () => { calls++; throw new Error('connection lost') }
    const result = await calibrateAudioInputs({ ...options(), transport })
    expect(result).toMatchObject({ state: 'result-unknown', attemptedModelCalls: 1, outcome: 'not-evidenced' })
    const original = await fs.readFile(path.join(temp, 'run/journal.json'), 'utf8')
    await expect(calibrateAudioInputs({ ...options(), outputDir: path.join(temp, 'other'), transport })).rejects.toMatchObject({ code: 'EEXIST' })
    expect(calls).toBe(1)
    expect(await fs.readFile(path.join(temp, 'run/journal.json'), 'utf8')).toBe(original)
  })

  it('rejects malformed successful output and preserves its original response/usage', async () => {
    let calls = 0
    const result = await calibrateAudioInputs({ ...options(), transport: async () => { calls++; return response({ authorApproved: true }) } })
    expect(calls).toBe(1)
    expect(result).toMatchObject({ state: 'stopped', outcome: 'not-evidenced' })
    expect((await read('speech-response.json')).body).toContain('authorApproved')
    expect((await read('journal.json')).attempts[0]).toMatchObject({ state: 'known-response-rejected', usage: { total_tokens: 16 } })
  })

  it('does not count self-attested hearing or a hallucinated silent transcript as capability evidence', async () => {
    let calls = 0
    const result = await calibrateAudioInputs({ ...options(), transport: async () => { calls++; return response(speech) } })
    expect(calls).toBe(2)
    expect(result).toMatchObject({ outcome: 'not-evidenced', speechMatch: true, silenceCorrect: false, authorReviewChanged: false })
  })

  it('caps a successful but oversized response and leaves it unknown without a second dispatch', async () => {
    let calls = 0
    const result = await calibrateAudioInputs({ ...options(), transport: async () => {
      calls++; return new Response('x'.repeat(65537), { status: 200 })
    } })
    expect(calls).toBe(1)
    expect(result).toMatchObject({ outcome: 'not-evidenced', state: 'result-unknown', attemptedModelCalls: 1 })
    expect((await read('journal.json')).attempts[0]).toMatchObject({ httpStatus: 200, error: 'Response exceeds evaluation byte budget' })
  })

  it('redacts credential/endpoint echoes, refuses repeat outputs and cannot store receipts in the repo', async () => {
    let calls = 0
    const transport = async () => { calls++; return new Response(config.apiKey + config.baseUrl, { status: 401 }) }
    await calibrateAudioInputs({ ...options(), transport })
    const files = await fs.readdir(path.join(temp, 'run'))
    const contents = await Promise.all(files.filter(name => name.endsWith('.json')).map(name => fs.readFile(path.join(temp, 'run', name), 'utf8')))
    expect(contents.join('')).not.toContain(config.apiKey)
    expect(contents.join('')).not.toContain(config.baseUrl)
    await expect(calibrateAudioInputs({ ...options(), transport })).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(calibrateAudioInputs({ ...options(), outputDir: path.join(repo, 'forbidden-eval-output'), transport })).rejects.toThrow(/outside/)
    expect(calls).toBe(1)
  })

  it('requires exact eval-only/no-adoption registry binding even for a private execution', () => {
    expect(() => assertOfflineAudioEntry({ version: 2, scope: 'formal-ai-execution-entry', offlineEvaluations: [] })).toThrow(/registry/)
  })

  it('also redacts valid structured model output and nested usage before storing or returning receipts', async () => {
    let calls = 0
    const result = await calibrateAudioInputs({ ...options(), transport: async () => {
      calls++
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        ...(calls === 1 ? speech : quiet), limitations: [config.apiKey, config.baseUrl],
      }) } }], usage: { providerNote: config.apiKey, nested: { endpoint: config.baseUrl } } }))
    } })
    expect(result.outcome).toBe('sample-transcription-capability-evidenced')
    expect(JSON.stringify(result)).not.toContain(config.apiKey)
    expect(JSON.stringify(result)).not.toContain(config.baseUrl)
    for (const file of (await fs.readdir(path.join(temp, 'run'))).filter(name => name.endsWith('.json'))) {
      const content = await fs.readFile(path.join(temp, 'run', file), 'utf8')
      expect(content).not.toContain(config.apiKey)
      expect(content).not.toContain(config.baseUrl)
    }
  })
})
