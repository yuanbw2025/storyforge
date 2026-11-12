import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const runNode = promisify(execFile)

describe('NW-2E independent model judge boundary (no live calls)', () => {
  it('keeps blinding, exact source-bound evidence, abstention denominators and permits one continuation for each parent', async () => {
    const { stdout } = await runNode(process.execPath, ['--test', '--test-reporter=tap',
      'scripts/narrative-reader-judge-contract.test.mjs', 'scripts/narrative-reader-judge-content.test.mjs',
      'scripts/narrative-reader-judge-coverage.test.mjs', 'scripts/narrative-reader-judge-continuation.test.mjs'],
    { encoding: 'utf8', timeout: 120_000 })
    expect(stdout).toMatch(/# fail 0/)
  }, 125_000)
})
