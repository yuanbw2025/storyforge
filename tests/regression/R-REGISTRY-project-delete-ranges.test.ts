import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(async () => { vi.restoreAllMocks(); await db.delete() })

async function fixture() {
  const a = (await seedCurrentWorkspace('range-delete-owned')).scope.projectId
  const b = (await seedCurrentWorkspace('range-delete-foreign')).scope.projectId
  const row = (id: number | string, projectId: number) => ({
    id, projectId, type: 'character', status: 'done', filename: `${id}.txt`,
    fileSize: 1, fileHash: String(id), totalChunks: 1, completedChunks: 1,
    parsedSummary: {}, createdAt: 1, updatedAt: 1,
  })
  // Fractional and string keys model legacy/imported IndexedDB records. They
  // remain valid DB keys even though current domain-created IDs are integers.
  await db.importSessions.bulkAdd([
    ...[1, 2, 4, 5, 8, 9].map(id => row(id, a)),
    ...[3, 4.5, 6, 7].map(id => row(id, b)),
  ] as any)
  for (const sessionId of [1, 2, 3, 4, 4.5, 5, 8, 9]) {
    await db.importLogs.add({ sessionId, level: 'info', message: 'retained evidence', timestamp: 1 } as any)
    await db.importFiles.put({ sessionId, filename: `${sessionId}.txt`, blob: new Blob(['evidence']),
      fileHash: 'evidence', createdAt: 1 } as any)
  }
  return { a, b, row }
}

it('deletes only the owned scope across integer gaps and foreign fractional keys, including indirect rows and blobs', async () => {
  const { a, b } = await fixture()
  const foreign = await db.importSessions.where('projectId').equals(b).toArray()
  await cascadeDeleteProject(a)
  expect(await db.projects.get(a)).toBeUndefined()
  expect(await db.projects.get(b)).toBeDefined()
  expect(await db.importSessions.where('projectId').equals(a).count()).toBe(0)
  expect(await db.importSessions.toArray()).toEqual(foreign)
  expect((await db.importLogs.toArray()).map(row => row.sessionId)).toEqual([3, 4.5])
  expect((await db.importFiles.toArray()).map(row => row.sessionId)).toEqual([3, 4.5])
})

it('keeps deleting hooks and rolls back the whole project cascade when a later group fails', async () => {
  const { a } = await fixture()
  const sessions = await db.importSessions.toArray()
  const logs = await db.importLogs.toArray()
  const fileKeys = await db.importFiles.toCollection().primaryKeys()
  const onDelete = (key: number) => { if (key === 8) throw new Error('isolated-delete-hook-refusal') }
  db.importSessions.hook('deleting', onDelete)
  try { await expect(cascadeDeleteProject(a)).rejects.toThrow('isolated-delete-hook-refusal') }
  finally { db.importSessions.hook('deleting').unsubscribe(onDelete) }
  expect(await db.projects.get(a)).toBeDefined()
  expect(await db.importSessions.toArray()).toEqual(sessions)
  expect(await db.importLogs.toArray()).toEqual(logs)
  expect(await db.importFiles.toCollection().primaryKeys()).toEqual(fileKeys)
})

it('falls back to exact scoped deletion for legacy non-integer keys', async () => {
  const { a, b, row } = await fixture()
  await db.importSessions.bulkAdd([row('owned', a), row('foreign', b)] as any)
  await cascadeDeleteProject(a)
  expect(await db.importSessions.where('projectId').equals(a).count()).toBe(0)
  expect(await db.importSessions.get('foreign' as any)).toMatchObject({ projectId: b })
  expect(await db.importSessions.get(4.5)).toMatchObject({ projectId: b })
})

it('uses bounded native range deletion for a large contiguous append-only evidence set', async () => {
  const { a, b } = await fixture()
  await db.agentRunEvents.bulkAdd(Array.from({ length: 1_000 }, (_, index) => ({
    id: index + 1, projectId: a, runId: 1, sequence: index + 1,
    type: 'test-evidence', payloadJson: '{}', createdAt: 1,
  })) as any)
  await db.agentRunEvents.add({ id: 1_001, projectId: b, runId: 2, sequence: 1,
    type: 'test-evidence', payloadJson: '{}', createdAt: 1 } as any)
  const deletes = vi.spyOn(IDBObjectStore.prototype, 'delete')
  await cascadeDeleteProject(a)
  expect(await db.agentRunEvents.where('projectId').equals(a).count()).toBe(0)
  expect(await db.agentRunEvents.get(1_001)).toMatchObject({ projectId: b })
  const evidenceDeletes = deletes.mock.calls.filter((_call, index) => deletes.mock.contexts[index].name === 'agentRunEvents')
  expect(evidenceDeletes).toHaveLength(1)
  expect(evidenceDeletes[0][0]).toBeInstanceOf(IDBKeyRange)
})
