// Fixed public Chinese text only; no author data, reference voices or adoption.
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = path.dirname(fileURLToPath(import.meta.url))
const caller = 'scripts/ttrpg-local-tts/native-voice-evaluate.mjs'
const entryId = 'ttrpg.local-voice.native-fixture-eval'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export const nativeVoiceProfile = JSON.parse(readFileSync(path.join(base, 'native-voice-eval-profile.json'), 'utf8'))
export function selectNativeFixture(engine = 'kokoro') {
  if (!['kokoro', 'qwen'].includes(engine)) throw new Error('仅允许已登记的 Kokoro 或 Qwen 固定试音')
  const profileFile = engine === 'qwen' ? 'qwen-native-eval-profile.json' : 'native-voice-eval-profile.json'
  const workerFile = engine === 'qwen' ? 'qwen-native-worker.py' : 'native-voice-worker.py'
  const profile = engine === 'kokoro' ? nativeVoiceProfile : JSON.parse(readFileSync(path.join(base, profileFile), 'utf8'))
  if (profile.entryId !== entryId || profile.adoptionAllowed !== false || profile.productInvocationAllowed !== false
    || profile.network !== 'disabled' || profile.fixture !== nativeVoiceProfile.fixture) throw new Error('声线评测不能扩大到产品或任意原文')
  return { engine, profile, profileFile, workerFile }
}
export function assertVoiceTransport(id, actualCaller, registry = JSON.parse(readFileSync(path.join(base, '../../src/lib/agent/ai-entry-registry.json'), 'utf8'))) {
  const rows = registry.limitedTransports?.filter(row => row.entryId === id)
  if (id !== entryId || actualCaller !== caller || registry.version !== 2 || rows?.length !== 1
    || rows[0].boundary !== 'offline-fixture-audio-eval' || rows[0].adoptAllowed !== false
    || JSON.stringify(rows[0].allowedCallers) !== JSON.stringify([caller])
    || Object.keys(rows[0]).sort().join(',') !== 'adoptAllowed,allowedCallers,boundary,entryId,reason') throw new Error('原生声线固定评测入口未登记')
}
export function parseNativeFixtureArgs(args) {
  const result = {}, seen = new Set()
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (seen.has(key) || !['--check-only', '--engine', '--melo-runtime-dir', '--native-runtime-dir'].includes(key)) throw new Error('只接受已核对运行库路径；不接受自定义台词、声线或参考人声')
    seen.add(key)
    if (key === '--check-only') result.checkOnly = true
    else {
      const value = args[++i]; if (!value || value.startsWith('--')) throw new Error('缺少路径或已登记引擎')
      if (key === '--engine') { if (!['kokoro', 'qwen'].includes(value)) throw new Error('未知评测引擎'); result.engine = value }
      else result[key.slice(2)] = path.resolve(value)
    }
  }
  if (result.checkOnly && [...seen].some(key => !['--check-only', '--engine'].includes(key))) throw new Error('静态检查不能混入执行参数')
  return result
}
export function verifyNativeFixturePcm(bytes, expectedHash = null, p = nativeVoiceProfile) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.length > 44 + p.sampleRate * 2 * p.maxSecondsPerVoice
    || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.readUInt32LE(4) !== bytes.length - 8
    || bytes.toString('ascii', 8, 16) !== 'WAVEfmt ' || bytes.readUInt32LE(16) !== 16
    || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 || bytes.readUInt16LE(34) !== 16
    || bytes.readUInt16LE(32) !== 2 || bytes.readUInt32LE(24) !== p.sampleRate || bytes.readUInt32LE(28) !== p.sampleRate * 2
    || bytes.toString('ascii', 36, 40) !== 'data' || bytes.readUInt32LE(40) !== bytes.length - 44 || (bytes.length - 44) % 2
    || (expectedHash && hash(bytes) !== expectedHash)) throw new Error('原生声线 PCM 或身份不符')
  const samples = (bytes.length - 44) / 2
  if (samples / p.sampleRate < 5) throw new Error('固定长段落音频不完整')
  let sum = 0, peak = 0
  for (let i = 44; i < bytes.length; i += 2) { const n = bytes.readInt16LE(i) / 32767; sum += n * n; peak = Math.max(peak, Math.abs(n)) }
  const rms = Math.sqrt(sum / samples)
  if (rms < .00001 || peak > .991) throw new Error('声线静音或削波')
  return { sha256: hash(bytes), bytes: bytes.length, sampleRate: p.sampleRate, samples, durationSeconds: samples / p.sampleRate, rms, peak }
}
export function assertQwenResourceAdmission(result, profile) {
  if (result.resourceAcceptance !== 'passed' || result.memoryGuidelineBytes !== profile.gpuMemoryLimitBytes
    || !Number.isSafeInteger(result.peakMetalBytes) || result.peakMetalBytes <= 0 || result.peakMetalBytes > profile.gpuMemoryLimitBytes
    || !Number.isSafeInteger(result.memoryChecks) || result.memoryChecks < 4) throw new Error('Qwen 实际 Metal 峰值未通过准入，分配目标不能冒充硬上限')
}
export function assertQwenCodecClock(voice, pcm, profile) {
  if (!Number.isSafeInteger(voice.codecTokens) || voice.codecTokens < 1 || voice.codecTokens >= profile.maxCodecTokensPerVoice
    || voice.eosObserved !== true || voice.samples !== pcm.samples || voice.sampleRate !== pcm.sampleRate
    || pcm.samples !== voice.codecTokens * profile.decodeUpsampleRate) throw new Error('Qwen 完整音频码与真实 PCM 时序不符，不能丢弃合法零号音频码')
}
async function main() {
  const options = parseNativeFixtureArgs(process.argv.slice(2))
  assertVoiceTransport('ttrpg.local-voice.native-fixture-eval', 'scripts/ttrpg-local-tts/native-voice-evaluate.mjs')
  const selected = selectNativeFixture(options.engine), p = selected.profile
  if (options.checkOnly) { console.log(JSON.stringify({ entryId, evaluationOnly: true, adoptionAllowed: false, modelCalled: false, voices: p.voices })); return }
  const melo = options['melo-runtime-dir'], runtime = options['native-runtime-dir']
  if (!melo || !runtime) throw new Error('请指定现有共享 Python 与已核对原生声线资产目录')
  const runId = `run-${randomUUID()}`, directory = path.join(runtime, 'evaluations', runId), acquired = []
  const receipt = { status: 'preparing', entryId, engine: selected.engine, runId, pid: process.pid, startedAt: Date.now(), directory,
    evaluationOnly: true, adoptionAllowed: false, automaticRetryAllowed: false, voices: [],
    profileSha256: hash(readFileSync(path.join(base, selected.profileFile))), workerSha256: hash(readFileSync(path.join(base, selected.workerFile))) }
  const save = () => writeFileSync(path.join(directory, 'attempt.json'), JSON.stringify(receipt, null, 2) + '\n')
  mkdirSync(directory, { recursive: true }); save()
  try {
    for (const root of [melo, runtime]) {
      const lock = path.join(root, '.eval.lock'), claim = JSON.stringify({ kind: 'native-fixture-evaluation', runId, pid: process.pid })
      const fd = openSync(lock, 'wx', 0o600)
      try { writeFileSync(fd, claim); acquired.push({ lock, claim }) } finally { closeSync(fd) }
    }
    if ([path.join(melo, '.setup.lock'), path.join(runtime, '.prepare.lock')].some(existsSync)) throw new Error('运行库正在准备；保留原任务，不并发加载')
    const stdout = openSync(path.join(directory, 'worker.log'), 'wx', 0o600)
    let child, timer, killTimer
    try {
      child = spawn(path.join(melo, 'venv/bin/python3'), ['-I', '-B', path.join(base, selected.workerFile)], { stdio: ['pipe', stdout, stdout], env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PYTHONNOUSERSITE: '1' } })
      child.stdin.on('error', error => { receipt.inputError = String(error); save() })
      receipt.workerPid = child.pid; receipt.status = 'running'; save()
      child.stdin.end(JSON.stringify({ meloRuntime: melo, nativeRuntime: runtime, outputDir: directory, profileSha256: receipt.profileSha256, workerSha256: receipt.workerSha256 }))
      receipt.workerExit = await new Promise((resolve, reject) => {
        timer = setTimeout(() => { receipt.deadlineExceeded = true; save(); child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 3000) }, p.timeoutMs)
        child.once('error', reject); child.once('exit', (exit, signal) => resolve({ exit, signal }))
      })
      if (receipt.workerExit.exit !== 0 || receipt.deadlineExceeded) throw new Error('原生声线评测失败；保留原证据，不自动重试')
    } finally { clearTimeout(timer); clearTimeout(killTimer); closeSync(stdout) }
    const result = JSON.parse(readFileSync(path.join(directory, 'result.json'), 'utf8'))
    if (result.status !== 'generated' || result.profileSha256 !== receipt.profileSha256 || result.workerSha256 !== receipt.workerSha256
      || result.text !== p.fixture || result.network !== 'disabled' || result.calls !== p.maxCalls
      || result.humanListeningAcceptance !== 'unproven' || result.adoptionAllowed !== false
      || JSON.stringify(result.voices.map(v => v.voice)) !== JSON.stringify(p.voices)) throw new Error('真实声线回执身份不符')
    if (selected.engine === 'qwen') assertQwenResourceAdmission(result, p)
    for (const voice of result.voices) {
      const pcm = verifyNativeFixturePcm(readFileSync(path.join(directory, voice.voice + '.wav')), voice.audioSha256, p)
      if (selected.engine === 'qwen') assertQwenCodecClock(voice, pcm, p)
      receipt.voices.push({ voice: voice.voice, ...pcm })
    }
    if (hash(readFileSync(path.join(base, selected.profileFile))) !== receipt.profileSha256 || hash(readFileSync(path.join(base, selected.workerFile))) !== receipt.workerSha256) throw new Error('评测源码变化')
    receipt.status = 'passed'; receipt.humanListeningAcceptance = 'unproven'
  } catch (error) { receipt.status = 'failed'; receipt.error = String(error); throw error }
  finally {
    receipt.finishedAt = Date.now(); save()
    for (const { lock, claim } of acquired.reverse()) if (existsSync(lock) && readFileSync(lock, 'utf8') === claim) unlinkSync(lock)
  }
  console.log(JSON.stringify({ status: receipt.status, directory, voices: receipt.voices.length, humanListeningAcceptance: 'unproven' }))
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error('ttrpg-native-fixture:', error.message); process.exitCode = 1 })
