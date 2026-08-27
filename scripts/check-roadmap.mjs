/* global console, process */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = {
  entry: path.join(root, 'docs', 'ROADMAP.md'),
  charter: path.join(root, 'docs', 'PROJECT-MASTER-CHARTER.md'),
  authority: path.join(root, 'docs', 'DOCUMENT-AUTHORITY.md'),
  current: path.join(root, 'docs', 'roadmap', 'README.md'),
  baseline: path.join(root, 'docs', 'roadmap', 'CAPABILITY-BASELINE.md'),
  completed: path.join(root, 'docs', 'roadmap', 'COMPLETED.md'),
}

const failures = []
const read = (name, file) => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    failures.push(`missing ${name}: ${path.relative(root, file)}`)
    return ''
  }
}

const docs = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, read(name, file)]))

const stageHeadings = [
  '阶段 A · 权威与主干',
  '阶段 B · 保持分步骤长篇基线并完成节点同源',
  '阶段 C · 独立创作产品',
  '阶段 D · 世界引擎',
  '阶段 E · 上层垂直产品',
  '阶段 F · 网站、社区、平台与商业化',
]
let priorIndex = -1
for (const heading of stageHeadings) {
  const index = docs.current.indexOf(heading)
  if (index < 0) failures.push(`current roadmap missing stage: ${heading}`)
  else if (index <= priorIndex) failures.push(`current roadmap stage order is invalid at: ${heading}`)
  priorIndex = Math.max(priorIndex, index)
}

const capabilityIds = [
  'A-GOV-01', 'A-GOV-02',
  'B-LF-01', 'B-LF-02', 'B-LF-03', 'B-LF-04', 'B-LF-05', 'B-LF-06',
  'B-NODE-01', 'B-NODE-02',
  'C-SHORT-01', 'C-SCREENPLAY-01', 'C-COMIC-01',
  'D-WORLD-01', 'D-WORLD-02', 'D-WORLD-03', 'D-WORLD-04',
  'E-TTRPG-01', 'E-CHAT-01', 'E-TOWN-01', 'E-TEXTADV-01', 'E-AVG-01', 'E-OPENWORLD-01',
  'F-PLATFORM-01', 'F-COMMERCIAL-01',
]
const activeTaskIds = [
  'A-GOV-02',
  'B-NODE-01', 'B-NODE-02',
  'C-SHORT-01', 'C-SCREENPLAY-01', 'C-COMIC-01',
  'D-WORLD-01', 'D-WORLD-02', 'D-WORLD-03', 'D-WORLD-04',
  'E-TTRPG-01', 'E-CHAT-01', 'E-TOWN-01', 'E-TEXTADV-01', 'E-AVG-01', 'E-OPENWORLD-01',
  'F-PLATFORM-01', 'F-COMMERCIAL-01',
]
const completedCapabilityIds = [
  'A-GOV-01',
  'B-LF-01', 'B-LF-02', 'B-LF-03', 'B-LF-04', 'B-LF-05', 'B-LF-06',
]
for (const id of capabilityIds) {
  if (!docs.baseline.includes(id)) failures.push(`capability baseline missing task: ${id}`)
}
for (const id of activeTaskIds) {
  if (!docs.current.includes(id)) failures.push(`current roadmap missing active task: ${id}`)
}
for (const id of completedCapabilityIds) {
  if (!docs.completed.includes(id)) failures.push(`completed index missing capability: ${id}`)
}

const currentTaskRows = docs.current.split('\n').filter(line => /^\| [A-Z]/.test(line))
for (const id of completedCapabilityIds) {
  if (currentTaskRows.some(line => line.includes(`| ${id} |`))) {
    failures.push(`completed capability returned to active roadmap: ${id}`)
  }
}

for (const status of ['implemented', 'partial', 'missing', 'experimental']) {
  if (!docs.baseline.includes(`\`${status}\``)) {
    failures.push(`capability baseline missing status definition: ${status}`)
  }
}

for (const [id, status] of [
  ['BASE-DATA-01', 'implemented'],
  ['BASE-REG-01', 'implemented'],
  ['BASE-AI-01', 'implemented'],
  ['BASE-HARNESS-01', 'implemented'],
  ['BASE-CTX-01', 'implemented'],
  ['B-LF-01', 'implemented'],
  ['B-LF-02', 'implemented'],
  ['B-LF-03', 'implemented'],
  ['B-LF-04', 'implemented'],
  ['B-LF-05', 'implemented'],
  ['B-LF-06', 'implemented'],
]) {
  const row = docs.baseline.split('\n').find(line => line.includes(`| ${id} |`)) ?? ''
  if (!row.includes(`| ${status} |`)) failures.push(`${id} must be ${status} in capability baseline`)
  if (!docs.completed.includes(`| ${id} |`)) failures.push(`completed index missing ${id}`)
}

for (const [needle, label] of [
  ['./PROJECT-MASTER-CHARTER.md', 'master charter'],
  ['./roadmap/README.md', 'current roadmap'],
  ['./roadmap/CAPABILITY-BASELINE.md', 'capability baseline'],
  ['./roadmap/COMPLETED.md', 'completed index'],
]) {
  if (!docs.entry.includes(needle)) failures.push(`docs/ROADMAP.md missing link to ${label}`)
}

const forbidden = /MASTER-BLUEPRINT|ROADMAP-LEGACY|docs\/refactor\/|docs\/completion\/|docs\/text-game\//
for (const name of ['entry', 'current', 'baseline', 'completed']) {
  if (forbidden.test(docs[name])) failures.push(`${path.relative(root, files[name])} references archived authority`)
}

const markdownLink = /\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
for (const [name, file] of Object.entries(files)) {
  for (const match of docs[name].matchAll(markdownLink)) {
    const target = match[1]
    if (/^(?:https?:|mailto:|#)/.test(target)) continue
    const clean = target.split('#')[0]
    if (!clean) continue
    const resolved = path.resolve(path.dirname(file), clean)
    if (!fs.existsSync(resolved)) {
      failures.push(`broken roadmap link: ${path.relative(root, file)} -> ${target}`)
    }
  }
}

if (!docs.charter.includes('阶段 B：保持分步骤长篇基线并完成节点同源')) {
  failures.push('master charter no longer contains the stage B dependency')
}
if (!docs.authority.includes('docs/roadmap/CAPABILITY-BASELINE.md')) {
  failures.push('document authority does not register the capability baseline')
}

if (failures.length) {
  console.error('roadmap check failed:')
  failures.forEach(failure => console.error(`- ${failure}`))
  process.exit(1)
}

console.log(`roadmap check passed: ${activeTaskIds.length} active tasks and ${completedCapabilityIds.length} completed capabilities across stages A-F`)
