import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const configPath = path.join(root, 'tsconfig.json')
const configFile = ts.readConfigFile(configPath, ts.sys.readFile)

if (configFile.error) {
  throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'))
}

const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root)
const sourceFiles = new Set(
  config.fileNames
    .filter(file => /\.(ts|tsx)$/.test(file) && !file.endsWith('.d.ts'))
    .map(file => path.resolve(file)),
)

const entrypoints = [
  'src/main.tsx',
  // Product-approved i18n scaffold: retained until the English milestone is decided.
  'src/i18n/index.ts',
].map(file => path.resolve(root, file))

const graph = new Map()
for (const file of sourceFiles) {
  const imports = ts.preProcessFile(fs.readFileSync(file, 'utf8'), true, true).importedFiles
  const dependencies = new Set()
  for (const imported of imports) {
    const resolved = ts.resolveModuleName(imported.fileName, file, config.options, ts.sys)
      .resolvedModule?.resolvedFileName
    if (resolved && sourceFiles.has(path.resolve(resolved))) {
      dependencies.add(path.resolve(resolved))
    }
  }
  graph.set(file, dependencies)
}

const reachable = new Set()
const pending = [...entrypoints]
while (pending.length > 0) {
  const file = pending.pop()
  if (!file || reachable.has(file)) continue
  reachable.add(file)
  for (const dependency of graph.get(file) ?? []) pending.push(dependency)
}

const unreachable = [...sourceFiles]
  .filter(file => !reachable.has(file))
  .map(file => path.relative(root, file))
  .sort()

if (unreachable.length > 0) {
  console.error('[source-reachability] unreachable source files:')
  unreachable.forEach(file => console.error(`  - ${file}`))
  console.error('Delete confirmed dead code or add an intentional entrypoint with a reason.')
  process.exit(1)
}

console.log(`[source-reachability] ok: ${sourceFiles.size} source files reachable from declared entrypoints`)
