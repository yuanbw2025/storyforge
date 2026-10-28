import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile), owned: string[] = []
afterEach(async () => { for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true }) })
// Report/backup structures below are invented CI metadata. They never become
// product imports, real producer/author receipts or actual pixel evidence.
const sourceTitle = 'V5 native family images preserve policy2, local derivatives and five consumers through Source5/6 Preview and portable restore'
const closedTitle = 'original V5 published images and local derivative restore and play with both visual factories closed and no new provider/quality authority'
const foregroundCases = [
  { file: 'avg-foreground-processing.spec.ts', title: 'native foreground Worker clears declared original pixels before fitting and preserves exact PNG lineage' },
  { file: 'avg-foreground-processing.spec.ts', title: 'native boundary unmix2 uses exact recomputation, cleans an encoded PNG edge and terminates cancellation during verification' },
  { file: 'avg-character-family.spec.ts', title: 'native ordinary family freezes both foreground requests and retains exact processed PNGs offline without regenerating the previous background' },
  { file: 'avg-visual-planning-workbench.spec.ts', title: 'V5 native declared foreground family removes both opaque backdrops through actual producer, Preview, reference provenance and portable restore' },
  { file: 'avg-visual-planning-workbench.spec.ts', title: 'V5 native boundary-unmix2 family preserves originals and clean edges through producer, Stage, Release, reference and portable restore' },
]
const report = (file: string, title: string) => ({ errors: [], suites: [{ specs: [{ file, title, tests: [{ projectName: 'chromium', expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed' }] }] }] }] })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'storyforge-v5-release-reports-')); owned.push(root)
  await mkdir(join(root, 'all')); await mkdir(join(root, 'visual-frozen'))
  const source = report('avg-visual-planning-workbench.spec.ts', sourceTitle), closed = report('avg-visual-prototype-read.spec.ts', closedTitle)
  for (const entry of foregroundCases) source.suites[0].specs.push(report(entry.file, entry.title).suites[0].specs[0])
  await writeFile(join(root, 'all/report.json'), JSON.stringify(source)); await writeFile(join(root, 'visual-frozen/report.json'), JSON.stringify(closed))
  const backup = { engineeringReportOnly: true }, exported = { schema: 'storyforge.avg.visual-release-native-test-export', version: 1, backup,
    backupSHA256: createHash('sha256').update(JSON.stringify(backup)).digest('hex'), expected: { releaseUid: 'report-only', manifestJson: '{}', assets: Array.from({ length: 5 }, () => ({})) } }
  await writeFile(join(root, 'visual-release.json'), JSON.stringify(exported))
  return { root, source, closed, exported, run: () => execute(process.execPath, [resolve('scripts/check-avg-visual-release-ci-reports.mjs'), root]) }
}
describe('V5 actual CI source-to-closed-release report dependency', () => {
  it('requires both exact native cases and unchanged complete export, without granting product authority', async () => {
    const s = await fixture(), before = await readFile(join(s.root, 'visual-release.json'))
    expect(JSON.parse((await s.run()).stdout).modes).toEqual([
      { directory: 'all', expected: 1, flaky: 0 }, { directory: 'visual-frozen', expected: 1, flaky: 0 },
      ...foregroundCases.map(() => ({ directory: 'all', expected: 1, flaky: 0 })),
    ])
    expect(await readFile(join(s.root, 'visual-release.json'))).toEqual(before)
  })
  it.each(['missing-source', 'v4-title', 'skipped-closed', 'wrong-browser', 'duplicate-source', 'changed-export', 'missing-export'] as const)('refuses %s', async mode => {
    const s = await fixture()
    if (mode === 'missing-source') s.source.suites = []
    if (mode === 'v4-title') s.source.suites[0].specs[0].title = 'old V4 pixels passed'
    if (mode === 'skipped-closed') Object.assign(s.closed.suites[0].specs[0].tests[0], { status: 'skipped', results: [{ status: 'skipped' }] })
    if (mode === 'wrong-browser') s.closed.suites[0].specs[0].tests[0].projectName = 'firefox'
    if (mode === 'duplicate-source') s.source.suites[0].specs.push(structuredClone(s.source.suites[0].specs[0]))
    if (mode === 'changed-export') s.exported.backup.engineeringReportOnly = false
    await writeFile(join(s.root, 'all/report.json'), JSON.stringify(s.source)); await writeFile(join(s.root, 'visual-frozen/report.json'), JSON.stringify(s.closed))
    await writeFile(join(s.root, 'visual-release.json'), JSON.stringify(s.exported))
    if (mode === 'missing-export') await rm(join(s.root, 'visual-release.json'))
    await expect(s.run()).rejects.toThrow()
  })
  it('retains flaky classification without claiming a first-pass success', async () => {
    const s = await fixture(), test = s.closed.suites[0].specs[0].tests[0]
    test.status = 'flaky'; test.results.unshift({ status: 'failed' })
    await writeFile(join(s.root, 'visual-frozen/report.json'), JSON.stringify(s.closed))
    expect(JSON.parse((await s.run()).stdout).modes[1]).toEqual({ directory: 'visual-frozen', expected: 0, flaky: 1 })
  })
  it.each(foregroundCases)('refuses an omitted foreground path: $title', async entry => {
    const s = await fixture()
    s.source.suites[0].specs = s.source.suites[0].specs.filter(spec => spec.title !== entry.title)
    await writeFile(join(s.root, 'all/report.json'), JSON.stringify(s.source))
    await expect(s.run()).rejects.toThrow()
  })
  it.each(foregroundCases)('refuses a foreground path skipped by a feature flag: $title', async entry => {
    const s = await fixture(), spec = s.source.suites[0].specs.find(value => value.title === entry.title)!
    Object.assign(spec.tests[0], { status: 'skipped', results: [{ status: 'skipped' }] })
    await writeFile(join(s.root, 'all/report.json'), JSON.stringify(s.source))
    await expect(s.run()).rejects.toThrow()
  })
})
