import { describe, expect, it } from 'vitest'
import type { ProductProductionBriefV3 } from '../../src/lib/types'
import {
  productPublicCoreExperienceV1,
  productPublicDescriptionV1,
  textAdventurePublicPlayerDescriptionV1,
} from '../../src/lib/product-production/public-copy'

function brief(): ProductProductionBriefV3 {
  return {
    schema: 'storyforge.product-production-brief', version: 3,
    source: {
      worldReleaseId: 1, worldContentHash: 'a'.repeat(64),
      selection: {
        schema: 'storyforge.product-world-source-selection', version: 1,
        productType: 'text-adventure', worldReferenceHash: 'b'.repeat(64),
        resourceKeys: [], roleBindings: {},
      },
      startingPoint: {
        kind: 'mainline', title: '潮钟危机', summary: '三日内修复潮钟。',
        sourceRefs: [], protagonistRefs: [], openingConflict: '雾潮逼近。',
      },
    },
    intent: {
      productType: 'text-adventure', playerRole: '见习守灯人与机械修复师',
      protagonistRefs: [], openingSituation: '雾潮将在三日后吞没群岛。',
      coreExperience: ['探索群岛', '有后果的选择'], requiredFacts: [], forbiddenChanges: [],
      contentBoundaries: ['不得替玩家决定感受'], tone: ['海洋机械奇幻'],
    },
    scale: { scope: 'campaign', targetPlayMinutes: 60, targetWordCount: 12_000, targetEndingCount: 3 },
    media: { visualLevel: 'none', audioLevel: 'none', imageCount: 0, musicTrackCount: 0, sfxCount: 0, voiceLineCount: 0, requiredMediaKinds: [] },
    consultationBudget: { maximumModelCalls: 1, maximumInputTokens: 1_000, maximumOutputTokens: 1_000, maximumCostUsd: null },
    productionBudget: { maximumModelCalls: 1, maximumInputTokens: 1_000, maximumOutputTokens: 1_000, maximumCostUsd: null, maximumMediaCalls: 0, maximumDurationMs: 1_000, maximumStorageBytes: 1_000_000 },
    qualityProfile: 'commercial-candidate', capabilityRequirements: [],
    externalDataPolicy: { allowedDataClasses: ['world-selection'], forbiddenDataClasses: ['api-key'], allowReferenceImages: false, allowVoiceScripts: false },
    fallbackPolicy: { allowTextOnly: true, allowExistingProjectMedia: true, allowProceduralAudio: false, onRequiredCapabilityMissing: 'pause' },
    completionContract: { requiresPlayablePreview: true, requiredGateIds: [], minimumMediaCoverage: 0, allowSoftWaivers: false },
    unresolvedDecisionKeys: [],
  }
}

describe('PRODUCT-PROD-1J · player-visible copy boundary', () => {
  it('保留健康 Brief 的公开体验与开场描述', () => {
    const current = brief()
    expect(productPublicCoreExperienceV1(current)).toEqual(['探索群岛', '有后果的选择'])
    expect(productPublicDescriptionV1({ moduleTitle: '最后的灯火', brief: current }))
      .toBe('最后的灯火 · 探索群岛；有后果的选择')
    expect(textAdventurePublicPlayerDescriptionV1(current)).toBe('雾潮将在三日后吞没群岛。')
  })

  it('旧演化 Brief 的内部目标不会进入产品简介或玩家身份', () => {
    const current = brief()
    const userGoal = '真实试玩发现 sceneKey 与 action label 错位，请逐项返修。'
    current.intent.openingSituation = userGoal
    current.intent.coreExperience.push(`本轮演化：${userGoal}`)
    current.evolution = {
      schema: 'storyforge.product-evolution-impact', version: 1,
      base: { kind: 'build', buildNumber: 96, manifestHash: 'c'.repeat(64) },
      userGoal, affectedLanes: ['content'],
    }
    expect(productPublicCoreExperienceV1(current)).toEqual(['探索群岛', '有后果的选择'])
    expect(productPublicDescriptionV1({ moduleTitle: '最后的灯火', brief: current }))
      .toBe('最后的灯火 · 探索群岛；有后果的选择')
    expect(textAdventurePublicPlayerDescriptionV1(current))
      .toBe('玩家将以见习守灯人与机械修复师的身份进入故事并承担选择的后果。')
  })
})
