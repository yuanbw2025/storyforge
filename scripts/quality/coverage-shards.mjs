import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVitest } from 'vitest/node'
// Vitest 4's native blob uses flatted and carries the graph for native V8 remapping.
import { parse as parseBlob } from 'flatted'

/** @typedef {{source: string, tree: string, root: string, node: string, vitest: string, provider: string, lock: string, config: string, package: string, run: string, attempt: string}} Identity */
/** @typedef {{version: 1, identity: Identity, coverage: unknown, testTimeout: number, files: {path: string, sha256: string}[], shards: {index: number, files: string[]}[]}} Plan */
/** @typedef {{version: 1, phase: 'collected-only', index: number, count: number, plan: string, identity: Identity, files: string[], hashes: Record<string, string>}} Receipt */
/** @typedef {{success: boolean, numTotalTests: number, numFailedTests: number, numFailedTestSuites: number, testResults: {name: string, status: string}[]}} TestReport */
/** @typedef {{version: string, files: {filepath: string}[], errors: unknown[], coverage: Record<string, {path: string, s: object, f: object, b: object, statementMap: object, fnMap: object, branchMap: object}>}} Blob */

const self = fileURLToPath(import.meta.url)
const executable = fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url))
const artifactFiles = ['blob.json', 'test-results.json', 'coverage-summary.json']
/** @param {string|Buffer} value */
export const sha256 = value => createHash('sha256').update(value).digest('hex')
/** @param {unknown} value */
const encode = value => JSON.stringify(value)
/** @param {string} file */
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'))
/** @param {string} file @param {unknown} value */
function writeNewJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, encode(value) + '\n', { flag: 'wx' })
}
/** @param {unknown} actual @param {unknown} expected @param {string} message */
function equal(actual, expected, message) {
  if (encode(actual) !== encode(expected)) throw new Error(message)
}
/** @param {string[]} actual @param {string[]} expected @param {string} label */
export function exactFiles(actual, expected, label) {
  if (new Set(actual).size !== actual.length) throw new Error(label + ': duplicate file')
  equal([...actual].sort(), [...expected].sort(), label + ': missing or unexpected files')
}
/** @param {string} root @param {string} file */
function relativeFile(root, file) {
  const relative = path.relative(root, file)
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes('..')) {
    throw new Error('Report path is outside its exact checkout: ' + file)
  }
  return relative.split(path.sep).join('/')
}
/** @param {string} root @param {string[]} args */
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
/** @param {string} root */
export function sourceIdentity(root) {
  if (git(root, ['status', '--porcelain', '--untracked-files=all'])) {
    throw new Error('Coverage requires an unchanged committed checkout')
  }
  const source = git(root, ['rev-parse', 'HEAD'])
  if (process.env.GITHUB_SHA && source !== process.env.GITHUB_SHA) throw new Error('Checkout differs from GITHUB_SHA')
  const version = (/** @type {string} */ name) => readJSON(path.join(path.dirname(executable), '..', name, 'package.json')).version
  const vitest = version('vitest')
  const provider = version('@vitest/coverage-v8')
  const locked = readJSON(path.join(root, 'package-lock.json')).packages
  if (vitest !== provider || vitest !== locked['node_modules/vitest']?.version
    || provider !== locked['node_modules/@vitest/coverage-v8']?.version) {
    throw new Error('Vitest/coverage provider must match each other and the exact lock')
  }
  return {
    source, tree: git(root, ['rev-parse', 'HEAD^{tree}']), root,
    node: process.version, vitest, provider,
    lock: sha256(fs.readFileSync(path.join(root, 'package-lock.json'))),
    config: sha256(fs.readFileSync(path.join(root, 'vitest.config.ts'))),
    package: sha256(fs.readFileSync(path.join(root, 'package.json'))),
    run: process.env.GITHUB_RUN_ID ?? 'local',
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? 'local',
  }
}

/** Discover without collecting/executing tests, using the installed Vitest's own sequencer.
 * @param {string} root @param {number} count @returns {Promise<Plan>} */
