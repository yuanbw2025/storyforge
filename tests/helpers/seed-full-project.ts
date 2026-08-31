/**
 * 全量项目种子 · 测试共享 helper
 *
 * 覆盖全部 exportable 表 + 双世界组 + 树 + 各类外键。
 * 供 R-export-fullcoverage(往返安全网)与 R-export-derive-equivalence(派生等价性)共用。
 */
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { replayAgentRunEventsV1, toAgentRunProjectionBodyV1 } from '../../src/lib/agent/run/projection'
import { createNarrativeSimulationAcceptanceContent } from '../../src/lib/narrative-simulation/authoring'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import {
  confirmAdaptationBrief,
  confirmAdaptationPlan,
  confirmComicVisualBible,
  createAdaptation,
  listActiveSourceUnits,
  saveAdaptationBriefDraft,
  saveAdaptationPlanDraft,
  startAdaptationProduction,
} from '../../src/lib/adaptation/source-manifest'
import { createScreenplayScene } from '../../src/lib/screenplay/service'
import { createComicPage, saveComicVisualSubject } from '../../src/lib/comic/service'
import { commitUploadedComicAssetV1 } from '../../src/lib/comic/media-service'
import type {
  AdaptationBriefV1,
  AdaptationPlanV1,
  AnyAgentRunEventV1,
  ComicTargetSpecV1,
  GameProductionBriefV3,
  ScreenplayTargetSpecV1,
  WorkspaceScope,
} from '../../src/lib/types'
import { hashGameProductionValueV2 } from '../../src/lib/game-production/hash'
import { GAME_BROWSER_PERFORMANCE_POLICY_V1 } from '../../src/lib/game-production/browser-performance'
import { recordGameBrowserPerformanceMeasurementV1 } from '../../src/lib/game-production/quality-receipts'
import { createStoryForgeRulePackV1 } from '../../src/lib/ttrpg/storyforge-rule-pack'
import { hashCharacterInteractionProductReleaseManifestV1 } from '../../src/lib/character-interaction/production-pipeline'

const now = 1_700_000_000_000 // 固定时间戳,保证派生/手写两版导出可逐字段比对

const adaptationBrief: AdaptationBriefV1 = {
  version: 1,
  coreTheme: '选择与代价',
  dominantEmotion: '克制',
  mustKeep: ['青云山门的抉择'],
  mayCut: [],
  mayMerge: [],
  mayReorder: [],
  allowedAdditions: [],
  audience: '大众',
  rating: 'PG-13',
  targetScale: '全表往返夹具',
  narrativePerspective: '林惊羽',
  timeBudget: '',
  costLimit: '',
  deviationNotes: '',
  unresolvedQuestions: [],
  assumptions: [],
}

const screenplayTargetSpec: ScreenplayTargetSpecV1 = {
  format: 'film',
  language: 'zh-CN',
  episodeCount: null,
  targetMinutesPerEpisode: 90,
  rating: 'PG-13',
  dialogueDensity: 'balanced',
  productionScale: 'standard',
  preserveVoiceOver: false,
  titlePage: {
    creditLine: '小说改编',
    authorDisplayName: '全量夹具',
    contactText: '',
    copyrightNotice: '测试用途',
    draftLabel: '第一稿',
  },
  exportDefaults: ['fountain', 'fdx', 'pdf'],
}

const comicTargetSpec: ComicTargetSpecV1 = {
  format: 'page-comic',
  audience: '大众',
  readingDirection: 'ltr',
  chapterCount: 1,
  targetPagesPerChapter: 20,
  pageSize: { width: 1200, height: 1700, unit: 'px', bleed: 30 },
  colorMode: 'color',
  artStyleBrief: '清晰线稿与克制配色',
  renderCandidatesPerPanel: 2,
  imageCapabilityRequirement: {
    referenceImage: false,
    deterministicSeed: false,
    inpainting: false,
    commercialUseRequired: false,
    minimumWidth: 1024,
    minimumHeight: 1024,
  },
}

function fixturePng(width = 1200, height = 1700): ArrayBuffer {
  const bytes = new Uint8Array(32)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}

async function seedAdaptationProducts(sourceScope: WorkspaceScope) {
  const screenplay = await createAdaptation({
    sourceScope,
    sourceWorkId: sourceScope.workId,
    title: '青云山门 · 剧本',
    sourceSelection: { mode: 'entire-work' },
    medium: 'screenplay',
    targetSpec: screenplayTargetSpec,
  })
  const screenplayUnit = (await listActiveSourceUnits(screenplay.adaptation.id!))
    .find(unit => unit.sourceKind === 'chapter')
  if (!screenplayUnit?.id) throw new Error('全量夹具缺少剧本来源章节单元')
  const screenplayPlan: AdaptationPlanV1 = {
    version: 1,
    premise: '林惊羽必须决定复仇还是守护。',
    sections: [{
      stableKey: 'act-1',
      title: '第一幕',
      summary: '踏入山门并遭遇抉择。',
      order: 0,
      episodeNumber: 1,
      sourceUnitKeys: [screenplayUnit.sourceUnitKey],
    }],
    globalAssumptions: [],
  }
  let screenplayRoot = await saveAdaptationBriefDraft({ adaptationProjectId: screenplay.adaptation.id!, brief: adaptationBrief, expectedRevision: screenplay.adaptation.revision })
  screenplayRoot = await confirmAdaptationBrief({ adaptationProjectId: screenplayRoot.id!, expectedRevision: screenplayRoot.revision })
  screenplayRoot = await saveAdaptationPlanDraft({ adaptationProjectId: screenplayRoot.id!, plan: screenplayPlan, expectedRevision: screenplayRoot.revision })
  screenplayRoot = await confirmAdaptationPlan({ adaptationProjectId: screenplayRoot.id!, expectedRevision: screenplayRoot.revision })
  screenplayRoot = await startAdaptationProduction({ adaptationProjectId: screenplayRoot.id!, expectedRevision: screenplayRoot.revision })
  const screenplayScene = await createScreenplayScene(screenplay.scope, {
    stableKey: 'scene-1',
    planSectionKey: 'act-1',
    episodeNumber: 1,
    sceneNumber: 1,
    intExt: 'EXT',
    location: '青云山门',
    timeOfDay: '晨',
    summary: '林惊羽踏入山门。',
    estimatedSeconds: 45,
    sourceUnitIds: [screenplayUnit.id],
    blocks: [{ id: 'action-1', type: 'action', text: '云海散开，青云山门出现在林惊羽面前。' }],
  })

  const comic = await createAdaptation({
    sourceScope,
    sourceWorkId: sourceScope.workId,
    title: '青云山门 · 漫画',
    sourceSelection: { mode: 'entire-work' },
    medium: 'comic',
    targetSpec: comicTargetSpec,
  })
  const comicUnit = (await listActiveSourceUnits(comic.adaptation.id!))
    .find(unit => unit.sourceKind === 'chapter')
  if (!comicUnit?.id) throw new Error('全量夹具缺少漫画来源章节单元')
  const comicPlan: AdaptationPlanV1 = {
    version: 1,
    premise: '用一页建立山门与人物的力量关系。',
    sections: [{
      stableKey: 'comic-chapter-1',
      title: '山门',
      summary: '主人公第一次看见青云山。',
      order: 0,
      episodeNumber: 1,
      sourceUnitKeys: [comicUnit.sourceUnitKey],
    }],
    globalAssumptions: [],
  }
  let comicRoot = await saveAdaptationBriefDraft({ adaptationProjectId: comic.adaptation.id!, brief: adaptationBrief, expectedRevision: comic.adaptation.revision })
  comicRoot = await confirmAdaptationBrief({ adaptationProjectId: comicRoot.id!, expectedRevision: comicRoot.revision })
  comicRoot = await saveAdaptationPlanDraft({ adaptationProjectId: comicRoot.id!, plan: comicPlan, expectedRevision: comicRoot.revision })
  comicRoot = await confirmAdaptationPlan({ adaptationProjectId: comicRoot.id!, expectedRevision: comicRoot.revision })
  comicRoot = await confirmComicVisualBible({
    adaptationProjectId: comicRoot.id!,
    expectedRevision: comicRoot.revision,
    visualBible: {
      version: 1,
      artDirection: '东方奇幻页漫',
      linework: '清晰有重量的墨线',
      palette: ['青灰', '金色'],
      lighting: '晨雾逆光',
      periodAndMaterials: '古典山门与石阶',
      cameraLanguage: ['先建立镜头，再切人物近景'],
      prohibitedDepictions: ['成图不含文字与水印'],
    },
  })
  comicRoot = await startAdaptationProduction({ adaptationProjectId: comicRoot.id!, expectedRevision: comicRoot.revision })
  const styleSubject = await saveComicVisualSubject({
    scope: comic.scope,
    draft: {
      stableKey: 'fixture-style',
      kind: 'style',
      characterId: null,
      locationRefKey: null,
      label: '青云视觉风格',
      design: {
        description: '晨雾中的东方奇幻山门',
        silhouette: '层叠山峰与高耸牌楼',
        facialFeatures: '',
        hairAndCostume: '',
        palette: ['青灰', '金色'],
        materials: ['青石', '木构'],
        distinguishingMarks: ['云海金边'],
        prohibitedChanges: ['不得改成现代建筑'],
      },
      sourceUnitIds: [comicUnit.id],
      status: 'reviewed',
    },
  })
  const comicPage = await createComicPage(comic.scope, {
    stableKey: 'page-1',
    chapterNumber: 1,
    summary: '林惊羽踏入青云山门。',
    panels: [{
      stableKey: 'page-1-panel-1',
      frame: { x: 0, y: 0, width: 1, height: 1 },
      shot: { size: 'wide', angle: 'low', movement: 'static', composition: '人物位于山门前景下方' },
      action: '林惊羽仰望云海中的青云山门。',
      visualPrompt: 'eastern fantasy mountain gate in morning mist, no text',
      negativePrompt: 'letters, watermark, logo',
      continuityRefs: [{ subjectKey: styleSubject.stableKey, note: '保持青灰与金色主调' }],
      lettering: [{
        id: 'caption-1',
        kind: 'caption',
        text: '青云山。',
        frame: { x: 0.05, y: 0.05, width: 0.3, height: 0.12 },
        direction: 'horizontal',
        fontFamily: 'storyforge-serif',
        fontSize: 28,
        textColor: '#111111',
        fillColor: '#ffffff',
        strokeColor: '#111111',
        strokeWidth: 2,
        tail: null,
        zIndex: 1,
      }],
      sourceUnitIds: [comicUnit.id],
    }],
  })
  const comicMedia = await commitUploadedComicAssetV1({
    scope: comic.scope,
    data: fixturePng(),
    panelId: comicPage.panels[0].id!,
    rights: {
      version: 1,
      source: 'author-upload',
      commercialUse: 'allowed',
      redistribution: 'allowed',
      attribution: 'StoryForge 全量夹具',
      declaration: '测试夹具确认拥有该测试图片的完整使用权。',
      declaredAt: Date.now(),
    },
  })
  return { screenplay, screenplayRoot, screenplayScene, comic, comicRoot, comicPage, comicMedia }
}

