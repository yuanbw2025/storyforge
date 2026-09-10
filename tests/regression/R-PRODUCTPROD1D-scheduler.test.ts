import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import { appendAgentRunEventV1, readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readContextGatewayManifestV3ForAttemptV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { openWorldSemanticResourceCatalogV1 } from '../../src/lib/context-gateway/world-release-client'
import { recordAgentRunArtifactV1 } from '../../src/lib/memory/artifact-store'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import {
  assertProductProductionBudgetLedgerV1,
  projectProductProductionSchedulerV1,
  runProductProductionSchedulerCycleV1,
  runProductProductionUntilBlockedV1,
  ProductProductionDraftRejectedErrorV1,
  ProductProductionResultUnknownErrorV1,
  type ProductProductionTaskExecutionResultV1,
  type ProductProductionTaskExecutorV1,
} from '../../src/lib/product-production/scheduler'
import type { ProductBuildArtifactKindV1, ProductRuntimePackageV1 } from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { resolveProductProductionWorldCompilationDescriptorsV2 } from '../../src/lib/product-production/world-source'
import { AIError } from '../../src/lib/types'
import { AICompletionResponseErrorV1 } from '../../src/lib/ai/completion-response'
import {
  beginProductProductionEvolutionV1,
  readProductProductionTaskEvidenceV1,
  setProductProductionPausedV1,
} from '../../src/lib/product-production/service'
import { readProductProductionRepairFeedback } from '../../src/lib/product-production/context'
import { createTextOpenWorldSourceLockExecutorV1 } from '../../src/lib/open-world/production-executor'
import { createTextOpenWorldSourceCurationExecutorV1 } from '../../src/lib/open-world/source-curation'
import { seedAuthorizedTextOpenWorldCreatorBuildV1 } from '../helpers/text-open-world-creator-build'
import { putMediaBlobObject } from '../../src/lib/product-production/media-blob-store'
import { installFakeOpfsV1 } from '../helpers/fake-opfs'
import {
  prepareProductProductionAdoption,
  publishProductProductionBuild,
} from '../../src/lib/product-production/adoption'
import {
  verifyProductBuildTerminalArtifactSetV1,
} from '../../src/lib/product-production/artifact-store'

async function fixture(name: string, extraFacts: string[] = []) {
  const owned = await seedCurrentProductWorld(name)
  const release = owned.release
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: release.id! })
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope, worldReleaseId: release.id!, suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType: 'avg', scale: 'scene', visualLevel: 'none', audioLevel: 'none',
    requiredFacts: ['冻结世界事实保持一致', ...extraFacts], forbiddenChanges: ['不得写回世界正式表'],
  })
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent', commandId: `${name}.intent`, productionKey: `${name}.production`,
      productType: 'avg', worldReleaseId: release.id!, userText: `${name} 自动生产`,
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: `${name}.brief`, expectedStateRevision: 0,
      parentRevision: null, brief,
    },
  })
  await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: `${name}.start`, expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: `${name}.click`,
    },
  })
  return { ...owned, productionId: created.productionId, brief }
}

