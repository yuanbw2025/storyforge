import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import {
  ProductProductionDraftRejectedErrorV1,
  ProductProductionResultUnknownErrorV1,
  runProductProductionSchedulerCycleV1,
  runProductProductionUntilBlockedV1,
  type ProductProductionTaskExecutionInputV1,
  type ProductProductionTaskExecutionResultV1,
} from '../../src/lib/product-production/scheduler'
import { authorizeSFQA050ProductionV1, SFQA050_CONFIG_A } from '../helpers/sfqa050-provider-dispatch-binding'

beforeEach(async () => {
  await db.delete(); await db.open()
  window.location.href = 'http://localhost:4178/storyforge/'
  useAIConfigStore.setState({ config: { ...SFQA050_CONFIG_A }, presets: [], taskRoutes: {} })
})
afterEach(() => { vi.restoreAllMocks(); db.close() })

// Synthetic executor output; all Plan/claim/Run/ledger/admission paths are real.
function result(input: ProductProductionTaskExecutionInputV1): ProductProductionTaskExecutionResultV1 {
  const kind = input.task.taskKey === 'media.requirements' ? 'asset-manifest'
    : input.task.taskKey === 'content.narrative' ? 'narrative' : 'product-design'
  return { artifacts: input.task.outputArtifactKeys.map(artifactKey => ({ artifactKey, kind,
    payload: { taskKey: input.task.taskKey }, rights: { origin: 'isolated-engineering-fixture', license: 'test', commercialUse: true } })),
  passedGateIds: [...input.task.acceptanceGateIds],
  usage: { modelCalls: input.task.executionMode === 'model' ? 1 : 0,
    inputTokens: input.task.executionMode === 'model' ? 10 : 0,
    outputTokens: input.task.executionMode === 'model' ? 11 : 0, mediaCalls: 0,
    costUsd: input.task.executionMode === 'model' ? .012 : 0, durationMs: 1, storageBytes: 0 } }
}

