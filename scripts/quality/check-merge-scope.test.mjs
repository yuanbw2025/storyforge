import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { directTests, plan } from './check-merge-scope.mjs'

const present = () => true

test('documentation and workflow-only changes avoid dependency installation', () => {
  assert.equal(plan(['README.md'], present).npm, false)
  const workflow = plan(['.github/workflows/ci.yml'], present)
  assert.equal(workflow.npm, false)
  assert.deepEqual(workflow.nodeTests, ['scripts/quality/check-merge-scope.test.mjs'])
  assert.equal(plan(['website-docs/en/index.md'], present).docs, true)
})

test('changed tests, deleted modules and schema changes have scoped checks', () => {
  const deleted = 'src/lib/old.ts'
  const checks = plan([deleted, 'src/lib/db/schema.ts', 'tests/db/schema.test.ts'], path => path !== deleted)
  assert.deepEqual(checks.units, ['tests/db/schema.test.ts'])
  assert.ok(checks.typeConfigs.includes('tsconfig.json'))
  assert.deepEqual(checks.scripts, ['check:required-tables'])
  assert.equal(checks.npm, true)
})

test('direct consumers use the module path, including aliases and directories', () => {
  const files = ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts']
  const imports = [['@/lib/project'], ['../src/lib/project/index.js'], ['@/other/project']]
  assert.deepEqual(directTests(['src/lib/project/index.ts'], files, file => imports[files.indexOf(file)]), files.slice(0, 2))
})

test('ordinary PRs only trigger the scoped check and releases retain their tagged entry', () => {
  // Ruby may decode the Actions key "on" as the YAML 1.1 boolean true.
  const data = JSON.parse(execFileSync('ruby', ['-ryaml', '-rjson', '-e', `
    workflows = Dir['.github/workflows/*.yml'].to_h { |file|
      doc = YAML.load_file(file)
      events = doc.fetch('on') { doc.fetch(true) }
      [File.basename(file), events]
    }
    puts JSON.generate(workflows)
  `], { encoding: 'utf8' }))
  /** @param {string | object} value */
  const events = value => typeof value === 'string' ? [value] : Object.keys(value)
  assert.deepEqual(Object.keys(data).filter(file => events(data[file]).some(e => e === 'pull_request' || e === 'pull_request_target')), ['ci.yml'])
  assert.deepEqual(events(data['ci.yml']), ['pull_request'])
  assert.deepEqual(events(data['ttrpg-open-preview.yml']), ['workflow_dispatch'])
  assert.deepEqual(events(data['avg-media.yml']), ['workflow_dispatch'])
  assert.deepEqual(data['release.yml'].push.tags, ['v*'])
  for (const file of ['clients.yml', 'client-release-upgrade.yml']) assert.ok(events(data[file]).includes('workflow_call'))
})
