import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace, addCurrentWorldFixtureV1, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { useWorldGroupStore } from '../../src/stores/world-group'
import type { WorldGroup } from '../../src/lib/types'

beforeEach(async () => {
  await db.delete(); await db.open()
  useWorldGroupStore.setState({ groups: [], links: [], activeGroupId: null, loadedScope: null, loading: false })
})
afterEach(() => vi.restoreAllMocks())
async function fixture() {
  const { scope } = await seedCurrentWorkspace('世界作者编辑')
  await useWorldGroupStore.getState().loadAll(scope)
  const id = await useWorldGroupStore.getState().createGroup({ projectId: scope.projectId, name: '旧界', description: '旧描述', type: 'traversal', order: 0 }, scope)
  return { scope, id, group: (await db.worldGroups.get(id))! }
}

it('acknowledges exact author fields, explicit clearing and unchanged owner', async () => {
  const { scope, id, group } = await fixture()
  const saved = await useWorldGroupStore.getState().updateGroup(id, { name: '新界', description: '', entryCondition: '', plannedChapterCount: 0 }, { scope, expected: group })
  expect(saved.worldId).toBe(scope.worldId); expect(saved.projectId).toBe(scope.projectId)
  expect(saved.name).toBe('新界'); expect(saved.description).toBe(''); expect(saved.plannedChapterCount).toBe(0)
  expect(await db.worldGroups.get(id)).toEqual(saved)
  expect(useWorldGroupStore.getState().groups[0]).toEqual(saved)
})
it('rejects a stale author snapshot even when a second writer kept the same timestamp', async () => {
  const { scope, id, group } = await fixture()
  await db.worldGroups.update(id, { description: '另一个页面保存的描述', updatedAt: group.updatedAt })
  await expect(useWorldGroupStore.getState().updateGroup(id, { name: '过时草稿' }, { scope, expected: group })).rejects.toThrow('其他页面修改')
  expect((await db.worldGroups.get(id))?.description).toBe('另一个页面保存的描述')
  expect((await db.worldGroups.get(id))?.name).toBe('旧界')
})
it('rejects a World B group through a frozen World A scope', async () => {
  const { scope } = await fixture()
  const world = await addCurrentWorldFixtureV1({ projectId: scope.projectId, name: 'B' })
  const work = await addCurrentWorkFixtureV1({ projectId: scope.projectId, worldId: world.id!, create: { title: 'B 作品', kind: 'novel', novelProfile: 'long' } })
  const other = { projectId: scope.projectId, worldId: world.id!, workId: work.id! }
  const id = await useWorldGroupStore.getState().createGroup({ projectId: scope.projectId, name: 'B 界', description: '', type: 'parallel', order: 0 }, other)
  await expect(useWorldGroupStore.getState().updateGroup(id, { name: '不能写入 B' }, { scope })).rejects.toThrow('作用域')
  expect((await db.worldGroups.get(id))?.name).toBe('B 界')
  expect(useWorldGroupStore.getState().groups.some(group => group.id === id)).toBe(false)
})
it('never promotes a side world or demotes the primary world', async () => {
  const { scope, id } = await fixture()
  await expect(useWorldGroupStore.getState().updateGroup(id, { type: 'primary' }, { scope })).rejects.toThrow('主世界')
  const primary = await useWorldGroupStore.getState().ensurePrimaryGroup(scope)
  await expect(useWorldGroupStore.getState().updateGroup(primary, { type: 'custom' }, { scope })).rejects.toThrow('主世界')
  expect((await db.worldGroups.get(primary))?.type).toBe('primary')
})
it('rejects ownership and inherited enum keys without changing the row', async () => {
  const { scope, id, group } = await fixture()
  for (const patch of [{ worldId: 900 }, { projectId: 900 }, { type: '__proto__' }, { type: 'constructor' }]) {
    await expect(useWorldGroupStore.getState().updateGroup(id, patch as unknown as Partial<WorldGroup>, { scope })).rejects.toThrow()
    expect(await db.worldGroups.get(id)).toEqual(group)
  }
})
it('a deleted group fails visibly and is never recreated by saving its draft', async () => {
  const { scope, id, group } = await fixture()
  await db.worldGroups.delete(id)
  await expect(useWorldGroupStore.getState().updateGroup(id, { name: '待保存草稿' }, { scope, expected: group })).rejects.toThrow('删除')
  expect(await db.worldGroups.count()).toBe(0)
})
it('a failed group read releases loading without falsely changing its scope', async () => {
  const { scope, group } = await fixture()
  vi.spyOn(db.worldGroups, 'where').mockImplementationOnce(() => { throw new Error('group read failed') })
  await expect(useWorldGroupStore.getState().loadAll(scope)).rejects.toThrow('group read failed')
  expect(useWorldGroupStore.getState().loading).toBe(false)
  expect(useWorldGroupStore.getState().groups).toEqual([group])
})
