/* global console, process */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const plans = [
  {
    file: 'docs/roadmap/SHORT-NOVEL-DEVELOPMENT-PLAN.md',
    productId: 'independent.shortform',
    branch: 'feat/shortform-production',
    owner: 'Short Work',
    forbiddenBranches: ['feat/screenplay-production', 'feat/comic-production'],
  },
  {
    file: 'docs/roadmap/NOVEL-TO-SCREENPLAY-DEVELOPMENT-PLAN.md',
    productId: 'independent.screenplay',
    branch: 'feat/screenplay-production',
    owner: 'Screenplay Work',
    forbiddenBranches: ['feat/shortform-production', 'feat/comic-production'],
  },
  {
    file: 'docs/roadmap/NOVEL-TO-COMIC-DEVELOPMENT-PLAN.md',
    productId: 'independent.comic',
    branch: 'feat/comic-production',
    owner: 'Comic Work',
    forbiddenBranches: ['feat/shortform-production', 'feat/screenplay-production'],
  },
]

const requiredSections = [
  '开工卡与边界',
  '数据模型',
  '三注册表',
  'Agent/Skill',
  'Prompt',
  '工作台',
  '测试',
  '施工顺序与分支',
  '完成定义',
]

const failures = []

for (const plan of plans) {
  const absolute = path.join(root, plan.file)
  if (!fs.existsSync(absolute)) {
    failures.push(`missing independent product plan: ${plan.file}`)
    continue
  }
  const source = fs.readFileSync(absolute, 'utf8')
  for (const marker of [plan.productId, plan.branch, plan.owner, '世界引擎', 'PROJECT_TABLES', '唯一功能分支']) {
    if (!source.includes(marker)) failures.push(`${plan.file} missing marker: ${marker}`)
  }
  for (const section of requiredSections) {
    if (!source.includes(section)) failures.push(`${plan.file} missing required section: ${section}`)
  }
  for (const forbidden of plan.forbiddenBranches) {
    if (source.includes(forbidden)) failures.push(`${plan.file} references sibling implementation branch: ${forbidden}`)
  }
}

const indexPath = path.join(root, 'docs/roadmap/INDEPENDENT-CREATION-DEVELOPMENT-PLAN.md')
const auditPath = path.join(root, 'docs/roadmap/INDEPENDENT-CREATION-PLAN-AUDIT.md')
if (fs.existsSync(indexPath)) {
  const index = fs.readFileSync(indexPath, 'utf8')
  for (const plan of plans) {
    const basename = path.basename(plan.file)
    if (!index.includes(basename)) failures.push(`independent creation index missing plan link: ${basename}`)
  }
  if (!index.includes('INDEPENDENT-CREATION-PLAN-AUDIT.md')) failures.push('independent creation index missing plan audit link')
} else {
  failures.push('missing independent creation index')
}

if (fs.existsSync(auditPath)) {
  const audit = fs.readFileSync(auditPath, 'utf8')
  for (const marker of [
    '通过，附带施工时必须持续执行的共享底座和串行集成条件',
    'feat/independent-creation-integration',
    ...plans.map(plan => plan.branch),
  ]) {
    if (!audit.includes(marker)) failures.push(`independent creation plan audit missing marker: ${marker}`)
  }
} else {
  failures.push('missing independent creation plan audit')
}

if (failures.length) {
  console.error('independent creation plan check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`independent creation plan check passed: ${plans.length} isolated product plans and one cross-plan audit`)
