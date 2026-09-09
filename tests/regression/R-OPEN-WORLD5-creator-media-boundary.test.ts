import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createTextOpenWorldProductionExecutorV1 } from '../../src/lib/open-world/production-executor'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { resolveTrustedRelayMediaCapabilityV1 } from '../../src/lib/product-production/media-transport'
import {
  createBuiltInProductionCapabilityBindingV1,
} from '../../src/lib/product-production/production-executor'
import { createProductProductionPlanV3, parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import {
  projectProductProductionSchedulerV1,
  runProductProductionSchedulerCycleV1,
  runProductProductionUntilBlockedV1,
  type ProductProductionTaskExecutionInputV1,
  type ProductProductionTaskExecutionResultV1,
  type ProductProductionTaskExecutorV1,
} from '../../src/lib/product-production/scheduler'
import type {
  ProductProductionBriefV3,
  ProductProductionPlanTaskV3,
  ProductProductionRecordV1,
} from '../../src/lib/types'
import {
  CURRENT_PRODUCT_RESOURCE_KEYS,
  currentProductSelection,
  seedCurrentProductWorld,
} from '../helpers/current-product-world'

const HASH = 'a'.repeat(64)

function capability(requirementKey: string, mediaClass: 'text' | 'image') {
  return {
    requirementKey,
    mediaClass,
    operation: 'generate',
    adapterFamily: mediaClass === 'text' ? 'configured-text' : 'configured-media',
    minimumCapabilityVersion: '1',
    allowedDataClasses: ['world-selection'],
    maximumRequestCost: mediaClass === 'image' ? 0 : 1,
    maximumTotalCost: mediaClass === 'image' ? 0 : 30,
    rightsPolicyVersion: 'storyforge-rights-v1',
    capabilityHash: HASH,
    required: true,
  } as const
}

function creatorExecutionBrief(): ProductProductionBriefV3 {
  return parseProductProductionBriefV3({
    schema: 'storyforge.product-production-brief',
    version: 3,
    source: {
      worldReleaseId: 1,
      worldContentHash: HASH,
      selection: currentProductSelection('text-open-world', {
        story: [CURRENT_PRODUCT_RESOURCE_KEYS.story],
        characters: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
        locations: [CURRENT_PRODUCT_RESOURCE_KEYS.location],
        storyArcs: [CURRENT_PRODUCT_RESOURCE_KEYS.arc],
      }),
      startingPoint: {
        kind: 'mainline',
        title: '盐脊断流',
        summary: '冻结来源的 Creator 正式生产入口。',
        sourceRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.story],
        protagonistRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
        openingConflict: '盐井失去回声。',
      },
    },
    intent: {
      productType: 'text-open-world',
      playerRole: '巡盐人',
      protagonistRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
      openingSituation: '盐井失去回声。',
      coreExperience: ['有边界的自由演绎'],
      requiredFacts: ['冻结来源保持不变'],
      forbiddenChanges: ['不得写回世界引擎'],
      contentBoundaries: ['不生成露骨内容'],
      tone: ['边地奇幻'],
    },
    scale: {
      scope: 'campaign',
      targetPlayMinutes: 360,
      targetWordCount: 80_000,
      targetEndingCount: 2,
    },
    media: {
      visualLevel: 'key-scenes',
      audioLevel: 'none',
      imageCount: 1,
      musicTrackCount: 0,
      sfxCount: 0,
      voiceLineCount: 0,
      requiredMediaKinds: ['background'],
    },
    consultationBudget: {
      maximumModelCalls: 0,
      maximumInputTokens: 0,
      maximumOutputTokens: 0,
      maximumCostUsd: 0,
    },
    productionBudget: {
      maximumModelCalls: 160,
      maximumInputTokens: 1_200_000,
      maximumOutputTokens: 360_000,
      maximumCostUsd: 30,
      maximumMediaCalls: 1,
      maximumDurationMs: 7_200_000,
      maximumStorageBytes: 200_000_000,
    },
    qualityProfile: 'prototype',
    capabilityRequirements: [
      capability('text-open-world.production.text.v1', 'text'),
      capability('media.visual', 'image'),
    ],
    externalDataPolicy: {
      allowedDataClasses: ['world-selection'],
      forbiddenDataClasses: ['api-key'],
      allowReferenceImages: false,
      allowVoiceScripts: false,
    },
    fallbackPolicy: {
      allowTextOnly: false,
      allowExistingProjectMedia: true,
      allowProceduralAudio: true,
      onRequiredCapabilityMissing: 'pause',
    },
    completionContract: {
      requiresPlayablePreview: true,
      requiredGateIds: ['runtime.package.valid', 'runtime.playable', 'rights.complete'],
      minimumMediaCoverage: 1,
      allowSoftWaivers: false,
    },
    unresolvedDecisionKeys: [],
  })
}

