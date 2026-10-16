import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { readOwnedRows } from '../../src/lib/workspace/scope'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { useCreativeRulesStore } from '../../src/stores/project-singletons'

describe('LFQ3 · 创作规则保存作用域', () => {
  beforeEach(async () => {
    resetPendingEditCoordinatorForTestsV1()
    await db.delete()
    await db.open()
    useCreativeRulesStore.setState({ creativeRules: null, loading: false, activeWorldGroupId: null })
  })

  it('同一工作区切换作品后，显式旧 scope 的保存仍归旧 Work', async () => {
    const a = await createWorkspace({ name: '同壳 A', genres: [], status: 'drafting' }, { kind: 'novel', novelProfile: 'long' })
    await useCreativeRulesStore.getState().save({ projectId: a.scope.projectId, specialRequirements: 'A 初始' }, a.scope)
    const b = await createWorldWork(a.scope.projectId, { title: '同壳 B', kind: 'novel', novelProfile: 'long' })
    const bScope = await switchActiveWork(a.scope.projectId, b.id!)
    await useCreativeRulesStore.getState().loadAll(bScope)
    await useCreativeRulesStore.getState().save({ projectId: a.scope.projectId, specialRequirements: 'A 修改' }, a.scope)
    await useCreativeRulesStore.getState().save({ projectId: a.scope.projectId, specialRequirements: 'B 内容' }, bScope)
    expect((await readOwnedRows(a.scope, 'creativeRules', { owner: 'work' }))[0]).toMatchObject({ specialRequirements: 'A 修改', workId: a.scope.workId })
    expect((await readOwnedRows(bScope, 'creativeRules', { owner: 'work' }))[0]).toMatchObject({ specialRequirements: 'B 内容', workId: b.id })
  })

  it('外来 recordId 被拒绝，两个作品都不发生写入', async () => {
    const a = await createWorkspace({ name: '固定 A', genres: [], status: 'drafting' }, { kind: 'novel', novelProfile: 'long' })
    const b = await createWorkspace({ name: '固定 B', genres: [], status: 'drafting' }, { kind: 'novel', novelProfile: 'long' })
    await useCreativeRulesStore.getState().save({ projectId: a.scope.projectId, specialRequirements: '保留 A' }, a.scope)
    const before = (await readOwnedRows(a.scope, 'creativeRules', { owner: 'work' }))[0]
    await expect(useCreativeRulesStore.getState().save({ id: before.id, projectId: b.scope.projectId, specialRequirements: '越界' }, b.scope)).rejects.toThrow('不属于指定作用域')
    expect((await readOwnedRows(a.scope, 'creativeRules', { owner: 'work' }))[0]).toEqual(before)
    expect(await readOwnedRows(b.scope, 'creativeRules', { owner: 'work' })).toHaveLength(0)
  })

  it('缓存中有另一作品的单例时，保存目标作品不能迁移或覆盖该缓存记录', async () => {
    const a = await createWorkspace({ name: '规则 A', genres: [], status: 'drafting' }, { kind: 'novel', novelProfile: 'long' })
    const b = await createWorkspace({ name: '规则 B', genres: [], status: 'drafting' }, { kind: 'novel', novelProfile: 'long' })
    await useCreativeRulesStore.getState().save({ projectId: a.scope.projectId, specialRequirements: 'A 的限制' })
    await useCreativeRulesStore.getState().loadAll(a.scope)
    const before = (await readOwnedRows(a.scope, 'creativeRules', { owner: 'work' }))[0]

    await useCreativeRulesStore.getState().save({ projectId: b.scope.projectId, specialRequirements: 'B 的限制' })

    const afterA = await readOwnedRows(a.scope, 'creativeRules', { owner: 'work' })
    const afterB = await readOwnedRows(b.scope, 'creativeRules', { owner: 'work' })
    expect(afterA).toHaveLength(1)
    expect(afterA[0]).toEqual(before)
    expect(afterB).toHaveLength(1)
    expect(afterB[0]).toMatchObject({ projectId: b.scope.projectId, workId: b.scope.workId, specialRequirements: 'B 的限制' })
  })
})
