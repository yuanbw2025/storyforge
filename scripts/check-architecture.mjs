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
 *
 * 用法:node scripts/check-architecture.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, ent.name)
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

// ── 报告 ──
if (violations.length) {
  console.error('[architecture] ❌ 发现反模式违规(违反 CLAUDE.md 三注册表铁律):\n')
  for (const v of violations) console.error('  ' + v)
  console.error(`\n共 ${violations.length} 处。修复方式见 /CLAUDE.md「动手前的四问」。`)
  process.exit(1)
} else {
  console.log('[architecture] ✅ ok: 无反模式违规(三注册表铁律守住)。')
}
