import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  buildEntityRenamePreview,
  executeEntityRename,
  listRenamableEntities,
  undoEntityRename,
} from '../../src/lib/editor/entity-rename'
import { useStateCardStore } from '../../src/stores/state-card'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const now = 1_800_000_000_000

async function seedProject() {
  const { scope } = await seedCurrentWorkspace('实体改名测试')
  const { projectId } = scope
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId,
    parentId: null,
    type: 'chapter',
    title: '李明初入山门',
    summary: '李明遇见李明轩',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never)
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId,
    outlineNodeId,
    title: '第一章',
    content: '<p>李明举剑。</p><p><strong>李明</strong>看见李明轩。</p>',
    wordCount: 12,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never)
  const characterId = await db.characters.add(stampNewRecord(scope, 'characters', {
    projectId,
    name: '李明',
    roleWeight: 'main',
    moralAxis: 'good',
    orderAxis: 'neutral',
    shortDescription: '',
    appearance: '',
    personality: '',
    background: '',
    motivation: '',
    abilities: '',
    relationships: '[]',
    arc: '',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'world' }) as never)
  const longerCharacterId = await db.characters.add(stampNewRecord(scope, 'characters', {
    projectId,
    name: '李明轩',
    roleWeight: 'secondary',
    moralAxis: 'neutral',
    orderAxis: 'neutral',
    shortDescription: '李明的同门',
    appearance: '',
    personality: '',
    background: '',
    motivation: '',
    abilities: '',
    relationships: '[]',
    arc: '',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'world' }) as never)
  const stateCardId = await db.stateCards.add(stampNewRecord(scope, 'stateCards', {
    projectId,
    category: 'character',
    entityName: '李明',
    fields: JSON.stringify([{ key: '位置', value: '山门' }]),
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never)
  const factId = await db.temporalFacts.add(stampNewRecord(scope, 'temporalFacts', {
    projectId,
    characterId,
    subjectName: '李明',
    predicate: 'location',
    factKind: 'state',
    value: '山门',
    sourceType: 'manual',
    status: 'confirmed',
    locked: false,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never)
  const knowledgeId = await db.knowledgeLedger.add(stampNewRecord(scope, 'knowledgeLedger', {
    projectId,
    characterId,
    characterName: '李明',
    knowledgeKey: 'secret',
    statement: '山门有密道',
    action: 'learn',
    sourceType: 'manual',
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never)
  const cultivationId = await db.cultivationProgress.add(stampNewRecord(scope, 'cultivationProgress', {
    projectId,
    characterId,
    characterName: '李明',
    cultivationSystemName: '剑道',
    stageName: '入门',
    transition: 'enter',
    sourceChapterTitle: '第一章',
    sourceQuote: '李明举剑',
    sourceOffset: 0,
    trigger: '',
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as never)
  const itemId = await db.itemLedger.add(stampNewRecord(scope, 'itemLedger', {
    projectId,
    itemName: '青锋剑',
    action: 'gain',
    quantity: 1,
    heldByName: '李明',
    characterId,
    chapterId,
    createdAt: now,
  }, { owner: 'work' }) as never)
  return {
    scope,
    projectId,
    outlineNodeId,
    chapterId,
    characterId,
    longerCharacterId,
    stateCardId,
    factId,
    knowledgeId,
    cultivationId,
    itemId,
  }
}

describe('EDITOR-5 · 安全实体改名', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('角色改名同步正文与稳定 FK 的冗余名称，并可原子撤销', async () => {
    const seeded = await seedProject()
    const target = { kind: 'character' as const, id: seeded.characterId }
    const preview = await buildEntityRenamePreview(seeded.projectId, target, '林照')

    expect(preview.blockers).toEqual([])
    expect(preview.chapterReplacementCount).toBe(2)
    expect(preview.manualReview.some(item => item.source === '大纲')).toBe(true)
    expect(preview.structuredCounts).toEqual(expect.arrayContaining([
      { label: '角色主档', count: 1 },
      { label: '状态卡', count: 1 },
      { label: '时序事实显示名', count: 1 },
      { label: '角色认知账本', count: 1 },
      { label: '修炼进度', count: 1 },
      { label: '物品流水持有人', count: 1 },
    ]))

    const result = await executeEntityRename({
      projectId: seeded.projectId,
      entity: target,
      newName: '林照',
      expectedBaseline: preview.baseline,
      createSnapshot: vi.fn().mockResolvedValue(91),
      label: '角色改名前快照',
    })

    expect(result.snapshotId).toBe(91)
    expect((await db.characters.get(seeded.characterId))?.name).toBe('林照')
    expect((await db.chapters.get(seeded.chapterId))?.content).toContain('<strong>林照</strong>')
    expect((await db.chapters.get(seeded.chapterId))?.content).toContain('李明轩')
    expect((await db.stateCards.get(seeded.stateCardId))?.entityName).toBe('林照')
    expect((await db.temporalFacts.get(seeded.factId))?.subjectName).toBe('林照')
    expect((await db.knowledgeLedger.get(seeded.knowledgeId))?.characterName).toBe('林照')
    expect((await db.cultivationProgress.get(seeded.cultivationId))?.characterName).toBe('林照')
    expect((await db.itemLedger.get(seeded.itemId))?.heldByName).toBe('林照')
    expect((await db.outlineNodes.get(seeded.outlineNodeId))?.title).toBe('李明初入山门')
    await useStateCardStore.getState().loadAll(seeded.projectId)
    expect(useStateCardStore.getState().buildSelectiveStateContext('林照回到山门').text).toContain('林照')
    expect(useStateCardStore.getState().buildSelectiveStateContext('李明回到山门').text).not.toContain('李明')

    await undoEntityRename(result.undoPatch)
    expect((await db.characters.get(seeded.characterId))?.name).toBe('李明')
    expect((await db.chapters.get(seeded.chapterId))?.content).toContain('<strong>李明</strong>')
    expect((await db.stateCards.get(seeded.stateCardId))?.entityName).toBe('李明')
    expect((await db.temporalFacts.get(seeded.factId))?.subjectName).toBe('李明')
    expect((await db.itemLedger.get(seeded.itemId))?.heldByName).toBe('李明')
  })

  it('地点与势力词条使用类型匹配的状态卡并同步事实显示名', async () => {
    const { projectId, scope } = await seedProject()
    const locationId = await db.importantLocations.add(stampNewRecord(scope, 'importantLocations', {
      projectId,
      name: '旧城',
      tags: '[]',
      description: '',
      significance: '',
      parentId: null,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'world' }) as never)
    const locationCardId = await db.stateCards.add(stampNewRecord(scope, 'stateCards', {
      projectId,
      category: 'location',
      entityName: '旧城',
      fields: '[]',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }) as never)
    const locationFactId = await db.temporalFacts.add(stampNewRecord(scope, 'temporalFacts', {
      projectId,
      locationId,
      subjectName: '旧城',
      predicate: 'location',
      factKind: 'state',
      value: '封锁',
      sourceType: 'manual',
      status: 'confirmed',
      locked: false,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }) as never)
    const categoryId = await db.codexCategories.add(stampNewRecord(scope, 'codexCategories', {
      projectId,
      domain: 'humanity',
      parentId: null,
      name: '势力',
      builtInKey: 'faction',
      fieldSchema: '[]',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'world' }) as never)
    const codexId = await db.codexEntries.add(stampNewRecord(scope, 'codexEntries', {
      projectId,
      categoryId,
      name: '玄门',
      summary: '',
      description: '',
      fields: '{}',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'world' }) as never)
    const factionCardId = await db.stateCards.add(stampNewRecord(scope, 'stateCards', {
      projectId,
      category: 'faction',
      entityName: '玄门',
      fields: '[]',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }) as never)
    const codexFactId = await db.temporalFacts.add(stampNewRecord(scope, 'temporalFacts', {
      projectId,
      codexEntryId: codexId,
      subjectName: '玄门',
      predicate: 'factionMembership',
      factKind: 'state',
      value: '中立',
      sourceType: 'manual',
      status: 'confirmed',
      locked: false,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }) as never)

    const locationPreview = await buildEntityRenamePreview(projectId, { kind: 'location', id: locationId }, '新城')
    await executeEntityRename({
      projectId,
      entity: { kind: 'location', id: locationId },
      newName: '新城',
      expectedBaseline: locationPreview.baseline,
      createSnapshot: vi.fn().mockResolvedValue(1),
      label: '地点改名',
    })
    expect((await db.stateCards.get(locationCardId))?.entityName).toBe('新城')
    expect((await db.temporalFacts.get(locationFactId))?.subjectName).toBe('新城')

    const codexPreview = await buildEntityRenamePreview(projectId, { kind: 'codexEntry', id: codexId }, '太玄门')
    await executeEntityRename({
      projectId,
      entity: { kind: 'codexEntry', id: codexId },
      newName: '太玄门',
      expectedBaseline: codexPreview.baseline,
      createSnapshot: vi.fn().mockResolvedValue(2),
      label: '词条改名',
    })
    expect((await db.stateCards.get(factionCardId))?.entityName).toBe('太玄门')
    expect((await db.temporalFacts.get(codexFactId))?.subjectName).toBe('太玄门')
  })

  it('跨类型同名和物品同名都会阻止无法判定归属的全局替换', async () => {
    const { projectId, scope, characterId } = await seedProject()
    await db.importantLocations.add(stampNewRecord(scope, 'importantLocations', {
      projectId,
      name: '李明',
      tags: '[]',
      description: '',
      significance: '',
      parentId: null,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    }, { owner: 'world' }) as never)
    const oldCollision = await buildEntityRenamePreview(projectId, { kind: 'character', id: characterId }, '林照')
    expect(oldCollision.blockers.join('')).toContain('旧名称')

    await db.itemLedger.add(stampNewRecord(scope, 'itemLedger', {
      projectId,
      itemName: '天问',
      action: 'gain',
      quantity: 1,
      heldByName: '李明',
      characterId,
      createdAt: now,
    }, { owner: 'work' }) as never)
    const newCollision = await buildEntityRenamePreview(projectId, { kind: 'character', id: characterId }, '天问')
    expect(newCollision.blockers.join('')).toContain('新名称')

    const listed = await listRenamableEntities(projectId)
    expect(listed.some(item => item.name === '天问')).toBe(false)
  })

  it('不会把新名称已有的同类型状态卡静默合并', async () => {
    const { projectId, scope, characterId } = await seedProject()
    await db.stateCards.add(stampNewRecord(scope, 'stateCards', {
      projectId,
      category: 'character',
      entityName: '林照',
      fields: JSON.stringify([{ key: '位置', value: '未知' }]),
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }) as never)

    const preview = await buildEntityRenamePreview(
      projectId,
      { kind: 'character', id: characterId },
      '林照',
    )
    expect(preview.blockers.join('')).toContain('同类型状态卡')
  })

  it('快照失败时不写入任何记录', async () => {
    const seeded = await seedProject()
    const entity = { kind: 'character' as const, id: seeded.characterId }
    const preview = await buildEntityRenamePreview(seeded.projectId, entity, '林照')

    await expect(executeEntityRename({
      projectId: seeded.projectId,
      entity,
      newName: '林照',
      expectedBaseline: preview.baseline,
      createSnapshot: vi.fn().mockRejectedValue(new Error('磁盘已满')),
      label: '失败快照',
    })).rejects.toThrow('磁盘已满')

    expect((await db.characters.get(seeded.characterId))?.name).toBe('李明')
    expect((await db.chapters.get(seeded.chapterId))?.content).toContain('李明举剑')
  })

  it('事务中任一结构化写入失败会回滚正文与主档', async () => {
    const seeded = await seedProject()
    const entity = { kind: 'character' as const, id: seeded.characterId }
    const preview = await buildEntityRenamePreview(seeded.projectId, entity, '林照')
    vi.spyOn(db.temporalFacts, 'update').mockRejectedValueOnce(new Error('事实账本写入失败'))

    await expect(executeEntityRename({
      projectId: seeded.projectId,
      entity,
      newName: '林照',
      expectedBaseline: preview.baseline,
      createSnapshot: vi.fn().mockResolvedValue(8),
      label: '回滚测试',
    })).rejects.toThrow('事实账本写入失败')

    expect((await db.characters.get(seeded.characterId))?.name).toBe('李明')
    expect((await db.chapters.get(seeded.chapterId))?.content).toContain('李明举剑')
    expect((await db.stateCards.get(seeded.stateCardId))?.entityName).toBe('李明')
  })

  it('预览后数据变化会拒绝执行，撤销前数据变化也会整体拒绝', async () => {
    const seeded = await seedProject()
    const entity = { kind: 'character' as const, id: seeded.characterId }
    const stalePreview = await buildEntityRenamePreview(seeded.projectId, entity, '林照')
    await db.chapters.update(seeded.chapterId, { content: '<p>李明已经离开。</p>' })
    const createSnapshot = vi.fn().mockResolvedValue(3)
    await expect(executeEntityRename({
      projectId: seeded.projectId,
      entity,
      newName: '林照',
      expectedBaseline: stalePreview.baseline,
      createSnapshot,
      label: '过期预览',
    })).rejects.toThrow('重新预览')
    expect(createSnapshot).not.toHaveBeenCalled()

    const freshPreview = await buildEntityRenamePreview(seeded.projectId, entity, '林照')
    const result = await executeEntityRename({
      projectId: seeded.projectId,
      entity,
      newName: '林照',
      expectedBaseline: freshPreview.baseline,
      createSnapshot: vi.fn().mockResolvedValue(4),
      label: '可撤销改名',
    })
    await db.stateCards.update(seeded.stateCardId, { entityName: '人工新名称' })
    await expect(undoEntityRename(result.undoPatch)).rejects.toThrow('项目快照')
    expect((await db.characters.get(seeded.characterId))?.name).toBe('林照')
    expect((await db.stateCards.get(seeded.stateCardId))?.entityName).toBe('人工新名称')
  })
})
