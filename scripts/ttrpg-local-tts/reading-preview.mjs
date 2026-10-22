// Bounded CPU text preview only. This does not share the fixed-fixture model
// transport, reserve a request, import media or grant product invocation.
import { readFileSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const base = path.dirname(fileURLToPath(import.meta.url))
const profilePath = path.join(base, 'reading-profile.json')
const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const hash = value => createHash('sha256').update(value).digest('hex')
const exact = (row, keys) => row && typeof row === 'object' && !Array.isArray(row)
  && Object.keys(row).sort().join(',') === [...keys].sort().join(',')
export const readingProfileHash = hash(JSON.stringify(canonical(profile)))

export function parseReadingArgs(args) {
  if (args.length !== 2 || args[0] !== '--runtime-dir' || !args[1] || args[1].startsWith('--')) throw new Error('仅允许明确的本机运行库路径；原文从有界标准输入读取')
  return { runtimeDir: path.resolve(args[1]) }
}

export function validateReadingInput(value) {
  if (!exact(value, ['schema', 'version', 'text', 'overrides']) || value.schema !== 'storyforge.ttrpg-local-tts-reading-input'
    || value.version !== 1 || typeof value.text !== 'string' || !value.text.trim() || value.text.length > profile.maxSourceUtf16
    || !Array.isArray(value.overrides) || value.overrides.length > profile.maxOverrides) throw new Error('朗读预览输入格式或原文预算无效')
  const text = value.text
  const boundary = offset => !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]))
  let cursor = 0, reading = ''
  for (const row of value.overrides) {
    if (!exact(row, ['textOffset', 'textLength', 'spokenText']) || !Number.isSafeInteger(row.textOffset) || !Number.isSafeInteger(row.textLength)
      || row.textOffset < cursor || row.textLength < 1 || row.textOffset + row.textLength > text.length
      || !boundary(row.textOffset) || !boundary(row.textOffset + row.textLength)
      || typeof row.spokenText !== 'string' || !row.spokenText.trim() || row.spokenText.length > profile.maxReadingUtf16) throw new Error('读法选择须指向有序、不重叠且完整的原文字符范围')
    reading += text.slice(cursor, row.textOffset) + row.spokenText; cursor = row.textOffset + row.textLength
  }
  reading += text.slice(cursor)
  if (reading.length > profile.maxReadingUtf16 || /[\uD800-\uDFFF]/u.test(text) || /[\uD800-\uDFFF]/u.test(reading)) throw new Error('朗读文字超出预算或包含无效 UTF-16')
  return reading
}

export function verifyReadingPreview(result, input) {
  const reading = validateReadingInput(input)
  if (!exact(result, ['schema', 'version', 'profileHash', 'normalizerSha256', 'status', 'sourceText', 'sourceTextSha256', 'overrides',
    'readingText', 'normalizedText', 'normalizedTextSha256', 'issues', 'issueCount', 'issueOffsetsReferTo', 'modelCalled', 'generationAllowed', 'adoptionAllowed', 'network'])
    || result.schema !== 'storyforge.ttrpg-local-tts-reading-preview' || result.version !== 1
    || result.profileHash !== readingProfileHash || result.normalizerSha256 !== profile.normalizerSha256
    || result.sourceText !== input.text || result.sourceTextSha256 !== hash(input.text)
    || JSON.stringify(canonical(result.overrides)) !== JSON.stringify(canonical(input.overrides)) || result.readingText !== reading
    || result.modelCalled !== false || result.generationAllowed !== false || result.adoptionAllowed !== false || result.network !== 'disabled'
    || result.issueOffsetsReferTo !== 'readingText-utf16' || !Array.isArray(result.issues) || result.issues.length > profile.maxReportedIssues
    || !Number.isSafeInteger(result.issueCount) || result.issueCount < result.issues.length || result.issueCount > profile.maxReadingUtf16 * 3
    || result.issues.length !== Math.min(result.issueCount, profile.maxReportedIssues)) throw new Error('本机朗读预览与原文、读法或有限权限不一致')
  for (const row of result.issues) {
    if (!exact(row, ['code', 'textOffset', 'textLength']) || !['unsupported-script', 'unsupported-character', 'ambiguous-number'].includes(row.code)
      || !Number.isSafeInteger(row.textOffset) || !Number.isSafeInteger(row.textLength) || row.textOffset < 0 || row.textLength < 1
      || row.textOffset + row.textLength > reading.length) throw new Error('朗读问题位置无效')
  }
  if (result.status === 'needs-reading-choice') {
    if (!result.issues.length || result.normalizedText !== null || result.normalizedTextSha256 !== null) throw new Error('未解决读法不能冒充可朗读结果')
  } else if (result.status !== 'ready-for-reading-review' || result.issues.length || typeof result.normalizedText !== 'string'
    || !result.normalizedText.trim() || result.normalizedText.length > profile.maxReadingUtf16
    || result.normalizedTextSha256 !== hash(result.normalizedText)) throw new Error('归一朗读文字或准确哈希无效')
  return result
}

