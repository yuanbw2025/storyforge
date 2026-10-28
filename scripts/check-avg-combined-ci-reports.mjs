import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'test-results/avg-media')
const fail = message => { throw new Error(`[avg-combined-ci] ${message}`) }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
function bytes(path) {
  if (!statSync(path).isFile() || statSync(path).size > 32 * 1024 * 1024) fail('缺少有界真实报告/导出')
  return readFileSync(path)
}
function cases(suites, file, title) {
  if (!Array.isArray(suites)) fail('报告 suite 无效')
  return suites.flatMap(suite => [
    ...(suite.specs ?? []).filter(spec => basename(String(spec.file).replaceAll('\\', '/')) === file && spec.title === title)
      .flatMap(spec => spec.tests ?? []), ...cases(suite.suites ?? [], file, title),
  ])
}
const required = [
  { directory: 'combined-production', file: 'avg-combined-media-production.spec.ts',
    title: 'native same-Work five images, original Sound and local fixed voice publish nine exact consumers and retain the earlier five-image Release' },
  { directory: 'combined-frozen', file: 'avg-combined-prototype-read.spec.ts',
    title: 'the same successful nine-media export restores all native consumers and Release-only saves with all five factories closed and no new production authority' },
]
const selected = required.map(mode => {
  const report = JSON.parse(bytes(join(root, mode.directory, 'report.json')))
  if (!Array.isArray(report.errors) || report.errors.length) fail(`${mode.directory} 报告级错误`)
  const tests = cases(report.suites, mode.file, mode.title)
  if (tests.length !== 1) fail(`${mode.directory} 缺少或重复准确组合用例`)
  const test = tests[0], results = test.results
  if (test.projectName !== 'chromium' || test.expectedStatus !== 'passed' || !['expected', 'flaky'].includes(test.status)
    || !Array.isArray(results) || !results.length || results.at(-1).status !== 'passed'
    || results.some(r => !['passed', 'failed', 'timedOut'].includes(r.status))) fail(`${mode.directory} 未实际执行并通过`)
  const flaky = results.some(r => r.status !== 'passed')
  if (flaky !== (test.status === 'flaky')) fail(`${mode.directory} 重试分类不闭合`)
  return { mode, test, result: results.at(-1), expected: flaky ? 0 : 1, flaky: flaky ? 1 : 0 }
})
const sourceBytes = bytes(join(root, 'combined-release.json')), exported = JSON.parse(sourceBytes)
const current = exported.expected, old = exported.originalFive, counts = exported.providerCounts
if (exported.schema !== 'storyforge.avg.combined-release-native-test-export' || exported.version !== 1 || !exported.backup
  || sha(JSON.stringify(exported.backup)) !== exported.backupSHA256 || !current || !old
  || typeof current.manifestJson !== 'string' || typeof old.manifestJson !== 'string'
  || typeof current.releaseUid !== 'string' || typeof old.releaseUid !== 'string' || current.releaseUid === old.releaseUid
  || current.scope?.workId !== old.scope?.workId || current.scope?.projectId !== old.scope?.projectId
  || !Array.isArray(current.assets) || current.assets.length !== 9 || !Array.isArray(old.assets) || old.assets.length !== 5
  || new Set(current.assets.map(a => a.assetKey)).size !== 9 || current.assets.filter(a => a.mimeType?.startsWith('image/')).length !== 5
  || ['bgm', 'sfx', 'ambience', 'voice'].some(kind => current.assets.filter(a => a.kind === kind).length !== 1)
  || old.assets.some(a => JSON.stringify(current.assets.find(b => b.assetKey === a.assetKey)) !== JSON.stringify(a))
  || !Array.isArray(current.hashes) || current.hashes.length !== 9
  || current.hashes.some((h, i) => h.assetKey !== current.assets[i].assetKey || h.hash !== current.assets[i].blobContentHash)
  || !counts || counts.visualPlans !== 4 || counts.images !== 5 || counts.text !== 1 || counts.music !== 1
  || counts.library !== 2 || counts.publisher !== 1 || counts.voice !== 1 || !Array.isArray(counts.unknown) || counts.unknown.length
  || current.hasKey !== false) fail('缺少准确同Work九媒资、旧五图版本、实际调用计数或完整成功导出')
const attachments = selected[1].result.attachments?.filter(a => a.name === 'combined-closed-consumed-export' && a.contentType === 'application/json')
if (!attachments || attachments.length !== 1 || typeof attachments[0].path !== 'string') fail('缺少关闭恢复实际消费的导出见证')
const path = resolve(attachments[0].path), inside = relative(root, path)
if (isAbsolute(inside) || inside === '..' || inside.startsWith('../')) fail('消费见证不属于本次原生输出目录')
const read = JSON.parse(bytes(path))
if (read.schema !== 'storyforge.avg.combined-closed-export-read' || read.version !== 1
  || read.sourceFileSHA256 !== sha(sourceBytes) || read.backupSHA256 !== exported.backupSHA256
  || read.releaseUid !== current.releaseUid || read.originalFiveReleaseUid !== old.releaseUid
  || read.assetCount !== 9 || read.originalFiveAssetCount !== 5 || read.allFactoriesClosed !== true
  || read.ownerRemapped !== true || read.releaseOnlySave !== true || read.newProviderRequests !== 0
  || read.productionAuthorityCountsUnchanged !== true || read.artOrListeningAccepted !== false) fail('关闭恢复未消费本次准确成功导出或权限边界不闭合')
process.stdout.write(JSON.stringify({ modes: selected.map(s => ({ directory: s.mode.directory, expected: s.expected, flaky: s.flaky })),
  sourceFileSHA256: sha(sourceBytes), backupSHA256: exported.backupSHA256,
  classification: 'Executed same-Work nine-media UI/export/native closed-read evidence only; never real generation, hearing, art or commercial authority' }) + '\n')
