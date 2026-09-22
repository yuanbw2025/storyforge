import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const matrix = JSON.parse(await readFile(
  resolve(repositoryRoot, 'tests/acceptance/text-open-world-g7-lifecycle.json'),
  'utf8',
))
const backupTrustSource = await readFile(resolve(repositoryRoot, 'src/lib/export/backup-trust.ts'), 'utf8')
const currentBackupVersionMatch = backupTrustSource.match(/CURRENT_BACKUP_VERSION\s*=\s*(\d+)/)
const currentBackupVersion = currentBackupVersionMatch ? Number(currentBackupVersionMatch[1]) : null

if (matrix.schema !== 'storyforge.text-open-world.g7-lifecycle-matrix' || matrix.version !== 1) {
  throw new Error('文字开放世界G7生命周期矩阵Schema或版本无效')
}
if (!Number.isInteger(currentBackupVersion)
  || matrix.backupVersion !== currentBackupVersion
  || matrix.compatibilityPolicy !== 'current-only-backup-explicit-release-migration'
  || typeof matrix.profileNote !== 'string'
  || !matrix.profileNote.includes('旧存档继续绑定旧Release')) {
  throw new Error('生命周期矩阵必须冻结当前备份与显式Release迁移策略')
}
if (!Array.isArray(matrix.gates) || matrix.gates.length !== 12) {
  throw new Error(`文字开放世界G7生命周期矩阵必须精确包含12项，当前为${matrix.gates?.length ?? 0}项`)
}
const sources = new Map()
for (let index = 0; index < matrix.gates.length; index += 1) {
  const gate = matrix.gates[index]
  const expectedId = `TOW-G7-L${String(index + 1).padStart(2, '0')}`
  if (gate.id !== expectedId) throw new Error(`文字开放世界G7生命周期门ID顺序无效:${gate.id}`)
  if (typeof gate.title !== 'string' || gate.title.trim().length < 18) throw new Error(`${gate.id}缺少可读标题`)
  if (typeof gate.evidenceFile !== 'string' || typeof gate.testName !== 'string') throw new Error(`${gate.id}缺少证据定位`)
  let source = sources.get(gate.evidenceFile)
  if (source == null) {
    source = await readFile(resolve(repositoryRoot, gate.evidenceFile), 'utf8')
    sources.set(gate.evidenceFile, source)
  }
  if (!source.includes(gate.testName)) throw new Error(`${gate.id}证据已漂移:${gate.testName}`)
}

const registryExport = await readFile(resolve(repositoryRoot, 'src/lib/export/registry-export.ts'), 'utf8')
const registryImport = await readFile(resolve(repositoryRoot, 'src/lib/export/registry-import.ts'), 'utf8')
const lifecycle = await readFile(resolve(repositoryRoot, 'src/lib/workspace/lifecycle.ts'), 'utf8')
for (const evidence of [
  'verifyProductQualityGateReceiptRecordV1',
  'readVerifiedMediaBlobObjectData',
  'verifyTextOpenWorldSaveMigrationBranchV1',
  'parseProductRuntimeCheckpointV1',
]) {
  if (!registryExport.includes(evidence)) throw new Error(`导出边界缺少完整性证据:${evidence}`)
}
for (const evidence of [
  'verifyProductQualityGateReceiptRecordV1',
  'restorePortableSharedMediaObject',
  'verifyTextOpenWorldSaveMigrationBranchV1',
  'ProductRuntimeCheckpoint Hash 不匹配',
]) {
  if (!registryImport.includes(evidence)) throw new Error(`导入边界缺少完整性证据:${evidence}`)
}
for (const evidence of ['rowsReferencingField', 'intentionally', "deleteOwnerRows('work'"]) {
  if (!lifecycle.includes(evidence)) throw new Error(`删除生命周期缺少非索引引用或Work owner证据:${evidence}`)
}

console.log(`Text Open World G7 lifecycle OK: ${matrix.gates.length} gates, backup v${matrix.backupVersion}, explicit release migration`)
