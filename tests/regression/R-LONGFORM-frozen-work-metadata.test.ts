import { beforeEach, afterEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createWorldWork, switchActiveWork, updateActiveWork } from '../../src/lib/workspace/works'
import type { WorkspaceScope } from '../../src/lib/types'
import { coordinatePendingEditV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

// The new optional argument binds the author's already selected Work. Before
// the fix the runtime ignores this argument and borrows the new active Work.
const saveFrozen = updateActiveWork as unknown as (
  projectId: number, patch: Parameters<typeof updateActiveWork>[1], scope: WorkspaceScope,
) => Promise<void>
beforeEach(async () => { await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1() })
afterEach(() => resetPendingEditCoordinatorForTestsV1())

it('a queued metadata save remains on Work A after Work B becomes active', async () => {
  const { scope } = await seedCurrentWorkspace('A')
  const b = await createWorldWork(scope.projectId, { title: 'B', kind: 'novel', novelProfile: 'long' })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const blocked = coordinatePendingEditV1({ key: `work-info:${scope.workId}`, persist: () => gate })
  const saving = coordinatePendingEditV1({ key: `work-info:${scope.workId}`, persist: () => saveFrozen(scope.projectId, { description: '只能写入 A 的简介' }, scope) })
  try { await switchActiveWork(scope.projectId, b.id!) } finally { release() }
  await Promise.all([blocked, saving])
  expect((await db.works.get(scope.workId))?.description).toBe('只能写入 A 的简介')
  expect((await db.works.get(b.id!))?.description).not.toBe('只能写入 A 的简介')
  expect((await db.projects.get(scope.projectId))?.activeWorkId).toBe(b.id)
})
it('rejects a frozen scope from another workspace without changing either Work', async () => {
  const a = await seedCurrentWorkspace('A'), b = await seedCurrentWorkspace('B')
  await expect(saveFrozen(b.scope.projectId, { title: '不能写入' }, a.scope)).rejects.toThrow()
  expect((await db.works.get(a.scope.workId))?.title).toBe('A')
  expect((await db.works.get(b.scope.workId))?.title).toBe('B')
})
it('does not redirect a deleted Work target to the remaining active Work', async () => {
  const { scope } = await seedCurrentWorkspace('A')
  const b = await createWorldWork(scope.projectId, { title: 'B', kind: 'novel', novelProfile: 'long' })
  await switchActiveWork(scope.projectId, b.id!); await db.works.delete(scope.workId)
  await expect(saveFrozen(scope.projectId, { title: '不能重新定向' }, scope)).rejects.toThrow()
  expect((await db.works.get(b.id!))?.title).toBe('B')
})
