import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { acceptProductBuildArtifact } from '../../src/lib/product-production/artifact-store'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseConfirmedProductBriefV1, parseProductProductionSourcePlanV1 } from '../../src/lib/product-production/source-contracts'
import {
  createTextOpenWorldExperienceDesignExecutorV1,
  validateTextOpenWorldExperienceArtifactsV1,
  type TextOpenWorldExperienceDesignArtifactsV1,
  type TextOpenWorldExperienceInputContextV1,
  type TextOpenWorldExperienceModelRunnerV1,
} from '../../src/lib/open-world/experience-design'
import {
  createTextOpenWorldGameplayRulesetExecutorV1,
  TEXT_OPEN_WORLD_COMPILER_OWNED_EFFECT_OPERATIONS_V1,
  TEXT_OPEN_WORLD_LEGACY_EFFECT_OPERATIONS_V1,
  TEXT_OPEN_WORLD_MODEL_PROPOSABLE_EFFECT_OPERATIONS_V1,
  validateTextOpenWorldGameplayRulesetSkeletonV1,
  type TextOpenWorldGameplayRulesetInputContextV1,
  type TextOpenWorldGameplayRulesetModelRunnerV1,
} from '../../src/lib/open-world/gameplay-ruleset'
import {
  createTextOpenWorldPlayerBuildExecutorV1,
  validateTextOpenWorldPlayerBuildV1,
  type TextOpenWorldPlayerBuildInputContextV1,
  type TextOpenWorldPlayerBuildModelRunnerV1,
} from '../../src/lib/open-world/player-build'
import {
  createTextOpenWorldStoryArchitectureExecutorV1,
  validateTextOpenWorldStoryArchitectureArtifactsV1,
  type TextOpenWorldStoryArchitectureArtifactsV1,
  type TextOpenWorldStoryArchitectureInputContextV1,
  type TextOpenWorldStoryArchitectureModelRunnerV1,
} from '../../src/lib/open-world/story-architecture'
import {
  createTextOpenWorldRegionSkeletonExecutorV1,
  validateTextOpenWorldRegionSkeletonV1,
  type TextOpenWorldRegionSkeletonInputContextV1,
  type TextOpenWorldRegionSkeletonModelRunnerV1,
} from '../../src/lib/open-world/region-skeleton'
import {
  createTextOpenWorldMainlineExecutorV1,
  validateTextOpenWorldMainlineThreadV1,
  type TextOpenWorldMainlineInputContextV1,
  type TextOpenWorldMainlineModelRunnerV1,
} from '../../src/lib/open-world/mainline-production'
import {
  createTextOpenWorldSignificantThreadsExecutorV1,
  validateTextOpenWorldSignificantThreadsV1,
  type TextOpenWorldSignificantThreadsInputContextV1,
  type TextOpenWorldSignificantThreadsModelRunnerV1,
} from '../../src/lib/open-world/significant-threads-production'
import {
  createTextOpenWorldRegionNarrativePacksExecutorV1,
  validateTextOpenWorldRegionNarrativePacksV1,
  type TextOpenWorldRegionNarrativePacksInputContextV1,
  type TextOpenWorldRegionNarrativePacksModelRunnerV1,
} from '../../src/lib/open-world/region-narrative-packs-production'
import {
  createTextOpenWorldQuestSkeletonsExecutorV1,
  validateTextOpenWorldQuestSkeletonArtifactsV1,
  type TextOpenWorldQuestSkeletonsInputContextV1,
  type TextOpenWorldQuestSkeletonsModelRunnerV1,
} from '../../src/lib/open-world/quest-skeletons-production'
import {
  createTextOpenWorldProgressionCatalogsExecutorV1,
  validateTextOpenWorldProgressionCatalogsV1,
  type TextOpenWorldProgressionCatalogsInputContextV1,
  type TextOpenWorldProgressionCatalogsModelRunnerV1,
} from '../../src/lib/open-world/progression-catalogs-production'
import {
  createTextOpenWorldEncounterCatalogExecutorV1,
  validateTextOpenWorldEnemyEncounterCatalogV1,
  type TextOpenWorldEncounterCatalogInputContextV1,
  type TextOpenWorldEncounterCatalogModelRunnerV1,
} from '../../src/lib/open-world/encounter-catalog-production'
import { TEXT_OPEN_WORLD_EFFECT_OPERATIONS_V1 } from '../../src/lib/types/text-open-world-effect'
import type {
  TextOpenWorldGameplayRulesetSkeletonV1,
  TextOpenWorldMainlineThreadV1,
  TextOpenWorldPlayerBuildV1,
  TextOpenWorldRegionSkeletonV1,
  TextOpenWorldRegionNarrativePacksV1,
  TextOpenWorldContentRequirementManifestV1,
  TextOpenWorldQuestSkeletonsV1,
  TextOpenWorldProgressionCatalogsV1,
  TextOpenWorldEnemyEncounterCatalogV1,
  TextOpenWorldSignificantThreadsV1,
} from '../../src/lib/types'
import {
  createTextOpenWorldProductionPlanV1,
} from '../../src/lib/open-world/production-contract'
import {
  createTextOpenWorldSourceCurationExecutorV1,
  type TextOpenWorldSourceCurationModelRunnerV1,
} from '../../src/lib/open-world/source-curation'
import {
  acceptTextOpenWorldSourcePinBundleV1,
  freezeTextOpenWorldWorldReleaseSourceV1,
} from '../../src/lib/open-world/source-pin'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

const CAPABILITY_HASH = 'b'.repeat(64)
const NOW = 1_788_720_000_000

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
    receiptHash: 'c'.repeat(64),
  }
}

function curationRunner(protagonistResourceKey: string): TextOpenWorldSourceCurationModelRunnerV1 {
  return async input => {
    const context = JSON.parse(input.contextText) as {
      units: Array<{ unitKey: string; sourceResourceKey: string; content: string }>
    }
    const target = context.units.find(unit => unit.sourceResourceKey === protagonistResourceKey) ?? context.units[0]!
    const quote = target.content.slice(0, Math.min(20, target.content.length))
    return {
      output: JSON.stringify({
        schema: 'storyforge.text-open-world-source-curation-draft',
        version: 1,
        unitKeys: context.units.map(unit => unit.unitKey),
        claims: [{
          claimKind: 'plot',
          canonicalName: '雾港核心冒险',
          statement: '守灯调查者从雾港危机出发，在地区探索中成长并守住核心目标。',
          entityKeys: ['story.mist-harbor', 'character.linzho'],
          coverageTags: [
            'story-core', 'protagonist', 'core-conflict', 'character',
            'faction', 'place', 'timeline',
          ],
          confidence: 90,
          evidence: [{ unitKey: target.unitKey, quote, start: 0, end: quote.length }],
        }],
        gaps: [],
      }),
      bindingReceipt: bindingReceipt(input.requirementKey),
      usage: { inputTokens: 300, outputTokens: 180 },
    }
  }
}

function experienceRunner(options: { forgedClaim?: boolean } = {}): TextOpenWorldExperienceModelRunnerV1 {
  return async input => {
    const context = JSON.parse(input.contextText) as TextOpenWorldExperienceInputContextV1
    const claimKey = options.forgedClaim ? 'source.claim.forged' : context.selectedClaims[0]!.claimKey
    return {
      output: JSON.stringify({
        schema: 'storyforge.text-open-world-experience-draft',
        version: 1,
        experience: {
          pitch: '在持续演化的雾港及周边地区调查危机，通过主线、重要支线与地区冒险逐步成长。',
          playerFantasy: '成为能够旅行、战斗、调查并影响局部关系的守灯调查者。',
          narrativePillars: ['受保护的长程主线', '地区化重要故事', '有后果的边界自由'],
          regionalVarietyPromise: '每个地区具有不同人物需求、风险、资源与可抛弃的小故事。',
          growthPromise: '通过任务、战斗与制作稳定获得等级、技能、装备和关系反馈。',
          toneGuide: ['边地悬疑', '克制', '冒险成长'],
          sourceClaimKeys: [claimKey],
        },
        protagonist: {
          identitySummary: '林舟是熟悉雾港规则、必须承担守护责任的守灯调查者。',
          motivations: ['追查危机来源', '保护仍在运行的港口秩序'],
          personalStakes: ['失败会让家园继续失去安全边界'],
          sourceClaimKeys: [claimKey],
        },
      }),
      bindingReceipt: bindingReceipt(input.requirementKey),
      usage: null,
    }
  }
}

async function fixture() {
  const owned = await seedCurrentProductWorld(`TOW P2 ${crypto.randomUUID()}`)
  const suggestions = await suggestProductStartingPoints({
    scope: owned.scope,
    worldReleaseId: owned.release.id!,
  })
  const characterStart = suggestions.suggestions.find(item => item.kind === 'character')!
  const draft = await draftProductProductionBriefV3({
    scope: owned.scope,
    worldReleaseId: owned.release.id!,
    suggestionKey: characterStart.suggestionKey,
    productType: 'text-open-world',
    scale: 'chapter',
    visualLevel: 'key-scenes',
    audioLevel: 'none',
    qualityProfile: 'commercial-candidate',
    playerRole: '扮演守灯调查者林舟',
    openingSituation: '从雾港潮门危机开始，逐步进入两个完整地区。',
    coreExperience: ['有边界的自由演绎', '长期任务成长', '地区探索'],
    requiredFacts: ['潮汐规则和主角身份必须保持'],
    forbiddenChanges: ['不得让主线核心目标永久失败'],
    contentBoundaries: ['不生成露骨内容'],
    tone: ['边地悬疑', '成长冒险'],
  })
  const brief = parseProductProductionBriefV3({
    ...draft,
    media: {
      ...draft.media,
      visualLevel: 'key-scenes',
      imageCount: 3,
      requiredMediaKinds: ['background'],
    },
    productionBudget: {
      ...draft.productionBudget,
      maximumModelCalls: 160,
      maximumInputTokens: 1_200_000,
      maximumOutputTokens: 360_000,
      maximumMediaCalls: 30,
      maximumCostUsd: 30,
      maximumDurationMs: 7_200_000,
    },
  })
  const productionKey = `tow.p2.${crypto.randomUUID()}`
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    now: NOW,
    command: {
      type: 'create-intent',
      commandId: `${productionKey}.intent`,
      productionKey,
      productType: 'text-open-world',
      worldReleaseId: owned.release.id!,
      userText: '生产一个有边界自由的文字开放世界',
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope,
    productionId: created.productionId,
    now: NOW + 1,
    command: {
      type: 'save-brief-revision',
      commandId: `${productionKey}.brief`,
      expectedStateRevision: 0,
      parentRevision: null,
      brief,
    },
  })
  await executeProductProductionCommand({
    scope: owned.scope,
    productionId: created.productionId,
    now: NOW + 2,
    command: {
      type: 'authorize-start',
      commandId: `${productionKey}.start`,
      expectedStateRevision: 1,
      briefRevision: 1,
      briefHash: saved.result.briefHash as string,
      authorizationNonce: `${productionKey}.author-click`,
    },
  })
  const production = await db.productProductions.get(created.productionId)
  const build = await db.productBuilds
    .where('[productionId+buildNumber]').equals([created.productionId, 1]).first()
  const briefRow = await db.productProductionBriefs
    .where('[productionId+revision]').equals([created.productionId, 1]).first()
  if (!production || !build || !briefRow) throw new Error('测试生产数据创建失败')
  const sourcePlan = await parseProductProductionSourcePlanV1(briefRow)
  const confirmed = await parseConfirmedProductBriefV1({ row: briefRow, sourcePlan })
  const plan = await createTextOpenWorldProductionPlanV1({
    buildNumber: build.buildNumber,
    controlEpoch: build.controlEpoch,
    briefHash: briefRow.briefHash,
    brief,
  })
  const planHash = await hashProductProductionValueV2(plan)
  await db.productBuilds.update(build.id!, {
    planJson: JSON.stringify(plan),
    planHash,
  })
  const bundle = await freezeTextOpenWorldWorldReleaseSourceV1({
    scope: owned.scope,
    localReleaseRecordId: owned.release.id!,
    selection: {
      mode: 'selected-resources',
      resourceKeys: brief.source.selection.resourceKeys,
    },
    authorization: {
      productInstanceKey: production.productionKey,
      briefRevision: briefRow.revision,
      briefHash: briefRow.briefHash,
      authorStartRevision: confirmed.authorStartRevision,
      authorizationNonce: `${productionKey}.source-pin`,
      rightsBasis: 'author-owned',
      rightsNote: '仅供本次文字开放世界生产。',
      authorizedAt: NOW + 2,
    },
    createdAt: NOW + 2,
  })
  await acceptTextOpenWorldSourcePinBundleV1({
    scope: owned.scope,
    buildId: build.id!,
    controlEpoch: build.controlEpoch,
    bundle,
  })
  const p1 = plan.tasks.find(task => task.taskKey === 'p1.source-curation')!
  const p1Result = await createTextOpenWorldSourceCurationExecutorV1({
    runModel: curationRunner(brief.intent.protagonistRefs[0]!),
    now: () => NOW + 3,
  })({
    scope: owned.scope,
    productionId: production.id!,
    buildId: build.id!,
    buildNumber: build.buildNumber,
    controlEpoch: build.controlEpoch,
    planHash,
    task: p1,
    attempt: 1,
    idempotencyKey: await hashProductProductionValueV2('p1-experience-input'),
    contextText: '',
    inputArtifacts: [],
    capabilityBindings: p1.capabilityRequirementKeys.map(requirementKey => ({
      requirementKey,
      bindingHash: CAPABILITY_HASH,
      adapterId: 'configured-text.v1',
    })),
    signal: new AbortController().signal,
  })
  for (const artifact of p1Result.artifacts) {
    await acceptProductBuildArtifact({
      scope: owned.scope,
      buildId: build.id!,
      controlEpoch: build.controlEpoch,
      artifactKey: artifact.artifactKey,
      kind: artifact.kind,
      payload: artifact.payload,
      quality: artifact.quality,
      rights: artifact.rights,
      inputHash: await hashProductProductionValueV2({ stage: 'P1', artifactKey: artifact.artifactKey }),
    })
  }
  const assembled = await assembleContext({
    projectId: owned.scope.projectId,
    scope: owned.scope,
    sourceKeys: ['text-open-world.experience-input'],
    productProductionId: production.id!,
    productBuildId: build.id!,
    inputBudgetMaxTokens: p2InputBudget(plan),
  })
  const p2 = plan.tasks.find(task => task.taskKey === 'p2.experience-design')!
  return {
    ...owned,
    production,
    build,
    brief,
    briefRow,
    confirmed,
    bundle,
    planHash,
    p2,
    contextText: assembled.text,
    context: JSON.parse(assembled.text) as TextOpenWorldExperienceInputContextV1,
    contextEvidence: assembled.sourceEvidence,
  }
}

function p2InputBudget(plan: Awaited<ReturnType<typeof createTextOpenWorldProductionPlanV1>>): number {
  return plan.tasks.find(task => task.taskKey === 'p2.experience-design')!.budgetReservation.inputTokens
}

async function executeP2(
  input: Awaited<ReturnType<typeof fixture>>,
  runModel: TextOpenWorldExperienceModelRunnerV1 = experienceRunner(),
) {
  return createTextOpenWorldExperienceDesignExecutorV1({
    runModel,
    now: () => NOW + 4,
  })({
    scope: input.scope,
    productionId: input.production.id!,
    buildId: input.build.id!,
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    planHash: input.planHash,
    task: input.p2,
    attempt: 1,
    idempotencyKey: await hashProductProductionValueV2('p2-experience-design'),
    contextText: input.contextText,
    inputArtifacts: [],
    capabilityBindings: input.p2.capabilityRequirementKeys.map(requirementKey => ({
      requirementKey,
      bindingHash: CAPABILITY_HASH,
      adapterId: 'configured-text.v1',
    })),
    signal: new AbortController().signal,
  })
}

function resultArtifacts(result: Awaited<ReturnType<typeof executeP2>>): TextOpenWorldExperienceDesignArtifactsV1 {
  return {
    gameBrief: result.artifacts.find(item => item.artifactKey === 'text-open-world.game-brief')!.payload as TextOpenWorldExperienceDesignArtifactsV1['gameBrief'],
    experienceContract: result.artifacts.find(item => item.artifactKey === 'text-open-world.experience-contract')!.payload as TextOpenWorldExperienceDesignArtifactsV1['experienceContract'],
    protagonistAsset: result.artifacts.find(item => item.artifactKey === 'text-open-world.protagonist-asset')!.payload as TextOpenWorldExperienceDesignArtifactsV1['protagonistAsset'],
  }
}

function rulesetRunner(options: { forgedClaim?: boolean } = {}): TextOpenWorldGameplayRulesetModelRunnerV1 {
  return async input => {
    const context = JSON.parse(input.contextText) as TextOpenWorldGameplayRulesetInputContextV1
    return {
      output: JSON.stringify({
        schema: 'storyforge.text-open-world-gameplay-ruleset-draft',
        version: 1,
        rulesetTitle: '雾港标准冒险规则',
        summary: '用简洁的成长、回合战斗、装备、制作和经济规则支撑以叙事为核心的地区冒险。',
        attributes: {
          power: { label: '腕力', meaning: '决定武器攻击的基础能力。' },
          vitality: { label: '坚韧', meaning: '决定生命上限与防御能力。' },
          agility: { label: '身法', meaning: '决定先手与暴击倾向。' },
        },
        skillResourceLabel: '战技点',
        equipmentSlotLabels: { weapon: '武器', armor: '护具', accessory: '信物' },
        currencyLabel: '港票',
        difficultyLabel: '标准',
        sourceClaimKeys: [options.forgedClaim ? 'source.claim.forged' : context.sourceLedger.claims[0]!.claimKey],
      }),
      bindingReceipt: bindingReceipt(input.requirementKey),
      usage: null,
    }
  }
}

