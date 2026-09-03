/* global console, process */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const activeRootDocuments = [
  'AGENTS.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'README.md',
  'SECURITY.md',
]

const activeDocs = [
  'docs/README.md',
  'docs/PROJECT-MASTER-CHARTER.md',
  'docs/DOCUMENT-AUTHORITY.md',
  'docs/CONTEXT-ROUTING.md',
  'docs/ARCHITECTURE.md',
  'docs/DATA-GOVERNANCE.md',
  'docs/HARNESS-QUALITY-STANDARD.md',
  'docs/ENGINEERING-QUALITY-STANDARD.md',
  'docs/COLLAB-WORKFLOW.md',
  'docs/ROADMAP.md',
  'docs/AI-FUNCTIONS-MANUAL.generated.md',
  'docs/AI-FUNCTIONS-MANUAL.semantic.md',
  'docs/CONSISTENCY-COVERAGE-MAP.md',
  'docs/MEMORY-WORKSPACE-GUIDE.md',
  'docs/guides/I18N.md',
  'docs/products/README.md',
  'docs/products/LONGFORM-AND-NODE.md',
  'docs/products/INDEPENDENT-CREATION.md',
  'docs/products/WORLD-ENGINE.md',
  'docs/products/UPPER-PRODUCTS.md',
  'docs/roadmap/README.md',
  'docs/roadmap/CAPABILITY-BASELINE.md',
  'docs/roadmap/COMPLETED.md',
  'docs/audits/CURRENT-ARCHITECTURE-AUDIT-20260903.md',
  'docs/ttrpg/licenses/SRD-5.2.1-CC-BY-4.0.md',
]

const failures = []
const activeSet = new Set(activeDocs)

const walk = directory => {
  const result = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...walk(absolute))
    else result.push(path.relative(root, absolute).split(path.sep).join('/'))
  }
  return result
}

for (const file of [...activeRootDocuments, ...activeDocs]) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`missing active document: ${file}`)
}

for (const file of walk(path.join(root, 'docs'))) {
  if (!activeSet.has(file)) failures.push(`unregistered file in active docs library: ${file}`)
}

const markdownLink = /\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
for (const file of [...activeRootDocuments, ...activeDocs]) {
  const absolute = path.join(root, file)
  if (!fs.existsSync(absolute) || path.extname(file) !== '.md') continue
  const source = fs.readFileSync(absolute, 'utf8')
  for (const match of source.matchAll(markdownLink)) {
    const target = match[1]
    if (/^(?:https?:|mailto:|#)/.test(target)) continue
    const clean = decodeURIComponent(target.split('#')[0])
    if (!clean) continue
    if (!fs.existsSync(path.resolve(path.dirname(absolute), clean))) {
      failures.push(`broken active-document link: ${file} -> ${target}`)
    }
  }
}

const archivedAuthority =
  /MASTER-BLUEPRINT|ROADMAP-LEGACY|FEATURE-GUIDE|docs\/(?:refactor|completion|text-game|pitch|assets|brand|evals|product-platform|readme|adr|archive)\//
for (const file of [...activeRootDocuments, ...activeDocs]) {
  if (
    file === 'CHANGELOG.md' ||
    file === 'docs/DOCUMENT-AUTHORITY.md' ||
    file.startsWith('docs/audits/')
  ) {
    continue
  }
  const absolute = path.join(root, file)
  if (!fs.existsSync(absolute) || path.extname(file) !== '.md') continue
  if (archivedAuthority.test(fs.readFileSync(absolute, 'utf8'))) {
    failures.push(`active document references archived authority: ${file}`)
  }
}

const authorityPath = path.join(root, 'docs', 'DOCUMENT-AUTHORITY.md')
if (fs.existsSync(authorityPath)) {
  const authority = fs.readFileSync(authorityPath, 'utf8')
  for (const file of activeDocs) {
    if (!authority.includes(file.replace(/^docs\//, '')) && !authority.includes(file)) {
      failures.push(`DOCUMENT-AUTHORITY.md does not register: ${file}`)
    }
  }
  for (const marker of [
    'https://www.kdocs.cn/mine/556058861849',
    'https://www.kdocs.cn/l/cidJLBJJTi03',
    'https://www.kdocs.cn/l/chgdLLD82FoA',
    '80992125d26a4692b1a01537c568fd4a7f7ea90bf8acce57ee546a9ce12710ae',
  ]) {
    if (!authority.includes(marker)) failures.push(`archive evidence missing from authority: ${marker}`)
  }
}

if (failures.length) {
  console.error('document authority check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`document authority check passed: ${activeDocs.length} governed docs, no stale files or links`)
