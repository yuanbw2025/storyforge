import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile), owned: string[] = []
const checker = resolve('scripts/check-avg-sound-ci-reports.mjs')
afterEach(async () => { for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true }) })

// Fabricated Playwright structures exercise only CI reporting, never product
// Runs, author adoption, actual native playback or real listening evidence.
function report(file: string, expected: number, skipped: number, flaky = 0, unexpected = 0, publisher = true, publisherRelease = true) {
  const test = (status: string, results: string[]) => ({ projectName: 'chromium', expectedStatus: 'passed', status, results: results.map(status => ({ status })) })
  const tests = [
    ...Array.from({ length: expected }, () => test('expected', ['passed'])),
    ...Array.from({ length: skipped }, () => test('skipped', ['skipped'])),
    ...Array.from({ length: flaky }, () => test('flaky', ['failed', 'passed'])),
    ...Array.from({ length: unexpected }, () => test('unexpected', ['failed'])),
  ]
  const titles = file === 'avg-sound-production.spec.ts' ? ["native publisher-page V2 original audio keeps unknown hearing through actual decoding, playback and portable raw recovery without a Key or music request", "native publisher-page V2 engineering choice independently configures ambience Stage and original Release for exact closed-factory export without generating music", "native original sound plan, actual continuous audition, independent author choices and original Preview remain usable without a text Key", "native explicit sound inheritance creates a separately adopted revision and release with original audio and no generation requests", "native loop boundary failure survives interruption and refresh as blocking evidence, with no selection or duplicate dispatch", "native mute/unmute cannot turn a partial generation into a passing observation and page switching stops its source"] : file === 'avg-sound-prototype-read.spec.ts' ? ["original published Sound backup remains natively playable with both factory switches closed, without credentials or new producer/quality writes", "published publisher-page V2 original ambience restores exact grant and Release bytes with both sound factories closed and no producer or quality writes"] : []
  const named = titles.flatMap((title,index) => {
    const selected = tests.splice(0,1)
    return selected.length ? [{ file, title: (index===0 ? publisher : index===1 ? publisherRelease : true) ? title : 'unrelated passing case', tests:selected }] : []
  })
  return { errors: [], stats: { expected, skipped, flaky, unexpected }, suites: [{ specs: [
    ...named, { file, title: 'controlled report fixture remaining cases', tests },
  ] }] }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'storyforge-avg-sound-ci-reports-')); owned.push(root)
  for (const [mode, file, expected, skipped] of [
    ['sound-closed', 'avg-sound-requirements.spec.ts', 1, 3],
    ['sound-preparation', 'avg-sound-requirements.spec.ts', 3, 1],
    ['sound-production', 'avg-sound-production.spec.ts', 6, 0],
    ['sound-frozen', 'avg-sound-prototype-read.spec.ts', 2, 0],
  ] as const) {
    await mkdir(join(root, mode)); await writeFile(join(root, mode, 'report.json'), JSON.stringify(report(file, expected, skipped)))
  }
  const path = join(root, 'sound-production', 'report.json')
  return { root, path, run: () => execute(process.execPath, [checker, root]) }
}

describe('AVG Sound CI execution and retained reports', () => {
  it('requires all declared modes including the closed-factory immutable read without granting any media acceptance', async () => {
    const s = await fixture(), before = await readFile(s.path)
    expect(JSON.parse((await s.run()).stdout).modes).toEqual([
      { mode: 'sound-closed', expected: 1, flaky: 0, unexpected: 0, skipped: 3 },
      { mode: 'sound-preparation', expected: 3, flaky: 0, unexpected: 0, skipped: 1 },
      { mode: 'sound-production', expected: 6, flaky: 0, unexpected: 0, skipped: 0 },
      { mode: 'sound-frozen', expected: 2, flaky: 0, unexpected: 0, skipped: 0 },
    ])
    expect(await readFile(s.path)).toEqual(before)
  })
  it.each([
    ['the old production suite missing retained-sound revision', report('avg-sound-production.spec.ts', 3, 0)],
    ['the old four cases without publisher source coverage', report('avg-sound-production.spec.ts', 4, 0)],
    ['the old five cases without publisher Stage and Release', report('avg-sound-production.spec.ts', 5, 0)],
    ['enough passing cases but no exact publisher source test', report('avg-sound-production.spec.ts', 6, 0, 0, 0, false)],
    ['enough passing cases but no exact publisher Stage/Release test', report('avg-sound-production.spec.ts', 6, 0, 0, 0, true, false)],
    ['an entirely skipped production suite', report('avg-sound-production.spec.ts', 0, 3)],
    ['a different spec with passing counts', report('unrelated.spec.ts', 3, 0)],
    ['a failed case', report('avg-sound-production.spec.ts', 2, 0, 0, 1)],
    ['a summary not backed by executed cases', { ...report('avg-sound-production.spec.ts', 0, 3), stats: { expected: 3, flaky: 0, unexpected: 0, skipped: 0 } }],
  ])('rejects %s', async (_label, invalid) => {
    const s = await fixture(); await writeFile(s.path, JSON.stringify(invalid))
    await expect(s.run()).rejects.toThrow()
  })
  it('rejects a preparation report mislabeled as default-off even though some tests passed', async () => {
    const s = await fixture(); await writeFile(join(s.root, 'sound-closed', 'report.json'), JSON.stringify(report('avg-sound-requirements.spec.ts', 3, 1)))
    await expect(s.run()).rejects.toThrow(/声明的声音模式/)
  })
  it.each(['missing', 'skipped'])('rejects %s closed-factory Release execution evidence', async reason => {
    const s = await fixture(), path = join(s.root, 'sound-frozen', 'report.json')
    if (reason === 'missing') await rm(path)
    else await writeFile(path, JSON.stringify(report('avg-sound-prototype-read.spec.ts', 0, 1)))
    await expect(s.run()).rejects.toThrow()
  })
  it('rejects enough closed counts without the exact publisher Release recovery', async () => {
    const s = await fixture(); await writeFile(join(s.root, 'sound-frozen', 'report.json'), JSON.stringify(report('avg-sound-prototype-read.spec.ts', 2, 0, 0, 0, true, false)))
    await expect(s.run()).rejects.toThrow()
  })
  it.each(['missing', 'invalid JSON', 'oversize'])('rejects %s retained evidence', async reason => {
    const s = await fixture()
    if (reason === 'missing') await rm(s.path)
    else await writeFile(s.path, reason === 'invalid JSON' ? '{broken' : ' '.repeat(8 * 1024 * 1024 + 1))
    await expect(s.run()).rejects.toThrow()
  })
  it('preserves a visible flaky result instead of claiming first-pass success', async () => {
    const s = await fixture(); await writeFile(s.path, JSON.stringify(report('avg-sound-production.spec.ts', 5, 0, 1)))
    const before = await readFile(s.path), result = JSON.parse((await s.run()).stdout)
    expect(result.modes[2]).toMatchObject({ expected: 5, flaky: 1, skipped: 0 })
    expect(await readFile(s.path)).toEqual(before)
  })
})
