/* global console, process */

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const target = path.join(root, 'docs', 'ARCHITECTURE.md')
const START = '<!-- project-metrics:start -->'
const END = '<!-- project-metrics:end -->'

const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')

function tsSourceFiles() {
  const configPath = path.join(root, 'tsconfig.json')
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
  if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'))
  return ts.parseJsonConfigFileContent(configFile.config, ts.sys, root).fileNames
    .filter(file => /\.(ts|tsx)$/.test(file) && !file.endsWith('.d.ts'))
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length
}

function declaredArrayLength(rel, declarationName) {
  const source = read(rel)
  const sourceFile = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations = new Map()
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  const resolveLength = (initializer, seen = new Set()) => {
    if (ts.isArrayLiteralExpression(initializer)) return initializer.elements.length
    if (ts.isIdentifier(initializer)) {
      if (seen.has(initializer.text)) return 0
      const target = declarations.get(initializer.text)
      if (!target) return 0
      return resolveLength(target, new Set([...seen, initializer.text]))
    }
    if (!ts.isCallExpression(initializer)) return 0
    if (initializer.expression.getText(sourceFile) === 'Object.freeze') {
      return initializer.arguments[0] ? resolveLength(initializer.arguments[0], seen) : 0
    }
    if (
      ts.isPropertyAccessExpression(initializer.expression)
      && initializer.expression.name.text === 'map'
    ) {
      return resolveLength(initializer.expression.expression, seen)
    }
    return 0
  }

  const declaration = declarations.get(declarationName)
  return declaration ? resolveLength(declaration, new Set([declarationName])) : 0
}

/** ADOPTION_EXTENSIONS merges existing per-target entries with registered
 * narrative projectors. Counting two spread expressions as two extensions
 * would under-report the actual governance surface. No application execution. */
