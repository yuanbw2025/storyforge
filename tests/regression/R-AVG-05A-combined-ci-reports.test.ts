import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile), owned: string[] = [], sha = (s: string) => createHash('sha256').update(s).digest('hex')
afterEach(async () => { for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true }) })
// Invented CI metadata only. These values never enter a product import,
// generate a real Run/author/quality receipt or stand for native evidence.
const producerTitle = 'native same-Work five images, original Sound and local fixed voice publish nine exact consumers and retain the earlier five-image Release'
const closedTitle = 'the same successful nine-media export restores all native consumers and Release-only saves with all five factories closed and no new production authority'
const report = (file: string, title: string) => ({ errors: [], suites: [{ specs: [{ file, title,
  tests: [{ projectName: 'chromium', expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', attachments: [] as any[] }] }] }] }] })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'storyforge-combined-reports-')); owned.push(root)
  for (const dir of ['combined-production', 'combined-frozen']) await mkdir(join(root, dir))
  const producer = report('avg-combined-media-production.spec.ts', producerTitle), closed = report('avg-combined-prototype-read.spec.ts', closedTitle)
  const images = Array.from({ length: 5 }, (_, i) => ({ assetKey: `image.${i}`, kind: 'background', mimeType: 'image/png', blobContentHash: `${i}`.repeat(64) }))
  const assets = [...images, ...['bgm', 'sfx', 'ambience', 'voice'].map((kind, i) => ({ assetKey: `audio.${kind}`, kind, mimeType: 'audio/wav', blobContentHash: `${i + 5}`.repeat(64) }))]
  const backup = { engineeringReportOnly: true }, scope = { projectId: 1, workId: 1 }
  const exported = { schema: 'storyforge.avg.combined-release-native-test-export', version: 1, backup, backupSHA256: sha(JSON.stringify(backup)),
    expected: { scope, releaseUid: 'new-report-only', manifestJson: '{}', assets, hashes: assets.map(a => ({ assetKey: a.assetKey, hash: a.blobContentHash })), hasKey: false },
    originalFive: { scope, releaseUid: 'old-report-only', manifestJson: '{}', assets: images },
    providerCounts: { visualPlans: 4, images: 5, text: 1, music: 1, library: 2, publisher: 1, voice: 1, unknown: [] as string[] } }
  const receipt = { schema: 'storyforge.avg.combined-closed-export-read', version: 1, sourceFileSHA256: sha(JSON.stringify(exported)),
    backupSHA256: exported.backupSHA256, releaseUid: exported.expected.releaseUid, originalFiveReleaseUid: exported.originalFive.releaseUid,
    assetCount: 9, originalFiveAssetCount: 5, allFactoriesClosed: true, ownerRemapped: true, releaseOnlySave: true,
    newProviderRequests: 0, productionAuthorityCountsUnchanged: true, artOrListeningAccepted: false }
  const receiptPath = join(root, 'combined-frozen/consumed.json')
  closed.suites[0].specs[0].tests[0].results[0].attachments.push({ name: 'combined-closed-consumed-export', contentType: 'application/json', path: receiptPath })
  async function save() {
    await writeFile(join(root, 'combined-production/report.json'), JSON.stringify(producer)); await writeFile(join(root, 'combined-frozen/report.json'), JSON.stringify(closed))
    await writeFile(join(root, 'combined-release.json'), JSON.stringify(exported)); await writeFile(receiptPath, JSON.stringify(receipt))
  }
  await save()
  return { root, producer, closed, exported, receipt, save, run: () => execute(process.execPath, [resolve('scripts/check-avg-combined-ci-reports.mjs'), root]) }
}
describe('actual same-Work nine-media producer to exact closed-reader export dependency', () => {
  it('requires both actual native cases and exact consumed successful export while retaining all source bytes', async () => {
    const s = await fixture(), before = await readFile(join(s.root, 'combined-release.json'))
    expect(JSON.parse((await s.run()).stdout).modes).toEqual([{ directory: 'combined-production', expected: 1, flaky: 0 }, { directory: 'combined-frozen', expected: 1, flaky: 0 }])
    expect(await readFile(join(s.root, 'combined-release.json'))).toEqual(before)
  })
  it.each(['missing-producer', 'old-single-line', 'skipped-closed', 'wrong-browser', 'changed-backup', 'eight-media',
    'another-export', 'new-request', 'open-factory', 'missing-consumption'] as const)('refuses %s', async mode => {
    const s = await fixture()
    if (mode === 'missing-producer') s.producer.suites = []
    if (mode === 'old-single-line') s.producer.suites[0].specs[0].title = 'old single-line voice release'
    if (mode === 'skipped-closed') Object.assign(s.closed.suites[0].specs[0].tests[0], { status: 'skipped', results: [{ status: 'skipped', attachments: [] }] })
    if (mode === 'wrong-browser') s.closed.suites[0].specs[0].tests[0].projectName = 'firefox'
    if (mode === 'changed-backup') s.exported.backup.engineeringReportOnly = false
    if (mode === 'eight-media') s.exported.expected.assets.pop()
    if (mode === 'another-export') s.receipt.sourceFileSHA256 = '0'.repeat(64)
    if (mode === 'new-request') s.receipt.newProviderRequests = 1
    if (mode === 'open-factory') s.receipt.allFactoriesClosed = false
    if (mode === 'missing-consumption') s.closed.suites[0].specs[0].tests[0].results[0].attachments = []
    await s.save(); await expect(s.run()).rejects.toThrow()
  })
  it('keeps a reported retry visible as flaky rather than claiming first-pass success', async () => {
    const s = await fixture(), value = s.closed.suites[0].specs[0].tests[0]
    value.status = 'flaky'; value.results.unshift({ status: 'failed', attachments: [] }); await s.save()
    expect(JSON.parse((await s.run()).stdout).modes[1]).toEqual({ directory: 'combined-frozen', expected: 0, flaky: 1 })
  })
})
