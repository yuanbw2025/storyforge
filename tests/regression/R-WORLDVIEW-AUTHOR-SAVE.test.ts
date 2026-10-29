import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { useWorldviewStore } from '../../src/stores/worldview'
import { coordinatePendingEditV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import type { Worldview } from '../../src/lib/types'

beforeEach(async () => {
  await db.delete(); await db.open()
  useWorldviewStore.setState({ worldview: null, storyCore: null, powerSystem: null, loadedProjectId: null, activeWorldGroupId: null })
  resetPendingEditCoordinatorForTestsV1()
})
afterEach(() => resetPendingEditCoordinatorForTestsV1())

describe.each(['worldview', 'story-core'] as const)('manual %s persistence', kind => {
  const field = kind === 'worldview' ? 'worldOrigin' : 'theme'
  const save = (projectId: number, patch: Record<string, unknown>) => kind === 'worldview'
    ? useWorldviewStore.getState().saveWorldview({ projectId, ...patch })
    : useWorldviewStore.getState().saveStoryCore({ projectId, ...patch })
  const read = () => kind === 'worldview' ? useWorldviewStore.getState().worldview : useWorldviewStore.getState().storyCore
  it('rejects a refused adoption instead of reporting a successful save', async () => {
    const { scope } = await seedCurrentWorkspace()
    await useWorldviewStore.getState().loadAll(scope)
    await expect(save(scope.projectId, { unknownAuthorField: 'must not persist' })).rejects.toThrow()
    expect(read()).toBeNull()
  })
  it('persists explicit clearing and keeps it empty after reloading', async () => {
    const { scope } = await seedCurrentWorkspace()
    await useWorldviewStore.getState().loadAll(scope)
    await save(scope.projectId, { [field]: '原文' })
    await save(scope.projectId, { [field]: '' })
    await useWorldviewStore.getState().loadAll(scope)
    expect((read() as unknown as Record<string, unknown>)?.[field]).toBe('')
  })
  it('does not replace the selected workspace cache when an old queued save finishes', async () => {
    const a = await seedCurrentWorkspace('A'), b = await seedCurrentWorkspace('B')
    await useWorldviewStore.getState().loadAll(a.scope)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const blocked = coordinatePendingEditV1({ key: `${kind === 'worldview' ? 'worldview' : 'story-core'}:${a.scope.projectId}${kind === 'worldview' ? ':default' : ''}`, persist: () => gate })
    const saving = save(a.scope.projectId, { [field]: '只属于A的设定' })
    try { await useWorldviewStore.getState().loadAll(b.scope) } finally { release() }
    await Promise.all([blocked, saving])
    expect(useWorldviewStore.getState().loadedProjectId).toBe(b.scope.projectId)
    expect(read()).toBeNull()
    await useWorldviewStore.getState().loadAll(a.scope)
    expect((read() as unknown as Record<string, unknown>)?.[field]).toBe('只属于A的设定')
  })
})

it('keeps independent natural-resource and divinity leaf edits when queued together', async () => {
  const { scope } = await seedCurrentWorkspace()
  await useWorldviewStore.getState().loadAll(scope)
  const save = (patch: Record<string, unknown>) => useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, ...patch } as Partial<Worldview>)
  await save({ naturalResources: { rareCreatures: '鹤', herbs: '旧草', minerals: '旧矿', others: '茶' }, divineDesign: { hasDivinity: true, divineRank: '旧阶', divineNames: '旧神', divineRules: '旧律' } })
  await Promise.all([
    save({ naturalResources: { herbs: '新草' } }), save({ naturalResources: { minerals: '新矿' } }),
    save({ divineDesign: { divineNames: '新神' } }), save({ divineDesign: { divineRules: '新律' } }),
  ])
  await useWorldviewStore.getState().loadAll(scope)
  expect(useWorldviewStore.getState().worldview?.naturalResources).toEqual({ rareCreatures: '鹤', herbs: '新草', minerals: '新矿', others: '茶' })
  expect(useWorldviewStore.getState().worldview?.divineDesign).toEqual({ hasDivinity: true, divineRank: '旧阶', divineNames: '新神', divineRules: '新律' })
})
