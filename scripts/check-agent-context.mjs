/* global console, process */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = {
  entry: path.join(root, 'AGENTS.md'),
  constitution: path.join(root, 'CLAUDE.md'),
  routing: path.join(root, 'docs', 'CONTEXT-ROUTING.md'),
}
const previousMandatoryBytes = 166_002
const maxEntryBytes = 8 * 1024
const failures = []

const read = (name, file) => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    failures.push(`missing ${name}: ${path.relative(root, file)}`)
    return ''
  }
}

const entry = read('agent entry', files.entry)
const constitution = read('constitution', files.constitution)
const routing = read('context routing', files.routing)
const entryBytes = Buffer.byteLength(entry)

if (entryBytes > maxEntryBytes) {
  failures.push(
    `AGENTS.md is ${entryBytes} bytes; keep the automatic entry at or below ${maxEntryBytes}`,
  )
}

const entryRequirements = [
  ['docs/PROJECT-MASTER-CHARTER.md', 'master charter link'],
  ['docs/DOCUMENT-AUTHORITY.md', 'document authority link'],
  ['CONTEXT_SOURCES', 'AI read registry'],
  ['FIELD_REGISTRY', 'AI write registry'],
  ['PROJECT_TABLES', 'table lifecycle registry'],
  ['docs/CONTEXT-ROUTING.md', 'task routing link'],
  ['分步骤长篇', 'independent long-form product boundary'],
  ['世界引擎', 'world-engine product boundary'],
  ['IndexedDB', 'production data warning'],
  ['main', 'production branch warning'],
  ['同一个已验证治理提交', 'parallel product branch baseline'],
  ['共享热点', 'shared-core serialization rule'],
  ['npm run ci', 'delivery verification'],
]
for (const [needle, label] of entryRequirements) {
  if (!entry.includes(needle)) failures.push(`AGENTS.md missing ${label}: ${needle}`)
}

const forbiddenHeadings = /^#{1,6}\s+(?:第[一二三四]动作|所有任务必读|全文必读)/m
if (forbiddenHeadings.test(entry)) {
  failures.push('AGENTS.md must route by task instead of defining a mandatory reading sequence')
}

const longDocs =
  /MASTER-BLUEPRINT|CAPABILITY-BASELINE|COLLAB-WORKFLOW|COLLAB-LOG|ROADMAP-LEGACY/
const fullRead = /全文(?:阅读|预载|读取)|通读|读完/
const negativeOrScoped = /不要|无需|不应|禁止|不得|不再|仅在|只有|按需|避免/
for (const [name, source] of [
  ['AGENTS.md', entry],
  ['CLAUDE.md', constitution],
]) {
  for (const line of source.split('\n')) {
    if (longDocs.test(line) && fullRead.test(line) && !negativeOrScoped.test(line)) {
      failures.push(`${name} restores mandatory full-document reading: ${line.trim()}`)
    }
  }
}

const routingRequirements = [
  ['局部 UI', 'local UI route'],
  ['AI 读取', 'AI read route'],
  ['AI 写回', 'AI write route'],
  ['schema', 'data lifecycle route'],
  ['新体系', 'roadmap route'],
  ['世界引擎', 'world-engine route'],
  ['上层产品', 'upper-product route'],
  ['PR', 'collaboration route'],
  ['并行产品开发', 'parallel product route'],
  ['历史追溯', 'history route'],
  ['rg', 'targeted search guidance'],
]
for (const [needle, label] of routingRequirements) {
  if (!routing.includes(needle)) failures.push(`CONTEXT-ROUTING.md missing ${label}: ${needle}`)
}

if (!constitution.includes('docs/CONTEXT-ROUTING.md')) {
  failures.push('CLAUDE.md must delegate task-specific reading to docs/CONTEXT-ROUTING.md')
}

if (failures.length) {
  console.error('agent context check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

const reduction = ((1 - entryBytes / previousMandatoryBytes) * 100).toFixed(1)
console.log(
  `agent context check passed: fixed project entry ${entryBytes} bytes ` +
    `(previous mandatory chain ${previousMandatoryBytes} bytes, ${reduction}% smaller)`,
)
