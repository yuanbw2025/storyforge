import { createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1 } from '../../src/lib/product-production/production-executor'
/** Exact normal Plan and real durable Run/command/ledger APIs in fake IndexedDB.
 * The transport is simulated; no real provider or author data is touched. */
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { openProductionFixtureV1 } from '../helpers/open-ttrpg-production'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { readProductProductionDetailsV1, retryProductProductionBlockerV1 } from '../../src/lib/product-production/service'
import { appendAgentRunEventV1, readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { canonicalProductProductionJsonV2 as stable } from '../../src/lib/product-production/hash'
import { runProductProductionSchedulerCycleV1, runProductProductionUntilBlockedV1, assertProductProductionBudgetLedgerV1,
  ProductProductionResultUnknownErrorV1, productProductionFailureNeedsProviderAccountingV1, type ProductProductionTaskExecutorV1 } from '../../src/lib/product-production/scheduler'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); db.close() })

async function authorized() {
  const { scope, productionId, brief } = await openProductionFixtureV1()
  const previous = (await db.productProductions.get(productionId))!
  const saved = await executeProductProductionCommand({ scope, productionId, command: { type: 'save-brief-revision',
    commandId: 'timeout-accounting.save', expectedStateRevision: previous.stateRevision,
    parentRevision: previous.currentBriefRevision, brief } })
  expect(saved.ok).toBe(true)
  const ready = (await db.productProductions.get(productionId))!
  const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([productionId, ready.currentBriefRevision!]).first())!
  expect((await executeProductProductionCommand({ scope, productionId, command: { type: 'authorize-start',
    commandId: 'timeout-accounting.start', expectedStateRevision: ready.stateRevision,
    briefRevision: row.revision, briefHash: row.briefHash, authorizationNonce: 'explicit.test.author' } })).ok).toBe(true)
  const plan = await createProductProductionPlanV3({ brief, briefHash: row.briefHash, buildNumber: 1, controlEpoch: 0 })
  const requirementKey = brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey
  return { scope, productionId, brief, plan, capabilityBindings: [{ requirementKey, adapterId: 'configured-text.v1', bindingHash: 'a'.repeat(64) }] }
}

