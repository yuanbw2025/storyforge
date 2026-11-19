import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { COVERAGE_SHARD_COUNT, completedTestFiles, coverageSource, fileDigest, vitestExecutable } from './coverage-shards.mjs'

const index = Number(process.argv[2]), output = process.argv[3]
if (!Number.isInteger(index) || index < 1 || index > COVERAGE_SHARD_COUNT || !output) {
  throw new Error(`Usage: node scripts/run-coverage-shard.mjs <1-${COVERAGE_SHARD_COUNT}> <new-output-directory>`)
}
mkdirSync(output)
const reportsDirectory = mkdtempSync(path.join(os.tmpdir(), 'storyforge-coverage-shard-'))
const blob = path.resolve(output, 'blob.json'), results = path.resolve(output, 'test-results.json')
const run = spawnSync(process.execPath, [vitestExecutable(), 'run', '--config=vitest.shard.config.ts',
  '--coverage', `--shard=${index}/${COVERAGE_SHARD_COUNT}`, '--pool=forks', '--isolate', '--maxWorkers=1',
  '--reporter=default', '--reporter=blob', '--reporter=json',
  `--outputFile.blob=${blob}`, `--outputFile.json=${results}`,
  `--coverage.reportsDirectory=${reportsDirectory}`,
], { stdio: 'inherit', env: { ...process.env, STORYFORGE_COVERAGE_SHARD_COMPONENT: '1' } })
if (run.error) throw run.error
if (run.status !== 0) process.exit(run.status ?? 1)
const files = completedTestFiles(JSON.parse(readFileSync(results, 'utf8')))
writeFileSync(path.join(output, 'receipt.json'), JSON.stringify({
  schema: 1, index, count: COVERAGE_SHARD_COUNT, source: coverageSource(), files,
  blobSha256: fileDigest(blob), resultsSha256: fileDigest(results),
}, null, 2))
console.info(`[coverage] shard ${index}/${COVERAGE_SHARD_COUNT}: ${files.length} files; aggregate acceptance still required`)
