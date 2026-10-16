import path from 'node:path'
import { withTestDirectory } from './test-temp-directory.mjs'

// Vitest may delete its reportsDirectory. Keep the ownership record in a
// separate parent, and never share coverage output with another test run.
const executable = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')

try {
  process.exitCode = await withTestDirectory('coverage', async temporary => {
    return temporary.run(process.execPath, [
      executable,
      'run',
      '--coverage',
      // Fork isolation prevents timed-out fake IndexedDB suites from blocking
      // later files. Keep the existing bounded two-worker coverage policy.
      '--pool=forks',
      '--maxWorkers=2',
      '--minWorkers=2',
      `--coverage.reportsDirectory=${temporary.path}`,
    ], {
      cwd: process.cwd(),
      env: process.env,
    })
  })
} catch (error) {
  console.error('[coverage] ' + error.message)
  process.exitCode = error.exitCode ?? 1
}