/** 种子:每张 exportable 表至少一行,带双世界组 + 树 + 各类外键。返回各源 id 便于断言。 */
export async function seedFullProject() {
  const projectId = await db.projects.add({
    name: '全量作品', genre: 'fantasy', genres: ['fantasy'], description: '全表往返',
    targetWordCount: 100000, enableMultiWorld: true, createdAt: now, updatedAt: now,
  } as any) as number

  // ── WORLD-2C C1 显式世界/作品根 ──
  const worldId = await db.worlds.add({
    projectId,
    code: 'world-full-fixture',
    name: '全量世界',
    description: '全表往返世界根',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    code: 'work-full-fixture',
    title: '全量作品',
    description: '全表往返作品根',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100000,
    kind: 'novel',
    novelProfile: 'long',
    createdAt: now,
    updatedAt: now,
  }) as number

  // ── 双世界组(order 决定导出序) ──
  const wgA = await db.worldGroups.add({ projectId, name: '主世界群', order: 0, createdAt: now, updatedAt: now } as any) as number
  const wgB = await db.worldGroups.add({ projectId, name: '镜世界群', order: 1, createdAt: now, updatedAt: now } as any) as number
  await db.worldGroupLinks.add({ projectId, fromGroupId: wgA, toGroupId: wgB, type: 'portal', createdAt: now, updatedAt: now } as any)

  // ── worldScoped 设定表(挂 wgA / wgB,验证 worldGroupId 重映射) ──
  await db.worldviews.add({ projectId, worldGroupId: wgA, worldOrigin: '混沌创世', powerHierarchy: '炼气→金丹', createdAt: now, updatedAt: now } as any)
  await db.worldviews.add({ projectId, worldGroupId: wgB, worldOrigin: '镜中倒影', createdAt: now, updatedAt: now } as any)
  await db.storyCores.add({ projectId, logline: '少年逆袭', mainPlot: '从山村到仙界', createdAt: now, updatedAt: now } as any)
  await db.powerSystems.add({ projectId, worldGroupId: wgA, name: '修真体系', description: '九重天', createdAt: now, updatedAt: now } as any)
  await db.geographies.add({ projectId, worldGroupId: wgA, overview: '三大洲', createdAt: now, updatedAt: now } as any)
  await db.histories.add({ projectId, worldGroupId: wgA, summary: '上古神战', createdAt: now, updatedAt: now } as any)
  await db.historicalTimelineEvents.add({ projectId, worldGroupId: wgA, title: '封神之战', year: -1000, createdAt: now, updatedAt: now } as any)
  await db.historicalKeywords.add({ projectId, worldGroupId: wgA, keyword: '神器', createdAt: now, updatedAt: now } as any)
  await db.worldRulesProfiles.add({ projectId, worldGroupId: wgA, rules: '魔法守恒', createdAt: now, updatedAt: now } as any)
  const cultivationSystem = await db.cultivationSystems.add({
    projectId, worldGroupId: wgA, name: '青云剑修', description: '以灵气淬剑',
    stages: JSON.stringify([
      { id: 'qi', name: '炼气', parentStageIds: [] },
      { id: 'foundation', name: '筑基', parentStageIds: ['qi'], breakthrough: '筑成道基' },
    ]),
    createdAt: now, updatedAt: now,
  }) as number

  // ── worldNodes(树 + portalsJSON 自引用,wgA) ──
  const rootWorld = await db.worldNodes.add({ projectId, worldGroupId: wgA, parentId: null, name: '主世界', description: '起点', sortOrder: 0, createdAt: now, updatedAt: now } as any) as number
  const mirrorWorld = await db.worldNodes.add({ projectId, worldGroupId: wgA, parentId: rootWorld, name: '镜界', description: '镜中', sortOrder: 1, createdAt: now, updatedAt: now } as any) as number
  await db.worldNodes.update(rootWorld, { portalsJSON: JSON.stringify([{ name: '镜门', targetWorldId: mirrorWorld, x: 1, y: 2 }]) })

  // ── importantLocations(树) ──
  const locParent = await db.importantLocations.add({ projectId, parentId: null, name: '青云山', type: 'mountain', createdAt: now, updatedAt: now } as any) as number
  await db.importantLocations.add({ projectId, parentId: locParent, name: '青云峰', type: 'peak', createdAt: now, updatedAt: now } as any)

  // ── 角色(homeWorldScoped:一个挂 wgA,一个跨世界) ──
  const char1 = await db.characters.add({
    projectId, homeWorldGroupId: wgA, name: '林惊羽', role: 'protagonist', personality: '坚毅',
    cultivationSystemId: cultivationSystem, cultivationStageId: 'qi',
    createdAt: now, updatedAt: now,
  } as any) as number
  const char2 = await db.characters.add({ projectId, isCrossWorld: true, name: '苏长歌', role: 'supporting', createdAt: now, updatedAt: now } as any) as number
  await db.characterRelations.add({ projectId, fromCharacterId: char1, toCharacterId: char2, type: 'ally', description: '同门', createdAt: now, updatedAt: now } as any)
  await db.workCharacterBindings.add({
    projectId,
    workId,
    characterId: char1,
    role: 'protagonist',
    arc: '从复仇者到守护者',
    createdAt: now,
    updatedAt: now,
  })
  const characterDrivenPlan = await db.characterDrivenPlans.add({
    projectId,
    name: '林惊羽角色驱动方案',
    arcs: JSON.stringify([{
      characterId: char1,
      name: '林惊羽',
      role: '主角',
      initialState: '孤身复仇',
      targetState: '守护同门',
    }]),
    userHint: '服务复仇主线',
    generatedVolumes: '[]',
    status: 'draft',
    version: 1,
    parentPlanId: null,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.works.update(workId, { activeCharacterDrivenPlanId: characterDrivenPlan })
  await db.projects.update(projectId, {
    activeCharacterDrivenPlanId: characterDrivenPlan,
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
    worldCode: 'world-full-fixture',
    worldVersion: 1,
  })

  // ── 大纲(树,wgA)+ 章节 + 细纲 + 情感卡 ──
  const vol = await db.outlineNodes.add({ projectId, worldGroupId: wgA, parentId: null, type: 'volume', title: '第一卷', summary: '开篇', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chapNode = await db.outlineNodes.add({ projectId, worldGroupId: wgA, parentId: vol, type: 'chapter', title: '第1章', summary: '觉醒', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chapter = await db.chapters.add({ projectId, outlineNodeId: chapNode, title: '第1章', content: '<p>废墟中睁眼</p>', wordCount: 6, status: 'draft', order: 0, createdAt: now, updatedAt: now } as any) as number
  await db.detailedOutlines.add({ projectId, outlineNodeId: chapNode, openingHook: '承接', endingCliffhanger: '黑影', appearingCharacterIds: [char1], scenes: [{ sceneId: 's1', title: '苏醒', summary: '醒来', characterIds: [char1], location: '废墟', conflict: '失忆' }], createdAt: now, updatedAt: now } as any)

  // ── WORLD-2D/2E 可执行叙事与不可变发布 ──
  const narrativeModule = await db.narrativeModules.add({
    projectId,
    kind: 'main',
    title: '青云主线',
    description: '从山门启程',
    status: 'ready',
    sourceProjection: 'outline',
    sourceRefId: chapNode,
    entryNodeKey: 'entry',
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.narrativeNodes.add({
    projectId,
    moduleId: narrativeModule,
    key: 'entry',
    kind: 'entry',
    title: '踏入山门',
    summary: '从主线入口开始',
    conditionJson: '{}',
    effectsJson: '[]',
    successorKeysJson: '[]',
    sourceOutlineNodeId: chapNode,
    order: 0,
    createdAt: now,
    updatedAt: now,
  })
  await db.narrativeNodes.add({
    projectId, moduleId: narrativeModule, key: 'ending', kind: 'ending',
    title: '抵达青云峰', summary: '全表往返结局', conditionJson: '{}', effectsJson: '[]',
    successorKeysJson: '[]', sourceOutlineNodeId: chapNode, order: 1, createdAt: now, updatedAt: now,
  })
  await db.narrativeBeats.add({
    projectId, moduleId: narrativeModule, nodeKey: 'entry', beatKey: 'arrival', kind: 'narration',
    speakerCharacterId: null, text: '林惊羽踏入青云山门。', order: 0, createdAt: now, updatedAt: now,
  })
  await db.narrativeChoices.add({
    projectId, moduleId: narrativeModule, sourceNodeKey: 'entry', choiceKey: 'climb',
    text: '登上青云峰', description: '', unavailableReason: '', targetNodeKey: 'ending',
    displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tagsJson: '[]',
    order: 0, createdAt: now, updatedAt: now,
  })
  await db.works.update(workId, { activeNarrativeModuleId: narrativeModule })
  const releaseManifest = JSON.stringify({
    schema: 'storyforge.world-package',
    version: 2,
    worldCode: 'world-full-fixture',
    worldName: '全量世界',
    workTitle: '全量作品',
    selectedTables: ['narrativeModules', 'narrativeNodes'],
    selectedNarrativeModules: [{ exportId: 0, kind: 'main', title: '青云主线' }],
    dependencies: [],
    records: {},
    portableProject: {},
  })
  const worldRevision = await db.worldRevisions.add({
    projectId,
    worldId,
    parentRevisionId: null,
    revision: 1,
    label: '初始修订',
    manifestJson: releaseManifest,
    contentHash: 'fixture-release-hash',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldRelease = await db.worldReleases.add({
    projectId,
    worldId,
    revisionId: worldRevision,
    version: 1,
    label: '世界 v1',
    manifestJson: releaseManifest,
    contentHash: 'fixture-release-hash',
    sourceWorldCode: 'world-full-fixture',
    createdAt: now,
  } as any) as number
  const worldDerivation = await db.worldDerivations.add({
    projectId,
    worldId,
    sourceWorkspaceUid: 'fixture:independent-long-novel',
    sourceWorkCode: 'work-full-fixture',
    sourceWorkRevision: now,
    sourceRevisionVectorJson: canonicalStringify({
      schema: 'fixture.workspace-content-revision',
      version: 1,
      capturedAt: now,
      tables: [],
    }),
    sourceKind: 'long-novel',
    sourceRangeJson: canonicalStringify({ kind: 'all-confirmed-canon' }),
    selectedResourceIdsJson: canonicalStringify(['story-core', 'narrative']),
    sourceContentHash: await hashCanonicalValue({
      sourceWorkspaceUid: 'fixture:independent-long-novel',
      sourceWorkCode: 'work-full-fixture',
      sourceWorkRevision: now,
    }),
    targetRevisionId: worldRevision,
    targetReleaseId: worldRelease,
    createdAt: now,
  }) as number
  const worldReleaseMigrationClassification = {
    version: 1,
    contract: 'legacy-mixed',
    migrationRequired: true,
    tables: [{
      table: 'gameDefinitions',
      role: 'product-content',
      rowCount: 1,
      byteSize: 128,
      contentHash: await hashCanonicalValue([{ gameKey: 'legacy-full-fixture' }]),
    }],
    totals: {
      'world-semantic': { tableCount: 0, rowCount: 0, byteSize: 0 },
      'product-content': { tableCount: 1, rowCount: 1, byteSize: 128 },
      'product-media': { tableCount: 0, rowCount: 0, byteSize: 0 },
      runtime: { tableCount: 0, rowCount: 0, byteSize: 0 },
      infrastructure: { tableCount: 0, rowCount: 0, byteSize: 0 },
      unknown: { tableCount: 0, rowCount: 0, byteSize: 0 },
    },
  }
  const worldReleaseMigration = await db.worldReleaseMigrations.add({
    projectId,
    worldId,
    sourcePackageId: 'fixture:legacy-mixed-world-package',
    sourceWorldCode: 'world-full-fixture',
    sourceWorldVersion: 0,
    classificationJson: canonicalStringify(worldReleaseMigrationClassification),
    semanticReleaseId: worldRelease,
    semanticContentHash: 'fixture-release-hash',
    productRecoveryWorkspaceUid: 'fixture:legacy-product-recovery',
    productRecoveryContentHash: await hashCanonicalValue({ fixture: 'legacy-product-recovery' }),
    createdAt: now,
  }) as number
  const gameDefinition = await db.gameDefinitions.add({
    projectId, worldId, workId, gameKey: 'full-fixture-story', productType: 'storygame',
    title: '青云山门', description: '全表往返游戏定义', status: 'draft',
    narrativeModuleId: narrativeModule, enabledCapabilitiesJson: '["narrative"]',
    initialVariablesJson: '{}', rulesetVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  const interactionCharacterProfile = await db.interactionCharacterProfiles.add({
    projectId, worldId, workId, gameDefinitionId: gameDefinition, characterId: char1,
    participantKey: 'lin-jingyu', roleLabel: '同行守门人', voiceRules: '克制、直接，不泄露未获知的秘密。',
    initialKnowledgeJson: JSON.stringify([
      { key: 'mountain.gate', content: '青云山门将在日落时关闭。', visibility: 'public', importance: 2 },
      { key: 'hidden.oath', content: '林惊羽曾在镜界立下秘密誓言。', visibility: 'private', importance: 5 },
    ]),
    relationshipDimensionsJson: JSON.stringify([
      { key: 'trust', label: '信任', minimum: -10, maximum: 10, initial: 1, largeChangeThreshold: 3 },
    ]),
    maxMemoryEntries: 24, createdAt: now, updatedAt: now,
  }) as number
  const interactionSceneTemplate = await db.interactionSceneTemplates.add({
    projectId, worldId, workId, gameDefinitionId: gameDefinition,
    sceneKey: 'mountain-gate-reunion', title: '山门重逢', purpose: '确认双方是否仍愿意同行。',
    location: '青云山门', timeLabel: '日落前', participantKeysJson: '["lin-jingyu"]',
    publicKnowledgeKeysJson: '["mountain.gate"]', goalsJson: '["完成重逢"]',
    endingConditionsJson: '["承诺同行或明确拒绝"]', safetyBoundariesJson: '["不替玩家决定情感"]',
    openingNodeKey: 'entry', endingNodeKey: 'ending', maxTurns: 20, directorBudget: 1,
    order: 0, createdAt: now, updatedAt: now,
  }) as number
  const gameRelease = await db.gameReleases.add({
    projectId, worldId, workId, gameDefinitionId: gameDefinition, worldReleaseId: worldRelease,
    version: 1, label: '青云山门 v1',
    manifestJson: JSON.stringify({ schema: 'storyforge.game-release', version: 1 }),
    contentHash: 'fixture-game-release-hash', createdAt: now,
  }) as number

  // ── CHATGAME-3C 角色互动专属来源 / Production / Brief 谱系 ──
  const characterInteractionProduction = await db.characterInteractionProductions.add({
    projectId, worldId, workId,
    productionKey: 'full-fixture-character-interaction',
    title: '青云山门角色互动', status: 'brief-confirmed',
    activeSourceSelectionId: null, activeBriefId: null, currentProductReleaseId: null,
    createdAt: now, updatedAt: now,
  }) as number
  const characterInteractionSelectionValue = {
    schema: 'storyforge.character-interaction-world-source-selection', version: 1,
    productType: 'character-interaction', contractVersion: 1,
    worldReleaseId: worldRelease, sourceWorldCode: 'world-full-fixture',
    worldContentHash: 'fixture-release-hash', sourceWorldExportId: 0,
    sourceWorkExportId: 0, sourceMappingVersion: 1,
    participantCharacterExportIds: [0], recordSelections: [], guestCharacterKeys: [],
    selectionHash: '1'.repeat(64),
  }
  const characterInteractionSelectionHash = await hashCanonicalValue(characterInteractionSelectionValue)
  const characterInteractionSourceSelection = await db.characterInteractionSourceSelections.add({
    projectId, worldId, workId, productionId: characterInteractionProduction,
    revision: 1, status: 'frozen', sourceWorldReleaseId: worldRelease,
    selectionJson: canonicalStringify(characterInteractionSelectionValue),
    selectionHash: characterInteractionSelectionHash,
    worldContentHash: 'fixture-release-hash', createdAt: now,
  }) as number
  const characterInteractionBriefValue = {
    schema: 'storyforge.character-interaction-brief', version: 1,
    productType: 'character-interaction', contractVersion: 1,
    source: {
      worldReleaseId: worldRelease,
      worldContentHash: 'fixture-release-hash',
      selectionHash: characterInteractionSelectionHash,
    },
    title: '青云山门角色互动', userInstruction: '与林惊羽在山门重逢并决定是否同行。',
    userRole: 'self',
    participants: [{ participantKey: 'world.character.0', source: 'world', displayName: '林惊羽', reason: '核心互动角色' }],
    guests: [],
    setting: {
      storyMode: 'parallel-timeline', timeContext: '日落前', locationContext: '青云山门',
      historicalContext: '世界 v1', chatGoal: '确认是否同行', desiredDirections: ['建立信任'],
      safetyBoundaries: ['不替用户决定情感'],
    },
    knowledgePolicy: { publicKnowledge: ['山门即将关闭'], privateKnowledge: [], prohibitedDisclosure: ['镜界誓言'] },
    relationshipPolicy: { dimensions: ['trust'], largeChangeNeedsEvidence: true },
    runtime: { sceneCount: 1, maxTurnsPerScene: 12, directorBudget: 2, endingStrategy: 'user-decides' },
    media: { tier: 'text-core' },
    worldFeedback: { allowCandidate: true, autoWriteback: false },
  }
  const characterInteractionBriefHash = await hashCanonicalValue(characterInteractionBriefValue)
  const characterInteractionRunContract = {
    schema: 'storyforge.character-interaction-production-run-contract', version: 1,
    productType: 'character-interaction', contractVersion: 1,
    sourceWorldReleaseId: worldRelease,
    sourceSelectionHash: characterInteractionSelectionHash,
    briefHash: characterInteractionBriefHash,
    allowedContextSourceKeys: ['characterInteractionProduction'],
    allowedSteps: ['character-capsules', 'knowledge-and-relationship-seeds', 'scene-plan', 'narrative-links', 'media-bible', 'integration', 'counterexample-validation', 'author-preview'],
    writeMode: 'candidate-only', worldWritebackAllowed: false, formalMediaWriteAllowed: false,
    requiredHumanConfirmations: ['author-preview'],
  }
  const characterInteractionBrief = await db.characterInteractionBriefs.add({
    projectId, worldId, workId, productionId: characterInteractionProduction,
    sourceSelectionId: characterInteractionSourceSelection, revision: 1, status: 'confirmed',
    briefJson: canonicalStringify(characterInteractionBriefValue),
    briefHash: characterInteractionBriefHash,
    runContractJson: canonicalStringify(characterInteractionRunContract),
    runContractHash: await hashCanonicalValue(characterInteractionRunContract),
    confirmedAt: now, createdAt: now,
  }) as number
  await db.characterInteractionProductions.update(characterInteractionProduction, {
    activeSourceSelectionId: characterInteractionSourceSelection,
    activeBriefId: characterInteractionBrief,
  })
  const characterInteractionArtifactPayload = {
    schema: 'storyforge.character-interaction-character-capsules', version: 1,
    capsules: [{
      participantKey: 'world.character.0', characterKey: 'release-character:0', name: '林惊羽',
      source: 'world', roleLabel: '核心互动角色', identitySummary: '青云山门守门人',
      voiceRules: '克制、直接', publicStance: '愿意同行', privateAnchor: '守住镜界誓言', maxMemoryEntries: 24,
    }],
  }
  const characterInteractionArtifactHash = await hashCanonicalValue(characterInteractionArtifactPayload)
  const characterInteractionArtifact = await db.characterInteractionArtifacts.add({
    projectId, worldId, workId, productionId: characterInteractionProduction,
    stepKey: 'character-capsules', artifactKey: 'character-capsules', revision: 1,
    kind: 'character-capsules', status: 'confirmed', sourceSelectionHash: characterInteractionSelectionHash,
    briefHash: characterInteractionBriefHash, dependencyHash: await hashCanonicalValue([]),
    payloadJson: canonicalStringify(characterInteractionArtifactPayload), payloadHash: characterInteractionArtifactHash,
    producerRunId: null, sourceSessionId: null,
    confirmationJson: canonicalStringify({ authorConfirmed: true, confirmedAt: now }), createdAt: now, confirmedAt: now,
  }) as number
  await db.characterInteractionProductionSteps.add({
    projectId, worldId, workId, productionId: characterInteractionProduction,
    stepKey: 'character-capsules', attempt: 1, status: 'confirmed', inputHash: '2'.repeat(64),
    candidateArtifactId: characterInteractionArtifact, confirmedArtifactId: characterInteractionArtifact,
    producerRunId: null,
    checkpointJson: canonicalStringify({ artifactKey: 'character-capsules', revision: 1, payloadHash: characterInteractionArtifactHash }),
    errorJson: null, startedAt: now, completedAt: now, updatedAt: now,
  })
  await db.characterInteractionMediaAssets.add({
    projectId, worldId, workId, productionId: characterInteractionProduction,
    slotKey: 'portrait:world.character.0', assetKey: 'portrait.world.character.0', version: 1,
    kind: 'portrait', targetRef: 'world.character.0', productionRequired: true, status: 'planned',
    specJson: canonicalStringify({ schema: 'fixture.character-interaction-media-slot', version: 1 }),
    specHash: '3'.repeat(64), fallbackText: '林惊羽（文字头像）', altText: '林惊羽的角色头像',
    blobObjectId: null, mimeType: null, byteSize: 0, contentHash: null, producerRunId: null,
    rightsJson: canonicalStringify({ status: 'unresolved' }), failureJson: null, createdAt: now, updatedAt: now,
  })
  const characterInteractionProductReleaseManifest = {
    schema: 'storyforge.character-interaction-product-release' as const, version: 1 as const,
    productType: 'character-interaction' as const, releaseVersion: 1,
    source: {
      worldReleaseId: worldRelease, worldContentHash: 'fixture-release-hash',
      selectionHash: characterInteractionSelectionHash, selection: characterInteractionSelectionValue,
    },
    brief: { content: characterInteractionBriefValue as any, contentHash: characterInteractionBriefHash },
    artifacts: [{ artifactKey: 'character-capsules', kind: 'character-capsules' as const, payload: characterInteractionArtifactPayload, payloadHash: characterInteractionArtifactHash }],
    media: [],
    gameRelease: { contentHash: 'fixture-game-release-hash' },
    integrity: { artifactManifestHash: '4'.repeat(64), mediaManifestHash: await hashCanonicalValue([]), releaseInputHash: '5'.repeat(64) },
    compatibility: { productionContract: 1 as const, runtimeProtocol: 1 as const, minimumPlayerVersion: 1 as const },
    createdAt: now,
  }
  const characterInteractionProductRelease = await db.characterInteractionProductReleases.add({
    projectId, worldId, workId, productionId: characterInteractionProduction,
    sourceSelectionId: characterInteractionSourceSelection, sourceWorldReleaseId: worldRelease,
    briefId: characterInteractionBrief, gameReleaseId: gameRelease, version: 1,
    label: '青云山门角色互动 v1', manifestJson: canonicalStringify(characterInteractionProductReleaseManifest),
    contentHash: await hashCharacterInteractionProductReleaseManifestV1(characterInteractionProductReleaseManifest), createdAt: now,
  }) as number
  await db.characterInteractionProductions.update(characterInteractionProduction, {
    currentProductReleaseId: characterInteractionProductRelease,
  })
  const adventureGameDefinition = await db.gameDefinitions.add({
    projectId, worldId, workId, gameKey: 'full-fixture-adventure', productType: 'adventure',
    title: '青云山门 · 冒险版', description: '全表往返文字冒险定义', status: 'draft',
    narrativeModuleId: narrativeModule, enabledCapabilitiesJson: '["narrative","adventure"]',
    initialVariablesJson: '{}', rulesetVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  await db.adventureModules.add({
    projectId, worldId, workId, gameDefinitionId: adventureGameDefinition,
    contentJson: JSON.stringify({
      version: 1, initialLocationKey: 'gate', playerKey: 'player',
      locations: [{ key: 'gate', title: '青云山门', description: '山门前云雾缭绕。', tags: [] }],
      objects: [], items: [], abilities: [], conditions: [], resources: [], quests: [], actions: [], initialInventory: [],
    }),
    createdAt: now, updatedAt: now,
  })
  const avgGameDefinition = await db.gameDefinitions.add({
    projectId, worldId, workId, gameKey: 'full-fixture-avg', productType: 'avg',
    title: '青云山门 · 演出版', description: '全表往返 AVG 定义', status: 'draft',
    narrativeModuleId: narrativeModule, enabledCapabilitiesJson: '["narrative","presentation"]',
    initialVariablesJson: '{}', rulesetVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  await db.avgPresentationModules.add({
    projectId, worldId, workId, gameDefinitionId: avgGameDefinition,
    contentJson: JSON.stringify({ version: 1, cues: [] }), createdAt: now, updatedAt: now,
  })
  const narrativeSimulationDefinition = await db.gameDefinitions.add({
    projectId, worldId, workId, gameKey: 'full-fixture-narrative-simulation',
    productType: 'narrative-simulation', title: '青云山门 · 治理模拟',
    description: '全表往返叙事模拟定义', status: 'draft', narrativeModuleId: narrativeModule,
    enabledCapabilitiesJson: '["narrative","simulation"]', initialVariablesJson: '{}',
    rulesetVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  await db.narrativeSimulationModules.add({
    projectId, worldId, workId, gameDefinitionId: narrativeSimulationDefinition,
    contentJson: JSON.stringify(createNarrativeSimulationAcceptanceContent()), createdAt: now, updatedAt: now,
  })
  const openWorldGameDefinition = await db.gameDefinitions.add({
    projectId, worldId, workId, gameKey: 'full-fixture-open-world', productType: 'text-open-world',
    title: '青云山门 · 开放世界', description: '全表往返开放世界定义', status: 'draft',
    narrativeModuleId: narrativeModule,
    enabledCapabilitiesJson: '["narrative","interaction","adventure","simulation","open-world"]',
    initialVariablesJson: '{}', rulesetVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  await db.openWorldModules.add({
    projectId, worldId, workId, gameDefinitionId: openWorldGameDefinition,
    contentJson: JSON.stringify({ version: 1, regions: [] }), createdAt: now, updatedAt: now,
  })
  const avgMediaData = new TextEncoder().encode('full-fixture-avg-media').buffer
  const avgMediaDigest = await crypto.subtle.digest('SHA-256', avgMediaData)
  const avgMediaHash = Array.from(new Uint8Array(avgMediaDigest), byte => byte.toString(16).padStart(2, '0')).join('')
  const avgMediaAsset = await db.avgMediaAssets.add({
    projectId, worldId, workId, assetKey: 'fixture.background', version: 1, kind: 'background',
    name: '全表往返背景', mimeType: 'image/svg+xml', byteSize: avgMediaData.byteLength,
    width: 320, height: 180, durationMs: null, contentHash: avgMediaHash,
    source: 'StoryForge test fixture', license: 'CC0 test fixture', altText: '青云山门测试背景',
    characterTag: '', sceneTag: 'gate', createdAt: now, updatedAt: now,
  }) as number
  await db.avgMediaBlobs.add({
    projectId, worldId, workId, mediaAssetId: avgMediaAsset, data: avgMediaData, createdAt: now,
  })
  await db.emotionBeatCards.add({ projectId, chapterId: chapter, overallArc: '低落→振奋', beats: '[]', createdAt: now, updatedAt: now } as any)
  await db.cultivationProgress.add({
    projectId,
    worldGroupId: wgA,
    characterId: char1,
    characterName: '林惊羽',
    cultivationSystemId: cultivationSystem,
    cultivationSystemName: '青云剑修',
    stageId: 'qi',
    stageName: '炼气',
    transition: 'enter',
    sourceChapterId: chapter,
    sourceChapterTitle: '第1章',
    sourceQuote: '废墟中睁眼',
    sourceOffset: 0,
    trigger: '苏醒',
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  })

  // ── 下游产物 ──
  await db.foreshadows.add({ projectId, name: '神秘玉佩', type: 'item', status: 'planted', description: '身世之谜', createdAt: now, updatedAt: now } as any)
  const storyArc = await db.storyArcs.add({
    projectId, type: 'main', name: '复仇线', stages: '[]', createdAt: now, updatedAt: now,
  } as any) as number
  await db.storylineProgress.add({
    projectId,
    arcId: storyArc,
    currentStageId: null,
    status: 'active',
    progressNote: '主角已开始追查旧案',
    lastActiveChapterId: chapter,
    lastActiveChapterTitle: '第1章',
    involvedEntities: JSON.stringify(['林惊羽']),
    evidenceQuote: '废墟中睁眼',
    createdAt: now,
    updatedAt: now,
  })
  // 全表 FK 往返种子复用同一 Arc 覆盖 A/B 两个字段；“两端必须不同”的产品约束
  // 由 storyline-progress 领域解析/采纳测试单独锁定。
  await db.storylineCrossings.add({
    projectId,
    arcIdA: storyArc,
    arcIdB: storyArc,
    chapterId: chapter,
    chapterTitle: '第1章',
    note: '全表往返 FK 覆盖种子',
    evidenceQuote: '废墟中睁眼',
    createdAt: now,
    updatedAt: now,
  })
  await db.stateCards.add({ projectId, category: 'character', entityName: '林惊羽', fields: JSON.stringify([{ key: '境界', value: '炼气一层' }]), createdAt: now, updatedAt: now } as any)
  await db.itemLedger.add({ projectId, itemName: '青锋剑', heldByName: '林惊羽', characterId: char1, action: 'gain', quantity: 1, chapterId: chapter, chapterTitle: '第1章', createdAt: now, updatedAt: now } as any)
  await db.storyTimelineEvents.add({ projectId, chapterId: chapter, title: '获得青锋剑', createdAt: now, updatedAt: now } as any)
  await db.notes.add({ projectId, title: '灵感', content: '记一笔', createdAt: now, updatedAt: now } as any)

  // ── 参考书 + 分块分析(creativeRules 引用 reference) ──
  const ref1 = await db.references.add({ projectId, title: '斗破苍穹', author: '天蚕土豆', type: 'story', note: '参考爽点', createdAt: now, updatedAt: now } as any) as number
  const referenceRun = await db.referenceAnalysisRuns.add({
    projectId, referenceId: ref1, version: 1, status: 'active', depth: 'quick',
    sourceFilename: '斗破苍穹.txt', fileHash: 'full-project-reference', totalChars: 100,
    sourceKind: 'unknown', usageScope: 'analysis-only', rightsNote: '测试种子',
    rightsConfirmed: false, rightsDeclaredAt: now, expectedChunks: 1, completedChunks: 1,
    progress: 100, completedAt: now, activatedAt: now, createdAt: now, updatedAt: now,
  } as any) as number
  await db.referenceChunkAnalysis.add({
    referenceId: ref1, analysisRunId: referenceRun, chunkIndex: 0,
    openingTechnique: '天才陨落钩子', createdAt: now, updatedAt: now,
  } as any)
  await db.creativeRules.add({ projectId, citedReferenceIds: [ref1], content: '多爽点', createdAt: now, updatedAt: now } as any)

  // ── 词条(树,wgA) ──
  const cat = await db.codexCategories.add({ projectId, worldGroupId: wgA, parentId: null, name: '势力', order: 0, createdAt: now, updatedAt: now } as any) as number
  const subCat = await db.codexCategories.add({ projectId, worldGroupId: wgA, parentId: cat, name: '宗门', order: 0, createdAt: now, updatedAt: now } as any) as number
  const codexEntry = await db.codexEntries.add({
    projectId, worldGroupId: wgA, categoryId: subCat, name: '青云宗', summary: '正道魁首',
    importantLocationId: locParent,
    createdAt: now, updatedAt: now,
  } as any) as number
  // 全表 FK 往返只验证 codexEntries ID 重映射；race 类别语义由角色关联测试单独覆盖。
  await db.characters.update(char1, { raceEntryId: codexEntry })

  // ── FB-5 文风画像 ──
  await db.userStyleProfiles.add({ projectId, profile: '简洁明快', enabled: true, createdAt: now, updatedAt: now } as any)

  // ── IDEA-1 / CM-1 增量灵感工作区 ──
  const inspirationFragmentId = 'idea-seed-old-city'
  await db.inspirationWorkspaces.add({
    projectId,
    fragments: JSON.stringify([{
      id: inspirationFragmentId,
      text: '旧城每逢暴雨都会忘记一个人',
      label: '遗忘规则',
      sourceKind: 'author',
      createdAt: now,
    }]),
    versions: JSON.stringify([{
      id: 'idea-version-seed',
      parentVersionId: null,
      mode: 'single',
      fragmentIds: [inspirationFragmentId],
      resultJson: JSON.stringify({ storyCore: { logline: '守塔人保存被雨抹去的名字' } }),
      createdAt: now,
    }]),
    createdAt: now,
    updatedAt: now,
  })

  // ── PLATFORM-2 / AGENT-1 可审计对话事件 ──
  const agentConversation = await db.agentConversations.add({
    projectId,
    worldGroupId: wgA,
    title: '建立主世界与主角',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.agentEvents.add({
    projectId,
    conversationId: agentConversation,
    sequence: 1,
    kind: 'message',
    role: 'user',
    content: '建立主世界与主角',
    payload: '{}',
    createdAt: now,
  })
  const harnessContract = {
    version: 1,
    objective: '生成第一卷卷纲候选',
    workflowKind: 'direct-generation',
    scope: { projectId, worldGroupId: wgA, outlineNodeIds: [vol] },
    permissions: {
      contextSourceKeys: ['worldview', 'storyCore'],
      writeTargets: [{ table: 'outlineNodes', fields: ['summary'], mode: 'candidate-only' }],
    },
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 8_000,
      maxOutputTokens: 2_000,
      maxAttemptsPerStep: 1,
    },
    acceptance: [{ id: 'outline.output', kind: 'output-present', required: true }],
    verificationPlan: [{
      id: 'outline.terminal',
      kind: 'terminal',
      verifier: 'terminal-v1',
      criterionIds: ['outline.output'],
    }],
    failurePolicy: {
      onProtocolError: 'fail',
      onVerificationFailure: 'fail',
      onStaleInput: 'pause-for-author',
    },
  }
  const harnessContractHash = await hashCanonicalValue(harnessContract)
  const agentRun = await db.agentRuns.add({
    projectId,
    workId,
    simulationSessionId: null,
    worldGroupId: wgA,
    conversationId: agentConversation,
    status: 'planned',
    contractVersion: 1,
    contractJson: canonicalStringify(harnessContract),
    contractHash: harnessContractHash,
    generation: 1,
    lastSequence: 0,
    projectionJson: '{}',
    projectionHash: '0'.repeat(64),
    terminalReceiptHash: null,
    createdAt: now,
    updatedAt: now,
  }) as number
  const harnessEvents: AnyAgentRunEventV1[] = [{
    version: 1 as const,
    runId: agentRun,
    sequence: 1,
    generation: 1,
    projectId,
    worldGroupId: wgA,
    contractHash: harnessContractHash,
    type: 'run.created' as const,
    payload: { objectiveHash: await hashCanonicalValue(harnessContract.objective) },
    createdAt: now,
  }, {
    version: 1 as const,
    runId: agentRun,
    sequence: 2,
    generation: 1,
    projectId,
    worldGroupId: wgA,
    contractHash: harnessContractHash,
    type: 'contract.accepted' as const,
    payload: { contractJson: canonicalStringify(harnessContract) },
    createdAt: now,
  }]
  const beforeCheckpoint = replayAgentRunEventsV1(harnessEvents)
  const checkpointProjectionBody = toAgentRunProjectionBodyV1(beforeCheckpoint)
  const checkpointProjectionHash = await hashCanonicalValue(checkpointProjectionBody)
  const checkpointHash = await hashCanonicalValue({
    version: 1,
    generation: 1,
    throughSequence: 2,
    projectionHash: checkpointProjectionHash,
    resumePayloadHash: null,
  })
  const agentRunCheckpoint = await db.agentRunCheckpoints.add({
    projectId,
    worldGroupId: wgA,
    runId: agentRun,
    throughSequence: 2,
    generation: 1,
    contractHash: harnessContractHash,
    checkpointHash,
    projectionJson: canonicalStringify(checkpointProjectionBody),
    projectionHash: checkpointProjectionHash,
    resumePayloadJson: null,
    resumePayloadHash: null,
    createdAt: now,
  }) as number
  harnessEvents.push({
    version: 1,
    runId: agentRun,
    sequence: 3,
    generation: 1,
    projectId,
    worldGroupId: wgA,
    contractHash: harnessContractHash,
    type: 'checkpoint.created',
    payload: { throughSequence: 2, checkpointHash },
    createdAt: now,
  })
  await db.agentRunEvents.bulkAdd(harnessEvents.map(event => ({
    projectId: event.projectId,
    worldGroupId: event.worldGroupId,
    runId: event.runId,
    sequence: event.sequence,
    generation: event.generation,
    contractHash: event.contractHash,
    type: event.type,
    payloadJson: canonicalStringify(event.payload),
    createdAt: event.createdAt,
  })))
  const harnessProjection = replayAgentRunEventsV1(harnessEvents)
  const harnessProjectionBody = toAgentRunProjectionBodyV1(harnessProjection)
  await db.agentRuns.update(agentRun, {
    lastSequence: harnessProjection.lastSequence,
    projectionJson: canonicalStringify(harnessProjectionBody),
    projectionHash: await hashCanonicalValue(harnessProjectionBody),
  })
  const exactArtifactContent = '{"fixture":"seed-full-project"}'
  await db.agentRunArtifacts.add({
    projectId,
    artifactKind: 'context-packet',
    contentHash: await sha256Text(exactArtifactContent),
    encoding: 'utf-8',
    byteLength: new TextEncoder().encode(exactArtifactContent).byteLength,
    content: exactArtifactContent,
    retentionState: 'available',
    pruneReceiptJson: null,
    pruneReceiptHash: null,
    createdAt: now,
    updatedAt: now,
  })

  // ── FLOW-2 独立节点文档与可见运行记录 ──
  const nodeFlow = await db.nodeFlows.add({
    projectId,
    worldGroupId: wgA,
    name: '主角生成图',
    description: '全表往返覆盖',
    graphJson: JSON.stringify({
      version: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }),
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.nodeRuns.add({
    projectId,
    flowId: nodeFlow,
    status: 'completed',
    inputSnapshotsJson: JSON.stringify({}),
    nodeResultsJson: JSON.stringify({}),
    startedAt: now,
    updatedAt: now,
    completedAt: now,
  })

  // ── SIM-1 共享互动运行时（父子分支 + 事件 + 检查点） ──
  const simulationParent = await db.simulationSessions.add({
    projectId,
    worldGroupId: wgA,
    worldId,
    workId,
    worldReleaseId: worldRelease,
    narrativeModuleId: narrativeModule,
    draftSnapshotHash: null,
    kind: 'ttrpg',
    title: '青云山战役',
    status: 'active',
    rulesetVersion: 1,
    seed: 'full-project-parent',
    canonSnapshotJson: JSON.stringify({ version: 1, sources: [] }),
    initialStateJson: JSON.stringify({
      version: 1,
      clock: 0,
      entities: {},
      memories: [],
      narratives: [],
      lastSequence: 0,
    }),
    parentSessionId: null,
    parentThroughSequence: null,
    createdAt: now,
    updatedAt: now,
  }) as number
  const simulationChild = await db.simulationSessions.add({
    projectId,
    worldGroupId: wgA,
    worldId,
    workId,
    worldReleaseId: worldRelease,
    narrativeModuleId: narrativeModule,
    draftSnapshotHash: null,
    kind: 'ttrpg',
    title: '青云山战役 · 分支',
    status: 'active',
    rulesetVersion: 1,
    seed: 'full-project-child',
    canonSnapshotJson: JSON.stringify({ version: 1, sources: [] }),
    initialStateJson: JSON.stringify({
      version: 1,
      clock: 0,
      entities: {},
      memories: [],
      narratives: [],
      lastSequence: 0,
    }),
    parentSessionId: simulationParent,
    parentThroughSequence: 0,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.simulationEvents.add({
    projectId,
    worldGroupId: wgA,
    sessionId: simulationChild,
    sequence: 1,
    type: 'narrative.recorded',
    actorKey: null,
    targetKey: null,
    payloadJson: JSON.stringify({ text: '林惊羽踏入青云山门。' }),
    createdAt: now,
  })
  await db.simulationCheckpoints.add({
    projectId,
    worldGroupId: wgA,
    sessionId: simulationChild,
    throughSequence: 1,
    name: '入山',
    stateJson: JSON.stringify({
      version: 1,
      clock: 0,
      entities: {},
      memories: [],
      narratives: [{ eventSequence: 1, text: '林惊羽踏入青云山门。' }],
      lastSequence: 1,
    }),
    stateHash: 'fixture-hash',
    createdAt: now,
  })
  await db.ttrpgSessionParticipants.add({
    projectId, worldGroupId: wgA, worldId, workId, sessionId: simulationParent,
    seatKey: 'player.1', role: 'player', controller: 'human', actorKey: 'release-character:0',
    viewerKey: 'viewer.player.1', assignmentState: 'claimed', humanAssignmentPolicy: 'owner',
    activation: 'manual', substitutionPolicy: 'never', aiProfile: null,
    consent: {
      safetyBoundariesAccepted: true, aiIdentityDisclosed: true, aiAdviceAllowed: false,
      aiSubstitutionAllowed: false, pvpAllowed: false, characterDeathAllowed: false,
      sessionLoggingAllowed: true, generatedPortraitAllowed: false, publicSharingAllowed: false,
    },
    sessionZeroAcceptedAtSequence: null, revision: 1,
    lastCommandId: 'fixture.participant', lastCommandFingerprint: 'fixture.participant',
    createdAt: now, updatedAt: now,
  })
  await db.ttrpgRuntimeAssetRequests.add({
    projectId, worldGroupId: wgA, worldId, workId, sessionId: simulationParent,
    requestKey: 'fixture.runtime-media', slotKey: 'scene.fixture', kind: 'scene', targetRef: 'scene.fixture',
    audience: 'party', requesterViewerKey: 'viewer.player.1', prompt: '全量生命周期测试场景', negativePrompt: '',
    fallbackText: '媒资不可用时继续显示这段文字。', altText: '测试场景图',
    styleBibleHash: '7'.repeat(64), inputHash: '8'.repeat(64), adapterId: 'fixture.media.v1',
    status: 'available', priority: 10, attemptCount: 1, maximumAttempts: 3, maximumSessionCostUsd: 1,
    estimatedCostUsd: 0, costReservationUsd: 0, actualCostUsd: 0, estimatedStorageBytes: avgMediaData.byteLength,
    mediaAssetId: avgMediaAsset, mediaAssetVersion: 1, mediaContentHash: avgMediaHash,
    processorLeaseId: null, processorLeaseExpiresAt: null, lastErrorCode: null, lastErrorDetail: null,
    requestedAtSequence: 0, terminalEventSequence: 1, revision: 2, createdAt: now, updatedAt: now,
  })

  // ── NS-4 时序事实账本（带分类型 FK，供全表往返覆盖） ──
  const temporalFact = await db.temporalFacts.add({ projectId, worldGroupId: wgA, characterId: char1, subjectName: '林惊羽', predicate: 'powerStage', factKind: 'state', value: '炼气一层', sourceType: 'chapter', sourceChapterId: chapter, validFromChapterId: chapter, status: 'confirmed', locked: false, createdAt: now, updatedAt: now } as any) as number

  // ── CONSISTENCY-2 角色认知账本（覆盖角色/章节/世界/事实四类 FK） ──
  await db.knowledgeLedger.add({
    projectId, worldGroupId: wgA, characterId: char1, characterName: '林惊羽',
    knowledgeKey: 'self.power_stage', statement: '林惊羽已达到炼气一层',
    factId: temporalFact, action: 'learn', sourceType: 'chapter', sourceChapterId: chapter,
    sourceQuote: '废墟中睁眼', status: 'confirmed', createdAt: now, updatedAt: now,
  })

  // ── GAMEPROD-1 六表生产控制/证据/共享媒资闭包 ──
  const mediaBlobObject = await db.mediaBlobObjects.add({
    projectId, worldId, workId, contentHash: avgMediaHash, mimeType: 'image/svg+xml',
    byteSize: avgMediaData.byteLength, backend: 'indexeddb', storageState: 'ready',
    data: avgMediaData, opfsPath: null, leaseOwner: null, leaseExpiresAt: null,
    lastVerifiedAt: now, createdAt: now, updatedAt: now,
  }) as number
  await db.avgMediaBlobs.where('mediaAssetId').equals(avgMediaAsset).modify({ blobObjectId: mediaBlobObject })
  const gameProduction = await db.gameProductions.add({
    projectId, worldId, workId, productionKey: 'full-fixture-production', title: '全量生产流程',
    status: 'preview-ready', stateRevision: 3, controlEpoch: 1, currentBriefRevision: 1,
    currentBuildNumber: 1, currentGameDefinitionId: gameDefinition, currentGameReleaseId: gameRelease,
    lastErrorJson: '{}', createdAt: now, updatedAt: now,
  }) as number
  const fixtureWorldContentHash = 'a'.repeat(64)
  const fixtureBrief: GameProductionBriefV3 = {
    schema: 'storyforge.game-production-brief', version: 3,
    source: {
      worldReleaseId: worldRelease, worldContentHash: fixtureWorldContentHash,
      selection: {
        schema: 'storyforge.world-game-source', version: 2, productType: 'storygame',
        worldContentHash: fixtureWorldContentHash, narrativeModuleExportIds: [0],
        characterExportIds: [0], characterRelationExportIds: [], importantLocationExportIds: [],
        artifactExportIds: [], codexEntryExportIds: [], storyArcExportIds: [], avgMediaAssetExportIds: [],
        productSource: { kind: 'storygame', narrativeModuleExportIds: [0] },
      },
      startingPoint: {
        kind: 'mainline', title: '青云山门', summary: '从冻结主线起点开始',
        sourceRefs: ['narrative:0'], protagonistRefs: ['character:0'], openingConflict: '山门将在日落时关闭。',
      },
    },
    intent: {
      productType: 'storygame', playerRole: '扮演林惊羽', protagonistRefs: ['character:0'],
      openingSituation: '在山门关闭前作出选择。', coreExperience: ['选择与后果'],
      requiredFacts: ['山门日落关闭'], forbiddenChanges: ['不得改写冻结世界'],
      contentBoundaries: ['不含未授权露骨内容'], tone: ['克制', '紧张'],
    },
    scale: { scope: 'scene', targetPlayMinutes: 20, targetWordCount: 3_000, targetEndingCount: 2 },
    media: {
      visualLevel: 'none', audioLevel: 'none', imageCount: 0, musicTrackCount: 0,
      sfxCount: 0, voiceLineCount: 0, requiredMediaKinds: [],
    },
    consultationBudget: {
      maximumModelCalls: 2, maximumInputTokens: 20_000, maximumOutputTokens: 5_000, maximumCostUsd: null,
    },
    productionBudget: {
      maximumModelCalls: 10, maximumInputTokens: 100_000, maximumOutputTokens: 30_000,
      maximumCostUsd: null, maximumMediaCalls: 0, maximumDurationMs: 3_600_000,
      maximumStorageBytes: 100_000_000,
    },
    qualityProfile: 'prototype', capabilityRequirements: [],
    externalDataPolicy: {
      allowedDataClasses: ['world-selection'], forbiddenDataClasses: ['api-key'],
      allowReferenceImages: false, allowVoiceScripts: false,
    },
    fallbackPolicy: {
      allowTextOnly: true, allowExistingProjectMedia: true, allowProceduralAudio: true,
      onRequiredCapabilityMissing: 'pause',
    },
    completionContract: {
      requiresPlayablePreview: true, requiredGateIds: ['runtime.playable'],
      minimumMediaCoverage: 0, allowSoftWaivers: true,
    },
    unresolvedDecisionKeys: [],
  }
  const fixtureBriefHash = await hashGameProductionValueV2(fixtureBrief)
  const gameProductionBrief = await db.gameProductionBriefs.add({
    projectId, worldId, workId, productionId: gameProduction, revision: 1, parentRevision: null,
    status: 'authorized', sourceWorldReleaseId: worldRelease, sourceWorldContentHash: fixtureWorldContentHash,
    userIntentSummary: '从主线起点制作一段有画面的文字游戏', unresolvedJson: '[]',
    estimateJson: '{"qualityProfile":"prototype"}', briefJson: JSON.stringify(fixtureBrief),
    briefHash: fixtureBriefHash, authorizedAt: now, createdAt: now,
  }) as number
  const gameProductionCommand = await db.gameProductionCommands.add({
    projectId, worldId, workId, productionId: gameProduction, commandId: 'fixture-preview',
    type: 'request-preview', payloadHash: '2'.repeat(64), expectedStateRevision: 2,
    status: 'succeeded', resultJson: '{"buildNumber":1}', errorCode: null,
    createdAt: now, completedAt: now,
  }) as number
  const gameBuild = await db.gameBuilds.add({
    projectId, worldId, workId, productionId: gameProduction, buildNumber: 1, briefRevision: 1,
    briefHash: fixtureBriefHash, parentBuildNumber: null, sourceGameReleaseId: null,
    status: 'preview-ready', resumeState: null, stateRevision: 4, controlEpoch: 1,
    planRevision: 1, planJson: '{"version":1}', planHash: '3'.repeat(64), budgetLedgerJson: '{}',
    manifestJson: '{"version":2}', manifestHash: '4'.repeat(64), packageHash: '5'.repeat(64),
    previewManifestJson: '{"version":1}', previewHash: '6'.repeat(64),
    qualityReportJson: '{"valid":true}', qualityReportHash: '7'.repeat(64), compatibilityJson: '{}',
    rootTerminalReceiptHash: null, adoptionIntentHash: null, adoptedGameDefinitionId: null,
    releasedGameReleaseId: null, failureJson: '{}', authorizedAt: now, startedAt: now,
    completedAt: now, createdAt: now, updatedAt: now,
  }) as number
  const gameQualityGateReceipt = await recordGameBrowserPerformanceMeasurementV1({
    scope: { projectId, worldId, workId },
    gameBuildId: gameBuild,
    measurement: {
      browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
      viewport: { width: 1440, height: 900 },
      packageHash: '5'.repeat(64), previewHash: '6'.repeat(64),
      firstInteractiveBytes: 2 * 1024 * 1024,
      cachedSceneLatenciesMs: Array.from({ length: 20 }, (_, index) => 40 + index),
      choiceInputLatenciesMs: Array.from({ length: 20 }, (_, index) => 20 + index),
      memorySamples: [
        { elapsedMs: GAME_BROWSER_PERFORMANCE_POLICY_V1.warmupDurationMs, usedHeapBytes: 100 * 1024 * 1024 },
        { elapsedMs: GAME_BROWSER_PERFORMANCE_POLICY_V1.minimumLongRunDurationMs, usedHeapBytes: 108 * 1024 * 1024 },
      ],
      measuredAt: now,
    },
  })
  const productionAgentRunSnapshot = await createAgentRunV1({
    scope: { projectId, worldId, workId },
    gameBuildId: gameBuild,
    now,
    contract: {
      version: 1,
      objective: '验证全量项目中的生产 Build Run 便携生命周期',
      workflowKind: 'long-running-resumable',
      scope: {
        projectId,
        worldGroupId: null,
        gameProduction: {
          gameBuildId: gameBuild,
          buildNumber: 1,
          controlEpoch: 1,
          planHash: '3'.repeat(64),
          taskKey: '$root',
        },
      },
      permissions: {
        contextSourceKeys: ['game-production.brief'],
        writeTargets: [{
          table: 'gameBuilds',
          fields: [],
          mode: 'candidate-only',
          adoptionExtension: 'game-production-builds',
        }],
      },
      dependencyReceiptPolicy: {
        requiredForJoin: true,
        verifierSetVersion: 'game-production-root-v1',
      },
      budget: {
        maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 1,
        maxOutputTokens: 1, maxAttemptsPerStep: 1,
      },
      acceptance: [
        { id: 'game-production.children', kind: 'deterministic-check', required: true },
        { id: 'game-production.package', kind: 'gate-passed', required: true },
      ],
      verificationPlan: [{
        id: 'game-production.root-terminal', kind: 'terminal',
        verifier: 'game-production-root-v1',
        criterionIds: ['game-production.children', 'game-production.package'],
      }],
      failurePolicy: {
        onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author',
      },
    },
  })
  const productionAgentRun = productionAgentRunSnapshot.run.id
  const gameBuildArtifact = await db.gameBuildArtifacts.add({
    projectId, worldId, workId, buildId: gameBuild, artifactKey: 'visual.background.full-fixture',
    requirementKey: 'visual.background', version: 1, kind: 'image', mediaKind: 'background',
    status: 'accepted', producerRunId: productionAgentRun, producerReceiptHash: null, controlEpoch: 1,
    inputHash: '8'.repeat(64), contentHash: avgMediaHash, payloadJson: '{}', metadataJson: '{}',
    qualityJson: '{"valid":true}', rightsJson: '{"status":"cleared"}', blobObjectId: mediaBlobObject,
    mimeType: 'image/svg+xml', byteSize: avgMediaData.byteLength, parentArtifactHash: null,
    carriedFrom: null, createdAt: now, updatedAt: now,
  }) as number

  // ── TTRPG-2A RulePack / CampaignPack 作者闭包 ──
  const fixtureRulePack = createStoryForgeRulePackV1()
  const gameRulePack = await db.gameRulePacks.add({
    projectId, worldId, workId,
    ruleSystemId: fixtureRulePack.ruleSystemId,
    ruleSystemVersion: fixtureRulePack.ruleSystemVersion,
    title: fixtureRulePack.title,
    status: 'validated',
    rulePackJson: JSON.stringify(fixtureRulePack),
    contentHash: await hashGameProductionValueV2(fixtureRulePack),
    createdAt: now,
    updatedAt: now,
  }) as number
  const fixtureCampaign = {
    schema: 'storyforge.ttrpg-campaign', version: 1,
    campaignKey: 'full-fixture-campaign', title: '全量跑团战役',
    sourceWorld: { contentHash: 'world-release-hash', bundleHash: '9'.repeat(64) },
  }
  const ttrpgCampaignModule = await db.ttrpgCampaignModules.add({
    projectId, worldId, workId,
    campaignKey: fixtureCampaign.campaignKey,
    title: fixtureCampaign.title,
    status: 'draft',
    sourceWorldReleaseId: worldRelease,
    rulePackId: gameRulePack,
    contentJson: JSON.stringify(fixtureCampaign),
    contentHash: await hashGameProductionValueV2(fixtureCampaign),
    createdAt: now,
    updatedAt: now,
  }) as number

  // ── TTRPG-4B 产品专属来源 / Brief / 步骤 / Build / Release 谱系 ──
  const ttrpgProduction = await db.ttrpgProductions.add({
    projectId, worldId, workId, productionKey: 'full-fixture-ttrpg-production', title: '全量跑团产品生产',
    status: 'released', activeSourceSelectionId: null, activeBriefId: null,
    currentBuildId: null, currentProductReleaseId: null, createdAt: now, updatedAt: now,
  }) as number
  const ttrpgSourceCatalog = { schema: 'fixture.ttrpg-source', version: 1, title: '全量正式来源' }
  const ttrpgSelection = { schema: 'fixture.ttrpg-selection', version: 1, sourceKey: 'full-fixture-source' }
  const ttrpgSourceSelection = await db.ttrpgSourceSelections.add({
    projectId, worldId, workId, productionId: ttrpgProduction, revision: 1,
    sourceKind: 'world-release', developmentOnly: false, sourceWorldReleaseId: worldRelease,
    sourceKey: 'full-fixture-source', sourceContentHash: 'a'.repeat(64),
    sourceCatalogJson: JSON.stringify(ttrpgSourceCatalog),
    sourceCatalogHash: await hashGameProductionValueV2(ttrpgSourceCatalog),
    selectionJson: JSON.stringify(ttrpgSelection), selectionHash: await hashGameProductionValueV2(ttrpgSelection),
    status: 'frozen', createdAt: now,
  }) as number
  const ttrpgBriefValue = { schema: 'fixture.ttrpg-brief', version: 1, title: '全量 Brief' }
  const ttrpgProductionBrief = await db.ttrpgProductionBriefs.add({
    projectId, worldId, workId, productionId: ttrpgProduction, sourceSelectionId: ttrpgSourceSelection,
    revision: 1, briefJson: JSON.stringify(ttrpgBriefValue),
    briefHash: await hashGameProductionValueV2(ttrpgBriefValue), status: 'confirmed', createdAt: now,
  }) as number
  await db.ttrpgProductionSteps.add({
    projectId, worldId, workId, productionId: ttrpgProduction, buildId: null, stepKey: 'author-preview', attempt: 1,
    status: 'completed', inputHash: 'b'.repeat(64), outputHash: 'c'.repeat(64),
    checkpointJson: '{"accepted":true}', errorJson: null,
    startedAt: now, completedAt: now, updatedAt: now,
  })
  const ttrpgBuildValue = { rulePack: fixtureRulePack, campaign: fixtureCampaign }
  const ttrpgProductionBuild = await db.ttrpgProductionBuilds.add({
    projectId, worldId, workId, productionId: ttrpgProduction,
    sourceSelectionId: ttrpgSourceSelection, briefId: ttrpgProductionBrief, buildNumber: 1,
    status: 'release-ready', developmentOnly: false,
    rulePackJson: JSON.stringify(fixtureRulePack), rulePackHash: await hashGameProductionValueV2(fixtureRulePack),
    campaignJson: JSON.stringify(fixtureCampaign), campaignHash: await hashGameProductionValueV2(fixtureCampaign),
    validationJson: '{"valid":true}', buildHash: await hashGameProductionValueV2(ttrpgBuildValue),
    errorJson: null, createdAt: now, updatedAt: now,
  }) as number
  await db.ttrpgProductionMediaAssets.add({
    projectId, worldId, workId, buildId: ttrpgProductionBuild,
    slotKey: 'scene.full-fixture', assetKey: 'scene.full-fixture', version: 1,
    kind: 'scene', targetRef: 'scene.full-fixture', audience: 'party', productionRequired: true,
    status: 'available', specHash: 'd'.repeat(64), prompt: '全量跑团场景素材', negativePrompt: '',
    fallbackText: '全量跑团场景文字降级。', altText: '全量跑团场景图', width: null, height: null,
    blobObjectId: mediaBlobObject, mimeType: 'image/svg+xml', byteSize: avgMediaData.byteLength,
    contentHash: avgMediaHash, producerRunId: null, providerAdapterId: 'fixture.media.v1',
    providerRequestId: 'fixture-request', providerModelId: 'fixture-model', providerReceiptHash: 'e'.repeat(64),
    rightsPolicyVersion: 'fixture-rights-v1', rightsJson: '{"authorConfirmed":true}', failureJson: null,
    createdAt: now, updatedAt: now,
  })
  const ttrpgReleaseManifest = {
    schema: 'fixture.ttrpg-product-release', version: 1,
    source: {
      worldReleaseId: worldRelease,
      sourceContentHash: 'fixture-release-hash',
      sourceCatalogHash: await hashGameProductionValueV2(ttrpgSourceCatalog),
      selection: ttrpgSelection,
    },
    buildHash: await hashGameProductionValueV2(ttrpgBuildValue),
  }
  const ttrpgProductRelease = await db.ttrpgProductReleases.add({
    projectId, worldId, workId, productionId: ttrpgProduction,
    sourceSelectionId: ttrpgSourceSelection, sourceWorldReleaseId: worldRelease,
    briefId: ttrpgProductionBrief, buildId: ttrpgProductionBuild, version: 1,
    label: '全量跑团产品 v1', manifestJson: JSON.stringify(ttrpgReleaseManifest),
    contentHash: await hashGameProductionValueV2(ttrpgReleaseManifest), createdAt: now,
  }) as number
  await db.ttrpgProductions.update(ttrpgProduction, {
    activeSourceSelectionId: ttrpgSourceSelection,
    activeBriefId: ttrpgProductionBrief,
    currentBuildId: ttrpgProductionBuild,
    currentProductReleaseId: ttrpgProductRelease,
  })

  // 旧共享种子最初只带 projectId；在全量备份边界前按 PROJECT_TABLES
  // 为每个受治理记录补齐 v4 World/Work owner，避免物理 ID 或隐式活动作品泄漏。
  for (const spec of PROJECT_TABLES) {
    const locator = spec.domainOwner?.locator
    if (['projects', 'worlds', 'works'].includes(spec.name)) continue
    let rows: any[] = []
    if (spec.owner === 'project') rows = await spec.table.where('projectId').equals(projectId).toArray()
    else if (spec.projectResolver) {
      const parentIds = await spec.projectResolver(projectId)
      const link = (spec.exportRemap ?? []).find(remap => (
        PROJECT_TABLES.find(candidate => candidate.name === remap.remapVia)?.owner === 'project'
      ))
      if (parentIds.length && link) rows = await spec.table.where(link.field).anyOf(parentIds).toArray()
    }
    if (locator?.kind === 'field' && (locator.owner === 'world' || locator.owner === 'work')) {
      for (const row of rows) {
        if (row.id != null && (row as any)[locator.field] == null) {
          await spec.table.update(row.id, { [locator.field]: locator.owner === 'world' ? worldId : workId })
        }
      }
    } else if (locator?.kind === 'exclusive-fields') {
      for (const row of rows) {
        if (row.id != null && (row as any)[locator.worldField] == null && (row as any)[locator.workField] == null) {
          await spec.table.update(row.id, { [locator.workField]: workId, [locator.worldField]: null })
        }
      }
    }
  }

  // 新媒介能力必须与历史 82 表在同一个真实项目中完成严格往返，不能只靠孤立夹具。
  // 先完成旧记录 owner 补齐，再通过正式领域服务创建两个目标 Work 及其来源清单。
  const adaptationProducts = await seedAdaptationProducts({ projectId, worldId, workId })
  // createAdaptation() 模拟真实交互会切换当前 Work；全量夹具的基准身份仍是最早的
  // 小说 Work，因此恢复指针及旧 fixture 的项目兼容镜像，不改变新增目标 Work。
  const mirroredProject = await db.projects.get(projectId) as any
  const restoredProject = {
    ...mirroredProject,
    name: '全量作品',
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '全表往返',
    targetWordCount: 100000,
    activeWorldId: worldId,
    activeWorkId: workId,
    activeCharacterDrivenPlanId: characterDrivenPlan,
    updatedAt: now,
  }
  for (const key of ['status', 'currentWordCount', 'coverImage', 'writingStyleId', 'methodologyId', 'communityOrigin']) delete restoredProject[key]
  await db.projects.put(restoredProject)

  return {
    projectId, wgA, wgB, char1, char2, vol, chapNode, chapter, temporalFact, ref1,
    cat, subCat, rootWorld, mirrorWorld, locParent, cultivationSystem, codexEntry,
    characterDrivenPlan, simulationParent, simulationChild, worldId, workId,
    narrativeModule, worldRevision, worldRelease, worldDerivation, worldReleaseMigration, gameDefinition, gameRelease,
    adventureGameDefinition, avgGameDefinition, narrativeSimulationDefinition, openWorldGameDefinition, avgMediaAsset,
    interactionCharacterProfile, interactionSceneTemplate, agentRun, agentRunCheckpoint,
    characterInteractionProduction, characterInteractionSourceSelection, characterInteractionBrief,
    characterInteractionArtifact, characterInteractionProductRelease,
    gameProduction, gameProductionBrief, gameProductionCommand, gameBuild,
    gameQualityGateReceipt: gameQualityGateReceipt.row.id, gameBuildArtifact, mediaBlobObject,
    productionAgentRun, gameRulePack, ttrpgCampaignModule, ttrpgProduction,
    ttrpgSourceSelection, ttrpgProductionBrief, ttrpgProductionBuild, ttrpgProductRelease,
    adaptationProducts,
  }
}

/** 所有 exportable 的项目级表名(可按 projectId 查;排除 projects 与 direct-child referenceChunkAnalysis) */
export const EXPORTABLE_PROJECT_TABLES = PROJECT_TABLES
  .filter(s => s.exportable && s.name !== 'projects' && s.name !== 'referenceChunkAnalysis')
  .map(s => s.name)
