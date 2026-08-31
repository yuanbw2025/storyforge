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
 *   ⑩ 绑定文件夹不得恢复页面进入/定时静默写盘；旧 JSON 只能显式保存
 *   ⑪ PROJECT_TABLES 的工作区记忆分类必须由同一注册表 100% 派生
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
  'src/lib/agent/formal-ai-entry.ts',
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
        if (file === 'src/lib/agent/formal-ai-entry.ts') continue
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
const registryTypesSource = read('src/lib/registry/types.ts')
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
  if (file.startsWith('src/lib/evals/')) continue
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

// ── ⑩ MEMORY-0 文件写入边界 ──
const removedFolderAutoBackup = 'src/hooks/useFolderAutoBackup.ts'
if (fs.existsSync(path.join(root, removedFolderAutoBackup))) {
  violations.push(`[⑩静默文件写入] ${removedFolderAutoBackup}: 本地文件夹不得在页面进入或定时器中自动覆盖`)
}

for (const dir of UI_DIRS) {
  for (const file of walk(dir)) {
    const src = read(file)
    if (/\bwriteProjectJSONToFolder\b/.test(src)) {
      violations.push(`[⑩旧写盘入口] ${file}: 已下线的 writeProjectJSONToFolder 不得恢复`)
    }
    if (/\bwriteProjectSnapshotToFolder\b/.test(src) && file !== 'src/components/data/DataManagementPanel.tsx') {
      violations.push(`[⑩快照旁路] ${file}: 完整 JSON 快照只能由数据管理面板的明确用户操作触发`)
    }
  }
}