async function rulesetFixture() {
  const input = await fixture()
  const p2Result = await executeP2(input)
  for (const artifact of p2Result.artifacts) {
    await acceptProductBuildArtifact({
      scope: input.scope,
      buildId: input.build.id!,
      controlEpoch: input.build.controlEpoch,
      artifactKey: artifact.artifactKey,
      kind: artifact.kind,
      payload: artifact.payload,
      quality: artifact.quality,
      rights: artifact.rights,
      inputHash: await hashProductProductionValueV2({ stage: 'P2', artifactKey: artifact.artifactKey }),
    })
  }
  const plan = await createTextOpenWorldProductionPlanV1({
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    briefHash: input.briefRow.briefHash,
    brief: input.brief,
  })
  const task = plan.tasks.find(item => item.taskKey === 'p2.gameplay-ruleset')!
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    sourceKeys: ['text-open-world.gameplay-ruleset-input'],
    productProductionId: input.production.id!,
    productBuildId: input.build.id!,
    inputBudgetMaxTokens: task.budgetReservation.inputTokens,
  })
  return {
    ...input,
    task,
    rulesetContextText: assembled.text,
    rulesetContext: JSON.parse(assembled.text) as TextOpenWorldGameplayRulesetInputContextV1,
    rulesetContextEvidence: assembled.sourceEvidence,
  }
}

async function executeRuleset(
  input: Awaited<ReturnType<typeof rulesetFixture>>,
  runModel: TextOpenWorldGameplayRulesetModelRunnerV1 = rulesetRunner(),
) {
  return createTextOpenWorldGameplayRulesetExecutorV1({ runModel, now: () => NOW + 5 })({
    scope: input.scope,
    productionId: input.production.id!,
    buildId: input.build.id!,
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    planHash: input.planHash,
    task: input.task,
    attempt: 1,
    idempotencyKey: await hashProductProductionValueV2('p2-gameplay-ruleset'),
    contextText: input.rulesetContextText,
    inputArtifacts: [],
    capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
      requirementKey,
      bindingHash: CAPABILITY_HASH,
      adapterId: 'configured-text.v1',
    })),
    signal: new AbortController().signal,
  })
}

function playerBuildRunner(options: { sameAttributes?: boolean } = {}): TextOpenWorldPlayerBuildModelRunnerV1 {
  return async input => ({
    output: JSON.stringify({
      schema: 'storyforge.text-open-world-player-build-draft',
      version: 1,
      identity: {
        pronouns: '他',
        appearance: '披着受潮的守灯人短斗篷，随身带有旧港区留下的盐迹。',
        background: '林舟熟悉雾港规则，并因潮门危机承担起调查与守护责任。',
        personality: '谨慎、坚韧，对陌生线索保持克制的好奇。',
        publicKnowledge: '港区居民知道他是参与调查的守灯人。',
        privateKnowledge: '他担心自己无法同时守住港口秩序和身边的人。',
        shortGoal: '查清潮门附近的首批异常。',
        longGoal: '在地区冒险与成长中阻止危机吞没雾港。',
        portrayal: '用简短观察和务实判断回应世界，对危机保持警惕但不冷漠。',
      },
      playstyleTitle: '敏锐的守灯调查者',
      playstyleSummary: '以观察后的迅速出手为主，同时保留正面解决危险的能力。',
      primaryAttribute: 'agility',
      secondaryAttribute: options.sameAttributes ? 'agility' : 'power',
      basicAttack: { title: '灯钩挥击', description: '用守灯短钩进行可靠的普通攻击。' },
      signatureSkill: {
        title: '潮隙突袭',
        description: '抓住敌人动作间隙快速突进，形成一次高压攻击。',
        combatPurpose: 'burst-damage',
      },
      starterWeapon: { title: '旧守灯短钩', description: '便于在潮湿狭窄环境中挥动的基础武器。' },
      recoveryConsumable: { title: '盐草敷包', description: '用于战斗中稳定伤势的基础恢复用品。' },
    }),
    bindingReceipt: bindingReceipt(input.requirementKey),
    usage: null,
  })
}

async function playerBuildFixture() {
  const input = await rulesetFixture()
  const rulesetResult = await executeRuleset(input)
  for (const artifact of rulesetResult.artifacts) {
    await acceptProductBuildArtifact({
      scope: input.scope,
      buildId: input.build.id!,
      controlEpoch: input.build.controlEpoch,
      artifactKey: artifact.artifactKey,
      kind: artifact.kind,
      payload: artifact.payload,
      quality: artifact.quality,
      rights: artifact.rights,
      inputHash: await hashProductProductionValueV2({ stage: 'P2', artifactKey: artifact.artifactKey }),
    })
  }
  const plan = await createTextOpenWorldProductionPlanV1({
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    briefHash: input.briefRow.briefHash,
    brief: input.brief,
  })
  const task = plan.tasks.find(item => item.taskKey === 'p4.player-build')!
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    sourceKeys: ['text-open-world.player-build-input'],
    productProductionId: input.production.id!,
    productBuildId: input.build.id!,
    inputBudgetMaxTokens: task.budgetReservation.inputTokens,
  })
  return {
    ...input,
    task,
    playerBuildContextText: assembled.text,
    playerBuildContext: JSON.parse(assembled.text) as TextOpenWorldPlayerBuildInputContextV1,
    playerBuildContextEvidence: assembled.sourceEvidence,
  }
}

async function executePlayerBuild(
  input: Awaited<ReturnType<typeof playerBuildFixture>>,
  runModel: TextOpenWorldPlayerBuildModelRunnerV1 = playerBuildRunner(),
) {
  return createTextOpenWorldPlayerBuildExecutorV1({ runModel, now: () => NOW + 6 })({
    scope: input.scope,
    productionId: input.production.id!,
    buildId: input.build.id!,
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    planHash: input.planHash,
    task: input.task,
    attempt: 1,
    idempotencyKey: await hashProductProductionValueV2('p4-player-build'),
    contextText: input.playerBuildContextText,
    inputArtifacts: [],
    capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
      requirementKey,
      bindingHash: CAPABILITY_HASH,
      adapterId: 'configured-text.v1',
    })),
    signal: new AbortController().signal,
  })
}

function storyArchitectureRunner(options: {
  forgedClaim?: boolean
  badPromiseOrder?: boolean
} = {}): TextOpenWorldStoryArchitectureModelRunnerV1 {
  return async input => {
    const context = JSON.parse(input.contextText) as TextOpenWorldStoryArchitectureInputContextV1
    const claimKey = options.forgedClaim
      ? 'source.claim.forged'
      : context.sourceLedger.selectedClaims[0]!.claimKey
    const sourceClaimKeys = [claimKey]
    const endings = [
      {
        title: '共守潮门', outcomeSummary: '各地区共同承担潮门维护，雾港以协作换来稳定。',
        differentiationAxis: '地区协作与权力共享', decisivePlayerValue: '信任与共同责任',
        coreGoalResolution: '林舟终止潮门危机，并建立多地区共同维护的新秩序。',
        eligiblePathSummary: '适合持续帮助各地区并维护合作关系的游玩路径。', sourceClaimKeys,
      },
      {
        title: '孤灯守界', outcomeSummary: '危机被终止，但林舟承担主要代价，地区保留更强自主性。',
        differentiationAxis: '个人承担与地区自主', decisivePlayerValue: '牺牲与克制干预',
        coreGoalResolution: '林舟以个人代价封住潮门，使沿岸免于继续被危机吞没。',
        eligiblePathSummary: '适合优先保护地区自主、接受个人代价的游玩路径。', sourceClaimKeys,
      },
    ]
    while (endings.length < context.gameBrief.scale.endingCount) {
      const number = endings.length + 1
      endings.push({
        title: `新约余波${number}`,
        outcomeSummary: `危机被终止，沿岸以第${number}种责任安排进入重建。`,
        differentiationAxis: `重建责任分配${number}`,
        decisivePlayerValue: `长期选择组合${number}`,
        coreGoalResolution: '林舟终止潮门危机，并让沿岸获得继续重建的条件。',
        eligiblePathSummary: `适合形成第${number}种地区后果组合的游玩路径。`,
        sourceClaimKeys,
      })
    }
    const allEndingNumbers = endings.map((_, index) => index + 1)
    return {
      output: JSON.stringify({
        schema: 'storyforge.text-open-world-story-architecture-draft',
        version: 1,
        title: '雾港潮门纪事',
        logline: '林舟从潮门异变出发，穿行多个地区查清危机，并以不同代价守住雾港。',
        themeStatement: '守护不是维持原状，而是在代价中选择应由谁共同承担未来。',
        coreConflict: {
          coreGoal: '终止持续吞没雾港边界的潮门危机。',
          protagonistDrive: '守住家园并查明危机为何重现。',
          opposingForce: '利用旧港盟约裂痕扩散潮灾的幕后力量。',
          conflictMechanism: '每次局部解围都会揭开更深的地区利益冲突，并迫使林舟寻找可持续的解决办法。',
          personalStakes: '林舟可能失去守灯人身份以及仍信任他的人。',
          regionalStakes: '各地区可能因互不信任而拒绝协作，逐步失去安全边界。',
          worldStakes: '潮门秩序崩解会让沿岸聚落长期暴露在失控潮灾中。',
        },
        macroBeats: [
          {
            phase: 'opening', title: '潮门失序',
            dramaticPurpose: '让主角承担守灯调查职责并确认危机不是偶发事故。',
            protagonistChange: '从执行日常职责转为主动追查异常。',
            requiredReveal: '潮门异变与旧港盟约留下的裂痕有关。',
            spatialFunctionNeeds: ['提供安全起点与首个危机现场'], sourceClaimKeys,
          },
          {
            phase: 'rising', title: '分裂的沿岸',
            dramaticPurpose: '通过地区矛盾扩张冲突，并让成长与盟友关系成为必要条件。',
            protagonistChange: '认识到单靠个人武力无法维持多个地区的安全。',
            requiredReveal: '不同地区掌握互相矛盾但都真实的危机线索。',
            spatialFunctionNeeds: ['承载差异化地区需求与成长冒险'], sourceClaimKeys,
          },
          {
            phase: 'turning-point', title: '旧约真相',
            dramaticPurpose: '重释危机成因，使玩家此前的地区经历获得新的意义。',
            protagonistChange: '从寻找单一敌人转为处理制度与个人共同造成的后果。',
            requiredReveal: '旧盟约曾以牺牲边缘地区换取雾港核心区稳定。',
            spatialFunctionNeeds: ['提供真相揭示与价值冲突场所'], sourceClaimKeys,
          },
          {
            phase: 'convergence', title: '沿岸集结',
            dramaticPurpose: '让重要关系、地区状态与玩家价值选择汇入最终行动。',
            protagonistChange: '决定以怎样的协作关系承担修复秩序的代价。',
            requiredReveal: '危机可被终止，但不同方案会留下不同的地区后果。',
            spatialFunctionNeeds: ['汇聚重要人物和地区后果'], sourceClaimKeys,
          },
          {
            phase: 'resolution', title: '新灯亮起',
            dramaticPurpose: '完成核心目标，并按玩家长期选择呈现不同但兼容的结局。',
            protagonistChange: '成为能够定义新秩序而不只是服从旧规则的守护者。',
            requiredReveal: '新的安全边界取决于林舟此前建立的信任与选择的代价。',
            spatialFunctionNeeds: ['承载终局行动与结局回收'], sourceClaimKeys,
          },
        ],
        endings,
        promises: [
          {
            kind: 'core-conflict', statement: '潮门危机能够被查明并最终终止。',
            setupBeatNumber: 1, setupDescription: '首场异变证明危机正在扩张。',
            callbacks: [{ beatNumber: options.badPromiseOrder ? 1 : 2, function: 'escalate', description: '沿岸异变升级并波及更多地区。' }],
            payoffBeatNumber: 5, payoffDescription: '玩家完成终局行动，两个结局都真正终止危机。',
            endingNumbers: allEndingNumbers, sourceClaimKeys,
          },
          {
            kind: 'character', statement: '林舟会从守灯执行者成长为新秩序的定义者。',
            setupBeatNumber: 1, setupDescription: '林舟最初只想完成守灯职责。',
            callbacks: [{ beatNumber: 3, function: 'recontextualize', description: '旧约真相迫使他重新理解职责。' }],
            payoffBeatNumber: 5, payoffDescription: '他的价值选择决定新秩序的形式。',
            endingNumbers: [1], sourceClaimKeys,
          },
          {
            kind: 'world', statement: '多个地区的局部冒险会汇成可见的世界后果。',
            setupBeatNumber: 1, setupDescription: '雾港首先暴露地区间依赖。',
            callbacks: [{ beatNumber: 3, function: 'complicate', description: '地区利益让共同解决方案变得困难。' }],
            payoffBeatNumber: 5, payoffDescription: '终局呈现各地区如何共同存续或保持自主。',
            endingNumbers: allEndingNumbers, sourceClaimKeys,
          },
          {
            kind: 'mystery', statement: '旧港盟约隐藏的牺牲会被逐层揭露并得到回应。',
            setupBeatNumber: 2, setupDescription: '矛盾线索暗示旧约记录不完整。',
            callbacks: [{ beatNumber: 4, function: 'recontextualize', description: '集结前揭示旧约与幕后力量的关系。' }],
            payoffBeatNumber: 5, payoffDescription: '终局处理旧约遗留的制度性代价。',
            endingNumbers: [2], sourceClaimKeys,
          },
        ],
        explicitAssumptionGapKeys: [],
      }),
      bindingReceipt: bindingReceipt(input.requirementKey),
      usage: null,
    }
  }
}

async function storyArchitectureFixture() {
  const input = await rulesetFixture()
  const plan = await createTextOpenWorldProductionPlanV1({
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    briefHash: input.briefRow.briefHash,
    brief: input.brief,
  })
  const task = plan.tasks.find(item => item.taskKey === 'p3.story-architecture')!
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    sourceKeys: ['text-open-world.story-architecture-input'],
    productProductionId: input.production.id!,
    productBuildId: input.build.id!,
    inputBudgetMaxTokens: task.budgetReservation.inputTokens,
  })
  return {
    ...input,
    task,
    storyContextText: assembled.text,
    storyContext: JSON.parse(assembled.text) as TextOpenWorldStoryArchitectureInputContextV1,
    storyContextEvidence: assembled.sourceEvidence,
  }
}

async function executeStoryArchitecture(
  input: Awaited<ReturnType<typeof storyArchitectureFixture>>,
  runModel: TextOpenWorldStoryArchitectureModelRunnerV1 = storyArchitectureRunner(),
) {
  return createTextOpenWorldStoryArchitectureExecutorV1({ runModel, now: () => NOW + 7 })({
    scope: input.scope,
    productionId: input.production.id!,
    buildId: input.build.id!,
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    planHash: input.planHash,
    task: input.task,
    attempt: 1,
    idempotencyKey: await hashProductProductionValueV2('p3-story-architecture'),
    contextText: input.storyContextText,
    inputArtifacts: [],
    capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
      requirementKey,
      bindingHash: CAPABILITY_HASH,
      adapterId: 'configured-text.v1',
    })),
    signal: new AbortController().signal,
  })
}

function storyArtifacts(
  result: Awaited<ReturnType<typeof executeStoryArchitecture>>,
): TextOpenWorldStoryArchitectureArtifactsV1 {
  return {
    storyArc: result.artifacts.find(item => item.artifactKey === 'text-open-world.story-arc')!.payload as TextOpenWorldStoryArchitectureArtifactsV1['storyArc'],
    endingContracts: result.artifacts.find(item => item.artifactKey === 'text-open-world.ending-contracts')!.payload as TextOpenWorldStoryArchitectureArtifactsV1['endingContracts'],
    narrativePromises: result.artifacts.find(item => item.artifactKey === 'text-open-world.narrative-promises')!.payload as TextOpenWorldStoryArchitectureArtifactsV1['narrativePromises'],
  }
}