it.each([
  { retry: false, cleanup: false, outcome: 'success' }, { retry: true, cleanup: false, outcome: 'success' },
  { retry: true, cleanup: true, outcome: 'success' }, { retry: true, cleanup: false, outcome: 'paid-failure' },
  { retry: true, cleanup: false, outcome: 'unknown' }, { retry: false, cleanup: false, outcome: 'cancelled' },
  { retry: false, cleanup: false, outcome: 'accepted-first' },
] as const)('040 settles a stopped sibling: retry=$retry, cleanup=$cleanup, $outcome', async ({ retry: retryBeforeReply, cleanup, outcome }) => {
  // The real Agnes adapter intentionally serializes its free-tier text lane.
  // Freeze a different synthetic provider so the approved two-slot Plan runs.
  useAIConfigStore.setState({ config: { ...SFQA050_CONFIG_A, provider: 'openai' } })
  const owned = await authorizeSFQA050ProductionV1('avg')
  const plan = { ...owned.plan, concurrency: { ...owned.plan.concurrency,
    maximumCostBearingTasks: 2, maximumTextProviderTasks: 2 } }
  const siblings = ['content.narrative', 'media.requirements'].map(key => plan.tasks.find(task => task.taskKey === key)!)
  expect(siblings.every(Boolean), JSON.stringify(plan.tasks.map(task => task.taskKey))).toBe(true)
  let late: ProductProductionTaskExecutionInputV1 | undefined
  let releaseLate!: () => void
  const waiting = new Promise<void>(resolve => { releaseLate = resolve })
  const calls: string[] = []
  const executor = async (input: ProductProductionTaskExecutionInputV1) => {
    calls.push(input.task.taskKey)
    if (input.task.taskKey === 'content.narrative') {
      late = input
      if (outcome !== 'accepted-first') await waiting
      if (outcome === 'paid-failure') throw new ProductProductionDraftRejectedErrorV1('isolated late paid failure', result(input).usage)
      if (outcome === 'unknown') throw new ProductProductionResultUnknownErrorV1()
      if (outcome === 'cancelled') throw Object.assign(new DOMException('isolated paid abort', 'AbortError'), {
        productProductionUsage: result(input).usage,
      })
    }
    if (input.task.taskKey === 'media.requirements') {
      await expect.poll(() => late != null).toBe(true)
      if (outcome === 'accepted-first') await expect.poll(async () => {
        const build = (await db.productBuilds.get(input.buildId))!
        return JSON.parse(build.budgetLedgerJson).tasks['content.narrative']?.status
      }).toBe('settled')
      throw new ProductProductionDraftRejectedErrorV1('isolated sibling blocker', result(input).usage)
    }
    return result(input)
  }
  for (let cycle = 0; cycle < plan.tasks.length; cycle++) {
    const build = (await db.productBuilds.toArray())[0]
    const tasks = build ? JSON.parse(build.budgetLedgerJson).tasks ?? {} : {}
    if (siblings.every(task => task.dependsOn.every(key => tasks[key]?.status === 'settled'))) break
    const first = await runProductProductionSchedulerCycleV1({ ...owned, suppliedPlan: plan, executor })
    expect(first.buildStatus, JSON.stringify({ first, calls })).toBe('building')
  }
  const cycle = runProductProductionSchedulerCycleV1({ ...owned, suppliedPlan: plan, executor })
  let replacementTasks: unknown
  try {
    await expect.poll(async () => (await db.productBuilds.toArray())[0]?.status).toMatch(/^(failed|recovery-required)$/)
    expect(late).toBeDefined()
    if (cleanup) {
      const stoppedExecutor = vi.fn(executor)
      await runProductProductionSchedulerCycleV1({ ...owned, executor: stoppedExecutor })
      expect(stoppedExecutor).not.toHaveBeenCalled()
      expect((await readAgentRunV1(owned.scope, late!.taskRunId!)).projection.state).toBe('cancelled')
    }
    if (retryBeforeReply) {
      const production = (await db.productProductions.get(owned.productionId))!
      await expect(executeProductProductionCommand({ scope: owned.scope, productionId: owned.productionId,
        command: { type: 'resolve-blocker', commandId: 'sfqa040.author.retry', expectedStateRevision: production.stateRevision,
          blockerKey: 'media.requirements', resolution: { action: 'retry', note: 'isolated explicit author retry' } },
      })).resolves.toMatchObject({ ok: true, result: { controlEpoch: 1 } })
      // Let the real scheduler install its replacement Plan and claim, then
      // interrupt before a new provider can dispatch. The old request is live.
      const newExecutor = vi.fn(executor)
      await expect(runProductProductionSchedulerCycleV1({ ...owned, executor: newExecutor,
        onDurableBoundary: boundary => { if (boundary === 'task.claimed') throw new Error('isolated replacement claim') },
      })).rejects.toThrow('isolated replacement claim')
      expect(newExecutor).not.toHaveBeenCalled()
      const replacement = (await db.productBuilds.get(late!.buildId))!
      expect(JSON.parse(replacement.planJson).controlEpoch).toBe(1)
      const ledger = JSON.parse(replacement.budgetLedgerJson)
      replacementTasks = ledger.tasks
      expect(ledger.attempts).toContainEqual(expect.objectContaining({ controlEpoch: 0,
        runId: late!.taskRunId, attempt: late!.attempt, usageKnown: false,
        usage: expect.objectContaining({ modelCalls: 1 }) }))
    }
  } finally {
    releaseLate()
  }
  const stopped = await cycle
  const build = (await db.productBuilds.get(stopped.buildId))!
  const ledger = JSON.parse(build.budgetLedgerJson)
  if (retryBeforeReply) expect(ledger.tasks).toEqual(replacementTasks)
  expect(ledger.attempts.filter((entry: { runId: number }) => entry.runId === late!.taskRunId)).toEqual([
    expect.objectContaining({ taskKey: 'content.narrative', controlEpoch: late!.controlEpoch,
      runId: late!.taskRunId, attempt: late!.attempt, usageKnown: outcome !== 'unknown',
      usage: outcome === 'unknown' ? expect.objectContaining({ modelCalls: 1 }) : result(late!).usage }),
  ])
  expect(await db.productBuildArtifacts.where('buildId').equals(build.id!).and(row =>
    row.artifactKey === late!.task.outputArtifactKeys[0]).count()).toBe(outcome === 'accepted-first' ? 1 : 0)
  expect((await readAgentRunV1(owned.scope, late!.taskRunId!)).projection.state)
    .toBe(outcome === 'accepted-first' ? 'completed' : 'cancelled')
  db.close(); await db.open()
  if (!retryBeforeReply) await runProductProductionSchedulerCycleV1({ ...owned, executor })
  expect((await db.productBuilds.get(build.id!))!.budgetLedgerJson).toBe(build.budgetLedgerJson)
  expect(calls.filter(key => key === 'content.narrative')).toHaveLength(1)
})

