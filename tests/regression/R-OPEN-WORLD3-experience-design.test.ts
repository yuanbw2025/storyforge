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
import { TEXT_OPEN_WORLD_EFFECT_OPERATIONS_V1 } from '../../src/lib/types/text-open-world-effect'
import type {
  TextOpenWorldGameplayRulesetSkeletonV1,
  TextOpenWorldPlayerBuildV1,
  TextOpenWorldRegionSkeletonV1,
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
