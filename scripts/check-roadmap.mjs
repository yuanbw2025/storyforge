/* global console, process */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roadmapDir = path.join(root, 'docs', 'roadmap')
const files = {
  entry: path.join(root, 'docs', 'ROADMAP.md'),
  current: path.join(roadmapDir, 'README.md'),
  baseline: path.join(roadmapDir, 'CAPABILITY-BASELINE.md'),
  completed: path.join(roadmapDir, 'COMPLETED.md'),
  legacy: path.join(root, 'docs', 'ROADMAP-LEGACY.md'),
}

const expectedLegacySha =
  'e497de7d0f8100489bdcb3a7b3fcb528d07024b9dcb832f7de6e2701d584667d'
const expectedLegacyHeadingCount = 197
const expectedStatusHeadingCount = 166
const statusMarkers = [
  '✅',
  '⏳',
  '🟡',
  '🔴',
  '🟠',
  '🟢',
  '🧪',
  '🚧',
  '⚠️',
  '❌',
  '🚫',
  '⌧',
  '⬜',
  '🔵',
  '🏗️',
  '📋',
  '🎯',
  '📅',
]
const expectedStatusCounts = {
  active: 31,
  partial: 11,
  completed: 115,
  deprecated: 2,
  historical: 7,
}
const portfolioIds = [
  'GOV-1',
  'INV-1',
  'CANON-1',
  'PIPE-1',
  'WORLD-1',
  'STORY-1',
  'AUTHOR-1',
  'IDEA-1',
  'AGENT-1',
  'SIM-1',
  'PRODUCT-1',
  'PLATFORM-1',
]

const failures = []
const read = (file) => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    failures.push(`missing roadmap document: ${path.relative(root, file)}`)
    return ''
  }
}

const entry = read(files.entry)
const current = read(files.current)
const baseline = read(files.baseline)
const completed = read(files.completed)
const legacy = read(files.legacy)

const legacyIdPattern =
  '(?:CONSISTENCY-\\d+|INVENTORY-\\d+|QUICKWIN-\\d+|EDITOR-\\d+|PIPELINE-\\d+|CF-\\d{8}-\\d+|PR-\\d{8}-\\d+|CM-\\d+|AUDIT-\\d+[A-Za-z]?|ENH-[A-Z0-9-]+|FB-\\d+[A-Za-z-]*|HEALTH-\\d+|BUG-[A-Z0-9-]+|NS-\\d+|Phase\\s+\\d+(?:\\.\\d+){0,2}|[A-H]-\\d+|25\\.5\\.\\d+)'
const hasStatusSemantics = (title) =>
  statusMarkers.some((marker) => title.includes(marker)) ||
  /待开发|待办|完成|部分|废弃|作废|关闭|未规划|长期/.test(title)

const classifyLegacyHeading = (title) => {
  if (title.startsWith('❌') || title.startsWith('⌧') || /已关闭|已下线/.test(title)) {
    return 'deprecated'
  }
  if (title.startsWith('✅')) {
    return /部分|第一阶段|待(?:审|复测|预览|后续)|原始记录|后续|基础版已完成|跑偏/.test(
      title,
    )
      ? 'partial'
      : 'completed'
  }
  if (['🔴', '🟠', '🟡', '🟢', '⬜'].some((marker) => title.startsWith(marker))) {
    return /已完成|已修|底层已修|测试体系已完成|段一/.test(title)
      ? 'partial'
      : 'active'
  }
  if (/✅.*(?:完成|已修)/.test(title)) return 'completed'
  if (/Phase\s+\d|待开发|待办|未规划|长期/.test(title)) return 'active'
  return 'historical'
}