function packageFor(brief: Awaited<ReturnType<typeof fixture>>['brief'], productionKey: string): ProductRuntimePackageV1 {
  return {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'avg',
    definition: {
      productKey: productionKey, title: '耐久调度游戏', description: '自动生产测试',
      enabledCapabilities: ['narrative', 'presentation'], rulesetVersion: 1, initialVariables: {},
    },
    sourceWorld: { contentHash: brief.source.worldContentHash, selection: brief.source.selection },
    narrative: {
      moduleKind: 'main', moduleTitle: '耐久调度故事', entryNodeKey: 'opening',
      nodes: [
        { key: 'opening', title: '开场', summary: '从这里开始', kind: 'entry', conditionJson: '{}', effectsJson: '[]', successorKeys: ['ending'] },
        { key: 'ending', title: '结束', summary: '完成', kind: 'ending', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
      ],
      beats: [
        { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '故事开始。', order: 0 },
        { beatKey: 'beat.ending', nodeKey: 'ending', kind: 'narration', speakerKey: null, text: '故事结束。', order: 0 },
      ],
      choices: [{
        choiceKey: 'choice.continue', sourceNodeKey: 'opening', targetNodeKey: 'ending',
        text: '继续', description: '走向结局', unavailableReason: '',
        displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0,
      }],
    },
    presentation: { version: 1, cues: [], assets: [] },
  }
}

function executorFor(
  input: Awaited<ReturnType<typeof fixture>>,
  calls: Map<string, number>,
  concurrency: { active: number; peak: number; proveSiblingOverlap?: boolean; overlapWaiters?: Array<() => void> },
): ProductProductionTaskExecutorV1 {
  return async request => {
    calls.set(request.task.taskKey, (calls.get(request.task.taskKey) ?? 0) + 1)
    concurrency.active++
    concurrency.peak = Math.max(concurrency.peak, concurrency.active)
    // These two sibling tasks must be selected in the same scheduler cycle.
    // A deterministic barrier proves actual overlap without depending on real
    // timers, which unrelated full-suite fake-timer cases can starve.
    if (concurrency.proveSiblingOverlap
      && (request.task.taskKey === 'content.narrative' || request.task.taskKey === 'media.requirements')) {
      await new Promise<void>(resolve => {
        const waiters = concurrency.overlapWaiters ??= []
        waiters.push(resolve)
        if (waiters.length === 2) {
          concurrency.overlapWaiters = []
          waiters.forEach(release => release())
        }
      })
    }
    let payload: unknown = { taskKey: request.task.taskKey, inputs: request.inputArtifacts.map(row => row.contentHash) }
    if (request.task.taskKey === 'integration.package') {
      payload = packageFor(input.brief, `${input.productionId}.scheduler`)
    } else if (request.task.taskKey === 'qa.release') {
      const packageHash = request.inputArtifacts.find(row => row.artifactKey === 'runtime.package')!.contentHash
      payload = {
        schema: 'storyforge.product-build-quality-report', version: 1,
        buildNumber: request.buildNumber, packageHash,
        hardGateResults: input.brief.completionContract.requiredGateIds.map(gateId => ({
          gateId, passed: true, evidence: [`task:${request.task.taskKey}`],
        })),
        softGateResults: [], mediaCoverage: 1, playable: true, releaseReady: true, warnings: [],
      }
    }
    const kindByTask: Record<string, ProductBuildArtifactKindV1> = {
      'content.design': 'product-design', 'content.narrative': 'narrative',
      'content.product-module': 'product-module', 'media.requirements': 'asset-manifest',
      'integration.package': 'presentation', 'qa.release': 'quality-report',
    }
    const result: ProductProductionTaskExecutionResultV1 = {
      artifacts: [{
        artifactKey: request.task.outputArtifactKeys[0], kind: kindByTask[request.task.taskKey],
        payload, rights: { origin: 'test-executor', commercialUse: true, license: 'test' },
      }],
      passedGateIds: [...request.task.acceptanceGateIds],
      usage: {
        modelCalls: request.task.executionMode === 'model' ? 1 : 0,
        inputTokens: request.task.executionMode === 'model' ? 10 : 0,
        outputTokens: request.task.executionMode === 'model' ? 10 : 0,
        mediaCalls: 0, costUsd: 0, durationMs: 1, storageBytes: 0,
      },
    }
    concurrency.active--
    return result
  }
}

async function singleTaskBudgetPlan(
  owned: Awaited<ReturnType<typeof fixture>>,
  controlEpoch: number,
  modelCalls = owned.brief.productionBudget.maximumModelCalls,
) {
  const briefRow = await db.productProductionBriefs
    .where('[productionId+revision]').equals([owned.productionId, 1]).first()
  const base = await createProductProductionPlanV3({
    buildNumber: 1,
    controlEpoch,
    briefHash: briefRow!.briefHash,
    brief: owned.brief,
  })
  const task = base.tasks.find(item => item.taskKey === 'content.design')!
  return {
    ...base,
    tasks: [{
      ...task,
      maxAttempts: 2,
      budgetReservation: {
        ...task.budgetReservation,
        modelCalls,
      },
    }],
    terminalTaskKey: task.taskKey,
  }
}

async function singleMediaTaskBudgetPlan(
  owned: Awaited<ReturnType<typeof fixture>>,
  controlEpoch: number,
) {
  const base = await singleTaskBudgetPlan(owned, controlEpoch, 0)
  const source = base.tasks[0]
  const task = {
    ...source,
    taskKey: 'media.visual',
    lane: 'visual' as const,
    kind: 'media-generation',
    skillId: null,
    executionMode: 'media-provider' as const,
    concurrencyGroup: 'media-provider',
    outputArtifactKeys: ['media.visual.test'],
    subjectLockKeys: ['media.visual.test'],
    acceptanceGateIds: ['media.visual.test.accepted'],
    budgetReservation: {
      ...source.budgetReservation,
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      mediaCalls: 1,
    },
  }
  return { ...base, tasks: [task], terminalTaskKey: task.taskKey }
}

function creatorLocalMediaBindings(plan: {
  tasks: Array<{ taskKey: string; capabilityRequirementKeys: string[] }>
}) {
  return plan.tasks
    .filter(task => task.taskKey === 'media.visual' || task.taskKey === 'media.audio')
    .flatMap(task => task.capabilityRequirementKeys.map(requirementKey => ({
      requirementKey,
      adapterId: task.taskKey === 'media.visual'
        ? 'storyforge.procedural-svg.v1'
        : 'storyforge.procedural-audio.v1',
      bindingHash: 'a'.repeat(64),
    })))
}

describe('R-PRODUCTPROD-1D · durable bounded DAG scheduler', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  beforeEach(async () => {
    // Repeated versionchange/delete cycles can leave fake-indexeddb waiting on
    // an old Dexie connection under the full coverage run. These tests only
    // require row isolation, so clear the already-open schema atomically.
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map(table => table.clear()))
    })
  })
  afterEach(() => vi.restoreAllMocks())
  afterAll(() => db.close())

  it('结构校验失败前保留模型原文证据，失败候选不成为正式产物', async () => {
    const owned = await fixture('scheduler-rejected-output')
    const raw = '{"scene":"未完成的候选"'
    let calls = 0
    const result = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: async request => {
        calls++
        await request.onModelOutput?.(raw)
        throw new ProductProductionDraftRejectedErrorV1('JSON 不完整', {
          modelCalls: 1, inputTokens: 100, outputTokens: 10, mediaCalls: 0,
          costUsd: null, durationMs: 100, storageBytes: 0,
        })
      },
      capabilityBindings: [{ requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: 'a'.repeat(64) }],
    })
    expect(result.tasks.find(item => item.taskKey === 'content.design')?.status).toBe('blocked')
    expect((await db.agentRunArtifacts.toArray()).some(item => item.artifactKind === 'raw-response' && item.content === raw)).toBe(true)
    expect(await db.productBuildArtifacts.count()).toBe(0)
    expect(calls).toBe(1)
    expect(result.budget.usage.modelCalls).toBe(1)
    expect(result.budget.usage.costUsd).toBeNull()
    const evidence = await readProductProductionTaskEvidenceV1({
      scope: owned.scope, productionId: owned.productionId, taskKey: 'content.design',
    })
    expect(evidence.some(item => item.kind === 'raw-response' && item.content === raw)).toBe(true)
    expect(evidence.some(item => item.kind === 'tool-result' && item.content.includes('JSON 不完整'))).toBe(true)
    const repair = JSON.parse(await readProductProductionRepairFeedback({
      projectId: owned.scope.projectId, scope: owned.scope, productProductionId: owned.productionId,
      productBuildId: result.buildId, productProductionTaskKey: 'content.design',
    }))
    expect(repair.previous.evidence.some((item: { content: string }) => item.content === raw)).toBe(true)
    const other = await fixture('scheduler-other-owner')
    await expect(readProductProductionTaskEvidenceV1({
      scope: other.scope, productionId: owned.productionId, taskKey: 'content.design',
    })).rejects.toThrow()
  })

  it('修复上下文精确绑定触发blocker的Run/epoch/attempt，且不递归回灌source-snapshot', async () => {
    const owned = await fixture('scheduler-repair-evidence-lineage')
    const suppliedPlan = await singleTaskBudgetPlan(owned, 0, 1)
    const raw = '{"draft":"current rejected response"}'
    const deliveredRepairPacket = '{"schema":"prior-repair-packet","mustNotReenter":true}'
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings: [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }],
      executor: async request => {
        await request.onModelOutput?.(raw)
        const snapshot = await readAgentRunV1(owned.scope, request.taskRunId!)
        await recordAgentRunArtifactV1({
          scope: owned.scope,
          runId: snapshot.run.id,
          stepId: request.task.taskKey,
          attempt: request.attempt,
          artifactKind: 'source-snapshot',
          content: deliveredRepairPacket,
          expectedLastSequence: snapshot.projection.lastSequence,
        })
        throw new ProductProductionDraftRejectedErrorV1('当前候选未通过', {
          modelCalls: 1, inputTokens: 80, outputTokens: 10, mediaCalls: 0,
          costUsd: 0.01, durationMs: 20, storageBytes: 0,
        })
      },
    })
    expect(projection.buildStatus).toBe('recovery-required')
    const blocked = (await db.productBuilds.get(projection.buildId))!
    const originalFailure = JSON.parse(blocked.failureJson)
    expect(originalFailure.failureProvenance).toMatchObject({
      rootRunId: projection.rootRunId,
      controlEpoch: 0,
      planHash: projection.planHash,
      attempt: 1,
    })

    const production = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'resolve-blocker',
        commandId: 'scheduler-repair-evidence-lineage.resolve',
        expectedStateRevision: production.stateRevision,
        blockerKey: 'content.design',
        resolution: { action: 'retry', note: '只修正当前候选' },
      },
    })
    const resolvedBuild = (await db.productBuilds.get(projection.buildId))!
    const resolvedFailure = JSON.parse(resolvedBuild.failureJson)
    expect(resolvedFailure.previousFailure.failureProvenance).toEqual(originalFailure.failureProvenance)
    const repair = JSON.parse(await readProductProductionRepairFeedback({
      projectId: owned.scope.projectId,
      scope: owned.scope,
      productProductionId: owned.productionId,
      productBuildId: projection.buildId,
      productProductionTaskKey: 'content.design',
    }))
    expect(repair.previous).toMatchObject({
      runId: originalFailure.failureProvenance.runId,
      controlEpoch: 0,
      attempt: 1,
    })
    expect(repair.previous.evidence.some((item: { kind: string; content: string }) => (
      item.kind === 'raw-response' && item.content === raw
    ))).toBe(true)
    expect(repair.previous.evidence.some((item: { kind: string; content: string }) => (
      item.kind === 'source-snapshot' || item.content.includes('mustNotReenter')
    ))).toBe(false)

    const pristineResolvedFailure = structuredClone(resolvedFailure)
    const corruptions: Array<[string, (value: typeof resolvedFailure) => void]> = [
      ['runId', value => { value.previousFailure.failureProvenance.runId += 999_999 }],
      ['controlEpoch', value => { value.previousFailure.failureProvenance.controlEpoch += 1 }],
      ['planHash', value => { value.previousFailure.failureProvenance.planHash = 'b'.repeat(64) }],
      ['attempt', value => { value.previousFailure.failureProvenance.attempt += 1 }],
    ]
    for (const [label, corrupt] of corruptions) {
      const corrupted = structuredClone(pristineResolvedFailure)
      corrupt(corrupted)
      await db.productBuilds.update(projection.buildId, { failureJson: JSON.stringify(corrupted) })
      await expect(readProductProductionRepairFeedback({
        projectId: owned.scope.projectId,
        scope: owned.scope,
        productProductionId: owned.productionId,
        productBuildId: projection.buildId,
        productProductionTaskKey: 'content.design',
      }), label).rejects.toThrow(/谱系无效|Run 不存在|越过 Build\/task|Run\/epoch\/attempt 不一致/)
    }
    await db.productBuilds.update(projection.buildId, {
      failureJson: JSON.stringify(pristineResolvedFailure),
    })
  })

  it('author-edit 执行边界拒绝同 task 的旧失败 Run，且不会调用 executor', async () => {
    const owned = await fixture('scheduler-author-edit-old-run')
    const binding = [{
      requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: 'a'.repeat(64),
    }]
    const rejectDraft = async () => {
      throw new ProductProductionDraftRejectedErrorV1('候选需要作者修订', {
        modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0,
        costUsd: 0, durationMs: 0, storageBytes: 0,
      })
    }
    const first = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: await singleTaskBudgetPlan(owned, 0, 1),
      capabilityBindings: binding,
      executor: rejectDraft,
    })
    const firstFailure = JSON.parse((await db.productBuilds.get(first.buildId))!.failureJson)
    let production = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'resolve-blocker',
        commandId: 'scheduler-author-edit-old-run.retry',
        expectedStateRevision: production.stateRevision,
        blockerKey: 'content.design',
        resolution: { action: 'retry', note: '生成第二个同 task 失败 Run' },
      },
    })
    const second = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: await singleTaskBudgetPlan(owned, 1, 1),
      capabilityBindings: binding,
      executor: rejectDraft,
    })
    production = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'resolve-blocker',
        commandId: 'scheduler-author-edit-old-run.author-edit',
        expectedStateRevision: production.stateRevision,
        blockerKey: 'content.design',
        resolution: { action: 'author-edit', note: '采用作者稿', authorDraftJson: '{"fixed":true}' },
      },
    })
    const resolvedBuild = (await db.productBuilds.get(second.buildId))!
    const resolvedFailure = JSON.parse(resolvedBuild.failureJson)
    resolvedFailure.previousFailure.failureProvenance = firstFailure.failureProvenance
    await db.productBuilds.update(second.buildId, { failureJson: JSON.stringify(resolvedFailure) })

    let executorCalls = 0
    const blocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: await singleTaskBudgetPlan(owned, 2, 1),
      capabilityBindings: binding,
      executor: async () => {
        executorCalls += 1
        throw new Error('旧失败 Run 不得到达 executor')
      },
    })
    expect(executorCalls).toBe(0)
    expect(blocked.buildStatus).toBe('recovery-required')
    expect((await db.productBuilds.get(blocked.buildId))!.failureJson)
      .toContain('task-recovery-provenance-invalid')
  })

  it('legacy author-edit 即使直接写入 resolved directive 也在执行边界 fail-closed', async () => {
    const owned = await fixture('scheduler-legacy-author-edit-boundary')
    const production = (await db.productProductions.get(owned.productionId))!
    const build = (await db.productBuilds.where('productionId').equals(owned.productionId).first())!
    const suppliedPlan = await singleTaskBudgetPlan(owned, 1, 1)
    const planHash = await hashProductProductionValueV2(suppliedPlan)
    await db.productBuilds.update(build.id!, {
      status: 'building',
      controlEpoch: 1,
      planJson: JSON.stringify(suppliedPlan),
      planHash,
      failureJson: JSON.stringify({
        blockerKey: 'content.design',
        resolution: { action: 'author-edit', note: 'legacy', authorDraftJson: '{"legacy":true}' },
        previousFailure: { taskKey: 'content.design', code: 'task-draft-rejected', failureProvenance: null },
      }),
    })
    await db.productProductions.update(owned.productionId, {
      status: 'producing', controlEpoch: 1, stateRevision: production.stateRevision + 1,
    })
    let executorCalls = 0
    const blocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings: [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }],
      executor: async () => {
        executorCalls += 1
        throw new Error('legacy 作者稿不得到达 executor')
      },
    })
    expect(executorCalls).toBe(0)
    expect(blocked.buildStatus).toBe('recovery-required')
    expect((await db.productBuilds.get(blocked.buildId))!.failureJson)
      .toContain('task-recovery-provenance-invalid')
  })

  it('legacy 无 provenance 仍可执行普通 retry，并由新失败建立现代谱系', async () => {
    const owned = await fixture('scheduler-legacy-retry-compatibility')
    const production = (await db.productProductions.get(owned.productionId))!
    const build = (await db.productBuilds.where('productionId').equals(owned.productionId).first())!
    const suppliedPlan = await singleTaskBudgetPlan(owned, 1, 1)
    await db.productBuilds.update(build.id!, {
      status: 'building',
      controlEpoch: 1,
      planJson: JSON.stringify(suppliedPlan),
      planHash: await hashProductProductionValueV2(suppliedPlan),
      failureJson: JSON.stringify({
        blockerKey: 'content.design',
        resolution: { action: 'retry', note: '兼容旧 blocker 的普通重试' },
        previousFailure: { taskKey: 'content.design', code: 'task-executor-failed', failureProvenance: null },
      }),
    })
    await db.productProductions.update(owned.productionId, {
      status: 'producing', controlEpoch: 1, stateRevision: production.stateRevision + 1,
    })
    let executorCalls = 0
    const blocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings: [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }],
      executor: async () => {
        executorCalls += 1
        throw new ProductProductionDraftRejectedErrorV1('新候选仍需修订', {
          modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0,
          costUsd: 0, durationMs: 0, storageBytes: 0,
        })
      },
    })
    expect(executorCalls).toBe(1)
    expect(blocked.buildStatus).toBe('recovery-required')
    expect(JSON.parse((await db.productBuilds.get(blocked.buildId))!.failureJson)).toMatchObject({
      taskKey: 'content.design',
      code: 'task-draft-rejected',
      failureProvenance: { controlEpoch: 1, planHash: blocked.planHash, attempt: 1 },
    })
  })

  it('executor返回后即使调度器合同校验失败也累计真实usage，且下一次自动重试在Brief预算前阻断', async () => {
    const owned = await fixture('scheduler-returned-invalid-usage')
    const suppliedPlan = await singleTaskBudgetPlan(owned, 0, 1)
    let calls = 0
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings: [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }],
      executor: async request => {
        calls += 1
        return {
          artifacts: null,
          passedGateIds: [...request.task.acceptanceGateIds],
          usage: {
            modelCalls: 1, inputTokens: 100, outputTokens: 20, mediaCalls: 0,
            costUsd: 0.01, durationMs: 25, storageBytes: 0,
          },
        } as unknown as ProductProductionTaskExecutionResultV1
      },
    })
    expect(calls).toBe(1)
    expect(projection.buildStatus).toBe('recovery-required')
    expect(projection.budget.usage).toMatchObject({
      modelCalls: 1, inputTokens: 100, outputTokens: 20, costUsd: 0.01,
    })
    const build = (await db.productBuilds.get(projection.buildId))!
    expect(build.failureJson).toContain('brief-production-budget-exhausted')
    const ledger = JSON.parse(build.budgetLedgerJson)
    expect(ledger.version).toBe(2)
    expect(Object.values(ledger.charges)).toHaveLength(1)
    expect(Object.values(ledger.reservations)).toHaveLength(0)
    const taskRun = await readAgentRunV1(owned.scope, ledger.tasks['content.design'].runId)
    expect(taskRun.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
  })

  it('media provider 已耗尽任务调用预留时在第二次attempt进入executor前阻断', async () => {
    const owned = await fixture('scheduler-media-depleted-before-retry')
    const suppliedPlan = await singleMediaTaskBudgetPlan(owned, 0)
    let calls = 0
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings: [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }],
      executor: async request => {
        calls += 1
        return {
          artifacts: null,
          passedGateIds: [...request.task.acceptanceGateIds],
          usage: {
            modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 1,
            costUsd: 0.02, durationMs: 25, storageBytes: 0,
          },
        } as unknown as ProductProductionTaskExecutionResultV1
      },
    })
    expect(calls).toBe(1)
    expect(projection.buildStatus).toBe('recovery-required')
    expect(projection.budget.usage).toMatchObject({ mediaCalls: 1, costUsd: 0.02 })
    const build = (await db.productBuilds.get(projection.buildId))!
    expect(build.failureJson).toContain('task-media-calls-depleted')
    const ledger = JSON.parse(build.budgetLedgerJson)
    expect(Object.values(ledger.charges)).toHaveLength(1)
    expect(Object.values(ledger.reservations)).toHaveLength(0)
    const taskRun = await readAgentRunV1(owned.scope, ledger.tasks['media.visual'].runId)
    expect(taskRun.events.filter(event => (
      event.type === 'tool.called' && event.payload.toolName === 'game-media-provider'
    ))).toHaveLength(1)
  })

  it('同一task的多次自动重试按run/attempt分开计费，最新task状态不覆盖历史usage', async () => {
    const owned = await fixture('scheduler-attempt-cumulative-usage')
    const suppliedPlan = await singleTaskBudgetPlan(owned, 0, 2)
    let calls = 0
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings: [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }],
      executor: async request => {
        calls += 1
        return {
          artifacts: null,
          passedGateIds: [...request.task.acceptanceGateIds],
          usage: {
            modelCalls: 1, inputTokens: 30, outputTokens: 12, mediaCalls: 0,
            costUsd: 0.01, durationMs: 10, storageBytes: 0,
          },
        } as unknown as ProductProductionTaskExecutionResultV1
      },
    })
    expect(calls).toBe(2)
    expect(projection.buildStatus).toBe('recovery-required')
    expect(projection.budget.usage).toMatchObject({
      modelCalls: 2, inputTokens: 60, outputTokens: 24, costUsd: 0.02,
    })
    const ledger = JSON.parse((await db.productBuilds.get(projection.buildId))!.budgetLedgerJson)
    const charges = Object.values(ledger.charges as Record<string, { attempt: number }>)
    expect(charges).toHaveLength(2)
    expect(new Set(charges.map(charge => charge.attempt))).toEqual(new Set([1, 2]))
  })

  it('作者多次resolve-blocker后仍按taskKey跨epoch累计调用与token用量', async () => {
    const owned = await fixture('scheduler-cross-epoch-budget')
    const firstPlan = await singleTaskBudgetPlan(owned, 0, 2)
    let calls = 0
    const attemptReservations: unknown[] = []
    const first = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: firstPlan,
      capabilityBindings: [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }],
      executor: async request => {
        calls += 1
        attemptReservations.push(request.attemptBudgetReservation)
        throw new ProductProductionDraftRejectedErrorV1('候选需要作者修复', {
          modelCalls: 1, inputTokens: 80, outputTokens: 10, mediaCalls: 0,
          costUsd: 0.02, durationMs: 20, storageBytes: 0,
        })
      },
    })
    expect(first.buildStatus).toBe('recovery-required')
    expect(first.budget.usage.modelCalls).toBe(1)
    expect(attemptReservations).toEqual([firstPlan.tasks[0].budgetReservation])

    const production = (await db.productProductions.get(owned.productionId))!
    const resolved = await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'resolve-blocker',
        commandId: 'scheduler-cross-epoch-budget.resolve',
        expectedStateRevision: production.stateRevision,
        blockerKey: 'content.design',
        resolution: { action: 'retry', note: '作者确认重试' },
      },
    })
    expect(resolved).toMatchObject({ ok: true, result: { controlEpoch: 1 } })
    const secondPlan = await singleTaskBudgetPlan(owned, 1, 2)
    const second = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: secondPlan,
      capabilityBindings: [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }],
      executor: async request => {
        calls += 1
        attemptReservations.push(request.attemptBudgetReservation)
        throw new ProductProductionDraftRejectedErrorV1('第二个候选仍需作者修复', {
          modelCalls: 1, inputTokens: 30, outputTokens: 5, mediaCalls: 0,
          costUsd: 0.01, durationMs: 10, storageBytes: 0,
        })
      },
    })
    expect(calls).toBe(2)
    expect(second.buildStatus).toBe('recovery-required')
    expect(second.controlEpoch).toBe(1)
    expect(attemptReservations[1]).toEqual({
      ...secondPlan.tasks[0].budgetReservation,
      modelCalls: 1,
      inputTokens: secondPlan.tasks[0].budgetReservation.inputTokens - 80,
      outputTokens: secondPlan.tasks[0].budgetReservation.outputTokens - 10,
      maximumCostUsd: secondPlan.tasks[0].budgetReservation.maximumCostUsd == null
        ? null
        : secondPlan.tasks[0].budgetReservation.maximumCostUsd - 0.02,
      durationMs: secondPlan.tasks[0].budgetReservation.durationMs - 20,
    })
    expect(second.budget.usage).toMatchObject({
      modelCalls: 2, inputTokens: 110, outputTokens: 15, costUsd: 0.03, durationMs: 30,
    })

    const productionAfterSecond = (await db.productProductions.get(owned.productionId))!
    const resolvedAgain = await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'resolve-blocker',
        commandId: 'scheduler-cross-epoch-budget.resolve-again',
        expectedStateRevision: productionAfterSecond.stateRevision,
        blockerKey: 'content.design',
        resolution: { action: 'retry', note: '作者再次确认重试' },
      },
    })
    expect(resolvedAgain).toMatchObject({ ok: true, result: { controlEpoch: 2 } })
    const thirdPlan = await singleTaskBudgetPlan(owned, 2, 2)
    const third = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: thirdPlan,
      capabilityBindings: [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }],
      executor: async () => {
        calls += 1
        throw new Error('跨 epoch 的 task 预算耗尽后不得调用 executor')
      },
    })
    expect(calls).toBe(2)
    expect(third.buildStatus).toBe('recovery-required')
    expect(third.controlEpoch).toBe(2)
    expect(third.budget.usage).toMatchObject({
      modelCalls: 2, inputTokens: 110, outputTokens: 15, costUsd: 0.03, durationMs: 30,
    })
    const ledger = JSON.parse((await db.productBuilds.get(third.buildId))!.budgetLedgerJson)
    expect(Object.values(ledger.charges)).toHaveLength(2)
    expect(ledger.tasks['content.design']).toMatchObject({ errorCode: 'brief-production-budget-exhausted' })
    expect(JSON.parse((await db.productBuilds.get(third.buildId))!.failureJson)).toMatchObject({
      violations: ['task-model-calls-depleted'],
    })
  })

  it('请求结果未知时保留预留；作者精确确认未计费后释放旧attempt并可重试至终态', async () => {
    const owned = await fixture('scheduler-unknown-result-reservation')
    expect(owned.brief.productionBudget.maximumModelCalls).toBeGreaterThan(4)
    const firstPlan = await singleTaskBudgetPlan(owned, 0, 2)
    let calls = 0
    const capabilityBindings = [{
      requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: 'a'.repeat(64),
    }]
    const first = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: firstPlan,
      capabilityBindings,
      executor: async () => {
        calls += 1
        throw new ProductProductionResultUnknownErrorV1()
      },
    })
    expect(calls).toBe(1)
    expect(first.buildStatus).toBe('recovery-required')
    const blockedBuild = (await db.productBuilds.get(first.buildId))!
    const failure = JSON.parse(blockedBuild.failureJson)
    expect(failure).toMatchObject({
      taskKey: 'content.design',
      code: 'unknown-result',
      resultStatus: 'unknown',
      reservationDisposition: 'retained',
      automaticRetryAllowed: false,
      failureProvenance: {
        rootRunId: first.rootRunId,
        controlEpoch: 0,
        planHash: first.planHash,
        attempt: 1,
      },
    })
    expect(failure.failureProvenance.runId).toBeGreaterThan(0)
    const blockedLedger = JSON.parse(blockedBuild.budgetLedgerJson)
    expect(Object.values(blockedLedger.charges)).toHaveLength(0)
    expect(Object.values(blockedLedger.reservations)).toHaveLength(1)
    expect(Object.values(blockedLedger.reservations)[0]).toMatchObject({
      controlEpoch: 0,
      taskKey: 'content.design',
      budget: { modelCalls: 2 },
    })
    const evidence = await readProductProductionTaskEvidenceV1({
      scope: owned.scope,
      productionId: owned.productionId,
      taskKey: 'content.design',
    })
    expect(evidence.some(item => item.kind === 'tool-result'
      && item.content.includes('"resultStatus":"unknown"')
      && item.content.includes('"reservationDisposition":"retained"'))).toBe(true)

    const production = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'resolve-blocker',
        commandId: 'scheduler-unknown-result-reservation.resolve',
        expectedStateRevision: production.stateRevision,
        blockerKey: 'content.design',
        resolution: {
          action: 'retry',
          note: '作者已核对供应商后台，显式确认本次未计费并重试',
          unknownResultReservation: {
            runId: failure.failureProvenance.runId,
            attempt: failure.failureProvenance.attempt,
            controlEpoch: failure.failureProvenance.controlEpoch,
            disposition: 'confirmed-not-charged',
          },
        },
      },
    })
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([owned.productionId, 1]).first()
    const secondPlan = await createProductProductionPlanV3({
      buildNumber: 1,
      controlEpoch: 1,
      briefHash: briefRow!.briefHash,
      brief: owned.brief,
    })
    const successfulCalls = new Map<string, number>()
    const second = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: secondPlan,
      capabilityBindings,
      executor: executorFor(owned, successfulCalls, { active: 0, peak: 0 }),
    })
    expect(calls).toBe(1)
    expect(successfulCalls.get('content.design')).toBe(1)
    expect(second.buildStatus).toBe('release-ready')
    expect(second.controlEpoch).toBe(1)
    const secondBuild = (await db.productBuilds.get(second.buildId))!
    const secondLedger = JSON.parse(secondBuild.budgetLedgerJson)
    expect(Object.values(secondLedger.reservations)).toHaveLength(0)
    expect(Object.values(secondLedger.charges).length).toBeGreaterThan(0)
    expect(secondLedger.charges[`${failure.failureProvenance.runId}:${failure.failureProvenance.attempt}`])
      .toMatchObject({
        resolution: 'author-confirmed-not-charged',
        usage: {
          modelCalls: 0, inputTokens: 0, outputTokens: 0,
          mediaCalls: 0, costUsd: 0, durationMs: 0, storageBytes: 0,
        },
      })
  })

  it('unknown-result 选择按预留上限记账时原子转为 charge，且拒绝错 attempt 处置', async () => {
    const owned = await fixture('scheduler-unknown-result-upper-bound')
    const firstPlan = await singleTaskBudgetPlan(owned, 0, 2)
    const capabilityBindings = [{
      requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: 'a'.repeat(64),
    }]
    const first = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: firstPlan,
      capabilityBindings,
      executor: async () => { throw new ProductProductionResultUnknownErrorV1() },
    })
    const blocked = (await db.productBuilds.get(first.buildId))!
    const failure = JSON.parse(blocked.failureJson)
    const production = (await db.productProductions.get(owned.productionId))!
    const wrong = await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'resolve-blocker',
        commandId: 'scheduler-unknown-result-upper-bound.wrong-attempt',
        expectedStateRevision: production.stateRevision,
        blockerKey: 'content.design',
        resolution: {
          action: 'retry',
          note: '错误 attempt 不得释放预留',
          unknownResultReservation: {
            runId: failure.failureProvenance.runId,
            attempt: failure.failureProvenance.attempt + 1,
            controlEpoch: failure.failureProvenance.controlEpoch,
            disposition: 'charge-reservation-upper-bound',
          },
        },
      },
    })
    expect(wrong).toMatchObject({ ok: false, errorCode: 'invalid-state-transition' })
    expect(Object.values(JSON.parse((await db.productBuilds.get(first.buildId))!.budgetLedgerJson).reservations))
      .toHaveLength(1)

    const resolved = await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'resolve-blocker',
        commandId: 'scheduler-unknown-result-upper-bound.resolve',
        expectedStateRevision: production.stateRevision,
        blockerKey: 'content.design',
        resolution: {
          action: 'retry',
          note: '供应商后台无法确认，按完整预留上限记账',
          unknownResultReservation: {
            runId: failure.failureProvenance.runId,
            attempt: failure.failureProvenance.attempt,
            controlEpoch: failure.failureProvenance.controlEpoch,
            disposition: 'charge-reservation-upper-bound',
          },
        },
      },
    })
    expect(resolved).toMatchObject({ ok: true, result: { controlEpoch: 1 } })
    const ledger = JSON.parse((await db.productBuilds.get(first.buildId))!.budgetLedgerJson)
    const attemptKey = `${failure.failureProvenance.runId}:${failure.failureProvenance.attempt}`
    expect(Object.values(ledger.reservations)).toHaveLength(0)
    expect(ledger.charges[attemptKey]).toMatchObject({
      runId: failure.failureProvenance.runId,
      attempt: failure.failureProvenance.attempt,
      controlEpoch: failure.failureProvenance.controlEpoch,
      taskKey: 'content.design',
      resolution: 'author-charged-reservation-upper-bound',
      usage: {
        modelCalls: 2,
        inputTokens: firstPlan.tasks[0].budgetReservation.inputTokens,
        outputTokens: firstPlan.tasks[0].budgetReservation.outputTokens,
      },
    })
  })

  it.each(['before-resolution', 'after-resolution'] as const)(
    '真实并发迟到 provider 结果在作者处置 %s 返回时闭合记账、零旧候选并可完成新epoch',
    async order => {
      const owned = await fixture(`scheduler-unknown-result-late-${order}`)
      const firstPlan = await singleTaskBudgetPlan(owned, 0, 2)
      const task = firstPlan.tasks[0]
      const baseNow = 2_100_000_000_000
      vi.spyOn(Date, 'now').mockReturnValue(baseNow)
      const capabilityBindings = [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }]
      let releaseLate!: () => void
      const lateGate = new Promise<void>(resolve => { releaseLate = resolve })
      let markStarted!: () => void
      const started = new Promise<void>(resolve => { markStarted = resolve })
      const oldCalls = new Map<string, number>()
      const oldExecutor = executorFor(owned, oldCalls, { active: 0, peak: 0 })
      const lateRaw = JSON.stringify({ taskKey: task.taskKey, order, late: true })
      const firstCycle = runProductProductionSchedulerCycleV1({
        scope: owned.scope,
        productionId: owned.productionId,
        suppliedPlan: firstPlan,
        capabilityBindings,
        executor: async request => {
          markStarted()
          await lateGate
          const result = await oldExecutor(request)
          await request.onModelOutput?.(lateRaw)
          return result
        },
      })
      await started

      vi.mocked(Date.now).mockReturnValue(baseNow + task.timeoutMs + 1)
      const timedOut = await runProductProductionSchedulerCycleV1({
        scope: owned.scope,
        productionId: owned.productionId,
        suppliedPlan: firstPlan,
        capabilityBindings,
        executor: async () => { throw new Error('并发恢复不得重新派发旧 attempt') },
      })
      expect(timedOut.buildStatus).toBe('recovery-required')
      const blocked = (await db.productBuilds.get(timedOut.buildId))!
      const failure = JSON.parse(blocked.failureJson)
      const oldRunId = failure.failureProvenance.runId as number
      const resolveUnknown = async () => {
        const production = (await db.productProductions.get(owned.productionId))!
        const receipt = await executeProductProductionCommand({
          scope: owned.scope,
          productionId: owned.productionId,
          command: {
            type: 'resolve-blocker',
            commandId: `scheduler-unknown-result-late-${order}.resolve`,
            expectedStateRevision: production.stateRevision,
            blockerKey: task.taskKey,
            resolution: {
              action: 'retry',
              note: '作者核对后关闭旧 attempt；迟到回调不得重开候选',
              unknownResultReservation: {
                runId: oldRunId,
                attempt: failure.failureProvenance.attempt,
                controlEpoch: failure.failureProvenance.controlEpoch,
                disposition: 'confirmed-not-charged',
              },
            },
          },
        })
        expect(receipt).toMatchObject({ ok: true, result: { controlEpoch: 1 } })
        const expectedEffectiveDisposition = order === 'before-resolution'
          ? 'provider-actual-charge'
          : 'author-confirmed-not-charged'
        expect(receipt.result.unknownResultAccounting).toMatchObject({
          runId: oldRunId,
          attempt: failure.failureProvenance.attempt,
          controlEpoch: failure.failureProvenance.controlEpoch,
          requestedDisposition: 'confirmed-not-charged',
          effectiveDisposition: expectedEffectiveDisposition,
          usage: { modelCalls: order === 'before-resolution' ? 1 : 0 },
        })
        const resolvedFailure = JSON.parse((await db.productBuilds.get(timedOut.buildId))!.failureJson)
        expect(resolvedFailure.unknownResultAccounting).toEqual(receipt.result.unknownResultAccounting)
        expect(resolvedFailure.resolution.unknownResultAccounting).toEqual(receipt.result.unknownResultAccounting)
        expect(resolvedFailure.resolution.unknownResultReservation).toBeUndefined()
      }
      if (order === 'before-resolution') {
        releaseLate()
        await expect(firstCycle).resolves.toBeDefined()
        await resolveUnknown()
      } else {
        await resolveUnknown()
        releaseLate()
        await expect(firstCycle).resolves.toBeDefined()
      }
      const oldRunAfterLateCallback = await readAgentRunV1(owned.scope, oldRunId)
      expect(oldRunAfterLateCallback.events.some(event => (
        event.type === 'evidence.artifact.recorded'
        && event.payload.artifactKind === 'raw-response'
      ))).toBe(false)

      const briefRow = await db.productProductionBriefs
        .where('[productionId+revision]').equals([owned.productionId, 1]).first()
      const nextPlanBase = await createProductProductionPlanV3({
        buildNumber: 1,
        controlEpoch: 1,
        briefHash: briefRow!.briefHash,
        brief: owned.brief,
      })
      const nextPlan = {
        ...nextPlanBase,
        tasks: nextPlanBase.tasks.map(nextTask => nextTask.taskKey === task.taskKey
          ? {
              ...nextTask,
              budgetReservation: { ...nextTask.budgetReservation, modelCalls: 2 },
            }
          : nextTask),
      }
      const newCalls = new Map<string, number>()
      const completed = await runProductProductionUntilBlockedV1({
        scope: owned.scope,
        productionId: owned.productionId,
        suppliedPlan: nextPlan,
        capabilityBindings,
        executor: executorFor(owned, newCalls, { active: 0, peak: 0 }),
      })
      expect(completed.buildStatus, JSON.stringify({
        failure: JSON.parse((await db.productBuilds.get(completed.buildId))!.failureJson),
        budget: completed.budget,
        tasks: completed.tasks.map(item => ({ taskKey: item.taskKey, status: item.status, blocker: item.blocker })),
      }, null, 2)).toBe('release-ready')
      expect(oldCalls.get(task.taskKey)).toBe(1)
      expect(newCalls.get(task.taskKey)).toBe(1)
      const finalLedger = JSON.parse((await db.productBuilds.get(completed.buildId))!.budgetLedgerJson)
      expect(Object.values(finalLedger.reservations)).toHaveLength(0)
      const oldCharge = finalLedger.charges[`${oldRunId}:${failure.failureProvenance.attempt}`]
      expect(oldCharge).toMatchObject(order === 'before-resolution'
        ? { resolution: null, usage: { modelCalls: 1 } }
        : { resolution: 'author-confirmed-not-charged', usage: { modelCalls: 0 } })
      const oldAccepted = await db.productBuildArtifacts.where('buildId').equals(completed.buildId)
        .filter(row => row.producerRunId === oldRunId && row.status === 'accepted').count()
      expect(oldAccepted).toBe(0)
    },
    30_000,
  )

  it('raw-response 已持久化后再超时只允许按预留上限封账，迟到 return 不重开旧处置', async () => {
    const owned = await fixture('scheduler-response-evidence-before-timeout')
    const firstPlan = await singleTaskBudgetPlan(owned, 0, 2)
    const task = firstPlan.tasks[0]
    const baseNow = 2_110_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(baseNow)
    const capabilityBindings = [{
      requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: 'a'.repeat(64),
    }]
    const raw = JSON.stringify({ taskKey: task.taskKey, responseObserved: true })
    let notifyRawPersisted!: () => void
    let releaseExecutorReturn!: () => void
    const rawPersisted = new Promise<void>(resolve => { notifyRawPersisted = resolve })
    const executorReturn = new Promise<void>(resolve => { releaseExecutorReturn = resolve })
    const oldCalls = new Map<string, number>()
    const resultExecutor = executorFor(owned, oldCalls, { active: 0, peak: 0 })
    const firstCycle = runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: firstPlan,
      capabilityBindings,
      executor: async request => {
        // Constructing the result first models the protocol having already
        // captured provider usage before it awaits the durable raw callback.
        const result = await resultExecutor(request)
        await request.onModelOutput?.(raw)
        notifyRawPersisted()
        await executorReturn
        return result
      },
    })
    await rawPersisted

    vi.mocked(Date.now).mockReturnValue(baseNow + task.timeoutMs + 1)
    const timedOut = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: firstPlan,
      capabilityBindings,
      executor: async () => { throw new Error('响应已观察的超时 attempt 不得重新派发') },
    })
    expect(timedOut.buildStatus).toBe('recovery-required')
    const blocked = (await db.productBuilds.get(timedOut.buildId))!
    const failure = JSON.parse(blocked.failureJson)
    expect(failure).toMatchObject({
      taskKey: task.taskKey,
      code: 'provider-response-uncheckpointed',
      resultStatus: 'known-incomplete',
      reservationDisposition: 'retained',
    })
    const oldRunId = failure.failureProvenance.runId as number

    const productionBeforeInvalidDisposition = (await db.productProductions.get(owned.productionId))!
    const invalidZeroCharge = await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'resolve-blocker',
        commandId: 'scheduler-response-evidence-before-timeout.invalid-zero-charge',
        expectedStateRevision: productionBeforeInvalidDisposition.stateRevision,
        blockerKey: task.taskKey,
        resolution: {
          action: 'retry',
          note: '已有响应原文，不得再声明未计费',
          unknownResultReservation: {
            runId: oldRunId,
            attempt: failure.failureProvenance.attempt,
            controlEpoch: failure.failureProvenance.controlEpoch,
            disposition: 'confirmed-not-charged',
          },
        },
      },
    })
    expect(invalidZeroCharge).toMatchObject({ ok: false, errorCode: 'invalid-state-transition' })

    const production = (await db.productProductions.get(owned.productionId))!
    const resolved = await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'resolve-blocker',
        commandId: 'scheduler-response-evidence-before-timeout.resolve',
        expectedStateRevision: production.stateRevision,
        blockerKey: task.taskKey,
        resolution: {
          action: 'retry',
          note: '已观察响应但完整用量未回传，按冻结预留上限封账',
          unknownResultReservation: {
            runId: oldRunId,
            attempt: failure.failureProvenance.attempt,
            controlEpoch: failure.failureProvenance.controlEpoch,
            disposition: 'charge-reservation-upper-bound',
          },
        },
      },
    })
    expect(resolved).toMatchObject({
      ok: true,
      result: {
        controlEpoch: 1,
        unknownResultAccounting: {
          requestedDisposition: 'charge-reservation-upper-bound',
          effectiveDisposition: 'author-charged-reservation-upper-bound',
          usage: { modelCalls: task.budgetReservation.modelCalls },
        },
      },
    })

    releaseExecutorReturn()
    await expect(firstCycle).resolves.toBeDefined()
    const ledgerAfterReturn = JSON.parse((await db.productBuilds.get(timedOut.buildId))!.budgetLedgerJson)
    expect(Object.values(ledgerAfterReturn.reservations)).toHaveLength(0)
    expect(ledgerAfterReturn.charges[`${oldRunId}:${failure.failureProvenance.attempt}`]).toMatchObject({
      resolution: 'author-charged-reservation-upper-bound',
      usage: resolved.result.unknownResultAccounting.usage,
    })
    const oldRun = await readAgentRunV1(owned.scope, oldRunId)
    expect(oldRun.events.some(event => (
      event.type === 'evidence.artifact.recorded'
      && event.payload.artifactKind === 'raw-response'
    ))).toBe(true)
    expect(oldRun.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(0)
    expect(await db.productBuildArtifacts.where('buildId').equals(timedOut.buildId)
      .filter(row => row.producerRunId === oldRunId && row.status === 'accepted').count()).toBe(0)

    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([owned.productionId, 1]).first()
    const nextPlanBase = await createProductProductionPlanV3({
      buildNumber: 1,
      controlEpoch: 1,
      briefHash: briefRow!.briefHash,
      brief: owned.brief,
    })
    const nextPlan = {
      ...nextPlanBase,
      tasks: nextPlanBase.tasks.map(nextTask => {
        if (nextTask.taskKey === task.taskKey) return {
          ...nextTask,
          budgetReservation: {
            ...nextTask.budgetReservation,
            modelCalls: task.budgetReservation.modelCalls + 1,
            inputTokens: task.budgetReservation.inputTokens + 10,
            outputTokens: task.budgetReservation.outputTokens + 10,
            durationMs: task.budgetReservation.durationMs + 1,
          },
        }
        return nextTask.executionMode === 'model'
          ? {
              ...nextTask,
              budgetReservation: { ...nextTask.budgetReservation, outputTokens: 10 },
            }
          : nextTask.taskKey === 'integration.package'
            ? {
                ...nextTask,
                budgetReservation: {
                  ...nextTask.budgetReservation,
                  inputTokens: nextTask.budgetReservation.inputTokens - 10,
                },
              }
          : nextTask
      }),
    }
    const newCalls = new Map<string, number>()
    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: nextPlan,
      capabilityBindings,
      executor: executorFor(owned, newCalls, { active: 0, peak: 0 }),
    })
    expect(completed.buildStatus, JSON.stringify({
      failure: JSON.parse((await db.productBuilds.get(completed.buildId))!.failureJson),
      budget: completed.budget,
      tasks: completed.tasks.map(item => ({ taskKey: item.taskKey, status: item.status, blocker: item.blocker })),
    }, null, 2)).toBe('release-ready')
    expect(oldCalls.get(task.taskKey)).toBe(1)
    expect(newCalls.get(task.taskKey)).toBe(1)
  }, 30_000)

  it('P1证据只读当前task Run内精确批次的当前终态attempt', async () => {
    const owned = await fixture('scheduler-p1-batch-evidence')
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([owned.productionId, 1]).first()
    expect(briefRow).toBeTruthy()
    const basePlan = await createProductProductionPlanV3({
      buildNumber: 1,
      briefHash: briefRow!.briefHash,
      brief: owned.brief,
    })
    const template = basePlan.tasks.find(task => task.taskKey === 'content.design')!
    const taskKey = 'p1.source-curation'
    const task = {
      ...template,
      taskKey,
      kind: 'text-open-world.p1.source-curation',
      skillId: null,
      executionMode: 'deterministic' as const,
      dependsOn: [],
      requiredReceipts: [],
    }
    const suppliedPlan = {
      ...basePlan,
      tasks: [task],
      terminalTaskKey: taskKey,
    }
    const staleContent = '{"attempt":1,"mustNotLeak":true}'
    const currentContent = '{"attempt":2,"current":true}'
    const failedContent = '{"attempt":2,"rejected":true}'
    const failedToolResult = '{"code":"batch-draft-invalid"}'
    const lookalikeContent = '{"lookalikePrefix":true}'
    const append = async (
      snapshot: Awaited<ReturnType<typeof readAgentRunV1>>,
      type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
      payload: unknown,
    ) => appendAgentRunEventV1({
      scope: owned.scope,
      runId: snapshot.run.id,
      type,
      payload,
      expectedLastSequence: snapshot.projection.lastSequence,
    } as Parameters<typeof appendAgentRunEventV1>[0])
    const projection = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings: [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }],
      executor: async request => {
        expect(request.task.taskKey).toBe(taskKey)
        expect(request.taskRunId).toBeTruthy()
        const batchStepId = `${taskKey}.world.source-curation.batch.001`
        let snapshot = await readAgentRunV1(owned.scope, request.taskRunId!)
        snapshot = await append(snapshot, 'step.scheduled', { stepId: batchStepId })
        snapshot = await append(snapshot, 'step.started', { stepId: batchStepId, attempt: 1 })
        snapshot = (await recordAgentRunArtifactV1({
          scope: owned.scope,
          runId: snapshot.run.id,
          stepId: batchStepId,
          attempt: 1,
          artifactKind: 'raw-response',
          content: staleContent,
          expectedLastSequence: snapshot.projection.lastSequence,
        })).snapshot
        snapshot = await append(snapshot, 'step.failed', {
          stepId: batchStepId,
          attempt: 1,
          code: 'retry-batch',
          retryable: true,
        })
        snapshot = await append(snapshot, 'step.started', { stepId: batchStepId, attempt: 2 })
        snapshot = (await recordAgentRunArtifactV1({
          scope: owned.scope,
          runId: snapshot.run.id,
          stepId: batchStepId,
          attempt: 2,
          artifactKind: 'raw-response',
          content: currentContent,
          expectedLastSequence: snapshot.projection.lastSequence,
        })).snapshot
        const currentHash = await hashProductProductionValueV2(currentContent)
        snapshot = await append(snapshot, 'candidate.persisted', {
          stepId: batchStepId,
          attempt: 2,
          candidateHash: currentHash,
          requiresConfirmation: false,
        })
        snapshot = await append(snapshot, 'step.succeeded', {
          stepId: batchStepId,
          attempt: 2,
          outputHash: currentHash,
        })

        const failedBatchStepId = `${taskKey}.world.source-curation.batch.002`
        snapshot = await append(snapshot, 'step.scheduled', { stepId: failedBatchStepId })
        snapshot = await append(snapshot, 'step.started', { stepId: failedBatchStepId, attempt: 1 })
        snapshot = (await recordAgentRunArtifactV1({
          scope: owned.scope,
          runId: snapshot.run.id,
          stepId: failedBatchStepId,
          attempt: 1,
          artifactKind: 'raw-response',
          content: staleContent,
          expectedLastSequence: snapshot.projection.lastSequence,
        })).snapshot
        snapshot = await append(snapshot, 'step.failed', {
          stepId: failedBatchStepId,
          attempt: 1,
          code: 'retry-batch',
          retryable: true,
        })
        snapshot = await append(snapshot, 'step.started', { stepId: failedBatchStepId, attempt: 2 })
        snapshot = (await recordAgentRunArtifactV1({
          scope: owned.scope,
          runId: snapshot.run.id,
          stepId: failedBatchStepId,
          attempt: 2,
          artifactKind: 'raw-response',
          content: failedContent,
          expectedLastSequence: snapshot.projection.lastSequence,
        })).snapshot
        snapshot = (await recordAgentRunArtifactV1({
          scope: owned.scope,
          runId: snapshot.run.id,
          stepId: failedBatchStepId,
          attempt: 2,
          artifactKind: 'tool-result',
          content: failedToolResult,
          expectedLastSequence: snapshot.projection.lastSequence,
        })).snapshot
        snapshot = await append(snapshot, 'step.failed', {
          stepId: failedBatchStepId,
          attempt: 2,
          code: 'source-curation-batch-failed',
          retryable: false,
        })

        const lookalikeStepId = `${taskKey}.world.source-curation.batch-shadow.001`
        snapshot = await append(snapshot, 'step.scheduled', { stepId: lookalikeStepId })
        snapshot = await append(snapshot, 'step.started', { stepId: lookalikeStepId, attempt: 1 })
        snapshot = (await recordAgentRunArtifactV1({
          scope: owned.scope,
          runId: snapshot.run.id,
          stepId: lookalikeStepId,
          attempt: 1,
          artifactKind: 'raw-response',
          content: lookalikeContent,
          expectedLastSequence: snapshot.projection.lastSequence,
        })).snapshot
        const lookalikeHash = await hashProductProductionValueV2(lookalikeContent)
        snapshot = await append(snapshot, 'candidate.persisted', {
          stepId: lookalikeStepId,
          attempt: 1,
          candidateHash: lookalikeHash,
          requiresConfirmation: false,
        })
        await append(snapshot, 'step.succeeded', {
          stepId: lookalikeStepId,
          attempt: 1,
          outputHash: lookalikeHash,
        })
        throw new Error('P1批次最终失败')
      },
    })
    expect(projection.tasks).toEqual([expect.objectContaining({
      taskKey,
      status: 'retry-ready',
      attempt: 1,
    })])
    const evidence = await readProductProductionTaskEvidenceV1({
      scope: owned.scope,
      productionId: owned.productionId,
      taskKey,
    })
    expect(evidence).toEqual(expect.arrayContaining([
      { attempt: 2, kind: 'raw-response', content: currentContent },
      { attempt: 2, kind: 'raw-response', content: failedContent },
      { attempt: 2, kind: 'tool-result', content: failedToolResult },
      { attempt: 2, kind: 'failure', content: 'source-curation-batch-failed' },
    ]))
    expect(evidence.some(item => item.content === staleContent || item.content === lookalikeContent)).toBe(false)
  })

  it.each([
    new AIError(401, 'invalid token'),
    new AICompletionResponseErrorV1('empty', 'content=0; finish=length'),
  ])('授权拒绝与空响应不隐藏重试: %s', async error => {
    const owned = await fixture('scheduler-nonretryable')
    let calls = 0
    const input = { scope: owned.scope, productionId: owned.productionId,
      executor: async () => { calls++; throw error },
      capabilityBindings: [{ requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: 'a'.repeat(64) }] }
    const result = await runProductProductionUntilBlockedV1(input)
    expect(calls).toBe(1)
    expect(result.tasks.find(item => item.taskKey === 'content.design')?.status).toBe('blocked')
    await runProductProductionUntilBlockedV1(input)
    expect(calls).toBe(1)
  })

  it('长 Brief 超过单源软上限仍全文交付；尾部约束与 V3 证据一致', async () => {
    const owned = await fixture('scheduler-long-contract', Array.from({ length: 6 }, (_, i) => `${i}：${'潮'.repeat(800)}`))
    const calls = new Map<string, number>()
    const executor = executorFor(owned, calls, { active: 0, peak: 0 })
    const projection = await runProductProductionSchedulerCycleV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: async request => {
        expect(request.contextText).toContain('不得写回世界正式表')
        expect(request.contextText).not.toContain('…（上下文已截断）')
        for (const fact of owned.brief.intent.requiredFacts) expect(request.contextText).toContain(fact)
        return executor(request)
      },
      capabilityBindings: [{ requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: 'a'.repeat(64) }],
    })
    const task = projection.tasks.find(item => item.taskKey === 'content.design')!
    expect(task.status).toBe('completed')
    expect(calls.get('content.design')).toBe(1)
    const evidence = await readContextGatewayManifestV3ForAttemptV1({ scope: owned.scope,
      runId: task.runId!, stepId: 'content.design', attempt: 1 })
    const source = evidence.manifest.sources.find(item => item.key === 'product-production.brief')!
    expect(source.delivery).toBe('full')
    expect(source.originalTokens).toBeGreaterThan(8000)
    expect(source.tokens).toBe(source.originalTokens)
  })

  it('超过任务总预算在调用前持久化阻塞；重新调度不自动花费模型调用', async () => {
    const owned = await fixture('scheduler-oversized-contract', Array.from({ length: 20 }, (_, i) => `${i}：${'潮'.repeat(1900)}`))
    const calls = new Map<string, number>()
    const input = { scope: owned.scope, productionId: owned.productionId,
      executor: executorFor(owned, calls, { active: 0, peak: 0 }),
      capabilityBindings: [{ requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: 'a'.repeat(64) }] }
    const projection = await runProductProductionUntilBlockedV1(input)
    expect(calls.size).toBe(0)
    expect(projection.tasks.find(item => item.taskKey === 'content.design')?.status).toBe('blocked')
    const build = await db.productBuilds.get(projection.buildId)
    expect(build?.status).toBe('recovery-required')
    expect(build?.failureJson).toContain('task-context-budget-exceeded')
    await runProductProductionUntilBlockedV1(input)
    expect(calls.size).toBe(0)
  })

  it('task.claimed后崩溃的planned child直接复用原Run并安全开始attempt 1', async () => {
    const owned = await fixture('scheduler-planned-child-recovery')
    const suppliedPlan = await singleTaskBudgetPlan(owned, 0, 1)
    const task = suppliedPlan.tasks[0]
    const capabilityBindings = [{
      requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: 'a'.repeat(64),
    }]
    await expect(runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings,
      executor: async () => { throw new Error('claim崩溃周期不得调用executor') },
      onDurableBoundary(boundary) {
        if (boundary === 'task.claimed') throw new Error('injected-after-task-claim')
      },
    })).rejects.toThrow('injected-after-task-claim')

    const before = await projectProductProductionSchedulerV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
    })
    const claimed = before.tasks.find(item => item.taskKey === task.taskKey)!
    expect(claimed).toMatchObject({ status: 'running', attempt: 0, steps: [] })

    const calls = new Map<string, number>()
    const recovered = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings,
      executor: executorFor(owned, calls, { active: 0, peak: 0 }),
    })
    const taskAfterRecovery = recovered.tasks.find(item => item.taskKey === task.taskKey)!
    expect(calls.get(task.taskKey)).toBe(1)
    expect(taskAfterRecovery).toMatchObject({
      runId: claimed.runId,
      status: 'completed',
      attempt: 1,
    })
    const taskChildren = await db.agentRuns.where('[parentRunId+parentRelation]')
      .equals([before.rootRunId, `task:${task.taskKey}`]).toArray()
    expect(taskChildren).toHaveLength(1)
  })

  it('step.started后尚未dispatch的running child到达timeout后标记原attempt失败并安全重试', async () => {
    const owned = await fixture('scheduler-timeout-before-dispatch')
    const suppliedPlan = await singleTaskBudgetPlan(owned, 0, 2)
    const task = suppliedPlan.tasks[0]
    const baseNow = 2_000_000_000_000
    const clock = vi.spyOn(Date, 'now').mockReturnValue(baseNow)
    const capabilityBindings = [{
      requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: 'a'.repeat(64),
    }]
    await expect(runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings,
      executor: async () => { throw new Error('dispatch前不得调用executor') },
      onDurableBoundary(boundary) {
        if (boundary === 'task.claimed') throw new Error('injected-after-task-claim')
      },
    })).rejects.toThrow('injected-after-task-claim')

    const build = (await db.productBuilds
      .where('productionId').equals(owned.productionId).first())!
    const ledger = JSON.parse(build.budgetLedgerJson)
    const childRow = await db.agentRuns
      .where('[parentRunId+parentRelation]')
      .equals([ledger.rootRunId, `task:${task.taskKey}`])
      .first()
    let child = await readAgentRunV1(owned.scope, childRow!.id!)
    child = await appendAgentRunEventV1({
      scope: owned.scope,
      runId: child.run.id,
      type: 'step.scheduled',
      payload: { stepId: task.taskKey },
      expectedLastSequence: child.projection.lastSequence,
    })
    await appendAgentRunEventV1({
      scope: owned.scope,
      runId: child.run.id,
      type: 'step.started',
      payload: { stepId: task.taskKey, attempt: 1 },
      expectedLastSequence: child.projection.lastSequence,
    })

    clock.mockReturnValue(baseNow + task.timeoutMs + 1)
    const calls = new Map<string, number>()
    const projection = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings,
      executor: executorFor(owned, calls, { active: 0, peak: 0 }),
    })
    const projectedTask = projection.tasks.find(item => item.taskKey === task.taskKey)!
    expect(calls.get(task.taskKey)).toBe(1)
    expect(projectedTask).toMatchObject({ status: 'completed', attempt: 2, maxAttempts: 2 })
    expect(projectedTask.steps.find(step => step.stepId === task.taskKey)?.attempts).toMatchObject([
      { attempt: 1, status: 'failed', failureCode: 'task-timeout-before-dispatch' },
      { attempt: 2, status: 'succeeded', failureCode: null },
    ])
  })

  it('model.requested后无response的running child超时转unknown-result并保留预留，绝不重发', async () => {
    const owned = await fixture('scheduler-timeout-request-unknown')
    const suppliedPlan = await singleTaskBudgetPlan(owned, 0, 2)
    const task = suppliedPlan.tasks[0]
    const baseNow = 2_000_100_000_000
    const clock = vi.spyOn(Date, 'now').mockReturnValue(baseNow)
    const capabilityBindings = [{
      requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: 'a'.repeat(64),
    }]
    await expect(runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings,
      executor: async () => { throw new Error('request边界崩溃后不得调用executor') },
      onDurableBoundary(boundary) {
        if (boundary === 'provider.requested') throw new Error('injected-after-provider-requested')
      },
    })).rejects.toThrow('injected-after-provider-requested')

    clock.mockReturnValue(baseNow + task.timeoutMs + 1)
    let calls = 0
    const projection = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings,
      executor: async () => {
        calls += 1
        throw new Error('unknown-result不得盲重发')
      },
    })
    expect(calls).toBe(0)
    expect(projection.buildStatus).toBe('recovery-required')
    const projectedTask = projection.tasks.find(item => item.taskKey === task.taskKey)!
    expect(projectedTask).toMatchObject({
      status: 'blocked',
      dependsOn: [],
      concurrencyGroup: task.concurrencyGroup,
      maxAttempts: task.maxAttempts,
      timeoutMs: task.timeoutMs,
      subjectLocks: task.subjectLockKeys,
      checkpoint: null,
      staleReason: null,
    })
    expect(projectedTask.requiredReceipts).toEqual(task.requiredReceipts)
    expect(projectedTask.latestDurableBoundary?.eventType).toBe('memory.settlement.recorded')
    expect(projectedTask.steps.find(step => step.stepId === task.taskKey)?.attempts[0]).toMatchObject({
      attempt: 1,
      status: 'failed',
      failureCode: 'unknown-result',
    })
    const blocked = (await db.productBuilds.get(projection.buildId))!
    expect(JSON.parse(blocked.failureJson)).toMatchObject({
      taskKey: task.taskKey,
      code: 'unknown-result',
      resultStatus: 'unknown',
      reservationDisposition: 'retained',
      automaticRetryAllowed: false,
    })
    expect(Object.values(JSON.parse(blocked.budgetLedgerJson).reservations)).toHaveLength(1)
    const repeated = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings,
      executor: async () => {
        calls += 1
        throw new Error('unknown-result重复调度仍不得重发')
      },
    })
    expect(calls).toBe(0)
    expect(repeated.buildStatus).toBe('recovery-required')
    expect(Object.values(JSON.parse((await db.productBuilds.get(repeated.buildId))!.budgetLedgerJson).reservations))
      .toHaveLength(1)
  })

  it.each(['pause', 'stop'] as const)(
    'provider.requested边界并发%s后复验epoch/status，绝不进入executor并留下零费用派发证明',
    async control => {
      const owned = await fixture(`scheduler-dispatch-recheck-${control}`)
      const suppliedPlan = await singleTaskBudgetPlan(owned, 0, 2)
      const task = suppliedPlan.tasks[0]
      const capabilityBindings = [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }]
      let executorCalls = 0
      let commandApplied = false
      const projection = await runProductProductionSchedulerCycleV1({
        scope: owned.scope,
        productionId: owned.productionId,
        suppliedPlan,
        capabilityBindings,
        executor: async () => {
          executorCalls += 1
          throw new Error('失去dispatch所有权后不得进入executor')
        },
        async onDurableBoundary(boundary) {
          if (boundary !== 'provider.requested' || commandApplied) return
          commandApplied = true
          const production = (await db.productProductions.get(owned.productionId))!
          if (control === 'pause') {
            const build = (await db.productBuilds.where('productionId').equals(owned.productionId).first())!
            const ledger = JSON.parse(build.budgetLedgerJson)
            ledger.reservations['999991:1'] = {
              taskKey: 'local.zero-reservation',
              runId: 999_991,
              attempt: 1,
              controlEpoch: build.controlEpoch,
              budget: {
                modelCalls: 0,
                inputTokens: 0,
                outputTokens: 0,
                mediaCalls: 0,
                maximumCostUsd: 0,
                durationMs: 0,
                storageBytes: 0,
              },
            }
            await db.productBuilds.update(build.id!, { budgetLedgerJson: JSON.stringify(ledger) })
          }
          const receipt = await executeProductProductionCommand({
            scope: owned.scope,
            productionId: owned.productionId,
            command: control === 'pause'
              ? {
                  type: 'pause',
                  commandId: `scheduler-dispatch-recheck-${control}.pause`,
                  expectedStateRevision: production.stateRevision,
                  reason: '模拟另一标签页在真正dispatch前暂停',
                }
              : {
                  type: 'stop',
                  commandId: `scheduler-dispatch-recheck-${control}.stop`,
                  expectedStateRevision: production.stateRevision,
                  retention: 'keep-build',
                },
          })
          expect(receipt.ok).toBe(true)
          if (control === 'pause') {
            expect(receipt.result).toMatchObject({
              automaticallySettledReservations: [{
                taskKey: 'local.zero-reservation',
                runId: 999_991,
                attempt: 1,
                effectiveDisposition: 'author-confirmed-not-charged',
                usage: { modelCalls: 0, mediaCalls: 0, costUsd: 0 },
              }],
            })
          }
        },
      })

      expect(commandApplied).toBe(true)
      expect(executorCalls).toBe(0)
      expect(projection.buildStatus).toBe(control === 'pause' ? 'paused' : 'cancelled')
      const build = (await db.productBuilds.get(projection.buildId))!
      const ledger = JSON.parse(build.budgetLedgerJson)
      expect(Object.values(ledger.charges)).toHaveLength(control === 'pause' ? 2 : 1)
      expect(Object.values(ledger.reservations)).toHaveLength(0)
      const releaseEntry = Object.entries(ledger.charges).find(([, value]) => (
        (value as { resolution?: unknown }).resolution === 'system-released-before-dispatch'
      ))!
      const [attemptKey, releaseProof] = releaseEntry as [string, {
        taskKey: string
        runId: number
        attempt: number
        controlEpoch: number
        costUpperBoundUsd: number
        resolution: string
        usage: { modelCalls: number; mediaCalls: number; costUsd: number }
      }]
      expect(attemptKey).toBe(`${releaseProof.runId}:${releaseProof.attempt}`)
      expect(releaseProof).toMatchObject({
        taskKey: task.taskKey,
        attempt: 1,
        controlEpoch: 0,
        costUpperBoundUsd: 0,
        resolution: 'system-released-before-dispatch',
        usage: { modelCalls: 0, mediaCalls: 0, costUsd: 0 },
      })
      const forgedReleaseProof = structuredClone(ledger)
      forgedReleaseProof.charges[attemptKey].usage.modelCalls = 1
      expect(() => assertProductProductionBudgetLedgerV1(JSON.stringify(forgedReleaseProof)))
        .toThrow('零费用 tombstone 含非零用量')
      expect(projection.budget.usage).toMatchObject({
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        mediaCalls: 0,
        costUsd: 0,
      })
      if (control === 'pause') {
        expect(ledger.charges['999991:1']).toMatchObject({
          taskKey: 'local.zero-reservation',
          runId: 999_991,
          attempt: 1,
          controlEpoch: 0,
          costUpperBoundUsd: 0,
          resolution: 'author-confirmed-not-charged',
          usage: { modelCalls: 0, mediaCalls: 0, costUsd: 0 },
        })
      }
      const child = await db.agentRuns.where('[parentRunId+parentRelation]')
        .equals([projection.rootRunId, `task:${task.taskKey}`]).first()
      expect(child?.status).toBe('cancelled')

      if (control === 'pause') {
        const pausedProduction = (await db.productProductions.get(owned.productionId))!
        expect(build.status).toBe('paused')
        expect(JSON.parse(build.failureJson)).toMatchObject({
          code: 'pause-provider-result-unknown',
          pausedProviderReservations: [{
            taskKey: task.taskKey,
            runId: releaseProof.runId,
            attempt: releaseProof.attempt,
            controlEpoch: releaseProof.controlEpoch,
          }],
        })

        const wrongEpoch = await executeProductProductionCommand({
          scope: owned.scope,
          productionId: owned.productionId,
          command: {
            type: 'resume',
            commandId: 'scheduler-dispatch-recheck-pause.resume-wrong-epoch',
            expectedStateRevision: pausedProduction.stateRevision,
            pausedReservationDispositions: [{
              taskKey: releaseProof.taskKey,
              runId: releaseProof.runId,
              attempt: releaseProof.attempt,
              controlEpoch: releaseProof.controlEpoch + 1,
              disposition: 'confirmed-not-charged',
            }],
          },
        })
        expect(wrongEpoch).toMatchObject({ ok: false, errorCode: 'invalid-state-transition' })

        // Mere absence is never accepted as proof. A corrupt/deleted release
        // record must leave both Production and Build in the same paused epoch.
        delete ledger.charges[attemptKey]
        await db.productBuilds.update(projection.buildId, { budgetLedgerJson: JSON.stringify(ledger) })
        const missingProof = await executeProductProductionCommand({
          scope: owned.scope,
          productionId: owned.productionId,
          command: {
            type: 'resume',
            commandId: 'scheduler-dispatch-recheck-pause.resume-missing-proof',
            expectedStateRevision: pausedProduction.stateRevision,
          },
        })
        expect(missingProof).toMatchObject({ ok: false, errorCode: 'invalid-state-transition' })
        expect(await db.productProductions.get(owned.productionId)).toMatchObject({
          status: 'paused',
          controlEpoch: pausedProduction.controlEpoch,
          stateRevision: pausedProduction.stateRevision,
        })
        expect(await db.productBuilds.get(projection.buildId)).toMatchObject({ status: 'paused' })

        ledger.charges[attemptKey] = releaseProof
        await db.productBuilds.update(projection.buildId, { budgetLedgerJson: JSON.stringify(ledger) })
        const resumed = await setProductProductionPausedV1({
          scope: owned.scope,
          production: pausedProduction,
          build: (await db.productBuilds.get(projection.buildId))!,
        })
        expect(resumed).toBe('resumed')
        const resumedBuild = (await db.productBuilds.get(projection.buildId))!
        expect(JSON.parse(resumedBuild.failureJson)).toMatchObject({
          code: 'user-pause-resolved',
          pausedReservationAccountings: [{
              taskKey: task.taskKey,
              runId: releaseProof.runId,
              attempt: releaseProof.attempt,
              controlEpoch: releaseProof.controlEpoch,
              requestedDisposition: null,
              effectiveDisposition: 'system-released-before-dispatch',
              usage: { modelCalls: 0, mediaCalls: 0, costUsd: 0 },
          }],
        })
        expect(resumedBuild).toMatchObject({
          status: 'building',
          resumeState: null,
        })
      }
    },
  )

  it('provider response已持久化但candidate checkpoint前崩溃时停止恢复，不重复付费调用', async () => {
    const owned = await fixture('scheduler-timeout-response-uncheckpointed')
    const suppliedPlan = await singleTaskBudgetPlan(owned, 0, 2)
    const task = suppliedPlan.tasks[0]
    const baseNow = 2_000_200_000_000
    const clock = vi.spyOn(Date, 'now').mockReturnValue(baseNow)
    const calls = new Map<string, number>()
    const capabilityBindings = [{
      requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: 'a'.repeat(64),
    }]
    await expect(runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings,
      executor: executorFor(owned, calls, { active: 0, peak: 0 }),
      onDurableBoundary(boundary) {
        if (boundary === 'provider.responded') throw new Error('injected-before-candidate-checkpoint')
      },
    })).rejects.toThrow('injected-before-candidate-checkpoint')
    expect(calls.get(task.taskKey)).toBe(1)

    clock.mockReturnValue(baseNow + task.timeoutMs + 1)
    const projection = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings,
      executor: async () => {
        calls.set(task.taskKey, (calls.get(task.taskKey) ?? 0) + 1)
        throw new Error('已观察response不得盲重发')
      },
    })
    expect(calls.get(task.taskKey)).toBe(1)
    expect(projection.buildStatus).toBe('recovery-required')
    const build = (await db.productBuilds.get(projection.buildId))!
    expect(JSON.parse(build.failureJson)).toMatchObject({
      taskKey: task.taskKey,
      code: 'provider-response-uncheckpointed',
      resultStatus: 'known-incomplete',
      reservationDisposition: 'settled',
      automaticRetryAllowed: false,
    })
    const budget = JSON.parse(build.budgetLedgerJson)
    expect(Object.values(budget.charges)).toHaveLength(1)
    expect(Object.values(budget.reservations)).toHaveLength(0)
  })

  it('投影视图公开旧epoch child的stale原因，而不把旧收据当作当前完成态', async () => {
    const owned = await fixture('scheduler-stale-projection')
    const suppliedPlan = await singleTaskBudgetPlan(owned, 0, 1)
    const calls = new Map<string, number>()
    const capabilityBindings = [{
      requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: 'a'.repeat(64),
    }]
    const current = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan,
      capabilityBindings,
      executor: executorFor(owned, calls, { active: 0, peak: 0 }),
    })
    expect(current.tasks).toEqual([expect.objectContaining({
      taskKey: 'content.design', status: 'completed', staleReason: null,
    })])

    await db.productBuilds.update(current.buildId, { controlEpoch: 1, updatedAt: Date.now() })
    const nextEpochPlan = { ...suppliedPlan, controlEpoch: 1 }
    const projected = await projectProductProductionSchedulerV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: nextEpochPlan,
    })
    expect(projected.tasks).toEqual([expect.objectContaining({
      taskKey: 'content.design',
      status: 'stale',
      staleReason: 'control-epoch-mismatch:0->1',
      blocker: 'control-epoch-mismatch:0->1',
    })])
  })

  it('从授权 Brief 自主并行执行 DAG、冻结 child receipts、编译 Preview 并完成 root join', async () => {
    const owned = await fixture('scheduler-parallel')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0, proveSiblingOverlap: true }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: executorFor(owned, calls, concurrency),
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }],
    })
    expect(projection.terminal).toBe(true)
    expect(projection.tasks.every(task => task.status === 'completed')).toBe(true)
    expect(projection.budget.usage.modelCalls).toBeGreaterThan(0)
    expect(projection.budget.usage.modelCalls).toBeLessThanOrEqual(projection.budget.limits.maximumModelCalls)
    expect(projection.budget.usage.storageBytes).toBeLessThanOrEqual(projection.budget.limits.maximumStorageBytes)
    expect(concurrency.peak).toBeGreaterThanOrEqual(2)
    expect([...calls.values()].every(count => count === 1)).toBe(true)
    const build = await db.productBuilds.get(projection.buildId)
    expect(build).toMatchObject({ status: 'release-ready' })
    expect(build!.rootTerminalReceiptHash).toBe((await db.agentRuns.get(projection.rootRunId))!.terminalReceiptHash)
    const children = await db.agentRuns.where('productBuildId').equals(projection.buildId).toArray()
    expect(children.filter(row => row.parentRunId === projection.rootRunId)).toHaveLength(projection.tasks.length)
    expect(new Set(children.filter(row => row.parentRunId === projection.rootRunId).map(row => row.parentRelation)).size)
      .toBe(projection.tasks.length)
    const integrationRun = children.find(row => row.parentRelation === 'task:integration.package')!
    const evidence = await readContextGatewayManifestV3ForAttemptV1({
      scope: owned.scope,
      runId: integrationRun.id!,
      stepId: 'integration.package',
      attempt: 1,
    })
    const catalog = await openWorldSemanticResourceCatalogV1({
      localReleaseRecordId: owned.release.id!,
      expectedProjectId: owned.scope.projectId,
      expectedWorldId: owned.scope.worldId,
    })
    const compilationKeys = resolveProductProductionWorldCompilationDescriptorsV2({
      descriptors: catalog.resources,
      selection: owned.brief.source.selection,
    }).map(descriptor => descriptor.resourceKey)
    const traced = [
      ...evidence.manifest.gateway.retrievalTrace.mandatory,
      ...evidence.manifest.gateway.retrievalTrace.autoSelected,
    ]
    expect(compilationKeys.every(resourceKey => traced.some(decision => (
      decision.resourceKey === resourceKey && decision.depth === 'original'
    )))).toBe(true)
  }, 30_000)

  it.each(['delete', 'payload-tamper', 'extra'] as const)(
    '最后 Artifact 验收后发生 %s 时 terminal verifier 拒绝封存且零发布',
    async mutation => {
      const owned = await fixture(`scheduler-terminal-artifact-${mutation}`)
      const calls = new Map<string, number>()
      const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
      let injected = false
      await expect(runProductProductionUntilBlockedV1({
        scope: owned.scope,
        productionId: owned.productionId,
        executor: executorFor(owned, calls, { active: 0, peak: 0 }),
        capabilityBindings: [{
          requirementKey: textRequirement.requirementKey,
          adapterId: 'configured-text-provider.v1',
          bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
        }],
        async onDurableBoundary(boundary, snapshot) {
          if (injected || boundary !== 'artifact.accepted'
            || snapshot.contract.scope.productProduction?.taskKey !== 'qa.release') return
          injected = true
          const buildId = snapshot.run.productBuildId!
          const design = await db.productBuildArtifacts
            .where('[buildId+artifactKey]').equals([buildId, 'design.game']).first()
          expect(design?.id).toBeTruthy()
          if (mutation === 'delete') {
            await db.productBuildArtifacts.delete(design!.id!)
          } else if (mutation === 'payload-tamper') {
            await db.productBuildArtifacts.update(design!.id!, {
              payloadJson: canonicalProductProductionJsonV2({ tamperedAfterAcceptance: true }),
              updatedAt: Date.now(),
            })
          } else {
            const { id: _id, ...copy } = design!
            await db.productBuildArtifacts.add({
              ...copy,
              artifactKey: 'unexpected.extra',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            })
          }
        },
      })).rejects.toThrow(/Artifact/)
      expect(injected).toBe(true)
      const build = await db.productBuilds.where('productionId').equals(owned.productionId).first()
      expect(build?.status).not.toMatch(/preview-ready|release-ready/)
      expect(build?.rootTerminalReceiptHash).toBeNull()
      expect(await db.productReleases.where('workId').equals(owned.scope.workId).count()).toBe(0)
    },
    30_000,
  )

  it.each(['root-row', 'root-event', 'root-checkpoint'] as const)(
    'root 完成后篡改 %s 会被 post-root 完整复验拒绝',
    async mutation => {
      const owned = await fixture(`scheduler-terminal-final-cas-${mutation}`)
      const calls = new Map<string, number>()
      const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
      let injected = false
      let targetBuildId: number | null = null
      await expect(runProductProductionUntilBlockedV1({
        scope: owned.scope,
        productionId: owned.productionId,
        executor: executorFor(owned, calls, { active: 0, peak: 0 }),
        capabilityBindings: [{
          requirementKey: textRequirement.requirementKey,
          adapterId: 'configured-text-provider.v1',
          bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
        }],
        async onDurableBoundary(boundary, snapshot) {
          if (injected || boundary !== 'root.verification.accepted') return
          injected = true
          targetBuildId = snapshot.run.productBuildId!
          const root = await db.agentRuns.get(snapshot.run.id)
          expect(root?.status).toBe('completed')
          const terminalReceiptHash = root!.terminalReceiptHash
          if (mutation === 'root-row') {
            await db.agentRuns.update(root!.id!, {
              contractJson: canonicalProductProductionJsonV2({ tamperedAfterRootCompletion: true }),
              // Keep the two shallow fields that the former final commit read.
              status: 'completed',
              terminalReceiptHash,
            })
          } else if (mutation === 'root-event') {
            const event = await db.agentRunEvents.where('runId').equals(root!.id!).first()
            expect(event?.id).toBeTruthy()
            await db.agentRunEvents.update(event!.id!, {
              payloadJson: canonicalProductProductionJsonV2({ tamperedAfterRootCompletion: true }),
            })
          } else {
            await db.agentRunCheckpoints.add({
              projectId: root!.projectId,
              worldGroupId: root!.worldGroupId ?? null,
              runId: root!.id!,
              throughSequence: root!.lastSequence,
              generation: root!.generation,
              contractHash: root!.contractHash,
              checkpointHash: 'f'.repeat(64),
              projectionJson: root!.projectionJson,
              projectionHash: root!.projectionHash,
              resumePayloadJson: null,
              resumePayloadHash: null,
              createdAt: Date.now(),
            })
          }
        },
      })).rejects.toThrow()
      expect(injected).toBe(true)
      const build = await db.productBuilds.get(targetBuildId!)
      expect(build?.status).toBe('validating')
      expect(build?.rootTerminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
      expect(await db.productReleases.where('workId').equals(owned.scope.workId).count()).toBe(0)
    },
    30_000,
  )

  it('root 完成后 OPFS 字节被替换时，post-root 物理复验拒绝封存', async () => {
    const owned = await fixture('scheduler-terminal-post-root-opfs')
    const fakeOpfs = installFakeOpfsV1()
    try {
      const bytes = new TextEncoder().encode('terminal-post-root-opfs-bytes').buffer
      const blob = await putMediaBlobObject({
        scope: owned.scope,
        data: bytes,
        mimeType: 'image/png',
        backend: 'opfs',
      })
      const calls = new Map<string, number>()
      const baseExecutor = executorFor(owned, calls, { active: 0, peak: 0 })
      const executor: ProductProductionTaskExecutorV1 = async request => {
        const result = await baseExecutor(request)
        if (request.task.taskKey === 'content.design') {
          result.artifacts[0] = {
            ...result.artifacts[0],
            kind: 'image',
            mediaKind: 'image',
            contentHash: blob.contentHash,
            blobObjectId: blob.id!,
            mimeType: blob.mimeType,
            byteSize: blob.byteSize,
          }
        }
        return result
      }
      const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
      let injected = false
      let targetBuildId: number | null = null
      await expect(runProductProductionUntilBlockedV1({
        scope: owned.scope,
        productionId: owned.productionId,
        executor,
        capabilityBindings: [{
          requirementKey: textRequirement.requirementKey,
          adapterId: 'configured-text-provider.v1',
          bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
        }],
        async onDurableBoundary(boundary, snapshot) {
          if (injected || boundary !== 'root.verification.accepted') return
          injected = true
          targetBuildId = snapshot.run.productBuildId!
          const path = [...fakeOpfs.files.keys()][0]
          const changed = fakeOpfs.files.get(path)!.slice(0)
          new Uint8Array(changed)[0] ^= 0xff
          fakeOpfs.files.set(path, changed)
        },
      })).rejects.toThrow(/共享媒资哈希不匹配/)
      expect(injected).toBe(true)
      const build = await db.productBuilds.get(targetBuildId!)
      expect(build?.status).toBe('validating')
      expect(await db.productReleases.where('workId').equals(owned.scope.workId).count()).toBe(0)
    } finally {
      fakeOpfs.restore()
    }
  }, 30_000)

  it.each([
    ['root.step.succeeded', 'running'],
    ['root.verification.started', 'verifying'],
    ['root.verification.accepted', 'completed'],
  ] as const)(
    'terminal claim 后在 %s 崩溃可按 root 阶段恢复，且不重复追加终态事件',
    async (crashBoundary, expectedInterruptedState) => {
      const owned = await fixture(`scheduler-root-join-recovery-${crashBoundary}`)
      const calls = new Map<string, number>()
      const executor = executorFor(owned, calls, { active: 0, peak: 0 })
      const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
      const capabilityBindings = [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }]
      let crashed = false

      await expect(runProductProductionUntilBlockedV1({
        scope: owned.scope,
        productionId: owned.productionId,
        executor,
        capabilityBindings,
        onDurableBoundary(boundary) {
          if (!crashed && boundary === crashBoundary) {
            crashed = true
            throw new Error(`injected-after-${crashBoundary}`)
          }
        },
      })).rejects.toThrow(`injected-after-${crashBoundary}`)

      expect(crashed).toBe(true)
      const interruptedBuild = await db.productBuilds
        .where('productionId').equals(owned.productionId).first()
      expect(interruptedBuild).toMatchObject({ status: 'validating' })
      expect(interruptedBuild?.rootTerminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
      const interruptedLedger = JSON.parse(interruptedBuild!.budgetLedgerJson)
      const interruptedRoot = await readAgentRunV1(owned.scope, interruptedLedger.rootRunId)
      expect(interruptedRoot.projection.state).toBe(expectedInterruptedState)

      const recovered = await runProductProductionSchedulerCycleV1({
        scope: owned.scope,
        productionId: owned.productionId,
        executor,
        capabilityBindings,
      })
      expect(recovered).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
      expect([...calls.values()].every(count => count === 1)).toBe(true)

      const completedRoot = await readAgentRunV1(owned.scope, recovered.rootRunId!)
      expect(completedRoot.projection).toMatchObject({
        state: 'completed',
        terminalReceiptHash: interruptedBuild!.rootTerminalReceiptHash,
      })
      const terminalEvents = completedRoot.events.filter(event => (
        (event.type === 'step.succeeded' && event.payload.stepId === '$join')
        || event.type === 'verification.started'
        || event.type === 'verification.accepted'
      ))
      expect(terminalEvents.map(event => event.type)).toEqual([
        'step.succeeded',
        'verification.started',
        'verification.accepted',
      ])
      expect(new Set(terminalEvents.map(event => event.sequence)).size).toBe(3)
    },
    30_000,
  )

  it.each(['pause', 'stop'] as const)(
    'executor 实际开始后并发%s，暂停可在无回调时封账恢复且迟到候选永不成为 Artifact',
    async control => {
      const owned = await fixture(`scheduler-late-result-${control}`)
      const suppliedPlan = await singleTaskBudgetPlan(owned, 0, 2)
      const task = suppliedPlan.tasks[0]
      const capabilityBindings = [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }]
      let notifyStarted!: () => void
      let releaseExecutor!: () => void
      const executorStarted = new Promise<void>(resolve => { notifyStarted = resolve })
      const executorRelease = new Promise<void>(resolve => { releaseExecutor = resolve })
      let executorCalls = 0
      const resultExecutor = executorFor(owned, new Map(), { active: 0, peak: 0 })
      const schedulerPromise = runProductProductionSchedulerCycleV1({
        scope: owned.scope,
        productionId: owned.productionId,
        suppliedPlan,
        capabilityBindings,
        executor: async request => {
          executorCalls += 1
          notifyStarted()
          await executorRelease
          return resultExecutor(request)
        },
      })

      await executorStarted
      const production = (await db.productProductions.get(owned.productionId))!
      const controlReceipt = await executeProductProductionCommand({
        scope: owned.scope,
        productionId: owned.productionId,
        command: control === 'pause'
          ? {
              type: 'pause',
              commandId: `scheduler-late-result-${control}.pause`,
              expectedStateRevision: production.stateRevision,
              reason: '模拟另一控制流在供应商已开始后暂停',
            }
          : {
              type: 'stop',
              commandId: `scheduler-late-result-${control}.stop`,
              expectedStateRevision: production.stateRevision,
              retention: 'keep-build',
            },
      })
      expect(controlReceipt.ok).toBe(true)
      if (control === 'pause') {
        const pausedProduction = (await db.productProductions.get(owned.productionId))!
        const pausedBuild = (await db.productBuilds.where('productionId').equals(owned.productionId).first())!
        expect(pausedProduction.status).toBe('paused')
        expect(pausedBuild.status).toBe('paused')
        const failure = JSON.parse(pausedBuild.failureJson)
        const frozen = failure.pausedProviderReservations[0]
        expect(failure).toMatchObject({
          code: 'pause-provider-result-unknown',
          pausedProviderReservations: [{ taskKey: task.taskKey, attempt: 1, controlEpoch: 0 }],
        })
        expect(Object.values(JSON.parse(pausedBuild.budgetLedgerJson).reservations)).toHaveLength(1)

        await expect(setProductProductionPausedV1({
          scope: owned.scope,
          production: pausedProduction,
          build: pausedBuild,
        })).rejects.toThrow('恢复前请先结算暂停时仍在途的供应商请求')
        expect(await db.productProductions.get(owned.productionId)).toMatchObject({
          status: 'paused',
          controlEpoch: pausedProduction.controlEpoch,
          stateRevision: pausedProduction.stateRevision,
        })

        const resumed = await setProductProductionPausedV1({
          scope: owned.scope,
          production: pausedProduction,
          build: pausedBuild,
          pausedReservationDisposition: 'charge-reservation-upper-bound',
        })
        expect(resumed).toBe('resumed')
        expect(await db.productBuilds.get(pausedBuild.id!)).toMatchObject({
          status: 'building',
          resumeState: null,
          controlEpoch: pausedProduction.controlEpoch + 1,
        })
        expect(Object.values(JSON.parse(
          (await db.productBuilds.get(pausedBuild.id!))!.budgetLedgerJson,
        ).charges)[0]).toMatchObject({
          taskKey: task.taskKey,
          runId: frozen.runId,
          attempt: 1,
          controlEpoch: 0,
          resolution: 'author-charged-reservation-upper-bound',
        })
      }
      releaseExecutor()

      const projection = await schedulerPromise
      expect(executorCalls).toBe(1)
      expect(projection.buildStatus).toBe(control === 'pause' ? 'building' : 'cancelled')
      const build = (await db.productBuilds.get(projection.buildId))!
      const ledger = JSON.parse(build.budgetLedgerJson)
      expect(Object.values(ledger.charges)).toHaveLength(1)
      expect(Object.values(ledger.reservations)).toHaveLength(0)
      expect(Object.values(ledger.charges)[0]).toMatchObject({
        taskKey: task.taskKey,
        attempt: 1,
        controlEpoch: 0,
        ...(control === 'pause'
          ? { resolution: 'author-charged-reservation-upper-bound' }
          : { usage: { modelCalls: 1, inputTokens: 10, outputTokens: 10 } }),
      })
      expect(await db.productBuildArtifacts.where('buildId').equals(projection.buildId).count()).toBe(0)
      const childRow = await db.agentRuns.where('[parentRunId+parentRelation]')
        .equals([projection.rootRunId, `task:${task.taskKey}`]).first()
      const child = await readAgentRunV1(owned.scope, childRow!.id!)
      expect(child.projection.state).toBe('cancelled')
      expect(child.events.filter(event => event.type === 'budget.settled')).toHaveLength(1)
      expect(child.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(0)
      expect(child.events.filter(event => event.type === 'verification.accepted')).toHaveLength(0)
    },
    30_000,
  )

  it('Creator 正式 P0 将完整 SourcePin 原子写入并闭合 producer/ledger，且同 cycle 不启动 P1', async () => {
    const world = await seedCurrentProductWorld('scheduler-creator-p0-atomic')
    const creator = await seedAuthorizedTextOpenWorldCreatorBuildV1({
      source: {
        kind: 'world-release',
        scope: world.scope,
        localReleaseRecordId: world.release.id!,
        expectedReleaseHash: world.release.contentHash,
      },
      sessionKey: 'scheduler-creator-p0-atomic',
    })
    const plan = JSON.parse((await db.productBuilds.get(creator.buildId))!.planJson)
    const p0 = plan.tasks.find((task: { taskKey: string }) => task.taskKey === 'p0.source-lock')!

    const projection = await runProductProductionSchedulerCycleV1({
      scope: creator.scope,
      productionId: creator.productionId,
      executor: createTextOpenWorldSourceLockExecutorV1(),
      capabilityBindings: creatorLocalMediaBindings(plan),
    })
    const projectedP0 = projection.tasks.find(task => task.taskKey === 'p0.source-lock')!
    expect(projectedP0).toMatchObject({ status: 'completed', attempt: 1 })
    expect(projection.tasks.find(task => task.taskKey === 'p1.source-curation')).toMatchObject({
      status: 'ready',
      runId: null,
    })
    const accepted = (await db.productBuildArtifacts.where('buildId').equals(creator.buildId).toArray())
      .filter(row => row.status === 'accepted')
    expect(accepted.map(row => row.artifactKey).sort()).toEqual([...p0.outputArtifactKeys].sort())
    expect(new Set(accepted.map(row => row.producerRunId))).toEqual(new Set([projectedP0.runId]))
    expect(new Set(accepted.map(row => row.producerReceiptHash))).toEqual(new Set([projectedP0.terminalReceiptHash]))
    expect(accepted.every(row => /^[a-f0-9]{64}$/.test(row.inputHash))).toBe(true)

    const build = (await db.productBuilds.get(creator.buildId))!
    const ledger = JSON.parse(build.budgetLedgerJson)
    expect(Object.values(ledger.reservations)).toHaveLength(0)
    expect(Object.values(ledger.charges)).toHaveLength(1)
    expect(ledger.tasks['p0.source-lock']).toMatchObject({
      runId: projectedP0.runId,
      status: 'settled',
      terminalReceiptHash: projectedP0.terminalReceiptHash,
    })
    expect(await db.agentRuns.where('[parentRunId+parentRelation]')
      .equals([projection.rootRunId, 'task:p1.source-curation']).count()).toBe(0)
  }, 30_000)

  it('P1嵌套 provider 响应迟于外层timeout时先结算paid usage，且不向终态Run追加响应或候选', async () => {
    const world = await seedCurrentProductWorld('scheduler-creator-p1-late-response')
    const creator = await seedAuthorizedTextOpenWorldCreatorBuildV1({
      source: {
        kind: 'world-release',
        scope: world.scope,
        localReleaseRecordId: world.release.id!,
        expectedReleaseHash: world.release.contentHash,
      },
      sessionKey: 'scheduler-creator-p1-late-response',
    })
    const plan = JSON.parse((await db.productBuilds.get(creator.buildId))!.planJson)
    const p1 = plan.tasks.find((task: { taskKey: string }) => task.taskKey === 'p1.source-curation')!
    const textBinding = {
      requirementKey: p1.capabilityRequirementKeys[0],
      adapterId: 'configured-text-provider.v1',
      bindingHash: 'b'.repeat(64),
    }
    const capabilityBindings = [textBinding, ...creatorLocalMediaBindings(plan)]
    const p0Projection = await runProductProductionSchedulerCycleV1({
      scope: creator.scope,
      productionId: creator.productionId,
      executor: createTextOpenWorldSourceLockExecutorV1(),
      capabilityBindings,
    })
    expect(p0Projection.tasks.find(task => task.taskKey === 'p0.source-lock')).toMatchObject({
      status: 'completed',
    })

    const baseNow = 2_120_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(baseNow)
    let notifyProviderStarted!: () => void
    let releaseProvider!: () => void
    const providerStarted = new Promise<void>(resolve => { notifyProviderStarted = resolve })
    const providerRelease = new Promise<void>(resolve => { releaseProvider = resolve })
    const p1Executor = createTextOpenWorldSourceCurationExecutorV1({
      runModel: async request => {
        notifyProviderStarted()
        await providerRelease
        return {
          output: '{"late":true}',
          bindingReceipt: {
            schema: 'storyforge.provider-binding-receipt',
            version: 1,
            requirementKey: request.requirementKey,
            adapterId: 'configured-text-provider.v1',
            adapterVersion: 1,
            provider: 'test',
            model: 'test-model',
            endpointOrigin: 'https://example.invalid',
            executionLocation: 'browser-direct',
            credentialSource: 'existing-ai-config',
            credentialPresent: true,
            capabilityHash: textBinding.bindingHash,
            boundAt: baseNow,
            receiptHash: 'c'.repeat(64),
          },
          usage: { inputTokens: 17, outputTokens: 5 },
        }
      },
      now: () => baseNow,
    })
    const firstCycle = runProductProductionSchedulerCycleV1({
      scope: creator.scope,
      productionId: creator.productionId,
      executor: p1Executor,
      capabilityBindings,
    })
    await providerStarted

    vi.mocked(Date.now).mockReturnValue(baseNow + p1.timeoutMs + 1)
    const timedOut = await runProductProductionSchedulerCycleV1({
      scope: creator.scope,
      productionId: creator.productionId,
      executor: async () => { throw new Error('P1 unknown-result timeout 不得重新派发') },
      capabilityBindings,
    })
    expect(timedOut.buildStatus).toBe('recovery-required')
    const blocked = (await db.productBuilds.get(creator.buildId))!
    const failure = JSON.parse(blocked.failureJson)
    expect(failure).toMatchObject({ taskKey: p1.taskKey, code: 'unknown-result' })

    releaseProvider()
    await expect(firstCycle).resolves.toBeDefined()
    const ledger = JSON.parse((await db.productBuilds.get(creator.buildId))!.budgetLedgerJson)
    const attemptKey = `${failure.failureProvenance.runId}:${failure.failureProvenance.attempt}`
    expect(Object.values(ledger.reservations)).toHaveLength(0)
    expect(ledger.charges[attemptKey]).toMatchObject({
      taskKey: p1.taskKey,
      resolution: null,
      usage: { modelCalls: 1, inputTokens: 17, outputTokens: 5 },
    })
    const child = await readAgentRunV1(creator.scope, failure.failureProvenance.runId)
    const nestedEvents = child.events.filter(event => (
      'stepId' in event.payload
      && typeof event.payload.stepId === 'string'
      && event.payload.stepId.startsWith(`${p1.taskKey}.`)
    ))
    expect(nestedEvents.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(nestedEvents.filter(event => event.type === 'model.responded')).toHaveLength(0)
    expect(nestedEvents.filter(event => event.type === 'candidate.persisted')).toHaveLength(0)
    expect(await db.productBuildArtifacts.where('buildId').equals(creator.buildId)
      .filter(row => row.producerRunId === failure.failureProvenance.runId).count()).toBe(0)

    const production = (await db.productProductions.get(creator.productionId))!
    const resolved = await executeProductProductionCommand({
      scope: creator.scope,
      productionId: creator.productionId,
      command: {
        type: 'resolve-blocker',
        commandId: 'scheduler-creator-p1-late-response.resolve',
        expectedStateRevision: production.stateRevision,
        blockerKey: p1.taskKey,
        resolution: {
          action: 'retry',
          note: '迟到实际计费已闭合，开启新 epoch',
          unknownResultReservation: {
            runId: failure.failureProvenance.runId,
            attempt: failure.failureProvenance.attempt,
            controlEpoch: failure.failureProvenance.controlEpoch,
            disposition: 'confirmed-not-charged',
          },
        },
      },
    })
    expect(resolved).toMatchObject({
      ok: true,
      result: {
        controlEpoch: 1,
        unknownResultAccounting: {
          effectiveDisposition: 'provider-actual-charge',
          usage: { modelCalls: 1, inputTokens: 17, outputTokens: 5 },
        },
      },
    })
  }, 30_000)

  it('Creator P0 整包事务在中途存储故障时回滚为零半包，且 P1 不会越级启动', async () => {
    const world = await seedCurrentProductWorld('scheduler-creator-p0-crash')
    const creator = await seedAuthorizedTextOpenWorldCreatorBuildV1({
      source: {
        kind: 'world-release',
        scope: world.scope,
        localReleaseRecordId: world.release.id!,
        expectedReleaseHash: world.release.contentHash,
      },
      sessionKey: 'scheduler-creator-p0-crash',
    })
    const plan = JSON.parse((await db.productBuilds.get(creator.buildId))!.planJson)
    let sourceWrites = 0
    const failSecondSourceWrite = (_primaryKey: unknown, row: { buildId?: number; kind?: string }) => {
      if (row.buildId !== creator.buildId
        || !['text-open-world.source-pin', 'text-open-world.source-pin-unit'].includes(row.kind ?? '')) return
      sourceWrites += 1
      if (sourceWrites === 2) throw new Error('injected-mid-p0-bundle-transaction')
    }
    db.productBuildArtifacts.hook('creating', failSecondSourceWrite)
    try {
      await expect(runProductProductionSchedulerCycleV1({
        scope: creator.scope,
        productionId: creator.productionId,
        executor: createTextOpenWorldSourceLockExecutorV1(),
        capabilityBindings: creatorLocalMediaBindings(plan),
      })).rejects.toThrow('injected-mid-p0-bundle-transaction')
    } finally {
      db.productBuildArtifacts.hook('creating').unsubscribe(failSecondSourceWrite)
    }

    expect(sourceWrites).toBe(2)
    expect(await db.productBuildArtifacts.where('buildId').equals(creator.buildId).count()).toBe(0)
    const build = (await db.productBuilds.get(creator.buildId))!
    const ledger = JSON.parse(build.budgetLedgerJson)
    expect(Object.values(ledger.charges)).toHaveLength(1)
    expect(Object.values(ledger.reservations)).toHaveLength(0)
    expect(ledger.tasks['p0.source-lock']).toMatchObject({ status: 'settled' })
    expect(await db.agentRuns.where('[parentRunId+parentRelation]')
      .equals([ledger.rootRunId, 'task:p1.source-curation']).count()).toBe(0)
  }, 30_000)

  it('候选检查点后崩溃会从 durable payload 恢复，不重复调用已计费 executor', async () => {
    const owned = await fixture('scheduler-recovery')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const executor = executorFor(owned, calls, concurrency)
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    let injected = false
    await expect(runProductProductionSchedulerCycleV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
      onDurableBoundary(boundary, snapshot) {
        if (!injected && boundary === 'candidate.checkpoint'
          && snapshot.contract.scope.productProduction?.taskKey === 'content.design') {
          injected = true
          throw new Error('injected-process-crash')
        }
      },
    })).rejects.toThrow('injected-process-crash')
    expect(calls.get('content.design')).toBe(1)

    const interrupted = await projectProductProductionSchedulerV1({
      scope: owned.scope,
      productionId: owned.productionId,
    })
    const interruptedDesign = interrupted.tasks.find(task => task.taskKey === 'content.design')!
    expect(interruptedDesign.checkpoint).toMatchObject({
      status: 'verified',
      resumeKind: 'task-candidate',
      attempt: 1,
    })
    expect(interruptedDesign.checkpoint?.candidateHash).toMatch(/^[a-f0-9]{64}$/)
    expect(interruptedDesign.latestDurableBoundary?.eventType).toBe('checkpoint.created')
    expect(interruptedDesign.steps.find(step => step.stepId === 'content.design')).toMatchObject({
      currentAttempt: 1,
      candidateHash: interruptedDesign.checkpoint?.candidateHash,
      attempts: [expect.objectContaining({ attempt: 1, status: 'running' })],
    })

    const recovered = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(recovered.terminal).toBe(true)
    expect(calls.get('content.design')).toBe(1)
    expect(await db.agentRunCheckpoints.count()).toBeGreaterThan(0)
    expect((await db.productBuildArtifacts.where('buildId').equals(recovered.buildId).toArray())
      .filter(row => row.artifactKey === 'design.game' && row.status === 'accepted')).toHaveLength(1)
  }, 30_000)

  it('作者暂停并恢复后复用已验收产物，只为新 epoch 补签收据而不重复调用 executor', async () => {
    const owned = await fixture('scheduler-pause-resume')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const executor = executorFor(owned, calls, concurrency)
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]

    const partial = await runProductProductionSchedulerCycleV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(partial.terminal).toBe(false)
    expect(calls.get('content.design')).toBe(1)
    expect([...calls.entries()].filter(([taskKey]) => taskKey !== 'content.design')).toHaveLength(0)

    // Simulate an in-place upgrade from a persisted pre-v2 ledger. The latest
    // v1 settlement must be promoted into cumulative history before the epoch
    // changes; otherwise the already paid content.design call disappears.
    const partialBuild = (await db.productBuilds.get(partial.buildId))!
    const v2Ledger = JSON.parse(partialBuild.budgetLedgerJson)
    await db.productBuilds.update(partial.buildId, {
      budgetLedgerJson: JSON.stringify({
        schema: 'storyforge.product-production-budget-ledger',
        version: 1,
        rootRunId: v2Ledger.rootRunId,
        rootClaim: v2Ledger.rootClaim,
        tasks: v2Ledger.tasks,
      }),
    })

    const beforePause = await db.productProductions.get(owned.productionId)
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'pause', commandId: 'scheduler-pause-resume.pause',
        expectedStateRevision: beforePause!.stateRevision, reason: '作者主动暂停检查进度',
      },
    })
    const paused = await db.productProductions.get(owned.productionId)
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resume', commandId: 'scheduler-pause-resume.resume',
        expectedStateRevision: paused!.stateRevision,
      },
    })

    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(completed.terminal).toBe(true)
    expect([...calls.values()].every(count => count === 1)).toBe(true)
    expect(calls.get('content.design')).toBe(1)
    expect(completed.budget.usage.modelCalls).toBe(4)
    const completedBuild = (await db.productBuilds.get(completed.buildId))!
    const completedLedger = JSON.parse(completedBuild.budgetLedgerJson)
    const completedCharges = Object.values(completedLedger.charges as Record<string, {
      taskKey: string
      controlEpoch: number | null
      usage: { modelCalls: number }
    }>)
    expect(completedBuild.rootTerminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(completedCharges.some(charge => (
      charge.taskKey === 'content.design' && charge.controlEpoch === null
    ))).toBe(true)
    expect(completedCharges.reduce((sum, charge) => (
      sum + charge.usage.modelCalls
    ), 0)).toBe(4)

    const designRows = (await db.productBuildArtifacts.where('buildId').equals(completed.buildId).toArray())
      .filter(row => row.artifactKey === 'design.game')
      .sort((left, right) => left.controlEpoch - right.controlEpoch)
    expect(designRows).toHaveLength(2)
    expect(designRows[0]).toMatchObject({ controlEpoch: 0, status: 'invalid' })
    expect(designRows[1]).toMatchObject({
      controlEpoch: 2, status: 'carried-forward', parentArtifactHash: designRows[0].contentHash,
    })
    expect(designRows[1].producerRunId).not.toBeNull()
    expect(designRows[1].producerReceiptHash).not.toBe(designRows[0].producerReceiptHash)
  }, 30_000)

  it('same-build carry 在写事务内精确 CAS 父 producer/root 的 Run、事件与 checkpoint', async () => {
    const owned = await fixture('scheduler-same-build-parent-proof-cas')
    const calls = new Map<string, number>()
    const executor = executorFor(owned, calls, { active: 0, peak: 0 })
    const capabilityBindings = [{
      requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: 'a'.repeat(64),
    }]
    const partial = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor,
      capabilityBindings,
    })
    const source = (await db.productBuildArtifacts.where('buildId').equals(partial.buildId).toArray())
      .find(row => row.artifactKey === 'design.game' && row.status === 'accepted')!
    const beforePause = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'pause', commandId: 'scheduler-same-build-parent-proof-cas.pause',
        expectedStateRevision: beforePause.stateRevision, reason: '测试父证明原子 CAS',
      },
    })
    const paused = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'resume', commandId: 'scheduler-same-build-parent-proof-cas.resume',
        expectedStateRevision: paused.stateRevision,
      },
    })
    const producerEvent = await db.agentRunEvents.where('runId').equals(source.producerRunId!).first()
    expect(producerEvent?.id).toBeTruthy()

    const originalBulkGet = db.agentRuns.bulkGet.bind(db.agentRuns)
    let injected = false
    const spy = vi.spyOn(db.agentRuns, 'bulkGet').mockImplementation(async keys => {
      const rows = await originalBulkGet(keys)
      if (!injected && Dexie.currentTransaction?.mode === 'readwrite'
        && [...keys].includes(source.producerRunId!)) {
        injected = true
        await db.agentRunEvents.update(producerEvent!.id!, {
          createdAt: producerEvent!.createdAt + 1,
        })
      }
      return rows
    })
    try {
      await expect(runProductProductionSchedulerCycleV1({
        scope: owned.scope,
        productionId: owned.productionId,
        executor,
        capabilityBindings,
      })).rejects.toThrow(/carry-forward 父证明读取后已变化/)
    } finally {
      spy.mockRestore()
    }
    expect(injected).toBe(true)
    expect((await db.agentRunEvents.get(producerEvent!.id!))?.createdAt).toBe(producerEvent!.createdAt)
    const rows = await db.productBuildArtifacts.where('buildId').equals(partial.buildId).toArray()
    expect(rows.filter(row => row.artifactKey === 'design.game')).toEqual([
      expect.objectContaining({ id: source.id, status: 'accepted', controlEpoch: source.controlEpoch }),
    ])
  }, 30_000)

  it('terminal verifier 拒绝伪装为 accepted 却携带 lineage 治理字段的当前行', async () => {
    const owned = await fixture('scheduler-accepted-lineage-envelope')
    const executor = executorFor(owned, new Map(), { active: 0, peak: 0 })
    const capabilityBindings = [{
      requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: 'b'.repeat(64),
    }]
    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor,
      capabilityBindings,
    })
    const build = (await db.productBuilds.get(completed.buildId))!
    const accepted = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([completed.buildId, 'design.game']).first()
    await db.productBuildArtifacts.update(accepted!.id!, {
      parentArtifactHash: accepted!.contentHash,
    })
    await expect(verifyProductBuildTerminalArtifactSetV1({
      scope: owned.scope,
      productionId: owned.productionId,
      buildId: completed.buildId,
      expectedControlEpoch: build.controlEpoch,
      expectedPlanHash: build.planHash,
    })).rejects.toThrow(/terminal accepted sibling producer\/ledger 不闭合/)
  }, 30_000)

  it('terminal verifier 拒绝历史 accepted 父行携带 lineage 治理字段', async () => {
    const owned = await fixture('scheduler-historical-accepted-lineage-envelope')
    const executor = executorFor(owned, new Map(), { active: 0, peak: 0 })
    const capabilityBindings = [{
      requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: 'c'.repeat(64),
    }]
    const partial = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor,
      capabilityBindings,
    })
    const beforePause = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'pause', commandId: 'scheduler-historical-accepted-lineage-envelope.pause',
        expectedStateRevision: beforePause.stateRevision, reason: '制造历史 accepted 父行',
      },
    })
    const paused = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'resume', commandId: 'scheduler-historical-accepted-lineage-envelope.resume',
        expectedStateRevision: paused.stateRevision,
      },
    })
    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor,
      capabilityBindings,
    })
    const build = (await db.productBuilds.get(completed.buildId))!
    const historical = (await db.productBuildArtifacts.where('buildId').equals(partial.buildId).toArray())
      .find(row => row.artifactKey === 'design.game'
        && row.status === 'invalid' && row.controlEpoch < build.controlEpoch)!
    await db.productBuildArtifacts.update(historical.id!, {
      parentArtifactHash: historical.contentHash,
    })
    await expect(verifyProductBuildTerminalArtifactSetV1({
      scope: owned.scope,
      productionId: owned.productionId,
      buildId: completed.buildId,
      expectedControlEpoch: build.controlEpoch,
      expectedPlanHash: build.planHash,
    })).rejects.toThrow(/terminal (same-build proof 已变化|historical accepted identity 不闭合)/)
  }, 30_000)

  it('scheduler 不得为绕过 Plan API 注入的未授权 carried row 创建 synthetic receipt 或结算 ledger', async () => {
    const owned = await fixture('scheduler-unauthorized-carried-row')
    const plan = await singleTaskBudgetPlan(owned, 0, 1)
    const planHash = await hashProductProductionValueV2(plan)
    const build = await db.productBuilds.where('productionId').equals(owned.productionId).first()
    expect(build?.id).toBeTruthy()
    await db.productBuilds.update(build!.id!, {
      planRevision: 1,
      planJson: canonicalProductProductionJsonV2(plan),
      planHash,
      updatedAt: Date.now(),
    })
    const payloadJson = canonicalProductProductionJsonV2({ injected: 'not-authorized-by-plan-reuse' })
    const contentHash = await hashProductProductionValueV2(JSON.parse(payloadJson))
    const now = Date.now()
    const artifactId = await db.productBuildArtifacts.add({
      projectId: owned.scope.projectId,
      worldId: owned.scope.worldId,
      workId: owned.scope.workId,
      buildId: build!.id!,
      artifactKey: 'design.game',
      requirementKey: null,
      version: 1,
      kind: 'product-design',
      mediaKind: null,
      status: 'carried-forward',
      producerRunId: null,
      producerReceiptHash: 'a'.repeat(64),
      controlEpoch: 0,
      inputHash: 'b'.repeat(64),
      contentHash,
      payloadJson,
      metadataJson: '{}',
      qualityJson: '{}',
      rightsJson: '{}',
      blobObjectId: null,
      mimeType: null,
      byteSize: new TextEncoder().encode(payloadJson).byteLength,
      parentArtifactHash: contentHash,
      carriedFrom: {
        buildNumber: build!.buildNumber,
        artifactKey: 'design.game',
        version: 1,
        contentHash,
        proofHash: 'c'.repeat(64),
      },
      createdAt: now,
      updatedAt: now,
    }) as number

    await expect(runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor: executorFor(owned, new Map(), { active: 0, peak: 0 }),
      capabilityBindings: [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'd'.repeat(64),
      }],
    })).rejects.toThrow(/carried-forward same-build lineage 不闭合/)
    expect(await db.productBuildArtifacts.get(artifactId)).toMatchObject({
      producerRunId: null,
      producerReceiptHash: 'a'.repeat(64),
    })
    const refreshed = (await db.productBuilds.get(build!.id!))!
    const ledger = JSON.parse(refreshed.budgetLedgerJson)
    expect(ledger.tasks?.['content.design']).toBeUndefined()
    expect(await db.agentRuns.where('[parentRunId+parentRelation]')
      .equals([ledger.rootRunId, 'task:content.design']).count()).toBe(0)
  })

  it('目标 Plan 已持久化但首次 cross-build carry 中断时，scheduler 重入会补齐授权复用', async () => {
    const owned = await fixture('scheduler-plan-before-cross-build-carry')
    const calls = new Map<string, number>()
    const bindings = [{
      requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: 'e'.repeat(64),
    }]
    await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor: executorFor(owned, calls, { active: 0, peak: 0 }),
      capabilityBindings: bindings,
    })
    const evolution = await beginProductProductionEvolutionV1({
      scope: owned.scope,
      productionId: owned.productionId,
      userText: '只调整音频方向，内容闭包保持不变',
      affectedLanes: ['audio'],
    })
    const production = (await db.productProductions.get(owned.productionId))!
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([owned.productionId, evolution.briefRevision]).first()
    const authorized = await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'authorize-start',
        commandId: 'scheduler-plan-before-cross-build-carry.evolution-start',
        expectedStateRevision: production.stateRevision,
        briefRevision: briefRow!.revision,
        briefHash: briefRow!.briefHash,
        authorizationNonce: 'scheduler-plan-before-cross-build-carry.click',
      },
    })
    const targetBuildId = authorized.result.buildId as number
    let injected = false
    const failFirstCarry = (_primaryKey: unknown, row: { buildId?: number; status?: string }) => {
      if (!injected && row.buildId === targetBuildId && row.status === 'carried-forward') {
        injected = true
        throw new Error('injected-after-plan-before-cross-build-carry')
      }
    }
    db.productBuildArtifacts.hook('creating', failFirstCarry)
    try {
      await expect(runProductProductionSchedulerCycleV1({
        scope: owned.scope,
        productionId: owned.productionId,
        executor: executorFor(owned, calls, { active: 0, peak: 0 }),
        capabilityBindings: bindings,
      })).rejects.toThrow('injected-after-plan-before-cross-build-carry')
    } finally {
      db.productBuildArtifacts.hook('creating').unsubscribe(failFirstCarry)
    }
    expect(injected).toBe(true)
    const persisted = (await db.productBuilds.get(targetBuildId))!
    const persistedPlan = JSON.parse(persisted.planJson) as {
      tasks: Array<{ taskKey: string; outputArtifactKeys: string[]; reuse: unknown }>
    }
    const reuseTasks = persistedPlan.tasks.filter(task => task.reuse != null)
    expect(persisted.planHash).toMatch(/^[a-f0-9]{64}$/)
    expect(reuseTasks.length).toBeGreaterThan(0)
    expect(await db.productBuildArtifacts.where('buildId').equals(targetBuildId).count()).toBe(0)

    await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor: executorFor(owned, calls, { active: 0, peak: 0 }),
      capabilityBindings: bindings,
    })
    const recovered = (await db.productBuildArtifacts.where('buildId').equals(targetBuildId).toArray())
      .filter(row => row.controlEpoch === persisted.controlEpoch && row.status === 'carried-forward')
    const expectedKeys = reuseTasks.flatMap(task => task.outputArtifactKeys).sort()
    expect(recovered.map(row => row.artifactKey).sort()).toEqual(expectedKeys)
    expect(recovered.every(row => row.producerRunId != null && row.producerReceiptHash != null)).toBe(true)
  }, 30_000)

  it.each(['parent-envelope', 'lineage-proof', 'blob-bytes'] as const)(
    'terminal verifier 后、claim 前 %s 变化会被原始 proof readset CAS 拒绝',
    async mutation => {
      const owned = await fixture(`scheduler-terminal-cas-${mutation}`)
      const calls = new Map<string, number>()
      const baseExecutor = executorFor(owned, calls, { active: 0, peak: 0 })
      const blob = mutation === 'blob-bytes'
        ? await putMediaBlobObject({
            scope: owned.scope,
            data: new TextEncoder().encode('terminal-cas-physical-bytes').buffer,
            mimeType: 'image/png',
            backend: 'indexeddb',
          })
        : null
      const executor: ProductProductionTaskExecutorV1 = async request => {
        const result = await baseExecutor(request)
        if (blob && request.task.taskKey === 'content.design') {
          result.artifacts[0] = {
            ...result.artifacts[0],
            kind: 'image',
            mediaKind: 'image',
            contentHash: blob.contentHash,
            blobObjectId: blob.id!,
            mimeType: blob.mimeType,
            byteSize: blob.byteSize,
          }
        }
        return result
      }
      const capabilityBindings = [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'f'.repeat(64),
      }]
      const partial = await runProductProductionSchedulerCycleV1({
        scope: owned.scope,
        productionId: owned.productionId,
        executor,
        capabilityBindings,
      })
      expect(partial.tasks.find(task => task.taskKey === 'content.design')?.status).toBe('completed')
      const production = (await db.productProductions.get(owned.productionId))!
      await executeProductProductionCommand({
        scope: owned.scope,
        productionId: owned.productionId,
        command: {
          type: 'pause',
          commandId: `scheduler-terminal-cas-${mutation}.pause`,
          expectedStateRevision: production.stateRevision,
          reason: '制造合法 same-build carry 后测试 terminal CAS',
        },
      })
      const paused = (await db.productProductions.get(owned.productionId))!
      await executeProductProductionCommand({
        scope: owned.scope,
        productionId: owned.productionId,
        command: {
          type: 'resume',
          commandId: `scheduler-terminal-cas-${mutation}.resume`,
          expectedStateRevision: paused.stateRevision,
        },
      })
      let injected = false
      await expect(runProductProductionUntilBlockedV1({
        scope: owned.scope,
        productionId: owned.productionId,
        executor,
        capabilityBindings,
        async onDurableBoundary(boundary, snapshot) {
          if (injected || boundary !== 'terminal.proof.checked') return
          injected = true
          const rows = await db.productBuildArtifacts.where('buildId').equals(snapshot.run.productBuildId!).toArray()
          const parent = rows.find(row => row.artifactKey === 'design.game'
            && row.status === 'invalid' && row.controlEpoch === 0)!
          const carried = rows.find(row => row.artifactKey === 'design.game'
            && row.status === 'carried-forward' && row.controlEpoch > 0)!
          if (mutation === 'parent-envelope') {
            await db.productBuildArtifacts.update(parent.id!, {
              metadataJson: canonicalProductProductionJsonV2({ changedAfterVerify: true }),
              updatedAt: Date.now(),
            })
          } else if (mutation === 'lineage-proof') {
            await db.productBuildArtifacts.update(carried.id!, {
              carriedFrom: { ...carried.carriedFrom!, proofHash: '0'.repeat(64) },
              updatedAt: Date.now(),
            })
          } else {
            const stored = await db.mediaBlobObjects.get(carried.blobObjectId!)
            const changed = stored!.data!.slice(0)
            new Uint8Array(changed)[0] ^= 0xff
            await db.mediaBlobObjects.update(stored!.id!, { data: changed })
          }
        },
      })).rejects.toThrow(/terminal CAS (Artifact|Blob) proof/)
      expect(injected).toBe(true)
      const build = await db.productBuilds.get(partial.buildId)
      expect(build?.status).toBe('building')
      expect(build?.rootTerminalReceiptHash).toBeNull()
    },
    30_000,
  )

  it('发布事务前复验完整 terminal OPFS 集合而非只复验 Runtime 媒资', async () => {
    const fakeOpfs = installFakeOpfsV1()
    try {
      const owned = await fixture('scheduler-adoption-non-runtime-opfs')
      const physical = await putMediaBlobObject({
        scope: owned.scope,
        data: new TextEncoder().encode('non-runtime-terminal-opfs-proof').buffer,
        mimeType: 'image/png',
        backend: 'indexeddb',
      })
      const baseExecutor = executorFor(owned, new Map(), { active: 0, peak: 0 })
      const executor: ProductProductionTaskExecutorV1 = async request => {
        const result = await baseExecutor(request)
        if (request.task.taskKey === 'content.design') {
          result.artifacts[0] = {
            ...result.artifacts[0],
            kind: 'image',
            mediaKind: 'image',
            contentHash: physical.contentHash,
            blobObjectId: physical.id!,
            mimeType: physical.mimeType,
            byteSize: physical.byteSize,
          }
        }
        return result
      }
      const capabilityBindings = [{
        requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: '9'.repeat(64),
      }]
      const completed = await runProductProductionUntilBlockedV1({
        scope: owned.scope,
        productionId: owned.productionId,
        executor,
        capabilityBindings,
      })
      expect(completed).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
      const stored = await db.mediaBlobObjects.get(physical.id!)
      const originalData = stored!.data!.slice(0)
      const opfsPath = `storyforge/media/v1/work-${owned.scope.workId}/${stored!.contentHash}`
      const fakePath = `/${opfsPath}`
      fakeOpfs.files.set(fakePath, originalData.slice(0))
      await db.mediaBlobObjects.update(stored!.id!, {
        backend: 'opfs',
        data: null,
        opfsPath,
        updatedAt: Date.now(),
      })
      const prepared = await prepareProductProductionAdoption({
        scope: owned.scope,
        productionId: owned.productionId,
      })
      expect(prepared.mediaAssetKeys).toEqual([])
      const command = {
        type: 'publish' as const,
        commandId: 'scheduler-adoption-non-runtime-opfs.publish',
        expectedStateRevision: prepared.intent.expectedStateRevision,
        buildNumber: prepared.intent.buildNumber,
        expectedManifestHash: prepared.intent.manifestHash,
        adoptionIntentHash: prepared.adoptionIntentHash,
      }
      let injected = false
      fakeOpfs.readCount = 0
      fakeOpfs.beforeRead = (path, readCount) => {
        // publish inspect re-proves the full terminal set once. The next read
        // is the immediately-before-transaction refresh; this Artifact is not
        // referenced by RuntimePackage.presentation.
        if (injected || readCount !== 2) return
        injected = true
        const changed = fakeOpfs.files.get(path)!.slice(0)
        new Uint8Array(changed)[0] ^= 0xff
        fakeOpfs.files.set(path, changed)
      }
      await expect(publishProductProductionBuild({
        scope: owned.scope,
        productionId: owned.productionId,
        command,
      })).rejects.toThrow(/共享媒资哈希不匹配/)
      expect(injected).toBe(true)
      expect(await db.productReleases.where('workId').equals(owned.scope.workId).count()).toBe(0)
      expect(await db.productProductionCommands
        .where('[productionId+commandId]')
        .equals([owned.productionId, command.commandId]).count()).toBe(0)

      fakeOpfs.beforeRead = null
      fakeOpfs.files.set(fakePath, originalData.slice(0))
      await expect(publishProductProductionBuild({
        scope: owned.scope,
        productionId: owned.productionId,
        command,
      })).resolves.toMatchObject({ buildId: completed.buildId, replayed: false })
    } finally {
      fakeOpfs.restore()
    }
  }, 60_000)

  it('供应商连续失败停在用户 blocker，作者重试后新 epoch 继续且错误信息不泄露密钥', async () => {
    const owned = await fixture('scheduler-user-retry')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const successExecutor = executorFor(owned, calls, concurrency)
    let injectedFailures = 0
    const executor: ProductProductionTaskExecutorV1 = async request => {
      if (request.task.taskKey === 'content.design' && injectedFailures < 2) {
        injectedFailures++
        calls.set(request.task.taskKey, (calls.get(request.task.taskKey) ?? 0) + 1)
        throw new Error('provider 503 api-key=sk-proj-supersecret123')
      }
      return successExecutor(request)
    }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    const blocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(blocked.buildStatus).toBe('recovery-required')
    const blockedBuild = (await db.productBuilds.get(blocked.buildId))!
    expect(blockedBuild.failureJson).toContain('[redacted]')
    expect(blockedBuild.failureJson).not.toContain('supersecret')

    const production = (await db.productProductions.get(owned.productionId))!
    const resolved = await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'scheduler-user-retry.resolve',
        expectedStateRevision: production.stateRevision, blockerKey: 'content.design',
        resolution: { action: 'retry', note: '作者确认重试' },
      },
    })
    expect(resolved).toMatchObject({ ok: true, result: { controlEpoch: 1, action: 'retry' } })
    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(completed.terminal).toBe(true)
    expect(calls.get('content.design')).toBe(3)
    expect([...calls.entries()].filter(([key]) => key !== 'content.design').every(([, count]) => count === 1)).toBe(true)
  }, 60_000)

  it('provider safety refusal 不自动改写或重试，第一次即暂停等待用户决定', async () => {
    const owned = await fixture('scheduler-safety-refusal')
    let calls = 0
    const executor: ProductProductionTaskExecutorV1 = async request => {
      if (request.task.taskKey === 'content.design') {
        calls += 1
        throw new Error('[product-media-adapter] provider-safety-refusal')
      }
      throw new Error('safety refusal 后不应继续其他任务')
    }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const blocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor,
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }],
    })
    expect(calls).toBe(1)
    expect(blocked.buildStatus).toBe('recovery-required')
    expect(blocked.tasks.find(task => task.taskKey === 'content.design')).toMatchObject({ status: 'blocked' })
    expect((await db.productBuilds.get(blocked.buildId))?.failureJson).toContain('provider-safety-refusal')
  }, 30_000)

  it('拒绝带未知字段或伪造结算数据的 budget ledger', () => {
    const emptyLedger = {
      schema: 'storyforge.product-production-budget-ledger', version: 1,
      rootRunId: null, rootClaim: null, tasks: {},
    }
    expect(() => assertProductProductionBudgetLedgerV1(JSON.stringify(emptyLedger))).not.toThrow()
    expect(() => assertProductProductionBudgetLedgerV1(JSON.stringify({
      ...emptyLedger,
      version: 2,
      charges: {},
      reservations: {},
    }))).not.toThrow()
    expect(() => assertProductProductionBudgetLedgerV1(JSON.stringify({
      ...emptyLedger, forgedSettlement: true,
    }))).toThrow('budget ledger 字段不精确')
    expect(() => assertProductProductionBudgetLedgerV1(JSON.stringify({
      ...emptyLedger,
      tasks: {
        'content.design': {
          runId: 1, attempt: 1, status: 'settled', idempotencyKey: '',
          candidateHash: null, terminalReceiptHash: null, passedGateIds: [],
          usage: {
            modelCalls: 1, inputTokens: 10, outputTokens: 10, mediaCalls: 0,
            costUsd: -100, durationMs: 1, storageBytes: 0,
          },
          errorCode: null,
        },
      },
    }))).toThrow('costUsd 无效')
  })
})
