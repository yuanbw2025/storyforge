import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type {
  GameBuildRecordV1,
  GameProductionBriefV3,
  GameRuntimePackageV2,
  ProductSpecificWorldSourceV1,
  WorkspaceScope,
  WorldRelease,
} from '../../src/lib/types'
import {
  buildGameProductModulesV1,
  listGameProductProductionAdaptersV1,
  type ProductionProductTypeV1,
} from '../../src/lib/game-production/product-adapters'
import { parseGameRuntimePackageV2 } from '../../src/lib/game-production/runtime-package'
import { createInitialInteractionState } from '../../src/lib/character-interaction/runtime'
import { applyAdventureEffects, availableAdventureActions, createInitialAdventureState } from '../../src/lib/adventure/runtime'
import {
  availableNarrativeSimulationActions,
  createInitialNarrativeSimulationState,
  planNarrativeSimulationTurn,
} from '../../src/lib/narrative-simulation/runtime'
import { createInitialOpenWorldState, planOpenWorldTravel } from '../../src/lib/open-world/runtime'
import { db } from '../../src/lib/db/schema'
import { createGameBuildPreviewManifestV1 } from '../../src/lib/game-production/preview-manifest'
import { createPlayableGameInstance } from '../../src/lib/world-engine/instances'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { readSimulationState } from '../../src/lib/simulation/runtime'

const PRODUCTS: ProductionProductTypeV1[] = [
  'storygame', 'character-interaction', 'text-adventure', 'avg',
  'narrative-simulation', 'text-open-world',
]

function productSource(productType: ProductionProductTypeV1): ProductSpecificWorldSourceV1 {
  if (productType === 'storygame') return { kind: productType, narrativeModuleExportIds: [1] }
  if (productType === 'character-interaction') return {
    kind: productType, participantCharacterExportIds: [1], sceneKeys: ['production.opening'],
  }
  if (productType === 'text-adventure') return {
    kind: productType, locationExportIds: [1], itemExportIds: [1], questStoryArcExportIds: [1],
  }
  if (productType === 'avg') return { kind: productType, presentationStyle: 'key-scenes', existingMediaAssetExportIds: [] }
  if (productType === 'narrative-simulation') return {
    kind: productType, issueStoryArcExportIds: [1], factionExportIds: [1],
  }
  return { kind: productType, regionLocationExportIds: [1], factionExportIds: [1], questStoryArcExportIds: [1] }
}

function brief(productType: ProductionProductTypeV1): GameProductionBriefV3 {
  const worldContentHash = 'a'.repeat(64)
  return {
    schema: 'storyforge.game-production-brief', version: 3,
    source: {
      worldReleaseId: 1, worldContentHash,
      selection: {
        schema: 'storyforge.world-game-source', version: 2, productType, worldContentHash,
        narrativeModuleExportIds: [1], characterExportIds: [1], characterRelationExportIds: [],
        importantLocationExportIds: [1], artifactExportIds: [1], codexEntryExportIds: [1],
        storyArcExportIds: [1], avgMediaAssetExportIds: [], productSource: productSource(productType),
      },
      startingPoint: {
        kind: 'mainline', title: '冻结主线', summary: '从主线冲突开始', sourceRefs: ['narrative:1'],
        protagonistRefs: ['character:1'], openingConflict: '在潮门关闭前决定公开真相还是保护同伴。',
      },
    },
    intent: {
      productType, playerRole: '守灯人', protagonistRefs: ['character:1'],
      openingSituation: '在潮门关闭前决定公开真相还是保护同伴。',
      coreExperience: ['调查', '抉择', '承担后果'], requiredFacts: [], forbiddenChanges: [],
      contentBoundaries: ['不生成未授权露骨内容'], tone: ['克制', '悬疑'],
    },
    scale: { scope: 'scene', targetPlayMinutes: 15, targetWordCount: 2500, targetEndingCount: 4 },
    media: {
      visualLevel: 'none', audioLevel: 'none', imageCount: 0, musicTrackCount: 0,
      sfxCount: 0, voiceLineCount: 0, requiredMediaKinds: [],
    },
    consultationBudget: { maximumModelCalls: 3, maximumInputTokens: 30_000, maximumOutputTokens: 8_000, maximumCostUsd: null },
    productionBudget: {
      maximumModelCalls: 16, maximumInputTokens: 180_000, maximumOutputTokens: 60_000,
      maximumCostUsd: null, maximumMediaCalls: 1, maximumDurationMs: 3_600_000,
      maximumStorageBytes: 200_000_000,
    },
    qualityProfile: 'internal', capabilityRequirements: [],
    externalDataPolicy: {
      allowedDataClasses: ['world-selection'], forbiddenDataClasses: ['api-key'],
      allowReferenceImages: false, allowVoiceScripts: false,
    },
    fallbackPolicy: {
      allowTextOnly: true, allowExistingProjectMedia: true, allowProceduralAudio: true,
      onRequiredCapabilityMissing: 'pause',
    },
    completionContract: {
      requiresPlayablePreview: true,
      requiredGateIds: ['runtime.package.valid', 'runtime.playable', 'narrative.graph.valid', 'rights.complete'],
      minimumMediaCoverage: 0, allowSoftWaivers: true,
    },
    unresolvedDecisionKeys: [],
  }
}