function adoptionExtensionCount() {
  const targets = new Set()
  const scan = (rel, accept) => {
    const sourceFile = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const visit = node => {
      if (ts.isObjectLiteralExpression(node)) {
        const fields = new Map(node.properties.filter(ts.isPropertyAssignment).map(field => [field.name.getText(sourceFile).replace(/^['"]|['"]$/g, ''), field.initializer]))
        accept(fields, sourceFile)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  scan('src/lib/registry/adoption-schema.ts', fields => {
    const target = fields.get('target')
    if (target && ts.isStringLiteral(target) && fields.has('id') && fields.has('policyRegistry')) targets.add(target.text)
  })
  scan('src/lib/registry/project-tables.ts', (fields, sourceFile) => {
    const name = fields.get('name'), semantics = fields.get('worldSemantic')
    if (name && ts.isStringLiteral(name) && semantics?.getText(sourceFile).includes('NARRATIVE_PROJECTOR_V1(')) targets.add(name.text)
  })
  if (!targets.size) throw new Error('无法从注册声明读取领域扩展')
  return targets.size
}

/** Read the literal fact actually bound to the exported PromptModuleKey type. */
function readPromptModuleKeys(sourceFile) {
  const exported = node => node.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword)
  const aliases = sourceFile.statements.filter(node => ts.isTypeAliasDeclaration(node)
    && node.name.text === 'PromptModuleKey' && exported(node))
  if (aliases.length !== 1) throw new Error('PromptModuleKey 必须有唯一导出声明')
  const type = aliases[0].type
  const inline = ts.isUnionTypeNode(type) ? [...type.types] : [type]
  let literals
  if (inline.every(node => ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal))) {
    literals = inline.map(node => node.literal)
  } else {
    if (!ts.isIndexedAccessTypeNode(type) || type.indexType.kind !== ts.SyntaxKind.NumberKeyword
      || !ts.isTypeQueryNode(type.objectType) || !ts.isIdentifier(type.objectType.exprName)) {
      throw new Error('PromptModuleKey 必须绑定字符串 union 或本文件 const 数组[number]')
    }
    const name = type.objectType.exprName.text
    const bindings = sourceFile.statements.flatMap(node => ts.isVariableStatement(node) && exported(node)
      && (node.declarationList.flags & ts.NodeFlags.Const)
      ? [...node.declarationList.declarations].filter(item => ts.isIdentifier(item.name) && item.name.text === name)
      : [])
    if (bindings.length !== 1 || !bindings[0].initializer) throw new Error(`PromptModuleKey 缺少唯一 const 绑定：${name}`)
    let value = bindings[0].initializer
    if (ts.isAsExpression(value) && ts.isTypeReferenceNode(value.type)
      && ts.isIdentifier(value.type.typeName) && value.type.typeName.text === 'const') value = value.expression
    if (!ts.isArrayLiteralExpression(value) || value.elements.some(item => !ts.isStringLiteral(item))) {
      throw new Error('PromptModuleKey const 绑定必须是纯字符串字面量数组')
    }
    literals = [...value.elements]
  }
  const keys = literals.map(node => node.text)
  if (!keys.length || keys.some(key => !key.trim())) throw new Error('PromptModuleKey 不得为空')
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index)
  if (duplicates.length) throw new Error(`PromptModuleKey 重复声明: ${[...new Set(duplicates)].join(', ')}`)
  return keys
}

function metrics() {
  const files = tsSourceFiles()
  const sourceLines = files.reduce((total, file) => {
    const source = fs.readFileSync(file, 'utf8')
    return total + countMatches(source, /\n/g)
  }, 0)
  const schema = read('src/lib/db/schema.ts')
  const schemaVersionMatch = schema.match(/export const STORYFORGE_SCHEMA_VERSION\s*=\s*(\d+)/)
  if (!schemaVersionMatch) throw new Error('无法从 schema.ts 读取 STORYFORGE_SCHEMA_VERSION')
  const schemaVersion = Number(schemaVersionMatch[1])
  const required = read('src/lib/db/ensure-schema.ts').match(/export const REQUIRED_TABLES = \[([\s\S]*?)\] as const/)?.[1] ?? ''
  const promptKeys = readPromptModuleKeys(ts.createSourceFile('src/lib/types/prompt.ts', read('src/lib/types/prompt.ts'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS))
  const seedFiles = fs.readdirSync(path.join(root, 'src/lib/ai'))
    .filter(name => /^prompt-seeds.*\.ts$/.test(name))
  const promptTemplates = seedFiles.reduce((total, name) =>
    total + countMatches(read(`src/lib/ai/${name}`), /\bmoduleKey:\s*'[^']+'/g), 0)
  return {
    version: JSON.parse(read('package.json')).version,
    sourceFiles: files.length,
    sourceLines,
    schemaVersion,
    requiredTables: countMatches(required, /'[^']+'/g),
    projectTables: declaredArrayLength('src/lib/registry/project-tables.ts', 'PROJECT_TABLES'),
    promptModuleKeys: promptKeys.length,
    promptTemplates,
    contextSources: declaredArrayLength('src/lib/registry/context-sources.ts', 'CONTEXT_SOURCES'),
    adoptionTargets: declaredArrayLength('src/lib/registry/adoption-schema.ts', 'ADOPTION_SCHEMAS'),
    adoptionExtensions: adoptionExtensionCount(),
  }
}

function render(value) {
  return [
    START,
    '> 本区块由 `npm run gen:project-metrics` 从当前代码生成；`npm run check:project-metrics` 在 CI 中防止漂移。',
    '',
    '| 当前事实 | 数值 | 单一事实源 |',
    '|---|---:|---|',
    `| 应用语义版本 | \`${value.version}\` | \`package.json\` |`,
    `| TypeScript 生产源码 | ${value.sourceFiles} 个文件 / ${value.sourceLines} 行 | \`tsconfig.json\` |`,
    `| IndexedDB schema | v${value.schemaVersion} / ${value.requiredTables} 张 required tables | \`schema.ts\` / \`REQUIRED_TABLES\` |`,
    `| PROJECT_TABLES | ${value.projectTables} 张表 | \`project-tables.ts\` |`,
    `| Prompt 主线 | ${value.promptModuleKeys} 个 moduleKey / ${value.promptTemplates} 条内置模板 | \`PromptModuleKey\` / \`prompt-seeds*.ts\` |`,
    `| CONTEXT_SOURCES | ${value.contextSources} 个上下文源 | \`context-sources.ts\` |`,
    `| 写回治理 | ${value.adoptionTargets} 个通用 adopt target / ${value.adoptionExtensions} 个领域扩展 | \`adoption-schema.ts\` |`,
    END,
  ].join('\n')
}

const source = fs.readFileSync(target, 'utf8')
const generated = render(metrics())
const current = source.match(new RegExp(`${START}[\\s\\S]*?${END}`))?.[0] ?? ''

if (process.argv.includes('--check')) {
  if (current !== generated) {
    console.error('[project-metrics] ARCHITECTURE 实时事实已漂移，请运行 `npm run gen:project-metrics`。')
    process.exit(1)
  }
  console.log('[project-metrics] ok: architecture metrics match current code.')
} else {
  if (!current) throw new Error('ARCHITECTURE 缺少 project-metrics 标记')
  fs.writeFileSync(target, source.replace(current, generated))
  console.log('[project-metrics] updated docs/ARCHITECTURE.md')
}
