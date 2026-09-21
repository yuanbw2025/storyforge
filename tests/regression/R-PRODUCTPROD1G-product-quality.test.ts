import { describe, expect, it } from 'vitest'
import type { ProductProductionBriefV3, ProductRuntimePackageV1, ProductionProductKindV1 } from '../../src/lib/types'
import { buildUpperProductModulesV1 } from '../../src/lib/product-production/product-adapters'
import { evaluateProductRuntimeProductQualityV1 } from '../../src/lib/product-production/product-quality'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { compileTextAdventureProductionBriefV1 } from '../../src/lib/adventure/production-brief'
import { TEXT_ADVENTURE_COMMERCIAL_VISUAL_BASELINE_V1 } from '../../src/lib/adventure/media-composition'
import {
  CURRENT_PRODUCT_RESOURCE_KEYS,
  CURRENT_PRODUCT_SOURCE_CATALOG,
  currentProductSelection,
} from '../helpers/current-product-world'
import { createTextAdventureFoundationContentV2 } from '../helpers/text-adventure-v2-foundation'
import { analyzeTextAdventureRouteQualityV1 } from '../../src/lib/adventure/quality-analysis'

const PRODUCTS: ProductionProductKindV1[] = [
  'character-interaction', 'text-adventure', 'avg', 'text-open-world',
]

