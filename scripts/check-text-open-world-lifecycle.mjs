import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

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
  || matrix.compatibilityPolicy !== 'validated-v14-v15-v16-conversion-explicit-release-migration'
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
const runtimeExportIntegrity = await readFile(resolve(repositoryRoot, 'src/lib/export/runtime-export-integrity.ts'), 'utf8')
const registryImport = await readFile(resolve(repositoryRoot, 'src/lib/export/registry-import.ts'), 'utf8')
const lifecycle = await readFile(resolve(repositoryRoot, 'src/lib/workspace/lifecycle.ts'), 'utf8')
/** @param {ts.SourceFile} source @param {string} name */
function bodyOf(source, name) {
  const declaration = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name)
  if (!declaration || !ts.isFunctionDeclaration(declaration) || !declaration.body) {
    throw new Error(`导出边界缺少实际函数:${name}`)
  }
  return declaration.body
}

/** @param {ts.Node} node @param {(node: ts.CallExpression) => boolean} matches @returns {boolean} */
function calls(node, matches) {
  if (ts.isCallExpression(node) && matches(node)) return true
  return ts.forEachChild(node, child => !ts.isFunctionLike(child) && calls(child, matches) ? true : undefined) === true
}

/** @param {ts.Node} node */
const compact = node => node.getText().replace(/\s/g, '')

/** @param {ts.Block} body @param {string} name @param {boolean} [awaited] */
function requireCall(body, name, awaited = false) {
  if (!calls(body, call => call.expression.getText() === name && (!awaited || ts.isAwaitExpression(call.parent)))) {
    throw new Error(`导出边界缺少完整性调用:${name}`)
  }
}

const exportAst = ts.createSourceFile('registry-export.ts', registryExport, ts.ScriptTarget.Latest, true)
const integrityAst = ts.createSourceFile('runtime-export-integrity.ts', runtimeExportIntegrity, ts.ScriptTarget.Latest, true)
const capture = bodyOf(exportAst, 'captureProjectExport')
const transaction = capture.statements.findIndex(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration => compact(declaration.name) === 'captured'
    && declaration.initializer && ts.isAwaitExpression(declaration.initializer)
    && calls(declaration.initializer, call => compact(call.expression) === 'db.transaction'
      && !!call.arguments[0] && ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === 'r')))
const integrityImport = capture.statements.findIndex(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration => compact(declaration.name) === '{assertProductRuntimeExportIntegrityV1}'
    && declaration.initializer && ts.isAwaitExpression(declaration.initializer)
    && ts.isCallExpression(declaration.initializer.expression)
    && declaration.initializer.expression.expression.kind === ts.SyntaxKind.ImportKeyword
    && declaration.initializer.expression.arguments.length === 1
    && ts.isStringLiteral(declaration.initializer.expression.arguments[0])
    && declaration.initializer.expression.arguments[0].text === './runtime-export-integrity'))
const verify = capture.statements.findIndex(statement => ts.isExpressionStatement(statement)
  && compact(statement.expression) === 'awaitassertProductRuntimeExportIntegrityV1(captured.integrityRows)')
const returnsCapture = capture.statements.findIndex(statement => ts.isReturnStatement(statement)
  && statement.expression && compact(statement.expression) === 'captured')
if (transaction < 0 || integrityImport <= transaction || verify <= integrityImport || returnsCapture <= verify) {
  throw new Error('导出边界必须在读取事务完成后等待验证实际快照')
}
const exportEntry = bodyOf(exportAst, 'deriveStrictExportProjectSnapshot')
requireCall(exportEntry, 'captureProjectExport', true)
if (!calls(exportEntry, call => ts.isAwaitExpression(call.parent)
    && compact(call) === 'Dexie.ignoreTransaction(()=>portableizeSnapshot(captured))')) {
  throw new Error('导出入口必须校验已捕获快照的媒资')
}
const portableize = bodyOf(exportAst, 'portableizeSnapshot')
requireCall(portableize, 'readVerifiedMediaBlobObjectData')
const verifyRuntime = bodyOf(integrityAst, 'assertProductRuntimeExportIntegrityV1')
requireCall(verifyRuntime, 'verifyProductQualityGateReceiptRecordV1', true)
requireCall(verifyRuntime, 'migrationContract.verifyTextOpenWorldSaveMigrationBranchV1', true)
requireCall(verifyRuntime, 'runtimeCore.parseProductRuntimeCheckpointV1')
for (const evidence of [
  'verifyProductQualityGateReceiptRecordV1',
  'restorePortableSharedMediaObject',
  'verifyTextOpenWorldSaveMigrationBranchV1',
  'ProductRuntimeCheckpoint Hash 不匹配',
]) {
  if (!registryImport.includes(evidence)) throw new Error(`导入边界缺少完整性证据:${evidence}`)
}
for (const evidence of ['keysReferencingField', 'return table.filter(row => row[field] === sourceId).primaryKeys()', "deleteOwnerRows('work'"]) {
  if (!lifecycle.includes(evidence)) throw new Error(`删除生命周期缺少非索引引用或Work owner证据:${evidence}`)
}

console.log(`Text Open World G7 lifecycle OK: ${matrix.gates.length} gates, backup v${matrix.backupVersion}, explicit release migration`)
