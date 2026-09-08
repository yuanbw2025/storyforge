import { describe, expect, it } from 'vitest'
import {
  createTextOpenWorldRegionNarrativePacksExecutorV1,
  validateTextOpenWorldRegionNarrativePacksV1,
  type TextOpenWorldRegionNarrativePacksInputContextV1,
} from '../../src/lib/open-world/region-narrative-packs-production'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import type {
  ProductProductionTaskExecutionInputV1,
} from '../../src/lib/product-production/scheduler'
import type {
  TextOpenWorldExperienceContractV1,
  TextOpenWorldGameBriefV1,
  TextOpenWorldMainlineThreadV1,
  TextOpenWorldRegionNarrativePacksV1,
  TextOpenWorldRegionSkeletonV1,
  TextOpenWorldSignificantThreadsV1,
  TextOpenWorldSourceLedgerEntryV1,
} from '../../src/lib/types'

const NOW = 1_788_720_000_011
const PRODUCT_KEY = 'text-open-world.p7-contract-regression'
const CLAIM_KEY = 'source.claim.00001'
const LEDGER_HASH = 'a'.repeat(64)
const OMITTED_HASH = 'b'.repeat(64)
const CAPABILITY_HASH = 'c'.repeat(64)

async function minimalContext(governed: boolean): Promise<TextOpenWorldRegionNarrativePacksInputContextV1> {
  const claimBody = {
    claimKey: CLAIM_KEY,
    claimKind: 'region' as const,
    canonicalName: '盐港',
    statement: '盐港依靠旧盐渠维持生活。',
    entityKeys: ['region.salt-port'],
    coverageTags: ['place' as const],
    confidence: 100,
    evidence: [],
    modelBatchKey: 'batch.test',
  }
  const claim = {
    ...claimBody,
    entryHash: await hashProductProductionValueV2(claimBody),
  } satisfies TextOpenWorldSourceLedgerEntryV1

  const gameBriefBody = {
    schema: 'storyforge.text-open-world-game-brief' as const,
    version: 1 as const,
    productType: 'text-open-world' as const,
    productInstanceKey: PRODUCT_KEY,
    source: { sourceLedgerHash: LEDGER_HASH },
    scale: {
      regionCount: 1,
      ordinaryQuestRange: { minimum: 0, maximum: 0 },
      taskTemplateRange: { minimum: 0, maximum: 0 },
      randomEventRange: { minimum: 0, maximum: 0 },
    },
    fixedProductBoundary: { ordinaryWorldEvolution: 'continues-with-time' as const },
  }
  const gameBrief = {
    ...gameBriefBody,
    gameBriefHash: await hashProductProductionValueV2(gameBriefBody),
  } as unknown as TextOpenWorldGameBriefV1

  const experienceBody = {
    schema: 'storyforge.text-open-world-experience-contract' as const,
    version: 1 as const,
    productType: 'text-open-world' as const,
    productInstanceKey: PRODUCT_KEY,
    gameBriefHash: gameBrief.gameBriefHash,
    sourceLedgerHash: LEDGER_HASH,
    worldEvolution: {
      timeWeatherAndRegionsContinue: true as const,
      importantStorylinesWaitAtSafePoints: true as const,
    },
    sourceClaimKeys: [CLAIM_KEY],
  }
  const experienceContract = {
    ...experienceBody,
    experienceContractHash: await hashProductProductionValueV2(experienceBody),
  } as unknown as TextOpenWorldExperienceContractV1

  const regionBody = {
    schema: 'storyforge.text-open-world-region-skeleton' as const,
    version: 1 as const,
    productType: 'text-open-world' as const,
    productInstanceKey: PRODUCT_KEY,
    gameBriefHash: gameBrief.gameBriefHash,
    sourceLedgerHash: LEDGER_HASH,
    worldScale: { regionCount: 1 },
    regions: [{ key: 'region.001', order: 1, title: '盐港' }],
    locations: [{
      key: 'location.001', regionKey: 'region.001', order: 1, title: '盐港广场',
      functions: ['narrative' as const, 'service' as const],
    }],
    coverage: { usedSourceClaimKeys: [CLAIM_KEY] },
  }
  const regionSkeleton = {
    ...regionBody,
    regionSkeletonHash: await hashProductProductionValueV2(regionBody),
  } as unknown as TextOpenWorldRegionSkeletonV1

  const mainlineBody = {
    schema: 'storyforge.text-open-world-mainline-thread' as const,
    version: 1 as const,
    productType: 'text-open-world' as const,
    productInstanceKey: PRODUCT_KEY,
    regionSkeletonHash: regionSkeleton.regionSkeletonHash,
    stages: [],
    governance: { ordinaryStateCannotBlock: true as const },
  }
  const mainlineThread = {
    ...mainlineBody,
    mainlineThreadHash: await hashProductProductionValueV2(mainlineBody),
  } as unknown as TextOpenWorldMainlineThreadV1

  const significantBody = {
    schema: 'storyforge.text-open-world-significant-threads' as const,
    version: 1 as const,
    productType: 'text-open-world' as const,
    productInstanceKey: PRODUCT_KEY,
    regionSkeletonHash: regionSkeleton.regionSkeletonHash,
    mainlineThreadHash: mainlineThread.mainlineThreadHash,
    threads: [],
    stages: [],
    coverage: { sourceClaimKeys: [] },
    governance: {
      lifecycle: 'persistent-safe-wait' as const,
      mainlineCompatibility: 'cannot-block-or-rewrite' as const,
    },
  }
  const significantThreads = {
    ...significantBody,
    significantThreadsHash: await hashProductProductionValueV2(significantBody),
  } as unknown as TextOpenWorldSignificantThreadsV1

  const body = {
    schema: 'storyforge.text-open-world-region-narrative-packs-input' as const,
    version: 1 as const,
    productInstanceKey: PRODUCT_KEY,
    gameBrief,
    experienceContract,
    sourceLedger: {
      ledgerHash: LEDGER_HASH,
      totalClaimCount: 1,
      selectedClaims: [claim],
      omittedClaimCount: 0,
      omittedClaimsHash: OMITTED_HASH,
    },
    regionSkeleton,
    mainlineThread,
    significantThreads,
    ...(governed ? { knowledgeSeedContract: 'governed-v1' as const } : {}),
  }
  return {
    ...body,
    contextSelectionHash: await hashProductProductionValueV2(body),
  }
}

