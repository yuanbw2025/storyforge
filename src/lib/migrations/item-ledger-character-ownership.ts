import type { Transaction } from 'dexie'

interface LegacyItemLedgerRow {
  id?: number
  projectId: number
  heldByName?: string
  characterId?: number | null
  [key: string]: unknown
}

interface LegacyCharacterRow {
  id?: number
  projectId: number
  name: string
  role?: string
  roleWeight?: string
  [key: string]: unknown
}

/** v37 → v38：itemLedger 加 heldByName + characterId，存量条目归给项目主角。 */
export async function migrateItemLedgerToCharacterOwnership(tx: Transaction): Promise<void> {
  const items = await tx.table('itemLedger').toArray() as LegacyItemLedgerRow[]
  const characters = await tx.table('characters').toArray() as LegacyCharacterRow[]

  const byProject = new Map<number, LegacyCharacterRow[]>()
  for (const c of characters) {
    const list = byProject.get(c.projectId) ?? []
    list.push(c)
    byProject.set(c.projectId, list)
  }

  for (const item of items) {
    if (item.heldByName != null) continue
    const chars = byProject.get(item.projectId) ?? []
    const protagonists = chars.filter(c => c.role === 'protagonist')
    if (protagonists.length === 1) {
      item.heldByName = protagonists[0].name
      item.characterId = protagonists[0].id ?? null
    } else {
      item.heldByName = '未知(历史数据)'
      item.characterId = null
    }
    await tx.table('itemLedger').update(item.id!, { heldByName: item.heldByName, characterId: item.characterId })
  }
}
