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

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text
  return null
}

function literalStrings(node) {
  if (!node) return []
  if (ts.isStringLiteralLike(node)) return [node.text]
  if (ts.isConditionalExpression(node)) {
    return [...literalStrings(node.whenTrue), ...literalStrings(node.whenFalse)]
  }
  return []
}

function objectProperty(node, name) {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined
  const property = node.properties.find(item => (
    ts.isPropertyAssignment(item) && propertyName(item.name) === name
  ))
  return property?.initializer
}

function lineOf(ast, node) {
  return ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1
}

export function analyzeAIEntrySource(source, file = 'entry.tsx') {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const hookFactories = new Set(['useAIStream'])
  const hookVariables = new Set()
  const startAliases = new Set()
  const rawIdentifiers = new Set(['chat', 'streamChat'])
  const rawNamespaces = new Set()
  const registeredExecutors = new Set(['executeRegisteredAIEntryV1'])
  const frozenExecutors = new Set(['executeFrozenFormalAIEntryV1'])
  const streamExecutors = new Set(['streamRegisteredAIEntryV1'])
  const voiceGuards = new Set(['assertVoiceTransport'])
  const transports = []
  const calls = []
  const violations = []
  const typedAIStartFile = source.includes('UseAIStreamReturn') || source.includes('useAIStream')

  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const moduleName = statement.moduleSpecifier.text
    const clause = statement.importClause
    if (!clause?.namedBindings) continue
    if (moduleName.endsWith('/contract') && ts.isNamedImports(clause.namedBindings)) {
      for (const specifier of clause.namedBindings.elements) {
        if ((specifier.propertyName?.text ?? specifier.name.text) === 'assertVoiceTransport') voiceGuards.add(specifier.name.text)
      }
    }
    if (moduleName.endsWith('/useAIStream') || moduleName.endsWith('hooks/useAIStream')) {
      if (ts.isNamedImports(clause.namedBindings)) {
        for (const specifier of clause.namedBindings.elements) {
          if ((specifier.propertyName?.text ?? specifier.name.text) === 'useAIStream') hookFactories.add(specifier.name.text)
        }
      }
    }
    if (moduleName.endsWith('/ai/client') || moduleName.endsWith('lib/ai/client')) {
      if (ts.isNamespaceImport(clause.namedBindings)) rawNamespaces.add(clause.namedBindings.name.text)
      if (ts.isNamedImports(clause.namedBindings)) {
        for (const specifier of clause.namedBindings.elements) {
          const imported = specifier.propertyName?.text ?? specifier.name.text
          if (imported === 'chat' || imported === 'streamChat') rawIdentifiers.add(specifier.name.text)
        }
      }
    }
    if (moduleName.endsWith('/agent/formal-ai-entry')
      || moduleName.endsWith('lib/agent/formal-ai-entry')) {
      if (ts.isNamedImports(clause.namedBindings)) {
        for (const specifier of clause.namedBindings.elements) {
          const imported = specifier.propertyName?.text ?? specifier.name.text
          if (imported === 'executeRegisteredAIEntryV1') registeredExecutors.add(specifier.name.text)
          if (imported === 'executeFrozenFormalAIEntryV1') frozenExecutors.add(specifier.name.text)
          if (imported === 'streamRegisteredAIEntryV1') streamExecutors.add(specifier.name.text)
        }
      }
    }
  }

  function collectBindings(node) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression) && hookFactories.has(node.initializer.expression.text)) {
      if (ts.isIdentifier(node.name)) hookVariables.add(node.name.text)
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (propertyName(element.propertyName ?? element.name) === 'start' && ts.isIdentifier(element.name)) {
            startAliases.add(element.name.text)
          }
        }
      }
    }
    ts.forEachChild(node, collectBindings)
  }
  collectBindings(ast)

  function registerGovernedCall(node, entryNode, metaNode, callerNode) {
    const entryIds = literalStrings(entryNode)
    const categoryNode = objectProperty(metaNode, 'category')
    const categories = literalStrings(categoryNode)
    if (entryIds.length !== 1) {
      violations.push(`${file}:${lineOf(ast, node)} 正式 AI 调用必须使用单一字面量 entryId`)
      return
    }
    if (categories.length === 0 && categoryNode) categories.push('*')
    if (categories.length === 0) {
      violations.push(`${file}:${lineOf(ast, node)} 正式 AI 调用缺少可机验 category`)
      return
    }
    if (callerNode) {
      const callers = literalStrings(callerNode)
      if (callers.length !== 1 || callers[0] !== file) {
        violations.push(`${file}:${lineOf(ast, node)} 冻结正式 AI 调用必须用等于真实文件路径的单一 caller 字面量`)
        return
      }
    }
    calls.push({ file, line: lineOf(ast, node), entryId: entryIds[0], categories })
  }

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression
      if (ts.isIdentifier(expression) && voiceGuards.has(expression.text)) {
        const ids = literalStrings(node.arguments[0])
        const callers = literalStrings(node.arguments[1])
        if (ids.length !== 1 || callers.length !== 1 || callers[0] !== file) {
          violations.push(`${file}:${lineOf(ast, node)} 有限语音入口必须绑定字面量 entryId 和真实 caller`)
        } else transports.push({ entryId: ids[0], file })
      }
      if (ts.isIdentifier(expression) && registeredExecutors.has(expression.text)) {
        registerGovernedCall(node, node.arguments[0], node.arguments[3])
      } else if (ts.isIdentifier(expression) && frozenExecutors.has(expression.text)) {
        registerGovernedCall(node, node.arguments[0], node.arguments[6], node.arguments[3])
      } else if (ts.isIdentifier(expression) && streamExecutors.has(expression.text)
        && file !== 'src/hooks/useAIStream.ts') {
        registerGovernedCall(node, objectProperty(node.arguments[2], 'formalEntryId'), node.arguments[2])
      } else if (ts.isIdentifier(expression) && startAliases.has(expression.text)) {
        registerGovernedCall(node, objectProperty(node.arguments[2], 'formalEntryId'), node.arguments[2])
      } else if (ts.isPropertyAccessExpression(expression) && propertyName(expression.name) === 'start') {
        const owner = ts.isIdentifier(expression.expression) ? expression.expression.text : ''
        if (hookVariables.has(owner) || typedAIStartFile) {
          registerGovernedCall(node, objectProperty(node.arguments[2], 'formalEntryId'), node.arguments[2])
        }
      }

      if (ts.isIdentifier(expression) && rawIdentifiers.has(expression.text)) {
        violations.push(`${file}:${lineOf(ast, node)} 禁止绕过集中执行器调用 ${expression.text}()`)
      }
      if (ts.isPropertyAccessExpression(expression)) {
        const owner = ts.isIdentifier(expression.expression) ? expression.expression.text : ''
        const member = propertyName(expression.name)
        if ((rawNamespaces.has(owner) && (member === 'chat' || member === 'streamChat'))
          || ((member === 'chat' || member === 'streamChat') && file.startsWith('src/components/'))) {
          violations.push(`${file}:${lineOf(ast, node)} 禁止 member/namespace 模型直连 ${owner}.${member}()`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return { calls, transports, violations }
}

if (registry.version !== 2 || registry.bindingVersion !== 1
  || registry.scope !== 'formal-ai-execution-entry' || !Array.isArray(registry.entries)) {
  failures.push(`${registryPath}: 版本、bindingVersion、scope 或 entries 无效`)
}

const skillSource = fs.readFileSync(path.join(root, 'src/lib/agent/skill-registry.ts'), 'utf8')
const skillIds = new Set([...skillSource.matchAll(/\bid:\s*'([^']+)'/g)].map(match => match[1]))
const registered = new Map()
for (const entry of registry.entries ?? []) {
  if (!entry?.entryId || registered.has(entry.entryId)) {
    failures.push(`${registryPath}: 重复或无效 entryId ${String(entry?.entryId)}`)
    continue
  }
  if (!skillIds.has(entry.skillId)) failures.push(`${entry.entryId}: 未知 Skill ${String(entry.skillId)}`)
  if (!Array.isArray(entry.categories) || entry.categories.length === 0) failures.push(`${entry.entryId}: 缺少 categories`)
  if (!Array.isArray(entry.allowedCallers) || entry.allowedCallers.length === 0) failures.push(`${entry.entryId}: 缺少 allowedCallers`)
  if (!entry.runContractBuilderId || !entry.candidateKind || !entry.reason) failures.push(`${entry.entryId}: 执行/候选/理由不完整`)
  if (entry.adoptAllowed === false && (entry.adoptionTargets?.length ?? 0) > 0) failures.push(`${entry.entryId}: 未授权采纳却声明写目标`)
  if (['auxiliary', 'evaluation', 'experimental'].includes(entry.entryKind) && entry.adoptAllowed !== false) {
    failures.push(`${entry.entryId}: ${entry.entryKind} 必须机器声明 adoptAllowed=false`)
  }
  registered.set(entry.entryId, entry)
}

const actualCalls = []
const actualTransports = []
const scannedFiles = [
  ...['src/components', 'src/hooks', 'src/pages', 'src/lib/generation', 'src/lib/outline'].flatMap(dir => walk(dir)),
  // DETAIL-1: this service is itself a formal generation entry and must not
  // remain outside the UI/generation scanners merely because it predates them.
  'src/lib/ai/batch-detail-runner.ts',
  'src/lib/ai-town/consultation.ts',
  // G5-02 creator consultation is a formal durable service rather than a UI
  // hook; keep its literal entry/category binding under the same machine gate.
  'src/lib/open-world/creator-brief.ts',
  // G5-06 Creator Artifact Agent edits are a formal durable service; direct
  // edits share its candidate pipeline but never cross this AI entry.
  'src/lib/open-world/creator-artifact-edit.ts',
  // G6-01 owns the only frozen provider gateway for all six vNext open-world
  // runtime AI skills. Later UI work must call this governed service.
  'src/lib/open-world/runtime-ai-execution.ts',
  // G6-10's independent semantic grader is an eval-only formal model entry.
  // It may judge redacted observations, but can never adopt product content.
  'src/lib/evals/open-world-runtime/judge.ts',
  // G7-11's independent release calibrator is an explicit paid eval-only call.
  // Its output may only become Build-bound quality evidence.
  'src/lib/open-world/creator-quality-calibration.ts',
  ...walk('src/lib/longform-voice'),
]
for (const file of [...new Set(scannedFiles)]) {
    if (file === 'src/lib/agent/formal-ai-entry.ts') continue
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const analysis = analyzeAIEntrySource(source, file)
    actualCalls.push(...analysis.calls)
    actualTransports.push(...analysis.transports)
    failures.push(...analysis.violations)
}

const used = new Set()
const limited = new Map()
for (const entry of registry.limitedTransports ?? []) {
  if (!entry.entryId || registered.has(entry.entryId) || limited.has(entry.entryId)
    || entry.adoptAllowed !== false || entry.adoptionTargets?.length
    || !['ephemeral-author-input', 'read-only-audio'].includes(entry.boundary)
    || !entry.allowedCallers?.length || !entry.reason) {
    failures.push('有限语音入口边界无效: ' + entry.entryId)
  }
  limited.set(entry.entryId, entry)
}
for (const call of actualTransports) {
  if (!limited.get(call.entryId)?.allowedCallers.includes(call.file)) failures.push('未登记的有限语音调用: ' + call.entryId)
}
for (const entry of limited.values()) {
  for (const caller of entry.allowedCallers) {
    if (!actualTransports.some(call => call.entryId === entry.entryId && call.file === caller)) failures.push('语音入口缺少真实绑定: ' + entry.entryId)
  }
}
for (const call of actualCalls) {
  const entry = registered.get(call.entryId)
  if (!entry) {
    failures.push(`${call.file}:${call.line} 使用未登记 entryId ${call.entryId}`)
    continue
  }
  used.add(call.entryId)
  if (!entry.allowedCallers.includes(call.file)) {
    failures.push(`${call.file}:${call.line} 不在 ${call.entryId}.allowedCallers`)
  }
  for (const category of call.categories) {
    if (!entry.categories.includes('*') && !entry.categories.includes(category)) {
      failures.push(`${call.file}:${call.line} 的 category ${category} 不属于 ${call.entryId}`)
    }
  }
}
for (const entryId of registered.keys()) {
  if (!used.has(entryId)) failures.push(`${entryId}: 注册表残留或真实调用点未携带该 entryId`)
}

// Scanner self-tests cover the historical blind spots: member, alias, namespace and wrapper.
const memberSelfTest = analyzeAIEntrySource(
  "import { useAIStream } from '../hooks/useAIStream'; const ai = useAIStream(); ai.start([], undefined, { category: 'x' });",
  'src/components/Self.tsx',
)
const voiceSelfTest = analyzeAIEntrySource(
  "import { assertVoiceTransport as guard } from './contract'; guard('voice', caller);",
  'src/lib/longform-voice/fake.ts',
)
if (!voiceSelfTest.violations.some(item => item.includes('有限语音'))) failures.push('守卫自测失败：未阻断伪造语音 caller')
if (!memberSelfTest.violations.some(item => item.includes('entryId'))) failures.push('守卫自测失败：未阻断缺 entryId 的 member start')
const aliasSelfTest = analyzeAIEntrySource(
  "import { useAIStream as useModel } from '../hooks/useAIStream'; const { start: run } = useModel(); run([], undefined, { category: 'x' });",
  'src/components/Alias.tsx',
)
if (!aliasSelfTest.violations.some(item => item.includes('entryId'))) failures.push('守卫自测失败：未阻断 alias start')
const wrapperSelfTest = analyzeAIEntrySource(
  "import { chat as ask } from '../lib/ai/client'; const invoke = x => ask(x, {}); invoke([]);",
  'src/components/Wrapper.tsx',
)
if (!wrapperSelfTest.violations.some(item => item.includes('集中执行器'))) failures.push('守卫自测失败：未阻断 raw wrapper')
const namespaceSelfTest = analyzeAIEntrySource(
  "import * as api from '../lib/ai/client'; api.chat([], {});",
  'src/components/Namespace.tsx',
)
if (!namespaceSelfTest.violations.some(item => item.includes('member/namespace'))) failures.push('守卫自测失败：未阻断 namespace member')
const frozenAliasSelfTest = analyzeAIEntrySource(
  "import { executeFrozenFormalAIEntryV1 as runFrozen } from '../lib/agent/formal-ai-entry'; runFrozen('x', snapshot, skill, caller, [], {}, { category: 'x' });",
  'src/lib/FrozenAlias.ts',
)
if (!frozenAliasSelfTest.violations.some(item => item.includes('caller 字面量'))) {
  failures.push('守卫自测失败：未阻断伪造 caller 的 frozen formal entry alias')
}

if (failures.length) {
  console.error('[ai-entry-registry] ❌ 正式 AI 入口机器绑定未闭合:\n')
  failures.forEach(failure => console.error(`  ${failure}`))
  process.exit(1)
}

const counts = { formal: 0, auxiliary: 0, evaluation: 0, experimental: 0 }
for (const entry of registered.values()) counts[entry.entryKind]++
console.log(
  `[ai-entry-registry] ok: ${registered.size} bindings / ${actualCalls.length} calls; `
  + `formal ${counts.formal}, auxiliary ${counts.auxiliary}, evaluation ${counts.evaluation}, experimental ${counts.experimental}`,
)
