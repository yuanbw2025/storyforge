import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'test-results/avg-media')
const fail = message => { throw new Error(`[avg-visual-release-ci] ${message}`) }
function read(path) {
  if (!statSync(path).isFile() || statSync(path).size > 32 * 1024 * 1024) fail('缺少有界真实报告/导出')
  return JSON.parse(readFileSync(path, 'utf8'))
}
function cases(suites, file, title) {
  if (!Array.isArray(suites)) fail('报告 suite 集合无效')
  return suites.flatMap(suite => [
    ...(suite.specs ?? []).filter(spec => basename(String(spec.file).replaceAll('\\', '/')) === file && spec.title === title).flatMap(spec => spec.tests ?? []),
    ...cases(suite.suites ?? [], file, title),
  ])
}
const required = [
  { directory: 'all', file: 'avg-visual-planning-workbench.spec.ts', title: 'V5 native family images preserve policy2, local derivatives and five consumers through Source5/6 Preview and portable restore' },
  { directory: 'visual-frozen', file: 'avg-visual-prototype-read.spec.ts', title: 'original V5 published images and local derivative restore and play with both visual factories closed and no new provider/quality authority' },
]
const modes = required.map(mode => {
  const report = read(join(root, mode.directory, 'report.json'))
  if (!Array.isArray(report.errors) || report.errors.length) fail(`${mode.directory} 存在报告级错误`)
  const selected = cases(report.suites, mode.file, mode.title)
  if (selected.length !== 1) fail(`${mode.directory} 缺少或重复准确 V5 发布/恢复用例`)
  const test = selected[0], results = test.results
  if (test.projectName !== 'chromium' || test.expectedStatus !== 'passed' || !['expected', 'flaky'].includes(test.status)
    || !Array.isArray(results) || !results.length || results.at(-1).status !== 'passed'
    || results.some(r => !['passed', 'failed', 'timedOut'].includes(r.status))) fail(`${mode.directory} 未实际执行并通过`)
  const flaky = results.some(r => r.status !== 'passed')
  if (flaky !== (test.status === 'flaky')) fail(`${mode.directory} 重试分类不闭合`)
  return { directory: mode.directory, expected: flaky ? 0 : 1, flaky: flaky ? 1 : 0 }
})
const exported = read(join(root, 'visual-release.json'))
if (exported.schema !== 'storyforge.avg.visual-release-native-test-export' || exported.version !== 1 || !exported.backup
  || createHash('sha256').update(JSON.stringify(exported.backup)).digest('hex') !== exported.backupSHA256
  || typeof exported.expected?.releaseUid !== 'string' || typeof exported.expected?.manifestJson !== 'string'
  || !Array.isArray(exported.expected?.assets) || exported.expected.assets.length !== 5) fail('缺少准确五图原生发布导出或字节hash已变化')
process.stdout.write(JSON.stringify({ modes, classification: 'Executed native source/export/closed-recovery coverage only; never producer, author, art or commercial authority' }) + '\n')
