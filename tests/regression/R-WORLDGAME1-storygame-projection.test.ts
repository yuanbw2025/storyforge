import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { addNarrativeNode, createNarrativeModule } from '../../src/lib/narrative/blueprint'
import { readSimulationState } from '../../src/lib/simulation/runtime'
import { createGameDefinition } from '../../src/lib/text-game/content'
import { parseGameReleaseManifest } from '../../src/lib/text-game/releases'
import { publishStoryGameDraft } from '../../src/lib/text-game/authoring'
import {
  buildStoryGameDraftFromWorldRelease,
  generateStoryGameFromWorldRelease,
} from '../../src/lib/text-game/world-generation'
import { createStoryGameInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'

async function createWorkspace(name: string) {
  const now = Date.now()
  const projectId = await db.projects.add({
    name,
    genre: 'mystery',
    genres: ['mystery'],
    status: 'drafting',
    description: '世界到游戏确定性投影测试',
    targetWordCount: 80_000,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  return ensureWorkspaceOwnership(projectId)
}

async function createFrozenWorldStory(name = '雾港主线') {
  const owned = await createWorkspace(name)
  const module = await createNarrativeModule({
    scope: owned.scope,
    owner: 'world',
    kind: 'main',
    title: name,
    description: '潮汐钟停止后，守灯人必须在黎明前作出决定。',
  })
  await addNarrativeNode({
    scope: owned.scope,
    moduleId: module.id!,
    key: 'entry',
    kind: 'entry',
    title: '失潮之夜',
    summary: '雾港第一次没有等到潮水。',
    successorKeys: ['choice'],
    order: 0,
  })
  await addNarrativeNode({
    scope: owned.scope,
    moduleId: module.id!,
    key: 'choice',
    kind: 'scene',
    title: '潮汐钟楼',
    summary: '守灯人登上钟楼，寻找失潮的原因。',
    successorKeys: ['ending'],
    order: 1,
  })
  await addNarrativeNode({
    scope: owned.scope,
    moduleId: module.id!,
    key: 'ending',
    kind: 'ending',
    title: '黎明重新到来',
    summary: '潮声重新越过防波堤。',
    order: 2,
  })
  const revision = await createWorldRevision({
    scope: owned.scope,
    label: '雾港世界源版本',
    selectedNarrativeModuleIds: [module.id!],
  })
  const release = await publishWorldRevision(revision.id!)
  return { ...owned, module, release }
}

describe('WORLDGAME-1 · WorldRelease 到分支互动叙事', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只从不可变清单读取内容，并把线性世界蓝图补成可发布的 Beat 与 Choice', async () => {
    const fixture = await createFrozenWorldStory()
    const worldManifest = JSON.parse(fixture.release.manifestJson)
    const sourceExportId = worldManifest.selectedNarrativeModules[0].exportId as number
    const pureDraft = buildStoryGameDraftFromWorldRelease({
      manifest: worldManifest,
      worldContentHash: fixture.release.contentHash,
      narrativeModuleExportId: sourceExportId,
    })
    expect(pureDraft).toMatchObject({
      entryNodeKey: 'entry',
      source: {
        schema: 'storyforge.world-game-source',
        productType: 'storygame',
        worldContentHash: fixture.release.contentHash,
        narrativeModuleExportId: sourceExportId,
      },
    })
    expect(pureDraft.beats).toHaveLength(3)
    expect(pureDraft.choices.map(choice => choice.targetNodeKey)).toEqual(['choice', 'ending'])

    await db.narrativeNodes.where('moduleId').equals(fixture.module.id!).modify({
      title: '发布后被修改的实时标题',
      summary: '这段实时内容不得进入游戏投影。',
    })
    const generated = await generateStoryGameFromWorldRelease({
      scope: fixture.scope,
      worldReleaseId: fixture.release.id!,
      narrativeModuleExportId: sourceExportId,
      title: '雾港余烬',
    })
    expect(generated.report.valid).toBe(true)
    expect(generated.definition).toMatchObject({
      productType: 'storygame',
      title: '雾港余烬',
      sourceWorldContentHash: fixture.release.contentHash,
      sourceMappingVersion: 1,
    })
    const projectedNodes = await db.narrativeNodes.where('moduleId').equals(generated.definition.narrativeModuleId).sortBy('order')
    expect(projectedNodes.map(node => node.title)).toEqual(['失潮之夜', '潮汐钟楼', '黎明重新到来'])
    expect(projectedNodes.some(node => node.title.includes('发布后'))).toBe(false)
    expect(await db.narrativeBeats.where('moduleId').equals(generated.definition.narrativeModuleId).count()).toBe(3)
    expect(await db.narrativeChoices.where('moduleId').equals(generated.definition.narrativeModuleId).count()).toBe(2)
  })

  it('完成生成、校验、WorldRelease、GameRelease 和立即试玩闭环', async () => {
    const fixture = await createFrozenWorldStory('雾港冷启动主线')
    const sourceManifest = JSON.parse(fixture.release.manifestJson)
    const generated = await generateStoryGameFromWorldRelease({
      scope: fixture.scope,
      worldReleaseId: fixture.release.id!,
      narrativeModuleExportId: sourceManifest.selectedNarrativeModules[0].exportId,
    })
    const repeated = await generateStoryGameFromWorldRelease({
      scope: fixture.scope,
      worldReleaseId: fixture.release.id!,
      narrativeModuleExportId: sourceManifest.selectedNarrativeModules[0].exportId,
    })
    expect(repeated.definition.id).toBe(generated.definition.id)

    const publication = await publishStoryGameDraft({
      scope: fixture.scope,
      gameDefinitionId: generated.definition.id!,
      label: '雾港世界游戏发布',
    })
    const manifest = parseGameReleaseManifest(publication.gameRelease.manifestJson)
    expect(manifest.definition.source).toEqual({
      worldContentHash: fixture.release.contentHash,
      mappingVersion: 1,
      selection: generated.source,
    })
    expect(manifest.narrative).toMatchObject({ entryNodeKey: 'entry' })
    expect(manifest.narrative.beats).toHaveLength(3)
    expect(manifest.narrative.choices).toHaveLength(2)
    expect(manifest.worldRelease.contentHash).toBe(publication.worldRelease.contentHash)

    const session = await createStoryGameInstance({
      scope: fixture.scope,
      gameReleaseId: publication.gameRelease.id!,
      title: '评审现场试玩',
    })
    expect(await readSimulationState(session.id!)).toMatchObject({
      narrative: {
        currentNodeKey: 'entry',
        availableChoiceKeys: ['entry.to.choice'],
      },
    })
  }, 20_000)

  it('拒绝越界的发布版本和不存在的便携 NarrativeModule 引用', async () => {
    expect((FIELD_BY_TARGET.get('gameDefinitions') ?? []).map(item => item.field)).not.toEqual(expect.arrayContaining([
      'sourceWorldContentHash', 'sourceSelectionJson', 'sourceMappingVersion',
    ]))
    const owner = await createFrozenWorldStory('当前世界')
    const foreign = await createFrozenWorldStory('其他世界')
    const manifest = JSON.parse(owner.release.manifestJson)
    await expect(generateStoryGameFromWorldRelease({
      scope: owner.scope,
      worldReleaseId: foreign.release.id!,
      narrativeModuleExportId: 0,
    })).rejects.toThrow('不属于当前 World')
    await expect(generateStoryGameFromWorldRelease({
      scope: owner.scope,
      worldReleaseId: owner.release.id!,
      narrativeModuleExportId: Number(manifest.selectedNarrativeModules[0].exportId) + 999,
    })).rejects.toThrow('不在该 WorldRelease')
    await expect(createGameDefinition({
      scope: owner.scope,
      gameKey: 'forged-source',
      title: '伪造来源',
      narrativeModuleId: owner.module.id!,
      productType: 'storygame',
      sourceWorldContentHash: owner.release.contentHash,
      sourceMappingVersion: 1,
      sourceSelectionJson: JSON.stringify({ productType: 'avg', worldContentHash: owner.release.contentHash }),
    })).rejects.toThrow('来源选择与游戏定义不一致')

    const generated = await generateStoryGameFromWorldRelease({
      scope: owner.scope,
      worldReleaseId: owner.release.id!,
      narrativeModuleExportId: manifest.selectedNarrativeModules[0].exportId,
    })
    const revisionCount = await db.worldRevisions.where('worldId').equals(owner.scope.worldId).count()
    await db.gameDefinitions.update(generated.definition.id!, {
      sourceSelectionJson: JSON.stringify({
        ...generated.source,
        characterExportIds: [-1],
      }),
    })
    await expect(publishStoryGameDraft({
      scope: owner.scope,
      gameDefinitionId: generated.definition.id!,
    })).rejects.toThrow('世界来源便携引用无效')
    expect(await db.worldRevisions.where('worldId').equals(owner.scope.worldId).count()).toBe(revisionCount)
  })
})
