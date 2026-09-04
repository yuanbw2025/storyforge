import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { parseEntryRefs } from '../../src/lib/types/codex'
import { useCodexStore } from '../../src/stores/codex'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

describe('WORLD-1 · Codex 引用生命周期', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
  })

  it('删除词条时原子移除其它词条中的引用', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({
      name: 'refs', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const categoryId = await db.codexCategories.add({
      projectId, domain: 'natural', parentId: null, name: '材料', fieldSchema: '[]',
      order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const targetId = await db.codexEntries.add({
      projectId, categoryId, name: '玄铁', summary: '', description: '', fields: '{}',
      refs: '{}', order: 0, worldGroupId: null, createdAt: now, updatedAt: now,
    } as any) as number
    const ownerId = await db.codexEntries.add({
      projectId, categoryId, name: '玄铁剑', summary: '', description: '', fields: '{}',
      refs: JSON.stringify({ material: [targetId], related: [targetId] }),
      order: 1, worldGroupId: null, createdAt: now, updatedAt: now,
    } as any) as number
    const characterId = await db.characters.add({
      projectId, name: '林舟', roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful',
      homeWorldGroupId: null, isCrossWorld: false, raceEntryId: targetId,
      createdAt: now, updatedAt: now,
    } as any) as number
    await finalizeCurrentFixtureV1(projectId)

    await useCodexStore.getState().loadExisting(projectId)
    await useCodexStore.getState().deleteEntry(targetId)

    expect(await db.codexEntries.get(targetId)).toBeUndefined()
    expect(parseEntryRefs((await db.codexEntries.get(ownerId))?.refs)).toEqual({
      material: [],
      related: [],
    })
    expect((await db.characters.get(characterId))?.raceEntryId ?? null).toBeNull()
  })
})
