import Dexie, { type Table } from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

interface Row { id?: number; [key: string]: unknown }

class CodexV65FixtureDB extends Dexie {
  codexEntries!: Table<Row, number>

  constructor(name: string) {
    super(name)
    this.version(64).stores({
      codexEntries: '++id, projectId, categoryId, worldGroupId, order',
    })
    this.version(65).stores({
      codexEntries: '++id, projectId, categoryId, worldGroupId, order, producerRunId',
    }).upgrade(async tx => {
      await tx.table('codexEntries').toCollection().modify(entry => {
        if (!Object.prototype.hasOwnProperty.call(entry, 'origin')) entry.origin = 'manual'
        if (!Object.prototype.hasOwnProperty.call(entry, 'sourceEvidenceQuotes')) entry.sourceEvidenceQuotes = '[]'
        if (!Object.prototype.hasOwnProperty.call(entry, 'sourceContentHash')) entry.sourceContentHash = ''
        if (!Object.prototype.hasOwnProperty.call(entry, 'producerRunId')) entry.producerRunId = null
        if (!Object.prototype.hasOwnProperty.call(entry, 'producerCandidateHash')) entry.producerCandidateHash = null
      })
    })
  }
}

const names: string[] = []
afterEach(async () => {
  await Promise.all(names.splice(0).map(name => Dexie.delete(name)))
})

describe('CODEX-1 · v65 provenance migration', () => {
  it('preserves historical author entries and adds the lifecycle index without inventing AI lineage', async () => {
    const name = `codex-v65-${crypto.randomUUID()}`
    names.push(name)
    const legacy = new CodexV65FixtureDB(name)
    legacy.version(65)
    await legacy.open()
    await legacy.close()

    // Recreate a genuine v64 database before opening the v65 fixture.
    await Dexie.delete(name)
    const v64 = new Dexie(name)
    v64.version(64).stores({ codexEntries: '++id, projectId, categoryId, worldGroupId, order' })
    await v64.open()
    await v64.table('codexEntries').add({
      projectId: 1, categoryId: 2, worldGroupId: 3, order: 0,
      name: '旧人工词条', description: '作者原有内容',
    })
    v64.close()

    const upgraded = new CodexV65FixtureDB(name)
    await upgraded.open()
    const row = await upgraded.codexEntries.toCollection().first()
    expect(row).toMatchObject({
      name: '旧人工词条', description: '作者原有内容', origin: 'manual',
      sourceEvidenceQuotes: '[]', sourceContentHash: '', producerRunId: null,
      producerCandidateHash: null,
    })
    expect(upgraded.codexEntries.schema.indexes.map(index => index.name)).toContain('producerRunId')
    upgraded.close()
  })
})