function regionSkeletonRunner(options: {
  forgedClaim?: boolean
  disconnected?: boolean
} = {}): TextOpenWorldRegionSkeletonModelRunnerV1 {
  return async input => {
    const context = JSON.parse(input.contextText) as TextOpenWorldRegionSkeletonInputContextV1
    const claimKey = options.forgedClaim
      ? 'source.claim.forged'
      : context.sourceLedger.selectedClaims[0]!.claimKey
    const grounding = (beatNumber: number) => ({
      sourceClaimKeys: [claimKey],
      storyNeedRefs: [{ beatNumber, needNumber: 1 }],
    })
    const connections = [
      [1, 2, 'near', 'safe'], [1, 3, 'near', 'safe'], [1, 4, 'medium', 'ordinary'],
      [1, 5, 'far', 'ordinary'], [5, 6, 'near', 'safe'], [5, 7, 'medium', 'dangerous'],
      [5, 8, 'near', 'safe'],
    ].map(([fromLocationNumber, toLocationNumber, distanceBand, riskProfile], index) => ({
      fromLocationNumber,
      toLocationNumber,
      distanceBand,
      description: `第${index + 1}条道路连接相邻的生活、调查与冒险空间。`,
      riskProfile,
      connectionPurpose: '让玩家可自由往返，并为后续任务提供不依赖到达触发的空间路径。',
      ...grounding(Math.min(5, index + 1)),
    }))
    if (options.disconnected) connections.splice(3, 1)
    return {
      output: JSON.stringify({
        schema: 'storyforge.text-open-world-region-skeleton-draft',
        version: 1,
        startingRegionNumber: 1,
        startingLocationNumber: 1,
        regions: [
          {
            title: '雾港核心区',
            description: '守灯人、工坊与潮门共同维持的港口核心，也是玩家最初理解危机的安全起点。',
            theme: '职责、日常秩序与最初裂痕',
            narrativeRole: '承载开场危机、主角身份和最终回到家园时可见的变化。',
            ...grounding(1),
            hubLocationNumber: 1,
            locations: [
              {
                title: '雾港潮门', description: '守灯人与居民出入的港口广场，潮门异变的痕迹仍清晰可见。',
                kind: 'settlement', purpose: '提供开局叙事、安全服务、制作与地区旅行枢纽。',
                functions: ['narrative', 'service', 'crafting', 'travel'],
                earlyArrivalDescription: '主线未推进时，这里仍保持日常港务、基础服务和可反复调查的公开痕迹。',
                ...grounding(1),
              },
              {
                title: '守灯塔', description: '俯瞰潮门和沿岸航路的旧塔，保存守灯人的公开记录。',
                kind: 'landmark', purpose: '承载主角身份、世界观察和后续叙事回收。',
                functions: ['narrative', 'exploration'],
                earlyArrivalDescription: '玩家可查看公开记录与远眺沿岸，但关键真相不会因抵达而自动揭示。',
                ...grounding(5),
              },
              {
                title: '盐雾工坊', description: '修理灯具、武器和航行器材的公共工坊。',
                kind: 'interior', purpose: '为装备制作、补给和普通居民委托预留功能空间。',
                functions: ['service', 'crafting', 'exploration'],
                earlyArrivalDescription: '工匠只提供与当前进度相符的普通服务，不泄露尚未发生的任务信息。',
                ...grounding(2),
              },
              {
                title: '退潮滩', description: '潮水退去后显露盐壳、残骸与危险生物的开阔滩地。',
                kind: 'wilderness', purpose: '提供探索、基础战斗和地区小事件空间。',
                functions: ['exploration', 'combat'],
                earlyArrivalDescription: '这里始终可进行普通探索和战斗，主线相关遗留物只有在条件满足后才进入场景。',
                ...grounding(2),
              },
            ],
          },
          {
            title: '脊湾沿岸',
            description: '与雾港互相依赖却长期保留戒心的沿岸地区，分布集市、峡谷与旧约遗迹。',
            theme: '地区利益、旧约代价与协作选择',
            narrativeRole: '扩展地区差异，承载冲突升级、真相揭示、集结和终局选择。',
            sourceClaimKeys: [claimKey],
            storyNeedRefs: [2, 3, 4, 5].map(beatNumber => ({ beatNumber, needNumber: 1 })),
            hubLocationNumber: 1,
            locations: [
              {
                title: '脊湾集市', description: '沿岸居民交换物资与消息的中立集市。',
                kind: 'settlement', purpose: '提供第二地区服务、旅行枢纽、地方传闻和重要人物交汇点。',
                functions: ['narrative', 'service', 'travel'],
                earlyArrivalDescription: '提前到达时只呈现日常贸易与当地态度，重要人物保持安全等待而不自动开场。',
                ...grounding(2),
              },
              {
                title: '旧约档案所', description: '存放沿岸盟约公开副本与残缺索引的石屋。',
                kind: 'interior', purpose: '为调查与分阶段真相揭示提供可控的叙事空间。',
                functions: ['narrative', 'exploration'],
                earlyArrivalDescription: '玩家只能阅读公开索引，关键卷宗由后续明确任务条件开放而非到达触发。',
                ...grounding(3),
              },
              {
                title: '裂潮峡', description: '潮灾侵蚀形成的峡谷，危险生物与旧设施散布其中。',
                kind: 'dungeon', purpose: '承载成长战斗、资源探索和危机升级的环境证据。',
                functions: ['combat', 'exploration'],
                earlyArrivalDescription: '普通敌人与资源始终存在，涉及核心危机的场景在主线到达前不会加载。',
                ...grounding(2),
              },
              {
                title: '沿岸议事台', description: '各聚落处理共同事务的露天环形议场。',
                kind: 'landmark', purpose: '承载地区群像、后果汇聚与多结局前的价值选择。',
                functions: ['narrative', 'exploration'],
                earlyArrivalDescription: '非关键议事和居民争论可正常发生，主线集结必须由明确任务阶段启动。',
                sourceClaimKeys: [claimKey],
                storyNeedRefs: [{ beatNumber: 4, needNumber: 1 }, { beatNumber: 5, needNumber: 1 }],
              },
            ],
          },
        ],
        connections,
      }),
      bindingReceipt: bindingReceipt(input.requirementKey),
      usage: null,
    }
  }
}

async function regionSkeletonFixture() {
  const input = await storyArchitectureFixture()
  const storyResult = await executeStoryArchitecture(input)
  for (const artifact of storyResult.artifacts) {
    await acceptProductBuildArtifact({
      scope: input.scope,
      buildId: input.build.id!,
      controlEpoch: input.build.controlEpoch,
      artifactKey: artifact.artifactKey,
      kind: artifact.kind,
      payload: artifact.payload,
      quality: artifact.quality,
      rights: artifact.rights,
      inputHash: await hashProductProductionValueV2({ stage: 'P3', artifactKey: artifact.artifactKey }),
    })
  }
  const plan = await createTextOpenWorldProductionPlanV1({
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    briefHash: input.briefRow.briefHash,
    brief: input.brief,
  })
  const task = plan.tasks.find(item => item.taskKey === 'p4.region-skeleton')!
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    sourceKeys: ['text-open-world.region-skeleton-input'],
    productProductionId: input.production.id!,
    productBuildId: input.build.id!,
    inputBudgetMaxTokens: task.budgetReservation.inputTokens,
  })
  return {
    ...input,
    task,
    regionContextText: assembled.text,
    regionContext: JSON.parse(assembled.text) as TextOpenWorldRegionSkeletonInputContextV1,
    regionContextEvidence: assembled.sourceEvidence,
  }
}

async function executeRegionSkeleton(
  input: Awaited<ReturnType<typeof regionSkeletonFixture>>,
  runModel: TextOpenWorldRegionSkeletonModelRunnerV1 = regionSkeletonRunner(),
) {
  return createTextOpenWorldRegionSkeletonExecutorV1({ runModel, now: () => NOW + 8 })({
    scope: input.scope,
    productionId: input.production.id!,
    buildId: input.build.id!,
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    planHash: input.planHash,
    task: input.task,
    attempt: 1,
    idempotencyKey: await hashProductProductionValueV2('p4-region-skeleton'),
    contextText: input.regionContextText,
    inputArtifacts: [],
    capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
      requirementKey,
      bindingHash: CAPABILITY_HASH,
      adapterId: 'configured-text.v1',
    })),
    signal: new AbortController().signal,
  })
}

function mainlineRunner(options: {
  badBeatOrder?: boolean
  invalidLocation?: boolean
} = {}): TextOpenWorldMainlineModelRunnerV1 {
  return async input => {
    const context = JSON.parse(input.contextText) as TextOpenWorldMainlineInputContextV1
    const stage = (
      title: string,
      storyBeatNumber: number,
      regionNumbers: number[],
      locationNumbers: number[],
      gameplayFocus: string[],
      requiredReveal: string,
      stageOutcome: string,
      durationWeight: number,
    ) => ({
      title,
      summary: `${title}把故事宏观节拍转成玩家可调查、对话、探索或战斗完成的阶段。`,
      dramaticQuestion: `玩家如何在${title}中继续守住核心目标？`,
      storyBeatNumber,
      regionNumbers,
      locationNumbers,
      gameplayFocus,
      playerGoals: ['收集当前阶段的可靠信息', '通过明确行动解决本阶段核心阻力'],
      requiredReveal,
      stageOutcome,
      protectionNeeds: ['关键线索必须可重新获取', '承担主线信息的角色或替代入口必须受保护'],
      recoveryDescription: '战斗失败可从战前重试或复活后再次进入；拒绝、资源不足或普通世界状态不会永久关闭调查入口。',
      durationWeight,
    })
    const stages = [
      stage('潮门失序', 1, [1], [options.invalidLocation ? 99 : 1, 2], ['dialogue', 'investigation'], '确认潮门危机并非偶发事故。', '林舟正式承担调查责任并获得下一阶段明确入口。', 1),
      stage('退潮痕迹', 2, [1], [3, 4], ['exploration', 'combat'], '局部异常正沿地区依赖扩散。', '玩家获得进入脊湾调查所需的公开线索与成长准备。', 1),
      stage('分裂的沿岸', 2, [2], [5], ['dialogue', 'exploration'], '不同地区掌握互相矛盾但真实的线索。', '玩家理解两地利益冲突，并建立继续查证的路径。', 1),
      stage('旧约真相', options.badBeatOrder ? 1 : 3, [2], [6], ['investigation', 'choice'], '旧盟约曾以边缘地区代价维持核心区稳定。', '旧约真相被确认，核心冲突从寻找敌人转向修复失衡秩序。', 2),
      stage('裂潮试炼', 4, [2], [7], ['combat', 'preparation'], '危机可被终止，但最终行动需要可恢复的战斗准备。', '关键危险被清除，终局所需的行动窗口被建立。', 1),
      stage('沿岸集结', 4, [1, 2], [1, 5, 8], ['dialogue', 'choice', 'preparation'], '地区关系和长期选择将影响解决方案的代价。', '多个地区后果汇入最终行动，两个合规方案同时保持可达。', 2),
      stage('新灯亮起', 5, [1, 2], [2, 8], ['choice', 'investigation'], '新的安全边界取决于此前建立的信任与代价。', '核心危机被终止，并按玩家长期价值选择进入合规结局。', 1),
    ]
    return {
      output: JSON.stringify({
        schema: 'storyforge.text-open-world-mainline-draft',
        version: 1,
        title: '雾港潮门主线',
        summary: '林舟从雾港危机出发，调查两地裂痕、揭露旧约并以不同代价终止潮门危机。',
        stages,
        endingRoutes: context.endingContracts.endings.map(ending => ({
          endingNumber: ending.order,
          routeSummary: `最终Stage根据玩家长期选择表达“${ending.title}”，但都完成终止潮门危机的核心目标。`,
        })),
      }),
      bindingReceipt: bindingReceipt(input.requirementKey),
      usage: null,
    }
  }
}

async function acceptTaskArtifacts(
  input: Awaited<ReturnType<typeof regionSkeletonFixture>>,
  artifacts: Array<{
    artifactKey: string
    kind: string
    payload: unknown
    quality: Record<string, unknown>
    rights: Record<string, unknown>
  }>,
  stage: string,
) {
  for (const artifact of artifacts) {
    await acceptProductBuildArtifact({
      scope: input.scope,
      buildId: input.build.id!,
      controlEpoch: input.build.controlEpoch,
      artifactKey: artifact.artifactKey,
      kind: artifact.kind,
      payload: artifact.payload,
      quality: artifact.quality,
      rights: artifact.rights,
      inputHash: await hashProductProductionValueV2({ stage, artifactKey: artifact.artifactKey }),
    })
  }
}

async function mainlineFixture() {
  const input = await regionSkeletonFixture()
  const plan = await createTextOpenWorldProductionPlanV1({
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    briefHash: input.briefRow.briefHash,
    brief: input.brief,
  })
  const rulesetTask = plan.tasks.find(item => item.taskKey === 'p2.gameplay-ruleset')!
  const rulesetContext = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    sourceKeys: ['text-open-world.gameplay-ruleset-input'],
    productProductionId: input.production.id!,
    productBuildId: input.build.id!,
    inputBudgetMaxTokens: rulesetTask.budgetReservation.inputTokens,
  })
  const rulesetResult = await createTextOpenWorldGameplayRulesetExecutorV1({
    runModel: rulesetRunner(), now: () => NOW + 5,
  })({
    scope: input.scope, productionId: input.production.id!, buildId: input.build.id!,
    buildNumber: input.build.buildNumber, controlEpoch: input.build.controlEpoch,
    planHash: input.planHash, task: rulesetTask, attempt: 1,
    idempotencyKey: await hashProductProductionValueV2('mainline-ruleset'),
    contextText: rulesetContext.text, inputArtifacts: [],
    capabilityBindings: rulesetTask.capabilityRequirementKeys.map(requirementKey => ({
      requirementKey, bindingHash: CAPABILITY_HASH, adapterId: 'configured-text.v1',
    })),
    signal: new AbortController().signal,
  })
  await acceptTaskArtifacts(input, rulesetResult.artifacts, 'P2-ruleset')

  const playerTask = plan.tasks.find(item => item.taskKey === 'p4.player-build')!
  const playerContext = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    sourceKeys: ['text-open-world.player-build-input'],
    productProductionId: input.production.id!,
    productBuildId: input.build.id!,
    inputBudgetMaxTokens: playerTask.budgetReservation.inputTokens,
  })
  const playerResult = await createTextOpenWorldPlayerBuildExecutorV1({
    runModel: playerBuildRunner(), now: () => NOW + 6,
  })({
    scope: input.scope, productionId: input.production.id!, buildId: input.build.id!,
    buildNumber: input.build.buildNumber, controlEpoch: input.build.controlEpoch,
    planHash: input.planHash, task: playerTask, attempt: 1,
    idempotencyKey: await hashProductProductionValueV2('mainline-player'),
    contextText: playerContext.text, inputArtifacts: [],
    capabilityBindings: playerTask.capabilityRequirementKeys.map(requirementKey => ({
      requirementKey, bindingHash: CAPABILITY_HASH, adapterId: 'configured-text.v1',
    })),
    signal: new AbortController().signal,
  })
  await acceptTaskArtifacts(input, playerResult.artifacts, 'P4-player')

  const regionResult = await executeRegionSkeleton(input)
  await acceptTaskArtifacts(input, regionResult.artifacts, 'P4-region')
  const task = plan.tasks.find(item => item.taskKey === 'p5.mainline')!
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    sourceKeys: ['text-open-world.mainline-input'],
    productProductionId: input.production.id!,
    productBuildId: input.build.id!,
    inputBudgetMaxTokens: task.budgetReservation.inputTokens,
  })
  return {
    ...input,
    task,
    mainlineContextText: assembled.text,
    mainlineContext: JSON.parse(assembled.text) as TextOpenWorldMainlineInputContextV1,
    mainlineContextEvidence: assembled.sourceEvidence,
  }
}

async function executeMainline(
  input: Awaited<ReturnType<typeof mainlineFixture>>,
  runModel: TextOpenWorldMainlineModelRunnerV1 = mainlineRunner(),
) {
  return createTextOpenWorldMainlineExecutorV1({ runModel, now: () => NOW + 9 })({
    scope: input.scope,
    productionId: input.production.id!,
    buildId: input.build.id!,
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    planHash: input.planHash,
    task: input.task,
    attempt: 1,
    idempotencyKey: await hashProductProductionValueV2('p5-mainline'),
    contextText: input.mainlineContextText,
    inputArtifacts: [],
    capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
      requirementKey,
      bindingHash: CAPABILITY_HASH,
      adapterId: 'configured-text.v1',
    })),
    signal: new AbortController().signal,
  })
}

function significantThreadsRunner(options: {
  insufficientOwnerCoverage?: boolean
  invalidLocation?: boolean
} = {}): TextOpenWorldSignificantThreadsModelRunnerV1 {
  return async input => {
    const context = JSON.parse(input.contextText) as TextOpenWorldSignificantThreadsInputContextV1
    const claimKey = context.sourceLedger.selectedClaims[0]!.claimKey
    const stage = (
      title: string,
      regionNumber: number,
      locationNumber: number,
      gameplayFocus: string[],
      consequenceKind: string,
      index: number,
    ) => ({
      title,
      summary: `${title}通过可执行目标推进重要故事，但不会改写或阻断主线。`,
      dramaticQuestion: `玩家愿意以怎样的局部代价处理${title}？`,
      regionNumbers: [regionNumber],
      locationNumbers: [locationNumber],
      gameplayFocus,
      playerGoals: ['与冲突参与者交谈并确认其真实诉求', '完成一个可验证的地方行动'],
      stageOutcome: `第${index}阶段在安全等待点收束，并留下可见但不阻断主线的地区后果。`,
      durationWeight: index,
      localConsequences: [{
        kind: consequenceKind,
        direction: index % 2 ? 'increase' : 'change',
        magnitude: index === 3 ? 'moderate' : 'minor',
        description: '改变当地人对玩家的态度或地区日常表现，不改变主线核心目标和可达性。',
      }],
    })
    const threads = [
      {
        ownerKind: 'character',
        ownerTitle: '守灯学徒阿澜',
        title: '失落的守灯誓言',
        summary: '阿澜试图在家族责任、个人真相与雾港公共安全之间找到能够承担的选择。',
        centralConflict: '阿澜必须决定继承一套有缺陷的守灯传统，还是公开真相并重建自己的责任。',
        theme: '继承不是服从，而是理解代价之后重新作出承诺。',
        sourceClaimKeys: [claimKey],
        storyBeatNumbers: [1, 2],
        regionNumbers: [1],
        locationNumbers: [1, 2, 3],
        supportingPromiseNumbers: [1],
        availableAfterMainlineStageNumber: 1,
        conflictSides: [
          { name: '阿澜', goal: '查明导师隐瞒的誓言代价', resource: '守灯训练与导师留下的私人物件', pressure: '既害怕背叛传统，也无法继续假装无事发生' },
          { name: '守灯旧规维护者', goal: '维持雾港对守灯制度的信任', resource: '公开记录、职业权威与居民支持', pressure: '潮门异变让任何质疑都可能引发恐慌' },
        ],
        escalationSteps: ['私人物件暴露记录矛盾', '公开职责与个人真相发生冲突', '阿澜必须在保密与重建承诺之间选择'],
        atmosphereSignals: ['塔下学徒压低声音议论旧誓', '工坊拒绝修复来历不明的灯具', '居民对守灯人的问候随调查阶段变化'],
        stages: [
          stage('塔下旧物', 1, 2, ['dialogue', 'investigation'], 'npc-attitude', 1),
          stage('工坊证言', 1, 3, ['dialogue', 'exploration'], 'morality', 2),
          stage('重立誓言', 1, 1, ['dialogue', 'choice'], 'npc-attitude', 3),
        ],
      },
      {
        ownerKind: options.insufficientOwnerCoverage ? 'character' : 'region',
        ownerTitle: '脊湾沿岸共同体',
        title: '盐路与旧约',
        summary: '脊湾各聚落围绕盐路收益、危险治理和旧约责任展开一场可被玩家介入的地区纷争。',
        centralConflict: '依赖同一条盐路的群体无法就风险、收益和历史责任达成一致。',
        theme: '共同体不是没有冲突，而是能否建立承担冲突的规则。',
        sourceClaimKeys: [claimKey],
        storyBeatNumbers: [2, 3, 4],
        regionNumbers: [2],
        locationNumbers: [5, 6, options.invalidLocation ? 99 : 8],
        supportingPromiseNumbers: [2],
        availableAfterMainlineStageNumber: 3,
        conflictSides: [
          { name: '集市行商', goal: '保持盐路开放并降低通行成本', resource: '物资网络、价格和跨地消息', pressure: '持续封路会让普通家庭先破产' },
          { name: '沿岸守望者', goal: '在危险查明前限制通行', resource: '地形知识、巡逻队和居民信任', pressure: '近期伤亡迫使他们采取更激进的封锁' },
          { name: '旧约见证人', goal: '让各聚落承认被掩盖的历史责任', resource: '档案索引、仪式权威和幸存者证词', pressure: '主线调查让旧约争议重新公开' },
        ],
        escalationSteps: ['盐路检查引发价格冲突', '伤亡证据使双方拒绝妥协', '议事台必须形成新的共同治理办法'],
        atmosphereSignals: ['集市货架价格与货量发生变化', '道路旁增加守望者和受困行商', '功能NPC用不同问候表达对争议的立场'],
        stages: [
          stage('盐路争执', 2, 5, ['dialogue', 'investigation'], 'faction-affinity', 1),
          stage('旧约证词', 2, 6, ['dialogue', 'exploration'], 'regional-state', 2),
          stage('议事台新规', 2, 8, ['dialogue', 'choice'], 'regional-state', 3),
        ],
      },
    ]
    return {
      output: JSON.stringify({
        schema: 'storyforge.text-open-world-significant-threads-draft',
        version: 1,
        threads,
      }),
      bindingReceipt: bindingReceipt(input.requirementKey),
      usage: null,
    }
  }
}

