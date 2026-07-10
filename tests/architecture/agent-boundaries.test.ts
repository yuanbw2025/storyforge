import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function runAgentImportProbe(source: string) {
  return spawnSync(process.execPath, ['scripts/check-architecture.mjs', '--agent-import-probe'], {
    cwd: root,
    encoding: 'utf8',
    input: source,
  })
}

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

  it.each([
    ["static store import", "import { useProjectStore } from '../../stores/project-store'"],
    ['side-effect schema import', "import '../../db/schema'"],
    ['re-exported schema import', "export { db } from '../../db/schema'"],
    ['literal dynamic store import', "const store = import('../../stores/project-store')"],
    ['literal schema require', "const schema = require('../../db/schema')"],
    ['template interpolation dynamic schema import', "const template = `${import('../../db/schema')}`"],
    ['template interpolation store require', "const template = `${require('../../stores/project-store')}`"],
    ['no-substitution template literal dynamic store import', 'const store = import(`../../stores/project-store`)'],
  ])('rejects %s', (_name, source) => {
    const result = runAgentImportProbe(source)
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.status).toBe(1)
    expect(output).toContain('[⑧Agent越层]')
  })

  it('ignores comments, ordinary strings, and permitted modules', () => {
    const result = runAgentImportProbe(`
      // import { useProjectStore } from '../../stores/project-store'
      /* require('../../db/schema') */
      const documentation = "export { db } from '../../db/schema'"
      const dynamicSpecifier = '../../stores/project-store'
      import { createToolDefinition } from './tool-types'
      import { create } from 'zustand'
      import(dynamicSpecifier)
    `)
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.status).toBe(0)
    expect(output).not.toContain('[⑧Agent越层]')
  })
})
