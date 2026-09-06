import { describe, expect, it } from 'vitest'
import {
  createTextOpenWorldProductionPlanV1,
  createTextOpenWorldProductionRunContractBlueprintV1,
  TEXT_OPEN_WORLD_PRODUCTION_ARTIFACT_DEFINITIONS_V1,
  TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1,
  textOpenWorldProductionArtifactKindForKeyV1,
  textOpenWorldProductionStageTaskKeysV1,
  validateTextOpenWorldProductionTaskContractsV1,
} from '../../src/lib/open-world/production-contract'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import {
  TEXT_OPEN_WORLD_PRODUCTION_ARTIFACT_KINDS_V1,
  TEXT_OPEN_WORLD_PRODUCTION_STAGES_V1,
  type ProductProductionBriefV3,
} from '../../src/lib/types'
import { CURRENT_PRODUCT_RESOURCE_KEYS, currentProductSelection } from '../helpers/current-product-world'

const HASH = 'a'.repeat(64)

function capability(
  requirementKey: string,
  mediaClass: 'text' | 'image' | 'music' | 'sfx' | 'voice' | 'transcode',
) {
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

function brief(input: {
  productType?: 'text-open-world' | 'avg'
  maximumModelCalls?: number
  withMedia?: boolean
} = {}): ProductProductionBriefV3 {
  const productType = input.productType ?? 'text-open-world'
  const withMedia = input.withMedia ?? false
  return parseProductProductionBriefV3({
    schema: 'storyforge.product-production-brief',
    version: 3,
    source: {
      worldReleaseId: 1,
      worldContentHash: HASH,
      selection: currentProductSelection(productType, {
        story: [CURRENT_PRODUCT_RESOURCE_KEYS.story],
        characters: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
        locations: [CURRENT_PRODUCT_RESOURCE_KEYS.location],
        storyArcs: [CURRENT_PRODUCT_RESOURCE_KEYS.arc],
      }),
      startingPoint: {
        kind: 'mainline', title: '从盐脊开始', summary: '冻结世界的主线入口',
        sourceRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.story],
        protagonistRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.character], openingConflict: '盐井失去回声。',
      },
    },
    intent: {
      productType, playerRole: '巡盐人', protagonistRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
      openingSituation: '盐井失去回声。', coreExperience: ['有边界的自由演绎', '长期冒险成长'],
      requiredFacts: ['主线核心目标必须保持'], forbiddenChanges: ['不得改写冻结世界事实'],
      contentBoundaries: ['不生成露骨内容'], tone: ['边地奇幻'],
    },
    scale: { scope: 'campaign', targetPlayMinutes: 360, targetWordCount: 80_000, targetEndingCount: 2 },
    media: {
      visualLevel: withMedia ? 'key-scenes' : 'none', audioLevel: withMedia ? 'music-sfx' : 'none',
      imageCount: withMedia ? 1 : 0, musicTrackCount: withMedia ? 1 : 0,
      sfxCount: 0, voiceLineCount: 0,
      requiredMediaKinds: withMedia ? ['background', 'bgm'] : [],
    },
    consultationBudget: {
      maximumModelCalls: 3, maximumInputTokens: 30_000,
      maximumOutputTokens: 8_000, maximumCostUsd: null,
    },
    productionBudget: {
      maximumModelCalls: input.maximumModelCalls ?? 160,
      maximumInputTokens: 320_000, maximumOutputTokens: 128_000,
      maximumCostUsd: 80, maximumMediaCalls: withMedia ? 2 : 0,
      maximumDurationMs: 7_200_000, maximumStorageBytes: 200_000_000,
    },
    qualityProfile: 'commercial-candidate',
    capabilityRequirements: withMedia
      ? [
          capability('text.open-world-production', 'text'),
          capability('media.visual', 'image'),
          capability('media.music', 'music'),
          capability('media.transcode', 'transcode'),
        ]
      : [capability('text.open-world-production', 'text')],
    externalDataPolicy: {
      allowedDataClasses: ['world-selection'], forbiddenDataClasses: ['api-key'],
      allowReferenceImages: false, allowVoiceScripts: false,
    },
    fallbackPolicy: {
      allowTextOnly: !withMedia, allowExistingProjectMedia: true,
      allowProceduralAudio: true, onRequiredCapabilityMissing: 'pause',
    },
    completionContract: {
      requiresPlayablePreview: true,
      requiredGateIds: ['runtime.package.valid', 'runtime.playable', 'rights.complete'],
      minimumMediaCoverage: withMedia ? 1 : 0, allowSoftWaivers: false,
    },
    unresolvedDecisionKeys: [],
  })
}

