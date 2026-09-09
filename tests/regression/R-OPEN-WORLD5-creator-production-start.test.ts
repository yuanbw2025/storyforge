import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  confirmTextOpenWorldCreatorBriefV1,
  startTextOpenWorldCreatorBriefSessionV1,
  type TextOpenWorldCreatorBriefSessionV1,
} from '../../src/lib/open-world/creator-brief'
import { createTextOpenWorldCreatorSourceLocatorV1 } from '../../src/lib/open-world/creator-brief-persistence'
import {
  confirmTextOpenWorldCreatorProductionPreflightV1,
  createTextOpenWorldCreatorProductionPreflightV1,
} from '../../src/lib/open-world/creator-production-preflight'
import { readTextOpenWorldCreatorExecutionBriefV1 } from '../../src/lib/open-world/creator-production-start'
import { createTextOpenWorldProductionExecutorV1 } from '../../src/lib/open-world/production-executor'
import {
  inspectTextOpenWorldCreatorNovelSourceV1,
  inspectTextOpenWorldCreatorWorldSourceV1,
} from '../../src/lib/open-world/creator-source'
import {
  authorizeTextOpenWorldCreatorProductionStartV1,
  previewTextOpenWorldCreatorProductionStartV1,
  runAuthorizedProductProductionV1,
  type TextOpenWorldCreatorStartInputV1,
} from '../../src/lib/product-production/service'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { resolveConfiguredTextCapabilityV1 } from '../../src/lib/product-production/capabilities'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import {
  ProductProductionDraftRejectedErrorV1,
  runProductProductionSchedulerCycleV1,
  runProductProductionUntilBlockedV1,
  type ProductProductionTaskExecutionInputV1,
} from '../../src/lib/product-production/scheduler'
import type {
  AIConfig,
  TextOpenWorldCreatorSourceSelectionV1,
} from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

const AI_CONFIG: AIConfig = {
  provider: 'deepseek',
  apiKey: 'creator-start-regression-session-key',
  model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com/v1',
  temperature: 0.7,
  maxTokens: 0,
}

const BRIEF_ACKNOWLEDGEMENTS = {
  sourceIdentityReviewed: true,
  productBoundaryReviewed: true,
  unresolvedItemsClosed: true,
  directPublishWorkflowReviewed: true,
} as const

const PREFLIGHT_ACKNOWLEDGEMENT = {
  credentialPolicyReviewed: true,
  providerAndModelReviewed: true,
  priceAndBudgetReviewed: true,
  mediaCostBoundaryReviewed: true,
} as const

