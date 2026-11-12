import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { pathToFileURL } from 'node:url'

const unit = /^(?:src|tests)\/.*\.test\.tsx?$/
const app = /^src\/.*\.(?:tsx?|jsx?)$/
const nodeTest = /^(?:scripts|tools)\/.*\.test\.[cm]?js$/
const tooling = /^(?:scripts|tools)\/.*\.[cm]?js$/
const workflow = /^\.github\/workflows\/[^/]+\.ya?ml$/
const scopeChecker = 'scripts/quality/check-merge-scope.mjs'
const routingTest = 'scripts/quality/check-merge-scope.test.mjs'
const databaseSchema = 'src/lib/db/schema.ts'
const mediaList = 'scripts/quality/avg-media-harnesses.txt'
const manualMedia = new Set(readFileSync(new URL('./avg-media-harnesses.txt', import.meta.url), 'utf8').trim().split(/\r?\n/))
const tsConfig = /^tsconfig(?:\.[\w.-]+)?\.json$/

/** @param {string} command @param {string[]} args */
function run(command, args) {
  console.log('+', command, ...args)
  execFileSync(command, args, { stdio: 'inherit' })
}

/** @param {string[]} args */
function names(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\0').filter(Boolean)
}

/** @param {string} path */
function moduleName(path) {
  return path.replace(/\.(?:[cm]?[jt]sx?)$/, '').replace(/\/index$/, '')
}

/** @param {string} importer @param {string} specifier */
function importedModule(importer, specifier) {
  if (specifier.startsWith('@/')) return moduleName('src/' + specifier.slice(2))
  if (specifier.startsWith('.')) return moduleName(posix.join(posix.dirname(importer), specifier))
}

// Indirect and dynamic contracts are verified using the PR's targeted cases.
/** @param {string[]} changed @param {string[]} tests @param {(test: string) => string[]} importsOf
 * @param {(test:string, specifier:string, source:string)=>boolean} affected */
export function directTests(changed, tests, importsOf, affected = () => true) {
  const modules = new Map(changed.map(path => [moduleName(path), path]))
  return tests.filter(test => !manualMedia.has(test) && importsOf(test).some(specifier => {
    const name = importedModule(test, specifier)
    const source = name && modules.get(name)
    return source && affected(test, specifier, source)
  }))
}

