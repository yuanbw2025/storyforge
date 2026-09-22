import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const matrixPath = resolve(repositoryRoot, 'tests/acceptance/text-open-world-g7-invariants.json')
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'))

if (matrix.schema !== 'storyforge.text-open-world.g7-invariant-matrix' || matrix.version !== 1) {
  throw new Error('文字开放世界G7不变量矩阵Schema或版本无效')
}
if (!Array.isArray(matrix.invariants) || matrix.invariants.length !== 12) {
  throw new Error(`文字开放世界G7系统不变量必须精确包含12项，当前为${matrix.invariants?.length ?? 0}项`)
}

const expectedIds = Array.from({ length: 12 }, (_, index) => (
  `TOW-G7-I${String(index + 1).padStart(2, '0')}`
))
const actualIds = matrix.invariants.map(invariant => invariant.id)
if (new Set(actualIds).size !== 12 || actualIds.some((id, index) => id !== expectedIds[index])) {
  throw new Error(`文字开放世界G7不变量ID必须连续且唯一：${actualIds.join(', ')}`)
}

const allowedLayers = new Set(['unit', 'property', 'invariant', 'integration', 'fixed-seed-replay'])
const requiredLayers = new Set(allowedLayers)
const coveredLayers = new Set()
const completionIds = new Set([
  'TOW-G7-I01', 'TOW-G7-I02', 'TOW-G7-I03',
  'TOW-G7-I05', 'TOW-G7-I07', 'TOW-G7-I08', 'TOW-G7-I11',
])

for (const invariant of matrix.invariants) {
  if (typeof invariant.title !== 'string' || invariant.title.trim().length < 10) {
    throw new Error(`${invariant.id}缺少可读的不变量标题`)
  }
  if (!Array.isArray(invariant.evidence) || invariant.evidence.length === 0) {
    throw new Error(`${invariant.id}没有可执行测试证据`)
  }
  for (const evidence of invariant.evidence) {
    if (!allowedLayers.has(evidence.layer)) {
      throw new Error(`${invariant.id}使用未登记测试层:${String(evidence.layer)}`)
    }
    coveredLayers.add(evidence.layer)
    if (evidence.runner !== 'vitest') {
      throw new Error(`${invariant.id}的自动不变量证据必须由Vitest执行`)
    }
    if (typeof evidence.file !== 'string' || !evidence.file.startsWith('tests/regression/')) {
      throw new Error(`${invariant.id}的测试证据路径不在tests/regression/`)
    }
    if (typeof evidence.testName !== 'string' || evidence.testName.length < 8) {
      throw new Error(`${invariant.id}的测试证据缺少稳定名称片段`)
    }
    const source = await readFile(resolve(repositoryRoot, evidence.file), 'utf8')
    if (!source.includes(evidence.testName)) {
      throw new Error(`${invariant.id}测试证据已漂移:${evidence.file}::${evidence.testName}`)
    }
  }
  if (completionIds.has(invariant.id)
    && !invariant.evidence.some(evidence => evidence.file === 'tests/regression/R-OPEN-WORLD7-fixed-seed-invariants.test.ts')) {
    throw new Error(`${invariant.id}必须保留G7集中属性/不变量/重放证据`)
  }
}

for (const layer of requiredLayers) {
  if (!coveredLayers.has(layer)) throw new Error(`文字开放世界G7缺少${layer}测试层`)
}

const replayInvariant = matrix.invariants.find(invariant => invariant.id === 'TOW-G7-I08')
if (!replayInvariant?.evidence.some(evidence => evidence.layer === 'fixed-seed-replay')) {
  throw new Error('重放Hash不变量必须保留固定seed证据')
}

console.log(`Text Open World G7 invariants OK: ${matrix.invariants.length} invariants, ${coveredLayers.size} test layers`)