function production(): ProductProductionRecordV1 {
  return {
    id: 1,
    projectId: 1,
    worldId: 1,
    workId: 1,
    productionKey: 'creator-media-boundary',
    productType: 'text-open-world',
    title: 'Creator 媒资授权边界',
    status: 'producing',
    stateRevision: 1,
    controlEpoch: 0,
    currentBriefRevision: 1,
    currentBuildNumber: 1,
    currentProductReleaseId: null,
    lastErrorJson: '{}',
    createdAt: 1,
    updatedAt: 1,
  }
}

function zeroCostVisualTask(): ProductProductionPlanTaskV3 {
  return {
    taskKey: 'media.visual',
    lane: 'visual',
    kind: 'text-open-world.image-bundle',
    skillId: 'product-production.media-request.v1',
    executionMode: 'media-provider',
    dependsOn: ['p10.system-finalize'],
    requiredReceipts: [{ taskKey: 'p10.system-finalize', receiptHash: null }],
    inputArtifactKeys: ['text-open-world.media-requirements'],
    outputArtifactKeys: ['text-open-world.media.visual.001'],
    requirementKeys: ['background'],
    capabilityRequirementKeys: ['media.visual'],
    concurrencyGroup: 'media-provider',
    subjectLockKeys: ['text-open-world.media.visual.001'],
    priority: 50,
    budgetReservation: {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      mediaCalls: 1,
      maximumCostUsd: 0,
      durationMs: 60_000,
      storageBytes: 5_000_000,
    },
    maxAttempts: 2,
    timeoutMs: 60_000,
    failurePolicy: 'pause',
    fallbackTaskKey: null,
    acceptanceGateIds: ['media.integrity', 'media.rights'],
    reuse: null,
  }
}

function executionInput(
  task: ProductProductionPlanTaskV3,
  capabilityBindings: ProductProductionTaskExecutionInputV1['capabilityBindings'],
): ProductProductionTaskExecutionInputV1 {
  return {
    scope: { projectId: 1, worldId: 1, workId: 1 },
    productionId: 1,
    buildId: 1,
    buildNumber: 1,
    controlEpoch: 0,
    planHash: 'b'.repeat(64),
    task,
    attemptBudgetReservation: structuredClone(task.budgetReservation),
    attempt: 1,
    idempotencyKey: 'c'.repeat(64),
    contextText: '',
    inputArtifacts: [],
    capabilityBindings,
    signal: new AbortController().signal,
  }
}

