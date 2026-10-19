import { readFile, stat } from 'node:fs/promises'
import { resolve, basename } from 'node:path'

// These are CI execution requirements, never media/author/Harness receipts.
// Minimums permit added cases; they prevent a disabled build from turning an
// entirely skipped Sound suite into an apparent successful verification.
const modes = [
  { directory: 'sound-closed', file: 'avg-sound-requirements.spec.ts', minimumExecuted: 1, minimumSkipped: 3 },
  { directory: 'sound-preparation', file: 'avg-sound-requirements.spec.ts', minimumExecuted: 3, minimumSkipped: 1 },
  { directory: 'sound-production', file: 'avg-sound-production.spec.ts', minimumExecuted: 4, minimumSkipped: 0 },
  { directory: 'sound-frozen', file: 'avg-sound-prototype-read.spec.ts', minimumExecuted: 1, minimumSkipped: 0 },
]
const maximumBytes = 8 * 1024 * 1024
const fail = message => { throw new Error(message) }

function testsIn(suites, expectedFile) {
  if (!Array.isArray(suites)) fail('报告缺少 suite 集合')
  return suites.flatMap(suite => {
    const specs = suite.specs ?? []
    if (!Array.isArray(specs)) fail('报告 spec 集合无效')
    const tests = specs.flatMap(spec => {
      if (typeof spec.file !== 'string' || basename(spec.file.replaceAll('\\', '/')) !== expectedFile
        || !Array.isArray(spec.tests)) fail('报告并非本模式的准确声音用例')
      return spec.tests
    })
    return [...tests, ...testsIn(suite.suites ?? [], expectedFile)]
  })
}

async function verifyMode(root, mode) {
  const path = resolve(root, mode.directory, 'report.json')
  const info = await stat(path)
  if (!info.isFile() || info.size < 1 || info.size > maximumBytes) fail(`${mode.directory} 报告大小无效`)
  const content = await readFile(path)
  if (content.length > maximumBytes) fail(`${mode.directory} 报告超过上限`)
  const report = JSON.parse(content.toString('utf8'))
  if (!Array.isArray(report.errors) || report.errors.length) fail(`${mode.directory} 有运行级失败`)
  const counts = { expected: 0, flaky: 0, unexpected: 0, skipped: 0 }
  for (const test of testsIn(report.suites, mode.file)) {
    if (test.projectName !== 'chromium' || !Object.hasOwn(counts, test.status)) fail('报告项目或用例终态无效')
    counts[test.status]++
    if (test.status === 'expected' || test.status === 'flaky') {
      if (test.expectedStatus !== 'passed' || !Array.isArray(test.results)
        || test.results.at(-1)?.status !== 'passed') fail('执行统计缺少真实通过的用例结果')
    }
  }
  if (!report.stats || Object.entries(counts).some(([key, count]) => report.stats[key] !== count)) fail('报告统计与逐例结果不一致')
  if (counts.unexpected) fail(`${mode.directory} 存在失败用例`)
  if (counts.expected + counts.flaky < mode.minimumExecuted || counts.skipped < mode.minimumSkipped
    || mode.minimumSkipped === 0 && counts.skipped !== 0) fail(`${mode.directory} 未实际覆盖声明的声音模式，不能以跳过充当通过`)
  return { mode: mode.directory, ...counts }
}

try {
  if (process.argv.length !== 3) fail('需要明确的声音 CI 报告根目录')
  const results = []
  for (const mode of modes) results.push(await verifyMode(resolve(process.argv[2]), mode))
  // Retain the project's visible browser-retry policy: flaky stays flaky,
  // never relabel it as an expected first-pass success or a hearing approval.
  console.log(JSON.stringify({ schema: 'storyforge.avg.sound-ci-execution', version: 1, modes: results }))
} catch (error) {
  console.error(`[avg-sound-ci] ${error instanceof Error ? error.message : '报告无法核验'}`)
  process.exitCode = 1
}
