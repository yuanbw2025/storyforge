import { afterEach, beforeEach, expect, it } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import { createReferenceAnalysisRun } from '../../src/lib/reference-analysis/lifecycle'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

async function setup() {
  const { scope } = await seedCurrentWorkspace('Reference first-start transaction')
  const text = 'A local reference for testing the shared transaction.'
  const referenceId = await db.references.add(stampNewRecord(scope, 'references', {
    projectId: scope.projectId, workId: scope.workId, title: 'Local test reference', author: '', type: 'story', note: '', url: '',
    analysisDepth: 'deep', analysisStatus: 'pending', analysisProgress: 0,
    fileHash: 'reference-test-file', totalChars: text.length, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' }))
  const input: Parameters<typeof createReferenceAnalysisRun>[0] = {
    referenceId, depth: 'deep', sourceFilename: 'example.txt', fileHash: 'reference-test-file',
    totalChars: text.length, expectedChunks: 1, sourceKind: 'unknown', usageScope: 'analysis-only',
    rightsConfirmed: false, sourceText: text,
  }
  let calls = 0
  const guard = {
    transactionTables: [db.references],
    async claimInTransaction() {
      const tx = Dexie.currentTransaction
      if (!tx || tx.db !== db || tx.mode !== 'readwrite') throw new Error('Expected the original run write transaction')
      ++calls
      // An observable test write proves the caller's claim shares the same commit.
      await tx.table(db.references.name).update(referenceId, { note: 'claimed' })
    },
  }
  return { input, referenceId, text, guard, calls: () => calls }
}

it('only one concurrent first start creates its run and original local source', async () => {
  const f = await setup()
  const requests = await Promise.allSettled([createReferenceAnalysisRun(f.input, f.guard), createReferenceAnalysisRun(f.input, f.guard)])
  expect(requests.filter(row => row.status === 'fulfilled')).toHaveLength(1)
  expect(requests.filter(row => row.status === 'rejected')).toHaveLength(1)
  expect(f.calls()).toBe(1)
  const runs = await db.referenceAnalysisRuns.where('referenceId').equals(f.referenceId).toArray()
  expect(runs).toHaveLength(1)
  expect(runs[0]).toMatchObject({ version: 1, rightsConfirmed: false })
  expect((await db.referenceAnalysisSources.get(runs[0].id!))?.chunks[0].text).toBe(f.text)
  expect((await db.references.get(f.referenceId))?.note).toBe('claimed')
})

it('aborts the claim and version when writing the local source fails, then allows an explicit retry', async () => {
  const f = await setup()
  const fail = () => { throw new Error('isolated source write failure') }
  db.referenceAnalysisSources.hook('creating', fail)
  try {
    await expect(createReferenceAnalysisRun(f.input, f.guard)).rejects.toThrow('isolated source write failure')
  } finally { db.referenceAnalysisSources.hook('creating').unsubscribe(fail) }
  expect(f.calls()).toBe(1)
  expect((await db.references.get(f.referenceId))?.note).toBe('')
  expect(await db.referenceAnalysisRuns.count()).toBe(0)
  expect(await db.referenceAnalysisSources.count()).toBe(0)
  expect((await createReferenceAnalysisRun(f.input, f.guard)).version).toBe(1)
  expect(await db.referenceAnalysisSources.count()).toBe(1)
})
