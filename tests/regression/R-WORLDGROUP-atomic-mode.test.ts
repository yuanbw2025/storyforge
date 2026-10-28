import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace, addCurrentWorldFixtureV1, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { useWorldGroupStore } from '../../src/stores/world-group'
import { adopt } from '../../src/lib/registry/adopt'
import type { WorkspaceScope } from '../../src/lib/types'

beforeEach(async () => {
  await db.delete(); await db.open()
  useWorldGroupStore.setState({ groups: [], links: [], activeGroupId: null, loading: false })
})
afterEach(() => vi.restoreAllMocks())
async function seed(scope: WorkspaceScope, text: string) {
  const result = await adopt({ projectId: scope.projectId, scope, target: 'worldviews', mode: 'replace', data: { worldOrigin: text } })
  expect(result.written).toHaveLength(1)
}

it('enables the workspace and reassigns its author records in one acknowledged operation', async () => {
  const { scope } = await seedCurrentWorkspace('完整启用')
  await seed(scope, '正式来历')
  await expect(useWorldGroupStore.getState().enableMultiWorld(scope)).resolves.toBe(true)
  expect((await db.projects.get(scope.projectId))?.enableMultiWorld).toBe(true)
  const primary = (await db.worldGroups.toArray())[0]
  expect((await db.worldviews.toArray())[0].worldGroupId).toBe(primary.id)
})

it('a flag write failure rolls back primary creation, reassignment and cached groups', async () => {
  const { scope } = await seedCurrentWorkspace('事务回滚')
  await seed(scope, '失败前的正式来历')
  const before = await db.worldviews.toArray()
  vi.spyOn(db.projects, 'update').mockRejectedValueOnce(new DOMException('mode quota', 'QuotaExceededError'))
  await expect(useWorldGroupStore.getState().enableMultiWorld(scope)).rejects.toThrow('mode quota')
  expect(await db.worldviews.toArray()).toEqual(before)
  expect(await db.worldGroups.count()).toBe(0)
  expect((await db.projects.get(scope.projectId))?.enableMultiWorld).toBe(false)
  expect(useWorldGroupStore.getState().groups).toEqual([])
})

it('each World gets its own primary rather than cross-stamping another World', async () => {
  const { scope } = await seedCurrentWorkspace('独立 World A')
  const b = await addCurrentWorldFixtureV1({ projectId: scope.projectId, name: '独立 World B' })
  const work = await addCurrentWorkFixtureV1({ projectId: scope.projectId, worldId: b.id!, create: { title: 'B 的作品', kind: 'novel', novelProfile: 'long' } })
  const scopeB = { projectId: scope.projectId, worldId: b.id!, workId: work.id! }
  await seed(scope, 'A 的来历'); await seed(scopeB, 'B 的来历')
  await useWorldGroupStore.getState().enableMultiWorld(scope)
  const groups = await db.worldGroups.toArray(), rows = await db.worldviews.toArray()
  expect(groups).toHaveLength(2)
  for (const row of rows) expect(groups.find(group => group.id === row.worldGroupId)?.worldId).toBe(row.worldId)
  expect((await db.projects.get(scope.projectId))?.activeWorkId).toBe(scope.workId)
})
