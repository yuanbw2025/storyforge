import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { cascadeDeleteProject, transactionTablesFor } from '../../src/lib/registry/lifecycle'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { clearAtlasWorkspaceViews, readAtlasView, saveAtlasView } from '../../src/lib/authoring/atlas-view-cache'
import { authorViewCache } from '../../src/lib/storage/author-view-cache'
import type { AtlasPaintPackageV2 } from '../../src/lib/world-map/atlas/paint-package'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(async () => {
  vi.restoreAllMocks()
  for (const project of await db.projects.toArray()) if (project.workspaceUid) await clearAtlasWorkspaceViews(project.workspaceUid)
  await db.delete()
})

const paint: AtlasPaintPackageV2 = { kind: 'storyforge.atlas-paint', version: 2, geometryHash: 'a'.repeat(64),
  style: 'sketch', symbols: 'watercolor', rendering: 'masked-v2', image: 'data:image/png;base64,eA==',
  source: { provider: 'fixture', model: 'image', createdAt: 1, promptRevision: 'v2' } }

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

it('clears only the deleted workspace view while an enclosing caller holds root identity locks', async () => {
  const { a, b } = await fixture()
  const ownerA = (await db.projects.get(a))!.workspaceUid!, ownerB = (await db.projects.get(b))!.workspaceUid!
  await saveAtlasView(ownerA + ':map:1', paint)
  await saveAtlasView(ownerB + ':map:1', paint)
  await db.transaction('rw', transactionTablesFor('deleteProject'), async () => {
    await cascadeDeleteProject(a)
    expect(await db.projects.get(a)).toBeUndefined()
    expect(await db.projects.get(b)).toBeDefined()
  })
  expect(await readAtlasView(ownerA + ':map:1', 'sketch', 'watercolor')).toBeUndefined()
  expect((await readAtlasView(ownerB + ':map:1', 'sketch', 'watercolor'))?.art).toEqual(paint)
})

it('retains the workspace and its view when cache cleanup fails before deletion', async () => {
  const { a, b } = await fixture()
  const owner = (await db.projects.get(a))!.workspaceUid!
  await saveAtlasView(owner + ':map:1', paint)
  vi.spyOn(authorViewCache, 'removePrefix').mockRejectedValueOnce(Error('cache-cleanup-blocked'))
  await expect(cascadeDeleteProject(a)).rejects.toThrow('cache-cleanup-blocked')
  expect(await db.projects.get(a)).toBeDefined()
  expect(await db.projects.get(b)).toBeDefined()
  expect((await readAtlasView(owner + ':map:1', 'sketch', 'watercolor'))?.art).toEqual(paint)
})

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
