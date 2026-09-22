import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const matrixPath = resolve(repositoryRoot, 'tests/acceptance/text-open-world-g7-stress.json')
const testPath = resolve(repositoryRoot, 'tests/regression/R-OPEN-WORLD7-long-run-stress.test.ts')
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'))
const source = await readFile(testPath, 'utf8')

if (matrix.schema !== 'storyforge.text-open-world.g7-stress-matrix' || matrix.version !== 1) {
  throw new Error('文字开放世界G7压力矩阵Schema或版本无效')
}
if (matrix.batchCount !== 1_000 || !source.includes('const STRESS_BATCH_COUNT = 1_000')) {
  throw new Error('文字开放世界G7压力门必须保持一千批次')
}
if (!Array.isArray(matrix.gates) || matrix.gates.length !== 5) {
  throw new Error(`文字开放世界G7压力门必须精确包含5项，当前为${matrix.gates?.length ?? 0}项`)
}

const expectedIds = Array.from({ length: 5 }, (_, index) => `TOW-G7-S0${index + 1}`)
const actualIds = matrix.gates.map(gate => gate.id)
if (new Set(actualIds).size !== expectedIds.length
  || actualIds.some((id, index) => id !== expectedIds[index])) {
  throw new Error(`文字开放世界G7压力门ID必须连续且唯一:${actualIds.join(', ')}`)
}

for (const gate of matrix.gates) {
  if (typeof gate.title !== 'string' || gate.title.trim().length < 12) {
    throw new Error(`${gate.id}缺少可读的压力门标题`)
  }
  if (typeof gate.testName !== 'string' || !source.includes(gate.testName)) {
    throw new Error(`${gate.id}的测试证据已漂移:${String(gate.testName)}`)
  }
}

const requiredEvidence = [
  'maximumQuestInstances',
  'maximumRevealed',
  'assertNoCrossRegionContent',
  'protectedQuestSnapshot',
  'maximumSettlementIntervals',
  'historyLimit',
  "runDirectorStress('salt-ridge-director-stress-v1')",
]
for (const evidence of requiredEvidence) {
  if (!source.includes(evidence)) throw new Error(`文字开放世界G7压力测试缺少边界证据:${evidence}`)
}
if (/runtime-ai|complete\(|executeRegistered/.test(source)) {
  throw new Error('确定性Director压力测试不得引入模型或Agent执行入口')
}

console.log(`Text Open World G7 stress OK: ${matrix.batchCount} batches, ${matrix.gates.length} bounded gates`)
