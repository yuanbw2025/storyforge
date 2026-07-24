/* global console, process */

/**
 * 架构守护 lint(Phase 3.3)
 *
 * 自动执行 CLAUDE.md 的"三注册表铁律" —— 防止任何人(人/AI)重新引入反模式,
 * 让"屎山"无法复发。在 CI 中运行,违反则 fail。
 *
 * 检查项:
 *   ① stores 里不得手写 db.transaction([...大表清单...])(必须走 lifecycle 派生)
 *   ② components/hooks 里不得直接 db.xxx.add/update/delete(必须走 adopt/store)
 *   ③ components/hooks 里不得手挑 buildWorldContext/buildCharacterContext(必须走 assembleContext)
 *   ④ 消耗统计:ai.start/chat 调用应带 category meta(允许豁免列表)
 *   ⑤ PROJECT_TABLES exportable 表必须接入 JSON 导出/导入
 *   ⑥ components/hooks/pages 不得使用浏览器原生 alert/confirm/prompt
 *   ⑦ 正式 UI 不得出现"正在开发/即将推出/敬请期待"式死入口文案
 *
 * 用法:node scripts/check-architecture.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, acc = []) {
  // 累加用于匹配的相对路径必须强制 POSIX 分隔符，否则 Windows 上得到 'src\\hooks\\...'，
  // 与下方 AI_META_FORWARDERS / 字面 prefix 比较失败，导致守卫误报。
  for (const ent of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${ent.name}`
    if (ent.isDirectory()) walk(rel, acc)
    else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\./.test(ent.name)) acc.push(rel)
  }
  return acc
}

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const violations = []

function parseSource(rel) {
  return ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function visit(node, callback) {
  callback(node)
  ts.forEachChild(node, child => visit(child, callback))
}

function propertyName(node) {
  if (!node?.name) return null
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text
  return null
}

function objectProperty(object, name) {
  return object.properties.find(property =>
    ts.isPropertyAssignment(property) && propertyName(property) === name,
  )
}

function stringValue(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null
}

function stringArrayValue(node) {
  if (!node || !ts.isArrayLiteralExpression(node)) return []
  return node.elements.map(stringValue).filter(value => value != null)
}

// ── ① stores 手写事务表清单 ──
// 允许小事务(≤2 表,如 chapter 的 chapters+emotionBeatCards),禁止大表清单(≥5 表)
for (const file of walk('src/stores')) {
  const src = read(file)
  for (const m of src.matchAll(/db\.transaction\(\s*'rw'\s*,\s*\[([\s\S]*?)\]/g)) {
    const tableCount = (m[1].match(/db\.\w+/g) ?? []).length
    if (tableCount >= 5) {
      violations.push(`[①事务清单] ${file}: 手写 ${tableCount} 表的事务清单,应改用 lib/registry/lifecycle 派生 API`)
    }
  }
}

// ── ② components/hooks 直接写库 ──
const UI_DIRS = ['src/components', 'src/hooks', 'src/pages']
for (const dir of UI_DIRS) {
  for (const file of walk(dir)) {
    const src = read(file)
    for (const m of src.matchAll(/\bdb\.\w+\.(add|update|put|delete|bulkDelete|bulkPut)\(/g)) {
      // 行级:取该匹配所在行,排除注释
      const lineStart = src.lastIndexOf('\n', m.index) + 1
      const line = src.slice(lineStart, src.indexOf('\n', m.index))
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue
      violations.push(`[②直接写库] ${file}: \`${m[0]}\` —— UI 层不得直接写库,应走 adopt() 或 store action`)
    }
  }
}

// ── ③ components/hooks 手挑上下文 ──
for (const dir of UI_DIRS) {
  for (const file of walk(dir)) {
    const src = read(file)
    for (const fn of ['buildWorldContext', 'buildCharacterContext']) {
      const re = new RegExp(`\\b${fn}\\(`, 'g')
      for (const m of src.matchAll(re)) {
        const lineStart = src.lastIndexOf('\n', m.index) + 1
        const line = src.slice(lineStart, src.indexOf('\n', m.index))
        if (line.includes('import') || line.trim().startsWith('//') || line.trim().startsWith('*')) continue
        violations.push(`[③手挑上下文] ${file}: \`${fn}(\` —— 应走 assembleContext({ sourceKeys })`)
      }
    }
  }
}

// ── ④ AI 调用必须带 category meta ──
const AI_META_FORWARDERS = new Set([
  'src/hooks/useAIStream.ts',
  'src/lib/import/chat-with-abort.ts',
  'src/lib/reference-analysis/pipeline.ts',
])

function findCallRanges(src, callee) {
  const ranges = []
  const re = new RegExp(`\\b${callee.replace('.', '\\.')}\\s*\\(`, 'g')
  let m
  while ((m = re.exec(src))) {
    const prefix = src.slice(Math.max(0, m.index - 24), m.index)
    if (/\bfunction\s*$/.test(prefix) || /\bexport\s+async\s+function\s*$/.test(prefix)) continue
    let depth = 0
    let quote = null
    let escaped = false
    for (let i = m.index + callee.length; i < src.length; i++) {
      const ch = src[i]
      if (quote) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch
      } else if (ch === '(') {
        depth++
      } else if (ch === ')') {
        depth--
        if (depth === 0) {
          ranges.push({ start: m.index, end: i + 1, text: src.slice(m.index, i + 1) })
          break
        }
      }
    }
  }
  return ranges
}

for (const dir of ['src/components', 'src/hooks', 'src/lib']) {
  for (const file of walk(dir)) {
    const src = read(file)
    for (const callee of ['ai.start', 'chat', 'streamChat']) {
      for (const call of findCallRanges(src, callee)) {
        const lineStart = src.lastIndexOf('\n', call.start) + 1
        const lineEnd = src.indexOf('\n', call.start)
        const lineText = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd).trim()
        if (lineText.startsWith('//') || lineText.startsWith('*')) continue
        if (AI_META_FORWARDERS.has(file) && /\bmeta\b/.test(call.text)) continue
        if (file === 'src/lib/ai/client.ts') continue
        if (!/\bcategory\s*:/.test(call.text)) {
          const line = src.slice(0, call.start).split('\n').length
          violations.push(`[④AI分类] ${file}:${line}: \`${callee}(...)\` 缺少 category meta,消耗统计与 AI manual 会漏记`)
        }
      }
    }
  }
}

// ── ⑤ exportable 表必须接入 JSON 导出/导入 ──
// AUDIT-1 后:导出/导入主体由注册表派生(registry-export/registry-import 遍历 exportable),
// 加新表自动进出,无需逐表手写。本守卫验证:① ProjectExportData 类型契约逐表声明完整;
// ② 导出/导入确实委托给派生引擎,且派生引擎确实遍历 exportable 表(防回退到手写枚举)。
const registrySrc = read('src/lib/registry/project-tables.ts')
const jsonExportSrc = read('src/lib/export/json-export.ts')
const deriveExportSrc = read('src/lib/export/registry-export.ts')
const deriveImportSrc = read('src/lib/export/registry-import.ts')
const specChunks = registrySrc
  .split(/\n\s*\n/)
  .filter(chunk => chunk.includes('table: db.') && chunk.includes('name:'))

for (const chunk of specChunks) {
  if (!/\bexportable:\s*true\b/.test(chunk)) continue
  const name = chunk.match(/\bname:\s*'([^']+)'/)?.[1]
  if (!name || name === 'projects') continue

  // ① 类型契约:ProjectExportData 必须逐表声明(给 TS 类型安全 + Gist 等消费方)
  const interfaceRe = new RegExp(`\\n\\s*${name}\\??\\s*:`)
  if (!interfaceRe.test(jsonExportSrc)) {
    violations.push(`[⑤导出契约] src/lib/export/json-export.ts: ProjectExportData 缺少 exportable 表 \`${name}\``)
  }
}

// ② 导出/导入主体必须由注册表派生(遍历 exportable),不得回退到逐表手写枚举
const derivesExportable = /PROJECT_TABLES\.filter\(\s*s\s*=>\s*s\.exportable/
if (!derivesExportable.test(deriveExportSrc)) {
  violations.push('[⑤导出派生] registry-export.ts: deriveExportProjectJSON 未遍历 PROJECT_TABLES exportable 表')
}
if (!derivesExportable.test(deriveImportSrc)) {
  violations.push('[⑤导出派生] registry-import.ts: deriveImportProjectJSON 未遍历 PROJECT_TABLES exportable 表')
}
if (!/deriveExportProjectJSON/.test(jsonExportSrc)) {
  violations.push('[⑤导出派生] json-export.ts: exportProjectJSON 未委托派生引擎 deriveExportProjectJSON')
}
if (!/deriveImportProjectJSON/.test(jsonExportSrc)) {
  violations.push('[⑤导出派生] json-export.ts: importProjectJSON 未委托派生引擎 deriveImportProjectJSON')
}

// ── ⑥ UI 层禁止浏览器原生弹窗 ──
for (const dir of UI_DIRS) {
  for (const file of walk(dir)) {
    const src = read(file)
    const re = /(?:^|[^\w.])(?:window\.)?(alert|confirm|prompt)\s*\(/g
    for (const m of src.matchAll(re)) {
      const lineStart = src.lastIndexOf('\n', m.index) + 1
      const lineEnd = src.indexOf('\n', m.index)
      const lineText = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd).trim()
      if (lineText.startsWith('//') || lineText.startsWith('*')) continue
      const line = src.slice(0, m.index).split('\n').length
      violations.push(`[⑥原生弹窗] ${file}:${line}: UI 层不得使用 alert/confirm/prompt,应走 DialogProvider 或 ToastProvider`)
    }
  }
}

// ── ⑦ 正式 UI 禁止半成品承诺文案 ──
const WIP_TEXT_RE = /正在开发|开发中|即将推出|敬请期待|Coming soon/i
for (const dir of UI_DIRS) {
  for (const file of walk(dir)) {
    const src = read(file)
    const m = WIP_TEXT_RE.exec(src)
    if (!m) continue
    const line = src.slice(0, m.index).split('\n').length
    violations.push(`[⑦半成品文案] ${file}:${line}: 正式 UI 不得出现"${m[0]}"式死入口承诺;请隐藏入口、标记 Labs 禁用态,或指向已上线流程`)
  }
}

// ── ⑧ src/lib 的 AI/结构化写回不得绕过 adopt 或已登记领域扩展 ──
const fieldRegistryAst = parseSource('src/lib/registry/field-registry.ts')
const governedWriteTargets = new Set()
const fieldHelpers = new Set(['text', 'longtext', 'num', 'bool', 'json', 'object', 'arr', 'enumeration', 'enumField', 'field'])
visit(fieldRegistryAst, node => {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || !fieldHelpers.has(node.expression.text)) return
  const target = stringValue(node.arguments[0])
  if (target) governedWriteTargets.add(target)
})

const adoptionAst = parseSource('src/lib/registry/adoption-schema.ts')
const extensionEntrypoints = new Map()
visit(adoptionAst, node => {
  if (!ts.isObjectLiteralExpression(node)) return
  const target = stringValue(objectProperty(node, 'target')?.initializer)
  const policyRegistry = stringValue(objectProperty(node, 'policyRegistry')?.initializer)
  const reviewAfter = stringValue(objectProperty(node, 'reviewAfter')?.initializer)
  const entrypoints = stringArrayValue(objectProperty(node, 'entrypoints')?.initializer)
  if (!target || !policyRegistry || !reviewAfter || !entrypoints.length) return
  governedWriteTargets.add(target)
  for (const entrypoint of entrypoints) {
    const targets = extensionEntrypoints.get(entrypoint) ?? new Set()
    targets.add(target)
    extensionEntrypoints.set(entrypoint, targets)
  }
  if (reviewAfter < new Date().toISOString().slice(0, 10)) {
    violations.push(`[⑧扩展到期] ${target}: ADOPTION_EXTENSIONS 已到复审日期 ${reviewAfter}`)
  }
})

const writeMethods = new Set(['add', 'update', 'put', 'delete', 'bulkDelete', 'bulkPut', 'clear'])
function dbTableFromExpression(node) {
  if (ts.isPropertyAccessExpression(node)) {
    if (ts.isIdentifier(node.expression) && node.expression.text === 'db') return node.name.text
    return dbTableFromExpression(node.expression)
  }
  if (ts.isCallExpression(node)) return dbTableFromExpression(node.expression)
  return null
}

function findDbWrites(sourceFile) {
  const writes = []
  visit(sourceFile, node => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return
    const method = node.expression.name.text
    if (!writeMethods.has(method)) return
    const target = dbTableFromExpression(node.expression.expression)
    if (!target) return
    writes.push({
      target,
      method,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    })
  })
  return writes
}

for (const file of walk('src/lib')) {
  if (file === 'src/lib/registry/adopt.ts' || file.startsWith('src/lib/registry/')) continue
  const sourceFile = parseSource(file)
  for (const { target, method, line } of findDbWrites(sourceFile)) {
    if (!governedWriteTargets.has(target)) continue
    if (extensionEntrypoints.get(file)?.has(target)) continue
    violations.push(`[⑧lib写回旁路] ${file}:${line}: db.${target}.${method}(...) 必须走 adopt() 或 ADOPTION_EXTENSIONS 登记入口`)
  }
}

// ── ⑨ 旧 context builder 不得绕过 CONTEXT_SOURCES ──
const legacyContextBuilders = new Set([
  'buildWorldContext',
  'buildCharacterContext',
  'buildCodexContext',
  'buildHistoricalContext',
  'buildLocationContext',
  'buildRefAnalysisContext',
  'buildWorldRulesContext',
])
function findLegacyContextCalls(sourceFile) {
  const calls = []
  visit(sourceFile, node => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return
    if (!legacyContextBuilders.has(node.expression.text)) return
    calls.push({
      name: node.expression.text,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    })
  })
  return calls
}

for (const dir of ['src/components', 'src/hooks', 'src/pages', 'src/lib']) {
  for (const file of walk(dir)) {
    if (file === 'src/lib/registry/context-sources.ts') continue
    const sourceFile = parseSource(file)
    for (const { name, line } of findLegacyContextCalls(sourceFile)) {
      violations.push(`[⑨上下文旁路] ${file}:${line}: ${name}(...) 必须由 CONTEXT_SOURCES + assembleContext() 调用`)
    }
  }
}

// 守卫自测：防止 AST 扫描器自身退化后与被检查代码一起“假绿”。
const selfTestSource = ts.createSourceFile(
  'architecture-self-test.ts',
  "await db.references.update(1, {}); await db.referenceChunkAnalysis.where('referenceId').equals(1).delete(); buildCodexContext(1, null)",
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
)
const selfTestWrites = findDbWrites(selfTestSource).map(write => `${write.target}.${write.method}`)
if (!selfTestWrites.includes('references.update') || !selfTestWrites.includes('referenceChunkAnalysis.delete')) {
  violations.push('[⑧守卫自测] lib 写回 AST 扫描器未识别基准违规')
}
if (!findLegacyContextCalls(selfTestSource).some(call => call.name === 'buildCodexContext')) {
  violations.push('[⑨守卫自测] context builder AST 扫描器未识别基准违规')
}

// ── 报告 ──
if (violations.length) {
  console.error('[architecture] ❌ 发现反模式违规(违反 CLAUDE.md 三注册表铁律):\n')
  for (const v of violations) console.error('  ' + v)
  console.error(`\n共 ${violations.length} 处。修复方式见 /CLAUDE.md「动手前的四问」。`)
  process.exit(1)
} else {
  console.log('[architecture] ✅ ok: 无反模式违规(三注册表铁律守住)。')
}
