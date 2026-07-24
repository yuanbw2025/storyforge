/**
 * R-QUICKWIN2 · 物品栏流水可编辑。
 * 守卫：InventoryPanel 暴露的编辑入口依赖 useItemLedgerStore.updateEntry；
 * 这里锁定 itemName/quantity/note/action 修改必须同步内存 store 与 IndexedDB。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useItemLedgerStore } from '../../src/stores/item-ledger'

const now = Date.now()

describe('QUICKWIN-2 · 物品栏编辑保存', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useItemLedgerStore.setState({ entries: [], loading: false })
  })

  afterEach(() => {
    db.close()
  })

  it('updateEntry 能修改物品名、数量、动作和备注，并持久化到 Dexie', async () => {
    const projectId = await db.projects.add({
      name: 'QUICKWIN2',
      genre: '',
      description: '',
      targetWordCount: 0,
      enableMultiWorld: false,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const store = useItemLedgerStore.getState()
    const entryId = await store.addEntry({
      projectId,
      itemName: '旧剑',
      heldByName: '主角',
      characterId: null,
      action: 'gain',
      quantity: 1,
      chapterId: null,
      chapterTitle: '',
      note: 'AI 识别结果',
    })

    await useItemLedgerStore.getState().updateEntry(entryId, {
      itemName: '青铜剑',
      action: 'consume',
      quantity: 2,
      note: '用户修正',
    })

    const inStore = useItemLedgerStore.getState().entries.find(entry => entry.id === entryId)
    expect(inStore).toMatchObject({
      itemName: '青铜剑',
      action: 'consume',
      quantity: 2,
      note: '用户修正',
    })

    const persisted = await db.itemLedger.get(entryId)
    expect(persisted).toMatchObject({
      itemName: '青铜剑',
      action: 'consume',
      quantity: 2,
      note: '用户修正',
    })
  })
})
