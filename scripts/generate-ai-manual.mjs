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
 * 全部正则解析声明性字面量,零依赖、不需要编译/IndexedDB,CI 友好。
 *
 * 用法:
 *   node scripts/generate-ai-manual.mjs          # 生成
 *   node scripts/generate-ai-manual.mjs --check   # 校验(生成结果与已提交文件一致,不一致退出码 1)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'docs/AI-FUNCTIONS-MANUAL.generated.md')

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// ── ① PromptModuleKey 枚举 ──
function extractModuleKeys() {
  const src = read('src/lib/types/prompt.ts')
  const block = src.match(/export type PromptModuleKey =([\s\S]*?)(?:\n\nexport|\n\/\*\*|\nexport interface)/)
  const scope = block ? block[1] : src
  return [...scope.matchAll(/\|\s*'([a-zA-Z0-9._-]+)'/g)].map(m => m[1])
}

// ── ② prompt 种子 ──
function extractSeeds() {
  const src = read('src/lib/ai/prompt-seeds.ts')
  const seeds = []
  // 按 moduleKey: '...' 分块
  const re = /moduleKey:\s*'([a-zA-Z0-9._-]+)'/g
  let m
  const positions = []
  while ((m = re.exec(src))) positions.push({ key: m[1], idx: m.index })
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].idx
    const end = i + 1 < positions.length ? positions[i + 1].idx : src.length
    const chunk = src.slice(start, end)
    const name = chunk.match(/name:\s*'([^']*)'/)?.[1] ?? ''
    const description = chunk.match(/description:\s*'([^']*)'/)?.[1] ?? ''
    const varsRaw = chunk.match(/variables:\s*\[([^\]]*)\]/)?.[1] ?? ''
    const variables = [...varsRaw.matchAll(/'([^']+)'/g)].map(x => x[1])
    seeds.push({ key: positions[i].key, name, description, variables })
  }
  return seeds
}

// ── ③ CONTEXT_SOURCES ──
function extractContextSources() {
  const src = read('src/lib/registry/context-sources.ts')
  const out = []
  const re = /\bkey:\s*'([a-zA-Z0-9._-]+)'/g
  let m
  const positions = []
  while ((m = re.exec(src))) positions.push({ key: m[1], idx: m.index })
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].idx
    const end = i + 1 < positions.length ? positions[i + 1].idx : src.length
    const chunk = src.slice(start, end)
    const label = chunk.match(/label:\s*'([^']*)'/)?.[1] ?? ''
    const scope = chunk.match(/scope:\s*'([^']*)'/)?.[1] ?? ''
    const layer = chunk.match(/layer:\s*'([^']*)'/)?.[1] ?? ''
    const budget = chunk.match(/budgetTokens:\s*(\d+)/)?.[1] ?? ''
    out.push({ key: positions[i].key, label, scope, layer, budget })
  }
  return out
}

// ── ④ FIELD_REGISTRY 可写字段(target → field 列表) ──
function extractFields() {
  const src = read('src/lib/registry/field-registry.ts')
  const byTarget = {}
  // 形如 text('worldviews', 'worldOrigin', ['summary'])、enumeration(...) 等。
  // 注意:字段说明书必须跟 FIELD_REGISTRY 的 helper 命名同步;此前漏扫 enumeration() 会丢枚举字段。
  for (const m of src.matchAll(/\b(?:text|longtext|num|bool|json|arr|enumeration|enumField|field)\(\s*'([a-zA-Z0-9_]+)'\s*,\s*'([a-zA-Z0-9_]+)'/g)) {
    const [, target, field] = m
    ;(byTarget[target] ??= new Set()).add(field)
  }
  for (const target of Object.keys(byTarget)) {
    byTarget[target] = [...byTarget[target]].sort()
  }
  return byTarget
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
  const aiCallScan = extractAiCalls()
  const aiCalls = aiCallScan.byCategory
  const seedByKey = Object.fromEntries(seeds.map(s => [s.key, s]))

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
  lines.push(`共 ${keys.length} 个 moduleKey。`)
  lines.push('')
  lines.push('| moduleKey | 名称 | 说明 | 读取变量 |')
  lines.push('|---|---|---|---|')
  for (const k of keys) {
    const s = seedByKey[k]
    const vars = s?.variables?.length ? '`' + s.variables.join('` `') + '`' : '—'
    lines.push(`| \`${k}\` | ${s?.name ?? '—'} | ${s?.description ?? '—'} | ${vars} |`)
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
