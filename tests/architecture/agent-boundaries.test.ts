import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('Agent architecture boundaries', () => {
  it('does not import Zustand stores or the Dexie schema', () => {
    const result = spawnSync(process.execPath, ['scripts/check-architecture.mjs'], {
      cwd: root,
      encoding: 'utf8',
    })
    const output = `${result.stdout}\n${result.stderr}`

    expect(output).not.toContain('[⑧Agent越层]')
    expect(result.status).toBe(0)
  })
})
