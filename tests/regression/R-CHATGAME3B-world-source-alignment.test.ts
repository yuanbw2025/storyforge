import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  freezeCharacterInteractionWorldSourceSelectionV1,
  loadCharacterInteractionWorldSourceCatalogV1,
  parseCharacterInteractionWorldSourceSelectionV1,
  readCharacterInteractionSelectedWorldRowsV1,
  validateCharacterInteractionWorldSourceSelectionV1,
} from '../../src/lib/character-interaction/world-source'
import { db } from '../../src/lib/db/schema'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { stampNewRecord } from '../../src/lib/world-engine/scope'

async function fixture() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '角色互动冻结来源', genre: 'drama', genres: ['drama'], status: 'drafting',
    description: '验证角色互动产品独立来源契约', targetWordCount: 30_000,
    workspacePurpose: 'world-engine', workspacePurposeDecision: 'explicit',
    createdAt: now, updatedAt: now,
  } as any) as number
  const owned = await ensureWorkspaceOwnership(projectId)
  const characterIds: number[] = []
  for (const [index, name] of ['岑星', '白榆', '顾潮'].entries()) {
    characterIds.push(await db.characters.add(stampNewRecord(owned.scope, 'characters', {
      projectId,
      name,
      role: 'supporting', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
      shortDescription: `${name}经历了旧港停战。`, appearance: '', personality: '克制',
      background: '旧港居民', motivation: '弄清旧案', abilities: '', relationships: '[]',
      arc: '从回避到面对', speechStyle: '谨慎简短', createdAt: now + index, updatedAt: now + index,
    } as any, { owner: 'world' })) as number)
  }
  await db.workCharacterBindings.bulkAdd(characterIds.map((characterId, index) => (
    stampNewRecord(owned.scope, 'workCharacterBindings', {
      projectId, workId: owned.scope.workId, characterId, role: `作品角色${index + 1}`,
      arc: '在终局重新选择生活', outcome: index === 0 ? '隐居旧港' : '继续旅行',
      createdAt: now + index, updatedAt: now + index,
    } as any, { owner: 'work' })
  )))
  await db.characterRelations.add(stampNewRecord(owned.scope, 'characterRelations', {
    projectId, fromCharacterId: characterIds[0], toCharacterId: characterIds[1],
    relationType: 'friend', label: '旧友', description: '停战后仍保持书信往来。',
    isBidirectional: true, createdAt: now, updatedAt: now,
  } as any, { owner: 'world' }))
  const parentLocationId = await db.importantLocations.add(stampNewRecord(owned.scope, 'importantLocations', {
    projectId, name: '旧港', tags: '["港口"]', description: '停战后的港城。', significance: '角色归宿地',
    parentId: null, sortOrder: 0, createdAt: now, updatedAt: now,
  } as any, { owner: 'world' })) as number
  await db.importantLocations.add(stampNewRecord(owned.scope, 'importantLocations', {
    projectId, name: '守潮灯塔', tags: '["灯塔"]', description: '岑星隐居的灯塔。', significance: '聊天开场',
    parentId: parentLocationId, sortOrder: 0, createdAt: now + 1, updatedAt: now + 1,
  } as any, { owner: 'world' }))
  const revision = await createWorldRevision({ scope: owned.scope, label: '角色互动正式来源' })
  const release = await publishWorldRevision(revision.id!, '角色互动正式来源 v1')
  return { ...owned, release, characterIds }
}

describe('CHATGAME-3B · 角色互动产品独立 World Source 契约', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('从不可变 Release 建目录并冻结角色、关系、作品绑定与地点树闭包', async () => {
    const owned = await fixture()
    const catalog = await loadCharacterInteractionWorldSourceCatalogV1({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
    })
    expect(catalog).toMatchObject({
      schema: 'storyforge.character-interaction-world-source-catalog',
      productType: 'character-interaction',
      worldReleaseId: owned.release.id,
      worldContentHash: owned.release.contentHash,
      sourceMappingVersion: 1,
    })
    const characters = catalog.records.characters ?? []
    const locations = catalog.records.importantLocations ?? []
    const selectedCharacterIds = characters.slice(0, 2).map(item => item.exportId)
    const childLocation = locations.find(item => item.label === '守潮灯塔')!
    const selection = await freezeCharacterInteractionWorldSourceSelectionV1({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
      participantCharacterExportIds: selectedCharacterIds,
      optionalRecordSelections: [{ table: 'importantLocations', exportIds: [childLocation.exportId] }],
    })
    expect(selection).toMatchObject({
      schema: 'storyforge.character-interaction-world-source-selection',
      productType: 'character-interaction',
      participantCharacterExportIds: selectedCharacterIds,
      selectionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    const byTable = new Map(selection.recordSelections.map(item => [item.table, item.exportIds]))
    expect(byTable.get('workCharacterBindings')).toHaveLength(2)
    expect(byTable.get('characterRelations')).toHaveLength(1)
    expect(byTable.get('importantLocations')).toEqual(expect.arrayContaining([
      childLocation.exportId,
      childLocation.parentExportId,
    ]))
    await expect(validateCharacterInteractionWorldSourceSelectionV1({ scope: owned.scope, selection }))
      .resolves.toEqual(selection)
  }, 30_000)

  it('实时角色变化不污染已冻结读取，并拒绝未知字段、篡改哈希和跨作用域 Release', async () => {
    const owned = await fixture()
    const catalog = await loadCharacterInteractionWorldSourceCatalogV1({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const character = catalog.records.characters![0]
    const selection = await freezeCharacterInteractionWorldSourceSelectionV1({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
      participantCharacterExportIds: [character.exportId],
    })
    await db.characters.update(owned.characterIds[0], { name: '活动工作表中的新名字', updatedAt: Date.now() })
    const frozen = await readCharacterInteractionSelectedWorldRowsV1({ scope: owned.scope, selection })
    expect(frozen.records.characters?.[0].name).toBe('岑星')

    expect(() => parseCharacterInteractionWorldSourceSelectionV1({ ...selection, injected: true }))
      .toThrow('未知字段')
    await expect(validateCharacterInteractionWorldSourceSelectionV1({
      scope: owned.scope,
      selection: { ...selection, selectionHash: 'f'.repeat(64) },
    })).rejects.toThrow('selectionHash 校验失败')

    const otherProjectId = await db.projects.add({
      name: '越界项目', genre: 'other', genres: ['other'], status: 'drafting', description: '',
      targetWordCount: 1_000, createdAt: Date.now(), updatedAt: Date.now(),
    } as any) as number
    const other = await ensureWorkspaceOwnership(otherProjectId)
    await expect(loadCharacterInteractionWorldSourceCatalogV1({
      scope: other.scope,
      worldReleaseId: owned.release.id!,
    })).rejects.toThrow('不属于当前 WorkspaceScope')
  }, 30_000)
})
