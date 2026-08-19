import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteAdventureGameDraft, publishAdventureGameDraft } from '../../src/lib/adventure/authoring'
import { deleteAvgGameDraft, publishAvgGame } from '../../src/lib/avg/authoring'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  commitAdventureAction,
  commitNarrativeChoice,
  readSimulationState,
  readSimulationStateVersion,
} from '../../src/lib/simulation/runtime'
import { deleteStoryGameDraft, publishStoryGameDraft } from '../../src/lib/text-game/authoring'
import { parseAdventureGameReleaseManifest, parseGameReleaseManifest } from '../../src/lib/text-game/releases'
import {
  generateAdventureGameFromWorldRelease,
  generateAvgGameFromWorldRelease,
  generateStoryGameFromWorldRelease,
  loadWorldGameSourceCatalog,
} from '../../src/lib/text-game/world-generation'
import { validateStoryGameContent } from '../../src/lib/text-game/content'
import {
  createAvgGameInstance,
  createStoryGameInstance,
  createTextAdventureInstance,
} from '../../src/lib/world-engine/instances'
import { installMistHarborDemoWorld } from '../../src/lib/world-engine/mist-harbor-demo'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { adopt } from '../../src/lib/registry/adopt'
import { groupOutlineChaptersByTopLevelVolume } from '../../src/lib/outline/canonical-outline-walk'
import { WORLD_RULE_TREE } from '../../src/lib/types/world-rules'

const CHAPTER_TITLES = [
  '第一章　潮声迟到十三分钟',
  '第二章　潮灯下的失名者',
  '第三章　被抽走的记录页',
  '第四章　退潮石脊之下',
  '第五章　泵轮与四十七个名字',
  '第六章　北塔的三枚权限',
  '第七章　父亲第七码与封缄令',
  '第八章　失声钟楼',
  '第九章　把名字还给全城',
  '第十章　雾散以前',
] as const

async function blankWorkspace() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '路演冷启动项目', genre: 'mystery', genres: ['mystery'], status: 'drafting',
    description: '', targetWordCount: 80_000, createdAt: now, updatedAt: now,
  } as any) as number
  return ensureWorkspaceOwnership(projectId)
}

