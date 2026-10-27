// Fixed development fixtures only; no author input, database, adoption or playback.
import { readFileSync, mkdirSync, writeFileSync, openSync, closeSync, existsSync, unlinkSync, statSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const caller = 'scripts/ttrpg-local-tts/evaluate.mjs'
const root = new URL('../../', import.meta.url)
const registryPath = new URL('src/lib/agent/ai-entry-registry.json', root)
const fixturesPath = new URL('./eval-cases.json', import.meta.url)
const contractPath = new URL('./eval-contract.json', import.meta.url)
const json = file => JSON.parse(readFileSync(file, 'utf8'))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const exact = (object, keys) => object && typeof object === 'object' && !Array.isArray(object)
  && Object.keys(object).sort().join(',') === [...keys].sort().join(',')

export function assertVoiceTransport(entryId, actualCaller, registry = json(registryPath)) {
  const entries = registry.limitedTransports?.filter(row => row.entryId === entryId)
  const entry = entries?.[0]
  if (registry.version !== 2 || registry.bindingVersion !== 1 || registry.scope !== 'formal-ai-execution-entry'
    || entries?.length !== 1 || !exact(entry, ['entryId', 'boundary', 'adoptAllowed', 'allowedCallers', 'reason'])
    || entryId !== 'ttrpg.local-voice.eval' || actualCaller !== caller
    || entry.boundary !== 'offline-fixture-audio-eval' || entry.adoptAllowed !== false
    || !Array.isArray(entry.allowedCallers) || entry.allowedCallers.length !== 1 || entry.allowedCallers[0] !== caller
    || typeof entry.reason !== 'string' || !entry.reason.trim()) throw new Error('离线语音评测入口未登记或边界不符')
  return entry
}

export function selectEvaluationCase(caseId, fixturesBytes = readFileSync(fixturesPath), contract = json(contractPath)) {
  if (!exact(contract, ['schema', 'version', 'entryId', 'fixtureSha256', 'maxChars', 'maxAudioSeconds', 'timeoutMs'])
    || contract.schema !== 'storyforge.ttrpg-local-tts-eval-contract' || contract.version !== 2
    || contract.entryId !== 'ttrpg.local-voice.eval' || contract.maxChars !== 300
    || contract.maxAudioSeconds !== 60 || contract.timeoutMs !== 120000
    || digest(fixturesBytes) !== contract.fixtureSha256) throw new Error('离线语音评测合同或固定台词校验失败')
  const fixtures = JSON.parse(fixturesBytes)
  if (!exact(fixtures, ['schema', 'version', 'cases']) || fixtures.schema !== 'storyforge.ttrpg-local-tts-eval-cases'
    || fixtures.version !== 2 || !Array.isArray(fixtures.cases) || fixtures.cases.length !== 6
    || new Set(fixtures.cases.map(row => row.id)).size !== 6
    || fixtures.cases.some(row => !exact(row, ['id', 'text', 'expectation', 'expectedNormalizedText']) || typeof row.id !== 'string'
      || typeof row.text !== 'string' || !row.text.trim() || [...row.text].length > contract.maxChars
      || (row.expectation === 'audio' ? typeof row.expectedNormalizedText !== 'string' || !row.expectedNormalizedText
        || row.expectedNormalizedText.length > 600 : row.expectedNormalizedText !== null)
      || !['audio', 'unsupported-script'].includes(row.expectation))) throw new Error('固定评测台词格式无效')
  const selected = fixtures.cases.find(row => row.id === caseId)
  if (!selected) throw new Error('仅允许登记的固定台词，不接受作者文本')
  return { selected, contract, caseHash: digest(JSON.stringify(selected)) }
}

export function parseEvaluationArgs(args) {
  const options = { checkOnly: false, caseId: null, runtimeDir: null }
  const seen = new Set()
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (seen.has(flag) || !['--check-only', '--case', '--runtime-dir'].includes(flag)) throw new Error('评测参数无效；不接受文本、提示词或项目路径')
    seen.add(flag)
    if (flag === '--check-only') options.checkOnly = true
    else {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error('评测参数缺少值')
      if (flag === '--case') options.caseId = value
      else options.runtimeDir = path.resolve(value)
    }
  }
  if (!options.caseId) throw new Error('请明确选择固定评测台词 --case')
  return options
}