async function significantThreadsFixture() {
  const input = await mainlineFixture()
  const mainlineResult = await executeMainline(input)
  await acceptTaskArtifacts(input, mainlineResult.artifacts, 'P5-mainline')
  const plan = await createTextOpenWorldProductionPlanV1({
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    briefHash: input.briefRow.briefHash,
    brief: input.brief,
  })
  const task = plan.tasks.find(item => item.taskKey === 'p6.significant-threads')!
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    sourceKeys: ['text-open-world.significant-threads-input'],
    productProductionId: input.production.id!,
    productBuildId: input.build.id!,
    inputBudgetMaxTokens: task.budgetReservation.inputTokens,
  })
  return {
    ...input,
    task,
    significantContextText: assembled.text,
    significantContext: JSON.parse(assembled.text) as TextOpenWorldSignificantThreadsInputContextV1,
    significantContextEvidence: assembled.sourceEvidence,
  }
}

async function executeSignificantThreads(
  input: Awaited<ReturnType<typeof significantThreadsFixture>>,
  runModel: TextOpenWorldSignificantThreadsModelRunnerV1 = significantThreadsRunner(),
) {
  return createTextOpenWorldSignificantThreadsExecutorV1({ runModel, now: () => NOW + 10 })({
    scope: input.scope,
    productionId: input.production.id!,
    buildId: input.build.id!,
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    planHash: input.planHash,
    task: input.task,
    attempt: 1,
    idempotencyKey: await hashProductProductionValueV2('p6-significant-threads'),
    contextText: input.significantContextText,
    inputArtifacts: [],
    capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
      requirementKey,
      bindingHash: CAPABILITY_HASH,
      adapterId: 'configured-text.v1',
    })),
    signal: new AbortController().signal,
  })
}

function regionNarrativePacksRunner(options: {
  wrongSupply?: boolean
  omitLocation?: boolean
  duplicateDistinctiveness?: boolean
  missingOwner?: boolean
} = {}): TextOpenWorldRegionNarrativePacksModelRunnerV1 {
  return async input => {
    const context = JSON.parse(input.contextText) as TextOpenWorldRegionNarrativePacksInputContextV1
    const claimKey = context.sourceLedger.selectedClaims[0]!.claimKey
    const eventKinds = ['ambient', 'opportunity', 'danger', 'discovery', 'social', 'ambient']
    const packs = context.regionSkeleton.regions.map((region, regionIndex) => {
      const ownedLocations = context.regionSkeleton.locations.filter(location => location.regionKey === region.key)
      const locationNumber = (index: number) => ownedLocations[index % ownedLocations.length]!.order
      const tensionTitle = (index: number) => `${region.title}矛盾${index + 1}`
      return {
        regionNumber: region.order,
        title: `${region.title}地区生态`,
        fantasy: regionIndex === 0
          ? '在潮雾港口的日常职责中追查危机留下的细小裂痕。'
          : '在盐路、旧约和多方利益之间参与一场持续变化的沿岸生活。',
        localConflict: regionIndex === 0
          ? '维持港口日常秩序的人们对公开危机真相的代价存在分歧。'
          : '依赖盐路的群体无法就收益、风险和旧约责任达成共同规则。',
        regionalQuestion: regionIndex === 0 ? '安全是否必须依赖沉默？' : '共同体如何分担一条危险道路的代价？',
        dailyLifeBaseline: '居民按清晨、白天和夜晚执行劳作、服务、交换消息与休息规则，主线等待时日常仍继续。',
        distinctivenessStatement: options.duplicateDistinctiveness
          ? '重复的地区体验。'
          : regionIndex === 0 ? '紧凑港口中的职责调查与熟人社会反馈。' : '开阔沿岸中的路线选择、多方议事与资源流动。',
        sourceClaimKeys: [claimKey],
        tensions: [0, 1].map(index => ({
          title: tensionTitle(index),
          sideA: index === 0 ? '依靠现有秩序维持生计的人' : '要求立即处理危险的人',
          sideB: index === 0 ? '要求公开旧问题的人' : '担忧行动破坏日常供给的人',
          stakes: '局部信任、物资流动和地区生活面貌会变化，但主线入口始终保留。',
          pressureAxis: index === 0 ? '保密与公开' : '安全与生计',
        })),
        stateAxes: [
          { title: '地方信任', lowExpression: '居民回避交谈并减少互助。', middleExpression: '居民维持礼貌但观望。', highExpression: '居民主动分享公开消息并提供普通协助。' },
          { title: '日常稳定', lowExpression: '服务和公共活动出现明显中断。', middleExpression: '生活勉强维持且争论增多。', highExpression: '公共活动恢复并出现新的协作习惯。' },
        ],
        locations: ownedLocations.slice(0, options.omitLocation && regionIndex === 1 ? -1 : undefined).map((location, index) => ({
          locationNumber: location.order,
          dailyLife: `${location.title}在非任务时仍有与其${location.functions.join('、')}功能相符的日常活动。`,
          activityPatterns: [`观察${location.title}的日常变化`, `与当地功能角色进行普通交互`],
          npcRoleNeeds: ['提供日常问候的居民', `维持${location.functions[0]}功能的角色`],
          rumorHooks: [`关于${tensionTitle(index % 2)}的一条局部传闻`],
          timeExpressions: ['清晨开始劳作，白天开放主要功能，夜晚减少服务并改变问候。'],
          contentRisk: location.functions.includes('combat') ? 'dangerous' : index % 2 ? 'ordinary' : 'safe',
        })),
        characters: [
          {
            tier: 'important',
            roleTitle: regionIndex === 0 ? '守灯学徒阿澜' : '沿岸议事记录人',
            narrativeFunction: '持续保持地区冲突、重要故事进度和玩家已知后果的一致表达。',
            homeLocationNumber: locationNumber(0),
            routine: '在安全等待点按地区时段出现在固定公共地点，不因玩家缺席推进关键结果。',
            serviceNeeds: [],
            significantThreadNumbers: regionIndex === 0 && !options.missingOwner ? [1] : regionIndex === 1 ? [2] : [],
            sourceClaimKeys: [claimKey],
          },
          {
            tier: 'functional',
            roleTitle: regionIndex === 0 ? '盐雾工匠' : '脊湾行商',
            narrativeFunction: '通过服务、价格、问候和普通委托表现地区状态。',
            homeLocationNumber: locationNumber(1),
            routine: '日出后提供功能，夜晚休息；只按规则读取道德、阵营和地区状态。',
            serviceNeeds: ['基础交易', '地区普通委托入口'],
            significantThreadNumbers: [],
            sourceClaimKeys: [],
          },
          {
            tier: 'ambient',
            roleTitle: regionIndex === 0 ? '港务居民' : '沿岸搬运者',
            narrativeFunction: '用短问候和日常行动建立人口与劳动氛围。',
            homeLocationNumber: locationNumber(0),
            routine: '日出而作、日落而息，危险时移动到安全地点。',
            serviceNeeds: [],
            significantThreadNumbers: [],
            sourceClaimKeys: [],
          },
        ],
        factions: [{
          title: regionIndex === 0 ? '雾港守灯会' : '脊湾行商联合',
          publicGoal: '维持地区生活所依赖的公共功能，同时争取对风险处置的话语权。',
          localResource: regionIndex === 0 ? '灯塔记录、工坊和居民信任' : '货运网络、价格消息和盐路节点',
          visiblePresence: '通过服饰、工作地点、问候和地区事件中的立场被玩家识别。',
          significantThreadNumbers: regionIndex === 1 ? [2] : [],
          sourceClaimKeys: [claimKey],
        }],
        ordinaryQuestSeeds: Array.from({ length: regionIndex === 0 && options.wrongSupply ? 2 : 3 }, (_, index) => ({
          title: `${region.title}普通委托${index + 1}`,
          premise: `一名处在${tensionTitle(index % 2)}中的普通居民遇到具体而局部的问题。`,
          playerActivity: ['调查公开痕迹并核对说法', '探索指定地点并带回资源', '在冲突双方之间传递可验证信息'][index % 3],
          locationNumbers: [locationNumber(index)],
          tensionNumber: index % 2 + 1,
          rewardNeeds: index % 2 ? ['经验', '货币'] : ['经验', '制作材料'],
          estimatedMinutes: 12 + index * 3,
          sourceClaimKeys: [],
        })),
        taskTemplateSeeds: Array.from({ length: 2 }, (_, index) => ({
          title: `${region.title}需求模板${index + 1}`,
          storyFrame: index === 0 ? '功能NPC因地区状态产生一项可替换目标的资源需求。' : '居民听到传闻后请求玩家核实一个可替换地点的异常。',
          locationNumbers: [locationNumber(index)],
          variationAxes: ['委托人身份', '目标地点', '所需资源', '地区当前压力'],
          eligibilitySummary: '只在地点已知、玩家等级合适且同结构近期未出现时进入地区牌组。',
          cooldownIntent: '同一结构冷却若干次地区抽牌，并优先更换委托人、地点和叙事包装。',
          sourceClaimKeys: [],
        })),
        randomEventSeeds: Array.from({ length: 6 }, (_, index) => ({
          kind: eventKinds[index],
          title: `${region.title}地区事件${index + 1}`,
          setup: `地区状态与${tensionTitle(index % 2)}在${ownedLocations[index % ownedLocations.length]!.title}形成一个短时可见场面。`,
          playerOpportunity: '玩家可以观察、交谈、提供普通帮助或离开；忽略不会阻断主线或重要故事。',
          locationNumbers: [locationNumber(index)],
          repeatability: index < 2 ? 'repeatable-variant' : 'one-shot',
          sourceClaimKeys: [],
        })),
        rumors: [0, 1, 2].map(index => ({
          text: `${region.title}居民最近在谈论第${index + 1}件与地方生活有关的小事。`,
          pointsTo: ['tension', 'location', 'event'][index],
          spoilerBoundary: '只透露玩家当前可知道的地点名称、公开冲突或事件迹象，不披露隐藏任务结果。',
          sourceClaimKeys: [],
        })),
      }
    })
    return {
      output: JSON.stringify({
        schema: 'storyforge.text-open-world-region-narrative-packs-draft',
        version: 1,
        packs,
      }),
      bindingReceipt: bindingReceipt(input.requirementKey),
      usage: null,
    }
  }
}

async function regionNarrativePacksFixture() {
  const input = await significantThreadsFixture()
  const significantResult = await executeSignificantThreads(input)
  await acceptTaskArtifacts(input, significantResult.artifacts, 'P6-significant')
  const plan = await createTextOpenWorldProductionPlanV1({
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    briefHash: input.briefRow.briefHash,
    brief: input.brief,
  })
  const task = plan.tasks.find(item => item.taskKey === 'p7.region-narrative-packs')!
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    sourceKeys: ['text-open-world.region-narrative-packs-input'],
    productProductionId: input.production.id!,
    productBuildId: input.build.id!,
    inputBudgetMaxTokens: task.budgetReservation.inputTokens,
  })
  return {
    ...input,
    task,
    regionPacksContextText: assembled.text,
    regionPacksContext: JSON.parse(assembled.text) as TextOpenWorldRegionNarrativePacksInputContextV1,
    regionPacksContextEvidence: assembled.sourceEvidence,
  }
}

async function executeRegionNarrativePacks(
  input: Awaited<ReturnType<typeof regionNarrativePacksFixture>>,
  runModel: TextOpenWorldRegionNarrativePacksModelRunnerV1 = regionNarrativePacksRunner(),
) {
  return createTextOpenWorldRegionNarrativePacksExecutorV1({ runModel, now: () => NOW + 11 })({
    scope: input.scope,
    productionId: input.production.id!,
    buildId: input.build.id!,
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    planHash: input.planHash,
    task: input.task,
    attempt: 1,
    idempotencyKey: await hashProductProductionValueV2('p7-region-narrative-packs'),
    contextText: input.regionPacksContextText,
    inputArtifacts: [],
    capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
      requirementKey,
      bindingHash: CAPABILITY_HASH,
      adapterId: 'configured-text.v1',
    })),
    signal: new AbortController().signal,
  })
}

function questSkeletonsRunner(options: {
  omitSource?: boolean
  weakProtected?: boolean
  invalidCombat?: boolean
  conflictingRequirement?: boolean
  prematureField?: boolean
} = {}): TextOpenWorldQuestSkeletonsModelRunnerV1 {
  return async input => {
    const context = JSON.parse(input.contextText) as TextOpenWorldQuestSkeletonsInputContextV1
    const kindsBySource = {
      'mainline-stage': ['actor', 'skill', 'faction', 'item', 'encounter', 'faction', 'reward'],
      'significant-stage': ['actor', 'action', 'faction', 'actor', 'faction', 'reward'],
      'ordinary-seed': ['actor', 'item', 'material', 'enemy', 'vendor', 'reward'],
      'template-seed': ['actor', 'item', 'encounter', 'location-interaction'],
    } as const
    const intentByKind = {
      actor: 'dialogue', faction: 'dialogue', enemy: 'combat', encounter: 'combat',
      item: 'collect', equipment: 'collect', material: 'collect', skill: 'interact',
      recipe: 'interact', vendor: 'trade', reward: 'interact', action: 'interact',
      'location-interaction': 'interact',
    } as const
    const quests = context.questSources.map(source => {
      const sameKindSources = context.questSources.filter(candidate => candidate.kind === source.kind)
      const sourceNumber = sameKindSources.findIndex(candidate => candidate.sourceKey === source.sourceKey) + 1
      let kind = kindsBySource[source.kind][(sourceNumber - 1) % kindsBySource[source.kind].length]
      let title = `${source.title}所需${kind}`
      if (options.conflictingRequirement && source.kind === 'mainline-stage' && sourceNumber <= 2) {
        kind = 'actor'
        title = '冲突定义的同名关键角色'
      }
      const criticality = source.type === 'mainline'
        ? options.weakProtected && sourceNumber === 1 ? 'ordinary' : 'protected'
        : source.type === 'significant' ? 'important' : 'ordinary'
      const requirement: Record<string, unknown> = {
        kind,
        title,
        description: `为${source.sourceKey}提供能够支持玩家完成目标的${kind}定义。`,
        requestedTraits: [`关联${source.kind}`, `服务${source.title}`],
        minimumCount: 1,
        criticality,
      }
      if (options.prematureField && source.kind === 'mainline-stage' && sourceNumber === 1) {
        requirement.enemyKey = 'enemy.forged'
      }
      const timed = (source.type === 'ordinary' && sourceNumber % 3 === 0) || source.type === 'template'
      const playerIntent = options.invalidCombat && source.kind === 'mainline-stage' && sourceNumber === 1
        ? 'combat'
        : intentByKind[kind]
      return {
        sourceKind: source.kind,
        sourceNumber,
        title: source.title,
        premise: source.premise,
        storyMotivation: `让玩家通过可执行行动推进“${source.title}”，并理解它与当前世界局势的关系。`,
        intendedPlayerExperience: `在${source.regionKeys.join('、')}完成一个有明确起因、过程和反馈的${source.type}任务。`,
        timePolicy: timed ? 'timed' : 'waits',
        expirationMinutes: timed ? source.type === 'template' ? 180 : 240 : null,
        stages: [{
          title: `${source.title}执行阶段`,
          purpose: '把故事前提转化为玩家可观察、可选择并可验证完成的行动。',
          completionIntent: '玩家完成关键行动并获得清晰的叙事与系统反馈。',
          objectives: [{
            title: `处理${source.title}的当前目标`,
            playerIntent,
            successDescription: `已完成${source.title}要求的关键行动。`,
            optional: false,
            requirements: [requirement],
          }],
        }],
      }
    })
    return {
      output: JSON.stringify({
        schema: 'storyforge.text-open-world-quest-skeletons-draft',
        version: 1,
        quests: options.omitSource ? quests.slice(0, -1) : quests,
      }),
      bindingReceipt: bindingReceipt(input.requirementKey),
      usage: null,
    }
  }
}