const dataManagementSource = read('src/components/data/DataManagementPanel.tsx')
const snapshotWriteCalls = dataManagementSource.match(/\bwriteProjectSnapshotToFolder\s*\(/g) ?? []
if (snapshotWriteCalls.length !== 1 || !/const handleSaveToFolder[\s\S]*?writeProjectSnapshotToFolder\s*\(/.test(dataManagementSource)) {
  violations.push('[⑩快照入口] DataManagementPanel 必须且只能在 handleSaveToFolder 的明确点击路径写一次完整 JSON 快照')
}

// ── ⑪ MEMORY-10 全表记忆分类 ──
if (!/const PROJECT_TABLE_REGISTRATIONS:[\s\S]*?export const PROJECT_TABLES:[\s\S]*?PROJECT_TABLE_REGISTRATIONS\.map\(/.test(registrySrc)) {
  violations.push('[⑪记忆分类] PROJECT_TABLES 必须从唯一注册表登记派生 100% memoryClassification')
}
for (const classification of ['editable', 'evidence', 'derived-none', 'not-applicable']) {
  const quotedClassification = new RegExp(`classification:\\s*["']${classification}["']`)
  if (!quotedClassification.test(registrySrc)) {
    violations.push(`[⑪记忆分类] PROJECT_TABLES 缺少 ${classification} 明确策略`)
  }
}
if (!/memoryClassification:\s*classifyWorkspaceMemory\(spec\)/.test(registrySrc)) {
  violations.push('[⑪记忆分类] 新表可能绕过 classifyWorkspaceMemory')
}

// ── ⑫ Harness 终态必须在公共事件事务内结算为记忆 ──
const eventStoreSource = read('src/lib/agent/run/event-store.ts')
if (!/RESERVED_EVENT_TYPES[\s\S]*?'memory\.settlement\.recorded'/.test(eventStoreSource)) {
  violations.push('[⑫记忆结算权限] memory.settlement.recorded 必须是 event-store 专用保留事件')
}
if (!/const next = await appendPrivilegedAgentRunEventInTransactionV1\(snapshot, event\)[\s\S]*?const settlementEvent = parseAgentRunEventV1\([\s\S]*?return appendPrivilegedAgentRunEventInTransactionV1\(next, settlementEvent\)/.test(eventStoreSource)) {
  violations.push('[⑫记忆结算原子性] Harness 终态与 memory settlement 必须在 appendAgentRunEventV1 同一事务追加')
}
for (const file of walk('src/lib')) {
  if (file === 'src/lib/agent/run/event-store.ts') continue
  const src = read(file)
  if (/type:\s*['"]memory\.settlement\.recorded['"]/.test(src)) {
    violations.push(`[⑫记忆结算旁路] ${file}: memory settlement 只能由公共 event-store 发出`)
  }
}

// ── ⑬ 正文/大纲正式生成来源只能由 Agent Skill binding 派生 ──
const chapterEditorSource = read('src/components/editor/ChapterEditor.tsx')
const proseCopilotSource = read('src/lib/agent/prose-copilot.ts')
const outlinePanelSource = read('src/components/outline/OutlinePanel.tsx')
const detailedOutlineControllerSource = read('src/components/outline/useDetailedOutlineGenerationController.ts')
const batchDetailRunnerGovernanceSource = read('src/lib/ai/batch-detail-runner.ts')
const detailedOutlineDurableSource = read('src/lib/agent/run/detailed-outline-generation-durable.ts')
const detailedOutlineBatchDurableSource = read('src/lib/agent/run/detailed-outline-batch-durable.ts')
const proseDurableSource = read('src/lib/agent/run/prose-generation-durable.ts')
const outlineHarnessSource = read('src/lib/outline/harness.ts')
const htmlUtilsSource = read('src/lib/utils/html.ts')
if (/\bPROSE_GENERATION_SOURCE_KEYS_V1\b/.test(chapterEditorSource)) {
  violations.push('[⑬Skill来源旁路] ChapterEditor 不得拥有 PROSE_GENERATION_SOURCE_KEYS_V1；正式来源必须取 generationBinding.contextSourceKeys')
}
if (!/prepareProseGatewayAssemblyV1\s*\(/.test(chapterEditorSource)) {
  violations.push('[⑬Gateway来源派生] ChapterEditor 正文正式请求未调用 prepareProseGatewayAssemblyV1')
}
if (/sourceKeys:\s*generationBinding\.contextSourceKeys/.test(chapterEditorSource)) {
  violations.push('[⑬Gateway来源旁路] ChapterEditor 不得退回页面层 Skill 来源清单装配')
}
if (!/prepareProseGatewayAssemblyV1\s*\(/.test(proseCopilotSource)
  || /assembleContext\s*\(/.test(proseCopilotSource)) {
  violations.push('[⑬Gateway来源派生] 主 Agent prose-copilot 必须复用 prepareProseGatewayAssemblyV1，禁止保留第二套上下文装配')
}
if (/\bOUTLINE_GENERATION_SOURCE_KEYS\b/.test(outlinePanelSource)) {
  violations.push('[⑬Gateway来源旁路] OutlinePanel 不得拥有 OUTLINE_GENERATION_SOURCE_KEYS；正式来源必须由共享 Gateway 装配器派生')
}
if (!/prepareOutlineGatewayAssemblyV1\s*\(/.test(outlinePanelSource)) {
  violations.push('[⑬Gateway来源派生] OutlinePanel 大纲正式请求未调用 prepareOutlineGatewayAssemblyV1')
}
if (/resolveOutlineGenerationSourceKeysV2\s*\(/.test(outlinePanelSource)) {
  violations.push('[⑬Gateway来源旁路] OutlinePanel 不得重新使用页面层来源 resolver')
}
if (/\bDETAILED_OUTLINE_GENERATION_SOURCE_KEYS_V1\b|sourceKeys:\s*\[/.test(detailedOutlineControllerSource)) {
  violations.push('[⑬Gateway来源旁路] 细纲正式 controller 不得持有来源数组')
}
if (!/prepareDetailedOutlineGatewayAssemblyV1\s*\(/.test(detailedOutlineControllerSource)) {
  violations.push('[⑬Gateway来源派生] 细纲正式 controller 未调用共享 Detail Gateway')
}
if (/\bassembleContext\b|contextResolver\s*:|sourceKeys:\s*\[|parseEnhancedDetailResult\s*\(|\bnanoid\s*\(/.test(batchDetailRunnerGovernanceSource)) {
  violations.push('[⑬Gateway批量旁路] 批量细纲不得保留手工来源、旧解析器或无条件 sceneId 追加路径')
}
if (!/prepareDetailedOutlineGatewayAssemblyV1\s*\(/.test(batchDetailRunnerGovernanceSource)
  || !/beginDetailedOutlineBatchGatewayStepV1\s*\(/.test(batchDetailRunnerGovernanceSource)
  || !/finalizeDetailedOutlineBatchGatewayStepV1\s*\(/.test(batchDetailRunnerGovernanceSource)
  || !/executeRegisteredAIEntryV1\s*\(\s*['"]outline\.detail\.batch['"]/.test(batchDetailRunnerGovernanceSource)) {
  violations.push('[⑬Gateway批量收口] 批量细纲必须复用 shared Detail Gateway、exact V3 evidence 和正式 AI 入口')
}
if (!/PROSE_GENERATION_SOURCE_KEYS_V1[\s\S]*?resolveAgentSkillContextSourceKeysV1\s*\([\s\S]*?getAgentSkillV1\('prose\.generate'/.test(proseDurableSource)) {
  violations.push('[⑬Skill来源别名] prose 历史来源别名必须只读派生自 prose.generate Skill')
}
if (!/OUTLINE_GENERATION_SOURCE_KEYS[\s\S]*?resolveAgentSkillContextSourceKeysV1\s*\([\s\S]*?getAgentSkillV1\('outline\.compose'/.test(outlineHarnessSource)) {
  violations.push('[⑬Skill来源别名] outline 历史来源别名必须只读派生自 outline.compose Skill')
}
if (!/version:\s*2[\s\S]*?executionBindings:\s*stepBindings/.test(proseDurableSource)
  || !/buildProseGenerationRunContractV3[\s\S]*?executionBoundary:\s*'formal'/.test(proseDurableSource)) {
  violations.push('[⑬Skill运行契约] 正文正式 durable contract 必须冻结 V2 executionBindings')
}
if (!/version:\s*3[\s\S]*?executionBindings:\s*\[\{\s*stepId,\s*\.\.\.binding\s*\}\]/.test(outlineHarnessSource)) {
  violations.push('[⑬Skill运行契约] 大纲正式 durable contract 必须冻结 V2 execution binding')
}
if (!/buildDetailedOutlineGenerationRunContractV3[\s\S]*?version:\s*3[\s\S]*?executionBoundary:\s*'formal'/.test(detailedOutlineDurableSource)
  || !/buildDetailedOutlineBatchRunContractV3[\s\S]*?version:\s*3[\s\S]*?executionBoundary:\s*'formal'/.test(detailedOutlineBatchDurableSource)) {
  violations.push('[⑬Skill运行契约] 单章与批量细纲正式 durable contract 必须冻结 V2 Skill/Gateway binding')
}
const proseNormalizationCalls = chapterEditorSource.match(/\bnormalizeProseForEditorV1\s*\(/g)?.length ?? 0
if (!/export function normalizeProseForEditorV1\s*\(/.test(htmlUtilsSource)
  || proseNormalizationCalls < 3
  || !/expectedContentHash:\s*await hashChapterText\([\s\S]{0,500}normalizeProseForEditorV1\(outputText\)/.test(chapterEditorSource)
  || !/plainTextToHtml\(normalizeProseForEditorV1\(text\)\)/.test(chapterEditorSource)
  || /const\s+normalizeProse\s*=/.test(chapterEditorSource)) {
  violations.push('[⑬正文规范化单源] 候选预期哈希与编辑器采纳必须复用 lib/utils/html 的 normalizeProseForEditorV1')
}

// ── ⑭ 大纲 formal 入口必须 fail-closed，UI 不得拆开 durable adoption ──
const outlineControllerSource = read('src/components/outline/useOutlineGenerationController.ts')
const outlinePanelFormalSource = read('src/components/outline/OutlinePanel.tsx')
const outlineBatchControllerSource = read('src/components/outline/useOutlineBatchGeneration.ts')
const batchOutlineRunnerSource = read('src/lib/ai/batch-outline-runner.ts')
for (const [file, source] of [
  ['src/components/outline/useOutlineGenerationController.ts', outlineControllerSource],
  ['src/lib/ai/batch-outline-runner.ts', batchOutlineRunnerSource],
]) {
  if (/继续沿原生成路径|候选持久化失败，本次结果仍保留|正式采纳仍按原入口继续/.test(source)) {
    violations.push(`[⑭formal fail-open] ${file}: 正式 trace/candidate/adoption 失败不得 catch-and-warn 后继续`)
  }
}
if (!/traceFailureMode:\s*executionBoundary === 'formal' \? 'throw' : 'ignore'/.test(outlineControllerSource)) {
  violations.push('[⑭formal trace] 大纲 controller 未把 formal trace 失败配置为 throw')
}
if (!/traceFailureMode:\s*'throw'/.test(batchOutlineRunnerSource)) {
  violations.push('[⑭formal trace] 批量章纲 runner 未把 durable trace 失败配置为 throw')
}
for (const [file, source] of [
  ['src/components/outline/OutlinePanel.tsx', outlinePanelFormalSource],
  ['src/components/outline/useOutlineBatchGeneration.ts', outlineBatchControllerSource],
]) {
  if (/\badoptGeneratedOutline(?:Items|Summary)\b|\bbeginOutlineGenerationAdoptionV1\b|\bcommitOutlineGenerationAdoptionV1\b/.test(source)) {
    violations.push(`[⑭采纳旁路] ${file}: UI 必须调用单一 adoptOutlineGenerationCandidateV1，不得拆开 intent/业务写/终态`)
  }
}
if (!/正式大纲运行必须启用 durable Harness/.test(outlineHarnessSource)
  || !/executionBoundary === 'formal'/.test(outlineHarnessSource)) {
  violations.push('[⑭formal durable] 大纲 Harness 必须在 formal 边界拒绝 shadow-only 降级')
}

// ── ⑮ WEH-0C 正式生成必须越过保存屏障并冻结 PROJECT_TABLES 派生修订向量 ──
const pendingEditSource = read('src/lib/authoring/pending-edit-coordinator.ts')
const contentRevisionSource = read('src/lib/authoring/content-revision.ts')
const masterCopilotSource = read('src/components/agent/useMasterCopilot.ts')
const worldGroupSwitcherSource = read('src/components/world-group/WorldGroupSwitcher.tsx')
if (!pendingEditSource.includes('registerPendingDraftFlusherV1')
  || !pendingEditSource.includes('flushPendingEditsV1')
  || !pendingEditSource.includes('while (pendingWrites.size)')) {
  violations.push('[⑮保存屏障] PendingEditCoordinator 必须先冲刷 UI draft，再等待写队列静止')
}
for (const file of [
  'src/stores/_factories.ts',
  'src/stores/worldview.ts',
  'src/stores/character.ts',
  'src/stores/cultivation.ts',
  'src/stores/outline.ts',
  'src/stores/detailed-outline.ts',
  'src/stores/chapter.ts',
  'src/stores/reference.ts',
]) {
  if (!read(file).includes('coordinatePendingEditV1')) {
    violations.push(`[⑮写入登记] ${file}: 行内编辑目标 store 必须同步登记保存 Promise`)
  }
}
if (!contentRevisionSource.includes('return PROJECT_TABLES')
  || !contentRevisionSource.includes('spec.workspaceProjection')
  || !contentRevisionSource.includes('spec.worldSemantic')) {
  violations.push('[⑮修订来源] content revision 的表集合必须从 PROJECT_TABLES 元数据派生')
}
for (const [file, source] of [
  ['src/components/agent/useMasterCopilot.ts', masterCopilotSource],
  ['src/components/outline/useOutlineGenerationController.ts', outlineControllerSource],
  ['src/components/outline/useOutlineBatchGeneration.ts', outlineBatchControllerSource],
  ['src/components/outline/useDetailedOutlineGenerationController.ts', detailedOutlineControllerSource],
]) {
  if (!/flushPendingEditsV1\s*\(/.test(source)) {
    violations.push(`[⑮生成前保存] ${file}: 正式生成入口缺少 PendingEditCoordinator flush`)
  }
}
for (const [file, source] of [
  ['src/components/outline/useOutlineGenerationController.ts', outlineControllerSource],
  ['src/lib/ai/batch-outline-runner.ts', batchOutlineRunnerSource],
  ['src/components/outline/useDetailedOutlineGenerationController.ts', detailedOutlineControllerSource],
  ['src/components/editor/ChapterEditor.tsx', chapterEditorSource],
]) {
  if (!/captureWorkspaceContentRevisionV1\s*\(/.test(source)
    || !/assertWorkspaceContentRevisionFreshV1\s*\(/.test(source)) {
    violations.push(`[⑮内容冻结] ${file}: 上下文装配前后必须冻结并复核 content revision`)
  }
}
if (!/flushPendingEditsV1\s*\([\s\S]*?setActiveGroup\s*\(/.test(worldGroupSwitcherSource)) {
  violations.push('[⑮切世界保存] WorldGroupSwitcher 必须在切换作用域前完成保存屏障')
}
if (!/contentRevision:\s*input\.contentRevision/.test(outlineHarnessSource)) {
  violations.push('[⑮候选证据] 大纲 durable candidate 必须持久化 content revision')
}
if (!/contentRevision:\s*input\.contentRevision/.test(chapterEditorSource)
  || !/assertWorkspaceContentRevisionFreshV1\s*\(input\.candidate\.contentRevision/.test(proseDurableSource)) {
  violations.push('[⑮正文候选证据] 正文 durable candidate 必须冻结并在采纳前复核 content revision')
}

// ── ⑯ WEH-0D 候选必须本地响应、按候选串行并在决策前同步 ──
const candidateDraftCoordinatorSource = read('src/lib/agent/candidate-draft-coordinator.ts')
const conversationsSource = read('src/lib/agent/conversations.ts')
if (!candidateDraftCoordinatorSource.includes('queueCandidateDraftV1')
  || !candidateDraftCoordinatorSource.includes('flushCandidateDraftV1')
  || !/while \(entry\.persistedVersion < entry\.version\)/.test(candidateDraftCoordinatorSource)) {
  violations.push('[⑯候选队列] CandidateDraftCoordinator 必须按 candidate key 合并、串行并可强制 flush')
}
if (!/localCandidateDrafts\.current\.set\(eventId, draft\)[\s\S]*?setEvents\([\s\S]*?queueCandidateDraftV1\s*\(/.test(masterCopilotSource)) {
  violations.push('[⑯候选本地草稿] useMasterCopilot 必须先更新本地 draft，再登记异步候选保存')
}
if (!/flushCandidateDraftV1\(candidateDraftKey\(candidate\.event\.id\)\)[\s\S]*?readAgentEvents\(conversationId, workspaceScope\)[\s\S]*?commitMasterAgentCandidateAdoptionV1/.test(masterCopilotSource)) {
  violations.push('[⑯候选决策屏障] Master 候选必须 flush 后从 IndexedDB 重读，才可进入 durable adoption')
}
if (!masterCopilotSource.includes("window.addEventListener('beforeunload', handleBeforeUnload)")
  || !masterCopilotSource.includes("window.addEventListener('pagehide', flush)")
  || !/hasPendingCandidateDraftsV1\(prefix\)[\s\S]*?flush\(\)[\s\S]*?event\.preventDefault\(\)/.test(masterCopilotSource)) {
  violations.push('[⑯候选离开屏障] 未同步候选必须在刷新意图和页面离开时触发保护性 flush')
}
if (!/revalidateCreativeArtifact[\s\S]*?parseCreativeArtifactV1\(payload\.creativeArtifact\)/.test(conversationsSource)) {
  violations.push('[⑯候选当前载荷] 候选语义证据必须基于事务读取到的当前 payload 重算，不得使用 UI 闭包旧版本')
}

// ── ⑰ WEH-0E 正式结构化输出必须共用严格管线和唯一 repair 额度 ──
const structuredOutputSource = read('src/lib/agent/structured-output-pipeline.ts')
const teamExecutionSource = read('src/lib/agent/team-execution.ts')
const orchestratorSource = read('src/lib/agent/orchestrator.ts')
const masterDurableSource = read('src/lib/agent/run/master-durable.ts')
const failurePolicySource = read('src/lib/agent/run/failure-policy.ts')
for (const file of [
  'src/lib/agent/worldview-field-copilot.ts',
  'src/lib/agent/story-core-copilot.ts',
  'src/lib/agent/creative-rules-copilot.ts',
  'src/lib/agent/character-copilot.ts',
  'src/lib/agent/character-driven-copilot.ts',
  'src/lib/agent/character-supplement-copilot.ts',
  'src/lib/agent/character-revision-copilot.ts',
  'src/lib/agent/storyline-progress-copilot.ts',
  'src/lib/agent/detailed-outline-copilot.ts',
  'src/lib/agent/inspiration-copilot.ts',
  'src/lib/agent/outline-copilot.ts',
  'src/lib/agent/story-arc-copilot.ts',
  'src/lib/text-game/agent-contract.ts',
]) {
  const source = read(file)
  if (!source.includes('parseStructuredOutputV1')) {
    violations.push(`[⑰结构化管线] ${file}: 正式候选 parser 必须接入 StructuredOutputPipelineV1`)
  }
  if (/import\s+JSON5\s+from/.test(source)) {
    violations.push(`[⑰禁止猜测解析] ${file}: 正式结构化输出不得接受 JSON5`)
  }
}
if (!structuredOutputSource.includes('structured-output-ambiguous-root')
  || !structuredOutputSource.includes('apply-registered-field-alias')
  || !structuredOutputSource.includes('StructuredOutputRepairFailedErrorV1')) {
  violations.push('[⑰确定性修复] StructuredOutputPipeline 必须拒绝竞争根、登记 alias 并保存 repair 失败证据')
}
if ((teamExecutionSource.match(/claimCanonRetry\(retryIssues\)/g) ?? []).length !== 1
  || !teamExecutionSource.includes("purpose: 'repair'")
  || !teamExecutionSource.includes('buildStructuredOutputRepairMessagesV1')) {
  violations.push('[⑰唯一 repair] 结构/schema/target 必须共用一次 Canon retry，repair 不得重新装配完整上下文')
}
if (!orchestratorSource.includes('structuredOutputEvidence: result.structuredOutputEvidence')
  || !masterDurableSource.includes('parseStructuredOutputRunEvidenceV1')) {
  violations.push('[⑰证据生命周期] 成功或修复后的结构化证据必须随 candidate/run 持久化并严格恢复')
}
if (!masterCopilotSource.includes('error instanceof StructuredOutputRepairFailedErrorV1')
  || !masterCopilotSource.includes("errorClass: 'structured-output-repair-failed'")
  || !masterCopilotSource.includes('adoptable: false')) {
  violations.push('[⑰失败留证] 唯一 repair 失败必须保存 raw attempts 并明确不可采纳')
}
if (!failurePolicySource.includes('error instanceof StructuredOutputRepairFailedErrorV1')
  || !failurePolicySource.includes("code: 'structured_output_repair_exhausted'")
  || !/structured_output_repair_exhausted[\s\S]*?retryable:\s*false/.test(failurePolicySource)) {
  violations.push('[⑰失败重放] repair 额度耗尽后 durable Run 必须暂停，禁止按普通 protocol error 重跑整步')
}

// ── ⑱ WEH-0F 分步骤正式 Prompt 必须冻结、真渲染且禁止 UI 静默截断 ──
const promptExecutionSource = read('src/lib/agent/prompt-execution.ts')
const worldviewCopilotSource = read('src/lib/agent/worldview-field-copilot.ts')
const storyCoreCopilotSource = read('src/lib/agent/story-core-copilot.ts')
const characterCopilotSource = read('src/lib/agent/character-copilot.ts')
const worldviewControlsSource = read('src/components/worldview/WorldviewAgentControls.tsx')
const storyCorePanelSource = read('src/components/worldview/StoryCorePanel.tsx')
const characterPanelSource = read('src/components/character/CharacterPanel.tsx')
if (!promptExecutionSource.includes('renderPrompt(options.template')
  || !promptExecutionSource.includes('templateHash: await hashCanonicalValue(template)')
  || !promptExecutionSource.includes('renderedPromptHash: await hashCanonicalValue(messages)')) {
  violations.push('[⑱Prompt 冻结] PromptExecution 必须冻结模板并记录实际渲染 messages hash')
}
for (const [file, source] of [
  ['src/lib/agent/worldview-field-copilot.ts', worldviewCopilotSource],
  ['src/lib/agent/story-core-copilot.ts', storyCoreCopilotSource],
  ['src/lib/agent/character-copilot.ts', characterCopilotSource],
]) {
  if (!source.includes('renderFrozenPromptExecutionV1')
    || !source.includes('promptExecutionEvidence')) {
    violations.push(`[⑱Prompt 真接入] ${file}: 正式节点必须执行冻结模板并返回运行证据`)
  }
  if (/\.slice\(0,\s*(?:1_000|1000|360|640|240|160)\)/.test(source)) {
    violations.push(`[⑱禁止静默截断] ${file}: 作者说明、参数或 override 不得按旧固定前缀截断`)
  }
}
for (const [file, source, moduleKey] of [
  ['src/components/worldview/WorldviewAgentControls.tsx', worldviewControlsSource, 'worldview.dimension'],
  ['src/components/worldview/StoryCorePanel.tsx', storyCorePanelSource, 'story.generate'],
  ['src/components/character/CharacterPanel.tsx', characterPanelSource, 'character.generate'],
]) {
  if (!source.includes('submitTargetedRequest') || !source.includes(`moduleKey: '${moduleKey}'`)) {
    violations.push(`[⑱UI Prompt 合同] ${file}: 必须把 Prompt 参数按角色分离后提交固定 Skill`)
  }
}
if (!orchestratorSource.includes('freezeMasterAgentPlanPromptsV1')
  || !orchestratorSource.includes('promptExecution: task.promptExecution')
  || !orchestratorSource.includes('promptExecutionEvidence: prepared.promptExecutionEvidence')) {
  violations.push('[⑱计划与候选] 主计划必须冻结 Prompt，执行节点和候选必须携带同一绑定证据')
}
if (!masterDurableSource.includes('parsePromptExecutionOptionsV1')
  || !masterDurableSource.includes('parsePromptExecutionEvidenceV1')
  || !masterDurableSource.includes('parameterValuesHash: task.promptExecution.parameterValuesHash')) {
  violations.push('[⑱durable Prompt] durable 计划、Run Contract 和候选恢复必须验证 Prompt 绑定')
}

// ── ⑲ WEH-0H 正式 AI 入口必须由机器绑定与集中执行器授权 ──
const formalEntryRegistrySource = read('src/lib/agent/ai-entry-registry.json')
const formalEntrySource = read('src/lib/agent/formal-ai-entry.ts')
const useAIStreamSource = read('src/hooks/useAIStream.ts')
const formalEntryCheckSource = read('scripts/check-ai-entry-registry.mjs')
if (!/"version":\s*2/.test(formalEntryRegistrySource)
  || !/"bindingVersion":\s*1/.test(formalEntryRegistrySource)
  || /"calls":\s*\d+/.test(formalEntryRegistrySource)
  || /"status":\s*"(?:governed|auxiliary|migration)"/.test(formalEntryRegistrySource)) {
  violations.push('[⑲入口唯一事实源] AI 入口注册表不得退回文件调用次数和人工 status 说明')
}
for (const token of [
  'parseFormalAIEntryRegistryV1',
  'assertFormalAIEntryCallV1',
  'executeRegisteredAIEntryV1',
  'streamRegisteredAIEntryV1',
  'AGENT_SKILL_BY_ID',
]) {
  if (!formalEntrySource.includes(token)) violations.push(`[⑲集中执行器] formal-ai-entry.ts 缺少 ${token}`)
}
if (!useAIStreamSource.includes('meta: FormalAICallMetaV1')
  || !useAIStreamSource.includes('streamRegisteredAIEntryV1(messages, config, meta')) {
  violations.push('[⑲流式入口] useAIStream.start 必须要求 entryId 并进入集中执行器')
}
for (const token of ['memberSelfTest', 'aliasSelfTest', 'wrapperSelfTest', 'namespaceSelfTest']) {
  if (!formalEntryCheckSource.includes(token)) violations.push(`[⑲旁路守卫] AI 入口 checker 缺少 ${token}`)
}
if (!detailedOutlineDurableSource.includes('freezeFormalAIEntryBindingV1(detailedOutlineFormalEntryIdV1(input.operation))')
  || !detailedOutlineDurableSource.includes('assertFormalAIEntrySnapshotIntegrityV1(formalEntry)')
  || !detailedOutlineDurableSource.includes("binding.adoptionTargets.includes('detailedOutlines')")) {
  violations.push('[⑲Run/Manifest/候选/采纳链接] 细纲正式入口必须把 entry snapshot 冻结进 Run 并在 Manifest 开始前验证 Skill 与采纳目标')
}
for (const dir of UI_DIRS) {
  for (const file of walk(dir)) {
    const source = read(file)
    if (/from\s+['"][^'"]*lib\/ai\/client['"][\s\S]{0,160}\b(?:chat|streamChat)\b/.test(source)
      && !file.endsWith('.test.ts')) {
      violations.push(`[⑲UI 直连] ${file}: UI 不得导入底层 chat/streamChat，必须进入 FormalAIEntry 集中执行器`)
    }
  }
}

// ── ⑳ WEH-0G 证据可视化、统一错误分类与开发态故障注入 ──
const harnessEvidenceSource = read('src/lib/agent/harness-evidence.ts')
const harnessEvidencePanelSource = read('src/components/agent/HarnessEvidencePanel.tsx')
const harnessFailureSource = read('src/lib/agent/run/harness-failure.ts')
const harnessFaultSource = read('src/lib/agent/dev-fault-injection.ts')
const assembleContextSource = read('src/lib/registry/assemble-context.ts')
for (const failureClass of [
  'save', 'scope', 'context', 'budget', 'provider', 'parse',
  'schema', 'gate', 'candidate', 'stale', 'adoption', 'terminal',
]) {
  if (!harnessFailureSource.includes(`'${failureClass}'`)) {
    violations.push(`[⑳错误分类] harness-failure.ts 缺少 ${failureClass}`)
  }
}
for (const stageId of [
  'author-edits-saved', 'context-frozen', 'candidate-persisted', 'adoptable', 'terminal-verified',
]) {
  if (!harnessEvidenceSource.includes(`'${stageId}'`)) {
    violations.push(`[⑳五段证据] harness-evidence.ts 缺少 ${stageId}`)
  }
}
if (!harnessEvidencePanelSource.includes('source.originalCharacters')
  || !harnessEvidencePanelSource.includes('source.inputCharacters')
  || !harnessEvidencePanelSource.includes('source.sourceHash')
  || !harnessEvidencePanelSource.includes('terminalReceiptHash')) {
  violations.push('[⑳证据面板] 共享面板必须显示字符/token 前后数量、来源哈希和终态回执')
}
if (!assembleContextSource.includes('originalCharacters: content.length')
  || !assembleContextSource.includes('inputCharacters: item.segment.content.length')) {
  violations.push('[⑳上下文证据] assembleContext 必须从实际 reader/delivery 内容派生字符计数')
}
if (!masterDurableSource.includes('payload.contextManifestHash = contextManifestHash')
  || !masterDurableSource.includes("maybeInjectHarnessFaultV1('candidate.before-persist')")
  || !masterDurableSource.includes("maybeInjectHarnessFaultV1('candidate.after-persist')")) {
  violations.push('[⑳候选证据] durable 候选必须冻结 Context Manifest 并覆盖持久化前后故障点')
}
if (!masterCopilotSource.includes('classifyHarnessFailureV1')
  || !masterCopilotSource.includes('buildSettledHarnessLifecycleEvidenceV1')
  || !masterCopilotSource.includes('terminalReceiptHash')) {
  violations.push('[⑳产品证据] 主 Agent 必须统一分类错误并展示采纳/终态结构化证据')
}
if (!harnessFaultSource.includes('import.meta.env.DEV')
  || !harnessFaultSource.includes("import.meta.env.MODE === 'test'")
  || /localStorage|sessionStorage|\bdb\./.test(harnessFaultSource)) {
  violations.push('[⑳故障注入隔离] 故障注入必须仅 DEV/test 可用、只驻留内存且不得写库')
}
for (const dir of UI_DIRS) {
  for (const file of walk(dir)) {
    const source = read(file)
    if (source.includes('dev-fault-injection')
      || source.includes('configureHarnessFaultInjectionV1')
      || source.includes('maybeInjectHarnessFaultV1')) {
      violations.push(`[⑳生产 UI 隔离] ${file}: UI 不得导入或暴露 Harness 故障注入`)
    }
  }
}

// ── ㉑ MEMINT-0 五层记忆边界必须复用既有 ledger/settlement ──
const memoryPlaneSource = read('src/lib/memory/plane-contract.ts')
const evidencePolicySource = read('src/lib/memory/evidence-policy.ts')
const artifactRetentionSource = read('src/lib/memory/artifact-retention.ts')
const workingContextSource = read('src/lib/memory/working-context.ts')
const settlementCoreSource = read('src/lib/memory/settlement-core.ts')
const agentRunTypeSource = read('src/lib/types/agent-run.ts')
for (const plane of [
  'canon-authority',
  'derived-narrative-memory',
  'execution-evidence',
  'bounded-working-context',
  'projection-recovery',
]) {
  if (!memoryPlaneSource.includes(`'${plane}'`)) violations.push(`[㉑记忆平面] 缺少 ${plane}`)
}
if (!memoryPlaneSource.includes('REGISTRY_BY_NAME')
  || /new Map[\s\S]{0,80}(?:worldviews|chapters|characters)/.test(memoryPlaneSource)) {
  violations.push('[㉑单一表注册表] 记忆平面只能校验 PROJECT_TABLES，不得复制 Canon 表清单')
}
for (const token of ['secret-material', 'hidden-reasoning', 'FORBIDDEN_KEY']) {
  if (!evidencePolicySource.includes(token)) violations.push(`[㉑证据脱敏] evidence-policy 缺少 ${token}`)
}
if (!artifactRetentionSource.includes("mode: 'mark-and-sweep' | 'explicit-retention-prune'")
  || !artifactRetentionSource.includes("state: 'evidence-pruned'")) {
  violations.push('[㉑证据保留] exact artifact 必须具备活引用清扫和 evidence-pruned 回执')
}
for (const token of [
  'baseCheckpointHash',
  'tailFromSequence',
  'originalPacketHash',
  'replacementPacketHash',
  'rawArtifactRefs',
]) {
  if (!workingContextSource.includes(token)) violations.push(`[㉑compaction replay] working-context 缺少 ${token}`)
}
if (!agentRunTypeSource.includes("'evidence.artifact.recorded'")
  || !settlementCoreSource.includes("sourceKind: 'agent-run-artifact'")) {
  violations.push('[㉑唯一结算] exact evidence 必须从同一 Run ledger 进入现有 Memory Settlement/Index')
}

// ── ㉒ CTXG-1 Gateway 合同必须扩展 CONTEXT_SOURCES，而非新建第四注册表 ──
const registryTypeSource = read('src/lib/registry/types.ts')
const gatewayContractSource = read('src/lib/context-gateway/contracts.ts')
if (!registryTypeSource.includes('resources?: ContextResourceProviderV1')) {
  violations.push('[㉒Provider 挂载] ContextResourceProvider 必须作为 CONTEXT_SOURCES 条目扩展点')
}
for (const contract of [
  'ContextAccessPolicyV1', 'ContextResourceDescriptorV1', 'ContextResourceProviderV1',
  'ContextSourceRefV1', 'ContextSufficiencyReportV1', 'RetrievalTraceV1',
  'ContextPacketV1', 'AgentRunArtifactV1', 'ContextGatewayVersionV1',
]) {
  if (!registryTypeSource.includes(`interface ${contract}`)) violations.push(`[㉒Gateway 合同] registry/types 缺少 ${contract}`)
}
if (!gatewayContractSource.includes("from '../registry/project-tables'")
  || !gatewayContractSource.includes('REGISTRY_BY_NAME.get(ref.table)')
  || /const\s+(?:SOURCE|TABLE|OWNER)_REGISTRY/.test(gatewayContractSource)) {
  violations.push('[㉒SourceRef owner] SourceRef 表与 owner 必须从 PROJECT_TABLES 派生，不得有平行注册表')
}
for (const token of [
  'listMetadata', 'searchMetadata', 'readOriginal', 'metadata-body-leak',
  'explicit-resource-key-only', 'providerSetHash', 'sufficiencyObligationsVersion',
  'toolSchemaHash', 'normalizationVersion',
]) {
  if (!`${registryTypeSource}\n${gatewayContractSource}`.includes(token)) {
    violations.push(`[㉒Gateway 边界] Gateway 类型/实现缺少 ${token}`)
  }
}
if (!assembleContextSource.includes("from '../context-gateway/contracts'")) {
  violations.push('[㉒唯一入口] Gateway 合同必须由现有 assembleContext 边界导出')
}

// ── ㉓ CTXG-2 资源身份、纯目录与 exact artifact 物理生命周期 ──
const projectTableSource = read('src/lib/registry/project-tables.ts')
const scopeSource = read('src/lib/world-engine/scope.ts')
const resourceUidSource = read('src/lib/context-gateway/resource-uid.ts')
const resourceIdentitySource = read('src/lib/context-gateway/resource-identity.ts')
const ragLibrarySource = read('src/lib/retrieval/rag-library.ts')
const artifactStoreSource = read('src/lib/memory/artifact-store.ts')
const artifactRecordSource = read('src/lib/memory/artifact-record.ts')
const artifactRetentionStoreSource = read('src/lib/memory/artifact-retention-store.ts')
const schemaSource = read('src/lib/db/schema.ts')
if (!registryTypeSource.includes('resourceIdentity?:')
  || !projectTableSource.includes("resourceIdentity: RESOURCE_IDENTITY('worldview',")
  || !scopeSource.includes('stampResourceIdentityV1(spec, result)')) {
  violations.push('[㉓资源身份单一来源] searchable resource 必须由 PROJECT_TABLES 声明并在统一新建边界盖章')
}
if (!resourceUidSource.includes('crypto.randomUUID()')
  || /projectId|row\.id/.test(resourceUidSource.split('createPortableResourceUidV1')[1]?.split('/** Stamps')[0] ?? '')) {
  violations.push('[㉓资源身份可移植] resource UID 不得派生自 projectId 或 Dexie numeric id')
}
if (!resourceIdentitySource.includes("PROJECT_TABLES.filter(spec => spec.resourceIdentity != null)")
  || !resourceIdentitySource.includes("db.transaction('rw'")
  || !resourceIdentitySource.includes('let written = 0')) {
  violations.push('[㉓显式 backfill] 身份迁移必须从 PROJECT_TABLES 派生、全事务且返回幂等证据')
}
if (/descriptor\.table\.update\(/.test(ragLibrarySource.match(/export async function buildRagLibrary[\s\S]*?function descriptorFor/)?.[0] ?? '')
  || !ragLibrarySource.includes("'identity-missing'")) {
  violations.push('[㉓纯读取目录] buildRagLibrary 不得写库，缺 UID 必须明确诊断')
}
if (!ragLibrarySource.includes('ragPolicyRevision') || !ragLibrarySource.includes('ragPolicyHash')) {
  violations.push('[㉓策略版本] retrieval policy 必须拥有独立 revision/hash，不得冒充 Canon revision')
}
if (!schemaSource.includes("agentRunArtifacts: '++id, projectId, &[projectId+artifactKind+contentHash]")
  || !projectTableSource.includes("portableData: { kind: 'exact-run-artifact' }")) {
  violations.push('[㉓exact artifact 表] 内容寻址证据表必须登记 schema、PROJECT_TABLES 与 portable integrity')
}
for (const token of [
  'recordAgentRunArtifactV1', 'readAgentRunArtifactExactV1',
  'appendPrivilegedAgentRunEventInTransactionV1', 'sameEvidenceEvent',
]) {
  if (!artifactStoreSource.includes(token)) violations.push(`[㉓exact artifact 原子性] artifact-store 缺少 ${token}`)
}
for (const token of ['assertExactRunArtifactBodySafeV1', 'sha256Text', 'pruneReceiptHash']) {
  if (!artifactRecordSource.includes(token)) violations.push(`[㉓导入导出完整性] artifact-record 缺少 ${token}`)
}
if (!artifactRetentionStoreSource.includes('pruneUnreferencedAgentRunArtifactsInCurrentTransactionV1')
  || !artifactRetentionStoreSource.includes("'evidence-pruned'")) {
  violations.push('[㉓artifact 清理] Run 删除必须 mark-and-sweep，共享正文保留并留下 tombstone')
}

// ── ㉔ CTXG-3 Canon resource descriptor 覆盖与旧 RAG 收口 ──
const canonProviderSource = read('src/lib/context-gateway/canon-provider.ts')
const contextSourceRegistrySource = read('src/lib/registry/context-sources.ts')
const registryValidationSource = read('src/lib/registry/validate.ts')
if (!/key:\s*'ragSelection'[\s\S]*?resources:\s*CANON_RESOURCE_PROVIDER_V1/.test(contextSourceRegistrySource)) {
  violations.push('[㉔Provider 挂载] Canon Provider 必须挂在 CONTEXT_SOURCES.ragSelection.resources')
}
if (!/PROJECT_TABLES\.filter\(\(spec\):\s*spec is ResourceSpec => spec\.resourceIdentity != null\)/.test(canonProviderSource)
  || /const\s+(?:RESOURCE_TABLES|CANON_TABLES|CATALOG_TABLES)\s*=\s*\[/.test(canonProviderSource)) {
  violations.push('[㉔目录单一来源] Canon resource table 集合必须只由 PROJECT_TABLES.resourceIdentity 派生')
}
if (!canonProviderSource.includes("FIELD_BY_TARGET.get(spec.name)")
  || !projectTableSource.includes("'registered-fields'")
  || !registryValidationSource.includes("descriptorMode === 'registered-fields'")) {
  violations.push('[㉔字段单一来源] 核心字段描述符必须由 FIELD_REGISTRY 派生并接受启动校验')
}
for (const token of [
  'contentRevision', 'contentHash', 'policyRevision', 'policyHash',
  'sourceRefs', 'timeRangeForRow', 'relationsForRow', 'readOriginal',
  'nestedStoryStages', 'nestedDetailedScenes', 'worldLinkAggregate',
  'logicalFieldKeyFromResourceKeyV1', 'readCanonicalDescriptorV1',
]) {
  if (!canonProviderSource.includes(token)) violations.push(`[㉔描述符合同] Canon Provider 缺少 ${token}`)
}
for (const legacyList of ['WORLDVIEW_FIELDS', 'STORY_CORE_FIELDS', 'CHARACTER_FIELDS', 'function descriptors(']) {
  if (ragLibrarySource.includes(legacyList)) {
    violations.push(`[㉔旧 RAG 清单] rag-library.ts 不得恢复手写 ${legacyList}`)
  }
}
if (!ragLibrarySource.includes('CANON_RESOURCE_PROVIDER_V1.listMetadata')
  || !ragLibrarySource.includes('readCanonicalDescriptorV1')) {
  violations.push('[㉔旧 RAG 收口] 旧资料库 UI 必须从 Canon Provider 分页目录与定点读取派生')
}
if (/\.(?:add|put|update|delete|bulkPut|bulkDelete|clear)\s*\(/.test(canonProviderSource)) {
  violations.push('[㉔Provider 只读] Canon Provider 不得写任何数据库表')
}

// ── ㉕ CTXG-4 四个 Gateway 工具必须复用唯一 Tool Registry 与统一 Runner ──
const agentToolRegistrySource = read('src/lib/agent/tool-registry.ts')
const gatewayToolsSource = read('src/lib/agent/context-gateway-tools.ts')
const gatewaySessionSource = read('src/lib/context-gateway/tool-session.ts')
const agentRunnerSource = read('src/lib/agent/runner.ts')
const agentExecutionBindingSource = read('src/lib/agent/execution-binding.ts')
for (const toolName of [
  'list_context_catalog', 'search_context', 'read_context_resource', 'read_original_evidence',
]) {
  if (!gatewayToolsSource.includes(`name: '${toolName}'`)) {
    violations.push(`[㉕Gateway 工具] 缺少唯一 Tool Registry 定义 ${toolName}`)
  }
}
if (!agentToolRegistrySource.includes('...CONTEXT_GATEWAY_READ_TOOLS_V1')
  || !agentToolRegistrySource.includes('AGENT_TOOL_BY_NAME')
  || !agentToolRegistrySource.includes('executeAgentTool')) {
  violations.push('[㉕唯一工具入口] Gateway 工具必须并入 AGENT_READ_TOOLS/AGENT_TOOL_BY_NAME/executeAgentTool')
}
if (!agentRunnerSource.includes('await executeAgentTool(call.name, input.context, call.arguments)')
  || !agentRunnerSource.includes('maxToolCalls')
  || !agentRunnerSource.includes('maxToolResultTokens')
  || !agentRunnerSource.includes('loop_detected')) {
  violations.push('[㉕统一 Runner] Gateway 工具必须复用既有调用数、结果 token 与循环预算')
}
for (const token of [
  'normalizeContextAccessPolicyV1', 'claimContextGatewayReadCallV1',
  'assertContextGatewayTokenRequestV1', 'settleContextGatewayTokensV1',
  'issueContextSourceRefCapabilitiesV1', 'resolveContextSourceRefCapabilityV1',
]) {
  if (!`${gatewaySessionSource}\n${gatewayToolsSource}`.includes(token)) {
    violations.push(`[㉕Gateway 权限] Gateway session/tool 缺少 ${token}`)
  }
}
if (!gatewayToolsSource.includes("CONTEXT_SOURCES\n  .filter(source => source.resources != null)")
  || /const\s+GATEWAY_SOURCE_KEYS\s*=\s*\[/.test(gatewayToolsSource)) {
  violations.push('[㉕Provider 来源] Gateway 工具 source keys 必须从 CONTEXT_SOURCES.resources 派生')
}
if (!gatewayToolsSource.includes('sourceRefCount: descriptor.sourceRefs.length')
  || !gatewayToolsSource.includes('sourceRefCapabilities: issued')
  || !gatewayToolsSource.includes('sourceRefEvidence')
  || !gatewayToolsSource.includes("sourceRef: { type: 'string'")) {
  violations.push('[㉕SourceRef 能力] 目录不得暴露本地主键；原文工具只能接受 session 签发的 opaque capability')
}
if (/\bdb\./.test(gatewayToolsSource)) {
  violations.push('[㉕工具只读] Context Gateway tool adapter 不得直接访问或写数据库')
}
if (!agentExecutionBindingSource.includes("AGENT_TOOL_SCHEMA_VERSION_V1 = 'agent-read-tools-v4'")
  || !agentExecutionBindingSource.includes('verifyAgentToolSchemaBindingV1')) {
  violations.push('[㉕工具版本] 四个工具必须升级并冻结 Agent tool schema version/hash')
}

// ── ㉖ CTXG-5 选择器必须由 task kind / Policy / descriptors 纯派生 ──
const contextSelectorSource = read('src/lib/context-gateway/selector.ts')
for (const token of [
  'CONTEXT_SELECTOR_POLICIES_V1', 'AGENT_CONTEXT_TASK_KINDS', 'mandatoryResourceKeys',
  'categoryShares', 'maxOneHopResources', 'early-anchor', 'recent-change',
  'createContextSufficiencyReportV1', 'selectorHash',
]) {
  if (!contextSelectorSource.includes(token)) violations.push(`[㉖确定性选择器] selector 缺少 ${token}`)
}
if (!contextSelectorSource.includes('input.accessPolicy.selectorPolicyId')
  || !contextSelectorSource.includes('isContextResourceDiscoverableV1')
  || !contextSelectorSource.includes('input.accessPolicy.perKindMinimumTokens')) {
  violations.push('[㉖Policy 绑定] selector 必须执行 policy version、权限与 kind 配额，不得由 UI 私自决定')
}
if (!contextSelectorSource.includes("'must-read'")
  || !contextSelectorSource.includes("'pinned'")
  || !contextSelectorSource.includes("hardRequirement: entry.hard")) {
  violations.push('[㉖Mandatory/Pinned] 硬资源必须保留交付与超预算阻断证据')
}
if (/\bdb\.|from ['"]\.\.\/db\//.test(contextSelectorSource)) {
  violations.push('[㉖选择器纯函数] selector 不得读取或写入数据库，只能消费 Provider descriptors')
}
if (!assembleContextSource.includes("from '../context-gateway/selector'")) {
  violations.push('[㉖唯一入口] selector 必须由现有 assembleContext 边界统一导出')
}

// ── ㉗ CTXG-6 单次 attempt 必须绑定 V3 Manifest 与可逐字回读证据 ──
const contextManifestSource = read('src/lib/agent/run/context-manifest.ts')
const contextAttemptEvidenceSource = read('src/lib/context-gateway/attempt-evidence.ts')
const contextGatewayIndexSource = read('src/lib/context-gateway/index.ts')
const memoryEngineeringTypeSource = read('src/lib/types/memory-engineering.ts')
const eventSchemaSource = read('src/lib/agent/run/event-schema.ts')
for (const token of [
  'ContextManifestV3', 'v2ManifestHash', 'gatewayVersionHash', 'selectorHash',
  'contextPacketHash', 'retrievalTrace', 'renderedRequestArtifactHash',
  'rawResponseArtifactHash', 'packetArtifactHash', 'verifyContextManifestIntegrityV3',
]) {
  if (!`${agentRunTypeSource}\n${contextManifestSource}`.includes(token)) {
    violations.push(`[㉗Manifest V3] 缺少 ${token}`)
  }
}
for (const token of [
  'recordContextGatewayPreflightEvidenceV1', 'finalizeContextGatewayAttemptEvidenceV1',
  'verifyContextGatewayCandidateEvidenceV1', 'inspectContextGatewayManifestFreshnessV1',
  'exportContextGatewayDiagnosticV1', 'preflight-order', 'duplicate-finalize',
  'policyRevision', 'policyHash', 'sourceContentHash',
]) {
  if (!contextAttemptEvidenceSource.includes(token)) violations.push(`[㉗attempt 证据] 缺少 ${token}`)
}
for (const kind of [
  'context-manifest', 'selector-result', 'context-packet', 'source-snapshot', 'tool-result', 'rendered-request', 'raw-response',
]) {
  if (!memoryEngineeringTypeSource.includes(`'${kind}'`)
    || !eventSchemaSource.includes(`'${kind}'`)
    || !artifactRecordSource.includes(`'${kind}'`)
    || !artifactRetentionStoreSource.includes(`'${kind}'`)) {
    violations.push(`[㉗exact artifact 闭集] ${kind} 未覆盖类型、事件、完整性与 retention`)
  }
}
for (const token of [
  'verifyAgentRunCheckpointV1', 'checkpointChainHashes',
  'assertWorkingContextArtifactsAvailableV1', 'packet-artifact-unavailable',
]) {
  if (!workingContextSource.includes(token)) violations.push(`[㉗compaction 恢复] 缺少 ${token}`)
}
if (/\bdb\./.test(contextAttemptEvidenceSource)
  || /contextGateway(?:Artifacts|Manifests|Traces)\s*:/.test(schemaSource)) {
  violations.push('[㉗单一证据生命周期] Gateway attempt 必须复用 Run ledger/agentRunArtifacts，不得新建平行表')
}
if (!contextGatewayIndexSource.includes("from './attempt-evidence'")) {
  violations.push('[㉗公开入口] attempt evidence API 必须从 Context Gateway headless 边界导出')
}

// ── ㉘ CTXG-7 正式 Skill/Runner 快慢路径与 V3 采纳门 ──
const contextExecutionSource = read('src/lib/context-gateway/execution.ts')
const contextSkillPolicySource = read('src/lib/context-gateway/skill-policy.ts')
const futureBoundarySource = read('src/lib/outline/future-boundary.ts')
const agentSkillSource = read('src/lib/agent/skill-registry.ts')
const agentProtocolSource = read('src/lib/agent/protocol.ts')
const agentClientAdapterSource = read('src/lib/agent/client-adapter.ts')
const masterAdoptionSource = read('src/lib/agent/run/master-adoption.ts')
for (const token of [
  'contextGateway?: AgentSkillContextGatewayPolicyV1',
  "rollout: 'shadow' | 'required'",
  'additionalReadToolNames', 'maxPlanningSteps', 'maxPlanningModelTokens',
]) {
  if (!agentSkillSource.includes(token)) violations.push(`[㉘Skill Gateway 合同] 缺少 ${token}`)
}
if (!agentExecutionBindingSource.includes('contextGateway: skill.contextGateway')
  || !agentExecutionBindingSource.includes('assertFrozenGatewayPolicyV1')) {
  violations.push('[㉘冻结权限] Skill V2 binding 必须冻结并严格校验 Gateway policy，旧 snapshot 仍可无该字段')
}
for (const token of [
  'allowedToolNames', 'stopAfterToolBatch', '本次 Skill 未授权只读工具',
  'loop_detected', 'maxToolCalls', 'maxToolResultTokens',
]) {
  if (!agentRunnerSource.includes(token)) violations.push(`[㉘Runner 能力闭集] 缺少 ${token}`)
}
if (!agentProtocolSource.includes('formatAgentToolCatalog(allowedToolNames')
  || !agentClientAdapterSource.includes('nativeToolOptions(input.allowedToolNames)')) {
  violations.push('[㉘双 transport 权限] 文本目录和 native tool schema 必须使用同一逐运行 allowlist')
}
for (const token of [
  'executeContextGatewayV1', "'deterministic-fast'", "'bounded-additional-read'",
  "'deterministic-fallback'", 'selector.sufficiency.additionalRead === \'needed\'',
  'additionalPlanningModelCalls', 'additionalToolCalls', 'hard-sufficiency',
  'assertContextGatewayCandidateAdoptableV1', 'candidate-manifest-required',
  'verifyContextGatewayCandidateEvidenceV1', 'inspectContextGatewayManifestFreshnessV1',
]) {
  if (!contextExecutionSource.includes(token)) violations.push(`[㉘Gateway 执行主链] 缺少 ${token}`)
}
if (!contextSkillPolicySource.includes('createContextAccessPolicyFromSkillV1')
  || !contextSkillPolicySource.includes('CONTEXT_SOURCE_BY_KEY.get(sourceKey)?.resources')
  || !contextSkillPolicySource.includes('AGENT_TOOL_BY_NAME.get(name)')) {
  violations.push('[㉘三注册表权限] Gateway Policy 必须从 Skill、CONTEXT_SOURCES Provider 与 Tool Registry 共同校验')
}
if (/\bdb\.|from ['"]\.\.\/db\//.test(contextExecutionSource)
  || /contextGateway(?:Executions|Plans|Sessions)\s*:/.test(schemaSource)) {
  violations.push('[㉘无平行状态] Gateway execution 不得直接访问 DB 或新增并行执行/计划表')
}
if (!contextAttemptEvidenceSource.includes('硬证据义务未满足')) {
  violations.push('[㉘V3 fail-closed] forbidden 不能掩盖 mandatory/conflicted 硬证据失败')
}
if (!contextGatewayIndexSource.includes("from './execution'")
  || !contextGatewayIndexSource.includes("from './skill-policy'")) {
  violations.push('[㉘公开入口] 快慢路径与 Skill policy 必须从唯一 Context Gateway headless 边界导出')
}
for (const token of [
  'masterCandidateGatewayScopeAxesV1', 'chapterId:', 'characterId:',
]) {
  if (!masterAdoptionSource.includes(token)) {
    violations.push(`[㉘采纳作用域复原] 主采纳入口缺少 ${token}`)
  }
}
if (!futureBoundarySource.includes('normalizeChapterText(chapter.content)')
  || futureBoundarySource.includes('chapter.content.trim().length > 0')) {
  violations.push('[㉘未来保护边界] 必须按规范正文文本判定已写状态，不得把空 HTML 占位误判为正文')
}

// ── ㉙ CTXG-8 Provider 缓存必须可丢弃、实时失效且 derived retrieval 不得升权 ──
const contextProviderCacheSource = read('src/lib/context-gateway/provider-cache.ts')
const narrativeRetrievalSource = read('src/lib/context-gateway/narrative-retrieval.ts')
for (const token of [
  'createCachedContextResourceProviderV1', 'Dexie.on.storagemutated.subscribe',
  'providerVersion', 'normalizationVersion', 'contentHash', 'policyHash',
  'markContextGatewayCacheUncertainV1', 'invalidateContextGatewayCacheV1',
  'contextGatewayCacheEpochV1', 'startedEpoch !== cacheEpoch', 'return input.load()',
]) {
  if (!contextProviderCacheSource.includes(token)) violations.push(`[㉙缓存失效] Provider cache 缺少 ${token}`)
}
if (/\bdb\.|from ['"]\.\.\/db\//.test(contextProviderCacheSource)
  || /contextGateway(?:Cache|Catalog|Index)(?:Entries|Records)?\s*!:\s*Table/.test(schemaSource)) {
  violations.push('[㉙缓存非权威] Gateway cache 必须是可丢弃的 Provider 包装，不得直接写库或新增权威表')
}
for (const token of [
  'retrievalChunks', 'narrativeSummaryNodes', 'buildLongTermConsistencyDossierV1',
  'hashChapterText', "summary.status !== 'verified'", 'canonFallbackRecordKeys',
  'embeddingAuthoritative: false', 'narrativePlanMatchesSourceRefsV1',
]) {
  if (!narrativeRetrievalSource.includes(token)) violations.push(`[㉙长篇候选检索] 缺少 ${token}`)
}
if (!canonProviderSource.includes('UNCACHED_CANON_RESOURCE_PROVIDER_V1')
  || !canonProviderSource.includes('createCachedContextResourceProviderV1(UNCACHED_CANON_RESOURCE_PROVIDER_V1)')
  || !canonProviderSource.includes('planNarrativeRetrievalV1')
  || !canonProviderSource.includes('projected.fullContent.toLocaleLowerCase')) {
  violations.push('[㉙Provider 透明接入] Canon 必须以同合同包装缓存，并在 derived index 坏/缺时定点回 Canon body')
}
for (const token of [
  'MAX_RESOURCE_LOCATORS_V1', 'RESOURCE_LOCATORS_V1', 'locatorCacheKeyV1',
  'rememberResourceLocatorV1', 'scopeFingerprint', 'await visibleInScope',
]) {
  if (!canonProviderSource.includes(token)) violations.push(`[㉙Provider 定位器] 缺少 ${token}`)
}
if (!contextGatewayIndexSource.includes("from './provider-cache'")
  || !contextGatewayIndexSource.includes("from './narrative-retrieval'")) {
  violations.push('[㉙公开入口] 缓存诊断与长篇候选规划必须从唯一 Context Gateway headless 边界导出')
}

// ── ㉚ GATE-P1A shadow read 只能观察，不得形成第二条生产/写入路径 ──
const contextShadowReadSource = read('src/lib/context-gateway/shadow-read.ts')
for (const token of [
  'compareContextGatewayShadowReadV1', "rollout !== 'shadow'", 'assembleContext({',
  'executeContextGatewayV1({', 'additionalReadsEnabled: false',
  'additionalPlanningModelCalls !== 0', 'additionalToolCalls !== 0',
  'startedEpoch !== contextGatewayCacheEpochV1()', 'reportHash',
]) {
  if (!contextShadowReadSource.includes(token)) violations.push(`[㉚shadow 总门] 缺少 ${token}`)
}
if (/\bdb\.|from ['"]\.\.\/db\//.test(contextShadowReadSource)
  || /recordContextGateway|finalizeContextGateway|adopt\(|persistCandidate|createAgentRun/.test(contextShadowReadSource)) {
  violations.push('[㉚shadow 零副作用] shadow compare 不得直接访问 DB、写 Run/Artifact、持久化候选或采纳')
}
const worldviewFieldCopilotSource = read('src/lib/agent/worldview-field-copilot.ts')
const fieldRegistrySource = read('src/lib/registry/field-registry.ts')
if (!agentSkillSource.includes("id: 'world-origin.worldview-field'")
  || !/id:\s*'world-origin\.worldview-field'[\s\S]*?rollout:\s*'required'/.test(agentSkillSource)
  || !agentSkillSource.includes('requiredWriteTargets: WORLDVIEW_GENERATABLE_FIELD_SPECS.map')
  || !agentSkillSource.includes('fields: WORLDVIEW_GENERATABLE_FIELD_SPECS.map')) {
  violations.push('[㉚WE-1 required] 世界基座 Skill 必须从 generatable capability 派生 required Gateway 与写目标')
}
for (const token of [
  'WORLDVIEW_GENERATABLE_FIELD_SPECS', 'aiGeneration:', "domain: 'worldview-foundation'",
  'directDependencies:', 'outputSchemaId:', 'temporaryAssumptions:',
]) {
  if (!fieldRegistrySource.includes(token)) violations.push(`[㉚WE-1 字段能力] FIELD_REGISTRY 缺少 ${token}`)
}
if (!worldviewFieldCopilotSource.includes('WORLDVIEW_GENERATABLE_FIELD_SPECS')
  || !worldviewFieldCopilotSource.includes('WORLDVIEW_AGENT_FIELD_CAPABILITIES')
  || !worldviewFieldCopilotSource.includes('`worldview-field:${before.ragDocumentId}:field:${targetField}`')) {
  violations.push('[㉚WE-1 controller] 字段集合、合同与 mandatory target 必须从注册能力派生，不得只特判 races')
}
if (!contextGatewayIndexSource.includes("from './shadow-read'")) {
  violations.push('[㉚公开入口] shadow compare 必须从唯一 Context Gateway headless 边界导出')
}
const workspacePageSource = read('src/pages/WorkspacePage.tsx')
if (!workspacePageSource.includes('await flushPendingEditsV1()')
  || !workspacePageSource.includes('onSelect={selectModule}')
  || !workspacePageSource.includes('已阻止切换页面')) {
  violations.push('[㉚切页保存屏障] 工作区侧栏必须在卸载当前编辑器前 flush，保存失败不得继续切页')
}

// ── ㉛ PROGRESS-1 正文采纳只能经统一章后策略协调器 ──
const acceptProseStart = chapterEditorSource.indexOf('const handleAcceptAI = async')
const acceptProseEnd = chapterEditorSource.indexOf('const handleDismissAI = async', acceptProseStart)
const acceptProseBody = acceptProseStart >= 0 && acceptProseEnd > acceptProseStart
  ? chapterEditorSource.slice(acceptProseStart, acceptProseEnd)
  : ''
if (!acceptProseBody.includes('preparePostAdoptionAfterCommit({')
  || acceptProseBody.includes('handleAutoPostGenerate({')) {
  violations.push('[㉛章后策略旁路] 正文采纳必须进入 preparePostAdoptionAfterCommit，禁止直接启动模型后处理')
}
const postAdoptionCoordinatorStart = chapterEditorSource.indexOf('const preparePostAdoptionAfterCommit = async')
const postAdoptionCoordinatorEnd = chapterEditorSource.indexOf('const handleAuthorizePostAdoption = async', postAdoptionCoordinatorStart)
const postAdoptionCoordinatorBody = postAdoptionCoordinatorStart >= 0 && postAdoptionCoordinatorEnd > postAdoptionCoordinatorStart
  ? chapterEditorSource.slice(postAdoptionCoordinatorStart, postAdoptionCoordinatorEnd)
  : ''
const invalidateIndex = postAdoptionCoordinatorBody.indexOf('invalidateChapterPostAdoptionDerivativesV1({')
const policyIndex = postAdoptionCoordinatorBody.indexOf('readWorkPostAdoptionSettingsV1(scope)')
const runIndex = postAdoptionCoordinatorBody.indexOf('createChapterPostAdoptionDurableRunV1({')
if (invalidateIndex < 0 || policyIndex <= invalidateIndex || runIndex <= policyIndex
  || !postAdoptionCoordinatorBody.includes("settings.policy === 'off'")
  || !postAdoptionCoordinatorBody.includes("settings.policy === 'auto-with-budget'")) {
  violations.push('[㉛章后策略顺序] 章后协调器必须先确定性失效，再读取 Work 策略，并在 off/suggest/auto 边界后创建 Run')
}

// ── ㉜ ARCH-01/02 产品身份与纯语义世界发布边界 ──
const worldIdentitySource = read('src/lib/product/world-identity.ts')
const worldReleaseSource = read('src/lib/world-engine/releases.ts')
const worldPackageSource = read('src/lib/product/world-package.ts')
const worldPackageMigrationSource = read('src/lib/product/world-package-migration.ts')
const worldSharingPanelSource = read('src/components/product/WorldSharingPanel.tsx')
const worldDerivationSource = read('src/lib/world-engine/derivation.ts')
if (!worldIdentitySource.includes("WorkspacePurpose")
  || !worldIdentitySource.includes("world.identityKind === 'world-draft'")
  || !worldIdentitySource.includes('Number(project.worldVersion) >= 0')) {
  violations.push('[㉜身份分离] 世界草稿、独立作品与 v0 公共身份必须有显式机器判定')
}
for (const token of [
  'buildIndependentWorkWorldSnapshot', 'captureWorkspaceContentRevisionV1',
  'verifyWorkspaceContentRevisionV1', 'worldDerivations', 'cascadeDeleteProject',
]) {
  if (!worldDerivationSource.includes(token)) violations.push(`[㉜显式派生] 派生服务缺少 ${token}`)
}
if (!worldReleaseSource.includes('PROJECT_TABLES.filter(spec => spec.worldSemantic)')
  || worldReleaseSource.includes('legacyWorldPackageV1')
  || worldReleaseSource.includes('communityShare')) {
  violations.push('[㉜纯语义发布] 新 WorldRelease 必须只从 worldSemantic 派生，禁止读取任何旧分享标志')
}
if (!worldReleaseSource.includes('semanticContract: 3')
  || !worldReleaseSource.includes('selectedNarrativeModules: []')
  || !worldReleaseSource.includes('不能封存进语义 WorldRelease')) {
  violations.push('[㉜产品内容隔离] 新 WorldRelease 必须声明 semanticContract 3 并拒绝可执行叙事模块')
}
for (const token of [
  "releaseManifest.semanticContract !== 3", 'WORLD_SEMANTIC_TABLE_NAMES',
  'WORLD_PACKAGE_MAX_BYTES', 'migrationRequired', 'report.importable',
  'v1 仅供历史读取与迁移',
]) {
  if (!worldPackageSource.includes(token)) violations.push(`[㉜世界包边界] world-package 缺少 ${token}`)
}
if (worldSharingPanelSource.includes('createWorldPackage,')
  || !worldSharingPanelSource.includes('migrateLegacyWorldPackageV1')
  || !worldSharingPanelSource.includes('report.migrationRequired')) {
  violations.push('[㉜世界包 UI] 正式 UI 不得回退创建 v1；旧包必须暴露分类迁移入口')
}
for (const token of [
  'semanticPortableProject', 'productRecoveryProjectId', 'worldReleaseMigrations',
  "confirmWorkspacePurpose(semanticProjectId, 'world-engine'",
  "confirmWorkspacePurpose(recoveryProjectId, 'independent-work'",
]) {
  if (!worldPackageMigrationSource.includes(token)) violations.push(`[㉜旧包拆分] 迁移服务缺少 ${token}`)
}
if (!registryTypesSource.includes('@deprecated PLATFORM-1 v1 read/migration classification only')
  || /\bcommunityShare\b|\breleaseSection\b/.test(registrySrc)) {
  violations.push('[㉜旧元数据降权] 旧分享字段必须明确重命名为 legacy 专用，不能继续冒充发布协议')
}

// ── ㉝ ARCH-03 上层产品不得绕过制作阶段从作者 UI 直接发布 ──
const LEGACY_FIXTURE_PUBLISHERS = [
  'publishGameDefinition',
  'publishStoryGameDraft',
  'publishAdventureGameDraft',
  'publishAvgGame',
  'publishNarrativeSimulationGame',
  'publishTextOpenWorldGame',
  'publishInteractionGameDraft',
  'publishTtrpgCampaignReleaseV1',
]
for (const dir of UI_DIRS) {
  for (const file of walk(dir)) {
    const source = read(file)
    for (const publisher of LEGACY_FIXTURE_PUBLISHERS) {
      if (new RegExp(`\\b${publisher}\\b`).test(source)) {
        violations.push(`[㉝三阶段旁路] ${file}: UI 不得调用 ${publisher}；正式发布必须进入产品制作中心`)
      }
    }
  }
}
for (const [file, publisher, fixtureFlag = 'fixtureOnly'] of [
  ['src/lib/text-game/releases.ts', 'publishGameDefinition'],
  ['src/lib/text-game/authoring.ts', 'publishStoryGameDraft'],
  ['src/lib/adventure/authoring.ts', 'publishAdventureGameDraft'],
  ['src/lib/avg/authoring.ts', 'publishAvgGame'],
  ['src/lib/narrative-simulation/authoring.ts', 'publishNarrativeSimulationGame'],
  ['src/lib/open-world/authoring.ts', 'publishTextOpenWorldGame'],
  ['src/lib/character-interaction/authoring.ts', 'publishInteractionGameDraft'],
  ['src/lib/ttrpg/release.ts', 'publishTtrpgCampaignReleaseV1', 'testOnlyAllowFixtureCampaign'],
]) {
  const source = read(file)
  const start = source.indexOf(`function ${publisher}`)
  const body = start >= 0 ? source.slice(start, start + 1_200) : ''
  if (!body.includes(fixtureFlag)
    || !body.includes("if (import.meta.env.MODE !== 'test')")) {
    violations.push(`[㉝fixture 闸门] ${file}: ${publisher} 必须无条件拒绝非 test mode；fixtureOnly 参数不能成为生产旁路`)
  }
}
const ttrpgFixtureAuthoringSource = read('src/lib/ttrpg/authoring.ts')
const ttrpgFixtureCampaignSource = read('src/lib/ttrpg/campaign.ts')
if (!ttrpgFixtureAuthoringSource.includes('import.meta.env.MODE !== "test" || input.fixtureOnly !== true')
  || !ttrpgFixtureCampaignSource.includes("import.meta.env.MODE !== 'test' || input.fixtureOnly !== true")) {
  violations.push('[㉝跑团 fixture 闸门] 固定战役编译器及其持久化入口必须同时验证 test mode 与 fixtureOnly')
}
const formalRuntimeBoundarySource = read('src/lib/product/runtime-boundary.ts')
const worldInstanceSource = read('src/lib/world-engine/instances.ts')
const simulationKernelSource = read('src/lib/simulation/runtime.ts')
const simulationRuntimeStoreSource = read('src/stores/simulation-runtime.ts')
const sidebarTreeSource = read('src/components/layout/sidebar-tree.ts')
for (const kind of [
  'ttrpg', 'chatgame', 'storygame', 'textadventure', 'avg', 'textsimulation', 'textworld',
]) {
  if (!formalRuntimeBoundarySource.includes(`'${kind}'`)) {
    violations.push(`[㉝正式运行类型] runtime-boundary.ts 漏登记 ${kind}`)
  }
}
if (!worldInstanceSource.includes('isFormalProductSessionKindV1(input.kind) && !playable')
  || worldInstanceSource.includes('explicitLegacyBinding')) {
  violations.push('[㉝底层实例闸门] 正式产品必须统一拒绝 WorldRelease/草稿直启，禁止恢复 legacy 特例')
}
if (!simulationKernelSource.includes('isFormalProductSessionKindV1(input.kind)')
  || !simulationRuntimeStoreSource.includes('isFormalProductSessionKindV1(input.kind)')) {
  violations.push('[㉝内核旁路] 通用 runtime kernel/store 必须共同拒绝正式产品从作者快照直启')
}
if (!simulationKernelSource.includes('createSimulationSessionFixtureV1')
  || !simulationKernelSource.includes('import.meta.env.MODE !== "test"')) {
  violations.push('[㉝测试夹具] 正式类型的内核回归构造器必须只在 test mode 生效')
}
if (!simulationKernelSource.includes('branchSimulationSessionFixtureV1')
  || !simulationKernelSource.includes('branchSimulationSessionInternal(input, { allowFormalFixture: true })')) {
  violations.push('[㉝分支夹具] 正式类型的回归分支只能经 test-only 构造器，正式 branch 不得放宽')
}
const worldReleaseFixture = 'createInternalProductWorldReleaseFixtureV1'
if (!worldReleaseSource.includes(`function ${worldReleaseFixture}`)
  || !worldReleaseSource.includes("if (import.meta.env.MODE !== 'test')")
  || !worldReleaseSource.includes('allowInternalSource: true')) {
  violations.push('[㉝世界夹具] 独立产品内核的语义 WorldRelease 夹具必须只在 test mode 生效')
}
for (const dir of UI_DIRS) {
  for (const file of walk(dir)) {
    const source = read(file)
    for (const fixture of [
      'createSimulationSessionFixtureV1',
      'branchSimulationSessionFixtureV1',
      worldReleaseFixture,
    ]) {
      if (source.includes(fixture)) {
        violations.push(`[㉝测试夹具旁路] ${file}: 产品 UI 不得导入 regression-only 构造器 ${fixture}`)
      }
    }
  }
}
if (sidebarTreeSource.includes("leaf('simulation-runtime'")) {
  violations.push('[㉝长篇入口隔离] 分步骤侧栏不得重新暴露通用互动运行时')
}
if (workspacePageSource.includes("import('../components/simulation/SimulationRuntimePanel')")
  || !workspacePageSource.includes('互动运行已移至独立上层产品')) {
  violations.push('[㉝旧路由收口] 长篇 legacy runtime 路由只能显示产品中心交接说明，不得渲染创建器')
}

// ── ㉝B ARCH-04 产品发布谱系必须先于正式 Runtime 校验 ──
const productSourceContractsSource = read('src/lib/world-engine/product-source-contracts.ts')
const characterProductPipelineSource = read('src/lib/character-interaction/production-pipeline.ts')
const characterPlayerStoreSource = read('src/stores/interaction-game-player.ts')
const chatGamePanelSource = read('src/components/simulation/ChatGamePanel.tsx')
for (const token of [
  'validateWorldReferenceV1', 'validateProductSourcePlanV1',
  'validateConfirmedProductBriefV1', 'validateProductSourceManifestV1',
  'validateProductReleaseLineageV1', 'assertFormalProductProductionStartV1',
]) {
  if (!productSourceContractsSource.includes(token)) {
    violations.push(`[㉝B五契约] product-source-contracts.ts 缺少 ${token}`)
  }
}
for (const token of [
  'publishCharacterInteractionProductReleaseV1',
  'assertCharacterInteractionProductReleaseUnchangedV1',
  'createCharacterInteractionProductInstanceV1',
  'sourceManifestHash', 'lineageHash', 'productReleaseUid',
  'productReleaseLineageHash', 'deleteSimulationSession(session.id!)',
]) {
  if (!characterProductPipelineSource.includes(token)) {
    violations.push(`[㉝B参考纵切面] 角色互动 ProductRelease→Runtime 缺少 ${token}`)
  }
}
if (!characterPlayerStoreSource.includes('db.characterInteractionProductReleases')
  || !characterPlayerStoreSource.includes('createCharacterInteractionProductInstanceV1({')
  || characterPlayerStoreSource.includes('createInteractionGameInstance({')) {
  violations.push('[㉝B角色运行入口] 正式角色互动玩家必须列 ProductRelease 并经 lineage launcher，禁止直接列/启 GameRelease')
}
if (!chatGamePanelSource.includes('item.productRelease.id')
  || chatGamePanelSource.includes('store.start(item.release.id')) {
  violations.push('[㉝B角色运行 UI] 新会话必须传 ProductRelease identity，不能传裸 GameRelease id')
}

// ARCH-05 compatibility quarantine. Existing product readers are kept only so
// their product-specific migrations can be completed without a destructive
// rewrite. New product code must consume WorldReference + the neutral provider
// through a versioned requirement adapter instead of parsing the physical
// WorldRelease manifest. Delete entries as each legacy reader is retired.
const WORLD_RELEASE_MANIFEST_COMPATIBILITY_ALLOWLIST = new Set([
  'src/lib/character-interaction/world-source.ts',
  'src/lib/context-gateway/world-release-provider.ts',
  'src/lib/game-platform/distribution-bundle.ts',
  'src/lib/game-production/context.ts',
  'src/lib/product/world-package.ts',
  'src/lib/simulation/canon-snapshot.ts',
  'src/lib/text-game/releases.ts',
  'src/lib/text-game/world-generation.ts',
  'src/lib/ttrpg/authoring.ts',
  'src/lib/ttrpg/continuity.ts',
  'src/lib/ttrpg/release.ts',
  'src/lib/ttrpg/world-source.ts',
  'src/lib/types/character-interaction.ts',
  'src/lib/types/world-release.ts',
  'src/lib/world-engine/instances.ts',
  'src/lib/world-engine/release-classification.ts',
  'src/lib/world-engine/releases.ts',
  'src/lib/world-engine/world-reference.ts',
])
for (const file of walk('src')) {
  const source = read(file)
  if (source.includes('WorldReleaseManifestV2')
    && !WORLD_RELEASE_MANIFEST_COMPATIBILITY_ALLOWLIST.has(file)) {
    violations.push(`[㉝C世界读取兼容隔离] ${file}: 新产品代码不得解析 WorldReleaseManifestV2；请新增产品 requirement adapter 并使用中立 provider`)
  }
}
const requirementAdaptersSource = read('src/lib/world-engine/product-requirement-adapters.ts')
if (requirementAdaptersSource.includes('WorldReleaseManifestV2')
  || requirementAdaptersSource.includes('selectedTables')
  || requirementAdaptersSource.includes('.records')) {
  violations.push('[㉝C需求适配器中立性] 产品 requirement adapter 不得读取物理表、selectedTables 或 WorldRelease records')
}

// ── ㉞ ARCH-06 节点模式只能编排分步骤领域动作，不得复制第二套生成/写回后端 ──
const nodeDomainActionSource = read('src/lib/node-authoring/domain-action-registry.ts')
const nodeDomainExecutionSource = read('src/lib/node-authoring/domain-execution.ts')
const nodeExecutorSource = read('src/lib/node-authoring/executor.ts')
const nodeTemplatesSource = read('src/lib/node-authoring/templates.ts')
for (const token of [
  'worldview-field-copilot', 'story-core-field-copilot', 'character-profile-copilot',
  'character-supplement-copilot', 'character-relationship-durable', 'story-arc-copilot',
  'outline-copilot', 'detailed-outline-copilot', 'prose-copilot',
  'chapter-organization-durable', 'candidate-only',
]) {
  if (!nodeDomainActionSource.includes(token)) violations.push(`[㉞节点动作注册] 缺少 ${token}`)
}
for (const token of [
  'prepareWorldviewFieldCopilot', 'prepareStoryCoreCopilot', 'prepareCharacterCopilot',
  'prepareCharacterSupplementCopilotV1', 'generateCharacterRelationshipCandidateV1',
  'prepareStoryArcCopilot', 'prepareOutlineCopilot', 'prepareProseCopilot',
  'adoptRestoredWorldviewFieldCandidate', 'adoptRestoredStoryCoreCandidate',
  'adoptRestoredCharacterSupplementCandidateV1', 'adoptCharacterRelationshipCandidateV1',
]) {
  if (!nodeDomainExecutionSource.includes(token)) violations.push(`[㉞节点领域同源] 缺少 ${token}`)
}
if (!nodeExecutorSource.includes("actionBinding?.mode === 'formal-domain-action'")
  || !nodeExecutorSource.includes('已阻止回退到通用生成')
  || !nodeExecutorSource.includes("actionBinding?.mode === 'experimental-draft'")
  || !nodeExecutorSource.includes('不能直接写入 Canon')) {
  violations.push('[㉞节点回退闸门] 正式动作必须拒绝通用生成回退，实验草稿必须拒绝直接采纳')
}
if (!nodeTemplatesSource.includes('assertOfficialAuthoringGraphUsesFormalActionsV1')) {
  violations.push('[㉞官方模板闸门] 官方节点模板必须在构建时验证所有生成节点均已同源')
}

// ── ㉟ ARCH-07 世界能力只表达语义；未验收产品必须经过成熟度入口 ──
const worldDomainSource = read('src/lib/world-engine/domain.ts')
const productCatalogSource = read('src/lib/product/product-catalog.ts')
const productHubSource = read('src/pages/ProductHubPage.tsx')
for (const capability of [
  'foundation', 'story', 'characters', 'relations', 'entities', 'storylines',
  'outline', 'detailed-outline', 'manuscript', 'multi-world',
]) {
  if (!worldDomainSource.includes(`key: '${capability}'`)) {
    violations.push(`[㉟世界语义能力] domain.ts 缺少 ${capability}`)
  }
}
if (/key:\s*['"](?:runtime|media|assets|gameplay|sessions?)['"]/.test(worldDomainSource)) {
  violations.push('[㉟世界边界] 世界能力投影不得拥有 runtime、media、assets、gameplay 或 session')
}
for (const token of [
  'PRODUCT_CATALOG_V1', "status: 'released'", "status: 'preview'",
  "status: 'experimental'", "status: 'internal'", 'requiresWorldReference',
  'ownsRuntime', 'ownsMedia', 'experimentalOptIn',
]) {
  if (!productCatalogSource.includes(token)) violations.push(`[㉟产品目录] 缺少 ${token}`)
}
if (!productCatalogSource.includes("input.channel === 'local-development' || input.channel === 'test'")
  || !productCatalogSource.includes("entry.status === 'released'")) {
  violations.push('[㉟生产入口] 产品目录必须以 released 为生产可见基线，并把预览/内部限制在本地或测试环境')
}
if (!productCatalogSource.includes("item.family === 'world-engine' && (item.ownsRuntime || item.ownsMedia)")) {
  violations.push('[㉟世界产品所有权] 产品目录必须拒绝世界引擎拥有运行态或产品媒资')
}
for (const token of [
  'evaluateProductEntryV1', 'visibleNavTabs()', 'MaturityBadge',
  'currentProductCatalogChannelV1', 'currentExperimentalProductOptInV1',
]) {
  if (!productHubSource.includes(token)) violations.push(`[㉟入口成熟度闸门] ProductHub 缺少 ${token}`)
}

// ── ㊱ Phase D 世界引擎：诚实能力画像、关系出口、规模缓存与显式作品派生 ──
const worldReleaseProviderSource = read('src/lib/context-gateway/world-release-provider.ts')
const worldDerivationPhaseDSource = read('src/lib/world-engine/derivation.ts')
for (const token of [
  'semanticSelectionStats', 'selectionStatus', 'selectedResourceCount',
  'omittedResourceCount', 'confirmedRowCount', 'candidateRowCount',
  'conflictRowCount', 'originalEvidenceAvailable', 'queryableIndexAvailable',
  'selectedResourceIds', 'omittedResourceIds', 'WORLD_CAPABILITY_AREAS.map',
]) {
  if (!worldReleaseSource.includes(token)) violations.push(`[㊱世界能力画像] releases.ts 缺少 ${token}`)
}
for (const token of [
  'validatedReleaseCache', 'projectedReleaseCache', 'RELEASE_CACHE_LIMIT',
  'addWorldRelation', "item.table === 'worldGroupLinks'",
  'searchWorldReleaseV1', 'readWorldResourceV1', 'readWorldOriginalEvidenceV1',
]) {
  if (!worldReleaseProviderSource.includes(token)) violations.push(`[㊱世界出口] world-release-provider.ts 缺少 ${token}`)
}
for (const token of [
  'deriveNovelToWorld', "effectiveNovelProfile(sourceWork) === 'short' ? 'short-novel' : 'long-novel'",
  'sourceRevisionVectorJson', 'targetRevisionId', 'targetReleaseId',
]) {
  if (!worldDerivationPhaseDSource.includes(token)) violations.push(`[㊱作品派生世界] derivation.ts 缺少 ${token}`)
}
if (!registryTypesSource.includes('WORLD_CAPABILITY_AREAS')
  || !registryTypesSource.includes("'multi-world'")) {
  violations.push('[㊱世界能力单一事实源] 能力域必须有可运行常量并包含 multi-world')
}

// ── ㊲ Headless 迁移/演示边界不得重新进入正式产品 UI ──
for (const dir of UI_DIRS) {
  for (const file of walk(dir)) {
    const source = read(file)
    if (/legacy-entry-governance|mist-harbor-(?:demo|roadshow)|scope-conversion/.test(source)) {
      violations.push(`[㊲headless 边界] ${file}: 不得导入旧发布策略、路演 fixture 或任意 scope 转换服务`)
    }
  }
}
for (const file of walk('src')) {
  if (file === 'src/lib/world-engine/mist-harbor-demo.ts'
    || file === 'src/lib/world-engine/mist-harbor-roadshow-authoring.ts'
    || file === 'src/lib/world-engine/mist-harbor-roadshow-story.ts') continue
  if (/mist-harbor-(?:demo|roadshow-authoring|roadshow-story)/.test(read(file))) {
    violations.push(`[㊲演示隔离] ${file}: 雾港 fixture 只能在其 headless fixture 边界内部互相引用`)
  }
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
