import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const matrixPath = resolve(repositoryRoot, 'tests/acceptance/text-open-world-g7-human-playtest.json')
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'))

if (matrix.schema !== 'storyforge.text-open-world.g7-human-playtest-matrix' || matrix.version !== 1) {
  throw new Error('文字开放世界G7真人试玩矩阵Schema或版本无效')
}
if (matrix.profileStatus !== 'implementation-ready-awaiting-human-evidence'
  || typeof matrix.profileNote !== 'string'
  || !matrix.profileNote.includes('不得由自动化')) {
  throw new Error('真人试玩矩阵必须明确工程完成不等于真人证据完成')
}
const requirements = matrix.requirements
if (requirements?.minimumDistinctEndings !== 2 || requirements.maximumRoutes !== 6
  || requirements.assessmentCriteria !== 10 || requirements.minimumFreeInputResponses !== 1
  || requirements.minimumPassingRating !== 3) {
  throw new Error('文字开放世界G7真人试玩验收阈值漂移')
}
if (!Array.isArray(matrix.gates) || matrix.gates.length !== 10) {
  throw new Error(`文字开放世界G7真人试玩矩阵必须精确包含10项，当前为${matrix.gates?.length ?? 0}项`)
}
const sources = new Map()
for (let index = 0; index < matrix.gates.length; index += 1) {
  const gate = matrix.gates[index]
  const expectedId = `TOW-G7-H${String(index + 1).padStart(2, '0')}`
  if (gate.id !== expectedId) throw new Error(`文字开放世界G7真人试玩门ID顺序无效:${gate.id}`)
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
  "'text-open-world.creator.full-playtest'",
  "'personallyPlayedAllRoutes'",
  "'noAutomationOrModelProxy'",
  "'freeInputActuallyTested'",
  "'allObservedProblemsReported'",
  "'repair-required'",
]) {
  if (!contract.includes(evidence)) throw new Error(`真人试玩合同缺少证据:${evidence}`)
}

console.log(`Text Open World G7 human playtest harness OK: ${matrix.gates.length} gates; actual human evidence remains author-triggered`)