async function questSkeletonsFixture() {
  const input = await regionNarrativePacksFixture()
  const regionPacksResult = await executeRegionNarrativePacks(input)
  await acceptTaskArtifacts(input, regionPacksResult.artifacts, 'P7-region-packs')
  const plan = await createTextOpenWorldProductionPlanV1({
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    briefHash: input.briefRow.briefHash,
    brief: input.brief,
  })
  const task = plan.tasks.find(item => item.taskKey === 'p8.quest-skeletons')!
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    sourceKeys: ['text-open-world.quest-skeletons-input'],
    productProductionId: input.production.id!,
    productBuildId: input.build.id!,
    inputBudgetMaxTokens: task.budgetReservation.inputTokens,
  })
  return {
    ...input,
    task,
    questContextText: assembled.text,
    questContext: JSON.parse(assembled.text) as TextOpenWorldQuestSkeletonsInputContextV1,
    questContextEvidence: assembled.sourceEvidence,
  }
}

async function executeQuestSkeletons(
  input: Awaited<ReturnType<typeof questSkeletonsFixture>>,
  runModel: TextOpenWorldQuestSkeletonsModelRunnerV1 = questSkeletonsRunner(),
) {
  return createTextOpenWorldQuestSkeletonsExecutorV1({ runModel, now: () => NOW + 12 })({
    scope: input.scope,
    productionId: input.production.id!,
    buildId: input.build.id!,
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    planHash: input.planHash,
    task: input.task,
    attempt: 1,
    idempotencyKey: await hashProductProductionValueV2('p8-quest-skeletons'),
    contextText: input.questContextText,
    inputArtifacts: [],
    capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
      requirementKey,
      bindingHash: CAPABILITY_HASH,
      adapterId: 'configured-text.v1',
    })),
    signal: new AbortController().signal,
  })
}

function progressionCatalogsRunner(options: {
  omitDemand?: boolean
  rewriteInitial?: boolean
  invalidPassive?: boolean
  missingCombatFormula?: boolean
} = {}): TextOpenWorldProgressionCatalogsModelRunnerV1 {
  return async input => {
    const context = JSON.parse(input.contextText) as TextOpenWorldProgressionCatalogsInputContextV1
    const skills = context.skillDemands.map((demand, index) => {
      const fixed = demand.fixedMechanics
      let activation = fixed?.activation ?? (index % 3 === 0 ? 'passive' : 'active')
      let kind = fixed?.kind ?? (index % 3 === 0 ? 'status' : index % 3 === 1 ? 'attack' : 'recovery')
      let target = fixed?.target ?? (activation === 'passive' || kind !== 'attack' ? 'self' : 'single-enemy')
      const scalingAttribute = fixed?.scalingAttribute ?? (kind === 'attack' ? 'power' : kind === 'recovery' ? 'vitality' : null)
      let resourceCost = fixed?.resourceCost ?? (activation === 'passive' ? 0 : 2)
      let cooldownTurns = fixed?.cooldownTurns ?? (activation === 'passive' ? 0 : 1)
      if (options.invalidPassive && demand.demandKind === 'level-progression' && demand.unlockPlan.level === 2) {
        activation = 'passive'; kind = 'status'; target = 'single-enemy'; resourceCost = 1; cooldownTurns = 1
      }
      const combatRequired = activation === 'active' && kind === 'attack'
      return {
        demandNumber: demand.demandNumber,
        title: options.rewriteInitial && demand.demandNumber === 1
          ? '篡改后的基础攻击'
          : demand.fixedTitle ?? (demand.demandKind === 'level-progression'
            ? `${demand.unlockPlan.level}级守灯技`
            : `${demand.semanticBrief.slice(0, 12)}技${index + 1}`),
        description: demand.fixedDescription ?? `${demand.semanticBrief}该能力以明确的系统效果支持角色成长。`,
        tags: [demand.demandKind, demand.requestedTraits[0] ?? '成长'],
        activation,
        kind,
        target,
        scalingAttribute,
        priority: Math.max(10, 100 - index),
        resourceCost,
        cooldownTurns,
        combatPowerNumerator: combatRequired && !(options.missingCombatFormula && demand.demandNumber === 1)
          ? demand.demandNumber === 1 ? 1 : 3 : null,
        combatPowerDenominator: combatRequired ? demand.demandNumber === 1 ? 1 : 2 : null,
        flatDamage: combatRequired ? 0 : null,
      }
    })
    return {
      output: JSON.stringify({
        schema: 'storyforge.text-open-world-progression-catalogs-draft',
        version: 1,
        skills: options.omitDemand ? skills.slice(0, -1) : skills,
        statuses: [
          { title: '守势', description: '角色暂时采取更谨慎的防御姿态。', polarity: 'beneficial' },
          { title: '破绽', description: '角色短暂暴露出容易被利用的行动破绽。', polarity: 'harmful' },
        ],
      }),
      bindingReceipt: bindingReceipt(input.requirementKey),
      usage: null,
    }
  }
}

async function progressionCatalogsFixture() {
  const input = await questSkeletonsFixture()
  const questResult = await executeQuestSkeletons(input)
  await acceptTaskArtifacts(input, questResult.artifacts, 'P8-quest-skeletons')
  const plan = await createTextOpenWorldProductionPlanV1({
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    briefHash: input.briefRow.briefHash,
    brief: input.brief,
  })
  const task = plan.tasks.find(item => item.taskKey === 'p8.catalog.progression')!
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    sourceKeys: ['text-open-world.progression-catalogs-input'],
    productProductionId: input.production.id!,
    productBuildId: input.build.id!,
    inputBudgetMaxTokens: task.budgetReservation.inputTokens,
  })
  return {
    ...input,
    task,
    progressionContextText: assembled.text,
    progressionContext: JSON.parse(assembled.text) as TextOpenWorldProgressionCatalogsInputContextV1,
    progressionContextEvidence: assembled.sourceEvidence,
  }
}

async function executeProgressionCatalogs(
  input: Awaited<ReturnType<typeof progressionCatalogsFixture>>,
  runModel: TextOpenWorldProgressionCatalogsModelRunnerV1 = progressionCatalogsRunner(),
) {
  return createTextOpenWorldProgressionCatalogsExecutorV1({ runModel, now: () => NOW + 13 })({
    scope: input.scope,
    productionId: input.production.id!,
    buildId: input.build.id!,
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    planHash: input.planHash,
    task: input.task,
    attempt: 1,
    idempotencyKey: await hashProductProductionValueV2('p8-progression-catalogs'),
    contextText: input.progressionContextText,
    inputArtifacts: [],
    capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
      requirementKey, bindingHash: CAPABILITY_HASH, adapterId: 'configured-text.v1',
    })),
    signal: new AbortController().signal,
  })
}

function encounterCatalogRunner(options: {
  omitDemand?: boolean
  invalidLocation?: boolean
  duplicateEnemyTitle?: boolean
} = {}): TextOpenWorldEncounterCatalogModelRunnerV1 {
  return async input => {
    const context = JSON.parse(input.contextText) as TextOpenWorldEncounterCatalogInputContextV1
    const encounters = context.encounterDemands.map((demand, index) => ({
      demandNumber: demand.demandNumber,
      enemyTitle: options.duplicateEnemyTitle ? '重复敌人' : `${demand.title}之敌${index + 1}`,
      enemyDescription: `${demand.description}该敌人的行动方式能够体现${demand.requestedTraits[0] ?? '地区危险'}。`,
      enemyTags: [demand.demandKind, demand.criticality],
      enemyArchetype: ['balanced', 'brute', 'swift', 'armored'][index % 4],
      encounterTitle: `${demand.title}遭遇${index + 1}`,
      encounterDescription: `玩家在${demand.regionKey}面对与需求相符、可以逃跑并可失败恢复的战斗。`,
      locationNumber: options.invalidLocation && index === 0 ? demand.candidateLocationKeys.length + 1 : 1,
      recommendedLevel: Math.min(5, index + 1),
      intensity: demand.criticality === 'protected' ? 'dangerous' : 'ordinary',
      enemyCount: demand.criticality === 'ordinary' ? 1 : 2,
      openingText: `${demand.title}对应的威胁挡在玩家面前。`,
      victoryText: '威胁暂时解除，玩家可以继续当前行动。',
      defeatText: '这次交锋失败了；玩家可以从战前重试或回到复活点。',
    }))
    return {
      output: JSON.stringify({
        schema: 'storyforge.text-open-world-encounter-catalog-draft',
        version: 1,
        encounters: options.omitDemand ? encounters.slice(0, -1) : encounters,
      }),
      bindingReceipt: bindingReceipt(input.requirementKey),
      usage: null,
    }
  }
}

async function encounterCatalogFixture() {
  const input = await progressionCatalogsFixture()
  const progressionResult = await executeProgressionCatalogs(input)
  await acceptTaskArtifacts(input, progressionResult.artifacts, 'P8-progression-catalogs')
  const plan = await createTextOpenWorldProductionPlanV1({
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    briefHash: input.briefRow.briefHash,
    brief: input.brief,
  })
  const task = plan.tasks.find(item => item.taskKey === 'p8.catalog.encounters')!
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    sourceKeys: ['text-open-world.encounter-catalog-input'],
    productProductionId: input.production.id!,
    productBuildId: input.build.id!,
    inputBudgetMaxTokens: task.budgetReservation.inputTokens,
  })
  return {
    ...input,
    task,
    encounterContextText: assembled.text,
    encounterContext: JSON.parse(assembled.text) as TextOpenWorldEncounterCatalogInputContextV1,
    encounterContextEvidence: assembled.sourceEvidence,
  }
}

async function executeEncounterCatalog(
  input: Awaited<ReturnType<typeof encounterCatalogFixture>>,
  runModel: TextOpenWorldEncounterCatalogModelRunnerV1 = encounterCatalogRunner(),
) {
  return createTextOpenWorldEncounterCatalogExecutorV1({ runModel, now: () => NOW + 14 })({
    scope: input.scope,
    productionId: input.production.id!,
    buildId: input.build.id!,
    buildNumber: input.build.buildNumber,
    controlEpoch: input.build.controlEpoch,
    planHash: input.planHash,
    task: input.task,
    attempt: 1,
    idempotencyKey: await hashProductProductionValueV2('p8-encounter-catalog'),
    contextText: input.encounterContextText,
    inputArtifacts: [],
    capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
      requirementKey, bindingHash: CAPABILITY_HASH, adapterId: 'configured-text.v1',
    })),
    signal: new AbortController().signal,
  })
}

describe('R-OPEN-WORLD3 · P2 GameBrief / ExperienceContract / ProtagonistAsset', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('从作者授权Brief和P1证据编译固定产品边界，再由模型补充体验语义', async () => {
    const input = await fixture()
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.experience-input')).toMatchObject({
      layer: 'L0', ownerFrom: 'work', protectedFromTrim: true,
    })
    expect(getAgentSkillV1('text-open-world.production.experience-design.v1')).toMatchObject({
      contextSourceKeys: ['text-open-world.experience-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
    })
    expect(input.contextEvidence).toEqual([
      expect.objectContaining({ key: 'text-open-world.experience-input', status: 'included', delivery: 'full' }),
    ])
    expect(input.context.source.sourcePinHash).toBe(input.bundle.pin.pinHash)
    expect(input.context.authorization.confirmedBriefHash).toBe(input.confirmed.confirmationHash)
    expect(input.context.totalClaimCount).toBeGreaterThan(0)
    expect(input.context.omittedClaimCount).toBe(0)

    const result = await executeP2(input)
    const artifacts = resultArtifacts(result)
    expect(result.passedGateIds).toEqual(input.p2.acceptanceGateIds)
    expect(result.usage).toMatchObject({ modelCalls: 1, mediaCalls: 0 })
    expect(result.usage.inputTokens).toBeGreaterThan(0)
    expect(result.usage.outputTokens).toBeGreaterThan(0)
    expect(artifacts.gameBrief).toMatchObject({
      productInstanceKey: input.production.productionKey,
      authorization: {
        productBriefHash: input.briefRow.briefHash,
        confirmedBriefHash: input.confirmed.confirmationHash,
      },
      source: {
        sourcePinHash: input.bundle.pin.pinHash,
        openGapKeys: input.context.allOpenGapKeys,
      },
      fixedProductBoundary: {
        freedomMode: 'bounded-guided',
        interactionModes: ['system-action', 'fixed-choice', 'natural-language'],
        mainlineOrder: 'strict-sequential',
        ordinaryWorldEvolution: 'continues-with-time',
        combatInput: ['fight', 'escape', 'skill', 'item'],
        combatMode: 'turn-based',
        difficulty: 'standard',
      },
      media: {
        requiredVisualKinds: ['procedural-map', 'character-portrait', 'scene-background'],
        textFallbackRequired: true,
      },
      completion: { releaseMode: 'direct-after-gates' },
    })
    expect(artifacts.experienceContract).toMatchObject({
      gameBriefHash: artifacts.gameBrief.gameBriefHash,
      freedom: { customSolutionPolicy: 'future-extension' },
      narrative: {
        mainline: 'strict-sequential-protected',
        importantStorylines: 'persistent-safe-wait',
        ordinaryContent: 'regional-deck-and-fixed-quests',
      },
      worldEvolution: { mainlineWaits: true, timeWeatherAndRegionsContinue: true },
    })
    expect(artifacts.protagonistAsset).toMatchObject({
      origin: 'source-character',
      displayName: input.context.protagonistCandidates[0]!.label,
      protection: {
        criticalRole: true,
        playerMayAbandonMainline: false,
        initialBuildDeferredToP4: true,
      },
    })
    await expect(validateTextOpenWorldExperienceArtifactsV1({
      artifacts,
      context: input.context,
    })).resolves.toEqual(artifacts)
  }, 30_000)

  it('拒绝模型引用未交付来源事实，且不会用自然语言越过P1证据边界', async () => {
    const input = await fixture()
    await expect(executeP2(input, experienceRunner({ forgedClaim: true })))
      .rejects.toThrow(/未交付的SourceLedger claim/)
  }, 30_000)

  it('即使重新计算Artifact Hash，也拒绝篡改交互、主线和完整缺口边界', async () => {
    const input = await fixture()
    const artifacts = resultArtifacts(await executeP2(input))
    const tampered = structuredClone(artifacts)
    tampered.gameBrief.fixedProductBoundary.interactionModes = [
      'natural-language', 'fixed-choice', 'system-action',
    ]
    const { gameBriefHash: _oldHash, ...body } = tampered.gameBrief
    tampered.gameBrief.gameBriefHash = await hashProductProductionValueV2(body)
    await expect(validateTextOpenWorldExperienceArtifactsV1({
      artifacts: tampered,
      context: input.context,
    })).rejects.toThrow(/交互模式不精确/)

    const forgedContext = structuredClone(input.context)
    forgedContext.allOpenGapKeys.push('source.gap.forged')
    const executor = createTextOpenWorldExperienceDesignExecutorV1({ runModel: experienceRunner() })
    await expect(executor({
      scope: input.scope,
      productionId: input.production.id!,
      buildId: input.build.id!,
      buildNumber: input.build.buildNumber,
      controlEpoch: input.build.controlEpoch,
      planHash: input.planHash,
      task: input.p2,
      attempt: 1,
      idempotencyKey: await hashProductProductionValueV2('forged-context'),
      contextText: JSON.stringify(forgedContext),
      inputArtifacts: [],
      capabilityBindings: input.p2.capabilityRequirementKeys.map(requirementKey => ({
        requirementKey,
        bindingHash: CAPABILITY_HASH,
        adapterId: 'configured-text.v1',
      })),
      signal: new AbortController().signal,
    })).rejects.toThrow(/数量闭包无效|选择Hash不匹配/)
  }, 30_000)
})

