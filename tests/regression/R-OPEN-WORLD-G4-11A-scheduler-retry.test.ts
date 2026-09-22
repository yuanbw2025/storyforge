import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { appendAgentRunEventV1, readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { db } from '../../src/lib/db/schema'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import {
  ProductProductionRetryableExecutionErrorV1,
  runProductProductionSchedulerCycleV1,
  type ProductProductionTaskExecutorV1,
} from '../../src/lib/product-production/scheduler'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

async function fixture() {
  const owned = await seedCurrentProductWorld('open-world-p9-scheduler-retry')
  const suggestions = await suggestProductStartingPoints({
    scope: owned.scope,
    worldReleaseId: owned.release.id!,
  })
  const draftedBrief = await draftProductProductionBriefV3({
    scope: owned.scope,
    worldReleaseId: owned.release.id!,
    suggestionKey: suggestions.suggestions[0]!.suggestionKey,
    productType: 'avg',
    scale: 'scene',
    visualLevel: 'none',
    audioLevel: 'none',
    requiredFacts: ['验证有子步骤的模型任务可在同一Run恢复'],
    forbiddenChanges: ['不得写回世界正式表'],
  })
  const brief = {
    ...draftedBrief,
    productionBudget: {
      ...draftedBrief.productionBudget,
      maximumModelCalls: 160,
      maximumInputTokens: 200_000,
      maximumOutputTokens: 100_000,
      maximumCostUsd: 20,
    },
  }
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent',
      commandId: 'open-world-p9-scheduler-retry.intent',
      productionKey: 'open-world-p9-scheduler-retry.production',
      productType: 'avg',
      worldReleaseId: owned.release.id!,
      userText: '验证P9分片调度恢复',
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope,
    productionId: created.productionId,
    command: {
      type: 'save-brief-revision',
      commandId: 'open-world-p9-scheduler-retry.brief',
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
      commandId: 'open-world-p9-scheduler-retry.start',
      expectedStateRevision: 1,
      briefRevision: 1,
      briefHash: saved.result.briefHash as string,
      authorizationNonce: 'open-world-p9-scheduler-retry.click',
    },
  })
  const base = await createProductProductionPlanV3({
    buildNumber: 1,
    briefHash: saved.result.briefHash as string,
    brief,
  })
  const source = base.tasks.find(task => task.taskKey === 'content.design')!
  const task = {
    ...source,
    maxAttempts: 2,
    budgetReservation: {
      ...source.budgetReservation,
      modelCalls: 129,
      inputTokens: 36_000,
      outputTokens: 50_000,
      maximumCostUsd: 12.9,
    },
  }
  return {
    ...owned,
    brief,
    productionId: created.productionId,
    suppliedPlan: { ...base, tasks: [task], terminalTaskKey: task.taskKey },
  }
}

async function appendChildFailure(input: {
  scope: Awaited<ReturnType<typeof fixture>>['scope']
  runId: number
}) {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const stepId = 'content.design.fragment.scene.00001'
  snapshot = await appendAgentRunEventV1({
    scope: input.scope,
    runId: input.runId,
    type: 'step.scheduled',
    payload: { stepId },
    expectedLastSequence: snapshot.projection.lastSequence,
  })
  snapshot = await appendAgentRunEventV1({
    scope: input.scope,
    runId: input.runId,
    type: 'step.started',
    payload: { stepId, attempt: 1 },
    expectedLastSequence: snapshot.projection.lastSequence,
  })
  await appendAgentRunEventV1({
    scope: input.scope,
    runId: input.runId,
    type: 'step.failed',
    payload: {
      stepId,
      attempt: 1,
      code: 'provider-transient',
      retryable: true,
      category: 'unknown',
      action: 'retry',
    },
    expectedLastSequence: snapshot.projection.lastSequence,
  })
}

async function appendChildSuccess(input: {
  scope: Awaited<ReturnType<typeof fixture>>['scope']
  runId: number
}) {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const stepId = 'content.design.fragment.scene.00001'
  const candidateHash = await hashProductProductionValueV2('recovered-child-fragment')
  snapshot = await appendAgentRunEventV1({
    scope: input.scope,
    runId: input.runId,
    type: 'step.started',
    payload: { stepId, attempt: 2 },
    expectedLastSequence: snapshot.projection.lastSequence,
  })
  snapshot = await appendAgentRunEventV1({
    scope: input.scope,
    runId: input.runId,
    type: 'candidate.persisted',
    payload: { stepId, attempt: 2, candidateHash, requiresConfirmation: false },
    expectedLastSequence: snapshot.projection.lastSequence,
  })
  await appendAgentRunEventV1({
    scope: input.scope,
    runId: input.runId,
    type: 'step.succeeded',
    payload: { stepId, attempt: 2, outputHash: candidateHash },
    expectedLastSequence: snapshot.projection.lastSequence,
  })
}

