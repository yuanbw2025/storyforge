import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { importAvgMediaAsset, publishAvgGame, validateAvgGame } from '../../src/lib/avg/authoring'
import { db } from '../../src/lib/db/schema'
import { addNarrativeNode, createNarrativeModule } from '../../src/lib/narrative/blueprint'
import { readSimulationState } from '../../src/lib/simulation/runtime'
import { addNarrativeBeat, addNarrativeChoice } from '../../src/lib/text-game/content'
import { parseAvgGameReleaseManifest } from '../../src/lib/text-game/releases'
import {
  buildAvgPresentationFromWorldRelease,
  generateAvgGameFromWorldRelease,
  loadWorldGameSourceCatalog,
} from '../../src/lib/text-game/world-generation'
import { createAvgGameInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { publishWorldRevision } from '../../src/lib/world-engine/releases'
import { createLegacyExecutableWorldRevisionFixtureV1 } from '../helpers/legacy-executable-world-release'
import { stampNewRecord } from '../../src/lib/world-engine/scope'

function svg(name: string, color: string): Blob {
  return new Blob([
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="${color}"/><circle cx="640" cy="310" r="170" fill="#d6c28a"/><path d="M0 610 Q320 520 640 610 T1280 610 V720 H0Z" fill="#142c3a"/><title>${name}</title></svg>`,
  ], { type: 'image/svg+xml' })
}

async function avgWorldFixture(withMedia = true) {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspacePurpose: 'world-engine', workspacePurposeDecision: 'explicit',
    name: withMedia ? '雾港 AVG 世界' : '无媒资 AVG 世界', genre: 'mystery', genres: ['mystery'], status: 'drafting',
    description: '世界到 AVG 确定性投影测试', targetWordCount: 30_000, createdAt: now, updatedAt: now,
  } as any) as number
  const owned = await ensureWorkspaceOwnership(projectId)
  const characterId = await db.characters.add(stampNewRecord(owned.scope, 'characters', {
    projectId, name: '守灯人林澈', role: 'protagonist', roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral',
    shortDescription: '在失潮之夜守住雾港灯塔。', appearance: '深蓝风衣与旧铜灯。', personality: '冷静而坚定。',
    background: '从小熟悉潮汐钟的声音。', motivation: '让港口重新看到黎明。', abilities: '辨认潮声', relationships: '[]',
    arc: '从独自承担秘密到相信同伴。', speechStyle: '简短、清晰。', createdAt: now, updatedAt: now,
  } as any, { owner: 'world' })) as number
  const module = await createNarrativeModule({
    scope: owned.scope, owner: 'world', kind: 'main', title: '雾港最后一盏灯',
    description: '失潮之夜，守灯人决定是否重启被封存的潮汐钟。',
  })
  await addNarrativeNode({ scope: owned.scope, moduleId: module.id!, key: 'entry', kind: 'entry', title: '雾港码头', summary: '浓雾吞没码头，灯塔仍亮着。', successorKeys: ['ending'], order: 0 })
  await addNarrativeNode({ scope: owned.scope, moduleId: module.id!, key: 'ending', kind: 'ending', title: '潮声归来', summary: '晨光与潮声一同越过防波堤。', order: 1 })
  await addNarrativeBeat({ scope: owned.scope, moduleId: module.id!, nodeKey: 'entry', beatKey: 'entry.scene', kind: 'narration', text: '雾从海面漫上青石码头。', order: 0 })
  await addNarrativeBeat({ scope: owned.scope, moduleId: module.id!, nodeKey: 'entry', beatKey: 'entry.lin', kind: 'dialogue', speakerCharacterId: characterId, text: '只要灯还亮着，雾港就没有沉没。', order: 1 })
  await addNarrativeBeat({ scope: owned.scope, moduleId: module.id!, nodeKey: 'ending', beatKey: 'ending.dawn', kind: 'narration', text: '第一缕晨光照亮重新转动的钟盘。', order: 0 })
  await addNarrativeChoice({ scope: owned.scope, moduleId: module.id!, sourceNodeKey: 'entry', choiceKey: 'entry.restart', text: '重启潮汐钟', targetNodeKey: 'ending', order: 0 })
  if (withMedia) {
    await importAvgMediaAsset({
      scope: owned.scope, assetKey: 'world.bg.harbor', kind: 'background', name: '雾港码头夜景',
      blob: svg('雾港码头夜景', '#17354a'), altText: '蓝灰色雾港码头与远方灯塔', source: 'StoryForge 雾港演示资产', license: 'CC0', sceneTag: 'entry', width: 1280, height: 720,
    })
    await importAvgMediaAsset({
      scope: owned.scope, assetKey: 'world.actor.lin', kind: 'character-pose', name: '守灯人林澈立绘',
      blob: svg('守灯人林澈立绘', '#24334d'), altText: '身穿深蓝风衣、手持铜灯的守灯人', source: 'StoryForge 雾港演示资产', license: 'CC0', characterTag: '守灯人林澈', width: 720, height: 1080,
    })
    await importAvgMediaAsset({
      scope: owned.scope, assetKey: 'world.cg.dawn', kind: 'cg', name: '潮声归来结局图',
      blob: svg('潮声归来', '#ca8750'), altText: '晨光照亮潮汐钟与防波堤', source: 'StoryForge 雾港演示资产', license: 'CC0', sceneTag: 'ending', width: 1280, height: 720,
    })
  }
  const revision = await createLegacyExecutableWorldRevisionFixtureV1({ scope: owned.scope, label: '雾港 AVG 来源', selectedNarrativeModuleIds: [module.id!] })
  const release = await publishWorldRevision(revision.id!)
  return { ...owned, module, release }
}

describe('WORLDGAME-3 · WorldRelease 到 AVG', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('复用历史叙事投影，但世界工作区中的旧媒资不会进入语义 WorldRelease', async () => {
    const fixture = await avgWorldFixture(true)
    const catalog = await loadWorldGameSourceCatalog({ scope: fixture.scope, worldReleaseId: fixture.release.id! })
    expect(catalog.mediaAssets).toEqual([])
    const narrativeModuleExportId = catalog.narrativeModules[0].exportId
    const pure = buildAvgPresentationFromWorldRelease({ catalog, narrativeModuleExportId })
    expect(pure.content.cues).toEqual([])
    expect(pure.source).toMatchObject({
      productType: 'avg', worldContentHash: fixture.release.contentHash,
      avgMediaAssetExportIds: [],
    })

    const generated = await generateAvgGameFromWorldRelease({
      scope: fixture.scope, worldReleaseId: fixture.release.id!, narrativeModuleExportId,
    })
    expect(generated.definition).toMatchObject({ productType: 'avg', sourceWorldContentHash: fixture.release.contentHash, sourceMappingVersion: 1 })
    const story = await db.gameDefinitions.where('workId').equals(fixture.scope.workId).filter(item => item.productType === 'storygame').first()
    expect(generated.definition.narrativeModuleId).toBe(story?.narrativeModuleId)
    expect(await validateAvgGame(fixture.scope, generated.definition.id!)).toMatchObject({ valid: true })
  })

  it('完成纯文字 AVG 发布和立即试玩，GameRelease 不伪造世界媒资', async () => {
    const fixture = await avgWorldFixture(true)
    const catalog = await loadWorldGameSourceCatalog({ scope: fixture.scope, worldReleaseId: fixture.release.id! })
    const generated = await generateAvgGameFromWorldRelease({
      scope: fixture.scope, worldReleaseId: fixture.release.id!, narrativeModuleExportId: catalog.narrativeModules[0].exportId,
    })
    const publication = await publishAvgGame({ scope: fixture.scope, gameDefinitionId: generated.definition.id! })
    const manifest = parseAvgGameReleaseManifest(publication.gameRelease.manifestJson)
    expect(manifest.definition.source).toMatchObject({
      worldContentHash: fixture.release.contentHash,
      mappingVersion: 1,
      selection: { productType: 'avg', avgMediaAssetExportIds: expect.any(Array) },
    })
    expect(manifest.presentation.assets).toEqual([])
    expect(manifest.presentation.cues).toEqual([])
    const session = await createAvgGameInstance({ scope: fixture.scope, gameReleaseId: publication.gameRelease.id!, title: '评审现场 AVG' })
    expect(await readSimulationState(session.id!)).toMatchObject({
      narrative: { currentNodeKey: 'entry' },
      presentation: { currentNodeKey: 'entry', assets: [] },
    })
  }, 60_000)

  it('语义版本封存后新增产品媒资也不会追写或污染旧 WorldRelease', async () => {
    const fixture = await avgWorldFixture(true)
    const catalog = await loadWorldGameSourceCatalog({ scope: fixture.scope, worldReleaseId: fixture.release.id! })
    expect(catalog.mediaAssets).toEqual([])
    await importAvgMediaAsset({
      scope: fixture.scope,
      assetKey: 'product.bg.after-release',
      kind: 'background',
      name: '产品阶段新增背景',
      blob: svg('不得追写世界版本', '#ff00ff'),
      altText: '产品阶段新增背景',
    })
    const generated = await generateAvgGameFromWorldRelease({
      scope: fixture.scope,
      worldReleaseId: fixture.release.id!,
      narrativeModuleExportId: catalog.narrativeModules[0].exportId,
    })
    expect(generated.warnings.join('')).toContain('纯文字 AVG')
    expect((await loadWorldGameSourceCatalog({
      scope: fixture.scope,
      worldReleaseId: fixture.release.id!,
    })).mediaAssets).toEqual([])
    const publication = await publishAvgGame({ scope: fixture.scope, gameDefinitionId: generated.definition.id! })
    const manifest = parseAvgGameReleaseManifest(publication.gameRelease.manifestJson)
    expect(manifest.presentation.assets).toEqual([])
  })

  it('没有冻结媒资时明确降级为仍可发布试玩的纯文字 AVG', async () => {
    const fixture = await avgWorldFixture(false)
    const catalog = await loadWorldGameSourceCatalog({ scope: fixture.scope, worldReleaseId: fixture.release.id! })
    const generated = await generateAvgGameFromWorldRelease({
      scope: fixture.scope, worldReleaseId: fixture.release.id!, narrativeModuleExportId: catalog.narrativeModules[0].exportId,
    })
    expect(generated.warnings.join('')).toContain('纯文字 AVG')
    const presentation = await db.avgPresentationModules.where('gameDefinitionId').equals(generated.definition.id!).first()
    expect(JSON.parse(presentation!.contentJson).cues).toEqual([])
    await expect(publishAvgGame({ scope: fixture.scope, gameDefinitionId: generated.definition.id! })).resolves.toBeTruthy()
  }, 30_000)
})