function narrative(): GameRuntimePackageV2['narrative'] {
  const endingKeys = ['ending.truth', 'ending.shelter', 'ending.depart', 'ending.wait']
  return {
    moduleKind: 'main', moduleTitle: '雾港四路', entryNodeKey: 'opening',
    nodes: [
      { key: 'opening', kind: 'entry', title: '潮门之前', summary: '先进入信号塔调查。', conditionJson: '{}', effectsJson: '[]', successorKeys: ['crossroads'] },
      { key: 'crossroads', kind: 'choice', title: '信号塔抉择', summary: '证据齐全后必须承担选择。', conditionJson: '{}', effectsJson: '[]', successorKeys: endingKeys },
      ...endingKeys.map((key, index) => ({
        key, kind: 'ending' as const, title: `结局 ${index + 1}`, summary: '选择形成不可变后果。',
        conditionJson: '{}', effectsJson: '[]', successorKeys: [],
      })),
    ],
    beats: [
      { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '潮声盖过警铃。', order: 0 },
      { beatKey: 'beat.crossroads', nodeKey: 'crossroads', kind: 'narration', speakerKey: 'character:1', text: '守灯人摊开了最后一份信号记录。', order: 0 },
      ...endingKeys.map((nodeKey, index) => ({
        beatKey: `beat.ending.${index + 1}`, nodeKey, kind: 'narration' as const,
        speakerKey: null, text: `第 ${index + 1} 条道路已经冻结。`, order: 0,
      })),
    ],
    choices: [{
      choiceKey: 'choice.investigate', sourceNodeKey: 'opening', text: '进入信号塔调查',
      description: '先确认冻结证据', unavailableReason: '', targetNodeKey: 'crossroads',
      displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0,
    }, ...endingKeys.map((targetNodeKey, index) => ({
      choiceKey: `choice.${index + 1}`, sourceNodeKey: 'crossroads', text: `选择道路 ${index + 1}`,
      description: '', unavailableReason: '', targetNodeKey,
      displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: index,
    }))],
  }
}

function runtimePackage(productType: ProductionProductTypeV1): GameRuntimePackageV2 {
  const currentBrief = brief(productType)
  const currentNarrative = narrative()
  const modules = buildGameProductModulesV1({ brief: currentBrief, narrative: currentNarrative })
  const pkg: GameRuntimePackageV2 = {
    schema: 'storyforge.game-runtime-package', version: 2, productType,
    definition: {
      gameKey: `preview.${productType}`, title: `Preview ${productType}`, description: '',
      enabledCapabilities: modules.enabledCapabilities, rulesetVersion: 1,
      initialVariables: { productAdapterId: modules.adapterId },
    },
    sourceWorld: { contentHash: currentBrief.source.worldContentHash, selection: currentBrief.source.selection },
    narrative: currentNarrative,
  }
  if (modules.interaction) pkg.interaction = modules.interaction
  if (modules.adventure) pkg.adventure = modules.adventure
  if (modules.simulation) pkg.simulation = modules.simulation
  if (modules.openWorld) pkg.openWorld = modules.openWorld
  if (productType === 'avg') pkg.presentation = { version: 1, cues: [], assets: [] }
  return parseGameRuntimePackageV2(pkg)
}

async function workspace(name: string) {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspacePurpose: 'world-engine', workspacePurposeDecision: 'explicit',
    name, genre: 'interactive-fiction', genres: ['interactive-fiction'], status: 'drafting',
    description: '', targetWordCount: 1, createdAt: now, updatedAt: now,
  } as never) as number
  return ensureWorkspaceOwnership(projectId)
}

