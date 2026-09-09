import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { appendAgentRunEventV1, readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readContextGatewayManifestV3ForAttemptV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { openWorldSemanticResourceCatalogV1 } from '../../src/lib/context-gateway/world-release-client'
import { recordAgentRunArtifactV1 } from '../../src/lib/memory/artifact-store'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
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
import { readProductProductionTaskEvidenceV1 } from '../../src/lib/product-production/service'
import { readProductProductionRepairFeedback } from '../../src/lib/product-production/context'

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

  it('请求结果未知时不自动重试且保留预留，作者显式开启新epoch后预算闸门阻止可能重复计费', async () => {
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
        resolution: { action: 'retry', note: '作者已核对供应商后台，显式确认重试' },
      },
    })
    const secondPlan = await singleTaskBudgetPlan(owned, 1, 2)
    const second = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: secondPlan,
      capabilityBindings,
      executor: async () => {
        calls += 1
        throw new Error('保守预算闸门前不得再次调用 executor')
      },
    })
    expect(calls).toBe(1)
    expect(second.buildStatus).toBe('recovery-required')
    expect(second.controlEpoch).toBe(1)
    const secondBuild = (await db.productBuilds.get(second.buildId))!
    expect(JSON.parse(secondBuild.failureJson)).toMatchObject({
      taskKey: 'content.design',
      code: 'brief-production-budget-exhausted',
      violations: ['task-model-calls-depleted'],
      failureProvenance: { controlEpoch: 1, planHash: second.planHash, attempt: 1 },
    })
    const secondLedger = JSON.parse(secondBuild.budgetLedgerJson)
    expect(Object.values(secondLedger.reservations)).toHaveLength(1)
    expect(Object.values(secondLedger.charges)).toHaveLength(0)
  })

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
    'provider.requested边界并发%s后复验epoch/status，绝不进入executor或保留未派发预算',
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
        },
      })

      expect(commandApplied).toBe(true)
      expect(executorCalls).toBe(0)
      expect(projection.buildStatus).toBe(control === 'pause' ? 'paused' : 'cancelled')
      const build = (await db.productBuilds.get(projection.buildId))!
      const ledger = JSON.parse(build.budgetLedgerJson)
      expect(Object.values(ledger.charges)).toHaveLength(0)
      expect(Object.values(ledger.reservations)).toHaveLength(0)
      const child = await db.agentRuns.where('[parentRunId+parentRelation]')
        .equals([projection.rootRunId, `task:${task.taskKey}`]).first()
      expect(child?.status).toBe('cancelled')
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
  }, 30_000)

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