async function seedNovel(name: string) {
  const created = await createWorkspace({
    name,
    genres: ['fantasy'],
    status: 'drafting',
    description: '用于 Creator 正式启动链路测试的小说来源。',
    targetWordCount: 80_000,
    enableMultiWorld: false,
  }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
  const now = Date.now() - 2_000
  const volumeId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
    projectId: created.scope.projectId,
    parentId: null,
    type: 'volume',
    title: '盐脊卷',
    summary: '巡井人从断流调查走向城邦边境。',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' })) as number
  const outlineId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
    projectId: created.scope.projectId,
    parentId: volumeId,
    type: 'chapter',
    title: '第一章 断流',
    summary: '巡井人在旧渠发现被抹去的盐印。',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' })) as number
  const chapterId = await db.chapters.add(stampNewRecord(created.scope, 'chapters', {
    projectId: created.scope.projectId,
    outlineNodeId: outlineId,
    title: '第一章 断流',
    content: '<p>巡井人在旧渠发现被抹去的盐印，并决定追查断流源头。</p>',
    wordCount: 28,
    status: 'final',
    order: 0,
    notes: '',
    summary: '巡井人在旧渠发现被抹去的盐印。',
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' })) as number
  await db.storyCores.add(stampNewRecord(created.scope, 'storyCores', {
    projectId: created.scope.projectId,
    theme: '成长与守护',
    centralConflict: '巡井人必须在城邦秩序与断流真相之间作出选择。',
    plotPattern: '调查—成长—远行—回归',
    logline: '巡井人追查正在吞噬各地水源的旧日契约。',
    concept: '从小说拆解为文字开放世界',
    mainPlot: '逐区追查断流源头并完成主线目标。',
    subPlots: '各地角色、势力和地域命运故事。',
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' }))
  return { ...created, chapterId, now }
}

async function worldSelection(name: string): Promise<TextOpenWorldCreatorSourceSelectionV1> {
  const owned = await seedCurrentProductWorld(name)
  const preview = await inspectTextOpenWorldCreatorWorldSourceV1({
    scope: owned.scope,
    localReleaseRecordId: owned.release.id!,
    expectedReleaseHash: owned.release.contentHash,
  })
  return {
    sourceKind: 'world-release',
    sourceScope: owned.scope,
    localReleaseRecordId: owned.release.id!,
    expectedReleaseHash: owned.release.contentHash,
    preview,
  }
}

async function novelSelection(name: string) {
  const novel = await seedNovel(name)
  const selection = { mode: 'entire-work' } as const
  const preview = await inspectTextOpenWorldCreatorNovelSourceV1({
    sourceScope: novel.scope,
    selection,
  })
  return {
    novel,
    selection: {
      sourceKind: 'novel',
      sourceScope: novel.scope,
      selection,
      preview,
    } satisfies TextOpenWorldCreatorSourceSelectionV1,
  }
}

async function prepareStart(
  selection: TextOpenWorldCreatorSourceSelectionV1,
  sessionKey: string,
): Promise<{
  confirmed: TextOpenWorldCreatorBriefSessionV1
  input: TextOpenWorldCreatorStartInputV1
  preview: Awaited<ReturnType<typeof previewTextOpenWorldCreatorProductionStartV1>>
  beforePreview: Awaited<ReturnType<typeof productionMutationSnapshot>>
  afterPreview: Awaited<ReturnType<typeof productionMutationSnapshot>>
}> {
  const baseTime = Date.now() - 1_000
  const started = await startTextOpenWorldCreatorBriefSessionV1({
    selection,
    sessionKey,
    createdAt: baseTime,
  })
  const confirmed = await confirmTextOpenWorldCreatorBriefV1({
    session: started,
    draft: {
      ...started.draft,
      gameTitle: `启动链路 ${sessionKey}`,
      coreGoal: '完成可验证主线，并让来源事实只经冻结交接物进入生产。',
    },
    acknowledgements: BRIEF_ACKNOWLEDGEMENTS,
    confirmedAt: baseTime + 1,
  })
  const brief = confirmed.confirmedBrief!
  const preflight = await createTextOpenWorldCreatorProductionPreflightV1({
    brief,
    projectId: confirmed.scope.projectId,
    aiConfig: AI_CONFIG,
    rememberApiKey: false,
    pricing: { mode: 'catalog' },
  })
  const confirmation = await confirmTextOpenWorldCreatorProductionPreflightV1({
    brief,
    preflight,
    projectId: confirmed.scope.projectId,
    aiConfig: AI_CONFIG,
    rememberApiKey: false,
    acknowledgement: PREFLIGHT_ACKNOWLEDGEMENT,
    confirmedAt: baseTime + 2,
  })
  const input: TextOpenWorldCreatorStartInputV1 = {
    scope: confirmed.scope,
    productionId: confirmed.production.id,
    briefRevision: brief.revision,
    briefHash: brief.briefHash,
    expectedStateRevision: confirmed.production.stateRevision,
    sourceLocator: createTextOpenWorldCreatorSourceLocatorV1(confirmed.selection!),
    preflight,
    confirmation,
    rightsBasis: 'author-owned',
    rightsNote: '作者确认拥有当前来源的改编与生产权利。',
    authorizationNonce: `creator-start-${sessionKey}`,
    authorizedAt: baseTime + 3,
  }
  const beforePreview = await productionMutationSnapshot()
  const preview = await previewTextOpenWorldCreatorProductionStartV1(input)
  const afterPreview = await productionMutationSnapshot()
  return { confirmed, input, preview, beforePreview, afterPreview }
}

async function productionMutationSnapshot() {
  const [productions, briefs, commands, builds, artifacts, blobs, runs, events] = await Promise.all([
    db.productProductions.toArray(),
    db.productProductionBriefs.toArray(),
    db.productProductionCommands.toArray(),
    db.productBuilds.toArray(),
    db.productBuildArtifacts.toArray(),
    db.mediaBlobObjects.toArray(),
    db.agentRuns.toArray(),
    db.agentRunEvents.toArray(),
  ])
  return { productions, briefs, commands, builds, artifacts, blobs, runs, events }
}

describe('TOW-G5-04 · Creator 正式启动链路', () => {
  const originalAIState = useAIConfigStore.getState()

  beforeEach(async () => {
    await db.delete()
    await db.open()
    useAIConfigStore.setState({
      config: structuredClone(AI_CONFIG),
      rememberApiKey: false,
      presets: [],
      taskRoutes: {},
    })
  })

  afterAll(() => {
    db.close()
    useAIConfigStore.setState(originalAIState)
  })

  it.each([
    ['world-release', () => worldSelection(`G5-04 world ${crypto.randomUUID()}`)],
    ['novel', async () => (await novelSelection(`G5-04 novel ${crypto.randomUUID()}`)).selection],
  ] as const)('%s 来源预览零写入，并原子冻结 SourcePlan、Start、Plan 与 Build', async (sourceKind, selectionFactory) => {
    const selection = await selectionFactory()
    const prepared = await prepareStart(selection, `happy-${sourceKind}`)

    expect(prepared.preview.sourcePlan.sourceKind).toBe(sourceKind)
    expect(prepared.preview.sourcePlan.selection.kind).toBe(sourceKind === 'world-release' ? 'world-release' : 'novel')
    expect(prepared.preview.start.executionBrief.intent.productType).toBe('text-open-world')
    expect(prepared.preview.start.executionBrief).toMatchObject({
      qualityProfile: 'prototype',
      media: {
        imageCount: 2,
        musicTrackCount: 0,
        sfxCount: 0,
      },
    })
    expect(prepared.preview.start.executionBrief.capabilityRequirements.find(
      requirement => requirement.mediaClass === 'image',
    )).toMatchObject({ required: false, maximumRequestCost: 0, maximumTotalCost: 0 })
    expect(prepared.preview.plan.tasks.find(task => task.taskKey === 'media.visual'))
      .toMatchObject({
        executionMode: 'media-provider',
        capabilityRequirementKeys: ['media.visual'],
        budgetReservation: { mediaCalls: 2, maximumCostUsd: 0 },
      })
    expect(prepared.preview.plan.briefHash).toBe(prepared.confirmed.confirmedBrief!.briefHash)
    expect(prepared.afterPreview).toEqual(prepared.beforePreview)

    const receipt = await authorizeTextOpenWorldCreatorProductionStartV1({
      ...prepared.input,
      expectedPlanHash: prepared.preview.start.productionPlanHash,
    })
    expect(receipt).toMatchObject({ ok: true, replayed: false })
    expect(receipt.result).toMatchObject({
      briefHash: prepared.confirmed.confirmedBrief!.briefHash,
      sourcePlanHash: prepared.preview.sourcePlan.planHash,
      planHash: prepared.preview.start.productionPlanHash,
      startHash: prepared.preview.start.startHash,
    })

    const production = await db.productProductions.get(prepared.input.productionId)
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]')
      .equals([prepared.input.productionId, prepared.input.briefRevision])
      .first()
    const builds = await db.productBuilds.where('productionId').equals(prepared.input.productionId).toArray()
    expect(production).toMatchObject({
      status: 'producing',
      currentBuildNumber: 1,
      stateRevision: prepared.input.expectedStateRevision + 1,
    })
    expect(briefRow).toMatchObject({
      status: 'authorized',
      sourcePlanHash: prepared.preview.sourcePlan.planHash,
      confirmedBriefHash: prepared.preview.start.startHash,
      authorizedAt: prepared.input.authorizedAt,
    })
    expect(builds).toHaveLength(1)
    expect(builds[0]).toMatchObject({
      status: 'authorized',
      buildNumber: 1,
      briefHash: prepared.confirmed.confirmedBrief!.briefHash,
      planHash: prepared.preview.start.productionPlanHash,
    })

    const frozen = await readTextOpenWorldCreatorExecutionBriefV1({
      briefRow: briefRow!,
      planJson: builds[0]!.planJson,
    })
    expect(frozen.creatorBrief).toEqual(prepared.confirmed.confirmedBrief)
    expect(frozen.sourcePlan).toEqual(prepared.preview.sourcePlan)
    expect(frozen.start).toEqual(prepared.preview.start)
    expect(frozen.executionBrief).toEqual(prepared.preview.start.executionBrief)
  }, 30_000)

  it('Creator Start 只冻结非定位 compatibility 占位值，项目导入后仍由重映射行 locator 驱动', async () => {
    // Occupy the first physical release id so the regression cannot pass by
    // accidentally equating the compatibility sentinel with a real locator.
    await seedCurrentProductWorld(`G5-04 portability placeholder ${crypto.randomUUID()}`)
    const selection = await worldSelection(`G5-04 portable start ${crypto.randomUUID()}`)
    expect(selection.sourceKind).toBe('world-release')
    if (selection.sourceKind !== 'world-release') throw new Error('测试来源类型错误')
    expect(selection.localReleaseRecordId).toBeGreaterThan(1)
    const prepared = await prepareStart(selection, 'portable-compatibility-coordinate')
    expect(prepared.preview.start.executionBrief.source.worldReleaseId).toBe(1)
    expect(JSON.stringify(prepared.preview.sourcePlan)).not.toContain('localReleaseRecordId')
    await authorizeTextOpenWorldCreatorProductionStartV1({
      ...prepared.input,
      expectedPlanHash: prepared.preview.start.productionPlanHash,
    })

    const backup = await exportProjectJSON(prepared.preview.scope.projectId)
    const portableBrief = backup.productProductionBriefs[0]!
    expect(portableBrief).not.toHaveProperty('sourcePlanJson')
    expect(JSON.parse(portableBrief._sourcePlanPortableJson)).not.toHaveProperty('worldReference')
    expect(JSON.parse(portableBrief.confirmedBriefJson).executionBrief.source.worldReleaseId).toBe(1)

    const importedProjectId = await importProjectJSON(structuredClone(backup))
    const importedScope = (await resolveWorkspaceOwnership(importedProjectId)).scope
    const [briefRow, build] = await Promise.all([
      db.productProductionBriefs.where('projectId').equals(importedProjectId).first(),
      db.productBuilds.where('projectId').equals(importedProjectId).first(),
    ])
    expect(briefRow!.sourceWorldReleaseId).not.toBe(1)
    expect(briefRow!.sourceWorldReleaseId).not.toBe(selection.localReleaseRecordId)
    expect(briefRow!.workId).toBe(importedScope.workId)
    const rebound = await readTextOpenWorldCreatorExecutionBriefV1({
      briefRow: briefRow!,
      planJson: build!.planJson,
    })
    expect(rebound.start.executionBrief.source.worldReleaseId).toBe(1)
    expect(rebound.sourcePlan.planHash).toBe(prepared.preview.sourcePlan.planHash)
    expect(rebound.start.startHash).toBe(prepared.preview.start.startHash)
  }, 30_000)

  it('source/config/plan 任一 CAS 漂移都在命令 claim 前失败且生产链零写入', async () => {
    const sourceCase = await novelSelection(`G5-04 source CAS ${crypto.randomUUID()}`)
    const sourcePrepared = await prepareStart(sourceCase.selection, 'source-cas')
    await db.chapters.update(sourceCase.novel.chapterId, {
      content: '<p>作者在预览后修改了小说正文，旧 SourcePlan 必须失效。</p>',
      updatedAt: Date.now(),
    })
    const beforeSourceFailure = await productionMutationSnapshot()
    await expect(authorizeTextOpenWorldCreatorProductionStartV1({
      ...sourcePrepared.input,
      expectedPlanHash: sourcePrepared.preview.start.productionPlanHash,
    })).rejects.toThrow(/来源|变化|CAS|Hash|stale/i)
    expect(await productionMutationSnapshot()).toEqual(beforeSourceFailure)

    const configPrepared = await prepareStart(
      await worldSelection(`G5-04 config CAS ${crypto.randomUUID()}`),
      'config-cas',
    )
    useAIConfigStore.setState({
      config: { ...AI_CONFIG, model: 'deepseek-reasoner' },
      rememberApiKey: false,
    })
    const beforeConfigFailure = await productionMutationSnapshot()
    await expect(authorizeTextOpenWorldCreatorProductionStartV1({
      ...configPrepared.input,
      expectedPlanHash: configPrepared.preview.start.productionPlanHash,
    })).rejects.toThrow(/模型|配置|变化|绑定/i)
    expect(await productionMutationSnapshot()).toEqual(beforeConfigFailure)
    useAIConfigStore.setState({ config: structuredClone(AI_CONFIG), rememberApiKey: false })

    const planPrepared = await prepareStart(
      await worldSelection(`G5-04 plan CAS ${crypto.randomUUID()}`),
      'plan-cas',
    )
    const beforePlanFailure = await productionMutationSnapshot()
    await expect(authorizeTextOpenWorldCreatorProductionStartV1({
      ...planPrepared.input,
      expectedPlanHash: 'f'.repeat(64),
    })).rejects.toThrow(/Plan 已变化|生产 Plan 已变化/)
    expect(await productionMutationSnapshot()).toEqual(beforePlanFailure)
  }, 30_000)

  it('权利说明为空时在预览边界失败且不写入任何生产状态', async () => {
    const selection = await worldSelection(`G5-04 rights ${crypto.randomUUID()}`)
    const prepared = await prepareStart(selection, 'rights-required')
    const beforeFailure = await productionMutationSnapshot()

    await expect(previewTextOpenWorldCreatorProductionStartV1({
      ...prepared.input,
      rightsNote: '   ',
    })).rejects.toThrow(/rightsNote|权利/i)

    expect(await productionMutationSnapshot()).toEqual(beforeFailure)
  }, 30_000)

  it('正式事务内再次核对当前模型绑定，竞态变化时整单回滚', async () => {
    const selection = await worldSelection(`G5-04 atomic config CAS ${crypto.randomUUID()}`)
    const prepared = await prepareStart(selection, 'atomic-config-cas')
    const stableState = useAIConfigStore.getState()
    const changedState = {
      ...stableState,
      config: { ...stableState.config, model: 'deepseek-reasoner' },
    }
    let stateReads = 0
    const getState = vi.spyOn(useAIConfigStore, 'getState')
      .mockImplementation(() => ++stateReads === 1 ? stableState : changedState)
    const beforeFailure = await productionMutationSnapshot()

    try {
      await expect(authorizeTextOpenWorldCreatorProductionStartV1({
        ...prepared.input,
        expectedPlanHash: prepared.preview.start.productionPlanHash,
      })).rejects.toThrow(/模型|绑定|配置|原子授权/i)
      expect(stateReads).toBeGreaterThanOrEqual(2)
      expect(await productionMutationSnapshot()).toEqual(beforeFailure)
    } finally {
      getState.mockRestore()
    }
  }, 30_000)

  it('零媒体费用计划在任何外部 adapter 调用前失败关闭', async () => {
    const selection = await worldSelection(`G5-04 media boundary ${crypto.randomUUID()}`)
    const prepared = await prepareStart(selection, 'media-boundary')
    const task = prepared.preview.plan.tasks.find(candidate => candidate.taskKey === 'media.visual')!
    const executor = createTextOpenWorldProductionExecutorV1({
      production: prepared.preview.production,
      brief: prepared.preview.start.executionBrief,
      mediaCapabilities: new Map([['media.visual', {} as never]]),
    })
    const execution = {
      scope: prepared.preview.scope,
      productionId: prepared.preview.production.id,
      buildId: 1,
      buildNumber: prepared.preview.buildNumber,
      controlEpoch: prepared.preview.plan.controlEpoch,
      planHash: prepared.preview.start.productionPlanHash,
      task,
      attemptBudgetReservation: task.budgetReservation,
      attempt: 1,
      idempotencyKey: 'media-boundary-attempt',
      contextText: '{}',
      inputArtifacts: [],
      capabilityBindings: [{
        requirementKey: 'media.visual',
        adapterId: 'agnes.image-2.1-flash.v1',
        bindingHash: 'a'.repeat(64),
      }],
      signal: new AbortController().signal,
    } satisfies ProductProductionTaskExecutionInputV1

    await expect(executor(execution)).rejects.toThrow(/未获外部媒资费用授权|内置程序化 adapter/)
  }, 30_000)

  it('暂停恢复后的新 epoch 只重绑冻结 Plan 的 epoch，并保持 Creator Start 与 DAG 不变', async () => {
    const selection = await worldSelection(`G5-04 creator recovery ${crypto.randomUUID()}`)
    const prepared = await prepareStart(selection, 'creator-recovery')
    await authorizeTextOpenWorldCreatorProductionStartV1({
      ...prepared.input,
      expectedPlanHash: prepared.preview.start.productionPlanHash,
    })
    const frozenBriefRow = (await db.productProductionBriefs
      .where('[productionId+revision]')
      .equals([prepared.input.productionId, prepared.input.briefRevision])
      .first())!
    const frozenStartJson = frozenBriefRow.confirmedBriefJson
    const frozenStartHash = frozenBriefRow.confirmedBriefHash
    const producing = (await db.productProductions.get(prepared.input.productionId))!

    await executeProductProductionCommand({
      scope: prepared.preview.scope,
      productionId: prepared.input.productionId,
      command: {
        type: 'pause',
        commandId: 'creator-recovery.pause',
        expectedStateRevision: producing.stateRevision,
        reason: '作者检查冻结生产计划',
      },
    })
    const paused = (await db.productProductions.get(prepared.input.productionId))!
    await executeProductProductionCommand({
      scope: prepared.preview.scope,
      productionId: prepared.input.productionId,
      command: {
        type: 'resume',
        commandId: 'creator-recovery.resume',
        expectedStateRevision: paused.stateRevision,
      },
    })

    const executor = vi.fn(async () => {
      const error = new Error('作者恢复验证在首个任务 dispatch 后主动终止')
      error.name = 'AbortError'
      throw error
    })
    const projection = await runProductProductionSchedulerCycleV1({
      scope: prepared.preview.scope,
      productionId: prepared.input.productionId,
      executor,
      capabilityBindings: [{
        requirementKey: 'media.visual',
        adapterId: 'storyforge.procedural-svg.v1',
        bindingHash: 'a'.repeat(64),
      }],
    })
    expect(executor).toHaveBeenCalledTimes(1)
    expect(projection.controlEpoch).toBe(prepared.preview.plan.controlEpoch + 2)

    const [currentBuild, currentBriefRow] = await Promise.all([
      db.productBuilds.get(projection.buildId),
      db.productProductionBriefs
        .where('[productionId+revision]')
        .equals([prepared.input.productionId, prepared.input.briefRevision])
        .first(),
    ])
    expect(currentBriefRow).toMatchObject({
      confirmedBriefJson: frozenStartJson,
      confirmedBriefHash: frozenStartHash,
    })
    const currentPlan = parseProductProductionPlanV3(
      currentBuild!.planJson,
      prepared.preview.start.executionBrief,
      prepared.preview.start.briefHash,
    )
    expect({
      ...currentPlan,
      controlEpoch: prepared.preview.start.productionPlanControlEpoch,
    }).toEqual(prepared.preview.plan)
    expect(currentBuild!.planHash).toBe(await hashProductProductionValueV2(currentPlan))
    expect(currentBuild!.planHash).not.toBe(prepared.preview.start.productionPlanHash)

    const reread = await readTextOpenWorldCreatorExecutionBriefV1({
      briefRow: currentBriefRow!,
      planJson: currentBuild!.planJson,
    })
    expect(reread.start).toEqual(prepared.preview.start)

    const changedDag = {
      ...currentPlan,
      concurrency: {
        ...currentPlan.concurrency,
        maximumTextProviderTasks: 1,
      },
    }
    await db.productBuilds.update(currentBuild!.id!, {
      planJson: JSON.stringify(changedDag),
      planHash: await hashProductProductionValueV2(changedDag),
    })
    await expect(readTextOpenWorldCreatorExecutionBriefV1({
      briefRow: currentBriefRow!,
      planJson: changedDag,
    })).rejects.toThrow(/DAG|预算|作者授权/)
  }, 30_000)

  it('Creator blocker retry 在新 epoch 重跑 scheduler 且不改写冻结 Start 或 Plan body', async () => {
    const selection = await worldSelection(`G5-04 creator blocker ${crypto.randomUUID()}`)
    const prepared = await prepareStart(selection, 'creator-blocker')
    await authorizeTextOpenWorldCreatorProductionStartV1({
      ...prepared.input,
      expectedPlanHash: prepared.preview.start.productionPlanHash,
    })
    const briefRowBefore = (await db.productProductionBriefs
      .where('[productionId+revision]')
      .equals([prepared.input.productionId, prepared.input.briefRevision])
      .first())!
    let curationCalls = 0
    const rejectCuration = async () => {
      curationCalls += 1
      throw new ProductProductionDraftRejectedErrorV1('作者需要确认来源整理结果', {
        modelCalls: 1,
        inputTokens: 10,
        outputTokens: 10,
        mediaCalls: 0,
        costUsd: 0,
        durationMs: 1,
        storageBytes: 0,
      })
    }
    const executor = createTextOpenWorldProductionExecutorV1({
      production: prepared.preview.production,
      brief: prepared.preview.start.executionBrief,
      taskExecutors: { 'p1.source-curation': rejectCuration },
    })
    const capabilityBindings = [{
      requirementKey: 'text-open-world.production.text.v1',
      adapterId: 'configured-text-provider.v1',
      bindingHash: 'b'.repeat(64),
    }, {
      requirementKey: 'media.visual',
      adapterId: 'storyforge.procedural-svg.v1',
      bindingHash: 'a'.repeat(64),
    }]

    const firstBlocked = await runProductProductionUntilBlockedV1({
      scope: prepared.preview.scope,
      productionId: prepared.input.productionId,
      executor,
      capabilityBindings,
    })
    expect(firstBlocked.buildStatus).toBe('recovery-required')
    expect(curationCalls).toBe(1)
    const blockedProduction = (await db.productProductions.get(prepared.input.productionId))!
    const resolved = await executeProductProductionCommand({
      scope: prepared.preview.scope,
      productionId: prepared.input.productionId,
      command: {
        type: 'resolve-blocker',
        commandId: 'creator-blocker.retry',
        expectedStateRevision: blockedProduction.stateRevision,
        blockerKey: 'p1.source-curation',
        resolution: { action: 'retry', note: '作者确认在新 epoch 重试' },
      },
    })
    expect(resolved).toMatchObject({
      ok: true,
      result: { action: 'retry', controlEpoch: prepared.preview.plan.controlEpoch + 1 },
    })

    const secondBlocked = await runProductProductionUntilBlockedV1({
      scope: prepared.preview.scope,
      productionId: prepared.input.productionId,
      executor,
      capabilityBindings,
    })
    expect(secondBlocked.buildStatus).toBe('recovery-required')
    expect(secondBlocked.controlEpoch).toBe(prepared.preview.plan.controlEpoch + 1)
    expect(curationCalls).toBe(2)
    const [currentBuild, briefRowAfter] = await Promise.all([
      db.productBuilds.get(secondBlocked.buildId),
      db.productProductionBriefs
        .where('[productionId+revision]')
        .equals([prepared.input.productionId, prepared.input.briefRevision])
        .first(),
    ])
    expect(briefRowAfter!.confirmedBriefJson).toBe(briefRowBefore.confirmedBriefJson)
    expect(briefRowAfter!.confirmedBriefHash).toBe(briefRowBefore.confirmedBriefHash)
    const currentPlan = parseProductProductionPlanV3(
      currentBuild!.planJson,
      prepared.preview.start.executionBrief,
      prepared.preview.start.briefHash,
    )
    expect({
      ...currentPlan,
      controlEpoch: prepared.preview.start.productionPlanControlEpoch,
    }).toEqual(prepared.preview.plan)
    await expect(readTextOpenWorldCreatorExecutionBriefV1({
      briefRow: briefRowAfter!,
      planJson: currentBuild!.planJson,
    })).resolves.toMatchObject({ start: prepared.preview.start })
  }, 30_000)

  it('正式运行或恢复前模型路由/生成参数漂移会在任何 provider 请求前停止', async () => {
    const selection = await worldSelection(`G5-04 runtime binding ${crypto.randomUUID()}`)
    const prepared = await prepareStart(selection, 'runtime-binding')
    await authorizeTextOpenWorldCreatorProductionStartV1({
      ...prepared.input,
      expectedPlanHash: prepared.preview.start.productionPlanHash,
    })
    const beforeRun = await productionMutationSnapshot()
    useAIConfigStore.setState({
      config: { ...AI_CONFIG, temperature: 0.25 },
    })
    const fetchProvider = vi.spyOn(globalThis, 'fetch')

    await expect(runAuthorizedProductProductionV1({
      scope: prepared.preview.scope,
      productionId: prepared.preview.production.id,
    })).rejects.toThrow(/路由|模型|配置|变化|重新确认/i)
    expect(fetchProvider).not.toHaveBeenCalled()
    expect(await productionMutationSnapshot()).toEqual(beforeRun)
  }, 30_000)

  it('Creator 预检冻结的 canonical endpoint route 可被正式 capability 原样复验', async () => {
    const prepared = await prepareStart(
      await worldSelection(`G5-04 canonical route ${crypto.randomUUID()}`),
      'canonical-route',
    )
    const binding = prepared.preview.start.preflight.providerBinding

    await expect(resolveConfiguredTextCapabilityV1({
      projectId: prepared.preview.scope.projectId,
      category: 'product-production',
      requirementKey: 'text.runtime-package',
      expectedProviderIdentity: {
        provider: binding.provider,
        model: binding.model,
        endpointOrigin: binding.endpointOrigin,
        endpointRouteHash: binding.endpointRouteHash,
        temperature: binding.temperature,
        configuredMaxTokens: binding.maxTokens,
        contextWindow: binding.contextWindow,
      },
    })).resolves.toMatchObject({
      receipt: {
        provider: binding.provider,
        model: binding.model,
        endpointOrigin: binding.endpointOrigin,
      },
    })
  }, 30_000)

  it('正式运行将最终 capability receipt 与 Creator 快照比对，关闭验证后的配置竞态窗口', async () => {
    const selection = await worldSelection(`G5-04 runtime TOCTOU ${crypto.randomUUID()}`)
    const prepared = await prepareStart(selection, 'runtime-toc')
    await authorizeTextOpenWorldCreatorProductionStartV1({
      ...prepared.input,
      expectedPlanHash: prepared.preview.start.productionPlanHash,
    })
    const stableState = useAIConfigStore.getState()
    const changedState = {
      ...stableState,
      config: { ...stableState.config, model: 'deepseek-reasoner' },
    }
    let stateReads = 0
    const getState = vi.spyOn(useAIConfigStore, 'getState')
      .mockImplementation(() => ++stateReads <= 2 ? stableState : changedState)
    const fetchProvider = vi.spyOn(globalThis, 'fetch')
    const beforeRun = await productionMutationSnapshot()

    try {
      await expect(runAuthorizedProductProductionV1({
        scope: prepared.preview.scope,
        productionId: prepared.preview.production.id,
      })).rejects.toThrow(/Creator 授权快照不一致/)
      expect(stateReads).toBeGreaterThanOrEqual(3)
      expect(fetchProvider).not.toHaveBeenCalled()
      expect(await productionMutationSnapshot()).toEqual(beforeRun)
    } finally {
      fetchProvider.mockRestore()
      getState.mockRestore()
    }
  }, 30_000)

  it('相同作者启动命令在来源与模型随后不可解析时仍只重放冻结 receipt', async () => {
    const seeded = await novelSelection(`G5-04 replay ${crypto.randomUUID()}`)
    const prepared = await prepareStart(seeded.selection, 'replay')
    const command = {
      ...prepared.input,
      expectedPlanHash: prepared.preview.start.productionPlanHash,
    }
    const first = await authorizeTextOpenWorldCreatorProductionStartV1(command)
    expect(first).toMatchObject({ ok: true, replayed: false })

    await db.chapters.update(seeded.novel.chapterId, {
      content: '<p>首次授权后来源已经变化，但相同命令只能读取既有 receipt。</p>',
      updatedAt: Date.now(),
    })
    useAIConfigStore.setState({
      config: { ...AI_CONFIG, apiKey: '', model: '', baseUrl: '' },
      rememberApiKey: false,
    })
    const beforeReplay = await productionMutationSnapshot()
    const replay = await authorizeTextOpenWorldCreatorProductionStartV1(command)
    expect(replay).toEqual({ ...first, replayed: true })
    expect(await productionMutationSnapshot()).toEqual(beforeReplay)
    expect(await db.productBuilds.where('productionId').equals(prepared.input.productionId).count()).toBe(1)
  }, 30_000)
})
