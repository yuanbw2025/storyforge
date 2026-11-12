import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { verifyAcceptedProductBuildArtifactV1 } from '../../src/lib/product-production/artifact-store'
import { runProductProductionSchedulerCycleV1, runProductProductionUntilBlockedV1,
  type ProductProductionTaskExecutionInputV1, type ProductProductionTaskExecutionResultV1,
} from '../../src/lib/product-production/scheduler'
import { authorizeSFQA050ProductionV1, SFQA050_CONFIG_A } from '../helpers/sfqa050-provider-dispatch-binding'

beforeEach(async () => {
  await db.delete(); await db.open()
  window.location.href = 'http://localhost:4178/storyforge/'
  useAIConfigStore.setState({ config: { ...SFQA050_CONFIG_A }, presets: [], taskRoutes: {} })
})
afterEach(() => { vi.restoreAllMocks(); db.close() })

it.each(['exact', 'delta', 'outside'] as const)('045 applies the frozen %s billing boundary to original paid output', async scenario => {
  const owned = await authorizeSFQA050ProductionV1('ttrpg-open')
  const task = owned.plan.tasks.find(row => row.taskKey === 'ttrpg.open.source-facts')!
  const delta = Math.min(128, Math.ceil(task.budgetReservation.outputTokens * .02))
  const outputTokens = task.budgetReservation.outputTokens + (scenario === 'exact' ? 0 : delta + (scenario === 'outside' ? 1 : 0))
  const original = JSON.stringify({ schema: 'storyforge.ttrpg-open-source-facts', version: 1,
    factPolicy: owned.brief.ttrpgOpen!.settings.openAuthoring.factPolicy })
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
    choices: [{ message: { content: original }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: outputTokens, total_tokens: 10 + outputTokens },
  }), { headers: { 'content-type': 'application/json' } }))
  const cycle = await runProductProductionSchedulerCycleV1({ ...owned, suppliedPlan: owned.plan })
  const artifact = await db.productBuildArtifacts.where('buildId').equals(cycle.buildId)
    .and(row => row.artifactKey === task.outputArtifactKeys[0] && row.status === 'accepted').first()
  const before = (await db.productBuilds.get(cycle.buildId))!
  expect(JSON.parse(before.budgetLedgerJson).attempts).toContainEqual(expect.objectContaining({ usageKnown: true,
    taskKey: task.taskKey, usage: expect.objectContaining({ outputTokens }) }))
  expect(await db.agentRunArtifacts.where('projectId').equals(owned.scope.projectId)
    .and(row => row.artifactKind === 'raw-response' && row.content === original).count()).toBeGreaterThan(0)
  const count = fetch.mock.calls.length
  expect(count).toBe(1)
  if (scenario === 'outside') {
    expect(artifact).toBeUndefined()
    expect(cycle.buildStatus).toBe('recovery-required')
    expect(before.failureJson).toContain('task-budget-exceeded')
    db.close(); await db.open()
    await runProductProductionSchedulerCycleV1(owned)
    expect(fetch).toHaveBeenCalledTimes(count)
    expect((await db.productBuilds.get(cycle.buildId))!.budgetLedgerJson).toBe(before.budgetLedgerJson)
    return
  }
  expect(artifact).toBeDefined()
  const ref = { scope: owned.scope, buildId: cycle.buildId, artifactKey: artifact!.artifactKey,
    version: artifact!.version, contentHash: artifact!.contentHash }
  await expect(verifyAcceptedProductBuildArtifactV1(ref)).resolves.toMatchObject({ id: artifact!.id })
  db.close(); await db.open()
  await expect(verifyAcceptedProductBuildArtifactV1(ref)).resolves.toMatchObject({ id: artifact!.id })
  expect(fetch).toHaveBeenCalledTimes(count)
  expect((await db.productBuilds.get(cycle.buildId))!.budgetLedgerJson).toBe(before.budgetLedgerJson)
})

it('045 keeps the approved Build cap exact even when a measured output is within the task billing delta', async () => {
  const owned = await authorizeSFQA050ProductionV1('avg')
  const hardLimit = owned.brief.productionBudget.maximumOutputTokens
  expect(hardLimit).toBeGreaterThanOrEqual(1_000)
  const suppliedPlan = { ...owned.plan, tasks: owned.plan.tasks.map(task => ({ ...task,
    budgetReservation: { ...task.budgetReservation, outputTokens: task.taskKey === 'content.design' ? hardLimit : 0 },
  })) }
  const executor = vi.fn(async (input: ProductProductionTaskExecutionInputV1): Promise<ProductProductionTaskExecutionResultV1> => {
    const paid = input.task.taskKey === 'content.design'
    return { artifacts: input.task.outputArtifactKeys.map(artifactKey => ({ artifactKey, kind: 'product-design',
      payload: { taskKey: input.task.taskKey }, rights: { origin: 'isolated-engineering-fixture', license: 'test', commercialUse: true } })),
    passedGateIds: [...input.task.acceptanceGateIds], usage: { modelCalls: paid ? 1 : 0, inputTokens: paid ? 10 : 0,
      outputTokens: paid ? hardLimit + 1 : 0, mediaCalls: 0, costUsd: 0, durationMs: 1, storageBytes: 0 } }
  })
  const blocked = await runProductProductionUntilBlockedV1({ ...owned, suppliedPlan, executor })
  const build = (await db.productBuilds.get(blocked.buildId))!
  expect(blocked.buildStatus).toBe('recovery-required')
  expect(build.failureJson).toContain(`Build lifetime budget 不足:outputTokens=${hardLimit + 1}/${hardLimit}`)
  expect(JSON.parse(build.budgetLedgerJson).attempts).toContainEqual(expect.objectContaining({ taskKey: 'content.design',
    usageKnown: true, usage: expect.objectContaining({ outputTokens: hardLimit + 1 }) }))
  expect(executor.mock.calls.filter(([input]) => input.task.taskKey === 'content.design')).toHaveLength(1)
  const rejected = suppliedPlan.tasks.find(task => task.taskKey === 'content.design')!
  expect(await db.productBuildArtifacts.where('buildId').equals(blocked.buildId).and(row =>
    rejected.outputArtifactKeys.includes(row.artifactKey) && row.status === 'accepted').count()).toBe(0)
})
