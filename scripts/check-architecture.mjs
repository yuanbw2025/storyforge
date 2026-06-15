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
const registrySrc = read('src/lib/registry/project-tables.ts')
const jsonExportSrc = read('src/lib/export/json-export.ts')
const specChunks = registrySrc
  .split(/\n\s*\n/)
  .filter(chunk => chunk.includes('table: db.') && chunk.includes('name:'))

for (const chunk of specChunks) {
  if (!/\bexportable:\s*true\b/.test(chunk)) continue
  const name = chunk.match(/\bname:\s*'([^']+)'/)?.[1]
  if (!name || name === 'projects') continue

  const interfaceRe = new RegExp(`\\n\\s*${name}\\??\\s*:`)
  const outputRe = new RegExp(`\\n\\s*${name}\\s*:`)
  const importRe = new RegExp(`\\bdata\\.${name}\\b`)

  if (!interfaceRe.test(jsonExportSrc)) {
    violations.push(`[⑤导出覆盖] src/lib/export/json-export.ts: ProjectExportData 缺少 exportable 表 \`${name}\``)
  }
  if (!outputRe.test(jsonExportSrc)) {
    violations.push(`[⑤导出覆盖] src/lib/export/json-export.ts: exportProjectJSON 返回对象缺少 \`${name}\``)
  }
  if (!importRe.test(jsonExportSrc)) {
    violations.push(`[⑤导出覆盖] src/lib/export/json-export.ts: importProjectJSON 未读取 \`data.${name}\``)
  }
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

// ── 报告 ──
if (violations.length) {
  console.error('[architecture] ❌ 发现反模式违规(违反 CLAUDE.md 三注册表铁律):\n')
  for (const v of violations) console.error('  ' + v)
  console.error(`\n共 ${violations.length} 处。修复方式见 /CLAUDE.md「动手前的四问」。`)
  process.exit(1)
} else {
  console.log('[architecture] ✅ ok: 无反模式违规(三注册表铁律守住)。')
}
