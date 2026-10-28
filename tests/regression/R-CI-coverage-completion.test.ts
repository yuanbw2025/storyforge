import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const runner = path.resolve('scripts/run-isolated-coverage.mjs')
const ownedDirectories: string[] = []

afterEach(() => {
  for (const directory of ownedDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('isolated coverage completion receipts', () => {
  it.each(['missing-coverage', 'missing-tests', 'failed-report', 'complete', 'exit-seven'])(
    'preserves the real child outcome and rejects incomplete success: %s', mode => {
      const fixture = mkdtempSync(path.join(os.tmpdir(), 'storyforge-coverage-fixture-'))
      ownedDirectories.push(fixture)
      const moduleDirectory = path.join(fixture, 'node_modules', 'vitest')
      mkdirSync(moduleDirectory, { recursive: true })
      writeFileSync(path.join(moduleDirectory, 'vitest.mjs'), `
        import fs from 'node:fs'; import path from 'node:path';
        const mode = ${JSON.stringify(mode)};
        const args = process.argv.slice(2);
        if (!args.includes('--pool=forks') || !args.includes('--poolOptions.forks.singleFork=false')) process.exit(9);
        if (mode === 'exit-seven') process.exit(7);
        const reports = args.find(a => a.startsWith('--coverage.reportsDirectory=')).split('=').slice(1).join('=');
        const output = args.find(a => a.startsWith('--outputFile=')).split('=').slice(1).join('=');
        if (mode !== 'missing-coverage') fs.writeFileSync(path.join(reports, 'coverage-summary.json'), '{}');
        if (mode !== 'missing-tests') fs.writeFileSync(output, JSON.stringify({
          success: mode !== 'failed-report', numTotalTests: 1, numFailedTests: 0,
          numFailedTestSuites: 0, testResults: [{ status: 'passed' }]
        }));
      `)
      const result = spawnSync(process.execPath, [runner], {
        cwd: fixture, env: { ...process.env, CI: '1' }, encoding: 'utf8',
      })
      const reports = result.stdout.match(/^\[coverage\] reports: (.+)$/m)?.[1]
      expect(reports).toBeDefined()
      if (reports && path.dirname(reports) === os.tmpdir()
        && path.basename(reports).startsWith('storyforge-coverage-')) ownedDirectories.push(reports)
      expect(result.status).toBe(mode === 'complete' ? 0 : mode === 'exit-seven' ? 7 : 1)
      if (mode.startsWith('missing-')) expect(result.stderr).toContain('the run is incomplete')
      if (mode === 'failed-report') expect(result.stderr).toContain('does not establish a successful test run')
      if (mode === 'complete') expect(result.stdout).toContain('completed: 1 files, 1 tests')
    },
  )
})
