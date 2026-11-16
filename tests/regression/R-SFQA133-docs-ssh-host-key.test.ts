import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('SFQA133 verifies the docs deployment host pin with isolated OpenSSH keys', () => {
  expect(() => execFileSync(process.execPath, ['--test', '--test-concurrency=1',
    'scripts/deploy/verify-docs-ssh-host-key.test.mjs'], {
    encoding: 'utf8', timeout: 25_000,
  })).not.toThrow()
}, 30_000)
