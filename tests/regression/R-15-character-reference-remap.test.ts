/**
 * R-15: character delete/merge must clean JSON-array references.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useCharacterStore } from '../../src/stores/character'
import { applyCharacterReferenceRemap } from '../../src/lib/registry/character-references'
import { transactionTablesFor } from '../../src/lib/registry/lifecycle'
import { parseFields, stringifyFields } from '../../src/lib/types/state-card'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

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
    const projectId = await seedCurrentProject({
      name: 'R-15-delete', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const deletedId = await db.characters.add(character(projectId, '旧角色', now)) as number
    const keptId = await db.characters.add(character(projectId, '保留角色', now)) as number
    await db.characterRelations.add({
      projectId, fromCharacterId: deletedId, toCharacterId: keptId,
      relationType: 'ally', label: '盟友', description: '', isBidirectional: true,
      createdAt: now, updatedAt: now,
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
    await finalizeCurrentFixtureV1(projectId)
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
    const projectId = await seedCurrentProject({
      name: 'R-15-merge', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const primaryId = await db.characters.add(character(projectId, '主角色', now)) as number
    const aliasId = await db.characters.add(character(projectId, '别名角色', now)) as number
    await db.characterRelations.add({
      projectId, fromCharacterId: primaryId, toCharacterId: aliasId,
      relationType: 'ally', label: '盟友', description: '', isBidirectional: true,
      createdAt: now, updatedAt: now,
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
        fields: stringifyFields([{ key: '位置', value: '' }]),
        createdAt: now, updatedAt: now,
      },
      {
        projectId, category: 'character', entityName: '别名角色',
        fields: stringifyFields([
          { key: '位置', value: '主城' },
          { key: '伤势', value: '轻伤' },
        ]),
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
    await finalizeCurrentFixtureV1(projectId)
    await db.transaction('rw', transactionTablesFor('importProject'), async () => {
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
    expect(parseFields(cards[0].fields).find(f => f.key === '位置')?.value).toBe('主城')
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

  it('promotes the source state card when the primary character has no existing card', async () => {
    const now = Date.now()
    const projectId = await seedCurrentProject({
      name: 'R-15-promote-card', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const primaryId = await db.characters.add(character(projectId, '无卡主角色', now)) as number
    const aliasId = await db.characters.add(character(projectId, '有卡别名', now)) as number
    const sourceCardId = await db.stateCards.add({
      projectId, category: 'character', entityName: '有卡别名',
      fields: stringifyFields([{ key: '位置', value: '盐港' }]),
      createdAt: now, updatedAt: now,
    } as any) as number
    await db.stateCards.add({
      projectId, category: 'character', entityName: '有卡别名',
      fields: stringifyFields([{ key: '伤势', value: '无' }]),
      createdAt: now, updatedAt: now,
    } as any)

    // 生命周期重映射必须容忍现存旧草稿中的脏 JSON/数组形态：它们不能让角色合并
    // 事务失败，也不能被误改成另一个角色。这里同时覆盖无匹配引用的保留路径。
    const outlineNodeId = await db.outlineNodes.add({
      projectId, parentId: null, type: 'chapter', title: '脏引用容错', summary: '',
      order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    await db.detailedOutlines.bulkAdd([
      {
        projectId, outlineNodeId,
        appearingCharacterIds: 'not-an-array',
        scenes: [null, { title: '缺少角色数组' }, { title: '无关角色', characterIds: [primaryId] }],
        createdAt: now, updatedAt: now,
      },
      {
        projectId, outlineNodeId,
        appearingCharacterIds: [], scenes: 'not-an-array',
        createdAt: now, updatedAt: now,
      },
    ] as any[])
    const planBase = {
      projectId, name: '旧草稿', userHint: '', generatedVolumes: '[]',
      status: 'draft', version: 1, parentPlanId: null, createdAt: now, updatedAt: now,
    }
    await db.characterDrivenPlans.bulkAdd([
      { ...planBase, name: '坏 JSON', arcs: '[' },
      { ...planBase, name: '非数组 JSON', arcs: '{}' },
      { ...planBase, name: '无关数组项', arcs: JSON.stringify([null, { characterId: primaryId }]) },
    ] as any[])

    await db.transaction('rw', transactionTablesFor('importProject'), async () => {
      await applyCharacterReferenceRemap({
        projectId,
        fromCharacterId: aliasId,
        fromName: '有卡别名',
        toCharacterId: primaryId,
        toName: '无卡主角色',
      })
      await db.characters.delete(aliasId)
    })

    const promoted = await db.stateCards.get(sourceCardId)
    expect(promoted?.entityName).toBe('无卡主角色')
    expect(parseFields(promoted?.fields ?? '')).toEqual([{ key: '位置', value: '盐港' }])
    expect(await db.stateCards.where('projectId').equals(projectId).count()).toBe(1)
    expect((await db.characterDrivenPlans.where('projectId').equals(projectId).toArray()).map(plan => plan.arcs))
      .toEqual(['[', '{}', JSON.stringify([null, { characterId: primaryId }])])
  })
})

function character(projectId: number, name: string, now: number) {
  return {
    projectId, name, roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
    shortDescription: '', appearance: '', personality: '', background: '',
    motivation: '', abilities: '', relationships: '', arc: '', homeWorldGroupId: null,
    isCrossWorld: false,
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