describe('R-OPEN-WORLD3 · P2 GameplayRulesetSkeleton', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('把AI限定在世界化语义层，并冻结可直接映射G2运行模块的完整规则骨架', async () => {
    const input = await rulesetFixture()
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.gameplay-ruleset-input')).toMatchObject({
      layer: 'L0', ownerFrom: 'work', protectedFromTrim: true,
    })
    expect(getAgentSkillV1('text-open-world.production.gameplay-ruleset.v1')).toMatchObject({
      contextSourceKeys: ['text-open-world.gameplay-ruleset-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
    })
    expect(input.rulesetContextEvidence).toEqual([
      expect.objectContaining({
        key: 'text-open-world.gameplay-ruleset-input', status: 'included', delivery: 'full',
      }),
    ])
    expect(input.rulesetContext.gameBrief.gameBriefHash).toBe(input.rulesetContext.experienceContract.gameBriefHash)
    expect(input.rulesetContext.sourceLedger.claims.length).toBeGreaterThan(0)

    const result = await executeRuleset(input)
    const artifact = result.artifacts[0]!.payload as TextOpenWorldGameplayRulesetSkeletonV1
    expect(result.passedGateIds).toEqual(input.task.acceptanceGateIds)
    expect(result.usage).toMatchObject({ modelCalls: 1, mediaCalls: 0 })
    expect(result.usage.inputTokens).toBeGreaterThan(0)
    expect(artifact).toMatchObject({
      productInstanceKey: input.production.productionKey,
      ruleset: { key: 'storyforge.standard', version: 1, title: '雾港标准冒险规则' },
      characterModel: {
        professionSystem: 'none',
        playerAttributeAllocation: 'automatic-no-player-points',
      },
      progression: {
        moduleVersion: 1,
        maximumLevel: 20,
        acceptanceLevelRange: { minimum: 1, maximum: 5 },
        automaticAttributeGrowth: true,
        skillAcquisition: ['initial', 'level', 'quest'],
      },
      combat: {
        moduleVersion: 3,
        mode: 'turn-based-player-choice',
        playerActions: ['basic-attack', 'skill', 'item', 'escape'],
        freeTextActions: false,
        defaultAttackHits: true,
        playerPartyLimit: 1,
        allowFriendlyNpcCombatants: false,
        allowElements: false,
        defeatPolicy: 'retry-or-respawn',
        respawnCost: 'none-v1',
      },
      inventory: {
        capacityPolicy: 'unlimited',
        randomAffixes: false,
        enhancement: false,
        durability: false,
      },
      crafting: { moduleVersion: 2, successPolicy: 'guaranteed', recipeKnowledgeRequired: true },
      economy: {
        moduleVersion: 2,
        currency: { key: 'currency', label: '港票' },
        currencyModel: 'single',
        ordinaryStockPolicy: 'unlimited',
        specialStockPolicy: 'limited',
      },
      g2Compatibility: {
        progressionModuleVersion: 1,
        combatModuleVersion: 3,
        itemModuleVersion: 1,
        craftingModuleVersion: 2,
        economyModuleVersion: 2,
        actionModuleVersion: 14,
        runtimePackageVersion: 1,
      },
    })
    expect(artifact.characterModel.attributes.map(item => item.key)).toEqual(['power', 'vitality', 'agility'])
    expect(artifact.inventory.equipmentSlots.map(item => item.key)).toEqual(['weapon', 'armor', 'accessory'])
    expect(artifact.effects.runtimeSupportedOperations).toEqual(TEXT_OPEN_WORLD_EFFECT_OPERATIONS_V1)
    expect(new Set([
      ...artifact.effects.modelProposableOperations,
      ...artifact.effects.compilerOwnedOperations,
    ])).toEqual(new Set(artifact.effects.newBuildAllowedOperations))
    expect(artifact.effects.modelProposableOperations).toEqual(TEXT_OPEN_WORLD_MODEL_PROPOSABLE_EFFECT_OPERATIONS_V1)
    expect(artifact.effects.compilerOwnedOperations).toEqual(TEXT_OPEN_WORLD_COMPILER_OWNED_EFFECT_OPERATIONS_V1)
    expect(artifact.effects.legacyReadOnlyOperations).toEqual(TEXT_OPEN_WORLD_LEGACY_EFFECT_OPERATIONS_V1)
    await expect(validateTextOpenWorldGameplayRulesetSkeletonV1({
      artifact,
      context: input.rulesetContext,
    })).resolves.toEqual(artifact)
  }, 30_000)

  it('拒绝AI引用未交付来源事实，不允许模型自行补写世界化规则依据', async () => {
    const input = await rulesetFixture()
    await expect(executeRuleset(input, rulesetRunner({ forgedClaim: true })))
      .rejects.toThrow(/必须引用已交付的SourceLedger claim/)
  }, 30_000)

  it('即使重算产物Hash，也拒绝篡改20级、战斗、三装备位和Effect权限分区', async () => {
    const input = await rulesetFixture()
    const artifact = (await executeRuleset(input)).artifacts[0]!.payload as TextOpenWorldGameplayRulesetSkeletonV1
    const tampered = structuredClone(artifact)
    tampered.progression.formulas.baseHealth = 999
    tampered.effects.modelProposableOperations.push('perform-transaction')
    const { gameplayRulesetHash: _oldHash, ...body } = tampered
    tampered.gameplayRulesetHash = await hashProductProductionValueV2(body)
    await expect(validateTextOpenWorldGameplayRulesetSkeletonV1({
      artifact: tampered,
      context: input.rulesetContext,
    })).rejects.toThrow(/固定边界或G2映射被篡改/)

    const forgedContext = structuredClone(input.rulesetContext)
    forgedContext.gameBrief.fixedProductBoundary.combatMode = 'turn-based'
    forgedContext.gameBrief.fixedProductBoundary.combatInput = ['escape', 'fight', 'skill', 'item']
    const executor = createTextOpenWorldGameplayRulesetExecutorV1({ runModel: rulesetRunner() })
    await expect(executor({
      scope: input.scope,
      productionId: input.production.id!,
      buildId: input.build.id!,
      buildNumber: input.build.buildNumber,
      controlEpoch: input.build.controlEpoch,
      planHash: input.planHash,
      task: input.task,
      attempt: 1,
      idempotencyKey: await hashProductProductionValueV2('forged-ruleset-context'),
      contextText: JSON.stringify(forgedContext),
      inputArtifacts: [],
      capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
        requirementKey,
        bindingHash: CAPABILITY_HASH,
        adapterId: 'configured-text.v1',
      })),
      signal: new AbortController().signal,
    })).rejects.toThrow(/战斗输入不精确|选择Hash不匹配/)
  }, 30_000)
})

describe('R-OPEN-WORLD3 · P4 PlayerBuild', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('从已确认主角与规则骨架形成合法构筑，并为后续目录预留而不伪造运行定义', async () => {
    const input = await playerBuildFixture()
    expect(input.playerBuildContextEvidence).toEqual([
      expect.objectContaining({
        key: 'text-open-world.player-build-input', status: 'included', delivery: 'full',
      }),
    ])
    expect(input.playerBuildContext.protagonistAsset.protagonistAssetHash).toBeTruthy()
    expect(input.playerBuildContext.gameplayRuleset.gameplayRulesetHash).toBeTruthy()

    const result = await executePlayerBuild(input)
    const artifact = result.artifacts[0]!.payload as TextOpenWorldPlayerBuildV1
    expect(result.passedGateIds).toEqual(input.task.acceptanceGateIds)
    expect(result.usage).toMatchObject({ modelCalls: 1, mediaCalls: 0 })
    expect(artifact).toMatchObject({
      productInstanceKey: input.production.productionKey,
      identity: { name: input.playerBuildContext.protagonistAsset.displayName },
      playstyle: {
        title: '敏锐的守灯调查者',
        professionKey: null,
        primaryAttribute: 'agility',
        secondaryAttribute: 'power',
      },
      buildCandidate: {
        progressionProfileKey: 'progression.default',
        initialLevel: 1,
        attributes: { power: 4, vitality: 3, agility: 5 },
        learnedSkillKeys: ['skill.player.basic-attack', 'skill.player.signature'],
        startingItemKeys: ['item.player.starter-weapon', 'item.player.recovery-consumable'],
        startingCurrency: 100,
      },
      catalogBinding: {
        status: 'reserved-unbound',
        playerDefinitionReady: false,
        bindingPolicy: 'exact-reserved-keys-before-runtime-assembly',
      },
    })
    expect(artifact.catalogRequirements.skills[1]).toMatchObject({
      key: 'skill.player.signature',
      combatPurpose: 'burst-damage',
      kind: 'attack',
      target: 'single-enemy',
      scalingAttribute: 'agility',
      resourceCost: 1,
      cooldownTurns: 1,
    })
    expect(artifact.catalogRequirements.items.map(item => item.initialQuantity)).toEqual([1, 3])
    await expect(validateTextOpenWorldPlayerBuildV1({
      artifact,
      context: input.playerBuildContext,
    })).resolves.toEqual(artifact)
  }, 30_000)

  it('拒绝相同主副属性，防止模型突破确定性分配规则', async () => {
    const input = await playerBuildFixture()
    await expect(executePlayerBuild(input, playerBuildRunner({ sameAttributes: true })))
      .rejects.toThrow(/主副属性不能相同/)
  }, 30_000)

  it('即使重算Hash也拒绝篡改属性预算、预留键、货币与目录绑定状态', async () => {
    const input = await playerBuildFixture()
    const artifact = (await executePlayerBuild(input)).artifacts[0]!.payload as TextOpenWorldPlayerBuildV1
    const tampered = structuredClone(artifact)
    tampered.buildCandidate.attributes.agility = 9
    tampered.buildCandidate.startingCurrency = 999
    tampered.catalogBinding.playerDefinitionReady = true as false
    const { playerBuildHash: _oldHash, ...body } = tampered
    tampered.playerBuildHash = await hashProductProductionValueV2(body)
    await expect(validateTextOpenWorldPlayerBuildV1({
      artifact: tampered,
      context: input.playerBuildContext,
    })).rejects.toThrow(/固定预算、身份、目录预留或上游绑定被篡改/)

    const forgedContext = structuredClone(input.playerBuildContext)
    forgedContext.protagonistAsset.displayName = '被篡改的主角'
    await expect(createTextOpenWorldPlayerBuildExecutorV1({ runModel: playerBuildRunner() })({
      scope: input.scope,
      productionId: input.production.id!,
      buildId: input.build.id!,
      buildNumber: input.build.buildNumber,
      controlEpoch: input.build.controlEpoch,
      planHash: input.planHash,
      task: input.task,
      attempt: 1,
      idempotencyKey: await hashProductProductionValueV2('forged-player-build-context'),
      contextText: JSON.stringify(forgedContext),
      inputArtifacts: [],
      capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
        requirementKey,
        bindingHash: CAPABILITY_HASH,
        adapterId: 'configured-text.v1',
      })),
      signal: new AbortController().signal,
    })).rejects.toThrow(/ProtagonistAsset Hash不匹配|选择Hash不匹配/)
  }, 30_000)
})

describe('R-OPEN-WORLD3 · P3 StoryArchitecture', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('把来源、体验与主角编译成长程故事弧、多结局契约和可追踪叙事承诺', async () => {
    const input = await storyArchitectureFixture()
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.story-architecture-input')).toMatchObject({
      layer: 'L0', ownerFrom: 'work', protectedFromTrim: true,
    })
    expect(getAgentSkillV1('text-open-world.production.story-architecture.v1')).toMatchObject({
      contextSourceKeys: ['text-open-world.story-architecture-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
    })
    expect(input.storyContextEvidence).toEqual([
      expect.objectContaining({
        key: 'text-open-world.story-architecture-input', status: 'included', delivery: 'full',
      }),
    ])
    expect(input.storyContext.sourceLedger.selectedClaims.length).toBeGreaterThan(0)
    expect(input.storyContext.gameBrief.gameBriefHash).toBeTruthy()
    expect(input.storyContext.protagonistAsset.protagonistAssetHash).toBeTruthy()

    const result = await executeStoryArchitecture(input)
    const artifacts = storyArtifacts(result)
    expect(result.passedGateIds).toEqual(input.task.acceptanceGateIds)
    expect(result.usage).toMatchObject({ modelCalls: 1, mediaCalls: 0 })
    expect(artifacts.storyArc).toMatchObject({
      productInstanceKey: input.production.productionKey,
      governance: {
        mainlineOrder: 'strict-sequential',
        mainlinePressure: 'wait-for-player',
        mainlineFailure: 'cannot-permanently-fail',
        criticalTriggerPolicy: 'never-location-only',
      },
      endingContractKeys: Array.from(
        { length: input.storyContext.gameBrief.scale.endingCount },
        (_, index) => `ending.${String(index + 1).padStart(3, '0')}`,
      ),
      narrativePromiseKeys: ['promise.001', 'promise.002', 'promise.003', 'promise.004'],
    })
    expect(artifacts.storyArc.macroBeats.map(beat => beat.key)).toEqual([
      'story.beat.001', 'story.beat.002', 'story.beat.003', 'story.beat.004', 'story.beat.005',
    ])
    expect(artifacts.endingContracts).toMatchObject({
      endingCount: input.storyContext.gameBrief.scale.endingCount,
    })
    expect(artifacts.endingContracts.endings.every(ending => (
      ending.coreGoalStatus === 'achieved'
      && ending.runtimeBinding.status === 'condition-unbound'
      && ending.runtimeBinding.conditionKeys.length === 0
    ))).toBe(true)
    expect(artifacts.narrativePromises).toMatchObject({ promiseCount: 4 })
    expect(artifacts.narrativePromises.promises.every(promise => (
      promise.binding.status === 'scene-unbound'
      && promise.callbacks.length > 0
    ))).toBe(true)
    await expect(validateTextOpenWorldStoryArchitectureArtifactsV1({
      artifacts,
      context: input.storyContext,
    })).resolves.toEqual(artifacts)
  }, 30_000)

  it('拒绝模型引用未交付事实，也拒绝破坏承诺建立、回响和回收顺序', async () => {
    const input = await storyArchitectureFixture()
    await expect(executeStoryArchitecture(input, storyArchitectureRunner({ forgedClaim: true })))
      .rejects.toThrow(/引用了未交付claim/)
    await expect(executeStoryArchitecture(input, storyArchitectureRunner({ badPromiseOrder: true })))
      .rejects.toThrow(/建立、回响和回收顺序无效/)
  }, 30_000)

  it('即使重算Hash也拒绝篡改主线保护、多结局与运行绑定占位', async () => {
    const input = await storyArchitectureFixture()
    const artifacts = storyArtifacts(await executeStoryArchitecture(input))
    const tampered = structuredClone(artifacts)
    tampered.storyArc.governance.mainlinePressure = 'pressured' as 'wait-for-player'
    tampered.endingContracts.endings[0]!.runtimeBinding.conditionKeys = ['condition.forged'] as []
    const { endingContractsHash: _endingHash, ...endingBody } = tampered.endingContracts
    tampered.endingContracts.endingContractsHash = await hashProductProductionValueV2(endingBody)
    const { narrativePromisesHash: _promiseHash, ...promiseBody } = tampered.narrativePromises
    tampered.narrativePromises.narrativePromisesHash = await hashProductProductionValueV2(promiseBody)
    await expect(validateTextOpenWorldStoryArchitectureArtifactsV1({
      artifacts: tampered,
      context: input.storyContext,
    })).rejects.toThrow(/固定保护、顺序、引用或Hash被篡改/)

    const forgedContext = structuredClone(input.storyContext)
    forgedContext.protagonistAsset.displayName = '被篡改的主角'
    await expect(createTextOpenWorldStoryArchitectureExecutorV1({
      runModel: storyArchitectureRunner(),
    })({
      scope: input.scope,
      productionId: input.production.id!,
      buildId: input.build.id!,
      buildNumber: input.build.buildNumber,
      controlEpoch: input.build.controlEpoch,
      planHash: input.planHash,
      task: input.task,
      attempt: 1,
      idempotencyKey: await hashProductProductionValueV2('forged-story-context'),
      contextText: JSON.stringify(forgedContext),
      inputArtifacts: [],
      capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
        requirementKey,
        bindingHash: CAPABILITY_HASH,
        adapterId: 'configured-text.v1',
      })),
      signal: new AbortController().signal,
    })).rejects.toThrow(/ProtagonistAsset Hash不匹配|选择Hash不匹配/)
  }, 30_000)
})

describe('R-OPEN-WORLD3 · P4 RegionSkeleton', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('把来源事实和StoryArc空间需求编译为完整、连通且可提前到达的世界骨架', async () => {
    const input = await regionSkeletonFixture()
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.region-skeleton-input')).toMatchObject({
      layer: 'L0', ownerFrom: 'work', protectedFromTrim: true,
    })
    expect(getAgentSkillV1('text-open-world.production.region-skeleton.v1')).toMatchObject({
      contextSourceKeys: ['text-open-world.region-skeleton-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
    })
    expect(input.regionContextEvidence).toEqual([
      expect.objectContaining({ key: 'text-open-world.region-skeleton-input', status: 'included', delivery: 'full' }),
    ])
    expect(input.regionContext.storyNeeds).toHaveLength(5)
    const result = await executeRegionSkeleton(input)
    const artifact = result.artifacts[0]!.payload as TextOpenWorldRegionSkeletonV1
    expect(result.passedGateIds).toEqual(input.task.acceptanceGateIds)
    expect(result.usage).toMatchObject({ modelCalls: 1, mediaCalls: 0 })
    expect(artifact).toMatchObject({
      productInstanceKey: input.production.productionKey,
      worldScale: {
        regionCount: 2,
        namedLocationCount: 8,
        completeness: 'complete-at-build',
        revealPolicy: 'progressive-knowledge',
      },
      initialRegionKey: 'region.001',
      initialLocationKey: 'location.001',
      governance: {
        topology: 'all-locations-connected',
        regionTopology: 'all-regions-connected',
        everyRegionHasFastTravelPoint: true,
        earlyArrival: 'all-locations-safe',
        arrivalStoryTrigger: 'never-critical-location-only',
        mainlineBindings: 'unbound-until-p5',
        ordinaryContentBindings: 'unbound-until-p7-p8',
        travelConditions: 'none-in-skeleton',
      },
      coverage: { requiredStoryNeedCount: 5, coveredStoryNeedCount: 5, uncoveredStoryNeedRefs: [] },
    })
    expect(artifact.regions.map(region => region.key)).toEqual(['region.001', 'region.002'])
    expect(artifact.locations.map(location => location.key)).toEqual(
      Array.from({ length: 8 }, (_, index) => `location.${String(index + 1).padStart(3, '0')}`),
    )
    expect(artifact.edges.map(edge => edge.key)).toEqual(
      Array.from({ length: 7 }, (_, index) => `edge.${String(index + 1).padStart(3, '0')}`),
    )
    expect(artifact.fastTravelPoints).toEqual([
      expect.objectContaining({ key: 'fast-travel.001', locationKey: 'location.001', unlockedByDefault: true, canRespawn: true }),
      expect.objectContaining({ key: 'fast-travel.002', locationKey: 'location.005', unlockedByDefault: false, canRespawn: true }),
    ])
    expect(artifact.locations.every(location => (
      location.contentBinding.status === 'content-unbound'
      && location.contentBinding.sceneKeys.length === 0
      && location.presentationBinding.status === 'presentation-unbound'
      && location.earlyArrivalDescription.length > 0
    ))).toBe(true)
    expect(artifact.edges.every(edge => edge.bidirectional && edge.conditionKeys.length === 0)).toBe(true)
    await expect(validateTextOpenWorldRegionSkeletonV1({ artifact, context: input.regionContext }))
      .resolves.toEqual(artifact)
  }, 30_000)

  it('拒绝未交付来源引用与不能连通完整世界的地图建议', async () => {
    const input = await regionSkeletonFixture()
    await expect(executeRegionSkeleton(input, regionSkeletonRunner({ forgedClaim: true })))
      .rejects.toThrow(/引用了未交付claim/)
    await expect(executeRegionSkeleton(input, regionSkeletonRunner({ disconnected: true })))
      .rejects.toThrow(/connections数量不足|结构可达|跨区道路连通/)
  }, 30_000)

  it('即使重算Hash也拒绝篡改提前到达、地点内容绑定与快旅解锁规则', async () => {
    const input = await regionSkeletonFixture()
    const artifact = (await executeRegionSkeleton(input)).artifacts[0]!.payload as TextOpenWorldRegionSkeletonV1
    const tampered = structuredClone(artifact)
    tampered.governance.arrivalStoryTrigger = 'arrival-can-trigger-mainline' as 'never-critical-location-only'
    tampered.locations[0]!.contentBinding.sceneKeys = ['scene.forged'] as []
    tampered.fastTravelPoints[1]!.unlockedByDefault = true
    const { regionSkeletonHash: _hash, ...body } = tampered
    tampered.regionSkeletonHash = await hashProductProductionValueV2(body)
    await expect(validateTextOpenWorldRegionSkeletonV1({ artifact: tampered, context: input.regionContext }))
      .rejects.toThrow(/固定键、连通性、提前到达保护、绑定占位或Hash被篡改/)

    const forgedContext = structuredClone(input.regionContext)
    forgedContext.storyArc.macroBeats[0]!.spatialFunctionNeeds[0] = '被篡改的空间需求'
    await expect(createTextOpenWorldRegionSkeletonExecutorV1({ runModel: regionSkeletonRunner() })({
      scope: input.scope,
      productionId: input.production.id!,
      buildId: input.build.id!,
      buildNumber: input.build.buildNumber,
      controlEpoch: input.build.controlEpoch,
      planHash: input.planHash,
      task: input.task,
      attempt: 1,
      idempotencyKey: await hashProductProductionValueV2('forged-region-context'),
      contextText: JSON.stringify(forgedContext),
      inputArtifacts: [],
      capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
        requirementKey,
        bindingHash: CAPABILITY_HASH,
        adapterId: 'configured-text.v1',
      })),
      signal: new AbortController().signal,
    })).rejects.toThrow(/StoryArc Hash不匹配|storyNeeds与StoryArc不一致|选择Hash不匹配/)
  }, 30_000)
})