async function insertPreviewBuild(input: {
  scope: WorkspaceScope
  sourceWorldRelease: WorldRelease
  runtimePackage: GameRuntimePackageV2
}) {
  const now = Date.now()
  const emptyHash = '0'.repeat(64)
  const manifestHash = 'f'.repeat(64)
  const productionKey = `six-product.${input.runtimePackage.productType}.${crypto.randomUUID()}`
  const productionId = await db.gameProductions.add({
    projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId,
    productionKey, title: input.runtimePackage.definition.title, status: 'preview-ready', stateRevision: 2,
    controlEpoch: 1, currentBriefRevision: 1, currentBuildNumber: 1, currentGameDefinitionId: null,
    currentGameReleaseId: null, lastErrorJson: '{}', createdAt: now, updatedAt: now,
  }) as number
  await db.gameProductionBriefs.add({
    projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId,
    productionId, revision: 1, parentRevision: null, status: 'authorized',
    sourceWorldReleaseId: input.sourceWorldRelease.id!, sourceWorldContentHash: input.sourceWorldRelease.contentHash,
    userIntentSummary: '六产品预览闭环', unresolvedJson: '[]', estimateJson: '{}', briefJson: '{}',
    briefHash: emptyHash, authorizedAt: now, createdAt: now,
  })
  const preview = await createGameBuildPreviewManifestV1({
    productionKey, buildNumber: 1, buildManifestHash: manifestHash,
    runtimePackage: input.runtimePackage,
  })
  const build: GameBuildRecordV1 = {
    projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId,
    productionId, buildNumber: 1, briefRevision: 1, briefHash: emptyHash, parentBuildNumber: null,
    sourceGameReleaseId: null, status: 'preview-ready', resumeState: null, stateRevision: 2, controlEpoch: 1,
    planRevision: 1, planJson: '{}', planHash: emptyHash, budgetLedgerJson: '{}', manifestJson: '{}',
    manifestHash, packageHash: preview.packageHash, previewManifestJson: JSON.stringify(preview),
    previewHash: preview.previewHash, qualityReportJson: '{}', qualityReportHash: emptyHash,
    compatibilityJson: '{}', rootTerminalReceiptHash: emptyHash, adoptionIntentHash: null,
    adoptedGameDefinitionId: null, releasedGameReleaseId: null, failureJson: '{}', authorizedAt: now,
    startedAt: now, completedAt: now, createdAt: now, updatedAt: now,
  }
  const buildId = await db.gameBuilds.add(build) as number
  return { buildId, previewHash: preview.previewHash }
}

