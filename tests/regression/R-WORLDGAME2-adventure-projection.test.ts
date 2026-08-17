import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { publishAdventureGameDraft, validateAdventureGameDraft } from '../../src/lib/adventure/authoring'
import { db } from '../../src/lib/db/schema'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { addNarrativeNode, createNarrativeModule } from '../../src/lib/narrative/blueprint'
import {
  commitAdventureAction,
  commitAdventureNarrativeChoice,
  readSimulationState,
  readSimulationStateVersion,
} from '../../src/lib/simulation/runtime'
import { parseAdventureGameReleaseManifest } from '../../src/lib/text-game/releases'
import {
  generateAdventureGameFromWorldRelease,
  loadWorldGameSourceCatalog,
} from '../../src/lib/text-game/world-generation'
import { createTextAdventureInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { stampNewRecord } from '../../src/lib/world-engine/scope'

async function worldFixture() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '雾港世界资产', genre: 'mystery', genres: ['mystery'], status: 'drafting',
    description: '用于世界到文字冒险投影', targetWordCount: 50_000, createdAt: now, updatedAt: now,
  } as any) as number
  const owned = await ensureWorkspaceOwnership(projectId)
  const locations = [
    ['雾港码头', '失潮之后仍有守灯人巡夜。'],
    ['旧档案馆', '封存着潮汐钟最后一次鸣响的记录。'],
    ['失声钟楼', '主线真相隐藏在停摆的钟机里。'],
  ]
  for (const [index, [name, description]] of locations.entries()) {
    await db.importantLocations.add(stampNewRecord(owned.scope, 'importantLocations', {
      projectId, name, tags: '["港口"]', description, significance: '主线地点', parentId: null,
      sortOrder: index, createdAt: now + index, updatedAt: now + index,
    } as any, { owner: 'world' }))
  }
  const categoryId = await db.codexCategories.add(stampNewRecord(owned.scope, 'codexCategories', {
    projectId, domain: 'humanity', parentId: null, name: '人工器物', builtInKey: 'artifact',
    fieldSchema: '[]', hidden: false, order: 0, worldGroupId: null, createdAt: now, updatedAt: now,
  } as any, { owner: 'world' })) as number
  await db.codexEntries.bulkAdd([
    stampNewRecord(owned.scope, 'codexEntries', {
      projectId, categoryId, name: '黄铜潮汐钥匙', summary: '能够重新启动潮汐钟机。', description: '钥匙齿纹对应着旧档案中的潮位。',
      fields: '{}', refs: '{}', tags: '["关键道具"]', importance: 5, order: 0, worldGroupId: null, createdAt: now, updatedAt: now,
    } as any, { owner: 'world' }),
    stampNewRecord(owned.scope, 'codexEntries', {
      projectId, categoryId, name: '守灯人徽章', summary: '允许持有者进入封闭钟楼。', description: '背面刻着雾港旧誓词。',
      fields: '{}', refs: '{}', tags: '["道具"]', importance: 4, order: 1, worldGroupId: null, createdAt: now + 1, updatedAt: now + 1,
    } as any, { owner: 'world' }),
  ])
  const characterId = await db.characters.add(stampNewRecord(owned.scope, 'characters', {
    projectId, name: '守钟人余砚', role: 'supporting', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'lawful',
    shortDescription: '守着失声钟楼的最后见证人。', appearance: '灰色长衣与铜制护目镜。', personality: '克制而警觉。',
    background: '曾负责校准潮汐钟。', motivation: '不让雾港遗忘失潮真相。', abilities: '机械修复', relationships: '[]', arc: '从守秘转向公开真相。',
    speechStyle: '句子简短，只回答自己确认过的事实。', createdAt: now, updatedAt: now,
  } as any, { owner: 'world' })) as number
  const module = await createNarrativeModule({
    scope: owned.scope, owner: 'world', kind: 'main', title: '找回失声的潮汐钟',
    description: '沿码头、档案馆和钟楼追查失潮真相。',
  })
  await addNarrativeNode({ scope: owned.scope, moduleId: module.id!, key: 'entry', kind: 'entry', title: '失潮委托', summary: '从码头告示开始调查。', successorKeys: ['ending'], order: 0 })
  await addNarrativeNode({ scope: owned.scope, moduleId: module.id!, key: 'ending', kind: 'ending', title: '钟声归来', summary: '潮汐钟重新响起。', order: 1 })
  const revision = await createWorldRevision({ scope: owned.scope, label: '雾港冒险源版本', selectedNarrativeModuleIds: [module.id!] })
  const release = await publishWorldRevision(revision.id!)
  return { ...owned, release, characterId }
}