export function verifyEvaluationResult(result, selected, contract, profileHash, audio) {
  if (result.schema !== 'storyforge.ttrpg-local-tts-eval-result' || result.version !== 1
    || result.caseId !== selected.id || result.evaluationOnly !== true || result.adoptAllowed !== false) throw new Error('评测结果身份或边界不符')
  if (selected.expectation === 'unsupported-script') {
    if (!exact(result, ['schema', 'version', 'caseId', 'status', 'reasonCode', 'modelCalled', 'evaluationOnly', 'adoptAllowed'])
      || result.status !== 'expected-rejection' || result.modelCalled !== false || result.reasonCode !== 'unsupported-script' || audio) throw new Error('不支持的文本不能被静默改写或生成')
    return
  }
  if (!exact(result, ['schema', 'version', 'caseId', 'status', 'modelCalled', 'evaluationOnly', 'adoptAllowed',
    'profileHash', 'fixtureSha256', 'text', 'normalizedText', 'sampleRate', 'samples', 'durationMs',
    'peakBeforeGain', 'appliedGain', 'rms', 'audioSha256', 'wallSeconds', 'cpuSeconds', 'maxRssBytes',
    'threads', 'network', 'humanListeningAcceptance'])
    || result.status !== 'generated' || result.modelCalled !== true || result.text !== selected.text
    || result.normalizedText !== selected.expectedNormalizedText
    || result.profileHash !== profileHash || result.fixtureSha256 !== contract.fixtureSha256
    || result.network !== 'disabled' || result.threads !== 2 || result.humanListeningAcceptance !== 'unproven'
    || !Number.isSafeInteger(result.samples) || result.samples < 1 || !Number.isSafeInteger(result.sampleRate)
    || result.sampleRate < 16000 || result.sampleRate > 96000 || result.samples > result.sampleRate * contract.maxAudioSeconds
    || result.durationMs < 250 || result.durationMs !== Math.round(1000 * result.samples / result.sampleRate)
    || ![result.rms, result.peakBeforeGain, result.appliedGain, result.wallSeconds, result.cpuSeconds, result.maxRssBytes].every(Number.isFinite)
    || result.rms < .00001 || result.rms > 1 || result.peakBeforeGain <= 0 || result.appliedGain <= 0 || result.appliedGain > 1
    || result.wallSeconds < 0 || result.cpuSeconds < 0 || result.maxRssBytes <= 0
    || !audio || audio.length !== 44 + result.samples * 2 || audio.length > 12 * 1024 * 1024
    || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE'
    || audio.readUInt32LE(4) !== audio.length - 8 || audio.toString('ascii', 12, 16) !== 'fmt '
    || audio.readUInt32LE(16) !== 16 || audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1
    || audio.readUInt32LE(24) !== result.sampleRate || audio.readUInt32LE(28) !== result.sampleRate * 2
    || audio.readUInt16LE(32) !== 2 || audio.readUInt16LE(34) !== 16
    || audio.toString('ascii', 36, 40) !== 'data' || audio.readUInt32LE(40) !== result.samples * 2
    || digest(audio) !== result.audioSha256) throw new Error('实际音频、原台词或评测结果校验失败')
  let square = 0, peak = 0
  for (let offset = 44; offset < audio.length; offset += 2) {
    const sample = audio.readInt16LE(offset) / 32767
    square += sample * sample; peak = Math.max(peak, Math.abs(sample))
  }
  const actualRms = Math.sqrt(square / result.samples)
  if (actualRms < .00001 || Math.abs(actualRms - result.rms) > 2 / 32767 || peak > .99 + 1 / 32767) throw new Error('实际 PCM 音量与结果不符或发生削波')
}

