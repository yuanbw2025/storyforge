import { describe, expect, it } from 'vitest'
import type { GameProductionBriefV3, GameRuntimePackageV2 } from '../../src/lib/types'
import { buildGameProductModulesV1, type ProductionProductTypeV1 } from '../../src/lib/game-production/product-adapters'
import { evaluateGameRuntimeProductQualityV1 } from '../../src/lib/game-production/product-quality'
import { parseGameRuntimePackageV2 } from '../../src/lib/game-production/runtime-package'
import {
  CURRENT_PRODUCT_RESOURCE_KEYS,
  CURRENT_PRODUCT_SOURCE_CATALOG,
  currentProductSelection,
} from '../helpers/current-product-world'

const PRODUCTS: ProductionProductTypeV1[] = [
  'storygame', 'character-interaction', 'text-adventure', 'avg', 'narrative-simulation', 'text-open-world',
]

function brief(productType: ProductionProductTypeV1): GameProductionBriefV3 {
  const hash = 'a'.repeat(64)
  const key = CURRENT_PRODUCT_RESOURCE_KEYS
  const roleBindings = productType === 'storygame'
    ? { story: [key.story] }
    : productType === 'character-interaction'
      ? { participants: [key.character], context: [key.story, key.arc] }
      : productType === 'text-adventure'
        ? { characters: [key.character], locations: [key.location], items: [key.artifact], quests: [key.arc] }
        : productType === 'avg'
          ? { story: [key.story, key.arc], characters: [key.character], locations: [key.location] }
          : productType === 'narrative-simulation'
            ? { issues: [key.arc], factions: [key.lore], characters: [key.character] }
            : { characters: [key.character], regions: [key.location], factions: [key.lore], quests: [key.arc] }
  return {
    schema: 'storyforge.game-production-brief', version: 3,
    source: {
      worldReleaseId: 1, worldContentHash: hash,
      selection: currentProductSelection(productType, roleBindings),
      startingPoint: {
        kind: 'mainline', title: '主线', summary: '调查并抉择', sourceRefs: [key.story],
        protagonistRefs: [key.character], openingConflict: '危机逼近。',
      },
    },
    intent: {
      productType, playerRole: '调查者', protagonistRefs: [key.character], openingSituation: '危机逼近。',
      coreExperience: ['调查', '抉择'], requiredFacts: [], forbiddenChanges: [], contentBoundaries: ['安全边界'], tone: ['悬疑'],
    },
    scale: { scope: 'scene', targetPlayMinutes: 60, targetWordCount: 8_000, targetEndingCount: 2 },
    media: { visualLevel: 'none', audioLevel: 'none', imageCount: 0, musicTrackCount: 0, sfxCount: 0, voiceLineCount: 0, requiredMediaKinds: [] },
    consultationBudget: { maximumModelCalls: 1, maximumInputTokens: 1_000, maximumOutputTokens: 1_000, maximumCostUsd: null },
    productionBudget: { maximumModelCalls: 1, maximumInputTokens: 1_000, maximumOutputTokens: 1_000, maximumCostUsd: null, maximumMediaCalls: 0, maximumDurationMs: 1_000, maximumStorageBytes: 1_000_000 },
    qualityProfile: 'commercial-candidate', capabilityRequirements: [],
    externalDataPolicy: { allowedDataClasses: ['world-selection'], forbiddenDataClasses: ['api-key'], allowReferenceImages: false, allowVoiceScripts: false },
    fallbackPolicy: { allowTextOnly: true, allowExistingProjectMedia: true, allowProceduralAudio: false, onRequiredCapabilityMissing: 'pause' },
    completionContract: { requiresPlayablePreview: true, requiredGateIds: ['runtime.package.valid'], minimumMediaCoverage: 0, allowSoftWaivers: false },
    unresolvedDecisionKeys: [],
  }
}

