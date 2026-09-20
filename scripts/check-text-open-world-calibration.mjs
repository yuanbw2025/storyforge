import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const matrixPath = resolve(repositoryRoot, 'tests/acceptance/text-open-world-g7-calibration.json')
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'))

if (matrix.schema !== 'storyforge.text-open-world.g7-calibration-matrix' || matrix.version !== 1) {
  throw new Error('文字开放世界G7校准矩阵Schema或版本无效')
}
if (matrix.profileStatus !== 'implementation-ready-awaiting-real-provider-evidence'
  || typeof matrix.profileNote !== 'string'
  || !matrix.profileNote.includes('不得冒充真实外部模型')) {
  throw new Error('校准矩阵必须明确自动测试不能冒充真实模型质量证据')
}
const thresholds = matrix.thresholds
if (thresholds?.minimumNarrativeScore !== 70 || thresholds.variantsPerTemplate !== 3
  || thresholds.maximumPairSimilarityBasisPoints !== 8500
  || thresholds.mainlineMinutes?.minimum !== 90 || thresholds.mainlineMinutes?.maximum !== 120
  || thresholds.optionalInventoryMinutes?.minimum !== 180 || thresholds.optionalInventoryMinutes?.maximum !== 300) {
  throw new Error('文字开放世界G7校准阈值漂移')
}
if (!Array.isArray(matrix.gates) || matrix.gates.length !== 9) {
  throw new Error(`文字开放世界G7校准矩阵必须精确包含9项，当前为${matrix.gates?.length ?? 0}项`)
}
const sources = new Map()
for (let index = 0; index < matrix.gates.length; index += 1) {
  const gate = matrix.gates[index]
  const expectedId = `TOW-G7-C0${index + 1}`
  if (gate.id !== expectedId) throw new Error(`文字开放世界G7校准门ID顺序无效:${gate.id}`)
  if (typeof gate.title !== 'string' || gate.title.trim().length < 18) throw new Error(`${gate.id}缺少可读标题`)
  let source = sources.get(gate.evidenceFile)
  if (source == null) {
    source = await readFile(resolve(repositoryRoot, gate.evidenceFile), 'utf8')
    sources.set(gate.evidenceFile, source)
  }
  if (!source.includes(gate.testName)) throw new Error(`${gate.id}证据已漂移:${gate.testName}`)
}
const registry = await readFile(resolve(repositoryRoot, 'src/lib/agent/ai-entry-registry.json'), 'utf8')
for (const evidence of [
  'eval.text-open-world.release-calibration-grader',
  'text-open-world-release-calibration-v1',
  '"executionBoundary": "eval-only"',
  '"adoptAllowed": false',
]) {
  if (!registry.includes(evidence)) throw new Error(`独立校准AI入口缺少治理证据:${evidence}`)
}
const quality = sources.get('src/lib/open-world/creator-quality.ts') ?? ''
for (const evidence of [
  'plausibleRealProviderIdentity',
  "verifierKind: 'provider-review'",
  'priceQuoteHash',
  'ledgerHash',
  '必须先通过当前Build的独立叙事、重复度、时长与成本校准',
]) {
  if (!quality.includes(evidence)) throw new Error(`校准回执缺少发布边界:${evidence}`)
}

console.log(`Text Open World G7 calibration harness OK: ${matrix.gates.length} gates; real provider evidence remains author-triggered`)