describe('WORLDGAME-2 · WorldRelease 到文字冒险', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('从冻结角色、地点和 artifact 词条生成可发布冒险，不读取 itemLedger', async () => {
    const fixture = await worldFixture()
    const catalog = await loadWorldGameSourceCatalog({ scope: fixture.scope, worldReleaseId: fixture.release.id! })
    expect(catalog.locations.map(item => item.name)).toEqual(['雾港码头', '旧档案馆', '失声钟楼'])
    expect(catalog.artifacts.map(item => item.name)).toEqual(['黄铜潮汐钥匙', '守灯人徽章'])
    expect(catalog.characters.map(item => item.name)).toContain('守钟人余砚')

    const generated = await generateAdventureGameFromWorldRelease({
      scope: fixture.scope,
      worldReleaseId: fixture.release.id!,
      narrativeModuleExportId: catalog.narrativeModules[0].exportId,
      title: '雾港潮汐钟 · 世界版',
    })
    const reordered = await generateAdventureGameFromWorldRelease({
      scope: fixture.scope,
      worldReleaseId: fixture.release.id!,
      narrativeModuleExportId: catalog.narrativeModules[0].exportId,
      locationExportIds: [...catalog.locations].reverse().map(item => item.exportId),
      artifactExportIds: [...catalog.artifacts].reverse().map(item => item.exportId),
      characterExportIds: [...catalog.characters].reverse().map(item => item.exportId),
      title: '雾港潮汐钟 · 世界版',
    })
    expect(reordered.definition.id).toBe(generated.definition.id)
    expect(generated.definition).toMatchObject({
      productType: 'text-adventure', sourceWorldContentHash: fixture.release.contentHash, sourceMappingVersion: 1,
    })
    const storyDefinition = await db.gameDefinitions.where('workId').equals(fixture.scope.workId)
      .filter(item => item.productType === 'storygame').first()
    expect(generated.definition.narrativeModuleId).toBe(storyDefinition?.narrativeModuleId)
    expect((await db.narrativeNodes.where('moduleId').equals(generated.definition.narrativeModuleId).sortBy('order'))
      .map(item => item.title)).toEqual(['失潮委托', '钟声归来'])
    expect(await validateAdventureGameDraft(fixture.scope, generated.definition.id!)).toMatchObject({ valid: true })
    const module = await db.adventureModules.where('gameDefinitionId').equals(generated.definition.id!).first()
    const content = JSON.parse(module!.contentJson)
    expect(content.locations.map((item: any) => item.title)).toEqual(['雾港码头', '旧档案馆', '失声钟楼'])
    expect(content.items.map((item: any) => item.title)).toEqual(['黄铜潮汐钥匙', '守灯人徽章'])
    expect(content.actions.some((item: any) => item.kind === 'talk')).toBe(true)
    expect(await db.itemLedger.where('projectId').equals(fixture.scope.projectId).count()).toBe(0)
    const profile = await db.interactionCharacterProfiles.where('gameDefinitionId').equals(generated.definition.id!).first()
    await db.interactionCharacterProfiles.update(profile!.id!, { characterId: fixture.characterId })
    expect(await validateAdventureGameDraft(fixture.scope, generated.definition.id!)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([expect.stringContaining('不能同时绑定实时角色与冻结来源')]),
    })
  })

  it('完成生成、校验、双发布和立即试玩，并冻结来源选择', async () => {
    const fixture = await worldFixture()
    const catalog = await loadWorldGameSourceCatalog({ scope: fixture.scope, worldReleaseId: fixture.release.id! })
    const generated = await generateAdventureGameFromWorldRelease({
      scope: fixture.scope,
      worldReleaseId: fixture.release.id!,
      narrativeModuleExportId: catalog.narrativeModules[0].exportId,
    })
    const publication = await publishAdventureGameDraft({ scope: fixture.scope, gameDefinitionId: generated.definition.id! })
    const manifest = parseAdventureGameReleaseManifest(publication.gameRelease.manifestJson)
    expect(manifest.definition.source).toMatchObject({
      worldContentHash: fixture.release.contentHash,
      mappingVersion: 1,
      selection: { productType: 'text-adventure', importantLocationExportIds: expect.any(Array), artifactExportIds: expect.any(Array) },
    })
    expect(manifest.adventure.locations).toHaveLength(3)
    expect(manifest.adventure.items).toHaveLength(2)
    expect(manifest.narrative.nodes.map(item => item.title)).toEqual(['失潮委托', '钟声归来'])
    expect(manifest.interaction.profiles).toEqual([expect.objectContaining({ name: '守钟人余砚' })])
    const draftProfile = await db.interactionCharacterProfiles.where('gameDefinitionId').equals(generated.definition.id!).first()
    expect(draftProfile).toMatchObject({ characterId: null })
    expect(JSON.parse(draftProfile!.sourceSnapshotJson ?? '{}')).toMatchObject({
      schema: 'storyforge.interaction-source-character',
      worldContentHash: fixture.release.contentHash,
      name: '守钟人余砚',
    })

    const session = await createTextAdventureInstance({
      scope: fixture.scope, gameReleaseId: publication.gameRelease.id!, title: '现场新冒险', seed: 'world-game-demo',
    })
    expect(await readSimulationState(session.id!)).toMatchObject({
      adventure: { currentLocationKey: `location-${catalog.locations[0].exportId}`, inventory: [] },
    })
    expect((await readSimulationState(session.id!)).narrative?.availableChoiceKeys).not.toContain('entry.to.ending')
    const act = async (actionKey: string) => {
      const base = await readSimulationStateVersion(session.id!)
      await commitAdventureAction({
        sessionId: session.id!,
        actionKey,
        commandId: `world.${actionKey}`,
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
      })
    }
    await act(`look.location-${catalog.locations[0].exportId}`)
    await act(`move.location-${catalog.locations[0].exportId}.location-${catalog.locations[1].exportId}`)
    await act(`take.artifact-${catalog.artifacts[0].exportId}`)
    await act(`move.location-${catalog.locations[1].exportId}.location-${catalog.locations[2].exportId}`)
    await act('use.attune-evidence')
    await act('resolve.main')
    expect((await readSimulationState(session.id!)).narrative?.availableChoiceKeys).toContain('entry.to.ending')
    await commitAdventureNarrativeChoice({
      sessionId: session.id!,
      choiceKey: 'entry.to.ending',
      commandId: 'world.choice.ending',
    })
    const completedState = await readSimulationState(session.id!)
    expect(completedState.adventure?.quests.find(quest => quest.questKey === 'main.bell')).toMatchObject({
      status: 'completed',
    })
    expect(completedState.narrative).toMatchObject({ completed: true, endingKey: 'ending' })
  }, 30_000)

  it('缺少正式地点或 artifact 道具时拒绝生成，实时角色变化也不会污染冻结角色投影', async () => {
    const fixture = await worldFixture()
    const catalog = await loadWorldGameSourceCatalog({ scope: fixture.scope, worldReleaseId: fixture.release.id! })
    await expect(generateAdventureGameFromWorldRelease({
      scope: fixture.scope,
      worldReleaseId: fixture.release.id!,
      narrativeModuleExportId: catalog.narrativeModules[0].exportId,
      locationExportIds: [catalog.locations[0].exportId],
    })).rejects.toThrow('至少需要两个')
    await expect(generateAdventureGameFromWorldRelease({
      scope: fixture.scope,
      worldReleaseId: fixture.release.id!,
      narrativeModuleExportId: catalog.narrativeModules[0].exportId,
      artifactExportIds: [],
    })).rejects.toThrow('至少需要一个 codex artifact')
    await db.characters.update(fixture.characterId, { name: '发布后被替换的实时角色', updatedAt: Date.now() })
    const generated = await generateAdventureGameFromWorldRelease({
      scope: fixture.scope,
      worldReleaseId: fixture.release.id!,
      narrativeModuleExportId: catalog.narrativeModules[0].exportId,
    })
    const profile = await db.interactionCharacterProfiles.where('gameDefinitionId').equals(generated.definition.id!).first()
    expect(profile?.characterId).toBeNull()
    expect(profile?.sourceSnapshotJson).toContain('守钟人余砚')
    expect(profile?.sourceSnapshotJson).not.toContain('发布后被替换')
    expect((FIELD_BY_TARGET.get('interactionCharacterProfiles') ?? []).map(item => item.field))
      .not.toContain('sourceSnapshotJson')
  })

})