function narrative(): GameRuntimePackageV2['narrative'] {
  return {
    moduleKind: 'main', moduleTitle: '质量门', entryNodeKey: 'opening',
    nodes: [
      { key: 'opening', kind: 'entry', title: '开场', summary: '进入现场', conditionJson: '{}', effectsJson: '[]', successorKeys: ['choice'] },
      { key: 'choice', kind: 'choice', title: '抉择', summary: '选择真相', conditionJson: '{}', effectsJson: '[]', successorKeys: ['ending.a', 'ending.b'] },
      { key: 'ending.a', kind: 'ending', title: '公开', summary: '公开真相', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
      { key: 'ending.b', kind: 'ending', title: '保护', summary: '保护同伴', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
    ],
    beats: [
      { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '门打开了。', order: 0 },
      { beatKey: 'beat.choice', nodeKey: 'choice', kind: 'narration', speakerKey: 'character:1', text: '必须选择。', order: 0 },
      { beatKey: 'beat.a', nodeKey: 'ending.a', kind: 'narration', speakerKey: null, text: '真相公开。', order: 0 },
      { beatKey: 'beat.b', nodeKey: 'ending.b', kind: 'narration', speakerKey: null, text: '同伴得救。', order: 0 },
    ],
    choices: [
      { choiceKey: 'enter', sourceNodeKey: 'opening', text: '调查', description: '', unavailableReason: '', targetNodeKey: 'choice', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0 },
      { choiceKey: 'publish', sourceNodeKey: 'choice', text: '公开', description: '', unavailableReason: '', targetNodeKey: 'ending.a', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0 },
      { choiceKey: 'protect', sourceNodeKey: 'choice', text: '保护', description: '', unavailableReason: '', targetNodeKey: 'ending.b', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 1 },
    ],
  }
}

function runtime(productType: ProductionProductTypeV1): GameRuntimePackageV2 {
  const currentBrief = brief(productType)
  const currentNarrative = narrative()
  const modules = buildGameProductModulesV1({
    brief: currentBrief, narrative: currentNarrative, sourceCatalog: CURRENT_PRODUCT_SOURCE_CATALOG,
  })
  return parseGameRuntimePackageV2({
    schema: 'storyforge.game-runtime-package', version: 2, productType,
    definition: { gameKey: `quality.${productType}`, title: '质量门', description: '', enabledCapabilities: modules.enabledCapabilities, rulesetVersion: 1, initialVariables: { productAdapterCommercialReady: modules.commercialReady } },
    sourceWorld: { contentHash: currentBrief.source.worldContentHash, selection: currentBrief.source.selection },
    narrative: currentNarrative,
    ...(modules.interaction ? { interaction: modules.interaction } : {}),
    ...(modules.adventure ? { adventure: modules.adventure } : {}),
    ...(modules.simulation ? { simulation: modules.simulation } : {}),
    ...(modules.openWorld ? { openWorld: modules.openWorld } : {}),
    ...(productType === 'avg' ? { presentation: { version: 1 as const, cues: [], assets: [] } } : {}),
  })
}

describe('GAME-PROD-1G · product-specific quality gates', () => {
  it('六类产品必须各自具备玩法闭环，而非只通过共同 Narrative parser', () => {
    for (const productType of PRODUCTS) {
      const report = evaluateGameRuntimeProductQualityV1({ runtimePackage: runtime(productType), brief: brief(productType) })
      expect(report, `${productType}: ${report.warnings.join(' | ')}`).toMatchObject({ productType, passed: true })
      expect(report.gates.some(item => item.gateId.startsWith(`product.${productType === 'character-interaction' ? 'interaction' : productType === 'text-adventure' ? 'adventure' : productType === 'narrative-simulation' ? 'simulation' : productType === 'text-open-world' ? 'open-world' : productType}`))).toBe(true)
    }
  })

  it('删除文字冒险的资源/能力后，产品质量门会失败，即使 Narrative 仍然有效', () => {
    const currentBrief = brief('text-adventure')
    const broken = runtime('text-adventure')
    broken.adventure = { ...broken.adventure!, abilities: [], resources: [] }
    const report = evaluateGameRuntimeProductQualityV1({ runtimePackage: broken, brief: currentBrief })
    expect(report.passed).toBe(false)
    expect(report.gates).toContainEqual(expect.objectContaining({ gateId: 'product.adventure.progression', passed: false }))
  })
})
