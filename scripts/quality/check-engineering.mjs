import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import ts from 'typescript'
import { ESLint } from 'eslint'

/** @typedef {{path: string, sha256: string, reason: string}} HistoricalException */
/** @typedef {{kind: 'typescript'|'eslint', file: string, code: string, message: string, anchor: string, line: number, column: number, start: number, length: number}} Diagnostic */
/** @typedef {{identity: string, count: number, diagnostic: Diagnostic}} DebtEntry */
/** @typedef {{schema: string, pins: Record<string, unknown>, entries: DebtEntry[]}} Baseline */
/** @typedef {{completed: true, compilerExitCode: number, roots: string[], diagnostics: Diagnostic[], loaded: Record<string, string>}} WorkerResult */

const self = fileURLToPath(import.meta.url)
const defaultBaseline = 'scripts/quality/engineering-debt-baseline.json'
const policyPath = 'scripts/quality/engineering-scope.json'
const configPaths = ['tsconfig.json', 'tsconfig.tests.open-world-experience.json', 'tsconfig.tests.json', 'tsconfig.tooling.json', 'eslint.tooling.config.mjs', policyPath]
/**
 * @param {string|Buffer} value */
const sha = value => createHash('sha256').update(value).digest('hex')
/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>} */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
/**
 * @param {string} file
 * @returns {unknown} */
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
/**
 * @param {string} file
 * @param {unknown} value */
function writeNewJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
}
/**
 * @param {string} root
 * @param {string} name */