function legacyDraft(): Record<string, unknown> {
  return {
    schema: 'storyforge.text-open-world-region-narrative-packs-draft',
    version: 1,
    packs: [{
      regionNumber: 1,
      title: '盐港生态',
      fantasy: '在盐雾与旧渠之间维持一座港口的日常。',
      localConflict: '居民对旧盐渠应当修复还是封存存在分歧。',
      regionalQuestion: '共同生活所依赖的旧设施应由谁负责？',
      dailyLifeBaseline: '居民白天劳作交易，夜间返回住处。',
      distinctivenessStatement: '熟人港口中的公共设施争议。',
      sourceClaimKeys: [CLAIM_KEY],
      tensions: [
        { title: '修复之争', sideA: '修复派', sideB: '封存派', stakes: '港口生计', pressureAxis: '生计与安全' },
        { title: '责任之争', sideA: '守渠人', sideB: '商会', stakes: '公共信任', pressureAxis: '责任与利益' },
      ],
      stateAxes: [
        { title: '地方信任', lowExpression: '互相回避', middleExpression: '谨慎合作', highExpression: '主动互助' },
        { title: '日常稳定', lowExpression: '服务中断', middleExpression: '勉强维持', highExpression: '秩序恢复' },
      ],
      locations: [{
        locationNumber: 1,
        dailyLife: '居民在广场交易和交换消息。',
        activityPatterns: ['交易'],
        npcRoleNeeds: ['商贩'],
        rumorHooks: ['旧渠异响'],
        timeExpressions: ['白天开放'],
        contentRisk: 'safe',
      }],
      characters: [
        {
          tier: 'important', roleTitle: '守渠人', narrativeFunction: '保持地区冲突', homeLocationNumber: 1,
          routine: '白天巡渠', serviceNeeds: [], significantThreadNumbers: [], sourceClaimKeys: [],
        },
        {
          tier: 'functional', roleTitle: '盐商', narrativeFunction: '提供交易服务', homeLocationNumber: 1,
          routine: '白天营业', serviceNeeds: ['交易'], significantThreadNumbers: [], sourceClaimKeys: [],
        },
      ],
      factions: [{
        title: '守渠会', publicGoal: '维持盐渠', localResource: '工具与记录', visiblePresence: '广场值守',
        significantThreadNumbers: [], sourceClaimKeys: [],
      }],
      ordinaryQuestSeeds: [],
      taskTemplateSeeds: [],
      randomEventSeeds: [],
      rumors: [1, 2, 3].map(number => ({
        text: `盐港传闻${number}`,
        pointsTo: 'tension',
        spoilerBoundary: '不泄露最终真相。',
        sourceClaimKeys: [],
      })),
    }],
  }
}