describe('R-OPEN-WORLD3 · product production contract and P0-P10 DAG', () => {
  it('为每个阶段、Artifact和Run边界声明唯一事实源', () => {
    const tasks = validateTextOpenWorldProductionTaskContractsV1()
    const blueprint = createTextOpenWorldProductionRunContractBlueprintV1()
    expect(new Set(tasks.map(task => task.stage))).toEqual(new Set(TEXT_OPEN_WORLD_PRODUCTION_STAGES_V1))
    expect(TEXT_OPEN_WORLD_PRODUCTION_ARTIFACT_DEFINITIONS_V1).toHaveLength(
      TEXT_OPEN_WORLD_PRODUCTION_ARTIFACT_KINDS_V1.length,
    )
    expect(new Set(TEXT_OPEN_WORLD_PRODUCTION_ARTIFACT_DEFINITIONS_V1.map(item => item.ownerTaskKey)).size)
      .toBeLessThanOrEqual(tasks.length)
    expect(blueprint).toMatchObject({
      productOwner: 'text-open-world',
      workflowKind: 'long-running-resumable',
      activation: 'contract-only-until-skills-and-executors-registered',
      artifactAcceptance: 'candidate-then-accepted-by-shared-artifact-store',
      terminalTaskKey: 'qa.release',
    })
    expect(textOpenWorldProductionStageTaskKeysV1('P8')).toEqual([
      'p8.quest-skeletons', 'p8.catalog.progression',
      'p8.catalog.encounters', 'p8.catalog.items-rewards',
      'p8.catalog.crafting-economy', 'p8.catalog.npc-runtime',
      'p8.catalog.map-interactions',
    ])
  })

  it('让全部任务显式声明重试、stale传播、验收门和终态回执', () => {
    const tasks = validateTextOpenWorldProductionTaskContractsV1()
    for (const task of tasks) {
      expect(task.stalePolicy.watches).toEqual(expect.arrayContaining([
        'sourcePinHash', 'briefHash', 'planHash', 'controlEpoch', 'inputArtifactHashes',
      ]))
      expect(task.stalePolicy).toMatchObject({
        propagation: 'transitive-downstream',
        onChange: 'pause-for-author',
        staleCandidatePolicy: 'view-only-rebuild-required',
      })
      expect(task.retryPolicy.nonRetryableFailures).toEqual(expect.arrayContaining(['stale', 'unknown-result']))
      expect(task.completion.requiresAcceptedOutputs).toBe(true)
      expect(task.completion.requiredGateIds.length).toBeGreaterThan(0)
      expect(task.completion.terminalEvidence).toBe('task-receipt')
      expect(task.retryPolicy.maxAttempts).toBe(task.executionMode === 'model' ? 2 : 1)
      if (task.executionMode === 'model') expect(task.recommendedModelCalls).toBeGreaterThanOrEqual(1)
      else expect(task.recommendedModelCalls).toBe(0)
    }
  })

  it('生成共享Harness可接受的多Skill有界计划，并把所有任务汇入发布QA', async () => {
    const parsedBrief = brief()
    const briefHash = await hashProductProductionValueV2(parsedBrief)
    const plan = await createTextOpenWorldProductionPlanV1({
      buildNumber: 3, controlEpoch: 2, briefHash, brief: parsedBrief,
    })
    expect(plan).toMatchObject({
      productType: 'text-open-world', buildNumber: 3, controlEpoch: 2,
      terminalTaskKey: 'qa.release',
    })
    expect(plan.tasks.filter(task => task.executionMode === 'model')).toHaveLength(22)
    expect(plan.tasks.reduce((sum, task) => sum + task.budgetReservation.modelCalls, 0)).toBe(150)
    expect(plan.tasks.find(task => task.taskKey === 'p5.mainline')?.budgetReservation.modelCalls).toBe(12)
    expect(plan.tasks.find(task => task.taskKey === 'p7.region-narrative-packs')?.budgetReservation.modelCalls).toBe(16)
    expect(plan.tasks.find(task => task.taskKey === 'p8f.quest-finalize')?.dependsOn).toEqual(
      expect.arrayContaining([
        'p8.quest-skeletons', 'p8.catalog.progression',
        'p8.catalog.encounters', 'p8.catalog.items-rewards',
        'p8.catalog.crafting-economy', 'p8.catalog.npc-runtime',
        'p8.catalog.map-interactions',
      ]),
    )
    expect(plan.tasks.find(task => task.taskKey === 'v2.semantic-review')?.dependsOn)
      .toContain('v1.deterministic-preflight')
    expect(plan.tasks.find(task => task.taskKey === 'qa.release')?.acceptanceGateIds)
      .toEqual(expect.arrayContaining(parsedBrief.completionContract.requiredGateIds))

    const minimumBrief = brief({ maximumModelCalls: 22 })
    const minimumPlan = await createTextOpenWorldProductionPlanV1({
      buildNumber: 1,
      briefHash: await hashProductProductionValueV2(minimumBrief),
      brief: minimumBrief,
    })
    expect(minimumPlan.tasks.reduce((sum, task) => sum + task.budgetReservation.modelCalls, 0)).toBe(22)
    expect(minimumPlan.tasks.filter(task => task.executionMode === 'model')
      .every(task => task.budgetReservation.modelCalls === 1)).toBe(true)
  })

  it('把媒资Lane接到P10之后，并保持V3为唯一装配汇合点', async () => {
    const parsedBrief = brief({ withMedia: true })
    const briefHash = await hashProductProductionValueV2(parsedBrief)
    const plan = await createTextOpenWorldProductionPlanV1({
      buildNumber: 1, briefHash, brief: parsedBrief,
    })
    const integration = plan.tasks.find(task => task.taskKey === 'v3.runtime-package')!
    expect(integration.dependsOn).toEqual(expect.arrayContaining(['media.visual', 'media.audio']))
    expect(integration.capabilityRequirementKeys).toEqual(['media.transcode'])
    expect(plan.tasks.find(task => task.taskKey === 'media.visual')).toMatchObject({
      dependsOn: ['p10.system-finalize'], outputArtifactKeys: ['text-open-world.media.visual.001'],
    })
    expect(textOpenWorldProductionArtifactKindForKeyV1('text-open-world.media.visual.001')).toBe('image')
    expect(textOpenWorldProductionArtifactKindForKeyV1('text-open-world.media.audio.001')).toBe('audio')
  })

  it('拒绝错误产品、未授权预算、stale缺口和非上游Artifact读取', async () => {
    const avgBrief = brief({ productType: 'avg' })
    await expect(createTextOpenWorldProductionPlanV1({
      buildNumber: 1, briefHash: await hashProductProductionValueV2(avgBrief), brief: avgBrief,
    })).rejects.toThrow(/只能为 text-open-world/)

    const underBudget = brief({ maximumModelCalls: 21 })
    await expect(createTextOpenWorldProductionPlanV1({
      buildNumber: 1, briefHash: await hashProductProductionValueV2(underBudget), brief: underBudget,
    })).rejects.toThrow(/至少需要 22 次/)

    const staleGap = structuredClone(TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1)
    staleGap[0].stalePolicy.watches = staleGap[0].stalePolicy.watches.filter(item => item !== 'sourcePinHash')
    expect(() => validateTextOpenWorldProductionTaskContractsV1(staleGap)).toThrow(/stale 合同不完整/)

    const hiddenInput = structuredClone(TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1)
    hiddenInput.find(task => task.taskKey === 'p9.scene-scripts')!.dependsOn = ['p7.region-narrative-packs']
    expect(() => validateTextOpenWorldProductionTaskContractsV1(hiddenInput)).toThrow(/输入未由上游依赖提供/)
  })
})