describe('WORLDGAME-4 · 雾港全新项目演示闭环', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('从空项目建立正式世界资产，幂等重进不复制内容', async () => {
    const owned = await blankWorkspace()
    const first = await installMistHarborDemoWorld({ scope: owned.scope })
    const second = await installMistHarborDemoWorld({ scope: owned.scope })
    expect(second).toEqual(first)
    expect(first).toMatchObject({
      characterCount: 5,
      relationCount: 4,
      locationCount: 5,
      artifactCount: 3,
      loreEntryCount: 2,
      mediaAssetCount: 17,
      worldRuleEntryCount: 16,
      historicalEventCount: 5,
      historicalKeywordCount: 5,
      storyCoreCount: 1,
      outlineNodeCount: 14,
      chapterCount: 10,
      detailedOutlineCount: 10,
      foreshadowCount: 4,
    })
    expect(await validateStoryGameContent(owned.scope, first.narrativeModuleId)).toMatchObject({
      valid: true,
      reachableEndingKeys: ['home', 'sea', 'truth'],
    })
    const [nodes, beats, choices, arc, worldview, worldRules, geography, history, powerSystem, storyCore, characters, outlines, chapters, detailedOutlines, foreshadows] = await Promise.all([
      db.narrativeNodes.where('moduleId').equals(first.narrativeModuleId).toArray(),
      db.narrativeBeats.where('moduleId').equals(first.narrativeModuleId).toArray(),
      db.narrativeChoices.where('moduleId').equals(first.narrativeModuleId).toArray(),
      db.storyArcs.where('projectId').equals(owned.scope.projectId).filter(item => item.name === '失潮钟声主线').first(),
      db.worldviews.where('projectId').equals(owned.scope.projectId).first(),
      db.worldRulesProfiles.where('projectId').equals(owned.scope.projectId).first(),
      db.geographies.where('projectId').equals(owned.scope.projectId).first(),
      db.histories.where('projectId').equals(owned.scope.projectId).first(),
      db.powerSystems.where('projectId').equals(owned.scope.projectId).first(),
      db.storyCores.where('projectId').equals(owned.scope.projectId).first(),
      db.characters.where('projectId').equals(owned.scope.projectId).toArray(),
      db.outlineNodes.where('projectId').equals(owned.scope.projectId).toArray(),
      db.chapters.where('projectId').equals(owned.scope.projectId).toArray(),
      db.detailedOutlines.where('projectId').equals(owned.scope.projectId).toArray(),
      db.foreshadows.where('projectId').equals(owned.scope.projectId).toArray(),
    ])
    expect(nodes).toHaveLength(18)
    expect(beats).toHaveLength(158)
    expect(choices).toHaveLength(20)
    expect(beats.reduce((sum, item) => sum + item.text.length, 0)).toBeGreaterThanOrEqual(5_900)
    expect(beats.filter(item => item.kind === 'dialogue')).toHaveLength(76)
    expect(JSON.parse(arc!.stages as unknown as string)).toHaveLength(3)
    expect(arc?.description).toContain('集体记忆')
    expect(worldview).toMatchObject({
      worldOrigin: expect.stringContaining('潮汐钟'),
      internalConflicts: expect.stringContaining('公开真相'),
      itemDesign: expect.stringContaining('黄铜潮汐钥匙'),
    })
    expect(Object.keys(worldRules!.entries)).toHaveLength(16)
    const registeredRuleNodeIds = new Set(WORLD_RULE_TREE.flatMap(node => [node.id, ...(node.children ?? []).map(child => child.id)]))
    expect(Object.keys(worldRules!.entries).every(key => registeredRuleNodeIds.has(key))).toBe(true)
    expect(worldRules?.globalNote).toContain('载体、权限、代价')
    expect(JSON.parse(geography!.locations)).toHaveLength(8)
    expect(JSON.parse(history!.events)).toHaveLength(5)
    expect(powerSystem).toMatchObject({ name: '潮汐共振工学', rules: expect.stringContaining('单人不能接管主钟') })
    expect(storyCore).toMatchObject({
      logline: expect.stringContaining('全城姓名消失'),
      mainPlot: expect.stringContaining('失声钟楼'),
      subPlots: expect.stringContaining('四十七名遇难者'),
    })
    expect(characters).toHaveLength(5)
    for (const character of characters) {
      expect(character).toMatchObject({
        identity: expect.any(String),
        profile: expect.any(String),
        goals: expect.any(String),
        innerConflict: expect.any(String),
        storyRole: expect.any(String),
        ending: expect.any(String),
      })
      expect(character.identity!.length).toBeGreaterThan(10)
      expect(character.storyRole!.length).toBeGreaterThan(20)
    }
    expect(outlines.filter(item => item.title === '第一卷　失潮钟声' || item.title.startsWith('第一幕') || item.title.startsWith('第二幕') || item.title.startsWith('第三幕') || item.type === 'chapter')).toHaveLength(14)
    expect(groupOutlineChaptersByTopLevelVolume(outlines)).toEqual([
      expect.objectContaining({
        volume: expect.objectContaining({ title: '第一卷　失潮钟声' }),
        chapters: expect.arrayContaining(CHAPTER_TITLES.map(title => expect.objectContaining({ title }))),
      }),
    ])
    expect(chapters).toHaveLength(10)
    expect(chapters.every(item => item.content.includes('data-mist-harbor-roadshow="v1"'))).toBe(true)
    expect(chapters.reduce((sum, item) => sum + item.content.replace(/<[^>]+>/g, '').length, 0)).toBeGreaterThanOrEqual(5_000)
    expect(detailedOutlines).toHaveLength(10)
    expect(detailedOutlines.every(item => Array.isArray(item.scenes) && item.scenes.length > 0)).toBe(true)
    expect(foreshadows).toHaveLength(4)
    expect(await db.historicalTimelineEvents.where('projectId').equals(owned.scope.projectId).count()).toBe(5)
    expect(await db.historicalKeywords.where('projectId').equals(owned.scope.projectId).count()).toBe(5)
    expect(await db.itemLedger.where('projectId').equals(owned.scope.projectId).count()).toBe(0)

    await db.chapters.update(chapters[0].id!, { content: '<p>作者现场修改的正文</p>', wordCount: 10 })
    await installMistHarborDemoWorld({ scope: owned.scope })
    expect((await db.chapters.get(chapters[0].id!))?.content).toBe('<p>作者现场修改的正文</p>')
    expect(await db.chapters.where('projectId').equals(owned.scope.projectId).count()).toBe(10)
  }, 15_000)

  it('完整走通建立世界、选择主线、冻结 WorldRelease、生成三种游戏、冻结 GameRelease 和立即试玩', async () => {
    const owned = await blankWorkspace()
    const demo = await installMistHarborDemoWorld({ scope: owned.scope })
    await adopt({
      projectId: owned.scope.projectId,
      scope: owned.scope,
      target: 'characters',
      mode: 'add',
      data: {
        name: '潮汐商人', role: 'supporting', shortDescription: '路演世界中已有、但不参与本段对白的世界角色。',
        relationships: '[]',
      },
    })
    const revision = await createWorldRevision({
      scope: owned.scope,
      label: '路演现场 · 雾港世界 v1',
      selectedNarrativeModuleIds: [demo.narrativeModuleId],
    })
    const sourceRelease = await publishWorldRevision(revision.id!, '路演现场 · 雾港世界 v1')
    const catalog = await loadWorldGameSourceCatalog({ scope: owned.scope, worldReleaseId: sourceRelease.id! })
    expect(catalog).toMatchObject({
      characters: expect.arrayContaining([expect.objectContaining({ name: '林澈' })]),
      locations: expect.arrayContaining([expect.objectContaining({ name: '失声钟楼' })]),
      artifacts: expect.arrayContaining([expect.objectContaining({ name: '黄铜潮汐钥匙' })]),
    })
    expect(catalog.mediaAssets).toHaveLength(17)
    expect(catalog.mediaAssets.filter(item => item.kind === 'background')).toHaveLength(5)
    expect(catalog.mediaAssets.filter(item => item.kind === 'character-expression')).toHaveLength(6)
    expect(catalog.loreEntries.map(item => item.name)).toEqual(['黑潮事故', '守灯人旧誓'])
    expect(catalog.relationships).toHaveLength(4)
    expect(catalog.storyArcs).toEqual([expect.objectContaining({ name: '失潮钟声主线', type: 'main' })])
    const narrativeModuleExportId = catalog.narrativeModules[0].exportId

    const story = await generateStoryGameFromWorldRelease({
      scope: owned.scope, worldReleaseId: sourceRelease.id!, narrativeModuleExportId,
    })
    const storyPublication = await publishStoryGameDraft({ scope: owned.scope, gameDefinitionId: story.definition.id! })
    const storyManifest = parseGameReleaseManifest(storyPublication.gameRelease.manifestJson)
    expect(story.source.storyArcExportIds).toEqual(catalog.storyArcs.map(item => item.exportId))
    expect(storyManifest.narrative.nodes).toHaveLength(18)
    expect(storyManifest.narrative.beats).toHaveLength(158)
    expect(storyManifest.narrative.choices).toHaveLength(20)
    expect(storyManifest.narrative.beats.reduce((sum, item) => sum + item.text.length, 0)).toBeGreaterThanOrEqual(5_900)
    const storySession = await createStoryGameInstance({ scope: owned.scope, gameReleaseId: storyPublication.gameRelease.id!, title: '雾港分支叙事试玩' })
    expect(await readSimulationState(storySession.id!)).toMatchObject({ narrative: { currentNodeKey: 'entry' } })
    for (const [index, choiceKey] of [
      'entry.archive',
      'archive.vault',
      'vault.undercity',
      'undercity.pump',
      'pump.north',
      'north.father',
      'father.bell',
      'bell.truth',
      'public.truth',
    ].entries()) {
      const baseline = await readSimulationStateVersion(storySession.id!)
      await commitNarrativeChoice({
        sessionId: storySession.id!, choiceKey, commandId: `roadshow.story.${index}`,
        baseSequence: baseline.sequence, baseStateHash: baseline.stateHash,
      })
    }
    expect(await readSimulationState(storySession.id!)).toMatchObject({
      narrative: {
        completed: true,
        endingKey: 'truth',
        visitedNodeKeys: ['entry', 'archive', 'vault', 'undercity', 'pump', 'north-tower', 'father-log', 'bell', 'public-square', 'truth'],
        choiceHistory: expect.arrayContaining([expect.objectContaining({ choiceKey: 'bell.truth' })]),
      },
    })

    const adventure = await generateAdventureGameFromWorldRelease({
      scope: owned.scope, worldReleaseId: sourceRelease.id!, narrativeModuleExportId,
      characterExportIds: catalog.characters.map(item => item.exportId),
      locationExportIds: catalog.locations.map(item => item.exportId),
      artifactExportIds: catalog.artifacts.map(item => item.exportId),
    })
    const adventurePublication = await publishAdventureGameDraft({ scope: owned.scope, gameDefinitionId: adventure.definition.id! })
    const adventureManifest = parseAdventureGameReleaseManifest(adventurePublication.gameRelease.manifestJson)
    expect(adventureManifest.definition.source?.selection).toMatchObject({
      characterRelationExportIds: expect.arrayContaining(catalog.relationships.map(item => item.exportId)),
      codexEntryExportIds: expect.arrayContaining(catalog.loreEntries.map(item => item.exportId)),
    })
    expect(adventureManifest.adventure.objects.map(item => item.title)).toEqual(expect.arrayContaining(['黑潮事故', '守灯人旧誓']))
    expect(adventureManifest.adventure.objects.length).toBeGreaterThanOrEqual(20)
    expect(adventureManifest.adventure.playerIdentity).toMatchObject({ name: '林澈' })
    expect(adventureManifest.interaction.profiles.map(item => item.name)).not.toContain('林澈')
    expect(adventureManifest.adventure.actions.length).toBeGreaterThanOrEqual(40)
    const openingAction = adventureManifest.adventure.actions.find(item => item.key === `look.${adventureManifest.adventure.initialLocationKey}`)!
    expect(openingAction.successText).toContain('【林澈】')
    expect(openingAction.successText).toContain('【余砚】')
    const talkActions = adventureManifest.adventure.actions.filter(item => item.kind === 'talk')
    expect(talkActions.map(item => item.label)).not.toContain('询问林澈')
    expect(talkActions.every(item => (item.successText.match(/【[^】]+】/g) ?? []).length >= 2)).toBe(true)
    expect(adventureManifest.adventure.abilities.map(item => item.title)).toEqual(['观察', '推理', '灵巧', '共情'])
    expect(adventureManifest.adventure.conditions).toHaveLength(4)
    expect(adventureManifest.adventure.quests.map(item => item.key)).toEqual(expect.arrayContaining([
      'main.bell', 'side.survey', 'side.archive', 'side.reconstruction', 'side.voices',
    ]))
    expect(adventureManifest.adventure.actions.filter(item => item.kind === 'move').every(item => item.rule.kind === 'resource-payment')).toBe(true)
    expect(adventureManifest.adventure.actions.map(item => item.key)).toContain('use.attune-evidence')
    expect(adventureManifest.adventure.actions.filter(item => item.key.startsWith('investigate.story-'))).toHaveLength(14)
    expect(adventureManifest.adventure.actions.reduce((sum, item) => sum + item.successText.length, 0)).toBeGreaterThanOrEqual(5_000)
    expect(adventureManifest.adventure.actions.map(item => item.label)).toEqual(expect.arrayContaining([
      '公开全部记录，敲响真相之钟',
      '限制共振，签下七日公开之约',
      '彻底断钟，带领船队驶向黑潮',
    ]))
    expect(JSON.stringify(adventureManifest.interaction.profiles)).toContain('真相同盟')
    const adventureSession = await createTextAdventureInstance({
      scope: owned.scope, gameReleaseId: adventurePublication.gameRelease.id!, title: '雾港文字冒险试玩', seed: 'roadshow',
    })
    expect(await readSimulationState(adventureSession.id!)).toMatchObject({ adventure: { inventory: [] } })
    const locationKeys = adventureManifest.adventure.locations.map(item => item.key)
    const act = async (actionKey: string) => {
      const baseline = await readSimulationStateVersion(adventureSession.id!)
      await commitAdventureAction({
        sessionId: adventureSession.id!, actionKey, commandId: `roadshow.adventure.${actionKey}`,
        baseSequence: baseline.sequence, baseStateHash: baseline.stateHash,
      })
    }
    await act(`look.${locationKeys[0]}`)
    await act(`move.${locationKeys[0]}.${locationKeys[1]}`)
    await act(`take.artifact-${catalog.artifacts[0].exportId}`)
    await act(`move.${locationKeys[1]}.${locationKeys[2]}`)
    await act(`move.${locationKeys[2]}.${locationKeys[3]}`)
    await act('use.attune-evidence')
    await act('resolve.truth')
    const adventureState = await readSimulationState(adventureSession.id!)
    expect(adventureState.adventure?.currentLocationKey).toBe(locationKeys[3])
    expect(adventureState.adventure?.quests.find(quest => quest.questKey === 'main.bell')).toMatchObject({ status: 'completed' })
    expect(adventureState.adventure?.actionHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionKey: 'use.attune-evidence', narrative: expect.stringContaining('黄铜潮汐钥匙') }),
      expect.objectContaining({ actionKey: 'resolve.truth', narrative: expect.stringContaining('真相之钟') }),
    ]))
    expect(adventureState.adventure?.conditions).toEqual(expect.arrayContaining([
      expect.objectContaining({ conditionKey: 'calibrated' }),
    ]))

    const avg = await generateAvgGameFromWorldRelease({
      scope: owned.scope, worldReleaseId: sourceRelease.id!, narrativeModuleExportId,
      characterExportIds: catalog.characters.map(item => item.exportId),
      mediaAssetExportIds: catalog.mediaAssets.map(item => item.exportId),
    })
    const avgPresentation = await db.avgPresentationModules.where('gameDefinitionId').equals(avg.definition.id!).first()
    const avgCues = JSON.parse(avgPresentation!.contentJson).cues as Array<{ type: string; assetKey?: string }>
    expect(avgCues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'show-actor', assetKey: 'mist.actor.lin.resolve' }),
    ]))
    expect(avgCues).toHaveLength(94)
    expect(avgCues.filter(item => item.type === 'show-actor')).toHaveLength(76)
    expect(avgCues.filter(item => item.type === 'set-background')).toHaveLength(15)
    expect(avgCues.filter(item => item.type === 'show-cg')).toHaveLength(3)
    const avgPublication = await publishAvgGame({ scope: owned.scope, gameDefinitionId: avg.definition.id! })
    const avgSession = await createAvgGameInstance({ scope: owned.scope, gameReleaseId: avgPublication.gameRelease.id!, title: '雾港 AVG 试玩' })
    expect(await readSimulationState(avgSession.id!)).toMatchObject({
      presentation: { assets: expect.arrayContaining([expect.objectContaining({ kind: 'background' }), expect.objectContaining({ kind: 'character-pose' })]) },
    })

    expect(await db.gameDefinitions.where('workId').equals(owned.scope.workId).count()).toBe(3)
    expect(await db.gameReleases.where('workId').equals(owned.scope.workId).count()).toBe(3)
    expect(await db.simulationSessions.where('workId').equals(owned.scope.workId).count()).toBe(3)

    const exported = await exportProjectJSON(owned.scope.projectId)
    const importedProjectId = await importProjectJSON(exported)
    const imported = await ensureWorkspaceOwnership(importedProjectId)
    const importedDefinitions = await db.gameDefinitions.where('workId').equals(imported.scope.workId).toArray()
    expect(importedDefinitions).toHaveLength(3)
    expect(importedDefinitions.every(item => item.sourceWorldContentHash === sourceRelease.contentHash)).toBe(true)
    expect(await db.avgMediaBlobs.where('workId').equals(imported.scope.workId).count()).toBe(17)
    expect(await db.gameReleases.where('workId').equals(imported.scope.workId).count()).toBe(3)
    const importedProfiles = await db.interactionCharacterProfiles.where('workId').equals(imported.scope.workId).toArray()
    expect(importedProfiles).toHaveLength(4)
    expect(importedProfiles.every(item => item.characterId == null)).toBe(true)
    expect(importedProfiles.every(item => JSON.parse(item.sourceSnapshotJson ?? '{}').worldContentHash === sourceRelease.contentHash)).toBe(true)

    const definitionByProduct = new Map(importedDefinitions.map(item => [item.productType, item]))
    const sharedNarrativeModuleId = importedDefinitions[0].narrativeModuleId
    expect(importedDefinitions.every(item => item.narrativeModuleId === sharedNarrativeModuleId)).toBe(true)
    await deleteStoryGameDraft({ scope: imported.scope, gameDefinitionId: definitionByProduct.get('storygame')!.id! })
    expect(await db.narrativeModules.get(sharedNarrativeModuleId)).toBeTruthy()
    await deleteAdventureGameDraft({ scope: imported.scope, gameDefinitionId: definitionByProduct.get('text-adventure')!.id! })
    expect(await db.narrativeModules.get(sharedNarrativeModuleId)).toBeTruthy()
    await deleteAvgGameDraft({ scope: imported.scope, gameDefinitionId: definitionByProduct.get('avg')!.id! })
    expect(await db.narrativeModules.get(sharedNarrativeModuleId)).toBeUndefined()
    expect((await db.simulationSessions.where('workId').equals(imported.scope.workId).toArray())
      .every(item => item.narrativeModuleId == null)).toBe(true)
    expect(await db.gameDefinitions.where('workId').equals(imported.scope.workId).count()).toBe(0)
    expect(await db.gameReleases.where('workId').equals(imported.scope.workId).count()).toBe(3)
  }, 120_000)
})
