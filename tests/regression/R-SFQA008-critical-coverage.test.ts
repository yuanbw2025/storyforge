import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { stripVTControlCharacters } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import scopes from '../../scripts/quality/critical-coverage-scopes.json'

// Use the installed runner and the real project thresholds. Only the fixture's
// tiny input modules and test are synthetic.
const project = process.cwd()
const domainFiles = Object.values(scopes)
const logic = `export function sample(n: number) {
  if (n === 0) return 0
  if (n === 1) return 1
  if (n === 2) return 2
  return 3
}
export function left() {
  return 1
}
export function right() {
  return 3
}
`

it.each(['critical domains', 'original coverage scope'] as const)(
  'rejects weak %s even when the expanded global aggregate passes', scenario => {
    const fixture = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'sfqa008-coverage-')))
    try {
      symlinkSync(path.join(project, 'node_modules'), path.join(fixture, 'node_modules'), 'junction')
      writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}')
      writeFileSync(path.join(fixture, 'vitest.config.mjs'), `import base from ${JSON.stringify(path.join(project, 'vitest.config.ts'))};
        export default {...base, root: ${JSON.stringify(fixture)}, test: {...base.test,
          setupFiles: [], environment: 'node', include: ['sample.test.ts'],
          coverage: {...base.test.coverage, reporter: ['json-summary']} } };`)
      const weakDomains = scenario === 'critical domains'
      const cases = [
        ...domainFiles.map(group => ({ file: group[0], cover: !weakDomains })),
        ...Array.from({ length: weakDomains ? 9 : 1 }, (_, i) => ({
          file: 'src/lib/db/sample' + i + '.ts', cover: weakDomains,
        })),
      ]
      const imports = [], calls = []
      for (const [i, { file, cover }] of cases.entries()) {
        const target = path.join(fixture, file)
        mkdirSync(path.dirname(target), { recursive: true })
        writeFileSync(target, logic)
        imports.push(`import * as f${i} from ${JSON.stringify('./' + file)}`)
        calls.push(`expect(f${i}.sample(0)).toBe(0)`)
        if (cover) calls.push(`expect([1,2,3].map(f${i}.sample)).toEqual([1,2,3]); expect(f${i}.left()+f${i}.right()).toBe(4)`)
      }
      writeFileSync(path.join(fixture, 'sample.test.ts'), [
        'import {it,expect} from "vitest"', ...imports, 'it("runs samples",()=>{', ...calls, '})',
      ].join('\n'))
      const reports = path.join(fixture, 'reports')
      const run = spawnSync(process.execPath, [path.join(project, 'node_modules/vitest/vitest.mjs'), 'run',
        '--coverage', '--coverage.reportsDirectory=' + reports, '--maxWorkers=1'],
      { cwd: fixture, encoding: 'utf8', timeout: 30_000 })
      expect(run.error).toBeUndefined()
      const output = stripVTControlCharacters(run.stdout + run.stderr)
      expect(run.status, output).toBe(1)
      expect(output).toMatch(/Test Files\s+1 passed/)
      expect(output).not.toContain('does not meet global threshold')
      const result = JSON.parse(readFileSync(path.join(reports, 'coverage-summary.json'), 'utf8')).total
      for (const [metric, floor] of Object.entries({ lines: 58, functions: 50, statements: 58, branches: 60 })) {
        expect(result[metric].pct).toBeGreaterThanOrEqual(floor)
      }
      if (weakDomains) {
        for (const group of domainFiles) expect(output).toContain('{' + group.join(',') + '}')
      } else {
        expect(output).toContain('{src/lib/registry/**/*.ts,src/lib/db/**/*.ts,')
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  }, 40_000,
)
