/* global console, process */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const registryPath = 'src/lib/agent/ai-entry-registry.json'
const registry = JSON.parse(fs.readFileSync(path.join(root, registryPath), 'utf8'))
const failures = []

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(file, acc)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) acc.push(file)
  }
  return acc
}

export function countDirectUiModelCalls(source, file = 'entry.tsx') {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let count = 0
  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && (node.expression.text === 'useAIStream' || node.expression.text === 'chat')
    ) count++
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return count
}

if (registry.version !== 1 || registry.scope !== 'step-by-step-ui-direct-model-entry' || !Array.isArray(registry.entries)) {
  failures.push(`${registryPath}: 版本、scope 或 entries 无效`)
}

const registered = new Map()
for (const entry of registry.entries ?? []) {
  if (!entry?.file || registered.has(entry.file)) {
    failures.push(`${registryPath}: 重复或无效 file ${String(entry?.file)}`)
    continue
  }
  if (!['governed', 'auxiliary', 'migration'].includes(entry.status)) {
    failures.push(`${entry.file}: status 必须是 governed/auxiliary/migration`)
  }
  if (!Number.isInteger(entry.calls) || entry.calls < 1) failures.push(`${entry.file}: calls 必须是正整数`)
  if (!entry.reason?.trim()) failures.push(`${entry.file}: 缺少可复审 reason`)
  if (entry.status === 'migration' && !/^HARNESS-\d+$/.test(entry.nextUnit ?? '')) {
    failures.push(`${entry.file}: migration 必须登记 nextUnit`)
  }
  if (entry.status !== 'migration' && !entry.mechanism?.trim()) {
    failures.push(`${entry.file}: ${entry.status} 必须登记 mechanism`)
  }
  registered.set(entry.file, entry)
}

const actual = new Map()
for (const dir of ['src/components', 'src/hooks', 'src/pages']) {
  for (const file of walk(dir)) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const calls = countDirectUiModelCalls(source, file)
    if (calls > 0) actual.set(file, calls)
  }
}

for (const [file, calls] of actual) {
  const entry = registered.get(file)
  if (!entry) failures.push(`${file}: ${calls} 个 UI 直调模型入口未登记`)
  else if (entry.calls !== calls) failures.push(`${file}: 登记 calls=${entry.calls}，实际=${calls}`)
}
for (const file of registered.keys()) {
  if (!actual.has(file)) failures.push(`${file}: 注册表残留，源码已无 UI 直调模型入口`)
}

// Scanner self-test: imports/declarations must not count, real calls must count.
const selfTest = "import { chat } from './client'; const useAIStream = () => null; useAIStream(); await chat([]); api.chat([])"
if (countDirectUiModelCalls(selfTest) !== 2) failures.push('守卫自测失败：UI 模型调用 AST 计数器退化')

if (failures.length) {
  console.error('[ai-entry-registry] ❌ 分步骤 UI 模型入口未闭合：\n')
  failures.forEach(failure => console.error(`  ${failure}`))
  process.exit(1)
}

const counts = { governed: 0, auxiliary: 0, migration: 0 }
for (const entry of registered.values()) counts[entry.status]++
console.log(`[ai-entry-registry] ok: ${registered.size} files / ${[...actual.values()].reduce((sum, value) => sum + value, 0)} calls; governed ${counts.governed}, auxiliary ${counts.auxiliary}, migration ${counts.migration}`)
