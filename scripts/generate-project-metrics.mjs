/* global console, process */

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const target = path.join(root, 'docs', 'MASTER-BLUEPRINT.md')
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
  let length = 0
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === declarationName) {
      let initializer = node.initializer
      if (initializer && ts.isCallExpression(initializer) && initializer.expression.getText(sourceFile) === 'Object.freeze') {
        initializer = initializer.arguments[0]
      }
      if (initializer && ts.isArrayLiteralExpression(initializer)) length = initializer.elements.length
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return length
}

function metrics() {
  const files = tsSourceFiles()
  const sourceLines = files.reduce((total, file) => {
    const source = fs.readFileSync(file, 'utf8')
    return total + countMatches(source, /\n/g)
  }, 0)
  const schema = read('src/lib/db/schema.ts')
  const schemaVersions = [...schema.matchAll(/this\.version\((\d+)\)/g)].map(match => Number(match[1]))
  const required = read('src/lib/db/ensure-schema.ts').match(/export const REQUIRED_TABLES = \[([\s\S]*?)\] as const/)?.[1] ?? ''
  const promptType = read('src/lib/types/prompt.ts').match(/export type PromptModuleKey =([\s\S]*?)(?:\n\nexport|\n\/\*\*|\nexport interface)/)?.[1] ?? ''
  const promptKeys = new Set([...promptType.matchAll(/\|\s*'([^']+)'/g)].map(match => match[1]))
  const seedFiles = fs.readdirSync(path.join(root, 'src/lib/ai'))
    .filter(name => /^prompt-seeds.*\.ts$/.test(name))
  const promptTemplates = seedFiles.reduce((total, name) =>
    total + countMatches(read(`src/lib/ai/${name}`), /\bmoduleKey:\s*'[^']+'/g), 0)
  return {
    version: JSON.parse(read('package.json')).version,
    sourceFiles: files.length,
    sourceLines,
    schemaVersion: Math.max(...schemaVersions),
    requiredTables: countMatches(required, /'[^']+'/g),
    projectTables: countMatches(read('src/lib/registry/project-tables.ts'), /\bname:\s*'[^']+'/g),
    promptModuleKeys: promptKeys.size,
    promptTemplates,
    contextSources: countMatches(read('src/lib/registry/context-sources.ts'), /\n\s*key:\s*'[^']+'/g),
    adoptionTargets: declaredArrayLength('src/lib/registry/adoption-schema.ts', 'ADOPTION_SCHEMAS'),
    adoptionExtensions: declaredArrayLength('src/lib/registry/adoption-schema.ts', 'ADOPTION_EXTENSIONS'),
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
    console.error('[project-metrics] MASTER-BLUEPRINT 实时事实已漂移，请运行 `npm run gen:project-metrics`。')
    process.exit(1)
  }
  console.log('[project-metrics] ok: Blueprint metrics match current code.')
} else {
  if (!current) throw new Error('MASTER-BLUEPRINT 缺少 project-metrics 标记')
  fs.writeFileSync(target, source.replace(current, generated))
  console.log('[project-metrics] updated docs/MASTER-BLUEPRINT.md')
}
