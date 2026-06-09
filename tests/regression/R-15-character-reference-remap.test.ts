/**
 * R-15: character delete/merge must clean JSON-array references.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCharacterStore } from '../../src/stores/character'
import { applyCharacterReferenceRemap } from '../../src/lib/registry/character-references'
import { parseFields, stringifyFields } from '../../src/lib/types/state-card'

describe('R-15: character reference remap', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
  })

  it('removes deleted character ids from detailed outline arrays and scene JSON', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'R-15-delete', genre: '', description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const deletedId = await db.characters.add(character(projectId, '旧角色', now)) as number
    const keptId = await db.characters.add(character(projectId, '保留角色', now)) as number
    await db.characterRelations.add({
      projectId, fromCharacterId: deletedId, toCharacterId: keptId,
      type: 'ally', description: '', createdAt: now, updatedAt: now,
    } as any)
    const outlineId = await db.detailedOutlines.add({
      projectId, outlineNodeId: 1,
      appearingCharacterIds: [deletedId, keptId],
      scenes: [scene([deletedId, keptId])],
      createdAt: now, updatedAt: now,
    } as any) as number
    await db.stateCards.add({
      projectId, category: 'character', entityName: '旧角色',
      fields: stringifyFields([{ key: '位置', value: '旧城' }]),
      createdAt: now, updatedAt: now,
    } as any)

    await useCharacterStore.getState().loadAll(projectId)
    await useCharacterStore.getState().deleteCharacter(deletedId)

    const outline = await db.detailedOutlines.get(outlineId)
    expect(outline?.appearingCharacterIds).toEqual([keptId])
    expect(outline?.scenes[0].characterIds).toEqual([keptId])
    expect(await db.characterRelations.count()).toBe(0)
    expect(await db.stateCards.where('projectId').equals(projectId).count()).toBe(0)
    expect(await db.characters.get(deletedId)).toBeUndefined()
  })

  it('remaps merged character ids to the primary character and merges state cards by name', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'R-15-merge', genre: '', description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const primaryId = await db.characters.add(character(projectId, '主角色', now)) as number
    const aliasId = await db.characters.add(character(projectId, '别名角色', now)) as number
    await db.characterRelations.add({
      projectId, fromCharacterId: primaryId, toCharacterId: aliasId,
      type: 'ally', description: '', createdAt: now, updatedAt: now,
    } as any)
    const outlineId = await db.detailedOutlines.add({
      projectId, outlineNodeId: 1,
      appearingCharacterIds: [aliasId],
      scenes: [scene([primaryId, aliasId])],
      createdAt: now, updatedAt: now,
    } as any) as number
    await db.stateCards.bulkAdd([
      {
        projectId, category: 'character', entityName: '主角色',
        fields: stringifyFields([{ key: '位置', value: '主城' }]),
        createdAt: now, updatedAt: now,
      },
      {
        projectId, category: 'character', entityName: '别名角色',
        fields: stringifyFields([{ key: '伤势', value: '轻伤' }]),
        createdAt: now, updatedAt: now,
      },
    ] as any[])

    await db.transaction('rw', db.characters, db.characterRelations, db.detailedOutlines, db.stateCards, async () => {
      await applyCharacterReferenceRemap({
        projectId,
        fromCharacterId: aliasId,
        fromName: '别名角色',
        toCharacterId: primaryId,
        toName: '主角色',
      })
      await db.characters.delete(aliasId)
    })

    const outline = await db.detailedOutlines.get(outlineId)
    expect(outline?.appearingCharacterIds).toEqual([primaryId])
    expect(outline?.scenes[0].characterIds).toEqual([primaryId])
    expect(await db.characterRelations.count()).toBe(0)
    const cards = await db.stateCards.where('projectId').equals(projectId).toArray()
    expect(cards).toHaveLength(1)
    expect(cards[0].entityName).toBe('主角色')
    expect(parseFields(cards[0].fields).map(f => f.key).sort()).toEqual(['伤势', '位置'])
  })
})

function character(projectId: number, name: string, now: number) {
  return {
    projectId, name, role: 'supporting',
    shortDescription: '', appearance: '', personality: '', background: '',
    motivation: '', abilities: '', relationships: '', arc: '',
    createdAt: now, updatedAt: now,
  }
}

function scene(characterIds: number[]) {
  return {
    sceneId: crypto.randomUUID(),
    title: 'scene',
    summary: '',
    characterIds,
    location: '',
    conflict: '',
    pace: 'medium',
    estimatedWords: 100,
    notes: '',
  }
}