describe('R-OPEN-WORLD3 · P5 MainlineThread', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('把故事节拍、地区骨架和玩法边界编译为严格顺序、可等待、可恢复的主线', async () => {
    const input = await mainlineFixture()
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.mainline-input')).toMatchObject({
      layer: 'L0', ownerFrom: 'work', protectedFromTrim: true,
    })
    expect(getAgentSkillV1('text-open-world.production.mainline.v1')).toMatchObject({
      contextSourceKeys: ['text-open-world.mainline-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
    })
    expect(input.mainlineContextEvidence).toEqual([
      expect.objectContaining({ key: 'text-open-world.mainline-input', status: 'included', delivery: 'full' }),
    ])
    const result = await executeMainline(input)
    const artifact = result.artifacts[0]!.payload as TextOpenWorldMainlineThreadV1
    expect(result.passedGateIds).toEqual(input.task.acceptanceGateIds)
    expect(result.usage).toMatchObject({ modelCalls: 1, mediaCalls: 0 })
    expect(artifact).toMatchObject({
      thread: {
        key: 'storyline.main', kind: 'mainline', ownerKind: 'core', ownerKey: null,
        coreGoal: input.mainlineContext.storyArc.coreConflict.coreGoal,
      },
      governance: {
        order: 'strict-sequential', pressure: 'wait-for-player', failure: 'cannot-permanently-fail',
        criticalTrigger: 'never-location-only', allStagesReachable: true,
        allStagesProtectedWait: true, ordinaryStateCannotBlock: true,
      },
      pacing: {
        stageCount: 7,
        initialLevel: 1,
        finalRecommendedLevel: 5,
      },
      downstreamBinding: { status: 'requirements-unbound', runtimeReady: false },
    })
    expect(artifact.stages.map(stage => stage.key)).toEqual(
      Array.from({ length: 7 }, (_, index) => `mainline.stage.${String(index + 1).padStart(3, '0')}`),
    )
    expect(artifact.stages.map(stage => stage.storyBeatKey)).toEqual([
      'story.beat.001', 'story.beat.002', 'story.beat.002', 'story.beat.003',
      'story.beat.004', 'story.beat.004', 'story.beat.005',
    ])
    expect(artifact.stages[0]).toMatchObject({
      previousStageKey: null,
      nextStageKey: 'mainline.stage.002',
      locationKeys: expect.arrayContaining(['location.001']),
      safeWaitBefore: true,
      safeWaitAfter: true,
      entryPolicy: { mode: 'explicit-mainline-advance', arrivalAloneNeverStarts: true, previousStageCompletionRequired: false },
      failurePolicy: { abandonable: false, expirable: false, ordinaryStateMayBlock: false },
      questBinding: { status: 'quest-unbound', questKey: null },
      sceneBinding: { status: 'scene-unbound', sceneKeys: [] },
      rewardBinding: { status: 'reward-unbound', rewardContractKey: null },
    })
    expect(artifact.stages[6]).toMatchObject({ previousStageKey: 'mainline.stage.006', nextStageKey: null })
    expect(artifact.pacing.totalEstimatedMinutes).toBeGreaterThanOrEqual(artifact.pacing.requiredPlayMinuteRange.minimum)
    expect(artifact.pacing.totalEstimatedMinutes).toBeLessThanOrEqual(artifact.pacing.requiredPlayMinuteRange.maximum)
    expect(artifact.promisePlan).toHaveLength(input.mainlineContext.narrativePromises.promiseCount)
    expect(artifact.endingRoutes.map(route => route.endingKey)).toEqual(
      input.mainlineContext.endingContracts.endings.map(ending => ending.key),
    )
    expect(artifact.endingRoutes.every(route => (
      route.finalStageKey === 'mainline.stage.007'
      && route.coreGoalStatus === 'achieved'
      && route.runtimeBinding.status === 'condition-unbound'
    ))).toBe(true)
    await expect(validateTextOpenWorldMainlineThreadV1({ artifact, context: input.mainlineContext }))
      .resolves.toEqual(artifact)
  }, 45_000)

  it('拒绝逆序或漏掉StoryBeat，也拒绝引用不存在的地点', async () => {
    const input = await mainlineFixture()
    await expect(executeMainline(input, mainlineRunner({ badBeatOrder: true })))
      .rejects.toThrow(/单调推进|没有承载StoryBeat/)
    await expect(executeMainline(input, mainlineRunner({ invalidLocation: true })))
      .rejects.toThrow(/locationNumbers/)
  }, 45_000)

  it('即使重算Hash也拒绝篡改等待保护、阶段链和下游运行绑定', async () => {
    const input = await mainlineFixture()
    const artifact = (await executeMainline(input)).artifacts[0]!.payload as TextOpenWorldMainlineThreadV1
    const tampered = structuredClone(artifact)
    tampered.governance.pressure = 'pressured' as 'wait-for-player'
    tampered.stages[1]!.previousStageKey = null
    tampered.stages[0]!.questBinding.questKey = 'quest.main.001' as null
    const { mainlineThreadHash: _hash, ...body } = tampered
    tampered.mainlineThreadHash = await hashProductProductionValueV2(body)
    await expect(validateTextOpenWorldMainlineThreadV1({ artifact: tampered, context: input.mainlineContext }))
      .rejects.toThrow(/固定顺序、保护、节奏、Promise或下游绑定被篡改/)

    const forgedContext = structuredClone(input.mainlineContext)
    forgedContext.regionSkeleton.initialLocationKey = 'location.forged'
    await expect(createTextOpenWorldMainlineExecutorV1({ runModel: mainlineRunner() })({
      scope: input.scope,
      productionId: input.production.id!,
      buildId: input.build.id!,
      buildNumber: input.build.buildNumber,
      controlEpoch: input.build.controlEpoch,
      planHash: input.planHash,
      task: input.task,
      attempt: 1,
      idempotencyKey: await hashProductProductionValueV2('forged-mainline-context'),
      contextText: JSON.stringify(forgedContext),
      inputArtifacts: [],
      capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
        requirementKey, bindingHash: CAPABILITY_HASH, adapterId: 'configured-text.v1',
      })),
      signal: new AbortController().signal,
    })).rejects.toThrow(/RegionSkeleton Hash不匹配|选择Hash不匹配/)
  }, 45_000)
})

describe('R-OPEN-WORLD3 · P6 SignificantThreads', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('把角色个人线与地区群像线编译成可等待、局部后果且不阻断主线的重要故事', async () => {
    const input = await significantThreadsFixture()
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.significant-threads-input')).toMatchObject({
      layer: 'L0', ownerFrom: 'work', protectedFromTrim: true,
    })
    expect(getAgentSkillV1('text-open-world.production.significant-threads.v1')).toMatchObject({
      contextSourceKeys: ['text-open-world.significant-threads-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
    })
    expect(input.significantContextEvidence).toEqual([
      expect.objectContaining({ key: 'text-open-world.significant-threads-input', status: 'included', delivery: 'full' }),
    ])
    const result = await executeSignificantThreads(input)
    const artifact = result.artifacts[0]!.payload as TextOpenWorldSignificantThreadsV1
    expect(result.passedGateIds).toEqual(input.task.acceptanceGateIds)
    expect(result.usage).toMatchObject({ modelCalls: 1, mediaCalls: 0 })
    expect(artifact.coverage).toMatchObject({
      requiredThreadCount: 2,
      actualThreadCount: 2,
      ownerKinds: ['character', 'region'],
      minimumOwnerKindCount: 2,
    })
    expect(artifact.governance).toEqual({
      lifecycle: 'persistent-safe-wait',
      failure: 'cannot-permanently-fail',
      abandonable: false,
      expirable: false,
      pressureWhileAbsent: 'none',
      consequences: 'local-only',
      mainlineCompatibility: 'cannot-block-or-rewrite',
      criticalTrigger: 'never-location-only',
      criticalAssets: 'protected-by-downstream-requirements',
    })
    expect(artifact.threads[0]).toMatchObject({
      key: 'significant-thread.001',
      ownerKind: 'character',
      ownerKey: 'actor.significant.001',
      ownerBinding: { status: 'catalog-unbound', actorKey: null, factionKey: null, regionKey: null },
      mainlineCompatibility: {
        availableAfterStageKey: 'mainline.stage.001',
        lastSafeStartStageKey: null,
        requiredMainlineMutationKeys: [],
        mayChangeCoreGoal: false,
        mayBlockMainline: false,
        mayDetermineEndingAlone: false,
      },
    })
    expect(artifact.threads[1]).toMatchObject({
      key: 'significant-thread.002',
      ownerKind: 'region',
      ownerKey: 'region.002',
      ownerBinding: { status: 'region-bound', regionKey: 'region.002' },
    })
    expect(artifact.threads.every(thread => thread.conflictSystem.sides.length >= 2)).toBe(true)
    expect(artifact.stages).toHaveLength(6)
    expect(artifact.stages.every(stage => (
      stage.safeWaitBefore && stage.safeWaitAfter
      && stage.entryPolicy.arrivalAloneNeverStarts
      && !stage.failurePolicy.abandonable
      && !stage.failurePolicy.expirable
      && !stage.failurePolicy.ordinaryStateMayBlock
      && stage.localConsequencePlans.every(plan => plan.runtimeBinding.status === 'effect-unbound')
      && stage.contentBinding.status === 'content-unbound'
    ))).toBe(true)
    expect(artifact.downstreamBinding).toMatchObject({ status: 'requirements-unbound', runtimeReady: false })
    await expect(validateTextOpenWorldSignificantThreadsV1({ artifact, context: input.significantContext }))
      .resolves.toEqual(artifact)
  }, 60_000)

  it('拒绝owner种类不足和越界地点，不能把同类人物小传冒充完整重要故事生态', async () => {
    const input = await significantThreadsFixture()
    await expect(executeSignificantThreads(input, significantThreadsRunner({ insufficientOwnerCoverage: true })))
      .rejects.toThrow(/至少覆盖两种owner/)
    await expect(executeSignificantThreads(input, significantThreadsRunner({ invalidLocation: true })))
      .rejects.toThrow(/locationNumbers|地点/)
  }, 60_000)

  it('即使重算Hash也拒绝解除等待保护、写入运行Effect或改成可阻断主线', async () => {
    const input = await significantThreadsFixture()
    const artifact = (await executeSignificantThreads(input)).artifacts[0]!.payload as TextOpenWorldSignificantThreadsV1
    const tampered = structuredClone(artifact)
    tampered.governance.abandonable = true as false
    tampered.threads[0]!.mainlineCompatibility.mayBlockMainline = true as false
    tampered.stages[0]!.localConsequencePlans[0]!.runtimeBinding.effectKeys.push('effect.forged' as never)
    const { significantThreadsHash: _hash, ...body } = tampered
    tampered.significantThreadsHash = await hashProductProductionValueV2(body)
    await expect(validateTextOpenWorldSignificantThreadsV1({ artifact: tampered, context: input.significantContext }))
      .rejects.toThrow(/主线兼容、局部后果、等待保护|被篡改/)

    const forgedContext = structuredClone(input.significantContext)
    forgedContext.mainlineThread.thread.coreGoal = '伪造的新核心目标'
    await expect(createTextOpenWorldSignificantThreadsExecutorV1({ runModel: significantThreadsRunner() })({
      scope: input.scope,
      productionId: input.production.id!,
      buildId: input.build.id!,
      buildNumber: input.build.buildNumber,
      controlEpoch: input.build.controlEpoch,
      planHash: input.planHash,
      task: input.task,
      attempt: 1,
      idempotencyKey: await hashProductProductionValueV2('forged-significant-context'),
      contextText: JSON.stringify(forgedContext),
      inputArtifacts: [],
      capabilityBindings: input.task.capabilityRequirementKeys.map(requirementKey => ({
        requirementKey, bindingHash: CAPABILITY_HASH, adapterId: 'configured-text.v1',
      })),
      signal: new AbortController().signal,
    })).rejects.toThrow(/MainlineThread Hash不匹配|选择Hash不匹配/)
  }, 60_000)
})

describe('R-OPEN-WORLD3 · P7 RegionNarrativePacks', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('为每个地区和地点建立差异化生活、NPC层级与保底任务/模板/事件供给', async () => {
    const input = await regionNarrativePacksFixture()
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.region-narrative-packs-input')).toMatchObject({
      layer: 'L0', ownerFrom: 'work', protectedFromTrim: true,
    })
    expect(getAgentSkillV1('text-open-world.production.region-narrative-packs.v1')).toMatchObject({
      contextSourceKeys: ['text-open-world.region-narrative-packs-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
    })
    expect(input.regionPacksContextEvidence).toEqual([
      expect.objectContaining({ key: 'text-open-world.region-narrative-packs-input', status: 'included', delivery: 'full' }),
    ])
    const result = await executeRegionNarrativePacks(input)
    const artifact = result.artifacts[0]!.payload as TextOpenWorldRegionNarrativePacksV1
    expect(result.passedGateIds).toEqual(input.task.acceptanceGateIds)
    expect(result.usage).toMatchObject({ modelCalls: 1, mediaCalls: 0 })
    expect(artifact.coverage).toMatchObject({
      requiredRegionCount: 2,
      actualRegionCount: 2,
      ordinaryQuestSeedCount: 6,
      requiredOrdinaryQuestSeedCount: 6,
      taskTemplateSeedCount: 4,
      requiredTaskTemplateSeedCount: 4,
      randomEventSeedCount: 12,
      requiredRandomEventSeedCount: 12,
      importantCharacterRequirementCount: 2,
    })
    expect(artifact.coverage.coveredLocationKeys).toEqual(artifact.coverage.requiredLocationKeys)
    expect(artifact.governance).toEqual({
      everyLocationHasPlan: true,
      everyRegionDistinct: true,
      ordinaryWorldContinues: true,
      mainlineWaits: true,
      importantStoriesWaitAtSafePoints: true,
      regionalConsequencesCannotBlockMainline: true,
      npcRuntimeSplit: 'important-agent-ordinary-rules',
      contentSupply: 'build-seeds-before-runtime-deck',
    })
    expect(artifact.packs[0]!.characterRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'actor.significant.001',
        tier: 'important',
        runtimeMode: 'agent-maintained',
        protectionRequirement: 'protected-nonlethal',
        catalogBinding: { status: 'actor-unbound', actorKey: null },
      }),
      expect.objectContaining({
        tier: 'functional',
        runtimeMode: 'rule-driven',
        protectionRequirement: 'ordinary-lifecycle',
      }),
    ]))
    expect(artifact.packs.every(pack => (
      pack.locationPlans.length > 0
      && pack.locationPlans.every(plan => plan.catalogBindingStatus === 'unbound')
      && pack.tensions.every(tension => !tension.mainlineMayBlock)
      && pack.stateAxes.every(axis => !axis.mainlineMayBlock && axis.runtimeBinding.status === 'effect-unbound')
      && pack.ordinaryQuestSeeds.every(seed => seed.binding.status === 'quest-unbound')
      && pack.taskTemplateSeeds.every(seed => seed.binding.status === 'template-unbound')
      && pack.randomEventSeeds.every(seed => seed.binding.status === 'event-unbound')
    ))).toBe(true)
    expect(artifact.downstreamBinding).toMatchObject({ status: 'requirements-unbound', runtimeReady: false })
    await expect(validateTextOpenWorldRegionNarrativePacksV1({ artifact, context: input.regionPacksContext }))
      .resolves.toEqual(artifact)
  }, 75_000)

  it('拒绝地点漏覆盖、保底供给不足和重复地区体验', async () => {
    const input = await regionNarrativePacksFixture()
    await expect(executeRegionNarrativePacks(input, regionNarrativePacksRunner({ omitLocation: true })))
      .rejects.toThrow(/locations必须覆盖本地区全部地点/)
    await expect(executeRegionNarrativePacks(input, regionNarrativePacksRunner({ wrongSupply: true })))
      .rejects.toThrow(/普通任务种子总数/)
    await expect(executeRegionNarrativePacks(input, regionNarrativePacksRunner({ duplicateDistinctiveness: true })))
      .rejects.toThrow(/不同的体验辨识度/)
  }, 75_000)

  it('拒绝遗漏重要故事owner承接，也拒绝重算Hash后解除主线保护或私自绑定Quest', async () => {
    const input = await regionNarrativePacksFixture()
    await expect(executeRegionNarrativePacks(input, regionNarrativePacksRunner({ missingOwner: true })))
      .rejects.toThrow(/owner必须由唯一地区目录需求兑现/)
    const artifact = (await executeRegionNarrativePacks(input)).artifacts[0]!.payload as TextOpenWorldRegionNarrativePacksV1
    const tampered = structuredClone(artifact)
    tampered.governance.regionalConsequencesCannotBlockMainline = false as true
    tampered.packs[0]!.tensions[0]!.mainlineMayBlock = true as false
    tampered.packs[0]!.ordinaryQuestSeeds[0]!.binding.questKey = 'quest.forged' as null
    const { regionNarrativePacksHash: _hash, ...body } = tampered
    tampered.regionNarrativePacksHash = await hashProductProductionValueV2(body)
    await expect(validateTextOpenWorldRegionNarrativePacksV1({ artifact: tampered, context: input.regionPacksContext }))
      .rejects.toThrow(/主线保护、稳定键或未绑定槽被篡改/)
  }, 75_000)
})