async function schedulerFixture(name: string) {
  const owned = await seedCurrentProductWorld(name)
  const suggestions = await suggestProductStartingPoints({
    scope: owned.scope,
    worldReleaseId: owned.release.id!,
  })
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope,
    worldReleaseId: owned.release.id!,
    suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType: 'avg',
    qualityProfile: 'prototype',
    scale: 'scene',
    visualLevel: 'key-scenes',
    audioLevel: 'none',
    requiredFacts: ['冻结世界事实保持一致'],
    forbiddenChanges: ['不得写回世界正式表'],
  })
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent',
      commandId: `${name}.intent`,
      productionKey: `${name}.production`,
      productType: 'avg',
      worldReleaseId: owned.release.id!,
      userText: `${name} 程序化媒资恢复`,
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope,
    productionId: created.productionId,
    command: {
      type: 'save-brief-revision',
      commandId: `${name}.brief`,
      expectedStateRevision: 0,
      parentRevision: null,
      brief,
    },
  })
  await executeProductProductionCommand({
    scope: owned.scope,
    productionId: created.productionId,
    command: {
      type: 'authorize-start',
      commandId: `${name}.start`,
      expectedStateRevision: 1,
      briefRevision: 1,
      briefHash: saved.result.briefHash as string,
      authorizationNonce: `${name}.click`,
    },
  })

  const base = await createProductProductionPlanV3({
    buildNumber: 1,
    controlEpoch: 0,
    briefHash: saved.result.briefHash as string,
    brief,
  })
  const design = structuredClone(base.tasks.find(task => task.taskKey === 'content.design')!)
  const media = structuredClone(base.tasks.find(task => task.taskKey === 'media.visual')!)
  media.dependsOn = [design.taskKey]
  media.requiredReceipts = [{ taskKey: design.taskKey, receiptHash: null }]
  media.inputArtifactKeys = [...design.outputArtifactKeys]
  media.outputArtifactKeys = ['media.visual.local.001']
  media.subjectLockKeys = [...media.outputArtifactKeys]
  media.budgetReservation = {
    ...media.budgetReservation,
    mediaCalls: 1,
    maximumCostUsd: 0,
  }
  const plan = parseProductProductionPlanV3({
    ...base,
    tasks: [design, media],
    terminalTaskKey: media.taskKey,
  }, brief, saved.result.briefHash as string)
  const textRequirement = brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
  const imageRequirement = brief.capabilityRequirements.find(item => item.mediaClass === 'image')!
  const capabilityBindings = [{
    requirementKey: textRequirement.requirementKey,
    adapterId: 'configured-text.v1',
    bindingHash: await hashProductProductionValueV2({ provider: 'configured-text-test' }),
  }, await createBuiltInProductionCapabilityBindingV1({
    requirementKey: imageRequirement.requirementKey,
    adapterId: 'storyforge.procedural-svg.v1',
  })]
  return {
    ...owned,
    brief,
    productionId: created.productionId,
    plan,
    design,
    media,
    capabilityBindings,
  }
}

function recoveryExecutor(calls: Map<string, number>): ProductProductionTaskExecutorV1 {
  return async request => {
    calls.set(request.task.taskKey, (calls.get(request.task.taskKey) ?? 0) + 1)
    const media = request.task.taskKey === 'media.visual'
    const result: ProductProductionTaskExecutionResultV1 = {
      artifacts: request.task.outputArtifactKeys.map(artifactKey => ({
        artifactKey,
        kind: media ? 'image' : 'product-design',
        mediaKind: media ? 'background' : null,
        payload: { schema: 'storyforge.creator-media-boundary-fixture', version: 1, artifactKey },
        rights: {
          origin: media ? 'procedural' : 'test-executor',
          adapterId: media ? 'storyforge.procedural-svg.v1' : 'configured-text.v1',
          license: media ? 'CC0-1.0' : 'test',
          commercialUse: true,
        },
      })),
      passedGateIds: [...request.task.acceptanceGateIds],
      usage: {
        modelCalls: media ? 0 : 1,
        inputTokens: media ? 0 : 1,
        outputTokens: media ? 0 : 1,
        mediaCalls: media ? 1 : 0,
        costUsd: 0,
        durationMs: 1,
        storageBytes: 0,
      },
    }
    return result
  }
}