export async function createPlan(root, count) {
  if (!Number.isInteger(count) || count < 2 || count > 4) throw new Error('Expected 2 to 4 shards')
  const identity = sourceIdentity(root)
  const ctx = await createVitest('test', {
    root, config: path.join(root, 'vitest.config.ts'), watch: false,
  })
  try {
    const specs = await ctx.globTestSpecifications()
    const files = specs.map(spec => ({
      path: relativeFile(root, spec.moduleId),
      sha256: sha256(fs.readFileSync(spec.moduleId)),
    })).sort((a, b) => a.path.localeCompare(b.path))
    if (files.length < count) throw new Error('Every shard must contain tests')
    exactFiles(files.map(file => file.path), files.map(file => file.path), 'Manifest')
    if (ctx.config.coverage.provider !== 'v8' || !ctx.config.coverage.thresholds) {
      throw new Error('Expected the original v8 coverage threshold contract')
    }
    const sequencer = new ctx.config.sequence.sequencer(ctx)
    const shards = []
    for (let index = 1; index <= count; index++) {
      ctx.config.shard = { index, count }
      /** @type {typeof specs} */
      const selected = await sequencer.shard(specs)
      shards.push({ index, files: selected.map(spec => relativeFile(root, spec.moduleId)).sort() })
    }
    exactFiles(shards.flatMap(shard => shard.files), files.map(file => file.path), 'Native partitions')
    equal(sourceIdentity(root), identity, 'Source changed during discovery')
    return { version: 1, identity, coverage: ctx.config.coverage,
      testTimeout: ctx.config.testTimeout, files, shards }
  } finally { await ctx.close() }
}

/** @param {Plan} plan @param {string} root */
export async function verifyPlan(plan, root) {
  if (plan.version !== 1 || !Array.isArray(plan.shards)) throw new Error('Invalid coverage plan')
  equal(await createPlan(root, plan.shards.length), plan, 'Coverage plan/source/config/version drift')
}

/** @param {string} source @returns {Blob} */
export function decodeBlob(source) {
  const value = parseBlob(source)
  if (!Array.isArray(value) || value.length !== 6) throw new Error('Invalid native Vitest 4 blob')
  const [version, files, errors, coverage, executionTime, environmentModules] = value
  if (typeof executionTime !== 'number' || !Number.isFinite(executionTime) || executionTime < 0
    || !environmentModules || typeof environmentModules !== 'object' || Array.isArray(environmentModules)
    || Object.keys(environmentModules).length === 0
    || Object.values(environmentModules).some(project => !project || typeof project !== 'object'
      || !Array.isArray(project.external) || !project.environments || typeof project.environments !== 'object'
      || Array.isArray(project.environments))) {
    throw new Error('Missing native Vitest 4 module graph or execution time')
  }
  if (typeof version !== 'string' || !Array.isArray(files) || !Array.isArray(errors)
    || !coverage || typeof coverage !== 'object' || Object.keys(coverage).length === 0) {
    throw new Error('Missing complete test results or real coverage maps')
  }
  return { version, files, errors, coverage }
}

/** Validate both independent native reports; summaries are never merged.
 * @param {Plan} plan @param {number} index @param {string} blobSource @param {TestReport} report */
export function validateCollected(plan, index, blobSource, report) {
  const shard = plan.shards.find(candidate => candidate.index === index)
  if (!shard) throw new Error('Unknown shard index')
  const blob = decodeBlob(blobSource)
  if (blob.version !== plan.identity.vitest || blob.errors.length !== 0) throw new Error('Blob version or unhandled errors')
  if (report.success !== true || !(report.numTotalTests > 0)
    || report.numFailedTests !== 0 || report.numFailedTestSuites !== 0
    || !Array.isArray(report.testResults) || report.testResults.some(file => file.status !== 'passed')) {
    throw new Error('The completed test report does not establish successful collection')
  }
  const relative = (/** @type {string} */ file) => relativeFile(plan.identity.root, file)
  exactFiles(blob.files.map(file => relative(file.filepath)), shard.files, 'Blob shard ' + index)
  exactFiles(report.testResults.map(file => relative(file.name)), shard.files, 'JSON shard ' + index)
  for (const [file, data] of Object.entries(blob.coverage)) {
    relative(file)
    if (data.path !== file || !data.s || !data.f || !data.b || !data.statementMap || !data.fnMap || !data.branchMap) {
      throw new Error('Expected real Istanbul file coverage, not a summary')
    }
  }
  return shard.files
}

/** @param {Plan} plan @param {Receipt[]} receipts */
export function verifyReceipts(plan, receipts) {
  if (receipts.length !== plan.shards.length) throw new Error('Missing or extra shard receipts')
  const seen = new Set()
  for (const receipt of receipts) {
    if (receipt.version !== 1 || receipt.phase !== 'collected-only'
      || receipt.count !== plan.shards.length || receipt.plan !== sha256(encode(plan))) {
      throw new Error('Receipt is not from this complete collection plan')
    }
    equal(receipt.identity, plan.identity, 'Shard source/lock/config/version/root/run differs')
    const expected = plan.shards.find(shard => shard.index === receipt.index)
    if (!expected || seen.has(receipt.index)) throw new Error('Unknown or duplicate shard index')
    seen.add(receipt.index)
    exactFiles(receipt.files, expected.files, 'Receipt shard ' + receipt.index)
  }
  exactFiles(receipts.flatMap(receipt => receipt.files), plan.files.map(file => file.path), 'Complete manifest')
}

