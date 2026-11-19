import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileDigest, validateCoverageShards } from '../../scripts/coverage-shards.mjs'

const owned: string[] = []
afterEach(() => { for (const root of owned.splice(0)) rmSync(root, { recursive: true, force: true }) })
const source = { commit: 'exact-release-commit', tree: 'exact-release-tree', vitest: '4.1.12' }
const expectedFiles = ['tests/first.test.ts', 'tests/second.test.ts']

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'storyforge-shard-receipts-'))
  owned.push(root)
  expectedFiles.forEach((file, offset) => {
    const directory = path.join(root, String(offset + 1))
    mkdirSync(directory)
    writeFileSync(path.join(directory, 'blob.json'), `blob-${offset}`)
    writeFileSync(path.join(directory, 'test-results.json'), JSON.stringify({
      success: true, numTotalTests: 1, numFailedTests: 0, numFailedTestSuites: 0,
      testResults: [{ name: path.resolve(file), status: 'passed' }],
    }))
    writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify({
      schema: 1, index: offset + 1, count: 2, source, files: [file],
      blobSha256: fileDigest(path.join(directory, 'blob.json')),
      resultsSha256: fileDigest(path.join(directory, 'test-results.json')),
    }))
  })
  return root
}

function receipt(root: string, change: (row: Record<string, unknown>) => void) {
  const file = path.join(root, '2', 'receipt.json')
  const row = JSON.parse(readFileSync(file, 'utf8'))
  change(row)
  writeFileSync(file, JSON.stringify(row))
}

const verify = (root: string) => validateCoverageShards(root, { source, expectedFiles, count: 2 })

describe('complete, exact-source coverage shard acceptance', () => {
  it('accepts exactly one completed component for every expected test file', () => {
    expect(verify(fixture())).toHaveLength(2)
  })
  it('rejects a missing component even if the remaining tests passed', () => {
    const root = fixture(); rmSync(path.join(root, '2'), { recursive: true })
    expect(() => verify(root)).toThrow('Incomplete coverage shard set')
  })
  it('rejects repeated component indexes', () => {
    const root = fixture(); receipt(root, row => { row.index = 1 })
    expect(() => verify(root)).toThrow('duplicate coverage shard index')
  })
  it.each(['commit', 'tree', 'vitest'])('rejects mixed %s provenance', key => {
    const root = fixture(); receipt(root, row => { row.source = { ...source, [key]: 'different' } })
    expect(() => verify(root)).toThrow(`source mismatch: ${key}`)
  })
  it('rejects changed coverage bytes', () => {
    const root = fixture(); writeFileSync(path.join(root, '2', 'blob.json'), 'changed')
    expect(() => verify(root)).toThrow('checksum mismatch')
  })
  it('rejects failed tests even with a matching checksum', () => {
    const root = fixture(), results = path.join(root, '2', 'test-results.json')
    const row = JSON.parse(readFileSync(results, 'utf8')); row.success = false; row.numFailedTests = 1
    writeFileSync(results, JSON.stringify(row))
    receipt(root, value => { value.resultsSha256 = fileDigest(results) })
    expect(() => verify(root)).toThrow('successful completed test report')
  })
  it('rejects duplicated files rather than letting them hide a missing test', () => {
    const root = fixture(), results = path.join(root, '2', 'test-results.json')
    const row = JSON.parse(readFileSync(results, 'utf8')); row.testResults[0].name = path.resolve(expectedFiles[0])
    writeFileSync(results, JSON.stringify(row))
    receipt(root, value => { value.files = [expectedFiles[0]]; value.resultsSha256 = fileDigest(results) })
    expect(() => verify(root)).toThrow('Duplicate coverage test file')
  })
  it('rejects an incomplete union despite successful component receipts', () => {
    expect(() => validateCoverageShards(fixture(), { source, expectedFiles: [...expectedFiles, 'tests/missing.test.ts'], count: 2 }))
      .toThrow('complete test file inventory')
  })
})
