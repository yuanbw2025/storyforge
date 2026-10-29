import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { withTestDirectory } from './test-temp-directory.mjs'

const executable = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')
const workers = process.env.CI ? 1 : 2

try {
  process.exitCode = await withTestDirectory('coverage', async temporary => {
    const reportsDirectory = temporary.path
    const resultsFile = path.join(reportsDirectory, 'test-results.json')
    console.info(`[coverage] reports: ${reportsDirectory}`)
    const status = await temporary.run(process.execPath, [
      executable,
      'run',
      '--coverage',
      '--reporter=default',
      '--reporter=json',
      `--outputFile=${resultsFile}`,
      // Fresh fork per file; measured replays run alone on CI runners.
      '--pool=forks',
      '--poolOptions.forks.isolate=true',
      '--poolOptions.forks.singleFork=false',
      `--maxWorkers=${workers}`,
      `--minWorkers=${workers}`,
      `--coverage.reportsDirectory=${reportsDirectory}`,
    ], { cwd: process.cwd(), env: process.env })
    if (status !== 0) return status
    if (!existsSync(resultsFile) || !existsSync(path.join(reportsDirectory, 'coverage-summary.json'))) {
      console.error('[coverage] Vitest exited without completed test and coverage reports; the run is incomplete.')
      return 1
    }
    const report = JSON.parse(readFileSync(resultsFile, 'utf8'))
    if (report.success !== true || report.numTotalTests < 1
      || report.numFailedTests !== 0 || report.numFailedTestSuites !== 0
      || !Array.isArray(report.testResults) || report.testResults.length === 0) {
      console.error('[coverage] The completed test report does not establish a successful test run.')
      return 1
    }
    console.info(`[coverage] completed: ${report.testResults.length} files, ${report.numTotalTests} tests`)
    return 0
  })
} catch (error) {
  console.error('[coverage] ' + error.message)
  process.exitCode = error.exitCode ?? 1
}
