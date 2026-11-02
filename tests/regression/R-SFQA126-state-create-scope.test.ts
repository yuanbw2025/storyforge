import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import * as scopeApi from '../../src/lib/workspace/scope'
import type { WorkspaceScope } from '../../src/lib/types'
import { isPortableResourceUidV1 } from '../../src/lib/context-gateway/resource-uid'
import { stringifyFields } from '../../src/lib/types/state-card'
import { useStateCardStore } from '../../src/stores/state-card'

beforeEach(async () => { await db.delete(); await db.open(); useStateCardStore.setState({ cards: [], loading: false, loadedScope: null }) })
afterEach(() => { vi.restoreAllMocks(); db.close() })

async function workspace(name = '状态归属') {
  return createWorkspace({ name, description: '', genres: [], status: 'drafting', targetWordCount: 100_000 },
    { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
}
const fields = stringifyFields([{ key: '状态', value: '原作品的作者输入 e\u0301 😀' }])
function input(projectId: number) { return { projectId, category: 'character' as const, entityName: '林照', fields } }

it('resolves a frozen full scope once, even when the actual active Work switches before stamping', async () => {
  const { scope } = await workspace()
  const next = await createWorldWork(scope.projectId, { title: '其他作品', kind: 'novel', novelProfile: 'long' })
  const originalResolve = scopeApi.resolveScopeLike
  let actualSwitches = 0
  const resolutions: WorkspaceScope[] = []
  const resolver = vi.spyOn(scopeApi, 'resolveScopeLike').mockImplementation(async value => {
    const resolved = await originalResolve(value)
    resolutions.push(resolved)
    await switchActiveWork(scope.projectId, next.id!); actualSwitches++
    return resolved
  })
  const id = await useStateCardStore.getState().addCard(input(scope.projectId), { scope })
  expect(resolver).toHaveBeenCalledTimes(1)
  expect(resolver).toHaveBeenCalledWith(scope)
  expect(resolutions).toEqual([scope]); expect(actualSwitches).toBe(1)
  const row = (await db.stateCards.get(id))!
  expect(row.fields).toBe(fields)
  expect(await scopeApi.assertRecordInScope(scope, 'stateCards', row, { owner: 'work' })).toBe(true)
  expect(await scopeApi.assertRecordInScope({ ...scope, workId: next.id! }, 'stateCards', row, { owner: 'work' })).toBe(false)
  const identity = scopeApi.getTableSpec('stateCards').resourceIdentity!
  expect(isPortableResourceUidV1(Reflect.get(row, identity.field), identity.resourceKind)).toBe(true)
  expect(useStateCardStore.getState().cards).toEqual([])
  expect(useStateCardStore.getState().loadedScope).toBeNull()
})

it('keeps legacy calls without options on the actual current Work', async () => {
  const { scope } = await workspace()
  const next = await createWorldWork(scope.projectId, { title: '旧调用的当前作品', kind: 'novel', novelProfile: 'long' })
  const current = await switchActiveWork(scope.projectId, next.id!)
  const id = await useStateCardStore.getState().addCard(input(scope.projectId))
  expect(await scopeApi.assertRecordInScope(current, 'stateCards', await db.stateCards.get(id), { owner: 'work' })).toBe(true)
  expect((await db.stateCards.get(id))?.fields).toBe(fields)
  expect(useStateCardStore.getState().cards.map(row => row.id)).toEqual([id])
})

it('does not append a frozen Work card into a different Work list that has actually loaded', async () => {
  const { scope } = await workspace()
  const next = await createWorldWork(scope.projectId, { title: '当前展示的作品', kind: 'novel', novelProfile: 'long' })
  const current = await switchActiveWork(scope.projectId, next.id!)
  const visible = await useStateCardStore.getState().addCard({ ...input(scope.projectId), entityName: '当前作品卡片' })
  await useStateCardStore.getState().loadAll(current)
  const before = useStateCardStore.getState().cards
  expect(before.map(row => row.id)).toEqual([visible])
  const saved = await useStateCardStore.getState().addCard(input(scope.projectId), { scope })
  expect(await scopeApi.assertRecordInScope(scope, 'stateCards', await db.stateCards.get(saved), { owner: 'work' })).toBe(true)
  expect(useStateCardStore.getState().cards).toEqual(before)
})

it.each(['sibling Work', 'foreign Project'])('protects a truly empty loaded list belonging to %s', async kind => {
  const { scope } = await workspace()
  const current = kind === 'foreign Project' ? (await workspace('另一个可见工作区')).scope
    : await switchActiveWork(scope.projectId, (await createWorldWork(scope.projectId, { title: '空白作品', kind: 'novel', novelProfile: 'long' })).id!)
  await useStateCardStore.getState().loadAll(current)
  expect(useStateCardStore.getState().cards).toEqual([])
  const id = await useStateCardStore.getState().addCard(input(scope.projectId), { scope })
  expect(await scopeApi.assertRecordInScope(scope, 'stateCards', await db.stateCards.get(id), { owner: 'work' })).toBe(true)
  expect(useStateCardStore.getState().cards).toEqual([])
  expect(useStateCardStore.getState().loadedScope).toEqual(current)
})

it('publishes a new card into its matching, actually loaded view', async () => {
  const { scope } = await workspace()
  await useStateCardStore.getState().loadAll(scope)
  const id = await useStateCardStore.getState().addCard(input(scope.projectId), { scope })
  expect(useStateCardStore.getState().cards).toEqual([await db.stateCards.get(id)])
  expect(useStateCardStore.getState().loadedScope).toEqual(scope)
})

it('labels the actual list published by applyDiffs before a later frozen-owner write', async () => {
  const { scope } = await workspace()
  const next = await createWorldWork(scope.projectId, { title: '差异操作的作品', kind: 'novel', novelProfile: 'long' })
  const current = { ...scope, workId: next.id! }
  const visible = await useStateCardStore.getState().addCard({ ...input(scope.projectId), entityName: '差异操作的原卡' }, { scope: current })
  await useStateCardStore.getState().loadAll(current)
  await useStateCardStore.getState().applyDiffs(current, [])
  expect(useStateCardStore.getState().loadedScope).toEqual(current)
  expect(useStateCardStore.getState().cards.map(row => row.id)).toEqual([visible])
  await useStateCardStore.getState().addCard(input(scope.projectId), { scope })
  expect(useStateCardStore.getState().cards.map(row => row.id)).toEqual([visible])
})

it('rejects a valid full scope from a different Project without writing either owner', async () => {
  const first = await workspace(), foreign = await workspace('外来工作区')
  const before = await db.projects.toArray()
  await expect(useStateCardStore.getState().addCard(input(first.scope.projectId), { scope: foreign.scope })).rejects.toThrow('同一工作区')
  expect(await db.stateCards.count()).toBe(0)
  expect(useStateCardStore.getState().cards).toEqual([])
  expect(await db.projects.toArray()).toEqual(before)
})

it('rejects a cross-Project Work tuple instead of using the active Work as fallback', async () => {
  const first = await workspace(), foreign = await workspace('其他作品的工作区')
  await expect(useStateCardStore.getState().addCard(input(first.scope.projectId), {
    scope: { ...first.scope, workId: foreign.scope.workId },
  })).rejects.toThrow('不是当前工作区的有效')
  expect(await db.stateCards.count()).toBe(0)
})

it('rejects an incomplete explicit scope instead of silently resolving current pointers', async () => {
  const { scope } = await workspace()
  await expect(useStateCardStore.getState().addCard(input(scope.projectId), {
    scope: { projectId: scope.projectId, worldId: scope.worldId } as WorkspaceScope,
  })).rejects.toThrow('有效的 projectId/worldId/workId')
  expect(await db.stateCards.count()).toBe(0)
})

it('does not recreate a removed frozen Work or write into its active sibling', async () => {
  const { scope } = await workspace()
  const next = await createWorldWork(scope.projectId, { title: '仍有效的作品', kind: 'novel', novelProfile: 'long' })
  await switchActiveWork(scope.projectId, next.id!)
  await db.works.delete(scope.workId)
  await expect(useStateCardStore.getState().addCard(input(scope.projectId), { scope })).rejects.toThrow('不是当前工作区的有效')
  expect(await db.stateCards.count()).toBe(0)
  expect(await db.works.get(scope.workId)).toBeUndefined()
})

it('legacy add during a real pending owner load never appends into the previous display cache', async () => {
  const { scope } = await workspace()
  const next = await createWorldWork(scope.projectId, { title: '正在读取的作品B', kind: 'novel', novelProfile: 'long' })
  const current = await switchActiveWork(scope.projectId, next.id!)
  const store = useStateCardStore.getState()
  const aId = await store.addCard(input(scope.projectId), { scope })
  const bId = await store.addCard({ ...input(scope.projectId), entityName: 'B已有卡片' }, { scope: current })
  await store.loadAll(scope)
  const beforeA = structuredClone(useStateCardStore.getState().cards)
  expect(beforeA.map(card => card.id)).toEqual([aId])
  const originalA = await db.stateCards.get(aId)
  let release!: () => void, ready!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const reached = new Promise<void>(resolve => { ready = resolve })
  const originalRead = scopeApi.readOwnedRows
  let waiting = false
  vi.spyOn(scopeApi, 'readOwnedRows').mockImplementation(async <T>(...args: Parameters<typeof originalRead>) => {
    const rows = await originalRead<T>(...args)
    if (!waiting && args[1] === 'stateCards' && args[0].projectId === current.projectId
      && args[0].worldId === current.worldId && 'workId' in args[0] && args[0].workId === current.workId) {
      waiting = true; ready(); await held
    }
    return rows
  })
  const loadingB = store.loadAll(current)
  let addedId = 0
  try {
    await reached
    expect(useStateCardStore.getState().loading).toBe(true)
    expect(useStateCardStore.getState().loadedScope).toBeNull()
    addedId = await store.addCard({ ...input(scope.projectId), entityName: 'B加载期间新增的卡片' })
    const saved = await db.stateCards.get(addedId)
    expect(saved?.fields).toBe(fields)
    expect(await scopeApi.assertRecordInScope(current, 'stateCards', saved, { owner: 'work' })).toBe(true)
    expect(await db.stateCards.get(aId)).toEqual(originalA)
    expect(useStateCardStore.getState().cards).toEqual(beforeA)
    expect(useStateCardStore.getState().loading).toBe(true)
    expect(useStateCardStore.getState().loadedScope).toBeNull()
  } finally { release(); await loadingB }
  await store.loadAll(current)
  expect(useStateCardStore.getState().loadedScope).toEqual(current)
  expect(useStateCardStore.getState().loading).toBe(false)
  expect(useStateCardStore.getState().cards.map(card => card.id).sort()).toEqual([bId, addedId].sort())
  expect(await db.stateCards.get(aId)).toEqual(originalA)
})

it('legacy add after a real owner read failure does not mix the new owner into the retained display cache', async () => {
  const { scope } = await workspace()
  const next = await createWorldWork(scope.projectId, { title: '读取失败的作品B', kind: 'novel', novelProfile: 'long' })
  const current = await switchActiveWork(scope.projectId, next.id!)
  const store = useStateCardStore.getState()
  const aId = await store.addCard(input(scope.projectId), { scope })
  const bId = await store.addCard({ ...input(scope.projectId), entityName: 'B原有卡片' }, { scope: current })
  await store.loadAll(scope)
  const beforeA = structuredClone(useStateCardStore.getState().cards)
  expect(beforeA.map(card => card.id)).toEqual([aId])
  const originalA = await db.stateCards.get(aId)
  const readFailure = new Error('B真实读取完成后的受控读取失败')
  const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
  const originalRead = scopeApi.readOwnedRows
  let injected = false
  vi.spyOn(scopeApi, 'readOwnedRows').mockImplementation(async <T>(...args: Parameters<typeof originalRead>) => {
    const rows = await originalRead<T>(...args)
    if (!injected && args[1] === 'stateCards' && args[0].projectId === current.projectId
      && args[0].worldId === current.worldId && 'workId' in args[0] && args[0].workId === current.workId) {
      injected = true; throw readFailure
    }
    return rows
  })
  await store.loadAll(current)
  expect(injected).toBe(true)
  expect(reported).toHaveBeenCalledWith('[StateCard] loadAll 失败:', readFailure)
  expect(useStateCardStore.getState().loading).toBe(false)
  expect(useStateCardStore.getState().loadedScope).toBeNull()
  const addedId = await store.addCard({ ...input(scope.projectId), entityName: 'B读取失败后新增的卡片' })
  const saved = await db.stateCards.get(addedId)
  expect(saved?.fields).toBe(fields)
  expect(await scopeApi.assertRecordInScope(current, 'stateCards', saved, { owner: 'work' })).toBe(true)
  expect(await db.stateCards.get(aId)).toEqual(originalA)
  expect(useStateCardStore.getState().cards).toEqual(beforeA)
  await store.loadAll(current)
  expect(useStateCardStore.getState().loadedScope).toEqual(current)
  expect(useStateCardStore.getState().cards.map(card => card.id).sort()).toEqual([bId, addedId].sort())
  expect(await db.stateCards.get(aId)).toEqual(originalA)
})

it('keeps consecutive legacy creations visible for their actual owner before any view is loaded', async () => {
  const { scope } = await workspace()
  const store = useStateCardStore.getState()
  const first = await store.addCard(input(scope.projectId))
  const second = await store.addCard({ ...input(scope.projectId), entityName: '同作品第二张卡片' })
  expect(useStateCardStore.getState().cards.map(card => card.id)).toEqual([first, second])
  for (const id of [first, second]) expect(await scopeApi.assertRecordInScope(scope, 'stateCards', await db.stateCards.get(id), { owner: 'work' })).toBe(true)
})

it('labels the first legacy cache owner so a later active Work switch cannot mix its next creation into that list', async () => {
  const { scope } = await workspace()
  const next = await createWorldWork(scope.projectId, { title: '随后活动的作品B', kind: 'novel', novelProfile: 'long' })
  const store = useStateCardStore.getState()
  const first = await store.addCard(input(scope.projectId))
  const beforeA = structuredClone(useStateCardStore.getState().cards)
  expect(beforeA.map(card => card.id)).toEqual([first])
  expect(useStateCardStore.getState().loadedScope).toEqual(scope)
  const current = await switchActiveWork(scope.projectId, next.id!)
  const second = await store.addCard({ ...input(scope.projectId), entityName: 'B后来的卡片' })
  expect(await scopeApi.assertRecordInScope(current, 'stateCards', await db.stateCards.get(second), { owner: 'work' })).toBe(true)
  expect(useStateCardStore.getState().cards).toEqual(beforeA)
  expect(useStateCardStore.getState().loadedScope).toEqual(scope)
})
