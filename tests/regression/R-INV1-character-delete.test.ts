/**
 * R-INV1 · 角色删除不级联删物品。
 * 守卫：通过 store 删角色 → itemLedger 的 characterId 变 null、heldByName 保留；
 * cascadeDeleteProject 仍正常清理 itemLedger。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { useCharacterStore } from '../../src/stores/character'

const now = Date.now()

async function seedProject() {
  const projectId = await db.projects.add({
    name: 'INV1-DELETE', genre: '', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
  const worldGroupId = await db.worldGroups.add({
    projectId, name: '主世界', type: 'primary', order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const charA = await db.characters.add({
    projectId, name: '林风', role: 'protagonist', roleWeight: 'main',
    moralAxis: 'good', orderAxis: 'lawful', shortDescription: '',
    homeWorldGroupId: worldGroupId, createdAt: now, updatedAt: now,
  } as any) as number
  const entryId = await db.itemLedger.add({
    projectId, itemName: '青铜铃', heldByName: '林风', characterId: charA,
    action: 'gain', quantity: 1, chapterId: null, createdAt: now,
  } as any) as number
  return { projectId, charA, entryId }
}

describe('INV-1 · 角色删除不级联删物品', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { db.close() })

  it('删角色后 itemLedger 仍存在，characterId=null，heldByName 保留', async () => {
    const { projectId, charA, entryId } = await seedProject()

    await useCharacterStore.getState().loadAll(projectId)
    await useCharacterStore.getState().deleteCharacter(charA)

    const entry = await db.itemLedger.get(entryId)
    expect(entry).toBeDefined()
    expect(entry!.itemName).toBe('青铜铃')
    expect(entry!.characterId).toBeNull()
    expect(entry!.heldByName).toBe('林风')
  })

  it('cascadeDeleteProject 仍正常清理 itemLedger', async () => {
    const { projectId, entryId } = await seedProject()

    await cascadeDeleteProject(projectId)

    const entry = await db.itemLedger.get(entryId)
    expect(entry).toBeUndefined()
  })
})