function regularFile(root, name) {
  if (path.isAbsolute(name) || name.split(/[\\/]/).includes('..')) throw new Error(`Unsafe source path: ${name}`)
  const file = path.join(root, name)
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected an ordinary source file: ${name}`)
  return file
}

/** No prefix exemption: every historical exception has exact bytes and a reason.
 *
 * @param {string} root
 * @param {string[]} files
 * @param {HistoricalException[]} exceptions */
export function currentScope(root, files, exceptions) {
  /** @type {Set<string>} */
  const excluded = new Set()
  for (const item of exceptions) {
    if (!item.reason.trim() || excluded.has(item.path) || !files.includes(item.path)) throw new Error(`Invalid historical exception: ${item.path}`)
    if (sha(fs.readFileSync(regularFile(root, item.path))) !== item.sha256) throw new Error(`Historical bytes changed: ${item.path}`)
    excluded.add(item.path)
  }
  const active = files.filter(file => !excluded.has(file))
  const tests = active.filter(file => file.startsWith('tests/') && /\.(?:[cm]?ts|tsx)$/.test(file))
  const tooling = active.filter(file => /\.(?:[cm]?js|jsx)$/.test(file)
    || (/\.(?:[cm]?ts|tsx)$/.test(file) && (file.startsWith('scripts/') || file.startsWith('tools/') || /(?:^|\/)(?:[^/]+\.)?config\.[cm]?ts$/.test(file))))
  if (!tests.length || !tooling.length) throw new Error('Empty engineering scope')
  return { tests, tooling, exceptions }
}

/** Shared ambient declarations are present in every compiler program.
 *
 * @param {string} root
 * @param {string[]} roots
 * @param {string[]} configured */
export function sharedDeclarations(root, roots, configured) {
  const shared = new Set(configured)
  for (const name of roots) {
    if (name.endsWith('.d.ts')) { shared.add(name); continue }
    const source = ts.createSourceFile(name, fs.readFileSync(regularFile(root, name), 'utf8'), ts.ScriptTarget.Latest, true)
    /**
 * @param {import('typescript').Node} node */
    const visit = node => {
      if (ts.isModuleDeclaration(node) && ((node.flags & ts.NodeFlags.GlobalAugmentation) !== 0 || ts.isStringLiteral(node.name))) shared.add(name)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return [...shared].sort()
}

/**
 * @param {string[]} expected
 * @param {string[][]} actual */
export function assertRootCoverage(expected, actual) {
  const all = actual.flat(), desired = [...expected].sort()
  if (all.length !== expected.length || new Set(all).size !== all.length
    || [...all].sort().some((name, index) => name !== desired[index])) throw new Error('Incomplete or duplicate primary root coverage')
}

/** Identity uses the exact diagnostic and source line(s), not an error quota.
 * Line numbers remain visible but adding an unrelated earlier line does not
 * silently create or forgive debt. Repeated identical errors retain counts.
 *
 * @param {Diagnostic} diagnostic */
export function diagnosticIdentity(diagnostic) {
  return JSON.stringify([diagnostic.kind, diagnostic.file, diagnostic.code, diagnostic.message,
    diagnostic.anchor, diagnostic.column, diagnostic.length])
}

/**
 * @param {Diagnostic[]} diagnostics
 * @returns {DebtEntry[]} */
export function debtEntries(diagnostics) {
  /** @type {Set<string>} */
  const exact = new Set()
  /** @type {Map<string, DebtEntry>} */
  const grouped = new Map()
  for (const diagnostic of diagnostics) {
    const occurrence = JSON.stringify([diagnostic.kind, diagnostic.file, diagnostic.start, diagnostic.length, diagnostic.code, diagnostic.message])
    if (exact.has(occurrence)) continue // Same imported source reported by two cohorts.
    exact.add(occurrence)
    const identity = diagnosticIdentity(diagnostic), previous = grouped.get(identity)
    if (previous) previous.count++
    else grouped.set(identity, { identity, count: 1, diagnostic })
  }
  return [...grouped.values()].sort((a, b) => a.identity.localeCompare(b.identity))
}

/**
 * @param {DebtEntry[]} actual
 * @param {DebtEntry[]} accepted */
export function compareDebt(actual, accepted) {
  /** @type {Map<string, number>} */
  const old = new Map()
  for (const entry of accepted) {
    if (entry.identity !== diagnosticIdentity(entry.diagnostic) || !Number.isSafeInteger(entry.count) || entry.count < 1 || old.has(entry.identity)) throw new Error('Invalid or duplicate baseline entry')
    old.set(entry.identity, entry.count)
  }
  const current = new Map(actual.map(entry => [entry.identity, entry.count]))
  const added = actual.filter(entry => entry.count > (old.get(entry.identity) ?? 0))
  const resolved = accepted.filter(entry => entry.count > (current.get(entry.identity) ?? 0))
  // Resolved debt must be pruned from the reviewed baseline, so a fixed error
  // cannot silently return using an obsolete allowance.
  return { passed: added.length === 0 && resolved.length === 0, added, resolved }
}

/** Normalize checkout-local path values in a copy of the evidence only. The
 * actual compiler options retain their native paths. Outside paths and all
 * other option values remain different when their semantics differ.
 * @param {string} root
 * @param {Record<string, unknown>} pins
 * @returns {Record<string, unknown>} */
export function portablePins(root, pins) {
  const prefix = path.resolve(root).replaceAll('\\', '/').replace(/\/$/, '')
  /** @param {unknown} value
   * @returns {unknown} */
  const normalize = value => {
    if (typeof value === 'string') {
      const normalized = value.replaceAll('\\', '/')
      if (normalized === prefix) return '<repo>'
      if (normalized.startsWith(`${prefix}/`)) return `<repo>/${normalized.slice(prefix.length + 1)}`
      return value
    }
    if (Array.isArray(value)) return value.map(normalize)
    if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
    return value
  }
  return Object.fromEntries(Object.entries(pins).map(([key, value]) => [key, normalize(value)]))
}

/** @param {Record<string, unknown>} actual
 * @param {Record<string, unknown>} accepted */
export function assertCompatiblePins(actual, accepted) {
  if (JSON.stringify(actual) !== JSON.stringify(accepted)) throw new Error('Engineering compiler/configuration pins changed; review a new capture without weakening the gate')
}

/** Newly introduced gate code and the already-clean Experience unit cannot be
 * reclassified as pre-existing debt by an initial capture.
 * @param {Diagnostic[]} diagnostics
 * @param {string[]} files */
export function assertNoDebtInFiles(diagnostics, files) {
  const errors = diagnostics.filter(diagnostic => files.includes(diagnostic.file))
  if (errors.length) throw new Error(`New/previously clean engineering source has diagnostics: ${JSON.stringify(errors)}`)
}

/**
 * @param {string} text
 * @param {number} start
 * @param {number} length */
function sourceAnchor(text, start, length) {
  const begin = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const next = text.indexOf('\n', start + length)
  return sha(text.slice(begin, next < 0 ? text.length : next).replaceAll('\r\n', '\n'))
}

/**
 * @param {string} root
 * @param {readonly import('typescript').Diagnostic[]} diagnostics
 * @returns {Diagnostic[]} */
export function compilerDiagnostics(root, diagnostics) {
  return diagnostics.map(d => {
    if (!d.file || d.start === undefined) throw new Error(`Unbaselinable compiler/config error TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)
    const position = d.file.getLineAndCharacterOfPosition(d.start), length = d.length ?? 0
    return { kind: 'typescript', file: path.relative(root, d.file.fileName).replaceAll(path.sep, '/'), code: `TS${d.code}`,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n').replaceAll(root.replaceAll(path.sep, '/'), '<repo>').replaceAll(root, '<repo>'), anchor: sourceAnchor(d.file.text, d.start, length),
      line: position.line + 1, column: position.character + 1, start: d.start, length }
  })
}

