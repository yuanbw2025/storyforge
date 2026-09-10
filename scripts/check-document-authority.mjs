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
  'README.en.md',
  'README.fr.md',
  'README.de.md',
  'README.it.md',
  'README.es.md',
  'README.pt.md',
  'README.ja.md',
  'README.ko.md',
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
  'docs/assets/support/afdian-aloneone.jpeg',
  'docs/assets/readme/product-hub.png',
  'docs/assets/readme/create-work.png',
  'docs/assets/readme/longform-outline.png',
  'docs/assets/readme/ttrpg-preview.png',
  'docs/assets/readme/data-management.png',
  'docs/guides/I18N.md',
  'docs/products/README.md',
  'docs/products/LONGFORM-AND-NODE.md',
  'docs/products/INDEPENDENT-CREATION.md',
  'docs/products/MOTION-DRAMA.md',
  'docs/products/WORLD-ENGINE.md',
  'docs/products/UPPER-PRODUCTS.md',
  'docs/products/TTRPG-AI-KP.md',
  'docs/roadmap/README.md',
  'docs/roadmap/CAPABILITY-BASELINE.md',
  'docs/roadmap/INDEPENDENT-CREATION-DEVELOPMENT-PLAN.md',
  'docs/roadmap/SHORT-NOVEL-DEVELOPMENT-PLAN.md',
  'docs/roadmap/NOVEL-TO-SCREENPLAY-DEVELOPMENT-PLAN.md',
  'docs/roadmap/NOVEL-TO-COMIC-DEVELOPMENT-PLAN.md',
  'docs/roadmap/MOTION-DRAMA-PREPRODUCTION-DEVELOPMENT-PLAN.md',
  'docs/roadmap/MOTION-DRAMA-CONTENT-PRODUCTION-FLOW.md',
  'docs/roadmap/INDEPENDENT-CREATION-PLAN-AUDIT.md',
  'docs/roadmap/MOTION-DRAMA-PLAN-AUDIT.md',
  'docs/roadmap/COMPLETED.md',
  'docs/audits/CURRENT-ARCHITECTURE-AUDIT-20260903.md',
  'docs/ttrpg/licenses/SRD-5.2.1-CC-BY-4.0.md',
]

const failures = []
const activeSet = new Set(activeDocs)
const publicReadmes = activeRootDocuments.filter(file => /^README(?:\.[a-z]+)?\.md$/.test(file))
const canonicalStageNames = ['S1 世界封存', 'S2 产品定向', 'S3 产品执行']
const canonicalStageDocuments = [
  'AGENTS.md',
  'CLAUDE.md',
  'docs/PROJECT-MASTER-CHARTER.md',
  'docs/ARCHITECTURE.md',
  'docs/DATA-GOVERNANCE.md',
  'docs/HARNESS-QUALITY-STANDARD.md',
  'docs/products/UPPER-PRODUCTS.md',
]
const retiredStageTitles = [
  '阶段一：世界引擎',
  '阶段二：用户交互与发指令',
  '阶段三：产品执行与交付',
  '阶段一 · 世界引擎',
  '阶段二 · 用户交互与发指令',
  '阶段三 · 产品执行与交付',
]
const canonicalStageHandoffs = [
  {
    file: 'docs/PROJECT-MASTER-CHARTER.md',
    required: [
      'S1 -->|"可引用的 WorldRelease 身份与能力画像"| S2',
      'S2 -->|"开始授权 + WorldReference + ConfirmedProductBrief + ProductSourcePlan"| S3',
    ],
  },
  {
    file: 'docs/products/UPPER-PRODUCTS.md',
    required: [
      'W -->|"可引用 WorldRelease"| R',
      'A -->|"WorldReference + ConfirmedProductBrief + ProductSourcePlan"| P',
    ],
  },
  {
    file: 'docs/ARCHITECTURE.md',
    required: [
      'WR -->|"用户选定版本后生成并校验"| RF',
      'I -->|"用户明确开始\\nWorldReference + Brief + SourcePlan"| P',
    ],
  },
]

for (const file of publicReadmes) {
  const absolute = path.join(root, file)
  if (!fs.existsSync(absolute)) continue
  const source = fs.readFileSync(absolute, 'utf8')
  const navigation = source.match(/<!-- readme-languages:start -->([\s\S]*?)<!-- readme-languages:end -->/)
  if (!navigation) {
    failures.push(`missing README language navigation: ${file}`)
    continue
  }
  const targets = [...navigation[1].matchAll(/\[[^\]]+\]\(\.\/([^)]*)\)/g)].map(match => match[1])
  if (targets.length !== publicReadmes.length || publicReadmes.some(target => !targets.includes(target))) {
    failures.push(`incomplete README language navigation: ${file}`)
  }
}

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

for (const file of canonicalStageDocuments) {
  const absolute = path.join(root, file)
  if (!fs.existsSync(absolute)) continue
  const source = fs.readFileSync(absolute, 'utf8')
  for (const stageName of canonicalStageNames) {
    if (!source.includes(stageName)) failures.push(`canonical stage name missing: ${file} -> ${stageName}`)
  }
  for (const retiredTitle of retiredStageTitles) {
    if (source.includes(retiredTitle)) failures.push(`retired stage title restored: ${file} -> ${retiredTitle}`)
  }
}

for (const { file, required } of canonicalStageHandoffs) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  for (const snippet of required) {
    if (!source.includes(snippet)) failures.push(`canonical stage handoff missing: ${file} -> ${snippet}`)
  }
}

const masterCharter = fs.readFileSync(path.join(root, 'docs/PROJECT-MASTER-CHARTER.md'), 'utf8')
for (const stageStep of ['S3.1 生产', 'S3.2 验收', 'S3.3 发布', 'S3.4 运行与演化']) {
  if (!masterCharter.includes(stageStep)) failures.push(`master charter missing product-execution locator: ${stageStep}`)
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
  /MASTER-BLUEPRINT|ROADMAP-LEGACY|FEATURE-GUIDE|docs\/(?:refactor|completion|text-game|pitch|brand|evals|product-platform|readme|adr|archive)\//
const archivedAssetReference = /docs\/assets\/(?!support\/afdian-aloneone\.jpeg|readme\/(?:product-hub|create-work|longform-outline|ttrpg-preview|data-management)\.png)/
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
  const source = fs.readFileSync(absolute, 'utf8')
  if (archivedAuthority.test(source) || archivedAssetReference.test(source)) {
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