if (legacy) {
  const headings = [...legacy.matchAll(/^#{2,4}\s+(.+)$/gm)].map((match) => match[1])
  const statusHeadings = headings.filter(hasStatusSemantics)
  const statusCounts = Object.fromEntries(
    Object.keys(expectedStatusCounts).map((category) => [
      category,
      statusHeadings.filter((title) => classifyLegacyHeading(title) === category).length,
    ]),
  )

  if (headings.length !== expectedLegacyHeadingCount) {
    failures.push(
      `legacy heading count changed: expected ${expectedLegacyHeadingCount}, got ${headings.length}`,
    )
  }
  if (statusHeadings.length !== expectedStatusHeadingCount) {
    failures.push(
      `legacy status heading count changed: expected ${expectedStatusHeadingCount}, got ${statusHeadings.length}`,
    )
  }
  for (const [category, expected] of Object.entries(expectedStatusCounts)) {
    if (statusCounts[category] !== expected) {
      failures.push(
        `legacy ${category} heading count changed: expected ${expected}, got ${statusCounts[category]}`,
      )
    }
  }

  const currentPlanningDocs = `${current}\n${baseline}\n${completed}`
  const activeIds = [
    ...new Set(
      statusHeadings
        .filter((title) => ['active', 'partial'].includes(classifyLegacyHeading(title)))
        .flatMap((title) => [...title.matchAll(new RegExp(legacyIdPattern, 'g'))].map((match) => match[0])),
    ),
  ]
  for (const id of activeIds) {
    const alias = id === 'INVENTORY-1' ? 'INV-1' : id
    if (!currentPlanningDocs.includes(id) && !currentPlanningDocs.includes(alias)) {
      failures.push(`active or partial legacy item has no current destination: ${id}`)
    }
  }
}

if (!entry.includes('./roadmap/README.md')) {
  failures.push('docs/ROADMAP.md must link to docs/roadmap/README.md')
}
for (const name of ['CAPABILITY-BASELINE.md', 'COMPLETED.md']) {
  if (!entry.includes(`./roadmap/${name}`)) {
    failures.push(`docs/ROADMAP.md must link to docs/roadmap/${name}`)
  }
}
if (!entry.includes('./ROADMAP-LEGACY.md')) {
  failures.push('docs/ROADMAP.md must link to docs/ROADMAP-LEGACY.md')
}

if (legacy) {
  const actual = crypto.createHash('sha256').update(legacy).digest('hex')
  if (actual !== expectedLegacySha) {
    failures.push(
      `ROADMAP-LEGACY.md changed: expected ${expectedLegacySha}, got ${actual}`,
    )
  }
}

for (const id of portfolioIds) {
  if (!current.includes(id)) failures.push(`current roadmap missing portfolio ${id}`)
  if (!baseline.includes(id)) failures.push(`capability baseline missing portfolio ${id}`)
}

const links = /\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
for (const file of [
  files.entry,
  files.current,
  files.baseline,
  files.completed,
  files.legacy,
]) {
  const source = read(file)
  for (const match of source.matchAll(links)) {
    const target = match[1]
    if (/^(?:https?:|mailto:|#)/.test(target)) continue
    const clean = target.split('#')[0]
    if (!clean) continue
    const resolved = path.resolve(path.dirname(file), clean)
    if (!fs.existsSync(resolved)) {
      failures.push(
        `broken roadmap link: ${path.relative(root, file)} -> ${target}`,
      )
    }
  }
}

const legacyTaskIds = [
  'CONSISTENCY-2',
  'CONSISTENCY-0',
  'CONSISTENCY-3',
  'INVENTORY-1',
  'QUICKWIN-3',
  'EDITOR-2',
  'EDITOR-5',
  'PIPELINE-1',
  'PIPELINE-2',
  'PIPELINE-3',
  'CF-20260703-8',
  'CF-20260702-7',
  'CF-20260702-9',
  'CF-20260702-12',
  'CM-1',
  'AUDIT-5',
  'AUDIT-6',
  'AUDIT-7',
  'AUDIT-8',
  'AUDIT-9',
  'AUDIT-10',
  'AUDIT-11',
  'HEALTH-1',
  'HEALTH-4',
  'HEALTH-5',
]
for (const id of legacyTaskIds) {
  if (!legacy.includes(id)) failures.push(`legacy snapshot missing task ${id}`)
  if (!current.includes(id) && !current.includes(id.replace('PIPELINE-', 'PIPE-'))) {
    failures.push(`current roadmap missing task mapping ${id}`)
  }
}

if (failures.length) {
  console.error('roadmap check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `roadmap check passed: ${portfolioIds.length} portfolios, ${legacyTaskIds.length} sampled tasks, ${expectedStatusHeadingCount} classified legacy headings, legacy snapshot intact`,
)
