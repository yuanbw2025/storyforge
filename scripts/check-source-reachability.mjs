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
  // AGENT-1 Phase 27.1-a/b is a headless public boundary for tools and the read-only AgentRunner.
  // Keep it independently testable without eagerly bundling the future copilot into the current UI.
  'src/lib/agent/index.ts',
  // CTXG Phase 1A is a headless public Context Gateway/evidence boundary until formal Skills switch in CTXG-7.
  'src/lib/context-gateway/index.ts',
  // FLOW-3 public domain-node boundary is exercised by regression tests and external tooling.
  'src/lib/node-authoring/index.ts',
  // HARNESS-26 is a headless offline release-evaluation boundary; production routing must not import it.
  'src/lib/evals/agent-harness/paired-workflow.ts',
  // HARNESS-28 is the headless long-consistency fixture/verifier/artifact boundary; it remains report-only.
  'src/lib/evals/long-consistency/index.ts',
  // PHASE4 is a headless engineering-scale gate; it remains report-only and never writes author Canon.
  'src/lib/evals/index.ts',
  // FLOW-2 compatibility workspace remains intentionally reachable for old graphs and migration tests
  // while the product entry points use NodeAuthoringWorkspace.
  'src/components/node-flow/NodeModeWorkspace.tsx',
  // Server-only commercial/community/online adapters and external creator tooling live behind a
  // headless boundary. It must stay independently reachable without entering the pure browser bundle.
  'src/lib/game-platform/headless-platform.ts',
  // CHATGAME-2 legacy authoring compatibility is retained only for migration/regression evidence while
  // ProductHub routes new work through the frozen-source production studio. Delete this explicit
  // entrypoint after legacy migration coverage no longer imports the old workbench directly.
  'src/components/character-interaction/InteractionGameWorkbench.tsx',
  // Legacy game-release policy is a headless migration classifier only. No routed UI may import it;
  // check:architecture enforces that boundary until v1 release migration support is retired.
  'src/lib/game-production/legacy-entry-governance.ts',
  // Mist Harbor is a deterministic regression/roadshow fixture. It intentionally exercises a large
  // world authoring surface without becoming a product or WorldRelease entrypoint.
  'src/lib/world-engine/mist-harbor-demo.ts',
  // Scope conversion is a headless ownership-administration service. It remains independently tested
  // while no author UI exposes arbitrary record-owner conversion.
  'src/lib/world-engine/scope-conversion.ts',
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
