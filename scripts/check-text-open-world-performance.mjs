import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const matrixPath = resolve(repositoryRoot, 'tests/acceptance/text-open-world-g7-performance.json')
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'))

if (matrix.schema !== 'storyforge.text-open-world.g7-performance-matrix' || matrix.version !== 1) {
  throw new Error('文字开放世界G7性能矩阵Schema或版本无效')
}
if (matrix.profileStatus !== 'local-automated-baseline'
  || typeof matrix.profileNote !== 'string'
  || !matrix.profileNote.includes('不代表未测硬件认证')) {
  throw new Error('性能矩阵必须明确当前阈值只是本机自动化回归基线')
}

const expectedWorkloads = { locations: 96, inventoryItems: 180, questInstances: 120, replayEvents: 160 }
for (const [key, value] of Object.entries(expectedWorkloads)) {
  if (matrix.workloads?.[key] !== value) throw new Error(`文字开放世界大状态规模漂移:${key}`)
}

const requiredBudgets = [
  'packageParse', 'sessionStartup', 'actionProjection', 'questProjection', 'inventoryProjection',
  'mapProjection', 'mapScreenProjection', 'replay', 'checkpointCreateAndVerify', 'projectExport', 'projectImport',
  'formalSessionOpen', 'largeMapRender', 'largeQuestLogRender', 'largeInventoryRender', 'mobileMapListRender',
]
for (const key of requiredBudgets) {
  const value = matrix.budgetsMs?.[key]
  if (!Number.isInteger(value) || value < 1 || value > 60_000) throw new Error(`性能预算无效:${key}`)
}

if (!Array.isArray(matrix.gates) || matrix.gates.length !== 9) {
  throw new Error(`文字开放世界G7性能矩阵必须精确包含9项，当前为${matrix.gates?.length ?? 0}项`)
}
const expectedIds = Array.from({ length: 9 }, (_, index) => `TOW-G7-P0${index + 1}`)
const sources = new Map()
for (let index = 0; index < matrix.gates.length; index += 1) {
  const gate = matrix.gates[index]
  if (gate.id !== expectedIds[index]) throw new Error(`文字开放世界G7性能门ID顺序无效:${gate.id}`)
  if (typeof gate.title !== 'string' || gate.title.trim().length < 16) throw new Error(`${gate.id}缺少可读标题`)
  if (typeof gate.evidenceFile !== 'string' || typeof gate.testName !== 'string') throw new Error(`${gate.id}缺少测试证据`)
  let source = sources.get(gate.evidenceFile)
  if (source == null) {
    source = await readFile(resolve(repositoryRoot, gate.evidenceFile), 'utf8')
    sources.set(gate.evidenceFile, source)
  }
  if (!source.includes(gate.testName)) throw new Error(`${gate.id}的测试名称已漂移:${gate.testName}`)
}

const regression = sources.get('tests/regression/R-OPEN-WORLD7-large-state-performance.test.ts') ?? ''
const browser = sources.get('tests/e2e/text-open-world-large-state-performance.spec.ts') ?? ''
const helper = await readFile(resolve(repositoryRoot, 'tests/helpers/text-open-world-large-state.ts'), 'utf8')
const runtime = await readFile(resolve(repositoryRoot, 'src/lib/product/runtime-core.ts'), 'utf8')
const browserBudgetKeys = new Set(['formalSessionOpen', 'largeMapRender', 'largeQuestLogRender', 'largeInventoryRender', 'mobileMapListRender'])
for (const [key, expected] of Object.entries(matrix.budgetsMs)) {
  const source = browserBudgetKeys.has(key) ? browser : regression
  const match = source.match(new RegExp(`${key}:\\s*([0-9_]+)`))
  const actual = match ? Number(match[1].replaceAll('_', '')) : null
  if (actual !== expected) throw new Error(`性能矩阵与测试预算漂移:${key}:${String(actual)}!=${expected}`)
}
for (const evidence of [
  'TEXT_OPEN_WORLD_LARGE_STATE_COUNTS_V1',
  'createLargeTextOpenWorldSessionFixtureV1',
  'projectTextOpenWorldPlayerQuestLogV1',
  'projectTextOpenWorldPlayerInventoryV1',
  'createProductRuntimeCheckpoint',
  'exportProjectJSON',
  'importProjectJSON',
]) {
  if (!`${helper}\n${regression}`.includes(evidence)) throw new Error(`大状态性能测试缺少真实入口:${evidence}`)
}
for (const evidence of [
  "setViewportSize({ width: 390, height: 844 })",
  "getByRole('list', { name: '地图列表视图' })",
  'horizontalOverflow',
  'unnamed',
  "document.activeElement !== document.body",
]) {
  if (!browser.includes(evidence)) throw new Error(`浏览器性能/无障碍测试缺少证据:${evidence}`)
}
if (!runtime.includes('reduceProductRuntimeEvent(state, event, true)')) {
  throw new Error('大状态Event重放必须使用已校验状态的线性内部归约路径')
}

console.log(`Text Open World G7 performance OK: ${matrix.gates.length} gates, ${matrix.workloads.locations} locations, ${matrix.workloads.inventoryItems} items, ${matrix.workloads.questInstances} quests, ${matrix.workloads.replayEvents} replay events`)
