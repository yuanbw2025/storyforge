import { buildGameProductModulesV1 } from '../../src/lib/game-production/product-adapters'
import { parseGameRuntimePackageV2 } from '../../src/lib/game-production/runtime-package'
import type { GameProductionWorldSourceCatalogV2 } from '../../src/lib/game-production/world-source'
import type {
  GameProductionBriefV3,
  GameProductType,
  GameRuntimePackageV2,
  WorldRelease,
} from '../../src/lib/types'
import {
  CURRENT_PRODUCT_RESOURCE_KEYS,
  currentProductSelection,
} from './current-product-world'

function productRoles(productType: GameProductType): Record<string, string[]> {
  const key = CURRENT_PRODUCT_RESOURCE_KEYS
  if (productType === 'storygame') return { story: [key.story] }
  if (productType === 'character-interaction') {
    return { participants: [key.character], context: [key.story, key.arc] }
  }
  if (productType === 'text-adventure') {
    return {
      characters: [key.character],
      locations: [key.location],
      items: [key.artifact],
      quests: [key.arc],
    }
  }
  if (productType === 'avg') {
    return {
      story: [key.story, key.arc],
      characters: [key.character],
      locations: [key.location],
    }
  }
  if (productType === 'narrative-simulation') {
    return {
      issues: [key.arc],
      factions: [key.lore],
      characters: [key.character],
    }
  }
  if (productType === 'text-open-world') {
    return {
      characters: [key.character],
      regions: [key.location],
      items: [key.artifact],
      factions: [key.lore],
      quests: [key.arc],
    }
  }
  return {
    participants: [key.character],
    locations: [key.location],
    items: [key.artifact],
    quests: [key.arc],
  }
}

export function createCurrentNarrativeFixture(): GameRuntimePackageV2['narrative'] {
  const endingKeys = ['ending.truth', 'ending.shelter', 'ending.depart', 'ending.wait']
  return {
    moduleKind: 'main',
    moduleTitle: '雾港四路',
    entryNodeKey: 'opening',
    nodes: [
      {
        key: 'opening', kind: 'entry', title: '潮门之前', summary: '先进入信号塔调查。',
        conditionJson: '{}', effectsJson: '[]', successorKeys: ['crossroads'],
      },
      {
        key: 'crossroads', kind: 'choice', title: '信号塔抉择', summary: '证据齐全后必须承担选择。',
        conditionJson: '{}', effectsJson: '[]', successorKeys: endingKeys,
      },
      ...endingKeys.map((key, index) => ({
        key, kind: 'ending' as const, title: `结局 ${index + 1}`, summary: '选择形成不可变后果。',
        conditionJson: '{}', effectsJson: '[]', successorKeys: [],
      })),
    ],
    beats: [
      {
        beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null,
        text: '潮声盖过警铃。', order: 0,
      },
      {
        beatKey: 'beat.crossroads', nodeKey: 'crossroads', kind: 'narration', speakerKey: null,
        text: '守灯人摊开了最后一份信号记录。', order: 0,
      },
      ...endingKeys.map((nodeKey, index) => ({
        beatKey: `beat.ending.${index + 1}`, nodeKey, kind: 'narration' as const,
        speakerKey: null, text: `第 ${index + 1} 条道路已经冻结。`, order: 0,
      })),
    ],
    choices: [
      {
        choiceKey: 'choice.investigate', sourceNodeKey: 'opening', text: '进入信号塔调查',
        description: '先确认冻结证据', unavailableReason: '', targetNodeKey: 'crossroads',
        displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0,
      },
      ...endingKeys.map((targetNodeKey, index) => ({
        choiceKey: `choice.${index + 1}`, sourceNodeKey: 'crossroads', text: `选择道路 ${index + 1}`,
        description: '', unavailableReason: '', targetNodeKey,
        displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: index,
      })),
    ],
  }
}

export function createCurrentGameBriefFixture(input: {
  productType: GameProductType
  worldRelease: WorldRelease & { id: number }
  sourceCatalog: GameProductionWorldSourceCatalogV2
}): GameProductionBriefV3 {
  const selection = currentProductSelection(
    input.productType,
    productRoles(input.productType),
    input.sourceCatalog.worldReference.referenceHash,
  )
  return {
    schema: 'storyforge.game-production-brief',
    version: 3,
    source: {
      worldReleaseId: input.worldRelease.id,
      worldContentHash: input.worldRelease.contentHash,
      selection,
      startingPoint: {
        kind: 'mainline', title: '冻结主线', summary: '从主线冲突开始',
        sourceRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.story],
        protagonistRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
        openingConflict: '在潮门关闭前决定公开真相还是保护同伴。',
      },
    },
    intent: {
      productType: input.productType,
      playerRole: '守灯人',
      protagonistRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
      openingSituation: '在潮门关闭前决定公开真相还是保护同伴。',
      coreExperience: ['调查', '抉择', '承担后果'],
      requiredFacts: [], forbiddenChanges: [],
      contentBoundaries: ['不生成未授权露骨内容'], tone: ['克制', '悬疑'],
    },
    scale: { scope: 'scene', targetPlayMinutes: 15, targetWordCount: 2_500, targetEndingCount: 4 },
    media: {
      visualLevel: 'none', audioLevel: 'none', imageCount: 0, musicTrackCount: 0,
      sfxCount: 0, voiceLineCount: 0, requiredMediaKinds: [],
    },
    consultationBudget: {
      maximumModelCalls: 3, maximumInputTokens: 30_000, maximumOutputTokens: 8_000,
      maximumCostUsd: null,
    },
    productionBudget: {
      maximumModelCalls: 16, maximumInputTokens: 180_000, maximumOutputTokens: 60_000,
      maximumCostUsd: null, maximumMediaCalls: 1, maximumDurationMs: 3_600_000,
      maximumStorageBytes: 200_000_000,
    },
    qualityProfile: 'internal',
    capabilityRequirements: [],
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

export function createCurrentRuntimePackageFixture(input: {
  productType: Exclude<GameProductType, 'ttrpg'>
  worldRelease: WorldRelease & { id: number }
  sourceCatalog: GameProductionWorldSourceCatalogV2
}): GameRuntimePackageV2 {
  const brief = createCurrentGameBriefFixture(input)
  const narrative = createCurrentNarrativeFixture()
  const modules = buildGameProductModulesV1({
    brief,
    narrative,
    sourceCatalog: input.sourceCatalog,
  })
  const runtimePackage: GameRuntimePackageV2 = {
    schema: 'storyforge.game-runtime-package', version: 2, productType: input.productType,
    definition: {
      gameKey: `current.${input.productType}`, title: `Current ${input.productType}`,
      description: '现行统一 Product Build 运行包。', enabledCapabilities: modules.enabledCapabilities,
      rulesetVersion: 1, initialVariables: { productAdapterId: modules.adapterId },
    },
    sourceWorld: {
      contentHash: input.worldRelease.contentHash,
      selection: brief.source.selection,
    },
    narrative,
  }
  if (modules.interaction) runtimePackage.interaction = modules.interaction
  if (modules.adventure) runtimePackage.adventure = modules.adventure
  if (modules.simulation) runtimePackage.simulation = modules.simulation
  if (modules.openWorld) runtimePackage.openWorld = modules.openWorld
  if (input.productType === 'avg') runtimePackage.presentation = { version: 1, cues: [], assets: [] }
  return parseGameRuntimePackageV2(runtimePackage)
}
