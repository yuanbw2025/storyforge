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
