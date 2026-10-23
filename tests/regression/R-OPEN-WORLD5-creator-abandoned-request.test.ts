import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { appendAgentRunEventV1, readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { createTextOpenWorldProductionExecutorV1 } from '../../src/lib/open-world/production-executor'
import {
  ProductProductionRetryableExecutionErrorV1,
  runProductProductionSchedulerCycleV1,
  type ProductProductionTaskExecutorV1,
} from '../../src/lib/product-production/scheduler'
import type { AgentRunEventPayloadByTypeV1, AgentRunEventTypeV1 } from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedAuthorizedTextOpenWorldCreatorBuildV1 } from '../helpers/text-open-world-creator-build'

beforeEach(async () => { await db.delete(); await db.open() })
afterAll(async () => { await db.delete() })

it.each(['pending', 'responded', 'completed-then-pending', 'prior-attempt-only', 'prior-paid-then-pending'] as const)(
  'Creator abandoned P1 classifies current nested boundaries: %s', async mode => {
    const world = await seedCurrentProductWorld(`creator-abandoned-${mode}`)
    const creator = await seedAuthorizedTextOpenWorldCreatorBuildV1({
      source: { kind: 'world-release', scope: world.scope, localReleaseRecordId: world.release.id!,
        expectedReleaseHash: world.release.contentHash },
      sessionKey: `creator-abandoned-${mode}`,
    })
    let started!: () => void
    let release!: () => void
    const boundaryReached = new Promise<void>(resolve => { started = resolve })
    const held = new Promise<void>(resolve => { release = resolve })
    const heldExecutor = vi.fn<ProductProductionTaskExecutorV1>(async input => {
      // Synthetic provider boundaries in an isolated DB. The real Creator
      // contract suppresses the outer P1 request, as the production executor does.
      async function append<T extends AgentRunEventTypeV1>(type: T, payload: AgentRunEventPayloadByTypeV1[T]) {
        const snapshot = await readAgentRunV1(creator.scope, input.taskRunId)
        await appendAgentRunEventV1({ scope: creator.scope, runId: input.taskRunId,
          type, payload, expectedLastSequence: snapshot.projection.lastSequence })
      }
      const stepId = 'p1.source-curation.source.source-curation.batch.001'
      if (input.attempt === 1) {
        await append('step.scheduled', { stepId })
        await append('step.started', { stepId, attempt: 1 })
        await append('model.requested', { stepId, attempt: 1, bindingHash: 'b'.repeat(64) })
        if (mode !== 'pending') {
          await append('model.responded', { stepId, attempt: 1, outputHash: 'c'.repeat(64) })
        }
        if (mode === 'prior-attempt-only' || mode === 'prior-paid-then-pending') {
          await append('step.failed', { stepId, attempt: 1, code: 'test-transport-retry',
            retryable: true, category: 'transient', action: 'retry' })
          throw new ProductProductionRetryableExecutionErrorV1('isolated prior paid attempt', {
            modelCalls: 1, inputTokens: 1, outputTokens: 1, mediaCalls: 0,
            costUsd: 0, durationMs: 1, storageBytes: 0,
          })
        }
        if (mode === 'completed-then-pending') {
          await append('candidate.persisted', { stepId, attempt: 1,
            candidateHash: 'c'.repeat(64), requiresConfirmation: false })
          await append('step.succeeded', { stepId, attempt: 1, outputHash: 'c'.repeat(64) })
          const nextStep = 'p1.source-curation.source.source-curation.batch.002'
          await append('step.scheduled', { stepId: nextStep })
          await append('step.started', { stepId: nextStep, attempt: 1 })
          await append('model.requested', { stepId: nextStep, attempt: 1, bindingHash: 'b'.repeat(64) })
        }
      } else if (mode === 'prior-paid-then-pending') {
        // Outer attempt 2 can dispatch a new nested batch at nested attempt 1.
        const nextStep = 'p1.source-curation.source.source-curation.batch.002'
        await append('step.scheduled', { stepId: nextStep })
        await append('step.started', { stepId: nextStep, attempt: 1 })
        await append('model.requested', { stepId: nextStep, attempt: 1, bindingHash: 'b'.repeat(64) })
      }
      started()
      await held
      throw new Error('isolated abandoned process unwound after durable classification')
    })
    const executor = createTextOpenWorldProductionExecutorV1({
      production: (await db.productProductions.get(creator.productionId))!,
      brief: creator.start.executionBrief,
      taskExecutors: { 'p1.source-curation': heldExecutor },
    })
    const cycleInput = { scope: creator.scope, productionId: creator.productionId, executor,
      capabilityBindings: [{ requirementKey: 'text-open-world.production.text.v1',
        adapterId: 'configured-text-provider.v1', bindingHash: 'b'.repeat(64) }] }
    await runProductProductionSchedulerCycleV1(cycleInput) // P0 only.
    if (mode === 'prior-attempt-only' || mode === 'prior-paid-then-pending') {
      await runProductProductionSchedulerCycleV1(cycleInput)
    }
    const abandoned = runProductProductionSchedulerCycleV1(cycleInput)
    await boundaryReached
    vi.resetModules() // HMR loses process-local ownership, not durable evidence.
    const reloaded = await import('../../src/lib/product-production/scheduler')
    const duplicate = vi.fn<ProductProductionTaskExecutorV1>(async () => {
      throw new Error('must not redispatch an abandoned attempt')
    })
    try {
      const recent = await reloaded.runProductProductionSchedulerCycleV1({ ...cycleInput, executor: duplicate })
      expect(recent.buildStatus).toBe('building')
      expect(duplicate).not.toHaveBeenCalled()
      const currentBuild = (await db.productBuilds.get(creator.buildId))!
      const currentLedger = JSON.parse(currentBuild.budgetLedgerJson)
      const runId = currentLedger.tasks['p1.source-curation'].runId
      const snapshot = await readAgentRunV1(creator.scope, runId)
      expect(snapshot.events.filter(event => event.type === 'model.requested'
        && event.payload.stepId === 'p1.source-curation')).toHaveLength(0)
      expect(snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(
        mode === 'completed-then-pending' || mode === 'prior-paid-then-pending' ? 2 : 1,
      )
      const priorEvents = structuredClone(snapshot.events)
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1_000)
      const blocked = await reloaded.runProductProductionSchedulerCycleV1({ ...cycleInput, executor: duplicate })
      vi.useRealTimers()
      expect(blocked.buildStatus).toBe('recovery-required')
      expect(duplicate).not.toHaveBeenCalled()
      const build = (await db.productBuilds.get(creator.buildId))!
      const code = mode === 'prior-attempt-only' ? 'task-timeout-before-dispatch'
        : mode === 'responded' ? 'task-finalization-failed' : 'provider-result-unknown'
      expect(JSON.parse(build.failureJson).code).toBe(code)
      const attempts = JSON.parse(build.budgetLedgerJson).attempts.filter(
        (row: { runId: number }) => row.runId === runId,
      )
      expect(attempts.at(-1)).toMatchObject({ errorCode: code, usageKnown: mode === 'prior-attempt-only' })
      if (mode === 'prior-attempt-only') {
        expect(attempts).toHaveLength(2)
        expect(attempts[0]).toMatchObject({ attempt: 1, usageKnown: true, usage: { modelCalls: 1 } })
        expect(attempts[1]).toMatchObject({ attempt: 2, usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0 } })
      } else {
        expect(attempts.at(-1).usage.modelCalls).toBeGreaterThan(0)
        if (mode === 'prior-paid-then-pending') {
          expect(attempts).toHaveLength(2)
          expect(attempts[0]).toMatchObject({ attempt: 1, usageKnown: true, usage: { modelCalls: 1 } })
          expect(attempts[1]).toMatchObject({ attempt: 2, usageKnown: false })
        }
      }
      const settled = await readAgentRunV1(creator.scope, runId)
      expect(settled.events.slice(0, priorEvents.length)).toEqual(priorEvents)
    } finally {
      vi.useRealTimers()
      release()
      await abandoned.catch(() => undefined)
    }
  }, 30_000,
)
