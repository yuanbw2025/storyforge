import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('SFQA033 keeps traffic assets off protected main through real isolated Git controls', () => {
  expect(() => execFileSync(process.execPath, ['--test', '--test-concurrency=1',
    'scripts/quality/traffic-archive-workflow.test.mjs'], {
    encoding: 'utf8', timeout: 25_000,
  })).not.toThrow()
}, 30_000)