describe('R-GAMEPROD-1G · seven-product adapter registry', () => {
  it('六类文字游戏与 TTRPG 共享同一 registry，但未过 Golden 的 TTRPG 不得标商业就绪', () => {
    const catalog = listGameProductProductionAdaptersV1()
    expect(catalog.map(item => item.productType)).toEqual([...PRODUCTS, 'ttrpg'])
    expect(catalog.filter(item => item.commercialReady).map(item => item.productType)).toEqual(PRODUCTS)

    for (const productType of PRODUCTS) {
      const currentBrief = brief(productType)
      const worldContentHash = currentBrief.source.worldContentHash
      const currentNarrative = narrative()
      const modules = buildGameProductModulesV1({ brief: currentBrief, narrative: currentNarrative })
      const pkg: GameRuntimePackageV2 = {
        schema: 'storyforge.game-runtime-package', version: 2, productType,
        definition: {
          gameKey: `registry.${productType}`, title: `Registry ${productType}`, description: '',
          enabledCapabilities: modules.enabledCapabilities, rulesetVersion: 1,
          initialVariables: {
            productAdapterId: modules.adapterId,
            productAdapterCommercialReady: modules.commercialReady,
          },
        },
        sourceWorld: { contentHash: currentBrief.source.worldContentHash, selection: currentBrief.source.selection },
        narrative: currentNarrative,
      }
      if (modules.interaction) pkg.interaction = modules.interaction
      if (modules.adventure) pkg.adventure = modules.adventure
      if (modules.simulation) pkg.simulation = modules.simulation
      if (modules.openWorld) pkg.openWorld = modules.openWorld
      if (productType === 'avg') pkg.presentation = { version: 1, cues: [], assets: [] }
      const parsed = parseGameRuntimePackageV2(pkg)
      expect(parsed).toMatchObject({
        productType,
        definition: { initialVariables: { productAdapterCommercialReady: false } },
      })
      if (parsed.interaction) expect(createInitialInteractionState(parsed.interaction).profiles.length).toBeGreaterThan(0)
      if (parsed.adventure) {
        const initial = createInitialAdventureState(parsed.adventure, worldContentHash)
        expect(initial.currentLocationKey).toBe(parsed.adventure.initialLocationKey)
        const first = availableAdventureActions(parsed.adventure, initial)
          .find(item => item.available && item.action.narrativeChoiceKey != null)!.action
        const moved = applyAdventureEffects(parsed.adventure, initial, first.successEffects, 1)
        expect(moved.currentLocationKey).not.toBe(initial.currentLocationKey)
      }
      if (parsed.simulation) {
        const initial = createInitialNarrativeSimulationState(parsed.simulation, worldContentHash)
        expect(initial.phase).toBe('planning')
        const action = availableNarrativeSimulationActions(parsed.simulation, initial).find(item => item.available)!.action
        const turn = planNarrativeSimulationTurn({
          content: parsed.simulation, state: initial, decisionKeys: [action.key], seed: 'registry', startingSequence: 0,
        })
        expect(turn.projected.turn).toBeGreaterThan(initial.turn)
      }
      if (parsed.openWorld) {
        const initial = createInitialOpenWorldState(parsed.openWorld, worldContentHash)
        expect(initial.currentRegionKey).toBe(parsed.openWorld.initialRegionKey)
        const edge = parsed.openWorld.travelEdges.find(item => item.fromRegionKey === initial.currentRegionKey)!
        const travel = planOpenWorldTravel({ content: parsed.openWorld, state: initial, edgeKey: edge.key, startingSequence: 0 })
        expect(travel.projected.travel?.edgeKey).toBe(edge.key)
      }
      if (parsed.interaction) {
        expect(parsed.interaction.sceneTemplates).toHaveLength(currentNarrative.nodes.filter(node => node.kind !== 'ending').length)
      }
      if (parsed.adventure) {
        expect(parsed.adventure.locations).toHaveLength(currentNarrative.nodes.length)
        expect(parsed.adventure.actions.filter(action => action.narrativeChoiceKey != null)).toHaveLength(currentNarrative.choices.length)
      }
      if (parsed.simulation) {
        expect(parsed.simulation.issues).toHaveLength(currentNarrative.nodes.filter(node => node.kind !== 'ending').length)
        expect(parsed.simulation.actions).toHaveLength(currentNarrative.choices.length)
      }
      if (parsed.openWorld) {
        expect(parsed.openWorld.regions).toHaveLength(currentNarrative.nodes.length)
        expect(parsed.openWorld.travelEdges).toHaveLength(currentNarrative.choices.length)
      }
      expect(JSON.stringify(parsed)).not.toMatch(/十二街区治理录|公共资金|失踪的潮汐钟|固定区域任务/)
    }
  })

  it('TTRPG adapter 必须消费已验证的 RulePack/Campaign compiler 输出', () => {
    expect(() => buildGameProductModulesV1({
      brief: {
        ...brief('storygame'),
        source: {
          ...brief('storygame').source,
          selection: { ...brief('storygame').source.selection, productType: 'ttrpg' },
        },
        intent: { ...brief('storygame').intent, productType: 'ttrpg' },
      },
      narrative: narrative(),
    })).toThrow('缺少已验证 RulePack/Campaign compiler 输出')
  })

  it('正式产品模块消费冻结世界详情，不再把真实角色、地点、道具和势力降级为编号占位符', () => {
    const currentBrief = brief('text-open-world')
    const modules = buildGameProductModulesV1({
      brief: currentBrief,
      narrative: narrative(),
      sourceCatalog: {
        characters: [{ exportId: 1, name: '林舟', description: '谨慎的守灯调查者。' }],
        locations: [{ exportId: 1, name: '雾港灯塔', description: '潮门关闭前仍可进入的调查起点。' }],
        artifacts: [{ exportId: 1, name: '黄铜潮汐钥匙', description: '能够重新启动潮汐钟机。' }],
        loreEntries: [{ exportId: 1, name: '守潮公会', description: '负责维护旧港潮汐设施。' }],
        storyArcs: [{ exportId: 1, name: '失踪船队', description: '求救信号与禁航令的冲突。', type: 'side' }],
      },
    })
    expect(modules.interaction?.profiles[0]).toMatchObject({
      name: '林舟', initialKnowledge: [{ content: expect.stringContaining('谨慎的守灯调查者') }],
    })
    expect(modules.adventure?.locations[0]).toMatchObject({
      title: expect.stringContaining('雾港灯塔'), description: expect.stringContaining('潮门关闭前'),
    })
    expect(modules.adventure?.items).toContainEqual(expect.objectContaining({ title: '黄铜潮汐钥匙' }))
    expect(modules.adventure?.actions).toContainEqual(expect.objectContaining({
      key: 'action.take.source.1', label: '取得：黄铜潮汐钥匙',
    }))
    expect(modules.simulation?.actors).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '林舟', kind: 'actor' }),
      expect.objectContaining({ title: '守潮公会', kind: 'organization' }),
    ]))
    expect(modules.simulation?.issues[0]).toMatchObject({ title: '失踪船队' })
    expect(modules.openWorld?.regions[0].title).toContain('雾港灯塔')
  })

  it('内部预览不能伪装成商业候选；只有显式 commercial-candidate Brief 才打开后续商业 QA 门', () => {
    const internalBrief = brief('storygame')
    const candidateBrief = {
      ...internalBrief,
      qualityProfile: 'commercial-candidate' as const,
    }
    expect(buildGameProductModulesV1({ brief: internalBrief, narrative: narrative() }).commercialReady).toBe(false)
    expect(buildGameProductModulesV1({ brief: candidateBrief, narrative: narrative() }).commercialReady).toBe(true)
  })

  it('需要玩法模块的产品拒绝没有可游玩阶段的结局壳', () => {
    const endingOnly: GameRuntimePackageV2['narrative'] = {
      moduleKind: 'main', moduleTitle: '空壳', entryNodeKey: 'ending.only',
      nodes: [{
        key: 'ending.only', kind: 'ending', title: '直接结束', summary: '',
        conditionJson: '{}', effectsJson: '[]', successorKeys: [],
      }],
      beats: [{
        beatKey: 'beat.ending', nodeKey: 'ending.only', kind: 'narration', speakerKey: null,
        text: '没有可进行的玩法。', order: 0,
      }],
      choices: [],
    }
    expect(() => buildGameProductModulesV1({
      brief: brief('text-adventure'), narrative: endingOnly,
    })).toThrow('至少一个非结局节点')
  })
})

