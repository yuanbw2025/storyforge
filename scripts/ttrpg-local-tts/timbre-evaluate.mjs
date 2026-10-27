// Public fixture only. No project, arbitrary text, reference voice or playback.
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const base = path.dirname(fileURLToPath(import.meta.url))
const caller = 'scripts/ttrpg-local-tts/timbre-evaluate.mjs'
const entryId = 'ttrpg.local-voice.timbre-eval'
export const timbreProfile = JSON.parse(readFileSync(path.join(base, 'timbre-eval-profile.json'), 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export function assertVoiceTransport(id, actualCaller, registry = JSON.parse(readFileSync(path.join(base, '../../src/lib/agent/ai-entry-registry.json'), 'utf8'))) {
  const rows = registry.limitedTransports?.filter(row => row.entryId === id)
  if (id !== entryId || actualCaller !== caller || registry.version !== 2 || rows?.length !== 1
    || rows[0].boundary !== 'offline-fixture-audio-eval' || rows[0].adoptAllowed !== false
    || JSON.stringify(rows[0].allowedCallers) !== JSON.stringify([caller])
    || Object.keys(rows[0]).sort().join(',') !== 'adoptAllowed,allowedCallers,boundary,entryId,reason') throw new Error('多声线固定评测入口未登记')
}
export function parseTimbreArgs(args) {
  const result = {}, seen = new Set()
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (seen.has(key) || !['--check-only', '--melo-runtime-dir', '--timbre-runtime-dir', '--source-wav'].includes(key)) throw new Error('仅允许固定公开 WAV 与已核对的运行库，不接受原文或参考人声')
    seen.add(key)
    if (key === '--check-only') result.checkOnly = true
    else { const value = args[++i]; if (!value || value.startsWith('--')) throw new Error('缺少路径'); result[key.slice(2)] = path.resolve(value) }
  }
  return result
}
export function verifyTimbreWav(bytes, expectedHash = null, source = false) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.length > 2 * 1024 * 1024
    || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.readUInt32LE(4) !== bytes.length - 8
    || bytes.toString('ascii', 8, 16) !== 'WAVEfmt ' || bytes.readUInt32LE(16) !== 16
    || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 || bytes.readUInt16LE(34) !== 16
    || bytes.readUInt16LE(32) !== 2 || bytes.toString('ascii', 36, 40) !== 'data'
    || bytes.readUInt32LE(40) !== bytes.length - 44 || (bytes.length - 44) % 2) throw new Error('实际固定 PCM 格式不符')
  const sr = bytes.readUInt32LE(24), samples = (bytes.length - 44) / 2
  if (![22050, 44100].includes(sr) || bytes.readUInt32LE(28) !== sr * 2
    || Math.abs(samples / sr - timbreProfile.fixture.sourceSamples / timbreProfile.fixture.sourceSampleRate) > 0.04
    || (source && (sr !== timbreProfile.fixture.sourceSampleRate || samples !== timbreProfile.fixture.sourceSamples))
    || (expectedHash && hash(bytes) !== expectedHash)) throw new Error('固定音频身份、长度或 hash 不符')
  let energy = 0, peak = 0
  for (let i = 44; i < bytes.length; i += 2) { const n = bytes.readInt16LE(i) / 32767; energy += n * n; peak = Math.max(peak, Math.abs(n)) }
  const rms = Math.sqrt(energy / samples)
  if (rms < .00001 || peak > .991) throw new Error('音频静音或削波')
  return { sha256: hash(bytes), bytes: bytes.length, sampleRate: sr, samples, durationSeconds: samples / sr, rms, peak }
}
async function main() {
  const options = parseTimbreArgs(process.argv.slice(2))
  assertVoiceTransport('ttrpg.local-voice.timbre-eval', 'scripts/ttrpg-local-tts/timbre-evaluate.mjs')
  if (options.checkOnly) { console.log(JSON.stringify({ entryId, evaluationOnly: true, adoptionAllowed: false, modelCalled: false, targetCount: timbreProfile.targetSpeakers.length })); return }
  const melo = options['melo-runtime-dir'], runtime = options['timbre-runtime-dir'], source = options['source-wav']
  if (!melo || !runtime || !source) throw new Error('请指定两份已核对资产目录与原公开固定 WAV')
  verifyTimbreWav(readFileSync(source), timbreProfile.fixture.sourceWavSha256, true)
  const directory = path.join(runtime, 'evaluations', `run-${randomUUID()}`)
  const lock = path.join(runtime, '.eval.lock')
  const fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd)
  const receipt = { schema: 'storyforge.ttrpg-timbre-eval-attempt', version: 1, status: 'preparing', pid: process.pid,
    entryId, startedAt: Date.now(), directory, evaluationOnly: true, adoptionAllowed: false, automaticRetryAllowed: false,
    profileSha256: hash(readFileSync(path.join(base, 'timbre-eval-profile.json'))), workerSha256: hash(readFileSync(path.join(base, 'timbre-worker.py'))), voices: [] }
  const save = () => writeFileSync(path.join(directory, 'attempt.json'), JSON.stringify(receipt, null, 2) + '\n')
  try {
    mkdirSync(directory, { recursive: true }); save()
    const stdout = openSync(path.join(directory, 'worker.log'), 'wx', 0o600)
    let timer, child
    try {
      child = spawn(path.join(melo, 'venv/bin/python3'), ['-I', '-B', path.join(base, 'timbre-worker.py')], { stdio: ['pipe', stdout, stdout], env: { ...process.env, PYTHONNOUSERSITE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' } })
      child.stdin.on('error', error => { receipt.inputError = String(error); save() })
      receipt.workerPid = child.pid; receipt.status = 'running'; save()
      child.stdin.end(JSON.stringify({ meloRuntime: melo, timbreRuntime: runtime, sourceWav: source, outputDir: directory,
        profileSha256: receipt.profileSha256, workerSha256: receipt.workerSha256 }))
      const code = await new Promise((resolve, reject) => {
        timer = setTimeout(() => { receipt.deadlineExceeded = true; save(); child.kill('SIGTERM') }, timbreProfile.timeoutMs)
        child.on('error', reject); child.on('exit', (exit, signal) => resolve({ exit, signal }))
      })
      receipt.workerExit = code
      if (code.exit !== 0 || receipt.deadlineExceeded) throw new Error('离线候选执行未完成；原日志与部分文件保留，不重试')
    } finally { clearTimeout(timer); closeSync(stdout) }
    const result = JSON.parse(readFileSync(path.join(directory, 'result.json'), 'utf8'))
    if (result.status !== 'generated' || result.profileSha256 !== receipt.profileSha256 || result.workerSha256 !== receipt.workerSha256
      || result.network !== 'disabled' || result.calls !== timbreProfile.maxCalls || result.humanListeningAcceptance !== 'unproven'
      || JSON.stringify(result.voices.map(v => v.preset)) !== JSON.stringify(timbreProfile.targetSpeakers)) throw new Error('真实候选回执身份不符')
    for (const voice of result.voices) receipt.voices.push({ preset: voice.preset, ...verifyTimbreWav(readFileSync(path.join(directory, `${voice.preset}.wav`)), voice.audioSha256) })
    verifyTimbreWav(readFileSync(source), timbreProfile.fixture.sourceWavSha256, true)
    if (hash(readFileSync(path.join(base, 'timbre-worker.py'))) !== receipt.workerSha256 || hash(readFileSync(path.join(base, 'timbre-eval-profile.json'))) !== receipt.profileSha256) throw new Error('评测源码已变化')
    receipt.status = 'passed'; receipt.humanListeningAcceptance = 'unproven'
  } catch (error) { receipt.status = 'failed'; receipt.error = String(error); throw error }
  finally { receipt.finishedAt = Date.now(); save(); if (existsSync(lock)) unlinkSync(lock) }
  console.log(JSON.stringify({ status: receipt.status, directory, voices: receipt.voices.length, humanListeningAcceptance: 'unproven' }))
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error('ttrpg-timbre-eval:', error.message); process.exitCode = 1 })