describe('R-OPEN-WORLD-G4-11A · P9 child-step scheduler recovery', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  beforeEach(async () => {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map(table => table.clear()))
    })
  })
  afterAll(() => db.close())

  it('晚期子步骤失败后只预留剩余预算，并在同一Run累计真实usage与比例费用上界', async () => {
    const input = await fixture()
    const runIds: number[] = []
    let calls = 0
    const executor: ProductProductionTaskExecutorV1 = async request => {
      calls += 1
      runIds.push(request.taskRunId!)
      if (calls === 1) {
        await appendChildFailure({ scope: input.scope, runId: request.taskRunId! })
        throw new ProductProductionRetryableExecutionErrorV1('HTTP 503 transient', {
          modelCalls: 100,
          inputTokens: 30_000,
          outputTokens: 30_000,
          mediaCalls: 0,
          costUsd: null,
          durationMs: 100_000,
          storageBytes: 0,
        })
      }
      await appendChildSuccess({ scope: input.scope, runId: request.taskRunId! })
      return {
        artifacts: [{
          artifactKey: request.task.outputArtifactKeys[0]!,
          kind: 'product-design',
          payload: { recovered: true },
          rights: { origin: 'p9-child-retry-regression' },
        }],
        passedGateIds: [...request.task.acceptanceGateIds],
        usage: {
          modelCalls: 29,
          inputTokens: 6_000,
          outputTokens: 10_000,
          mediaCalls: 0,
          costUsd: null,
          durationMs: 29_000,
          storageBytes: 0,
        },
      }
    }
    const request = {
      scope: input.scope,
      productionId: input.productionId,
      suppliedPlan: input.suppliedPlan,
      capabilityBindings: [{
        requirementKey: input.brief.capabilityRequirements[0]!.requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }],
      executor,
    }

    const first = await runProductProductionSchedulerCycleV1(request)
    expect(first.tasks).toEqual([expect.objectContaining({
      taskKey: 'content.design',
      status: 'retry-ready',
      attempt: 1,
    })])
    const second = await runProductProductionSchedulerCycleV1(request)
    expect(second.tasks).toEqual([expect.objectContaining({
      taskKey: 'content.design',
      status: 'completed',
      attempt: 2,
    })])
    expect(calls).toBe(2)
    expect(new Set(runIds).size).toBe(1)
    expect(second.budget.usage).toMatchObject({
      modelCalls: 129,
      inputTokens: 36_000,
      outputTokens: 40_000,
      costUsd: null,
    })

    const build = (await db.productBuilds.where('productionId').equals(input.productionId).first())!
    const ledger = JSON.parse(build.budgetLedgerJson) as {
      version: number
      tasks: Record<string, { runId: number; attempt: number; usage: { modelCalls: number } | null }>
      attempts: Array<{
        runId: number
        attempt: number
        taskKey: string
        usage: { modelCalls: number } | null
      }>
    }
    expect(ledger.tasks['content.design']).toMatchObject({
      runId: runIds[0],
      attempt: 2,
    })
    if (ledger.version === 2) {
      const attempts = ledger.attempts.filter(attempt => attempt.taskKey === 'content.design')
      expect(attempts).toHaveLength(2)
      expect(new Set(attempts.map(attempt => attempt.attempt))).toEqual(new Set([1, 2]))
      expect(attempts.reduce((sum, attempt) => sum + (attempt.usage?.modelCalls ?? 0), 0)).toBe(129)
      expect(attempts.reduce((sum, attempt) => sum + (attempt.usage?.modelCalls ?? 0), 0))
        .toBeLessThanOrEqual(input.brief.productionBudget.maximumModelCalls)
    } else {
      expect(ledger.tasks['content.design']!.usage?.modelCalls).toBe(129)
    }
  })

  it('重试已付用量超过剩余任务预算时保留charge但拒绝候选且不再重试', async () => {
    const input = await fixture()
    let calls = 0
    const executor: ProductProductionTaskExecutorV1 = async request => {
      calls += 1
      if (calls === 1) {
        await appendChildFailure({ scope: input.scope, runId: request.taskRunId! })
        throw new ProductProductionRetryableExecutionErrorV1('HTTP 503 transient', {
          modelCalls: 100,
          inputTokens: 30_000,
          outputTokens: 30_000,
          mediaCalls: 0,
          costUsd: null,
          durationMs: 100_000,
          storageBytes: 0,
        })
      }
      expect(request.attemptBudgetReservation).toMatchObject({
        modelCalls: 29,
        inputTokens: 6_000,
        outputTokens: 20_000,
        maximumCostUsd: expect.closeTo(2.9),
      })
      await appendChildSuccess({ scope: input.scope, runId: request.taskRunId! })
      return {
        artifacts: [{
          artifactKey: request.task.outputArtifactKeys[0]!,
          kind: 'product-design',
          payload: { mustNotBeAccepted: true },
          rights: { origin: 'p9-child-retry-over-budget-regression' },
        }],
        passedGateIds: [...request.task.acceptanceGateIds],
        usage: {
          modelCalls: 30,
          inputTokens: 6_001,
          outputTokens: 10_000,
          mediaCalls: 0,
          costUsd: null,
          durationMs: 30_000,
          storageBytes: 0,
        },
      }
    }
    const request = {
      scope: input.scope,
      productionId: input.productionId,
      suppliedPlan: input.suppliedPlan,
      capabilityBindings: [{
        requirementKey: input.brief.capabilityRequirements[0]!.requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }],
      executor,
    }

    const first = await runProductProductionSchedulerCycleV1(request)
    expect(first.tasks[0]).toMatchObject({ status: 'retry-ready', attempt: 1 })
    const second = await runProductProductionSchedulerCycleV1(request)
    expect(second.tasks[0]).toMatchObject({ status: 'blocked', attempt: 2 })
    expect(second.tasks[0]?.status).not.toBe('completed')
    expect(second.buildStatus).toBe('recovery-required')
    expect(calls).toBe(2)

    const build = (await db.productBuilds.where('productionId').equals(input.productionId).first())!
    const ledger = JSON.parse(build.budgetLedgerJson) as {
      version: number
      attempts: Array<{
        taskKey: string
        usage: { modelCalls: number; inputTokens: number } | null
      }>
    }
    expect(ledger.version).toBe(2)
    const attempts = ledger.attempts.filter(attempt => attempt.taskKey === 'content.design')
    expect(attempts).toHaveLength(2)
    expect(attempts.reduce((sum, attempt) => sum + (attempt.usage?.modelCalls ?? 0), 0)).toBe(130)
    expect(attempts.reduce((sum, attempt) => sum + (attempt.usage?.inputTokens ?? 0), 0)).toBe(36_001)
    expect(await db.productBuildArtifacts.where('buildId').equals(build.id!).count()).toBe(0)
    expect(JSON.parse(build.failureJson)).toMatchObject({
      taskKey: 'content.design',
      code: 'task-budget-exceeded',
      attempt: 2,
    })
  })

  it('重试异常携带的已付usage超过剩余预算时同样结算charge并失败关闭', async () => {
    const input = await fixture()
    let calls = 0
    const executor: ProductProductionTaskExecutorV1 = async () => {
      calls += 1
      throw new ProductProductionRetryableExecutionErrorV1(`retryable attempt ${calls}`, calls === 1
        ? {
            modelCalls: 100,
            inputTokens: 30_000,
            outputTokens: 30_000,
            mediaCalls: 0,
            costUsd: null,
            durationMs: 100_000,
            storageBytes: 0,
          }
        : {
            modelCalls: 30,
            inputTokens: 6_001,
            outputTokens: 10_000,
            mediaCalls: 0,
            costUsd: null,
            durationMs: 30_000,
            storageBytes: 0,
          })
    }
    const request = {
      scope: input.scope,
      productionId: input.productionId,
      suppliedPlan: input.suppliedPlan,
      capabilityBindings: [{
        requirementKey: input.brief.capabilityRequirements[0]!.requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }],
      executor,
    }

    expect((await runProductProductionSchedulerCycleV1(request)).tasks[0])
      .toMatchObject({ status: 'retry-ready', attempt: 1 })
    const rejected = await runProductProductionSchedulerCycleV1(request)
    expect(rejected.tasks[0]).toMatchObject({ status: 'blocked', attempt: 2 })
    await runProductProductionSchedulerCycleV1(request)
    expect(calls).toBe(2)

    const build = (await db.productBuilds.where('productionId').equals(input.productionId).first())!
    const ledger = JSON.parse(build.budgetLedgerJson) as {
      attempts: Array<{
        taskKey: string
        usage: { modelCalls: number; inputTokens: number } | null
      }>
    }
    const attempts = ledger.attempts.filter(attempt => attempt.taskKey === 'content.design')
    expect(attempts).toHaveLength(2)
    expect(attempts.reduce((sum, attempt) => sum + (attempt.usage?.modelCalls ?? 0), 0)).toBe(130)
    expect(attempts.reduce((sum, attempt) => sum + (attempt.usage?.inputTokens ?? 0), 0)).toBe(36_001)
    expect(await db.productBuildArtifacts.where('buildId').equals(build.id!).count()).toBe(0)
    expect(JSON.parse(build.failureJson)).toMatchObject({
      taskKey: 'content.design',
      code: 'task-budget-exceeded',
      attempt: 2,
    })
  })
})
