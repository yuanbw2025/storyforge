import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const matrixPath = resolve(repositoryRoot, 'tests/acceptance/text-open-world-g7-retirement.json')
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'))

if (matrix.schema !== 'storyforge.text-open-world.g7-retirement-matrix' || matrix.version !== 1) {
  throw new Error('文字开放世界G7旧入口下线矩阵Schema或版本无效')
}
if (matrix.policy !== 'dedicated-creator-vnext-only-with-release-compatibility'
  || typeof matrix.profileNote !== 'string'
  || !matrix.profileNote.includes('禁止新建旧包')) {
  throw new Error('旧入口下线矩阵必须冻结专属Creator和旧Release单向兼容策略')
}
if (!Array.isArray(matrix.gates) || matrix.gates.length !== 12) {
  throw new Error(`文字开放世界G7旧入口下线矩阵必须精确包含12项，当前为${matrix.gates?.length ?? 0}项`)
}

const sources = new Map()
for (let index = 0; index < matrix.gates.length; index += 1) {
  const gate = matrix.gates[index]
  const expectedId = `TOW-G7-R${String(index + 1).padStart(2, '0')}`
  if (gate.id !== expectedId) throw new Error(`文字开放世界G7旧入口下线门ID顺序无效:${gate.id}`)
  if (typeof gate.title !== 'string' || gate.title.trim().length < 18) throw new Error(`${gate.id}缺少可读标题`)
  let source = sources.get(gate.evidenceFile)
  if (source == null) {
    source = await readFile(resolve(repositoryRoot, gate.evidenceFile), 'utf8')
    sources.set(gate.evidenceFile, source)
  }
  if (!source.includes(gate.testName)) throw new Error(`${gate.id}证据已漂移:${gate.testName}`)
}

const absentPaths = [
  'src/lib/text-game/agent-contract.ts',
  'src/components/text-game/TextOpenWorldLegacyPlayer.tsx',
]
for (const path of absentPaths) {
  try {
    await access(resolve(repositoryRoot, path))
    throw new Error(`旧入口文件不得复活:${path}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('旧入口文件不得复活:')) throw error
  }
}

const compiler = await readFile(resolve(repositoryRoot, 'src/lib/product-production/product-module-compilers.ts'), 'utf8')
const adapters = await readFile(resolve(repositoryRoot, 'src/lib/product-production/product-adapters.ts'), 'utf8')
const quality = await readFile(resolve(repositoryRoot, 'src/lib/product-production/product-quality.ts'), 'utf8')
for (const forbidden of [
  'compileOpenWorldEvolutionModuleV1',
  'compileOpenWorldModulesV1',
  "parseOpenWorldContent",
  "parseOpenWorldEvolutionContent",
]) {
  if (compiler.includes(forbidden)) throw new Error(`通用模块编译器仍包含旧开放世界生产代码:${forbidden}`)
}
for (const forbidden of [
  "id: 'storyforge.product.text-open-world.v1'",
  "productType: 'text-open-world',\n    enabledCapabilities",
]) {
  if (adapters.includes(forbidden)) throw new Error(`通用Adapter仍能注册文字开放世界:${forbidden}`)
}
if (!quality.includes('必须使用专属V1/V2/QA质量链') || quality.includes('product.open-world.')) {
  throw new Error('通用产品质量门仍可把旧四模块当作现行文字开放世界验收')
}

console.log(`Text Open World G7 retirement OK: ${matrix.gates.length} gates, dedicated Creator only, legacy Release compatibility preserved`)