/** @param {string} root @param {string[]} args */
function runVitest(root, args) {
  const result = spawnSync(process.execPath, [executable, ...args], { cwd: root, env: process.env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Vitest failed or was interrupted (exit ' + result.status + ', signal ' + result.signal + ')')
}
/** @param {string} output */
function newOutput(output) {
  if (fs.existsSync(output)) throw new Error('Refusing existing artifact directory: ' + output)
  fs.mkdirSync(output, { recursive: true })
}

/** @param {string} root @param {string} privateDir */
export function writeCollectorConfig(root, privateDir) {
  const configFile = path.join(privateDir, 'collector.config.mjs')
  // A filesystem specifier is bundled by Vite, which injects file-scope
  // variables at the original TS file. A file: URL is externalized and lets
  // Node load the TS as native ESM, where the original __dirname is absent.
  fs.writeFileSync(configFile, 'import base from ' + JSON.stringify(path.join(root, 'vitest.config.ts')) + ';\n'
    + 'export default { ...base, test: { ...base.test, coverage: { ...base.test.coverage, thresholds: undefined } } };\n')
  return configFile
}

/** The derived config defers thresholds ONLY while producing a collection artifact.
 * The merge entry point below always loads the original config.
 * @param {string} root @param {string} shard @param {string} manifest @param {string} output */
export async function collectShard(root, shard, manifest, output) {
  const match = /^([1-4])\/([2-4])$/.exec(shard)
  if (!match) throw new Error('Invalid shard index/count')
  const index = Number(match[1]), count = Number(match[2])
  /** @type {Plan} */
  const plan = readJSON(manifest)
  await verifyPlan(plan, root)
  if (count !== plan.shards.length || index > count) throw new Error('Shard differs from manifest')
  newOutput(output)
  // OS-private reports remain outside Vitest's shared coverage cleanup tree.
  const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyforge-coverage-shard-'))
  const configFile = writeCollectorConfig(root, privateDir)
  runVitest(root, [
    'run', '--config=' + configFile, '--coverage', '--shard=' + shard,
    '--reporter=default', '--reporter=json', '--reporter=blob',
    '--outputFile.json=' + path.join(privateDir, 'test-results.json'),
    '--outputFile.blob=' + path.join(privateDir, 'blob.json'),
    '--pool=forks', '--isolate', '--maxWorkers=1',
    '--coverage.reporter=json-summary', '--coverage.reportsDirectory=' + path.join(privateDir, 'coverage'),
  ])
  equal(sourceIdentity(root), plan.identity, 'Source changed during shard execution')
  const sourceFiles = [path.join(privateDir, 'blob.json'), path.join(privateDir, 'test-results.json'),
    path.join(privateDir, 'coverage', 'coverage-summary.json')]
  const bytes = sourceFiles.map(file => fs.readFileSync(file))
  const files = validateCollected(plan, index, bytes[0].toString('utf8'), JSON.parse(bytes[1].toString('utf8')))
  const summary = JSON.parse(bytes[2].toString('utf8'))
  if (!summary.total) throw new Error('Coverage summary is incomplete')
  /** @type {Record<string, string>} */
  const hashes = {}
  artifactFiles.forEach((file, i) => {
    fs.writeFileSync(path.join(output, file), bytes[i], { flag: 'wx' })
    hashes[file] = sha256(bytes[i])
  })
  writeNewJSON(path.join(output, 'receipt.json'), {
    version: 1, phase: 'collected-only', index, count, plan: sha256(encode(plan)), identity: plan.identity, files, hashes,
  })
  console.info('[coverage] shard ' + shard + ' collected; global and directory thresholds NOT YET VERIFIED')
}

/**
 * The final provider summary must contain every explicitly included source.
 * A native percentage check alone can silently accept an empty threshold glob.
 * @param {Record<string, Record<string, {total: number}>>} summary
 * @param {string} root
 * @param {{include?: string[], thresholds?: Record<string, unknown>}} options
 */
export function assertExplicitCoverageScopes(summary, root, options) {
  if (!summary.total) throw new Error('Merged coverage summary is missing')
  const explicitFiles = (options.include ?? []).filter(pattern => !/[*?{}[\]]/.test(pattern))
  if (!explicitFiles.length) return

  const files = new Map(Object.entries(summary).filter(([file]) => file !== 'total')
    .map(([file, metrics]) => [relativeFile(root, file), metrics]))
  for (const file of explicitFiles) {
    if (!((files.get(file)?.statements?.total ?? 0) > 0)) throw new Error('Missing executable coverage: ' + file)
  }

  const assigned = new Set()
  for (const scope of Object.keys(options.thresholds ?? {}).filter(key => key.includes('/'))) {
    const required = explicitFiles.filter(file => path.posix.matchesGlob(file, scope))
    if (!required.length) continue
    for (const metric of ['lines', 'functions', 'statements', 'branches']) {
      const count = required.reduce((total, file) => total + (files.get(file)?.[metric]?.total ?? 0), 0)
      if (!(count > 0)) throw new Error('Empty ' + metric + ' coverage denominator: ' + scope)
    }
    required.forEach(file => assigned.add(file))
  }
  for (const file of explicitFiles) {
    if (!assigned.has(file)) throw new Error('Explicit coverage has no scope threshold: ' + file)
  }
}

/** @param {string} root @param {string} manifest @param {string} artifacts @param {string} output */
export async function mergeShards(root, manifest, artifacts, output) {
  /** @type {Plan} */
  const plan = readJSON(manifest)
  await verifyPlan(plan, root)
  const directories = fs.readdirSync(artifacts).sort()
  exactFiles(directories, plan.shards.map(shard => 'shard-' + shard.index), 'Artifact directories')
  /** @type {Receipt[]} */
  const receipts = directories.map(directory => readJSON(path.join(artifacts, directory, 'receipt.json')))
  verifyReceipts(plan, receipts)
  const privateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyforge-coverage-merge-'))
  const blobs = path.join(privateDir, 'blobs')
  fs.mkdirSync(blobs)
  directories.forEach((directory, i) => {
    const receipt = receipts[i]
    const source = path.join(artifacts, directory)
    exactFiles(fs.readdirSync(source), [...artifactFiles, 'receipt.json'], 'Shard artifact files')
    for (const file of artifactFiles) {
      if (sha256(fs.readFileSync(path.join(source, file))) !== receipt.hashes[file]) throw new Error('Corrupt shard artifact: ' + file)
    }
    const blob = fs.readFileSync(path.join(source, 'blob.json'), 'utf8')
    validateCollected(plan, receipt.index, blob, readJSON(path.join(source, 'test-results.json')))
    fs.writeFileSync(path.join(blobs, 'blob-' + receipt.index + '.json'), blob, { flag: 'wx' })
  })
  newOutput(output)
  const reports = path.join(privateDir, 'coverage')
  const results = path.join(privateDir, 'test-results.json')
  runVitest(root, [
    'run', '--config=' + path.join(root, 'vitest.config.ts'), '--coverage', '--merge-reports=' + blobs,
    '--reporter=default', '--reporter=json', '--outputFile.json=' + results,
    '--coverage.reportsDirectory=' + reports,
  ])
  equal(sourceIdentity(root), plan.identity, 'Source changed during coverage merge')
  /** @type {TestReport} */
  const report = readJSON(results)
  if (report.success !== true || !(report.numTotalTests > 0)
    || report.numFailedTests !== 0 || report.numFailedTestSuites !== 0) throw new Error('Merged tests did not pass')
  exactFiles(report.testResults.map(file => relativeFile(root, file.name)), plan.files.map(file => file.path), 'Merged test results')
  assertExplicitCoverageScopes(readJSON(path.join(reports, 'coverage-summary.json')), root,
    /** @type {{include?: string[], thresholds?: Record<string, unknown>}} */ (plan.coverage))
  fs.cpSync(reports, path.join(output, 'coverage'), { recursive: true, errorOnExist: true })
  fs.copyFileSync(results, path.join(output, 'test-results.json'), fs.constants.COPYFILE_EXCL)
  writeNewJSON(path.join(output, 'receipt.json'), {
    version: 1, phase: 'merged-thresholds-passed', identity: plan.identity, plan: sha256(encode(plan)),
    shards: receipts.map(receipt => receipt.index).sort(), files: plan.files.length, tests: report.numTotalTests,
  })
  console.info('[coverage] all ' + plan.files.length + ' files merged; original global and directory thresholds passed')
}

/** @param {string[]} args */
export async function main(args) {
  if (args[0] === 'plan' && args.length === 3) {
    writeNewJSON(path.resolve(args[2]), await createPlan(process.cwd(), Number(args[1])))
  } else if (args[0] === 'merge' && args.length === 4) {
    await mergeShards(process.cwd(), path.resolve(args[1]), path.resolve(args[2]), path.resolve(args[3]))
  } else {
    throw new Error('Usage: coverage-shards.mjs plan <count> <manifest> | merge <manifest> <shards-dir> <output>')
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  main(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1 })
}