/** @param {string[]} paths @param {(file: string) => boolean} [exists] */
export function plan(paths, exists = existsSync) {
  const present = paths.filter(exists)
  const source = paths.filter(path => app.test(path) && !unit.test(path))
  const nodeSources = paths.filter(path => tooling.test(path) && !nodeTest.test(path))
  /** @type {Set<string>} */
  const scripts = new Set()
  if (paths.some(path => /^(?:src\/lib\/db(?:\/|\.ts$)|src\/lib\/registry\/project-tables\.ts$)/.test(path))) scripts.add('check:required-tables')
  if (paths.some(path => /^src\/lib\/registry\/(?:context-sources|field-registry|adoption-schema)\.ts$/.test(path))) scripts.add('check:ai-manual')
  if (paths.includes('tests/acceptance/narrative-world/manifest-v1.json')) scripts.add('check:narrative-world')
  const nodeTests = new Set(present.filter(path => nodeTest.test(path)))
  for (const path of nodeSources) {
    const sibling = path.replace(/(\.[cm]?js)$/, '.test$1')
    if (exists(sibling)) nodeTests.add(sibling)
  }
  if (paths.some(path => workflow.test(path) || path === scopeChecker || path === mediaList)) nodeTests.add(routingTest)
  const typeConfigs = present.filter(path => tsConfig.test(path))
  if (source.some(path => !exists(path)) || paths.some(path => ['package.json', 'package-lock.json'].includes(path))) typeConfigs.push('tsconfig.json')
  const units = present.filter(path => unit.test(path) && !manualMedia.has(path))
  if (paths.includes(databaseSchema)) {
    typeConfigs.push('tsconfig.json')
    units.push('tests/registry/project-tables.test.ts')
  }
  if (paths.some(path => ['vitest.config.ts', 'tests/setup.ts'].includes(path))) units.push('tests/registry/project-tables.test.ts')
  if (paths.some(path => ['vite.config.ts', 'vite.adventure-player.config.ts'].includes(path))) scripts.add('build')
  const governance = paths.some(path => ['AGENTS.md', 'CLAUDE.md', 'docs/CONTEXT-ROUTING.md', 'scripts/check-agent-context.mjs'].includes(path))
  const sharedTestInputs = paths.filter(path => /^tests\/(?:helpers|fixtures)\//.test(path))
  const related = [...source, ...sharedTestInputs]
  const docs = paths.some(path => path.startsWith('website-docs/'))
  return { units, related, governance, nodeTests: [...nodeTests], scripts: [...scripts], typeConfigs: [...new Set(typeConfigs)],
    workflowFiles: present.filter(path => workflow.test(path)), js: present.filter(path => tooling.test(path)),
    shell: present.filter(path => /^(scripts|tools)\/.*\.sh$/.test(path)),
    python: present.filter(path => /^(scripts|tools)\/.*\.py$/.test(path)),
    docs,
    npm: Boolean(docs || related.length || units.length || scripts.size || typeConfigs.length || [...nodeTests].some(path => path !== routingTest)) }
}

async function main() {
  const [base, option] = process.argv.slice(2)
  if (!base || base.startsWith('-') || (option && option !== '--install')) throw new Error('Usage: node scripts/quality/check-merge-scope.mjs BASE [--install]')
  // Resolve an immutable base and compare it with the checked-out merge tree.
  const sha = execFileSync('git', ['rev-parse', '--verify', base + '^{commit}'], { encoding: 'utf8' }).trim()
  run('git', ['-c', 'core.whitespace=trailing-space,space-before-tab,cr-at-eol', 'diff', '--check', sha, 'HEAD'])
  const paths = names(['diff', '--no-renames', '--name-only', '-z', sha, 'HEAD'])
  const checks = plan(paths)
  console.log('Changed paths:', JSON.stringify(paths))
  if (checks.npm && option === '--install') run('npm', ['ci', '--no-audit', '--no-fund'])
  if (checks.workflowFiles.length) run('ruby', ['-rpsych', '-e', 'ARGV.each { |f| Psych.parse_file(f) }', ...checks.workflowFiles])
  for (const file of checks.js) run('node', ['--check', file])
  for (const file of checks.shell) run('bash', ['-n', file])
  if (checks.python.length) run('python3', ['-c', 'import ast, pathlib, sys; [ast.parse(pathlib.Path(p).read_bytes(), p) for p in sys.argv[1:]]', ...checks.python])
  if (checks.governance) run('node', ['scripts/check-agent-context.mjs'])
  if (checks.docs) {
    run('node', ['website-docs/.vitepress/check-i18n.mjs'])
    run('npm', ['run', 'docs:build'])
    run('node', ['website-docs/.vitepress/check-links.mjs'])
  }
  for (const script of checks.scripts) run('npm', ['run', script])
  if (checks.nodeTests.length) run('node', ['--test', ...checks.nodeTests])
  const units = new Set(checks.units)
  if (checks.related.length) {
    const { default: ts } = await import('typescript')
    const tests = names(['ls-files', '-z', '--', 'src', 'tests']).filter(path => unit.test(path) && existsSync(path))
    const { unchangedFunctions, onlyUnchangedImports, inertModule } = await import('./affected-exports.mjs')
    const { additiveStoreChange, usesOnlyExistingStores } = await import('./additive-store-consumers.mjs')
    /** @type {ReturnType<typeof additiveStoreChange>} */
    let additiveSchema
    const changedModules = new Set(paths.map(moduleName))
    const priorPaths = new Set(names(['ls-tree', '-rz', '--name-only', sha, '--', 'src', 'tests']))
    /** @type {Map<string, Set<string>>} */
    const stable = new Map()
    for (const file of checks.related.filter(f => app.test(f) && priorPaths.has(f) && existsSync(f))) {
      const before = execFileSync('git', ['show', sha + ':' + file], { encoding: 'utf8' })
      const after = readFileSync(file, 'utf8')
      if (file === databaseSchema) additiveSchema = additiveStoreChange(before, after)
      stable.set(file, unchangedFunctions(file, before, after,
        specifier => changedModules.has(importedModule(file, specifier) ?? ''),
        specifier => {
          const name = importedModule(file, specifier)
          if (!name || changedModules.has(name)) return false
          const path = [name + '.ts', name + '.tsx', name + '/index.ts'].find(p => priorPaths.has(p) && existsSync(p))
          return Boolean(path && inertModule(path, readFileSync(path, 'utf8')))
        }))
    }
    let contents = ''
    const matches = directTests(checks.related, tests, test => {
      contents = readFileSync(test, 'utf8')
      return ts.preProcessFile(contents, true, true).importedFiles.map(file => file.fileName)
    }, (test, specifier, source) => {
      if (source === databaseSchema && additiveSchema && usesOnlyExistingStores(test, contents, specifier, additiveSchema)) return false
      return !onlyUnchangedImports(test, contents, specifier, stable.get(source) ?? new Set())
    })
    for (const file of matches) units.add(file)
    if (!units.size && checks.related.some(path => app.test(path))) checks.typeConfigs.push('tsconfig.json')
  }
  for (const config of new Set(checks.typeConfigs)) run('node_modules/.bin/tsc', ['--noEmit', '-p', config])
  if (units.size) run('node_modules/.bin/vitest', ['run', ...units])
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
