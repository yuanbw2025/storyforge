/* global console, process */

/**
 * 架构守护 lint(Phase 3.4)
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

/** Same traversal for architecture vocabulary checks, including tests. */
function walkIncludingTests(dir, acc = []) {
  for (const ent of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${ent.name}`
    if (ent.isDirectory()) walkIncludingTests(rel, acc)
    else if (/\.(ts|tsx)$/.test(ent.name)) acc.push(rel)
  }
  return acc
}

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const violations = []
const currentSchemaSource = read('src/lib/db/schema.ts')

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
const proseGatewayContextSource = read('src/lib/prose/gateway-context.ts')
const proseSkillRegistrySource = read('src/lib/agent/skill-registry.ts')
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
const proseInputPolicyBlock = proseSkillRegistrySource.slice(
  proseSkillRegistrySource.indexOf('const PROSE_INPUT_POLICY'),
  proseSkillRegistrySource.indexOf('const PROSE_EMOTION_BEAT_INPUT_POLICY'),
)
if (!proseInputPolicyBlock.includes("'activeNarrativeBlueprint'")
  || !proseGatewayContextSource.includes('const blueprintKeys =')
  || !proseGatewayContextSource.includes('...blueprintKeys')) {
  violations.push('[⑬正文叙事蓝图] prose Skill 与共享 Gateway 必须显式纳入 activeNarrativeBlueprint，禁止页面手写来源替代')
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
if (/export\s+const\s+PROSE_GENERATION_SOURCE_KEYS_V1\b/.test(proseDurableSource)) {
  violations.push('[⑬Skill来源单源] prose 不得重新导出固定来源清单，运行契约必须从激活 Skill 派生')
}
if (/export\s+const\s+OUTLINE_GENERATION_SOURCE_KEYS\b/.test(outlineHarnessSource)) {
  violations.push('[⑬Skill来源单源] outline 不得重新导出固定来源清单，运行契约必须从激活 Skill 派生')
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
if (/OUTLINE_DURABLE_HARNESS_STORAGE_KEY|isOutlineDurableHarnessEnabledV1/.test(outlineHarnessSource)
  || /isOutlineDurableHarnessEnabledV1/.test(outlineControllerSource)) {
  violations.push('[⑭formal 单轨] 正式大纲不得恢复可关闭 durable Harness 的本机回滚开关')
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
if (/MASTER_AGENT_(?:DURABLE_HARNESS|REPLAN)_STORAGE_KEY|isMasterAgent(?:DurableHarness|Replan)EnabledV1/.test(masterDurableSource)
  || /\bexecuteMasterAgentPlan\s*\(/.test(masterCopilotSource)
  || !masterCopilotSource.includes('runDurableMasterAgentPlanV1')
  || !masterCopilotSource.includes('当前作品尚未完成世界与作品身份初始化，主 Agent 已阻止生成')) {
  violations.push('[⑯主 Agent 单轨] 正式主 Agent 必须强制 durable Harness；身份缺失应阻断，不能退回非持久化执行')
}
if (/MASTER_CANDIDATE_SEMANTIC_REVIEW_STORAGE_KEY|isMasterCandidateSemanticReviewEnabledV1|localStorage/.test(masterDurableSource)
  || !masterDurableSource.includes("candidateSemanticReview?: 'required' | 'disabled'")
  || !masterDurableSource.includes("input.candidateSemanticReview === 'required'")) {
  violations.push('[⑯主 Agent 显式策略] 候选语义复核必须由创建时输入冻结进 Run Contract，不得由浏览器隐藏开关改变')
}
if (/else if \(decision === 'adopted'\)[\s\S]{0,300}adoptMasterCandidate\s*\(/.test(masterCopilotSource)
  || !masterCopilotSource.includes('缺少当前 durable Harness 绑定')) {
  violations.push('[⑯主 Agent 候选单轨] UI 只能修订、采纳或拒绝与当前 durable run 绑定的候选')
}
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
  || !structuredOutputSource.includes('structured-output-unknown-field')
  || /fieldAliases|appliedAliases|apply-registered-field-alias/.test(structuredOutputSource)
  || !structuredOutputSource.includes('StructuredOutputRepairFailedErrorV1')) {
  violations.push('[⑰确定性修复] StructuredOutputPipeline 必须拒绝竞争根和非当前字段，且不得恢复字段 alias；repair 失败必须留证')
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
    if (/context-gateway\/world-release-provider/.test(source)) {
      violations.push(`[㉝C上层零物理 Provider] ${file}: 上层产品只能依赖 world-release-client/Context Gateway 中立协议`)
    }
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
const scopeSource = read('src/lib/workspace/scope.ts')
const resourceUidSource = read('src/lib/context-gateway/resource-uid.ts')
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
if (fs.existsSync(path.join(root, 'src/lib/context-gateway/resource-identity.ts'))
  || /backfillResourceUids|ensureResourceIdentit/.test(scopeSource)) {
  violations.push('[㉓当前资源身份] 禁止恢复资源身份 backfill；当前记录必须在统一新建边界一次性盖章')
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

// ── ㉔ CTXG-3 Canon resource descriptor 覆盖与资料目录单源化 ──
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
    violations.push(`[㉔资料目录清单] rag-library.ts 不得恢复手写 ${legacyList}`)
  }
}
if (!ragLibrarySource.includes('CANON_RESOURCE_PROVIDER_V1.listMetadata')
  || !ragLibrarySource.includes('readCanonicalDescriptorV1')) {
  violations.push('[㉔资料目录单源] 资料目录 UI 必须从 Canon Provider 分页目录与定点读取派生')
}
if (/\.(?:add|put|update|delete|bulkPut|bulkDelete|clear)\s*\(/.test(canonProviderSource)) {
  violations.push('[㉔Provider 只读] Canon Provider 不得写任何数据库表')
}

// ── ㉕ CTXG-4 Gateway 工具必须复用唯一 Tool Registry 与统一 Runner ──
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
if (!agentExecutionBindingSource.includes("AGENT_TOOL_SCHEMA_VERSION_V1 = 'agent-read-tools-v5'")
  || !agentExecutionBindingSource.includes("AGENT_TOOL_SCHEMA_HASH_V1 = '4ee6ed218f3c78035c9bbf9b05dee66bfb3efc8a11f43d99ebe0a3b9e36d043d'")
  || !agentExecutionBindingSource.includes('verifyAgentToolSchemaBindingV1')) {
  violations.push('[㉕工具版本] 当前 Gateway 工具必须冻结并校验 Agent tool schema version/hash')
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
  "rollout: 'required'",
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
if (/\bdb\./.test(contextProviderCacheSource)
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

// ── ㉚ GATE-P1A 过渡期 shadow 双读已下线，正式路径不得恢复 ──
if (fs.existsSync(path.join(root, 'src/lib/context-gateway/shadow-read.ts'))
  || contextGatewayIndexSource.includes("from './shadow-read'")
  || agentSkillSource.includes("rollout: 'shadow' | 'required'")
  || contextExecutionSource.includes('legacy-or-shadow')) {
  violations.push('[㉚Gateway 单路径] shadow 双读和 legacy-or-shadow 过渡协议已退役，不得恢复')
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
const worldIdentitySource = read('src/lib/world-engine/world-identity.ts')
const workspaceIdentitySource = read('src/lib/workspace/identity.ts')
const worldReleaseSource = read('src/lib/world-engine/releases.ts')
const worldPackageSource = read('src/lib/world-engine/world-package.ts')
const worldSharingPanelSource = read('src/components/product/WorldSharingPanel.tsx')
const worldDerivationSource = read('src/lib/world-engine/derivation.ts')
if (!workspaceIdentitySource.includes("project.workspacePurpose === 'independent-work'")
  || !workspaceIdentitySource.includes("project.workspacePurpose === 'world-engine'")
  || !workspaceIdentitySource.includes('throw new Error')
  || !workspaceIdentitySource.includes('generateWorkspaceScopeCode')
  || !worldIdentitySource.includes("world.identityKind === 'world-draft'")
  || !worldIdentitySource.includes('isPublicWorldCode(world.code)')
  || !workspaceIdentitySource.includes('generateWorldCode')) {
  violations.push('[㉜身份分离] 世界草稿、独立作品与 v0 公共身份必须有显式机器判定')
}
for (const token of [
  'buildIndependentWorkWorldSnapshot', 'captureWorkspaceContentRevisionV1',
  'verifyWorkspaceContentRevisionV1', 'worldDerivations', 'cascadeDeleteProject',
]) {
  if (!worldDerivationSource.includes(token)) violations.push(`[㉜显式派生] 派生服务缺少 ${token}`)
}
if (!worldReleaseSource.includes('PROJECT_TABLES.filter(spec => spec.worldSemantic)')
  || worldReleaseSource.includes('communityShare')) {
  violations.push('[㉜纯语义发布] WorldRelease 必须只从 worldSemantic 派生，禁止读取分享兼容标志')
}
if (!worldReleaseSource.includes('semanticContract: 3')
  || worldReleaseSource.includes('selectedNarrativeModules')) {
  violations.push('[㉜产品内容隔离] WorldRelease 必须声明 semanticContract 3，且协议中不得存在可执行叙事模块字段')
}
for (const token of [
  'WORLD_PACKAGE_VERSION = 3', 'WORLD_PACKAGE_MAX_BYTES',
  'verifyPureWorldReleaseManifestV3', 'report.importable',
]) {
  if (!worldPackageSource.includes(token)) violations.push(`[㉜世界包边界] world-package 缺少 ${token}`)
}
if (!worldSharingPanelSource.includes('createWorldPackage,')
  || /migrateLegacy|migrationRequired|分类迁移/.test(worldSharingPanelSource)) {
  violations.push('[㉜世界包 UI] 正式 UI 只能创建和导入当前纯语义协议，不得保留旧包迁移入口')
}
if (/legacyWorldPackageV1|legacyWorldReleaseSection|worldReleaseMigrations/.test(registrySrc)
  || /legacyWorldPackageV1|legacyWorldReleaseSection/.test(registryTypesSource)) {
  violations.push('[㉜零旧世界协议] 三注册表不得保留旧世界包分类元数据或迁移表')
}

// ── ㉝ ARCH-03 上层产品不得绕过制作阶段从作者 UI 直接发布 ──
const FORBIDDEN_DIRECT_PUBLISHERS = [
  'publishGameDefinition',
  'publishStoryGameDraft',
  'publishAdventureGameDraft',
  'publishAvgGame',
  'publishNarrativeSimulationGame',
  'publishTextOpenWorldGame',
  'publishCharacterInteractionDraft',
  'publishTtrpgCampaignReleaseV1',
]
for (const file of walk('src')) {
  const source = read(file)
  for (const publisher of FORBIDDEN_DIRECT_PUBLISHERS) {
    if (new RegExp(`\\b${publisher}\\b`).test(source)) {
      violations.push(`[㉝三阶段旁路] ${file}: 已删除的直发入口 ${publisher} 不得重新出现`)
    }
  }
}
const productRuntimeTypeSource = read('src/lib/types/product-runtime.ts')
const productRuntimeInstanceSource = read('src/lib/product/runtime-instances.ts')
const productRuntimeCoreSource = read('src/lib/product/runtime-core.ts')
const productRuntimeAdapterSource = read('src/lib/product/runtime-product-adapters.ts')
const productRuntimeApiSource = read('src/lib/product/runtime-api.ts')
const productRuntimeStoreSource = read('src/stores/ttrpg-runtime-player.ts')
const sidebarTreeSource = read('src/components/layout/sidebar-tree.ts')
if (!productRuntimeTypeSource.includes('PRODUCTION_PRODUCT_KINDS_V1')
  || !productRuntimeTypeSource.includes('PRODUCT_RUNTIME_KINDS = [...PRODUCTION_PRODUCT_KINDS_V1]')) {
  violations.push('[㉝正式运行类型] Product Runtime 类型必须直接复用封闭产品身份注册表')
}
if (!productRuntimeInstanceSource.includes("input.productSource.kind !== 'release' && input.productSource.kind !== 'build'")
  || !productRuntimeInstanceSource.includes('verifyProductRuntimeSource({')
  || !productRuntimeInstanceSource.includes('source: input.productSource')
  || !productRuntimeInstanceSource.includes('if (input.kind !== expectedKind)')
  || productRuntimeInstanceSource.includes('explicitLegacyBinding')
  || /worldReleaseId\??:\s*number/.test(productRuntimeInstanceSource)) {
  violations.push('[㉝底层实例闸门] 正式产品必须统一拒绝 WorldRelease/草稿直启，禁止恢复 legacy 特例')
}
if (!productRuntimeCoreSource.includes('verifyFormalRuntimeSourceV1(')
  || !productRuntimeCoreSource.includes('sourceCount !== 1')
  || /\bcreateSession\s*:/.test(productRuntimeStoreSource)) {
  violations.push('[㉝运行核心旁路] ProductRuntime core 必须验证正式分支来源，store 不得暴露无绑定创建入口')
}
for (const symbol of [
  'appendProductRuntimeEvent',
  'resolveProductRuntimeDice',
  'createPreviewProductRuntimeSession',
  'createReleasedProductRuntimeSession',
  'insertPreparedProductRuntimeSessionV1',
  'preparePreviewProductRuntimeSessionRecordV1',
  'prepareReleasedProductRuntimeSessionRecordV1',
]) {
  if (new RegExp(`\\b${symbol}\\b`).test(productRuntimeApiSource)) {
    violations.push(`[㉝运行公共边界] product/runtime-api.ts 不得公开底层写入或半成品会话入口 ${symbol}`)
  }
}
for (const file of walk('src')) {
  if (file === 'src/lib/product/runtime-core.ts' || file === 'src/lib/product/runtime-dice-command.ts') continue
  const source = read(file)
  if (/\bappendProductRuntimeEvent\b/.test(source) || /product\/runtime-dice-command/.test(source)) {
    violations.push(`[㉝运行底层写入] ${file}: 正式产品必须使用产品专用命令，不得导入通用事件写入器或随机事件命令`)
  }
}
const retiredFormalFixtureSymbols = [
  'createProductRuntimeSessionFixtureV1',
  'branchProductRuntimeSessionFixtureV1',
  'createInternalProductWorldReleaseFixtureV1',
  'allowFormalFixture',
]
for (const symbol of retiredFormalFixtureSymbols) {
  if (productRuntimeCoreSource.includes(symbol) || worldReleaseSource.includes(symbol)) {
    violations.push(`[㉝正式入口零夹具] src/ 不得保留可绕过 Product Build/Release 的 ${symbol}`)
  }
}
for (const dir of UI_DIRS) {
  for (const file of walk(dir)) {
    const source = read(file)
    for (const fixture of retiredFormalFixtureSymbols) {
      if (source.includes(fixture)) {
        violations.push(`[㉝测试夹具旁路] ${file}: 产品 UI 不得导入 regression-only 构造器 ${fixture}`)
      }
    }
  }
}
const retiredTtrpgFreeformCommands = [
  'openTtrpgScene',
  'appendTtrpgTurn',
  'parseTtrpgRuntimeEncounterCandidate',
  'startTtrpgEncounter',
  'resolveTtrpgEncounter',
  'resolveTtrpgCheck',
  'resolveTtrpgAttack',
  'changeTtrpgResource',
  'applyTtrpgCondition',
  'removeTtrpgCondition',
  'updateTtrpgCampaignSummary',
  'upsertTtrpgQuest',
  'upsertTtrpgNpcSchedule',
]
for (const file of [
  'src/lib/ttrpg/runtime-commands.ts',
  'src/lib/ttrpg/runtime-api.ts',
  'src/stores/ttrpg-runtime-player.ts',
]) {
  const source = read(file)
  for (const command of retiredTtrpgFreeformCommands) {
    if (new RegExp(`\\b${command}\\b`).test(source)) {
      violations.push(`[㉝跑团正式命令] ${file}: ${command} 会绕过冻结 CampaignPack 与正式命令信封，不得恢复`)
    }
  }
}
if (/\b(?:appendProductRuntimeEvent|resolveProductRuntimeDice)\b/.test(productRuntimeStoreSource)) {
  violations.push('[㉝跑团 Store 边界] 跑团 UI Store 只能管理会话投影、检查点与分支；玩法动作必须进入正式 TTRPG 命令 API')
}
if (sidebarTreeSource.includes('simulation-runtime')
  || workspacePageSource.includes('simulation-runtime')
  || workspacePageSource.includes("import('../components/simulation/SimulationRuntimePanel')")) {
  violations.push('[㉝长篇入口隔离] 分步骤工作区不得登记、渲染或兼容上层产品运行路由')
}

// ── ㉝B ARCH-04 产品发布谱系必须先于正式 Runtime 校验 ──
const productSourceContractsSource = read('src/lib/product/source-contracts.ts')
const productSourcePublicSource = read('src/lib/product/source.ts')
const requirementAdaptersSource = read('src/lib/product/world-requirement-adapters.ts')
const productProductionWorldSource = read('src/lib/product-production/world-source.ts')
const productProductionSourceContractsSource = read('src/lib/product-production/source-contracts.ts')
const productProductionCommandsSource = read('src/lib/product-production/commands.ts')
const productProductionServiceSource = read('src/lib/product-production/service.ts')
const productProductionSchedulerSource = read('src/lib/product-production/scheduler.ts')
const productProductionAdoptionSource = read('src/lib/product-production/adoption.ts')
const productProductionExecutorSource = read('src/lib/product-production/production-executor.ts')
const productProductionStudioSource = read('src/components/product/ProductProductionStudio.tsx')
const productIdentitySource = read('src/lib/types/product-identity.ts')
const productProductionTypesSource = read('src/lib/types/product-production.ts')
const productRuntimePackageSource = read('src/lib/product-production/runtime-package.ts')
const productReleaseTypesSource = read('src/lib/types/product-release.ts')
const productRuntimeTypesSource = read('src/lib/types/product-runtime.ts')
const worldReferenceSource = read('src/lib/world-engine/world-reference.ts')
const releaseCodecSource = read('src/lib/world-engine/release-codec.ts')
const productHubArchitectureSource = read('src/pages/ProductHubPage.tsx')
const distributionBundleSource = read('src/lib/product-platform/distribution-bundle.ts')
for (const token of [
  'validateWorldReferenceV1', 'validateProductSourcePlanV1',
  'validateConfirmedProductBriefV1', 'validateProductSourceManifestV1',
  'validateProductReleaseLineageV1', 'assertFormalProductProductionStartV1',
]) {
  if (!productSourceContractsSource.includes(token)) {
    violations.push(`[㉝B五契约] product/source-contracts.ts 缺少 ${token}`)
  }
}
if (!productSourcePublicSource.includes("from './source-contracts'")
  || !productSourcePublicSource.includes("from './world-requirement-adapters'")) {
  violations.push('[㉝B产品来源公共边界] 五项逻辑契约与产品需求适配器必须从同一 headless 入口导出')
}
for (const token of [
  'TTRPG_WORLD_REQUIREMENT_ADAPTER_V1',
  'CHARACTER_INTERACTION_WORLD_REQUIREMENT_ADAPTER_V1',
  'TEXT_ADVENTURE_WORLD_REQUIREMENT_ADAPTER_V1',
  'AVG_WORLD_REQUIREMENT_ADAPTER_V1',
  'TEXT_OPEN_WORLD_REQUIREMENT_ADAPTER_V1',
]) {
  if (!requirementAdaptersSource.includes(token)) violations.push(`[㉝B需求适配器] 缺少 ${token}`)
}
if (!productProductionWorldSource.includes('openWorldSemanticResourceCatalogV1({')
  || !productProductionWorldSource.includes('readWorldSemanticResourcesV1({')) {
  violations.push('[㉝B中立世界读取] 统一产品生产必须经语义目录与资源读取协议，不得解析物理 WorldRelease')
}
if (!productProductionWorldSource.includes('selection: ProductWorldSourceSelectionV1')
  || productProductionWorldSource.includes('selection?: ProductWorldSourceSelectionV1')
  || /input\.selection\s*\?|\?\?\s*opened\.resources|input\.selection\s*==\s*null/.test(productProductionWorldSource)
  || !productProductionWorldSource.includes('resolveProductProductionWorldCompilationDescriptorsV2({')
  || !productProductionWorldSource.includes('selection 与冻结 WorldReference 不一致')) {
  violations.push('[㉝B产品选择强制生效] 世界编译目录必须要求显式产品 selection、校验 WorldReference hash，且不得回退读取完整 release')
}
if (!productHubArchitectureSource.includes("lazy(() => import('../components/product/ProductProductionStudio'))")
  || !productHubArchitectureSource.includes('<ProductProductionStudio')) {
  violations.push('[㉝B统一产品生产] 产品中心必须把上层产品制作统一路由到 ProductProductionStudio')
}
for (const token of [
  'PRODUCTION_PRODUCT_KINDS_V1', 'TEXT_GAME_PRODUCT_KINDS_V1',
  "'text-adventure'", "'avg'", "'text-open-world'",
]) {
  if (!productIdentitySource.includes(token)) violations.push(`[㉝B封闭产品身份] product-identity.ts 缺少 ${token}`)
}
if (!/TEXT_GAME_PRODUCT_KINDS_V1\s*=\s*\[\s*'text-adventure',\s*'avg',\s*'text-open-world',?\s*\]\s*as const/.test(productIdentitySource)) {
  violations.push('[㉝B文字游戏三分类] 用户可见文字游戏必须且只能是文字冒险、AVG、文字开放世界')
}
if (!/PRODUCTION_PRODUCT_KINDS_V1\s*=\s*\[\s*'ttrpg',\s*'character-interaction',\s*'text-adventure',\s*'avg',\s*'text-open-world',?\s*\]\s*as const/.test(productIdentitySource)) {
  violations.push('[㉝B正式生产身份] 共享生产 Harness 必须且只能接入五种现行上层产品；AI 小镇未完成契约前不得混入')
}
if (!productProductionTypesSource.includes('productType: ProductionProductKindV1')
  || !productReleaseTypesSource.includes('productType: ProductionProductKindV1')
  || !productProductionStudioSource.includes('allowedProducts: readonly SupportedProduct[]')
  || !productProductionStudioSource.includes('props.allowedProducts.includes')
  || !productProductionServiceSource.includes('allowedProducts.includes(row.productType)')
) {
  violations.push('[㉝B产品隔离] Production/Release 根记录及工作台入口必须硬绑定并过滤产品身份')
}
if (!productHubArchitectureSource.includes('TEXT_GAME_PRODUCT_KINDS_V1')
  || /upper\.(?:storygame|narrative-simulation)/.test(productHubArchitectureSource)) {
  violations.push('[㉝B文字游戏收口] 产品中心只能从封闭注册表暴露文字冒险、AVG、文字开放世界')
}
if (!productRuntimePackageSource.includes('new Set<ProductionProductKindV1>(PRODUCTION_PRODUCT_KINDS_V1)')
  || !productRuntimeTypesSource.includes('...PRODUCTION_PRODUCT_KINDS_V1')) {
  violations.push('[㉝B产品身份单一源] RuntimePackage 与正式 Session 必须从 PRODUCTION_PRODUCT_KINDS_V1 派生，不得复制枚举')
}
if (!distributionBundleSource.includes("schema: 'storyforge.product-distribution-bundle'")
  || !distributionBundleSource.includes('sourceWorld: { contentHash: string }')
  || distributionBundleSource.includes('db.worldReleases')
  || distributionBundleSource.includes('WorldReleaseManifestV3')) {
  violations.push('[㉝B自包含分发] 产品分发只能包含 ProductRelease、产品媒资及世界 hash 来源证明')
}
for (const token of [
  'createProductProductionSourcePlanV1', 'createConfirmedProductBriefV1',
  'assertFormalProductProductionStartV1', 'sourcePlanJson', 'confirmedBriefJson',
]) {
  if (!productProductionCommandsSource.includes(token)) {
    violations.push(`[㉝B阶段二冻结] commands.ts 缺少 ${token}`)
  }
}
for (const token of [
  'executeProductProductionWorldGatewayV1', 'parseProductProductionSourcePlanV1',
  'parseConfirmedProductBriefV1', 'recordContextGatewayPreflightEvidenceV1',
  'finalizeContextGatewayAttemptEvidenceV1', 'sourcePlanHash', 'confirmedBriefHash',
  'product-production-deterministic-world-integrator',
  'requireCompilationResources:',
]) {
  if (!productProductionSchedulerSource.includes(token)) {
    violations.push(`[㉝B阶段三证据链] scheduler.ts 缺少 ${token}`)
  }
}
for (const token of [
  'aggregateProductSourceManifestFromExactRunsV1', 'portableProductSourcePlanV1',
  'createProductReleaseLineageV1', 'createProductReleaseManifestV1',
]) {
  if (!productProductionAdoptionSource.includes(token)) {
    violations.push(`[㉝B发布冻结] adoption.ts 缺少 ${token}`)
  }
}
if (!productProductionExecutorSource.includes('selection: options.brief.source.selection')) {
  violations.push('[㉝B作者选择生效] 正式产品编译器必须显式读取 Brief 冻结的世界资源 selection')
}
for (const token of [
  'ProductReleaseManifestV1', 'productionProvenance:', 'sourceContracts:',
  'releaseIdentityHash:', 'lineage:',
]) {
  if (!productReleaseTypesSource.includes(token)) violations.push(`[㉝B产品发布协议] product-release.ts 缺少 ${token}`)
}
for (const token of [
  'verifyProductReleaseManifestV1', 'validateProductSourcePlanV1',
  'validateConfirmedProductBriefV1', 'validateProductSourceManifestV1',
  'validateProductReleaseLineageV1', 'productReleaseIdentityHashV1',
]) {
  if (!productRuntimePackageSource.includes(token)) violations.push(`[㉝B发布反篡改] runtime-package.ts 缺少 ${token}`)
}
if (productReleaseTypesSource.includes('productionProvenance: null')
  || productReleaseTypesSource.includes('productionProvenance?:')) {
  violations.push('[㉝B发布来源必填] 当前 ProductRelease 不得允许空或可选 productionProvenance')
}
for (const token of [
  'freezeProductSourcePlanV1', 'resolveProductSourceReadBoundaryV1',
  'openWorldSemanticResourceCatalogV1', 'productProductionTaskUsesWorldGatewayV1',
  'resolveProductProductionWorldCompilationDescriptorsV2',
  'mandatoryOriginalResourceKeys:',
]) {
  if (!productProductionSourceContractsSource.includes(token)) {
    violations.push(`[㉝B产品来源执行器] source-contracts.ts 缺少 ${token}`)
  }
}
if (!productProductionWorldSource.includes('resolveProductProductionWorldCompilationDescriptorsV2')
  || !productProductionWorldSource.includes("relation.direction === 'outgoing'")
  || !productProductionWorldSource.includes("relation.direction === 'incoming'")) {
  violations.push('[①B确定性编译来源] 编译器与 Gateway 必须共用选择及语义依赖闭包')
}
for (const retiredCopy of [
  'ttrpg-upper-layer-development-gate',
  '正式世界适配完成前',
  '不会发布为商业 ProductRelease',
  '正式发布等待最终对接',
]) {
  if (productProductionStudioSource.includes(retiredCopy)) {
    violations.push(`[①B跑团正式链] ProductProductionStudio 不得恢复旧试玩/禁止发布旁路:${retiredCopy}`)
  }
}
if (/关闭[“"]启用创作可靠性工程/.test(read('src/components/settings/CreativeReliabilityCommunityPanel.tsx'))) {
  violations.push('[㉝B可靠性文案] 设置页不得暗示正式 Creative Reliability 链可以关闭')
}
if (worldReferenceSource.includes('db.worldReleases.update(')) {
  violations.push('[㉝B引用验证只读] WorldReference 创建/校验不得暗中回写 WorldRelease')
}
for (const token of [
  'resource.area !== registered.area',
  'resource.resourceKind !== registered.resourceKind',
  'resource.resourceId !== semanticResourceId',
  'sourceManifest selected/omitted 未与 PROJECT_TABLES 完整分区',
  'capabilityProfile 与 catalog/PROJECT_TABLES 不一致',
]) {
  if (!releaseCodecSource.includes(token)) violations.push(`[㉝B世界发布反篡改] release-codec.ts 缺少 ${token}`)
}
const worldSemanticSnapshotSource = read('src/lib/world-engine/semantic-snapshot.ts')
if (!worldSemanticSnapshotSource.includes('Object.keys(manifest.records).length !== selected.size')
  || !worldSemanticSnapshotSource.includes('!Array.isArray(manifest.records[table])')) {
  violations.push('[㉝B世界包精确闭合] 导入必须要求每个 selected table 存在且与冻结 records 一致，包括空表')
}

const createProductRuntimeInstanceStart = productRuntimeInstanceSource.indexOf('export async function createProductRuntimeInstance')
const createProductRuntimeInstanceEnd = productRuntimeInstanceSource.indexOf('\nexport ', createProductRuntimeInstanceStart + 1)
const createProductRuntimeInstanceBody = createProductRuntimeInstanceStart >= 0
  ? productRuntimeInstanceSource.slice(createProductRuntimeInstanceStart, createProductRuntimeInstanceEnd > createProductRuntimeInstanceStart
    ? createProductRuntimeInstanceEnd : productRuntimeInstanceSource.length)
  : ''
const prepareFormalSessionIndex = createProductRuntimeInstanceBody.indexOf('prepareReleasedProductRuntimeSessionRecordV1({')
const atomicSessionTransactionIndex = createProductRuntimeInstanceBody.indexOf("return db.transaction('rw'")
const insertPreparedSessionIndex = createProductRuntimeInstanceBody.indexOf('insertPreparedProductRuntimeSessionV1(preparedSession)')
if (prepareFormalSessionIndex < 0 || atomicSessionTransactionIndex <= prepareFormalSessionIndex
  || insertPreparedSessionIndex <= atomicSessionTransactionIndex) {
  violations.push('[㉝B会话事务边界] 加密发布校验必须在事务外准备；事务内只能 CAS、插入已验证 session 与初始事件')
}
for (const token of [
  'prepareReleasedProductRuntimeSessionRecordV1', 'preparePreviewProductRuntimeSessionRecordV1',
  'insertPreparedProductRuntimeSessionV1', 'preparedProductRuntimeSessionsV1',
]) {
  if (!productRuntimeCoreSource.includes(token)) violations.push(`[㉝B正式会话准备] product/runtime-core.ts 缺少 ${token}`)
}

// Shared runtime owns only session/event/checkpoint mechanics. Product parsing,
// reduction, validation and branch extensions enter through one explicit
// composition root; product commands remain in product-owned modules.
if (/from\s+['"]\.\.\/(?:ttrpg|character-interaction|adventure|avg|open-world)\//.test(productRuntimeCoreSource)) {
  violations.push('[㉝B运行核心纯度] product/runtime-core.ts 不得直接依赖任何上层产品实现')
}
for (const token of [
  'parseProductOwnedRuntimeStateV1', 'applyProductOwnedRuntimeEventV1',
  'assertFrozenProductRuntimeStateV1', 'assertProductNarrativeChoiceReadyV1',
  'rebaseProductRuntimeStateForBranchV1', 'cloneProductRuntimeBranchExtensionsV1',
]) {
  if (!productRuntimeAdapterSource.includes(token)) {
    violations.push(`[㉝B产品运行适配器] runtime-product-adapters.ts 缺少 ${token}`)
  }
}
if (productRuntimeCoreSource.split('\n').length > 2400) {
  violations.push('[㉝B运行核心规模] product/runtime-core.ts 超过 2400 行，疑似重新吸收产品职责')
}
for (const file of [
  'src/lib/product/runtime-api.ts',
  'src/lib/ttrpg/runtime-api.ts',
  'src/lib/character-interaction/runtime-api.ts',
  'src/lib/adventure/runtime-api.ts',
  'src/lib/avg/runtime-api.ts',
  'src/lib/open-world/runtime-api.ts',
]) {
  if (!fs.existsSync(path.join(root, file))) violations.push(`[㉝B运行 API] 缺少 ${file}`)
}

const productMediaTypeSource = read('src/lib/types/product-media.ts')
const productReleaseMediaSource = read('src/lib/product-production/release-media.ts')
const productRuntimeMediaLibrarySource = read('src/lib/product/runtime-media-library.ts')
for (const token of [
  "ownerKind: 'release' | 'runtime'",
  'productType: ProductionProductKindV1',
  'productReleaseId: number | null',
  'productRuntimeSessionId: number | null',
]) {
  if (!productMediaTypeSource.includes(token)) violations.push(`[㉝B媒资所有权] product-media.ts 缺少 ${token}`)
}
if (!registrySrc.includes("target: 'productMediaAssets[productReleaseId]'")
  || !registrySrc.includes("target: 'productMediaAssets[productRuntimeSessionId]'")) {
  violations.push('[㉝B媒资生命周期] ProductRelease 与 ProductRuntimeSession 必须在 PROJECT_TABLES 级联各自媒资')
}
if (!productReleaseMediaSource.includes("where('[productReleaseId+assetKey+version]')")
  || productReleaseMediaSource.includes("where('[workId+assetKey+version]')")) {
  violations.push('[㉝B发布媒资隔离] 正式媒资必须按 ProductRelease 解析，禁止回退到 Work 级资产键')
}
if (!productRuntimeMediaLibrarySource.includes('productRuntimeSessionId: number')
  || !productRuntimeMediaLibrarySource.includes("ownerKind: 'runtime'")) {
  violations.push('[㉝B运行媒资隔离] 运行中新生成的媒资必须绑定具体 ProductRuntimeSession')
}
if (!currentSchemaSource.includes("STORYFORGE_DATABASE_NAME = 'storyforge-core'")
  || !currentSchemaSource.includes('STORYFORGE_SCHEMA_VERSION = 1')
  || (currentSchemaSource.match(/\.version\(/g) ?? []).length !== 1
  || currentSchemaSource.includes('.upgrade(')
  || !currentSchemaSource.includes("productMediaAssets: '++id, projectId, worldId, workId, ownerKind, productType, productReleaseId, productRuntimeSessionId, &[productReleaseId+assetKey+version], &[productRuntimeSessionId+assetKey+version]")) {
  violations.push('[㉝B唯一当前 schema] 必须使用 storyforge-core v1 单基线、零 upgrade，并保留当前根/媒资隔离索引')
}
if (!deriveImportSrc.includes('ProductMedia 必须具有唯一、有效的产品所有者')
  || !deriveImportSrc.includes("asset.ownerKind === 'release'")
  || !deriveImportSrc.includes("asset.ownerKind === 'runtime'")) {
  violations.push('[㉝B媒资导入验签] 便携导入必须拒绝无 owner、双 owner 和产品身份不一致的媒资')
}

const PRODUCT_MEDIA_WRITERS = new Set([
  'src/lib/product-production/adoption.ts',
  'src/lib/product-platform/distribution-bundle.ts',
  'src/lib/product/runtime-media-library.ts',
])
const PRODUCT_RELEASE_WRITERS = new Set([
  'src/lib/product-production/adoption.ts',
  'src/lib/product-platform/distribution-bundle.ts',
])
const PRODUCT_RUNTIME_SESSION_WRITERS = new Set([
  'src/lib/product/runtime-core.ts',
  'src/lib/product/runtime-instances.ts',
  'src/lib/ttrpg/runtime-media.ts',
  'src/lib/ttrpg/runtime-commands.ts',
  'src/lib/character-interaction/runtime-commands.ts',
  'src/lib/adventure/runtime-commands.ts',
  'src/lib/avg/runtime-commands.ts',
  'src/lib/open-world/runtime-commands.ts',
])
for (const file of walk('src')) {
  const source = read(file)
  if (/\bdb\.productMediaAssets\.(?:add|put|bulkPut|update|delete|bulkDelete)\s*\(/.test(source)
    && !PRODUCT_MEDIA_WRITERS.has(file)) {
    violations.push(`[㉝B媒资唯一写入边界] ${file}: ProductMedia 只能由发布、分发导入或会话媒资库写入`)
  }
  if (/\bdb\.productReleases\.(?:add|put|bulkPut|update|delete|bulkDelete)\s*\(/.test(source)
    && !PRODUCT_RELEASE_WRITERS.has(file)) {
    violations.push(`[㉝B发布唯一写入边界] ${file}: ProductRelease 只能由原子发布或验签分发导入写入`)
  }
  if (/\bdb\.productRuntimeSessions\.(?:add|put|bulkPut|update|delete|bulkDelete)\s*\(/.test(source)
    && !PRODUCT_RUNTIME_SESSION_WRITERS.has(file)) {
    violations.push(`[㉝B运行会话唯一写入边界] ${file}: ProductRuntimeSession 只能由运行内核或经授权的产品运行适配器写入`)
  }
}

// ARCH-05: there is no compatibility allowlist. Physical WorldRelease decoding
// is world-owned infrastructure; upper products consume only the neutral gateway.
const WORLD_RELEASE_PHYSICAL_OWNERS = new Set([
  'src/lib/context-gateway/world-release-provider.ts',
  'src/lib/world-engine/world-package.ts',
  'src/lib/types/world-release.ts',
  'src/lib/world-engine/release-codec.ts',
  'src/lib/world-engine/releases.ts',
  'src/lib/world-engine/world-reference.ts',
  'src/lib/world-engine/semantic-snapshot.ts',
])
for (const file of walk('src')) {
  const source = read(file)
  if ((source.includes('WorldReleaseManifestV3')
      || source.includes('parsePureWorldReleaseManifestV3'))
    && !WORLD_RELEASE_PHYSICAL_OWNERS.has(file)) {
    violations.push(`[㉝C世界物理边界] ${file}: 非世界基础设施不得解析物理 WorldRelease`)
  }
}
if (requirementAdaptersSource.includes('WorldReleaseManifestV3')
  || requirementAdaptersSource.includes('selectedTables')
  || requirementAdaptersSource.includes('.records')) {
  violations.push('[㉝C需求适配器中立性] 产品 requirement adapter 不得读取物理表、selectedTables 或 WorldRelease records')
}
if (productProductionServiceSource.includes("from '../world-engine/releases'")
  || productProductionServiceSource.includes('WorldRelease[]')
  || productProductionAdoptionSource.includes('db.worldReleases')) {
  violations.push('[㉝C产品世界边界] 产品生产不得获取物理 WorldRelease，只能消费中立 WorldReference catalog/source 协议')
}
const registeredTableMarkers = [...registrySrc.matchAll(/\btable:\s*db\.([A-Za-z0-9_]+)/g)]
const worldSemanticTableNames = registeredTableMarkers.flatMap((match, index) => {
  const blockEnd = registeredTableMarkers[index + 1]?.index ?? registrySrc.length
  const block = registrySrc.slice(match.index, blockEnd)
  return block.includes('worldSemantic:') ? [match[1]] : []
})
for (const directory of [
  'src/lib/product',
  'src/lib/product-production',
  'src/lib/product-platform',
  'src/lib/ttrpg',
  'src/lib/character-interaction',
  'src/lib/adventure',
  'src/lib/avg',
  'src/lib/open-world',
]) {
  for (const file of walk(directory)) {
    const source = read(file)
    if (/context-gateway\/world-release-provider/.test(source)) {
      violations.push(`[㉝C上层零物理 Provider] ${file}: 上层产品只能依赖 world-release-client/Context Gateway 中立协议`)
    }
    if (/\bdb\.worldReleases\b/.test(source)) {
      violations.push(`[㉝C上层零物理世界表] ${file}: 上层产品不得直接查询 worldReleases，必须经 WorldReference 与中立 Gateway`)
    }
    for (const tableName of worldSemanticTableNames) {
      if (new RegExp(`\\bdb\\.${tableName}\\b`).test(source)) {
        violations.push(`[㉝C上层零实时世界依赖] ${file}: 上层产品不得直接查询可变世界语义表 ${tableName}`)
      }
    }
  }
}
if (!productSourcePublicSource.includes('listWorldReferenceCatalogV1')
  || !worldReferenceSource.includes('listWorldReferenceCatalogV1')) {
  violations.push('[㉝C世界参考目录] 上层产品选择世界必须走中立、只读 WorldReference catalog')
}

const RETIRED_ARCHITECTURE_FILES = [
  'src/components/character-interaction/CharacterInteractionProductionStudio.tsx',
  'src/components/character-interaction/CharacterInteractionWorkbench.tsx',
  'src/components/node-flow/NodeModeWorkspace.tsx',
  'src/components/text-game/AdventureGameWorkbench.tsx',
  'src/components/text-game/AvgGameWorkbench.tsx',
  'src/components/text-game/NarrativeSimulationWorkbench.tsx',
  'src/components/text-game/StoryGameWorkbench.tsx',
  'src/components/text-game/TextOpenWorldWorkbench.tsx',
  'src/components/ttrpg/TtrpgProductStudio.tsx',
  'src/components/ttrpg/TtrpgProductionWorkspace.tsx',
  'src/lib/adventure/authoring.ts',
  'src/lib/avg/authoring.ts',
  'src/lib/character-interaction/authoring.ts',
  'src/lib/character-interaction/production-pipeline.ts',
  'src/lib/product-production/legacy-entry-governance.ts',
  'src/lib/narrative-simulation/authoring.ts',
  'src/lib/node-authoring/migration.ts',
  'src/lib/node-flow/executor.ts',
  'src/lib/node-flow/graph.ts',
  'src/lib/open-world/authoring.ts',
  'src/lib/product/world-package-migration.ts',
  'src/lib/text-game/authoring.ts',
  'src/lib/ttrpg/authoring.ts',
  'src/lib/ttrpg/release.ts',
  'src/lib/ttrpg/world-source.ts',
  'src/lib/types/ttrpg-production.ts',
  'src/lib/types/ttrpg-production-source.ts',
  'src/lib/types/ttrpg-world-source.ts',
  'src/lib/world-engine/release-classification.ts',
  'src/lib/world-engine/instances.ts',
  'src/lib/world-engine/product-source.ts',
  'src/lib/world-engine/product-source-contracts.ts',
  'src/lib/world-engine/product-requirement-adapters.ts',
  'src/lib/world-engine/scope-conversion.ts',
  'src/lib/world-engine/create-workspace.ts',
  'src/lib/world-engine/ownership.ts',
  'src/lib/world-engine/scope.ts',
  'src/lib/world-engine/work-kind.ts',
  'src/lib/world-engine/works.ts',
  'src/lib/world-engine/lifecycle.ts',
  'src/lib/product-production/vertical-slice.ts',
  'src/lib/narrative-simulation/harness.ts',
  'src/lib/narrative-simulation/runtime.ts',
  'src/lib/types/narrative-simulation.ts',
  'src/lib/product/world-identity.ts',
  'src/lib/product/world-package.ts',
  'src/lib/product/_runtime-kernel.ts',
  'src/lib/reference-analysis/legacy-bridge.ts',
  'src/lib/ai/adapters/worldview-adapter.ts',
]
for (const file of RETIRED_ARCHITECTURE_FILES) {
  if (fs.existsSync(path.join(root, file))) violations.push(`[㉝C旧架构文件] ${file} 已退役，不得恢复`)
}

for (const file of walk('src/lib/world-engine')) {
  const source = read(file)
  if (/\.\.\/(?:product|product-production|simulation|text-game|ttrpg|character-interaction|adventure|avg|open-world)\//.test(source)
    || /\bdb\.(?:productProductions|productReleases|productBuilds|productRuntimeSessions|productMediaAssets|productMediaBlobs|mediaBlobObjects|ttrpgRulePacks)\b/.test(source)) {
    violations.push(`[㉝C世界引擎纯度] ${file}: 世界引擎不得依赖上层产品、媒资或运行会话`)
  }
}

for (const file of walk('src/lib/workspace')) {
  const source = read(file)
  if (/\.\.\/(?:world-engine|product|product-production|product-platform|simulation|text-game|ttrpg|character-interaction|adventure|avg|open-world)\//.test(source)) {
    violations.push(`[㉝C共享 Workspace 纯度] ${file}: 中立 Workspace/Work/Scope 层不得反向依赖世界引擎或具体产品`)
  }
}

const retiredTableTokens = [
  'gameDefinitions', 'adventureModules', 'avgMediaAssets', 'avgMediaBlobs',
  'avgPresentationModules', 'narrativeSimulationModules', 'openWorldModules',
  'ttrpgCampaignModules', 'worldReleaseMigrations',
]
for (const file of walk('src')) {
  if (file === 'src/lib/db/schema.ts') continue
  const source = read(file)
  for (const token of retiredTableTokens) {
    const accessesRetiredStore = new RegExp(`\\bdb\\.${token}\\b`).test(source)
    const registersRetiredStore = new RegExp(`\\b(?:name|target):\\s*['\"]${token}['\"]`).test(source)
    if (accessesRetiredStore || registersRetiredStore) {
      violations.push(`[㉝C旧表清场] ${file}: 已删除表 ${token} 不得存在于当前源码`)
    }
  }
}

// Current source and tests must speak only the active Product*/runtime protocol.
const currentArchitectureFiles = [
  ...walkIncludingTests('src'),
  ...walkIncludingTests('tests'),
]
const retiredArchitecturePatterns = [
  ['旧 Game 生产协议', /\b(?:GameProduction|GameBuild|GameRelease|GameRuntimePackage|PlayableWorld)\b/],
  ['旧 Game 绑定字段', /\b(?:gameProductionId|gameBuildId|gameReleaseId|gameDefinitionId)\b/],
  ['旧 Simulation 运行协议', /\b(?:SimulationSession|SimulationRuntime|SimulationEvent|SimulationCheckpoint|NarrativeSimulation)\b/],
  ['旧产品身份', /\b(?:storygame|chatgame|textsimulation|textworld)\b/i],
  ['旧架构导入路径', /(?:game-production|game-platform|narrative-simulation|lib\/simulation|components\/simulation|stores\/simulation)/],
  ['旧 Project 世界身份镜像', /\b(?:workspacePurposeDecision|projectCompatibilityMirror)\b/],
  ['旧运行候选绑定', /\b(?:narrativeModuleExportId|draftSnapshotHash)\b/],
  ['旧 Gateway 过渡路径', /\b(?:legacy-or-shadow|compareContextGatewayShadowReadV1)\b|context-gateway\/shadow-read/],
  ['旧项目级作用域旁路', /\b(?:isLegacyReadScope|legacyDefault|compat-project)\b/],
  ['旧内容写入字段', /\b(?:storyLines|historyLine|worldEvents|politicsEconomyCulture)\b/],
  ['产品发布误属文字游戏', /types\/text-game['"][^\n]*Product(?:Release|RuntimePackage|WorldSource)/],
  ['正式产品开发夹具身份', /\bdevelopment-fixture\b/],
  ['旧状态卡迁移谓词', /\bmigratedStateCard\b/],
  ['旧作品学习模块别名', /\bmaster-studies\b/],
  ['旧数据库名称', /indexedDB\.open\(\s*['"]storyforge['"]\s*\)/],
  ['旧多世界过渡符号', /\b(?:migrateToMultiWorld|stampPrimaryWorld)\b/],
  ['未声明的大纲锁定字段', /\b(?:outlineNode|target)\.locked\b/],
]
for (const file of currentArchitectureFiles) {
  const source = read(file)
  for (const [label, pattern] of retiredArchitecturePatterns) {
    if (pattern.test(source) || pattern.test(file)) {
      violations.push(`[㉝C现行树零旧协议] ${file}: ${label}不得存在于当前源码或测试`)
    }
  }
}

const workflowTypeSource = read('src/lib/types/workflow.ts')
const workflowGraphSource = read('src/lib/workflow/graph.ts')
const workflowRunnerSource = read('src/components/settings/prompt/WorkflowRunner.tsx')
const workflowHelpersSource = read('src/components/settings/prompt/workflow-helpers.ts')
const worldviewTypeSource = read('src/lib/types/worldview.ts')
const worldviewInterfaceSource = worldviewTypeSource.slice(
  worldviewTypeSource.indexOf('export interface Worldview'),
  worldviewTypeSource.indexOf('export interface StoryCore'),
)
if (!/graph:\s*PromptWorkflowGraph\b/.test(workflowTypeSource)
  || /graph\?:\s*PromptWorkflowGraph\b/.test(workflowTypeSource)) {
  violations.push('[㉞工作流显式图] PromptWorkflow.graph 必须是当前持久化协议的必填字段')
}
if (/createLegacyWorkflowGraph|workflow\.graph\s*\?\?|workflow\.graph\s*==\s*null/.test(workflowGraphSource)
  || /usesExplicitGraph|legacyPreviousOutput|旧工作流/.test(workflowRunnerSource)
  || /prevOutput:\s*string|旧线性工作流|旧参数兼容/.test(workflowHelpersSource)) {
  violations.push('[㉞工作流单轨执行] 当前 Runner 只能消费显式 DAG，不得按步骤相邻关系降级执行')
}
if (/(?:^|\n)\s*(?:geography|history|society|culture|economy|rules)\??:\s*string\b/.test(worldviewInterfaceSource)
  || fs.existsSync(path.join(root, 'src/lib/migrations'))
  || fs.existsSync(path.join(root, 'tests/migrations/legacy'))) {
  violations.push('[㉞当前内容单源] Worldview 不得重新吸收旧聚合字段，现行树也不得保留旧数据库迁移实现或夹具')
}
for (const token of [
  'gameDefinitionId', 'currentGameDefinitionId', 'adoptedGameDefinitionId',
  'ttrpgBuildId', 'narrativeModuleExportId', 'draftSnapshotHash',
]) {
  for (const file of walk('src')) {
    if (file === 'src/lib/db/schema.ts') continue
    if (new RegExp(`\\b${token}\\b`).test(read(file))) {
      violations.push(`[㉝C旧绑定清场] ${file}: 已删除运行/发布绑定 ${token} 不得恢复`)
    }
  }
}
for (const file of walk('src')) {
  const source = read(file)
  if (source.includes('product-production.consultation-source')) {
    violations.push(`[㉝C旧上下文来源] ${file}: 已退役的 consultation-source 不得恢复`)
  }
  if (source.includes('storyforge.ttrpg-world-source-catalog')) {
    violations.push(`[㉝C旧跑团目录] ${file}: 跑团不得恢复独立世界目录旁路`)
  }
}

const CURRENT_PRODUCT_PLAYER_STORES = [
  'src/stores/character-interaction-player.ts',
  'src/stores/adventure-game-player.ts',
  'src/stores/avg-game-player.ts',
  'src/stores/text-open-world-player.ts',
]
for (const file of CURRENT_PRODUCT_PLAYER_STORES) {
  const source = read(file)
  if (!source.includes('verifyProductRuntimeSessionSourceV1')
    && !source.includes('resolveProductRuntimeSource')) {
    violations.push(`[㉝C统一预览运行] ${file}: 玩家端必须同时验证 Product Build Preview 与 ProductRelease`)
  }
  if (/session\.productReleaseId\s*==\s*null[^\n]*(?:throw|return)/.test(source)
    || /row\.productReleaseId\s*!=\s*null\s*&&/.test(source)) {
    violations.push(`[㉝C统一预览运行] ${file}: 不得把统一 Product Build Preview 当作旧存档排除`)
  }
}

// The deterministic no-provider acceptance fixture is test-only. It must never
// become a second production entry or be imported by UI.
const productionServiceSource = read('src/lib/product-production/service.ts')
const productionStudioSource = read('src/components/product/ProductProductionStudio.tsx')
if (productionServiceSource.includes('runProductProductionPrototypeV1')
  || productionServiceSource.includes("from './vertical-slice'")) {
  violations.push('[㊌C唯一生产入口] service.ts 不得暴露确定性验收夹具为正式产品入口')
}
if (!productionStudioSource.includes('runAuthorizedProductProductionV1')) {
  violations.push('[㊌C唯一生产入口] 上层产品工作台必须调用正式 durable production Harness')
}
for (const dir of UI_DIRS) {
  for (const file of walk(dir)) {
    if (/product-production\/vertical-slice/.test(read(file))) {
      violations.push(`[㊌C测试夹具隔离] ${file}: UI 不得导入确定性纵切验收夹具`)
    }
  }
}

for (const file of walk('src')) {
  if (file === 'src/lib/db/schema.ts') continue
  const source = read(file)
  const retiredIdentityPatterns = [
    ['storygame', /storygame/i],
    ['chatgame', /chatgame/i],
    ['textadventure', /['"]textadventure['"]|TEXTADVENTURE/],
    ['textsimulation', /textsimulation/i],
    ['textworld', /(?:['"]textworld['"]|TextWorld|TEXTWORLD)/],
  ]
  for (const [retiredIdentity, pattern] of retiredIdentityPatterns) {
    if (pattern.test(source) || pattern.test(path.basename(file))) {
      violations.push(`[㉝C旧产品身份] ${file}: ${retiredIdentity} 的旧枚举、符号、文件名和展示文案只能存在于单向数据库升级逻辑`)
    }
  }
  if (/story\s+game/i.test(source)) {
    violations.push(`[㉝C旧产品展示] ${file}: STORY GAME 已退役，文字游戏只能展示三种现行产品`)
  }
  if (/['\"]narrative-simulation['\"]/.test(source)) {
    violations.push(`[㉝C旧产品身份] ${file}: narrative-simulation 已退役；文字开放世界内部状态推演必须使用自身命名空间`)
  }
  if (/storyforge\.world-product-production-handoff/.test(source)) {
    violations.push(`[㉝C旧交接协议] ${file}: 必须使用 upper-product-production-handoff v3`)
  }
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
  "status: 'experimental'", "'internal'", 'requiresWorldReference',
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
  'addRelation', "item.table === 'worldGroupLinks'",
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

// ── ㊲ Headless 管理边界不得进入正式产品 UI ──
for (const dir of UI_DIRS) {
  for (const file of walk(dir)) {
    const source = read(file)
    if (/ownership-scope-conversion/.test(source)) {
      violations.push(`[㊲headless 边界] ${file}: 产品 UI 不得导入任意 scope 转换服务`)
    }
  }
}
for (const file of [
  'src/lib/world-engine/mist-harbor-demo.ts',
  'src/lib/world-engine/mist-harbor-roadshow-authoring.ts',
  'src/lib/world-engine/mist-harbor-roadshow-story.ts',
]) {
  if (fs.existsSync(path.join(root, file))) violations.push(`[㊲演示清场] ${file} 已退役，不得恢复`)
}

// ── ㊳ 当前路由必须由代码事实反向约束架构文档 ──
const appRouteSource = read('src/App.tsx')
const architectureOverviewSource = read('docs/ARCHITECTURE.md')
const appRoutes = [...appRouteSource.matchAll(/<Route\s+path="([^"]+)"/g)]
  .map(match => match[1])
  .sort()
const documentedRoutes = [...architectureOverviewSource.matchAll(/^- `([^`]+)`：/gm)]
  .map(match => match[1])
  .sort()
if (JSON.stringify(appRoutes) !== JSON.stringify(documentedRoutes)) {
  violations.push(`[㊳路由文档同源] App 路由 ${JSON.stringify(appRoutes)} 与 ARCHITECTURE 路由 ${JSON.stringify(documentedRoutes)} 不一致`)
}

// ── ㊴ 当前架构硬切换：LocalWorkspace 壳与 Work 作品数据必须永久分离 ──
const projectTypeAst = parseSource('src/lib/types/project.ts')
const ownershipTypeAst = parseSource('src/lib/types/world-ownership.ts')
const declaredInterfaceKeys = (sourceFile, interfaceName) => {
  let keys = null
  visit(sourceFile, node => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      keys = node.members.map(propertyName).filter(value => value != null)
    }
  })
  return keys
}
const expectedProjectKeys = [
  'id', 'workspaceUid', 'workspacePurpose', 'name', 'enableMultiWorld',
  'activeWorldId', 'activeWorkId', 'productPlatformOptIns', 'createdAt', 'updatedAt',
].sort()
const actualProjectKeys = declaredInterfaceKeys(projectTypeAst, 'Project')?.sort() ?? null
if (!actualProjectKeys || JSON.stringify(actualProjectKeys) !== JSON.stringify(expectedProjectKeys)) {
  violations.push(`[㊴Project 壳单源] Project 只能拥有 ${expectedProjectKeys.join('、')}；当前为 ${actualProjectKeys?.join('、') ?? '未声明'}`)
}

const requiredWorkOwnedKeys = [
  'title', 'description', 'genres', 'customGenre', 'status', 'targetWordCount',
  'currentWordCount', 'coverImage', 'writingStyleId', 'methodologyId',
  'includeCultivationProgressInAI', 'activeCharacterDrivenPlanId', 'activeNarrativeModuleId',
]
const actualWorkKeys = new Set(declaredInterfaceKeys(ownershipTypeAst, 'Work') ?? [])
for (const key of requiredWorkOwnedKeys) {
  if (!actualWorkKeys.has(key)) violations.push(`[㊴Work 作品单源] Work 缺少唯一归属字段 ${key}`)
}

const retiredProjectWorkSymbols = [
  'projectActiveWorkProjection', 'projectProjectionWithoutWork',
  'projectProjectionWithoutWorld', 'updateProjectAndActiveWork',
  'CreateProjectInput', 'PromptProjectField', 'projectField', 'projectStatus',
  'readAgentProjectStatus', 'read_project_status', 'ProjectStatus', 'PROJECT_STATUS_LABELS',
]
for (const file of currentArchitectureFiles) {
  const source = read(file)
  for (const symbol of retiredProjectWorkSymbols) {
    if (new RegExp(`\\b${symbol}\\b`).test(source)) {
      violations.push(`[㊴Project/Work 旧镜像] ${file}: 已退役符号 ${symbol} 不得恢复`)
    }
  }
}

const backupTrustSource = read('src/lib/export/backup-trust.ts')
const registryImportSource = read('src/lib/export/registry-import.ts')
const gatewayInputSource = read('src/lib/agent/context-gateway-input.ts')
const workspaceProjectionSource = read('src/lib/memory/workspace-projection.ts')
const workspaceIdentitySourceV1 = read('src/lib/workspace/identity.ts')
const workspaceOwnershipSourceV1 = read('src/lib/workspace/ownership.ts')
for (const token of ['CURRENT_PROJECT_EXPORT_KEYS', 'CURRENT_WORLD_EXPORT_KEYS', 'CURRENT_WORK_EXPORT_KEYS', 'inspectExactKeys']) {
  if (!backupTrustSource.includes(token)) violations.push(`[㊴严格备份边界] backup-trust.ts 缺少 ${token}`)
}
if (/\.\.\.\s*(?:data\.project|projectData)/.test(registryImportSource)
  || !registryImportSource.includes('workspacePurpose: projectData.workspacePurpose')
  || !registryImportSource.includes('activeWorkId: null')) {
  violations.push('[㊴严格导入边界] Project 必须按当前壳字段显式构造，禁止展开外部项目对象')
}
if (!gatewayInputSource.includes("works: 'workStatus'")
  || gatewayInputSource.includes("projects: 'workStatus'")) {
  violations.push('[㊴Work 上下文单源] workStatus 必须从 works 表读取，禁止回退到 projects')
}
if (!workspaceIdentitySourceV1.includes('isWorkspaceScopeCode')
  || !workspaceIdentitySourceV1.includes('isPublicWorldCode')
  || !workspaceOwnershipSourceV1.includes('isCurrentWorldCode(world.identityKind, world.code)')) {
  violations.push('[㊴当前根身份] Workspace/World/Work 根必须校验与 identityKind 匹配的当前稳定编号')
}
const portableRootReader = workspaceProjectionSource.match(/async function readCurrentPortableRoots[\s\S]*?\n}\n/)?.[0] ?? ''
if (!portableRootReader
  || /generateWorkspaceUid|generateWorkCode|\.update\s*\(/.test(portableRootReader)
  || /chapter[^\n]*workId[^\n]*\?\?[^\n]*activeWorkId/.test(workspaceProjectionSource)) {
  violations.push('[㊴语义文件身份硬门] 文件投影只能验证当前根与精确 Work owner，不得回填身份或借活动指针补 owner')
}
if (!registrySrc.includes("target: 'works[activeCharacterDrivenPlanId]'")) {
  violations.push('[㊴作品叙事计划归属] activeCharacterDrivenPlanId 引用必须挂在 Work，而不是 Project')
}
for (const file of [
  'src/lib/agent/character-copilot.ts',
  'src/lib/agent/story-arc-copilot.ts',
  'src/lib/agent/worldview-field-copilot.ts',
  'src/lib/ai/relation-extractor.ts',
  'src/lib/export/text-export.ts',
]) {
  const source = read(file)
  if (/\bproject\??\.name\b/.test(source)
    || /\bproject\??\.(?:description|genres|status|targetWordCount|currentWordCount)\b/.test(source)) {
    violations.push(`[㊴作品语义读取] ${file}: 创作上下文与作品导出必须读取 Work，不得读取 Project 镜像`)
  }
}

const genreMetadataSource = read('src/lib/ai/genre-metadata.ts')
if (/buildGenreConstraintContext\s*\(\s*genreIds:\s*string\s*\|\s*string\[\]/.test(genreMetadataSource)
  || genreMetadataSource.includes('GENRE_METADATA_ALIASES')
  || genreMetadataSource.includes('normalizeGenreMetadataId')) {
  violations.push('[㊴题材当前格式] 题材上下文只接受 Work.genres 数组；不得恢复旧单值输入或别名兼容命名')
}

const reconciliationTableSource = read('src/components/editor/ReconciliationTable.tsx')
if (/key\s*===\s*config\.key\s*\|\|/.test(reconciliationTableSource)
  || reconciliationTableSource.includes('section-only key')) {
  violations.push('[㊴对账当前格式] 章节对账只接受 section:action 键，不得恢复 section-only 回退')
}

// ── ㊵ 正式 Master Harness 只接受当前 Skill 身份与领域候选协议 ──
const currentMasterOrchestratorSource = read('src/lib/agent/orchestrator.ts')
const masterVerificationSource = read('src/lib/agent/run/master-step-verification.ts')
const masterCandidateHashSource = read('src/lib/agent/run/master-candidate-hash.ts')
const skillExecutionModeBlock = proseSkillRegistrySource.slice(
  proseSkillRegistrySource.indexOf('export type AgentSkillExecutionModeV1'),
  proseSkillRegistrySource.indexOf('export interface AgentSkillInputPolicyV1'),
)
if (fs.existsSync(path.join(root, 'src/lib/agent/world-origin-copilot.ts'))
  || proseSkillRegistrySource.includes("id: 'world-origin.complete'")
  || /\|\s*'complete'/.test(skillExecutionModeBlock)
  || /'world-origin':\s*new Set\(\[[^\]]*'complete'/.test(proseSkillRegistrySource)) {
  violations.push('[㊵世界候选单轨] 通用 world-origin.complete 与 complete 执行模式已退役，不得恢复')
}
if (!/export interface MasterAgentTask\s*\{[\s\S]*?skillId:\s*AgentSkillId/.test(currentMasterOrchestratorSource)
  || !/export interface MasterCandidatePayload\s*\{[\s\S]*?skillId:\s*AgentSkillId/.test(currentMasterOrchestratorSource)
  || !masterDurableSource.includes('readRequiredSkillId')
  || masterDurableSource.includes('readOptionalSkillId')
  || !masterDurableSource.includes("['id', 'agentId', 'skillId', 'instruction', 'dependsOn']")) {
  violations.push('[㊵Skill 身份必填] 正式计划、候选与恢复必须冻结并严格校验当前 Skill ID')
}
if (!masterAdoptionSource.includes('世界领域候选使用了未登记的当前 Skill')
  || !masterVerificationSource.includes('世界领域候选使用了未登记的当前 Skill')) {
  violations.push('[㊵世界候选闭集] 世界候选验证与采纳必须拒绝未登记 Skill，不得回退到通用文本协议')
}
for (const field of ['contextManifestHash', 'semanticReview', 'teamBudgetEvidence']) {
  if (!masterCandidateHashSource.includes(`${field}: _${field}`)) {
    violations.push(`[㊵候选证据无环] Gateway 候选身份必须排除后置证据字段 ${field}`)
  }
}

// ── ㊶ 当前 schema 必须在任何 Store 初始化前 fail closed ──
const applicationBootstrapSource = read('src/main.tsx')
const applicationBootstrapAst = parseSource('src/main.tsx')
let currentSchemaCallInsideTry = false
let registryCallInsideTry = false
visit(applicationBootstrapAst, node => {
  if (!ts.isTryStatement(node)) return
  visit(node.tryBlock, child => {
    if (!ts.isCallExpression(child) || !ts.isIdentifier(child.expression)) return
    if (child.expression.text === 'openCurrentSchema') currentSchemaCallInsideTry = true
    if (child.expression.text === 'validateRegistry') registryCallInsideTry = true
  })
})
const currentSchemaOpenIndex = applicationBootstrapSource.indexOf('await openCurrentSchema()')
const registryValidationIndex = applicationBootstrapSource.indexOf('validateRegistry()')
const promptStoreInitIndex = applicationBootstrapSource.indexOf('usePromptStore.getState().init()')
if (registryValidationIndex < 0
  || currentSchemaOpenIndex < 0
  || promptStoreInitIndex < 0
  || registryValidationIndex > promptStoreInitIndex
  || currentSchemaOpenIndex > promptStoreInitIndex
  || registryCallInsideTry
  || currentSchemaCallInsideTry
  || /validateRegistry\s*\(\s*\{/.test(applicationBootstrapSource)
  || !applicationBootstrapSource.includes('void bootstrap().catch(')) {
  violations.push('[㊶当前架构启动硬门] 三注册表与 schema 校验必须先于 Store 初始化、不得被局部 catch 吞掉，启动失败必须进入显式终态')
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