function brief(productType: ProductionProductKindV1): ProductProductionBriefV3 {
  const hash = 'a'.repeat(64)
  const key = CURRENT_PRODUCT_RESOURCE_KEYS
  const roleBindings = productType === 'character-interaction'
      ? { participants: [key.character], context: [key.story, key.arc] }
      : productType === 'text-adventure'
        ? { characters: [key.character], locations: [key.location], items: [key.artifact], quests: [key.arc] }
        : productType === 'avg'
          ? { story: [key.story, key.arc], characters: [key.character], locations: [key.location] }
          : { characters: [key.character], regions: [key.location], factions: [key.lore], quests: [key.arc] }
  return {
    schema: 'storyforge.product-production-brief', version: 3,
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

function narrative(): ProductRuntimePackageV1['narrative'] {
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

function runtime(productType: ProductionProductKindV1): ProductRuntimePackageV1 {
  const currentBrief = brief(productType)
  const currentNarrative = narrative()
  const modules = buildUpperProductModulesV1({
    brief: currentBrief, narrative: currentNarrative, sourceCatalog: CURRENT_PRODUCT_SOURCE_CATALOG,
  })
  return parseProductRuntimePackageV1({
    schema: 'storyforge.product-runtime-package', version: 1, productType,
    definition: { productKey: `quality.${productType}`, title: '质量门', description: '', enabledCapabilities: modules.enabledCapabilities, rulesetVersion: 1, initialVariables: { productAdapterCommercialReady: modules.commercialReady } },
    sourceWorld: { contentHash: currentBrief.source.worldContentHash, selection: currentBrief.source.selection },
    narrative: currentNarrative,
    ...(modules.interaction ? { interaction: modules.interaction } : {}),
    ...(modules.adventure ? { adventure: modules.adventure } : {}),
    ...(modules.openWorldEvolution ? { openWorldEvolution: modules.openWorldEvolution } : {}),
    ...(modules.openWorld ? { openWorld: modules.openWorld } : {}),
    ...(productType === 'avg' ? { presentation: { version: 1 as const, cues: [], assets: [] } } : {}),
  })
}

describe('PRODUCT-PROD-1G · product-specific quality gates', () => {
  it('四类现行非跑团产品必须各自具备玩法闭环，而非只通过共同 Narrative parser', () => {
    for (const productType of PRODUCTS) {
      const report = evaluateProductRuntimeProductQualityV1({ runtimePackage: runtime(productType), brief: brief(productType) })
      expect(report, `${productType}: ${report.warnings.join(' | ')}`).toMatchObject({ productType, passed: true })
      expect(report.gates.some(item => item.gateId.startsWith(`product.${productType === 'character-interaction' ? 'interaction' : productType === 'text-adventure' ? 'adventure' : productType === 'text-open-world' ? 'open-world' : productType}`))).toBe(true)
    }
  })

  it('删除文字冒险的资源/能力后，产品质量门会失败，即使 Narrative 仍然有效', () => {
    const currentBrief = brief('text-adventure')
    const broken = runtime('text-adventure')
    broken.adventure = { ...broken.adventure!, abilities: [], resources: [] }
    const report = evaluateProductRuntimeProductQualityV1({ runtimePackage: broken, brief: currentBrief })
    expect(report.passed).toBe(false)
    expect(report.gates).toContainEqual(expect.objectContaining({ gateId: 'product.adventure.progression', passed: false }))
  })

  it('公开文案拒绝内部演化指令，即使指令只有中文也不能混入运行包', () => {
    const broken = runtime('text-adventure')
    broken.adventure = createTextAdventureFoundationContentV2()
    broken.definition.description = '质量门 · 本轮演化：返修玩家可见任务文案并重新核对目标。'
    expect(analyzeTextAdventureRouteQualityV1(broken).copyIssues).toContainEqual({
      kind: 'instruction-leak', surfaceKey: 'definition.description',
      excerpt: '质量门 · 本轮演化：返修玩家可见任务文案并重新核对目标。',
    })
  })

  it('任一叙事选择缺少唯一可执行行动时拒绝运行包，不能只验证剩余映射', () => {
    const currentBrief = brief('text-adventure')
    const broken = runtime('text-adventure')
    const foundation = createTextAdventureFoundationContentV2()
    const actionTemplate = foundation.actions.find(action => action.narrativeChoiceKey != null)!
    broken.narrative.choices.forEach(choice => {
      const actionKey = `action.choice.${choice.choiceKey}`
      choice.tags = [`adventure-action:${actionKey}`]
    })
    broken.adventure = {
      ...foundation,
      actions: [
        ...foundation.actions.filter(action => action.narrativeChoiceKey == null),
        ...broken.narrative.choices.map(choice => ({
          ...actionTemplate,
          key: `action.choice.${choice.choiceKey}`,
          narrativeChoiceKey: choice.choiceKey,
        })),
      ],
    }
    const removedChoiceKey = broken.narrative.choices[0].choiceKey
    broken.adventure = {
      ...broken.adventure!,
      actions: broken.adventure!.actions.filter(action => action.narrativeChoiceKey !== removedChoiceKey),
    }
    const report = evaluateProductRuntimeProductQualityV1({ runtimePackage: broken, brief: currentBrief })
    expect(report.gates).toContainEqual(expect.objectContaining({
      gateId: 'product.adventure.v2-choice-bridge',
      passed: false,
      evidence: expect.arrayContaining([
        `unmapped=${removedChoiceKey}`,
        'orphan=none',
        'duplicate=none',
      ]),
    }))

    broken.adventure.actions.push(
      {
        ...actionTemplate,
        key: `action.choice.${removedChoiceKey}`,
        narrativeChoiceKey: removedChoiceKey,
      },
      {
        ...actionTemplate,
        key: `action.choice.${removedChoiceKey}.duplicate`,
        narrativeChoiceKey: removedChoiceKey,
      },
    )
    const duplicateReport = evaluateProductRuntimeProductQualityV1({ runtimePackage: broken, brief: currentBrief })
    expect(duplicateReport.gates).toContainEqual(expect.objectContaining({
      gateId: 'product.adventure.v2-choice-bridge',
      passed: false,
      evidence: expect.arrayContaining([
        'unmapped=none',
        'orphan=none',
        `duplicate=${removedChoiceKey}`,
      ]),
    }))
  })

  it('商业文字冒险不能用十二张泛图冒充封面、地图、角色与关键剧情构成', () => {
    const currentBrief = brief('text-adventure')
    currentBrief.media = {
      ...currentBrief.media, visualLevel: 'key-scenes', imageCount: 12,
    }
    currentBrief.textAdventure = compileTextAdventureProductionBriefV1({
      scale: currentBrief.scale,
      media: currentBrief.media,
      draft: { confirmAll: true },
    })
    const currentRuntime = runtime('text-adventure')
    currentRuntime.adventure = createTextAdventureFoundationContentV2()
    const asset = (index: number, kind: 'background' | 'character-pose' | 'cg', sceneTag: string) => ({
      assetKey: `asset.quality.${index}`, version: 1, kind, name: `质量图片 ${index}`,
      mimeType: 'image/png', byteSize: 1, width: 1280, height: 720, durationMs: null,
      contentHash: String(index + 1).padStart(64, 'a'),
      blobContentHash: String(index + 1).padStart(64, 'a'),
      source: 'quality-fixture', license: 'test-only', altText: `质量图片 ${index}`,
      characterTag: '', sceneTag,
    })
    currentRuntime.presentation = {
      version: 1, cues: [],
      assets: Array.from({ length: 12 }, (_, index) => asset(
        index, index === 1 ? 'character-pose' : 'background', `generic-${index + 1}`,
      )),
    }
    const genericReport = evaluateProductRuntimeProductQualityV1({
      runtimePackage: currentRuntime, brief: currentBrief,
    })
    expect(genericReport.gates).toContainEqual(expect.objectContaining({
      gateId: 'product.adventure.recommendation-media-composition', passed: false,
    }))

    currentRuntime.presentation.assets = TEXT_ADVENTURE_COMMERCIAL_VISUAL_BASELINE_V1.map(
      (role, index) => asset(index, role.mediaKind, role.sceneTag),
    )
    const composedReport = evaluateProductRuntimeProductQualityV1({
      runtimePackage: currentRuntime, brief: currentBrief,
    })
    expect(composedReport.gates).toContainEqual(expect.objectContaining({
      gateId: 'product.adventure.recommendation-media-composition', passed: true,
    }))
  })
})
