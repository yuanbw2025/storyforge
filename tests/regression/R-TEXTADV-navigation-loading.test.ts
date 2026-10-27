import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import * as previews from '../../src/lib/adventure/player-previews'
import * as runtime from '../../src/lib/adventure/runtime-api'
import * as instances from '../../src/lib/product/runtime-instances'
import { EMPTY_PRODUCT_RUNTIME_STATE } from '../../src/lib/types'
import { useAdventureGamePlayerStore } from '../../src/stores/adventure-game-player'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

describe('文字冒险导航加载顺序', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('切换工作区后，迟到的作品库不能覆盖新工作区', async () => {
    const first = await seedCurrentProductWorld('先进入的工作区')
    const second = await seedCurrentProductWorld('后进入的工作区')
    let resolveOld!: (value: previews.AdventurePreviewItem[]) => void
    const pending = new Promise<previews.AdventurePreviewItem[]>(resolve => { resolveOld = resolve })
    vi.spyOn(previews, 'readAdventurePlayerPreviews').mockImplementation(scope => (
      scope.workId === first.scope.workId ? pending : Promise.resolve([])
    ))
    const oldLoad = useAdventureGamePlayerStore.getState().load(first.scope, null, true)
    await useAdventureGamePlayerStore.getState().load(second.scope, null, true)
    resolveOld([{
      productionId: 1, buildId: 1, buildNumber: 1, previewHash: 'old',
      title: '旧工作区作品', updatedAt: 1, manifest: null, error: '旧结果',
    }])
    await oldLoad
    expect(useAdventureGamePlayerStore.getState().scope).toEqual(second.scope)
    expect(useAdventureGamePlayerStore.getState().previews).toEqual([])
  })

  it('迟到的失败不能覆盖新页面的成功状态', async () => {
    const first = await seedCurrentProductWorld('旧页面')
    const second = await seedCurrentProductWorld('新页面')
    let rejectOld!: (reason: Error) => void
    const pending = new Promise<previews.AdventurePreviewItem[]>((_, reject) => { rejectOld = reject })
    vi.spyOn(previews, 'readAdventurePlayerPreviews').mockImplementation(scope => (
      scope.workId === first.scope.workId ? pending : Promise.resolve([])
    ))
    const oldLoad = useAdventureGamePlayerStore.getState().load(first.scope, null, true)
    await useAdventureGamePlayerStore.getState().load(second.scope, null, true)
    rejectOld(new Error('旧页面加载失败'))
    await oldLoad
    expect(useAdventureGamePlayerStore.getState().error).toBe('')
    expect(useAdventureGamePlayerStore.getState().loading).toBe(false)
  })

  it('离开播放器会阻止未完成的作品库加载重新填充界面', async () => {
    const owned = await seedCurrentProductWorld('已离开的页面')
    let resolve!: (value: previews.AdventurePreviewItem[]) => void
    vi.spyOn(previews, 'readAdventurePlayerPreviews').mockReturnValue(new Promise(done => { resolve = done }))
    const loading = useAdventureGamePlayerStore.getState().load(owned.scope, null, true)
    useAdventureGamePlayerStore.getState().cancelPendingLoad()
    resolve([{ productionId: 1, buildId: 1, buildNumber: 1, previewHash: 'old', title: '过期作品', updatedAt: 1, manifest: null, error: '' }])
    await loading
    expect(useAdventureGamePlayerStore.getState().previews).toEqual([])
    expect(useAdventureGamePlayerStore.getState().loading).toBe(false)
  })

  it('作品库逐份核验存档，不同时重放全部存档造成内存峰值', async () => {
    const owned = await seedCurrentProductWorld('多存档工作区')
    vi.spyOn(instances, 'readBoundInstances').mockResolvedValue([1, 2, 3].map(id => ({
      id, kind: 'text-adventure', worldGroupId: null, updatedAt: id,
    })) as Awaited<ReturnType<typeof instances.readBoundInstances>>)
    let concurrent = 0
    let maximum = 0
    const read = vi.spyOn(runtime, 'readProductRuntimeState').mockImplementation(async () => {
      concurrent += 1
      maximum = Math.max(maximum, concurrent)
      await new Promise(resolve => setTimeout(resolve, 1))
      concurrent -= 1
      return structuredClone(EMPTY_PRODUCT_RUNTIME_STATE)
    })
    await useAdventureGamePlayerStore.getState().load(owned.scope, null, true)
    expect(read).toHaveBeenCalledTimes(3)
    expect(maximum).toBe(1)
    expect(useAdventureGamePlayerStore.getState().sessions).toHaveLength(3)
  })
})
