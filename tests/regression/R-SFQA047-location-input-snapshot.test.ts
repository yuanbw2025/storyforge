import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { useLocationStore } from '../../src/stores/location'
import type { ImportantLocation } from '../../src/lib/types'

const network = vi.fn(async () => { throw new Error('isolated location test: zero network') })

async function fixture() {
  const f = await createWorkspace({ name: '输入快照', description: '', genres: [], status: 'drafting', targetWordCount: 0 },
    { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const add = (name: string, parentId: number | null = null) => useLocationStore.getState().addLocation({
    projectId: f.scope.projectId, name, parentId, tags: '[]', description: '作者原文', significance: '', sortOrder: 0,
  })
  const a = await add('A'), b = await add('B', a), c = await add('C')
  const other = await createWorkspace({ name: '另一个世界', description: '', genres: [], status: 'drafting', targetWordCount: 0 },
    { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const foreign = await useLocationStore.getState().addLocation({ projectId: other.scope.projectId, name: 'Foreign',
    parentId: null, tags: '[]', description: '其他世界原文', significance: '', sortOrder: 0 })
  await useLocationStore.getState().loadAll(f.scope)
  return { a, b, c, foreign, ...f }
}

beforeEach(async () => {
  await db.delete(); await db.open()
  useLocationStore.setState({ locations: [], loading: false })
  network.mockClear(); vi.stubGlobal('fetch', network)
})
afterEach(async () => {
  expect(network).not.toHaveBeenCalled()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.delete()
})

describe('SFQA047 call-time input snapshot inside actual native parent validation', () => {
  for (const action of ['update', 'add'] as const) for (const lateAlias of [false, true]) {
    it(`${action}: ${lateAlias ? 'late caller mutation' : 'ordinary unchanged input'}`, async () => {
      const f = await fixture(), originalForeign = await db.importantLocations.get(f.foreign)
      const patch: Partial<ImportantLocation> = { parentId: f.c, name: '原调用标题' }
      const data = { projectId: f.scope.projectId, name: '原调用标题', parentId: f.c, tags: '[]',
        description: '作者原文', significance: '', sortOrder: 0 }
      const observations: Array<string | undefined> = []
      const original = db.importantLocations.get.bind(db.importantLocations)
      // Observe the original native promise without replacing its identity,
      // transaction, resolution order or returned row.
      const spy = vi.spyOn(db.importantLocations, 'get').mockImplementation(((key: number) => {
        const nativePromise = original(key)
        if (key === f.c) void nativePromise.then(() => {
          observations.push(Dexie.currentTransaction?.mode)
          if (lateAlias) {
            if (action === 'update') { patch.parentId = f.b; patch.name = '晚改标题'; patch.description = '晚改正文' }
            else { data.parentId = f.foreign; data.name = '晚改标题'; data.description = '晚改正文' }
          }
        })
        return nativePromise
      }) as typeof db.importantLocations.get)
      let id = f.a
      try {
        if (action === 'update') await useLocationStore.getState().updateLocation(f.a, patch)
        else id = await useLocationStore.getState().addLocation(data)
      } finally { spy.mockRestore() }
      expect(observations).toEqual(['readwrite'])
      expect(await db.importantLocations.get(id)).toMatchObject({ parentId: f.c, name: '原调用标题', description: '作者原文' })
      expect((await db.importantLocations.get(f.a))!.parentId === f.b && (await db.importantLocations.get(f.b))!.parentId === f.a).toBe(false)
      expect(await db.importantLocations.get(f.foreign)).toEqual(originalForeign)
    })
  }
})
