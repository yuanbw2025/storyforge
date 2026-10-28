import { afterEach, beforeEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace, addCurrentWorldFixtureV1, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import { useWorldviewStore } from '../../src/stores/worldview'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import type { WorkspaceScope } from '../../src/lib/types'

beforeEach(async () => { await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1() })
afterEach(() => resetPendingEditCoordinatorForTestsV1())
const saveStory = useWorldviewStore.getState().saveStoryCore as (data: { projectId: number; theme: string }, scope: WorkspaceScope) => Promise<void>
const saveWorld = useWorldviewStore.getState().saveWorldview as (data: { projectId: number; worldOrigin: string }, scope: WorkspaceScope) => Promise<void>

it('a draft created in Work A stays there if active Work changes before blur', async () => {
  const { scope } = await seedCurrentWorkspace('A')
  const b = await createWorldWork(scope.projectId, { title: 'B', kind: 'novel', novelProfile: 'long' })
  await switchActiveWork(scope.projectId, b.id!)
  await saveStory({ projectId: scope.projectId, theme: 'A 开始编辑的主题' }, scope)
  const rows = await db.storyCores.toArray()
  expect(rows).toHaveLength(1); expect(rows[0].workId).toBe(scope.workId)
})

it('an ungrouped World A draft cannot borrow World B after the pointer changes', async () => {
  const { scope } = await seedCurrentWorkspace('World A')
  const world = await addCurrentWorldFixtureV1({ projectId: scope.projectId, name: 'World B' })
  const b = await addCurrentWorkFixtureV1({ projectId: scope.projectId, worldId: world.id!, create: { title: 'B', kind: 'novel', novelProfile: 'long' } })
  await switchActiveWork(scope.projectId, b.id!)
  await saveWorld({ projectId: scope.projectId, worldOrigin: 'A 开始编辑的来历' }, scope)
  const rows = await db.worldviews.toArray()
  expect(rows).toHaveLength(1); expect(rows[0].worldId).toBe(scope.worldId)
})