describe('R-GAMEPROD-1H · six-product playable Build Preview', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('六种产品均从不可变 Build Preview 建立正式会话，并初始化各自玩法状态', async () => {
    const owned = await workspace('六产品预览闭环')
    const revision = await createWorldRevision({ scope: owned.scope, label: '六产品冻结来源' })
    const worldRelease = await publishWorldRevision(revision.id!)
    const expectedKinds = {
      storygame: 'storygame',
      'character-interaction': 'chatgame',
      'text-adventure': 'textadventure',
      avg: 'avg',
      'narrative-simulation': 'textsimulation',
      'text-open-world': 'textworld',
    } as const

    for (const productType of PRODUCTS) {
      const pkg = runtimePackage(productType)
      pkg.sourceWorld.contentHash = worldRelease.contentHash
      pkg.sourceWorld.selection.worldContentHash = worldRelease.contentHash
      const build = await insertPreviewBuild({ scope: owned.scope, sourceWorldRelease: worldRelease, runtimePackage: pkg })
      const session = await createPlayableGameInstance({
        scope: owned.scope,
        source: { kind: 'build', gameBuildId: build.buildId, expectedPreviewHash: build.previewHash },
        title: `${productType} 玩家预览`,
      })
      const state = await readSimulationState(session.id!)
      expect(session).toMatchObject({ kind: expectedKinds[productType], gameBuildId: build.buildId, gameReleaseId: null })
      expect(state.narrative).toMatchObject({ currentNodeKey: 'opening', completed: false })
      expect(state.interaction != null).toBe(['character-interaction', 'text-adventure', 'text-open-world'].includes(productType))
      expect(state.adventure != null).toBe(['text-adventure', 'text-open-world'].includes(productType))
      expect(state.presentation != null).toBe(productType === 'avg')
      expect(state.narrativeSimulation != null).toBe(['narrative-simulation', 'text-open-world'].includes(productType))
      expect(state.openWorld != null).toBe(productType === 'text-open-world')
    }
    expect(await db.simulationSessions.count()).toBe(PRODUCTS.length)
  })
})