it.each((['deadline', 'legacy-retry', 'abandoned'] as const).flatMap(mode => (['retry', 'author-edit'] as const).map(action => [mode, action] as const)))('%s / %s requires exact accounting and resumes only after explicit booking', async (mode, action) => {
  const data = await authorized(), taskKey = 'ttrpg.open.source-facts'
  const executor = vi.fn<ProductProductionTaskExecutorV1>(async () => await new Promise(() => {}))
  const input = { ...data, suppliedPlan: data.plan, executor }
  if (mode === 'deadline') {
    const realTimer = globalThis.setTimeout.bind(globalThis), deadline = data.plan.tasks[0].timeoutMs
    const timerSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: TimerHandler, ms?: number, ...args: unknown[]) => realTimer(handler, ms === deadline ? 10 : ms, ...args)) as typeof globalThis.setTimeout)
    await runProductProductionUntilBlockedV1(input)
    timerSpy.mockRestore()
    expect(executor).toHaveBeenCalledTimes(1)
  } else {
    // Reconstruct a historical on-disk boundary using actual current owner,
    // Plan, Run and reservation identities. No production parser is weakened.
    await expect(runProductProductionSchedulerCycleV1({ ...input, onDurableBoundary: boundary => {
      if (boundary === 'provider.requested') throw new Error('simulated prior process loss')
    } })).rejects.toThrow('simulated prior process loss')
    expect(executor).not.toHaveBeenCalled()
    const build = (await db.productBuilds.where('productionId').equals(data.productionId).first())!
    if (mode === 'legacy-retry') {
      const ledger = JSON.parse(build.budgetLedgerJson), claimed = ledger.tasks[taskKey]
      const snapshot = await readAgentRunV1(data.scope, claimed.runId)
      const failed = await appendAgentRunEventV1({ scope: data.scope, runId: claimed.runId,
        expectedLastSequence: snapshot.projection.lastSequence, type: 'step.failed',
        payload: { stepId: taskKey, attempt: claimed.attempt, code: 'task-timeout', retryable: true, category: 'transient', action: 'retry' } })
      const reservation = data.plan.tasks[0].budgetReservation
      const held = { modelCalls: reservation.modelCalls, inputTokens: reservation.inputTokens,
        outputTokens: reservation.outputTokens, mediaCalls: reservation.mediaCalls, costUsd: reservation.maximumCostUsd,
        durationMs: reservation.durationMs, storageBytes: reservation.storageBytes }
      ledger.tasks[taskKey] = { ...claimed, status: 'failed', usage: null, errorCode: 'task-timeout' }
      ledger.attempts.push({ controlEpoch: build.controlEpoch, taskKey, runId: claimed.runId, attempt: claimed.attempt,
        idempotencyKey: claimed.idempotencyKey, outcome: 'failed', usage: held, usageKnown: false, errorCode: 'task-timeout' })
      assertProductProductionBudgetLedgerV1(stable(ledger))
      await db.productBuilds.update(build.id!, { budgetLedgerJson: stable(ledger), failureJson: stable({ taskKey,
        code: 'task-timeout', attempt: claimed.attempt, detail: 'Historical paid timeout, usage unknown',
        failureProvenance: { runId: claimed.runId, rootRunId: failed.run.parentRunId,
          controlEpoch: build.controlEpoch, planHash: build.planHash, attempt: claimed.attempt } }) })
    } else {
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 24 * 3600_000)
    }
    await runProductProductionUntilBlockedV1({ ...input, suppliedPlan: undefined })
    expect(executor).not.toHaveBeenCalled()
  }
  const details = await readProductProductionDetailsV1(data.scope, data.productionId, ['ttrpg'])
  expect(details.build!.status).toBe('recovery-required')
  const before = details.build!, originalPlan = before.planJson, originalLedger = before.budgetLedgerJson
  const failure = JSON.parse(before.failureJson), provenance = failure.failureProvenance
  expect(failure).toHaveProperty('failureProvenance')
  expect(provenance.runId).toBeGreaterThan(0)
  const oldRun = await readAgentRunV1(data.scope, provenance.runId)
  expect(oldRun.run.status).toBe('failed')
  const attempts = JSON.parse(originalLedger).attempts
  expect(attempts.filter((a: { usageKnown: boolean }) => !a.usageKnown)).toHaveLength(1)
  await runProductProductionUntilBlockedV1({ ...input, suppliedPlan: undefined })
  expect((await db.productBuilds.get(before.id!))!.budgetLedgerJson).toBe(originalLedger)
  expect((await db.productBuilds.get(before.id!))!.planJson).toBe(originalPlan)

  await expect(retryProductProductionBlockerV1({ scope: data.scope, details })).rejects.toThrow(/请先|必须先/)
  const authorDraftJson = JSON.stringify({ schema: 'storyforge.ttrpg-open-source-facts', version: 1, factPolicy: [] })
  await expect(retryProductProductionBlockerV1({ scope: data.scope, details, authorDraftJson })).rejects.toThrow(/请先|必须先/)
  const naked = await executeProductProductionCommand({ scope: data.scope, productionId: data.productionId,
    command: { type: 'resolve-blocker', commandId: 'timeout-accounting.naked', expectedStateRevision: details.production.stateRevision,
      blockerKey: taskKey, resolution: { action: 'retry', note: 'missing accounting must fail' } } })
  expect(naked.ok).toBe(false)
  const edited = await executeProductProductionCommand({ scope: data.scope, productionId: data.productionId,
    command: { type: 'resolve-blocker', commandId: 'timeout-accounting.unbooked-edit', expectedStateRevision: details.production.stateRevision,
      blockerKey: taskKey, resolution: { action: 'author-edit', authorDraftJson, note: 'zero-call edits still require original booking' } } })
  expect(edited.ok).toBe(false)
  for (const field of ['runId', 'attempt', 'controlEpoch'] as const) {
    const reservation = { runId: provenance.runId, attempt: provenance.attempt, controlEpoch: provenance.controlEpoch,
      disposition: 'charge-reservation-upper-bound' as const }
    reservation[field]++
    const forged = await executeProductProductionCommand({ scope: data.scope, productionId: data.productionId,
      command: { type: 'resolve-blocker', commandId: 'timeout-accounting.foreign.' + field,
        expectedStateRevision: details.production.stateRevision, blockerKey: taskKey,
        resolution: { action: 'retry', note: 'foreign accounting identity must fail', unknownResultReservation: reservation } } })
    expect(forged.ok).toBe(false)
  }
  expect((await db.productBuilds.get(before.id!))!.budgetLedgerJson).toBe(originalLedger)
  const accounting = await retryProductProductionBlockerV1({ scope: data.scope, details,
    unknownResultDisposition: 'charge-reservation-upper-bound', ...(action === 'author-edit' ? { authorDraftJson } : {}) })
  expect(accounting).toBe('author-charged-reservation-upper-bound')
  const booked = (await db.productBuilds.get(before.id!))!
  const bookedAttempt = JSON.parse(booked.budgetLedgerJson).attempts.find((a: {runId: number}) => a.runId === provenance.runId)
  expect(bookedAttempt.usageKnown).toBe(true)
  expect(bookedAttempt.usage).toEqual(attempts[0].usage)
  expect(bookedAttempt.resolution).toBe('author-charged-reservation-upper-bound')
  const resumed = vi.fn<ProductProductionTaskExecutorV1>(async () => { throw new ProductProductionResultUnknownErrorV1() })
  const runText = vi.fn<ProductionTextRunnerV1>(async () => { throw new ProductProductionResultUnknownErrorV1() })
  const execute = action === 'author-edit'
    ? createConfiguredProductProductionExecutorV1({ production: (await db.productProductions.get(data.productionId))!, brief: data.brief, runText })
    : resumed
  await runProductProductionUntilBlockedV1({ ...input, executor: execute, suppliedPlan: undefined })
  if (action === 'author-edit') {
    expect(runText).toHaveBeenCalledTimes(1)
    expect(runText.mock.calls[0][0].system).toContain('storyforge.ttrpg-open-rule-system')
    const artifacts = await db.productBuildArtifacts.where('buildId').equals(before.id!).toArray()
    expect(artifacts.filter(row => row.artifactKey === taskKey && row.status === 'accepted')).toHaveLength(1)
  } else expect(resumed).toHaveBeenCalledTimes(1)
  const after = (await db.productBuilds.get(before.id!))!, currentPlan = JSON.parse(after.planJson)
  expect(currentPlan.tasks).toEqual(JSON.parse(originalPlan).tasks)
  expect(after.controlEpoch).toBe(before.controlEpoch + 1)
  expect((await readAgentRunV1(data.scope, provenance.runId)).events.slice(0, oldRun.events.length)).toEqual(oldRun.events)
}, 30000)