describe('TOW-G5-04 · Creator 零费用媒资调用与恢复边界', () => {
  beforeAll(async () => {
    await db.delete()
    await db.open()
  })

  beforeEach(async () => {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map(table => table.clear()))
    })
  })

  afterEach(() => vi.restoreAllMocks())
  afterAll(() => db.close())

  it('外部 relay binding 在真实 open-world media executor 委托 provider 前失败', async () => {
    const brief = creatorExecutionBrief()
    const requirement = brief.capabilityRequirements.find(item => item.requirementKey === 'media.visual')!
    const fetcher = vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const resolved = await resolveTrustedRelayMediaCapabilityV1({
      requirement,
      relayUrl: 'https://media.storyforge.example/relay',
      environment: 'test',
      fetcher,
      now: 1,
    })
    const executor = createTextOpenWorldProductionExecutorV1({
      production: production(),
      brief,
      mediaCapabilities: new Map([[requirement.requirementKey, resolved]]),
    })

    await expect(executor(executionInput(zeroCostVisualTask(), [resolved.binding])))
      .rejects.toThrow(/未获外部媒资费用授权|只允许.*程序化/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('零费用 media.visual 不允许 taskExecutors override 绕过程序化硬闸', async () => {
    const brief = creatorExecutionBrief()
    const binding = await createBuiltInProductionCapabilityBindingV1({
      requirementKey: 'media.visual',
      adapterId: 'storyforge.procedural-svg.v1',
    })
    const override = vi.fn(async (): Promise<ProductProductionTaskExecutionResultV1> => ({
      artifacts: [],
      passedGateIds: [],
      usage: {
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        mediaCalls: 0,
        costUsd: 0,
        durationMs: 0,
        storageBytes: 0,
      },
    }))
    const executor = createTextOpenWorldProductionExecutorV1({
      production: production(),
      brief,
      taskExecutors: { 'media.visual': override },
    })

    await expect(executor(executionInput(zeroCostVisualTask(), [binding])))
      .rejects.toThrow(/media\.visual|媒资|程序化|override|覆盖/i)
    expect(override).not.toHaveBeenCalled()
  })

  it('本地程序化 media dispatch 后崩溃按安全可重放恢复，不伪装成远程 unknown-result', async () => {
    const owned = await schedulerFixture(`creator-media-recovery-${crypto.randomUUID()}`)
    const baseNow = 2_000_500_000_000
    const clock = vi.spyOn(Date, 'now').mockReturnValue(baseNow)
    const calls = new Map<string, number>()
    const executor = recoveryExecutor(calls)

    await expect(runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: owned.plan,
      capabilityBindings: owned.capabilityBindings,
      executor,
      onDurableBoundary(boundary, snapshot) {
        if (boundary === 'provider.requested'
          && snapshot.contract.scope.productProduction?.taskKey === 'media.visual') {
          throw new Error('injected-after-local-media-dispatch')
        }
      },
    })).rejects.toThrow('injected-after-local-media-dispatch')
    expect(calls.get('content.design')).toBe(1)
    expect(calls.get('media.visual') ?? 0).toBe(0)

    const interrupted = await projectProductProductionSchedulerV1({
      scope: owned.scope,
      productionId: owned.productionId,
    })
    expect(interrupted.tasks.find(task => task.taskKey === 'media.visual')?.latestDurableBoundary?.eventType)
      .toBe('tool.called')

    clock.mockReturnValue(baseNow + owned.media.timeoutMs + 1)
    const recovered = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: owned.plan,
      capabilityBindings: owned.capabilityBindings,
      executor,
    })
    const media = recovered.tasks.find(task => task.taskKey === 'media.visual')!
    expect(calls.get('media.visual')).toBe(1)
    expect(media.status).toBe('completed')
    expect(media.steps.find(step => step.stepId === 'media.visual')?.attempts).toEqual([
      expect.objectContaining({ attempt: 1, status: 'failed', failureCode: 'task-timeout-before-dispatch' }),
      expect.objectContaining({ attempt: 2, status: 'succeeded', failureCode: null }),
    ])
    expect(recovered.buildStatus).not.toBe('recovery-required')
  }, 30_000)
})
