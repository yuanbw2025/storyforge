import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

/** @typedef {'none' | 'read' | 'write'} PermissionLevel */
/** @typedef {Record<string, PermissionLevel>} PermissionMap */
/** @typedef {PermissionMap | 'read-all' | 'write-all'} Permissions */
/** @typedef {{ permissions?: Permissions, jobs?: Record<string, { permissions?: Permissions, uses?: string }> }} Workflow */

const ranks = { none: 0, read: 1, write: 2 }
/** @param {Permissions | undefined} value @param {PermissionMap} inherited @returns {PermissionMap} */
const normalize = (value, inherited) => value == null ? inherited
  : typeof value === 'string' ? { '*': value === 'read-all' ? 'read' : 'write' }
    : { '*': 'none', ...value }
/** @param {PermissionMap | null} map @param {string} scope @returns {PermissionLevel} */
const access = (map, scope) => map?.[scope] ?? map?.['*'] ?? 'none'

// Workflow permissions are defaults, while a reusable caller's actual grant is
// the ceiling. Validate every declared branch, including jobs with false `if`.
/** @param {string} entry @param {(file: string) => string} [read] */
function permissionErrors(entry, read = file => readFileSync(resolve(file), 'utf8')) {
  /** @type {string[]} */
  const errors = []
  /** @param {string} file @param {PermissionMap | null} ceiling @param {PermissionMap} inherited @param {string[]} chain */
  function visit(file, ceiling, inherited, chain) {
    assert(!chain.includes(file), 'reusable workflow cycle')
    const flow = /** @type {Workflow} */ (parse(read(file)))
    const defaults = normalize(flow.permissions, inherited)
    /** @param {PermissionMap} requested @param {string} label */
    const check = (requested, label) => {
      if (!ceiling) return
      for (const scope of new Set(['actions', 'contents', ...Object.keys(requested ?? {}), ...Object.keys(ceiling)])) {
        if (ranks[access(requested, scope)] > ranks[access(ceiling, scope)]) errors.push(`${label}: ${scope}`)
      }
    }
    check(defaults, file)
    for (const [name, job] of Object.entries(flow.jobs ?? {})) {
      const grant = normalize(job.permissions, defaults)
      check(grant, `${file} / ${name}`)
      if (job.uses?.startsWith('./.github/workflows/')) visit(job.uses.slice(2), grant, grant, [...chain, file])
    }
  }
  visit(entry, null, { '*': 'none' }, [])
  return errors
}

test('the actual formal release reusable chain never requests permissions above a caller grant', () => {
  assert.deepEqual(permissionErrors('.github/workflows/release.yml'), [])
})

test('the independent immutable Arch artifact diagnostic remains a valid manual root', () => {
  const entry = '.github/workflows/arch-upgrade-candidate.yml'
  const diagnostic = /** @type {{ on: { workflow_dispatch: { inputs: Record<string, { required: boolean }> } } }} */ (parse(readFileSync(entry, 'utf8')))
  assert.equal(diagnostic.on.workflow_dispatch.inputs.candidate_run.required, true)
  assert.equal(diagnostic.on.workflow_dispatch.inputs.candidate_source.required, true)
  assert.deepEqual(permissionErrors(entry), [])
})

test('a conditional nested job cannot raise permissions; a root job may override its workflow default', () => {
  /** @type {Record<string, string>} */
  const files = {
    '.github/workflows/root.yml': `permissions: {contents: read}
jobs:
  publish:
    permissions: {contents: write}
    runs-on: ubuntu-latest
    steps: []
  client:
    uses: ./.github/workflows/child.yml
`,
    '.github/workflows/child.yml': `permissions: {contents: read}
jobs:
  diagnostic:
    if: false
    permissions: {contents: read, actions: read}
    runs-on: ubuntu-latest
    steps: []
`,
  }
  assert.deepEqual(permissionErrors('.github/workflows/root.yml', file => files[file]), ['.github/workflows/child.yml / diagnostic: actions'])
  files['.github/workflows/child.yml'] = files['.github/workflows/child.yml'].replace('actions: read', 'actions: none')
  assert.deepEqual(permissionErrors('.github/workflows/root.yml', file => files[file]), [])
})