describe('R-OPEN-WORLD3 · P8 QuestSkeletons / ContentRequirementManifest', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('逐项编译主线、重要故事、普通种子与地区模板，并把正式目录需求交给后序任务', async () => {
    const input = await questSkeletonsFixture()
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.quest-skeletons-input')).toMatchObject({
      layer: 'L0', ownerFrom: 'work', protectedFromTrim: true,
    })
    expect(getAgentSkillV1('text-open-world.production.quest-skeletons.v1')).toMatchObject({
      contextSourceKeys: ['text-open-world.quest-skeletons-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
    })
    expect(input.questContextEvidence).toEqual([
      expect.objectContaining({ key: 'text-open-world.quest-skeletons-input', status: 'included', delivery: 'full' }),
    ])
    expect(input.questContext.questSources).toHaveLength(23)

    const result = await executeQuestSkeletons(input)
    const questSkeletons = result.artifacts.find(artifact => artifact.artifactKey === 'text-open-world.quest-skeletons')!
      .payload as TextOpenWorldQuestSkeletonsV1
    const manifest = result.artifacts.find(artifact => artifact.artifactKey === 'text-open-world.content-requirement-manifest')!
      .payload as TextOpenWorldContentRequirementManifestV1
    expect(result.passedGateIds).toEqual(input.task.acceptanceGateIds)
    expect(result.usage).toMatchObject({ modelCalls: 1, mediaCalls: 0 })
    expect(questSkeletons.coverage).toMatchObject({
      totalQuestCount: 23,
      protectedQuestCount: 13,
      ordinaryQuestCount: 6,
      templateQuestCount: 4,
      uncoveredSourceKeys: [],
    })
    expect(questSkeletons.quests).toHaveLength(23)
    expect(questSkeletons.stages).toHaveLength(23)
    expect(questSkeletons.objectives).toHaveLength(23)
    expect(questSkeletons.quests.filter(quest => quest.type === 'mainline' || quest.type === 'significant')
      .every(quest => quest.lifecyclePlan.lifecyclePolicy === 'protected-wait'
        && !quest.lifecyclePlan.abandonable
        && !quest.lifecyclePlan.mayFailPermanently
        && quest.lifecyclePlan.timePolicy === 'waits')).toBe(true)
    expect(questSkeletons.quests.filter(quest => quest.type === 'template')
      .every(quest => quest.lifecyclePlan.instantiationPolicy === 'director'
        && quest.lifecyclePlan.repeatable
        && quest.lifecyclePlan.timePolicy === 'timed')).toBe(true)
    expect(questSkeletons.quests.every(quest => quest.entryPlan.arrivalAloneNeverStarts
      && quest.runtimeBinding.status === 'runtime-unbound')).toBe(true)
    expect(questSkeletons.stages.every(stage => stage.runtimeBinding.status === 'runtime-unbound')).toBe(true)
    expect(questSkeletons.objectives.every(objective => objective.runtimeBinding.status === 'runtime-unbound')).toBe(true)

    const requirementKeys = new Set(manifest.requirements.map(requirement => requirement.key))
    expect(questSkeletons.objectives.every(objective => objective.requirementKeys.length > 0
      && objective.requirementKeys.every(key => requirementKeys.has(key)))).toBe(true)
    expect(manifest.coverage.questObjectiveKeys).toEqual(expect.arrayContaining(manifest.coverage.coveredQuestObjectiveKeys))
    expect(new Set(manifest.coverage.coveredQuestObjectiveKeys)).toEqual(new Set(manifest.coverage.questObjectiveKeys))
    expect(manifest.coverage.coveredRegionCharacterRequirementKeys)
      .toEqual(manifest.coverage.regionCharacterRequirementKeys)
    expect(manifest.coverage.coveredRegionFactionRequirementKeys)
      .toEqual(manifest.coverage.regionFactionRequirementKeys)
    expect(manifest.coverage.coveredLocationPlanKeys).toEqual(manifest.coverage.locationPlanKeys)
    expect(manifest.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'actor', sourceReservationKey: 'actor.significant.001',
        ownerTaskKey: 'p8.catalog.npc-runtime', binding: { status: 'catalog-unbound', definitionKeys: [] },
      }),
    ]))
    expect(manifest.coverage.unresolvedRequirementKeys).toHaveLength(manifest.requirements.length)
    expect(manifest.requirements.every(requirement => requirement.binding.status === 'catalog-unbound')).toBe(true)
    await expect(validateTextOpenWorldQuestSkeletonArtifactsV1({
      artifacts: { questSkeletons, contentRequirementManifest: manifest },
      context: input.questContext,
    })).resolves.toEqual({ questSkeletons, contentRequirementManifest: manifest })
  }, 90_000)

  it('拒绝任务来源漏编译、受保护任务弱化以及无法执行的战斗目标', async () => {
    const input = await questSkeletonsFixture()
    await expect(executeQuestSkeletons(input, questSkeletonsRunner({ omitSource: true })))
      .rejects.toThrow(/quests必须与23个上游来源一一对应/)
    await expect(executeQuestSkeletons(input, questSkeletonsRunner({ weakProtected: true })))
      .rejects.toThrow(/主线任务必须提出至少一项protected内容需求/)
    await expect(executeQuestSkeletons(input, questSkeletonsRunner({ invalidCombat: true })))
      .rejects.toThrow(/战斗Objective必须提出enemy或encounter需求/)
  }, 90_000)

  it('拒绝同名内容需求冲突、模型越权绑定目录，以及重算Hash后的生命周期篡改', async () => {
    const input = await questSkeletonsFixture()
    await expect(executeQuestSkeletons(input, questSkeletonsRunner({ conflictingRequirement: true })))
      .rejects.toThrow(/同名内容需求定义冲突/)
    await expect(executeQuestSkeletons(input, questSkeletonsRunner({ prematureField: true })))
      .rejects.toThrow(/字段不精确/)

    const result = await executeQuestSkeletons(input)
    const questSkeletons = structuredClone(result.artifacts.find(artifact => artifact.artifactKey === 'text-open-world.quest-skeletons')!
      .payload as TextOpenWorldQuestSkeletonsV1)
    const manifest = structuredClone(result.artifacts.find(artifact => artifact.artifactKey === 'text-open-world.content-requirement-manifest')!
      .payload as TextOpenWorldContentRequirementManifestV1)
    questSkeletons.quests[0]!.lifecyclePlan.abandonable = true as false
    const { questSkeletonsHash: _questHash, ...questBody } = questSkeletons
    questSkeletons.questSkeletonsHash = await hashProductProductionValueV2(questBody)
    manifest.questSkeletonsHash = questSkeletons.questSkeletonsHash
    manifest.basisHash = await hashProductProductionValueV2({
      questSkeletonsHash: questSkeletons.questSkeletonsHash,
      regionNarrativePacksHash: manifest.regionNarrativePacksHash,
      requirementKeys: manifest.requirements.map(requirement => requirement.key),
    })
    const { contentRequirementManifestHash: _manifestHash, ...manifestBody } = manifest
    manifest.contentRequirementManifestHash = await hashProductProductionValueV2(manifestBody)
    await expect(validateTextOpenWorldQuestSkeletonArtifactsV1({
      artifacts: { questSkeletons, contentRequirementManifest: manifest },
      context: input.questContext,
    })).rejects.toThrow(/任务来源覆盖、生命周期、需求清单、稳定键或未绑定运行槽被篡改/)
  }, 90_000)
})

describe('R-OPEN-WORLD3 · P8 ProgressionCatalogs', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('兑现主角预留与任务技能需求，并形成可供G2装配的20级确定性成长目录候选', async () => {
    const input = await progressionCatalogsFixture()
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.progression-catalogs-input')).toMatchObject({
      layer: 'L0', ownerFrom: 'work', protectedFromTrim: true,
    })
    expect(getAgentSkillV1('text-open-world.production.progression-catalogs.v1')).toMatchObject({
      contextSourceKeys: ['text-open-world.progression-catalogs-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
    })
    expect(input.progressionContextEvidence).toEqual([
      expect.objectContaining({ key: 'text-open-world.progression-catalogs-input', status: 'included', delivery: 'full' }),
    ])
    expect(input.progressionContext.skillDemands).toHaveLength(9)

    const result = await executeProgressionCatalogs(input)
    const artifact = result.artifacts[0]!.payload as TextOpenWorldProgressionCatalogsV1
    expect(result.passedGateIds).toEqual(input.task.acceptanceGateIds)
    expect(result.usage).toMatchObject({ modelCalls: 1, mediaCalls: 0 })
    expect(artifact.levels).toHaveLength(20)
    expect(artifact.levels.map(level => level.cumulativeExperience)).toEqual(
      Array.from({ length: 20 }, (_, index) => index * index * 100),
    )
    expect(artifact.levels[0]).toMatchObject({
      level: 1,
      attributeGrowth: { power: 0, vitality: 0, agility: 0 },
      unlockedSkillKeys: ['skill.player.basic-attack', 'skill.player.signature'],
    })
    expect(artifact.levels[1]!.unlockedSkillKeys).toEqual(['skill.level.002'])
    expect(artifact.coverage).toMatchObject({
      requiredPlayerSkillKeys: ['skill.player.basic-attack', 'skill.player.signature'],
      coveredPlayerSkillKeys: ['skill.player.basic-attack', 'skill.player.signature'],
      fullLevelCount: 20,
      uncoveredDemandKeys: [],
    })
    expect(artifact.coverage.requiredSkillRequirementKeys).toHaveLength(1)
    expect(artifact.coverage.coveredSkillRequirementKeys).toEqual(artifact.coverage.requiredSkillRequirementKeys)
    expect(artifact.coverage.acceptanceRangeUnlockSkillKeys).toEqual([
      'skill.player.basic-attack', 'skill.player.signature', 'skill.level.002', 'skill.level.004',
    ])
    expect(artifact.skills).toHaveLength(9)
    expect(artifact.skills.find(skill => skill.demandKind === 'quest-requirement')).toMatchObject({
      unlockPlan: { kind: 'quest-requirement', level: null },
      runtimeBinding: { status: 'runtime-unbound', unlockQuestKey: null, actionKey: null },
    })
    expect(artifact.skills.every(skill => skill.runtimeBinding.status === 'runtime-unbound')).toBe(true)
    expect(artifact.governance).toMatchObject({
      professionSystem: 'none', attributeGrowthOwner: 'deterministic-compiler',
      experienceCurveOwner: 'deterministic-compiler', allRuntimeBindingsUnbound: true,
      progressionModuleReady: false,
    })
    await expect(validateTextOpenWorldProgressionCatalogsV1({ artifact, context: input.progressionContext }))
      .resolves.toEqual(artifact)
  }, 120_000)

  it('拒绝技能需求漏项、篡改主角初始能力和不完整的主动攻击公式', async () => {
    const input = await progressionCatalogsFixture()
    await expect(executeProgressionCatalogs(input, progressionCatalogsRunner({ omitDemand: true })))
      .rejects.toThrow(/skills必须与9项skillDemands一一对应/)
    await expect(executeProgressionCatalogs(input, progressionCatalogsRunner({ rewriteInitial: true })))
      .rejects.toThrow(/PlayerBuild技能标题不可改写/)
    await expect(executeProgressionCatalogs(input, progressionCatalogsRunner({ missingCombatFormula: true })))
      .rejects.toThrow(/主动攻击技能必须且只能声明完整战斗公式/)
  }, 120_000)

  it('拒绝非法被动技能，也拒绝重算Hash后改写经验曲线或注入运行绑定', async () => {
    const input = await progressionCatalogsFixture()
    await expect(executeProgressionCatalogs(input, progressionCatalogsRunner({ invalidPassive: true })))
      .rejects.toThrow(/被动技能必须以自身为目标且无主动消耗/)

    const artifact = structuredClone((await executeProgressionCatalogs(input)).artifacts[0]!.payload as TextOpenWorldProgressionCatalogsV1)
    artifact.levels[1]!.cumulativeExperience = 101
    artifact.skills[0]!.runtimeBinding.actionKey = 'action.forged' as null
    const { progressionCatalogsHash: _hash, ...body } = artifact
    artifact.progressionCatalogsHash = await hashProductProductionValueV2(body)
    await expect(validateTextOpenWorldProgressionCatalogsV1({ artifact, context: input.progressionContext }))
      .rejects.toThrow(/成长曲线、需求覆盖、技能稳定键或未绑定运行槽被篡改/)
  }, 120_000)
})

describe('R-OPEN-WORLD3 · P8 EnemyEncounterCatalog', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('把战斗Objective与地区保底供给编译为有确定性数值的敌人和遭遇目录候选', async () => {
    const input = await encounterCatalogFixture()
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.encounter-catalog-input')).toMatchObject({
      layer: 'L0', ownerFrom: 'work', protectedFromTrim: true,
    })
    expect(getAgentSkillV1('text-open-world.production.encounter-catalog.v1')).toMatchObject({
      contextSourceKeys: ['text-open-world.encounter-catalog-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
    })
    expect(input.encounterContextEvidence).toEqual([
      expect.objectContaining({ key: 'text-open-world.encounter-catalog-input', status: 'included', delivery: 'full' }),
    ])
    expect(input.encounterContext.encounterDemands).toHaveLength(5)

    const result = await executeEncounterCatalog(input)
    const artifact = result.artifacts[0]!.payload as TextOpenWorldEnemyEncounterCatalogV1
    expect(result.passedGateIds).toEqual(input.task.acceptanceGateIds)
    expect(result.usage).toMatchObject({ modelCalls: 1, mediaCalls: 0 })
    expect(artifact.enemies).toHaveLength(5)
    expect(artifact.encounters).toHaveLength(5)
    expect(artifact.strategyProfiles).toHaveLength(5)
    expect(artifact.coverage.requiredEnemyRequirementKeys).toHaveLength(1)
    expect(artifact.coverage.coveredEnemyRequirementKeys).toEqual(artifact.coverage.requiredEnemyRequirementKeys)
    expect(artifact.coverage.requiredEncounterRequirementKeys).toHaveLength(2)
    expect(artifact.coverage.coveredEncounterRequirementKeys).toEqual(artifact.coverage.requiredEncounterRequirementKeys)
    expect(new Set(artifact.coverage.coveredCombatObjectiveKeys)).toEqual(new Set(artifact.coverage.combatObjectiveKeys))
    expect(new Set(artifact.coverage.coveredRegionKeys)).toEqual(new Set(artifact.coverage.requiredRegionKeys))
    expect(artifact.playerSkillResolutions.map(item => item.skillKey)).toEqual(expect.arrayContaining([
      'skill.player.basic-attack', 'skill.player.signature',
    ]))
    expect(artifact.enemies.every(enemy => enemy.runtimeBinding.status === 'runtime-partial'
      && enemy.runtimeBinding.dropTableKey === null
      && enemy.skillKeys.length === 1)).toBe(true)
    expect(artifact.encounters.every(encounter => encounter.runtimeBinding.status === 'runtime-unbound'
      && encounter.runtimeBinding.rewardContractKey === null
      && encounter.escapePolicy.allowed
      && encounter.defeatPolicy.kind === 'retry-or-respawn')).toBe(true)
    expect(artifact.governance).toMatchObject({
      statOwner: 'deterministic-compiler', standardDifficultyOnly: true,
      friendlyNpcCombatants: false, elementsDisabled: true,
      everyCombatObjectiveCovered: true, rewardsAndDropsDeferred: true,
      encounterModuleReady: false,
    })
    await expect(validateTextOpenWorldEnemyEncounterCatalogV1({ artifact, context: input.encounterContext }))
      .resolves.toEqual(artifact)
  }, 150_000)

  it('拒绝遭遇需求漏项、越界地点和同质化敌人标题', async () => {
    const input = await encounterCatalogFixture()
    await expect(executeEncounterCatalog(input, encounterCatalogRunner({ omitDemand: true })))
      .rejects.toThrow(/encounters必须与5项需求一一对应/)
    await expect(executeEncounterCatalog(input, encounterCatalogRunner({ invalidLocation: true })))
      .rejects.toThrow(/locationNumber必须是/)
    await expect(executeEncounterCatalog(input, encounterCatalogRunner({ duplicateEnemyTitle: true })))
      .rejects.toThrow(/敌人标题不得重复/)
  }, 150_000)

  it('拒绝重算Hash后修改敌人数值、奖励预留或战斗保护策略', async () => {
    const input = await encounterCatalogFixture()
    const artifact = structuredClone((await executeEncounterCatalog(input)).artifacts[0]!.payload as TextOpenWorldEnemyEncounterCatalogV1)
    artifact.enemies[0]!.attack += 999
    artifact.encounters[0]!.runtimeBinding.rewardContractKey = 'reward.forged' as null
    artifact.encounters[0]!.defeatPolicy.kind = 'none' as 'retry-or-respawn'
    const { enemyEncounterCatalogHash: _hash, ...body } = artifact
    artifact.enemyEncounterCatalogHash = await hashProductProductionValueV2(body)
    await expect(validateTextOpenWorldEnemyEncounterCatalogV1({ artifact, context: input.encounterContext }))
      .rejects.toThrow(/遭遇需求覆盖、敌人数值、稳定键、奖励预留或运行绑定被篡改|Enemy数值不属于确定性archetype/)
  }, 150_000)
})