it.each([
  ['unknown held model usage', false, 1, 'ttrpg.open.source-facts', true],
  ['actual known model usage', true, 1, 'ttrpg.open.source-facts', false],
  ['zero-call deterministic timeout', false, 0, 'ttrpg.open.source-facts', false],
  ['other task reservation', false, 1, 'ttrpg.open.rule-system', false],
] as const)('legacy timeout accounting distinguishes %s', (_label, usageKnown, modelCalls, taskKey, expected) => {
  const ledger = { schema: 'storyforge.product-production-budget-ledger', version: 2, rootRunId: null, rootClaim: null, tasks: {},
    attempts: [{ taskKey, runId: 2, attempt: 1, controlEpoch: 0, idempotencyKey: '', outcome: 'failed', usageKnown,
      errorCode: 'task-timeout', usage: { modelCalls, mediaCalls: 0, inputTokens: modelCalls * 100,
        outputTokens: modelCalls * 100, durationMs: 10, storageBytes: 0, costUsd: 0 } }] }
  const budgetLedgerJson = stable(ledger)
  assertProductProductionBudgetLedgerV1(budgetLedgerJson)
  expect(productProductionFailureNeedsProviderAccountingV1({ failureJson: stable({ code: 'task-timeout', taskKey: 'ttrpg.open.source-facts' }),
    budgetLedgerJson })).toBe(expected)
})

it('corrupt accounting proof cannot make an uncertain timeout appear free', () => {
  expect(productProductionFailureNeedsProviderAccountingV1({ failureJson: '{broken', budgetLedgerJson: '{}' })).toBe(true)
  expect(productProductionFailureNeedsProviderAccountingV1({ failureJson: stable({ code: 'task-timeout' }), budgetLedgerJson: '{broken' })).toBe(true)
})


it('a V1 failed timeout without usage stays uncertain and reading does not rewrite its ledger', () => {
  const budgetLedgerJson = stable({ schema: 'storyforge.product-production-budget-ledger', version: 1,
    rootRunId: null, rootClaim: null, tasks: { 'ttrpg.open.source-facts': { runId: 2, attempt: 1,
      status: 'failed', idempotencyKey: '', candidateHash: null, terminalReceiptHash: null,
      passedGateIds: [], usage: null, errorCode: 'task-timeout' } } })
  assertProductProductionBudgetLedgerV1(budgetLedgerJson)
  const build = { failureJson: stable({ code: 'task-timeout', taskKey: 'ttrpg.open.source-facts' }), budgetLedgerJson }
  expect(productProductionFailureNeedsProviderAccountingV1(build)).toBe(true)
  expect(build.budgetLedgerJson).toBe(budgetLedgerJson)
})
