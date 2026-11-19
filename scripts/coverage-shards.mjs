import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const COVERAGE_SHARD_COUNT = 8
export const vitestExecutable = () => path.resolve('node_modules/vitest/vitest.mjs')
/** @param {string} file */
export const fileDigest = file => createHash('sha256').update(readFileSync(file)).digest('hex')

/** @returns {import('./coverage-shards.d.mts').CoverageSource} */
export function coverageSource() {
  /** @param {string} revision */
  const git = revision => execFileSync('git', ['rev-parse', revision], { encoding: 'utf8' }).trim()
  return {
    commit: git('HEAD'),
    tree: git('HEAD^{tree}'),
    vitest: JSON.parse(readFileSync('node_modules/vitest/package.json', 'utf8')).version,
  }
}

export function coverageFiles() {
  // Keep --json last: its optional value is an output filename, not a filter.
  const output = execFileSync(process.execPath, [vitestExecutable(), 'list', '--filesOnly', '--json'], { encoding: 'utf8' })
  const files = JSON.parse(output).map(/** @param {{ file: string }} row */ row => relativeTestFile(row.file))
  if (!files.length || new Set(files).size !== files.length) throw new Error('Invalid complete coverage file inventory')
  return files.sort()
}

/** @param {string} file */
export function relativeTestFile(file) {
  const relative = path.relative(process.cwd(), file).split(path.sep).join('/')
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Coverage file is outside this checkout')
  return relative
}

/** @param {import('./coverage-shards.d.mts').CompletedTestReport} report */
export function completedTestFiles(report) {
  if (report.success !== true || !(report.numTotalTests > 0)
    || report.numFailedTests !== 0 || report.numFailedTestSuites !== 0
    || !Array.isArray(report.testResults) || report.testResults.length === 0) {
    throw new Error('Coverage shard has no successful completed test report')
  }
  return report.testResults.map(row => relativeTestFile(row.name)).sort()
}

/**
 * @param {string} directory
 * @param {import('./coverage-shards.d.mts').CoverageValidationOptions} options
 */
export function validateCoverageShards(directory, { source, expectedFiles, count = COVERAGE_SHARD_COUNT }) {
  const folders = readdirSync(directory, { withFileTypes: true })
  if (folders.length !== count || folders.some(row => !row.isDirectory())) throw new Error('Incomplete coverage shard set')
  const indexes = new Set(), covered = new Set(), blobs = []
  for (const folder of folders) {
    const root = path.join(directory, folder.name)
    const receipt = JSON.parse(readFileSync(path.join(root, 'receipt.json'), 'utf8'))
    if (receipt.schema !== 1 || receipt.count !== count || !Number.isInteger(receipt.index)
      || receipt.index < 1 || receipt.index > count || indexes.has(receipt.index)) {
      throw new Error('Invalid or duplicate coverage shard index')
    }
    indexes.add(receipt.index)
    /** @type {Array<keyof import('./coverage-shards.d.mts').CoverageSource>} */
    const sourceKeys = ['commit', 'tree', 'vitest']
    for (const key of sourceKeys) {
      if (receipt.source?.[key] !== source[key]) throw new Error(`Coverage shard source mismatch: ${key}`)
    }
    const blob = path.join(root, 'blob.json'), results = path.join(root, 'test-results.json')
    if (fileDigest(blob) !== receipt.blobSha256 || fileDigest(results) !== receipt.resultsSha256) {
      throw new Error('Coverage shard checksum mismatch')
    }
    const files = completedTestFiles(JSON.parse(readFileSync(results, 'utf8')))
    if (JSON.stringify(files) !== JSON.stringify(receipt.files)) throw new Error('Coverage shard file receipt mismatch')
    for (const file of files) {
      if (covered.has(file)) throw new Error(`Duplicate coverage test file: ${file}`)
      covered.add(file)
    }
    blobs.push(blob)
  }
  if (JSON.stringify([...covered].sort()) !== JSON.stringify([...expectedFiles].sort())) {
    throw new Error('Coverage shards do not match the complete test file inventory')
  }
  return blobs
}

/** @param {string} directory */
export function prepareCoverageMerge(directory) {
  const expectedFiles = coverageFiles()
  const blobs = validateCoverageShards(directory, { source: coverageSource(), expectedFiles })
  // Coverage providers may clear reportsDirectory before merge. Keep verified
  // input blobs outside that cleanup root, just like the downloaded receipts.
  const destination = mkdtempSync(path.join(os.tmpdir(), 'storyforge-verified-coverage-'))
  blobs.forEach((blob, index) => copyFileSync(blob, path.join(destination, `blob-${index}.json`)))
  return { destination, expectedFiles }
}
