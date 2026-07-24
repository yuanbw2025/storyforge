/* global console, process */

/**
 * AI 行为说明书自动生成器(Phase 3.1)
 *
 * 替代手写版 AI-FUNCTIONS-MANUAL.md(曾有 21 处 prompt key 错)。
 * 从代码扫描以下事实源,生成 docs/AI-FUNCTIONS-MANUAL.generated.md:
 *   ① PromptModuleKey 枚举          (src/lib/types/prompt.ts)
 *   ② prompt 种子模板               (src/lib/ai/prompt-seeds.ts) — key/name/description/variables
 *   ③ CONTEXT_SOURCES 上下文源       (src/lib/registry/context-sources.ts) — key/label/scope/layer
 *   ④ FIELD_REGISTRY 可写字段        (src/lib/registry/field-registry.ts) — target/field/aliases
 *   ⑤ AI 调用点 category             (src/components, src/lib) — category + 文件位置
 *
 * 用 TypeScript AST 解析声明性事实，不执行应用代码/IndexedDB，CI 友好。
 *
 * 用法:
 *   node scripts/generate-ai-manual.mjs          # 生成
 *   node scripts/generate-ai-manual.mjs --check   # 校验(生成结果与已提交文件一致,不一致退出码 1)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'docs/AI-FUNCTIONS-MANUAL.generated.md')

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const PROMPT_SEED_FILES = [
  'src/lib/ai/prompt-seeds-core.ts',
  'src/lib/ai/prompt-seeds-tools.ts',
  'src/lib/ai/prompt-seeds-genre-packs.ts',
  'src/lib/ai/prompt-seeds-genre-packs-extended.ts',
  'src/lib/ai/prompt-seeds-novel.ts',
]

function parseSource(rel) {
  return ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
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

function booleanValue(node) {
  if (node?.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node?.kind === ts.SyntaxKind.FalseKeyword) return false
  return null
}

function numberValue(node, sourceFile) {
  if (!node || !ts.isNumericLiteral(node)) return null
  return Number(node.getText(sourceFile).replaceAll('_', ''))
}

function stringArrayValue(node) {
  if (!node || !ts.isArrayLiteralExpression(node)) return []
  return node.elements.map(stringValue).filter(value => value != null)
}

// ── ① PromptModuleKey 枚举 ──
function extractModuleKeys() {
  const sourceFile = parseSource('src/lib/types/prompt.ts')
  const keys = []
  visit(sourceFile, node => {
    if (!ts.isTypeAliasDeclaration(node) || node.name.text !== 'PromptModuleKey') return
    visit(node.type, child => {
      if (ts.isLiteralTypeNode(child) && ts.isStringLiteral(child.literal)) {
        keys.push(child.literal.text)
      }
    })
  })
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index)
  if (duplicates.length) {
    throw new Error(`PromptModuleKey 重复声明: ${[...new Set(duplicates)].join(', ')}`)
  }
  return keys
}

// ── ② prompt 种子 ──
function extractSeeds() {
  const seeds = []
  for (const rel of PROMPT_SEED_FILES) {
    const sourceFile = parseSource(rel)
    visit(sourceFile, node => {
      if (!ts.isObjectLiteralExpression(node)) return
      const key = stringValue(objectProperty(node, 'moduleKey')?.initializer)
      if (!key) return
      seeds.push({
        key,
        name: stringValue(objectProperty(node, 'name')?.initializer) ?? '',
        description: stringValue(objectProperty(node, 'description')?.initializer) ?? '',
        variables: stringArrayValue(objectProperty(node, 'variables')?.initializer),
        genres: stringArrayValue(objectProperty(node, 'genres')?.initializer),
        isActive: booleanValue(objectProperty(node, 'isActive')?.initializer),
        source: rel,
      })
    })
  }
  return seeds
}

// ── ③ CONTEXT_SOURCES ──
function extractContextSources() {
  const out = []
  const sourceFile = parseSource('src/lib/registry/context-sources.ts')
  visit(sourceFile, node => {
    if (!ts.isObjectLiteralExpression(node)) return
    const key = stringValue(objectProperty(node, 'key')?.initializer)
    const budget = numberValue(objectProperty(node, 'budgetTokens')?.initializer, sourceFile)
    if (!key || budget == null) return
    out.push({
      key,
      label: stringValue(objectProperty(node, 'label')?.initializer) ?? '',
      scope: stringValue(objectProperty(node, 'scope')?.initializer) ?? '',
      layer: stringValue(objectProperty(node, 'layer')?.initializer) ?? '',
      budget: String(budget),
    })
  })
  return out
}

// ── ④ FIELD_REGISTRY 可写字段(target → field 列表) ──
function extractFields() {
  const sourceFile = parseSource('src/lib/registry/field-registry.ts')
  const byTarget = {}
  const helpers = new Set(['text', 'longtext', 'num', 'bool', 'json', 'object', 'arr', 'enumeration', 'enumField', 'field'])
  visit(sourceFile, node => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || !helpers.has(node.expression.text)) return
    const target = stringValue(node.arguments[0])
    const field = stringValue(node.arguments[1])
    if (target && field) (byTarget[target] ??= new Set()).add(field)
  })
  for (const target of Object.keys(byTarget)) {
    byTarget[target] = [...byTarget[target]].sort()
  }
  return byTarget
}

function extractAdoptionExtensions() {
  const sourceFile = parseSource('src/lib/registry/adoption-schema.ts')
  const extensions = []
  visit(sourceFile, node => {
    if (!ts.isObjectLiteralExpression(node)) return
    const id = stringValue(objectProperty(node, 'id')?.initializer)
    const policyRegistry = stringValue(objectProperty(node, 'policyRegistry')?.initializer)
    if (!id || !policyRegistry) return
    extensions.push({
      id,
      target: stringValue(objectProperty(node, 'target')?.initializer) ?? '',
      policyRegistry,
      entrypoints: stringArrayValue(objectProperty(node, 'entrypoints')?.initializer),
      reviewAfter: stringValue(objectProperty(node, 'reviewAfter')?.initializer) ?? '',
    })
  })
  return extensions
}

// ── ⑤ AI 调用点 category ──
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
      if (ch === '"' || ch === "'" || ch === '`') quote = ch
      else if (ch === '(') depth++
      else if (ch === ')') {
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

function extractAiCalls() {
  const out = {}
  const uncategorized = []
  const dynamic = []
  const dirs = ['src/components', 'src/hooks', 'src/lib']
  const walk = (dir) => {
    // 用 path.join(root, dir) 拼绝对路径供 fs 读取（Node 在 Win 上接受混合斜杠）；
    // 但累加用于 markdown 输出的相对路径必须强制 POSIX 风格，否则 Windows 上生成的
    // manual 是 `src\\components\\...`，Linux CI 跑 --check 时扫到 `src/components/...`，
    // 对比立刻失败。这里统一走 POSIX 分隔符，保证跨平台输出一致。
    for (const ent of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${ent.name}`
      if (ent.isDirectory()) walk(rel)
      else if (/\.(ts|tsx)$/.test(ent.name)) {
        const src = read(rel)
        for (const callee of ['ai.start', 'chat', 'streamChat']) {
          for (const call of findCallRanges(src, callee)) {
            const lineStart = src.lastIndexOf('\n', call.start) + 1
            const lineEnd = src.indexOf('\n', call.start)
            const lineText = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd).trim()
            if (lineText.startsWith('//') || lineText.startsWith('*')) continue
            if (AI_META_FORWARDERS.has(rel) && /\bmeta\b/.test(call.text)) continue
            if (rel === 'src/lib/ai/client.ts') continue
            const line = src.slice(0, call.start).split('\n').length
            const literal = call.text.match(/category:\s*'([a-zA-Z0-9._-]+)'/)
            if (literal) {
              ;(out[literal[1]] ??= new Set()).add(`${rel}:${line}`)
              continue
            }
            if (/\bcategory\s*:/.test(call.text)) {
              dynamic.push(`${rel}:${line} · ${callee}`)
            } else {
              uncategorized.push(`${rel}:${line} · ${callee}`)
            }
          }
        }
      }
    }
  }
  dirs.forEach(walk)
  return { byCategory: out, uncategorized, dynamic }
}

function buildMarkdown() {
  const keys = extractModuleKeys()
  const seeds = extractSeeds()
  const sources = extractContextSources()
  const fields = extractFields()
  const adoptionExtensions = extractAdoptionExtensions()
  const aiCallScan = extractAiCalls()
  const aiCalls = aiCallScan.byCategory
  const seedsByKey = new Map(keys.map(key => [key, seeds.filter(seed => seed.key === key)]))

  const lines = []
  lines.push('# AI 行为说明书（自动生成 · 请勿手动编辑）')
  lines.push('')
  lines.push('> 由 `scripts/generate-ai-manual.mjs` 从代码扫描生成。')
  lines.push('> 修改 AI 行为后请运行 `npm run gen:ai-manual` 重新生成。CI 用 `npm run check:ai-manual` 校验一致性。')
  lines.push('> 语义注解(每个动作的业务意图/坑)写在 `AI-FUNCTIONS-MANUAL.semantic.md`(手工维护)。')
  lines.push('')
  lines.push('---')
  lines.push('')

  // 一、Prompt 模板清单
  lines.push('## 一、Prompt 模板清单（PromptModuleKey 事实源）')
  lines.push('')
  lines.push(`共 ${keys.length} 个唯一 moduleKey，${seeds.length} 条内置模板定义。`)
  lines.push('')
  lines.push('| moduleKey | 模板数 | 代表名称 | 说明 | 读取变量 |')
  lines.push('|---|---:|---|---|---|')
  for (const k of keys) {
    const candidates = seedsByKey.get(k) ?? []
    const s = candidates.find(seed => seed.genres.length === 0 && seed.isActive !== false)
      ?? candidates.find(seed => seed.isActive !== false)
      ?? candidates[0]
    const vars = s?.variables?.length ? '`' + s.variables.join('` `') + '`' : '—'
    lines.push(`| \`${k}\` | ${candidates.length} | ${s?.name ?? '—'} | ${s?.description ?? '—'} | ${vars} |`)
  }
  lines.push('')

  // 二、上下文源
  lines.push('## 二、上下文源清单（CONTEXT_SOURCES · AI 读什么）')
  lines.push('')
  lines.push(`共 ${sources.length} 个上下文源。assembleContext({ sourceKeys }) 按 key 装配。`)
  lines.push('')
  lines.push('| key | 标签 | 作用域 | 层级 | 预算(token) |')
  lines.push('|---|---|---|---|---|')
  for (const s of sources) {
    lines.push(`| \`${s.key}\` | ${s.label} | ${s.scope} | ${s.layer} | ${s.budget} |`)
  }
  lines.push('')
  lines.push('> 层级裁剪顺序:超预算时 L3 → L2 → L1 依次裁剪,L0 永不裁剪。')
  lines.push('')

  // 三、可写字段
  lines.push('## 三、AI 可写字段（FIELD_REGISTRY · adopt 写什么）')
  lines.push('')
  lines.push('AI 输出经 `adopt({ target, data })` 写回,只有这里登记的字段可写(别名自动归一)。')
  lines.push('')
  lines.push('| 目标表 | 可写字段 |')
  lines.push('|---|---|')
  for (const target of Object.keys(fields).sort()) {
    lines.push(`| \`${target}\` | ${fields[target].map(f => '`' + f + '`').join(' ')} |`)
  }
  lines.push('')

  lines.push('### 领域写回扩展（不是第二套通用 adopt）')
  lines.push('')
  lines.push('| ID | 目标表 | 领域策略注册表 | 唯一入口 | 复审日期 |')
  lines.push('|---|---|---|---|---|')
  for (const extension of adoptionExtensions) {
    lines.push(`| \`${extension.id}\` | \`${extension.target}\` | \`${extension.policyRegistry}\` | ${extension.entrypoints.map(item => `\`${item}\``).join('<br/>')} | ${extension.reviewAfter} |`)
  }
  lines.push('')

  // 四、AI 调用点
  lines.push('## 四、AI 调用点（消耗统计 category · 在哪触发)')
  lines.push('')
  lines.push(`共 ${Object.keys(aiCalls).length} 个 category。`)
  lines.push(`未分类调用: ${aiCallScan.uncategorized.length} 个。动态 category 调用: ${aiCallScan.dynamic.length} 个。`)
  lines.push('')
  lines.push('| category | 触发文件 |')
  lines.push('|---|---|')
  for (const cat of Object.keys(aiCalls).sort()) {
    const files = [...aiCalls[cat]].sort().map(f => `\`${f}\``).join('<br/>')
    lines.push(`| \`${cat}\` | ${files} |`)
  }
  if (aiCallScan.dynamic.length) {
    lines.push('')
    lines.push('### 动态 category 调用')
    lines.push('')
    for (const item of aiCallScan.dynamic.sort()) lines.push(`- \`${item}\``)
  }
  if (aiCallScan.uncategorized.length) {
    lines.push('')
    lines.push('### 未分类调用（必须修复）')
    lines.push('')
    for (const item of aiCallScan.uncategorized.sort()) lines.push(`- \`${item}\``)
  }
  lines.push('')

  lines.push('---')
  lines.push('')
  lines.push(`生成时间基准:commit \`${gitHash()}\``)
  lines.push('')
  return lines.join('\n')
}

function gitHash() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim()
  } catch {
    return 'unknown'
  }
}

// ── main ──
const isCheck = process.argv.includes('--check')
const generated = buildMarkdown()

if (isCheck) {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  // 忽略末尾 commit hash 行(每次 commit 都会变)的差异
  const strip = (s) => s.replace(/生成时间基准:commit `[^`]*`/g, '生成时间基准:commit `X`')
  if (strip(existing) !== strip(generated)) {
    console.error('[ai-manual] 生成结果与已提交文件不一致。请运行 `npm run gen:ai-manual` 后提交。')
    process.exit(1)
  }
  console.log('[ai-manual] ok: generated manual matches code.')
} else {
  fs.writeFileSync(OUT, generated)
  console.log(`[ai-manual] generated ${path.relative(root, OUT)}`)
}
