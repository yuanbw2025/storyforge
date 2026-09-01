import { describe, expect, it } from 'vitest'
import { parseGameProductionBriefV3 } from '../../src/lib/game-production/contracts'
import { hashGameProductionValueV2 } from '../../src/lib/game-production/hash'
import {
  createGameProductionPlanV3,
  parseGameProductionPlanV3,
} from '../../src/lib/game-production/plan'
import type { GameProductionBriefV3 } from '../../src/lib/types'
import { CURRENT_PRODUCT_RESOURCE_KEYS, currentProductSelection } from '../helpers/current-product-world'

const HASH = 'a'.repeat(64)

function capability(requirementKey: string, mediaClass: 'text' | 'image' | 'music' | 'sfx') {
  return {
    requirementKey,
    mediaClass,
    operation: 'generate',
    adapterFamily: mediaClass === 'text' ? 'configured-text' : 'configured-media',
    minimumCapabilityVersion: '1',
    allowedDataClasses: ['world-selection'],
    maximumRequestCost: null,
    maximumTotalCost: null,
    rightsPolicyVersion: 'storyforge-rights-v1',
    capabilityHash: HASH,
    required: true,
  }
}

function brief(): GameProductionBriefV3 {
  return parseGameProductionBriefV3({
    schema: 'storyforge.game-production-brief',
    version: 3,
    source: {
      worldReleaseId: 1,
      worldContentHash: HASH,
      selection: currentProductSelection('avg', {
        story: [CURRENT_PRODUCT_RESOURCE_KEYS.story],
        characters: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
        locations: [CURRENT_PRODUCT_RESOURCE_KEYS.location],
        storyArcs: [CURRENT_PRODUCT_RESOURCE_KEYS.arc],
      }),
      startingPoint: {
        kind: 'mainline', title: '从港口开始', summary: '冻结世界的主线入口',
        sourceRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.story],
        protagonistRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.character], openingConflict: '灯塔熄灭。',
      },
    },
    intent: {
      productType: 'avg', playerRole: '守灯人', protagonistRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
      openingSituation: '灯塔熄灭。', coreExperience: ['有后果的选择'], requiredFacts: ['港口仍被封锁'],
      forbiddenChanges: ['不能复活旧王'], contentBoundaries: ['不生成露骨内容'], tone: ['悬疑'],
    },
    scale: { scope: 'short-arc', targetPlayMinutes: 60, targetWordCount: 10_000, targetEndingCount: 3 },
    media: {
      visualLevel: 'key-scenes', audioLevel: 'music-sfx', imageCount: 2, musicTrackCount: 1,
      sfxCount: 2, voiceLineCount: 0, requiredMediaKinds: ['background', 'character-pose', 'bgm', 'sfx'],
    },
    consultationBudget: { maximumModelCalls: 3, maximumInputTokens: 30_000, maximumOutputTokens: 8_000, maximumCostUsd: null },
    productionBudget: {
      maximumModelCalls: 8, maximumInputTokens: 160_000, maximumOutputTokens: 40_000,
      maximumCostUsd: 40, maximumMediaCalls: 5, maximumDurationMs: 3_600_000,
      maximumStorageBytes: 200_000_000,
    },
    qualityProfile: 'commercial-candidate',
    capabilityRequirements: [
      capability('text.runtime-package', 'text'), capability('media.visual', 'image'),
      capability('media.music', 'music'), capability('media.sfx', 'sfx'),
    ],
    externalDataPolicy: {
      allowedDataClasses: ['world-selection'], forbiddenDataClasses: ['api-key'],
      allowReferenceImages: false, allowVoiceScripts: false,
    },
    fallbackPolicy: {
      allowTextOnly: false, allowExistingProjectMedia: true, allowProceduralAudio: true,
      onRequiredCapabilityMissing: 'pause',
    },
    completionContract: {
      requiresPlayablePreview: true,
      requiredGateIds: ['runtime.package.valid', 'runtime.playable', 'rights.complete'],
      minimumMediaCoverage: 1, allowSoftWaivers: false,
    },
    unresolvedDecisionKeys: [],
  })
}

async function planFixture() {
  const parsedBrief = brief()
  const briefHash = await hashGameProductionValueV2(parsedBrief)
  const plan = await createGameProductionPlanV3({ buildNumber: 1, briefHash, brief: parsedBrief })
  return { parsedBrief, briefHash, plan }
}

describe('R-GAMEPROD-1C · bounded parallel production plan', () => {
  it('把内容、美术和音频拆成有界 DAG，并在集成节点汇合', async () => {
    const { plan, briefHash } = await planFixture()
    expect(plan.briefHash).toBe(briefHash)
    expect(plan.concurrency).toEqual({
      maximumCostBearingTasks: 3,
      maximumTextProviderTasks: 2,
      maximumMediaProviderTasks: 1,
    })
    expect(plan.tasks.find(task => task.taskKey === 'content.narrative')?.dependsOn).toEqual(['content.design'])
    expect(plan.tasks.find(task => task.taskKey === 'media.visual')?.dependsOn).toEqual(['media.requirements'])
    expect(plan.tasks.find(task => task.taskKey === 'media.audio')?.dependsOn).toEqual(['media.requirements'])
    expect(plan.tasks.find(task => task.taskKey === 'integration.package')?.dependsOn).toEqual([
      'content.narrative', 'content.product-module', 'media.requirements', 'media.visual', 'media.audio',
    ])
    expect(plan.terminalTaskKey).toBe('qa.release')
  })

  it('拒绝错误 Brief hash，避免用另一份授权 Brief 启动 Build', async () => {
    const parsedBrief = brief()
    await expect(createGameProductionPlanV3({
      buildNumber: 1, briefHash: 'b'.repeat(64), brief: parsedBrief,
    })).rejects.toThrow(/Brief 内容不一致/)
  })

  it('拒绝循环依赖和多个任务争抢同一 Artifact owner', async () => {
    const { plan, parsedBrief, briefHash } = await planFixture()
    const cyclic = structuredClone(plan)
    const design = cyclic.tasks.find(task => task.taskKey === 'content.design')!
    design.dependsOn = ['qa.release']
    design.requiredReceipts = [{ taskKey: 'qa.release', receiptHash: null }]
    expect(() => parseGameProductionPlanV3(cyclic, parsedBrief, briefHash)).toThrow(/DAG 有环/)

    const duplicate = structuredClone(plan)
    duplicate.tasks.find(task => task.taskKey === 'content.product-module')!.outputArtifactKeys = ['design.game']
    expect(() => parseGameProductionPlanV3(duplicate, parsedBrief, briefHash)).toThrow(/多个 owner/)
  })

  it('拒绝越过用户授权预算和遗漏必需 provider capability', async () => {
    const { plan, parsedBrief, briefHash } = await planFixture()
    const overBudget = structuredClone(plan)
    overBudget.tasks.find(task => task.taskKey === 'media.visual')!.budgetReservation.mediaCalls += 1
    expect(() => parseGameProductionPlanV3(overBudget, parsedBrief, briefHash)).toThrow(/预算预留超过/)

    const uncovered = structuredClone(plan)
    for (const task of uncovered.tasks) {
      task.capabilityRequirementKeys = task.capabilityRequirementKeys.filter(key => key !== 'media.visual')
    }
    expect(() => parseGameProductionPlanV3(uncovered, parsedBrief, briefHash)).toThrow(/必需 capability 未覆盖/)
  })
})
