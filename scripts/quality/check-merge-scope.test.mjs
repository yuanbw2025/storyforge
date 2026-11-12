import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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

test('the manual AVG media workflow owns its production harnesses; ordinary product unit tests stay scoped', () => {
  const list = 'scripts/quality/avg-media-harnesses.txt'
  const suites = readFileSync(list, 'utf8').trim().split(/\r?\n/)
  const visual = 'tests/regression/R-AVG-04A5-visual-planning-harness.test.ts'
  const unit = 'tests/regression/R-AVG-05A-production-assembly.test.ts'
  assert.ok(suites.includes(visual))
  assert.ok(suites.includes('tests/regression/R-AVG-05A-combined-media-stage.test.ts'))
  assert.ok(suites.includes('tests/regression/R-AVG-04A15-v5-current-assembly.test.ts'))
  assert.ok(suites.includes('tests/regression/R-AVG-04B-processed-sound-flow.test.ts'))
  assert.equal(suites.length, new Set(suites).size)
  assert.ok(suites.every(file => /^tests\/regression\/R-AVG-[a-zA-Z0-9-]+\.test\.ts$/.test(file) && existsSync(file)))
  assert.deepEqual(plan([...suites, unit], present).units, [unit])
  assert.deepEqual(directTests(['src/lib/product-production/plan.ts'], [...suites, unit],
    () => ['../../src/lib/product-production/plan']), [unit])
  assert.ok(plan([list], present).nodeTests.includes('scripts/quality/check-merge-scope.test.mjs'))
  assert.ok(readFileSync('.github/workflows/avg-media.yml', 'utf8').includes('vitest run < ' + list))
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