async function runEvaluation(options, selected, contract, caseHash) {
  if (!options.runtimeDir) throw new Error('请指定已完成安装的 --runtime-dir')
  const runtime = options.runtimeDir
  const executionFiles = ['evaluate.mjs', 'engine.py', 'eval-contract.json', 'eval-cases.json', 'runtime-profile.json']
    .map(name => ({ name, url: new URL(`./${name}`, import.meta.url) }))
  executionFiles.push({ name: 'ai-entry-registry.json', url: registryPath })
  const sourceHashes = Object.fromEntries(executionFiles.map(row => [row.name, digest(readFileSync(row.url))]))
  assertVoiceTransport('ttrpg.local-voice.eval', 'scripts/ttrpg-local-tts/evaluate.mjs')
  const profileHash = digest(readFileSync(new URL('./runtime-profile.json', import.meta.url)))
  const owner = json(path.join(runtime, 'owner.json')), setup = json(path.join(runtime, 'setup-receipt.json'))
  if (owner.profileId !== 'melo-zh-eval-v1' || owner.profileHash !== profileHash || setup.profileHash !== profileHash
    || setup.status !== 'passed' || existsSync(path.join(runtime, '.setup.lock'))) throw new Error('本机运行库尚未按固定版本完成安装')
  const runId = `run-${randomUUID()}`, lock = path.join(runtime, '.eval.lock')
  const fd = openSync(lock, 'wx', 0o600); closeSync(fd)
  writeFileSync(lock, JSON.stringify({ runId, pid: process.pid }))
  const directory = path.join(runtime, 'evaluations', runId)
  const attempt = { schema: 'storyforge.ttrpg-local-tts-eval-attempt', version: 1, entryId: contract.entryId,
    runId, caseId: selected.id, caseHash, fixtureSha256: contract.fixtureSha256, profileHash,
    evaluationOnly: true, adoptAllowed: false, status: 'running', startedAt: Date.now(), modelCallOutcome: 'unknown',
    sourceHashes, nodeVersion: process.version }
  const save = () => writeFileSync(path.join(directory, 'attempt.json'), JSON.stringify(attempt, null, 2) + '\n')
  let allocated = false
  try {
    if (existsSync(path.join(runtime, '.setup.lock'))) throw new Error('本机安装仍持有运行库，暂不启动评测')
    mkdirSync(path.join(runtime, 'evaluations'), { recursive: true }); mkdirSync(directory)
    allocated = true
    save()
    const child = spawn(path.join(runtime, 'venv/bin/python3'), ['-I', fileURLToPath(new URL('./engine.py', import.meta.url))], {
      cwd: runtime, stdio: ['pipe', 'pipe', 'pipe'], env: {
        PATH: process.env.PATH, LANG: 'en_US.UTF-8', OMP_NUM_THREADS: '2', MKL_NUM_THREADS: '2',
        HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1',
        HF_HOME: path.join(runtime, 'cache', 'huggingface'),
        TOKENIZERS_PARALLELISM: 'false', PYTHONNOUSERSITE: '1', TMPDIR: path.join(runtime, 'cache'),
      },
    })
    attempt.childPid = child.pid; save()
    let stopped = null, killTimer, bytes = 0
    const logs = { stdout: [], stderr: [] }
    const stop = reason => {
      if (stopped) return
      stopped = reason; child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 2500)
      killTimer.unref()
    }
    for (const name of ['stdout', 'stderr']) child[name].on('data', data => {
      const remaining = 1024 * 1024 - bytes
      if (remaining > 0) logs[name].push(data.subarray(0, remaining))
      bytes += data.length
      if (bytes > 1024 * 1024) stop('output-limit')
    })
    const timeout = setTimeout(() => stop('timeout'), contract.timeoutMs)
    const cancel = () => stop('cancelled')
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel)
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ caseId: selected.id, runtimeDir: runtime, outputDir: directory }))
    let terminal
    try {
      terminal = await new Promise(resolve => {
        child.once('error', error => resolve({ error: error.code ?? 'spawn-error' }))
        child.once('close', (code, signal) => resolve({ code, signal }))
      })
    } finally {
      clearTimeout(timeout); clearTimeout(killTimer)
      process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel)
      for (const name of ['stdout', 'stderr']) writeFileSync(path.join(directory, `engine.${name}.log`), Buffer.concat(logs[name]))
    }
    attempt.process = terminal
    if (stopped || terminal.error || terminal.code !== 0) {
      attempt.status = 'stopped-result-unknown'; attempt.reason = stopped ?? terminal.error ?? 'engine-exit'
      throw new Error('本机评测未正常完成；保留原回执和输出，不自动重发')
    }
    const resultPath = path.join(directory, 'result.json')
    if (executionFiles.some(row => digest(readFileSync(row.url)) !== sourceHashes[row.name])) throw new Error('评测源码或合同已变化，原结果保留为待核查')
    if (statSync(resultPath).size > 16384) throw new Error('评测结果超出合同')
    const resultBytes = readFileSync(resultPath)
    const result = JSON.parse(resultBytes)
    const audioPath = path.join(directory, 'audio.wav')
    if (existsSync(audioPath) && statSync(audioPath).size > 12 * 1024 * 1024) throw new Error('实际音频文件超出合同')
    const audio = existsSync(audioPath) ? readFileSync(audioPath) : null
    verifyEvaluationResult(result, selected, contract, profileHash, audio)
    attempt.status = 'passed'; attempt.modelCallOutcome = result.modelCalled ? 'returned-audio' : 'not-called'
    attempt.resultSha256 = digest(resultBytes)
    attempt.finishedAt = Date.now(); save()
    console.log(JSON.stringify({ ...result, attemptDirectory: directory, ...(audio ? { audioPath } : {}) }, null, 2))
  } catch (error) {
    if (attempt.status === 'running') attempt.status = 'failed-result-validation'
    attempt.error = error.message; attempt.finishedAt = Date.now()
    if (allocated) save()
    throw error
  } finally {
    if (json(lock).runId === runId) unlinkSync(lock)
  }
}

async function main() {
  assertVoiceTransport('ttrpg.local-voice.eval', 'scripts/ttrpg-local-tts/evaluate.mjs')
  const options = parseEvaluationArgs(process.argv.slice(2))
  const { selected, contract, caseHash } = selectEvaluationCase(options.caseId)
  if (options.checkOnly) {
    console.log(JSON.stringify({ schema: 'storyforge.ttrpg-local-tts-eval-preflight', version: 1,
      entryId: contract.entryId, caseId: selected.id, caseHash, fixtureSha256: contract.fixtureSha256,
      evaluationOnly: true, adoptAllowed: false, modelCalled: false, generationReady: false }, null, 2))
    return
  }
  await runEvaluation(options, selected, contract, caseHash)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`[ttrpg-local-tts-eval] ${error.message}`); process.exitCode = 1 })
}