export async function previewLocalReading(runtimeDir, input, { signal } = {}) {
  validateReadingInput(input)
  if (signal?.aborted) throw new Error('文字预览已取消，未启动子进程')
  if (profile.modelInvocationAllowed !== false || profile.adoptionAllowed !== false) throw new Error('文字预览没有模型执行权')
  const runtime = realpathSync(runtimeDir)
  const watched = [profilePath, path.join(base, 'reading_frontend.py'), fileURLToPath(import.meta.url)]
  const before = watched.map(file => hash(readFileSync(file)))
  const child = spawn(path.join(runtime, 'venv/bin/python3'), ['-I', path.join(base, 'reading_frontend.py'), '--runtime-dir', runtime], {
    cwd: runtime, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8',
      PYTHONNOUSERSITE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' },
  })
  const outputs = { stdout: [], stderr: [] }
  let bytes = 0, stopped = false, killTimer
  const stop = () => {
    if (stopped) return
    stopped = true; child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 1000); killTimer.unref()
  }
  for (const name of ['stdout', 'stderr']) child[name].on('data', data => {
    const remaining = profile.maxPayloadBytes - bytes
    if (remaining > 0) outputs[name].push(data.subarray(0, remaining))
    bytes += data.length; if (bytes > profile.maxPayloadBytes) stop()
  })
  const timeout = setTimeout(stop, profile.timeoutMs)
  signal?.addEventListener('abort', stop, { once: true })
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  child.stdin.on('error', () => {})
  child.stdin.end(JSON.stringify(input))
  let terminal
  try {
    terminal = await new Promise(resolve => { child.once('error', () => resolve({ error: true })); child.once('close', (code, signal) => resolve({ code, signal })) })
  } finally {
    clearTimeout(timeout); clearTimeout(killTimer); signal?.removeEventListener('abort', stop)
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop)
  }
  if (stopped || terminal.error || terminal.code !== 0 || watched.some((file, i) => hash(readFileSync(file)) !== before[i])) throw new Error('本机文字预览未完成或源码变化；未调用语音模型，请检查固定运行库')
  return verifyReadingPreview(JSON.parse(Buffer.concat(outputs.stdout).toString('utf8')), input)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseReadingArgs(process.argv.slice(2))
    const chunks = []; let bytes = 0
    for await (const chunk of process.stdin) {
      bytes += chunk.length; if (bytes > profile.maxPayloadBytes) throw new Error('文字预览输入超过有限边界')
      chunks.push(chunk)
    }
    console.log(JSON.stringify(await previewLocalReading(options.runtimeDir, JSON.parse(Buffer.concat(chunks).toString('utf8')))))
  } catch (error) { console.error('ttrpg-reading-preview: ' + error.message); process.exitCode = 1 }
}
