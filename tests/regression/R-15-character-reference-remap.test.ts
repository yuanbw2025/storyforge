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
    const sourceOutlineId = await db.outlineNodes.add({
      projectId, parentId: null, type: 'chapter', title: '引用章节', summary: '',
      order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const outlineId = await db.detailedOutlines.add({
      projectId, outlineNodeId: sourceOutlineId,
      appearingCharacterIds: [deletedId, keptId],
      scenes: [scene([deletedId, keptId])],
      createdAt: now, updatedAt: now,
    } as any) as number
    await db.stateCards.add({
      projectId, category: 'character', entityName: '旧角色',
      fields: stringifyFields([{ key: '位置', value: '旧城' }]),
      createdAt: now, updatedAt: now,
    } as any)
    const factId = await db.temporalFacts.add({
      projectId, characterId: deletedId, sourceCharacterId: deletedId, subjectName: '旧角色',
      predicate: 'location', factKind: 'state', value: '旧城',
      sourceType: 'chapter', status: 'confirmed', locked: false,
      createdAt: now, updatedAt: now,
    } as any) as number

    await useCharacterStore.getState().loadAll(projectId)
    await useCharacterStore.getState().deleteCharacter(deletedId)

    const outline = await db.detailedOutlines.get(outlineId)
    expect(outline?.appearingCharacterIds).toEqual([keptId])
    expect(outline?.scenes[0].characterIds).toEqual([keptId])
    expect(await db.characterRelations.count()).toBe(0)
    expect(await db.stateCards.where('projectId').equals(projectId).count()).toBe(0)
    expect(await db.characters.get(deletedId)).toBeUndefined()
    const fact = await db.temporalFacts.get(factId)
    expect(fact?.characterId).toBeNull()
    expect(fact?.sourceCharacterId).toBeNull()
    expect(fact?.status).toBe('source-missing') // 删除主体后不保留悬空 Canon，进入异常复核
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
    const sourceOutlineId = await db.outlineNodes.add({
      projectId, parentId: null, type: 'chapter', title: '合并引用章节', summary: '',
      order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const outlineId = await db.detailedOutlines.add({
      projectId, outlineNodeId: sourceOutlineId,
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
    const factId = await db.temporalFacts.add({
      projectId, characterId: aliasId, objectCharacterId: aliasId,
      sourceCharacterId: aliasId, subjectName: '别名角色',
      predicate: 'relation', factKind: 'state', value: '同门',
      sourceType: 'manual', status: 'confirmed', locked: false,
      createdAt: now, updatedAt: now,
    } as any) as number
    const itemId = await db.itemLedger.add({
      projectId, itemName: '别名佩剑', heldByName: '别名角色', characterId: aliasId,
      action: 'gain', quantity: 1, createdAt: now,
    } as any) as number

    await db.transaction('rw', db.characters, db.characterRelations, db.characterDrivenPlans, db.chapters, db.detailedOutlines, db.stateCards, db.temporalFacts, db.itemLedger, db.knowledgeLedger, db.cultivationProgress, async () => {
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
    const fact = await db.temporalFacts.get(factId)
    expect(fact?.characterId).toBe(primaryId)
    expect(fact?.objectCharacterId).toBe(primaryId)
    expect(fact?.sourceCharacterId).toBe(primaryId)
    expect(fact?.subjectName).toBe('主角色')
    expect(fact?.status).toBe('confirmed') // 合并是稳定重映射，不降级
    const item = await db.itemLedger.get(itemId)
    expect(item?.characterId).toBe(primaryId)
    expect(item?.heldByName).toBe('主角色')
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