/**
 * @param {string} root
 * @param {string[]} roots
 * @param {import('typescript').CompilerOptions} options
 * @returns {WorkerResult} */
export function compileRoots(root, roots, options) {
  const program = ts.createProgram({ rootNames: roots.map(name => path.join(root, name)), options })
  const actualRoots = program.getRootFileNames().map(name => path.relative(root, name).replaceAll(path.sep, '/'))
  assertRootCoverage(roots, [actualRoots])
  for (const name of roots) if (!program.getSourceFile(path.join(root, name))) throw new Error(`Compiler did not load target: ${name}`)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  const syntax = program.getSyntacticDiagnostics()
  if (syntax.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(syntax, { getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n' }))
  /** @type {Record<string, string>} */
  const loaded = {}
  for (const source of program.getSourceFiles()) {
    const name = path.relative(root, source.fileName).replaceAll(path.sep, '/')
    if (!name.startsWith('../') && !name.split('/').includes('node_modules')) loaded[name] = sha(source.text)
  }
  return { completed: true, compilerExitCode: diagnostics.some(d => d.category === ts.DiagnosticCategory.Error) ? 2 : 0,
    roots: actualRoots, diagnostics: compilerDiagnostics(root, diagnostics), loaded }
}

/**
 * @param {string} root
 * @param {string} config */
function readProject(root, config) {
  const filename = path.join(root, config), read = ts.readConfigFile(filename, ts.sys.readFile)
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, filename)
  if (parsed.errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors, { getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n' }))
  const strictOptions = ['noImplicitAny', 'strictNullChecks', 'strictFunctionTypes', 'strictBindCallApply', 'strictPropertyInitialization', 'alwaysStrict', 'useUnknownInCatchVariables', 'strictBuiltinIteratorReturn']
  if (!parsed.options.strict || !parsed.options.noEmit || !parsed.options.noUnusedLocals || !parsed.options.noUnusedParameters
    || !parsed.options.isolatedModules || !parsed.options.noFallthroughCasesInSwitch
    || parsed.options.noCheck || parsed.options.noResolve || parsed.options.noLib
    || strictOptions.some(name => parsed.options[name] === false)) throw new Error(`Strict compiler policy missing: ${config}`)
  if (config === 'tsconfig.tooling.json' && (!parsed.options.allowJs || !parsed.options.checkJs)) throw new Error('Tooling JavaScript semantic checking is required')
  return parsed
}

/**
 * @param {string} root
 * @param {string[]} files
 * @returns {Promise<Diagnostic[]>} */
export async function lintNode(root, files) {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: path.join(root, 'eslint.tooling.config.mjs') })
  for (const file of files) {
    const config = await eslint.calculateConfigForFile(file)
    if (await eslint.isPathIgnored(file) || !config) throw new Error(`Unlinted engineering file: ${file}`)
    const rule = config.rules?.['no-undef'], severity = Array.isArray(rule) ? rule[0] : rule
    if (/\.(?:[cm]?js|jsx)$/.test(file) && severity !== 2 && severity !== 'error') throw new Error(`Node no-undef rule is required: ${file}`)
  }
  const results = await eslint.lintFiles(files)
  assertRootCoverage(files, [results.map(result => path.relative(root, result.filePath).replaceAll(path.sep, '/'))])
  /** @type {Diagnostic[]} */
  const diagnostics = []
  for (const result of results) {
    const text = fs.readFileSync(result.filePath, 'utf8'), lines = text.split('\n')
    for (const message of result.messages) {
      if (message.fatal || !message.ruleId) throw new Error(`ESLint parsing/configuration failure: ${result.filePath}: ${message.message}`)
      const start = lines.slice(0, message.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + message.column - 1
      const endLine = message.endLine ?? message.line, endColumn = message.endColumn ?? message.column
      const end = lines.slice(0, endLine - 1).reduce((sum, line) => sum + line.length + 1, 0) + endColumn - 1
      diagnostics.push({ kind: 'eslint', file: path.relative(root, result.filePath).replaceAll(path.sep, '/'),
        code: message.ruleId, message: message.message, anchor: sourceAnchor(text, start, end - start),
        line: message.line, column: message.column, start, length: end - start })
    }
  }
  return diagnostics
}

/**
 * @param {string} root
 * @param {string[]} files */
function hashes(root, files) {
  return Object.fromEntries([...new Set(files)].sort().map(name => [name, sha(fs.readFileSync(regularFile(root, name)))]))
}

/**
 * @param {string} root
 * @param {string|undefined} evidenceDirectory */
async function collect(root, evidenceDirectory) {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const files = [...new Set(listed.split('\0').filter(Boolean))].sort()
  const rawPolicy = json(path.join(root, policyPath))
  if (!record(rawPolicy) || rawPolicy.version !== 1 || typeof rawPolicy.cohortSize !== 'number' || !Number.isSafeInteger(rawPolicy.cohortSize) || !Array.isArray(rawPolicy.exceptions)
    || !Array.isArray(rawPolicy.zeroDebtFiles) || !rawPolicy.zeroDebtFiles.every(value => typeof value === 'string')) throw new Error('Invalid engineering scope policy')
  const exceptions = rawPolicy.exceptions.map(value => {
    if (!record(value) || typeof value.path !== 'string' || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.reason !== 'string') throw new Error('Invalid exact historical exception')
    return { path: value.path, sha256: value.sha256, reason: value.reason }
  })
  const policy = { cohortSize: rawPolicy.cohortSize, exceptions, zeroDebtFiles: /** @type {string[]} */ (rawPolicy.zeroDebtFiles) }
  if (policy.zeroDebtFiles.some(name => !files.includes(name))) throw new Error('Missing zero-debt source target')
  if (policy.cohortSize < 1 || policy.cohortSize > 160) throw new Error('Invalid compiler cohort size')
  const scope = currentScope(root, files, policy.exceptions)
  // Check the new collector/configuration first; a first infrastructure error
  // must not cost another full test-type inventory.
  const projects = [{ name: 'tooling', roots: scope.tooling, project: readProject(root, 'tsconfig.tooling.json') },
    { name: 'tests', roots: scope.tests, project: readProject(root, 'tsconfig.tests.json') }]
  const inputNames = [...new Set([...files.filter(name => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(name)), ...configPaths, 'package.json', 'package-lock.json'])]
  const before = hashes(root, inputNames)
  /** @type {Diagnostic[]} */
  const diagnostics = []
  /** @type {Record<string, string>} */
  const loaded = {}
  const work = evidenceDirectory ?? fs.mkdtempSync(path.join(os.tmpdir(), 'storyforge-engineering-types-'))
  if (evidenceDirectory) fs.mkdirSync(work, { recursive: false })
  let completed = false
  /** @type {{name: string, primaryRoots: number, programs: number, compilerErrorPrograms: number}[]} */
  const compilerSummary = []
  try {
    for (const item of projects) {
      const configured = /** @type {string[]} */ (item.project.raw.files ?? [])
      const shared = sharedDeclarations(root, item.roots, configured)
      const chunks = []
      for (let offset = 0; offset < item.roots.length; offset += policy.cohortSize) chunks.push(item.roots.slice(offset, offset + policy.cohortSize))
      assertRootCoverage(item.roots, chunks)
      let compilerErrorPrograms = 0
      for (let index = 0; index < chunks.length; index++) {
        const plan = path.join(work, `${item.name}-${index}.plan.json`), output = path.join(work, `${item.name}-${index}.result.json`)
        const roots = [...new Set([...shared, ...chunks[index]])]
        writeNewJSON(plan, { root, roots, options: item.project.options })
        const child = spawnSync(process.execPath, [self, '--type-worker', plan, output], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
        writeNewJSON(path.join(work, `${item.name}-${index}.command.json`), {
          argv: [process.execPath, self, '--type-worker', plan, output],
          exitCode: child.status, signal: child.signal, error: child.error?.message ?? null,
          stdout: child.stdout, stderr: child.stderr,
        })
        if (child.error || child.signal || (child.status !== 0 && child.status !== 2) || !fs.existsSync(output)) throw new Error(`Compiler process failed (${item.name}/${index}): ${child.error?.message ?? child.signal ?? child.stderr}`)
        const result = /** @type {WorkerResult} */ (json(output))
        if (result.completed !== true || result.compilerExitCode !== child.status) throw new Error('Incomplete compiler result')
        assertRootCoverage(roots, [result.roots])
        assertNoDebtInFiles(result.diagnostics, policy.zeroDebtFiles)
        diagnostics.push(...result.diagnostics)
        if (result.compilerExitCode) compilerErrorPrograms++
        for (const [name, hash] of Object.entries(result.loaded)) {
          if (loaded[name] && loaded[name] !== hash) throw new Error(`Source changed between compiler cohorts: ${name}`)
          loaded[name] = hash
        }
        console.log(`[engineering] ${item.name} ${index + 1}/${chunks.length}: ${chunks[index].length} primary roots, ${result.diagnostics.length} compiler diagnostics`)
      }
      compilerSummary.push({ name: item.name, primaryRoots: item.roots.length, programs: chunks.length, compilerErrorPrograms })
      if (item.name === 'tooling') {
        const lint = await lintNode(root, scope.tooling)
        writeNewJSON(path.join(work, 'node-lint.diagnostics.json'), lint)
        assertNoDebtInFiles(lint, policy.zeroDebtFiles)
        diagnostics.push(...lint)
      }
    }
    const finalFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    if (JSON.stringify([...new Set(finalFiles.split('\0').filter(Boolean))].sort()) !== JSON.stringify(files)) throw new Error('Engineering file inventory changed during collection')
    const after = hashes(root, inputNames)
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Engineering inputs changed during collection')
    for (const [name, hash] of Object.entries(loaded)) {
      const text = ts.sys.readFile(regularFile(root, name))
      if (text === undefined || sha(text) !== hash) throw new Error(`Loaded source changed during collection: ${name}`)
    }
    const pins = portablePins(root, { compiler: ts.version, eslint: ESLint.version,
      compilerOptions: projects.map(item => ({ name: item.name, options: item.project.options })),
      configurationHashes: hashes(root, configPaths), lockfileHash: before['package-lock.json'] })
    completed = true
    return { schema: 'storyforge.engineering-type-report.v1', pins,
      captureIdentity: { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        status: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }) },
      scope: { tests: scope.tests, tooling: scope.tooling, historicalExceptions: policy.exceptions, zeroDebtFiles: policy.zeroDebtFiles },
      compilerSummary, entries: debtEntries(diagnostics), inputHashes: before, loadedHashes: loaded }
  } finally {
    if (completed && !evidenceDirectory) fs.rmSync(work, { recursive: true, force: true })
    else console.log(`[engineering] raw cohort evidence retained: ${work}`)
  }
}

/**
 * @param {string[]} args */
export async function main(args) {
  if (args[0] === '--type-worker') {
    if (args.length !== 3) throw new Error('Invalid compiler worker arguments')
    const plan = /** @type {{root: string, roots: string[], options: import('typescript').CompilerOptions}} */ (json(args[1]))
    const result = compileRoots(plan.root, plan.roots, plan.options)
    writeNewJSON(args[2], result)
    return result.compilerExitCode
  }
  let capture, report
  let baselinePath = defaultBaseline
  for (let index = 0; index < args.length; index += 2) {
    const value = args[index + 1]
    if (!value) throw new Error('Expected an option value')
    if (args[index] === '--capture-baseline') capture = path.resolve(value)
    else if (args[index] === '--report') report = path.resolve(value)
    else if (args[index] === '--baseline') baselinePath = value
    else throw new Error(`Unknown engineering option: ${args[index]}`)
  }
  const root = process.cwd()
  const baselineFile = path.resolve(root, baselinePath)
  if (!capture && !fs.existsSync(baselineFile)) throw new Error(`No reviewed engineering baseline: ${baselineFile}. Capture once on the final integration tree; existing debt is not a clean type-check.`)
  if (capture && fs.existsSync(capture)) throw new Error('Capture never overwrites an existing baseline')
  if (report) fs.mkdirSync(path.dirname(report), { recursive: true })
  const actual = await collect(root, report ? `${report}.cohorts` : undefined)
  if (report) writeNewJSON(report, actual)
  if (capture) {
    writeNewJSON(capture, { schema: 'storyforge.engineering-debt-baseline.v1', pins: actual.pins, entries: actual.entries,
      interpretation: 'Existing diagnostics at this exact capture; not fixes or functional bug counts. Review before committing. New diagnostics and resolved debt require an explicit baseline diff.', scope: actual.scope })
    console.log(`[engineering] captured ${actual.entries.reduce((sum, entry) => sum + entry.count, 0)} existing diagnostics; capture is not clean type-check or acceptance`)
    return 0
  }
  const accepted = /** @type {Baseline} */ (json(baselineFile))
  if (accepted.schema !== 'storyforge.engineering-debt-baseline.v1' || !Array.isArray(accepted.entries)) throw new Error('Invalid reviewed engineering baseline')
  assertCompatiblePins(actual.pins, accepted.pins)
  const compared = compareDebt(actual.entries, accepted.entries)
  console.log(JSON.stringify({ check: 'engineering-zero-new-debt', passed: compared.passed,
    existingDiagnostics: actual.entries.reduce((sum, entry) => sum + entry.count, 0), added: compared.added, resolved: compared.resolved }, null, 2))
  return compared.passed ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }).catch(error => { console.error(error); process.exitCode = 1 })
}
