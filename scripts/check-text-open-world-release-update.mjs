import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const matrixPath = resolve(repositoryRoot, 'tests/acceptance/text-open-world-g7-release-update.json')
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'))

if (matrix.schema !== 'storyforge.text-open-world.g7-release-update-matrix' || matrix.version !== 1) {
  throw new Error('文字开放世界G7发布更新矩阵Schema或版本无效')
}
if (matrix.profileStatus !== 'implementation-ready-awaiting-real-release-evidence'
  || typeof matrix.profileNote !== 'string'
  || !matrix.profileNote.includes('不得由自动化')) {
  throw new Error('发布更新矩阵必须明确工程完成不等于真实发布证据完成')
}
const requirements = matrix.requirements
if (requirements?.sourceOutcome !== 'repair-required' || requirements.targetOutcome !== 'accepted'
  || requirements.minimumPassingRating !== 3 || requirements.releaseLineage !== 'direct-child'
  || JSON.stringify(requirements.saveModes) !== JSON.stringify([
    'continued-on-source-release', 'explicit-migration-child',
  ])) {
  throw new Error('文字开放世界G7发布更新验收阈值漂移')
}
if (!Array.isArray(matrix.gates) || matrix.gates.length !== 10) {
  throw new Error(`文字开放世界G7发布更新矩阵必须精确包含10项，当前为${matrix.gates?.length ?? 0}项`)
}
const sources = new Map()
for (let index = 0; index < matrix.gates.length; index += 1) {
  const gate = matrix.gates[index]
  const expectedId = `TOW-G7-U${String(index + 1).padStart(2, '0')}`
  if (gate.id !== expectedId) throw new Error(`文字开放世界G7发布更新门ID顺序无效:${gate.id}`)
  if (typeof gate.title !== 'string' || gate.title.trim().length < 18) throw new Error(`${gate.id}缺少可读标题`)
  let source = sources.get(gate.evidenceFile)
  if (source == null) {
    source = await readFile(resolve(repositoryRoot, gate.evidenceFile), 'utf8')
    sources.set(gate.evidenceFile, source)
  }
  if (!source.includes(gate.testName)) throw new Error(`${gate.id}证据已漂移:${gate.testName}`)
}
const contract = sources.get('src/lib/open-world/creator-quality-contract.ts') ?? ''
for (const evidence of [
  "'text-open-world.creator.update-verification'",
  "'repairedBehaviorRetested'",
  "'oldVersionStillAvailable'",
  "'savePolicyActuallyVerified'",
  "'noAutomationOrModelProxy'",
  "'explicit-migration-child'",
]) {
  if (!contract.includes(evidence)) throw new Error(`发布更新合同缺少证据:${evidence}`)
}

console.log(`Text Open World G7 release update harness OK: ${matrix.gates.length} gates; real release evidence remains author-triggered`)
