import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const matrixPath = resolve(repositoryRoot, 'tests/acceptance/text-open-world-g7-player-paths.json')
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'))

if (matrix.schema !== 'storyforge.text-open-world.g7-player-path-matrix' || matrix.version !== 1) {
  throw new Error('文字开放世界G7玩家路径矩阵Schema或版本无效')
}
if (!Array.isArray(matrix.paths) || matrix.paths.length !== 17) {
  throw new Error(`文字开放世界G7玩家路径必须精确包含17项，当前为${matrix.paths?.length ?? 0}项`)
}

const expectedIds = Array.from({ length: 17 }, (_, index) => (
  `TOW-G7-P${String(index + 1).padStart(2, '0')}`
))
const actualIds = matrix.paths.map(path => path.id)
if (new Set(actualIds).size !== 17 || actualIds.some((id, index) => id !== expectedIds[index])) {
  throw new Error(`文字开放世界G7玩家路径ID必须连续且唯一：${actualIds.join(', ')}`)
}

const allowedRunners = new Set(['vitest', 'playwright'])
let playwrightEvidenceCount = 0
for (const path of matrix.paths) {
  if (typeof path.title !== 'string' || path.title.trim().length < 8) {
    throw new Error(`${path.id}缺少可读的玩家路径标题`)
  }
  if (!Array.isArray(path.evidence) || path.evidence.length === 0) {
    throw new Error(`${path.id}没有可执行测试证据`)
  }
  for (const evidence of path.evidence) {
    if (!allowedRunners.has(evidence.runner)) {
      throw new Error(`${path.id}使用未登记测试运行器:${String(evidence.runner)}`)
    }
    const expectedRoot = evidence.runner === 'playwright' ? 'tests/e2e/' : 'tests/regression/'
    if (typeof evidence.file !== 'string' || !evidence.file.startsWith(expectedRoot)) {
      throw new Error(`${path.id}的${evidence.runner}证据路径不在${expectedRoot}`)
    }
    if (typeof evidence.testName !== 'string' || evidence.testName.length < 8) {
      throw new Error(`${path.id}的测试证据缺少稳定名称片段`)
    }
    const source = await readFile(resolve(repositoryRoot, evidence.file), 'utf8')
    if (!source.includes(evidence.testName)) {
      throw new Error(`${path.id}测试证据已漂移:${evidence.file}::${evidence.testName}`)
    }
    if (evidence.runner === 'playwright') playwrightEvidenceCount += 1
  }
}

const browserRequiredIds = new Set([
  'TOW-G7-P01', 'TOW-G7-P02', 'TOW-G7-P04', 'TOW-G7-P05',
  'TOW-G7-P06', 'TOW-G7-P10', 'TOW-G7-P13', 'TOW-G7-P15',
  'TOW-G7-P16', 'TOW-G7-P17',
])
for (const path of matrix.paths.filter(candidate => browserRequiredIds.has(candidate.id))) {
  if (!path.evidence.some(evidence => evidence.runner === 'playwright')) {
    throw new Error(`${path.id}必须保留真实Chromium玩家路径证据`)
  }
}

console.log(`Text Open World G7 player paths OK: ${matrix.paths.length} paths, ${playwrightEvidenceCount} Chromium bindings`)
