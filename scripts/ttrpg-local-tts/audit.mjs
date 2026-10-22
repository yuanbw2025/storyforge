// Public metadata only. This command does not install, generate or read projects.
import { readFileSync, statfsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const selection = JSON.parse(readFileSync(new URL('./selection.json', import.meta.url), 'utf8'))
const sha = /^[a-f0-9]{40}$/
const allowed = new Set(['myshell-ai/MeloTTS-Chinese', 'google-bert/bert-base-multilingual-uncased'])

async function readPublic(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' })
  if (!response.ok) throw new Error(`Public metadata HTTP ${response.status}: ${url}`)
  const reader = response.body.getReader()
  const chunks = []; let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 2 * 1024 * 1024) throw new Error('Public metadata exceeds 2 MiB')
      chunks.push(Buffer.from(value))
    }
  } finally { await reader.cancel() }
  return Buffer.concat(chunks)
}

async function verifyModel(component) {
  if (!allowed.has(component.repo) || !sha.test(component.revision)) throw new Error('Unreviewed model identity')
  const data = JSON.parse(await readPublic(`https://huggingface.co/api/models/${component.repo}/revision/${component.revision}?blobs=true`))
  if (data.sha !== component.revision || data.cardData?.license !== component.license) throw new Error(`Model revision/license mismatch: ${component.repo}`)
  for (const expected of component.files) {
    const actual = data.siblings?.find(file => file.rfilename === expected.path)
    if (!actual || actual.size !== expected.bytes || (actual.lfs?.sha256 ?? null) !== expected.sha256) throw new Error(`Model file metadata mismatch: ${component.repo}/${expected.path}`)
  }
  return { repo: component.repo, revision: component.revision, license: component.license, filesVerified: component.files.length }
}

try {
  if (selection.schema !== 'storyforge.ttrpg-local-tts-selection' || selection.version !== 1
    || selection.code.repo !== 'myshell-ai/MeloTTS' || !sha.test(selection.code.revision)
    || selection.code.license !== 'MIT' || selection.fullUpstreamRequirementsApproved !== false
    || selection.downloadPolicy.automaticInstall !== false || selection.downloadPolicy.modelDownloadInAudit !== false) throw new Error('Selection boundary mismatch')
  const license = await readPublic(`https://raw.githubusercontent.com/myshell-ai/MeloTTS/${selection.code.revision}/LICENSE`)
  if (createHash('sha256').update(license).digest('hex') !== selection.code.licenseSha256
    || !license.toString('utf8').includes('Permission is hereby granted, free of charge')) throw new Error('Code license mismatch')
  const components = await Promise.all([verifyModel(selection.speech), verifyModel(selection.textEncoder)])
  const disk = statfsSync(fileURLToPath(new URL('.', import.meta.url)))
  const freeBytes = disk.bavail * disk.bsize
  console.log(JSON.stringify({
    metadataAudit: 'passed', installReady: false, generationReady: false,
    codeRevision: selection.code.revision, components,
    selectedModelBytes: [selection.speech, selection.textEncoder].flatMap(row => row.files).reduce((sum, row) => sum + row.bytes, 0),
    localFreeBytes: freeBytes,
    preliminaryDiskBudgetFits: freeBytes >= selection.downloadPolicy.plannedInstallBytes + selection.downloadPolicy.minimumFreeAfterInstallBytes,
    actualInstalledBytes: null, modelBytesDownloaded: 0,
    remainingGates: selection.remainingGates,
  }, null, 2))
} catch (error) {
  console.error(`[ttrpg-local-tts-audit] ${error.message}${error.cause?.code ? ` (${error.cause.code})` : ''}`)
  process.exitCode = 1
}
