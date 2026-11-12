import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Vitest cleans <reportsDirectory> before a coverage run. A shared
// `coverage/.tmp` lets concurrent CI/tasks delete files that another run is
// still writing. A unique child under coverage/ is insufficient because an
// older or direct Vitest invocation can clean the whole coverage root. Keep
// each run in an OS-owned private directory outside that shared cleanup tree.
const reportsDirectory = mkdtempSync(path.join(os.tmpdir(), 'storyforge-coverage-'))
const resultsFile = path.join(reportsDirectory, 'test-results.json')
console.info(`[coverage] reports: ${reportsDirectory}`)
const executable = path.join(
  process.cwd(),
  'node_modules',
  'vitest',
  'vitest.mjs',
)
const workers = process.env.CI ? 1 : 2

const result = spawnSync(process.execPath, [
  executable,
  'run',
  '--coverage',
  '--reporter=default',
  '--reporter=json',
  `--outputFile=${resultsFile}`,
  // Fake IndexedDB and Dexie lifecycle tests need process isolation. Threads
  // can share enough runtime state to leave an open connection blocking the
  // next test until its timeout even though the same case takes <1s alone.
  '--pool=forks',
  // Instrumented production replays and the measured million-character gate
  // must not compete with another file on a shared CI runner. Each file still
  // gets a fresh child process: one worker is not the reused singleFork mode.
  '--poolOptions.forks.isolate=true',
  '--poolOptions.forks.singleFork=false',
  `--maxWorkers=${workers}`,
  `--minWorkers=${workers}`,
  `--coverage.reportsDirectory=${reportsDirectory}`,
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
})

if (result.error) {
  console.error(`[coverage] failed to start Vitest: ${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) process.exit(result.status ?? 1)
if (!existsSync(resultsFile) || !existsSync(path.join(reportsDirectory, 'coverage-summary.json'))) {
  console.error('[coverage] Vitest exited without completed test and coverage reports; the run is incomplete.')
  process.exit(1)
}
const report = JSON.parse(readFileSync(resultsFile, 'utf8'))
if (report.success !== true || report.numTotalTests < 1
  || report.numFailedTests !== 0 || report.numFailedTestSuites !== 0
  || !Array.isArray(report.testResults) || report.testResults.length === 0) {
  console.error('[coverage] The completed test report does not establish a successful test run.')
  process.exit(1)
}
// A native glob threshold can pass on an empty map. Every named risk entry
// must contribute executable statements, and each domain must have a real
// denominator for all four independently enforced Vitest metrics.
/** @type {Record<string, string[]>} */
const criticalScopes = JSON.parse(readFileSync(new URL('./quality/critical-coverage-scopes.json', import.meta.url), 'utf8'))
const summary = JSON.parse(readFileSync(path.join(reportsDirectory, 'coverage-summary.json'), 'utf8'))
if (!summary?.total) throw new Error('[coverage] Missing aggregate coverage summary')
for (const [domain, files] of Object.entries(criticalScopes)) {
  const entries = files.map(file => {
    const absolute = path.resolve(file)
    const row = summary[absolute] ?? summary[absolute.split(path.sep).join('/')]
    if (!(row?.statements?.total > 0)) throw new Error(`[coverage] Missing executable coverage in ${domain}: ${file}`)
    return row
  })
  for (const metric of ['lines', 'functions', 'statements', 'branches']) {
    if (!entries.some(row => row[metric]?.total > 0)) {
      throw new Error(`[coverage] Empty ${metric} denominator in ${domain}`)
    }
  }
}

console.info(`[coverage] completed: ${report.testResults.length} files, ${report.numTotalTests} tests`)