it('040 recovers exact observed paid usage from the durable response boundary without redispatch', async () => {
  const owned = await authorizeSFQA050ProductionV1('avg')
  let paid: ProductProductionTaskExecutionInputV1 | undefined
  const executor = vi.fn(async (input: ProductProductionTaskExecutionInputV1) => {
    if (input.task.taskKey === 'content.design') paid = input
    return result(input)
  })
  await expect(runProductProductionUntilBlockedV1({ ...owned, executor, onDurableBoundary: (boundary, snapshot) => {
    if (boundary === 'provider.responded' && snapshot.contract.scope.productProduction?.taskKey === 'content.design') {
      throw new Error('isolated loss after durable response')
    }
  } })).rejects.toThrow('isolated loss after durable response')
  expect(paid).toBeDefined()
  const before = (await db.productBuilds.get(paid!.buildId))!
  expect(JSON.parse(before.budgetLedgerJson).tasks['content.design'].status).toBe('claimed')
  const run = await readAgentRunV1(owned.scope, paid!.taskRunId!)
  expect(run.projection.steps['content.design'].candidateHash).toBeUndefined()
  db.close(); await db.open()
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + paid!.task.timeoutMs + 5_001)
  const calls = executor.mock.calls.length
  const resumed = await runProductProductionSchedulerCycleV1({ ...owned, executor })
  expect(resumed.buildStatus).toBe('recovery-required')
  const settled = (await db.productBuilds.get(paid!.buildId))!
  expect(JSON.parse(settled.budgetLedgerJson).attempts.filter((entry: { runId: number }) => entry.runId === paid!.taskRunId))
    .toEqual([expect.objectContaining({ controlEpoch: paid!.controlEpoch, attempt: paid!.attempt,
      usageKnown: true, usage: result(paid!).usage })])
  await runProductProductionSchedulerCycleV1({ ...owned, executor })
  expect(executor).toHaveBeenCalledTimes(calls)
  expect((await db.productBuilds.get(paid!.buildId))!.budgetLedgerJson).toBe(settled.budgetLedgerJson)
})

it('040 resolves a timed-out attempt with its late measured receipt while keeping the result out of production', async () => {
  const owned = await authorizeSFQA050ProductionV1('avg')
  const suppliedPlan = { ...owned.plan, tasks: owned.plan.tasks.map(task => task.taskKey === 'content.design'
    ? { ...task, timeoutMs: 20 } : task) }
  let late: ProductProductionTaskExecutionInputV1 | undefined
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  const executor = vi.fn(async (input: ProductProductionTaskExecutionInputV1) => {
    if (input.task.taskKey === 'content.design') { late = input; await wait }
    return result(input)
  })
  const stopped = await runProductProductionUntilBlockedV1({ ...owned, suppliedPlan, executor })
  expect(stopped.buildStatus).toBe('recovery-required')
  expect(late).toBeDefined()
  const readAttempts = async () => JSON.parse((await db.productBuilds.get(stopped.buildId))!.budgetLedgerJson).attempts
    .filter((attempt: { runId: number }) => attempt.runId === late!.taskRunId)
  expect(await readAttempts()).toEqual([expect.objectContaining({ usageKnown: false,
    errorCode: 'task-result-unknown', usage: expect.objectContaining({ modelCalls: 1 }) })])
  release()
  await expect.poll(readAttempts).toEqual([expect.objectContaining({ usageKnown: true, usage: result(late!).usage })])
  const count = executor.mock.calls.length
  db.close(); await db.open()
  await runProductProductionSchedulerCycleV1({ ...owned, executor })
  expect(executor).toHaveBeenCalledTimes(count)
  expect(await db.productBuildArtifacts.where('buildId').equals(stopped.buildId).and(row =>
    late!.task.outputArtifactKeys.includes(row.artifactKey)).count()).toBe(0)
})