function bindingReceipt(requirementKey: string) {
  return {
    schema: 'storyforge.provider-binding-receipt' as const,
    version: 1 as const,
    requirementKey,
    adapterId: 'configured-text.v1' as const,
    adapterVersion: 1 as const,
    provider: 'test',
    model: 'test-model',
    endpointOrigin: 'https://example.invalid',
    executionLocation: 'browser-direct' as const,
    credentialSource: 'existing-ai-config' as const,
    credentialPresent: true as const,
    capabilityHash: CAPABILITY_HASH,
    boundAt: NOW,
    receiptHash: 'd'.repeat(64),
  }
}

async function executeDraft(
  context: TextOpenWorldRegionNarrativePacksInputContextV1,
  draft: Record<string, unknown>,
) {
  const requirementKey = 'capability.text'
  const executor = createTextOpenWorldRegionNarrativePacksExecutorV1({
    now: () => NOW,
    runModel: async () => ({
      output: JSON.stringify(draft),
      bindingReceipt: bindingReceipt(requirementKey),
      usage: null,
    }),
  })
  return executor({
    scope: { projectId: 1, worldId: 1, workId: 1 },
    productionId: 1,
    buildId: 1,
    buildNumber: 1,
    controlEpoch: 1,
    planHash: 'e'.repeat(64),
    task: {
      taskKey: 'p7.region-narrative-packs',
      skillId: 'text-open-world.production.region-narrative-packs.v1',
      executionMode: 'model',
      outputArtifactKeys: ['text-open-world.region-narrative-packs'],
      capabilityRequirementKeys: [requirementKey],
      acceptanceGateIds: ['p7.valid'],
      budgetReservation: { outputTokens: 8_000 },
    },
    attempt: 1,
    idempotencyKey: 'f'.repeat(64),
    contextText: canonicalProductProductionJsonV2(context),
    inputArtifacts: [],
    capabilityBindings: [{
      requirementKey,
      bindingHash: CAPABILITY_HASH,
      adapterId: 'configured-text.v1',
    }],
    signal: new AbortController().signal,
  } as unknown as ProductProductionTaskExecutionInputV1)
}

describe('R-OPEN-WORLD-G4-11A · P7 Knowledge contract compatibility', () => {
  it('fresh marker拒绝完全缺失治理字段的旧rumor shape', async () => {
    await expect(executeDraft(await minimalContext(true), legacyDraft()))
      .rejects.toThrow(/rumors\[0\]字段不精确/)
  })

  it('legacy Context保留空rumor sourceClaimKeys及完整Artifact Hash语义', async () => {
    const context = await minimalContext(false)
    const result = await executeDraft(context, legacyDraft())
    const artifact = result.artifacts[0]!.payload as TextOpenWorldRegionNarrativePacksV1
    expect(artifact.packs[0]!.rumors.map(rumor => rumor.sourceClaimKeys)).toEqual([[], [], []])
    expect(artifact.coverage.sourceClaimKeys).toEqual([CLAIM_KEY])
    expect(artifact.regionNarrativePacksHash).toBe('e1f995c21c1dc547d25184dfe1aa7c6a1fe7b24dee1fd24ba6c4cb6af648eea1')
    await expect(validateTextOpenWorldRegionNarrativePacksV1({ artifact, context })).resolves.toBeDefined()
  })
})
